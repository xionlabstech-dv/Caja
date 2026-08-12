import { Producto } from '@/types';

export function precioBS(producto: Producto, tasa: number): number {
  if (producto.moneda === 'USD') return producto.precio * tasa;
  return producto.precio;
}

export function precioUSD(producto: Producto, tasa: number): number {
  if (producto.moneda === 'USD') return producto.precio;
  return tasa > 0 ? producto.precio / tasa : 0;
}

// null si el producto no tiene costo registrado — a diferencia de precioUSD,
// nunca hay un "0 por defecto" aquí: 0 significaría costo cero (dato real),
// mientras que null significa "no sabemos el costo" (nada que snapshotear).
export function costoUSD(producto: Producto, tasa: number): number | null {
  if (producto.costo == null) return null;
  if (producto.moneda === 'USD') return producto.costo;
  return tasa > 0 ? producto.costo / tasa : null;
}

export function formatBS(amount: number): string {
  return `Bs ${amount.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatUSD(amount: number): string {
  return `$ ${amount.toFixed(2)}`;
}
