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
  getMovimientosFiado,
} from '@/lib/db';
import { getVentasPendientesRemoto, reconciliarCierresLocal, anularVenta, getAbonosPeriodoRemoto, getCierresRemoto, getVentasPorCierre } from '@/lib/sync';
import { encolarCerrarCaja, encolarActualizarCierreVentas, procesarCola } from '@/lib/outbox';
import { formatBS, formatUSD } from '@/lib/precio';
import { compartirComprobante } from '@/lib/comprobante';
import { Venta, MetodoPago, MetodoPagoVenta, CierreCaja, DesgloseCierre, MovimientoFiado } from '@/types';
import { useApp } from '@/components/Providers';
import ThemeToggle from '@/components/ThemeToggle';
import Button from '@/components/ui/Button';
import BottomSheet from '@/components/ui/BottomSheet';
import Icon from '@/components/ui/Icon';
import { TAMANO_ICONO } from '@/components/ui/iconos';

// desglose_metodos (cierres) y porMetodo (abajo) se arman siempre a partir
// de venta.pagos, así que sus llaves son MetodoPago real — 'mixto' nunca
// aparece ahí. El badge por venta (venta.metodo_pago) sí puede ser 'mixto',
// por eso estos mapas cubren MetodoPagoVenta completo.
const METODO_LABELS: Record<MetodoPagoVenta, string> = {
  efectivo_bs: 'Efectivo Bs',
  pago_movil: 'Pago Móvil',
  biopago: 'Biopago',
  tarjeta: 'Tarjeta',
  efectivo_usd: 'Efectivo $',
  fiado: 'Fiado',
  mixto: 'Mixto',
};

// Identidad visual por método de pago (chips en "Por método" y en cada
// venta) — no son tokens semánticos del sistema, es categórico a propósito,
// igual que COLORES_AVATAR en Fiado. Pares [fondo, texto] para claro/oscuro,
// tomados del mockup (llegó a una paleta casi idéntica a la que ya usaba
// esta pantalla, de forma independiente).
const METODOS_COLOR: Record<MetodoPagoVenta, { claro: [string, string]; oscuro: [string, string] }> = {
  efectivo_bs: { claro: ['#D1FAE5', '#036B48'], oscuro: ['rgba(4,135,90,.22)', '#6EE7B7'] },
  pago_movil: { claro: ['#DBEAFE', '#1D4ED8'], oscuro: ['rgba(29,78,216,.22)', '#93C5FD'] },
  biopago: { claro: ['#F3E8FF', '#7E22CE'], oscuro: ['rgba(126,34,206,.22)', '#D8B4FE'] },
  tarjeta: { claro: ['#F1F5F9', '#334155'], oscuro: ['rgba(51,65,85,.6)', '#CBD5E1'] },
  efectivo_usd: { claro: ['#FEF3C7', '#B45309'], oscuro: ['rgba(180,83,9,.22)', '#FCD34D'] },
  fiado: { claro: ['#FFEDD5', '#C2410C'], oscuro: ['rgba(194,65,12,.22)', '#FDBA74'] },
  mixto: { claro: ['#E0E7FF', '#4338CA'], oscuro: ['rgba(67,56,202,.22)', '#A5B4FC'] },
};

function colorMetodo(metodo: MetodoPagoVenta, tema: 'light' | 'dark'): { backgroundColor: string; color: string } {
  const [fondo, texto] = METODOS_COLOR[metodo][tema === 'dark' ? 'oscuro' : 'claro'];
  return { backgroundColor: fondo, color: texto };
}

function fmtFecha(iso: string, conHora = true) {
  return new Date(iso).toLocaleDateString('es-VE', {
    day: '2-digit',
    month: 'short',
    ...(conHora ? { hour: '2-digit', minute: '2-digit' } : { year: 'numeric' }),
  });
}

// Versión corta (solo día y mes) para el subtítulo del header — fmtFecha
// sigue igual, se usa tal cual en el resto del archivo.
function fmtFechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' });
}

function formatearNombre(nombre: string): string {
  return nombre
    .toLowerCase()
    .split(' ')
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

export default function ResumenPage() {
  const { tasa, negocioId, negocioNombre, datosNegocio, isOnline, user, userNombre, rol, estado, usaStock, sincronizarAhora, theme } = useApp();
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [abonos, setAbonos] = useState<MovimientoFiado[]>([]);
  const [cierres, setCierres] = useState<CierreCaja[]>([]);
  const [ultimoCierre, setUltimoCierreState] = useState<string | null>(null);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [expandidoCierre, setExpandidoCierre] = useState<string | null>(null);
  // Detalle de ventas de un cierre — cargado bajo demanda al expandir, no
  // para todos los cierres de una vez. Vive solo en memoria (no en
  // IndexedDB): con que sobreviva mientras la pantalla está abierta alcanza
  // para esta primera versión.
  const [ventasPorCierreId, setVentasPorCierreId] = useState<Record<string, Venta[]>>({});
  const [cargandoVentasCierreId, setCargandoVentasCierreId] = useState<string | null>(null);
  // Clave "cierreId:ventaId" — a diferencia de `expandido` (ventas del
  // período actual), acá hace falta el id del cierre también porque dos
  // cierres distintos podrían tener una venta expandida al mismo tiempo.
  const [expandidoVentaCierre, setExpandidoVentaCierre] = useState<string | null>(null);
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
  const [compartiendoComprobante, setCompartiendoComprobante] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 5000);
  };

  const compartirComprobanteVenta = async (venta: Venta, numero: number) => {
    setCompartiendoComprobante(venta.id);
    try {
      await compartirComprobante({ negocioNombre: negocioNombre || '', datosNegocio, venta, numero });
    } catch {
      showToast('No se pudo generar el comprobante');
    } finally {
      setCompartiendoComprobante(null);
    }
  };

  const cargar = async () => {
    const [vLocal, c, uc] = await Promise.all([
      getVentasSinCerrar(),
      getCierres(),
      getUltimoCierre(),
    ]);

    // Abonos del período actual: igual base offline-first que las ventas —
    // local siempre visible, completado con el resto del negocio cuando hay
    // red. No hay un flag "cierre_id" en fiado_movimientos como en ventas,
    // así que el corte de período es por fecha (después del último cierre).
    const abonosLocal = (await getMovimientosFiado()).filter(
      m => m.tipo === 'abono' && (!uc || m.ocurrido_en > uc)
    );

    // Etapa 1 — pinta de inmediato con lo que ya hay en este dispositivo,
    // sin esperar ninguna ida y vuelta a Supabase (reconciliación + fetch
    // remoto de ventas y abonos, etapa 2 abajo). Con la señal típica de
    // estos comercios esas idas y vueltas tardan, y hasta que terminaban la
    // pantalla se quedaba en blanco aunque ya hubiera datos guardados acá.
    setVentas(vLocal);
    setCierres(c);
    setUltimoCierreState(uc);
    setAbonos(abonosLocal);
    setSoloDispositivo(true);

    // Etapa 2 — completa con el servidor si hay conexión. Mismo criterio de
    // reconciliación y de qué gana entre local y remoto de siempre, solo
    // que corre después de la primera pintada en vez de antes.

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

    let abonosFinal = abonosLocal;
    if (isOnline && negocioId) {
      const remotos = await getAbonosPeriodoRemoto(negocioId, uc, new Date().toISOString());
      if (remotos !== null) {
        const porId = new Map(abonosLocal.map(m => [m.id, m]));
        for (const r of remotos) {
          if (!porId.has(r.id)) porId.set(r.id, r);
        }
        abonosFinal = Array.from(porId.values());
      }
    }
    setAbonos(abonosFinal);

    // Cierres de TODO el negocio, no solo los que este dispositivo archivó
    // — sin esto, un cierre hecho desde otro dispositivo (o este mismo tras
    // reinstalar/borrar almacenamiento) queda invisible en "Cierres
    // anteriores" aunque exista completo en Supabase. Mismo criterio que
    // ventas/abonos: local siempre visible, completado con el servidor
    // cuando hay conexión, y lo nuevo se cachea para verse offline después.
    if (isOnline && negocioId) {
      const cierresRemotosCompletos = await getCierresRemoto(negocioId);
      if (cierresRemotosCompletos !== null) {
        const porId = new Map(c.map(x => [x.id, x]));
        const nuevos: CierreCaja[] = [];
        for (const r of cierresRemotosCompletos) {
          if (!porId.has(r.id)) {
            porId.set(r.id, r);
            nuevos.push(r);
          }
        }
        if (nuevos.length > 0) {
          await Promise.all(nuevos.map(cierre => saveCierre(cierre)));
          setCierres(Array.from(porId.values()).sort((a, b) => b.periodo_fin.localeCompare(a.periodo_fin)));
        }
      }
    }
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

  // Cobrado, no vendido — separado a propósito de totalBS/porMetodo: un
  // abono puede venir de una venta de días atrás, así que sumarlo a "lo
  // vendido hoy" mezclaría dos cosas distintas.
  const totalAbonadoBs = abonos.reduce((s, m) => s + m.monto_bs, 0);
  const totalAbonadoUsd = abonos.reduce((s, m) => s + m.monto_usd, 0);

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
      total_abonado_bs: totalAbonadoBs,
      total_abonado_usd: totalAbonadoUsd,
      cantidad_abonos: abonos.length,
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
    setAbonos([]);
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

  // Detalle "qué vendió" de un cierre, bajo demanda — no se trae para todos
  // los cierres al cargar Resumen, solo el que el dueño realmente abre. Si
  // ya está en memoria no se vuelve a pedir (ni siquiera sin conexión: lo
  // que ya se cargó una vez en esta sesión se sigue viendo).
  const expandirCierre = async (cierreId: string) => {
    const abriendo = expandidoCierre !== cierreId;
    setExpandidoCierre(abriendo ? cierreId : null);
    if (abriendo && !ventasPorCierreId[cierreId] && isOnline) {
      setCargandoVentasCierreId(cierreId);
      const remotas = await getVentasPorCierre(cierreId);
      setCargandoVentasCierreId(null);
      if (remotas !== null) {
        setVentasPorCierreId(prev => ({ ...prev, [cierreId]: remotas }));
      }
      // Si remotas es null (falló) no se guarda nada — la sección muestra
      // "Necesitas conexión" en vez de una lista vacía engañosa, y un
      // próximo expand/collapse reintenta solo.
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

  // Igual construcción que porMetodo (bs por pagos vigentes) pero con el
  // conteo — solo para pintar en pantalla (barra de "Por método" y resumen
  // de la hoja de cierre). porMetodo en sí no se toca, sigue exactamente
  // igual que hoy (ver brief, protegido en §1).
  const countPorMetodo = ventasVigentes.reduce((acc, v) => {
    for (const p of v.pagos) acc[p.metodo] = (acc[p.metodo] || 0) + 1;
    return acc;
  }, {} as Partial<Record<MetodoPago, number>>);
  const montoMetodoMayor = Math.max(0, ...Object.values(porMetodo));
  const anuladasCount = ventas.filter(v => v.anulada).length;

  return (
    <div>
      <header className="bg-superficie-barra border-b border-borde-divisor px-4 pt-3.5 pb-3 flex items-center gap-2.5">
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-texto truncate">Resumen</h1>
          <p className="text-[11px] font-medium text-texto-3 truncate">
            {periodoInicio ? `Desde ${fmtFechaCorta(periodoInicio)}` : 'Sin ventas pendientes'}
          </p>
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

      <div className="px-4 py-3.5 flex flex-col gap-3.5">
        {soloDispositivo && (
          <div className="p-3 rounded-[12px] bg-aviso-fondo border border-aviso-borde text-aviso text-sm">
            Mostrando solo las ventas de este dispositivo — puede haber más ventas de otros usuarios
          </div>
        )}

        <div className="p-5 rounded-2xl bg-tinta">
          <p className="text-[11px] font-bold uppercase tracking-wide text-tinta-etiqueta">Vendido sin cerrar</p>
          <p className="mt-1.5 text-4xl font-extrabold text-tinta-texto tracking-tight tabular-nums">
            {formatBS(totalBS)}
          </p>
          {tasa > 0 && (
            <p className="mt-1 text-tinta-etiqueta tabular-nums">
              {formatUSD(totalUSD)} · tasa {tasa.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          )}
        </div>

        {ventasVigentes.length > 0 && (
          <>
            {/* Indicadores */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="p-3.5 rounded-2xl bg-tarjeta border border-borde-tarjeta space-y-1">
                <p className="text-[11px] font-semibold text-texto-3">Ventas</p>
                <p className="text-xl font-bold text-texto">{ventasVigentes.length}</p>
                <p className="text-[11px] text-texto-3">vigentes en el turno</p>
              </div>
              <div className="p-3.5 rounded-2xl bg-tarjeta border border-borde-tarjeta space-y-1">
                <p className="text-[11px] font-semibold text-texto-3">Ticket promedio</p>
                <p className="text-xl font-bold text-texto">
                  {formatBS(ventasVigentes.length > 0 ? totalBS / ventasVigentes.length : 0)}
                </p>
                <p className="text-[11px] text-texto-3">
                  {formatUSD(ventasVigentes.length > 0 ? totalUSD / ventasVigentes.length : 0)}
                </p>
              </div>
              <div className={`p-3.5 rounded-2xl bg-tarjeta border border-borde-tarjeta space-y-1 ${anuladasCount === 0 ? 'col-span-2' : ''}`}>
                <p className="text-[11px] font-semibold text-texto-3">Abonado a fiado</p>
                <p className="text-xl font-bold text-texto">{formatBS(totalAbonadoBs)}</p>
                <p className="text-[11px] text-texto-3">cobrado, no vendido</p>
              </div>
              {anuladasCount > 0 && (
                <div className="p-3.5 rounded-2xl bg-tarjeta border border-borde-tarjeta space-y-1">
                  <p className="text-[11px] font-semibold text-texto-3">Anuladas</p>
                  <p className="text-xl font-bold text-negativo">{anuladasCount}</p>
                  <p className="text-[11px] text-texto-3">no suman al total</p>
                </div>
              )}
            </div>

            {/* Por método de pago */}
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-texto-3">Por método de pago</p>
                <p className="text-[11px] font-bold uppercase tracking-wide text-texto-3">
                  {Object.keys(porMetodo).length} {Object.keys(porMetodo).length === 1 ? 'método' : 'métodos'}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {(Object.entries(porMetodo) as [MetodoPago, number][]).map(([metodo, total]) => {
                  const pctAncho = (total / Math.max(montoMetodoMayor, 1)) * 100;
                  const pct = totalBS > 0 ? (total / totalBS) * 100 : 0;
                  const count = countPorMetodo[metodo] ?? 0;
                  return (
                    <div key={metodo} className="relative overflow-hidden rounded-[12px] bg-tarjeta border border-borde-tarjeta">
                      <div className="absolute inset-y-0 left-0 bg-tarjeta-hundida" style={{ width: `${pctAncho}%` }} />
                      <div className="relative z-10 p-3 flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className="h-6 px-2.5 inline-flex items-center rounded-full text-xs font-semibold whitespace-nowrap"
                            style={colorMetodo(metodo, theme)}
                          >
                            {METODO_LABELS[metodo]}
                          </span>
                          <span className="font-bold text-texto tabular-nums">{formatBS(total)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-texto-3">
                          <span>{count} {count === 1 ? 'venta' : 'ventas'}</span>
                          <span className="tabular-nums">{pct.toFixed(0)} %</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* Ventas del turno */}
        {ventas.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-texto-3">Ventas del turno</p>
              <p className="text-[11px] font-bold uppercase tracking-wide text-texto-3">
                {ventas.length} {ventas.length === 1 ? 'venta' : 'ventas'}
                {anuladasCount > 0 ? ` · ${anuladasCount} anuladas` : ''}
              </p>
            </div>
            <div className="bg-tarjeta rounded-2xl border border-borde-tarjeta overflow-hidden divide-y divide-borde-divisor">
              {ventasParaMostrar.map(venta => {
                const hora = new Date(venta.fecha).toLocaleTimeString('es-VE', {
                  hour: '2-digit',
                  minute: '2-digit',
                });
                const isOpen = expandido === venta.id;

                return (
                  <div key={venta.id}>
                    <button
                      className="w-full flex items-center justify-between gap-3 p-3.5 text-left"
                      onClick={() => setExpandido(isOpen ? null : venta.id)}
                    >
                      <div className="min-w-0 flex items-center gap-2 flex-wrap">
                        <span className="text-texto-3 text-xs">{hora}</span>
                        <span
                          className="h-5 px-2 inline-flex items-center rounded-full text-[11px] font-semibold whitespace-nowrap"
                          style={colorMetodo(venta.metodo_pago, theme)}
                        >
                          {METODO_LABELS[venta.metodo_pago]}
                        </span>
                        {venta.anulada && (
                          <span className="h-5 px-2 inline-flex items-center rounded-full bg-negativo-fondo text-negativo text-[11px] font-bold whitespace-nowrap">
                            Anulada
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <p className={`font-bold tabular-nums ${venta.anulada ? 'text-texto-4 line-through' : 'text-texto'}`}>
                          {formatBS(venta.total_bs)}
                        </p>
                        <Icon
                          nombre="flechaDerecha"
                          tamano={16}
                          className={`text-texto-4 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                        />
                      </div>
                    </button>

                    {isOpen && (
                      <div className="px-3.5 pb-3.5 pt-1 flex flex-col gap-2.5">
                        {venta.items.map((item, i) => (
                          <div key={i} className="flex items-center justify-between text-sm">
                            <span className="text-texto-2">
                              {item.gramos !== undefined
                                ? formatearNombre(item.nombre)
                                : `${item.cantidad}× ${formatearNombre(item.nombre)}`}
                            </span>
                            <span className="font-medium text-texto">{formatBS(item.subtotal_bs)}</span>
                          </div>
                        ))}
                        {venta.pagos.length > 1 && (
                          <div className="border-t border-borde-divisor pt-2 flex flex-col gap-1">
                            {venta.pagos.map(p => (
                              <div key={p.id} className="flex items-center justify-between text-sm">
                                <span className="text-texto-3">{METODO_LABELS[p.metodo]}</span>
                                <span className="text-texto-2">{formatBS(p.monto_bs)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="border-t border-borde-divisor pt-2 flex items-center justify-between text-sm">
                          <span className="text-texto-3">Tasa usada</span>
                          <span className="text-texto-2">Bs {venta.tasa_usada.toLocaleString('es-VE')}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-texto-3">Vendida por</span>
                          <span className="text-texto-2">{venta.usuario_nombre || '—'}</span>
                        </div>

                        <Button
                          variante="secundario"
                          onClick={() => compartirComprobanteVenta(venta, numeroPorVenta.get(venta.id) ?? 0)}
                          disabled={compartiendoComprobante === venta.id}
                          className="w-full mt-1"
                        >
                          <Icon nombre="compartir" tamano={TAMANO_ICONO.secundario} />
                          {compartiendoComprobante === venta.id ? 'Generando...' : 'Compartir comprobante'}
                        </Button>

                        {venta.anulada ? (
                          <div className="border-t border-borde-divisor pt-2 flex flex-col gap-1">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-texto-3">Anulada por</span>
                              <span className="text-texto-2">{venta.anulada_por_nombre || '—'}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-texto-3">Fecha de anulación</span>
                              <span className="text-texto-2">{venta.anulada_en ? fmtFecha(venta.anulada_en) : '—'}</span>
                            </div>
                            <p className="text-sm text-negativo bg-negativo-fondo rounded-[10px] px-2.5 py-2 mt-1">
                              Motivo: {venta.motivo_anulacion || '—'}
                            </p>
                          </div>
                        ) : (
                          rol === 'admin' && estado !== 'restringido' && (
                            <Button
                              variante="destructivo"
                              onClick={() => abrirAnular(venta)}
                              disabled={!isOnline}
                              className="w-full mt-1"
                            >
                              <Icon nombre="anular" tamano={TAMANO_ICONO.secundario} />
                              {isOnline ? 'Anular venta' : 'Necesitas conexión para anular'}
                            </Button>
                          )
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <Button
              variante="primario"
              className="w-full"
              onClick={() => { setConfirmoSoloDispositivo(false); setShowConfirmCierre(true); }}
            >
              <Icon nombre="confirmar" tamano={TAMANO_ICONO.secundario} />
              Cerrar caja
            </Button>
          </div>
        ) : (
          <div className="text-center text-texto-3 py-10">
            <Icon nombre="resumen" tamano={48} className="mx-auto mb-3 text-texto-4" />
            <p className="font-medium">Caja cerrada</p>
            <p className="text-sm mt-1">Las nuevas ventas aparecerán aquí</p>
          </div>
        )}

        {/* Cierres anteriores */}
        {cierres.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-texto-3">Cierres anteriores</p>
            <div className="bg-tarjeta rounded-2xl border border-borde-tarjeta overflow-hidden divide-y divide-borde-divisor">
              {cierres.map(cierre => {
                const isOpen = expandidoCierre === cierre.id;
                return (
                  <div key={cierre.id}>
                    <button
                      className="w-full flex items-center justify-between gap-3 p-3.5 text-left"
                      onClick={() => expandirCierre(cierre.id)}
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-texto">{fmtFecha(cierre.periodo_fin)}</p>
                        <p className="text-xs text-texto-3 mt-0.5">
                          {cierre.cantidad_ventas} {cierre.cantidad_ventas === 1 ? 'venta' : 'ventas'}
                          {' · '}desde {fmtFecha(cierre.periodo_inicio)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <p className="font-bold text-texto tabular-nums">{formatBS(cierre.total_bs)}</p>
                        <Icon
                          nombre="flechaDerecha"
                          tamano={16}
                          className={`text-texto-4 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                        />
                      </div>
                    </button>

                    {isOpen && (
                      <div className="px-3.5 pb-3.5 pt-1 flex flex-col gap-2.5">
                        {cierre.total_usd > 0 && (
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-texto-3">Total</span>
                            <span className="font-medium text-texto-2">{formatUSD(cierre.total_usd)}</span>
                          </div>
                        )}
                        <div className="flex flex-col gap-2">
                          {(Object.entries(cierre.desglose_metodos) as [MetodoPago, DesgloseCierre][]).map(([metodo, d]) => (
                            <div key={metodo} className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span
                                  className="h-5 px-2 inline-flex items-center rounded-full text-[11px] font-semibold whitespace-nowrap"
                                  style={colorMetodo(metodo, theme)}
                                >
                                  {METODO_LABELS[metodo]}
                                </span>
                                <span className="text-xs text-texto-3">{d.count} {d.count === 1 ? 'venta' : 'ventas'}</span>
                              </div>
                              <span className="font-bold text-sm text-texto tabular-nums">{formatBS(d.bs)}</span>
                            </div>
                          ))}
                        </div>
                        {!!cierre.cantidad_abonos && (
                          <div className="border-t border-borde-divisor pt-2 flex items-center justify-between">
                            <span className="text-xs text-texto-3">Abonos recibidos ({cierre.cantidad_abonos})</span>
                            <span className="font-bold text-sm text-texto tabular-nums">
                              {formatBS(cierre.total_abonado_bs ?? 0)}
                            </span>
                          </div>
                        )}
                        <div className="border-t border-borde-divisor pt-2 flex items-center justify-between text-sm">
                          <span className="text-texto-3">Tasa al cierre</span>
                          <span className="text-texto-2">
                            Bs {cierre.tasa_cierre.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-texto-3">Cerrado por</span>
                          <span className="text-texto-2">{cierre.usuario_nombre || '—'}</span>
                        </div>

                        {/* Detalle de ventas del cierre — versión de solo
                            lectura: sin compartir ni anular acá. Copia visual
                            del bloque de "Ventas del turno" de arriba (no
                            extraída a componente compartido a propósito, ver
                            brief). */}
                        <div className="border-t border-borde-divisor pt-3 mt-1 flex flex-col gap-2">
                          <p className="text-[11px] font-semibold text-texto-3 uppercase tracking-wide">
                            Ventas de este cierre
                          </p>
                          {cargandoVentasCierreId === cierre.id ? (
                            <p className="text-sm text-texto-3 py-1">Cargando ventas…</p>
                          ) : !ventasPorCierreId[cierre.id] ? (
                            <p className="text-sm text-aviso py-1">Necesitas conexión para ver el detalle</p>
                          ) : ventasPorCierreId[cierre.id].length === 0 ? (
                            <p className="text-sm text-texto-3 py-1">Sin ventas registradas</p>
                          ) : (
                            <div className="rounded-[12px] border border-borde-tarjeta overflow-hidden divide-y divide-borde-divisor">
                              {[...ventasPorCierreId[cierre.id]]
                                .sort((a, b) => a.fecha.localeCompare(b.fecha))
                                .map(venta => {
                                  const hora = new Date(venta.fecha).toLocaleTimeString('es-VE', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  });
                                  const ventaKey = `${cierre.id}:${venta.id}`;
                                  const ventaOpen = expandidoVentaCierre === ventaKey;

                                  return (
                                    <div key={venta.id}>
                                      <button
                                        className="w-full flex items-center justify-between gap-3 p-3 text-left"
                                        onClick={() => setExpandidoVentaCierre(ventaOpen ? null : ventaKey)}
                                      >
                                        <div className="min-w-0 flex items-center gap-2 flex-wrap">
                                          <span className="text-texto-3 text-xs">{hora}</span>
                                          <span
                                            className="h-5 px-2 inline-flex items-center rounded-full text-[11px] font-semibold whitespace-nowrap"
                                            style={colorMetodo(venta.metodo_pago, theme)}
                                          >
                                            {METODO_LABELS[venta.metodo_pago]}
                                          </span>
                                          {venta.anulada && (
                                            <span className="h-5 px-2 inline-flex items-center rounded-full bg-negativo-fondo text-negativo text-[11px] font-bold whitespace-nowrap">
                                              Anulada
                                            </span>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                          <p className={`font-bold text-sm tabular-nums ${venta.anulada ? 'text-texto-4 line-through' : 'text-texto'}`}>
                                            {formatBS(venta.total_bs)}
                                          </p>
                                          <Icon
                                            nombre="flechaDerecha"
                                            tamano={14}
                                            className={`text-texto-4 transition-transform ${ventaOpen ? 'rotate-90' : ''}`}
                                          />
                                        </div>
                                      </button>

                                      {ventaOpen && (
                                        <div className="px-3 pb-3 pt-1 flex flex-col gap-2 bg-tarjeta-hundida">
                                          {venta.items.map((item, idx) => (
                                            <div key={idx} className="flex items-center justify-between text-sm">
                                              <span className="text-texto-2">
                                                {item.gramos !== undefined
                                                  ? formatearNombre(item.nombre)
                                                  : `${item.cantidad}× ${formatearNombre(item.nombre)}`}
                                              </span>
                                              <span className="font-medium text-texto">{formatBS(item.subtotal_bs)}</span>
                                            </div>
                                          ))}
                                          {venta.pagos.length > 1 && (
                                            <div className="border-t border-borde-divisor pt-2 flex flex-col gap-1">
                                              {venta.pagos.map(p => (
                                                <div key={p.id} className="flex items-center justify-between text-sm">
                                                  <span className="text-texto-3">{METODO_LABELS[p.metodo]}</span>
                                                  <span className="text-texto-2">{formatBS(p.monto_bs)}</span>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                          <div className="border-t border-borde-divisor pt-2 flex items-center justify-between text-sm">
                                            <span className="text-texto-3">Tasa usada</span>
                                            <span className="text-texto-2">Bs {venta.tasa_usada.toLocaleString('es-VE')}</span>
                                          </div>
                                          <div className="flex items-center justify-between text-sm">
                                            <span className="text-texto-3">Vendida por</span>
                                            <span className="text-texto-2">{venta.usuario_nombre || '—'}</span>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Cerrar caja */}
      <BottomSheet
        abierto={showConfirmCierre}
        onCerrar={() => { if (!cerrando) setShowConfirmCierre(false); }}
        titulo="Cerrar caja"
      >
        <div className="space-y-4">
          <p className="text-sm text-texto-3">
            Se archivará todo el período actual. Esta acción no se puede deshacer.
          </p>

          <div className="p-4 rounded-2xl bg-tinta text-center">
            <p className="text-2xl font-extrabold text-tinta-texto tabular-nums">{formatBS(totalBS)}</p>
            {tasa > 0 && <p className="text-tinta-etiqueta text-sm mt-0.5 tabular-nums">{formatUSD(totalUSD)}</p>}
            <p className="text-tinta-etiqueta text-sm font-medium mt-1">
              {ventasVigentes.length} {ventasVigentes.length === 1 ? 'venta' : 'ventas'}
            </p>
          </div>

          {Object.keys(porMetodo).length > 0 && (
            <div className="flex flex-col gap-2">
              {(Object.entries(porMetodo) as [MetodoPago, number][]).map(([metodo, total]) => (
                <div key={metodo} className="flex items-center justify-between">
                  <span
                    className="h-6 px-2.5 inline-flex items-center rounded-full text-xs font-semibold whitespace-nowrap"
                    style={colorMetodo(metodo, theme)}
                  >
                    {METODO_LABELS[metodo]}
                  </span>
                  <span className="font-bold text-sm text-texto tabular-nums">{formatBS(total)}</span>
                </div>
              ))}
            </div>
          )}

          {abonos.length > 0 && (
            <div className="flex items-center justify-between p-3 rounded-[12px] bg-tarjeta-hundida">
              <span className="text-sm text-texto-2">Abonos recibidos ({abonos.length})</span>
              <span className="font-bold text-sm text-texto tabular-nums">{formatBS(totalAbonadoBs)}</span>
            </div>
          )}

          {!isOnline && (
            <div className="p-3 rounded-[12px] bg-aviso-fondo border border-aviso-borde">
              <p className="text-sm font-bold text-aviso text-center">Sin conexión</p>
              <p className="text-sm text-aviso text-center mt-1">
                Solo se cerrarán las ventas de este dispositivo. Si hay otros cajeros vendiendo en este momento,
                sus ventas quedarán fuera de este cierre. Si puedes, espera a tener conexión.
              </p>
              <label className="flex items-start gap-2.5 mt-3 cursor-pointer">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={confirmoSoloDispositivo}
                  onClick={() => setConfirmoSoloDispositivo(v => !v)}
                  className={`flex-none w-5 h-5 mt-0.5 rounded-[6px] border flex items-center justify-center ${
                    confirmoSoloDispositivo ? 'bg-marca border-marca' : 'border-aviso-borde'
                  }`}
                >
                  {confirmoSoloDispositivo && <Icon nombre="confirmar" tamano={14} className="text-texto-invertido" />}
                </button>
                <span className="text-sm text-aviso">Entiendo que solo se cerrarán las ventas de este dispositivo</span>
              </label>
            </div>
          )}

          <Button
            variante="primario"
            disabled={cerrando || (!isOnline && !confirmoSoloDispositivo)}
            onClick={confirmarCierre}
            className="w-full"
          >
            {cerrando ? 'Cerrando...' : 'Confirmar cierre'}
          </Button>
          <button
            type="button"
            onClick={() => setShowConfirmCierre(false)}
            disabled={cerrando}
            className="w-full h-[52px] rounded-[12px] border border-borde-tarjeta text-texto-3 font-semibold disabled:opacity-40"
          >
            Volver
          </button>
        </div>
      </BottomSheet>

      {/* Anular venta */}
      <BottomSheet
        abierto={!!anulando}
        onCerrar={() => { if (!guardandoAnulacion) cerrarAnular(); }}
        titulo="Anular venta"
      >
        {anulando && (
          <div className="space-y-4">
            <p className="text-sm text-texto-3">
              Venta #{numeroPorVenta.get(anulando.id)} · {formatBS(anulando.total_bs)}. Esta acción no se puede deshacer.
            </p>

            <div>
              <label className="block text-sm text-texto-3 mb-1.5">Motivo</label>
              <textarea
                value={motivoAnular}
                onChange={e => setMotivoAnular(e.target.value)}
                rows={3}
                placeholder="¿Por qué se anula esta venta?"
                className={`font-caja w-full rounded-[12px] border bg-tarjeta text-texto text-base px-4 py-3 placeholder:text-texto-4 outline-none transition-colors duration-150 ${
                  errorAnular ? 'border-negativo' : 'border-borde-campo focus:border-foco'
                }`}
                autoFocus
              />
            </div>

            {errorAnular && <p className="text-sm text-negativo">{errorAnular}</p>}
            {!isOnline && <p className="text-sm text-aviso">Necesitas conexión para anular</p>}

            <Button
              variante="destructivo"
              disabled={guardandoAnulacion || !motivoAnular.trim() || !isOnline}
              onClick={confirmarAnular}
              className="w-full"
            >
              {guardandoAnulacion ? 'Anulando...' : 'Anular'}
            </Button>
            <button
              type="button"
              onClick={cerrarAnular}
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
