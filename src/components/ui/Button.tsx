'use client';

import { ButtonHTMLAttributes } from 'react';

// Botón base (Brief 01 — sistema de diseño). Variantes según
// design-system/tokens/colors.css: primario = acción sólida (marca);
// secundario = relleno suave (marca-suave/marca-suave-texto, igual que
// --accion-primaria-suave); destructivo = sólido en --negativo, para
// confirmar algo irreversible dentro de un ConfirmDialog.
//
// Deshabilitado = opacidad 0.4 (nunca gris plano, para seguir viendo qué
// botón es) — regla del readme. Sin hover diseñado: el único feedback de
// presión es el cambio de fondo en :active.
type Variante = 'primario' | 'secundario' | 'destructivo';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  compacto?: boolean;
}

const CLASES_VARIANTE: Record<Variante, string> = {
  primario: 'bg-marca text-texto-invertido active:bg-marca-presion',
  secundario: 'bg-marca-suave text-marca-suave-texto active:brightness-95',
  destructivo: 'bg-negativo text-texto-invertido active:brightness-90',
};

export default function Button({
  variante = 'primario',
  compacto = false,
  className = '',
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled}
      className={[
        'font-caja rounded-[12px] font-semibold text-base transition-colors duration-150',
        'flex items-center justify-center gap-2 px-5',
        compacto ? 'h-11' : 'h-[52px]',
        CLASES_VARIANTE[variante],
        disabled ? 'opacity-40 cursor-not-allowed' : '',
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </button>
  );
}
