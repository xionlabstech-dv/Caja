import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Producto, Configuracion, Venta } from '@/types';

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
}

let dbPromise: Promise<IDBPDatabase<CajaDBSchema>> | null = null;

function getDB() {
  if (typeof window === 'undefined') throw new Error('IDB solo disponible en el browser');
  if (!dbPromise) {
    dbPromise = openDB<CajaDBSchema>('caja-db', 1, {
      upgrade(db) {
        const productosStore = db.createObjectStore('productos', { keyPath: 'id' });
        productosStore.createIndex('by-codigo', 'codigo_barra');
        db.createObjectStore('configuracion', { keyPath: 'id' });
        const ventasStore = db.createObjectStore('ventas', { keyPath: 'id' });
        ventasStore.createIndex('by-fecha-dia', 'fecha_dia');
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
