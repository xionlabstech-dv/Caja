'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Presupuesto, Producto, ItemCarrito } from '@/types';
import { getPresupuestos, savePresupuesto, getProductos } from '@/lib/db';
import { getPresupuestoItemsRemoto } from '@/lib/sync';
import { encolarActualizarPresupuesto } from '@/lib/outbox';
import { formatBS, formatUSD } from '@/lib/precio';
import { compartirPresupuesto } from '@/lib/comprobante';
import { useApp } from '@/components/Providers';
import { useGuardarRuta } from '@/lib/useGuardarRuta';
import ThemeToggle from '@/components/ThemeToggle';
import Button from '@/components/ui/Button';
import BottomSheet from '@/components/ui/BottomSheet';
import Icon from '@/components/ui/Icon';
import { TAMANO_ICONO } from '@/components/ui/iconos';

function formatearNombre(nombre: string): string {
  return nombre
    .toLowerCase()
    .split(' ')
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

// fecha_vencimiento/creado_en de un presupuesto son 'date' puros
// ('YYYY-MM-DD'): parsearlos con `new Date(iso)` a secas los interpreta en
// UTC y puede mostrar el día anterior según la zona horaria.
function fmtFechaCorta(iso: string): string {
  const [anio, mes, dia] = iso.split('-').map(Number);
  return new Date(anio, mes - 1, dia).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
}

// A diferencia de fmtFechaCorta (fecha pura), convertido_en/anulado_en son
// timestamps reales (new Date().toISOString()) — acá sí corresponde
// new Date(iso) directo: toLocaleDateString ya convierte el instante a la
// zona horaria local, cortar el string y reparsearlo como fecha pura
// desplazaría el día cerca de la medianoche UTC.
function fmtFechaEvento(iso: string): string {
  return new Date(iso).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
}

function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Diferencia en días entre dos 'YYYY-MM-DD' puros — misma construcción
// local-safe que fmtFechaCorta, nunca `new Date(iso)` a secas.
function diasEntre(desdeIso: string, hastaIso: string): number {
  const [a1, m1, d1] = desdeIso.split('-').map(Number);
  const [a2, m2, d2] = hastaIso.split('-').map(Number);
  const desde = new Date(a1, m1 - 1, d1).getTime();
  const hasta = new Date(a2, m2 - 1, d2).getTime();
  return Math.round((hasta - desde) / 86400000);
}

type ChipId = 'todos' | 'vigente' | 'vencido' | 'convertido' | 'anulado';

const ESTADO_ESTILO: Record<Presupuesto['estado'], string> = {
  vigente: 'bg-marca-suave text-marca-suave-texto',
  convertido: 'bg-informativo-fondo text-informativo',
  anulado: 'bg-negativo-fondo text-negativo',
};

const ESTADO_LABELS: Record<Presupuesto['estado'], string> = {
  vigente: 'Vigente',
  convertido: 'Convertido',
  anulado: 'Anulado',
};

export default function PresupuestosPage() {
  const permitida = useGuardarRuta();
  const router = useRouter();
  const { negocioNombre, datosNegocio, negocioId, isOnline, productosVersion, setCarrito, setPresupuestoConvirtiendoId, setPresupuestoClienteNombre } = useApp();

  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [chip, setChip] = useState<ChipId>('todos');
  const [expandido, setExpandido] = useState<string | null>(null);
  const [cargandoItems, setCargandoItems] = useState<string | null>(null);
  const [convirtiendo, setConvirtiendo] = useState<string | null>(null);
  const [compartiendo, setCompartiendo] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  const [anulando, setAnulando] = useState<Presupuesto | null>(null);
  const [motivoAnular, setMotivoAnular] = useState('');
  const [guardandoAnulacion, setGuardandoAnulacion] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  const cargar = async () => {
    setCargando(true);
    const local = await getPresupuestos();
    setPresupuestos(local);
    setCargando(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { cargar(); }, [productosVersion]);

  if (!permitida) return null;

  const abrirAnular = (p: Presupuesto) => {
    setAnulando(p);
    setMotivoAnular('');
  };

  const confirmarAnular = async () => {
    if (!anulando || !motivoAnular.trim() || !negocioId) return;
    setGuardandoAnulacion(true);
    const actualizado: Presupuesto = {
      ...anulando,
      estado: 'anulado',
      anulado_en: new Date().toISOString(),
      motivo_anulacion: motivoAnular.trim(),
      sincronizado: false,
    };
    // Offline-first: nunca requiere conexión para anular (a diferencia de
    // anular una venta, esto es un UPDATE directo sin RPC) — se aplica
    // local de inmediato y se encola.
    await savePresupuesto(actualizado);
    await encolarActualizarPresupuesto(actualizado.id, negocioId);
    setPresupuestos(prev => prev.map(p => (p.id === actualizado.id ? actualizado : p)));
    setGuardandoAnulacion(false);
    setAnulando(null);
    setMotivoAnular('');
    showToast('Presupuesto anulado');
  };

  // Los items no viajan en presupuestos_listar (solo el resumen para la
  // lista) — un presupuesto creado en otro dispositivo, o que se limpió de
  // IndexedDB, llega sin ellos. Se piden bajo demanda al expandir, mismo
  // criterio y misma función que ya usa convertirPresupuesto, y se cachean
  // en el presupuesto local para no volver a pedirlos la próxima vez.
  const alExpandir = async (p: Presupuesto) => {
    const abrir = expandido !== p.id;
    setExpandido(abrir ? p.id : null);
    if (!abrir || (p.items && p.items.length > 0) || !isOnline) return;

    setCargandoItems(p.id);
    const remotos = await getPresupuestoItemsRemoto(p.id);
    if (remotos && remotos.length > 0) {
      const actualizado = { ...p, items: remotos };
      await savePresupuesto(actualizado);
      setPresupuestos(prev => prev.map(x => (x.id === p.id ? actualizado : x)));
    }
    setCargandoItems(null);
  };

  // Disponible para cualquier presupuesto, no solo los vigentes — si no se
  // compartió al crearlo, esta es la única forma de generar el documento
  // después.
  const compartir = async (p: Presupuesto) => {
    setCompartiendo(p.id);
    try {
      // Mismo criterio que "Venta #N": correlativo por orden de creación,
      // calculado sobre lo que este dispositivo conoce.
      const ordenados = [...presupuestos].sort((a, b) => a.creado_en.localeCompare(b.creado_en));
      const numero = ordenados.findIndex(x => x.id === p.id) + 1;
      await compartirPresupuesto({
        negocioNombre: negocioNombre || '',
        datosNegocio,
        presupuesto: p,
        numero: numero > 0 ? numero : ordenados.length,
      });
    } catch {
      showToast('No se pudo generar el documento');
    } finally {
      setCompartiendo(null);
    }
  };

  const convertirPresupuesto = async (p: Presupuesto) => {
    setConvirtiendo(p.id);
    try {
      let items = p.items;
      if (!items || items.length === 0) {
        if (!isOnline) {
          showToast('Sin conexión: no se pueden cargar los datos de este presupuesto todavía');
          return;
        }
        const remotos = await getPresupuestoItemsRemoto(p.id);
        if (!remotos || remotos.length === 0) {
          showToast('No se pudieron cargar los productos de este presupuesto');
          return;
        }
        items = remotos;
        await savePresupuesto({ ...p, items });
      }

      const productosLocal = await getProductos();
      const porId = new Map(productosLocal.map(pr => [pr.id, pr]));
      const avisos: string[] = [];

      const carritoNuevo: ItemCarrito[] = items.map(item => {
        const real = item.producto_id ? porId.get(item.producto_id) : undefined;
        const esPeso = item.gramos !== undefined;
        const cantidadNecesaria = esPeso ? (item.gramos ?? 0) / 1000 : item.cantidad;

        if (!real) {
          avisos.push(`${item.nombre}: ya no está en el catálogo`);
        } else if (real.controla_stock !== false && real.stock != null && real.stock < cantidadNecesaria) {
          avisos.push(`${item.nombre}: solo quedan ${real.stock}`);
        }

        // Producto "congelado": conserva el id/stock reales del catálogo
        // (necesarios para el descuento de stock al confirmar) pero fuerza
        // el precio en USD que se cotizó — nunca el que tenga hoy el
        // catálogo, aunque haya cambiado. El bolívar se recalcula a la
        // tasa de HOY al cobrar, como cualquier producto en USD: lo
        // congelado es el dólar cotizado, no el bolívar estimado.
        // costo: null a propósito — si el producto real tenía costo
        // registrado en VES, forzar moneda 'USD' encima lo interpretaría
        // como si fuera dólares. No hay un costo "congelado" confiable acá,
        // así que se trata como no registrado en vez de arriesgar un
        // margen de ganancia incorrecto en los reportes del admin.
        const productoCongelado: Producto = real
          ? { ...real, precio: item.precioUnitarioUsd, moneda: 'USD', costo: null }
          : {
              id: item.producto_id ?? item.id,
              codigo_barra: null,
              nombre: item.nombre,
              moneda: 'USD',
              precio: item.precioUnitarioUsd,
              activo: true,
              por_peso: esPeso,
            };

        return esPeso
          ? {
              lineId: crypto.randomUUID(),
              producto: productoCongelado,
              cantidad: 1,
              esPorPeso: true,
              gramos: item.gramos,
              precioCalculadoBase: item.precioUnitarioUsd * ((item.gramos ?? 0) / 1000),
            }
          : { lineId: crypto.randomUUID(), producto: productoCongelado, cantidad: item.cantidad };
      });

      // Nunca bloquea la conversión — el cajero decide cómo seguir (quitar
      // esa línea, avisar al cliente, lo que corresponda).
      if (avisos.length > 0) showToast(avisos.join(' · '));

      setCarrito(carritoNuevo);
      setPresupuestoConvirtiendoId(p.id);
      // No une clientes_fiado con presupuestos (son tablas distintas a
      // propósito) — solo le ahorra al cajero escribir de nuevo el nombre
      // que ya se cotizó si elige fiar parte de esta venta.
      setPresupuestoClienteNombre(p.cliente_nombre ?? null);
      router.push('/');
    } finally {
      setConvirtiendo(null);
    }
  };

  const hoy = hoyISO();
  const esVencido = (p: Presupuesto) => p.estado === 'vigente' && p.fecha_vencimiento < hoy;

  const vigentes = presupuestos.filter(p => p.estado === 'vigente' && !esVencido(p));
  const vencidos = presupuestos.filter(esVencido);
  const totalVigenteUsd = presupuestos
    .filter(p => p.estado === 'vigente')
    .reduce((s, p) => s + p.total_usd, 0);
  const totalVigenteBs = presupuestos
    .filter(p => p.estado === 'vigente')
    .reduce((s, p) => s + p.total_bs_estimado, 0);

  const CHIPS: { id: ChipId; label: string; cuenta: number }[] = [
    { id: 'todos', label: 'Todos', cuenta: presupuestos.length },
    { id: 'vigente', label: 'Vigente', cuenta: vigentes.length },
    { id: 'vencido', label: 'Vencido', cuenta: vencidos.length },
    { id: 'convertido', label: 'Convertido', cuenta: presupuestos.filter(p => p.estado === 'convertido').length },
    { id: 'anulado', label: 'Anulado', cuenta: presupuestos.filter(p => p.estado === 'anulado').length },
  ];

  const presupuestosFiltrados = presupuestos.filter(p => {
    if (chip === 'todos') return true;
    if (chip === 'vigente') return p.estado === 'vigente' && !esVencido(p);
    if (chip === 'vencido') return esVencido(p);
    return p.estado === chip;
  });

  // Correlativo por orden de creación, calculado una sola vez para toda la
  // lista (no por fila) — mismo criterio que "Venta #N" en Resumen.
  const ordenados = [...presupuestos].sort((a, b) => a.creado_en.localeCompare(b.creado_en));
  const numeroPorId = new Map(ordenados.map((p, i) => [p.id, i + 1]));

  function textoVigencia(p: Presupuesto): string {
    if (p.estado === 'convertido') {
      return p.convertido_en ? `Se convirtió en venta · ${fmtFechaEvento(p.convertido_en)}` : 'Se convirtió en venta';
    }
    if (p.estado === 'anulado') {
      return p.anulado_en ? `Anulado · ${fmtFechaEvento(p.anulado_en)}` : 'Anulado';
    }
    if (esVencido(p)) {
      const dias = diasEntre(p.fecha_vencimiento, hoy);
      return `Venció hace ${dias} ${dias === 1 ? 'día' : 'días'} · los precios ya no se sostienen`;
    }
    const dias = diasEntre(hoy, p.fecha_vencimiento);
    return dias === 0 ? 'Vence hoy' : `Vence en ${dias} ${dias === 1 ? 'día' : 'días'}`;
  }

  return (
    <div>
      <header className="bg-superficie-barra border-b border-borde-divisor px-4 pt-3.5 pb-3 flex items-center gap-2.5">
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-texto truncate">Presupuestos</h1>
          <p className="text-[11px] font-medium text-texto-3 truncate">
            {presupuestos.length} {presupuestos.length === 1 ? 'presupuesto' : 'presupuestos'}
          </p>
        </div>
        {/* píldora de conexión — sí aplica acá: alExpandir depende de
            isOnline para traer detalle, y convertirPresupuesto puede
            bloquearse sin conexión */}
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

      {/* pb-2.5 + overflow visible: mismo arreglo que Inventario/Fiado para
          que la barra de scroll del navegador no pise los chips — acá con
          5 chips (no 3) el scroll horizontal siempre se activa en un
          teléfono normal, así que hace falta más aire que el pb-1 de Fiado */}
      <div className="px-4 pt-3 pb-4 bg-superficie-barra border-b border-borde-divisor">
        <div className="flex gap-2 -mx-4 px-4 pb-2.5 overflow-x-auto">
          {CHIPS.map(c => {
            const activo = chip === c.id;
            return (
              <button
                key={c.id}
                onClick={() => { setChip(c.id); setExpandido(null); }}
                className={`flex-shrink-0 h-[34px] px-3.5 rounded-full text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors border ${
                  activo ? 'bg-marca-suave text-marca-suave-texto border-marca' : 'bg-tarjeta text-texto-2 border-borde-campo'
                }`}
              >
                {c.label}
                <span className="tabular-nums opacity-70">{c.cuenta}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-4 py-3.5 flex flex-col gap-3.5">
        <Button variante="primario" onClick={() => router.push('/presupuestos/nuevo')} className="w-full">
          <Icon nombre="agregar" tamano={TAMANO_ICONO.secundario} />
          Nuevo presupuesto
        </Button>

        {presupuestos.length > 0 && (
          <div className="p-5 rounded-2xl bg-tinta">
            <p className="text-[11px] font-bold uppercase tracking-wide text-tinta-etiqueta">Presupuestado vigente</p>
            <p className="mt-1.5 text-4xl font-extrabold text-tinta-texto tracking-tight tabular-nums">
              {formatUSD(totalVigenteUsd)}
            </p>
            <p className="mt-1 text-tinta-etiqueta tabular-nums">
              {formatBS(totalVigenteBs)} · {vigentes.length} {vigentes.length === 1 ? 'presupuesto vigente' : 'presupuestos vigentes'}
            </p>
            {vencidos.length > 0 && (
              <>
                <div className="h-px bg-[rgba(255,255,255,0.14)] my-3" />
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="h-6 px-2.5 inline-flex items-center rounded-full bg-aviso-fondo text-aviso text-[11px] font-bold whitespace-nowrap">
                    {vencidos.length} {vencidos.length === 1 ? 'vencido' : 'vencidos'}
                  </span>
                  <span className="text-tinta-etiqueta text-sm">los precios ya no se sostienen</span>
                </div>
              </>
            )}
          </div>
        )}

        {cargando ? (
          <div className="text-center text-texto-3 py-16">
            <svg className="w-8 h-8 mx-auto mb-3 text-marca animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : presupuestos.length === 0 ? (
          <div className="text-center text-texto-3 py-12">
            <Icon nombre="presupuestos" tamano={48} className="mx-auto mb-3 text-texto-4" />
            <p className="font-medium">Sin presupuestos todavía</p>
          </div>
        ) : presupuestosFiltrados.length === 0 ? (
          <div className="text-center text-texto-3 py-12">
            <p className="font-medium">Ningún presupuesto en este filtro</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {presupuestosFiltrados.map(p => {
              const vencido = esVencido(p);
              const isOpen = expandido === p.id;
              return (
                <div
                  key={p.id}
                  className={`bg-tarjeta rounded-2xl border overflow-hidden ${vencido ? 'border-aviso-borde' : 'border-borde-tarjeta'}`}
                >
                  <button className="w-full flex items-center justify-between gap-3 p-3.5 text-left" onClick={() => alExpandir(p)}>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-texto truncate">
                        {p.cliente_nombre ? formatearNombre(p.cliente_nombre) : 'Sin nombre de cliente'}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span className={`h-5 px-2 inline-flex items-center rounded-full text-[11px] font-bold whitespace-nowrap ${ESTADO_ESTILO[p.estado]}`}>
                          {ESTADO_LABELS[p.estado]}
                        </span>
                        {vencido && (
                          <span className="h-5 px-2 inline-flex items-center rounded-full bg-aviso-fondo text-aviso text-[11px] font-bold whitespace-nowrap">
                            Vencido
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-texto-3 mt-1">
                        Presupuesto #{numeroPorId.get(p.id)} · {textoVigencia(p)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="text-right">
                        <p className="font-bold text-texto tabular-nums">{formatUSD(p.total_usd)}</p>
                        <p className="text-xs text-texto-3 tabular-nums">{formatBS(p.total_bs_estimado)}</p>
                      </div>
                      <Icon
                        nombre="flechaDerecha"
                        tamano={16}
                        className={`text-texto-4 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                      />
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-borde-divisor px-3.5 pb-3.5 pt-3 flex flex-col gap-2.5">
                      {cargandoItems === p.id ? (
                        <p className="text-xs text-texto-3 py-1">Cargando...</p>
                      ) : !p.items || p.items.length === 0 ? (
                        <p className="text-xs text-texto-3 py-1">
                          {isOnline ? 'Sin detalle disponible' : 'Sin conexión — hace falta señal para ver el detalle'}
                        </p>
                      ) : (
                        p.items.map(item => (
                          <div key={item.id} className="flex items-center justify-between text-sm">
                            <span className="text-texto-2">
                              {item.gramos !== undefined ? `${item.gramos}g ` : `${item.cantidad}× `}
                              {formatearNombre(item.nombre)}
                            </span>
                            <span className="font-medium text-texto">
                              {formatBS(
                                item.gramos !== undefined
                                  ? item.precioUnitarioBs * (item.gramos / 1000)
                                  : item.precioUnitarioBs * item.cantidad
                              )}
                            </span>
                          </div>
                        ))
                      )}

                      {vencido && (
                        <div className="p-3 rounded-[12px] bg-aviso-fondo border border-aviso-borde">
                          <p className="text-sm text-aviso leading-relaxed">
                            El precio en dólares es el que se cotizó. El bolívar se recalcula con la tasa de hoy al
                            convertirlo en venta.
                          </p>
                        </div>
                      )}
                      {p.estado === 'convertido' && (
                        <div className="p-3 rounded-[12px] bg-informativo-fondo border border-informativo">
                          <p className="text-sm text-informativo">Ya se convirtió en venta.</p>
                        </div>
                      )}
                      {p.estado === 'anulado' && (
                        <div className="p-3 rounded-[12px] bg-negativo-fondo border border-negativo-borde flex flex-col gap-1">
                          <p className="text-sm text-negativo">
                            Anulado. Se conserva para dejar constancia, pero no se puede cobrar.
                          </p>
                          <p className="text-sm text-negativo">Motivo: {p.motivo_anulacion || '—'}</p>
                        </div>
                      )}

                      <div className="border-t border-borde-divisor pt-2 flex items-center justify-between text-sm">
                        <span className="text-texto-3">Equivalente</span>
                        <span className="text-texto-2">{formatUSD(p.total_usd)}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-texto-3">Creado por</span>
                        <span className="text-texto-2">{p.creado_por_nombre || '—'}</span>
                      </div>

                      <button
                        onClick={() => compartir(p)}
                        disabled={compartiendo === p.id}
                        className="w-full h-11 rounded-[12px] text-sm font-semibold bg-tarjeta-hundida text-texto-2 disabled:opacity-50 mt-1 flex items-center justify-center gap-2"
                      >
                        <Icon nombre="compartir" tamano={TAMANO_ICONO.secundario} />
                        {compartiendo === p.id ? 'Generando...' : 'Compartir'}
                      </button>

                      {p.estado === 'vigente' && (
                        <div className="flex gap-2">
                          <Button
                            variante="primario"
                            onClick={() => convertirPresupuesto(p)}
                            disabled={convirtiendo === p.id}
                            className="flex-1"
                          >
                            {convirtiendo === p.id ? 'Cargando...' : 'Convertir en venta'}
                          </Button>
                          <button
                            onClick={() => abrirAnular(p)}
                            className="flex-1 h-[52px] rounded-[12px] text-sm font-semibold bg-negativo-fondo text-negativo"
                          >
                            Anular
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Anular presupuesto */}
      <BottomSheet
        abierto={!!anulando}
        onCerrar={() => { if (!guardandoAnulacion) setAnulando(null); }}
        titulo="Anular presupuesto"
      >
        {anulando && (
          <div className="space-y-4">
            <p className="text-sm text-texto-3">
              {anulando.cliente_nombre ? formatearNombre(anulando.cliente_nombre) : 'Sin nombre de cliente'} ·{' '}
              {formatBS(anulando.total_bs_estimado)}
            </p>
            <div>
              <label className="block text-sm text-texto-3 mb-1.5">Motivo</label>
              <textarea
                value={motivoAnular}
                onChange={e => setMotivoAnular(e.target.value)}
                rows={3}
                placeholder="Ej: El cliente ya no lo necesita"
                className="font-caja w-full rounded-[12px] border bg-tarjeta text-texto text-base px-4 py-3 placeholder:text-texto-4 outline-none transition-colors duration-150 border-borde-campo focus:border-foco"
                autoFocus
              />
            </div>
            <Button
              variante="destructivo"
              disabled={guardandoAnulacion || !motivoAnular.trim()}
              onClick={confirmarAnular}
              className="w-full"
            >
              {guardandoAnulacion ? 'Anulando...' : 'Anular'}
            </Button>
            <button
              type="button"
              onClick={() => setAnulando(null)}
              disabled={guardandoAnulacion}
              className="w-full h-[52px] rounded-[12px] border border-borde-tarjeta text-texto-3 font-semibold disabled:opacity-40"
            >
              Cancelar
            </button>
          </div>
        )}
      </BottomSheet>

      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-toast-fondo text-toast-texto px-5 py-2.5 rounded-xl text-sm font-medium z-50 shadow-lg max-w-xs text-center">
          {toast}
        </div>
      )}
    </div>
  );
}
