import type { Metadata, Viewport } from 'next';
import './globals.css';
import BottomNav from '@/components/BottomNav';
import Providers from '@/components/Providers';

export const metadata: Metadata = {
  title: 'Caja',
  description: 'App de consulta de precios para punto de venta',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Caja',
  },
  icons: { apple: '/icon-192.png' },
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
      <body>
        <Providers>
          <main className="min-h-screen bg-gray-50 pb-16 max-w-lg mx-auto">
            {children}
          </main>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
