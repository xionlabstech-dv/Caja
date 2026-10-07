'use client';

import Icon from '@/components/ui/Icon';
import { TAMANO_ICONO } from '@/components/ui/iconos';

// Se muestra en vez de toda la app cuando el navegador no tiene IndexedDB —
// sin eso Caja no tiene dónde guardar ni una venta, con o sin polyfill (ver
// AvisoNavegadorViejo.tsx para lo que sí se puede parchear). Pantalla
// completa, sin bottom nav a propósito: se renderiza en vez de `children`
// desde Providers.tsx, así que BottomNav (que viaja dentro de `children`)
// tampoco se monta.
//
// Solo cubre que indexedDB no exista como función. No cubre que exista
// pero falle al abrirse (cuota llena, un modo privado que la expone pero la
// bloquea al usar) — ese es un caso de borde dentro de un caso de borde,
// afuera de este brief a propósito.
export default function NavegadorNoSoportado() {
  return (
    <div className="min-h-screen bg-superficie flex items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <div className="w-16 h-16 bg-negativo-fondo rounded-2xl flex items-center justify-center mx-auto mb-5">
          <Icon nombre="suspendido" tamano={TAMANO_ICONO.login} className="text-negativo" />
        </div>
        <h1 className="text-xl font-bold text-texto mb-2">
          Este navegador no es compatible con Caja
        </h1>
        <p className="text-sm text-texto-3 leading-relaxed">
          Esta app necesita guardar datos en el teléfono para funcionar sin internet, y este navegador no lo permite. Probá abriendo Caja desde Chrome.
        </p>
      </div>
    </div>
  );
}
