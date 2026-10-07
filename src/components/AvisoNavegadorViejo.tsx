'use client';

import { useEffect, useState } from 'react';
import Icon from '@/components/ui/Icon';
import { TAMANO_ICONO } from '@/components/ui/iconos';

const CLAVE_DESCARTADO = 'caja_aviso_navegador_descartado';

// Aviso suave (nunca bloquea) de que este navegador necesitó de verdad el
// polyfill de src/app/layout.tsx — no una sospecha por User-Agent (se puede
// falsificar, y Venezuela tiene navegadores raros que ni se identifican
// como "Chrome N"), sino el hecho concreto de que acá faltaba
// AbortSignal.timeout o crypto.randomUUID. window.__cajaNavegadorViejo lo
// deja escrito ese mismo script, antes de instalar el parche. Nunca
// aparece en un navegador al día.
export default function AvisoNavegadorViejo() {
  const [mostrar, setMostrar] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(window as any).__cajaNavegadorViejo) return;
    try {
      if (localStorage.getItem(CLAVE_DESCARTADO) === '1') return;
    } catch {}
    setMostrar(true);
  }, []);

  if (!mostrar) return null;

  const cerrar = () => {
    try {
      localStorage.setItem(CLAVE_DESCARTADO, '1');
    } catch {
      // Si falla (algunos navegadores viejos lo tienen de solo lectura en
      // ciertos modos), no pasa nada grave — solo que este aviso puede
      // volver a aparecer en la próxima carga. Nunca debe tumbar nada.
    }
    setMostrar(false);
  };

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-sm bg-aviso-fondo border border-aviso-borde text-aviso text-xs font-medium px-4 py-3 rounded-xl shadow-lg flex items-start gap-2">
      <span className="flex-1">
        <strong className="font-bold">Tu navegador está desactualizado.</strong> Caja sigue funcionando bien, pero si podés actualizar Chrome (o el navegador que uses), es más seguro a futuro.
      </span>
      <button onClick={cerrar} className="flex-shrink-0" aria-label="Cerrar aviso">
        <Icon nombre="cerrar" tamano={TAMANO_ICONO.secundario} />
      </button>
    </div>
  );
}
