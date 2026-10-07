import type { Metadata, Viewport } from 'next';
import './globals.css';
import BottomNav from '@/components/BottomNav';
import Providers from '@/components/Providers';
import EstadoBanner from '@/components/EstadoBanner';

export const metadata: Metadata = {
  title: 'Caja',
  description: 'App de consulta de precios para punto de venta',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Caja',
  },
  icons: {
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
    icon: [{ url: '/favicon-32.png', sizes: '32x32', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#059669',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        {/*
          Next.js (App Router, output:'export') siempre emite sus propios
          <script src="/_next/..."> de framework al principio del <head>,
          antes de cualquier JSX que esta misma pantalla ponga ahí — ocurre
          incluso usando next/script con strategy="beforeInteractive" (en
          una exportación 100% estática, ese script queda como payload RSC
          diferido, no como un <script> ejecutable en el HTML inicial; se
          probó y confirmó con el build real antes de descartarlo). Por eso
          el build de este proyecto corre scripts/mover-polyfill-al-frente.mjs
          después de `next build`: reordena el HTML ya exportado para que
          este script quede siendo el primer hijo de <head>, antes de
          cualquier script de Next — ver ese archivo para el detalle. Este
          <script> de acá sigue haciendo falta igual: es lo que ese postbuild
          reubica, y es también lo único que corre en `next dev` (ahí no hay
          /out ni postbuild).
        */}
        <script
          id="polyfills-navegadores-viejos"
          dangerouslySetInnerHTML={{
            __html: `
(function(){
  // Caja corre en teléfonos con navegadores viejos. Estas dos funciones no
  // existen antes de Chrome 103 y 92 respectivamente, y sin ellas la app
  // falla EN SILENCIO: AbortSignal.timeout revienta antes de hacer la
  // petición, el error queda atrapado en el catch de quien la llama, y la
  // cola reintenta para siempre sin que salga nada del teléfono. Pasó en
  // producción con un Chrome 94: 8 ventas trabadas horas sin ningún aviso.
  // Va como script inline en el head, no como módulo importado, para que
  // corra antes de que se evalúe cualquier bundle.
  try {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout !== 'function') {
      // Marca para que React (AvisoNavegadorViejo.tsx) sepa, una sola vez
      // después de montar, que este navegador necesitó de verdad el
      // polyfill — no es una sospecha por User-Agent (que se puede
      // falsificar, y Venezuela tiene navegadores raros que ni se
      // identifican como "Chrome N"), es el hecho concreto de que acá
      // faltaba la función.
      try { window.__cajaNavegadorViejo = true; } catch (e) {}
      AbortSignal.timeout = function (ms) {
        var c = new AbortController();
        setTimeout(function () { c.abort(); }, ms);
        return c.signal;
      };
    }
  } catch (e) {}
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function'
        && typeof crypto.randomUUID !== 'function') {
      try { window.__cajaNavegadorViejo = true; } catch (e) {}
      crypto.randomUUID = function () {
        var b = new Uint8Array(16);
        crypto.getRandomValues(b);
        b[6] = (b[6] & 0x0f) | 0x40;  // versión 4
        b[8] = (b[8] & 0x3f) | 0x80;  // variante RFC 4122
        var h = '';
        for (var i = 0; i < 16; i++) {
          h += (b[i] + 0x100).toString(16).slice(1);
          if (i === 3 || i === 5 || i === 7 || i === 9) h += '-';
        }
        return h;
      };
    }
  } catch (e) {}
})();
            `,
          }}
        />
        <script dangerouslySetInnerHTML={{
          __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}})();`
        }} />
      </head>
      <body>
        <Providers>
          <main className="min-h-screen bg-gray-50 dark:bg-slate-900 pb-16 max-w-lg mx-auto">
            <EstadoBanner />
            {children}
          </main>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
