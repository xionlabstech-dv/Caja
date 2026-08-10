import { supabase } from './supabase';
import { MetodoPago } from '@/types';

export interface TotalesPeriodo {
  total_bs: number;
  total_usd: number;
  cantidad_ventas: number;
}

export interface DesglosePorMetodo {
  metodo_pago: MetodoPago;
  total_bs: number;
  total_usd: number;
  cantidad: number;
}

export interface TopProducto {
  producto_id: string | null;
  nombre: string;
  es_por_peso: boolean;
  cantidad_total: number;
  monto_total: number;
}

export interface VentasPorDiaSemana {
  dia_semana: number; // 0=domingo .. 6=sábado (extract(dow))
  total_bs: number;
  cantidad_ventas: number;
  ocurrencias: number;
  promedio_bs: number;
}

// Todas las funciones agregan del lado de Supabase (funciones RPC en SQL) —
// nunca traen las filas crudas al cliente para sumarlas en JS. Devuelven
// null ante cualquier fallo (típicamente sin conexión); la página decide
// cómo mostrarlo.

export async function fetchTotales(negocioId: string, desde: Date, hasta: Date): Promise<TotalesPeriodo | null> {
  try {
    const { data, error } = await supabase.rpc('reportes_totales', {
      p_negocio_id: negocioId,
      p_desde: desde.toISOString(),
      p_hasta: hasta.toISOString(),
    }).single();
    if (error) throw error;
    return data as TotalesPeriodo;
  } catch {
    return null;
  }
}

export async function fetchPorMetodo(negocioId: string, desde: Date, hasta: Date): Promise<DesglosePorMetodo[] | null> {
  try {
    const { data, error } = await supabase.rpc('reportes_por_metodo', {
      p_negocio_id: negocioId,
      p_desde: desde.toISOString(),
      p_hasta: hasta.toISOString(),
    });
    if (error) throw error;
    return (data ?? []) as DesglosePorMetodo[];
  } catch {
    return null;
  }
}

export async function fetchTopProductos(negocioId: string, desde: Date, hasta: Date, limite = 10): Promise<TopProducto[] | null> {
  try {
    const { data, error } = await supabase.rpc('reportes_top_productos', {
      p_negocio_id: negocioId,
      p_desde: desde.toISOString(),
      p_hasta: hasta.toISOString(),
      p_limite: limite,
    });
    if (error) throw error;
    return (data ?? []) as TopProducto[];
  } catch {
    return null;
  }
}

export async function fetchPorDiaSemana(negocioId: string, desde: Date, hasta: Date): Promise<VentasPorDiaSemana[] | null> {
  try {
    const { data, error } = await supabase.rpc('reportes_por_dia_semana', {
      p_negocio_id: negocioId,
      p_desde: desde.toISOString(),
      p_hasta: hasta.toISOString(),
    });
    if (error) throw error;
    return (data ?? []) as VentasPorDiaSemana[];
  } catch {
    return null;
  }
}
