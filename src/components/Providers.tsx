'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { syncFromSupabase, getConfiguracion } from '@/lib/sync';
import { Configuracion } from '@/types';

interface AppContextType {
  tasa: number;
  setTasa: (tasa: number) => void;
  isOnline: boolean;
  configuracion: Configuracion | null;
}

const AppContext = createContext<AppContextType>({
  tasa: 0,
  setTasa: () => {},
  isOnline: true,
  configuracion: null,
});

export function useApp() {
  return useContext(AppContext);
}

export default function Providers({ children }: { children: ReactNode }) {
  const [tasa, setTasaState] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  const [configuracion, setConfiguracion] = useState<Configuracion | null>(null);

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
    <AppContext.Provider value={{ tasa, setTasa, isOnline, configuracion }}>
      {children}
    </AppContext.Provider>
  );
}
