'use client';

import { ReactNode } from 'react';
import Button from './Button';

// Diálogo de confirmación (Brief 01). Solo para lo irreversible — regla del
// readme ("Esta acción no se puede deshacer"). Centrado, a diferencia de la
// hoja inferior: todo lo demás interrumpe entrando por abajo, esto no.
interface ConfirmDialogProps {
  abierto: boolean;
  titulo: string;
  mensaje?: ReactNode;
  textoConfirmar?: string;
  textoCancelar?: string;
  varianteConfirmar?: 'primario' | 'destructivo';
  cargando?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}

export default function ConfirmDialog({
  abierto,
  titulo,
  mensaje,
  textoConfirmar = 'Confirmar',
  textoCancelar = 'Cancelar',
  varianteConfirmar = 'primario',
  cargando = false,
  onConfirmar,
  onCancelar,
}: ConfirmDialogProps) {
  if (!abierto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-overlay" onClick={onCancelar} />
      <div className="font-caja relative bg-tarjeta rounded-[16px] w-full max-w-sm shadow-[0_20px_25px_-5px_rgba(0,0,0,.1),0_8px_10px_-6px_rgba(0,0,0,.1)] p-5">
        <h2 className="text-lg font-bold text-texto mb-2">{titulo}</h2>
        {mensaje && <p className="text-sm text-texto-3 mb-5">{mensaje}</p>}
        <div className="flex gap-3">
          <Button variante="secundario" onClick={onCancelar} disabled={cargando} className="flex-1">
            {textoCancelar}
          </Button>
          <Button variante={varianteConfirmar} onClick={onConfirmar} disabled={cargando} className="flex-1">
            {cargando ? 'Guardando...' : textoConfirmar}
          </Button>
        </div>
      </div>
    </div>
  );
}
