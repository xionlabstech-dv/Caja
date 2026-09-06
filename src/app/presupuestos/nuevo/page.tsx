'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Producto, PresupuestoItem, Presupuesto } from '@/types';
import { getProductos, getProductoPorCodigo, savePresupuesto } from '@/lib/db';
import { encolarCrearPresupuesto } from '@/lib/outbox';
import { precioBS, precioUSD, formatBS, formatUSD } from '@/lib/precio';
import { pareceCodigoBarra } from '@/lib/barcode';
import { compartirPresupuesto } from '@/lib/comprobante';
import { useApp } from '@/components/Providers';
import { useGuardarRuta } from '@/lib/useGuardarRuta';
import Scanner from '@/components/Scanner';
import ThemeToggle from '@/components/ThemeToggle';
import StockBadge from '@/components/StockBadge';

function avatarColor(nombre: string): string {
  const idx = nombre.charCodeAt(0) % 8;
  return ['bg-violet-500', 'bg-blue-500', 'bg-cyan-500', 'bg-teal-500',
    'bg-emerald-500', 'bg-amber-500', 'bg-orange-500', 'bg-pink-500'][idx];
}

function formatearNombre(nombre: string): string {
  return nombre
    .toLowerCase()
    .split(' ')
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function NuevoPresupuestoPage() {
  useGuardarRuta();
  const router = useRouter();
  const { tasa, isOnline, usaStock, ultimaSincronizacion, negocioId, user, userNombre, negocioNombre, productosVersion } = useApp();

  const [productos, setProductos] = useState<Producto[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [items, setItems] = useState<PresupuestoItem[]>([]);
  const [clienteNombre, setClienteNombre] = useState('');
  const [fechaVencimiento, setFechaVencimiento] = useState('');
  const [showPeso, setShowPeso] = useState(false);
  const [productoPeso, setProductoPeso] = useState<Producto | null>(null);
  const [gramos, setGramos] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [guardado, setGuardado] = useState<Presupuesto | null>(null);
  const [compartiendo, setCompartiendo] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  // Mismo disparador que Caja: productosVersion se incrementa cuando el
  // sync periódico termina de escribir productos frescos en IndexedDB.
  useEffect(() => {
    let cancelado = false;
    getProductos().then(p => {
      if (!cancelado) setProductos(p);
    });
    return () => { cancelado = true; };
  }, [productosVersion]);

  const productosFiltrados = busqueda
    ? productos.filter(
        p =>
          p.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
          (p.codigo_barra && p.codigo_barra.includes(busqueda))
      )
    : productos;

  // Precio ya congelado al momento de agregar — un presupuesto es una foto
  // del catálogo en ese instante, igual que VentaItem: si el precio del
  // producto cambia después en Inventario, esto no se entera ni se
  // recalcula.
  const agregarItem = useCallback((producto: Producto) => {
    if (producto.por_peso) {
      setProductoPeso(producto);
      setGramos('');
      setShowPeso(true);
      return;
    }
    setItems(prev => {
      const existente = prev.find(i => i.producto_id === producto.id && i.gramos === undefined);
      if (existente) {
        return prev.map(i => (i.id === existente.id ? { ...i, cantidad: i.cantidad + 1 } : i));
      }
      return [...prev, {
        id: crypto.randomUUID(),
        producto_id: producto.id,
        nombre: producto.nombre,
        cantidad: 1,
        precioUnitarioUsd: precioUSD(producto, tasa),
        precioUnitarioBs: precioBS(producto, tasa),
      }];
    });
    showToast(`${producto.nombre} agregado`);
  }, [tasa]);

  const agregarPorPeso = () => {
    if (!productoPeso) return;
    const g = parseFloat(gramos);
    if (!g || g <= 0) return;
    setItems(prev => [...prev, {
      id: crypto.randomUUID(),
      producto_id: productoPeso.id,
      nombre: productoPeso.nombre,
      cantidad: 1,
      gramos: g,
      // Precio por kg — mismo criterio que VentaItem.precioUnitarioBs/Usd
      // para items por peso.
      precioUnitarioUsd: precioUSD(productoPeso, tasa),
      precioUnitarioBs: precioBS(productoPeso, tasa),
    }]);
    setShowPeso(false);
    showToast(`${productoPeso.nombre} ${g}g agregado`);
    setProductoPeso(null);
  };

  const actualizarCantidad = (id: string, delta: number) => {
    setItems(prev =>
      prev.map(i => (i.id === id ? { ...i, cantidad: i.cantidad + delta } : i)).filter(i => i.cantidad > 0)
    );
  };

  const quitarItem = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const handleScan = useCallback(async (codigo: string): Promise<{ nombre: string } | null> => {
    const producto = await getProductoPorCodigo(codigo);
    if (producto) {
      agregarItem(producto);
      return { nombre: producto.nombre };
    }
    return null;
  }, [agregarItem]);

  const handleBuscadorKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const codigo = busqueda.trim();
    if (!codigo || !pareceCodigoBarra(codigo)) return;
    const producto = await getProductoPorCodigo(codigo);
    if (!producto) return;
    agregarItem(producto);
    setBusqueda('');
    searchRef.current?.focus();
  };

  const itemSubtotalBs = (item: PresupuestoItem) =>
    item.gramos !== undefined
      ? item.precioUnitarioBs * (item.gramos / 1000)
      : item.precioUnitarioBs * item.cantidad;

  const itemSubtotalUsd = (item: PresupuestoItem) =>
    item.gramos !== undefined
      ? item.precioUnitarioUsd * (item.gramos / 1000)
      : item.precioUnitarioUsd * item.cantidad;

  const totalBs = items.reduce((s, i) => s + itemSubtotalBs(i), 0);
  const totalUsd = items.reduce((s, i) => s + itemSubtotalUsd(i), 0);

  const guardarPresupuesto = async () => {
    if (items.length === 0) { setError('Agrega al menos un producto'); return; }
    if (!fechaVencimiento) { setError('Elige una fecha de vencimiento'); return; }
    if (!negocioId) return;

    setGuardando(true);
    setError('');

    const presupuesto: Presupuesto = {
      id: crypto.randomUUID(),
      cliente_nombre: clienteNombre.trim() || undefined,
      estado: 'vigente',
      fecha_vencimiento: fechaVencimiento,
      tasa_al_crear: tasa,
      total_usd: totalUsd,
      total_bs_estimado: totalBs,
      items,
      creado_por: user?.id,
      creado_por_nombre: userNombre || undefined,
      creado_en: new Date().toISOString(),
      sincronizado: false,
    };

    // Offline-first, igual que una venta: se guarda local de inmediato y se
    // encola el respaldo en Supabase — ahora mismo si hay conexión, o al
    // reconectar si no la hay. Nunca depende de red para generarse.
    await savePresupuesto(presupuesto);
    await encolarCrearPresupuesto(presupuesto, negocioId);

    setGuardando(false);
    setGuardado(presupuesto);
  };

  const compartir = async () => {
    if (!guardado) return;
    setCompartiendo(true);
    try {
      await compartirPresupuesto({ negocioNombre: negocioNombre || '', presupuesto: guardado });
    } catch {
      showToast('No se pudo generar el documento');
    } finally {
      setCompartiendo(false);
    }
  };

  if (guardado) {
    return (
      <div className="flex flex-col h-screen max-h-screen items-center justify-center p-6 text-center">
        <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center mb-3">
          <svg className="w-8 h-8 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">Presupuesto guardado</h1>
        <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 mt-1">{formatBS(guardado.total_bs_estimado)}</p>
        {tasa > 0 && <p className="text-gray-400 text-sm">{formatUSD(guardado.total_usd)}</p>}

        <div className="w-full max-w-sm mt-6 space-y-2">
          <button
            onClick={compartir}
            disabled={compartiendo}
            className="w-full bg-emerald-600 text-white py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8.684 13.342a3 3 0 100-2.684m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            {compartiendo ? 'Generando...' : 'Compartir presupuesto'}
          </button>
          <button
            onClick={() => router.push('/presupuestos')}
            className="w-full bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200 py-3.5 rounded-xl font-semibold"
          >
            Ver lista de presupuestos
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen max-h-screen">
      <header className="bg-emerald-600 text-white px-4 pt-4 pb-3 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => router.back()} className="p-1 -ml-1 flex-shrink-0" aria-label="Volver">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-bold truncate">Nuevo presupuesto</h1>
        </div>
        <ThemeToggle />
      </header>

      <div className="p-4 pb-2 space-y-2">
        <div className="flex gap-2">
          <input
            ref={searchRef}
            type="text"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            onKeyDown={handleBuscadorKeyDown}
            placeholder="Buscar producto o escanear código..."
            className="flex-1 border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-3 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-400"
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
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-3 space-y-2">
        {items.length > 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 divide-y divide-gray-50 dark:divide-slate-700 mb-2">
            {items.map(item => (
              <div key={item.id} className="flex items-center gap-3 p-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {formatearNombre(item.nombre)}
                  </p>
                  <p className="text-xs text-gray-400">
                    {item.gramos !== undefined ? `${item.gramos}g` : `${item.cantidad}×`}
                    {' · '}{formatBS(itemSubtotalBs(item))}
                  </p>
                </div>
                {item.gramos === undefined ? (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => actualizarCantidad(item.id, -1)}
                      className="w-7 h-7 rounded-full bg-gray-100 dark:bg-slate-700 flex items-center justify-center text-gray-600 dark:text-gray-300 font-bold"
                    >
                      −
                    </button>
                    <span className="w-5 text-center text-sm font-semibold text-gray-800 dark:text-gray-200">{item.cantidad}</span>
                    <button
                      onClick={() => actualizarCantidad(item.id, 1)}
                      className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-700 dark:text-emerald-400 font-bold"
                    >
                      +
                    </button>
                  </div>
                ) : null}
                <button onClick={() => quitarItem(item.id)} className="text-gray-300 flex-shrink-0" aria-label="Quitar">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {productosFiltrados.length === 0 ? (
          <div className="text-center text-gray-400 py-12">
            <p>{busqueda ? `No se encontró "${busqueda}"` : 'Sin productos'}</p>
          </div>
        ) : (
          productosFiltrados.map(producto => {
            const pbs = tasa > 0 ? precioBS(producto, tasa) : null;
            const pusd = tasa > 0 ? precioUSD(producto, tasa) : null;
            return (
              <button
                key={producto.id}
                onClick={() => agregarItem(producto)}
                className="w-full bg-white dark:bg-slate-800 rounded-xl p-3 flex items-center gap-3 shadow-sm border border-gray-100 dark:border-slate-700 text-left"
              >
                <div className={`w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center ${avatarColor(producto.nombre)}`}>
                  <span className="text-white font-bold text-sm">{producto.nombre.charAt(0).toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-gray-900 dark:text-white truncate">
                    {formatearNombre(producto.nombre)}{producto.por_peso ? ' /kg' : ''}
                  </p>
                  {pbs !== null ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {formatBS(pbs)}{pusd !== null && ` · ${formatUSD(pusd)}`}
                    </p>
                  ) : (
                    <p className="text-xs text-gray-400">Tasa no configurada</p>
                  )}
                </div>
                {usaStock && (
                  <StockBadge
                    stock={producto.stock}
                    stockMinimo={producto.stock_minimo}
                    controlaStock={producto.controla_stock}
                    esPorPeso={producto.por_peso}
                    isOnline={isOnline}
                    ultimaSincronizacion={ultimaSincronizacion}
                  />
                )}
              </button>
            );
          })
        )}
      </div>

      <div className="p-4 border-t border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-800 space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cliente (opcional)</label>
          <input
            type="text"
            value={clienteNombre}
            onChange={e => setClienteNombre(e.target.value)}
            placeholder="Nombre del cliente"
            className="w-full border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-2.5 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-400"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Válido hasta</label>
          <input
            type="date"
            value={fechaVencimiento}
            min={hoyISO()}
            onChange={e => setFechaVencimiento(e.target.value)}
            className="w-full border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-2.5 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-400"
          />
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <div className="flex items-center justify-between pt-1">
          <div>
            <p className="text-xs text-gray-400">Total</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{formatBS(totalBs)}</p>
            {tasa > 0 && <p className="text-xs text-gray-400">{formatUSD(totalUsd)}</p>}
          </div>
          <button
            onClick={guardarPresupuesto}
            disabled={guardando || items.length === 0}
            className="bg-emerald-600 text-white px-6 py-3.5 rounded-xl font-bold disabled:opacity-40"
          >
            {guardando ? 'Guardando...' : 'Guardar presupuesto'}
          </button>
        </div>
      </div>

      {/* Weight input modal */}
      {showPeso && productoPeso && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowPeso(false)} />
          <div className="relative w-full max-w-lg mx-auto bg-white dark:bg-slate-800 rounded-t-2xl">
            <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-slate-700">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">{formatearNombre(productoPeso.nombre)}</h2>
              <button onClick={() => setShowPeso(false)} className="p-1 text-gray-400">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4">
              <label className="block text-sm text-gray-500 mb-1">Peso (gramos)</label>
              <input
                type="number"
                step="1"
                value={gramos}
                onChange={e => setGramos(e.target.value)}
                className="w-full border border-gray-300 dark:border-slate-600 rounded-xl p-3 text-xl font-bold bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-400"
                placeholder="0"
                autoFocus
              />
              {tasa > 0 && parseFloat(gramos) > 0 && (
                <p className="text-center text-lg font-bold text-emerald-700 dark:text-emerald-400 mt-3">
                  {formatBS(precioBS(productoPeso, tasa) * (parseFloat(gramos) / 1000))}
                </p>
              )}
            </div>
            <div className="p-4 border-t border-gray-100 dark:border-slate-700">
              <button
                onClick={agregarPorPeso}
                disabled={!gramos || parseFloat(gramos) <= 0}
                className="w-full bg-emerald-600 text-white py-4 rounded-xl text-lg font-bold disabled:opacity-40"
              >
                Agregar
              </button>
            </div>
          </div>
        </div>
      )}

      {showScanner && <Scanner continuous onDetect={handleScan} onClose={() => setShowScanner(false)} />}

      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-5 py-2.5 rounded-xl text-sm font-medium z-50 shadow-lg max-w-xs text-center">
          {toast}
        </div>
      )}
    </div>
  );
}
