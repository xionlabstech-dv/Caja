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
  // La mantiene un trigger sobre movimientos_stock en Supabase — de solo
  // lectura para el cliente, nunca se escribe desde acá. En true, el campo
  // "Existencia actual" se bloquea en Inventario (ver guardar() en
  // inventario/page.tsx): con historial, el único camino para ajustar
  // stock es Movimientos, nunca un UPDATE directo que no deja rastro.
  // Ausente/false = producto sin movimientos, existencia editable.
  tiene_movimientos?: boolean;
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

// 'fiado' es un método más, exactamente igual que los demás: una fila más
// en venta_pagos con su monto_bs/monto_usd, dentro del mismo pago mixto.
// Lo que lo distingue es que además dispara un MovimientoFiado tipo
// 'cargo' ligado a un cliente — ver confirmarVenta() en src/app/page.tsx.
export type MetodoPago = 'efectivo_bs' | 'pago_movil' | 'biopago' | 'tarjeta' | 'efectivo_usd' | 'fiado';

// 'mixto' solo aparece en Venta.metodo_pago (cuando pagos.length > 1) — un
// pago individual (PagoVenta.metodo) siempre es un MetodoPago real.
export type MetodoPagoVenta = MetodoPago | 'mixto';

export type Rol = 'admin' | 'cajero';

// Estado de suscripción del negocio. El bloqueo real vive en Supabase (RLS
// + un trigger que mantiene negocios.activo sincronizado) — esto es
// puramente para que el cliente sepa qué explicarle al usuario, nunca para
// decidir qué está permitido de verdad.
//   activo:       todo funciona normal.
//   restringido:  vender, cerrar caja y fijar tasa siguen andando; el
//                 resto (productos, movimientos, anular, reportes) no.
//   suspendido:   nada funciona salvo leer su propio perfil/negocio, lo
//                 justo para mostrar una pantalla explicativa.
export type EstadoNegocio = 'activo' | 'restringido' | 'suspendido';

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
  // Abonos de fiado cobrados durante el período — aparte de total_bs/
  // total_usd, que son lo VENDIDO. Un abono puede cobrar deuda de una
  // venta de días atrás, así que no es lo mismo que "vendí hoy". Opcional:
  // un cierre guardado antes de esta función simplemente no los trae, y
  // leerlos como 0 es literalmente correcto (esos cierres nunca tuvieron
  // abonos que contar) — no hace falta migración de IndexedDB.
  total_abonado_bs?: number;
  total_abonado_usd?: number;
  cantidad_abonos?: number;
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

// Fiado: Nelson fija la deuda de sus clientes en dólares (para que la
// inflación no se la coma) y recibe los abonos en bolívares a la tasa del
// día. El id lo genera el dispositivo — crear un cliente tiene que
// funcionar sin conexión, igual que todo lo demás acá.
export interface ClienteFiado {
  id: string;
  nombre: string;
  // Siempre nace en 0 — un trigger en Supabase lo fuerza sin importar qué
  // se mande. El saldo real solo se mueve a través de
  // aplicar_movimiento_fiado (cargo suma, abono resta). Nunca se edita
  // desde ningún formulario, ni siquiera un admin.
  saldo_usd: number;
  creado_por?: string;
  creado_por_nombre?: string;
  creado_en: string;
}

export type TipoMovimientoFiado = 'cargo' | 'abono';

// Ledger de fiado, mismo patrón que MovimientoStock: cada fila es un
// evento inmutable (fiar o abonar), nunca se edita ni se borra.
export interface MovimientoFiado {
  id: string;
  cliente_id: string;
  // Snapshot solo local (fiado_movimientos en Supabase no tiene esta
  // columna) — igual que producto_nombre en MovimientoStock, para mostrar
  // el historial offline sin depender de que el cliente siga cacheado.
  cliente_nombre?: string;
  tipo: TipoMovimientoFiado;
  // El cliente entrega bolívares (el abono) o se le fía en dólares (el
  // cargo, calculado desde el monto_bs de esa porción de la venta) — el
  // equivalente en la otra moneda se calcula UNA vez, a la tasa de ese
  // momento, y se guarda tal cual. Nunca se deriva de nuevo después.
  monto_usd: number;
  monto_bs: number;
  tasa_usada: number;
  // Solo en cargos originados por una venta — un abono no está ligado a
  // una venta puntual.
  venta_id?: string;
  usuario_id?: string;
  usuario_nombre?: string;
  nota?: string;
  saldo_resultante?: number;
  ocurrido_en: string;
  // Marca si ya se respaldó en Supabase (mismo patrón que Venta.sincronizada).
  sincronizado?: boolean;
}

export type EstadoPresupuesto = 'vigente' | 'convertido' | 'anulado';

// Foto congelada del producto al momento de cotizar — mismo patrón exacto
// que VentaItem: si el precio del producto cambia después en Inventario,
// el presupuesto sigue diciendo lo que se cotizó.
export interface PresupuestoItem {
  id: string;
  producto_id?: string;
  nombre: string;
  cantidad: number;
  gramos?: number;
  precioUnitarioUsd: number;
  precioUnitarioBs: number;
}

export interface Presupuesto {
  id: string;
  cliente_nombre?: string;
  estado: EstadoPresupuesto;
  // 'vencido' no es un estado guardado — se calcula comparando esta fecha
  // contra hoy, en el momento de mostrarlo (ver presupuestos_listar en
  // Supabase y el mismo cálculo del lado del cliente para lo local).
  fecha_vencimiento: string;
  tasa_al_crear: number;
  total_usd: number;
  total_bs_estimado: number;
  // En Supabase vive en su propia tabla (presupuesto_items), pero acá se
  // guarda embebido — igual que Venta.items — porque es lo que permite
  // crear y convertir sin conexión. Puede faltar si este presupuesto se
  // conoce solo por el resumen remoto (presupuestos_listar, que no trae
  // items) y todavía no se pidieron sus items bajo demanda para convertirlo.
  items?: PresupuestoItem[];
  creado_por?: string;
  creado_por_nombre?: string;
  creado_en: string;
  convertido_en?: string;
  venta_id?: string;
  anulado_en?: string;
  motivo_anulacion?: string;
  // Igual que Venta.sincronizada, pero sobre el ESTADO actual (el de la
  // última transición: creado, convertido o anulado) — el sync periódico
  // del resumen nunca pisa un presupuesto con esto en false. Sin esto, un
  // "convertir" o "anular" recién hecho localmente podía volver a aparecer
  // como 'vigente' si el sync corría antes de que la cola confirmara el
  // cambio con el servidor — mismo bug que ya se corrigió para fiado.
  sincronizado?: boolean;
}

// Datos de contacto del negocio (quien emite), todos opcionales — un
// negocio puede cargar solo el teléfono y dejar el resto vacío. Se usan en
// la pantalla "Datos del negocio" y en el documento de presupuesto.
export interface DatosNegocio {
  direccion?: string;
  telefono?: string;
  correo?: string;
  rif?: string;
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
  | 'aplicar_movimiento_stock'
  | 'crear_cliente_fiado'
  | 'aplicar_movimiento_fiado'
  | 'crear_presupuesto'
  | 'actualizar_presupuesto'
  | 'actualizar_datos_negocio';

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

export interface PayloadCrearClienteFiado {
  cliente: ClienteFiado;
  negocioId: string;
}

export interface PayloadAplicarMovimientoFiado {
  movimientoId: string;
  negocioId: string;
}

export interface PayloadCrearPresupuesto {
  presupuesto: Presupuesto;
  negocioId: string;
}

export interface PayloadActualizarPresupuesto {
  presupuestoId: string;
  negocioId: string;
}

export interface PayloadActualizarDatosNegocio {
  datos: DatosNegocio;
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
  | PayloadAplicarMovimientoStock
  | PayloadCrearClienteFiado
  | PayloadAplicarMovimientoFiado
  | PayloadCrearPresupuesto
  | PayloadActualizarPresupuesto
  | PayloadActualizarDatosNegocio;

export interface OperacionPendiente {
  id: string;
  tipo: TipoPendiente;
  payload: PayloadPendiente;
  timestamp: string;
  intentos: number;
  ultimoIntento?: string;
}
