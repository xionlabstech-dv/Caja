import { Rol } from '@/types';

// Debe coincidir con LIMITE_USUARIOS_POR_NEGOCIO en
// supabase/functions/crear-usuario/index.ts — viven en runtimes distintos
// (Deno vs. Next.js) que no comparten build, así que el valor se mantiene
// sincronizado a mano entre los dos lugares. Este es el único lugar del
// cliente que lo define.
export const LIMITE_USUARIOS_POR_NEGOCIO = 3;

// Único lugar que decide qué pestañas/rutas puede ver cada rol. /usuarios no
// es una pestaña de BottomNav (se llega desde el mini perfil), pero sí debe
// estar acá para que la guía de rutas la bloquee a un cajero por URL directa.
const RUTAS_ADMIN = ['/', '/resumen', '/reportes', '/tasa', '/inventario', '/usuarios'];
const RUTAS_CAJERO = ['/', '/resumen'];

export function rutasPermitidas(rol: Rol | null): string[] {
  return rol === 'admin' ? RUTAS_ADMIN : RUTAS_CAJERO;
}

export function esRutaPermitida(rol: Rol | null, pathname: string): boolean {
  return rutasPermitidas(rol).includes(pathname);
}
