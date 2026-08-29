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
