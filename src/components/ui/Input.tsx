'use client';

import { InputHTMLAttributes, forwardRef } from 'react';

// Campo de texto base (Brief 01 — sistema de diseño). Radio 12px
// (--radio-campo), borde --borde-campo, foco = borde verde --verde-400
// (readme: "Foco de campo = borde verde, sin anillo exterior").
interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, className = '', id, ...props },
  ref
) {
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={id} className="font-caja block text-sm text-texto-3 mb-1.5">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={id}
        className={[
          'font-caja w-full rounded-[12px] border bg-tarjeta text-texto text-base px-4 py-3',
          'placeholder:text-texto-4 outline-none transition-colors duration-150',
          error ? 'border-negativo' : 'border-borde-campo focus:border-foco',
          className,
        ].join(' ')}
        {...props}
      />
      {error && <p className="font-caja text-sm text-negativo mt-1">{error}</p>}
    </div>
  );
});

export default Input;
