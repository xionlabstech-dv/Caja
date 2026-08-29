'use client';

import { useState } from 'react';

interface SuspendedScreenProps {
  isOnline: boolean;
  onReintentar: () => Promise<void>;
  onSignOut: () => Promise<void>;
}

// Se muestra en vez de toda la app cuando negocios.estado === 'suspendido'.
// El bloqueo real ya está en Supabase (RLS) — esto es solo la explicación:
// un negocio suspendido todavía puede leer su propio perfil/negocio, así
// que hay datos suficientes para mostrar esta pantalla en vez de reventar.
// NUNCA se muestra estado_nota — es una nota interna del proveedor, no un
// mensaje para el cliente.
export default function SuspendedScreen({ isOnline, onReintentar, onSignOut }: SuspendedScreenProps) {
  const [verificando, setVerificando] = useState(false);
  const [noHuboCambio, setNoHuboCambio] = useState(false);

  const reintentar = async () => {
    setVerificando(true);
    setNoHuboCambio(false);
    await onReintentar();
    setVerificando(false);
    // Si seguimos acá después de reintentar, es porque el estado del
    // servidor sigue siendo el mismo (o no se pudo consultar) — avisar en
    // vez de dejar el botón sin dar ninguna señal.
    setNoHuboCambio(true);
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="absolute inset-0 flex flex-col pointer-events-none">
        <div className="h-1/2 bg-gray-700" />
        <div className="h-1/2 bg-gray-50 dark:bg-slate-900" />
      </div>

      <div className="relative z-10 flex flex-col min-h-screen max-w-sm mx-auto">
        <div className="flex-1 flex flex-col items-center justify-end pb-10 pt-16 px-6">
          <div className="w-20 h-20 bg-white/15 rounded-3xl flex items-center justify-center mb-5 shadow-lg">
            <svg className="w-11 h-11 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="text-white text-2xl font-bold text-center">Servicio pausado</h1>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-t-3xl shadow-2xl px-6 pt-8 pb-12">
          <p className="text-gray-700 dark:text-gray-200 text-base leading-relaxed mb-4">
            El acceso a Caja está pausado por un pago pendiente con quien te presta
            el servicio.
          </p>
          <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed mb-6">
            Para volver a usar la app, comunícate con el proveedor de tu servicio de
            Caja y resuelve el pago pendiente. En cuanto quede al día, el acceso se
            restablece solo — no hace falta reinstalar ni volver a iniciar sesión.
          </p>

          {!isOnline && (
            <div className="mb-4 p-3 bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-xl text-gray-500 dark:text-gray-400 text-sm text-center">
              Sin conexión — necesitas internet para confirmar si ya se resolvió
            </div>
          )}

          {noHuboCambio && !verificando && (
            <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-100 dark:border-amber-800 rounded-xl text-amber-700 dark:text-amber-400 text-sm text-center">
              Sigue pausado por ahora. Intenta de nuevo en un momento.
            </div>
          )}

          <button
            onClick={reintentar}
            disabled={verificando || !isOnline}
            className="w-full bg-gray-800 dark:bg-slate-600 text-white py-4 rounded-xl text-base font-bold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {verificando ? 'Verificando...' : 'Reintentar'}
          </button>

          <button
            onClick={onSignOut}
            className="w-full text-gray-400 dark:text-gray-500 text-sm font-medium mt-5"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}
