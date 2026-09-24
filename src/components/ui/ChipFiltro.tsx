'use client';

import { ButtonHTMLAttributes } from 'react';

// Chip de filtro (Brief 01). Cápsula completa (--radio-chip: 9999px).
// Seleccionado = relleno verde sólido con texto blanco — regla del readme.
interface ChipFiltroProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  activo?: boolean;
}

export default function ChipFiltro({ activo = false, className = '', children, ...props }: ChipFiltroProps) {
  return (
    <button
      type="button"
      className={[
        'font-caja rounded-full text-sm font-medium px-4 h-9 transition-colors duration-150 whitespace-nowrap',
        activo ? 'bg-marca text-texto-invertido' : 'bg-tarjeta-hundida text-texto-2',
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </button>
  );
}
