import {
  encolarPendiente,
  getPendientes,
  eliminarPendiente,
  contarPendientes,
  getVenta,
  saveVenta,
  getMovimiento,
  saveMovimiento,
  getMovimientoFiado,
  saveMovimientoFiado,
  eliminarMovimientoFiado,
  actualizarSaldoFiadoLocal,
  getPresupuesto,
  marcarPresupuestoSincronizado,
  getMovimientoAcreedor,
  saveMovimientoAcreedor,
  eliminarMovimientoAcreedor,
  actualizarSaldoAcreedorLocal,
  getAcreedor,
} from './db';
import {
  createProductoSupabase,
  updateProductoSupabase,
  softDeleteProducto,
  updateTasa,
  updateUsaCostos,
  updateUsaStock,
  sincronizarCierre,
  sincronizarVenta,
  actualizarCierreIdVentas,
  aplicarMovimientoStockRemoto,
  createClienteFiadoSupabase,
  aplicarMovimientoFiadoRemoto,
  getSaldoFiadoRemoto,
  sincronizarPresupuesto,
  actualizarPresupuestoSupabase,
  updateDatosNegocio,
  createAcreedorSupabase,
  aplicarMovimientoAcreedorRemoto,
  getSaldoAcreedorRemoto,
  editarAcreedorRemoto,
  ResultadoEscritura,
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
  PayloadActualizarUsaStock,
  PayloadAplicarMovimientoStock,
  PayloadCrearClienteFiado,
  PayloadAplicarMovimientoFiado,
  PayloadCrearPresupuesto,
  PayloadActualizarPresupuesto,
  PayloadActualizarDatosNegocio,
  PayloadCrearAcreedor,
  PayloadAplicarMovimientoAcreedor,
  PayloadEditarAcreedor,
  Producto,
  CierreCaja,
  ClienteFiado,
  Presupuesto,
  DatosNegocio,
  Acreedor,
} from '@/types';

// Backoff exponencial por operación: 2s, 4s, 8s... tope 60s.
function backoffMs(intentos: number): number {
  return Math.min(2 ** intentos * 1000, 60000);
}

// Red de seguridad por ENCIMA de TIMEOUT_RPC_MS (10s, en sync.ts): cuando
// una función ya tiene su propio timeout interno, ese tiene que ganar
// siempre — es el único que sabe distinguir "no hubo respuesta" (transitorio)
// de "el servidor rechazó" (permanente). Este candado de cola solo actúa
// cuando no hay timeout interno (la mayoría de las operaciones de esta cola
// todavía no lo tienen) o cuando algo se colgó más allá de su propio límite.
//
// 25s y no 10s: aplicar_movimiento_fiado, en su peor caso legítimo, encadena
// aplicarMovimientoFiadoRemoto (hasta 10s) más, si el fallo es permanente,
// un getSaldoFiadoRemoto que hoy no tiene timeout propio — un candado de 10s
// podría cortar una operación que en realidad iba bien.
const TIMEOUT_OPERACION_MS = 25000;

// Aviso de un cambio que el servidor rechazó de forma DEFINITIVA (no un
// problema de red) — se saca de la cola en vez de reintentar para siempre,
// pero eso no puede pasar en silencio: quien esté usando la app necesita
// enterarse de que ese cargo/abono o movimiento específico nunca se aplicó,
// y por qué. outbox.ts no es un componente de React, así que expone este
// suscriptor en vez de mostrar el aviso directamente — Providers.tsx (que sí
// puede pintar algo visible en cualquier pantalla) se suscribe una vez.
type ListenerFalloPermanente = (mensaje: string) => void;
const listenersFalloPermanente: ListenerFalloPermanente[] = [];

export function onFalloPermanente(cb: ListenerFalloPermanente): () => void {
  listenersFalloPermanente.push(cb);
  return () => {
    const i = listenersFalloPermanente.indexOf(cb);
    if (i >= 0) listenersFalloPermanente.splice(i, 1);
  };
}

function notificarFalloPermanente(mensaje: string) {
  for (const cb of listenersFalloPermanente) cb(mensaje);
}

async function encolar(
  tipo: TipoPendiente,
  payload: PayloadPendiente,
  idFijo?: string,
  dependeDe?: string,
): Promise<void> {
  const op: OperacionPendiente = {
    id: idFijo ?? crypto.randomUUID(),
    tipo,
    payload,
    timestamp: new Date().toISOString(),
    intentos: 0,
    ...(dependeDe ? { dependeDe } : {}),
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
  // dependeDe = cierreId (el id de la operación 'cerrar_caja'): ventas.cierre_id
  // tiene FK contra cierres_caja, así que este UPDATE no puede correr antes de
  // que el cierre exista en el servidor. El orden por timestamp NO alcanza: una
  // operación esperando su backoff se saltea y las de atrás avanzan igual.
  await encolar('actualizar_cierre_ventas', payload, `cierre-ventas-${cierreId}`, cierreId);
}

export async function encolarActualizarUsaCostos(usaCostos: boolean, negocioId: string): Promise<void> {
  const payload: PayloadActualizarUsaCostos = { usaCostos, negocioId };
  // id fijo: varios toggles seguidos sin red dejan solo el último en cola.
  await encolar('actualizar_usa_costos', payload, 'usa-costos-pendiente');
}

export async function encolarActualizarUsaStock(usaStock: boolean, negocioId: string): Promise<void> {
  const payload: PayloadActualizarUsaStock = { usaStock, negocioId };
  await encolar('actualizar_usa_stock', payload, 'usa-stock-pendiente');
}

export async function encolarActualizarDatosNegocio(datos: DatosNegocio, negocioId: string): Promise<void> {
  const payload: PayloadActualizarDatosNegocio = { datos, negocioId };
  // id fijo: varios guardados seguidos sin red dejan solo el último en cola.
  await encolar('actualizar_datos_negocio', payload, 'datos-negocio-pendiente');
}

export async function encolarCrearAcreedor(acreedor: Acreedor, negocioId: string): Promise<void> {
  const payload: PayloadCrearAcreedor = { acreedor, negocioId };
  await encolar('crear_acreedor', payload, acreedor.id);
}

export async function encolarEditarAcreedor(acreedorId: string, negocioId: string): Promise<void> {
  const payload: PayloadEditarAcreedor = { acreedorId, negocioId };
  // id fijo DISTINTO del id del acreedor: crear_acreedor ya usa acreedor.id
  // como id de operación, así que reusarlo haría que una edición PISE el
  // alta todavía en cola y el acreedor nunca se cree. Mismo criterio que
  // `presupuesto-estado-${id}` más arriba.
  //
  // Que sea fijo es a propósito: dos ediciones seguidas sin señal dejan una
  // sola operación en la cola, y como el handler relee el acreedor de
  // IndexedDB, sube el último estado.
  //
  // dependeDe = acreedorId: si el alta de este acreedor sigue en la cola,
  // la edición espera — el servidor la rechazaría por no encontrarlo.
  await encolar('editar_acreedor', payload, `acreedor-editar-${acreedorId}`, acreedorId);
}

export async function encolarAplicarMovimientoAcreedor(movimientoId: string, negocioId: string, acreedorId?: string): Promise<void> {
  const payload: PayloadAplicarMovimientoAcreedor = { movimientoId, negocioId };
  // id fijo = id del movimiento: mismo criterio que aplicar_movimiento_fiado.
  await encolar('aplicar_movimiento_acreedor', payload, movimientoId, acreedorId);
}

export async function encolarAplicarMovimientoStock(movimientoId: string, negocioId: string): Promise<void> {
  const payload: PayloadAplicarMovimientoStock = { movimientoId, negocioId };
  // id fijo = id del movimiento: la RPC ya es idempotente por su cuenta,
  // pero esto además evita encolar el mismo movimiento dos veces.
  await encolar('aplicar_movimiento_stock', payload, movimientoId);
}

export async function encolarCrearClienteFiado(cliente: ClienteFiado, negocioId: string): Promise<void> {
  const payload: PayloadCrearClienteFiado = { cliente, negocioId };
  await encolar('crear_cliente_fiado', payload, cliente.id);
}

export async function encolarAplicarMovimientoFiado(movimientoId: string, negocioId: string, clienteId?: string): Promise<void> {
  const payload: PayloadAplicarMovimientoFiado = { movimientoId, negocioId };
  // id fijo = id del movimiento: mismo criterio que aplicar_movimiento_stock.
  // clienteId como dependencia: si el alta de ese cliente sigue en la cola,
  // este movimiento espera — el servidor lo rechazaría por no encontrarlo.
  await encolar('aplicar_movimiento_fiado', payload, movimientoId, clienteId);
}

export async function encolarCrearPresupuesto(presupuesto: Presupuesto, negocioId: string): Promise<void> {
  const payload: PayloadCrearPresupuesto = { presupuesto, negocioId };
  await encolar('crear_presupuesto', payload, presupuesto.id);
}

export async function encolarActualizarPresupuesto(presupuestoId: string, negocioId: string): Promise<void> {
  const payload: PayloadActualizarPresupuesto = { presupuestoId, negocioId };
  // id fijo distinto del propio presupuesto: si se llega a encolar crear y
  // luego convertir/anular casi seguido sin red, deben quedar como dos
  // operaciones separadas.
  //
  // dependeDe = presupuestoId (que es el id de la operación 'crear_presupuesto'):
  // el orden por timestamp NO alcanza, porque una operación en espera de
  // backoff se saltea y las de atrás avanzan igual. Sin esto, el cambio de
  // estado puede llegar antes que el alta, encontrar 0 filas y quedar
  // descartado como permanente. Mismo criterio que 'editar_acreedor'.
  await encolar('actualizar_presupuesto', payload, `presupuesto-estado-${presupuestoId}`, presupuestoId);
}

// Mismo criterio que ya usan 'aplicar_movimiento_stock'/'aplicar_movimiento_fiado'
// más abajo: ok → resuelto, sale de la cola; permanente → el servidor ya
// respondió que no (RLS, permiso, o el propio dato es inválido) y reintentar
// no lo va a cambiar, así que también sale de la cola pero avisando; ni ok
// ni permanente → fallo transitorio (nunca hubo respuesta real), se
// reintenta con el backoff de siempre.
function resolverResultadoEscritura(resultado: ResultadoEscritura, mensajeFallo: string): boolean {
  if (resultado.ok) return true;
  if (resultado.permanente) {
    notificarFalloPermanente(`${mensajeFallo}: ${resultado.mensaje ?? 'el servidor lo rechazó'}`);
    return true;
  }
  return false;
}

async function procesarOperacion(op: OperacionPendiente): Promise<boolean> {
  switch (op.tipo) {
    case 'crear_producto': {
      const { producto, negocioId } = op.payload as PayloadCrearProducto;
      const resultado = await createProductoSupabase(producto, negocioId);
      return resolverResultadoEscritura(resultado, 'No se pudo guardar un producto nuevo');
    }
    case 'editar_producto': {
      const { id, datos } = op.payload as PayloadEditarProducto;
      const resultado = await updateProductoSupabase(id, datos);
      return resolverResultadoEscritura(resultado, 'No se pudo guardar la edición de un producto');
    }
    case 'eliminar_producto': {
      const { id } = op.payload as PayloadEliminarProducto;
      const resultado = await softDeleteProducto(id);
      return resolverResultadoEscritura(resultado, 'No se pudo eliminar un producto');
    }
    case 'actualizar_tasa': {
      const { tasa, negocioId } = op.payload as PayloadActualizarTasa;
      const resultado = await updateTasa(tasa, negocioId);
      return resolverResultadoEscritura(resultado, 'No se pudo actualizar la tasa');
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
      const resultado = await actualizarCierreIdVentas(ventaIds, cierreId);
      if (resultado.ok) return true;

      // Error real del servidor o de red: el criterio de siempre.
      if ('permanente' in resultado) {
        return resolverResultadoEscritura(
          resultado,
          'No se pudieron asociar las ventas a un cierre de caja',
        );
      }

      // El UPDATE corrió bien pero no tocó todas las ventas. Si alguna de las
      // que faltan todavía tiene su 'registrar_venta' en la cola, no es un
      // fallo: está en camino y va a recibir el cierre_id en su propio envío
      // (ver el comentario de resumen/page.tsx). Se espera, como hasta ahora.
      const idsEnCola = new Set((await getPendientes()).map(o => o.id));
      const enCamino = resultado.faltantes.some(id => idsEnCola.has(id));
      if (enCamino) return false;

      // Ninguna de las que faltan está en la cola: ya no existen en el servidor
      // (las borró un reseteo de datos de prueba) o RLS las está escondiendo.
      // Reintentar no las va a traer de vuelta.
      notificarFalloPermanente(
        `${resultado.faltantes.length} venta(s) del cierre no se pudieron asociar: ya no están en el servidor.`,
      );
      return true;
    }
    case 'actualizar_usa_costos': {
      const { usaCostos, negocioId } = op.payload as PayloadActualizarUsaCostos;
      const resultado = await updateUsaCostos(usaCostos, negocioId);
      return resolverResultadoEscritura(resultado, 'No se pudo guardar el cambio de control de costos');
    }
    case 'actualizar_usa_stock': {
      const { usaStock, negocioId } = op.payload as PayloadActualizarUsaStock;
      const resultado = await updateUsaStock(usaStock, negocioId);
      return resolverResultadoEscritura(resultado, 'No se pudo guardar el cambio de control de inventario');
    }
    case 'actualizar_datos_negocio': {
      const { datos, negocioId } = op.payload as PayloadActualizarDatosNegocio;
      const resultado = await updateDatosNegocio(datos, negocioId);
      return resolverResultadoEscritura(resultado, 'No se pudo guardar los datos del negocio');
    }
    case 'aplicar_movimiento_stock': {
      const { movimientoId } = op.payload as PayloadAplicarMovimientoStock;
      // Se relee de IndexedDB en vez de guardar una copia congelada en el
      // payload — mismo patrón que 'registrar_venta'.
      const movimiento = await getMovimiento(movimientoId);
      if (!movimiento) return true; // no hay nada que sincronizar
      const resultado = await aplicarMovimientoStockRemoto(movimiento);
      if (resultado.ok) {
        await saveMovimiento({ ...movimiento, sincronizado: true });
        return true;
      }
      if (resultado.permanente) {
        // El servidor respondió y rechazó el movimiento de forma definitiva
        // — reintentar no lo va a cambiar. Se saca de la cola en vez de
        // quedar reintentando para siempre, y se avisa con el motivo real.
        notificarFalloPermanente(
          `No se pudo aplicar un movimiento de stock: ${resultado.mensaje ?? 'el servidor lo rechazó'}`
        );
        return true;
      }
      return false;
    }
    case 'crear_cliente_fiado': {
      const { cliente, negocioId } = op.payload as PayloadCrearClienteFiado;
      const resultado = await createClienteFiadoSupabase(cliente, negocioId);
      // 'duplicate' en un reintento de cola = mismo id ya insertado antes → resuelto.
      return resultado !== null;
    }
    case 'aplicar_movimiento_fiado': {
      const { movimientoId } = op.payload as PayloadAplicarMovimientoFiado;
      // Se relee de IndexedDB en vez de guardar una copia congelada en el
      // payload — mismo patrón que 'aplicar_movimiento_stock'.
      const movimiento = await getMovimientoFiado(movimientoId);
      if (!movimiento) return true; // no hay nada que sincronizar
      const resultado = await aplicarMovimientoFiadoRemoto(movimiento);
      if (resultado.ok) {
        await saveMovimientoFiado({ ...movimiento, sincronizado: true });
        return true;
      }
      if (resultado.permanente) {
        const saldoReal = await getSaldoFiadoRemoto(movimiento.cliente_id);

        // Un cargo ligado a una venta es plata que alguien debe. La venta
        // ya subió y `ventas` no guarda cliente_id, así que si se borra el
        // cargo no queda NINGÚN rastro de a quién cobrarle. Se conserva,
        // marcado, para que la pantalla Fiado lo muestre y se resuelva a
        // mano. Un abono rechazado sí se borra: no se aplicó nunca y no
        // deja nada colgando.
        if (movimiento.tipo === 'cargo' && movimiento.venta_id) {
          await saveMovimientoFiado({
            ...movimiento,
            sincronizado: false,
            falloPermanente: resultado.mensaje ?? 'el servidor lo rechazó',
          });
          if (saldoReal !== null) await actualizarSaldoFiadoLocal(movimiento.cliente_id, saldoReal);
          notificarFalloPermanente(
            `No se registró una deuda de ${movimiento.monto_usd.toFixed(2)} $ por una venta a crédito. ` +
            `Revisa el cliente en la pantalla Por Cobrar: hay que cargarla a mano.`
          );
          return true;
        }

        // Ej. un abono que ya no coincide con el saldo real para cuando le
        // toca subir (otro dispositivo cobró de más entre medio) — la RPC
        // lo rechaza con un mensaje pensado para mostrarse tal cual.
        //
        // El movimiento nunca se aplicó de verdad, así que no puede quedar
        // en IndexedDB con sincronizado: false para siempre — saveClientesFiado()
        // trata eso como "hay un cambio pendiente" y nunca deja que el sync
        // periódico corrija el saldo. Se borra, y el saldo optimista (que
        // quedó mal) se corrige ya mismo con el valor real de Supabase, sin
        // esperar al próximo ciclo.
        await eliminarMovimientoFiado(movimiento.id);
        if (saldoReal !== null) await actualizarSaldoFiadoLocal(movimiento.cliente_id, saldoReal);
        notificarFalloPermanente(
          `No se pudo aplicar un movimiento en Por Cobrar: ${resultado.mensaje ?? 'el servidor lo rechazó'}`
        );
        return true;
      }
      return false;
    }
    case 'crear_presupuesto': {
      const { presupuesto, negocioId } = op.payload as PayloadCrearPresupuesto;
      return await sincronizarPresupuesto(presupuesto, negocioId);
    }
    case 'actualizar_presupuesto': {
      const { presupuestoId } = op.payload as PayloadActualizarPresupuesto;
      // Se relee de IndexedDB en vez de guardar una copia congelada en el
      // payload — mismo patrón que 'registrar_venta': manda lo último que
      // se sabe de este presupuesto en el momento de sincronizar.
      const presupuesto = await getPresupuesto(presupuestoId);
      if (!presupuesto) return true; // no hay nada que sincronizar
      const resultado = await actualizarPresupuestoSupabase(presupuesto.id, {
        estado: presupuesto.estado,
        convertido_en: presupuesto.convertido_en,
        venta_id: presupuesto.venta_id,
        anulado_en: presupuesto.anulado_en,
        motivo_anulacion: presupuesto.motivo_anulacion,
      });
      if (resultado.ok) await marcarPresupuestoSincronizado(presupuesto.id);
      return resolverResultadoEscritura(
        resultado,
        'No se pudo guardar el cambio de estado de un presupuesto',
      );
    }
    case 'crear_acreedor': {
      const { acreedor, negocioId } = op.payload as PayloadCrearAcreedor;
      const resultado = await createAcreedorSupabase(acreedor, negocioId);
      // 'duplicate' en un reintento de cola = mismo id ya insertado antes → resuelto.
      return resultado !== null;
    }
    case 'aplicar_movimiento_acreedor': {
      const { movimientoId } = op.payload as PayloadAplicarMovimientoAcreedor;
      // Se relee de IndexedDB en vez de guardar una copia congelada en el
      // payload — mismo patrón que 'aplicar_movimiento_fiado'.
      const movimiento = await getMovimientoAcreedor(movimientoId);
      if (!movimiento) return true; // no hay nada que sincronizar
      const resultado = await aplicarMovimientoAcreedorRemoto(movimiento);
      if (resultado.ok) {
        await saveMovimientoAcreedor({ ...movimiento, sincronizado: true });
        return true;
      }
      if (resultado.permanente) {
        // Ej. un pago mayor a la deuda real para cuando le toca subir (otro
        // dispositivo pagó entre medio) — la RPC lo rechaza con un mensaje
        // pensado para mostrarse tal cual.
        //
        // El movimiento nunca se aplicó de verdad, así que no puede quedar
        // en IndexedDB con sincronizado: false para siempre —
        // saveAcreedores() trata eso como "hay un cambio pendiente" y nunca
        // deja que el sync periódico corrija el saldo. Se borra, y el saldo
        // optimista (que quedó mal) se corrige ya mismo con el valor real
        // de Supabase, sin esperar al próximo ciclo.
        await eliminarMovimientoAcreedor(movimiento.id);
        const saldoReal = await getSaldoAcreedorRemoto(movimiento.acreedor_id);
        if (saldoReal !== null) await actualizarSaldoAcreedorLocal(movimiento.acreedor_id, saldoReal);
        notificarFalloPermanente(
          `No se pudo registrar un movimiento de cuentas por pagar: ${resultado.mensaje ?? 'el servidor lo rechazó'}`
        );
        return true;
      }
      return false;
    }
    case 'editar_acreedor': {
      const { acreedorId } = op.payload as PayloadEditarAcreedor;
      // Se relee de IndexedDB en vez de congelar los datos en el payload —
      // mismo patrón que 'actualizar_presupuesto': manda lo último que se
      // sabe de este acreedor en el momento de sincronizar.
      const acreedor = await getAcreedor(acreedorId);
      if (!acreedor) return true; // ya no existe local: nada que sincronizar
      const resultado = await editarAcreedorRemoto(
        acreedor.id, acreedor.nombre, acreedor.tipo, acreedor.nota,
        acreedor.activo, acreedor.es_recurrente, acreedor.dia_pago,
      );
      return resolverResultadoEscritura(resultado, 'No se pudo guardar el cambio del acreedor');
    }
    default:
      return true;
  }
}

async function procesarColaUnaPasada(): Promise<number> {
  let procesados = 0;
  const cola = await getPendientes();
  // Ids que siguen en la cola — para saber si la dependencia de una
  // operación todavía no se resolvió.
  const idsEnCola = new Set(cola.map(o => o.id));
  for (const op of cola) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) break;

    // Su dependencia sigue pendiente (ej. el alta del cliente al que
    // pertenece este cargo). No es un fallo: es que todavía no es su turno.
    // Se saltea sin contar intento ni tocar el backoff, y se vuelve a mirar
    // en la pasada siguiente. Si la dependencia ya salió de la cola —porque
    // se resolvió, o porque se descartó— esta operación avanza normal.
    if (op.dependeDe && idsEnCola.has(op.dependeDe)) continue;

    if (op.ultimoIntento) {
      const espera = backoffMs(op.intentos);
      const transcurrido = Date.now() - new Date(op.ultimoIntento).getTime();
      if (transcurrido < espera) continue;
    }

    const promesaOperacion = procesarOperacion(op);
    // Promise.race no cancela a la perdedora: si gana el candado, esta
    // sigue viva en segundo plano. Sin este catch, un rechazo tardío (ya
    // sin nadie esperándola acá) dispararía un unhandledrejection.
    promesaOperacion.catch(() => {});

    let timeoutId: ReturnType<typeof setTimeout>;
    const promesaCandado = new Promise<'candado'>(resolve => {
      timeoutId = setTimeout(() => resolve('candado'), TIMEOUT_OPERACION_MS);
    });

    const resultado = await Promise.race([promesaOperacion, promesaCandado]);

    if (resultado === 'candado') {
      // Nunca supimos si esto iba a terminar en éxito o en rechazo del
      // servidor — se trata como fallo transitorio (se re-encola), nunca
      // como éxito (perdería el dato) ni como rechazo definitivo: el
      // candado no es un "no" del servidor, es que no hubo respuesta a
      // tiempo, así que no se llama a notificarFalloPermanente.
      await encolarPendiente({
        ...op,
        intentos: op.intentos + 1,
        ultimoIntento: new Date().toISOString(),
      });
      // Si una operación agotó los 25s del candado, la red está
      // prácticamente muerta — seguir con las demás de esta pasada solo
      // gasta batería. No traba nada: la operación vencida queda salteada
      // por su propio backoff en la próxima pasada, y las demás sí se
      // procesan ahí (mismo criterio que el break de arriba por !onLine).
      break;
    }

    clearTimeout(timeoutId!);
    if (resultado) {
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

// Diagnóstico de la cola para distinguir "sin conexión" (progreso normal) de
// "con conexión pero algo bloquea las escrituras" (roto) — ver colaAtascada
// en Providers.tsx. Los datos ya existen en cada OperacionPendiente, solo
// hay que leerlos: no agrega ningún estado nuevo.
export interface DiagnosticoCola {
  pendientes: number;
  // El mayor `intentos` de toda la cola — una operación que lleva muchos
  // intentos con el teléfono reportando conexión ya no es una señal mala
  // normal, es algo roto (ver el caso real del polyfill de AbortSignal.timeout).
  maxIntentos: number;
  // `timestamp` (no `ultimoIntento`) de la operación más vieja en cola —
  // getPendientes() ya la trae ordenada ascendente por ese campo (el índice
  // 'by-timestamp'), así que la primera de la lista es la más antigua.
  masAntiguoEn: string | null;
}

export async function getDiagnosticoCola(): Promise<DiagnosticoCola> {
  const cola = await getPendientes();
  if (cola.length === 0) {
    return { pendientes: 0, maxIntentos: 0, masAntiguoEn: null };
  }
  return {
    pendientes: cola.length,
    maxIntentos: Math.max(...cola.map(op => op.intentos)),
    masAntiguoEn: cola[0].timestamp,
  };
}
