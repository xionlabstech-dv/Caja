'use client';

import { useState } from 'react';
import { useApp } from './Providers';

const DIAS_AVISO = 5;

// fecha_proximo_pago es un date puro (YYYY-MM-DD), sin hora ni huso —
// parsearlo con `new Date(str)` lo interpreta en UTC y puede correrse un
// día hacia atrás en husos negativos como Venezuela (UTC-4). Se arma la
// fecha local a mano para comparar días de calendario, no instantes.
function diasHasta(fechaISO: string): number {
  const [y, m, d] = fechaISO.split('-').map(Number);
  const fecha = new Date(y, m - 1, d);
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Math.round((fecha.getTime() - hoy.getTime()) / 86400000);
}

// Banner de una línea, arriba de todo el contenido. Dos casos, mutuamente
// excluyentes (nunca los dos a la vez):
//   - restringido: persistente, no se puede cerrar — el pago ya está
//     vencido y algunas funciones ya están limitadas de verdad.
//   - activo con fecha_proximo_pago cerca (o vencida): se puede cerrar,
//     pero es solo un recordatorio — el servicio funciona normal. Se
//     guarda en estado de componente, no en cache: vuelve a aparecer al
//     reabrir la app a propósito, no es un "no mostrar nunca más".
export default function EstadoBanner() {
  const { estado, fechaProximoPago } = useApp();
  const [cerrado, setCerrado] = useState(false);

  if (estado === 'restringido') {
    return (
      <div className="bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 text-xs font-medium text-center py-1.5 px-3">
        Hay un pago pendiente — algunas funciones están limitadas
      </div>
    );
  }

  if (estado === 'activo' && fechaProximoPago && !cerrado) {
    const dias = diasHasta(fechaProximoPago);
    if (dias <= DIAS_AVISO) {
      const texto =
        dias < 0
          ? `Pago pendiente vencido hace ${Math.abs(dias)} día${Math.abs(dias) === 1 ? '' : 's'}`
          : dias === 0
            ? 'Tu próximo pago vence hoy'
            : `Tu próximo pago vence en ${dias} día${dias === 1 ? '' : 's'}`;

      return (
        <div className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-medium py-1.5 pl-3 pr-2 flex items-center justify-between gap-2">
          <span>{texto}</span>
          <button
            onClick={() => setCerrado(true)}
            className="p-0.5 text-blue-400 dark:text-blue-500 flex-shrink-0"
            aria-label="Cerrar aviso"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      );
    }
  }

  return null;
}
