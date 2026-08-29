'use client';

import { useState, useEffect } from 'react';
import {
  getVentasSinCerrar,
  saveCierre,
  tagVentasConCierre,
  getCierres,
  getUltimoCierre,
  setUltimoCierre,
  getPendientes,
  marcarVentaAnulada,
} from '@/lib/db';
import { getVentasPendientesRemoto, reconciliarCierresLocal, anularVenta } from '@/lib/sync';
import { encolarCerrarCaja, encolarActualizarCierreVentas, procesarCola } from '@/lib/outbox';
import { formatBS, formatUSD } from '@/lib/precio';
import { Venta, MetodoPago, MetodoPagoVenta, CierreCaja, DesgloseCierre } from '@/types';
import { useApp } from '@/components/Providers';
import ThemeToggle from '@/components/ThemeToggle';

// desglose_metodos (cierres) y porMetodo (abajo) se arman siempre a partir
// de venta.pagos, así que sus llaves son MetodoPago real — 'mixto' nunca
// aparece ahí. El badge por venta (venta.metodo_pago) sí puede ser 'mixto',
// por eso estos tres mapas cubren MetodoPagoVenta completo.
const METODO_LABELS: Record<MetodoPagoVenta, string> = {
  efectivo_bs: 'Efectivo Bs',
  pago_movil: 'Pago Móvil',
  biopago: 'Biopago',
  tarjeta: 'Tarjeta',
  efectivo_usd: 'Efectivo $',
  mixto: 'Mixto',
};

const METODO_COLORS: Record<MetodoPagoVenta, string> = {
  efectivo_bs: 'bg-emerald-100 text-emerald-700',
  pago_movil: 'bg-blue-100 text-blue-700',
  biopago: 'bg-purple-100 text-purple-700',
  tarjeta: 'bg-slate-100 text-slate-700',
  efectivo_usd: 'bg-amber-100 text-amber-700',
  mixto: 'bg-indigo-100 text-indigo-700',
};

const METODO_ICONS: Record<MetodoPagoVenta, JSX.Element> = {
  efectivo_bs: (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
        d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  pago_movil: (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
        d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  ),
  biopago: (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
        d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
    </svg>
  ),
  tarjeta: (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
        d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
    </svg>
  ),
  efectivo_usd: (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  mixto: (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
        d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4m-4-4l4-4" />
    </svg>
  ),
};

function fmtFecha(iso: string, conHora = true) {
  return new Date(iso).toLocaleDateString('es-VE', {
    day: '2-digit',
    month: 'short',
    ...(conHora ? { hour: '2-digit', minute: '2-digit' } : { year: 'numeric' }),
  });
}

function formatearNombre(nombre: string): string {
  return nombre
    .toLowerCase()
    .split(' ')
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

export default function ResumenPage() {
  const { tasa, negocioId, isOnline, user, userNombre, rol, estado, usaStock, sincronizarAhora } = useApp();
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [cierres, setCierres] = useState<CierreCaja[]>([]);
  const [ultimoCierre, setUltimoCierreState] = useState<string | null>(null);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [expandidoCierre, setExpandidoCierre] = useState<string | null>(null);
  const [showConfirmCierre, setShowConfirmCierre] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  // false apenas se confirma que tenemos la foto completa del negocio (se
  // pudo consultar Supabase); true si por ahora solo podemos confiar en lo
  // que hay en este dispositivo (sin red, o falló la consulta remota).
  const [soloDispositivo, setSoloDispositivo] = useState(false);
  const [confirmoSoloDispositivo, setConfirmoSoloDispositivo] = useState(false);
  const [toast, setToast] = useState('');
  // Anulación: venta seleccionada para anular (abre el modal de motivo).
  const [anulando, setAnulando] = useState<Venta | null>(null);
  const [motivoAnular, setMotivoAnular] = useState('');
  const [guardandoAnulacion, setGuardandoAnulacion] = useState(false);
  const [errorAnular, setErrorAnular] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 5000);
  };

  const cargar = async () => {
    const [vLocal, c, uc] = await Promise.all([
      getVentasSinCerrar(),
      getCierres(),
      getUltimoCierre(),
    ]);

    // Reconciliación: ventas que este dispositivo cree pendientes pero que
    // otro dispositivo ya cerró en Supabase mientras tanto. Sin esto se
    // arrastrarían para siempre en el período local, duplicando totales en
    // el próximo cierre hecho desde aquí.
    let vigentes = vLocal;
    if (isOnline) {
      const sincronizadas = vLocal.filter(v => v.sincronizada).map(v => v.id);
      const cierresRemotos = await reconciliarCierresLocal(sincronizadas);
      if (cierresRemotos.size > 0) {
        await Promise.all(
          Array.from(cierresRemotos.entries()).map(([ventaId, cierreId]) =>
            tagVentasConCierre([ventaId], cierreId)
          )
        );
        vigentes = vLocal.filter(v => !cierresRemotos.has(v.id));
      }
    }

    // Base offline-first: lo local siempre se muestra. Si hay conexión, se
    // completa con las ventas de TODO el negocio (otros dispositivos) que
    // este dispositivo nunca vio — sin esto, cerrar caja solo archiva lo
    // propio y deja ventas de otros cajeros sueltas para siempre.
    let ventasFinal = vigentes;
    let completo = false;
    if (isOnline && negocioId) {
      const remotas = await getVentasPendientesRemoto(negocioId);
      if (remotas !== null) {
        completo = true;
        const porId = new Map(vigentes.map(v => [v.id, v]));
        for (const r of remotas) {
          const local = porId.get(r.id);
          // El remoto manda salvo que la copia local todavía no se haya
          // sincronizado (ej. venta hecha offline, en cola) — a esa no hay
          // que pisarla con lo que el servidor tenía antes de que llegara.
          // Si ya estaba sincronizada, el remoto es la fuente de verdad:
          // así una venta anulada desde OTRO dispositivo se refleja acá,
          // en vez de quedarse mostrando para siempre la copia local vieja
          // sin anular.
          if (!local || local.sincronizada) porId.set(r.id, r);
        }
        ventasFinal = Array.from(porId.values());
      }
    }

    setVentas(ventasFinal);
    setSoloDispositivo(!completo);
    setCierres(c);
    setUltimoCierreState(uc);
  };

  // Se re-consulta al recuperar conexión: si esta pantalla se abrió offline
  // solo tenía lo local, y al reconectar debe completarse con el resto del
  // negocio sin que el usuario tenga que salir y volver a entrar.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { cargar(); }, [isOnline]);

  // Vigentes = sin anular. Todos los totales y el desglose por método se
  // calculan de acá, nunca de `ventas` a secas — una venta anulada sigue en
  // la lista (no desaparece del histórico) pero no debe sumar ni al total
  // ni al desglose ni al cierre que se arma al cerrar caja.
  const ventasVigentes = ventas.filter(v => !v.anulada);

  const totalBS = ventasVigentes.reduce((s, v) => s + v.total_bs, 0);
  const totalUSD = tasa > 0 ? totalBS / tasa : 0;

  // Por PAGOS, no por venta: una venta mixta reparte su monto entre los
  // métodos reales que la componen, en vez de contar el total completo bajo
  // un único método (o bajo 'mixto', que no es un método real de cobro).
  const porMetodo = ventasVigentes.reduce(
    (acc, v) => {
      for (const p of v.pagos) {
        acc[p.metodo] = (acc[p.metodo] || 0) + p.monto_bs;
      }
      return acc;
    },
    {} as Partial<Record<MetodoPago, number>>
  );

  // Start of current period: last cierre time, or oldest pending venta, or null
  const periodoInicio = ultimoCierre
    ?? (ventas.length > 0
      ? ventas.reduce((min, v) => (v.fecha < min ? v.fecha : min), ventas[0].fecha)
      : null);

  // Numeración por orden cronológico real (no por posición en el array: IDB
  // getAll() devuelve las ventas ordenadas por id/UUID, sin relación alguna
  // con la fecha). La primera venta del período es siempre #1 y no cambia al
  // llegar más ventas nuevas.
  const ventasPorFecha = [...ventas].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const numeroPorVenta = new Map(ventasPorFecha.map((v, i) => [v.id, i + 1]));
  // Más reciente primero para la lista — usamos el mismo orden cronológico
  // ya calculado en vez de asumir que el array venía ordenado.
  const ventasParaMostrar = [...ventasPorFecha].reverse();

  const confirmarCierre = async () => {
    if (!isOnline && !confirmoSoloDispositivo) return;
    setCerrando(true);
    const now = new Date().toISOString();

    // Igual que porMetodo: por pagos VIGENTES, no por venta ni por lo
    // anulado. count termina siendo cantidad de PAGOS (una venta mixta suma
    // 1 a cada método que usó), lo correcto para arquear cada método por
    // separado — mismo criterio que ya tiene reportes_por_metodo en
    // Supabase.
    const desglose = ventasVigentes.reduce((acc, v) => {
      for (const p of v.pagos) {
        if (!acc[p.metodo]) acc[p.metodo] = { bs: 0, usd: 0, count: 0 };
        acc[p.metodo]!.bs += p.monto_bs;
        acc[p.metodo]!.usd += p.monto_usd;
        acc[p.metodo]!.count += 1;
      }
      return acc;
    }, {} as Partial<Record<MetodoPago, DesgloseCierre>>);

    const inicio = periodoInicio ?? now;

    const cierre: CierreCaja = {
      id: crypto.randomUUID(),
      periodo_inicio: inicio,
      periodo_fin: now,
      total_bs: totalBS,
      total_usd: tasa > 0 ? totalBS / tasa : 0,
      cantidad_ventas: ventasVigentes.length,
      desglose_metodos: desglose,
      tasa_cierre: tasa,
      creado_en: now,
      usuario_id: user?.id,
      usuario_nombre: userNombre || undefined,
    };

    await saveCierre(cierre);
    // Todas las ventas del período, ANULADAS INCLUIDAS: una venta anulada
    // igual debe archivarse (dejar de aparecer como "período actual") para
    // no quedar atrapada ahí para siempre — solo se excluye de los NÚMEROS
    // del cierre (arriba), nunca de qué ventas se consideran resueltas.
    await tagVentasConCierre(ventas.map(v => v.id), cierre.id);
    await setUltimoCierre(now);
    // Offline-first: el cierre ya quedó guardado localmente arriba. Se encola
    // para Supabase — ahora mismo si hay red, o al reconectar si no la hay.
    // El id del cierre se reutiliza como id de la operación en cola, así que
    // reintentos duplicados nunca crean un cierre repetido en el servidor.
    await encolarCerrarCaja(cierre, negocioId!);
    // Encolado DESPUÉS del cierre a propósito: la cola procesa en orden
    // cronológico, así que el cierre siempre se sincroniza primero. Esto
    // cubre las ventas que ya estaban en Supabase (les asigna cierre_id).
    // Las que todavía no habían sincronizado lo reciben directo en su propio
    // envío, porque 'registrar_venta' relee el estado actual de la venta
    // (incluido cierre_id) justo antes de enviarla.
    await encolarActualizarCierreVentas(ventas.map(v => v.id), cierre.id);

    setVentas([]);
    setCierres(prev => [cierre, ...prev]);
    setUltimoCierreState(now);
    setShowConfirmCierre(false);
    setCerrando(false);

    // El cierre ya quedó guardado en este dispositivo — no se revierte
    // automáticamente si la confirmación con Supabase falla: deshacer un
    // cierre que el cajero ya dio por hecho sería más confuso que útil, y
    // la cola sigue reintentando solo. Pero si hay red y aun así no se pudo
    // confirmar (ej. RLS bloqueó el UPDATE de cierre_id en algunas ventas
    // sin lanzar error — ver comentario en sync.ts), hay que avisar en vez
    // de dejar que el usuario asuma en silencio que ya quedó respaldado.
    if (isOnline) {
      await procesarCola();
      const pendientes = await getPendientes();
      const sigueSinConfirmar = pendientes.some(
        p => p.id === cierre.id || p.id === `cierre-ventas-${cierre.id}`
      );
      if (sigueSinConfirmar) {
        showToast(
          'El cierre se guardó en este dispositivo, pero no se pudo confirmar con el servidor todavía. Se reintentará automáticamente.'
        );
      }
    }
  };

  const abrirAnular = (venta: Venta) => {
    setAnulando(venta);
    setMotivoAnular('');
    setErrorAnular('');
  };

  const cerrarAnular = () => {
    setAnulando(null);
    setMotivoAnular('');
    setErrorAnular('');
  };

  // Anular requiere conexión y no pasa por el outbox ni por IndexedDB — es
  // una acción administrativa sobre algo que ya ocurrió (a diferencia de
  // registrar una venta), así que no aplica "nunca bloquear una venta". El
  // estado local SOLO se actualiza después de que el servidor confirmó el
  // éxito; si anular_venta falla, no se toca nada localmente.
  const confirmarAnular = async () => {
    if (!anulando || !motivoAnular.trim() || !isOnline) return;
    setGuardandoAnulacion(true);
    setErrorAnular('');
    const resultado = await anularVenta(anulando.id, motivoAnular.trim());
    setGuardandoAnulacion(false);

    if (!resultado) {
      setErrorAnular('No se pudo anular la venta. Intenta de nuevo.');
      return;
    }

    const datos = {
      anulada_en: resultado.anulada_en,
      anulada_por: user?.id,
      anulada_por_nombre: userNombre || undefined,
      motivo_anulacion: motivoAnular.trim(),
    };
    await marcarVentaAnulada(anulando.id, datos);
    setVentas(prev => prev.map(v => (v.id === anulando.id ? { ...v, anulada: true, ...datos } : v)));
    setAnulando(null);
    setMotivoAnular('');
    showToast('Venta anulada');

    // El servidor ya reversó el stock (si aplica) dentro de la misma RPC —
    // se refresca el catálogo para que se vea reflejado sin esperar al
    // próximo sync automático (cada 30s). No bloquea nada si falla.
    if (usaStock) sincronizarAhora();
  };

  return (
    <div>
      <header className="bg-emerald-600 text-white px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold">Período actual</h1>
            <p className="text-emerald-200 text-sm mt-0.5">
              {periodoInicio
                ? `Desde ${fmtFecha(periodoInicio)}`
                : 'Sin ventas pendientes'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <ThemeToggle />
            {ventas.length > 0 && (
              <button
                onClick={() => { setConfirmoSoloDispositivo(false); setShowConfirmCierre(true); }}
                className="bg-white text-emerald-700 px-3 py-2 rounded-xl font-semibold text-sm flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                Cerrar caja
              </button>
            )}
          </div>
        </div>
      </header>

      {soloDispositivo && (
        <div className="mx-4 mt-3 p-2.5 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-gray-600 dark:text-gray-300 text-xs text-center">
          Mostrando solo las ventas de este dispositivo — puede haber más ventas de otros usuarios
        </div>
      )}

      <div className="p-4 space-y-4">
        {/* Total del período */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 text-center">
          <p className="text-gray-500 text-sm mb-1">Total sin cerrar</p>
          <p className="text-4xl font-bold text-gray-900">{formatBS(totalBS)}</p>
          {tasa > 0 && <p className="text-gray-400 mt-1">{formatUSD(totalUSD)}</p>}
          <p className="text-emerald-600 text-sm font-medium mt-2">
            {ventasVigentes.length} {ventasVigentes.length === 1 ? 'venta' : 'ventas'}
          </p>
        </div>

        {/* Por método */}
        {Object.keys(porMetodo).length > 0 && (
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <h2 className="font-semibold text-gray-700 mb-3">Por método de pago</h2>
            <div className="space-y-2">
              {(Object.entries(porMetodo) as [MetodoPago, number][]).map(([metodo, total]) => (
                <div key={metodo} className="flex items-center justify-between">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1 ${METODO_COLORS[metodo]}`}>
                    {METODO_ICONS[metodo]}
                    {METODO_LABELS[metodo]}
                  </span>
                  <span className="font-bold text-gray-800">{formatBS(total)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Lista de ventas pendientes */}
        {ventas.length > 0 ? (
          <div className="space-y-2">
            <h2 className="font-semibold text-gray-700 px-1">Ventas</h2>
            {ventasParaMostrar.map(venta => {
              const hora = new Date(venta.fecha).toLocaleTimeString('es-VE', {
                hour: '2-digit',
                minute: '2-digit',
              });
              const isOpen = expandido === venta.id;

              return (
                <div
                  key={venta.id}
                  className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden"
                >
                  <button
                    className="w-full flex items-center justify-between p-4 text-left"
                    onClick={() => setExpandido(isOpen ? null : venta.id)}
                  >
                    <div>
                      <p className="font-semibold text-gray-800">Venta #{numeroPorVenta.get(venta.id)}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-gray-400 text-xs">{hora}</span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${METODO_COLORS[venta.metodo_pago]}`}>
                          {METODO_ICONS[venta.metodo_pago]}
                          {METODO_LABELS[venta.metodo_pago]}
                        </span>
                        {venta.anulada && (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                            Anulada
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className={`font-bold ${venta.anulada ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                        {formatBS(venta.total_bs)}
                      </p>
                      <svg
                        className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-2">
                      {venta.items.map((item, i) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span className="text-gray-600">
                            {item.gramos !== undefined
                              ? formatearNombre(item.nombre)
                              : `${item.cantidad}× ${formatearNombre(item.nombre)}`}
                          </span>
                          <span className="font-medium">{formatBS(item.subtotal_bs)}</span>
                        </div>
                      ))}
                      {venta.pagos.length > 1 && (
                        <div className="border-t border-gray-100 pt-2 space-y-1">
                          {venta.pagos.map(p => (
                            <div key={p.id} className="flex justify-between text-sm">
                              <span className="text-gray-500">{METODO_LABELS[p.metodo]}</span>
                              <span className="text-gray-600">{formatBS(p.monto_bs)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="border-t border-gray-100 pt-2 flex justify-between text-sm">
                        <span className="text-gray-500">Tasa usada</span>
                        <span className="text-gray-600">Bs {venta.tasa_usada.toLocaleString('es-VE')}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Vendida por</span>
                        <span className="text-gray-600">{venta.usuario_nombre || '—'}</span>
                      </div>

                      {venta.anulada ? (
                        <div className="border-t border-gray-100 pt-2 space-y-1">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Anulada por</span>
                            <span className="text-gray-600">{venta.anulada_por_nombre || '—'}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Fecha de anulación</span>
                            <span className="text-gray-600">{venta.anulada_en ? fmtFecha(venta.anulada_en) : '—'}</span>
                          </div>
                          <p className="text-sm text-red-700 bg-red-50 rounded-lg px-2.5 py-2 mt-1">
                            Motivo: {venta.motivo_anulacion || '—'}
                          </p>
                        </div>
                      ) : rol === 'admin' && estado !== 'restringido' && (
                        <button
                          onClick={() => abrirAnular(venta)}
                          disabled={!isOnline}
                          className="w-full mt-1 py-2.5 rounded-xl text-sm font-semibold bg-red-50 text-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {isOnline ? 'Anular venta' : 'Necesitas conexión para anular'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center text-gray-400 py-10">
            <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="font-medium">Caja cerrada</p>
            <p className="text-sm mt-1">Las nuevas ventas aparecerán aquí</p>
          </div>
        )}

        {/* Cierres anteriores */}
        {cierres.length > 0 && (
          <div className="space-y-2">
            <h2 className="font-semibold text-gray-700 px-1">Cierres anteriores</h2>
            {cierres.map(cierre => {
              const isOpen = expandidoCierre === cierre.id;
              return (
                <div key={cierre.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between p-4 text-left"
                    onClick={() => setExpandidoCierre(isOpen ? null : cierre.id)}
                  >
                    <div>
                      <p className="font-semibold text-gray-800">{fmtFecha(cierre.periodo_fin)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {cierre.cantidad_ventas} {cierre.cantidad_ventas === 1 ? 'venta' : 'ventas'}
                        {' · '}desde {fmtFecha(cierre.periodo_inicio)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-gray-900">{formatBS(cierre.total_bs)}</p>
                      <svg
                        className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-2">
                      {cierre.total_usd > 0 && (
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-gray-500">Total</span>
                          <span className="font-medium text-gray-700">{formatUSD(cierre.total_usd)}</span>
                        </div>
                      )}
                      {(Object.entries(cierre.desglose_metodos) as [MetodoPago, DesgloseCierre][]).map(([metodo, d]) => (
                        <div key={metodo} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${METODO_COLORS[metodo]}`}>
                              {METODO_ICONS[metodo]}
                              {METODO_LABELS[metodo]}
                            </span>
                            <span className="text-xs text-gray-400">{d.count} venta{d.count !== 1 ? 's' : ''}</span>
                          </div>
                          <span className="font-bold text-sm text-gray-800">{formatBS(d.bs)}</span>
                        </div>
                      ))}
                      <div className="border-t border-gray-100 pt-2 flex justify-between text-sm">
                        <span className="text-gray-500">Tasa al cierre</span>
                        <span className="text-gray-600">
                          Bs {cierre.tasa_cierre.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Cerrado por</span>
                        <span className="text-gray-600">{cierre.usuario_nombre || '—'}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirmation modal */}
      {showConfirmCierre && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => { if (!cerrando) setShowConfirmCierre(false); }}
          />
          <div className="relative bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden">
            <div className="p-5">
              <h2 className="text-xl font-bold text-gray-900 mb-1">Cerrar caja</h2>
              <p className="text-sm text-gray-500 mb-4">
                Se archivarán todas las ventas del período actual.
              </p>

              <div className="bg-emerald-50 rounded-xl p-4 mb-4 text-center">
                <p className="text-3xl font-bold text-gray-900">{formatBS(totalBS)}</p>
                {tasa > 0 && <p className="text-sm text-gray-500 mt-0.5">{formatUSD(totalUSD)}</p>}
                <p className="text-emerald-600 text-sm font-medium mt-1">
                  {ventasVigentes.length} {ventasVigentes.length === 1 ? 'venta' : 'ventas'}
                </p>
              </div>

              {Object.keys(porMetodo).length > 0 && (
                <div className="space-y-2 mb-4">
                  {(Object.entries(porMetodo) as [MetodoPago, number][]).map(([metodo, total]) => (
                    <div key={metodo} className="flex items-center justify-between">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1 ${METODO_COLORS[metodo]}`}>
                        {METODO_ICONS[metodo]}
                        {METODO_LABELS[metodo]}
                      </span>
                      <span className="font-bold text-sm text-gray-800">{formatBS(total)}</span>
                    </div>
                  ))}
                </div>
              )}

              {!isOnline && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm">
                  <p className="font-semibold text-center mb-1">Sin conexión</p>
                  <p className="text-center">
                    Solo se cerrarán las ventas de este dispositivo. Si hay otros
                    cajeros vendiendo en este momento, sus ventas quedarán fuera
                    de este cierre. Si puedes, espera a tener conexión.
                  </p>
                  <label className="flex items-start gap-2 mt-3 text-left cursor-pointer">
                    <input
                      type="checkbox"
                      checked={confirmoSoloDispositivo}
                      onChange={e => setConfirmoSoloDispositivo(e.target.checked)}
                      className="mt-0.5 w-4 h-4 flex-shrink-0"
                    />
                    <span>Entiendo que solo se cerrarán las ventas de este dispositivo</span>
                  </label>
                </div>
              )}

              <p className="text-xs text-gray-400 text-center mb-4">Esta acción no se puede deshacer.</p>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfirmCierre(false)}
                  disabled={cerrando}
                  className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-700 font-semibold disabled:opacity-40"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmarCierre}
                  disabled={cerrando || (!isOnline && !confirmoSoloDispositivo)}
                  className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-bold disabled:opacity-40"
                >
                  {cerrando ? 'Cerrando...' : 'Confirmar cierre'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Anular venta */}
      {anulando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => { if (!guardandoAnulacion) cerrarAnular(); }}
          />
          <div className="relative bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden">
            <div className="p-5">
              <h2 className="text-xl font-bold text-gray-900 mb-1">Anular venta</h2>
              <p className="text-sm text-gray-500 mb-4">
                Venta #{numeroPorVenta.get(anulando.id)} · {formatBS(anulando.total_bs)}. Esta acción no se puede deshacer.
              </p>

              <label className="block text-sm font-medium text-gray-700 mb-1">
                Motivo <span className="text-red-400">*</span>
              </label>
              <textarea
                value={motivoAnular}
                onChange={e => setMotivoAnular(e.target.value)}
                rows={3}
                placeholder="¿Por qué se anula esta venta?"
                className="w-full border border-gray-300 rounded-xl p-3 text-sm focus:outline-none focus:border-red-400"
                autoFocus
              />

              {errorAnular && <p className="text-red-500 text-sm mt-2">{errorAnular}</p>}
              {!isOnline && (
                <p className="text-amber-600 text-sm mt-2">Necesitas conexión para anular</p>
              )}

              <div className="flex gap-3 mt-4">
                <button
                  onClick={cerrarAnular}
                  disabled={guardandoAnulacion}
                  className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-700 font-semibold disabled:opacity-40"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmarAnular}
                  disabled={guardandoAnulacion || !motivoAnular.trim() || !isOnline}
                  className="flex-1 py-3 rounded-xl bg-red-600 text-white font-bold disabled:opacity-40"
                >
                  {guardandoAnulacion ? 'Anulando...' : 'Anular'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-5 py-2.5 rounded-xl text-sm font-medium z-50 shadow-lg max-w-xs text-center">
          {toast}
        </div>
      )}
    </div>
  );
}
