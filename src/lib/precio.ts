import { Producto } from '@/types';

export function precioBS(producto: Producto, tasa: number): number {
  if (producto.moneda === 'USD') return producto.precio * tasa;
  return producto.precio;
}

export function precioUSD(producto: Producto, tasa: number): number {
  if (producto.moneda === 'USD') return producto.precio;
  return tasa > 0 ? producto.precio / tasa : 0;
}

export function formatBS(amount: number): string {
  return `Bs ${amount.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatUSD(amount: number): string {
  return `$ ${amount.toFixed(2)}`;
}
