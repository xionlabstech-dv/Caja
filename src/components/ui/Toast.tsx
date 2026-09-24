'use client';

// Toast (Brief 01). Confirma algo después del hecho — nunca bloquea la
// acción en sí (readme: "un cobro nunca pide confirmación extra; lo que
// confirma es un toast después del hecho"). Fijo a 80px del borde superior,
// centrado en el ancho de la app — regla de layout del readme.
interface ToastProps {
  visible: boolean;
  mensaje: string;
}

export default function Toast({ visible, mensaje }: ToastProps) {
  if (!visible) return null;

  return (
    <div className="fixed top-20 left-0 right-0 z-[60] flex justify-center px-4 pointer-events-none">
      <div className="font-caja bg-toast-fondo text-toast-texto text-sm font-medium rounded-[12px] px-4 py-3 shadow-[0_10px_15px_-3px_rgba(0,0,0,.1)] max-w-lg">
        {mensaje}
      </div>
    </div>
  );
}
