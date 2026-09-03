import { Rol, EstadoNegocio } from '@/types';

// Debe coincidir con LIMITE_USUARIOS_POR_NEGOCIO en
// supabase/functions/crear-usuario/index.ts — viven en runtimes distintos
// (Deno vs. Next.js) que no comparten build, así que el valor se mantiene
// sincronizado a mano entre los dos lugares. Este es el único lugar del
// cliente que lo define.
export const LIMITE_USUARIOS_POR_NEGOCIO = 3;

// Único lugar que decide qué pestañas/rutas puede ver cada rol. /usuarios y
// /movimientos no son pestañas de BottomNav (se llega desde el mini perfil
// e Inventario respectivamente), pero sí deben estar acá para que la guía
// de rutas las bloquee a un cajero por URL directa.
const RUTAS_ADMIN = ['/', '/resumen', '/reportes', '/tasa', '/inventario', '/usuarios', '/movimientos', '/fiado'];
const RUTAS_CAJERO = ['/', '/resumen', '/fiado'];

// Con un negocio 'restringido', vender y cerrar caja (Caja, Resumen) y
// fijar la tasa siguen andando — el resto de las pantallas de admin, no.
// La base ya lo bloquea de verdad (RLS); esto solo evita que el admin
// entre a una pantalla que le va a rebotar todo. Fiado (fiar/abonar) es
// parte de vender, no de administrar — sigue disponible igual que Caja.
const RUTAS_OCULTAS_RESTRINGIDO = ['/inventario', '/movimientos', '/reportes'];

export function rutasPermitidas(rol: Rol | null, estado?: EstadoNegocio): string[] {
  const base = rol === 'admin' ? RUTAS_ADMIN : RUTAS_CAJERO;
  if (estado === 'restringido') {
    return base.filter(r => !RUTAS_OCULTAS_RESTRINGIDO.includes(r));
  }
  return base;
}

export function esRutaPermitida(rol: Rol | null, pathname: string, estado?: EstadoNegocio): boolean {
  return rutasPermitidas(rol, estado).includes(pathname);
}
