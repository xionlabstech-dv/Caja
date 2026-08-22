export interface Producto {
  id: string;
  codigo_barra: string | null;
  nombre: string;
  moneda: 'USD' | 'VES';
  precio: number;
  activo: boolean;
  por_peso: boolean;
  // Costo de adquisición, en la MISMA moneda que `precio` (por kilo si
  // por_peso). null = sin costo registrado. Información sensible del dueño
  // — nunca se muestra a un cajero, verificado por rol en cada pantalla que
  // la toca (no solo ocultada visualmente).
  costo?: number | null;
  // Existencia actual (unidades, o kilos si por_peso). null = nunca se
  // inicializó — distinto de cero, no dispara alertas de stock bajo.
  // Puede quedar negativo: se permite vender sin existencia, nunca se
  // bloquea la venta.
  stock?: number | null;
  // Umbral de alerta: cuando stock <= stock_minimo se considera "bajo".
  stock_minimo?: number | null;
  // Permite excluir productos puntuales del control (granel, servicios).
  // Solo aplica si el negocio tiene usa_stock activo. Default true.
  controla_stock?: boolean;
}

export interface Configuracion {
  id: number;
  tasa: number;
  tasa_actualizada_en: string;
}

export interface VentaItem {
  id: string;
  producto_id: string;
  nombre: string;
  precio_bs: number;
  cantidad: number;
  subtotal_bs: number;
  gramos?: number;
  // Precio unitario (o por kg si es pesable) al momento de la venta — se usa
  // para el respaldo en Supabase (venta_items.precio_bs/cantidad son
  // "unitario × cantidad", no el subtotal ya calculado que usa la UI local).
  precioUnitarioBs: number;
  precioUnitarioUsd: number;
  // Snapshot del costo unitario (o por kg) en USD al momento de la venta —
  // igual que nombre/usuario_nombre, congelado para siempre: si el costo del
  // producto cambia después, las ganancias históricas no se recalculan.
  // null si el producto no tenía costo registrado en ese momento.
  costo_usd?: number | null;
}

export type MetodoPago = 'efectivo_bs' | 'pago_movil' | 'biopago' | 'tarjeta' | 'efectivo_usd';

// 'mixto' solo aparece en Venta.metodo_pago (cuando pagos.length > 1) — un
// pago individual (PagoVenta.metodo) siempre es un MetodoPago real.
export type MetodoPagoVenta = MetodoPago | 'mixto';

export type Rol = 'admin' | 'cajero';

// Un pago cubre parte (o todo) el total de una venta. Snapshot: monto_bs y
// monto_usd quedan convertidos a la tasa ya congelada de la venta (Venta.
// tasa_usada), igual que costo_usd en VentaItem — no se recalculan después.
// Para una venta de un solo método, pagos trae un único elemento (orden 1,
// montos = totales de la venta): un solo camino de código, sin ramas
// especiales para "venta simple" vs. "venta mixta".
export interface PagoVenta {
  id: string;
  orden: number;
  metodo: MetodoPago;
  monto_bs: number;
  monto_usd: number;
}

export interface Venta {
  id: string;
  fecha: string;
  fecha_dia: string;
  items: VentaItem[];
  // Vale el método único cuando pagos trae un solo elemento, y 'mixto'
  // cuando trae varios. Se conserva (no se deriva de pagos en cada lectura)
  // porque Resumen y el histórico lo usan para mostrar la venta de un
  // vistazo sin tener que inspeccionar el arreglo completo.
  metodo_pago: MetodoPagoVenta;
  pagos: PagoVenta[];
  total_bs: number;
  total_usd: number;
  tasa_usada: number;
  cierre_id?: string;
  // Marca si ya se respaldó en Supabase — evita que la cola tenga que
  // reescanear el historial completo de ventas para saber qué falta subir.
  sincronizada?: boolean;
  // Atribución: quién hizo la venta. usuario_nombre es un snapshot (igual
  // que el nombre de producto en los items) — funciona offline y no se
  // altera si luego cambia el nombre visible del usuario.
  usuario_id?: string;
  usuario_nombre?: string;
  // Anulación (evento aparte, no una edición — regla 8): la venta original
  // (monto, items, pagos) nunca se toca. Ausente/false = vigente. No
  // requiere migración de IndexedDB: una venta local guardada antes de
  // este cambio simplemente no trae `anulada`, que se lee igual de falsy
  // que `false`.
  anulada?: boolean;
  anulada_en?: string;
  anulada_por?: string;
  // Snapshot, igual que usuario_nombre — no se altera si luego cambia el
  // nombre visible de quien anuló.
  anulada_por_nombre?: string;
  motivo_anulacion?: string;
}

export interface DesgloseCierre {
  bs: number;
  usd: number;
  count: number;
}

export interface CierreCaja {
  id: string;
  periodo_inicio: string;
  periodo_fin: string;
  total_bs: number;
  total_usd: number;
  cantidad_ventas: number;
  desglose_metodos: Partial<Record<MetodoPago, DesgloseCierre>>;
  tasa_cierre: number;
  creado_en: string;
  usuario_id?: string;
  usuario_nombre?: string;
}

export interface ItemCarrito {
  lineId: string;
  producto: Producto;
  cantidad: number;
  esPorPeso?: boolean;
  gramos?: number;
  precioCalculadoBase?: number;
}

// 'anulacion' solo la genera el servidor (dentro de anular_venta, nunca se
// crea desde el formulario de Movimientos) al reversar el stock de una
// venta anulada.
export type TipoMovimiento = 'entrada' | 'salida' | 'ajuste' | 'venta' | 'anulacion';

export type MotivoMovimiento =
  | 'compra'
  | 'devolucion_cliente'
  | 'consumo_propio'
  | 'dano'
  | 'vencido'
  | 'perdida'
  | 'devolucion_proveedor'
  | 'conteo_fisico'
  | 'correccion'
  | 'venta';

export interface MovimientoStock {
  id: string;
  producto_id: string;
  // Snapshot solo local (movimientos_stock en Supabase no tiene esta
  // columna, se resuelve ahí vía join con productos) — evita depender de
  // que el producto siga existiendo/con el mismo nombre para mostrar el
  // historial offline.
  producto_nombre: string;
  tipo: TipoMovimiento;
  // string, no MotivoMovimiento: para tipo 'anulacion' el motivo es el
  // texto libre que el admin escribió al anular la venta (mismo motivo que
  // quedó en ventas.motivo_anulacion), no uno de los valores fijos del
  // enum. Para el resto de los tipos sigue siendo uno de esos valores.
  motivo: string;
  // Positiva en entradas, negativa en salidas y ventas. En ajustes por
  // conteo es la diferencia ya calculada (puede ser + o -).
  cantidad: number;
  stock_resultante?: number | null;
  venta_id?: string;
  usuario_id?: string;
  usuario_nombre?: string;
  nota?: string;
  ocurrido_en: string;
  // Marca si ya se respaldó en Supabase (mismo patrón que Venta.sincronizada).
  sincronizado?: boolean;
}

export type TipoPendiente =
  | 'crear_producto'
  | 'editar_producto'
  | 'eliminar_producto'
  | 'actualizar_tasa'
  | 'cerrar_caja'
  | 'registrar_venta'
  | 'actualizar_cierre_ventas'
  | 'actualizar_usa_costos'
  | 'actualizar_usa_stock'
  | 'aplicar_movimiento_stock';

export interface PayloadCrearProducto {
  producto: Producto;
  negocioId: string;
}

export interface PayloadEditarProducto {
  id: string;
  datos: Partial<Producto>;
}

export interface PayloadEliminarProducto {
  id: string;
}

export interface PayloadActualizarTasa {
  tasa: number;
  negocioId: string;
}

export interface PayloadCerrarCaja {
  cierre: CierreCaja;
  negocioId: string;
}

export interface PayloadRegistrarVenta {
  ventaId: string;
  negocioId: string;
}

export interface PayloadActualizarCierreVentas {
  ventaIds: string[];
  cierreId: string;
}

export interface PayloadActualizarUsaCostos {
  usaCostos: boolean;
  negocioId: string;
}

export interface PayloadActualizarUsaStock {
  usaStock: boolean;
  negocioId: string;
}

export interface PayloadAplicarMovimientoStock {
  movimientoId: string;
  negocioId: string;
}

export type PayloadPendiente =
  | PayloadCrearProducto
  | PayloadEditarProducto
  | PayloadEliminarProducto
  | PayloadActualizarTasa
  | PayloadCerrarCaja
  | PayloadRegistrarVenta
  | PayloadActualizarCierreVentas
  | PayloadActualizarUsaCostos
  | PayloadActualizarUsaStock
  | PayloadAplicarMovimientoStock;

export interface OperacionPendiente {
  id: string;
  tipo: TipoPendiente;
  payload: PayloadPendiente;
  timestamp: string;
  intentos: number;
  ultimoIntento?: string;
}
