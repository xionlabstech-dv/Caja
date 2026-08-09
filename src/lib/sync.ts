import { supabase } from './supabase';
import { saveProductos, saveConfiguracion, getConfiguracion as getConfigDB } from './db';
import { Producto, Configuracion, CierreCaja } from '@/types';

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
