import { getTodasLasVentas, getMovimientos, getMovimientosFiado, getProductos, getConfiguracion } from './db';
import { Venta, VentaItem, MovimientoStock, MovimientoFiado, Producto, Configuracion, Rol, EstadoNegocio } from '@/types';
import {
  TotalesPeriodo,
  DesglosePorMetodo,
  TopProducto,
  OrdenTopProductos,
  VentasPorDiaSemana,
  MermaPorMotivo,
  AbonosFiadoPeriodo,
  VentaAnulada,
  PerdidaAgregada,
} from './reportes';

// Espejo de reportes.ts calculando desde IndexedDB en vez de las RPC —
// mismas firmas, mismos tipos de retorno, misma lógica exacta de cada RPC
// (leída directo de Supabase, no deducida). reportes.ts no se toca: sigue
// siendo la fuente autoritativa con señal, porque ve el negocio completo y
// no solo este dispositivo — esto es el camino de emergencia sin ella.
//
// La regla que manda sobre todas las demás: el número local y el del
// servidor tienen que ser el mismo número para los mismos datos. Por eso
// cada función de abajo tiene, pegado, de qué RPC viene y qué hace esa RPC
// exactamente.

// Las RPC de reportes deciden quién ve qué del lado del servidor
// (mi_rol(), mi_estado_negocio(), negocios.usa_costos) — acá no hay sesión
// de Postgres que resolver esas funciones, así que el llamador (la
// pantalla, que sí tiene esto del contexto) las pasa explícitas. Es la
// única diferencia real de firma contra reportes.ts.
export interface PermisosReporte {
  estado: EstadoNegocio;
  rol: Rol | null;
  usaCostos: boolean;
}

// mi_estado_negocio() = 'activo' está en el WHERE de las nueve RPC — un
// negocio restringido no ve reportes, con o sin señal (types/index.ts,
// EstadoNegocio). Replicado como "la fuente de filas de este cálculo queda
// vacía si no está activo", exactamente el mismo efecto que tiene agregarlo
// al WHERE del lado del servidor: cuentas/sumas en cero, nunca un error.
function activo(permisos: PermisosReporte): boolean {
  return permisos.estado === 'activo';
}

// mi_rol() = 'admin' and negocios.usa_costos — compuerta de toda cifra de
// ganancia/costo (ganancia_usd, monto_con_costo_usd, items_con_costo,
// items_totales, TopProducto.ganancia_usd, y valor_usd en mermas/consumo/
// faltantes si tuvieran costo). mi_estado_negocio() se repite acá tal cual
// lo repite cada RPC en su CTE `permitido`, aunque ya quedó cubierto arriba.
function permiteGanancia(permisos: PermisosReporte): boolean {
  return permisos.rol === 'admin' && permisos.usaCostos && activo(permisos);
}

function enRango(fechaIso: string, desde: Date, hasta: Date): boolean {
  const t = new Date(fechaIso).getTime();
  return t >= desde.getTime() && t < hasta.getTime();
}

// venta_items.cantidad que llega a Supabase NO es VentaItem.cantidad tal
// cual: sincronizarVenta (sync.ts) manda gramos/1000 para un item por peso
// (con precioUnitarioUsd/Bs y costo_usd como el valor POR KG, cantidad
// local siempre 1 ahí). Todas las fórmulas de las RPC que multiplican por
// "cantidad" usan ese valor ya convertido — hay que replicarlo acá o la
// ganancia de un item por peso saldría con cantidad=1 en vez de los kg
// reales vendidos.
function cantidadServidor(item: VentaItem): number {
  return item.gramos !== undefined ? item.gramos / 1000 : item.cantidad;
}

// Mismo criterio que reportes_por_dia_semana en el servidor
// (`extract(dow from (v.vendida_en at time zone 'America/Caracas'))`):
// día de la semana en America/Caracas de verdad, no en la zona del
// dispositivo — que debería ser la misma (el negocio opera ahí), pero no
// hay por qué depender de que el reloj/huso del teléfono esté bien puesto
// para que este número coincida con el del servidor. 0=domingo..6=sábado,
// igual que extract(dow).
const DOW_POR_ABREVIATURA: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function diaSemanaCaracas(fecha: Date): number {
  const abrev = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Caracas', weekday: 'short' }).format(fecha);
  return DOW_POR_ABREVIATURA[abrev];
}

// Lectura de IndexedDB una sola vez por carga: cada una de las nueve
// funciones de abajo llama a estas en vez de getTodasLasVentas()/
// getMovimientos()/getMovimientosFiado() directo. Como todas se piden
// juntas en un solo Promise.all (ver reportes/page.tsx), las primeras en
// ejecutar dejan la promesa en curso puesta ANTES de que ninguna haga
// await, así que las demás reusan esa misma promesa en vez de disparar su
// propio getAll(). invalidarCacheReportesLocal() hay que llamarla al
// empezar cada carga nueva (no solo una vez en la vida de la pestaña) —
// ver cargar() en la página.
let cacheVentas: Promise<Venta[]> | null = null;
let cacheMovimientos: Promise<MovimientoStock[]> | null = null;
let cacheMovimientosFiado: Promise<MovimientoFiado[]> | null = null;
let cacheProductos: Promise<Producto[]> | null = null;
let cacheConfiguracion: Promise<Configuracion | undefined> | null = null;

export function invalidarCacheReportesLocal(): void {
  cacheVentas = null;
  cacheMovimientos = null;
  cacheMovimientosFiado = null;
  cacheProductos = null;
  cacheConfiguracion = null;
}

function ventasCache(): Promise<Venta[]> {
  if (!cacheVentas) cacheVentas = getTodasLasVentas();
  return cacheVentas;
}

function movimientosCache(): Promise<MovimientoStock[]> {
  if (!cacheMovimientos) cacheMovimientos = getMovimientos();
  return cacheMovimientos;
}

function movimientosFiadoCache(): Promise<MovimientoFiado[]> {
  if (!cacheMovimientosFiado) cacheMovimientosFiado = getMovimientosFiado();
  return cacheMovimientosFiado;
}

// Para valor_usd de mermas/consumo propio/faltantes por conteo (ver
// valorUsdDeMovimientos) — solo se piden si hay permiso de ganancia, así
// que estos dos no se leen en la mayoría de las cargas (cajero, o negocio
// sin usa_costos).
function productosCache(): Promise<Producto[]> {
  if (!cacheProductos) cacheProductos = getProductos();
  return cacheProductos;
}

function configuracionCache(): Promise<Configuracion | undefined> {
  if (!cacheConfiguracion) cacheConfiguracion = getConfiguracion();
  return cacheConfiguracion;
}

// Ventas vigentes (not anulada) del período — la base de reportes_totales,
// reportes_por_metodo, reportes_top_productos y reportes_por_dia_semana.
// "Local = lo que este dispositivo vio": una venta anulada en este
// dispositivo pero todavía sin confirmar (anulacion_sincronizada === false)
// ya se excluye acá mismo, igual que ya la excluye Resumen — el servidor la
// sigue mostrando vigente hasta que la cola resuelva. Correcto en los dos
// lados, se cierra solo (ver brief).
function ventasVigentesEnRango(ventas: Venta[], desde: Date, hasta: Date, permisos: PermisosReporte): Venta[] {
  if (!activo(permisos)) return [];
  return ventas.filter(v => !v.anulada && enRango(v.fecha, desde, hasta));
}

export async function fetchTotalesLocal(
  _negocioId: string, desde: Date, hasta: Date, permisos: PermisosReporte,
): Promise<TotalesPeriodo> {
  const ventas = await ventasCache();
  const vigentes = ventasVigentesEnRango(ventas, desde, hasta, permisos);

  const total_bs = vigentes.reduce((s, v) => s + v.total_bs, 0);
  const total_usd = vigentes.reduce((s, v) => s + v.total_usd, 0);
  const cantidad_ventas = vigentes.length;

  // reportes_totales: ganancia = sum((precio_usd - costo_usd) * cantidad)
  // sobre los items CON costo_usd no nulo — monto_con_costo_usd e
  // items_con_costo salen del mismo filtro, items_totales es el conteo
  // crudo de items (con o sin costo). Los cuatro van null si no hay
  // permiso, no 0 — "no se sabe", no "es cero".
  let ganancia_usd: number | null = null;
  let monto_con_costo_usd: number | null = null;
  let items_con_costo: number | null = null;
  let items_totales: number | null = null;

  if (permiteGanancia(permisos)) {
    const items = vigentes.flatMap(v => v.items);
    const itemsConCosto = items.filter(i => i.costo_usd != null);
    // sum(...) filter(...) sin coalesce: si itemsConCosto queda vacío, la
    // RPC da NULL (SUM sobre cero filas), no 0 — a diferencia de
    // items_con_costo/items_totales, que son count(*) y nunca son null.
    if (itemsConCosto.length > 0) {
      ganancia_usd = itemsConCosto.reduce((s, i) => s + (i.precioUnitarioUsd - i.costo_usd!) * cantidadServidor(i), 0);
      monto_con_costo_usd = itemsConCosto.reduce((s, i) => s + i.precioUnitarioUsd * cantidadServidor(i), 0);
    }
    items_con_costo = itemsConCosto.length;
    items_totales = items.length;
  }

  return { total_bs, total_usd, cantidad_ventas, ganancia_usd, monto_con_costo_usd, items_con_costo, items_totales };
}

export async function fetchPorMetodoLocal(
  _negocioId: string, desde: Date, hasta: Date, permisos: PermisosReporte,
): Promise<DesglosePorMetodo[]> {
  const ventas = await ventasCache();
  const vigentes = ventasVigentesEnRango(ventas, desde, hasta, permisos);

  // reportes_por_metodo agrupa por venta_pagos.metodo, no por
  // ventas.metodo_pago — el equivalente local es recorrer venta.pagos, así
  // que una venta mixta suma a cada método que usó (cantidad cuenta PAGOS,
  // no ventas).
  const porMetodo = new Map<string, DesglosePorMetodo>();
  for (const v of vigentes) {
    for (const p of v.pagos) {
      const actual = porMetodo.get(p.metodo) ?? { metodo_pago: p.metodo, total_bs: 0, total_usd: 0, cantidad: 0 };
      actual.total_bs += p.monto_bs;
      actual.total_usd += p.monto_usd;
      actual.cantidad += 1;
      porMetodo.set(p.metodo, actual);
    }
  }
  return Array.from(porMetodo.values());
}

export async function fetchTopProductosLocal(
  _negocioId: string, desde: Date, hasta: Date,
  permisos: PermisosReporte, limite = 10, orden: OrdenTopProductos = 'cantidad',
): Promise<TopProducto[]> {
  const ventas = await ventasCache();
  const vigentes = ventasVigentesEnRango(ventas, desde, hasta, permisos)
    .slice().sort((a, b) => a.fecha.localeCompare(b.fecha)); // ascendente: el último en pisar "nombre" es el más reciente

  interface Acumulado {
    nombre: string;
    esPorPeso: boolean;
    cantidadTotal: number;
    montoTotal: number;
    gananciaSuma: number;
    gananciaCuenta: number; // items con costo_usd — si queda en 0, ganancia_usd_calc es null (SUM sobre cero filas), no 0
  }
  const porProducto = new Map<string, Acumulado>();

  for (const v of vigentes) {
    for (const item of v.items) {
      const cant = cantidadServidor(item);
      const acc = porProducto.get(item.producto_id) ?? {
        nombre: item.nombre, esPorPeso: false, cantidadTotal: 0, montoTotal: 0, gananciaSuma: 0, gananciaCuenta: 0,
      };
      // (array_agg(... order by vendida_en desc))[1]: el nombre de la
      // ocurrencia MÁS RECIENTE gana — como vigentes está ascendente, cada
      // item nuevo de este producto pisa el nombre anterior.
      // regexp_replace(nombre, ' — [0-9]+g$', ''): el nombre de un item por
      // peso trae el gramaje de ESA venta pegado (page.tsx, agregarPorPeso)
      // y el servidor lo pela para el top — mismo criterio acá.
      acc.nombre = item.nombre.replace(/ — \d+g$/, '');
      if (item.gramos !== undefined) acc.esPorPeso = true;
      acc.cantidadTotal += cant;
      acc.montoTotal += cant * item.precioUnitarioBs;
      if (item.costo_usd != null) {
        acc.gananciaSuma += (item.precioUnitarioUsd - item.costo_usd) * cant;
        acc.gananciaCuenta += 1;
      }
      porProducto.set(item.producto_id, acc);
    }
  }

  const permiso = permiteGanancia(permisos);
  const productos: TopProducto[] = Array.from(porProducto.entries()).map(([producto_id, acc]) => ({
    producto_id,
    nombre: acc.nombre,
    es_por_peso: acc.esPorPeso,
    cantidad_total: acc.cantidadTotal,
    monto_total: acc.montoTotal,
    ganancia_usd: permiso && acc.gananciaCuenta > 0 ? acc.gananciaSuma : null,
  }));

  // order by case when p_orden='ganancia' and permitido.ok then
  // ganancia_usd_calc end desc nulls last, cantidad_total desc — con orden
  // 'cantidad' o sin permiso, el primer criterio no aplica y queda solo el
  // segundo.
  productos.sort((a, b) => {
    if (orden === 'ganancia' && permiso) {
      const ga = a.ganancia_usd;
      const gb = b.ganancia_usd;
      if (ga == null && gb == null) return b.cantidad_total - a.cantidad_total;
      if (ga == null) return 1; // nulls last
      if (gb == null) return -1;
      if (gb !== ga) return gb - ga;
    }
    return b.cantidad_total - a.cantidad_total;
  });

  return productos.slice(0, limite);
}

export async function fetchPorDiaSemanaLocal(
  _negocioId: string, desde: Date, hasta: Date, permisos: PermisosReporte,
): Promise<VentasPorDiaSemana[]> {
  const ventas = await ventasCache();
  // Las ocurrencias NO dependen de estado/permisos — la RPC las cuenta con
  // generate_series(p_desde, p_hasta) sin el filtro mi_estado_negocio() que
  // sí tiene la agregación de ventas (CTE ventas_agg aparte). Un negocio
  // restringido sigue viendo los 7 días con ocurrencias reales, solo con
  // total_bs/cantidad_ventas en cero (porque ventasVigentesEnRango sí
  // aplica esa compuerta).
  const vigentes = ventasVigentesEnRango(ventas, desde, hasta, permisos);

  const porDia = new Map<number, { total_bs: number; cantidad_ventas: number }>();
  for (const v of vigentes) {
    const dow = diaSemanaCaracas(new Date(v.fecha));
    const acc = porDia.get(dow) ?? { total_bs: 0, cantidad_ventas: 0 };
    acc.total_bs += v.total_bs;
    acc.cantidad_ventas += 1;
    porDia.set(dow, acc);
  }

  // generate_series(p_desde::date, (p_hasta::date - 1 día)::date, 1 día):
  // un día calendario por vuelta, en el mismo sentido en que p_desde/p_hasta
  // ya llegan alineados a medianoche de America/Caracas (rangoPeriodo/
  // parseFechaInput construyen con el constructor local, no con el string
  // ISO) — Venezuela no tiene horario de verano, así que sumar 24h exactas
  // por vuelta nunca se corre de día.
  const ocurrencias = [0, 0, 0, 0, 0, 0, 0];
  for (let t = desde.getTime(); t < hasta.getTime(); t += 86400000) {
    ocurrencias[diaSemanaCaracas(new Date(t))]++;
  }

  const resultado: VentasPorDiaSemana[] = [];
  for (let dow = 0; dow < 7; dow++) {
    const oc = ocurrencias[dow];
    if (oc === 0 && !porDia.has(dow)) continue; // left join: un día que ni ocurre en el rango no aparece
    const agg = porDia.get(dow) ?? { total_bs: 0, cantidad_ventas: 0 };
    resultado.push({
      dia_semana: dow,
      total_bs: agg.total_bs,
      cantidad_ventas: agg.cantidad_ventas,
      ocurrencias: oc,
      promedio_bs: oc > 0 ? agg.total_bs / oc : 0,
    });
  }
  return resultado.sort((a, b) => a.dia_semana - b.dia_semana);
}

// valor_usd de mermas/consumo propio/faltantes por conteo: el servidor usa
// el COSTO ACTUAL del producto y la TASA ACTUAL (join contra productos +
// configuracion), no un snapshot histórico — así que, a diferencia de lo
// que decía la primera versión de este archivo, SÍ se puede reproducir
// igual offline: Producto.costo/moneda y Configuracion.tasa ya están en
// IndexedDB.
//
// sum(abs(cantidad) * (moneda='USD' ? costo : costo/nullif(tasa,0)))
// filter (where costo is not null) — dos semánticas NULL distintas, las
// dos replicadas acá:
//   - costo null (o producto ausente) → esa fila queda AFUERA del sum, no
//     cuenta ni como 0.
//   - costo en VES con tasa <= 0 → nullif(tasa,0) da NULL en SQL, y sum
//     ignora los NULL individuales sin envenenar el resto (a diferencia de
//     costo/0 en JS, que da Infinity). Esa fila tampoco suma nada, pero
//     las demás filas del grupo sí.
// Si NINGUNA fila termina aportando un número real, el resultado es null
// (sum sobre cero contribuciones), no 0 — mismo criterio que ya corregiste
// en fetchTotalesLocal.
//
// Divergencia aceptada, no corregida: el join de la RPC contra `productos`
// encuentra también los INACTIVOS. El store local ya no los tiene — desde
// el sync incremental, reconciliarProductos (db.ts) borra la fila cuando
// activo=false, que es lo que bajó el tráfico de 1,32 GB a 22 MB/día. Un
// producto dado de baja después de generar una merma hace que esa fila
// quede afuera del sum acá (mismo efecto que "sin costo"): el número local
// puede quedar por DEBAJO del servidor, nunca por encima ni inventado. No
// se arregla trayendo inactivos de vuelta al store — ese canje no vale una
// fila de merma.
function valorUsdDeMovimientos(movimientos: MovimientoStock[], productosPorId: Map<string, Producto>, tasa: number): number | null {
  let suma: number | null = null;
  for (const m of movimientos) {
    const producto = productosPorId.get(m.producto_id);
    if (!producto || producto.costo == null) continue;
    const valorUnitario = producto.moneda === 'USD' ? producto.costo : (tasa > 0 ? producto.costo / tasa : null);
    if (valorUnitario == null) continue;
    suma = (suma ?? 0) + Math.abs(m.cantidad) * valorUnitario;
  }
  return suma;
}

export async function fetchMermasLocal(
  _negocioId: string, desde: Date, hasta: Date, permisos: PermisosReporte,
): Promise<MermaPorMotivo[]> {
  if (!activo(permisos)) return [];
  const movimientos = await movimientosCache();
  // reportes_mermas: tipo='salida' and motivo in ('dano','vencido','perdida').
  const motivos = ['dano', 'vencido', 'perdida'];
  const filtrados = movimientos.filter(m => m.tipo === 'salida' && motivos.includes(m.motivo) && enRango(m.ocurrido_en, desde, hasta));

  // Compuerta de valor_usd: permitido.ok (admin + usa_costos), igual que
  // ganancia_usd en los demás reportes — cantidad no depende de esto, solo
  // de activo (ya aplicado arriba).
  const permiso = permiteGanancia(permisos);
  const productosPorId = permiso ? new Map((await productosCache()).map(p => [p.id, p])) : null;
  const tasa = permiso ? (await configuracionCache())?.tasa ?? 0 : 0;

  const porMotivo = new Map<string, MovimientoStock[]>();
  for (const m of filtrados) {
    const lista = porMotivo.get(m.motivo) ?? [];
    lista.push(m);
    porMotivo.set(m.motivo, lista);
  }

  return Array.from(porMotivo.entries()).map(([motivo, lista]) => ({
    motivo,
    cantidad: lista.reduce((s, m) => s + Math.abs(m.cantidad), 0),
    valor_usd: productosPorId ? valorUsdDeMovimientos(lista, productosPorId, tasa) : null,
  }));
}

export async function fetchAbonosFiadoLocal(
  _negocioId: string, desde: Date, hasta: Date, permisos: PermisosReporte,
): Promise<AbonosFiadoPeriodo> {
  if (!activo(permisos)) return { total_bs: 0, total_usd: 0, cantidad: 0 };
  const movimientos = await movimientosFiadoCache();
  // reportes_abonos_fiado: tipo='abono' and venta_id is null — excluye el
  // abono-reverso que genera anular_venta (ese SÍ trae venta_id), mismo
  // criterio que ya usa Resumen para separar "cobrado" de "reverso".
  const abonos = movimientos.filter(m => m.tipo === 'abono' && !m.venta_id && enRango(m.ocurrido_en, desde, hasta));
  return {
    total_bs: abonos.reduce((s, m) => s + m.monto_bs, 0),
    total_usd: abonos.reduce((s, m) => s + m.monto_usd, 0),
    cantidad: abonos.length,
  };
}

export async function fetchAnulacionesLocal(
  _negocioId: string, desde: Date, hasta: Date, permisos: PermisosReporte,
): Promise<VentaAnulada[]> {
  if (!activo(permisos)) return [];
  const ventas = await ventasCache();
  // reportes_anulaciones: v.anulada = true, filtrada por vendida_en (no por
  // anulada_en) — una venta vendida en el período y anulada después igual
  // cuenta acá si la anulación cayó en el mismo período de vendida_en.
  // order by vendida_en desc, igual que la RPC.
  return ventas
    .filter(v => v.anulada && enRango(v.fecha, desde, hasta))
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .map(v => ({
      venta_id: v.id,
      vendida_en: v.fecha,
      total_bs: v.total_bs,
      total_usd: v.total_usd,
      motivo_anulacion: v.motivo_anulacion ?? null,
      anulada_por_nombre: v.anulada_por_nombre ?? null,
      anulada_en: v.anulada_en ?? null,
    }));
}

// consumo_propio y faltantes_conteo comparten la misma forma (cantidad +
// valor_usd) y el mismo criterio de movimientos_stock — una sola función
// interna, dos exports, igual que PerdidaAgregada agrupa los dos tipos.
async function perdidaAgregadaLocal(
  desde: Date, hasta: Date, permisos: PermisosReporte,
  filtro: (m: MovimientoStock) => boolean,
): Promise<PerdidaAgregada> {
  if (!activo(permisos)) return { cantidad: 0, valor_usd: null };
  const movimientos = await movimientosCache();
  const filtrados = movimientos.filter(m => filtro(m) && enRango(m.ocurrido_en, desde, hasta));
  const cantidad = filtrados.reduce((s, m) => s + Math.abs(m.cantidad), 0);

  if (!permiteGanancia(permisos)) return { cantidad, valor_usd: null };
  const productosPorId = new Map((await productosCache()).map(p => [p.id, p]));
  const tasa = (await configuracionCache())?.tasa ?? 0;
  return { cantidad, valor_usd: valorUsdDeMovimientos(filtrados, productosPorId, tasa) };
}

export async function fetchConsumoPropioLocal(
  _negocioId: string, desde: Date, hasta: Date, permisos: PermisosReporte,
): Promise<PerdidaAgregada> {
  // reportes_consumo_propio: tipo='salida' and motivo='consumo_propio'.
  return perdidaAgregadaLocal(desde, hasta, permisos, m => m.tipo === 'salida' && m.motivo === 'consumo_propio');
}

export async function fetchFaltantesConteoLocal(
  _negocioId: string, desde: Date, hasta: Date, permisos: PermisosReporte,
): Promise<PerdidaAgregada> {
  // reportes_faltantes_conteo: tipo='ajuste' and motivo='conteo_fisico' and
  // cantidad < 0 (un ajuste de conteo puede ser + o -; solo el faltante
  // cuenta acá).
  return perdidaAgregadaLocal(
    desde, hasta, permisos,
    m => m.tipo === 'ajuste' && m.motivo === 'conteo_fisico' && m.cantidad < 0,
  );
}

// fetchStockBajo (reportes.ts) no tiene equivalente acá: reportes/page.tsx
// no la importa — no existe hoy un espejo que nadie llame.
