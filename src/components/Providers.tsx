'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { syncFromSupabase, getConfiguracion } from '@/lib/sync';
import { Configuracion } from '@/types';

interface AppContextType {
  tasa: number;
  setTasa: (tasa: number) => void;
  isOnline: boolean;
  configuracion: Configuracion | null;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

const AppContext = createContext<AppContextType>({
  tasa: 0,
  setTasa: () => {},
  isOnline: true,
  configuracion: null,
  theme: 'light',
  toggleTheme: () => {},
});

export function useApp() {
  return useContext(AppContext);
}

export default function Providers({ children }: { children: ReactNode }) {
  const [tasa, setTasaState] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  const [configuracion, setConfiguracion] = useState<Configuracion | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const saved = localStorage.getItem('theme') as 'light' | 'dark' | null;
    if (saved) setTheme(saved);
  }, []);

  const toggleTheme = () => {
    setTheme(prev => {
      const next = prev === 'light' ? 'dark' : 'light';
      localStorage.setItem('theme', next);
      document.documentElement.classList.toggle('dark', next === 'dark');
      return next;
    });
  };

  useEffect(() => {
    setIsOnline(navigator.onLine);

    const handleOnline = async () => {
      setIsOnline(true);
      const config = await syncFromSupabase();
      if (config) {
        setTasaState(config.tasa);
        setConfiguracion(config);
      }
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    async function init() {
      const localConfig = await getConfiguracion();
      if (localConfig) {
        setTasaState(localConfig.tasa);
        setConfiguracion(localConfig);
      }

      if (navigator.onLine) {
        const remoteConfig = await syncFromSupabase();
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
  }, []);

  const setTasa = (newTasa: number) => {
    setTasaState(newTasa);
  };

  return (
    <AppContext.Provider value={{ tasa, setTasa, isOnline, configuracion, theme, toggleTheme }}>
      {children}
    </AppContext.Provider>
  );
}
