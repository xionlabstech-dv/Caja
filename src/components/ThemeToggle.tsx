'use client';

import { useApp } from './Providers';
import Icon from '@/components/ui/Icon';
import { TAMANO_ICONO } from '@/components/ui/iconos';

interface ThemeToggleProps {
  // 'verde': header emerald-600 de siempre (default — no rompe las pantallas
  // que todavía no se migraron al header neutro). 'neutro': header
  // bg-superficie-barra de /datos-negocio, /perfil, /usuarios — un ícono
  // blanco fijo ahí desaparece en modo claro (--superficie-barra es casi
  // blanco), así que necesita colores de token en vez del blanco fijo. No
  // se puede compartir un solo color entre los dos: contra emerald-600,
  // texto-3/texto no dan el contraste mínimo (~1.3:1, hace falta 3:1).
  variant?: 'verde' | 'neutro';
}

export default function ThemeToggle({ variant = 'verde' }: ThemeToggleProps) {
  const { theme, toggleTheme } = useApp();
  const colores = variant === 'neutro'
    ? 'text-texto-3 hover:text-texto hover:bg-tarjeta-hundida'
    : 'text-white/80 hover:text-white hover:bg-white/10';
  return (
    <button
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      className={`p-2 rounded-xl transition-colors ${colores}`}
    >
      {theme === 'dark' ? (
        <Icon nombre="modoClaro" tamano={TAMANO_ICONO.buscarYToggle} />
      ) : (
        <Icon nombre="modoOscuro" tamano={TAMANO_ICONO.buscarYToggle} />
      )}
    </button>
  );
}
