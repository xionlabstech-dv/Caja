import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Producto, Configuracion, Venta, CierreCaja, OperacionPendiente, Rol, MovimientoStock, MetodoPago, EstadoNegocio, ClienteFiado, MovimientoFiado, Presupuesto } from '@/types';

interface MetaItem {
  key: string;
  value: string;
}

interface CajaDBSchema extends DBSchema {
  productos: {
    key: string;
    value: Producto;
    indexes: { 'by-codigo': string };
  };
  configuracion: {
    key: number;
    value: Configuracion;
  };
  ventas: {
    key: string;
    value: Venta;
    indexes: { 'by-fecha-dia': string };
  };
  cierres: {
    key: string;
    value: CierreCaja;
  };
  meta: {
    key: string;
    value: MetaItem;
  };
  pendientes: {
    key: string;
    value: OperacionPendiente;
    indexes: { 'by-timestamp': string };
  };
  movimientos: {
    key: string;
    value: MovimientoStock;
    indexes: { 'by-producto': string };
  };
  clientes_fiado: {
    key: string;
    value: ClienteFiado;
  };
  fiado_movimientos: {
    key: string;
    value: MovimientoFiado;
    indexes: { 'by-cliente': string };
  };
  presupuestos: {
    key: string;
    value: Presupuesto;
  };
}

let dbPromise: Promise<IDBPDatabase<CajaDBSchema>> | null = null;

function getDB() {
  if (typeof window === 'undefined') throw new Error('IDB solo disponible en el browser');
  if (!dbPromise) {
    dbPromise = openDB<CajaDBSchema>('caja-db', 7, {
      async upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          const productosStore = db.createObjectStore('productos', { keyPath: 'id' });
          productosStore.createIndex('by-codigo', 'codigo_barra');
          db.createObjectStore('configuracion', { keyPath: 'id' });
          const ventasStore = db.createObjectStore('ventas', { keyPath: 'id' });
          ventasStore.createIndex('by-fecha-dia', 'fecha_dia');
        }
        if (oldVersion < 2) {
          db.createObjectStore('cierres', { keyPath: 'id' });
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        if (oldVersion < 3) {
          const pendientesStore = db.createObjectStore('pendientes', { keyPath: 'id' });
          pendientesStore.createIndex('by-timestamp', 'timestamp');
        }
        if (oldVersion < 4) {
          const movimientosStore = db.createObjectStore('movimientos', { keyPath: 'id' });
          movimientosStore.createIndex('by-producto', 'producto_id');
        }
        if (oldVersion < 5) {
          // Pago mixto: Venta gana `pagos: PagoVenta[]`, campo que las
          // ventas guardadas antes de esta versión no tienen. Se migran acá
          // con el mismo backfill que ya se aplicó en Supabase: un único
          // pago (orden 1) con el método y los totales que la venta ya
          // tenía. Sin esto, una venta local sin sincronizar quedaría sin
          // `pagos` y se perdería o llegaría incompleta al sincronizar.
          const store = transaction.objectStore('ventas');
          let cursor = await store.openCursor();
          while (cursor) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const v = cursor.value as any;
            if (!v.pagos) {
              await cursor.update({
                ...v,
                pagos: [{
                  id: crypto.randomUUID(),
                  orden: 1,
                  metodo: v.metodo_pago as MetodoPago,
                  monto_bs: v.total_bs,
                  monto_usd: v.total_usd,
                }],
              });
            }
            cursor = await cursor.continue();
          }
        }
        if (oldVersion < 6) {
          // Fiado: sin datos que migrar, es una funcionalidad enteramente
          // nueva — solo hace falta crear las stores.
          db.createObjectStore('clientes_fiado', { keyPath: 'id' });
          const fiadoMovStore = db.createObjectStore('fiado_movimientos', { keyPath: 'id' });
          fiadoMovStore.createIndex('by-cliente', 'cliente_id');
        }
        if (oldVersion < 7) {
          // Presupuestos: sin datos que migrar, funcionalidad enteramente
          // nueva — solo hace falta crear la store.
          db.createObjectStore('presupuestos', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export async function saveProductos(productos: Producto[]) {
  const db = await getDB();
  const tx = db.transaction('productos', 'readwrite');
  await Promise.all([...productos.map(p => tx.store.put(p)), tx.done]);
}

export async function getProductos(): Promise<Producto[]> {
  const db = await getDB();
  const all = await db.getAll('productos');
  return all.filter(p => p.activo);
}

export async function getProductoPorCodigo(codigo: string): Promise<Producto | undefined> {
  const db = await getDB();
  const result = await db.getFromIndex('productos', 'by-codigo', codigo);
  return result?.activo ? result : undefined;
}

export async function saveProducto(producto: Producto) {
  const db = await getDB();
  await db.put('productos', producto);
}

export async function deleteProductoDB(id: string) {
  const db = await getDB();
  await db.delete('productos', id);
}

export async function saveConfiguracion(config: Configuracion) {
  const db = await getDB();
  await db.put('configuracion', config);
}

export async function getConfiguracion(): Promise<Configuracion | undefined> {
  const db = await getDB();
  return db.get('configuracion', 1);
}

// Para revertir un guardado optimista de la tasa cuando nunca había existido
// configuración local previa (no hay a qué "volver", solo deshacer).
export async function deleteConfiguracion(): Promise<void> {
  const db = await getDB();
  await db.delete('configuracion', 1);
}

export async function saveVenta(venta: Venta) {
  const db = await getDB();
  await db.put('ventas', venta);
}

export async function getVenta(id: string): Promise<Venta | undefined> {
  const db = await getDB();
  return db.get('ventas', id);
}

export async function getVentasHoy(): Promise<Venta[]> {
  const db = await getDB();
  const today = new Date().toISOString().split('T')[0];
  return db.getAllFromIndex('ventas', 'by-fecha-dia', today);
}

export async function getVentasSinCerrar(): Promise<Venta[]> {
  const db = await getDB();
  const all = await db.getAll('ventas');
  return all.filter(v => !v.cierre_id);
}

export async function tagVentasConCierre(ventaIds: string[], cierreId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('ventas', 'readwrite');
  for (const id of ventaIds) {
    const venta = await tx.store.get(id);
    if (venta) await tx.store.put({ ...venta, cierre_id: cierreId });
  }
  await tx.done;
}

// Se llama SOLO después de que anularVenta() confirmó el éxito con el
// servidor — nunca antes, para no dejar el estado local mostrando una
// anulación que en realidad no se guardó (ver comentario de verificación
// de escrituras en sync.ts). No hay "desanular": es intencional, la RPC
// tampoco lo permite.
export async function marcarVentaAnulada(
  ventaId: string,
  datos: { anulada_en: string; anulada_por?: string; anulada_por_nombre?: string; motivo_anulacion: string },
): Promise<void> {
  const db = await getDB();
  const venta = await db.get('ventas', ventaId);
  if (venta) {
    await db.put('ventas', { ...venta, anulada: true, ...datos });
  }
}

export async function saveCierre(cierre: CierreCaja): Promise<void> {
  const db = await getDB();
  await db.put('cierres', cierre);
}

export async function getCierres(): Promise<CierreCaja[]> {
  const db = await getDB();
  const all = await db.getAll('cierres');
  return all.sort((a, b) => b.periodo_fin.localeCompare(a.periodo_fin));
}

export async function getUltimoCierre(): Promise<string | null> {
  const db = await getDB();
  const item = await db.get('meta', 'ultimoCierre');
  return item?.value ?? null;
}

export async function setUltimoCierre(ts: string): Promise<void> {
  const db = await getDB();
  await db.put('meta', { key: 'ultimoCierre', value: ts });
}

export async function getCachedNegocioId(): Promise<string | null> {
  const db = await getDB();
  const item = await db.get('meta', 'negocio_id');
  return item?.value ?? null;
}

export async function setCachedNegocioId(id: string): Promise<void> {
  const db = await getDB();
  await db.put('meta', { key: 'negocio_id', value: id });
}

export async function getCachedNegocioNombre(): Promise<string | null> {
  const db = await getDB();
  const item = await db.get('meta', 'negocio_nombre');
  return item?.value ?? null;
}

export async function setCachedNegocioNombre(nombre: string): Promise<void> {
  const db = await getDB();
  await db.put('meta', { key: 'negocio_nombre', value: nombre });
}

export async function getCachedRol(): Promise<Rol | null> {
  const db = await getDB();
  const item = await db.get('meta', 'rol');
  return (item?.value as Rol | undefined) ?? null;
}

export async function setCachedRol(rol: Rol): Promise<void> {
  const db = await getDB();
  await db.put('meta', { key: 'rol', value: rol });
}

export async function getCachedUsuarioNombre(): Promise<string | null> {
  const db = await getDB();
  const item = await db.get('meta', 'usuario_nombre');
  return item?.value ?? null;
}

export async function setCachedUsuarioNombre(nombre: string): Promise<void> {
  const db = await getDB();
  await db.put('meta', { key: 'usuario_nombre', value: nombre });
}

export async function getCachedUsaCostos(): Promise<boolean> {
  const db = await getDB();
  const item = await db.get('meta', 'usa_costos');
  return item?.value === 'true';
}

export async function setCachedUsaCostos(usaCostos: boolean): Promise<void> {
  const db = await getDB();
  await db.put('meta', { key: 'usa_costos', value: String(usaCostos) });
}

export async function getCachedUsaStock(): Promise<boolean> {
  const db = await getDB();
  const item = await db.get('meta', 'usa_stock');
  return item?.value === 'true';
}

export async function setCachedUsaStock(usaStock: boolean): Promise<void> {
  const db = await getDB();
  await db.put('meta', { key: 'usa_stock', value: String(usaStock) });
}

// Estado de suscripción del negocio y fecha de próximo pago — cacheados
// igual que rol/usaStock para que la app sepa qué explicar sin conexión.
// getCachedEstado nunca devuelve null: sin dato cacheado, el default es
// 'activo' (nunca dejar a un cliente al día fuera de su app por un cache
// vacío — la base es la que bloquea de verdad, esto solo explica).
export async function getCachedEstado(): Promise<EstadoNegocio> {
  const db = await getDB();
  const item = await db.get('meta', 'estado_negocio');
  return (item?.value as EstadoNegocio | undefined) ?? 'activo';
}

export async function setCachedEstado(estado: EstadoNegocio): Promise<void> {
  const db = await getDB();
  await db.put('meta', { key: 'estado_negocio', value: estado });
}

export async function getCachedFechaProximoPago(): Promise<string | null> {
  const db = await getDB();
  const item = await db.get('meta', 'fecha_proximo_pago');
  // '' es como se guarda "sin fecha" (ver setCachedFechaProximoPago) — se
  // normaliza de vuelta a null, no a un string vacío.
  return item?.value || null;
}

export async function setCachedFechaProximoPago(fecha: string | null): Promise<void> {
  const db = await getDB();
  await db.put('meta', { key: 'fecha_proximo_pago', value: fecha ?? '' });
}

// Marca temporal de la última vez que se refrescó el catálogo desde
// Supabase con éxito — la regla de confiabilidad del stock (Parte 5) la usa
// para decidir si un número de stock bajo todavía es creíble o hay que
// mostrar "Consultar" en su lugar.
export async function getCachedUltimaSincronizacion(): Promise<string | null> {
  const db = await getDB();
  const item = await db.get('meta', 'ultima_sincronizacion');
  return item?.value ?? null;
}

export async function setCachedUltimaSincronizacion(ts: string): Promise<void> {
  const db = await getDB();
  await db.put('meta', { key: 'ultima_sincronizacion', value: ts });
}

// --- Movimientos de stock ---

export async function saveMovimiento(m: MovimientoStock): Promise<void> {
  const db = await getDB();
  await db.put('movimientos', m);
}

export async function getMovimiento(id: string): Promise<MovimientoStock | undefined> {
  const db = await getDB();
  return db.get('movimientos', id);
}

export async function getMovimientos(): Promise<MovimientoStock[]> {
  const db = await getDB();
  const all = await db.getAll('movimientos');
  return all.sort((a, b) => b.ocurrido_en.localeCompare(a.ocurrido_en));
}

export async function getMovimientosPorProducto(productoId: string): Promise<MovimientoStock[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('movimientos', 'by-producto', productoId);
  return all.sort((a, b) => b.ocurrido_en.localeCompare(a.ocurrido_en));
}

// Aplica el resultado de un movimiento al stock local del producto de
// inmediato (optimista) — sin esperar a que la cola offline sincronice.
export async function actualizarStockLocal(productoId: string, nuevoStock: number): Promise<void> {
  const db = await getDB();
  const producto = await db.get('productos', productoId);
  if (producto) await db.put('productos', { ...producto, stock: nuevoStock });
}

export async function clearTenantData(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    ['productos', 'configuracion', 'ventas', 'cierres', 'meta', 'pendientes', 'movimientos', 'clientes_fiado', 'fiado_movimientos', 'presupuestos'],
    'readwrite',
  );
  await Promise.all([
    tx.objectStore('productos').clear(),
    tx.objectStore('configuracion').clear(),
    tx.objectStore('ventas').clear(),
    tx.objectStore('cierres').clear(),
    tx.objectStore('meta').clear(),
    tx.objectStore('pendientes').clear(),
    tx.objectStore('movimientos').clear(),
    tx.objectStore('clientes_fiado').clear(),
    tx.objectStore('fiado_movimientos').clear(),
    tx.objectStore('presupuestos').clear(),
    tx.done,
  ]);
}

// --- Fiado ---

export async function saveClienteFiado(c: ClienteFiado): Promise<void> {
  const db = await getDB();
  await db.put('clientes_fiado', c);
}

export async function saveClientesFiado(clientes: ClienteFiado[]): Promise<void> {
  const db = await getDB();

  // Si el sync periódico cae justo entre que se aplica un cargo/abono local
  // y que el outbox termina de confirmarlo con el servidor, pisar saldo_usd
  // con lo que trae el servidor revive por un momento el saldo viejo (ej. un
  // cliente que ya saldó su deuda "reaparece" en la lista de deudores hasta
  // que el outbox corrija de nuevo). Se trae una sola vez, para todo el
  // lote, el set de clientes con movimientos locales todavía sin confirmar
  // — mismo principio que el merge local/remoto de ventas en Resumen: lo
  // pendiente no se pisa con lo remoto hasta que se confirma.
  const movimientos = await db.getAll('fiado_movimientos');
  const conMovimientoPendiente = new Set(
    movimientos.filter(m => m.sincronizado === false).map(m => m.cliente_id)
  );

  const tx = db.transaction('clientes_fiado', 'readwrite');
  for (const c of clientes) {
    if (conMovimientoPendiente.has(c.id)) {
      const local = await tx.store.get(c.id);
      if (local) {
        await tx.store.put({ ...c, saldo_usd: local.saldo_usd });
        continue;
      }
    }
    await tx.store.put(c);
  }
  await tx.done;
}

export async function getClienteFiado(id: string): Promise<ClienteFiado | undefined> {
  const db = await getDB();
  return db.get('clientes_fiado', id);
}

export async function getClientesFiado(): Promise<ClienteFiado[]> {
  const db = await getDB();
  return db.getAll('clientes_fiado');
}

// Aplica el saldo autoritativo que devuelve la RPC al cliente cacheado —
// mismo patrón que actualizarStockLocal.
export async function actualizarSaldoFiadoLocal(clienteId: string, nuevoSaldo: number): Promise<void> {
  const db = await getDB();
  const cliente = await db.get('clientes_fiado', clienteId);
  if (cliente) await db.put('clientes_fiado', { ...cliente, saldo_usd: nuevoSaldo });
}

export async function saveMovimientoFiado(m: MovimientoFiado): Promise<void> {
  const db = await getDB();
  await db.put('fiado_movimientos', m);
}

export async function getMovimientoFiado(id: string): Promise<MovimientoFiado | undefined> {
  const db = await getDB();
  return db.get('fiado_movimientos', id);
}

// Se usa cuando el servidor rechazó el movimiento de forma definitiva: nunca
// se aplicó de verdad, así que no puede quedar en IndexedDB marcado como
// sincronizado: false para siempre — saveClientesFiado() trata eso como "hay
// un cambio pendiente" y nunca deja que el sync periódico corrija el saldo.
export async function eliminarMovimientoFiado(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('fiado_movimientos', id);
}

export async function getMovimientosFiado(): Promise<MovimientoFiado[]> {
  const db = await getDB();
  const all = await db.getAll('fiado_movimientos');
  return all.sort((a, b) => b.ocurrido_en.localeCompare(a.ocurrido_en));
}

export async function getMovimientosFiadoPorCliente(clienteId: string): Promise<MovimientoFiado[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('fiado_movimientos', 'by-cliente', clienteId);
  return all.sort((a, b) => b.ocurrido_en.localeCompare(a.ocurrido_en));
}

// --- Presupuestos ---

export async function savePresupuesto(p: Presupuesto): Promise<void> {
  const db = await getDB();
  await db.put('presupuestos', p);
}

export async function getPresupuesto(id: string): Promise<Presupuesto | undefined> {
  const db = await getDB();
  return db.get('presupuestos', id);
}

// Vigentes primero, más recientes primero dentro de cada grupo — mismo
// orden que ya aplica presupuestos_listar en Supabase.
export async function getPresupuestos(): Promise<Presupuesto[]> {
  const db = await getDB();
  const all = await db.getAll('presupuestos');
  return all.sort((a, b) => {
    if (a.estado === 'vigente' && b.estado !== 'vigente') return -1;
    if (a.estado !== 'vigente' && b.estado === 'vigente') return 1;
    return b.creado_en.localeCompare(a.creado_en);
  });
}

// El resumen que trae presupuestos_listar no incluye items — se guarda el
// encabezado nada más, preservando los items locales si ya se conocían
// (creado en este dispositivo, o pedidos antes bajo demanda). Si el
// presupuesto tiene un cambio local todavía sin confirmar (sincronizado
// === false — un convertir/anular recién hecho), no se pisa: mismo motivo
// que el fix ya aplicado a clientes_fiado — el sync periódico podría
// revivir un 'vigente' viejo encima de un estado más nuevo que la cola
// todavía no terminó de subir.
export async function savePresupuestosResumen(
  resumenes: Omit<Presupuesto, 'items' | 'sincronizado'>[]
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('presupuestos', 'readwrite');
  for (const r of resumenes) {
    const local = await tx.store.get(r.id);
    if (local && local.sincronizado === false) continue;
    await tx.store.put({ ...r, items: local?.items, sincronizado: true });
  }
  await tx.done;
}

export async function marcarPresupuestoSincronizado(id: string): Promise<void> {
  const db = await getDB();
  const p = await db.get('presupuestos', id);
  if (p) await db.put('presupuestos', { ...p, sincronizado: true });
}

// --- Cola de sincronización (outbox) ---

export async function encolarPendiente(op: OperacionPendiente): Promise<void> {
  const db = await getDB();
  await db.put('pendientes', op);
}

export async function getPendientes(): Promise<OperacionPendiente[]> {
  const db = await getDB();
  return db.getAllFromIndex('pendientes', 'by-timestamp');
}

export async function eliminarPendiente(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('pendientes', id);
}

export async function contarPendientes(): Promise<number> {
  const db = await getDB();
  return db.count('pendientes');
}
