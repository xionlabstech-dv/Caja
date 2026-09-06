'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Producto, ItemCarrito, MetodoPago, MetodoPagoVenta, PagoVenta, Venta, VentaItem, MovimientoStock, ClienteFiado, MovimientoFiado, Presupuesto } from '@/types';
import {
  getProductos,
  getProductoPorCodigo,
  saveVenta,
  setCachedUsaCostos,
  setCachedUsaStock,
  saveMovimiento,
  actualizarStockLocal,
  getClientesFiado,
  saveClienteFiado,
  saveMovimientoFiado,
  actualizarSaldoFiadoLocal,
  getVentasSinCerrar,
  getPresupuesto,
  savePresupuesto,
} from '@/lib/db';
import {
  encolarRegistrarVenta,
  encolarActualizarUsaCostos,
  encolarActualizarUsaStock,
  encolarAplicarMovimientoStock,
  encolarCrearClienteFiado,
  encolarAplicarMovimientoFiado,
  encolarActualizarPresupuesto,
  onFalloPermanente,
} from '@/lib/outbox';
import { updateUsaCostos, updateUsaStock } from '@/lib/sync';
import { precioBS, precioUSD, costoUSD, formatBS, formatUSD } from '@/lib/precio';
import { pareceCodigoBarra } from '@/lib/barcode';
import { compartirComprobante } from '@/lib/comprobante';
import { useApp } from '@/components/Providers';
import Scanner from '@/components/Scanner';
import ThemeToggle from '@/components/ThemeToggle';
import StockBadge from '@/components/StockBadge';
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
  { id: 'fiado', label: 'Fiado' },
];

export default function CajaPage() {
  const {
    tasa, isOnline, negocioNombre, signOut, user, pendientesCount, negocioId, rol, userNombre,
    productosVersion, usaCostos, setUsaCostos, usaStock, setUsaStock, ultimaSincronizacion,
    carrito, setCarrito, showCarrito, setShowCarrito,
    presupuestoConvirtiendoId, setPresupuestoConvirtiendoId,
  } = useApp();
  const router = useRouter();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargandoProductos, setCargandoProductos] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [showPago, setShowPago] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showPeso, setShowPeso] = useState(false);
  const [productoPeso, setProductoPeso] = useState<Producto | null>(null);
  const [gramos, setGramos] = useState('');
  const [metodo, setMetodo] = useState<MetodoPago | null>(null);
  const [montoRecibido, setMontoRecibido] = useState('');
  // Pago mixto: pagosMixtos son los pagos ya "cerrados" (método + monto en
  // las dos monedas). metodoMixtoActual/montoMixtoInput son el método y el
  // monto que se está tecleando para el SIGUIENTE pago — solo aplica
  // mientras ese pago todavía no es el último (el último nunca se teclea,
  // se calcula como residuo, ver agregarPagoMixtoCalculado).
  const [modoPagoMixto, setModoPagoMixto] = useState(false);
  const [pagosMixtos, setPagosMixtos] = useState<{ metodo: MetodoPago; monto_bs: number; monto_usd: number; clienteFiadoId?: string }[]>([]);
  const [metodoMixtoActual, setMetodoMixtoActual] = useState<MetodoPago | null>(null);
  const [montoMixtoInput, setMontoMixtoInput] = useState('');
  const [toast, setToast] = useState('');
  const [showPerfil, setShowPerfil] = useState(false);
  const [passActual, setPassActual] = useState('');
  const [passNueva, setPassNueva] = useState('');
  const [passConfirmar, setPassConfirmar] = useState('');
  const [passError, setPassError] = useState('');
  const [passCargando, setPassCargando] = useState(false);
  const [showConfirmStock, setShowConfirmStock] = useState(false);
  const [showConfirmVaciar, setShowConfirmVaciar] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Fiado: clientes del negocio, para elegir/crear al cobrar. Se recarga
  // junto con productos (mismo disparador productosVersion) porque viaja en
  // el mismo sync periódico — ver syncFromSupabase.
  const [clientesFiado, setClientesFiado] = useState<ClienteFiado[]>([]);
  const [busquedaClienteFiado, setBusquedaClienteFiado] = useState('');
  const [creandoClienteFiado, setCreandoClienteFiado] = useState(false);
  // Cliente elegido para el pago fiado que se está armando ahora mismo (modo
  // simple, o el pago manual del modo mixto — nunca ambos a la vez).
  const [clienteFiadoElegido, setClienteFiadoElegido] = useState<ClienteFiado | null>(null);
  // En modo mixto, el pago "calculado" (el resto) normalmente se agrega al
  // toque de elegir el método — pero si ese método es fiado hace falta
  // primero elegir cliente, así que se abre este selector en su lugar.
  const [seleccionandoClienteCalculado, setSeleccionandoClienteCalculado] = useState(false);

  // Pantalla de éxito tras confirmar una venta — desde ahí se puede
  // compartir el comprobante mientras el cliente sigue parado ahí.
  const [ventaConfirmada, setVentaConfirmada] = useState<{ venta: Venta; numero: number } | null>(null);
  const [compartiendoComprobante, setCompartiendoComprobante] = useState(false);

  // productosVersion depende de Providers: se re-lee la lista cuando el sync
  // inicial (o cualquier sync posterior) termina de escribir productos
  // frescos en IndexedDB. Sin esto, el primer fetch de esta pantalla puede
  // ganarle la carrera al sync y quedarse con una lista vacía para siempre
  // (el efecto solo corría una vez, al montar).
  useEffect(() => {
    let cancelado = false;
    getProductos().then(p => {
      if (cancelado) return;
      setProductos(p);
      setCargandoProductos(false);
    });
    return () => { cancelado = true; };
  }, [productosVersion]);

  // Mismo disparador que productos: clientes_fiado viaja en el mismo sync
  // periódico (ver syncFromSupabase), así que se relee la lista local cada
  // vez que ese sync termina de escribir.
  useEffect(() => {
    let cancelado = false;
    getClientesFiado().then(cs => {
      if (!cancelado) setClientesFiado(cs);
    });
    return () => { cancelado = true; };
  }, [productosVersion]);

  // Si la cola rechazó de forma definitiva un movimiento de fiado, ya
  // corrigió el saldo en IndexedDB de inmediato (ver outbox.ts) — sin esto,
  // esta pantalla seguiría ofreciendo el saldo optimista viejo al elegir
  // cliente hasta el próximo sync periódico.
  useEffect(() => onFalloPermanente(() => {
    getClientesFiado().then(cs => setClientesFiado(cs));
  }), []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  // El switch responde al instante (estado + cache local), pero solo se da
  // por guardado cuando hay confirmación real: con red, se espera el
  // resultado verificado de la escritura; sin red, no hay forma de
  // confirmar nada ahora mismo, así que se encola para reintentar al
  // reconectar (offline-first, igual que la tasa).
  const handleToggleUsaCostos = async () => {
    if (!negocioId) return;
    const anterior = usaCostos;
    const nuevo = !usaCostos;
    await setCachedUsaCostos(nuevo);
    setUsaCostos(nuevo);

    if (!isOnline) {
      await encolarActualizarUsaCostos(nuevo, negocioId);
      showToast('Guardado localmente — se sincronizará cuando haya conexión');
      return;
    }

    // updateUsaCostos ahora verifica que el UPDATE haya afectado una fila de
    // verdad (ver comentario en sync.ts) — si no, no hubo guardado real
    // (ej. RLS lo bloqueó en silencio) y no hay que dejar el switch
    // mostrando un estado que nunca se persistió.
    const ok = await updateUsaCostos(nuevo, negocioId);
    if (!ok) {
      await setCachedUsaCostos(anterior);
      setUsaCostos(anterior);
      showToast('No se pudo guardar el cambio. Intenta de nuevo.');
      return;
    }
    showToast(nuevo ? 'Control de costos activado' : 'Control de costos desactivado');
  };

  // Activar pide confirmación explícita (el compromiso de registrar toda la
  // mercancía que entra); desactivar no la necesita — no borra datos, solo
  // deja de mostrarlos.
  const handleToggleUsaStock = () => {
    if (!usaStock) {
      setShowConfirmStock(true);
      return;
    }
    aplicarUsaStock(false);
  };

  const confirmarActivarStock = () => {
    setShowConfirmStock(false);
    aplicarUsaStock(true);
  };

  // Mismo patrón offline-first + verificación que usa_costos.
  const aplicarUsaStock = async (nuevo: boolean) => {
    if (!negocioId) return;
    const anterior = usaStock;
    await setCachedUsaStock(nuevo);
    setUsaStock(nuevo);

    if (!isOnline) {
      await encolarActualizarUsaStock(nuevo, negocioId);
      showToast('Guardado localmente — se sincronizará cuando haya conexión');
      return;
    }

    const ok = await updateUsaStock(nuevo, negocioId);
    if (!ok) {
      await setCachedUsaStock(anterior);
      setUsaStock(anterior);
      showToast('No se pudo guardar el cambio. Intenta de nuevo.');
      return;
    }
    showToast(nuevo ? 'Control de inventario activado' : 'Control de inventario desactivado');
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

  // Aviso discreto (un toast más, nada bloqueante) cuando el producto ya
  // está en cero o negativo — informa sin interrumpir el cobro, que es la
  // decisión de diseño explícita: nunca se bloquea una venta por falta de
  // stock.
  const sinExistencia = useCallback((producto: Producto) =>
    usaStock && producto.controla_stock !== false && producto.stock != null && producto.stock <= 0,
  [usaStock]);

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
    showToast(sinExistencia(producto) ? 'Sin existencia registrada' : `${producto.nombre} agregado`);
    reproducirBeep();
  }, [sinExistencia]);

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
    showToast(sinExistencia(productoPeso) ? 'Sin existencia registrada' : `${productoPeso.nombre} ${g}g agregado`);
    setProductoPeso(null);
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

  const confirmarVaciarCarrito = () => {
    setCarrito([]);
    // Vaciar el carrito rompe el vínculo con el presupuesto que lo había
    // cargado — una venta futura desde un carrito armado desde cero nunca
    // debe marcar ese presupuesto como convertido.
    setPresupuestoConvirtiendoId(null);
    setShowConfirmVaciar(false);
    setShowCarrito(false);
    showToast('Carrito vaciado');
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

  // Lector físico de código de barras: se comporta como un teclado que
  // escribe el código en el buscador y envía Enter. Mismo cooldown (1200ms
  // por código) que usa el escáner de cámara en modo continuo, para el caso
  // de que el lector dispare dos veces. Si el texto no matchea un código
  // exacto, no se toca nada — cae al filtro normal por nombre.
  const buscadorCooldownRef = useRef<{ codigo: string; timestamp: number } | null>(null);

  const handleBuscadorKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const codigo = busqueda.trim();
    // Antes de tratar el texto como código, verificar que "parezca" uno —
    // evita que buscar un producto por nombre y dar Enter dispare el flujo
    // de código (que en Caja solo importa por consistencia con Inventario,
    // donde sí abría "producto nuevo" con el nombre como código).
    if (!codigo || !pareceCodigoBarra(codigo)) return;
    const producto = await getProductoPorCodigo(codigo);
    if (!producto) return;
    const now = Date.now();
    const cd = buscadorCooldownRef.current;
    if (cd && cd.codigo === codigo && now - cd.timestamp < 1200) return;
    buscadorCooldownRef.current = { codigo, timestamp: now };
    agregarAlCarrito(producto);
    setBusqueda('');
    searchRef.current?.focus();
  };

  // Pago mixto: el primer pago se teclea (método + monto, en la moneda
  // natural de ese método — igual que "monto recibido" en el flujo simple:
  // Bs para todo menos efectivo_usd). El residuo se recalcula solo. Si ya
  // queda en cero (o casi, por redondeo), la venta queda completa sin
  // necesitar un segundo pago; si no, se ofrece un segundo método cuyo
  // monto NUNCA se teclea — es el residuo exacto en las dos monedas,
  // restado por separado en cada una (nunca una derivada de la otra vía
  // tasa), para que la suma cuadre exacto en Bs y en $ (regla del ajuste).
  const EPSILON_RESIDUO = 0.005;
  const sumaPagosMixtosBs = pagosMixtos.reduce((s, p) => s + p.monto_bs, 0);
  const sumaPagosMixtosUsd = pagosMixtos.reduce((s, p) => s + p.monto_usd, 0);
  const residuoMixtoBs = totalBS - sumaPagosMixtosBs;
  const residuoMixtoUsd = totalUSD - sumaPagosMixtosUsd;
  // Math.abs, no solo <=: un residuo negativo (pago de más) nunca debe
  // leerse como "completo" — es respaldo de agregarPagoMixtoManual, que ya
  // debería impedir que esto pase, pero si fallara no hay que confirmar una
  // venta con pagos que no cuadran.
  const pagoMixtoCompleto = pagosMixtos.length > 0 && Math.abs(residuoMixtoBs) <= EPSILON_RESIDUO;

  const iniciarPagoMixto = () => {
    setModoPagoMixto(true);
    setMetodo(null);
    setMontoRecibido('');
    setPagosMixtos([]);
    setMetodoMixtoActual(null);
    setMontoMixtoInput('');
  };

  const salirPagoMixto = () => {
    setModoPagoMixto(false);
    setPagosMixtos([]);
    setMetodoMixtoActual(null);
    setMontoMixtoInput('');
    setClienteFiadoElegido(null);
    setBusquedaClienteFiado('');
    setSeleccionandoClienteCalculado(false);
  };

  // Único punto para cerrar el panel de pago (flechita, fondo oscuro, o
  // venta confirmada) — sin esto, cerrar sin confirmar dejaba vivo el
  // estado de pago mixto y reabrir "Pagar" volvía a caer en modo mixto con
  // lo que se había tecleado antes.
  const cerrarPago = () => {
    setShowPago(false);
    setMetodo(null);
    setMontoRecibido('');
    setClienteFiadoElegido(null);
    setBusquedaClienteFiado('');
    salirPagoMixto();
  };

  // Cliente de fiado nuevo, creado sin salir del cobro — igual que crear un
  // producto sobre la marcha, nunca depende de conexión: se guarda local de
  // inmediato y se encola el alta en Supabase.
  const crearClienteFiado = async (nombre: string): Promise<ClienteFiado> => {
    const cliente: ClienteFiado = {
      id: crypto.randomUUID(),
      nombre: nombre.trim(),
      saldo_usd: 0,
      creado_por: user?.id,
      creado_por_nombre: userNombre || undefined,
      creado_en: new Date().toISOString(),
    };
    await saveClienteFiado(cliente);
    setClientesFiado(prev => [...prev, cliente]);
    if (negocioId) await encolarCrearClienteFiado(cliente, negocioId);
    return cliente;
  };

  // Buscar entre los clientes existentes o crear uno nuevo con solo el
  // nombre, sin salir del cobro. Se reutiliza en los tres puntos donde hace
  // falta elegir cliente: pago simple, pago manual mixto y el pago
  // calculado (el resto) mixto.
  const renderSelectorClienteFiado = (onElegir: (c: ClienteFiado) => void) => {
    const busqueda = busquedaClienteFiado.trim().toLowerCase();
    const filtrados = busqueda
      ? clientesFiado.filter(c => c.nombre.toLowerCase().includes(busqueda))
      : clientesFiado;
    const existeExacto = clientesFiado.some(c => c.nombre.toLowerCase() === busqueda);
    return (
      <div>
        <label className="block text-sm text-gray-500 mb-1">Cliente</label>
        <input
          type="text"
          value={busquedaClienteFiado}
          onChange={e => setBusquedaClienteFiado(e.target.value)}
          placeholder="Buscar o escribir nombre nuevo"
          className="w-full border border-gray-300 rounded-xl p-3 text-base focus:outline-none focus:border-emerald-400 mb-2"
          autoFocus
        />
        <div className="max-h-40 overflow-y-auto space-y-1.5">
          {filtrados.map(c => (
            <button
              key={c.id}
              onClick={() => onElegir(c)}
              className="w-full text-left px-3 py-2.5 rounded-xl bg-gray-50 flex items-center justify-between"
            >
              <span className="font-medium text-gray-800">{c.nombre}</span>
              {c.saldo_usd > 0 && (
                <span className="text-xs text-orange-600 font-semibold flex-shrink-0 ml-2">
                  Debe {formatUSD(c.saldo_usd)}
                </span>
              )}
            </button>
          ))}
          {busqueda && !existeExacto && (
            <button
              disabled={creandoClienteFiado}
              onClick={async () => {
                setCreandoClienteFiado(true);
                const nuevo = await crearClienteFiado(busquedaClienteFiado);
                setCreandoClienteFiado(false);
                onElegir(nuevo);
              }}
              className="w-full text-left px-3 py-2.5 rounded-xl bg-emerald-50 text-emerald-700 font-semibold disabled:opacity-50"
            >
              + Crear &quot;{busquedaClienteFiado.trim()}&quot;
            </button>
          )}
          {filtrados.length === 0 && !busqueda && (
            <p className="text-xs text-gray-400 text-center py-2">Escribe para buscar o crear un cliente</p>
          )}
        </div>
      </div>
    );
  };

  const agregarPagoMixtoManual = () => {
    if (!metodoMixtoActual) return;
    if (metodoMixtoActual === 'fiado' && !clienteFiadoElegido) return;
    const monto = parseFloat(montoMixtoInput);
    if (!monto || monto <= 0) return;
    const enUsd = metodoMixtoActual === 'efectivo_usd';
    const monto_bs = enUsd ? (tasa > 0 ? monto * tasa : 0) : monto;
    const monto_usd = enUsd ? monto : (tasa > 0 ? monto / tasa : 0);
    // Nunca dejar que un pago tecleado deje el residuo en negativo — eso
    // rompería la regla central del ajuste (el último pago se calcula, no
    // se teclea). Mismo margen que pagoMixtoCompleto para no rechazar por
    // un centavo de redondeo.
    if (monto_bs > residuoMixtoBs + EPSILON_RESIDUO) {
      showToast(`El monto no puede superar lo que falta: ${formatBS(residuoMixtoBs)}`);
      return;
    }
    setPagosMixtos(prev => [
      ...prev,
      {
        metodo: metodoMixtoActual,
        monto_bs,
        monto_usd,
        clienteFiadoId: metodoMixtoActual === 'fiado' ? clienteFiadoElegido!.id : undefined,
      },
    ]);
    setMetodoMixtoActual(null);
    setMontoMixtoInput('');
    setClienteFiadoElegido(null);
    setBusquedaClienteFiado('');
  };

  const agregarPagoMixtoCalculado = (metodoElegido: MetodoPago, clienteFiadoId?: string) => {
    setPagosMixtos(prev => [
      ...prev,
      { metodo: metodoElegido, monto_bs: residuoMixtoBs, monto_usd: residuoMixtoUsd, clienteFiadoId },
    ]);
  };

  const quitarPagoMixto = (index: number) => {
    setPagosMixtos(prev => prev.filter((_, i) => i !== index));
  };

  const confirmarVenta = async () => {
    if (modoPagoMixto) {
      if (!pagoMixtoCompleto) return;
    } else if (!metodo) {
      return;
    }
    const now = new Date();
    const items: VentaItem[] = carrito.map(item => {
      if (item.esPorPeso) {
        const precio_bs = itemPrecioBS(item);
        return {
          id: crypto.randomUUID(),
          producto_id: item.producto.id,
          nombre: `${item.producto.nombre} — ${item.gramos}g`,
          precio_bs,
          cantidad: 1,
          subtotal_bs: precio_bs,
          gramos: item.gramos,
          // Precio por kg (unitario), no el total de la línea — es lo que
          // espera venta_items para poder recalcular cantidad × precio.
          precioUnitarioBs: precioBS(item.producto, tasa),
          precioUnitarioUsd: precioUSD(item.producto, tasa),
          // Snapshot del costo (por kg si aplica) en USD al momento de la
          // venta — null si el producto no tiene costo registrado. Se
          // calcula igual en ambas ramas para que registrar una venta
          // funcione igual con o sin control de costos activado.
          costo_usd: costoUSD(item.producto, tasa),
        };
      }
      const precio_bs = precioBS(item.producto, tasa);
      return {
        id: crypto.randomUUID(),
        producto_id: item.producto.id,
        nombre: item.producto.nombre,
        precio_bs,
        cantidad: item.cantidad,
        subtotal_bs: precio_bs * item.cantidad,
        precioUnitarioBs: precio_bs,
        precioUnitarioUsd: precioUSD(item.producto, tasa),
        costo_usd: costoUSD(item.producto, tasa),
      };
    });

    // Un solo camino de código para venta simple y mixta: pagos siempre
    // trae al menos un elemento. Con un solo método, un único pago con los
    // totales de la venta (orden 1) — igual al backfill que ya se hizo en
    // Supabase para las ventas de antes de este cambio.
    const pagos: PagoVenta[] = modoPagoMixto
      ? pagosMixtos.map((p, i) => ({
          id: crypto.randomUUID(),
          orden: i + 1,
          metodo: p.metodo,
          monto_bs: p.monto_bs,
          monto_usd: p.monto_usd,
        }))
      : [{
          id: crypto.randomUUID(),
          orden: 1,
          metodo: metodo!,
          monto_bs: totalBS,
          monto_usd: totalUSD,
        }];
    const metodoPagoVenta: MetodoPagoVenta = pagos.length > 1 ? 'mixto' : pagos[0].metodo;

    const venta: Venta = {
      id: crypto.randomUUID(),
      fecha: now.toISOString(),
      fecha_dia: now.toISOString().split('T')[0],
      items,
      metodo_pago: metodoPagoVenta,
      pagos,
      total_bs: totalBS,
      total_usd: totalUSD,
      tasa_usada: tasa,
      sincronizada: false,
      usuario_id: user?.id,
      usuario_nombre: userNombre || undefined,
    };

    // Offline-first: se guarda local de inmediato (la venta nunca depende de
    // red) y se encola el respaldo en Supabase — ahora mismo si hay conexión,
    // o al reconectar si no la hay.
    await saveVenta(venta);
    if (negocioId) await encolarRegistrarVenta(venta.id, negocioId);

    // Descuento de stock: un movimiento tipo 'venta' por cada item cuyo
    // producto lleva control de existencias. Nunca bloquea el cobro — ya se
    // guardó la venta arriba pase lo que pase acá. Se aplica local de
    // inmediato (mismo criterio offline-first) y se sincroniza por su
    // cuenta vía la RPC atómica e idempotente (aplicar_movimiento_stock).
    if (usaStock && negocioId) {
      for (const item of carrito) {
        if (item.producto.controla_stock === false) continue;
        const cantidadDescontar = item.esPorPeso ? (item.gramos ?? 0) / 1000 : item.cantidad;
        if (cantidadDescontar <= 0) continue;

        const stockDespues = (item.producto.stock ?? 0) - cantidadDescontar;
        const movimiento: MovimientoStock = {
          id: crypto.randomUUID(),
          producto_id: item.producto.id,
          producto_nombre: item.producto.nombre,
          tipo: 'venta',
          motivo: 'venta',
          cantidad: -cantidadDescontar,
          stock_resultante: stockDespues,
          venta_id: venta.id,
          usuario_id: user?.id,
          usuario_nombre: userNombre || undefined,
          ocurrido_en: now.toISOString(),
          sincronizado: false,
        };
        await saveMovimiento(movimiento);
        await actualizarStockLocal(item.producto.id, stockDespues);
        await encolarAplicarMovimientoStock(movimiento.id, negocioId);
      }
    }

    // Fiado es un método más dentro de venta_pagos (ya insertado arriba, sin
    // cambios), pero además liga esa porción a la deuda de un cliente — un
    // aplicar_movimiento_fiado tipo 'cargo' aparte, encolado igual que el
    // descuento de stock: nunca bloquea el cobro, se aplica local de
    // inmediato y se sincroniza por su cuenta vía la RPC atómica e
    // idempotente. A lo sumo hay un pago fiado por venta (el selector de
    // método ya excluye 'fiado' de las opciones una vez usado en modo mixto).
    if (negocioId) {
      const pagoFiado = pagos.find(p => p.metodo === 'fiado');
      const clienteId = modoPagoMixto
        ? pagosMixtos.find(p => p.metodo === 'fiado')?.clienteFiadoId
        : clienteFiadoElegido?.id;
      if (pagoFiado && clienteId) {
        const movimientoFiado: MovimientoFiado = {
          id: crypto.randomUUID(),
          cliente_id: clienteId,
          tipo: 'cargo',
          monto_usd: pagoFiado.monto_usd,
          monto_bs: pagoFiado.monto_bs,
          tasa_usada: tasa,
          venta_id: venta.id,
          usuario_id: user?.id,
          usuario_nombre: userNombre || undefined,
          ocurrido_en: now.toISOString(),
          sincronizado: false,
        };
        await saveMovimientoFiado(movimientoFiado);
        const clienteLocal = clientesFiado.find(c => c.id === clienteId);
        if (clienteLocal) {
          const nuevoSaldo = clienteLocal.saldo_usd + movimientoFiado.monto_usd;
          await actualizarSaldoFiadoLocal(clienteId, nuevoSaldo);
          setClientesFiado(prev => prev.map(c => (c.id === clienteId ? { ...c, saldo_usd: nuevoSaldo } : c)));
        }
        await encolarAplicarMovimientoFiado(movimientoFiado.id, negocioId);
      }
    }

    // Si este carrito vino de "Convertir en venta" en /presupuestos, la
    // venta ya se confirmó — se marca el presupuesto como convertido,
    // ligado a esta venta. Mismo criterio offline-first que el resto de
    // los pasos posteriores a una venta: se aplica local y se encola,
    // nunca depende de tener conexión ahora mismo.
    if (presupuestoConvirtiendoId && negocioId) {
      const presupuesto = await getPresupuesto(presupuestoConvirtiendoId);
      if (presupuesto) {
        const actualizado: Presupuesto = {
          ...presupuesto,
          estado: 'convertido',
          convertido_en: now.toISOString(),
          venta_id: venta.id,
          sincronizado: false,
        };
        await savePresupuesto(actualizado);
        await encolarActualizarPresupuesto(actualizado.id, negocioId);
      }
      setPresupuestoConvirtiendoId(null);
    }

    setCarrito([]);
    cerrarPago();

    // Número correlativo dentro del período abierto — el mismo criterio que
    // ya usa Resumen (orden cronológico entre las ventas sin cerrar de todo
    // el negocio). Se calcula sobre lo local nada más: alcanza para el
    // comprobante recién hecho, que de todos modos aclara que no es un
    // documento fiscal.
    const ventasPeriodo = await getVentasSinCerrar();
    const ordenadas = [...ventasPeriodo].sort((a, b) => a.fecha.localeCompare(b.fecha));
    const numero = ordenadas.findIndex(v => v.id === venta.id) + 1;
    setVentaConfirmada({ venta, numero: numero > 0 ? numero : ordenadas.length });
  };

  const compartirComprobanteVenta = async (venta: Venta, numero: number) => {
    setCompartiendoComprobante(true);
    try {
      await compartirComprobante({ negocioNombre: negocioNombre || '', venta, numero });
    } catch {
      showToast('No se pudo generar el comprobante');
    } finally {
      setCompartiendoComprobante(false);
    }
  };

  const cambioBS =
    metodo === 'efectivo_bs' ? (parseFloat(montoRecibido) || 0) - totalBS : null;
  const cambioUSD =
    metodo === 'efectivo_usd' ? (parseFloat(montoRecibido) || 0) - totalUSD : null;
  const cambio = cambioBS ?? cambioUSD;
  const puedeConfirmarSimple =
    metodo !== null &&
    (metodo === 'efectivo_bs' || metodo === 'efectivo_usd'
      ? (cambio ?? -1) >= 0
      : metodo === 'fiado'
        ? clienteFiadoElegido !== null
        : true);
  const puedeConfirmar = modoPagoMixto ? pagoMixtoCompleto : puedeConfirmarSimple;

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
          <div className="min-w-0">
            <h1 className="text-xl font-bold truncate">
              Caja
              {negocioNombre && (
                <span className="font-normal text-emerald-200"> · {negocioNombre}</span>
              )}
            </h1>
            {userNombre && (
              <p className="text-emerald-200 text-xs truncate leading-tight">{userNombre}</p>
            )}
          </div>
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
            onKeyDown={handleBuscadorKeyDown}
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
        {cargandoProductos ? (
          <div className="text-center text-gray-400 py-16">
            <svg className="w-8 h-8 mx-auto mb-3 text-emerald-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm">Cargando productos...</p>
          </div>
        ) : productos.length === 0 ? (
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
                  {usaStock && (
                    <div className="mt-1">
                      <StockBadge
                        stock={producto.stock}
                        stockMinimo={producto.stock_minimo}
                        controlaStock={producto.controla_stock}
                        esPorPeso={producto.por_peso}
                        isOnline={isOnline}
                        ultimaSincronizacion={ultimaSincronizacion}
                      />
                    </div>
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
              <div className="flex items-center gap-3">
                {carrito.length > 0 && (
                  <button
                    onClick={() => setShowConfirmVaciar(true)}
                    className="text-xs text-red-400 font-medium"
                  >
                    Vaciar
                  </button>
                )}
                <button onClick={() => setShowCarrito(false)} className="p-1 text-gray-400">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
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
          <div className="absolute inset-0 bg-black/40" onClick={() => { cerrarPago(); setShowCarrito(true); }} />
          <div className="relative w-full max-w-lg mx-auto bg-white rounded-t-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold">{modoPagoMixto ? 'Pago mixto' : 'Método de pago'}</h2>
                {modoPagoMixto && (
                  <button onClick={salirPagoMixto} className="text-xs text-gray-400 font-medium">
                    Volver a un solo método
                  </button>
                )}
              </div>
              <button
                onClick={() => { cerrarPago(); setShowCarrito(true); }}
                className="p-1 text-gray-400"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <div className="text-center py-4 mb-4 bg-emerald-50 rounded-xl">
                {modoPagoMixto && pagosMixtos.length > 0 && !pagoMixtoCompleto ? (
                  <>
                    <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide mb-1">Falta</p>
                    <p className="text-3xl font-bold text-emerald-700">{formatBS(residuoMixtoBs)}</p>
                    {tasa > 0 && <p className="text-gray-500 text-sm mt-1">{formatUSD(residuoMixtoUsd)}</p>}
                  </>
                ) : (
                  <>
                    <p className="text-3xl font-bold text-emerald-700">{formatBS(totalBS)}</p>
                    {tasa > 0 && <p className="text-gray-500 text-sm mt-1">{formatUSD(totalUSD)}</p>}
                  </>
                )}
              </div>

              {modoPagoMixto ? (
                <div>
                  {pagosMixtos.length > 0 && (
                    <div className="space-y-2 mb-4">
                      {pagosMixtos.map((p, i) => {
                        const info = METODOS_PAGO.find(m => m.id === p.metodo);
                        return (
                          <div key={i} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2.5">
                            <span className="text-sm font-medium text-gray-700">{info?.label ?? p.metodo}</span>
                            <div className="flex items-center gap-3">
                              <div className="text-right">
                                <p className="font-bold text-gray-900 text-sm">{formatBS(p.monto_bs)}</p>
                                <p className="text-xs text-gray-400">{formatUSD(p.monto_usd)}</p>
                              </div>
                              <button onClick={() => quitarPagoMixto(i)} className="text-gray-300" aria-label="Quitar pago">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {pagoMixtoCompleto && (
                    <div className="text-center py-3 rounded-xl bg-green-50 text-green-700 font-bold mb-2">
                      Pago completo — listo para confirmar
                    </div>
                  )}

                  {!pagoMixtoCompleto && (
                    seleccionandoClienteCalculado ? (
                      <div>
                        <p className="text-sm text-gray-500 mb-2">Fiar el resto a:</p>
                        {renderSelectorClienteFiado(c => {
                          agregarPagoMixtoCalculado('fiado', c.id);
                          setSeleccionandoClienteCalculado(false);
                          setBusquedaClienteFiado('');
                        })}
                        <button
                          onClick={() => { setSeleccionandoClienteCalculado(false); setBusquedaClienteFiado(''); }}
                          className="text-xs text-gray-400 font-medium mt-2"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                    <>
                      <p className="text-sm text-gray-500 mb-2">
                        {pagosMixtos.length === 0 ? 'Elige el primer método' : 'Elige el método para el resto'}
                      </p>
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        {METODOS_PAGO.filter(m => !pagosMixtos.some(p => p.metodo === m.id)).map(m => (
                          <button
                            key={m.id}
                            onClick={() => {
                              if (pagosMixtos.length === 0) {
                                setMetodoMixtoActual(m.id);
                                setMontoMixtoInput('');
                                setClienteFiadoElegido(null);
                                setBusquedaClienteFiado('');
                              } else if (m.id === 'fiado') {
                                setSeleccionandoClienteCalculado(true);
                                setBusquedaClienteFiado('');
                              } else {
                                agregarPagoMixtoCalculado(m.id);
                              }
                            }}
                            className={`py-3 px-2 rounded-xl text-sm font-medium transition-colors text-center ${
                              metodoMixtoActual === m.id
                                ? 'bg-emerald-600 text-white shadow-sm'
                                : 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>

                      {pagosMixtos.length === 0 && metodoMixtoActual && (
                        <div>
                          <label className="block text-sm text-gray-500 mb-1">
                            Monto ({metodoMixtoActual === 'efectivo_usd' ? '$' : 'Bs'})
                          </label>
                          <div className="flex gap-2">
                            <input
                              type="number"
                              step="0.01"
                              value={montoMixtoInput}
                              onChange={e => setMontoMixtoInput(e.target.value)}
                              className="flex-1 min-w-0 border border-gray-300 rounded-xl p-3 text-xl font-bold focus:outline-none focus:border-emerald-400"
                              placeholder="0.00"
                              autoFocus={metodoMixtoActual !== 'fiado'}
                            />
                            <button
                              onClick={agregarPagoMixtoManual}
                              disabled={
                                !montoMixtoInput ||
                                parseFloat(montoMixtoInput) <= 0 ||
                                (metodoMixtoActual === 'fiado' && !clienteFiadoElegido)
                              }
                              className="px-4 rounded-xl bg-emerald-600 text-white font-semibold disabled:opacity-40"
                            >
                              Agregar
                            </button>
                          </div>
                          {metodoMixtoActual === 'fiado' && (
                            <div className="mt-3">
                              {clienteFiadoElegido ? (
                                <div className="flex items-center justify-between bg-orange-50 rounded-xl px-3 py-2.5">
                                  <p className="font-semibold text-gray-800 text-sm">{clienteFiadoElegido.nombre}</p>
                                  <button
                                    onClick={() => { setClienteFiadoElegido(null); setBusquedaClienteFiado(''); }}
                                    className="text-xs text-gray-400 font-medium"
                                  >
                                    Cambiar
                                  </button>
                                </div>
                              ) : renderSelectorClienteFiado(c => setClienteFiadoElegido(c))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                    )
                  )}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    {METODOS_PAGO.map(m => (
                      <button
                        key={m.id}
                        onClick={() => {
                          setMetodo(m.id);
                          setMontoRecibido('');
                          setClienteFiadoElegido(null);
                          setBusquedaClienteFiado('');
                        }}
                        className={`py-3 px-2 rounded-xl text-sm font-medium transition-colors text-center ${
                          metodo === m.id
                            ? 'bg-emerald-600 text-white shadow-sm'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                    <button
                      onClick={iniciarPagoMixto}
                      className="py-3 px-2 rounded-xl text-sm font-medium transition-colors text-center bg-gray-100 text-gray-700 flex flex-col items-center justify-center gap-1"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4m-4-4l4-4" />
                      </svg>
                      Pago mixto
                    </button>
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

                  {metodo === 'fiado' && (
                    <div className="mb-4">
                      {clienteFiadoElegido ? (
                        <div className="flex items-center justify-between bg-orange-50 rounded-xl px-3 py-2.5">
                          <div>
                            <p className="text-xs text-orange-500 font-semibold uppercase">Fiado a</p>
                            <p className="font-bold text-gray-800">{clienteFiadoElegido.nombre}</p>
                          </div>
                          <button
                            onClick={() => { setClienteFiadoElegido(null); setBusquedaClienteFiado(''); }}
                            className="text-xs text-gray-400 font-medium"
                          >
                            Cambiar
                          </button>
                        </div>
                      ) : renderSelectorClienteFiado(c => setClienteFiadoElegido(c))}
                    </div>
                  )}
                </>
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

      {/* Venta confirmada — momento natural para compartir el comprobante,
          el cliente sigue ahí parado. */}
      {ventaConfirmada && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setVentaConfirmada(null)} />
          <div className="relative w-full max-w-lg mx-auto bg-white rounded-t-2xl">
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-gray-900">Venta registrada</h2>
              <p className="text-2xl font-bold text-emerald-700 mt-1">{formatBS(ventaConfirmada.venta.total_bs)}</p>
              {tasa > 0 && <p className="text-gray-400 text-sm">{formatUSD(ventaConfirmada.venta.total_usd)}</p>}
            </div>
            <div className="p-4 pt-0 space-y-2">
              <button
                onClick={() => setVentaConfirmada(null)}
                className="w-full bg-emerald-600 text-white py-3.5 rounded-xl font-bold"
              >
                Nueva venta
              </button>
              <button
                onClick={() => compartirComprobanteVenta(ventaConfirmada.venta, ventaConfirmada.numero)}
                disabled={compartiendoComprobante}
                className="w-full bg-gray-100 text-gray-700 py-3.5 rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8.684 13.342a3 3 0 100-2.684m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                {compartiendoComprobante ? 'Generando...' : 'Compartir comprobante'}
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

            {/* Avatar + usuario en sesión */}
            <div className="flex flex-col items-center py-5 px-6">
              <div className={`w-20 h-20 rounded-full ${avatarColor(userNombre || negocioNombre || 'U')} flex items-center justify-center mb-3 shadow-md`}>
                <span className="text-white text-3xl font-bold">
                  {(userNombre || negocioNombre || 'U').charAt(0).toUpperCase()}
                </span>
              </div>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{userNombre || 'Usuario'}</p>
              <p className="text-sm text-gray-400 mt-0.5">
                {negocioNombre || 'Negocio'}
                {rol && ` · ${rol === 'admin' ? 'Admin' : 'Cajero'}`}
              </p>
            </div>

            <div className="border-t border-gray-100 dark:border-slate-700 mx-4" />

            {/* Change password */}
            <div className="p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Cambiar contraseña
              </p>
              <input
                type="password"
                value={passActual}
                onChange={e => { setPassActual(e.target.value); setPassError(''); }}
                placeholder="Contraseña actual"
                className="w-full border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-3 text-base bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-emerald-400"
              />
              <input
                type="password"
                value={passNueva}
                onChange={e => { setPassNueva(e.target.value); setPassError(''); }}
                placeholder="Nueva contraseña"
                className="w-full border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-3 text-base bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-emerald-400"
              />
              <input
                type="password"
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

            {rol === 'admin' && (
              <>
                <div className="border-t border-gray-100 dark:border-slate-700 mx-4" />
                <div className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      Llevar control de costos y ganancias
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Agrega costo a productos y ganancia a reportes
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={usaCostos}
                    onClick={handleToggleUsaCostos}
                    className={`relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                      usaCostos ? 'bg-emerald-600' : 'bg-gray-200 dark:bg-slate-600'
                    }`}
                  >
                    <span
                      className={`inline-block w-5 h-5 m-0.5 bg-white rounded-full shadow-sm transition-transform ${
                        usaCostos ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="border-t border-gray-100 dark:border-slate-700 mx-4" />
                <div className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      Control de inventario
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Descuenta existencias al vender y avisa stock bajo
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={usaStock}
                    onClick={handleToggleUsaStock}
                    className={`relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                      usaStock ? 'bg-emerald-600' : 'bg-gray-200 dark:bg-slate-600'
                    }`}
                  >
                    <span
                      className={`inline-block w-5 h-5 m-0.5 bg-white rounded-full shadow-sm transition-transform ${
                        usaStock ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="border-t border-gray-100 dark:border-slate-700 mx-4" />
                <div className="p-4">
                  <button
                    onClick={() => { setShowPerfil(false); router.push('/usuarios'); }}
                    className="w-full py-3 rounded-xl font-semibold text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-slate-700 flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-4.13a4 4 0 100-8 4 4 0 000 8zm6 4a4 4 0 10-8 0 4 4 0 008 0z" />
                    </svg>
                    Usuarios
                  </button>
                </div>
              </>
            )}

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

      {/* Confirmar activación de control de inventario */}
      {showConfirmStock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowConfirmStock(false)} />
          <div className="relative bg-white dark:bg-slate-800 rounded-2xl w-full max-w-sm shadow-xl p-5">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Activar control de inventario</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              El control de inventario solo funciona si registras la mercancía que entra.
              Si no lo haces, las existencias dejarán de ser confiables en pocas semanas.
              ¿Activar?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmStock(false)}
                className="flex-1 py-3 rounded-xl bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200 font-semibold"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarActivarStock}
                className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-bold"
              >
                Sí, activar
              </button>
            </div>
          </div>
        </div>
      )}

      {showConfirmVaciar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowConfirmVaciar(false)} />
          <div className="relative bg-white dark:bg-slate-800 rounded-2xl w-full max-w-sm shadow-xl p-5">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Vaciar carrito</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              Se {carrito.length === 1 ? 'va a quitar' : 'van a quitar'} {carrito.length} producto{carrito.length === 1 ? '' : 's'} del carrito. Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmVaciar(false)}
                className="flex-1 py-3 rounded-xl bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200 font-semibold"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarVaciarCarrito}
                className="flex-1 py-3 rounded-xl bg-red-600 text-white font-bold"
              >
                Vaciar
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
