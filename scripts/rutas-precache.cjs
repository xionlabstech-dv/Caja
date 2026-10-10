// Las rutas que el Service Worker precachea para que abran sin conexión
// desde cero.
//
// Esta lista es a propósito a mano, no derivada: agregar una pantalla a Caja
// tiene que ser una decisión deliberada, no algo que pasa solo. Pero olvidarse
// de agregarla acá dejaba la ruta rota en silencio — `navigateFallback: '/'`
// hace que abrirla en frío muestre la pantalla de Caja aunque la URL diga otra
// cosa, y navegar por el menú sigue andando bien, así que nadie lo reporta.
// Le pasó a /perfil durante semanas.
//
// Por eso scripts/verificar-precache.mjs compara esta lista contra las
// pantallas reales de src/app en cada build y lo rompe si no coinciden.
// Si agregaste una pantalla y el build falla, el build tiene razón.
module.exports = [
  '/',
  '/inventario',
  '/resumen',
  '/tasa',
  '/reportes',
  '/usuarios',
  '/movimientos',
  '/fiado',
  '/mas',
  '/presupuestos',
  '/presupuestos/nuevo',
  '/datos-negocio',
  '/perfil',
  '/por-pagar',
];
