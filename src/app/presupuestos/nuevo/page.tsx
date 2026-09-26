'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Producto, PresupuestoItem, Presupuesto } from '@/types';
import { getProductos, getProductoPorCodigo, savePresupuesto, getPresupuestos } from '@/lib/db';
import { encolarCrearPresupuesto } from '@/lib/outbox';
import { precioBS, precioUSD, formatBS, formatUSD } from '@/lib/precio';
import { pareceCodigoBarra } from '@/lib/barcode';
import { debeOcultarStock, stockBajo } from '@/lib/stock';
import { compartirPresupuesto } from '@/lib/comprobante';
import { useApp } from '@/components/Providers';
import { useGuardarRuta } from '@/lib/useGuardarRuta';
import Scanner from '@/components/Scanner';
import ThemeToggle from '@/components/ThemeToggle';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import BottomSheet from '@/components/ui/BottomSheet';
import Icon from '@/components/ui/Icon';
import { TAMANO_ICONO } from '@/components/ui/iconos';

// Identidad visual por producto en el catálogo — misma paleta que
// COLORES_AVATAR/colorAvatar de Fiado (mismo propósito, no dos paletas
// "crudas" distintas en el proyecto), no un token semántico del sistema.
const COLORES_AVATAR = ['#8B5CF6', '#3B82F6', '#06B6D4', '#14B8A6', '#10B981', '#F59E0B', '#F97316', '#EC4899'];
function avatarColor(nombre: string): string {
  return COLORES_AVATAR[nombre.charCodeAt(0) % COLORES_AVATAR.length];
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

// Mismo criterio que el componente compartido StockBadge.tsx (que sigue
// usando la Caja real, sin rediseñar — no se toca, mismo trato que ya se le
// dio en Inventario) — versión local retokenizada, misma lógica de
// debeOcultarStock/stockBajo, sin ícono (esto es una fila de catálogo
// chica, no la tarjeta grande de Inventario).
function stockBadge(
  producto: Producto,
  isOnline: boolean,
  ultimaSincronizacion: string | null
): { texto: string; clase: string } | null {
  if (producto.controla_stock === false || producto.stock == null) return null;
  if (debeOcultarStock(producto.stock, producto.stock_minimo, isOnline, ultimaSincronizacion)) {
    return { texto: 'Consultar', clase: 'bg-aviso-fondo text-aviso' };
  }
  const bajo = stockBajo(producto.stock, producto.stock_minimo);
  const texto = producto.por_peso
    ? `${producto.stock.toLocaleString('es-VE', { maximumFractionDigits: 2 })} kg`
    : `${Math.round(producto.stock)}`;
  return { texto, clase: bajo ? 'bg-negativo-fondo text-negativo' : 'bg-tarjeta-hundida text-texto-2' };
}

export default function NuevoPresupuestoPage() {
  const permitida = useGuardarRuta();
  const router = useRouter();
  const { tasa, isOnline, usaStock, ultimaSincronizacion, negocioId, user, userNombre, negocioNombre, datosNegocio, productosVersion } = useApp();

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
  const [numeroGuardado, setNumeroGuardado] = useState(0);
  const [compartiendo, setCompartiendo] = useState(false);
  // Mismo criterio que showCarrito/showPago en Caja — el catálogo ocupa
  // toda la pantalla, y el carrito/los datos del presupuesto viven en
  // hojas inferiores que se abren desde el botón flotante.
  const [showCarrito, setShowCarrito] = useState(false);
  const [showDatos, setShowDatos] = useState(false);
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

  if (!permitida) return null;

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

    // Correlativo por orden de creación — mismo criterio que "Venta #N" en
    // Resumen, calculado en el cliente sobre todo lo que este dispositivo
    // conoce (no hay concepto de "período" para presupuestos).
    const todos = await getPresupuestos();
    const ordenados = [...todos].sort((a, b) => a.creado_en.localeCompare(b.creado_en));
    const numero = ordenados.findIndex(p => p.id === presupuesto.id) + 1;

    setGuardando(false);
    setGuardado(presupuesto);
    setNumeroGuardado(numero > 0 ? numero : ordenados.length);
  };

  const compartir = async () => {
    if (!guardado) return;
    setCompartiendo(true);
    try {
      await compartirPresupuesto({
        negocioNombre: negocioNombre || '',
        datosNegocio,
        presupuesto: guardado,
        numero: numeroGuardado,
      });
    } catch {
      showToast('No se pudo generar el documento');
    } finally {
      setCompartiendo(false);
    }
  };

  if (guardado) {
    return (
      <div className="flex flex-col h-screen max-h-screen items-center justify-center p-6 text-center">
        <div className="w-16 h-16 bg-marca-suave rounded-full flex items-center justify-center mb-3">
          <Icon nombre="confirmar" tamano={32} className="text-marca-suave-texto" />
        </div>
        <h1 className="text-lg font-bold text-texto">Presupuesto guardado</h1>
        <p className="text-2xl font-bold text-marca mt-1 tabular-nums">{formatBS(guardado.total_bs_estimado)}</p>
        {tasa > 0 && <p className="text-texto-4 text-sm tabular-nums">{formatUSD(guardado.total_usd)}</p>}

        <div className="w-full max-w-sm mt-6 flex flex-col gap-2">
          <Button variante="primario" onClick={compartir} disabled={compartiendo} className="w-full">
            <Icon nombre="compartir" tamano={TAMANO_ICONO.secundario} />
            {compartiendo ? 'Generando...' : 'Compartir presupuesto'}
          </Button>
          <button
            onClick={() => router.push('/presupuestos')}
            className="w-full h-[52px] rounded-[12px] border border-borde-tarjeta text-texto-3 font-semibold"
          >
            Ver lista de presupuestos
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen max-h-screen">
      <header className="bg-superficie-barra border-b border-borde-divisor px-4 pt-3.5 pb-3 flex items-center gap-2.5 sticky top-0 z-30">
        <button onClick={() => router.back()} className="p-1 -ml-1 flex-shrink-0 text-texto-3" aria-label="Volver">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-texto truncate">Nuevo presupuesto</h1>
        </div>
        <ThemeToggle variant="neutro" />
      </header>

      <div className="p-4 pb-2">
        <div className="flex gap-2">
          <Input
            ref={searchRef}
            type="text"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            onKeyDown={handleBuscadorKeyDown}
            placeholder="Buscar producto o escanear código..."
            className="flex-1"
          />
          <button
            type="button"
            onClick={() => setShowScanner(true)}
            aria-label="Escanear código"
            className="flex-shrink-0 w-[52px] h-[52px] rounded-[12px] bg-tarjeta-hundida text-texto-2 flex items-center justify-center"
          >
            <Icon nombre="escanearCodigoBarras" tamano={TAMANO_ICONO.secundario} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-3 space-y-2">
        {productosFiltrados.length === 0 ? (
          <div className="text-center text-texto-3 py-12">
            <p>{busqueda ? `No se encontró "${busqueda}"` : 'Sin productos'}</p>
          </div>
        ) : (
          productosFiltrados.map(producto => {
            const pbs = tasa > 0 ? precioBS(producto, tasa) : null;
            const pusd = tasa > 0 ? precioUSD(producto, tasa) : null;
            const badge = stockBadge(producto, isOnline, ultimaSincronizacion);
            return (
              <button
                key={producto.id}
                onClick={() => agregarItem(producto)}
                className="w-full bg-tarjeta rounded-2xl p-3 flex items-center gap-3 border border-borde-tarjeta text-left"
              >
                <div
                  className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center"
                  style={{ backgroundColor: avatarColor(producto.nombre) }}
                >
                  <span className="text-texto-invertido font-bold text-sm">{producto.nombre.charAt(0).toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-texto truncate">
                    {formatearNombre(producto.nombre)}{producto.por_peso ? ' /kg' : ''}
                  </p>
                  {pbs !== null ? (
                    <p className="text-sm text-texto-3">
                      {formatBS(pbs)}{pusd !== null && ` · ${formatUSD(pusd)}`}
                    </p>
                  ) : (
                    <p className="text-xs text-texto-4">Tasa no configurada</p>
                  )}
                </div>
                {usaStock && badge && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${badge.clase}`}>
                    {badge.texto}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Floating cart — mismo criterio que Caja: solo si hay items y
          ninguna hoja está abierta. */}
      {items.length > 0 && !showCarrito && !showDatos && (
        <button
          onClick={() => setShowCarrito(true)}
          className="fixed bottom-20 right-4 bg-marca text-texto-invertido px-5 py-3 rounded-2xl shadow-[0_8px_24px_rgba(4,135,90,0.35)] flex items-center gap-2 z-30"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
          <span key={items.length} className="font-bold animate-cart-pop">{items.length}</span>
          <span className="hidden sm:inline">·</span>
          <span className="font-semibold text-sm hidden sm:inline">{formatBS(totalBs)}</span>
        </button>
      )}

      {/* Cart bottom sheet — mismo patrón que Caja: acá el usuario ajusta
          cantidades y quita items antes de pasar a los datos del
          presupuesto. La lista de arriba desapareció apenas se hacía
          scroll al catálogo; acá siempre queda a un toque del botón
          flotante. */}
      <BottomSheet abierto={showCarrito} onCerrar={() => setShowCarrito(false)} titulo="Tu presupuesto">
        <div className="flex flex-col gap-2">
          {items.map(item => (
            <div key={item.id} className="flex items-center gap-3 bg-tarjeta-hundida rounded-[12px] p-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-texto truncate">{formatearNombre(item.nombre)}</p>
                <p className="text-xs text-texto-4">
                  {item.gramos !== undefined ? `${item.gramos}g` : `${item.cantidad}×`}
                  {' · '}{formatBS(itemSubtotalBs(item))}
                </p>
              </div>
              {item.gramos === undefined && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => actualizarCantidad(item.id, -1)}
                    className="w-7 h-7 rounded-full bg-tarjeta flex items-center justify-center text-texto-2 font-bold"
                  >
                    −
                  </button>
                  <span className="w-5 text-center text-sm font-semibold text-texto">{item.cantidad}</span>
                  <button
                    onClick={() => actualizarCantidad(item.id, 1)}
                    className="w-7 h-7 rounded-full bg-marca-suave flex items-center justify-center text-marca-suave-texto font-bold"
                  >
                    +
                  </button>
                </div>
              )}
              <button onClick={() => quitarItem(item.id)} className="text-texto-4 flex-shrink-0" aria-label="Quitar">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-4 border-t border-borde-divisor">
          <div className="flex justify-between items-center mb-3">
            <span className="text-texto-2">Total</span>
            <div className="text-right">
              <p className="text-2xl font-bold text-texto tabular-nums">{formatBS(totalBs)}</p>
              {tasa > 0 && <p className="text-sm text-texto-4 tabular-nums">{formatUSD(totalUsd)}</p>}
            </div>
          </div>
          <Button variante="primario" onClick={() => { setShowCarrito(false); setShowDatos(true); }} className="w-full">
            Continuar
          </Button>
        </div>
      </BottomSheet>

      {/* Datos del presupuesto — mismo patrón de hoja que Caja para la
          hoja de pago: tocar el backdrop vuelve al carrito, no pierde
          todo. */}
      <BottomSheet
        abierto={showDatos}
        onCerrar={() => { setShowDatos(false); setShowCarrito(true); }}
        titulo="Datos del presupuesto"
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            {clienteNombre.trim() && (
              <div
                className="flex-none w-9 h-9 rounded-full flex items-center justify-center text-texto-invertido font-bold text-sm"
                style={{ backgroundColor: avatarColor(clienteNombre.trim()) }}
              >
                {clienteNombre.trim().charAt(0).toUpperCase()}
              </div>
            )}
            <Input
              label="Cliente (opcional)"
              value={clienteNombre}
              onChange={e => setClienteNombre(e.target.value)}
              placeholder="Nombre del cliente"
              className="flex-1"
            />
          </div>
          <Input
            label="Válido hasta"
            type="date"
            value={fechaVencimiento}
            min={hoyISO()}
            onChange={e => setFechaVencimiento(e.target.value)}
          />
          <p className="text-xs text-texto-4 -mt-1.5">
            Después de esa fecha el presupuesto queda vencido y los precios se recalculan al pasarlo a cobro.
          </p>

          <div className="p-3 rounded-[12px] bg-tarjeta-hundida">
            <p className="text-xs text-texto-4">Total</p>
            <p className="text-xl font-bold text-texto tabular-nums">{formatBS(totalBs)}</p>
            {tasa > 0 && <p className="text-xs text-texto-4 tabular-nums">{formatUSD(totalUsd)}</p>}
          </div>

          {error && <p className="text-sm text-negativo">{error}</p>}
        </div>
        <div className="mt-4">
          <Button variante="primario" onClick={guardarPresupuesto} disabled={guardando || items.length === 0} className="w-full">
            {guardando ? 'Guardando...' : 'Guardar presupuesto'}
          </Button>
        </div>
      </BottomSheet>

      {/* Weight input sheet */}
      <BottomSheet
        abierto={showPeso}
        onCerrar={() => setShowPeso(false)}
        titulo={productoPeso ? formatearNombre(productoPeso.nombre) : undefined}
      >
        {productoPeso && (
          <>
            <Input
              label="Peso (gramos)"
              type="number"
              step="1"
              value={gramos}
              onChange={e => setGramos(e.target.value)}
              className="text-xl font-bold"
              placeholder="0"
              autoFocus
            />
            {tasa > 0 && parseFloat(gramos) > 0 && (
              <p className="text-center text-lg font-bold text-marca mt-3 tabular-nums">
                {formatBS(precioBS(productoPeso, tasa) * (parseFloat(gramos) / 1000))}
              </p>
            )}
            <Button variante="primario" onClick={agregarPorPeso} disabled={!gramos || parseFloat(gramos) <= 0} className="w-full mt-4">
              Agregar
            </Button>
          </>
        )}
      </BottomSheet>

      {showScanner && <Scanner continuous onDetect={handleScan} onClose={() => setShowScanner(false)} />}

      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-toast-fondo text-toast-texto px-5 py-2.5 rounded-xl text-sm font-medium z-50 shadow-lg max-w-xs text-center">
          {toast}
        </div>
      )}
    </div>
  );
}
