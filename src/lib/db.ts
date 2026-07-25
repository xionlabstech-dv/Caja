import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Producto, Configuracion, Venta, CierreCaja } from '@/types';

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
}

let dbPromise: Promise<IDBPDatabase<CajaDBSchema>> | null = null;

function getDB() {
  if (typeof window === 'undefined') throw new Error('IDB solo disponible en el browser');
  if (!dbPromise) {
    dbPromise = openDB<CajaDBSchema>('caja-db', 2, {
      upgrade(db, oldVersion) {
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

export async function saveVenta(venta: Venta) {
  const db = await getDB();
  await db.put('ventas', venta);
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

export async function clearTenantData(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    ['productos', 'configuracion', 'ventas', 'cierres', 'meta'],
    'readwrite',
  );
  await Promise.all([
    tx.objectStore('productos').clear(),
    tx.objectStore('configuracion').clear(),
    tx.objectStore('ventas').clear(),
    tx.objectStore('cierres').clear(),
    tx.objectStore('meta').clear(),
    tx.done,
  ]);
}
