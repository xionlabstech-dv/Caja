'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { conCandado } from '@/lib/sync';
import Icon from '@/components/ui/Icon';

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
  const [mostrarPassword, setMostrarPassword] = useState(false);
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

    // Candado: si el teléfono cree tener señal pero no llega a internet de
    // verdad, signInWithPassword() puede quedarse esperando sin límite.
    const resultado = await conCandado(supabase.auth.signInWithPassword({ email, password }));

    if (resultado === 'candado') {
      setError('No se pudo confirmar, verifica tu conexión e intenta de nuevo');
      setLoading(false);
      return;
    }

    if (resultado.error) {
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
        <div className="h-[58%] bg-marca" />
        <div className="h-[42%] bg-gray-50 dark:bg-slate-900" />
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
          <p className="text-texto-invertido text-sm mt-2">Sistema de punto de venta</p>
        </div>

        {/* Form card */}
        <div className="relative">
          <svg
            className="absolute -top-16 left-0 w-full h-16 text-tarjeta"
            viewBox="0 0 400 64"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path d="M0,64 C100,0 300,0 400,64 L400,64 L0,64 Z" fill="currentColor" />
          </svg>
          <div className="relative bg-tarjeta rounded-t-3xl shadow-2xl px-6 pt-8 pb-12">
            <h2 className="text-xl font-bold text-texto mb-6">
              Iniciar sesión
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-texto-2 mb-1.5">
                  Usuario
                </label>
                <div className="relative">
                  <Icon nombre="campoUsuario" tamano={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-texto-4 pointer-events-none" />
                  <input
                    type="text"
                    value={usuario}
                    onChange={e => { setUsuario(e.target.value); setError(''); }}
                    autoCapitalize="none"
                    autoCorrect="off"
                    autoComplete="username"
                    placeholder="Tu usuario"
                    className="w-full border border-borde-campo rounded-xl pl-11 pr-4 py-3 text-base bg-tarjeta text-texto placeholder:text-texto-4 focus:outline-none focus:border-foco"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-texto-2 mb-1.5">
                  Contraseña
                </label>
                <div className="relative">
                  <Icon nombre="candado" tamano={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-texto-4 pointer-events-none" />
                  <input
                    type={mostrarPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError(''); }}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="w-full border border-borde-campo rounded-xl pl-11 pr-11 py-3 text-base bg-tarjeta text-texto placeholder:text-texto-4 focus:outline-none focus:border-foco"
                  />
                  <button
                    type="button"
                    onClick={() => setMostrarPassword(v => !v)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-texto-4"
                    aria-label={mostrarPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    <Icon nombre={mostrarPassword ? 'ocultarPassword' : 'mostrarPassword'} tamano={18} />
                  </button>
                </div>
              </div>

              {error && (
                <div className="p-3 bg-negativo-fondo border border-negativo-borde rounded-xl text-negativo text-sm text-center">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !usuario.trim() || !password}
                className="w-full bg-marca active:bg-marca-presion text-texto-invertido py-4 rounded-xl text-base font-bold transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed mt-2"
              >
                {loading ? 'Ingresando...' : 'Ingresar'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
