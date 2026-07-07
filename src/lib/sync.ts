import { supabase } from './supabase';
import { saveProductos, saveConfiguracion, getConfiguracion as getConfigDB } from './db';
import { Producto, Configuracion } from '@/types';

export async function syncFromSupabase(): Promise<Configuracion | null> {
  try {
    const [productosRes, configRes] = await Promise.all([
      supabase.from('productos').select('*'),
      supabase.from('configuracion').select('*').eq('id', 1).single(),
    ]);

    if (productosRes.data) {
      await saveProductos(productosRes.data as Producto[]);
    }

    if (configRes.data) {
      await saveConfiguracion(configRes.data as Configuracion);
      return configRes.data as Configuracion;
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
