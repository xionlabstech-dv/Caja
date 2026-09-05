import { supabase } from './supabase';
import {
  saveProductos,
  saveConfiguracion,
  getConfiguracion as getConfigDB,
  setCachedUsaCostos,
  setCachedUsaStock,
  setCachedUltimaSincronizacion,
  actualizarStockLocal,
  saveClientesFiado,
  actualizarSaldoFiadoLocal,
} from './db';
import {
  Producto,
  Configuracion,
  CierreCaja,
  Venta,
  VentaItem,
  PagoVenta,
  MovimientoStock,
  ClienteFiado,
  MovimientoFiado,
} from '@/types';

export async function syncFromSupabase(negocioId: string): Promise<Configuracion | null> {
  try {
    const PAGE_SIZE = 1000;
    let from = 0;
    const allProducts: Producto[] = [];

    while (true) {
      const { data, error } = await supabase
        .from('productos')
        .select('*')
        .eq('activo', true)
        .range(from, from + PAGE_SIZE - 1);

      if (error || !data?.length) break;
      allProducts.push(...(data as Producto[]));
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    if (allProducts.length > 0) {
      await saveProductos(allProducts);
    }

    // Clientes de fiado: mismo patrón paginado que productos, para que el
    // saldo de cada uno (quién debe y cuánto) esté disponible sin conexión —
    // si Nelson abre la pantalla Fiado sin señal, igual debe poder ver la
    // lista de deudores. RLS ya limita esto al negocio del usuario, igual
    // que en productos.
    let fromFiado = 0;
    const allClientesFiado: ClienteFiado[] = [];
    while (true) {
      const { data, error } = await supabase
        .from('clientes_fiado')
        .select('*')
        .range(fromFiado, fromFiado + PAGE_SIZE - 1);

      if (error || !data?.length) break;
      allClientesFiado.push(...(data as ClienteFiado[]));
      if (data.length < PAGE_SIZE) break;
      fromFiado += PAGE_SIZE;
    }

    if (allClientesFiado.length > 0) {
      await saveClientesFiado(allClientesFiado);
    }

    // Marca de "hasta acá se pudo confirmar con el servidor" — la regla de
    // confiabilidad del stock (Parte 5, ver src/lib/stock.ts) depende de
    // esto para decidir si un número de stock bajo todavía es creíble.
    await setCachedUltimaSincronizacion(new Date().toISOString());

    const { data: configData } = await supabase
      .from('configuracion')
      .select('*')
      .eq('negocio_id', negocioId)
      .single();

    if (configData) {
      const config: Configuracion = { ...configData, id: 1 };
      await saveConfiguracion(config);
      return config;
    }

    return null;
  } catch {
    return null;
  }
}

// Un UPDATE bloqueado por RLS (o que simplemente no matchea ninguna fila) NO
// lanza excepción: Postgres/PostgREST devuelven 200 con data vacía. Sin pedir
// de vuelta las filas realmente afectadas (.select()) no hay forma de
// distinguir eso de un éxito real — así fue como el switch de usa_costos se
// guardaba "bien" sin haber tocado la base (faltaba la policy de UPDATE en
// negocios). Todo UPDATE de este archivo pide sus filas de vuelta y trata
// data vacía como fallo, nunca como éxito.

export async function updateTasa(tasa: number, negocioId: string): Promise<boolean> {
  try {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('configuracion')
      .update({ tasa, tasa_actualizada_en: now })
      .eq('negocio_id', negocioId)
      .select('negocio_id');

    if (error) throw error;
    if (!data || data.length === 0) return false;

    await saveConfiguracion({ id: 1, tasa, tasa_actualizada_en: now });
    return true;
  } catch {
    return false;
  }
}

export async function updateUsaCostos(usaCostos: boolean, negocioId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('negocios')
      .update({ usa_costos: usaCostos })
      .eq('id', negocioId)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) return false;
    await setCachedUsaCostos(usaCostos);
    return true;
  } catch {
    return false;
  }
}

export async function updateUsaStock(usaStock: boolean, negocioId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('negocios')
      .update({ usa_stock: usaStock })
      .eq('id', negocioId)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) return false;
    await setCachedUsaStock(usaStock);
    return true;
  } catch {
    return false;
  }
}

export async function createProductoSupabase(
  producto: Producto,
  negocioId: string
): Promise<Producto | 'duplicate' | null> {
  try {
    const { data, error } = await supabase
      .from('productos')
      .insert({ ...producto, negocio_id: negocioId })
      .select()
      .single();

    if (error) throw error;
    return data as Producto;
  } catch (err) {
    const code = (err as { code?: string }).code;
    // 23505 con el mismo id (retry de la cola offline) = ya sincronizado, no error real
    if (code === '23505') return 'duplicate';
    return null;
  }
}

export async function updateProductoSupabase(
  id: string,
  producto: Partial<Producto>
): Promise<boolean | 'duplicate'> {
  try {
    const { data, error } = await supabase.from('productos').update(producto).eq('id', id).select('id');
    if (error) throw error;
    return !!data && data.length > 0;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return 'duplicate';
    return false;
  }
}

export async function softDeleteProducto(id: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('productos')
      .update({ activo: false })
      .eq('id', id)
      .select('id');
    if (error) throw error;
    return !!data && data.length > 0;
  } catch {
    return false;
  }
}

// Nunca se manda saldo_usd: el trigger en Supabase lo fuerza a nacer en 0
// sin importar qué se le mande, así que ni siquiera vale la pena enviarlo.
export async function createClienteFiadoSupabase(
  cliente: ClienteFiado,
  negocioId: string
): Promise<ClienteFiado | 'duplicate' | null> {
  try {
    const { data, error } = await supabase
      .from('clientes_fiado')
      .insert({
        id: cliente.id,
        negocio_id: negocioId,
        nombre: cliente.nombre,
        creado_por: cliente.creado_por ?? null,
        creado_por_nombre: cliente.creado_por_nombre ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    return data as ClienteFiado;
  } catch (err) {
    const code = (err as { code?: string }).code;
    // 23505 con el mismo id (retry de la cola offline) = ya sincronizado, no error real
    if (code === '23505') return 'duplicate';
    return null;
  }
}

// Select puntual del saldo real de UN cliente — se usa cuando un movimiento
// quedó rechazado de forma definitiva y el saldo optimista que se calculó al
// encolarlo quedó mal: no tiene sentido esperar al próximo ciclo de sync
// para corregirlo, se trae ya mismo. Devuelve null si no se pudo consultar
// (sin red, error), para que quien llama sepa que no hay nada que corregir
// todavía.
export async function getSaldoFiadoRemoto(clienteId: string): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from('clientes_fiado')
      .select('saldo_usd')
      .eq('id', clienteId)
      .single();
    if (error) throw error;
    return data.saldo_usd as number;
  } catch {
    return null;
  }
}

export { getConfigDB as getConfiguracion };

export async function sincronizarCierre(cierre: CierreCaja, negocioId: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('cierres_caja').insert({
      id: cierre.id,
      negocio_id: negocioId,
      periodo_inicio: cierre.periodo_inicio,
      periodo_fin: cierre.periodo_fin,
      total_bs: cierre.total_bs,
      total_usd: cierre.total_usd,
      cantidad_ventas: cierre.cantidad_ventas,
      desglose_metodos: cierre.desglose_metodos,
      // Cobrado (abonos de fiado), separado de lo vendido — "hoy vendí" y
      // "hoy cobré en mano" son números distintos, ver Resumen.
      total_abonado_bs: cierre.total_abonado_bs ?? 0,
      total_abonado_usd: cierre.total_abonado_usd ?? 0,
      cantidad_abonos: cierre.cantidad_abonos ?? 0,
      tasa_cierre: cierre.tasa_cierre,
      creado_en: cierre.creado_en,
      usuario_id: cierre.usuario_id ?? null,
      usuario_nombre: cierre.usuario_nombre ?? null,
    });
    if (error) {
      // Mismo id ya insertado en un intento previo (retry de la cola offline):
      // el cierre ya está sincronizado, no es un fallo real.
      if ((error as { code?: string }).code === '23505') return true;
      throw error;
    }
    return true;
  } catch {
    return false;
  }
}

export async function sincronizarVenta(venta: Venta, negocioId: string): Promise<boolean> {
  try {
    const { error: ventaError } = await supabase.from('ventas').insert({
      id: venta.id,
      negocio_id: negocioId,
      cierre_id: venta.cierre_id ?? null,
      metodo_pago: venta.metodo_pago,
      total_bs: venta.total_bs,
      total_usd: venta.total_usd,
      tasa: venta.tasa_usada,
      vendida_en: venta.fecha,
      usuario_id: venta.usuario_id ?? null,
      usuario_nombre: venta.usuario_nombre ?? null,
    });

    if (ventaError && (ventaError as { code?: string }).code !== '23505') {
      throw ventaError;
    }
    // Si dio 23505, la venta ya estaba insertada de un intento previo — seguimos
    // igual a insertar los items, por si esa vez se cortó antes de llegar a ellos.

    const itemsPayload = venta.items.map(item => {
      const esPorPeso = item.gramos !== undefined;
      return {
        id: item.id,
        venta_id: venta.id,
        producto_id: item.producto_id,
        nombre: item.nombre,
        cantidad: esPorPeso ? item.gramos! / 1000 : item.cantidad,
        precio_bs: item.precioUnitarioBs,
        precio_usd: item.precioUnitarioUsd,
        es_por_peso: esPorPeso,
        gramos: item.gramos ?? null,
        costo_usd: item.costo_usd ?? null,
      };
    });

    if (itemsPayload.length > 0) {
      const { error: itemsError } = await supabase.from('venta_items').insert(itemsPayload);
      if (itemsError && (itemsError as { code?: string }).code !== '23505') {
        throw itemsError;
      }
    }

    // Mismo patrón idempotente que venta_items: los id de cada pago los
    // genera el cliente, así que un reintento de la cola (misma venta, ya
    // insertada) vuelve a mandar los mismos id y 23505 confirma que ya
    // estaban — no es un error real, solo que este intento no era el primero.
    const pagosPayload = venta.pagos.map(pago => ({
      id: pago.id,
      venta_id: venta.id,
      orden: pago.orden,
      metodo: pago.metodo,
      monto_bs: pago.monto_bs,
      monto_usd: pago.monto_usd,
    }));

    if (pagosPayload.length > 0) {
      const { error: pagosError } = await supabase.from('venta_pagos').insert(pagosPayload);
      if (pagosError && (pagosError as { code?: string }).code !== '23505') {
        throw pagosError;
      }
    }

    return true;
  } catch {
    return false;
  }
}

export async function actualizarCierreIdVentas(ventaIds: string[], cierreId: string): Promise<boolean> {
  if (ventaIds.length === 0) return true;
  try {
    const { data, error } = await supabase
      .from('ventas')
      .update({ cierre_id: cierreId })
      .in('id', ventaIds)
      .select('id');
    if (error) throw error;
    // Update masivo: RLS puede bloquear algunas filas del lote y dejar pasar
    // otras sin lanzar error — se compara cuántas se pidieron contra cuántas
    // realmente se tocaron. Un reintento completo es seguro: re-aplicar
    // cierre_id sobre una fila ya actualizada es un no-op idempotente.
    const actualizadas = new Set((data ?? []).map(v => v.id as string));
    return ventaIds.every(id => actualizadas.has(id));
  } catch {
    return false;
  }
}

// Trae las ventas del NEGOCIO ENTERO sin cerrar (cierre_id is null), no solo
// las de este dispositivo — sin esto, un admin no ve lo que venden sus
// cajeros en otros teléfonos, y cerrar caja solo archiva lo local dejando el
// resto del negocio sin cerrar. Devuelve null si no se pudo consultar (sin
// red, error de Supabase), para que quien llama sepa distinguir "el negocio
// no tiene más ventas pendientes" de "no se pudo confirmar".
export async function getVentasPendientesRemoto(negocioId: string): Promise<Venta[] | null> {
  try {
    const { data: ventasData, error } = await supabase
      .from('ventas')
      .select('*')
      .eq('negocio_id', negocioId)
      .is('cierre_id', null);
    if (error) throw error;
    if (!ventasData || ventasData.length === 0) return [];

    const ids = ventasData.map(v => v.id as string);
    // Columnas explícitas SIN costo_usd: Resumen (admin o cajero) nunca
    // muestra costo/ganancia por venta, así que no hay razón para que ese
    // dato viaje hasta el cliente en esta consulta.
    const { data: itemsData } = await supabase
      .from('venta_items')
      .select('id, venta_id, producto_id, nombre, cantidad, precio_bs, precio_usd, es_por_peso, gramos')
      .in('venta_id', ids);

    const { data: pagosData } = await supabase
      .from('venta_pagos')
      .select('id, venta_id, orden, metodo, monto_bs, monto_usd')
      .in('venta_id', ids);

    const pagosPorVenta = new Map<string, PagoVenta[]>();
    for (const p of pagosData ?? []) {
      const lista = pagosPorVenta.get(p.venta_id) ?? [];
      lista.push({
        id: p.id,
        orden: p.orden,
        metodo: p.metodo,
        monto_bs: p.monto_bs,
        monto_usd: p.monto_usd,
      });
      pagosPorVenta.set(p.venta_id, lista);
    }

    const itemsPorVenta = new Map<string, VentaItem[]>();
    for (const it of itemsData ?? []) {
      const lista = itemsPorVenta.get(it.venta_id) ?? [];
      // venta_items.precio_bs es el unitario (o por kg) y venta_items.cantidad
      // es unidades o kg según es_por_peso — igual que arma confirmarVenta().
      // Para items por peso, el modelo local usa cantidad=1 (dummy) y guarda
      // el peso real en gramos; hay que deshacer aquí la conversión a kg que
      // hizo sincronizarVenta() al insertar, o "cantidad" quedaría en kg en
      // vez de 1 y desalinearía cualquier código que la use como # de items.
      const esPorPeso = Boolean(it.es_por_peso);
      lista.push({
        id: it.id,
        producto_id: it.producto_id,
        nombre: it.nombre,
        precio_bs: it.precio_bs,
        cantidad: esPorPeso ? 1 : it.cantidad,
        subtotal_bs: it.precio_bs * it.cantidad,
        gramos: it.gramos ?? undefined,
        precioUnitarioBs: it.precio_bs,
        precioUnitarioUsd: it.precio_usd,
      });
      itemsPorVenta.set(it.venta_id, lista);
    }

    return ventasData.map(v => ({
      id: v.id,
      fecha: v.vendida_en,
      fecha_dia: (v.vendida_en as string).split('T')[0],
      items: itemsPorVenta.get(v.id) ?? [],
      metodo_pago: v.metodo_pago,
      // Fallback por si una venta llegara sin filas en venta_pagos (no
      // debería pasar post-backfill, pero evita que Resumen reviente el
      // desglose por método si alguna vez ocurre): un pago único con el
      // total, igual al backfill que se hizo en Supabase.
      pagos: pagosPorVenta.get(v.id) ?? [{
        id: crypto.randomUUID(),
        orden: 1,
        metodo: v.metodo_pago,
        monto_bs: v.total_bs,
        monto_usd: v.total_usd,
      }],
      total_bs: v.total_bs,
      total_usd: v.total_usd,
      tasa_usada: v.tasa,
      cierre_id: v.cierre_id ?? undefined,
      sincronizada: true,
      usuario_id: v.usuario_id ?? undefined,
      usuario_nombre: v.usuario_nombre ?? undefined,
      // Anulación: se trae siempre (no solo si anulada = true) para que una
      // venta anulada por otro dispositivo llegue ya marcada, sin depender
      // de que este dispositivo haya sido el que la anuló.
      anulada: v.anulada ?? false,
      anulada_en: v.anulada_en ?? undefined,
      anulada_por: v.anulada_por ?? undefined,
      anulada_por_nombre: v.anulada_por_nombre ?? undefined,
      motivo_anulacion: v.motivo_anulacion ?? undefined,
    }));
  } catch {
    return null;
  }
}

// Anula una venta vía la RPC (SECURITY DEFINER, exige admin del lado
// servidor). No pasa por el outbox ni por IndexedDB — a diferencia de
// registrar una venta, anular requiere conexión: es una acción
// administrativa sobre algo que ya ocurrió, no el flujo de cobro, así que
// no aplica la regla de "nunca bloquear". Devuelve null ante cualquier
// fallo (sin red, RPC rechazada) para que quien llama NUNCA actualice el
// estado local como si hubiera funcionado.
export interface ResultadoAnulacion {
  anulada: boolean;
  anulada_en: string;
  // true si la venta ya estaba anulada de antes (RPC idempotente) — un
  // reintento (doble tap, mala señal) no vuelve a reversar el stock.
  ya_estaba_anulada: boolean;
}

export async function anularVenta(ventaId: string, motivo: string): Promise<ResultadoAnulacion | null> {
  try {
    const { data, error } = await supabase
      .rpc('anular_venta', { p_venta_id: ventaId, p_motivo: motivo })
      .single();
    if (error) throw error;
    return data as ResultadoAnulacion;
  } catch {
    return null;
  }
}

// Aplica un movimiento de stock vía la RPC atómica e idempotente — nunca un
// UPDATE directo. Si el mismo id ya se aplicó (reintento de la cola
// offline), la función devuelve el stock actual sin volver a descontar.
//
// El fallo viene distinguido, mismo criterio que aplicarMovimientoFiadoRemoto:
// si supabase.rpc() no llega a obtener respuesta (sin red, timeout), es
// transitorio y vale la pena reintentar. Si el servidor sí respondió y
// rechazó la operación, es permanente — quien llama debe sacarlo de la cola
// en vez de reintentar algo que nunca va a cambiar de resultado.
export interface ResultadoMovimientoStock {
  ok: boolean;
  nuevoStock?: number;
  mensaje?: string;
  permanente?: boolean;
}

export async function aplicarMovimientoStockRemoto(m: MovimientoStock): Promise<ResultadoMovimientoStock> {
  let data: unknown;
  let error: { message?: string } | null;
  try {
    ({ data, error } = await supabase.rpc('aplicar_movimiento_stock', {
      p_id: m.id,
      p_producto_id: m.producto_id,
      p_tipo: m.tipo,
      p_motivo: m.motivo,
      p_cantidad: m.cantidad,
      p_ocurrido_en: m.ocurrido_en,
      p_venta_id: m.venta_id ?? null,
      p_nota: m.nota ?? null,
    }));
  } catch (err) {
    return { ok: false, mensaje: (err as { message?: string }).message, permanente: false };
  }
  if (error) {
    return { ok: false, mensaje: error.message, permanente: true };
  }
  const nuevoStock = data as number;
  // El stock local se corrige al valor autoritativo que devuelve la RPC
  // (no simplemente al que se calculó de forma optimista al encolar) —
  // cubre el caso de que otro dispositivo haya aplicado movimientos
  // propios entre medio.
  await actualizarStockLocal(m.producto_id, nuevoStock);
  return { ok: true, nuevoStock };
}

// Historial de movimientos de TODO el negocio (no solo los de este
// dispositivo) — un admin necesita ver entradas/salidas/ventas registradas
// desde cualquier aparato, igual que ya pasa con las ventas pendientes.
export async function getMovimientosRemoto(negocioId: string, limite = 300): Promise<MovimientoStock[] | null> {
  try {
    const { data, error } = await supabase
      .from('movimientos_stock')
      .select(
        'id, producto_id, tipo, motivo, cantidad, stock_resultante, venta_id, usuario_id, usuario_nombre, nota, ocurrido_en, productos(nombre)'
      )
      .eq('negocio_id', negocioId)
      .order('ocurrido_en', { ascending: false })
      .limit(limite);
    if (error) throw error;

    return (data ?? []).map(m => {
      const productoEmbed = m.productos as unknown as { nombre: string } | { nombre: string }[] | null;
      const nombre = Array.isArray(productoEmbed) ? productoEmbed[0]?.nombre : productoEmbed?.nombre;
      return {
        id: m.id,
        producto_id: m.producto_id,
        producto_nombre: nombre ?? '(producto eliminado)',
        tipo: m.tipo,
        motivo: m.motivo,
        cantidad: m.cantidad,
        stock_resultante: m.stock_resultante ?? undefined,
        venta_id: m.venta_id ?? undefined,
        usuario_id: m.usuario_id ?? undefined,
        usuario_nombre: m.usuario_nombre ?? undefined,
        nota: m.nota ?? undefined,
        ocurrido_en: m.ocurrido_en,
        sincronizado: true,
      } as MovimientoStock;
    });
  } catch {
    return null;
  }
}

// Ventas que este dispositivo cree pendientes (sincronizadas, cierre_id
// null localmente) pero que otro dispositivo ya cerró en Supabase mientras
// tanto. Sin esto, esas ventas quedarían "atrapadas" en el período local
// para siempre: cada vez que ESTE dispositivo cierra caja las volvería a
// incluir, duplicando totales entre cierres reales. Devuelve el cierre_id
// real de cada una para poder aplicarlo localmente.
export async function reconciliarCierresLocal(ventaIds: string[]): Promise<Map<string, string>> {
  if (ventaIds.length === 0) return new Map();
  try {
    const { data, error } = await supabase
      .from('ventas')
      .select('id, cierre_id')
      .in('id', ventaIds)
      .not('cierre_id', 'is', null);
    if (error) throw error;
    return new Map((data ?? []).map(v => [v.id as string, v.cierre_id as string]));
  } catch {
    return new Map();
  }
}

// Aplica un cargo o abono de fiado vía la RPC atómica e idempotente — nunca
// un UPDATE directo a saldo_usd (ni siquiera está permitido por RLS). A
// diferencia de aplicarMovimientoStockRemoto, acá el mensaje de error
// importa: un abono mayor a la deuda lo rechaza la función con un mensaje
// pensado para mostrarse tal cual al usuario, así que no alcanza con
// devolver null en caso de fallo.
//
// El fallo también viene distinguido: si supabase.rpc() ni siquiera obtiene
// respuesta (sin red, timeout), es transitorio y vale la pena reintentar
// como hasta ahora. Si SÍ hubo respuesta y el servidor la rechazó (ej. un
// abono que ya no coincide con el saldo real para cuando le toca subir), es
// permanente — reintentar no lo va a cambiar, así que quien llama debe
// sacarlo de la cola en vez de dejarlo reintentando para siempre.
export interface ResultadoMovimientoFiado {
  ok: boolean;
  saldoNuevo?: number;
  // error.message tal cual lo devolvió la RPC, solo presente cuando ok=false.
  mensaje?: string;
  permanente?: boolean;
}

export async function aplicarMovimientoFiadoRemoto(m: MovimientoFiado): Promise<ResultadoMovimientoFiado> {
  let data: unknown;
  let error: { message?: string } | null;
  try {
    ({ data, error } = await supabase.rpc('aplicar_movimiento_fiado', {
      p_id: m.id,
      p_cliente_id: m.cliente_id,
      p_tipo: m.tipo,
      p_monto_usd: m.monto_usd,
      p_monto_bs: m.monto_bs,
      p_tasa: m.tasa_usada,
      p_venta_id: m.venta_id ?? null,
      p_nota: m.nota ?? null,
      p_ocurrido_en: m.ocurrido_en,
    }));
  } catch (err) {
    // La llamada ni siquiera volvió con una respuesta — sin red, timeout.
    return { ok: false, mensaje: (err as { message?: string }).message, permanente: false };
  }
  if (error) {
    // El servidor respondió y rechazó la operación — definitivo.
    return { ok: false, mensaje: error.message, permanente: true };
  }
  const nuevoSaldo = data as number;
  // Igual que con el stock: el saldo local se corrige al valor
  // autoritativo que devuelve la RPC, no al que se calculó de forma
  // optimista al encolar — cubre que otro dispositivo haya aplicado
  // movimientos propios sobre el mismo cliente entre medio.
  await actualizarSaldoFiadoLocal(m.cliente_id, nuevoSaldo);
  return { ok: true, saldoNuevo: nuevoSaldo };
}

// Historial de movimientos de UN cliente (cargos y abonos), para mostrar
// "qué llevó y cuándo" en su tarjeta de la pantalla Fiado. Se pide bajo
// demanda (no se sincroniza periódicamente como clientes_fiado) — el saldo
// ya está disponible sin conexión, este detalle es un enriquecimiento que
// requiere red y se degrada con gracia si no la hay.
export async function getMovimientosFiadoPorClienteRemoto(
  clienteId: string,
  limite = 20
): Promise<MovimientoFiado[] | null> {
  try {
    const { data, error } = await supabase
      .from('fiado_movimientos')
      .select(
        'id, cliente_id, tipo, monto_usd, monto_bs, tasa_usada, venta_id, usuario_id, usuario_nombre, nota, saldo_resultante, ocurrido_en'
      )
      .eq('cliente_id', clienteId)
      .order('ocurrido_en', { ascending: false })
      .limit(limite);
    if (error) throw error;

    return (data ?? []).map(m => ({
      id: m.id,
      cliente_id: m.cliente_id,
      tipo: m.tipo,
      monto_usd: m.monto_usd,
      monto_bs: m.monto_bs,
      tasa_usada: m.tasa_usada,
      venta_id: m.venta_id ?? undefined,
      usuario_id: m.usuario_id ?? undefined,
      usuario_nombre: m.usuario_nombre ?? undefined,
      nota: m.nota ?? undefined,
      saldo_resultante: m.saldo_resultante ?? undefined,
      ocurrido_en: m.ocurrido_en,
      sincronizado: true,
    } as MovimientoFiado));
  } catch {
    return null;
  }
}

// Abonos de TODO el negocio ocurridos en un rango de tiempo — usado tanto
// para armar el cierre (total_abonado_bs/usd, cantidad_abonos) como para la
// sección "Abonos recibidos" del período actual en Resumen. A propósito NO
// usa la RPC reportes_abonos_fiado: esa función solo devuelve datos con el
// negocio en estado 'activo', y fiar/abonar/cerrar caja deben seguir
// funcionando en 'restringido' — se consulta la tabla directo, confiando
// solo en RLS (que no filtra por estado).
export async function getAbonosPeriodoRemoto(
  negocioId: string,
  desde: string | null,
  hasta: string
): Promise<MovimientoFiado[] | null> {
  try {
    let query = supabase
      .from('fiado_movimientos')
      .select('id, cliente_id, tipo, monto_usd, monto_bs, tasa_usada, venta_id, ocurrido_en')
      .eq('negocio_id', negocioId)
      .eq('tipo', 'abono')
      .lte('ocurrido_en', hasta);
    if (desde) query = query.gt('ocurrido_en', desde);
    const { data, error } = await query;
    if (error) throw error;

    return (data ?? []).map(m => ({
      id: m.id,
      cliente_id: m.cliente_id,
      tipo: m.tipo,
      monto_usd: m.monto_usd,
      monto_bs: m.monto_bs,
      tasa_usada: m.tasa_usada,
      venta_id: m.venta_id ?? undefined,
      ocurrido_en: m.ocurrido_en,
      sincronizado: true,
    } as MovimientoFiado));
  } catch {
    return null;
  }
}
