'use client';

import { useState, useEffect } from 'react';
import { useApp } from '@/components/Providers';
import { PERIODOS, TipoPeriodo, rangoPeriodo, labelPeriodoAnterior } from '@/lib/periodos';
import {
  fetchTotales,
  fetchPorMetodo,
  fetchTopProductos,
  fetchPorDiaSemana,
  TotalesPeriodo,
  DesglosePorMetodo,
  TopProducto,
  VentasPorDiaSemana,
} from '@/lib/reportes';
import { formatBS, formatUSD } from '@/lib/precio';
import { MetodoPago } from '@/types';
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

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const ORDEN_LUNES_A_DOMINGO = [1, 2, 3, 4, 5, 6, 0];

function formatearNombre(nombre: string): string {
  return nombre
    .toLowerCase()
    .split(' ')
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

export default function ReportesPage() {
  const { negocioId, isOnline } = useApp();
  const [periodoTipo, setPeriodoTipo] = useState<TipoPeriodo>('mes');
  const [loading, setLoading] = useState(true);
  const [huboError, setHuboError] = useState(false);
  const [totales, setTotales] = useState<TotalesPeriodo | null>(null);
  const [totalesAnterior, setTotalesAnterior] = useState<TotalesPeriodo | null>(null);
  const [porMetodo, setPorMetodo] = useState<DesglosePorMetodo[]>([]);
  const [topProductos, setTopProductos] = useState<TopProducto[]>([]);
  const [porDiaSemana, setPorDiaSemana] = useState<VentasPorDiaSemana[]>([]);

  useEffect(() => {
    if (!isOnline || !negocioId) {
      setLoading(false);
      return;
    }

    let cancelado = false;
    setLoading(true);
    setHuboError(false);

    const { desde, hasta } = rangoPeriodo(periodoTipo, 0);
    const { desde: desdeAnt, hasta: hastaAnt } = rangoPeriodo(periodoTipo, -1);

    Promise.all([
      fetchTotales(negocioId, desde, hasta),
      fetchTotales(negocioId, desdeAnt, hastaAnt),
      fetchPorMetodo(negocioId, desde, hasta),
      fetchTopProductos(negocioId, desde, hasta, 10),
      fetchPorDiaSemana(negocioId, desde, hasta),
    ]).then(([tot, totAnt, metodo, top, dias]) => {
      if (cancelado) return;
      if (tot === null) {
        setHuboError(true);
        setLoading(false);
        return;
      }
      setTotales(tot);
      setTotalesAnterior(totAnt);
      setPorMetodo(metodo ?? []);
      setTopProductos(top ?? []);
      setPorDiaSemana(dias ?? []);
      setLoading(false);
    });

    return () => { cancelado = true; };
  }, [periodoTipo, isOnline, negocioId]);

  const ticketPromedioBs = totales && totales.cantidad_ventas > 0 ? totales.total_bs / totales.cantidad_ventas : 0;
  const ticketPromedioUsd = totales && totales.cantidad_ventas > 0 ? totales.total_usd / totales.cantidad_ventas : 0;

  const cambioPct =
    totales && totalesAnterior && totalesAnterior.total_bs > 0
      ? ((totales.total_bs - totalesAnterior.total_bs) / totalesAnterior.total_bs) * 100
      : null;

  const totalGeneral = porMetodo.reduce((s, m) => s + m.total_bs, 0);

  return (
    <div>
      <header className="bg-emerald-600 text-white px-4 pt-4 pb-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Reportes</h1>
          <p className="text-emerald-200 text-sm mt-0.5">Histórico de ventas</p>
        </div>
        <ThemeToggle />
      </header>

      {/* Selector de período */}
      <div className="px-4 py-3 bg-white dark:bg-slate-800 border-b border-gray-100 dark:border-slate-700 flex gap-2 overflow-x-auto">
        {PERIODOS.map(p => (
          <button
            key={p.tipo}
            onClick={() => setPeriodoTipo(p.tipo)}
            className={`flex-shrink-0 px-3.5 py-2 rounded-full text-sm font-medium transition-colors ${
              periodoTipo === p.tipo
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="p-4 space-y-4">
        {!isOnline ? (
          <div className="text-center text-gray-400 py-16">
            <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3" />
            </svg>
            <p className="font-medium">Los reportes necesitan conexión a internet</p>
            <p className="text-sm mt-1">Se muestran apenas recuperes la señal</p>
          </div>
        ) : loading ? (
          <div className="text-center text-gray-400 py-16">
            <svg className="w-8 h-8 mx-auto mb-3 text-emerald-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="font-medium">Calculando...</p>
          </div>
        ) : huboError ? (
          <div className="text-center text-gray-400 py-16">
            <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <p className="font-medium">No se pudieron cargar los reportes</p>
            <p className="text-sm mt-1">Intenta de nuevo en unos segundos</p>
          </div>
        ) : !totales || totales.cantidad_ventas === 0 ? (
          <div className="text-center text-gray-400 py-16">
            <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <p className="font-medium">Sin ventas registradas en este período</p>
          </div>
        ) : (
          <>
            {/* Totales del período */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-slate-700 text-center">
              <p className="text-gray-500 dark:text-gray-400 text-sm mb-1">Total vendido</p>
              <p className="text-4xl font-bold text-gray-900 dark:text-white">{formatBS(totales.total_bs)}</p>
              <p className="text-gray-400 mt-1">{formatUSD(totales.total_usd)}</p>

              <div className="flex items-center justify-center gap-6 mt-4 pt-4 border-t border-gray-100 dark:border-slate-700">
                <div>
                  <p className="text-lg font-bold text-gray-900 dark:text-white">{totales.cantidad_ventas}</p>
                  <p className="text-xs text-gray-400">{totales.cantidad_ventas === 1 ? 'venta' : 'ventas'}</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-gray-900 dark:text-white">{formatBS(ticketPromedioBs)}</p>
                  <p className="text-xs text-gray-400">ticket promedio</p>
                  <p className="text-xs text-gray-400">{formatUSD(ticketPromedioUsd)}</p>
                </div>
              </div>
            </div>

            {/* Comparación con período anterior */}
            {cambioPct !== null && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-slate-700">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500 dark:text-gray-400">
                    {PERIODOS.find(p => p.tipo === periodoTipo)?.label}: <span className="font-semibold text-gray-800 dark:text-gray-200">{formatBS(totales.total_bs)}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm mt-1.5">
                  <span className="text-gray-500 dark:text-gray-400">
                    {labelPeriodoAnterior(periodoTipo)}: <span className="font-semibold text-gray-800 dark:text-gray-200">{formatBS(totalesAnterior!.total_bs)}</span>
                  </span>
                </div>
                <p className={`text-right font-bold mt-2 ${cambioPct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {cambioPct >= 0 ? '+' : ''}{cambioPct.toLocaleString('es-VE', { maximumFractionDigits: 1 })}%
                </p>
              </div>
            )}

            {/* Desglose por método de pago */}
            {porMetodo.length > 0 && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-slate-700">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-3">Por método de pago</h2>
                <div className="space-y-3">
                  {porMetodo.map(m => {
                    const pct = totalGeneral > 0 ? (m.total_bs / totalGeneral) * 100 : 0;
                    return (
                      <div key={m.metodo_pago}>
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${METODO_COLORS[m.metodo_pago]}`}>
                            {METODO_LABELS[m.metodo_pago]}
                          </span>
                          <div className="text-right">
                            <span className="font-bold text-gray-800 dark:text-gray-100">
                              {m.metodo_pago === 'efectivo_usd' ? formatUSD(m.total_usd) : formatBS(m.total_bs)}
                            </span>
                            <span className="text-xs text-gray-400 ml-1.5">
                              {m.cantidad} {m.cantidad === 1 ? 'venta' : 'ventas'} · {pct.toLocaleString('es-VE', { maximumFractionDigits: 0 })}%
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Top 10 productos */}
            {topProductos.length > 0 && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-slate-700">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-3">Productos más vendidos</h2>
                <div className="space-y-2.5">
                  {topProductos.map((p, i) => (
                    <div key={p.producto_id ?? p.nombre} className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs font-bold flex items-center justify-center flex-shrink-0">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{formatearNombre(p.nombre)}</p>
                        <p className="text-xs text-gray-400">
                          {p.es_por_peso
                            ? `${p.cantidad_total.toLocaleString('es-VE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`
                            : `${Math.round(p.cantidad_total)} vendidos`}
                        </p>
                      </div>
                      <span className="font-bold text-sm text-gray-800 dark:text-gray-100 flex-shrink-0">{formatBS(p.monto_total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Ventas por día de la semana */}
            {porDiaSemana.filter(d => d.ocurrencias > 0).length > 0 && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-slate-700">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-1">Ventas por día de la semana</h2>
                <p className="text-xs text-gray-400 mb-3">Promedio dentro del período seleccionado</p>
                <div className="space-y-2">
                  {ORDEN_LUNES_A_DOMINGO.map(dow => {
                    const d = porDiaSemana.find(x => x.dia_semana === dow);
                    if (!d || d.ocurrencias === 0) return null;
                    return (
                      <div key={dow} className="flex items-center justify-between text-sm">
                        <span className="text-gray-600 dark:text-gray-300">{DIAS_SEMANA[dow]}</span>
                        <div className="text-right">
                          <span className="font-semibold text-gray-800 dark:text-gray-100">{formatBS(d.promedio_bs)}</span>
                          <span className="text-xs text-gray-400 ml-1.5">
                            total {formatBS(d.total_bs)} · {d.cantidad_ventas} {d.cantidad_ventas === 1 ? 'venta' : 'ventas'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
