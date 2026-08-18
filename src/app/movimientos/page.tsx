'use client';

import { useState, useEffect } from 'react';
import { Producto, MovimientoStock, TipoMovimiento, MotivoMovimiento } from '@/types';
import { getProductos, saveMovimiento, getMovimientos, actualizarStockLocal } from '@/lib/db';
import { encolarAplicarMovimientoStock } from '@/lib/outbox';
import { getMovimientosRemoto, aplicarMovimientoStockRemoto } from '@/lib/sync';
import { useApp } from '@/components/Providers';
import { useGuardarRuta } from '@/lib/useGuardarRuta';
import Scanner from '@/components/Scanner';
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

function fmtCantidad(n: number) {
  return n.toLocaleString('es-VE', { maximumFractionDigits: 3 });
}

type TipoUI = 'entrada' | 'salida' | 'ajuste';

const TIPO_TAB_LABELS: Record<TipoUI, string> = {
  entrada: 'Entrada',
  salida: 'Salida',
  ajuste: 'Ajuste por conteo',
};

const MOTIVOS: Record<TipoUI, { value: MotivoMovimiento; label: string }[]> = {
  entrada: [
    { value: 'compra', label: 'Compra' },
    { value: 'devolucion_cliente', label: 'Devolución de cliente' },
  ],
  salida: [
    { value: 'consumo_propio', label: 'Consumo propio' },
    { value: 'dano', label: 'Daño' },
    { value: 'vencido', label: 'Vencido' },
    { value: 'perdida', label: 'Pérdida' },
    { value: 'devolucion_proveedor', label: 'Devolución a proveedor' },
  ],
  ajuste: [{ value: 'conteo_fisico', label: 'Conteo físico' }],
};

const TIPO_LABELS: Record<TipoMovimiento, string> = {
  entrada: 'Entrada', salida: 'Salida', ajuste: 'Ajuste', venta: 'Venta',
};

const MOTIVO_LABELS: Record<MotivoMovimiento, string> = {
  compra: 'Compra',
  devolucion_cliente: 'Devolución de cliente',
  consumo_propio: 'Consumo propio',
  dano: 'Daño',
  vencido: 'Vencido',
  perdida: 'Pérdida',
  devolucion_proveedor: 'Devolución a proveedor',
  conteo_fisico: 'Conteo físico',
  correccion: 'Corrección',
  venta: 'Venta',
};

const TIPO_COLORS: Record<TipoMovimiento, string> = {
  entrada: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  salida: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  ajuste: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  venta: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-300',
};

export default function MovimientosPage() {
  useGuardarRuta();
  const { negocioId, isOnline, user, userNombre } = useApp();

  const [productos, setProductos] = useState<Producto[]>([]);
  const [movimientos, setMovimientos] = useState<MovimientoStock[]>([]);
  const [cargando, setCargando] = useState(true);
  const [soloDispositivo, setSoloDispositivo] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [productoSel, setProductoSel] = useState<Producto | null>(null);
  const [busquedaProducto, setBusquedaProducto] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [tipo, setTipo] = useState<TipoUI>('entrada');
  const [motivo, setMotivo] = useState<MotivoMovimiento>('compra');
  const [cantidad, setCantidad] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const [filtroProductoId, setFiltroProductoId] = useState<string>('');
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const cargar = async () => {
    setCargando(true);
    const [prods, movsLocal] = await Promise.all([getProductos(), getMovimientos()]);
    setProductos(prods);

    // Igual que en Resumen: base offline-first (lo local siempre se
    // muestra), completado con el resto del negocio cuando hay red — un
    // admin necesita ver movimientos hechos en otros dispositivos, no solo
    // los de este.
    let final = movsLocal;
    let completo = false;
    if (isOnline && negocioId) {
      const remotos = await getMovimientosRemoto(negocioId);
      if (remotos !== null) {
        completo = true;
        const porId = new Map(movsLocal.map(m => [m.id, m]));
        for (const r of remotos) {
          if (!porId.has(r.id)) porId.set(r.id, r);
        }
        final = Array.from(porId.values()).sort((a, b) => b.ocurrido_en.localeCompare(a.ocurrido_en));
      }
    }
    setMovimientos(final);
    setSoloDispositivo(!completo);
    setCargando(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { cargar(); }, [isOnline]);

  const abrirForm = () => {
    setProductoSel(null);
    setBusquedaProducto('');
    setTipo('entrada');
    setMotivo('compra');
    setCantidad('');
    setNota('');
    setError('');
    setShowForm(true);
  };

  const cambiarTipo = (t: TipoUI) => {
    setTipo(t);
    setMotivo(MOTIVOS[t][0].value);
    setCantidad('');
    setError('');
  };

  const productosFiltrados = busquedaProducto.trim()
    ? productos
        .filter(p =>
          p.nombre.toLowerCase().includes(busquedaProducto.toLowerCase()) ||
          (p.codigo_barra && p.codigo_barra.includes(busquedaProducto))
        )
        .slice(0, 8)
    : [];

  const handleScanProducto = (codigo: string) => {
    setShowScanner(false);
    const p = productos.find(x => x.codigo_barra === codigo);
    if (p) {
      setProductoSel(p);
      setBusquedaProducto('');
    } else {
      showToast('Código no encontrado');
    }
  };

  // Ajuste por conteo: lo que se ingresa es la cantidad REAL contada, no la
  // diferencia — la app la calcula sola contra la existencia actual.
  const cantidadNum = parseFloat(cantidad);
  const stockActualSel = productoSel?.stock ?? 0;
  const diferenciaConteo =
    tipo === 'ajuste' && cantidad.trim() && !isNaN(cantidadNum) ? cantidadNum - stockActualSel : null;

  const guardarMovimiento = async () => {
    if (!productoSel) { setError('Selecciona un producto'); return; }
    if (!negocioId) return;
    if (!cantidad.trim() || isNaN(cantidadNum)) { setError('Ingresa una cantidad válida'); return; }
    if (tipo !== 'ajuste' && cantidadNum <= 0) { setError('La cantidad debe ser mayor a 0'); return; }

    let cantidadAplicada: number;
    if (tipo === 'ajuste') {
      cantidadAplicada = diferenciaConteo ?? 0;
      if (cantidadAplicada === 0) {
        setError('El conteo coincide con la existencia actual — no hay nada que ajustar');
        return;
      }
    } else {
      cantidadAplicada = tipo === 'entrada' ? cantidadNum : -cantidadNum;
    }

    setGuardando(true);
    setError('');

    const now = new Date().toISOString();
    const stockDespues = (productoSel.stock ?? 0) + cantidadAplicada;
    const movimiento: MovimientoStock = {
      id: crypto.randomUUID(),
      producto_id: productoSel.id,
      producto_nombre: productoSel.nombre,
      tipo,
      motivo,
      cantidad: cantidadAplicada,
      stock_resultante: stockDespues,
      usuario_id: user?.id,
      usuario_nombre: userNombre || undefined,
      nota: nota.trim() || undefined,
      ocurrido_en: now,
      sincronizado: false,
    };

    // Optimista, igual que una venta o un cierre: el movimiento ya ocurrió
    // en la realidad (llegó mercancía, se dañó algo, se contó el estante) —
    // se aplica local de inmediato y nunca se revierte solo porque la red
    // falle en ese instante. Si falla la confirmación, queda encolado.
    await saveMovimiento(movimiento);
    await actualizarStockLocal(productoSel.id, stockDespues);

    if (!isOnline) {
      await encolarAplicarMovimientoStock(movimiento.id, negocioId);
      setGuardando(false);
      setShowForm(false);
      await cargar();
      showToast('Guardado localmente — se sincronizará cuando haya conexión');
      return;
    }

    const nuevoStock = await aplicarMovimientoStockRemoto(movimiento);
    setGuardando(false);
    if (nuevoStock === null) {
      await encolarAplicarMovimientoStock(movimiento.id, negocioId);
      setShowForm(false);
      await cargar();
      showToast('Guardado localmente — no se pudo confirmar con el servidor todavía, se reintentará');
      return;
    }

    await saveMovimiento({ ...movimiento, sincronizado: true, stock_resultante: nuevoStock });
    setShowForm(false);
    await cargar();
    showToast('Movimiento registrado');
  };

  const movimientosFiltrados = filtroProductoId
    ? movimientos.filter(m => m.producto_id === filtroProductoId)
    : movimientos;

  return (
    <div>
      <header className="bg-emerald-600 text-white px-4 pt-4 pb-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Movimientos</h1>
          <p className="text-emerald-200 text-sm">Entradas, salidas y ajustes de inventario</p>
        </div>
        <ThemeToggle />
      </header>

      {!isOnline && (
        <div className="mx-4 mt-3 p-2.5 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-gray-600 dark:text-gray-300 text-xs text-center">
          Sin conexión — los movimientos se guardan en el dispositivo y se sincronizan al reconectar
        </div>
      )}

      <div className="p-4 space-y-4">
        <button
          onClick={abrirForm}
          className="w-full bg-emerald-600 text-white py-3.5 rounded-xl font-bold flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Registrar movimiento
        </button>

        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-700 dark:text-gray-300">Historial</h2>
          {productos.length > 0 && (
            <select
              value={filtroProductoId}
              onChange={e => setFiltroProductoId(e.target.value)}
              className="text-xs border border-gray-200 dark:border-slate-600 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-200"
            >
              <option value="">Todos los productos</option>
              {productos.map(p => (
                <option key={p.id} value={p.id}>{formatearNombre(p.nombre)}</option>
              ))}
            </select>
          )}
        </div>

        {soloDispositivo && (
          <div className="p-2.5 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-gray-600 dark:text-gray-300 text-xs text-center">
            Mostrando solo los movimientos de este dispositivo — puede haber más de otros usuarios
          </div>
        )}

        {cargando ? (
          <div className="text-center text-gray-400 py-16">
            <svg className="w-8 h-8 mx-auto mb-3 text-emerald-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : movimientosFiltrados.length === 0 ? (
          <div className="text-center text-gray-400 py-12">
            <p className="font-medium">Sin movimientos registrados</p>
          </div>
        ) : (
          <div className="space-y-2">
            {movimientosFiltrados.map(m => (
              <div key={m.id} className="bg-white dark:bg-slate-800 rounded-xl p-3 shadow-sm border border-gray-100 dark:border-slate-700">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-gray-900 dark:text-white truncate">
                      {formatearNombre(m.producto_nombre)}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TIPO_COLORS[m.tipo]}`}>
                        {TIPO_LABELS[m.tipo]}
                      </span>
                      <span className="text-xs text-gray-400">{MOTIVO_LABELS[m.motivo]}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`font-bold text-sm ${m.cantidad >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {m.cantidad >= 0 ? '+' : ''}{fmtCantidad(m.cantidad)}
                    </p>
                    {m.stock_resultante != null && (
                      <p className="text-xs text-gray-400">→ {fmtCantidad(m.stock_resultante)}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-50 dark:border-slate-700 text-xs text-gray-400">
                  <span>{m.usuario_nombre || '—'}</span>
                  <span>{fmtFecha(m.ocurrido_en)}</span>
                </div>
                {m.nota && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 italic">{m.nota}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Registrar movimiento */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => !guardando && setShowForm(false)} />
          <div className="relative w-full max-w-lg mx-auto bg-white dark:bg-slate-800 rounded-t-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-slate-700">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Registrar movimiento</h2>
              <button onClick={() => setShowForm(false)} className="p-1 text-gray-400">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Producto</label>
                {productoSel ? (
                  <div className="flex items-center justify-between bg-gray-50 dark:bg-slate-700 rounded-xl p-3">
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-gray-900 dark:text-white truncate">
                        {formatearNombre(productoSel.nombre)}
                      </p>
                      <p className="text-xs text-gray-400">
                        Existencia actual: {productoSel.stock != null ? fmtCantidad(productoSel.stock) : 'sin inicializar'}
                        {productoSel.por_peso ? ' kg' : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => setProductoSel(null)}
                      className="flex-shrink-0 text-emerald-600 text-sm font-semibold"
                    >
                      Cambiar
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={busquedaProducto}
                        onChange={e => setBusquedaProducto(e.target.value)}
                        placeholder="Buscar por nombre o código..."
                        className="flex-1 border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-3 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-400"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => setShowScanner(true)}
                        className="flex-shrink-0 px-3 py-3 rounded-xl bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 flex items-center justify-center"
                        aria-label="Escanear código"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8v8M12 8v8M17 8v8" />
                        </svg>
                      </button>
                    </div>
                    {productosFiltrados.length > 0 && (
                      <div className="mt-2 border border-gray-100 dark:border-slate-600 rounded-xl divide-y divide-gray-100 dark:divide-slate-600 max-h-48 overflow-y-auto">
                        {productosFiltrados.map(p => (
                          <button
                            key={p.id}
                            onClick={() => { setProductoSel(p); setBusquedaProducto(''); }}
                            className="w-full text-left p-3 text-sm hover:bg-gray-50 dark:hover:bg-slate-700"
                          >
                            <p className="font-medium text-gray-900 dark:text-white">{formatearNombre(p.nombre)}</p>
                            <p className="text-xs text-gray-400">
                              Existencia: {p.stock != null ? fmtCantidad(p.stock) : 'sin inicializar'}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo</label>
                <div className="flex gap-2">
                  {(['entrada', 'salida', 'ajuste'] as TipoUI[]).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => cambiarTipo(t)}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                        tipo === t ? 'bg-emerald-600 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {TIPO_TAB_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              {tipo !== 'ajuste' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Motivo</label>
                  <div className="flex flex-wrap gap-2">
                    {MOTIVOS[tipo].map(m => (
                      <button
                        key={m.value}
                        type="button"
                        onClick={() => setMotivo(m.value)}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                          motivo === m.value ? 'bg-emerald-600 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {tipo === 'ajuste'
                    ? `Cantidad real contada${productoSel?.por_peso ? ' (kilos)' : ''}`
                    : `Cantidad${productoSel?.por_peso ? ' (kilos)' : ''}`}
                </label>
                <input
                  type="number"
                  step="0.001"
                  value={cantidad}
                  onChange={e => setCantidad(e.target.value)}
                  className="w-full border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-3 text-lg font-semibold bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-400"
                  placeholder="0"
                />
                {diferenciaConteo !== null && (
                  <p className={`text-sm mt-1 font-medium ${diferenciaConteo >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    Diferencia: {diferenciaConteo >= 0 ? '+' : ''}{fmtCantidad(diferenciaConteo)}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nota (opcional)</label>
                <input
                  type="text"
                  value={nota}
                  onChange={e => setNota(e.target.value)}
                  placeholder="Ej: Factura #123"
                  className="w-full border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-3 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-400"
                />
              </div>

              {error && <p className="text-red-500 text-sm">{error}</p>}
            </div>

            <div className="p-4 border-t border-gray-100 dark:border-slate-700">
              <button
                onClick={guardarMovimiento}
                disabled={guardando}
                className="w-full bg-emerald-600 text-white py-4 rounded-xl text-lg font-bold disabled:opacity-40"
              >
                {guardando ? 'Guardando...' : 'Registrar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showScanner && <Scanner onDetect={handleScanProducto} onClose={() => setShowScanner(false)} />}

      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-5 py-2.5 rounded-xl text-sm font-medium z-50 shadow-lg max-w-xs text-center">
          {toast}
        </div>
      )}
    </div>
  );
}
