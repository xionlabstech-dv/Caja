'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { getVentasHoy } from '@/lib/db';
import { formatBS, formatUSD } from '@/lib/precio';
import { Venta, MetodoPago } from '@/types';
import { useApp } from '@/components/Providers';

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
  tarjeta: 'bg-orange-100 text-orange-700',
  efectivo_usd: 'bg-yellow-100 text-yellow-700',
};

export default function ResumenPage() {
  const { tasa } = useApp();
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [expandido, setExpandido] = useState<string | null>(null);

  useEffect(() => {
    getVentasHoy().then(setVentas);
  }, []);

  const totalBS = ventas.reduce((s, v) => s + v.total_bs, 0);
  const totalUSD = tasa > 0 ? totalBS / tasa : 0;

  const porMetodo = ventas.reduce(
    (acc, v) => { acc[v.metodo_pago] = (acc[v.metodo_pago] || 0) + v.total_bs; return acc; },
    {} as Record<MetodoPago, number>
  );

  const hoy = new Date().toLocaleDateString('es-VE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div>
      <header className="bg-emerald-600 text-white px-4 pt-4 pb-3">
        <h1 className="text-xl font-bold">Resumen del día</h1>
        <p className="text-emerald-200 text-sm capitalize mt-0.5">{hoy}</p>
      </header>
      <div className="p-4 space-y-4">
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 text-center">
          <p className="text-gray-500 text-sm mb-1">Total vendido</p>
          <p className="text-4xl font-bold text-gray-900">{formatBS(totalBS)}</p>
          {tasa > 0 && <p className="text-gray-400 mt-1">{formatUSD(totalUSD)}</p>}
          <p className="text-emerald-600 text-sm font-medium mt-2">{ventas.length} {ventas.length === 1 ? 'venta' : 'ventas'}</p>
        </div>

        {Object.keys(porMetodo).length > 0 && (
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <h2 className="font-semibold text-gray-700 mb-3">Por método de pago</h2>
            <div className="space-y-2">
              {(Object.entries(porMetodo) as [MetodoPago, number][]).map(([metodo, total]) => (
                <div key={metodo} className="flex items-center justify-between">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${METODO_COLORS[metodo]}`}>{METODO_LABELS[metodo]}</span>
                  <span className="font-bold text-gray-800">{formatBS(total)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {ventas.length > 0 ? (
          <div className="space-y-2">
            <h2 className="font-semibold text-gray-700 px-1">Ventas</h2>
            {[...ventas].reverse().map((venta, idx) => {
              const hora = new Date(venta.fecha).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
              const isOpen = expandido === venta.id;
              return (
                <div key={venta.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <button className="w-full flex items-center justify-between p-4 text-left" onClick={() => setExpandido(isOpen ? null : venta.id)}>
                    <div>
                      <p className="font-semibold text-gray-800">Venta #{ventas.length - idx}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-gray-400 text-xs">{hora}</span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${METODO_COLORS[venta.metodo_pago]}`}>{METODO_LABELS[venta.metodo_pago]}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-gray-900">{formatBS(venta.total_bs)}</p>
                      <svg className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-2">
                      {venta.items.map((item, i) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span className="text-gray-600">{item.cantidad}× {item.nombre}</span>
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
          <div className="text-center text-gray-400 py-12">
            <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <p className="font-medium">Sin ventas hoy</p>
            <p className="text-sm mt-1">Las ventas aparecerán aquí</p>
          </div>
        )}
      </div>
    </div>
  );
}
