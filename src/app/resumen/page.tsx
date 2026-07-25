'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import {
  getVentasSinCerrar,
  saveCierre,
  tagVentasConCierre,
  getCierres,
  getUltimoCierre,
  setUltimoCierre,
} from '@/lib/db';
import { sincronizarCierre } from '@/lib/sync';
import { formatBS, formatUSD } from '@/lib/precio';
import { Venta, MetodoPago, CierreCaja, DesgloseCierre } from '@/types';
import { useApp } from '@/components/Providers';
import ThemeToggle from '@/components/ThemeToggle';

const METODO_LABELS: Record<MetodoPago, string> = {
  efectivo_bs: 'Efectivo Bs',
  pago_movil: 'Pago Móvil',
  biopago: 'Biopago',
  tarjeta: 'Tarjeta',
  efectivo_usd: 'Efectivo $',
};

const METODO_COLORS: Record<MetodoPago, string> = {
  efectivo_bs: 'bg-emerald-100 text-emerald-700',
  pago_movil: 'bg-blue-100 text-blue-700',
  biopago: 'bg-purple-100 text-purple-700',
  tarjeta: 'bg-slate-100 text-slate-700',
  efectivo_usd: 'bg-amber-100 text-amber-700',
};

const METODO_ICONS: Record<MetodoPago, JSX.Element> = {
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
  const { tasa, negocioId } = useApp();
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [cierres, setCierres] = useState<CierreCaja[]>([]);
  const [ultimoCierre, setUltimoCierreState] = useState<string | null>(null);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [expandidoCierre, setExpandidoCierre] = useState<string | null>(null);
  const [showConfirmCierre, setShowConfirmCierre] = useState(false);
  const [cerrando, setCerrando] = useState(false);

  const cargar = async () => {
    const [v, c, uc] = await Promise.all([
      getVentasSinCerrar(),
      getCierres(),
      getUltimoCierre(),
    ]);
    setVentas(v);
    setCierres(c);
    setUltimoCierreState(uc);
  };

  useEffect(() => { cargar(); }, []);

  const totalBS = ventas.reduce((s, v) => s + v.total_bs, 0);
  const totalUSD = tasa > 0 ? totalBS / tasa : 0;

  const porMetodo = ventas.reduce(
    (acc, v) => {
      acc[v.metodo_pago] = (acc[v.metodo_pago] || 0) + v.total_bs;
      return acc;
    },
    {} as Partial<Record<MetodoPago, number>>
  );

  // Start of current period: last cierre time, or oldest pending venta, or null
  const periodoInicio = ultimoCierre
    ?? (ventas.length > 0
      ? ventas.reduce((min, v) => (v.fecha < min ? v.fecha : min), ventas[0].fecha)
      : null);

  const confirmarCierre = async () => {
    setCerrando(true);
    const now = new Date().toISOString();

    const desglose = ventas.reduce((acc, v) => {
      const m = v.metodo_pago;
      if (!acc[m]) acc[m] = { bs: 0, usd: 0, count: 0 };
      acc[m]!.bs += v.total_bs;
      acc[m]!.usd += tasa > 0 ? v.total_bs / tasa : 0;
      acc[m]!.count += 1;
      return acc;
    }, {} as Partial<Record<MetodoPago, DesgloseCierre>>);

    const inicio = periodoInicio ?? now;

    const cierre: CierreCaja = {
      id: crypto.randomUUID(),
      periodo_inicio: inicio,
      periodo_fin: now,
      total_bs: totalBS,
      total_usd: tasa > 0 ? totalBS / tasa : 0,
      cantidad_ventas: ventas.length,
      desglose_metodos: desglose,
      tasa_cierre: tasa,
      creado_en: now,
    };

    await saveCierre(cierre);
    await tagVentasConCierre(ventas.map(v => v.id), cierre.id);
    await setUltimoCierre(now);
    sincronizarCierre(cierre, negocioId!); // fire-and-forget

    setVentas([]);
    setCierres(prev => [cierre, ...prev]);
    setUltimoCierreState(now);
    setShowConfirmCierre(false);
    setCerrando(false);
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
                onClick={() => setShowConfirmCierre(true)}
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

      <div className="p-4 space-y-4">
        {/* Total del período */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 text-center">
          <p className="text-gray-500 text-sm mb-1">Total sin cerrar</p>
          <p className="text-4xl font-bold text-gray-900">{formatBS(totalBS)}</p>
          {tasa > 0 && <p className="text-gray-400 mt-1">{formatUSD(totalUSD)}</p>}
          <p className="text-emerald-600 text-sm font-medium mt-2">
            {ventas.length} {ventas.length === 1 ? 'venta' : 'ventas'}
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
            {[...ventas].reverse().map((venta, idx) => {
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
                      <p className="font-semibold text-gray-800">Venta #{ventas.length - idx}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-gray-400 text-xs">{hora}</span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${METODO_COLORS[venta.metodo_pago]}`}>
                          {METODO_ICONS[venta.metodo_pago]}
                          {METODO_LABELS[venta.metodo_pago]}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-gray-900">{formatBS(venta.total_bs)}</p>
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
                      <div className="border-t border-gray-100 pt-2 flex justify-between text-sm">
                        <span className="text-gray-500">Tasa usada</span>
                        <span className="text-gray-600">Bs {venta.tasa_usada.toLocaleString('es-VE')}</span>
                      </div>
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
                  {ventas.length} {ventas.length === 1 ? 'venta' : 'ventas'}
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
                  disabled={cerrando}
                  className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-bold disabled:opacity-40"
                >
                  {cerrando ? 'Cerrando...' : 'Confirmar cierre'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
