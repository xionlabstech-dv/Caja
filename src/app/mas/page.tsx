'use client';

import Link from 'next/link';
import { useApp } from '@/components/Providers';
import { useGuardarRuta } from '@/lib/useGuardarRuta';
import { rutasPermitidas } from '@/lib/roles';
import ThemeToggle from '@/components/ThemeToggle';

// Un cuadro por pantalla que no se usa todo el rato (a diferencia de Caja,
// Resumen y Fiado, que se quedan fijos en la barra). Se filtra con la misma
// lista que ya bloquea rutas por URL directa — un cajero nunca ve un cuadro
// a una pantalla que esa lista ya le niega.
const ITEMS = [
  {
    href: '/reportes',
    label: 'Reportes',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M7 20V10m6 10V4m6 16v-7M4 20h16"
        />
      </svg>
    ),
  },
  {
    href: '/tasa',
    label: 'Tasa',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
  {
    href: '/inventario',
    label: 'Inventario',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
        />
      </svg>
    ),
  },
  {
    href: '/presupuestos',
    label: 'Presupuestos',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
    ),
  },
];

export default function MasPage() {
  useGuardarRuta();
  const { rol, estado } = useApp();
  const permitidas = rutasPermitidas(rol, estado);
  const visibles = ITEMS.filter(item => permitidas.includes(item.href));

  return (
    <div>
      <header className="bg-emerald-600 text-white px-4 pt-4 pb-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Más</h1>
          <p className="text-emerald-200 text-sm">El resto de las pantallas</p>
        </div>
        <ThemeToggle />
      </header>

      <div className="p-4">
        <div className="grid grid-cols-3 gap-3">
          {visibles.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center justify-center gap-2 bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-slate-700 text-gray-700 dark:text-gray-200 aspect-square"
            >
              <span className="text-emerald-600 dark:text-emerald-400">{item.icon}</span>
              <span className="text-xs font-semibold text-center">{item.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
