'use client';

import { createContext, useContext, useState, useEffect, Dispatch, SetStateAction, ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { syncFromSupabase, getConfiguracion } from '@/lib/sync';
import {
  getCachedNegocioId,
  setCachedNegocioId,
  getCachedNegocioNombre,
  setCachedNegocioNombre,
  getCachedRol,
  setCachedRol,
  getCachedUsuarioNombre,
  setCachedUsuarioNombre,
  getCachedUsaCostos,
  setCachedUsaCostos,
  getCachedUsaStock,
  setCachedUsaStock,
  getCachedEstado,
  setCachedEstado,
  getCachedFechaProximoPago,
  setCachedFechaProximoPago,
  getCachedUltimaSincronizacion,
  clearTenantData,
  contarPendientes,
} from '@/lib/db';
import { procesarCola, onFalloPermanente } from '@/lib/outbox';
import { Configuracion, Rol, EstadoNegocio, ItemCarrito } from '@/types';
import LoginScreen from './LoginScreen';
import SuspendedScreen from './SuspendedScreen';

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
  rol: Rol | null;
  userNombre: string;
  // Preferencia del negocio: si lleva control de costos y márgenes de
  // ganancia. Cacheada en IndexedDB (igual que rol) para que la UI que
  // depende de esto (Inventario, Reportes) sepa qué mostrar sin red.
  usaCostos: boolean;
  setUsaCostos: (v: boolean) => void;
  // Preferencia del negocio: si lleva control de inventario (stock). Mismo
  // patrón que usaCostos.
  usaStock: boolean;
  setUsaStock: (v: boolean) => void;
  // Estado de suscripción del negocio y fecha del próximo pago. El bloqueo
  // real ya está en Supabase (RLS + trigger) — esto es solo para que la UI
  // sepa qué explicarle al usuario. Cacheado igual que usaStock; default
  // 'activo' si nunca hubo nada cacheado (ver getCachedEstado en db.ts).
  estado: EstadoNegocio;
  fechaProximoPago: string | null;
  // Última vez que se refrescó el catálogo con éxito desde Supabase (ISO) —
  // null si nunca se ha logrado sincronizar en este dispositivo. La usa la
  // regla de confiabilidad del stock (Parte 5, ver src/lib/stock.ts).
  ultimaSincronizacion: string | null;
  authLoading: boolean;
  signOut: () => Promise<void>;
  pendientesCount: number;
  syncStatus: EstadoSync;
  sincronizarAhora: () => void;
  // Se incrementa cada vez que Providers termina de escribir productos
  // frescos en IndexedDB. Las pantallas que leen productos (Caja,
  // Inventario) dependen de este valor para volver a leer cuando los datos
  // cambian — sin esto, el fetch inicial de esas pantallas puede ganarle la
  // carrera al sync de Providers y quedarse con una lista vacía para
  // siempre (nunca hay un segundo render que la corrija).
  productosVersion: number;
  // Vive acá (no en un useState local de la pantalla de Caja) para que
  // sobreviva a navegar a cualquier otra pantalla y volver — Next.js
  // desmonta el componente de Caja al salir, y un useState local se pierde
  // con él. Nunca se persiste en IndexedDB ni en ningún storage: es
  // memoria de este contexto, nada más — se limpia explícitamente al
  // cerrar sesión (ver signOut) para que un cajero nuevo en el mismo
  // teléfono no herede el carrito del anterior.
  carrito: ItemCarrito[];
  setCarrito: Dispatch<SetStateAction<ItemCarrito[]>>;
  showCarrito: boolean;
  setShowCarrito: Dispatch<SetStateAction<boolean>>;
  // Igual que carrito: vive acá para sobrevivir a la navegación desde
  // /presupuestos hasta Caja. Si no es null, la próxima venta que se
  // confirme en Caja marca ESE presupuesto como convertido — se limpia al
  // confirmar la venta, al vaciar el carrito, o al cerrar sesión.
  presupuestoConvirtiendoId: string | null;
  setPresupuestoConvirtiendoId: Dispatch<SetStateAction<string | null>>;
  // El cliente_nombre del presupuesto que se está convirtiendo (si tenía
  // uno) — no une clientes_fiado con presupuestos, solo le ahorra al
  // cajero escribir de nuevo un nombre que ya se cotizó, precargando el
  // buscador de fiado al elegir cliente. Mismo ciclo de vida que
  // presupuestoConvirtiendoId.
  presupuestoClienteNombre: string | null;
  setPresupuestoClienteNombre: Dispatch<SetStateAction<string | null>>;
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
  rol: null,
  userNombre: '',
  usaCostos: false,
  setUsaCostos: () => {},
  usaStock: false,
  setUsaStock: () => {},
  estado: 'activo',
  fechaProximoPago: null,
  ultimaSincronizacion: null,
  authLoading: true,
  signOut: async () => {},
  pendientesCount: 0,
  syncStatus: 'online',
  sincronizarAhora: () => {},
  productosVersion: 0,
  carrito: [],
  setCarrito: () => {},
  showCarrito: false,
  setShowCarrito: () => {},
  presupuestoConvirtiendoId: null,
  setPresupuestoConvirtiendoId: () => {},
  presupuestoClienteNombre: null,
  setPresupuestoClienteNombre: () => {},
});

export function useApp() {
  return useContext(AppContext);
}

interface PerfilResuelto {
  negocioId: string;
  negocioNombre: string;
  rol: Rol;
  userNombre: string;
  usaCostos: boolean;
  usaStock: boolean;
  estado: EstadoNegocio;
  fechaProximoPago: string | null;
}

async function fetchPerfil(uid: string): Promise<PerfilResuelto | 'desactivado' | null> {
  try {
    const { data: perfil } = await supabase
      .from('perfiles')
      .select('negocio_id, rol, nombre, activo')
      .eq('id', uid)
      .single();

    if (!perfil?.negocio_id) return null;
    if (perfil.activo === false) return 'desactivado';

    const { data: negocio } = await supabase
      .from('negocios')
      .select('nombre, usa_costos, usa_stock, estado, fecha_proximo_pago')
      .eq('id', perfil.negocio_id)
      .single();

    if (!negocio) return null;

    return {
      negocioId: perfil.negocio_id,
      negocioNombre: negocio.nombre,
      rol: (perfil.rol as Rol) ?? 'cajero',
      userNombre: perfil.nombre ?? '',
      usaCostos: negocio.usa_costos ?? false,
      usaStock: negocio.usa_stock ?? false,
      // Default seguro: un negocio sin `estado` (no debería pasar, pero
      // cubre datos viejos o un select parcial) se trata como activo, nunca
      // como restringido/suspendido.
      estado: (negocio.estado as EstadoNegocio) ?? 'activo',
      fechaProximoPago: negocio.fecha_proximo_pago ?? null,
    };
  } catch {
    return null;
  }
}

// Resuelve el perfil del usuario (negocio, rol, nombre). Si no hay red (o
// falla por cualquier otro motivo), cae a lo último cacheado localmente en
// vez de dejar al usuario sin negocio/rol — la sesión offline nunca debe
// bloquear la app. La desactivación de un usuario SÍ requiere red para
// aplicarse (no se puede confiar en un "estaba activo" cacheado para negar
// acceso, pero tampoco para otorgarlo retroactivamente sin conexión).
async function resolverPerfil(uid: string): Promise<PerfilResuelto | 'desactivado' | null> {
  const perfil = await fetchPerfil(uid);
  if (perfil === 'desactivado') return 'desactivado';

  if (perfil) {
    await setCachedNegocioId(perfil.negocioId);
    await setCachedNegocioNombre(perfil.negocioNombre);
    await setCachedRol(perfil.rol);
    await setCachedUsuarioNombre(perfil.userNombre);
    await setCachedUsaCostos(perfil.usaCostos);
    await setCachedUsaStock(perfil.usaStock);
    await setCachedEstado(perfil.estado);
    await setCachedFechaProximoPago(perfil.fechaProximoPago);
    return perfil;
  }

  const cachedId = await getCachedNegocioId();
  if (!cachedId) return null;
  const [cachedNombre, cachedRol, cachedUserNombre, cachedUsaCostos, cachedUsaStock, cachedEstado, cachedFecha] =
    await Promise.all([
      getCachedNegocioNombre(),
      getCachedRol(),
      getCachedUsuarioNombre(),
      getCachedUsaCostos(),
      getCachedUsaStock(),
      getCachedEstado(),
      getCachedFechaProximoPago(),
    ]);
  return {
    negocioId: cachedId,
    negocioNombre: cachedNombre ?? '',
    rol: cachedRol ?? 'cajero',
    userNombre: cachedUserNombre ?? '',
    usaCostos: cachedUsaCostos,
    usaStock: cachedUsaStock,
    estado: cachedEstado,
    fechaProximoPago: cachedFecha,
  };
}

export default function Providers({ children }: { children: ReactNode }) {
  const [tasa, setTasaState] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  const [configuracion, setConfiguracion] = useState<Configuracion | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [user, setUser] = useState<User | null>(null);
  const [negocioId, setNegocioId] = useState<string | null>(null);
  const [negocioNombre, setNegocioNombre] = useState('');
  const [rol, setRol] = useState<Rol | null>(null);
  const [userNombre, setUserNombre] = useState('');
  const [usaCostos, setUsaCostos] = useState(false);
  const [usaStock, setUsaStock] = useState(false);
  // Default seguro: 'activo' hasta que se resuelva el perfil (fetch o
  // cache) — nunca arrancar mostrando restricciones que no corresponden.
  const [estado, setEstado] = useState<EstadoNegocio>('activo');
  const [fechaProximoPago, setFechaProximoPago] = useState<string | null>(null);
  const [ultimaSincronizacion, setUltimaSincronizacion] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [pendientesCount, setPendientesCount] = useState(0);
  const [sincronizando, setSincronizando] = useState(false);
  const [productosVersion, setProductosVersion] = useState(0);
  const [motivoDeslogueo, setMotivoDeslogueo] = useState<string | null>(null);
  // Aviso de versión nueva del Service Worker — nunca dispara una recarga
  // sola, solo lo pide al usuario (recargar solo podría tumbar una venta a
  // medio armar).
  const [updateDisponible, setUpdateDisponible] = useState(false);
  // Carrito de la pantalla de Caja — ver comentario en AppContextType.
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const [showCarrito, setShowCarrito] = useState(false);
  const [presupuestoConvirtiendoId, setPresupuestoConvirtiendoId] = useState<string | null>(null);
  const [presupuestoClienteNombre, setPresupuestoClienteNombre] = useState<string | null>(null);
  // Aviso de un cambio que el servidor rechazó de forma definitiva (no un
  // problema de red) y que la cola sacó de reintentar — ver onFalloPermanente
  // en outbox.ts. Global (no de una pantalla puntual) porque procesarCola()
  // puede correr con el usuario parado en cualquier lado.
  const [avisoFalloPermanente, setAvisoFalloPermanente] = useState<string | null>(null);

  useEffect(() => onFalloPermanente(mensaje => setAvisoFalloPermanente(mensaje)), []);

  useEffect(() => {
    const saved = localStorage.getItem('theme') as 'light' | 'dark' | null;
    if (saved) setTheme(saved);
  }, []);

  // Registro manual del Service Worker: next-pwa@5.6.0 inyecta su script de
  // auto-registro en el entry 'main.js' (Pages Router), pero el App Router de
  // Next.js sirve 'main-app.js' — ese registro nunca llega a ejecutarse.
  // sw.js se genera correctamente (next-pwa maneja bien esa parte), solo falta
  // registrarlo nosotros mismos para que el precache offline funcione.
  //
  // skipWaiting:true (next.config.js) hace que un SW nuevo se active solo,
  // sin esperar a que se cierren las pestañas viejas — pero la página ya
  // abierta sigue corriendo el JS viejo hasta que alguien la recarga. Un
  // cliente con la PWA instalada puede quedarse así días, porque nunca
  // cierra la app del todo. Detectamos cuándo hay una versión nueva lista y
  // avisamos — nunca recargamos solos, eso podría tumbar una venta a medio
  // armar.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').then(registration => {
      // Ya había un SW controlando esta pestaña cuando se registró, y ya
      // hay uno nuevo esperando: es una actualización, no la primera visita.
      if (registration.waiting && navigator.serviceWorker.controller) {
        setUpdateDisponible(true);
      }
      registration.addEventListener('updatefound', () => {
        const nuevo = registration.installing;
        if (!nuevo) return;
        nuevo.addEventListener('statechange', () => {
          if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
            setUpdateDisponible(true);
          }
        });
      });
    }).catch(() => {});
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
    setRol(null);
    setUserNombre('');
    setUsaCostos(false);
    setUsaStock(false);
    setEstado('activo');
    setFechaProximoPago(null);
    setTasaState(0);
    setConfiguracion(null);
    setPendientesCount(0);
    setCarrito([]);
    setShowCarrito(false);
    setPresupuestoConvirtiendoId(null);
    setPresupuestoClienteNombre(null);
  };

  // Auth: revisa la sesión al montar y escucha cambios. La sesión NUNCA se
  // limpia por falta de red — solo un SIGNED_OUT explícito (logout manual,
  // usuario desactivado, o token realmente inválido) borra el usuario. Un
  // fallo de refresh por falta de conexión debe dejar al usuario trabajando
  // con la sesión local.
  useEffect(() => {
    // Usuario desactivado por un admin: cerrar sesión ya mismo. Solo puede
    // detectarse con red (fetchPerfil trajo el perfil fresco y activo=false);
    // sin conexión, resolverPerfil cae al cache y nunca llega a este caso.
    const forzarDeslogueoPorInactivo = async () => {
      await supabase.auth.signOut();
      await clearTenantData();
      setUser(null);
      setNegocioId(null);
      setNegocioNombre('');
      setRol(null);
      setUserNombre('');
      setUsaCostos(false);
      setUsaStock(false);
      setEstado('activo');
      setFechaProximoPago(null);
      setCarrito([]);
      setShowCarrito(false);
      setPresupuestoConvirtiendoId(null);
      setPresupuestoClienteNombre(null);
      setMotivoDeslogueo('Tu usuario fue desactivado. Contacta al administrador de tu negocio.');
    };

    const aplicarPerfil = async (u: User) => {
      setUser(u);
      const perfil = await resolverPerfil(u.id);
      if (perfil === 'desactivado') {
        await forzarDeslogueoPorInactivo();
        return;
      }
      if (perfil) {
        setNegocioId(perfil.negocioId);
        setNegocioNombre(perfil.negocioNombre);
        setRol(perfil.rol);
        setUserNombre(perfil.userNombre);
        setUsaCostos(perfil.usaCostos);
        setUsaStock(perfil.usaStock);
        setEstado(perfil.estado);
        setFechaProximoPago(perfil.fechaProximoPago);
      }
    };

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        await aplicarPerfil(session.user);
      }
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        await aplicarPerfil(session.user);
      } else if (_event === 'SIGNED_OUT') {
        setUser(null);
        setNegocioId(null);
        setNegocioNombre('');
        setRol(null);
        setUserNombre('');
        setUsaCostos(false);
        setUsaStock(false);
        setEstado('activo');
        setFechaProximoPago(null);
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
      // syncFromSupabase ya escribió productos en IndexedDB para este punto
      // (con o sin config): avisar a quien esté leyendo productos que hay
      // datos nuevos que releer.
      setProductosVersion(v => v + 1);
      // syncFromSupabase actualiza esta marca en IndexedDB al refrescar el
      // catálogo con éxito — se relee acá para que el estado de React (del
      // que depende la regla "Consultar" de stock) quede al día.
      const ultima = await getCachedUltimaSincronizacion();
      if (ultima) setUltimaSincronizacion(ultima);
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
        setCarrito([]);
        setShowCarrito(false);
        setPresupuestoConvirtiendoId(null);
        setPresupuestoClienteNombre(null);
      }
      await setCachedNegocioId(id);

      const localConfig = await getConfiguracion();
      if (localConfig) {
        setTasaState(localConfig.tasa);
        setConfiguracion(localConfig);
      }

      // Se lee de una vez al arrancar (incluso offline) para que la regla
      // "Consultar" de stock sepa desde el primer render cuán vieja es la
      // última sincronización real, sin esperar a un sync nuevo.
      const ultima = await getCachedUltimaSincronizacion();
      if (ultima) setUltimaSincronizacion(ultima);

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
        const ultima = await getCachedUltimaSincronizacion();
        if (ultima) setUltimaSincronizacion(ultima);
        setSincronizando(false);
      });
  };

  const syncStatus: EstadoSync = !isOnline ? 'offline' : sincronizando ? 'syncing' : 'online';

  // Revalida el estado de suscripción contra el servidor — lo usa el botón
  // "Reintentar" de la pantalla de suspendido. No fuerza cierre de sesión
  // ni nada más: si no hay red o el perfil no resuelve, simplemente no hay
  // nada nuevo que aplicar todavía.
  const revalidarEstado = async () => {
    if (!user) return;
    const perfil = await fetchPerfil(user.id);
    if (perfil && perfil !== 'desactivado') {
      setEstado(perfil.estado);
      setFechaProximoPago(perfil.fechaProximoPago);
      await setCachedEstado(perfil.estado);
      await setCachedFechaProximoPago(perfil.fechaProximoPago);
    }
  };

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
    return (
      <LoginScreen
        mensajeInicial={motivoDeslogueo}
        onMensajeVisto={() => setMotivoDeslogueo(null)}
      />
    );
  }

  return (
    <AppContext.Provider value={{
      tasa, setTasa, isOnline, configuracion, theme, toggleTheme,
      user, negocioId, negocioNombre, rol, userNombre, usaCostos, setUsaCostos,
      usaStock, setUsaStock, estado, fechaProximoPago, ultimaSincronizacion, authLoading, signOut,
      pendientesCount, syncStatus, sincronizarAhora, productosVersion,
      carrito, setCarrito, showCarrito, setShowCarrito,
      presupuestoConvirtiendoId, setPresupuestoConvirtiendoId,
      presupuestoClienteNombre, setPresupuestoClienteNombre,
    }}>
      {estado === 'suspendido'
        ? <SuspendedScreen isOnline={isOnline} onReintentar={revalidarEstado} onSignOut={signOut} />
        : children}
      {updateDisponible && (
        <button
          onClick={() => window.location.reload()}
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-xs font-medium pl-3 pr-4 py-2.5 rounded-full shadow-lg flex items-center gap-2"
        >
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Hay una versión nueva — toca para actualizar
        </button>
      )}
      {avisoFalloPermanente && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-sm bg-red-600 text-white text-xs font-medium px-4 py-3 rounded-xl shadow-lg flex items-start gap-2">
          <span className="flex-1">{avisoFalloPermanente}</span>
          <button
            onClick={() => setAvisoFalloPermanente(null)}
            className="flex-shrink-0"
            aria-label="Cerrar aviso"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </AppContext.Provider>
  );
}
