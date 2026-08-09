'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Producto, ItemCarrito, MetodoPago, Venta, VentaItem } from '@/types';
import { getProductos, getProductoPorCodigo, saveVenta } from '@/lib/db';
import { precioBS, precioUSD, formatBS, formatUSD } from '@/lib/precio';
import { useApp } from '@/components/Providers';
import Scanner from '@/components/Scanner';
import ThemeToggle from '@/components/ThemeToggle';
import { supabase } from '@/lib/supabase';

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

let audioCtx: AudioContext | null = null;

function reproducirBeep() {
  try {
    if (!audioCtx) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audioCtx = new ((window as any).AudioContext || (window as any).webkitAudioContext)();
    }
    const osc = audioCtx!.createOscillator();
    const gain = audioCtx!.createGain();
    osc.connect(gain);
    gain.connect(audioCtx!.destination);
    osc.frequency.value = 1800;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.15, audioCtx!.currentTime);
    osc.start();
    osc.stop(audioCtx!.currentTime + 0.1);
  } catch {
    // Audio not supported
  }
}

const METODOS_PAGO: { id: MetodoPago; label: string }[] = [
  { id: 'efectivo_bs', label: 'Efectivo Bs' },
  { id: 'pago_movil', label: 'Pago Móvil' },
  { id: 'biopago', label: 'Biopago' },
  { id: 'tarjeta', label: 'Tarjeta' },
  { id: 'efectivo_usd', label: 'Efectivo $' },
];

export default function CajaPage() {
  const { tasa, isOnline, negocioNombre, signOut, user, pendientesCount } = useApp();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const [showCarrito, setShowCarrito] = useState(false);
  const [showPago, setShowPago] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showPeso, setShowPeso] = useState(false);
  const [productoPeso, setProductoPeso] = useState<Producto | null>(null);
  const [gramos, setGramos] = useState('');
  const [metodo, setMetodo] = useState<MetodoPago | null>(null);
  const [montoRecibido, setMontoRecibido] = useState('');
  const [toast, setToast] = useState('');
  const [showPerfil, setShowPerfil] = useState(false);
  const [passActual, setPassActual] = useState('');
  const [passNueva, setPassNueva] = useState('');
  const [passConfirmar, setPassConfirmar] = useState('');
  const [passError, setPassError] = useState('');
  const [passCargando, setPassCargando] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getProductos().then(setProductos);
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  const abrirPerfil = () => {
    setPassActual('');
    setPassNueva('');
    setPassConfirmar('');
    setPassError('');
    setShowPerfil(true);
  };

  const cambiarPassword = async () => {
    setPassError('');
    if (passNueva !== passConfirmar) {
      setPassError('Las contraseñas no coinciden');
      return;
    }
    if (passNueva.length < 6) {
      setPassError('La nueva contraseña debe tener al menos 6 caracteres');
      return;
    }
    setPassCargando(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user?.email ?? '',
      password: passActual,
    });
    if (signInError) {
      setPassError('Contraseña actual incorrecta');
      setPassCargando(false);
      return;
    }
    const { error: updateError } = await supabase.auth.updateUser({ password: passNueva });
    setPassCargando(false);
    if (updateError) {
      setPassError('Error al actualizar la contraseña');
      return;
    }
    setShowPerfil(false);
    showToast('Contraseña actualizada');
  };

  const productosFiltrados = busqueda
    ? productos.filter(
        p =>
          p.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
          (p.codigo_barra && p.codigo_barra.includes(busqueda))
      )
    : productos;

  // Returns the Bs price for a single cart line (handles both regular and weight items)
  const itemPrecioBS = useCallback((item: ItemCarrito): number => {
    if (item.esPorPeso && item.precioCalculadoBase !== undefined) {
      return item.producto.moneda === 'USD'
        ? item.precioCalculadoBase * tasa
        : item.precioCalculadoBase;
    }
    return precioBS(item.producto, tasa) * item.cantidad;
  }, [tasa]);

  const agregarAlCarrito = useCallback((producto: Producto) => {
    if (producto.por_peso) {
      setProductoPeso(producto);
      setGramos('');
      setShowPeso(true);
      return;
    }
    setCarrito(prev => {
      const existing = prev.find(i => i.lineId === producto.id);
      if (existing) {
        return prev.map(i =>
          i.lineId === producto.id ? { ...i, cantidad: i.cantidad + 1 } : i
        );
      }
      return [...prev, { lineId: producto.id, producto, cantidad: 1 }];
    });
    showToast(`${producto.nombre} agregado`);
    reproducirBeep();
  }, []);

  const agregarPorPeso = () => {
    if (!productoPeso) return;
    const g = parseFloat(gramos);
    if (!g || g <= 0) return;
    const precioCalculadoBase = productoPeso.precio * (g / 1000);
    setCarrito(prev => [...prev, {
      lineId: crypto.randomUUID(),
      producto: productoPeso,
      cantidad: 1,
      esPorPeso: true,
      gramos: g,
      precioCalculadoBase,
    }]);
    setShowPeso(false);
    setProductoPeso(null);
    showToast(`${productoPeso.nombre} ${g}g agregado`);
    reproducirBeep();
  };

  const actualizarCantidad = (lineId: string, delta: number) => {
    setCarrito(prev => {
      const updated = prev.map(i =>
        i.lineId === lineId ? { ...i, cantidad: i.cantidad + delta } : i
      );
      return updated.filter(i => i.cantidad > 0);
    });
  };

  const removerItem = (lineId: string) => {
    setCarrito(prev => prev.filter(i => i.lineId !== lineId));
  };

  const totalBS = carrito.reduce((sum, item) => sum + itemPrecioBS(item), 0);
  const totalUSD = tasa > 0 ? totalBS / tasa : 0;
  const totalItems = carrito.reduce((sum, i) => sum + (i.esPorPeso ? 1 : i.cantidad), 0);

  const handleScan = useCallback(async (codigo: string): Promise<{ nombre: string } | null> => {
    const producto = await getProductoPorCodigo(codigo);
    if (producto) {
      agregarAlCarrito(producto);
      return { nombre: producto.nombre };
    }
    return null;
  }, [agregarAlCarrito]);

  const confirmarVenta = async () => {
    if (!metodo) return;
    const now = new Date();
    const items: VentaItem[] = carrito.map(item => {
      if (item.esPorPeso) {
        const precio_bs = itemPrecioBS(item);
        return {
          producto_id: item.producto.id,
          nombre: `${item.producto.nombre} — ${item.gramos}g`,
          precio_bs,
          cantidad: 1,
          subtotal_bs: precio_bs,
          gramos: item.gramos,
        };
      }
      const precio_bs = precioBS(item.producto, tasa);
      return {
        producto_id: item.producto.id,
        nombre: item.producto.nombre,
        precio_bs,
        cantidad: item.cantidad,
        subtotal_bs: precio_bs * item.cantidad,
      };
    });

    const venta: Venta = {
      id: crypto.randomUUID(),
      fecha: now.toISOString(),
      fecha_dia: now.toISOString().split('T')[0],
      items,
      metodo_pago: metodo,
      total_bs: totalBS,
      total_usd: totalUSD,
      tasa_usada: tasa,
    };

    await saveVenta(venta);
    setCarrito([]);
    setShowPago(false);
    setMetodo(null);
    setMontoRecibido('');
    showToast('Venta registrada');
  };

  const cambioBS =
    metodo === 'efectivo_bs' ? (parseFloat(montoRecibido) || 0) - totalBS : null;
  const cambioUSD =
    metodo === 'efectivo_usd' ? (parseFloat(montoRecibido) || 0) - totalUSD : null;
  const cambio = cambioBS ?? cambioUSD;
  const puedeConfirmar =
    metodo !== null &&
    (metodo === 'efectivo_bs' || metodo === 'efectivo_usd'
      ? (cambio ?? -1) >= 0
      : true);

  // Live preview for weight modal
  const gramosNum = parseFloat(gramos);
  const pesoPreviewBase = productoPeso && gramosNum > 0
    ? productoPeso.precio * (gramosNum / 1000)
    : 0;
  const pesoPreviewBS = productoPeso && pesoPreviewBase > 0
    ? (productoPeso.moneda === 'USD' ? (tasa > 0 ? pesoPreviewBase * tasa : null) : pesoPreviewBase)
    : null;
  const pesoPreviewUSD = productoPeso && pesoPreviewBase > 0
    ? (productoPeso.moneda === 'USD' ? pesoPreviewBase : (tasa > 0 ? pesoPreviewBase / tasa : null))
    : null;

  return (
    <div className="flex flex-col h-screen max-h-screen">
      {/* Header */}
      <header className="bg-emerald-600 text-white px-4 pt-4 pb-3 flex items-center justify-between sticky top-0 z-30">
        <button
          onClick={abrirPerfil}
          className="flex items-center gap-1.5 min-w-0 text-left"
          aria-label="Ver perfil del negocio"
        >
          <h1 className="text-xl font-bold truncate">
            Caja
            {negocioNombre && (
              <span className="font-normal text-emerald-200"> · {negocioNombre}</span>
            )}
          </h1>
          <svg
            className={`w-4 h-4 text-emerald-200 flex-shrink-0 transition-transform ${showPerfil ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <div className="flex items-center gap-2 flex-shrink-0">
          <ThemeToggle />
          <div className="flex items-center gap-1.5 text-sm">
            <span
              className={`w-2 h-2 rounded-full ${
                !isOnline ? 'bg-gray-300' : pendientesCount > 0 ? 'bg-amber-300 animate-pulse' : 'bg-emerald-300'
              }`}
            />
            <span className="text-emerald-100 text-xs hidden sm:inline">
              {!isOnline
                ? 'Sin conexión'
                : pendientesCount > 0
                  ? `Sincronizando… ${pendientesCount}`
                  : 'En línea'}
            </span>
          </div>
        </div>
      </header>

      {!isOnline && pendientesCount > 0 && (
        <div className="mx-4 mt-3 p-2.5 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-gray-600 dark:text-gray-300 text-xs text-center">
          {pendientesCount} cambio{pendientesCount === 1 ? '' : 's'} guardado{pendientesCount === 1 ? '' : 's'} en el dispositivo, pendiente{pendientesCount === 1 ? '' : 's'} de sincronizar
        </div>
      )}

      {/* Search */}
      <div className="px-4 py-3 bg-white border-b border-gray-200 flex gap-2">
        <div className="flex-1 relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref={searchRef}
            type="text"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar producto..."
            className="w-full pl-9 pr-8 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-400"
          />
          {busqueda && (
            <button
              onClick={() => setBusqueda('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>
        <button
          onClick={() => setShowScanner(true)}
          className="bg-emerald-600 text-white p-2.5 rounded-xl flex items-center justify-center"
          aria-label="Escanear código"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
            />
          </svg>
        </button>
      </div>

      {tasa === 0 && (
        <div className="mx-4 mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm text-center">
          Configura la tasa BCV para ver precios en Bs
        </div>
      )}

      {/* Product list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {productos.length === 0 ? (
          <div className="text-center text-gray-400 py-16">
            <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
            </svg>
            <p className="font-medium">Sin productos</p>
            <p className="text-sm mt-1">Agrega productos en Inventario</p>
          </div>
        ) : productosFiltrados.length === 0 ? (
          <div className="text-center text-gray-400 py-12">
            <p>No se encontró &ldquo;{busqueda}&rdquo;</p>
          </div>
        ) : (
          productosFiltrados.map(producto => {
            const pbs = tasa > 0 ? precioBS(producto, tasa) : null;
            const pusd = tasa > 0 ? precioUSD(producto, tasa) : null;
            const enCarrito = !producto.por_peso
              ? carrito.find(i => i.lineId === producto.id)
              : null;
            const pesoCount = producto.por_peso
              ? carrito.filter(i => i.producto.id === producto.id).length
              : 0;

            return (
              <div
                key={producto.id}
                className="bg-white rounded-xl p-4 flex items-start gap-3 shadow-sm border border-gray-100"
              >
                <div className={`w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center ${avatarColor(producto.nombre)}`}>
                  <span className="text-white font-bold text-sm">{producto.nombre.charAt(0).toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="font-medium text-gray-900">{formatearNombre(producto.nombre)}</p>
                    {producto.por_peso && (
                      <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium flex-shrink-0">
                        /kg
                      </span>
                    )}
                  </div>
                  {pbs !== null ? (
                    <>
                      <p className="text-2xl font-bold text-gray-900 mt-0.5">
                        {formatBS(pbs)}
                        {producto.por_peso && <span className="text-sm font-normal text-gray-400"> / kg</span>}
                      </p>
                      <p className="text-sm text-gray-400">
                        {pusd !== null ? formatUSD(pusd) : ''}
                        {producto.por_peso ? ' / kg' : ''}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-400 mt-1">
                      {producto.precio.toLocaleString('es-VE')} {producto.moneda}
                      {producto.por_peso ? ' / kg' : ''} · tasa no configurada
                    </p>
                  )}
                </div>

                {producto.por_peso ? (
                  <button
                    onClick={() => agregarAlCarrito(producto)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-emerald-600 text-white"
                  >
                    {pesoCount > 0 && (
                      <span className="bg-white/30 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                        {pesoCount}
                      </span>
                    )}
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                    </svg>
                  </button>
                ) : (
                  <button
                    onClick={() => agregarAlCarrito(producto)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${
                      enCarrito
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-emerald-600 text-white'
                    }`}
                  >
                    {enCarrito ? (
                      <>
                        <span>{enCarrito.cantidad}</span>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </>
                    ) : (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    )}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Floating cart */}
      {totalItems > 0 && !showCarrito && !showPago && (
        <button
          onClick={() => setShowCarrito(true)}
          className="fixed bottom-20 right-4 bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-xl shadow-emerald-900/30 flex items-center gap-2 z-30"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
          <span key={totalItems} className="font-bold animate-cart-pop">{totalItems}</span>
          <span className="hidden sm:inline">·</span>
          <span className="font-semibold text-sm hidden sm:inline">{formatBS(totalBS)}</span>
        </button>
      )}

      {/* Cart bottom sheet */}
      {showCarrito && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowCarrito(false)} />
          <div className="relative w-full max-w-lg mx-auto bg-white rounded-t-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h2 className="text-lg font-bold">Tu carrito</h2>
              <button onClick={() => setShowCarrito(false)} className="p-1 text-gray-400">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {carrito.map(item => (
                <div key={item.lineId} className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">
                      {formatearNombre(item.producto.nombre)}
                      {item.esPorPeso && item.gramos && (
                        <span className="text-gray-400"> — {item.gramos}g</span>
                      )}
                    </p>
                    <p className="text-emerald-700 font-bold">
                      {formatBS(itemPrecioBS(item))}
                    </p>
                  </div>

                  {item.esPorPeso ? (
                    // Weight items: just a remove button, no quantity stepper
                    <button
                      onClick={() => removerItem(item.lineId)}
                      className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center text-red-400 flex-shrink-0"
                      aria-label="Eliminar"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  ) : (
                    // Regular items: quantity stepper
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => actualizarCantidad(item.lineId, -1)}
                        className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-lg font-bold text-gray-700"
                      >
                        −
                      </button>
                      <span className="w-6 text-center font-semibold">{item.cantidad}</span>
                      <button
                        onClick={() => actualizarCantidad(item.lineId, 1)}
                        className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-lg font-bold text-emerald-700"
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-gray-100">
              <div className="flex justify-between items-center mb-3">
                <span className="text-gray-600">Total</span>
                <div className="text-right">
                  <p className="text-2xl font-bold text-gray-900">{formatBS(totalBS)}</p>
                  {tasa > 0 && <p className="text-sm text-gray-400">{formatUSD(totalUSD)}</p>}
                </div>
              </div>
              <button
                onClick={() => { setShowCarrito(false); setShowPago(true); }}
                className="w-full bg-emerald-600 text-white py-4 rounded-xl text-lg font-bold"
              >
                Cobrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment sheet */}
      {showPago && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setShowPago(false); setShowCarrito(true); }} />
          <div className="relative w-full max-w-lg mx-auto bg-white rounded-t-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h2 className="text-lg font-bold">Método de pago</h2>
              <button
                onClick={() => { setShowPago(false); setShowCarrito(true); }}
                className="p-1 text-gray-400"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <div className="text-center py-4 mb-4 bg-emerald-50 rounded-xl">
                <p className="text-3xl font-bold text-emerald-700">{formatBS(totalBS)}</p>
                {tasa > 0 && <p className="text-gray-500 text-sm mt-1">{formatUSD(totalUSD)}</p>}
              </div>

              <div className="grid grid-cols-3 gap-2 mb-4">
                {METODOS_PAGO.map(m => (
                  <button
                    key={m.id}
                    onClick={() => { setMetodo(m.id); setMontoRecibido(''); }}
                    className={`py-3 px-2 rounded-xl text-sm font-medium transition-colors text-center ${
                      metodo === m.id
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {(metodo === 'efectivo_bs' || metodo === 'efectivo_usd') && (
                <div className="mb-4">
                  <label className="block text-sm text-gray-500 mb-1">
                    Monto recibido ({metodo === 'efectivo_bs' ? 'Bs' : '$'})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={montoRecibido}
                    onChange={e => setMontoRecibido(e.target.value)}
                    className="w-full border border-gray-300 rounded-xl p-3 text-xl font-bold focus:outline-none focus:border-emerald-400"
                    placeholder="0.00"
                    autoFocus
                  />
                  {montoRecibido && cambio !== null && (
                    <div
                      className={`mt-3 text-center text-xl font-bold py-3 rounded-xl ${
                        cambio >= 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                      }`}
                    >
                      {cambio >= 0
                        ? `Cambio: ${metodo === 'efectivo_bs' ? formatBS(cambio) : formatUSD(cambio)}`
                        : `Faltan: ${metodo === 'efectivo_bs' ? formatBS(-cambio) : formatUSD(-cambio)}`}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-100">
              <button
                onClick={confirmarVenta}
                disabled={!puedeConfirmar}
                className="w-full bg-emerald-600 text-white py-4 rounded-xl text-lg font-bold disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Confirmar Venta
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Weight input modal */}
      {showPeso && productoPeso && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowPeso(false)} />
          <div className="relative w-full max-w-lg mx-auto bg-white rounded-t-2xl">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold">Pesar {productoPeso.nombre}</h2>
                <p className="text-sm text-gray-400">
                  {tasa > 0
                    ? `${formatBS(precioBS(productoPeso, tasa))} / kg`
                    : `${productoPeso.precio} ${productoPeso.moneda} / kg`}
                </p>
              </div>
              <button onClick={() => setShowPeso(false)} className="p-1 text-gray-400">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4 space-y-4">
              <input
                type="number"
                inputMode="numeric"
                step="1"
                min="1"
                value={gramos}
                onChange={e => setGramos(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && agregarPorPeso()}
                placeholder="Gramos"
                className="w-full border border-gray-200 rounded-xl px-4 py-4 text-3xl font-bold text-center focus:outline-none focus:border-emerald-400"
                autoFocus
              />

              {pesoPreviewBS !== null || pesoPreviewUSD !== null ? (
                <div className="text-center py-3 bg-emerald-50 rounded-xl">
                  {pesoPreviewBS !== null && (
                    <p className="text-2xl font-bold text-gray-900">{formatBS(pesoPreviewBS)}</p>
                  )}
                  {pesoPreviewUSD !== null && (
                    <p className="text-sm text-gray-400 mt-0.5">{formatUSD(pesoPreviewUSD)}</p>
                  )}
                </div>
              ) : gramosNum > 0 ? (
                <div className="text-center py-3 bg-gray-50 rounded-xl">
                  <p className="text-sm text-gray-400">Configura la tasa BCV para ver precio en Bs</p>
                </div>
              ) : null}

              <button
                onClick={agregarPorPeso}
                disabled={!gramos || gramosNum <= 0}
                className="w-full bg-emerald-600 text-white py-4 rounded-xl text-lg font-bold disabled:opacity-40"
              >
                Agregar al carrito
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scanner */}
      {showScanner && <Scanner continuous onDetect={handleScan} onClose={() => setShowScanner(false)} />}

      {/* Profile sheet */}
      {showPerfil && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowPerfil(false)} />
          <div className="relative w-full max-w-lg mx-auto bg-white dark:bg-slate-800 rounded-t-2xl max-h-[90vh] overflow-y-auto flex flex-col">
            {/* Drag handle + close */}
            <div className="flex items-center justify-between px-4 pt-4 pb-0">
              <div className="w-8 h-1 bg-gray-200 dark:bg-slate-600 rounded-full mx-auto" />
              <button
                onClick={() => setShowPerfil(false)}
                className="absolute right-4 top-4 p-1 text-gray-400 dark:text-gray-500"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Avatar + negocio */}
            <div className="flex flex-col items-center py-5 px-6">
              <div className="w-20 h-20 rounded-full bg-emerald-600 flex items-center justify-center mb-3 shadow-md">
                <span className="text-white text-3xl font-bold">
                  {(negocioNombre || 'N').charAt(0).toUpperCase()}
                </span>
              </div>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{negocioNombre || 'Negocio'}</p>
              <p className="text-sm text-gray-400 mt-0.5">Sistema de punto de venta</p>
            </div>

            <div className="border-t border-gray-100 dark:border-slate-700 mx-4" />

            {/* Change password */}
            <div className="p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Cambiar contraseña
              </p>
              <input
                type="password"
                inputMode="numeric"
                value={passActual}
                onChange={e => { setPassActual(e.target.value); setPassError(''); }}
                placeholder="Contraseña actual"
                className="w-full border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-3 text-base bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-emerald-400"
              />
              <input
                type="password"
                inputMode="numeric"
                value={passNueva}
                onChange={e => { setPassNueva(e.target.value); setPassError(''); }}
                placeholder="Nueva contraseña"
                className="w-full border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-3 text-base bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-emerald-400"
              />
              <input
                type="password"
                inputMode="numeric"
                value={passConfirmar}
                onChange={e => { setPassConfirmar(e.target.value); setPassError(''); }}
                placeholder="Confirmar nueva contraseña"
                className="w-full border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-3 text-base bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-emerald-400"
              />
              {passError && (
                <p className="text-red-500 dark:text-red-400 text-sm">{passError}</p>
              )}
              <button
                onClick={cambiarPassword}
                disabled={passCargando || !passActual || !passNueva || !passConfirmar}
                className="w-full bg-emerald-600 text-white py-3 rounded-xl font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {passCargando ? 'Guardando...' : 'Guardar contraseña'}
              </button>
            </div>

            <div className="border-t border-gray-100 dark:border-slate-700 mx-4" />

            {/* Logout */}
            <div className="p-4 pb-8">
              <button
                onClick={() => { setShowPerfil(false); signOut(); }}
                className="w-full py-3 rounded-xl font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20"
              >
                Cerrar sesión
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-5 py-2.5 rounded-xl text-sm font-medium z-50 shadow-lg whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  );
}
