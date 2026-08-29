'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useApp } from '@/components/Providers';
import { esRutaPermitida } from './roles';

// Redirige a "/" si el rol actual no tiene acceso a la ruta en la que está
// parado — cubre el caso de un cajero navegando directo por URL a una
// pantalla de admin (Reportes, Tasa, Inventario, Usuarios), ya que ocultar
// la pestaña en BottomNav no impide escribir la URL a mano.
export function useGuardarRuta() {
  const { rol, estado, authLoading } = useApp();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (authLoading) return;
    if (rol === null) return; // perfil aún sin resolver, no redirigir a ciegas
    if (!esRutaPermitida(rol, pathname, estado)) {
      router.replace('/');
    }
  }, [rol, estado, authLoading, pathname, router]);
}
