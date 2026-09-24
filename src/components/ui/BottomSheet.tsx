'use client';

import { ReactNode } from 'react';
import Icon from './Icon';
import { TAMANO_ICONO } from './iconos';

// Hoja inferior (Brief 01). Todo lo que interrumpe entra por abajo — regla
// del readme. Velo negro al 40% (--overlay), radio superior 16px
// (--radio-hoja), sombra --sombra-hoja, entra con la animación
// caja-hoja-entra (220ms, motion.css).
interface BottomSheetProps {
  abierto: boolean;
  onCerrar: () => void;
  titulo?: string;
  children: ReactNode;
}

export default function BottomSheet({ abierto, onCerrar, titulo, children }: BottomSheetProps) {
  if (!abierto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <div className="absolute inset-0 bg-overlay" onClick={onCerrar} />
      <div
        className={[
          'font-caja relative w-full max-w-lg mx-auto bg-tarjeta rounded-t-[16px]',
          'max-h-[90vh] overflow-y-auto safe-area-bottom',
          'shadow-[0_-8px_24px_rgba(0,0,0,.12)] caja-hoja-entra',
        ].join(' ')}
      >
        <div className="flex items-center justify-center pt-3 pb-1">
          <div className="w-8 h-1 bg-tarjeta-hundida rounded-full" />
        </div>
        <button
          onClick={onCerrar}
          aria-label="Cerrar"
          className="absolute right-4 top-4 p-1 text-texto-4"
        >
          <Icon nombre="cerrar" tamano={TAMANO_ICONO.secundario} />
        </button>
        {titulo && <h2 className="text-lg font-semibold text-texto px-5 pt-2 pb-3">{titulo}</h2>}
        <div className="px-5 pb-6">{children}</div>
      </div>
    </div>
  );
}
