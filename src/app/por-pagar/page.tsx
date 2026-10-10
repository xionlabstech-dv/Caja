'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Acreedor, TipoAcreedor, MovimientoAcreedor, MetodoAbono } from '@/types';
import {
  getAcreedores,
  saveAcreedor,
  getMovimientosAcreedorPorAcreedor,
  saveMovimientoAcreedor,
  actualizarSaldoAcreedorLocal,
} from '@/lib/db';
import { getMovimientosAcreedorRemoto } from '@/lib/sync';
import { encolarCrearAcreedor, encolarAplicarMovimientoAcreedor, onFalloPermanente } from '@/lib/outbox';
import { formatBS, formatUSD } from '@/lib/precio';
import { METODOS_PAGO } from '@/lib/metodos';
import { useApp } from '@/components/Providers';
import { useGuardarRuta } from '@/lib/useGuardarRuta';
import ThemeToggle from '@/components/ThemeToggle';
import Button from '@/components/ui/Button';
import BottomSheet from '@/components/ui/BottomSheet';
import ChipFiltro from '@/components/ui/ChipFiltro';
import Icon from '@/components/ui/Icon';
import { ICONO_METODO_PAGO, TAMANO_ICONO } from '@/components/ui/iconos';

const TIPOS: { id: TipoAcreedor; label: string; labelPlural: string }[] = [
  { id: 'proveedor', label: 'Proveedor', labelPlural: 'Proveedores' },
  { id: 'servicio', label: 'Servicio', labelPlural: 'Servicios' },
  { id: 'persona', label: 'Persona', labelPlural: 'Personas' },
];

function labelTipo(tipo: TipoAcreedor): string {
  return TIPOS.find(t => t.id === tipo)?.label ?? tipo;
}

// Un pago nunca es 'fiado' — ese método no tiene sentido para pagarle a un
// acreedor. Mismo filtro que METODOS_ABONO en fiado/page.tsx.
const METODOS_ABONO = METODOS_PAGO.filter(
  (m): m is { id: MetodoAbono; label: string } => m.id !== 'fiado'
);

// Saldos que quedaron en centavos de nada por redondeo no cuentan como
// deuda real — mismo margen que usa Fiado, y el mismo que acreedores_listar
// usa internamente para decidir `vencido`: tienen que coincidir.
const EPSILON_SALDO = 0.005;

// proximo_vencimiento y vence_el son 'date' puros de Postgres ('YYYY-MM-DD'):
// parsearlos con `new Date(iso)` a secas los interpreta en UTC y puede
// mostrar el día anterior según la zona horaria (mismo cuidado que
// fmtFechaCorta en presupuestos/page.tsx).
function fmtVencimiento(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return new Date(anio, mes - 1, dia).toLocaleDateString('es-VE', { day: 'numeric', month: 'long' });
}

// Relativa ("hace 3 d") + exacta (día y mes corto) — mismo criterio que
// fmtFechaRelativa/fmtFechaExacta en fiado/page.tsx. A diferencia de
// fmtVencimiento, ocurrido_en es un timestamp real (new Date().toISOString()),
// así que acá sí corresponde `new Date(iso)` directo.
function fmtFechaRelativa(iso: string): string {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
  if (dias <= 0) return 'hoy';
  if (dias < 30) return `hace ${dias} d`;
  return `hace ${Math.floor(dias / 30)} m`;
}

function fmtFechaExacta(iso: string): string {
  return new Date(iso).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' });
}

// Recordatorio de pago recurrente: SOLO avisa cuándo toca pagar este mes,
// nunca genera la deuda sola (ver Cambio 5 del brief) ni cruza con los
// movimientos para adivinar si ya se pagó. Se recalcula contra el día de
// hoy en el mes actual — normalizado para meses cortos (31 en febrero cae
// en el último día real, no se desborda a marzo), con el mismo cuidado de
// zona horaria que fmtVencimiento: se construye la fecha por partes, nunca
// `new Date(iso)` a secas.
function textoRecordatorio(diaPago: number): { texto: string; destacar: boolean } {
  const hoy = new Date();
  const anio = hoy.getFullYear();
  const mes = hoy.getMonth();
  const ultimoDiaDelMes = new Date(anio, mes + 1, 0).getDate();
  const fecha = new Date(anio, mes, Math.min(diaPago, ultimoDiaDelMes));
  const hoySinHora = new Date(anio, mes, hoy.getDate());
  const dias = Math.round((fecha.getTime() - hoySinHora.getTime()) / (24 * 60 * 60 * 1000));

  let cuando: string;
  if (dias === 0) cuando = 'hoy';
  else if (dias > 0) cuando = `faltan ${dias} ${dias === 1 ? 'día' : 'días'}`;
  else cuando = `fue hace ${Math.abs(dias)} ${Math.abs(dias) === 1 ? 'día' : 'días'}`;

  // Destacar cuando faltan 3 días o menos, o ya pasó — mismo umbral que el
  // aviso de "Vencido" que ya existe en la pantalla.
  return { texto: `Paga los ${diaPago} · ${cuando}`, destacar: dias <= 3 };
}

export default function PorPagarPage() {
  const permitida = useGuardarRuta();
  const { tasa, isOnline, negocioId, userNombre, usaCuentasPagar, productosVersion } = useApp();
  const router = useRouter();

  const [acreedores, setAcreedores] = useState<Acreedor[]>([]);
  const [cargando, setCargando] = useState(true);
  const [chip, setChip] = useState<'todos' | TipoAcreedor>('todos');
  const [expandido, setExpandido] = useState<string | null>(null);
  const [detalleMovimientos, setDetalleMovimientos] = useState<Record<string, MovimientoAcreedor[]>>({});

  const [creando, setCreando] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [tipoNuevo, setTipoNuevo] = useState<TipoAcreedor | null>(null);
  const [notaNuevo, setNotaNuevo] = useState('');
  const [recurrenteNuevo, setRecurrenteNuevo] = useState(false);
  const [diaPagoNuevo, setDiaPagoNuevo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [errorNuevo, setErrorNuevo] = useState('');

  // Registrar deuda
  const [registrandoDeuda, setRegistrandoDeuda] = useState<Acreedor | null>(null);
  const [monedaDeuda, setMonedaDeuda] = useState<'usd' | 'bs'>('usd');
  const [montoDeuda, setMontoDeuda] = useState('');
  const [venceElDeuda, setVenceElDeuda] = useState('');
  const [notaDeuda, setNotaDeuda] = useState('');
  const [guardandoDeuda, setGuardandoDeuda] = useState(false);
  const [errorDeuda, setErrorDeuda] = useState('');

  // Registrar pago
  const [pagando, setPagando] = useState<Acreedor | null>(null);
  const [metodoPago, setMetodoPago] = useState<MetodoAbono | null>(null);
  const [montoPago, setMontoPago] = useState('');
  const [notaPago, setNotaPago] = useState('');
  const [guardandoPago, setGuardandoPago] = useState(false);
  const [errorPago, setErrorPago] = useState('');

  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  // Módulo opcional apagado por default: useGuardarRuta ya cubre rol/estado
  // (la ruta vive en RUTAS_ADMIN/RUTAS_OCULTAS_RESTRINGIDO), pero no sabe de
  // usa_cuentas_pagar — un admin con el módulo apagado tiene la ruta
  // permitida y llegaría a esta pantalla escribiendo la URL a mano.
  useEffect(() => {
    if (!usaCuentasPagar) router.replace('/');
  }, [usaCuentasPagar, router]);

  // acreedores viaja en el mismo sync periódico que productos (ver
  // syncFromSupabase) — se relee de IndexedDB con el mismo disparador que
  // usa Fiado, funciona sin conexión con el último dato sincronizado. A
  // diferencia de getProductos(), getAcreedores() no filtra por `activo` —
  // se filtra acá, o se mostrarían proveedores ya dados de baja.
  useEffect(() => {
    let cancelado = false;
    getAcreedores().then(as => {
      if (cancelado) return;
      setAcreedores(as.filter(a => a.activo));
      setCargando(false);
    });
    return () => { cancelado = true; };
  }, [productosVersion]);

  // Si la cola rechazó de forma definitiva un movimiento de este acreedor,
  // ya corrigió el saldo en IndexedDB de inmediato (ver outbox.ts) — sin
  // esto, esta pantalla seguiría mostrando el saldo optimista viejo hasta el
  // próximo sync periódico. Mismo listener que usa Fiado.
  useEffect(() => onFalloPermanente(() => {
    getAcreedores().then(as => setAcreedores(as.filter(a => a.activo)));
  }), []);

  // Recién ahora, con todos los hooks ya llamados, se puede cortar el
  // render — mismo criterio que Fiado, evita un frame de contenido indebido
  // antes de que el redirect del efecto de arriba (o useGuardarRuta) actúe.
  if (!permitida || !usaCuentasPagar) return null;

  const conDeuda = acreedores.filter(a => a.saldo_usd > EPSILON_SALDO);
  const vencidos = conDeuda.filter(a => a.vencido);

  const totalDeudaUsd = conDeuda.reduce((s, a) => s + a.saldo_usd, 0);
  const totalDeudaBs = tasa > 0 ? totalDeudaUsd * tasa : 0;
  const montoVencidoUsd = vencidos.reduce((s, a) => s + a.saldo_usd, 0);

  // El RPC ya los devuelve ordenados (saldo_usd desc, nombre) pero sin
  // conexión los datos salen de IndexedDB, donde ese orden no está
  // garantizado — se ordena también acá.
  const acreedoresFiltrados = acreedores
    .filter(a => (chip === 'todos' ? true : a.tipo === chip))
    .sort((a, b) => b.saldo_usd - a.saldo_usd || a.nombre.localeCompare(b.nombre, 'es'));

  // El historial no viaja en el sync periódico (el saldo sí) — se pide al
  // expandir. Sin red se muestra lo último cacheado en este dispositivo, o
  // nada la primera vez, sin bloquear el resto de la pantalla. Espejo de
  // expandirCliente en fiado/page.tsx.
  const expandirAcreedor = async (acreedorId: string) => {
    setExpandido(prev => (prev === acreedorId ? null : acreedorId));
    const local = await getMovimientosAcreedorPorAcreedor(acreedorId);
    setDetalleMovimientos(prev => ({ ...prev, [acreedorId]: local }));
    if (isOnline) {
      const remotos = await getMovimientosAcreedorRemoto(acreedorId, 20);
      if (remotos) {
        await Promise.all(remotos.map(m => saveMovimientoAcreedor(m)));
        setDetalleMovimientos(prev => ({ ...prev, [acreedorId]: remotos }));
      }
    }
  };

  const abrirCrear = () => {
    setNombreNuevo('');
    setTipoNuevo(null);
    setNotaNuevo('');
    setRecurrenteNuevo(false);
    setDiaPagoNuevo('');
    setErrorNuevo('');
    setCreando(true);
  };

  const cerrarCrear = () => {
    if (guardando) return;
    setCreando(false);
  };

  const confirmarCrear = async () => {
    if (!negocioId) return;
    const nombre = nombreNuevo.trim();
    if (!nombre) {
      setErrorNuevo('Ingresa un nombre');
      return;
    }
    if (!tipoNuevo) {
      setErrorNuevo('Elige un tipo');
      return;
    }
    const diaPagoNum = parseInt(diaPagoNuevo, 10);
    if (recurrenteNuevo && (!diaPagoNuevo.trim() || isNaN(diaPagoNum) || diaPagoNum < 1 || diaPagoNum > 31)) {
      setErrorNuevo('Elige el día del mes (1 a 31)');
      return;
    }

    setGuardando(true);
    const nuevo: Acreedor = {
      id: crypto.randomUUID(),
      negocio_id: negocioId,
      nombre,
      tipo: tipoNuevo,
      saldo_usd: 0,
      nota: notaNuevo.trim() || null,
      activo: true,
      creado_en: new Date().toISOString(),
      movimientos: 0,
      ultimo_movimiento_en: null,
      proximo_vencimiento: null,
      vencido: false,
      // Apagado por defecto: si no está prendido, el día no se muestra ni
      // se guarda (ver Cambio 5 del brief).
      es_recurrente: recurrenteNuevo,
      dia_pago: recurrenteNuevo ? diaPagoNum : null,
    };

    try {
      // Offline-first: igual que crearClienteFiado (src/app/page.tsx) — se
      // guarda local primero y se encola, nunca se espera al servidor para
      // mostrarlo.
      await saveAcreedor(nuevo);
      setAcreedores(prev => [...prev, nuevo]);
      await encolarCrearAcreedor(nuevo, negocioId);
      setCreando(false);
      showToast('Acreedor agregado');
      // Corrección directa de lo que le pasó a Juan probando: crear un
      // acreedor sin encadenar con "Registrar deuda" deja todo en cero sin
      // que quede claro por qué. Se puede saltear sin fricción: el
      // BottomSheet se cierra igual con el velo o la X.
      abrirRegistrarDeuda(nuevo);
    } catch {
      // Si IndexedDB falla, lo único inaceptable es dejar al usuario
      // encerrado en la hoja: cerrarCrear() no responde mientras
      // `guardando` esté en true, y el BottomSheet solo se cierra por ahí.
      setErrorNuevo('No se pudo guardar en este teléfono. Intenta de nuevo.');
    } finally {
      setGuardando(false);
    }
  };

  const abrirRegistrarDeuda = (acreedor: Acreedor) => {
    setRegistrandoDeuda(acreedor);
    setMonedaDeuda('usd');
    setMontoDeuda('');
    setVenceElDeuda('');
    setNotaDeuda('');
    setErrorDeuda('');
  };

  const cerrarRegistrarDeuda = () => {
    if (guardandoDeuda) return;
    setRegistrandoDeuda(null);
  };

  const montoDeudaEsUsd = monedaDeuda === 'usd';
  const montoDeudaNum = parseFloat(montoDeuda);
  // El equivalente se calcula una sola vez, con la tasa de este instante, y
  // se guarda tal cual — nunca se deriva después del otro monto. Igual que
  // montoAbonoUsd/montoAbonoBsCalculado en Fiado.
  const montoDeudaUsd = registrandoDeuda && montoDeudaNum > 0
    ? (montoDeudaEsUsd ? montoDeudaNum : (tasa > 0 ? montoDeudaNum / tasa : 0))
    : 0;
  const montoDeudaBsCalculado = registrandoDeuda && montoDeudaNum > 0
    ? (montoDeudaEsUsd ? (tasa > 0 ? montoDeudaNum * tasa : 0) : montoDeudaNum)
    : 0;
  const totalDespuesDeuda = registrandoDeuda && montoDeudaNum > 0 ? registrandoDeuda.saldo_usd + montoDeudaUsd : null;

  const confirmarDeuda = async () => {
    if (!registrandoDeuda || !negocioId) return;
    if (!montoDeuda.trim() || isNaN(montoDeudaNum) || montoDeudaNum <= 0) {
      setErrorDeuda('Ingresa un monto válido');
      return;
    }
    if (!montoDeudaEsUsd && tasa <= 0) {
      setErrorDeuda('Configura la tasa BCV para registrar en Bs');
      return;
    }

    setGuardandoDeuda(true);
    const now = new Date().toISOString();
    const nuevoSaldo = registrandoDeuda.saldo_usd + montoDeudaUsd;
    const movimiento: MovimientoAcreedor = {
      id: crypto.randomUUID(),
      negocio_id: negocioId,
      acreedor_id: registrandoDeuda.id,
      tipo: 'deuda',
      monto_usd: montoDeudaUsd,
      monto_bs: montoDeudaBsCalculado,
      tasa_usada: tasa,
      metodo_pago: null,
      vence_el: venceElDeuda || null,
      nota: notaDeuda.trim() || null,
      usuario_nombre: userNombre || null,
      saldo_resultante: nuevoSaldo,
      ocurrido_en: now,
      sincronizado: false,
    };

    try {
      // Offline-first, mismo orden que confirmarAbono en Fiado: el
      // movimiento ya ocurrió en la realidad (la mercancía llegó) — se
      // aplica local de inmediato y nunca se revierte solo porque falle la
      // red en este instante.
      await saveMovimientoAcreedor(movimiento);
      await actualizarSaldoAcreedorLocal(registrandoDeuda.id, nuevoSaldo);
      setAcreedores(prev => prev.map(a => (a.id === registrandoDeuda.id ? { ...a, saldo_usd: nuevoSaldo } : a)));
      // Si el historial de este acreedor ya está abierto (expandido), tiene
      // que reflejar el movimiento recién guardado sin esperar a que se
      // colapse y reexpanda — si no, queda contradiciendo al saldo de
      // arriba, que sí se actualiza al toque.
      setDetalleMovimientos(prev => ({
        ...prev,
        [registrandoDeuda.id]: [movimiento, ...(prev[registrandoDeuda.id] ?? [])],
      }));
      await encolarAplicarMovimientoAcreedor(movimiento.id, negocioId);
      setRegistrandoDeuda(null);
      showToast('Deuda registrada');
    } catch {
      // Mismo candado que confirmarCrear: el finally de abajo es lo único
      // que garantiza que la hoja se pueda cerrar pase lo que pase.
      setErrorDeuda('No se pudo guardar en este teléfono. Intenta de nuevo.');
    } finally {
      setGuardandoDeuda(false);
    }
  };

  const abrirRegistrarPago = (acreedor: Acreedor) => {
    setPagando(acreedor);
    setMetodoPago(null);
    setMontoPago('');
    setNotaPago('');
    setErrorPago('');
  };

  const cerrarRegistrarPago = () => {
    if (guardandoPago) return;
    setPagando(null);
  };

  const pagoEsUsd = metodoPago === 'efectivo_usd';
  const montoPagoNum = parseFloat(montoPago);
  const montoPagoUsd = pagando && montoPagoNum > 0
    ? (pagoEsUsd ? montoPagoNum : (tasa > 0 ? montoPagoNum / tasa : 0))
    : 0;
  const montoPagoBsCalculado = pagando && montoPagoNum > 0
    ? (pagoEsUsd ? (tasa > 0 ? montoPagoNum * tasa : 0) : montoPagoNum)
    : 0;
  const restanteDespuesPago = pagando && montoPagoNum > 0 ? pagando.saldo_usd - montoPagoUsd : null;
  const excedeDeudaPago = pagando !== null && montoPagoNum > 0 && montoPagoUsd > pagando.saldo_usd + EPSILON_SALDO;
  const quedaEnCeroPago = Math.max(0, restanteDespuesPago ?? 0) <= EPSILON_SALDO;
  const muestraTodoPago = metodoPago !== null && (pagoEsUsd || tasa > 0);

  // Rellena el monto con la deuda completa, convertida a la moneda del
  // método elegido — mismo botón píldora "Todo" que Fiado.
  const montoTodoPago = () => {
    if (!pagando || !metodoPago) return;
    const v = pagoEsUsd ? pagando.saldo_usd : pagando.saldo_usd * tasa;
    setMontoPago(v.toFixed(2));
  };

  const confirmarPago = async () => {
    if (!pagando || !negocioId) return;
    if (!metodoPago) {
      setErrorPago('Elige un método de pago');
      return;
    }
    if (!montoPago.trim() || isNaN(montoPagoNum) || montoPagoNum <= 0) {
      setErrorPago('Ingresa un monto válido');
      return;
    }
    if (!pagoEsUsd && tasa <= 0) {
      setErrorPago('Configura la tasa BCV para pagar con este método');
      return;
    }
    if (excedeDeudaPago) {
      setErrorPago(`No puede superar la deuda: ${formatUSD(pagando.saldo_usd)}`);
      return;
    }

    setGuardandoPago(true);
    const now = new Date().toISOString();
    const nuevoSaldo = Math.max(0, pagando.saldo_usd - montoPagoUsd);
    const movimiento: MovimientoAcreedor = {
      id: crypto.randomUUID(),
      negocio_id: negocioId,
      acreedor_id: pagando.id,
      tipo: 'pago',
      monto_usd: montoPagoUsd,
      monto_bs: montoPagoBsCalculado,
      tasa_usada: tasa,
      metodo_pago: metodoPago,
      vence_el: null,
      nota: notaPago.trim() || null,
      usuario_nombre: userNombre || null,
      saldo_resultante: nuevoSaldo,
      ocurrido_en: now,
      sincronizado: false,
    };

    try {
      await saveMovimientoAcreedor(movimiento);
      await actualizarSaldoAcreedorLocal(pagando.id, nuevoSaldo);
      setAcreedores(prev => prev.map(a => (a.id === pagando.id ? { ...a, saldo_usd: nuevoSaldo } : a)));
      // Mismo motivo que en confirmarDeuda: si el historial de este
      // acreedor está abierto, no puede seguir diciendo "no hay
      // movimientos" mientras el saldo de arriba ya cambió.
      setDetalleMovimientos(prev => ({
        ...prev,
        [pagando.id]: [movimiento, ...(prev[pagando.id] ?? [])],
      }));
      await encolarAplicarMovimientoAcreedor(movimiento.id, negocioId);
      setPagando(null);
      showToast('Pago registrado');
    } catch {
      setErrorPago('No se pudo guardar en este teléfono. Intenta de nuevo.');
    } finally {
      setGuardandoPago(false);
    }
  };

  const textoConfirmarPago = guardandoPago
    ? 'Guardando...'
    : !metodoPago
    ? 'Elige el método del pago'
    : !montoPago.trim() || montoPagoNum <= 0
    ? 'Ingresa el monto'
    : 'Confirmar pago';

  return (
    <div>
      <header className="bg-superficie-barra border-b border-borde-divisor px-4 pt-3.5 pb-3 flex items-center gap-2.5">
        <button onClick={() => router.back()} className="p-1 -ml-1 flex-shrink-0 text-texto-3" aria-label="Volver">
          <Icon nombre="flechaAbajo" tamano={TAMANO_ICONO.buscarYToggle} className="rotate-90" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-texto truncate">Por pagar</h1>
          <p className="text-[11px] font-medium text-texto-3 truncate">Lo que le debes a otros</p>
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
        <button
          onClick={abrirCrear}
          className="flex-none h-11 px-4 rounded-xl bg-marca text-texto-invertido font-semibold text-sm flex items-center gap-1.5 active:bg-marca-presion"
        >
          <Icon nombre="agregar" tamano={TAMANO_ICONO.secundario} />
          Agregar
        </button>
      </header>

      {/* pb-1 + overflow visible: mismo arreglo que Fiado/Inventario para
          que la barra de scroll del navegador no pise los chips */}
      <div className="px-4 pt-3 pb-4 bg-superficie-barra border-b border-borde-divisor">
        <div className="flex gap-2 -mx-4 px-4 pb-1 overflow-x-auto">
          <ChipFiltro activo={chip === 'todos'} onClick={() => setChip('todos')}>Todos</ChipFiltro>
          {TIPOS.map(t => (
            <ChipFiltro key={t.id} activo={chip === t.id} onClick={() => setChip(t.id)}>
              {t.labelPlural}
            </ChipFiltro>
          ))}
        </div>
      </div>

      <div className="px-4 py-3.5 flex flex-col gap-3.5">
        <div className="p-5 rounded-2xl bg-tinta">
          <p className="text-[11px] font-bold uppercase tracking-wide text-tinta-etiqueta">Total por pagar</p>
          <p className="mt-1.5 text-4xl font-extrabold text-tinta-texto tracking-tight tabular-nums">
            {formatUSD(totalDeudaUsd)}
          </p>
          <p className="mt-1 text-tinta-etiqueta tabular-nums">
            {formatBS(totalDeudaBs)} · {conDeuda.length} {conDeuda.length === 1 ? 'acreedor debe' : 'acreedores deben'}
          </p>
          {vencidos.length > 0 && (
            <>
              <div className="h-px bg-[rgba(255,255,255,0.14)] my-3" />
              <div className="flex items-center gap-2 flex-wrap">
                <span className="h-6 px-2.5 inline-flex items-center rounded-full bg-negativo-fondo text-negativo text-[11px] font-bold whitespace-nowrap">
                  {vencidos.length} {vencidos.length === 1 ? 'vencido' : 'vencidos'}
                </span>
                <span className="text-tinta-etiqueta text-sm">{formatUSD(montoVencidoUsd)} con vencimiento pasado</span>
              </div>
            </>
          )}
        </div>

        {cargando ? (
          <div className="text-center text-texto-3 py-16">
            <Icon nombre="cargando" tamano={32} className="mx-auto mb-3 text-marca animate-spin" />
          </div>
        ) : acreedores.length === 0 ? (
          <div className="text-center text-texto-3 py-16">
            <Icon nombre="sinProductos" tamano={48} className="mx-auto mb-3 text-texto-4" />
            <p className="font-medium">Todavía no hay acreedores</p>
            <p className="text-sm mt-1">Agrega un proveedor, servicio o persona a quien le debas</p>
          </div>
        ) : acreedoresFiltrados.length === 0 ? (
          <div className="text-center text-texto-3 py-12">
            <p className="font-medium">Nada en este filtro</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {acreedoresFiltrados.map(a => {
              const debe = a.saldo_usd > EPSILON_SALDO;

              return (
                <div
                  key={a.id}
                  className={`bg-tarjeta rounded-2xl border overflow-hidden ${a.vencido ? 'border-negativo-borde' : 'border-borde-tarjeta'}`}
                >
                  <button onClick={() => expandirAcreedor(a.id)} className="w-full flex items-center gap-3 p-3.5 text-left">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-semibold text-[15px] text-texto truncate">{a.nombre}</p>
                        <span className="flex-none h-5 px-1.5 inline-flex items-center rounded-full bg-tarjeta-hundida text-texto-3 text-[11px] font-semibold">
                          {labelTipo(a.tipo)}
                        </span>
                        {a.vencido && (
                          <span className="flex-none h-5 px-1.5 inline-flex items-center rounded-full bg-negativo-fondo text-negativo text-[11px] font-bold">
                            Vencido
                          </span>
                        )}
                      </div>
                      {(a.movimientos > 0 || a.proximo_vencimiento) && (
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                          {a.movimientos > 0 && (
                            <p className="text-xs text-texto-3">
                              {a.movimientos} {a.movimientos === 1 ? 'movimiento' : 'movimientos'}
                            </p>
                          )}
                          {a.proximo_vencimiento && (
                            <p className="flex items-center gap-1 text-xs text-texto-3">
                              <Icon nombre="calendario" tamano={TAMANO_ICONO.chip} />
                              Vence el {fmtVencimiento(a.proximo_vencimiento)}
                            </p>
                          )}
                        </div>
                      )}
                      {a.es_recurrente && a.dia_pago != null && (() => {
                        const { texto, destacar } = textoRecordatorio(a.dia_pago);
                        return (
                          <p className={`flex items-center gap-1 text-xs mt-0.5 ${destacar ? 'text-negativo font-semibold' : 'text-texto-3'}`}>
                            <Icon nombre="calendario" tamano={TAMANO_ICONO.chip} />
                            {texto}
                          </p>
                        );
                      })()}
                    </div>
                    <div className="text-right flex-shrink-0">
                      {debe ? (
                        <>
                          <p className="font-bold text-lg text-aviso tabular-nums">{formatUSD(a.saldo_usd)}</p>
                          {tasa > 0 && <p className="text-xs text-texto-2 tabular-nums">{formatBS(a.saldo_usd * tasa)}</p>}
                        </>
                      ) : (
                        <p className="font-medium text-texto-2">{a.movimientos === 0 ? 'Sin deudas' : 'Al día'}</p>
                      )}
                    </div>
                  </button>

                  {expandido === a.id && (
                    <div className="px-3.5 pb-3.5 border-t border-borde-divisor pt-3 flex flex-col gap-2.5">
                      {(() => {
                        const movimientos = detalleMovimientos[a.id] ?? [];
                        if (movimientos.length === 0) {
                          return (
                            <p className="text-xs text-texto-3 py-1">
                              {isOnline ? 'Todavía no hay movimientos' : 'Sin conexión — hace falta señal para ver el detalle'}
                            </p>
                          );
                        }
                        return (
                          <div className="flex flex-col gap-2">
                            {movimientos.map(m => {
                              const esDeuda = m.tipo === 'deuda';
                              const metodoLabel = m.metodo_pago
                                ? METODOS_PAGO.find(x => x.id === m.metodo_pago)?.label ?? m.metodo_pago
                                : null;
                              return (
                                <div key={m.id} className="bg-tarjeta-hundida rounded-[12px] p-3 flex flex-col gap-1.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <span
                                      className={`h-5 px-1.5 inline-flex items-center rounded-full text-[11px] font-bold whitespace-nowrap ${
                                        esDeuda ? 'bg-aviso-fondo text-aviso' : 'bg-marca-suave text-marca-suave-texto'
                                      }`}
                                    >
                                      {esDeuda ? 'Deuda' : 'Pago'}
                                    </span>
                                    <span className={`font-bold tabular-nums whitespace-nowrap ${esDeuda ? 'text-texto' : 'text-marca'}`}>
                                      {esDeuda ? '+' : '−'} {formatUSD(m.monto_usd)}
                                    </span>
                                  </div>
                                  <p className="text-xs text-texto-3">
                                    {fmtFechaRelativa(m.ocurrido_en)} · {fmtFechaExacta(m.ocurrido_en)}
                                    {m.sincronizado === false && ' · pendiente de subir'}
                                  </p>
                                  {!esDeuda && metodoLabel && (
                                    <span className="self-start h-6 px-2 inline-flex items-center gap-1.5 rounded-full bg-tarjeta text-texto-2 text-xs">
                                      {m.metodo_pago && <Icon nombre={ICONO_METODO_PAGO[m.metodo_pago]} tamano={12} />}
                                      {metodoLabel}
                                    </span>
                                  )}
                                  {esDeuda && m.vence_el && (
                                    <p className="flex items-center gap-1 text-xs text-texto-3">
                                      <Icon nombre="calendario" tamano={TAMANO_ICONO.chip} />
                                      Vence el {fmtVencimiento(m.vence_el)}
                                    </p>
                                  )}
                                  {m.nota && <p className="text-xs text-texto-2">{m.nota}</p>}
                                  {m.usuario_nombre && <p className="text-xs text-texto-4">Registrado por {m.usuario_nombre}</p>}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                      <div className="flex gap-2">
                        <Button variante="secundario" onClick={() => abrirRegistrarDeuda(a)} className="flex-1">
                          <Icon nombre="agregar" tamano={TAMANO_ICONO.secundario} />
                          Registrar deuda
                        </Button>
                        <Button variante="primario" disabled={!debe} onClick={() => abrirRegistrarPago(a)} className="flex-1">
                          <Icon nombre="confirmar" tamano={TAMANO_ICONO.secundario} />
                          Registrar pago
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Crear acreedor */}
      <BottomSheet abierto={creando} onCerrar={cerrarCrear} titulo="Nuevo acreedor">
        <div className="space-y-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-texto-3 mb-2">Nombre</p>
            <input
              type="text"
              value={nombreNuevo}
              onChange={e => { setNombreNuevo(e.target.value); setErrorNuevo(''); }}
              placeholder="Ej. Distribuidora La Central"
              className="w-full h-[52px] px-3.5 rounded-[12px] bg-tarjeta border border-borde-campo focus:outline-none focus:border-foco text-base text-texto"
              autoFocus
            />
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-texto-3 mb-2">Tipo</p>
            <div className="grid grid-cols-3 gap-2">
              {TIPOS.map(t => {
                const activo = tipoNuevo === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => { setTipoNuevo(t.id); setErrorNuevo(''); }}
                    className={`h-[52px] rounded-[12px] border flex items-center justify-center text-sm font-semibold ${
                      activo ? 'bg-marca-suave text-marca-suave-texto border-marca' : 'bg-tarjeta-hundida text-texto-2 border-borde-campo'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 min-h-[56px] px-3.5 py-3 rounded-[12px] bg-tarjeta border border-borde-campo">
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-texto">Se paga todos los meses</p>
              <p className="text-xs text-texto-3 mt-0.5">Caja te lo recuerda, pero no registra la deuda sola</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={recurrenteNuevo}
              onClick={() => { setRecurrenteNuevo(v => !v); setErrorNuevo(''); }}
              className={`relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 ${recurrenteNuevo ? 'bg-marca' : 'bg-tarjeta-hundida'}`}
            >
              <span className={`inline-block w-5 h-5 m-0.5 bg-white rounded-full shadow-sm transition-transform ${recurrenteNuevo ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>

          {recurrenteNuevo && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-texto-3 mb-2">Día del mes</p>
              <input
                type="number"
                min={1}
                max={31}
                value={diaPagoNuevo}
                onChange={e => { setDiaPagoNuevo(e.target.value); setErrorNuevo(''); }}
                placeholder="Ej. 25"
                className="w-full h-[52px] px-3.5 rounded-[12px] bg-tarjeta border border-borde-campo focus:outline-none focus:border-foco text-base text-texto"
              />
            </div>
          )}

          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-texto-3 mb-2">Nota (opcional)</p>
            <input
              type="text"
              value={notaNuevo}
              onChange={e => setNotaNuevo(e.target.value)}
              placeholder="Ej. Pago los días 15 y 30"
              className="w-full h-[52px] px-3.5 rounded-[12px] bg-tarjeta border border-borde-campo focus:outline-none focus:border-foco text-base text-texto"
            />
          </div>

          {errorNuevo && <p className="text-sm text-negativo">{errorNuevo}</p>}

          <Button variante="primario" disabled={guardando} onClick={confirmarCrear} className="w-full">
            {guardando ? 'Guardando...' : 'Agregar acreedor'}
          </Button>
        </div>
      </BottomSheet>

      {/* Registrar deuda */}
      <BottomSheet
        abierto={!!registrandoDeuda}
        onCerrar={cerrarRegistrarDeuda}
        titulo={registrandoDeuda ? `Deuda — ${registrandoDeuda.nombre}` : undefined}
      >
        {registrandoDeuda && (
          <div className="space-y-5">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-texto-3 mb-2">Moneda</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => { setMonedaDeuda('usd'); setErrorDeuda(''); }}
                  className={`h-[52px] rounded-[12px] border flex items-center justify-center text-sm font-semibold ${
                    montoDeudaEsUsd ? 'bg-marca-suave text-marca-suave-texto border-marca' : 'bg-tarjeta-hundida text-texto-2 border-borde-campo'
                  }`}
                >
                  USD
                </button>
                <button
                  type="button"
                  onClick={() => { setMonedaDeuda('bs'); setErrorDeuda(''); }}
                  className={`h-[52px] rounded-[12px] border flex items-center justify-center text-sm font-semibold ${
                    !montoDeudaEsUsd ? 'bg-marca-suave text-marca-suave-texto border-marca' : 'bg-tarjeta-hundida text-texto-2 border-borde-campo'
                  }`}
                >
                  Bs
                </button>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-texto-3 mb-2">
                Monto ({montoDeudaEsUsd ? 'USD' : 'Bs'})
              </p>
              <div className="flex items-center gap-2 h-[52px] px-3.5 rounded-[12px] bg-tarjeta border border-borde-campo focus-within:border-foco">
                <span className="text-texto-3 font-medium">{montoDeudaEsUsd ? '$' : 'Bs'}</span>
                <input
                  type="number"
                  step="0.01"
                  value={montoDeuda}
                  onChange={e => { setMontoDeuda(e.target.value); setErrorDeuda(''); }}
                  className="flex-1 min-w-0 bg-transparent outline-none text-lg font-bold text-texto tabular-nums"
                  placeholder="0.00"
                  autoFocus
                />
              </div>
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-texto-3 mb-2">Vence el (opcional)</p>
              <input
                type="date"
                value={venceElDeuda}
                onChange={e => setVenceElDeuda(e.target.value)}
                className="w-full h-[52px] px-3.5 rounded-[12px] bg-tarjeta border border-borde-campo focus:outline-none focus:border-foco text-base text-texto"
              />
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-texto-3 mb-2">Nota (opcional)</p>
              <input
                type="text"
                value={notaDeuda}
                onChange={e => setNotaDeuda(e.target.value)}
                placeholder="Ej. Factura #4521"
                className="w-full h-[52px] px-3.5 rounded-[12px] bg-tarjeta border border-borde-campo focus:outline-none focus:border-foco text-base text-texto"
              />
            </div>

            {montoDeudaNum > 0 && (
              <div className="p-3 rounded-[12px] bg-tarjeta-hundida flex items-center justify-between text-sm">
                <span className="text-texto-3">Quedará debiendo</span>
                <span className="font-semibold tabular-nums text-aviso">{formatUSD(totalDespuesDeuda ?? 0)}</span>
              </div>
            )}

            {errorDeuda && <p className="text-sm text-negativo">{errorDeuda}</p>}

            <Button
              variante="primario"
              disabled={guardandoDeuda || !montoDeuda.trim() || montoDeudaNum <= 0}
              onClick={confirmarDeuda}
              className="w-full"
            >
              {guardandoDeuda ? 'Guardando...' : 'Registrar deuda'}
            </Button>
          </div>
        )}
      </BottomSheet>

      {/* Registrar pago */}
      <BottomSheet
        abierto={!!pagando}
        onCerrar={cerrarRegistrarPago}
        titulo={pagando ? `Pago — ${pagando.nombre}` : undefined}
      >
        {pagando && (
          <div className="space-y-5">
            <div className="p-4 rounded-2xl bg-tinta text-center">
              <p className="text-[11px] font-bold uppercase tracking-wide text-tinta-etiqueta">Debe</p>
              <p className="mt-1 text-2xl font-extrabold text-tinta-texto tabular-nums">{formatUSD(pagando.saldo_usd)}</p>
              {tasa > 0 && (
                <p className="mt-0.5 text-tinta-etiqueta text-sm tabular-nums">{formatBS(pagando.saldo_usd * tasa)}</p>
              )}
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-texto-3 mb-2">Método del pago</p>
              <div className="grid grid-cols-2 gap-2">
                {METODOS_ABONO.map(m => {
                  const activo = metodoPago === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => { setMetodoPago(m.id); setMontoPago(''); setErrorPago(''); }}
                      className={`h-[52px] rounded-[12px] border flex items-center justify-center gap-2 text-sm font-semibold ${
                        activo ? 'bg-marca-suave text-marca-suave-texto border-marca' : 'bg-tarjeta-hundida text-texto-2 border-borde-campo'
                      }`}
                    >
                      <Icon nombre={ICONO_METODO_PAGO[m.id]} tamano={TAMANO_ICONO.secundario} />
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {metodoPago && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-texto-3 mb-2">
                  Monto a pagar ({pagoEsUsd ? 'USD' : 'Bs'})
                </p>
                <div className="flex items-center gap-2">
                  <div
                    className={`flex-1 min-w-0 flex items-center gap-2 h-[52px] px-3.5 rounded-[12px] bg-tarjeta border ${
                      excedeDeudaPago ? 'border-negativo' : 'border-borde-campo focus-within:border-foco'
                    }`}
                  >
                    <span className="text-texto-3 font-medium">{pagoEsUsd ? '$' : 'Bs'}</span>
                    <input
                      type="number"
                      step="0.01"
                      value={montoPago}
                      onChange={e => { setMontoPago(e.target.value); setErrorPago(''); }}
                      className="flex-1 min-w-0 bg-transparent outline-none text-lg font-bold text-texto tabular-nums"
                      placeholder="0.00"
                      autoFocus
                    />
                  </div>
                  {muestraTodoPago && (
                    <button
                      type="button"
                      onClick={montoTodoPago}
                      className="flex-none h-[52px] px-4 rounded-[12px] bg-tarjeta-hundida text-texto-2 font-bold text-sm"
                    >
                      Todo
                    </button>
                  )}
                </div>
              </div>
            )}

            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-texto-3 mb-2">Nota (opcional)</p>
              <input
                type="text"
                value={notaPago}
                onChange={e => setNotaPago(e.target.value)}
                className="w-full h-[52px] px-3.5 rounded-[12px] bg-tarjeta border border-borde-campo focus:outline-none focus:border-foco text-base text-texto"
              />
            </div>

            {montoPagoNum > 0 && (
              <div className="p-3 rounded-[12px] bg-tarjeta-hundida flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-texto-3">Pago en $</span>
                  <span className={`font-semibold tabular-nums ${excedeDeudaPago ? 'text-negativo' : 'text-texto'}`}>
                    {formatUSD(montoPagoUsd)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-texto-3">Queda debiendo</span>
                  <span className={`font-semibold tabular-nums ${quedaEnCeroPago ? 'text-marca' : 'text-aviso'}`}>
                    {quedaEnCeroPago ? 'Queda al día' : formatUSD(Math.max(0, restanteDespuesPago ?? 0))}
                  </span>
                </div>
                {excedeDeudaPago && (
                  <p className="text-xs font-semibold text-negativo pt-1">
                    El monto supera lo que debe — no se puede confirmar
                  </p>
                )}
              </div>
            )}

            {errorPago && <p className="text-sm text-negativo">{errorPago}</p>}

            <Button
              variante="primario"
              disabled={guardandoPago || !metodoPago || !montoPago.trim() || montoPagoNum <= 0 || excedeDeudaPago}
              onClick={confirmarPago}
              className="w-full"
            >
              {textoConfirmarPago}
            </Button>
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
