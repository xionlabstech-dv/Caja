'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/components/Providers';
import { PERIODOS, TipoPeriodo, rangoPeriodo } from '@/lib/periodos';
import {
  fetchTotales,
  fetchPorMetodo,
  fetchTopProductos,
  fetchPorDiaSemana,
  fetchMermas,
  fetchAbonosFiado,
  fetchAnulaciones,
  fetchConsumoPropio,
  fetchFaltantesConteo,
  TotalesPeriodo,
  DesglosePorMetodo,
  TopProducto,
  VentasPorDiaSemana,
  OrdenTopProductos,
  MermaPorMotivo,
  AbonosFiadoPeriodo,
  VentaAnulada,
  PerdidaAgregada,
} from '@/lib/reportes';
import { formatBS, formatUSD } from '@/lib/precio';
import { useGuardarRuta } from '@/lib/useGuardarRuta';
import ThemeToggle from '@/components/ThemeToggle';
import Icon from '@/components/ui/Icon';
import { TAMANO_ICONO } from '@/components/ui/iconos';

// ventas.metodo_pago es texto libre en Supabase (sin enum/check), y conviven
// dos esquemas de nombres en los datos reales: el que usa la pantalla de
// Caja ('efectivo_bs'/'efectivo_usd') y el que aparece en el histórico ya
// cargado ('efectivo'/'divisa'). Se mapean ambos al mismo label/color/moneda
// para que ningún método quede sin etiqueta — y cualquier valor futuro no
// contemplado cae en un fallback visible en vez de un chip vacío. Paleta
// categórica plana (no son tokens del sistema neutro) — mismo criterio que
// los chips de método en Resumen/Ventas recientes.
interface MetodoInfo { label: string; color: string; enUsd: boolean }

const METODO_INFO: Record<string, MetodoInfo> = {
  efectivo_bs: { label: 'Efectivo Bs', color: 'bg-emerald-100 text-emerald-700', enUsd: false },
  efectivo: { label: 'Efectivo Bs', color: 'bg-emerald-100 text-emerald-700', enUsd: false },
  pago_movil: { label: 'Pago Móvil', color: 'bg-blue-100 text-blue-700', enUsd: false },
  biopago: { label: 'Biopago', color: 'bg-purple-100 text-purple-700', enUsd: false },
  tarjeta: { label: 'Tarjeta', color: 'bg-slate-100 text-slate-700', enUsd: false },
  efectivo_usd: { label: 'Efectivo $', color: 'bg-amber-100 text-amber-700', enUsd: true },
  divisa: { label: 'Efectivo $', color: 'bg-amber-100 text-amber-700', enUsd: true },
  // reportes_por_metodo lee de venta_pagos, donde 'fiado' sí aparece como
  // método real (273 ventas en producción) — antes caía en el fallback gris.
  fiado: { label: 'Fiado', color: 'bg-orange-100 text-orange-700', enUsd: false },
};

function metodoInfo(metodoPago: string): MetodoInfo {
  return METODO_INFO[metodoPago] ?? { label: metodoPago, color: 'bg-gray-100 text-gray-600', enUsd: false };
}

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DIAS_SEMANA_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const ORDEN_LUNES_A_DOMINGO = [1, 2, 3, 4, 5, 6, 0];

const MERMA_MOTIVO_LABELS: Record<string, string> = {
  dano: 'Daño',
  vencido: 'Vencido',
  perdida: 'Pérdida',
};

const EYEBROW_PERIODO: Record<TipoPeriodo, string> = {
  hoy: 'hoy', semana: 'esta semana', mes: 'este mes', personalizado: 'el período',
};

function formatearNombre(nombre: string): string {
  return nombre
    .toLowerCase()
    .split(' ')
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// hasta siempre llega exclusivo (ver periodos.ts) — se resta un día para
// mostrar el último día real incluido en el rango.
function formatearRango(tipo: TipoPeriodo, desde: Date, hastaExclusiva: Date): string {
  const hasta = new Date(hastaExclusiva.getTime() - 1);
  if (tipo === 'hoy') {
    return capitalizar(desde.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long' }));
  }
  const mismoMes = desde.getMonth() === hasta.getMonth() && desde.getFullYear() === hasta.getFullYear();
  const desdeTxt = desde.toLocaleDateString('es-VE', mismoMes ? { day: 'numeric' } : { day: 'numeric', month: 'long' });
  const hastaTxt = hasta.toLocaleDateString('es-VE', { day: 'numeric', month: 'long', year: 'numeric' });
  return `${desdeTxt} — ${hastaTxt}`;
}

function fmtFechaHoraCorta(iso: string): string {
  return new Date(iso).toLocaleString('es-VE', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function fmtUnidades(cantidad: number): string {
  const txt = cantidad.toLocaleString('es-VE', { maximumFractionDigits: 3 });
  return `${txt} ${cantidad === 1 ? 'unidad' : 'uds'}`;
}

// yyyy-mm-dd local — lo que espera/devuelve <input type="date">. Se arma a
// mano (no toISOString) para no correr el día por huso horario.
function fechaInputStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseFechaInput(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function calcularRango(periodoTipo: TipoPeriodo, personalizado: { desde: Date; hasta: Date } | null): { desde: Date; hasta: Date } {
  if (periodoTipo === 'personalizado') return personalizado ?? rangoPeriodo('mes');
  return rangoPeriodo(periodoTipo);
}

const ATAJOS_RANGO: { label: string; calcular: () => { desde: Date; hasta: Date } }[] = [
  {
    label: 'Últimos 7 días',
    calcular: () => {
      const hoy = new Date();
      const desde = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 6);
      return { desde, hasta: hoy };
    },
  },
  {
    label: 'Mes pasado',
    calcular: () => {
      const hoy = new Date();
      const desde = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
      const hasta = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
      return { desde, hasta };
    },
  },
  {
    label: 'Últimos 3 meses',
    calcular: () => {
      const hoy = new Date();
      const desde = new Date(hoy.getFullYear(), hoy.getMonth() - 3, hoy.getDate());
      return { desde, hasta: hoy };
    },
  },
];

export default function ReportesPage() {
  const permitida = useGuardarRuta();
  const router = useRouter();
  const { negocioId, isOnline, rol, usaCostos, usaStock, tasa } = useApp();

  const [periodoTipo, setPeriodoTipo] = useState<TipoPeriodo>('hoy');
  const [rangoPersonalizado, setRangoPersonalizado] = useState<{ desde: Date; hasta: Date } | null>(null);

  const [loading, setLoading] = useState(true);
  const [huboError, setHuboError] = useState(false);
  const [totales, setTotales] = useState<TotalesPeriodo | null>(null);
  const [porMetodo, setPorMetodo] = useState<DesglosePorMetodo[]>([]);
  const [topProductos, setTopProductos] = useState<TopProducto[]>([]);
  const [porDiaSemana, setPorDiaSemana] = useState<VentasPorDiaSemana[]>([]);
  const [mermasList, setMermasList] = useState<MermaPorMotivo[]>([]);
  const [abonosFiado, setAbonosFiado] = useState<AbonosFiadoPeriodo | null>(null);
  const [anulaciones, setAnulaciones] = useState<VentaAnulada[]>([]);
  const [consumoPropio, setConsumoPropio] = useState<PerdidaAgregada | null>(null);
  const [faltantesConteo, setFaltantesConteo] = useState<PerdidaAgregada | null>(null);
  // Solo tiene sentido si podría haber ganancia que mostrar — ver también el
  // gate de renderizado más abajo (mostrarGanancia).
  const [ordenTop, setOrdenTop] = useState<OrdenTopProductos>('cantidad');

  const [showRango, setShowRango] = useState(false);
  const [desdeInput, setDesdeInput] = useState('');
  const [hastaInput, setHastaInput] = useState('');

  useEffect(() => {
    if (!isOnline || !negocioId) {
      setLoading(false);
      return;
    }
    // Personalizado recién elegido en el chip (antes de pasar por la hoja):
    // todavía no hay rango que pedir.
    if (periodoTipo === 'personalizado' && !rangoPersonalizado) {
      setLoading(false);
      return;
    }

    let cancelado = false;
    setLoading(true);
    setHuboError(false);

    const { desde, hasta } = calcularRango(periodoTipo, rangoPersonalizado);

    Promise.all([
      fetchTotales(negocioId, desde, hasta),
      fetchPorMetodo(negocioId, desde, hasta),
      fetchTopProductos(negocioId, desde, hasta, 10, ordenTop),
      fetchPorDiaSemana(negocioId, desde, hasta),
      // Mermas sigue atado a usa_stock (igual que hoy) — a diferencia de
      // abonos/anulaciones/consumo propio/faltantes, que se muestran
      // siempre, tenga o no el negocio control de inventario activado.
      usaStock ? fetchMermas(negocioId, desde, hasta) : Promise.resolve(null),
      fetchAbonosFiado(negocioId, desde, hasta),
      fetchAnulaciones(negocioId, desde, hasta),
      fetchConsumoPropio(negocioId, desde, hasta),
      fetchFaltantesConteo(negocioId, desde, hasta),
    ]).then(([tot, metodo, top, dias, mermasData, abonos, anuls, consumo, faltantes]) => {
      if (cancelado) return;
      if (tot === null) {
        setHuboError(true);
        setLoading(false);
        return;
      }
      setTotales(tot);
      setPorMetodo(metodo ?? []);
      setTopProductos(top ?? []);
      setPorDiaSemana(dias ?? []);
      setMermasList(mermasData ?? []);
      setAbonosFiado(abonos);
      setAnulaciones(anuls ?? []);
      setConsumoPropio(consumo);
      setFaltantesConteo(faltantes);
      setLoading(false);
    });

    return () => { cancelado = true; };
  }, [periodoTipo, rangoPersonalizado, isOnline, negocioId, ordenTop, usaStock]);

  if (!permitida) return null;

  const rango = calcularRango(periodoTipo, rangoPersonalizado);
  const rangoTexto = formatearRango(periodoTipo, rango.desde, rango.hasta);
  const diasEnPeriodo = Math.max(1, Math.round((rango.hasta.getTime() - rango.desde.getTime()) / 86400000));

  const ticketPromedioBs = totales && totales.cantidad_ventas > 0 ? totales.total_bs / totales.cantidad_ventas : 0;
  const ticketPromedioUsd = totales && totales.cantidad_ventas > 0 ? totales.total_usd / totales.cantidad_ventas : 0;

  const totalGeneral = porMetodo.reduce((s, m) => s + m.total_bs, 0);
  const maxMetodoBs = porMetodo.length > 0 ? Math.max(...porMetodo.map(m => m.total_bs)) : 0;

  // Gate por rol Y por preferencia del negocio — aunque la RPC ya devuelve
  // null en ganancia_usd para un no-admin, esta pantalla nunca debe intentar
  // renderizar nada de costo/ganancia basándose solo en "el campo vino con
  // dato": se verifica explícitamente quién está mirando.
  const mostrarGanancia = rol === 'admin' && usaCostos;
  const hayGanancia = mostrarGanancia && totales?.items_con_costo != null && totales.items_con_costo > 0;
  const gananciaBs = hayGanancia ? totales!.ganancia_usd! * tasa : 0;
  const coberturaPct = hayGanancia && totales?.items_totales
    ? Math.round((totales!.items_con_costo! / totales!.items_totales!) * 100)
    : null;

  const sinVentas = !totales || totales.cantidad_ventas === 0;
  const totalBsTexto = formatBS(totales?.total_bs ?? 0);

  const mermaTotalCantidad = mermasList.reduce((s, m) => s + m.cantidad, 0);
  const mermaTotalValorUsd = mermasList.reduce((s, m) => s + (m.valor_usd ?? 0), 0);
  const consumoCantidad = consumoPropio?.cantidad ?? 0;
  const faltantesCantidad = faltantesConteo?.cantidad ?? 0;

  const anulTotalBs = anulaciones.reduce((s, a) => s + a.total_bs, 0);
  const anulTotalUsd = anulaciones.reduce((s, a) => s + a.total_usd, 0);

  // Gráfico de ventas por día: 7 columnas fijas Lun–Dom, la de hoy resaltada
  // (no necesariamente la de mayor promedio).
  const hoyDow = new Date().getDay();
  const diasConDatos = ORDEN_LUNES_A_DOMINGO.map(dow => porDiaSemana.find(d => d.dia_semana === dow && d.ocurrencias > 0) ?? null);
  const promedios = diasConDatos.filter((d): d is VentasPorDiaSemana => d !== null).map(d => d.promedio_bs);
  const maxProm = promedios.length > 0 ? Math.max(...promedios) : 1;
  const hayDatosDia = promedios.length > 0;

  const barras = ORDEN_LUNES_A_DOMINGO.map((dow, i) => {
    const d = diasConDatos[i];
    return {
      dow,
      label: DIAS_SEMANA_CORTO[dow],
      esHoy: dow === hoyDow,
      altoPx: d ? Math.max(6, (d.promedio_bs / maxProm) * 96) : 6,
      valorTexto: d ? Math.round(d.promedio_bs).toLocaleString('es-VE') : '—',
    };
  });

  let diasNota = 'Promedio vendido en Bs por cada día de la semana dentro del período.';
  const diasReales = diasConDatos.filter((d): d is VentasPorDiaSemana => d !== null);
  if (diasReales.length >= 2) {
    const mayor = diasReales.reduce((a, b) => (a.promedio_bs >= b.promedio_bs ? a : b));
    const menor = diasReales.reduce((a, b) => (a.promedio_bs <= b.promedio_bs ? a : b));
    if (menor.promedio_bs > 0 && mayor.dia_semana !== menor.dia_semana) {
      const factor = mayor.promedio_bs / menor.promedio_bs;
      diasNota = `El ${DIAS_SEMANA[mayor.dia_semana].toLowerCase()} rinde ${factor.toLocaleString('es-VE', { maximumFractionDigits: 1 })} veces lo del ${DIAS_SEMANA[menor.dia_semana].toLowerCase()}.`;
    }
  }

  // Hoja de período personalizado
  const abrirRango = () => {
    const base = rangoPersonalizado ?? rangoPeriodo('mes');
    const hastaInclusiva = new Date(base.hasta.getTime() - 1);
    setDesdeInput(fechaInputStr(base.desde));
    setHastaInput(fechaInputStr(hastaInclusiva));
    setShowRango(true);
  };
  const errorRango = hastaInput < desdeInput ? 'La fecha "hasta" no puede ser anterior a "desde".' : '';
  const confirmarRango = () => {
    if (errorRango) return;
    const desde = parseFechaInput(desdeInput);
    const hastaInclusiva = parseFechaInput(hastaInput);
    const hasta = new Date(hastaInclusiva.getFullYear(), hastaInclusiva.getMonth(), hastaInclusiva.getDate() + 1);
    setRangoPersonalizado({ desde, hasta });
    setPeriodoTipo('personalizado');
    setShowRango(false);
  };

  return (
    <div>
      <header className="bg-superficie-barra border-b border-borde-divisor px-4 pt-3.5 pb-3 flex items-center gap-2.5">
        <button onClick={() => router.back()} className="p-1 -ml-1 flex-shrink-0 text-texto-3" aria-label="Volver">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-texto truncate">Reportes</h1>
          <p className="text-[11px] font-medium text-texto-3 truncate">{rangoTexto}</p>
        </div>
        <div className={`flex-none flex items-center gap-1.5 h-7 px-2.5 rounded-full ${isOnline ? 'bg-marca-suave' : 'bg-aviso-fondo'}`}>
          <Icon
            nombre={isOnline ? 'enLinea' : 'sinConexion'}
            tamano={TAMANO_ICONO.chip}
            className={isOnline ? 'text-marca-suave-texto' : 'text-aviso'}
          />
          <span className={`text-[11px] font-semibold whitespace-nowrap ${isOnline ? 'text-marca-suave-texto' : 'text-aviso'}`}>
            {isOnline ? 'En línea' : 'Sin conexión'}
          </span>
        </div>
        <ThemeToggle variant="neutro" />
      </header>

      <div className="px-4 py-3 bg-superficie-barra border-b border-borde-divisor flex gap-2 overflow-x-auto">
        {PERIODOS.map(p => {
          const activo = periodoTipo === p.tipo;
          return (
            <button
              key={p.tipo}
              onClick={() => (p.tipo === 'personalizado' ? abrirRango() : setPeriodoTipo(p.tipo))}
              className={`flex-shrink-0 px-3.5 py-2 rounded-full text-sm font-semibold flex items-center gap-1.5 transition-colors border ${
                activo ? 'bg-marca-suave text-marca-suave-texto border-marca' : 'bg-transparent text-texto-3 border-borde-campo'
              }`}
            >
              {p.tipo === 'personalizado' && <Icon nombre="calendario" tamano={14} />}
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="p-4 space-y-4">
        {!isOnline ? (
          <div className="text-center text-texto-3 py-16">
            <Icon nombre="sinConexion" tamano={48} className="mx-auto mb-3 text-texto-4" />
            <p className="font-medium">Los reportes necesitan conexión a internet</p>
            <p className="text-sm mt-1">Se muestran apenas recuperes la señal</p>
          </div>
        ) : loading ? (
          <div className="text-center text-texto-3 py-16">
            <svg className="w-8 h-8 mx-auto mb-3 text-marca animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="font-medium">Calculando...</p>
          </div>
        ) : huboError ? (
          <div className="text-center text-texto-3 py-16">
            <p className="font-medium">No se pudieron cargar los reportes</p>
            <p className="text-sm mt-1">Intenta de nuevo en unos segundos</p>
          </div>
        ) : (
          <>
            {/* Total vendido — único elemento "en tinta" de la pantalla */}
            <div className="p-5 rounded-2xl bg-tinta">
              <p className="text-[11px] font-bold uppercase tracking-wide text-tinta-etiqueta">
                Total vendido · {EYEBROW_PERIODO[periodoTipo]}
              </p>
              <p className={`mt-1.5 font-extrabold text-tinta-texto tracking-tight ${totalBsTexto.length > 14 ? 'text-3xl' : 'text-4xl'}`}>
                {totalBsTexto}
              </p>
              <p className="mt-1 text-tinta-etiqueta">{formatUSD(totales?.total_usd ?? 0)}</p>
            </div>

            {sinVentas && (
              <div className="p-4 rounded-2xl bg-tarjeta border border-borde-tarjeta space-y-1">
                <p className="font-bold text-texto">No hubo ventas en este período</p>
                <p className="text-sm text-texto-3">
                  Si esperabas ventas acá, revisa el rango de fechas. Lo que sí se movió en el período sigue más abajo.
                </p>
              </div>
            )}

            {!sinVentas && (
              <>
                {/* Indicadores */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="p-3.5 rounded-2xl bg-tarjeta border border-borde-tarjeta space-y-1">
                    <p className="text-[11px] font-semibold text-texto-3 truncate">Ventas</p>
                    <p className="text-xl font-bold text-texto">{totales!.cantidad_ventas}</p>
                    <p className="text-[11px] text-texto-3">
                      {diasEnPeriodo > 1 ? `${Math.round(totales!.cantidad_ventas / diasEnPeriodo)} por día` : 'en el día'}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-tarjeta border border-borde-tarjeta space-y-1">
                    <p className="text-[11px] font-semibold text-texto-3 truncate">Ticket promedio</p>
                    <p className="text-xl font-bold text-texto">{formatBS(ticketPromedioBs)}</p>
                    <p className="text-[11px] text-texto-3">{formatUSD(ticketPromedioUsd)}</p>
                  </div>
                  {hayGanancia && (
                    <div className="col-span-2 p-3.5 rounded-2xl bg-tarjeta border border-borde-tarjeta space-y-1">
                      <p className="text-[11px] font-semibold text-texto-3">Ganancia estimada</p>
                      <p className="text-xl font-bold text-texto">{formatBS(gananciaBs)}</p>
                      {coberturaPct !== null && (
                        <p className="text-[11px] text-texto-3">calculada sobre {coberturaPct}% de lo vendido con costo cargado</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Productos más vendidos */}
                {topProductos.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-texto-3">Productos más vendidos</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-texto-3">top 10</span>
                        {mostrarGanancia && (
                          <div className="flex gap-1 bg-tarjeta-hundida rounded-full p-0.5">
                            {(['cantidad', 'ganancia'] as OrdenTopProductos[]).map(valor => (
                              <button
                                key={valor}
                                onClick={() => setOrdenTop(valor)}
                                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                                  ordenTop === valor ? 'bg-tarjeta text-marca-suave-texto shadow-sm' : 'text-texto-3'
                                }`}
                              >
                                {valor === 'cantidad' ? 'Cantidad' : 'Ganancia'}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-px bg-borde-divisor rounded-2xl overflow-hidden">
                      {topProductos.map((p, i) => (
                        <div key={p.producto_id ?? p.nombre} className="flex items-center gap-3 px-3.5 py-2.5 bg-tarjeta">
                          <span className="w-5 flex-none text-right text-sm font-bold text-texto-4">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-texto truncate">{formatearNombre(p.nombre)}</p>
                            <p className="text-xs text-texto-3">
                              {formatBS(p.monto_total)}
                              {mostrarGanancia && p.ganancia_usd != null && (
                                <span className={p.ganancia_usd >= 0 ? 'text-marca-suave-texto' : 'text-negativo'}>
                                  {' '}· {p.ganancia_usd >= 0 ? '+' : ''}{formatBS(p.ganancia_usd * tasa)}
                                </span>
                              )}
                            </p>
                          </div>
                          <span className="flex-none text-sm font-bold text-texto text-right">
                            {p.es_por_peso
                              ? `${p.cantidad_total.toLocaleString('es-VE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`
                              : Math.round(p.cantidad_total)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Por método de pago */}
                {porMetodo.length > 0 && (
                  <div className="space-y-2">
                    <span className="block text-[11px] font-bold uppercase tracking-wide text-texto-3">Por método de pago</span>
                    <div className="space-y-2.5">
                      {porMetodo.map(m => {
                        const info = metodoInfo(m.metodo_pago);
                        const pct = totalGeneral > 0 ? (m.total_bs / totalGeneral) * 100 : 0;
                        const pctAncho = maxMetodoBs > 0 ? (m.total_bs / maxMetodoBs) * 100 : 0;
                        return (
                          <div key={m.metodo_pago} className="relative overflow-hidden p-3.5 rounded-2xl bg-tarjeta border border-borde-tarjeta">
                            <div className="absolute inset-y-0 left-0 bg-tarjeta-hundida" style={{ width: `${pctAncho}%` }} />
                            <div className="relative grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 items-center">
                              <span className={`justify-self-start px-2.5 py-1 rounded-full text-xs font-bold ${info.color}`}>
                                {info.label}
                              </span>
                              <span className="text-right text-xl font-bold text-texto">
                                {info.enUsd ? formatUSD(m.total_usd) : formatBS(m.total_bs)}
                              </span>
                              <span className="text-sm text-texto-3">{m.cantidad} {m.cantidad === 1 ? 'venta' : 'ventas'}</span>
                              <span className="text-right text-sm text-texto-3">{pct.toLocaleString('es-VE', { maximumFractionDigits: 0 })}%</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Abonos de fiado — no depende de que haya ventas en el período */}
            <div className="space-y-2">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-texto-3">Abonos de fiado</span>
              <div className="p-3.5 rounded-2xl bg-tarjeta border border-borde-tarjeta space-y-2.5">
                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-2xl font-bold text-texto tracking-tight">{formatBS(abonosFiado?.total_bs ?? 0)}</p>
                    <p className="text-sm text-texto-3">
                      {formatUSD(abonosFiado?.total_usd ?? 0)} · {abonosFiado?.cantidad === 1 ? '1 abono' : `${abonosFiado?.cantidad ?? 0} abonos`}
                    </p>
                  </div>
                  <button
                    onClick={() => router.push('/fiado')}
                    className="flex-none h-11 px-3 rounded-xl border border-borde-tarjeta bg-tarjeta-hundida text-texto-3 text-sm font-semibold flex items-center gap-1.5"
                  >
                    Ver fiado
                    <Icon nombre="flechaDerecha" tamano={14} />
                  </button>
                </div>
                <p className="text-xs text-texto-3">Plata que entró sin ser venta — no suma al total vendido.</p>
              </div>
            </div>

            {/* Pérdidas del período — tres bloques que nunca se suman */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-texto-3">Pérdidas del período</span>
                {!mostrarGanancia && <span className="text-[11px] font-medium text-texto-3">en unidades</span>}
              </div>

              <div className="space-y-2.5">
                {/* Mermas */}
                <div className={`p-3.5 rounded-2xl bg-tarjeta border space-y-2.5 ${mermaTotalCantidad > 0 ? 'border-aviso-borde' : 'border-borde-tarjeta'}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-bold text-texto">Mermas</p>
                    <p className={`text-base font-bold ${mermaTotalCantidad > 0 ? 'text-aviso' : 'text-texto-3'}`}>
                      {mermaTotalCantidad === 0
                        ? 'Ninguna'
                        : `${fmtUnidades(mermaTotalCantidad)}${mostrarGanancia ? ` · ${formatUSD(mermaTotalValorUsd)}` : ''}`}
                    </p>
                  </div>
                  {mermaTotalCantidad > 0 ? (
                    <div className="flex flex-col gap-px bg-borde-divisor rounded-lg overflow-hidden">
                      {mermasList.filter(m => m.cantidad > 0).map(m => (
                        <div key={m.motivo} className="flex items-baseline justify-between gap-3 px-3 py-2 bg-tarjeta-hundida">
                          <span className="text-sm text-texto-3">{MERMA_MOTIVO_LABELS[m.motivo] ?? m.motivo}</span>
                          <span className="text-sm font-semibold text-texto">
                            {fmtUnidades(m.cantidad)}{mostrarGanancia && m.valor_usd != null ? ` · ${formatUSD(m.valor_usd)}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-texto-3">No se registró ninguna merma en el período.</p>
                  )}
                </div>

                {/* Consumo propio */}
                <div className="p-3.5 rounded-2xl bg-tarjeta border border-borde-tarjeta space-y-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-bold text-texto">Consumo propio</p>
                    <p className={`text-base font-bold ${consumoCantidad === 0 ? 'text-texto-3' : 'text-texto'}`}>
                      {consumoCantidad === 0
                        ? 'Ninguno'
                        : `${fmtUnidades(consumoCantidad)}${mostrarGanancia && consumoPropio?.valor_usd != null ? ` · ${formatUSD(consumoPropio.valor_usd)}` : ''}`}
                    </p>
                  </div>
                  <p className="text-xs text-texto-3">
                    {consumoCantidad === 0
                      ? 'No se registró consumo del negocio en el período.'
                      : 'Lo que el negocio se llevó para sí — no es pérdida por daño.'}
                  </p>
                </div>

                {/* Faltantes por conteo */}
                <div className={`p-3.5 rounded-2xl bg-tarjeta border space-y-1 ${faltantesCantidad > 0 ? 'border-negativo-borde' : 'border-borde-tarjeta'}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-bold text-texto">Faltantes por conteo</p>
                    <p className={`text-base font-bold ${faltantesCantidad > 0 ? 'text-negativo' : 'text-texto-3'}`}>
                      {faltantesCantidad === 0
                        ? 'Ninguno'
                        : `${fmtUnidades(faltantesCantidad)}${mostrarGanancia && faltantesConteo?.valor_usd != null ? ` · ${formatUSD(faltantesConteo.valor_usd)}` : ''}`}
                    </p>
                  </div>
                  <p className="text-xs text-texto-3">
                    {faltantesCantidad === 0
                      ? 'Los conteos del período cerraron sin diferencia.'
                      : 'Diferencia entre lo que decía el sistema y lo que se contó.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Anulaciones — no depende de que haya ventas en el período */}
            <div className="space-y-2">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-texto-3">Anulaciones</span>
              <div className={`p-3.5 rounded-2xl bg-tarjeta border space-y-3 ${anulaciones.length > 0 ? 'border-negativo-borde' : 'border-borde-tarjeta'}`}>
                <div>
                  <p className={`text-2xl font-bold tracking-tight ${anulaciones.length > 0 ? 'text-negativo' : 'text-texto-3'}`}>
                    {anulaciones.length > 0 ? formatBS(anulTotalBs) : 'Ninguna'}
                  </p>
                  <p className="text-sm text-texto-3">
                    {anulaciones.length === 0
                      ? 'Sin anulaciones'
                      : `${anulaciones.length === 1 ? '1 venta anulada' : `${anulaciones.length} ventas anuladas`} · ${formatUSD(anulTotalUsd)}`}
                  </p>
                </div>
                {anulaciones.length > 0 && (
                  <div className="flex flex-col gap-px bg-borde-divisor rounded-lg overflow-hidden">
                    {anulaciones.map(a => (
                      <div key={a.venta_id} className="px-3 py-2.5 bg-tarjeta-hundida space-y-1">
                        <div className="flex items-baseline justify-between gap-3">
                          {/* No hay correlativo ("Venta #N") disponible en esta
                              RPC — solo venta_id (uuid) — así que se identifica
                              por fecha/hora, no por número. Ver nota en el PR. */}
                          <span className="text-sm font-bold text-texto">{fmtFechaHoraCorta(a.vendida_en)}</span>
                          <span className="text-base font-bold text-texto line-through">{formatBS(a.total_bs)}</span>
                        </div>
                        {a.motivo_anulacion && <p className="text-sm text-texto">&ldquo;{a.motivo_anulacion}&rdquo;</p>}
                        {a.anulada_por_nombre && <p className="text-xs text-texto-3">Anulada por {a.anulada_por_nombre}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Ventas por día — promedio, no total; va al final */}
            {!sinVentas && hayDatosDia && (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-texto-3">Ventas por día</span>
                  <span className="text-[11px] font-medium text-texto-3">promedio por día</span>
                </div>
                <div className="p-3.5 rounded-2xl bg-tarjeta border border-borde-tarjeta space-y-2.5">
                  <div className="grid grid-cols-7 gap-1.5 items-end h-32">
                    {barras.map(b => (
                      <div key={b.dow} className="flex flex-col justify-end gap-1 h-32">
                        <span className="text-[10px] font-semibold text-texto-3 text-center whitespace-nowrap">{b.valorTexto}</span>
                        <div className={`rounded-t ${b.esHoy ? 'bg-marca' : 'bg-marca-suave'}`} style={{ height: `${b.altoPx}px` }} />
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1.5">
                    {barras.map(b => (
                      <div key={b.dow} className={`text-[11px] font-semibold text-center ${b.esHoy ? 'text-marca' : 'text-texto-3'}`}>
                        {b.label}
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-texto-3">{diasNota}</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Hoja: período personalizado */}
      {showRango && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-overlay" onClick={() => setShowRango(false)} />
          <div className="relative w-full max-w-lg mx-auto bg-tarjeta rounded-t-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-center px-4 pt-4 pb-2">
              <div className="w-8 h-1 bg-borde-tarjeta rounded-full" />
            </div>
            <div className="flex items-center gap-2 px-4 pb-2">
              <p className="flex-1 min-w-0 text-base font-bold text-texto">Período personalizado</p>
              <button onClick={() => setShowRango(false)} aria-label="Cerrar" className="flex-none w-9 h-9 flex items-center justify-center text-texto-4">
                <Icon nombre="cerrar" tamano={20} />
              </button>
            </div>
            <div className="px-4 pb-4 space-y-3">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-sm font-semibold text-texto-2 mb-1.5">Desde</label>
                  <input
                    type="date"
                    value={desdeInput}
                    onChange={e => setDesdeInput(e.target.value)}
                    className="w-full h-[52px] px-3 rounded-xl bg-tarjeta-hundida border border-borde-campo outline-none text-[15px] font-semibold text-texto"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-texto-2 mb-1.5">Hasta</label>
                  <input
                    type="date"
                    value={hastaInput}
                    onChange={e => setHastaInput(e.target.value)}
                    className={`w-full h-[52px] px-3 rounded-xl bg-tarjeta-hundida border outline-none text-[15px] font-semibold text-texto ${
                      errorRango ? 'border-negativo-borde' : 'border-borde-campo'
                    }`}
                  />
                </div>
              </div>
              {errorRango && (
                <p className="px-3 py-2.5 rounded-lg bg-negativo-fondo border border-negativo-borde text-sm font-semibold text-negativo">
                  {errorRango}
                </p>
              )}
              <div className="flex gap-2 flex-wrap">
                {ATAJOS_RANGO.map(a => (
                  <button
                    key={a.label}
                    onClick={() => {
                      const r = a.calcular();
                      setDesdeInput(fechaInputStr(r.desde));
                      setHastaInput(fechaInputStr(r.hasta));
                    }}
                    className="h-11 px-3.5 rounded-full border border-borde-campo bg-tarjeta-hundida text-texto-3 text-sm font-semibold whitespace-nowrap"
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="px-4 pt-3 pb-5 border-t border-borde-tarjeta">
              <button
                onClick={confirmarRango}
                disabled={!!errorRango}
                className="w-full h-[52px] rounded-2xl bg-marca text-texto-invertido font-bold text-[17px] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Ver el período
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
