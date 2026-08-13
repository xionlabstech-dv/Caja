import {
  encolarPendiente,
  getPendientes,
  eliminarPendiente,
  contarPendientes,
  getVenta,
  saveVenta,
} from './db';
import {
  createProductoSupabase,
  updateProductoSupabase,
  softDeleteProducto,
  updateTasa,
  updateUsaCostos,
  sincronizarCierre,
  sincronizarVenta,
  actualizarCierreIdVentas,
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
  PayloadRegistrarVenta,
  PayloadActualizarCierreVentas,
  PayloadActualizarUsaCostos,
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

export async function encolarRegistrarVenta(ventaId: string, negocioId: string): Promise<void> {
  const payload: PayloadRegistrarVenta = { ventaId, negocioId };
  await encolar('registrar_venta', payload, ventaId);
}

export async function encolarActualizarCierreVentas(ventaIds: string[], cierreId: string): Promise<void> {
  if (ventaIds.length === 0) return;
  const payload: PayloadActualizarCierreVentas = { ventaIds, cierreId };
  await encolar('actualizar_cierre_ventas', payload, `cierre-ventas-${cierreId}`);
}

export async function encolarActualizarUsaCostos(usaCostos: boolean, negocioId: string): Promise<void> {
  const payload: PayloadActualizarUsaCostos = { usaCostos, negocioId };
  // id fijo: varios toggles seguidos sin red dejan solo el último en cola.
  await encolar('actualizar_usa_costos', payload, 'usa-costos-pendiente');
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
    case 'registrar_venta': {
      const { ventaId, negocioId } = op.payload as PayloadRegistrarVenta;
      // Se relee la venta actual de IndexedDB en vez de usar una copia
      // congelada al encolar: si mientras tanto se cerró caja, el cierre_id
      // ya asignado localmente viaja con la venta en su primer envío.
      const venta = await getVenta(ventaId);
      if (!venta) return true; // no hay nada que sincronizar
      const ok = await sincronizarVenta(venta, negocioId);
      if (ok) await saveVenta({ ...venta, sincronizada: true });
      return ok;
    }
    case 'actualizar_cierre_ventas': {
      const { ventaIds, cierreId } = op.payload as PayloadActualizarCierreVentas;
      return await actualizarCierreIdVentas(ventaIds, cierreId);
    }
    case 'actualizar_usa_costos': {
      const { usaCostos, negocioId } = op.payload as PayloadActualizarUsaCostos;
      return await updateUsaCostos(usaCostos, negocioId);
    }
    default:
      return true;
  }
}

async function procesarColaUnaPasada(): Promise<number> {
  let procesados = 0;
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
  return procesados;
}

let procesando = false;
let reejecutarSolicitado = false;
let corridaActual: Promise<{ procesados: number; pendientes: number }> | null = null;

// Dos operaciones encoladas casi al mismo tiempo (ej. cerrar caja + el
// backfill de cierre_id en las ventas) disparan cada una su propio intento
// de sync inmediato. Sin esto, la segunda llamada podía "rebotar" contra la
// primera (todavía en vuelo) y su operación quedaba huérfana hasta el
// siguiente 'online' o el barrido periódico de 30s. Ahora, si procesarCola()
// se llama mientras ya hay una corrida en curso, se pide una repasada extra
// al final en vez de simplemente abortar.
export async function procesarCola(): Promise<{ procesados: number; pendientes: number }> {
  if (procesando) {
    reejecutarSolicitado = true;
    return corridaActual ?? { procesados: 0, pendientes: await contarPendientes() };
  }

  procesando = true;
  corridaActual = (async () => {
    let totalProcesados = 0;
    try {
      do {
        reejecutarSolicitado = false;
        totalProcesados += await procesarColaUnaPasada();
      } while (
        reejecutarSolicitado &&
        (typeof navigator === 'undefined' || navigator.onLine)
      );
    } finally {
      procesando = false;
    }
    const pendientes = await contarPendientes();
    return { procesados: totalProcesados, pendientes };
  })();

  const resultado = await corridaActual;
  corridaActual = null;
  return resultado;
}
