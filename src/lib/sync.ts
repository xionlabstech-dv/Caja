import { supabase } from './supabase';
import { saveProductos, saveConfiguracion, getConfiguracion as getConfigDB } from './db';
import { Producto, Configuracion } from '@/types';

export async function syncFromSupabase(): Promise<Configuracion | null> {
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
      .eq('id', 1)
      .single();

    if (configData) {
      await saveConfiguracion(configData as Configuracion);
      return configData as Configuracion;
    }

    return null;
  } catch {
    return null;
  }
}

export async function updateTasa(tasa: number): Promise<boolean> {
  try {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('configuracion')
      .upsert({ id: 1, tasa, tasa_actualizada_en: now });

    if (error) throw error;

    await saveConfiguracion({ id: 1, tasa, tasa_actualizada_en: now });
    return true;
  } catch {
    return false;
  }
}

export async function createProductoSupabase(
  producto: Omit<Producto, 'id'>
): Promise<Producto | null> {
  try {
    const { data, error } = await supabase
      .from('productos')
      .insert(producto)
      .select()
      .single();

    if (error) throw error;
    return data as Producto;
  } catch {
    return null;
  }
}

export async function updateProductoSupabase(
  id: string,
  producto: Partial<Producto>
): Promise<boolean> {
  try {
    const { error } = await supabase.from('productos').update(producto).eq('id', id);
    if (error) throw error;
    return true;
  } catch {
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
