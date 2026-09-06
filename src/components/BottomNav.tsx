'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from './Providers';
import { rutasPermitidas } from '@/lib/roles';

// Solo lo que se usa constante, varias veces por hora, vive en la barra.
// El resto (Reportes, Tasa, Inventario, Presupuestos) se accede desde
// "Más" — con Presupuestos la barra hubiera llegado a 7 pestañas.
const tabs = [
  {
    href: '/',
    label: 'Caja',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
        />
      </svg>
    ),
  },
  {
    href: '/resumen',
    label: 'Resumen',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
        />
      </svg>
    ),
  },
  {
    href: '/fiado',
    label: 'Fiado',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a4 4 0 10-4-4"
        />
      </svg>
    ),
  },
  {
    href: '/mas',
    label: 'Más',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M4 6h16M4 12h16M4 18h16"
        />
      </svg>
    ),
  },
];

// Pantallas a las que solo se llega desde la grilla de "Más" — esa pestaña
// se marca activa en cualquiera de ellas, no solo en /mas mismo.
const RUTAS_DENTRO_DE_MAS = ['/mas', '/reportes', '/tasa', '/inventario', '/usuarios', '/movimientos', '/presupuestos', '/presupuestos/nuevo'];

export default function BottomNav() {
  const pathname = usePathname();
  const { rol, estado } = useApp();
  const visibles = tabs.filter(tab => rutasPermitidas(rol, estado).includes(tab.href));

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700 z-40 safe-area-bottom">
      <div className="max-w-lg mx-auto flex">
        {visibles.map(tab => {
          const isActive = tab.href === '/mas'
            ? RUTAS_DENTRO_DE_MAS.includes(pathname)
            : pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex-1 flex flex-col items-center py-2 px-1 text-xs transition-colors relative ${
                isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300'
              }`}
            >
              {tab.icon}
              <span className={`mt-0.5 ${isActive ? 'font-semibold' : ''}`}>{tab.label}</span>
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-emerald-600 dark:bg-emerald-400 rounded-b" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
