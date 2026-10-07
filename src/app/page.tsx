'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Producto, ItemCarrito, MetodoPago, MetodoPagoVenta, PagoVenta, Venta, VentaItem, MovimientoStock, ClienteFiado, MovimientoFiado, Presupuesto } from '@/types';
import { METODOS_PAGO } from '@/lib/metodos';
import {
  getProductos,
  getProductoPorCodigo,
  saveVenta,
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
  encolarAplicarMovimientoStock,
  encolarCrearClienteFiado,
  encolarAplicarMovimientoFiado,
  encolarActualizarPresupuesto,
  onFalloPermanente,
} from '@/lib/outbox';
import { precioBS, precioUSD, costoUSD, formatBS, formatUSD } from '@/lib/precio';
import { pareceCodigoBarra } from '@/lib/barcode';
import { compartirComprobante } from '@/lib/comprobante';
import { stockBajo, debeOcultarStock } from '@/lib/stock';
import { useApp } from '@/components/Providers';
import Scanner from '@/components/Scanner';
import ThemeToggle from '@/components/ThemeToggle';
import StockBadge from '@/components/StockBadge';
import ChecklistBienvenida from '@/components/ChecklistBienvenida';
import Icon from '@/components/ui/Icon';
import ChipFiltro from '@/components/ui/ChipFiltro';
import Button from '@/components/ui/Button';
import { TAMANO_ICONO, ICONO_METODO_PAGO } from '@/components/ui/iconos';

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

export default function CajaPage() {
  const {
    tasa, isOnline, negocioNombre, datosNegocio, user, pendientesCount, colaAtascada, negocioId, rol, userNombre,
    productosVersion, usaStock, ultimaSincronizacion, tutorialVisto,
    carrito, setCarrito, showCarrito, setShowCarrito,
    presupuestoConvirtiendoId, setPresupuestoConvirtiendoId,
    presupuestoClienteNombre,
  } = useApp();
  const router = useRouter();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargandoProductos, setCargandoProductos] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [chip, setChip] = useState<'todos' | 'porPeso' | 'bajo' | 'sin'>('todos');
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
  const [showConfirmVaciar, setShowConfirmVaciar] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Checklist de bienvenida: la fuente de verdad de "hay que mostrarlo" es
  // tutorialVisto (contexto), pero la visibilidad de la hoja vive en un
  // estado local para poder cerrarla al toque aunque marcarTutorialVisto()
  // falle por falta de red — si no, sin conexión la hoja nunca se cerraría
  // porque tutorialVisto seguiría en false. Sin red, el checklist
  // simplemente puede volver a aparecer en la próxima carga con conexión.
  const [mostrarTutorial, setMostrarTutorial] = useState(false);
  useEffect(() => {
    if (tutorialVisto === false) setMostrarTutorial(true);
  }, [tutorialVisto]);

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

  const productosFiltrados = productos.filter(p => {
    const coincideBusqueda =
      !busqueda ||
      p.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      (p.codigo_barra && p.codigo_barra.includes(busqueda));
    if (!coincideBusqueda) return false;
    if (chip === 'porPeso') return !!p.por_peso;
    if (chip === 'bajo') {
      return usaStock && p.controla_stock !== false && stockBajo(p.stock, p.stock_minimo);
    }
    if (chip === 'sin') {
      return usaStock && p.controla_stock !== false && p.stock != null && p.stock <= 0;
    }
    return true;
  });

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
        <label className="block text-[11px] font-bold uppercase tracking-wide text-texto-3 mb-1.5">
          Cliente
        </label>
        <input
          type="text"
          value={busquedaClienteFiado}
          onChange={e => setBusquedaClienteFiado(e.target.value)}
          placeholder="Buscar o escribir nombre nuevo"
          className="w-full h-[52px] px-3.5 rounded-xl bg-tarjeta-hundida border border-borde-campo text-base text-texto focus:outline-none focus:border-foco mb-2"
          autoFocus
        />
        <div className="max-h-40 overflow-y-auto space-y-1.5">
          {filtrados.map(c => (
            <button
              key={c.id}
              onClick={() => onElegir(c)}
              className="w-full text-left px-3.5 py-2.5 rounded-xl bg-tarjeta-hundida flex items-center justify-between"
            >
              <span className="font-medium text-texto">{c.nombre}</span>
              {c.saldo_usd > 0 && (
                <span className="text-xs text-deuda font-semibold flex-shrink-0 ml-2">
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
              className="w-full text-left px-3.5 py-2.5 rounded-xl bg-marca-suave text-marca-suave-texto font-semibold disabled:opacity-50"
            >
              + Crear &quot;{busquedaClienteFiado.trim()}&quot;
            </button>
          )}
          {filtrados.length === 0 && !busqueda && (
            <p className="text-xs text-texto-4 text-center py-2">Escribe para buscar o crear un cliente</p>
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
        // Snapshot de texto de los productos de ESTA venta — mismo criterio
        // de cantidad/peso que ya usa la app (ver el detalle de items en
        // Resumen/Presupuestos). No es "lo que se fió" en términos
        // monetarios exactos: con pago mixto, el cargo puede cubrir solo una
        // parte del total, así que esto queda como contexto, no como un
        // desglose financiero de esa porción.
        const detalleItems = carrito
          .map(item => item.esPorPeso
            ? `${item.gramos}g ${item.producto.nombre}`
            : `${item.cantidad}× ${item.producto.nombre}`)
          .join(', ');
        const movimientoFiado: MovimientoFiado = {
          id: crypto.randomUUID(),
          cliente_id: clienteId,
          tipo: 'cargo',
          monto_usd: pagoFiado.monto_usd,
          monto_bs: pagoFiado.monto_bs,
          tasa_usada: tasa,
          venta_id: venta.id,
          detalleItems: detalleItems || undefined,
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
      await compartirComprobante({ negocioNombre: negocioNombre || '', datosNegocio, venta, numero });
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
    <div className="flex flex-col h-dvh max-h-dvh">
      {/* Header */}
      <header className="bg-superficie-barra border-b border-borde-divisor px-4 pt-3.5 pb-3 flex items-center gap-2.5 sticky top-0 z-30">
        <button
          onClick={() => router.push('/perfil')}
          className="flex-1 min-w-0 flex items-center gap-1 text-left"
          aria-label="Ver mi perfil"
        >
          <div className="min-w-0">
            <h1 className="text-base font-bold text-texto truncate">
              Caja
              {negocioNombre && (
                <span className="font-normal text-texto-3"> · {negocioNombre}</span>
              )}
            </h1>
            {userNombre && (
              <p className="text-[11px] font-medium text-texto-3 truncate">{userNombre}</p>
            )}
          </div>
          <Icon nombre="flechaAbajo" tamano={TAMANO_ICONO.chip} className="text-texto-3 flex-shrink-0" />
        </button>
        <div
          className={`flex-none flex items-center gap-1.5 h-7 px-2.5 rounded-full ${
            !isOnline || pendientesCount > 0 ? 'bg-aviso-fondo' : 'bg-marca-suave'
          }`}
        >
          <Icon
            nombre={!isOnline ? 'sinConexion' : 'enLinea'}
            tamano={TAMANO_ICONO.chip}
            className={!isOnline || pendientesCount > 0 ? 'text-aviso' : 'text-marca-suave-texto'}
          />
          <span
            className={`text-[11px] font-semibold whitespace-nowrap ${
              !isOnline || pendientesCount > 0 ? 'text-aviso' : 'text-marca-suave-texto'
            }`}
          >
            {!isOnline
              ? 'Sin conexión'
              : pendientesCount > 0
                ? `Sincronizando… ${pendientesCount}`
                : 'En línea'}
          </span>
        </div>
        <ThemeToggle variant="neutro" />
      </header>

      {!isOnline && pendientesCount > 0 && (
        <div className="mx-4 mt-3 p-2.5 bg-tarjeta-hundida border border-borde-campo rounded-xl text-texto-2 text-xs text-center">
          {pendientesCount} cambio{pendientesCount === 1 ? '' : 's'} guardado{pendientesCount === 1 ? '' : 's'} en el dispositivo, pendiente{pendientesCount === 1 ? '' : 's'} de sincronizar
        </div>
      )}

      {/* Distinto a propósito del chip ámbar de "sin conexión" — tokens de
          negativo, no de aviso, para que no se confunda con el estado
          normal de offline. Esto es "tengo señal y aun así no puedo
          enviar", que es mucho más grave: ver el caso real de
          AbortSignal.timeout en Chrome 94 (brief de compatibilidad con
          navegadores viejos) — ventas trabadas horas sin ningún aviso
          porque este caso se veía idéntico al offline normal. */}
      {colaAtascada && (
        <div className="mx-4 mt-3 p-3 bg-negativo-fondo border border-negativo-borde rounded-xl text-negativo text-xs text-center space-y-0.5">
          <p className="font-bold">
            No se {pendientesCount === 1 ? 'está pudiendo enviar' : 'están pudiendo enviar'} {pendientesCount} cambio{pendientesCount === 1 ? '' : 's'}.
          </p>
          <p>
            Tienes conexión, pero algo está bloqueando el envío desde hace varios minutos. Avísale a soporte antes de cerrar sesión.
          </p>
        </div>
      )}

      {/* Search + filtros: un solo bloque visual */}
      <div className="px-4 pt-3 pb-2 bg-superficie-barra border-b border-borde-divisor flex flex-col gap-2.5">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Icon nombre="buscar" tamano={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-texto-4" />
            <input
              ref={searchRef}
              type="text"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              onKeyDown={handleBuscadorKeyDown}
              placeholder="Buscar producto..."
              className="w-full pl-9 pr-8 py-2.5 border border-borde-campo rounded-xl text-sm bg-tarjeta text-texto placeholder:text-texto-4 focus:outline-none focus:border-foco"
            />
            {busqueda && (
              <button
                onClick={() => setBusqueda('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-texto-4"
              >
                <Icon nombre="cerrar" tamano={16} />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowScanner(true)}
            className="bg-marca active:bg-marca-presion text-texto-invertido p-2.5 rounded-xl flex items-center justify-center"
            aria-label="Escanear código"
          >
            <Icon nombre="escanearCodigoBarras" tamano={20} />
          </button>
        </div>

        {/* pb-2 + overflow visible: deja aire para que la barra de scroll del
            navegador no quede pegada/pisando los chips (mismo criterio que en
            Inventario y Fiado, que usan pb-1 — acá Juan pidió más separación
            todavía) */}
        <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-2">
          <ChipFiltro activo={chip === 'todos'} onClick={() => setChip('todos')}>Todos</ChipFiltro>
          <ChipFiltro activo={chip === 'porPeso'} onClick={() => setChip('porPeso')}>Por peso</ChipFiltro>
          {usaStock && (
            <>
              <ChipFiltro activo={chip === 'bajo'} onClick={() => setChip('bajo')}>Stock bajo</ChipFiltro>
              <ChipFiltro activo={chip === 'sin'} onClick={() => setChip('sin')}>Sin stock</ChipFiltro>
            </>
          )}
        </div>
      </div>

      {tasa === 0 && (
        <div className="mx-4 mt-3 p-3 bg-aviso-fondo border border-aviso-borde rounded-xl text-aviso text-sm text-center">
          Configura la tasa BCV para ver precios en Bs
        </div>
      )}

      {/* Product list */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2">
        {cargandoProductos ? (
          <div className="text-center text-texto-4 py-16">
            <Icon nombre="cargando" tamano={32} className="mx-auto mb-3 text-marca animate-spin" />
            <p className="text-sm">Cargando productos...</p>
          </div>
        ) : productos.length === 0 ? (
          <div className="text-center text-texto-4 py-16">
            <Icon nombre="sinProductos" tamano={48} className="mx-auto mb-3 text-texto-4" />
            <p className="font-medium">Sin productos</p>
            <p className="text-sm mt-1">Agrega productos en Inventario</p>
          </div>
        ) : productosFiltrados.length === 0 ? (
          <div className="text-center text-texto-4 py-12">
            <p>{busqueda ? `No se encontró "${busqueda}"` : 'No hay productos en este filtro'}</p>
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
                className="bg-tarjeta rounded-xl p-4 flex flex-col gap-2.5 shadow-sm border border-borde-tarjeta"
              >
                {/* Fila 1: nombre + precio */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="font-medium text-texto">{formatearNombre(producto.nombre)}</p>
                      {producto.por_peso && (
                        <span className="text-xs bg-informativo-fondo text-informativo px-1.5 py-0.5 rounded-full font-medium flex-shrink-0">
                          /kg
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-texto-2 mt-0.5 tabular-nums">
                      {producto.codigo_barra || 'Sin código'}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {pbs !== null ? (
                      <>
                        <p className="text-2xl font-bold text-texto">
                          {formatBS(pbs)}
                          {producto.por_peso && <span className="text-sm font-normal text-texto-4"> / kg</span>}
                        </p>
                        <p className="text-sm text-texto-4">
                          {pusd !== null ? formatUSD(pusd) : ''}
                          {producto.por_peso ? ' / kg' : ''}
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-texto-4">
                        {producto.precio.toLocaleString('es-VE')} {producto.moneda}
                        {producto.por_peso ? ' / kg' : ''} · tasa no configurada
                      </p>
                    )}
                  </div>
                </div>

                {/* Fila 2: stock (izquierda) + botón agregar (derecha, abajo) */}
                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {usaStock && (
                      <>
                        <StockBadge
                          stock={producto.stock}
                          stockMinimo={producto.stock_minimo}
                          controlaStock={producto.controla_stock}
                          esPorPeso={producto.por_peso}
                          isOnline={isOnline}
                          ultimaSincronizacion={ultimaSincronizacion}
                        />
                        {producto.controla_stock !== false && producto.stock != null && producto.stock_minimo != null &&
                          !debeOcultarStock(producto.stock, producto.stock_minimo, isOnline, ultimaSincronizacion) && (
                            <div className="mt-1.5 h-1 w-full max-w-[120px] rounded-full bg-tarjeta-hundida overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  producto.stock <= 0
                                    ? 'bg-negativo'
                                    : stockBajo(producto.stock, producto.stock_minimo)
                                      ? 'bg-aviso'
                                      : 'bg-marca'
                                }`}
                                style={{
                                  width: `${Math.min(100, (producto.stock / (producto.stock_minimo * 3)) * 100)}%`,
                                }}
                              />
                            </div>
                          )}
                      </>
                    )}
                  </div>

                  {producto.por_peso ? (
                    <button
                      onClick={() => agregarAlCarrito(producto)}
                      className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-marca active:bg-marca-presion text-texto-invertido"
                    >
                      {pesoCount > 0 && (
                        <span className="bg-white/30 text-texto-invertido text-xs font-bold px-1.5 py-0.5 rounded-full">
                          {pesoCount}
                        </span>
                      )}
                      <Icon nombre="balanza" tamano={16} />
                    </button>
                  ) : (
                    <button
                      onClick={() => agregarAlCarrito(producto)}
                      className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${
                        enCarrito
                          ? 'bg-marca-suave text-marca-suave-texto'
                          : 'bg-marca active:bg-marca-presion text-texto-invertido'
                      }`}
                    >
                      {enCarrito ? (
                        <>
                          <span>{enCarrito.cantidad}</span>
                          <Icon nombre="agregar" tamano={16} />
                        </>
                      ) : (
                        <Icon nombre="agregar" tamano={20} />
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Floating cart */}
      {totalItems > 0 && !showCarrito && !showPago && (
        <button
          onClick={() => setShowCarrito(true)}
          className="fixed bottom-20 right-4 bg-marca active:bg-marca-presion text-texto-invertido px-5 py-3 rounded-2xl shadow-xl flex items-center gap-2 z-30"
        >
          <Icon nombre="caja" tamano={20} />
          <span key={totalItems} className="font-bold animate-cart-pop">{totalItems}</span>
          <span className="hidden sm:inline">·</span>
          <span className="font-semibold text-sm hidden sm:inline">{formatBS(totalBS)}</span>
        </button>
      )}

      {/* Cart bottom sheet */}
      {showCarrito && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-overlay" onClick={() => setShowCarrito(false)} />
          <div className="relative w-full max-w-lg mx-auto bg-tarjeta rounded-t-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center gap-2 p-4 pb-2.5">
              <h2 className="flex-1 text-lg font-bold text-texto tracking-tight">Carrito</h2>
              {carrito.length > 0 && (
                <button
                  onClick={() => setShowConfirmVaciar(true)}
                  className="h-[34px] px-3 rounded-full bg-negativo-fondo border border-negativo-borde text-negativo text-xs font-semibold"
                >
                  Vaciar
                </button>
              )}
              <button onClick={() => setShowCarrito(false)} className="p-2.5 -mr-2.5 text-texto-3" aria-label="Cerrar">
                <Icon nombre="cerrar" tamano={22} />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-2 space-y-2.5">
              {carrito.map(item => (
                <div
                  key={item.lineId}
                  className="bg-tarjeta border border-borde-tarjeta rounded-2xl p-3 flex flex-col gap-2.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 font-semibold text-[15px] leading-snug text-texto">
                      {formatearNombre(item.producto.nombre)}
                      {item.esPorPeso && item.gramos && (
                        <span className="font-medium text-texto-3"> — {item.gramos}g</span>
                      )}
                    </p>
                    <p className="flex-shrink-0 font-bold text-texto tabular-nums">
                      {formatBS(itemPrecioBS(item))}
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-texto-2 tabular-nums">
                      {formatBS(precioBS(item.producto, tasa))}
                      {item.esPorPeso ? ' / kg' : ' c/u'}
                    </p>

                    {item.esPorPeso ? (
                      // Weight items: just a remove button, no quantity stepper
                      <button
                        onClick={() => removerItem(item.lineId)}
                        className="flex-shrink-0 h-11 px-3.5 flex items-center gap-1.5 rounded-[10px] bg-negativo-fondo border border-negativo-borde text-negativo text-sm font-semibold"
                      >
                        <Icon nombre="cerrar" tamano={16} />
                        Quitar
                      </button>
                    ) : (
                      // Regular items: quantity stepper
                      <div className="flex-shrink-0 flex items-center gap-1">
                        <button
                          onClick={() => actualizarCantidad(item.lineId, -1)}
                          aria-label="Quitar uno"
                          className="w-11 h-11 rounded-[10px] border border-borde-campo bg-tarjeta-hundida flex items-center justify-center text-lg font-bold text-texto"
                        >
                          −
                        </button>
                        <span className="min-w-[36px] text-center font-bold text-texto tabular-nums">
                          {item.cantidad}
                        </span>
                        <button
                          onClick={() => actualizarCantidad(item.lineId, 1)}
                          aria-label="Agregar uno"
                          className="w-11 h-11 rounded-[10px] border border-borde-campo bg-tarjeta-hundida flex items-center justify-center text-lg font-bold text-texto"
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex-none p-4 pt-3 flex flex-col gap-3 border-t border-borde-divisor">
              <div className="p-4 rounded-2xl bg-tinta">
                <p className="text-[11px] font-bold uppercase tracking-wide text-tinta-etiqueta">
                  Total a cobrar
                </p>
                <p className="mt-1.5 text-[28px] leading-none font-extrabold tracking-tight text-tinta-texto tabular-nums">
                  {formatBS(totalBS)}
                </p>
                {tasa > 0 && (
                  <p className="mt-2 text-sm text-tinta-etiqueta tabular-nums">{formatUSD(totalUSD)}</p>
                )}
              </div>
              <Button
                variante="primario"
                onClick={() => { setShowCarrito(false); setShowPago(true); }}
                className="w-full"
              >
                Cobrar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Payment sheet */}
      {showPago && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-overlay" onClick={() => { cerrarPago(); setShowCarrito(true); }} />
          <div className="relative w-full max-w-lg mx-auto bg-tarjeta rounded-t-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center gap-1 p-4 pb-2.5">
              <button
                onClick={() => { cerrarPago(); setShowCarrito(true); }}
                aria-label="Volver al carrito"
                className="flex-shrink-0 p-2.5 -ml-2.5 text-texto-2"
              >
                <Icon nombre="flechaAbajo" tamano={22} className="rotate-90" />
              </button>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold text-texto tracking-tight">
                  {modoPagoMixto ? 'Pago mixto' : 'Cobrar'}
                </h2>
                {modoPagoMixto && (
                  <button onClick={salirPagoMixto} className="text-xs font-medium text-texto-3">
                    Volver a un solo método
                  </button>
                )}
              </div>
              <button
                onClick={() => { cerrarPago(); setShowCarrito(true); }}
                aria-label="Cerrar"
                className="flex-shrink-0 p-2.5 -mr-2.5 text-texto-3"
              >
                <Icon nombre="cerrar" tamano={22} />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4">
              <div className="p-5 rounded-2xl bg-tinta">
                {modoPagoMixto && pagosMixtos.length > 0 && !pagoMixtoCompleto ? (
                  <>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-tinta-etiqueta">Falta</p>
                    <p className="mt-1.5 text-[32px] leading-none font-extrabold tracking-tight text-tinta-texto tabular-nums">
                      {formatBS(residuoMixtoBs)}
                    </p>
                    {tasa > 0 && (
                      <p className="mt-2 text-sm text-tinta-etiqueta tabular-nums">{formatUSD(residuoMixtoUsd)}</p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-tinta-etiqueta">Total a cobrar</p>
                    <p className="mt-1.5 text-[32px] leading-none font-extrabold tracking-tight text-tinta-texto tabular-nums">
                      {formatBS(totalBS)}
                    </p>
                    {tasa > 0 && (
                      <p className="mt-2 text-sm text-tinta-etiqueta tabular-nums">{formatUSD(totalUSD)}</p>
                    )}
                  </>
                )}
                <div className="mt-4 pt-3.5 border-t border-white/10 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-tinta-etiqueta">Productos</p>
                    <p className="mt-1 text-xl font-bold text-tinta-texto tabular-nums">{totalItems}</p>
                  </div>
                  <div className="pl-3 border-l border-white/10">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-tinta-etiqueta">Tasa</p>
                    <p className="mt-1 text-xl font-bold text-tinta-texto tabular-nums">
                      {tasa > 0 ? tasa.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                    </p>
                  </div>
                </div>
              </div>

              {modoPagoMixto ? (
                <div className="flex flex-col gap-4">
                  {pagosMixtos.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {pagosMixtos.map((p, i) => {
                        const info = METODOS_PAGO.find(m => m.id === p.metodo);
                        return (
                          <div key={i} className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-tarjeta-hundida">
                            <span className="text-sm font-semibold text-texto-2">{info?.label ?? p.metodo}</span>
                            <div className="flex items-center gap-3">
                              <div className="text-right">
                                <p className="font-bold text-sm text-texto tabular-nums">{formatBS(p.monto_bs)}</p>
                                <p className="text-xs text-texto-4 tabular-nums">{formatUSD(p.monto_usd)}</p>
                              </div>
                              <button onClick={() => quitarPagoMixto(i)} className="text-texto-4" aria-label="Quitar pago">
                                <Icon nombre="cerrar" tamano={16} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {pagoMixtoCompleto && (
                    <div className="text-center py-3 rounded-xl bg-marca-suave text-marca-suave-texto font-bold">
                      Pago completo — listo para confirmar
                    </div>
                  )}

                  {!pagoMixtoCompleto && (
                    seleccionandoClienteCalculado ? (
                      <div>
                        <p className="text-sm text-texto-3 mb-2">Fiar el resto a:</p>
                        {renderSelectorClienteFiado(c => {
                          agregarPagoMixtoCalculado('fiado', c.id);
                          setSeleccionandoClienteCalculado(false);
                          setBusquedaClienteFiado('');
                        })}
                        <button
                          onClick={() => { setSeleccionandoClienteCalculado(false); setBusquedaClienteFiado(''); }}
                          className="text-xs font-medium text-texto-3 mt-2"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                    <div className="flex flex-col gap-3">
                      <p className="text-sm text-texto-3">
                        {pagosMixtos.length === 0 ? 'Elige el primer método' : 'Elige el método para el resto'}
                      </p>
                      <div className="flex flex-col gap-2">
                        {METODOS_PAGO.filter(m => !pagosMixtos.some(p => p.metodo === m.id)).map(m => {
                          const activo = metodoMixtoActual === m.id;
                          return (
                          <button
                            key={m.id}
                            onClick={() => {
                              if (pagosMixtos.length === 0) {
                                setMetodoMixtoActual(m.id);
                                setMontoMixtoInput('');
                                setClienteFiadoElegido(null);
                                // Precarga con el cliente del presupuesto que se
                                // está convirtiendo (si tenía uno) — le ahorra al
                                // cajero escribirlo de nuevo, solo confirma o crea.
                                setBusquedaClienteFiado(m.id === 'fiado' ? (presupuestoClienteNombre || '') : '');
                              } else if (m.id === 'fiado') {
                                setSeleccionandoClienteCalculado(true);
                                setBusquedaClienteFiado(presupuestoClienteNombre || '');
                              } else {
                                agregarPagoMixtoCalculado(m.id);
                              }
                            }}
                            className={`w-full flex items-center gap-3 h-[60px] px-3.5 rounded-2xl border text-left transition-colors ${
                              activo ? 'bg-marca-suave border-marca' : 'bg-tarjeta border-borde-tarjeta'
                            }`}
                          >
                            <span className={`flex-shrink-0 w-9 h-9 rounded-[10px] flex items-center justify-center ${
                              activo ? 'bg-marca text-texto-invertido' : 'bg-tarjeta-hundida text-texto-2'
                            }`}>
                              <Icon nombre={ICONO_METODO_PAGO[m.id]} tamano={20} />
                            </span>
                            <span className="flex-1 min-w-0 font-semibold text-[15px] text-texto">{m.label}</span>
                            <span className={`flex-shrink-0 w-[22px] h-[22px] rounded-full border-2 flex items-center justify-center ${
                              activo ? 'bg-marca border-marca' : 'border-borde-campo'
                            }`}>
                              {activo && <Icon nombre="confirmar" tamano={14} className="text-texto-invertido" />}
                            </span>
                          </button>
                          );
                        })}
                      </div>

                      {pagosMixtos.length === 0 && metodoMixtoActual && (
                        <div className="flex flex-col gap-2">
                          <label className="text-[11px] font-bold uppercase tracking-wide text-texto-3">
                            Monto ({metodoMixtoActual === 'efectivo_usd' ? '$' : 'Bs'})
                          </label>
                          <div className="flex gap-2">
                            <input
                              type="number"
                              step="0.01"
                              value={montoMixtoInput}
                              onChange={e => setMontoMixtoInput(e.target.value)}
                              className="flex-1 min-w-0 h-[52px] px-3.5 rounded-xl bg-tarjeta-hundida border border-borde-campo text-xl font-bold text-texto tabular-nums focus:outline-none focus:border-foco"
                              placeholder="0,00"
                              autoFocus={metodoMixtoActual !== 'fiado'}
                            />
                            <button
                              onClick={agregarPagoMixtoManual}
                              disabled={
                                !montoMixtoInput ||
                                parseFloat(montoMixtoInput) <= 0 ||
                                (metodoMixtoActual === 'fiado' && !clienteFiadoElegido)
                              }
                              className="px-4 rounded-xl bg-marca active:bg-marca-presion text-texto-invertido font-semibold disabled:opacity-40"
                            >
                              Agregar
                            </button>
                          </div>
                          {metodoMixtoActual === 'fiado' && (
                            <div className="mt-1">
                              {clienteFiadoElegido ? (
                                <div className="flex items-center justify-between px-3.5 py-3 rounded-xl bg-deuda-fondo">
                                  <p className="font-semibold text-sm text-texto">{clienteFiadoElegido.nombre}</p>
                                  <button
                                    onClick={() => { setClienteFiadoElegido(null); setBusquedaClienteFiado(''); }}
                                    className="text-xs font-medium text-texto-3"
                                  >
                                    Cambiar
                                  </button>
                                </div>
                              ) : renderSelectorClienteFiado(c => setClienteFiadoElegido(c))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    )
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    {METODOS_PAGO.map(m => {
                      const activo = metodo === m.id;
                      return (
                      <button
                        key={m.id}
                        onClick={() => {
                          setMetodo(m.id);
                          setMontoRecibido('');
                          setClienteFiadoElegido(null);
                          // Precarga con el cliente del presupuesto que se está
                          // convirtiendo (si tenía uno) — le ahorra al cajero
                          // escribirlo de nuevo, solo confirma o crea.
                          setBusquedaClienteFiado(m.id === 'fiado' ? (presupuestoClienteNombre || '') : '');
                        }}
                        className={`w-full flex items-center gap-3 h-[60px] px-3.5 rounded-2xl border text-left transition-colors ${
                          activo ? 'bg-marca-suave border-marca' : 'bg-tarjeta border-borde-tarjeta'
                        }`}
                      >
                        <span className={`flex-shrink-0 w-9 h-9 rounded-[10px] flex items-center justify-center ${
                          activo ? 'bg-marca text-texto-invertido' : 'bg-tarjeta-hundida text-texto-2'
                        }`}>
                          <Icon nombre={ICONO_METODO_PAGO[m.id]} tamano={20} />
                        </span>
                        <span className="flex-1 min-w-0 font-semibold text-[15px] text-texto">{m.label}</span>
                        <span className={`flex-shrink-0 w-[22px] h-[22px] rounded-full border-2 flex items-center justify-center ${
                          activo ? 'bg-marca border-marca' : 'border-borde-campo'
                        }`}>
                          {activo && <Icon nombre="confirmar" tamano={14} className="text-texto-invertido" />}
                        </span>
                      </button>
                      );
                    })}

                    <button
                      onClick={iniciarPagoMixto}
                      className="w-full flex items-center gap-3 h-14 px-3.5 rounded-2xl border border-dashed border-borde-tarjeta text-left"
                    >
                      <span className="flex-shrink-0 w-9 h-9 rounded-[10px] bg-informativo-fondo text-informativo flex items-center justify-center">
                        <Icon nombre="pagoMixto" tamano={20} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block font-semibold text-[15px] text-texto">Pago mixto</span>
                        <span className="block mt-0.5 text-xs text-texto-3">
                          Combinar dos métodos — el resto se calcula solo
                        </span>
                      </span>
                    </button>
                  </div>

                  {(metodo === 'efectivo_bs' || metodo === 'efectivo_usd') && (
                    <div className="flex flex-col gap-2">
                      <label className="text-[11px] font-bold uppercase tracking-wide text-texto-3">
                        Monto recibido ({metodo === 'efectivo_bs' ? 'Bs' : '$'})
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={montoRecibido}
                        onChange={e => setMontoRecibido(e.target.value)}
                        className="h-[52px] px-3.5 rounded-xl bg-tarjeta-hundida border border-borde-campo text-xl font-bold text-texto tabular-nums focus:outline-none focus:border-foco"
                        placeholder="0,00"
                        autoFocus
                      />
                      {montoRecibido && cambio !== null && (
                        <div className={`flex items-center justify-between px-3.5 py-3 rounded-xl ${
                          cambio >= 0 ? 'bg-tarjeta-hundida' : 'bg-negativo-fondo border border-negativo-borde'
                        }`}>
                          <span className={`text-sm font-semibold ${cambio >= 0 ? 'text-texto-2' : 'text-negativo'}`}>
                            {cambio >= 0 ? 'Vuelto' : 'Falta'}
                          </span>
                          <span className={`text-xl font-bold tabular-nums ${cambio >= 0 ? 'text-texto' : 'text-negativo'}`}>
                            {cambio >= 0
                              ? (metodo === 'efectivo_bs' ? formatBS(cambio) : formatUSD(cambio))
                              : (metodo === 'efectivo_bs' ? formatBS(-cambio) : formatUSD(-cambio))}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {metodo === 'fiado' && (
                    <div>
                      {clienteFiadoElegido ? (
                        <div className="flex items-center justify-between px-3.5 py-3 rounded-xl bg-deuda-fondo">
                          <div>
                            <p className="text-[11px] font-bold uppercase tracking-wide text-deuda">Fiado a</p>
                            <p className="font-bold text-texto">{clienteFiadoElegido.nombre}</p>
                          </div>
                          <button
                            onClick={() => { setClienteFiadoElegido(null); setBusquedaClienteFiado(''); }}
                            className="text-xs font-medium text-texto-3"
                          >
                            Cambiar
                          </button>
                        </div>
                      ) : renderSelectorClienteFiado(c => setClienteFiadoElegido(c))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex-none p-4 pt-3 border-t border-borde-divisor">
              <Button variante="primario" onClick={confirmarVenta} disabled={!puedeConfirmar} className="w-full">
                {puedeConfirmar ? 'Confirmar cobro' : 'Elige el método de pago'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Venta confirmada — momento natural para compartir el comprobante,
          el cliente sigue ahí parado. Mismo lenguaje visual que "Presupuesto
          guardado" (presupuestos/nuevo), pero como hoja inferior en vez de
          pantalla completa, y con el orden de énfasis que ya tenía Caja:
          "Nueva venta" primario, "Compartir comprobante" secundario. */}
      {ventaConfirmada && (
        <div className="fixed inset-0 z-50 bg-superficie flex flex-col items-center justify-center p-6 text-center">
          <div className="w-full max-w-sm">
            <div className="w-16 h-16 bg-marca-suave rounded-full flex items-center justify-center mx-auto mb-3">
              <Icon nombre="confirmar" tamano={32} className="text-marca-suave-texto" />
            </div>
            <h2 className="text-lg font-bold text-texto">Venta registrada</h2>
            <p className="text-2xl font-bold text-marca mt-1 tabular-nums">
              {formatBS(ventaConfirmada.venta.total_bs)}
            </p>
            {tasa > 0 && (
              <p className="text-texto-4 text-sm tabular-nums">{formatUSD(ventaConfirmada.venta.total_usd)}</p>
            )}

            <div className="mt-6 flex flex-col gap-2">
              <Button variante="primario" onClick={() => setVentaConfirmada(null)}>
                Nueva venta
              </Button>
              <Button
                variante="secundario"
                onClick={() => compartirComprobanteVenta(ventaConfirmada.venta, ventaConfirmada.numero)}
                disabled={compartiendoComprobante}
              >
                <Icon nombre="compartir" tamano={TAMANO_ICONO.secundario} />
                {compartiendoComprobante ? 'Generando...' : 'Compartir comprobante'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Weight input modal */}
      {showPeso && productoPeso && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-overlay" onClick={() => setShowPeso(false)} />
          <div className="relative w-full max-w-lg mx-auto bg-tarjeta rounded-t-2xl">
            <div className="flex items-start justify-between gap-3 p-4 pb-2.5">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-texto leading-snug">Pesar {productoPeso.nombre}</h2>
                <p className="text-sm text-texto-3 mt-0.5 tabular-nums">
                  {tasa > 0
                    ? `${formatBS(precioBS(productoPeso, tasa))} / kg`
                    : `${productoPeso.precio} ${productoPeso.moneda} / kg`}
                </p>
              </div>
              <button
                onClick={() => setShowPeso(false)}
                aria-label="Cerrar"
                className="flex-shrink-0 p-2.5 -mr-2.5 -mt-1 text-texto-3"
              >
                <Icon nombre="cerrar" tamano={22} />
              </button>
            </div>

            <div className="p-4 pt-1.5 flex flex-col gap-4">
              <input
                type="number"
                inputMode="numeric"
                step="1"
                min="1"
                value={gramos}
                onChange={e => setGramos(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && agregarPorPeso()}
                placeholder="Gramos"
                className="w-full h-[76px] rounded-2xl bg-tarjeta-hundida border border-borde-campo px-4 text-3xl font-bold text-texto text-center tabular-nums focus:outline-none focus:border-foco"
                autoFocus
              />

              {pesoPreviewBS !== null || pesoPreviewUSD !== null ? (
                <div className="text-center py-3 rounded-xl bg-tarjeta-hundida">
                  {pesoPreviewBS !== null && (
                    <p className="text-2xl font-bold text-texto tabular-nums">{formatBS(pesoPreviewBS)}</p>
                  )}
                  {pesoPreviewUSD !== null && (
                    <p className="text-sm text-texto-4 mt-0.5 tabular-nums">{formatUSD(pesoPreviewUSD)}</p>
                  )}
                </div>
              ) : gramosNum > 0 ? (
                <div className="text-center py-3 rounded-xl bg-tarjeta-hundida">
                  <p className="text-sm text-texto-4">Configura la tasa BCV para ver precio en Bs</p>
                </div>
              ) : null}

              <Button variante="primario" onClick={agregarPorPeso} disabled={!gramos || gramosNum <= 0}>
                Agregar al carrito
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Scanner */}
      {showScanner && <Scanner continuous onDetect={handleScan} onClose={() => setShowScanner(false)} />}

      {showConfirmVaciar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-overlay" onClick={() => setShowConfirmVaciar(false)} />
          <div className="relative bg-tarjeta rounded-2xl w-full max-w-sm shadow-xl p-6">
            <h2 className="text-lg font-bold text-texto mb-2">Vaciar carrito</h2>
            <p className="text-texto-3 mb-5">
              Se {carrito.length === 1 ? 'va a quitar' : 'van a quitar'} {carrito.length} producto{carrito.length === 1 ? '' : 's'} del carrito. Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3">
              <Button variante="secundario" onClick={() => setShowConfirmVaciar(false)} className="flex-1">
                Cancelar
              </Button>
              <Button variante="destructivo" onClick={confirmarVaciarCarrito} className="flex-1">
                Vaciar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-toast-fondo text-toast-texto px-5 py-2.5 rounded-xl text-sm font-medium z-50 shadow-lg whitespace-nowrap">
          {toast}
        </div>
      )}

      {/* Checklist de bienvenida: primer login, una sola vez */}
      {mostrarTutorial && (
        <ChecklistBienvenida onCerrar={() => setMostrarTutorial(false)} />
      )}
    </div>
  );
}
