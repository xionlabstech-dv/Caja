export interface Producto {
  id: string;
  codigo_barra: string | null;
  nombre: string;
  moneda: 'USD' | 'VES';
  precio: number;
  activo: boolean;
  por_peso: boolean;
}

export interface Configuracion {
  id: number;
  tasa: number;
  tasa_actualizada_en: string;
}

export interface VentaItem {
  producto_id: string;
  nombre: string;
  precio_bs: number;
  cantidad: number;
  subtotal_bs: number;
  gramos?: number;
}

export type MetodoPago = 'efectivo_bs' | 'pago_movil' | 'biopago' | 'tarjeta' | 'efectivo_usd';

export interface Venta {
  id: string;
  fecha: string;
  fecha_dia: string;
  items: VentaItem[];
  metodo_pago: MetodoPago;
  total_bs: number;
  total_usd: number;
  tasa_usada: number;
}

export interface ItemCarrito {
  lineId: string;
  producto: Producto;
  cantidad: number;
  esPorPeso?: boolean;
  gramos?: number;
  precioCalculadoBase?: number;
}
