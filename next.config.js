const withPWA = require('next-pwa')({
  dest: 'public',
  // El auto-registro de next-pwa apunta al entry 'main.js' (Pages Router) y
  // nunca se ejecuta en el App Router, que sirve 'main-app.js'. Registramos
  // el SW nosotros mismos en Providers.tsx.
  register: false,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
  // app-build-manifest.json es un artefacto interno de build del App Router:
  // next-pwa lo detecta en el compilation de webpack y lo agrega al precache,
  // pero output:'export' nunca lo copia a /out. Sin excluirlo, el install del
  // SW falla (404 en un solo fetch tumba TODO el precache) y el registro
  // completo del Service Worker se autodestruye silenciosamente.
  buildExcludes: [/middleware-manifest\.json$/, /app-build-manifest\.json$/],
  // Fallback de navegación offline: cualquier ruta no precacheada cae aquí
  // en vez de la pantalla de error nativa del navegador.
  navigateFallback: '/',
  manifestTransforms: [
    // next-pwa solo escanea /public en build time (antes de que exista /out),
    // así que las 4 rutas de la app nunca entran al precache automático.
    // Las agregamos explícitamente para garantizar apertura offline desde cero,
    // sin depender de que el usuario ya las haya visitado antes.
    async manifestEntries => {
      const revision = process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now());
      const rutas = ['/', '/inventario', '/resumen', '/tasa', '/reportes', '/usuarios', '/movimientos'].map(url => ({ url, revision }));
      return { manifest: [...manifestEntries, ...rutas], warnings: [] };
    },
  ],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',
};

module.exports = withPWA(nextConfig);
