'use client';

import { ReactNode } from 'react';

// Tarjeta tinta — el dato protagonista de la pantalla (Brief 01). Fondo
// #0C1A14 fijo en claro y oscuro (resolución del Paso 0: no es
// --superficie-contraste de colors.css, que cambiaba entre modos).
// Un número protagonista por pantalla — regla del readme.
interface TarjetaTintaProps {
  etiqueta?: string;
  valor: ReactNode;
  referencia?: ReactNode;
  tamano?: 'grande' | 'xl';
  cifra?: boolean;
  className?: string;
}

export default function TarjetaTinta({
  etiqueta,
  valor,
  referencia,
  tamano = 'grande',
  cifra = true,
  className = '',
}: TarjetaTintaProps) {
  return (
    <div
      className={['font-caja bg-tinta text-tinta-texto rounded-[16px] p-5', className].join(' ')}
    >
      {etiqueta && (
        <p className="text-tinta-etiqueta text-xs font-semibold uppercase tracking-[0.06em] mb-1">
          {etiqueta}
        </p>
      )}
      <p
        className={[
          'font-bold tracking-[-0.02em] leading-[1.1]',
          tamano === 'xl' ? 'text-[48px]' : 'text-[36px]',
          cifra ? 'cifra' : '',
        ].join(' ')}
      >
        {valor}
      </p>
      {referencia && <p className="text-[rgba(255,255,255,.7)] text-sm mt-1">{referencia}</p>}
    </div>
  );
}
