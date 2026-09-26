'use client';

import { useState, useEffect } from 'react';
import { ClienteFiado, MovimientoFiado, MetodoAbono, ResumenClienteFiado } from '@/types';
import { getClientesFiado, actualizarSaldoFiadoLocal, saveMovimientoFiado, getMovimientosFiadoPorCliente, getResumenFiado } from '@/lib/db';
import { getMovimientosFiadoPorClienteRemoto } from '@/lib/sync';
import { encolarAplicarMovimientoFiado, onFalloPermanente } from '@/lib/outbox';
import { formatBS, formatUSD } from '@/lib/precio';
import { METODOS_PAGO } from '@/lib/metodos';
import { useApp } from '@/components/Providers';
import { useGuardarRuta } from '@/lib/useGuardarRuta';
import ThemeToggle from '@/components/ThemeToggle';
import Button from '@/components/ui/Button';
import BottomSheet from '@/components/ui/BottomSheet';
import Icon from '@/components/ui/Icon';
import { ICONO_METODO_PAGO, TAMANO_ICONO } from '@/components/ui/iconos';

// Un abono nunca es 'fiado' — no tiene sentido pagar una deuda de fiado
// con más fiado (mismo check que ya existe en Supabase).
const METODOS_ABONO = METODOS_PAGO.filter(
  (m): m is { id: MetodoAbono; label: string } => m.id !== 'fiado'
);

function formatearNombre(nombre: string): string {
  return nombre
    .toLowerCase()
    .split(' ')
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

// Identidad visual por cliente (avatar), no semántica del sistema de
// diseño — por eso esta paleta va con colores crudos a propósito, a
// diferencia del resto del archivo. Mismo criterio que el mockup:
// nombre.charCodeAt(0) % 8, para que cada cliente tenga siempre el mismo
// color sin tener que guardarlo en ningún lado.
const COLORES_AVATAR = ['#8B5CF6', '#3B82F6', '#06B6D4', '#14B8A6', '#10B981', '#F59E0B', '#F97316', '#EC4899'];
function colorAvatar(nombre: string): string {
  return COLORES_AVATAR[nombre.charCodeAt(0) % COLORES_AVATAR.length];
}

// Relativa ("hace 38 d" / "hace 2 m") + exacta (día y mes corto) — en una
// deuda importa saber cuándo fue, no solo "hace un rato".
function fmtFechaRelativa(iso: string): string {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
  if (dias <= 0) return 'hoy';
  if (dias < 30) return `hace ${dias} d`;
  return `hace ${Math.floor(dias / 30)} m`;
}

function fmtFechaExacta(iso: string): string {
  return new Date(iso).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' });
}

// detalleItems llega como texto plano separado por coma, con la cantidad
// adelante ("240g Cebolla, 1× Ace las llaves económico 900g"). Se parte por
// un lookahead sobre el token de cantidad (no por cualquier coma) para no
// romper nombres de producto que también tengan comas.
function splitItems(detalle: string): string[] {
  return detalle.split(/,\s+(?=\d+(?:\s*×|\s*g)\s)/);
}

// Separa la cantidad del nombre dentro de un ítem ya partido, para pintarlas
// en dos tonos distintos — null si el ítem no matchea el formato esperado
// (se pinta tal cual, sin partir).
function partirCantidad(item: string): { cantidad: string; nombre: string } | null {
  const m = item.match(/^(\d+(?:\s*×|\s*g))\s+(.*)$/);
  return m ? { cantidad: m[1], nombre: m[2] } : null;
}

// Saldos que quedaron en centavos de nada por redondeo no cuentan como
// deuda real — mismo margen que el resto de la app usa para "completo".
const EPSILON_SALDO = 0.005;

// El flag "vencido" que devuelve fiado_clientes_listar (RPC) se congela en
// el momento del sync — si el equipo pasa varios días sin señal, un cliente
// puede cruzar los 30 días y el flag viejo seguiría diciendo que no.
// Calculándolo acá, a partir de la fecha del último movimiento, envejece
// bien sin conexión.
const DIAS_VENCIDO = 30;
function estaVencido(saldoUsd: number, ultimoMovimientoEn: string | null): boolean {
  return (
    saldoUsd > EPSILON_SALDO &&
    ultimoMovimientoEn !== null &&
    Date.now() - new Date(ultimoMovimientoEn).getTime() > DIAS_VENCIDO * 24 * 60 * 60 * 1000
  );
}

export default function FiadoPage() {
  const permitida = useGuardarRuta();
  const { tasa, isOnline, negocioId, user, userNombre, productosVersion } = useApp();

  const [clientes, setClientes] = useState<ClienteFiado[]>([]);
  // Conteo de movimientos + fecha del último, por cliente_id — decorativo
  // (ver ResumenClienteFiado): si falta para algún cliente (primer arranque,
  // sync que falló), esa tarjeta simplemente no muestra conteo ni "Vencido",
  // el saldo sigue viniendo de `clientes` sin depender de esto.
  const [resumen, setResumen] = useState<Record<string, ResumenClienteFiado>>({});
  const [cargando, setCargando] = useState(true);
  const [chip, setChip] = useState<'todos' | 'deuda' | 'aldia'>('todos');
  const [expandido, setExpandido] = useState<string | null>(null);
  const [detalleMovimientos, setDetalleMovimientos] = useState<Record<string, MovimientoFiado[]>>({});

  const [abonando, setAbonando] = useState<ClienteFiado | null>(null);
  const [metodoAbono, setMetodoAbono] = useState<MetodoAbono | null>(null);
  const [montoAbono, setMontoAbono] = useState('');
  const [guardandoAbono, setGuardandoAbono] = useState(false);
  const [errorAbono, setErrorAbono] = useState('');
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  // clientes_fiado viaja en el mismo sync periódico que productos (ver
  // syncFromSupabase), así que se relee de IndexedDB con el mismo
  // disparador — funciona sin conexión: el saldo mostrado es el último que
  // se pudo sincronizar. El resumen (fiado_resumen) viaja en ese mismo sync,
  // se relee junto con los clientes.
  useEffect(() => {
    let cancelado = false;
    Promise.all([getClientesFiado(), getResumenFiado()]).then(([cs, rs]) => {
      if (cancelado) return;
      setClientes(cs);
      setResumen(Object.fromEntries(rs.map(r => [r.cliente_id, r])));
      setCargando(false);
    });
    return () => { cancelado = true; };
  }, [productosVersion]);

  // Si la cola rechazó de forma definitiva un movimiento de este cliente, ya
  // corrigió el saldo en IndexedDB de inmediato (ver outbox.ts) — sin esto,
  // esta pantalla seguiría mostrando el saldo optimista viejo hasta el
  // próximo sync periódico.
  useEffect(() => onFalloPermanente(() => {
    getClientesFiado().then(cs => setClientes(cs));
  }), []);

  // Recién ahora, con todos los hooks ya llamados, se puede cortar el
  // render sin violar el orden de hooks — evita el frame de contenido
  // indebido antes de que useGuardarRuta redirija.
  if (!permitida) return null;

  const conDeuda = clientes.filter(c => c.saldo_usd > EPSILON_SALDO);
  const alDia = clientes.filter(c => c.saldo_usd <= EPSILON_SALDO);
  const vencidos = conDeuda.filter(c => estaVencido(c.saldo_usd, resumen[c.id]?.ultimo_movimiento_en ?? null));

  const totalDeudaUsd = conDeuda.reduce((s, c) => s + c.saldo_usd, 0);
  const totalDeudaBs = tasa > 0 ? totalDeudaUsd * tasa : 0;
  const montoVencidoUsd = vencidos.reduce((s, c) => s + c.saldo_usd, 0);

  const clientesFiltrados = clientes
    .filter(c => (chip === 'todos' ? true : chip === 'deuda' ? c.saldo_usd > EPSILON_SALDO : c.saldo_usd <= EPSILON_SALDO))
    .sort((a, b) => b.saldo_usd - a.saldo_usd || a.nombre.localeCompare(b.nombre, 'es'));

  // Detalle "qué llevó y cuándo" bajo demanda — no se sincroniza
  // periódicamente como el saldo, se pide al expandir la tarjeta. Sin red
  // se muestra lo último que haya quedado cacheado en este dispositivo (o
  // nada, la primera vez), sin bloquear el resto de la pantalla.
  const expandirCliente = async (clienteId: string) => {
    setExpandido(prev => (prev === clienteId ? null : clienteId));
    const local = await getMovimientosFiadoPorCliente(clienteId);
    setDetalleMovimientos(prev => ({ ...prev, [clienteId]: local }));
    if (isOnline) {
      const remotos = await getMovimientosFiadoPorClienteRemoto(clienteId, 10);
      if (remotos) {
        await Promise.all(remotos.map(m => saveMovimientoFiado(m)));
        setDetalleMovimientos(prev => ({ ...prev, [clienteId]: remotos }));
      }
    }
  };

  const abrirAbonar = (cliente: ClienteFiado) => {
    setAbonando(cliente);
    setMetodoAbono(null);
    setMontoAbono('');
    setErrorAbono('');
  };

  const cerrarAbonar = () => {
    setAbonando(null);
    setMetodoAbono(null);
    setMontoAbono('');
    setErrorAbono('');
  };

  const abonoEsUsd = metodoAbono === 'efectivo_usd';
  const montoAbonoNum = parseFloat(montoAbono);
  // El monto real es el que entregó el cliente, en la moneda del método
  // elegido — el equivalente en la otra moneda se calcula una sola vez, con
  // la tasa de este instante, y se guarda tal cual (nunca se deriva de otro
  // monto después).
  const montoAbonoUsd = abonando && montoAbonoNum > 0
    ? (abonoEsUsd ? montoAbonoNum : (tasa > 0 ? montoAbonoNum / tasa : 0))
    : 0;
  const montoAbonoBsCalculado = abonando && montoAbonoNum > 0
    ? (abonoEsUsd ? (tasa > 0 ? montoAbonoNum * tasa : 0) : montoAbonoNum)
    : 0;
  const restanteDespues = abonando && montoAbonoNum > 0 ? abonando.saldo_usd - montoAbonoUsd : null;
  const excedeDeuda = abonando !== null && montoAbonoNum > 0 && montoAbonoUsd > abonando.saldo_usd + EPSILON_SALDO;

  // Rellena el monto con la deuda completa, convertida a la moneda del
  // método elegido — el botón píldora "Todo" del campo de monto.
  const montoTodo = () => {
    if (!abonando || !metodoAbono) return;
    const v = abonoEsUsd ? abonando.saldo_usd : abonando.saldo_usd * tasa;
    setMontoAbono(v.toFixed(2));
  };

  const confirmarAbono = async () => {
    if (!abonando || !negocioId) return;
    if (!metodoAbono) {
      setErrorAbono('Elige un método de pago');
      return;
    }
    if (!montoAbono.trim() || isNaN(montoAbonoNum) || montoAbonoNum <= 0) {
      setErrorAbono('Ingresa un monto válido');
      return;
    }
    if (excedeDeuda) {
      setErrorAbono(`No puede superar la deuda: ${formatUSD(abonando.saldo_usd)}`);
      return;
    }

    setGuardandoAbono(true);
    const now = new Date().toISOString();
    const movimiento: MovimientoFiado = {
      id: crypto.randomUUID(),
      cliente_id: abonando.id,
      tipo: 'abono',
      monto_usd: montoAbonoUsd,
      monto_bs: montoAbonoBsCalculado,
      tasa_usada: tasa,
      metodoPago: metodoAbono,
      usuario_id: user?.id,
      usuario_nombre: userNombre || undefined,
      ocurrido_en: now,
      sincronizado: false,
    };

    // Offline-first: el abono ya ocurrió en la realidad (el cliente entregó
    // el dinero) — se aplica local de inmediato y nunca se revierte solo
    // porque falle la red en este instante; se sincroniza por su cuenta vía
    // la RPC atómica e idempotente.
    await saveMovimientoFiado(movimiento);
    const nuevoSaldo = Math.max(0, abonando.saldo_usd - movimiento.monto_usd);
    await actualizarSaldoFiadoLocal(abonando.id, nuevoSaldo);
    setClientes(prev => prev.map(c => (c.id === abonando.id ? { ...c, saldo_usd: nuevoSaldo } : c)));
    await encolarAplicarMovimientoFiado(movimiento.id, negocioId);

    setGuardandoAbono(false);
    cerrarAbonar();
    showToast('Abono registrado');
  };

  const quedaEnCero = Math.max(0, restanteDespues ?? 0) <= EPSILON_SALDO;
  const muestraTodo = metodoAbono !== null && (abonoEsUsd || tasa > 0);

  const textoConfirmar = guardandoAbono
    ? 'Guardando...'
    : !metodoAbono
    ? 'Elige el método del abono'
    : !montoAbono.trim() || montoAbonoNum <= 0
    ? 'Ingresa el monto'
    : 'Confirmar abono';

  return (
    <div>
      <header className="bg-superficie-barra border-b border-borde-divisor px-4 pt-3.5 pb-3 flex items-center gap-2.5">
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-texto truncate">Fiado</h1>
          <p className="text-[11px] font-medium text-texto-3 truncate">
            {clientes.length} clientes · {conDeuda.length} con deuda
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

      {/* pb-1 + overflow visible: mismo arreglo que Inventario para que la
          barra de scroll del navegador no pise los chips */}
      <div className="px-4 pt-3 pb-4 bg-superficie-barra border-b border-borde-divisor">
        <div className="flex gap-2 -mx-4 px-4 pb-1 overflow-x-auto">
          {[
            { id: 'todos' as const, label: 'Todos', cuenta: clientes.length },
            { id: 'deuda' as const, label: 'Con deuda', cuenta: conDeuda.length },
            { id: 'aldia' as const, label: 'Al día', cuenta: alDia.length },
          ].map(c => {
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
        <div className="p-5 rounded-2xl bg-tinta">
          <p className="text-[11px] font-bold uppercase tracking-wide text-tinta-etiqueta">Total por cobrar</p>
          <p className="mt-1.5 text-4xl font-extrabold text-tinta-texto tracking-tight tabular-nums">
            {formatUSD(totalDeudaUsd)}
          </p>
          <p className="mt-1 text-tinta-etiqueta tabular-nums">
            {formatBS(totalDeudaBs)} · {conDeuda.length} {conDeuda.length === 1 ? 'cliente debe' : 'clientes deben'}
          </p>
          {vencidos.length > 0 && (
            <>
              <div className="h-px bg-[rgba(255,255,255,0.14)] my-3" />
              <div className="flex items-center gap-2 flex-wrap">
                <span className="h-6 px-2.5 inline-flex items-center rounded-full bg-negativo-fondo text-negativo text-[11px] font-bold whitespace-nowrap">
                  {vencidos.length} {vencidos.length === 1 ? 'vencido' : 'vencidos'}
                </span>
                <span className="text-tinta-etiqueta text-sm">{formatUSD(montoVencidoUsd)} con más de 30 días</span>
              </div>
            </>
          )}
        </div>

        {cargando ? (
          <div className="text-center text-texto-3 py-16">
            <svg className="w-8 h-8 mx-auto mb-3 text-marca animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : clientes.length === 0 ? (
          <div className="text-center text-texto-3 py-16">
            <Icon nombre="fiado" tamano={48} className="mx-auto mb-3 text-texto-4" />
            <p className="font-medium">Todavía no hay clientes de fiado</p>
            <p className="text-sm mt-1">Se crean solos al cobrar una venta como fiado, desde Caja</p>
          </div>
        ) : clientesFiltrados.length === 0 ? (
          <div className="text-center text-texto-3 py-12">
            <p className="font-medium">{chip === 'deuda' ? 'Nadie debe por ahora' : 'Ningún cliente está al día todavía'}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {clientesFiltrados.map(c => {
              const debe = c.saldo_usd > EPSILON_SALDO;
              const resumenC = resumen[c.id];
              const vencido = estaVencido(c.saldo_usd, resumenC?.ultimo_movimiento_en ?? null);
              const nombreFormateado = formatearNombre(c.nombre);

              return (
                <div
                  key={c.id}
                  className={`bg-tarjeta rounded-2xl border overflow-hidden ${vencido ? 'border-negativo-borde' : 'border-borde-tarjeta'}`}
                >
                  <button onClick={() => expandirCliente(c.id)} className="w-full flex items-center gap-3 p-3 text-left">
                    <div
                      className="flex-none w-10 h-10 rounded-full flex items-center justify-center text-texto-invertido font-bold text-base"
                      style={{ backgroundColor: colorAvatar(c.nombre) }}
                    >
                      {nombreFormateado.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="font-semibold text-[15px] text-texto truncate">{nombreFormateado}</p>
                        {vencido && (
                          <span className="flex-none h-5 px-1.5 inline-flex items-center rounded-full bg-negativo-fondo text-negativo text-[11px] font-bold">
                            Vencido
                          </span>
                        )}
                      </div>
                      {resumenC && (
                        <p className="text-xs text-texto-3 mt-0.5">
                          {resumenC.movimientos} {resumenC.movimientos === 1 ? 'movimiento' : 'movimientos'}
                        </p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      {debe ? (
                        <>
                          <p className="font-bold text-lg text-aviso tabular-nums">{formatUSD(c.saldo_usd)}</p>
                          {tasa > 0 && <p className="text-xs text-texto-2 tabular-nums">{formatBS(c.saldo_usd * tasa)}</p>}
                        </>
                      ) : (
                        <p className="font-medium text-texto-2">Al día</p>
                      )}
                    </div>
                  </button>

                  {expandido === c.id && (
                    <div className="px-3 pb-3 border-t border-borde-divisor pt-3 flex flex-col gap-2.5">
                      {(() => {
                        const movimientos = detalleMovimientos[c.id] ?? [];
                        if (movimientos.length === 0) {
                          return (
                            <p className="text-xs text-texto-3 py-1">
                              {isOnline ? 'Sin detalle disponible' : 'Sin conexión — hace falta señal para ver el detalle'}
                            </p>
                          );
                        }
                        // El arreglo viene de más reciente a más antiguo. El
                        // primer saldo_resultante ~0 que aparece marca dónde
                        // terminó el ciclo de deuda anterior — ese movimiento
                        // y todos los que le siguen (más antiguos) ya están
                        // saldados y se muestran tachados/atenuados. Si nunca
                        // llegó a cero (o quedó fuera de la ventana traída),
                        // no se tacha nada. Se calcula una sola vez, no por
                        // fila.
                        const indiceSaldado = movimientos.findIndex(
                          m => m.saldo_resultante !== undefined && Math.abs(m.saldo_resultante) < EPSILON_SALDO
                        );
                        return (
                          <div className="flex flex-col gap-2">
                            {movimientos.map((m, i) => {
                              const saldado = indiceSaldado !== -1 && i >= indiceSaldado;
                              const esCargo = m.tipo === 'cargo';
                              const items = esCargo && m.detalleItems ? splitItems(m.detalleItems) : [];
                              const metodoLabel = m.metodoPago
                                ? METODOS_PAGO.find(x => x.id === m.metodoPago)?.label ?? m.metodoPago
                                : null;
                              return (
                                <div key={m.id} className={`bg-tarjeta-hundida rounded-[12px] p-3 flex flex-col gap-1.5 ${saldado ? 'opacity-55' : ''}`}>
                                  <div className="flex items-center justify-between gap-2">
                                    <span
                                      className={`h-5 px-1.5 inline-flex items-center rounded-full text-[11px] font-bold whitespace-nowrap ${
                                        esCargo ? 'bg-aviso-fondo text-aviso' : 'bg-marca-suave text-marca-suave-texto'
                                      }`}
                                    >
                                      {esCargo ? 'Cargo' : 'Abono'}
                                    </span>
                                    <span
                                      className={`font-bold tabular-nums whitespace-nowrap ${
                                        saldado ? 'line-through text-texto-4' : esCargo ? 'text-texto' : 'text-marca'
                                      }`}
                                    >
                                      {esCargo ? '+' : '−'} {formatUSD(m.monto_usd)}
                                    </span>
                                  </div>
                                  <p className="text-xs text-texto-3">
                                    {fmtFechaRelativa(m.ocurrido_en)} · {fmtFechaExacta(m.ocurrido_en)}
                                  </p>
                                  {items.length > 0 && (
                                    <div className="flex flex-col gap-0.5 mt-0.5">
                                      {items.map((item, idx) => {
                                        const partido = partirCantidad(item);
                                        return (
                                          <p key={idx} className="text-xs">
                                            {partido ? (
                                              <>
                                                <span className="text-texto-3">{partido.cantidad}</span>{' '}
                                                <span className="text-texto-2">{partido.nombre}</span>
                                              </>
                                            ) : (
                                              <span className="text-texto-2">{item}</span>
                                            )}
                                          </p>
                                        );
                                      })}
                                    </div>
                                  )}
                                  {!esCargo && metodoLabel && (
                                    <span className="self-start h-6 px-2 inline-flex items-center gap-1.5 rounded-full bg-tarjeta text-texto-2 text-xs">
                                      {m.metodoPago && <Icon nombre={ICONO_METODO_PAGO[m.metodoPago]} tamano={12} />}
                                      {metodoLabel}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                      <Button variante="primario" onClick={() => abrirAbonar(c)} className="w-full">
                        <Icon nombre="confirmar" tamano={TAMANO_ICONO.secundario} />
                        Registrar abono
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Registrar abono */}
      <BottomSheet
        abierto={!!abonando}
        onCerrar={() => !guardandoAbono && cerrarAbonar()}
        titulo={abonando ? formatearNombre(abonando.nombre) : undefined}
      >
        {abonando && (
          <div className="space-y-5">
            <div className="p-4 rounded-2xl bg-tinta text-center">
              <p className="text-[11px] font-bold uppercase tracking-wide text-tinta-etiqueta">Debe</p>
              <p className="mt-1 text-2xl font-extrabold text-tinta-texto tabular-nums">{formatUSD(abonando.saldo_usd)}</p>
              {tasa > 0 && (
                <p className="mt-0.5 text-tinta-etiqueta text-sm tabular-nums">{formatBS(abonando.saldo_usd * tasa)}</p>
              )}
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-texto-3 mb-2">Método del abono</p>
              <div className="grid grid-cols-2 gap-2">
                {METODOS_ABONO.map(m => {
                  const activo = metodoAbono === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => { setMetodoAbono(m.id); setMontoAbono(''); setErrorAbono(''); }}
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

            {metodoAbono && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-texto-3 mb-2">
                  Monto recibido ({abonoEsUsd ? 'USD' : 'Bs'})
                </p>
                <div className="flex items-center gap-2">
                  <div
                    className={`flex-1 flex items-center gap-2 h-[52px] px-3.5 rounded-[12px] bg-tarjeta border ${
                      excedeDeuda ? 'border-negativo' : 'border-borde-campo focus-within:border-foco'
                    }`}
                  >
                    <span className="text-texto-3 font-medium">{abonoEsUsd ? '$' : 'Bs'}</span>
                    <input
                      type="number"
                      step="0.01"
                      value={montoAbono}
                      onChange={e => { setMontoAbono(e.target.value); setErrorAbono(''); }}
                      className="flex-1 min-w-0 bg-transparent outline-none text-lg font-bold text-texto tabular-nums"
                      placeholder="0.00"
                      autoFocus
                    />
                  </div>
                  {muestraTodo && (
                    <button
                      type="button"
                      onClick={montoTodo}
                      className="flex-none h-[52px] px-4 rounded-[12px] bg-tarjeta-hundida text-texto-2 font-bold text-sm"
                    >
                      Todo
                    </button>
                  )}
                </div>
              </div>
            )}

            {montoAbonoNum > 0 && (
              <div className="p-3 rounded-[12px] bg-tarjeta-hundida flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-texto-3">Abono en $</span>
                  <span className={`font-semibold tabular-nums ${excedeDeuda ? 'text-negativo' : 'text-texto'}`}>
                    {formatUSD(montoAbonoUsd)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-texto-3">Queda debiendo</span>
                  <span className={`font-semibold tabular-nums ${quedaEnCero ? 'text-marca' : 'text-aviso'}`}>
                    {formatUSD(Math.max(0, restanteDespues ?? 0))}
                  </span>
                </div>
                {excedeDeuda && (
                  <p className="text-xs font-semibold text-negativo pt-1">
                    El monto supera lo que debe — no se puede confirmar
                  </p>
                )}
              </div>
            )}

            {errorAbono && <p className="text-sm text-negativo">{errorAbono}</p>}

            <Button
              variante="primario"
              disabled={guardandoAbono || !metodoAbono || !montoAbono.trim() || montoAbonoNum <= 0 || excedeDeuda}
              onClick={confirmarAbono}
              className="w-full"
            >
              {textoConfirmar}
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
