'use client';

import Link from 'next/link';
import { useApp } from '@/components/Providers';
import { useGuardarRuta } from '@/lib/useGuardarRuta';
import { rutasPermitidas } from '@/lib/roles';
import ThemeToggle from '@/components/ThemeToggle';
import Icon from '@/components/ui/Icon';
import { TAMANO_ICONO, type NombreIcono } from '@/components/ui/iconos';

// Un cuadro por pantalla que no se usa todo el rato (a diferencia de Caja,
// Resumen y Fiado, que se quedan fijos en la barra). Se filtra con la misma
// lista que ya bloquea rutas por URL directa — un cajero nunca ve un cuadro
// a una pantalla que esa lista ya le niega.
const ITEMS: { href: string; label: string; icono: NombreIcono }[] = [
  { href: '/reportes', label: 'Reportes', icono: 'reportes' },
  { href: '/tasa', label: 'Tasa', icono: 'tasaDelDia' },
  { href: '/inventario', label: 'Inventario', icono: 'inventario' },
  { href: '/presupuestos', label: 'Presupuestos', icono: 'presupuestos' },
  { href: '/datos-negocio', label: 'Datos del negocio', icono: 'datosDelNegocio' },
];

export default function MasPage() {
  const permitida = useGuardarRuta();
  const { rol, estado } = useApp();
  const permitidas = rutasPermitidas(rol, estado);

  if (!permitida) return null;
  const visibles = ITEMS.filter(item => permitidas.includes(item.href));

  return (
    <div>
      <header className="bg-superficie-barra border-b border-borde-divisor px-4 pt-3.5 pb-3 flex items-center gap-2.5">
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-texto truncate">Más</h1>
          <p className="text-[11px] font-medium text-texto-3 truncate">El resto de las pantallas</p>
        </div>
        <ThemeToggle variant="neutro" />
      </header>

      <div className="p-4">
        <div className="grid grid-cols-3 gap-3">
          {visibles.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center justify-center gap-2 p-4 bg-tarjeta border border-borde-tarjeta rounded-2xl aspect-square transition-transform active:scale-[0.99]"
            >
              <Icon nombre={item.icono} tamano={TAMANO_ICONO.grillaMas} className="text-marca" />
              <span className="text-xs font-semibold text-center text-texto">{item.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
