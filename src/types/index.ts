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

export type Rol = 'admin' | 'cajero';

export interface Venta {
  id: string;
  fecha: string;
  fecha_dia: string;
  items: VentaItem[];
  metodo_pago: MetodoPago;
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

export type TipoPendiente =
  | 'crear_producto'
  | 'editar_producto'
  | 'eliminar_producto'
  | 'actualizar_tasa'
  | 'cerrar_caja'
  | 'registrar_venta'
  | 'actualizar_cierre_ventas'
  | 'actualizar_usa_costos';

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

export type PayloadPendiente =
  | PayloadCrearProducto
  | PayloadEditarProducto
  | PayloadEliminarProducto
  | PayloadActualizarTasa
  | PayloadCerrarCaja
  | PayloadRegistrarVenta
  | PayloadActualizarCierreVentas
  | PayloadActualizarUsaCostos;

export interface OperacionPendiente {
  id: string;
  tipo: TipoPendiente;
  payload: PayloadPendiente;
  timestamp: string;
  intentos: number;
  ultimoIntento?: string;
}
