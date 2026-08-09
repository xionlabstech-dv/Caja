'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { syncFromSupabase, getConfiguracion } from '@/lib/sync';
import { getCachedNegocioId, setCachedNegocioId, clearTenantData } from '@/lib/db';
import { Configuracion } from '@/types';
import LoginScreen from './LoginScreen';

interface AppContextType {
  tasa: number;
  setTasa: (tasa: number) => void;
  isOnline: boolean;
  configuracion: Configuracion | null;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  user: User | null;
  negocioId: string | null;
  negocioNombre: string;
  authLoading: boolean;
  signOut: () => Promise<void>;
}

const AppContext = createContext<AppContextType>({
  tasa: 0,
  setTasa: () => {},
  isOnline: true,
  configuracion: null,
  theme: 'light',
  toggleTheme: () => {},
  user: null,
  negocioId: null,
  negocioNombre: '',
  authLoading: true,
  signOut: async () => {},
});

export function useApp() {
  return useContext(AppContext);
}

async function fetchNegocio(uid: string): Promise<{ negocioId: string; negocioNombre: string } | null> {
  try {
    const { data: perfil } = await supabase
      .from('perfiles')
      .select('negocio_id')
      .eq('id', uid)
      .single();

    if (!perfil?.negocio_id) return null;

    const { data: negocio } = await supabase
      .from('negocios')
      .select('nombre')
      .eq('id', perfil.negocio_id)
      .single();

    if (!negocio) return null;

    return { negocioId: perfil.negocio_id, negocioNombre: negocio.nombre };
  } catch {
    return null;
  }
}

export default function Providers({ children }: { children: ReactNode }) {
  const [tasa, setTasaState] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  const [configuracion, setConfiguracion] = useState<Configuracion | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [user, setUser] = useState<User | null>(null);
  const [negocioId, setNegocioId] = useState<string | null>(null);
  const [negocioNombre, setNegocioNombre] = useState('');
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem('theme') as 'light' | 'dark' | null;
    if (saved) setTheme(saved);
  }, []);

  // Registro manual del Service Worker: next-pwa@5.6.0 inyecta su script de
  // auto-registro en el entry 'main.js' (Pages Router), pero el App Router de
  // Next.js sirve 'main-app.js' — ese registro nunca llega a ejecutarse.
  // sw.js se genera correctamente (next-pwa maneja bien esa parte), solo falta
  // registrarlo nosotros mismos para que el precache offline funcione.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  const toggleTheme = () => {
    setTheme(prev => {
      const next = prev === 'light' ? 'dark' : 'light';
      localStorage.setItem('theme', next);
      document.documentElement.classList.toggle('dark', next === 'dark');
      return next;
    });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    await clearTenantData();
    setUser(null);
    setNegocioId(null);
    setNegocioNombre('');
    setTasaState(0);
    setConfiguracion(null);
  };

  // Auth: check session on mount and listen for changes
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        const negocio = await fetchNegocio(session.user.id);
        if (negocio) {
          setNegocioId(negocio.negocioId);
          setNegocioNombre(negocio.negocioNombre);
        }
      }
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        setUser(session.user);
        const negocio = await fetchNegocio(session.user.id);
        if (negocio) {
          setNegocioId(negocio.negocioId);
          setNegocioNombre(negocio.negocioNombre);
        }
      } else {
        setUser(null);
        setNegocioId(null);
        setNegocioNombre('');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Data sync: only runs when user is authenticated and negocioId is known
  useEffect(() => {
    if (!user || !negocioId) return;
    const id: string = negocioId;

    setIsOnline(navigator.onLine);

    const handleOnline = async () => {
      setIsOnline(true);
      const config = await syncFromSupabase(id);
      if (config) {
        setTasaState(config.tasa);
        setConfiguracion(config);
      }
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    async function init() {
      const cachedNegocioId = await getCachedNegocioId();
      if (cachedNegocioId !== null && cachedNegocioId !== id) {
        await clearTenantData();
      }
      await setCachedNegocioId(id);

      const localConfig = await getConfiguracion();
      if (localConfig) {
        setTasaState(localConfig.tasa);
        setConfiguracion(localConfig);
      }

      if (navigator.onLine) {
        const remoteConfig = await syncFromSupabase(id);
        if (remoteConfig) {
          setTasaState(remoteConfig.tasa);
          setConfiguracion(remoteConfig);
        }
      }
    }

    init();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [user, negocioId]);

  const setTasa = (newTasa: number) => setTasaState(newTasa);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-emerald-600 flex items-center justify-center">
        <div className="text-white text-center">
          <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-9 h-9 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <p className="text-2xl font-bold">Caja</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <AppContext.Provider value={{
      tasa, setTasa, isOnline, configuracion, theme, toggleTheme,
      user, negocioId, negocioNombre, authLoading, signOut,
    }}>
      {children}
    </AppContext.Provider>
  );
}
