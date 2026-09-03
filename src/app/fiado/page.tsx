'use client';

import { useState, useEffect } from 'react';
import { ClienteFiado, MovimientoFiado } from '@/types';
import { getClientesFiado, actualizarSaldoFiadoLocal, saveMovimientoFiado, getMovimientosFiadoPorCliente } from '@/lib/db';
import { getMovimientosFiadoPorClienteRemoto } from '@/lib/sync';
import { encolarAplicarMovimientoFiado } from '@/lib/outbox';
import { formatBS, formatUSD } from '@/lib/precio';
import { useApp } from '@/components/Providers';
import { useGuardarRuta } from '@/lib/useGuardarRuta';
import ThemeToggle from '@/components/ThemeToggle';

function formatearNombre(nombre: string): string {
  return nombre
    .toLowerCase()
    .split(' ')
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

function fmtFecha(iso: string) {
  return new Date(iso).toLocaleDateString('es-VE', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

// Saldos que quedaron en centavos de nada por redondeo no cuentan como
// deuda real — mismo margen que el resto de la app usa para "completo".
const EPSILON_SALDO = 0.005;

export default function FiadoPage() {
  useGuardarRuta();
  const { tasa, isOnline, negocioId, user, userNombre, productosVersion } = useApp();

  const [clientes, setClientes] = useState<ClienteFiado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [detalleCargos, setDetalleCargos] = useState<Record<string, MovimientoFiado[]>>({});

  const [abonando, setAbonando] = useState<ClienteFiado | null>(null);
  const [montoAbonoBs, setMontoAbonoBs] = useState('');
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
  // se pudo sincronizar.
  useEffect(() => {
    let cancelado = false;
    getClientesFiado().then(cs => {
      if (cancelado) return;
      setClientes(cs);
      setCargando(false);
    });
    return () => { cancelado = true; };
  }, [productosVersion]);

  const deudores = clientes
    .filter(c => c.saldo_usd > EPSILON_SALDO)
    .sort((a, b) => b.saldo_usd - a.saldo_usd);

  const totalDeudaUsd = deudores.reduce((s, c) => s + c.saldo_usd, 0);
  const totalDeudaBs = tasa > 0 ? totalDeudaUsd * tasa : 0;

  // Detalle "qué llevó y cuándo" bajo demanda — no se sincroniza
  // periódicamente como el saldo, se pide al expandir la tarjeta. Sin red
  // se muestra lo último que haya quedado cacheado en este dispositivo (o
  // nada, la primera vez), sin bloquear el resto de la pantalla.
  const expandirCliente = async (clienteId: string) => {
    setExpandido(prev => (prev === clienteId ? null : clienteId));
    const local = await getMovimientosFiadoPorCliente(clienteId);
    setDetalleCargos(prev => ({ ...prev, [clienteId]: local.filter(m => m.tipo === 'cargo') }));
    if (isOnline) {
      const remotos = await getMovimientosFiadoPorClienteRemoto(clienteId, 10);
      if (remotos) {
        await Promise.all(remotos.map(m => saveMovimientoFiado(m)));
        setDetalleCargos(prev => ({ ...prev, [clienteId]: remotos.filter(m => m.tipo === 'cargo') }));
      }
    }
  };

  const abrirAbonar = (cliente: ClienteFiado) => {
    setAbonando(cliente);
    setMontoAbonoBs('');
    setErrorAbono('');
  };

  const cerrarAbonar = () => {
    setAbonando(null);
    setMontoAbonoBs('');
    setErrorAbono('');
  };

  const montoAbonoNum = parseFloat(montoAbonoBs);
  const montoAbonoUsd = abonando && montoAbonoNum > 0 && tasa > 0 ? montoAbonoNum / tasa : 0;
  const restanteDespues = abonando && montoAbonoNum > 0 ? abonando.saldo_usd - montoAbonoUsd : null;
  const excedeDeuda = abonando !== null && montoAbonoNum > 0 && montoAbonoUsd > abonando.saldo_usd + EPSILON_SALDO;

  const confirmarAbono = async () => {
    if (!abonando || !negocioId) return;
    if (!montoAbonoBs.trim() || isNaN(montoAbonoNum) || montoAbonoNum <= 0) {
      setErrorAbono('Ingresa un monto válido');
      return;
    }
    if (excedeDeuda) {
      setErrorAbono(`No puede superar la deuda: ${formatUSD(abonando.saldo_usd)}`);
      return;
    }

    setGuardandoAbono(true);
    const now = new Date().toISOString();
    // El monto real es el que entregó el cliente, en bolívares — el
    // equivalente en $ se calcula una sola vez, con la tasa de este
    // instante, y se guarda tal cual (nunca se deriva de otro monto).
    const movimiento: MovimientoFiado = {
      id: crypto.randomUUID(),
      cliente_id: abonando.id,
      tipo: 'abono',
      monto_usd: montoAbonoUsd,
      monto_bs: montoAbonoNum,
      tasa_usada: tasa,
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

  return (
    <div>
      <header className="bg-emerald-600 text-white px-4 pt-4 pb-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Fiado</h1>
          <p className="text-emerald-200 text-sm">Cuentas por cobrar</p>
        </div>
        <ThemeToggle />
      </header>

      {!isOnline && (
        <div className="mx-4 mt-3 p-2.5 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-gray-600 dark:text-gray-300 text-xs text-center">
          Sin conexión — los saldos son los del último dato sincronizado
        </div>
      )}

      <div className="p-4 space-y-4">
        <div className="bg-orange-50 dark:bg-orange-900/20 rounded-2xl p-4 text-center">
          <p className="text-xs font-semibold text-orange-500 uppercase tracking-wide mb-1">Total por cobrar</p>
          <p className="text-3xl font-bold text-orange-600 dark:text-orange-400">{formatUSD(totalDeudaUsd)}</p>
          {tasa > 0 && <p className="text-sm text-gray-400 mt-1">{formatBS(totalDeudaBs)}</p>}
        </div>

        {cargando ? (
          <div className="text-center text-gray-400 py-16">
            <svg className="w-8 h-8 mx-auto mb-3 text-emerald-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : deudores.length === 0 ? (
          <div className="text-center text-gray-400 py-12">
            <p className="font-medium">Nadie debe por ahora</p>
          </div>
        ) : (
          <div className="space-y-2">
            {deudores.map(c => (
              <div key={c.id} className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 overflow-hidden">
                <button
                  onClick={() => expandirCliente(c.id)}
                  className="w-full flex items-center justify-between gap-3 p-3 text-left"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-gray-900 dark:text-white truncate">
                      {formatearNombre(c.nombre)}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">Toca para ver el detalle</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-orange-600 dark:text-orange-400">{formatUSD(c.saldo_usd)}</p>
                    {tasa > 0 && <p className="text-xs text-gray-400">{formatBS(c.saldo_usd * tasa)}</p>}
                  </div>
                </button>

                {expandido === c.id && (
                  <div className="px-3 pb-3 border-t border-gray-50 dark:border-slate-700 pt-2">
                    {(detalleCargos[c.id]?.length ?? 0) === 0 ? (
                      <p className="text-xs text-gray-400 py-1">Sin detalle disponible</p>
                    ) : (
                      <div className="space-y-1.5 mb-2">
                        {detalleCargos[c.id].map(m => (
                          <div key={m.id} className="flex items-center justify-between text-xs">
                            <span className="text-gray-500 dark:text-gray-400">{fmtFecha(m.ocurrido_en)}</span>
                            <span className="font-medium text-gray-700 dark:text-gray-300">{formatBS(m.monto_bs)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => abrirAbonar(c)}
                      className="w-full bg-emerald-600 text-white py-2.5 rounded-xl text-sm font-bold"
                    >
                      Abonar
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Registrar abono */}
      {abonando && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => !guardandoAbono && cerrarAbonar()} />
          <div className="relative w-full max-w-lg mx-auto bg-white dark:bg-slate-800 rounded-t-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-slate-700">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Abonar</h2>
                <p className="text-sm text-gray-400">{formatearNombre(abonando.nombre)}</p>
              </div>
              <button onClick={cerrarAbonar} className="p-1 text-gray-400">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="text-center py-3 bg-orange-50 dark:bg-orange-900/20 rounded-xl">
                <p className="text-xs font-semibold text-orange-500 uppercase tracking-wide mb-1">Debe actualmente</p>
                <p className="text-xl font-bold text-orange-600 dark:text-orange-400">{formatUSD(abonando.saldo_usd)}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monto recibido (Bs)</label>
                <input
                  type="number"
                  step="0.01"
                  value={montoAbonoBs}
                  onChange={e => { setMontoAbonoBs(e.target.value); setErrorAbono(''); }}
                  className="w-full border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-3 text-xl font-bold bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-400"
                  placeholder="0.00"
                  autoFocus
                />
              </div>

              {montoAbonoNum > 0 && (
                <div className={`rounded-xl p-3 space-y-1 ${excedeDeuda ? 'bg-red-50 dark:bg-red-900/20' : 'bg-gray-50 dark:bg-slate-700'}`}>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500 dark:text-gray-400">Equivalente</span>
                    <span className="font-semibold text-gray-800 dark:text-gray-200">{formatUSD(montoAbonoUsd)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500 dark:text-gray-400">Quedará debiendo</span>
                    <span className={`font-semibold ${excedeDeuda ? 'text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-gray-200'}`}>
                      {formatUSD(Math.max(0, restanteDespues ?? 0))}
                    </span>
                  </div>
                  {excedeDeuda && (
                    <p className="text-xs text-red-600 dark:text-red-400 font-semibold pt-1">
                      El monto supera lo que debe — no se puede confirmar
                    </p>
                  )}
                </div>
              )}

              {errorAbono && <p className="text-red-500 text-sm">{errorAbono}</p>}
            </div>

            <div className="p-4 border-t border-gray-100 dark:border-slate-700">
              <button
                onClick={confirmarAbono}
                disabled={guardandoAbono || !montoAbonoBs || montoAbonoNum <= 0 || excedeDeuda}
                className="w-full bg-emerald-600 text-white py-4 rounded-xl text-lg font-bold disabled:opacity-40"
              >
                {guardandoAbono ? 'Guardando...' : 'Confirmar abono'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-5 py-2.5 rounded-xl text-sm font-medium z-50 shadow-lg max-w-xs text-center">
          {toast}
        </div>
      )}
    </div>
  );
}
