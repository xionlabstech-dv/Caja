'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface LoginScreenProps {
  // Mensaje a mostrar de entrada (ej. "tu usuario fue desactivado") — viene
  // de Providers, que renderiza LoginScreen fuera de su propio contexto, así
  // que no puede leerse vía useApp().
  mensajeInicial?: string | null;
  onMensajeVisto?: () => void;
}

export default function LoginScreen({ mensajeInicial, onMensajeVisto }: LoginScreenProps) {
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(mensajeInicial ?? '');

  useEffect(() => {
    if (mensajeInicial) onMensajeVisto?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const u = usuario.trim();
    if (!u || !password) return;

    setLoading(true);
    setError('');

    // El primer login SIEMPRE requiere red (necesita validar contra Supabase).
    // Distinguir esto de "credenciales incorrectas" evita que un corte de luz
    // se confunda con un usuario/contraseña mal escritos.
    if (!navigator.onLine) {
      setError('Sin conexión — necesitas internet para iniciar sesión por primera vez');
      setLoading(false);
      return;
    }

    let email = u.toLowerCase();
    if (!email.includes('@')) email += '@caja.app';

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      if (!navigator.onLine) {
        setError('Sin conexión — necesitas internet para iniciar sesión por primera vez');
      } else {
        setError('Usuario o contraseña incorrectos');
      }
    }
    // On success, onAuthStateChange in Providers handles the rest

    setLoading(false);
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Split background */}
      <div className="absolute inset-0 flex flex-col pointer-events-none">
        <div className="h-1/2 bg-emerald-600" />
        <div className="h-1/2 bg-gray-50 dark:bg-slate-900" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col min-h-screen max-w-sm mx-auto">
        {/* Logo area */}
        <div className="flex-1 flex flex-col items-center justify-end pb-10 pt-16 px-6">
          <div className="w-20 h-20 bg-white/15 rounded-3xl flex items-center justify-center mb-5 shadow-lg">
            <svg className="w-11 h-11 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <h1 className="text-white text-5xl font-bold tracking-tight">Caja</h1>
          <p className="text-emerald-200 text-sm mt-2">Sistema de punto de venta</p>
        </div>

        {/* Form card */}
        <div className="bg-white dark:bg-slate-800 rounded-t-3xl shadow-2xl px-6 pt-8 pb-12">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">
            Iniciar sesión
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Usuario
              </label>
              <input
                type="text"
                value={usuario}
                onChange={e => { setUsuario(e.target.value); setError(''); }}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                placeholder="Tu usuario"
                className="w-full border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-3 text-base bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-emerald-400"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Contraseña
              </label>
              <input
                type="password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-3 text-base bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-emerald-400"
              />
            </div>

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-100 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 text-sm text-center">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !usuario.trim() || !password}
              className="w-full bg-emerald-600 text-white py-4 rounded-xl text-base font-bold disabled:opacity-40 disabled:cursor-not-allowed mt-2"
            >
              {loading ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
