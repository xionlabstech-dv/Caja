'use client';

import { useState, useEffect } from 'react';
import { useApp } from '@/components/Providers';
import { PERIODOS, TipoPeriodo, rangoPeriodo, labelPeriodoAnterior } from '@/lib/periodos';
import {
  fetchTotales,
  fetchPorMetodo,
  fetchTopProductos,
  fetchPorDiaSemana,
  fetchStockBajo,
  fetchMermas,
  TotalesPeriodo,
  DesglosePorMetodo,
  TopProducto,
  VentasPorDiaSemana,
  OrdenTopProductos,
  StockBajoProducto,
  MermaPorMotivo,
} from '@/lib/reportes';
import { formatBS, formatUSD } from '@/lib/precio';
import { useGuardarRuta } from '@/lib/useGuardarRuta';
import ThemeToggle from '@/components/ThemeToggle';

// ventas.metodo_pago es texto libre en Supabase (sin enum/check), y conviven
// dos esquemas de nombres en los datos reales: el que usa la pantalla de
// Caja ('efectivo_bs'/'efectivo_usd') y el que aparece en el histórico ya
// cargado ('efectivo'/'divisa'). Se mapean ambos al mismo label/color/moneda
// para que ningún método quede sin etiqueta — y cualquier valor futuro no
// contemplado cae en un fallback visible en vez de un chip vacío.
interface MetodoInfo { label: string; color: string; enUsd: boolean }

const METODO_INFO: Record<string, MetodoInfo> = {
  efectivo_bs: { label: 'Efectivo Bs', color: 'bg-emerald-100 text-emerald-700', enUsd: false },
  efectivo: { label: 'Efectivo Bs', color: 'bg-emerald-100 text-emerald-700', enUsd: false },
  pago_movil: { label: 'Pago Móvil', color: 'bg-blue-100 text-blue-700', enUsd: false },
  biopago: { label: 'Biopago', color: 'bg-purple-100 text-purple-700', enUsd: false },
  tarjeta: { label: 'Tarjeta', color: 'bg-slate-100 text-slate-700', enUsd: false },
  efectivo_usd: { label: 'Efectivo $', color: 'bg-amber-100 text-amber-700', enUsd: true },
  divisa: { label: 'Efectivo $', color: 'bg-amber-100 text-amber-700', enUsd: true },
};

function metodoInfo(metodoPago: string): MetodoInfo {
  return METODO_INFO[metodoPago] ?? { label: metodoPago, color: 'bg-gray-100 text-gray-600', enUsd: false };
}

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const ORDEN_LUNES_A_DOMINGO = [1, 2, 3, 4, 5, 6, 0];

const MERMA_MOTIVO_LABELS: Record<string, string> = {
  dano: 'Daño',
  vencido: 'Vencido',
  consumo_propio: 'Consumo propio',
};

function formatearNombre(nombre: string): string {
  return nombre
    .toLowerCase()
    .split(' ')
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

export default function ReportesPage() {
  useGuardarRuta();
  const { negocioId, isOnline, rol, usaCostos, usaStock, tasa } = useApp();
  const [periodoTipo, setPeriodoTipo] = useState<TipoPeriodo>('hoy');
  const [loading, setLoading] = useState(true);
  const [huboError, setHuboError] = useState(false);
  const [totales, setTotales] = useState<TotalesPeriodo | null>(null);
  const [totalesAnterior, setTotalesAnterior] = useState<TotalesPeriodo | null>(null);
  const [porMetodo, setPorMetodo] = useState<DesglosePorMetodo[]>([]);
  const [topProductos, setTopProductos] = useState<TopProducto[]>([]);
  const [porDiaSemana, setPorDiaSemana] = useState<VentasPorDiaSemana[]>([]);
  const [stockBajoList, setStockBajoList] = useState<StockBajoProducto[]>([]);
  const [mermasList, setMermasList] = useState<MermaPorMotivo[]>([]);
  // Solo tiene sentido si podría haber ganancia que mostrar — ver también el
  // gate de renderizado más abajo (mostrarGanancia).
  const [ordenTop, setOrdenTop] = useState<OrdenTopProductos>('cantidad');

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
      fetchTopProductos(negocioId, desde, hasta, 10, ordenTop),
      fetchPorDiaSemana(negocioId, desde, hasta),
      // Solo se piden si el negocio usa_stock — evita una consulta al
      // pedo para negocios que no llevan control de inventario.
      usaStock ? fetchStockBajo(negocioId) : Promise.resolve(null),
      usaStock ? fetchMermas(negocioId, desde, hasta) : Promise.resolve(null),
    ]).then(([tot, totAnt, metodo, top, dias, stockBajoData, mermasData]) => {
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
      setStockBajoList(stockBajoData ?? []);
      setMermasList(mermasData ?? []);
      setLoading(false);
    });

    return () => { cancelado = true; };
  }, [periodoTipo, isOnline, negocioId, ordenTop, usaStock]);

  const ticketPromedioBs = totales && totales.cantidad_ventas > 0 ? totales.total_bs / totales.cantidad_ventas : 0;
  const ticketPromedioUsd = totales && totales.cantidad_ventas > 0 ? totales.total_usd / totales.cantidad_ventas : 0;

  const cambioPct =
    totales && totalesAnterior && totalesAnterior.total_bs > 0
      ? ((totales.total_bs - totalesAnterior.total_bs) / totalesAnterior.total_bs) * 100
      : null;

  const totalGeneral = porMetodo.reduce((s, m) => s + m.total_bs, 0);

  // Gate por rol Y por preferencia del negocio — aunque la RPC ya devuelve
  // null en ganancia_usd para un no-admin, esta pantalla nunca debe intentar
  // renderizar nada de costo/ganancia basándose solo en "el campo vino con
  // dato": se verifica explícitamente quién está mirando.
  const mostrarGanancia = rol === 'admin' && usaCostos;
  const hayGanancia = mostrarGanancia && totales?.items_con_costo != null && totales.items_con_costo > 0;
  const gananciaBs = hayGanancia ? totales!.ganancia_usd! * tasa : 0;
  // Margen SOBRE EL COSTO (markup), igual definición que el formulario de
  // producto: costo = monto_con_costo_usd - ganancia_usd (precio - ganancia
  // = costo), y el % es ganancia / costo, no ganancia / venta.
  const costoTotalUsd = hayGanancia ? totales!.monto_con_costo_usd! - totales!.ganancia_usd! : 0;
  const margenPeriodoPct = hayGanancia && costoTotalUsd > 0 ? (totales!.ganancia_usd! / costoTotalUsd) * 100 : null;
  const coberturaParcial =
    hayGanancia && totales!.items_totales != null && totales!.items_con_costo! < totales!.items_totales;

  // Stock bajo y mermas no dependen de si hubo ventas en el período — un
  // negocio puede no haber vendido nada hoy y aun así tener existencias
  // bajas o una merma por daño. Se muestran fuera del estado "sin ventas".
  const mostrarStock = rol === 'admin' && usaStock;

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
        ) : (
          <>
            {/* Stock bajo y mermas: no dependen de si hubo ventas en el
                período, así que van antes de ese gate. */}
            {mostrarStock && stockBajoList.length > 0 && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-slate-700">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-3">Stock bajo o agotado</h2>
                <div className="space-y-2">
                  {stockBajoList.map(p => (
                    <div key={p.producto_id} className="flex items-center justify-between text-sm gap-3">
                      <span className="text-gray-700 dark:text-gray-200 truncate">{formatearNombre(p.nombre)}</span>
                      <span className={`font-bold flex-shrink-0 ${p.stock <= 0 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
                        {p.stock.toLocaleString('es-VE', { maximumFractionDigits: p.es_por_peso ? 2 : 0 })}{p.es_por_peso ? ' kg' : ''}
                        <span className="text-gray-400 font-normal text-xs"> / mín {p.stock_minimo.toLocaleString('es-VE', { maximumFractionDigits: p.es_por_peso ? 2 : 0 })}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {mostrarStock && mermasList.length > 0 && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-slate-700">
                <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-3">Mermas del período</h2>
                <div className="space-y-2">
                  {mermasList.map(m => (
                    <div key={m.motivo} className="flex items-center justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-300">{MERMA_MOTIVO_LABELS[m.motivo] ?? m.motivo}</span>
                      <div className="text-right">
                        <span className="font-bold text-gray-800 dark:text-gray-100">
                          {m.cantidad.toLocaleString('es-VE', { maximumFractionDigits: 3 })}
                        </span>
                        {m.valor_usd != null && (
                          <span className="text-xs text-red-500 dark:text-red-400 ml-1.5">
                            −{formatBS(m.valor_usd * tasa)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!totales || totales.cantidad_ventas === 0 ? (
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

              {hayGanancia && (
                <div className="mt-4 pt-4 border-t border-gray-100 dark:border-slate-700">
                  <p className="text-emerald-600 dark:text-emerald-400 font-semibold">
                    Ganancia estimada: {formatBS(gananciaBs)}
                    {margenPeriodoPct !== null && (
                      <span> ({margenPeriodoPct.toLocaleString('es-VE', { maximumFractionDigits: 1 })}%)</span>
                    )}
                  </p>
                  {coberturaParcial && (
                    <p className="text-xs text-gray-400 mt-1">
                      Basado en {totales!.items_con_costo} de {totales!.items_totales} productos vendidos
                    </p>
                  )}
                </div>
              )}
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
                    const info = metodoInfo(m.metodo_pago);
                    return (
                      <div key={m.metodo_pago}>
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${info.color}`}>
                            {info.label}
                          </span>
                          <div className="text-right">
                            <span className="font-bold text-gray-800 dark:text-gray-100">
                              {info.enUsd ? formatUSD(m.total_usd) : formatBS(m.total_bs)}
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
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold text-gray-700 dark:text-gray-300">Productos más vendidos</h2>
                  {mostrarGanancia && (
                    <div className="flex gap-1 bg-gray-100 dark:bg-slate-700 rounded-full p-0.5">
                      {([
                        ['cantidad', 'Cantidad'],
                        ['ganancia', 'Ganancia'],
                      ] as [OrdenTopProductos, string][]).map(([valor, label]) => (
                        <button
                          key={valor}
                          onClick={() => setOrdenTop(valor)}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                            ordenTop === valor
                              ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-sm'
                              : 'text-gray-500 dark:text-gray-400'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
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
                      <div className="text-right flex-shrink-0">
                        <span className="font-bold text-sm text-gray-800 dark:text-gray-100 block">{formatBS(p.monto_total)}</span>
                        {mostrarGanancia && p.ganancia_usd != null && (
                          <span className={`text-xs ${p.ganancia_usd >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                            {p.ganancia_usd >= 0 ? '+' : ''}{formatBS(p.ganancia_usd * tasa)}
                          </span>
                        )}
                      </div>
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
          </>
        )}
      </div>
    </div>
  );
}
