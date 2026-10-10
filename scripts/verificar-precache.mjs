// Guardián del precache del Service Worker. Corre en postbuild, después de
// mover-polyfill-al-frente.mjs, y rompe el build ante dos fallas que si no
// pasan calladas hasta producción.
//
//   Falla 1 — falta una pantalla en la lista.
//     No se precachea, abrirla en frío cae en navigateFallback: '/' y muestra
//     Caja. Navegar por el menú anda bien, así que nadie lo reporta. Fue el
//     bug de /perfil.
//
//   Falla 2 — el precache pide una URL que no existe en /out.
//     Un solo 404 durante el install tumba TODO el precache y el Service
//     Worker se autodestruye en silencio. La app queda sin modo offline y
//     nada lo avisa.
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const listaAMano = createRequire(import.meta.url)('./rutas-precache.cjs');
const problemas = [];

// ── Falla 1 ───────────────────────────────────────────────────────────────
// Las pantallas reales son las carpetas de src/app con un page.tsx.
function pantallasDe(dir, base = '') {
  const salida = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    // _privadas, [dinamicas] y @slots no son rutas estaticas precacheables.
    // Se saltan enteras, con todo lo que tengan adentro.
    if (/^[_[@]/.test(e.name)) continue;
    const sub = join(dir, e.name);
    // Un (grupo) no aporta segmento a la URL, pero las pantallas que tiene
    // adentro SI son rutas: src/app/(panel)/estadisticas es /estadisticas.
    // Se recorre sin sumar su nombre al camino.
    const ruta = e.name.startsWith('(') ? base : `${base}/${e.name}`;
    if (ruta && existsSync(join(sub, 'page.tsx'))) salida.push(ruta);
    salida.push(...pantallasDe(sub, ruta));
  }
  return salida;
}

const reales = ['/', ...pantallasDe('src/app')].sort();
const declaradas = [...listaAMano].sort();

const sinDeclarar = reales.filter(r => !declaradas.includes(r));
const sobrantes = declaradas.filter(r => !reales.includes(r));

if (sinDeclarar.length) {
  problemas.push(
    `Pantallas que existen en src/app pero NO están en scripts/rutas-precache.cjs:\n` +
    sinDeclarar.map(r => `    ${r}`).join('\n') +
    `\n  Sin eso quedan rotas al abrirlas desde cero. Agregalas a esa lista.`
  );
}
if (sobrantes.length) {
  problemas.push(
    `Rutas en scripts/rutas-precache.cjs que ya no existen en src/app:\n` +
    sobrantes.map(r => `    ${r}`).join('\n') +
    `\n  Cada una es un 404 en el install que tumba todo el precache. Sacalas.`
  );
}

// ── Falla 2 ───────────────────────────────────────────────────────────────
// Se lee el manifiesto que quedó en el sw.js generado, no la lista de arriba:
// lo que importa es lo que el Service Worker va a pedir de verdad, incluidos
// los chunks y los íconos que agrega next-pwa por su cuenta.
const sw = 'out/sw.js';
if (!existsSync(sw)) {
  problemas.push(`No existe ${sw}. ¿El build de next-pwa corrió?`);
} else {
  const urls = [...readFileSync(sw, 'utf8').matchAll(/\{url:"([^"]+)",revision:/g)].map(m => m[1]);
  if (urls.length === 0) {
    problemas.push(`El precache de ${sw} salió vacío. Algo se rompió en next-pwa.`);
  }
  const huerfanas = urls.filter(u => {
    const p = 'out' + decodeURIComponent(u);
    return !(existsSync(p) || existsSync(`${p}.html`) || (u === '/' && existsSync('out/index.html')));
  });
  if (huerfanas.length) {
    problemas.push(
      `URLs en el precache que no tienen archivo en out/:\n` +
      huerfanas.map(u => `    ${u}`).join('\n') +
      `\n  Un solo 404 en el install tumba TODO el precache, en silencio.`
    );
  }
  if (!problemas.length) {
    console.log(`verificar-precache: ${reales.length} pantallas declaradas, ${urls.length} entradas en el precache, todas resuelven.`);
  }
}

if (problemas.length) {
  console.error('\nverificar-precache FALLÓ:\n');
  problemas.forEach(p => console.error('  • ' + p + '\n'));
  process.exit(1);
}
