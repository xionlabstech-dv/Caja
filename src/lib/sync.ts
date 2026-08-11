import { supabase } from './supabase';
import { saveProductos, saveConfiguracion, getConfiguracion as getConfigDB } from './db';
import { Producto, Configuracion, CierreCaja, Venta, VentaItem } from '@/types';

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

export async function updateTasa(tasa: number, negocioId: string): Promise<boolean> {
  try {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('configuracion')
      .update({ tasa, tasa_actualizada_en: now })
      .eq('negocio_id', negocioId);

    if (error) throw error;

    await saveConfiguracion({ id: 1, tasa, tasa_actualizada_en: now });
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
    const { error } = await supabase.from('productos').update(producto).eq('id', id);
    if (error) throw error;
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return 'duplicate';
    return false;
  }
}

export async function softDeleteProducto(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('productos')
      .update({ activo: false })
      .eq('id', id);
    if (error) throw error;
    return true;
  } catch {
    return false;
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
      };
    });

    if (itemsPayload.length > 0) {
      const { error: itemsError } = await supabase.from('venta_items').insert(itemsPayload);
      if (itemsError && (itemsError as { code?: string }).code !== '23505') {
        throw itemsError;
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
    const { error } = await supabase
      .from('ventas')
      .update({ cierre_id: cierreId })
      .in('id', ventaIds);
    if (error) throw error;
    return true;
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
    const { data: itemsData } = await supabase
      .from('venta_items')
      .select('*')
      .in('venta_id', ids);

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
      total_bs: v.total_bs,
      total_usd: v.total_usd,
      tasa_usada: v.tasa,
      cierre_id: v.cierre_id ?? undefined,
      sincronizada: true,
      usuario_id: v.usuario_id ?? undefined,
      usuario_nombre: v.usuario_nombre ?? undefined,
    }));
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
