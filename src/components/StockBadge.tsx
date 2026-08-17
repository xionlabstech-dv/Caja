'use client';

import { debeOcultarStock, stockBajo } from '@/lib/stock';

interface StockBadgeProps {
  stock: number | null | undefined;
  stockMinimo: number | null | undefined;
  controlaStock?: boolean;
  esPorPeso: boolean;
  isOnline: boolean;
  ultimaSincronizacion: string | null;
}

// Usado en Caja e Inventario — misma regla de confiabilidad (Parte 5) en
// los dos únicos lugares donde se muestra el número de stock.
export default function StockBadge({
  stock,
  stockMinimo,
  controlaStock,
  esPorPeso,
  isOnline,
  ultimaSincronizacion,
}: StockBadgeProps) {
  if (controlaStock === false) return null;
  // Nunca inicializado: no hay nada que mostrar todavía (no es lo mismo que "en cero").
  if (stock == null) return null;

  if (debeOcultarStock(stock, stockMinimo, isOnline, ultimaSincronizacion)) {
    return (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
        Consultar
      </span>
    );
  }

  const bajo = stockBajo(stock, stockMinimo);
  const texto = esPorPeso
    ? `${stock.toLocaleString('es-VE', { maximumFractionDigits: 2 })} kg`
    : `${Math.round(stock)}`;

  return (
    <span
      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
        bajo
          ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
          : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300'
      }`}
    >
      {texto}
    </span>
  );
}
