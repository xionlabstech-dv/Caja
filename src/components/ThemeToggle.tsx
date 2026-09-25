'use client';

import { useApp } from './Providers';

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
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 7a5 5 0 100 10 5 5 0 000-10z"
          />
        </svg>
      ) : (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
          />
        </svg>
      )}
    </button>
  );
}
