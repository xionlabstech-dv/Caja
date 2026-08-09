'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { syncFromSupabase, getConfiguracion } from '@/lib/sync';
import {
  getCachedNegocioId,
  setCachedNegocioId,
  getCachedNegocioNombre,
  setCachedNegocioNombre,
  clearTenantData,
  contarPendientes,
} from '@/lib/db';
import { procesarCola } from '@/lib/outbox';
import { Configuracion } from '@/types';
import LoginScreen from './LoginScreen';

type EstadoSync = 'online' | 'offline' | 'syncing';

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
  pendientesCount: number;
  syncStatus: EstadoSync;
  sincronizarAhora: () => void;
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
  pendientesCount: 0,
  syncStatus: 'online',
  sincronizarAhora: () => {},
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

// Resuelve el negocio del usuario. Si no hay red (o falla por cualquier otro
// motivo), cae al último negocio cacheado localmente en vez de dejar al
// usuario sin negocio — la sesión offline nunca debe bloquear la app.
async function resolverNegocio(uid: string): Promise<{ negocioId: string; negocioNombre: string } | null> {
  let negocio = await fetchNegocio(uid);
  if (!negocio) {
    const cachedId = await getCachedNegocioId();
    if (cachedId) {
      const cachedNombre = await getCachedNegocioNombre();
      negocio = { negocioId: cachedId, negocioNombre: cachedNombre ?? '' };
    }
  }
  if (negocio) {
    await setCachedNegocioId(negocio.negocioId);
    await setCachedNegocioNombre(negocio.negocioNombre);
  }
  return negocio;
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
  const [pendientesCount, setPendientesCount] = useState(0);
  const [sincronizando, setSincronizando] = useState(false);

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
    const pendientes = await contarPendientes();
    if (pendientes > 0) {
      const confirmar = window.confirm(
        `Tienes ${pendientes} cambio${pendientes === 1 ? '' : 's'} sin sincronizar. ` +
        'Si cierras sesión ahora se perderán. ¿Cerrar sesión de todas formas?'
      );
      if (!confirmar) return;
    }
    await supabase.auth.signOut();
    await clearTenantData();
    setUser(null);
    setNegocioId(null);
    setNegocioNombre('');
    setTasaState(0);
    setConfiguracion(null);
    setPendientesCount(0);
  };

  // Auth: revisa la sesión al montar y escucha cambios. La sesión NUNCA se
  // limpia por falta de red — solo un SIGNED_OUT explícito (logout manual o
  // token realmente inválido) borra el usuario. Un fallo de refresh por falta
  // de conexión debe dejar al usuario trabajando con la sesión local.
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        const negocio = await resolverNegocio(session.user.id);
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
        const negocio = await resolverNegocio(session.user.id);
        if (negocio) {
          setNegocioId(negocio.negocioId);
          setNegocioNombre(negocio.negocioNombre);
        }
      } else if (_event === 'SIGNED_OUT') {
        setUser(null);
        setNegocioId(null);
        setNegocioNombre('');
      }
      // Otros eventos con session null (ej. refresh fallido sin red) se
      // ignoran a propósito: mantenemos la sesión local intacta.
    });

    return () => subscription.unsubscribe();
  }, []);

  // Data sync: only runs when user is authenticated and negocioId is known
  useEffect(() => {
    if (!user || !negocioId) return;
    const id: string = negocioId;

    setIsOnline(navigator.onLine);

    const refrescarConfig = async () => {
      const config = await syncFromSupabase(id);
      if (config) {
        setTasaState(config.tasa);
        setConfiguracion(config);
      }
    };

    // Procesa la cola de pendientes y refresca desde Supabase para reconciliar.
    const sincronizar = async () => {
      if (!navigator.onLine) return;
      setSincronizando(true);
      try {
        await procesarCola();
        await refrescarConfig();
      } finally {
        setPendientesCount(await contarPendientes());
        setSincronizando(false);
      }
    };

    const handleOnline = async () => {
      setIsOnline(true);
      await sincronizar();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Red de seguridad: reintenta la cola cada 30s mientras haya conexión,
    // por si un fallo puntual (no un simple "sin red") dejó algo atascado.
    const interval = setInterval(() => {
      if (navigator.onLine) sincronizar();
    }, 30000);

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

      setPendientesCount(await contarPendientes());

      if (navigator.onLine) {
        await sincronizar();
      }
    }

    init();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [user, negocioId]);

  const setTasa = (newTasa: number) => setTasaState(newTasa);

  const sincronizarAhora = () => {
    if (!negocioId || !navigator.onLine) return;
    setSincronizando(true);
    procesarCola()
      .then(() => syncFromSupabase(negocioId))
      .then(config => {
        if (config) {
          setTasaState(config.tasa);
          setConfiguracion(config);
        }
      })
      .finally(async () => {
        setPendientesCount(await contarPendientes());
        setSincronizando(false);
      });
  };

  const syncStatus: EstadoSync = !isOnline ? 'offline' : sincronizando ? 'syncing' : 'online';

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
      pendientesCount, syncStatus, sincronizarAhora,
    }}>
      {children}
    </AppContext.Provider>
  );
}
