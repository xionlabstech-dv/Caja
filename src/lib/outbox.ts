import {
  encolarPendiente,
  getPendientes,
  eliminarPendiente,
  contarPendientes,
} from './db';
import {
  createProductoSupabase,
  updateProductoSupabase,
  softDeleteProducto,
  updateTasa,
  sincronizarCierre,
} from './sync';
import {
  OperacionPendiente,
  TipoPendiente,
  PayloadPendiente,
  PayloadCrearProducto,
  PayloadEditarProducto,
  PayloadEliminarProducto,
  PayloadActualizarTasa,
  PayloadCerrarCaja,
  Producto,
  CierreCaja,
} from '@/types';

// Backoff exponencial por operación: 2s, 4s, 8s... tope 60s.
function backoffMs(intentos: number): number {
  return Math.min(2 ** intentos * 1000, 60000);
}

async function encolar(
  tipo: TipoPendiente,
  payload: PayloadPendiente,
  idFijo?: string,
): Promise<void> {
  const op: OperacionPendiente = {
    id: idFijo ?? crypto.randomUUID(),
    tipo,
    payload,
    timestamp: new Date().toISOString(),
    intentos: 0,
  };
  await encolarPendiente(op);
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    procesarCola().catch(() => {});
  }
}

export async function encolarCrearProducto(producto: Producto, negocioId: string): Promise<void> {
  const payload: PayloadCrearProducto = { producto, negocioId };
  await encolar('crear_producto', payload, producto.id);
}

export async function encolarEditarProducto(id: string, datos: Partial<Producto>): Promise<void> {
  const payload: PayloadEditarProducto = { id, datos };
  await encolar('editar_producto', payload);
}

export async function encolarEliminarProducto(id: string): Promise<void> {
  const payload: PayloadEliminarProducto = { id };
  await encolar('eliminar_producto', payload);
}

export async function encolarActualizarTasa(tasa: number, negocioId: string): Promise<void> {
  const payload: PayloadActualizarTasa = { tasa, negocioId };
  // id fijo: si el usuario cambia la tasa varias veces sin red, solo la
  // última queda en cola (last-write-wins ya desde el encolado).
  await encolar('actualizar_tasa', payload, 'tasa-pendiente');
}

export async function encolarCerrarCaja(cierre: CierreCaja, negocioId: string): Promise<void> {
  const payload: PayloadCerrarCaja = { cierre, negocioId };
  await encolar('cerrar_caja', payload, cierre.id);
}

async function procesarOperacion(op: OperacionPendiente): Promise<boolean> {
  switch (op.tipo) {
    case 'crear_producto': {
      const { producto, negocioId } = op.payload as PayloadCrearProducto;
      const resultado = await createProductoSupabase(producto, negocioId);
      // 'duplicate' en un reintento de cola = mismo id ya insertado antes → resuelto.
      return resultado !== null;
    }
    case 'editar_producto': {
      const { id, datos } = op.payload as PayloadEditarProducto;
      const resultado = await updateProductoSupabase(id, datos);
      return resultado !== false;
    }
    case 'eliminar_producto': {
      const { id } = op.payload as PayloadEliminarProducto;
      return await softDeleteProducto(id);
    }
    case 'actualizar_tasa': {
      const { tasa, negocioId } = op.payload as PayloadActualizarTasa;
      return await updateTasa(tasa, negocioId);
    }
    case 'cerrar_caja': {
      const { cierre, negocioId } = op.payload as PayloadCerrarCaja;
      return await sincronizarCierre(cierre, negocioId);
    }
    default:
      return true;
  }
}

let procesando = false;

export async function procesarCola(): Promise<{ procesados: number; pendientes: number }> {
  if (procesando) return { procesados: 0, pendientes: await contarPendientes() };
  procesando = true;
  let procesados = 0;
  try {
    const cola = await getPendientes();
    for (const op of cola) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) break;

      if (op.ultimoIntento) {
        const espera = backoffMs(op.intentos);
        const transcurrido = Date.now() - new Date(op.ultimoIntento).getTime();
        if (transcurrido < espera) continue;
      }

      const ok = await procesarOperacion(op);
      if (ok) {
        await eliminarPendiente(op.id);
        procesados++;
      } else {
        await encolarPendiente({
          ...op,
          intentos: op.intentos + 1,
          ultimoIntento: new Date().toISOString(),
        });
      }
    }
  } finally {
    procesando = false;
  }
  const pendientes = await contarPendientes();
  return { procesados, pendientes };
}
