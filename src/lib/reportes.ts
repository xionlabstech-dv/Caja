import { supabase } from './supabase';

export interface TotalesPeriodo {
  total_bs: number;
  total_usd: number;
  cantidad_ventas: number;
  // Todos null si quien llama no es admin o el negocio no usa_costos — la
  // función RPC lo verifica server-side, no es solo una omisión del cliente.
  ganancia_usd: number | null;
  monto_con_costo_usd: number | null;
  items_con_costo: number | null;
  items_totales: number | null;
}

export interface DesglosePorMetodo {
  // string, no MetodoPago: los valores reales en ventas.metodo_pago no están
  // restringidos por un enum/check en la base, y de hecho conviven distintos
  // esquemas de nombres (ver METODO_INFO en la página de Reportes).
  metodo_pago: string;
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
  // null si no hay costo registrado para ningún item vendido de este
  // producto en el período, o si quien llama no es admin / no usa_costos.
  ganancia_usd: number | null;
}

export type OrdenTopProductos = 'cantidad' | 'ganancia';

export interface VentasPorDiaSemana {
  dia_semana: number; // 0=domingo .. 6=sábado (extract(dow))
  total_bs: number;
  cantidad_ventas: number;
  ocurrencias: number;
  promedio_bs: number;
}

export interface StockBajoProducto {
  producto_id: string;
  nombre: string;
  es_por_peso: boolean;
  stock: number;
  stock_minimo: number;
}

export interface MermaPorMotivo {
  motivo: string;
  cantidad: number;
  // null si no hay costo registrado para ninguna merma de ese motivo en el
  // período, o si quien llama no es admin / no usa_costos.
  valor_usd: number | null;
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

export async function fetchTopProductos(
  negocioId: string,
  desde: Date,
  hasta: Date,
  limite = 10,
  orden: OrdenTopProductos = 'cantidad',
): Promise<TopProducto[] | null> {
  try {
    const { data, error } = await supabase.rpc('reportes_top_productos', {
      p_negocio_id: negocioId,
      p_desde: desde.toISOString(),
      p_hasta: hasta.toISOString(),
      p_limite: limite,
      p_orden: orden,
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

export async function fetchStockBajo(negocioId: string): Promise<StockBajoProducto[] | null> {
  try {
    const { data, error } = await supabase.rpc('reportes_stock_bajo', { p_negocio_id: negocioId });
    if (error) throw error;
    return (data ?? []) as StockBajoProducto[];
  } catch {
    return null;
  }
}

export async function fetchMermas(negocioId: string, desde: Date, hasta: Date): Promise<MermaPorMotivo[] | null> {
  try {
    const { data, error } = await supabase.rpc('reportes_mermas', {
      p_negocio_id: negocioId,
      p_desde: desde.toISOString(),
      p_hasta: hasta.toISOString(),
    });
    if (error) throw error;
    return (data ?? []) as MermaPorMotivo[];
  } catch {
    return null;
  }
}
