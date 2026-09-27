'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from './Providers';
import { rutasPermitidas } from '@/lib/roles';
import Icon from '@/components/ui/Icon';

// Solo lo que se usa constante, varias veces por hora, vive en la barra.
// El resto (Reportes, Tasa, Inventario, Presupuestos) se accede desde
// "Más" — con Presupuestos la barra hubiera llegado a 7 pestañas.
const tabs = [
  { href: '/', label: 'Caja', icon: <Icon nombre="caja" /> },
  { href: '/resumen', label: 'Resumen', icon: <Icon nombre="resumen" /> },
  { href: '/fiado', label: 'Fiado', icon: <Icon nombre="fiado" /> },
  { href: '/mas', label: 'Más', icon: <Icon nombre="mas" /> },
];

// Pantallas a las que solo se llega desde la grilla de "Más" — esa pestaña
// se marca activa en cualquiera de ellas, no solo en /mas mismo.
const RUTAS_DENTRO_DE_MAS = ['/mas', '/reportes', '/tasa', '/inventario', '/usuarios', '/movimientos', '/presupuestos', '/presupuestos/nuevo'];

export default function BottomNav() {
  const pathname = usePathname();
  const { rol, estado } = useApp();
  const visibles = tabs.filter(tab => rutasPermitidas(rol, estado).includes(tab.href));

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-superficie-barra border-t border-borde-divisor z-40 safe-area-bottom">
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
                isActive ? 'text-marca' : 'text-texto-4'
              }`}
            >
              {tab.icon}
              <span className={`mt-0.5 ${isActive ? 'font-semibold' : ''}`}>{tab.label}</span>
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-marca rounded-b" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
