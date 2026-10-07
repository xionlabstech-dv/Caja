#!/usr/bin/env node
// Next.js (App Router, output:'export') siempre emite sus propios
// <script src="/_next/..."> de framework al principio de <head>, antes de
// cualquier JSX que RootLayout (src/app/layout.tsx) ponga ahí — probado
// contra el HTML real: pasa igual usando next/script con
// strategy="beforeInteractive" (en una exportación 100% estática ese script
// queda como payload RSC diferido, no como un <script> ejecutable en el
// HTML inicial).
//
// El polyfill de AbortSignal.timeout/crypto.randomUUID (brief "compatibilidad
// con navegadores viejos") tiene que ser lo PRIMERO que corre, antes de que
// se evalúe cualquier bundle — así que este script corre después de
// `next build` y reordena cada HTML ya exportado a mano: saca el <script
// id="polyfills-navegadores-viejos"> de donde haya quedado y lo vuelve a
// insertar como el primer hijo de <head>, antes de cualquier otra cosa
// (incluidos los <script src="/_next/..."> de Next).
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT_DIR = path.join(process.cwd(), 'out');

const RE_POLYFILL_SCRIPT = /<script\b[^>]*\bid="polyfills-navegadores-viejos"[^>]*>[\s\S]*?<\/script>/;
const RE_HEAD_OPEN = /<head(\s[^>]*)?>/;

async function* htmlFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* htmlFiles(full);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      yield full;
    }
  }
}

async function procesarArchivo(filePath) {
  const html = await readFile(filePath, 'utf8');

  const match = html.match(RE_POLYFILL_SCRIPT);
  if (!match) {
    // Páginas sin <head> propio (no debería pasar, todas comparten
    // RootLayout) — no hay nada que mover.
    return { filePath, movido: false, razon: 'sin script de polyfill' };
  }
  const scriptTag = match[0];

  const headMatch = html.match(RE_HEAD_OPEN);
  if (!headMatch) {
    return { filePath, movido: false, razon: 'sin <head>' };
  }

  // Si ya es el primer hijo de <head>, no hay nada que hacer.
  const yaEsPrimero = html.indexOf(scriptTag) === headMatch.index + headMatch[0].length;
  if (yaEsPrimero) {
    return { filePath, movido: false, razon: 'ya estaba primero' };
  }

  const sinElScript = html.replace(scriptTag, '');
  const headMatch2 = sinElScript.match(RE_HEAD_OPEN);
  const insertAt = headMatch2.index + headMatch2[0].length;
  const reordenado = sinElScript.slice(0, insertAt) + scriptTag + sinElScript.slice(insertAt);

  await writeFile(filePath, reordenado, 'utf8');
  return { filePath, movido: true };
}

async function main() {
  let total = 0;
  let movidos = 0;
  const sinPolyfill = [];

  for await (const file of htmlFiles(OUT_DIR)) {
    total++;
    const resultado = await procesarArchivo(file);
    if (resultado.movido) movidos++;
    if (resultado.razon === 'sin script de polyfill') sinPolyfill.push(file);
  }

  console.log(`mover-polyfill-al-frente: ${total} HTML revisados, ${movidos} reordenados.`);

  if (sinPolyfill.length > 0) {
    console.error('ERROR: estos HTML no tienen el script de polyfill (no deberían existir):');
    for (const f of sinPolyfill) console.error(`  - ${f}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('mover-polyfill-al-frente falló:', err);
  process.exit(1);
});
