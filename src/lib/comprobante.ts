import { Venta, VentaItem, PagoVenta, MetodoPago, Presupuesto, PresupuestoItem, DatosNegocio } from '@/types';
import { formatBS, formatUSD } from './precio';

// Documentos de venta y de presupuesto — NUNCA fiscales (ver la leyenda que
// se dibuja en cada uno). Se generan como imagen PNG dibujada a mano en un
// <canvas>, no como PDF: el proyecto no tenía ninguna librería de PDF
// instalada y esta es una PWA que corre en teléfonos de gama baja con mala
// señal — una imagen pesa menos, no agrega dependencias al bundle, y además
// se previsualiza mejor dentro del chat de WhatsApp que un PDF.
//
// Cinco formatos posibles (los mismos identificadores que usa la columna en
// Supabase, negocios.formato_comprobante/formato_presupuesto — no hace falta
// traducir a otro vocabulario porque acá nunca se compara contra el string
// "media" que usa el prop de la referencia de Diseño):
//   Comprobante de venta: ticket | carta | media_carta
//   Presupuesto:                  carta | media_carta

const METODO_LABELS: Record<MetodoPago, string> = {
  efectivo_bs: 'Efectivo Bs',
  pago_movil: 'Pago Móvil',
  biopago: 'Biopago',
  tarjeta: 'Tarjeta',
  efectivo_usd: 'Efectivo $',
  fiado: 'Fiado',
};

const LEYENDA_FISCAL = 'Este documento no tiene validez fiscal';

const ESCALA = 2;
const VERDE_MARCA = '#04875A';
const COLOR_TINTA = '#111827';
const COLOR_TEXTO = '#111827';
const COLOR_TEXTO_SUAVE = '#374151';
const COLOR_TEXTO_APOYO = '#6b7280';
const COLOR_DIVISOR = '#e5e7eb';
const COLOR_ROJO = '#dc2626';
const COLOR_NARANJA = '#c2410c';
const COLOR_NARANJA_BG = '#fff7ed';

// --- Utilidades compartidas por los cinco formatos ---

function trazarLinea(
  ctx: CanvasRenderingContext2D,
  x1: number,
  x2: number,
  y: number,
  opciones: { color?: string; grosor?: number; guiones?: number[] } = {},
) {
  ctx.strokeStyle = opciones.color ?? COLOR_DIVISOR;
  ctx.lineWidth = opciones.grosor ?? 1;
  ctx.setLineDash(opciones.guiones ?? []);
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.setLineDash([]);
}

function truncar(ctx: CanvasRenderingContext2D, texto: string, anchoMax: number): string {
  if (ctx.measureText(texto).width <= anchoMax) return texto;
  let corto = texto;
  while (corto.length > 1 && ctx.measureText(corto + '…').width > anchoMax) {
    corto = corto.slice(0, -1);
  }
  return corto + '…';
}

// Envuelve texto en varias líneas por ancho disponible (a diferencia de
// truncar, acá no se pierde contenido) — usada por la nota al pie del
// presupuesto en carta, que junta tasa + resumen + aclaración en una sola
// oración que puede no caber en una línea.
function envolverTexto(ctx: CanvasRenderingContext2D, texto: string, anchoMax: number): string[] {
  const palabras = texto.split(' ');
  const lineas: string[] = [];
  let actual = '';
  for (const palabra of palabras) {
    const candidata = actual ? `${actual} ${palabra}` : palabra;
    if (ctx.measureText(candidata).width > anchoMax && actual) {
      lineas.push(actual);
      actual = palabra;
    } else {
      actual = candidata;
    }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

// Debajo del nombre del negocio, los datos de contacto que estén cargados —
// nunca los cuatro fijos: el que falte simplemente no ocupa una línea, no
// hay "No especificado" ni renglones en blanco. Mismo contrato en los 5
// formatos; lo que cambia es cómo se presentan (ver dibujarDatosNegocio*).
function lineasDatosNegocio(datos?: DatosNegocio): string[] {
  if (!datos) return [];
  const lineas: string[] = [];
  if (datos.direccion?.trim()) lineas.push(datos.direccion.trim());
  if (datos.telefono?.trim()) lineas.push(datos.telefono.trim());
  if (datos.correo?.trim()) lineas.push(datos.correo.trim());
  if (datos.rif?.trim()) lineas.push(`RIF ${datos.rif.trim()}`);
  return lineas;
}

// "N productos · M unidades[ + peso]" — productos cuenta líneas distintas
// (items.length), unidades suma cantidad solo de los items que NO son por
// peso, y "+ peso" se agrega como sufijo literal (nunca mezclado en el
// número) en cuanto haya al menos un item por peso.
function resumenProductosUnidades(items: { cantidad: number; gramos?: number }[]): string {
  const unidades = items
    .filter(i => i.gramos === undefined)
    .reduce((s, i) => s + i.cantidad, 0);
  const conPeso = items.some(i => i.gramos !== undefined);
  const productosTxto = `${items.length} producto${items.length === 1 ? '' : 's'}`;
  const unidadesTxto = `${unidades} unidad${unidades === 1 ? '' : 'es'}`;
  return `${productosTxto} · ${unidadesTxto}${conPeso ? ' + peso' : ''}`;
}

// La leyenda de no-validez-fiscal va SIEMPRE en un recuadro con borde de
// tinta (nunca gris, nunca texto suelto) para que sobreviva una impresión en
// blanco y negro. `textoDerecha` es el dato secundario que la acompaña en
// carta/media (número de documento o el resumen de productos); en ticket va
// sola y centrada.
function dibujarLeyendaFiscal(
  ctx: CanvasRenderingContext2D,
  x: number,
  anchoBox: number,
  y: number,
  opciones: { tamano: number; textoDerecha?: string; tamanoDerecha?: number; centrado?: boolean; padding?: number },
): number {
  const padding = opciones.padding ?? 10;
  const alto = opciones.tamano + padding * 2;

  ctx.strokeStyle = COLOR_TINTA;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, anchoBox, alto);

  ctx.textBaseline = 'middle';
  ctx.font = `bold ${opciones.tamano}px sans-serif`;
  ctx.fillStyle = COLOR_TINTA;
  if (opciones.centrado) {
    ctx.textAlign = 'center';
    ctx.fillText(LEYENDA_FISCAL, x + anchoBox / 2, y + alto / 2);
  } else {
    ctx.textAlign = 'left';
    ctx.fillText(LEYENDA_FISCAL, x + 14, y + alto / 2);
    if (opciones.textoDerecha) {
      ctx.textAlign = 'right';
      ctx.font = `${opciones.tamanoDerecha ?? opciones.tamano - 2}px sans-serif`;
      ctx.fillStyle = COLOR_TEXTO_SUAVE;
      ctx.fillText(opciones.textoDerecha, x + anchoBox - 14, y + alto / 2);
    }
  }
  ctx.textBaseline = 'alphabetic';
  return y + alto;
}

// Columnas de la tabla de items — DESCRIPCIÓN / CANT. / P. UNIT. / TOTAL —
// un único set de anchos por tamaño de página física (carta y media carta
// comparten el mismo ancho de 816px, así que comparten también estas
// columnas), reutilizado por comprobante y presupuesto: mismos encabezados
// para los dos documentos, sin parámetro de tipo de documento.
interface ColumnasTabla { cantX: number; precioX: number; totalX: number; descAnchoMax: number; }

function columnasTabla(
  ancho: number, padX: number, anchoCant: number, anchoPrecio: number, anchoTotal: number, gap: number,
): ColumnasTabla {
  const totalX = ancho - padX;
  const precioX = totalX - anchoTotal - gap;
  const cantX = precioX - anchoPrecio - gap;
  const descAnchoMax = cantX - gap - anchoCant - padX;
  return { cantX, precioX, totalX, descAnchoMax };
}

const columnasCarta = (ancho: number, padX: number) => columnasTabla(ancho, padX, 90, 120, 130, 16);
const columnasMedia = (ancho: number, padX: number) => columnasTabla(ancho, padX, 72, 100, 110, 14);

function dibujarEncabezadoTabla(ctx: CanvasRenderingContext2D, padX: number, y: number, cols: ColumnasTabla, tamano: number) {
  ctx.font = `bold ${tamano}px sans-serif`;
  ctx.fillStyle = COLOR_TEXTO_SUAVE;
  ctx.textAlign = 'left';
  ctx.fillText('DESCRIPCIÓN', padX, y);
  ctx.textAlign = 'right';
  ctx.fillText('CANT.', cols.cantX, y);
  ctx.fillText('P. UNIT.', cols.precioX, y);
  ctx.fillText('TOTAL', cols.totalX, y);
}

// --- Filas de pago: la fila con doble moneda para efectivo_usd dentro de un
// pago mixto (nueva) y la nota naranja de fiado (igual que hoy) ---

interface FilaPago { metodo: string; monto: string; nota?: string; color: string; colorNota: string; }

function construirFilasPago(pagos: PagoVenta[]): FilaPago[] {
  const mixto = pagos.length > 1;
  return pagos.map(p => {
    if (mixto && p.metodo === 'efectivo_usd') {
      return {
        metodo: METODO_LABELS[p.metodo],
        monto: formatUSD(p.monto_usd),
        nota: `= ${formatBS(p.monto_bs)}`,
        color: COLOR_TEXTO,
        colorNota: COLOR_TEXTO_APOYO,
      };
    }
    const esFiado = p.metodo === 'fiado';
    return {
      metodo: METODO_LABELS[p.metodo],
      monto: formatBS(p.monto_bs),
      nota: esFiado ? 'Pendiente de pago' : undefined,
      color: esFiado ? COLOR_NARANJA : COLOR_TEXTO,
      colorNota: COLOR_NARANJA,
    };
  });
}

// Genera el PNG final en dos pasadas: la primera mide el alto real
// dibujando sobre un canvas provisional bien alto (dibujar es una función
// pura del contenido, así que el resultado es idéntico), la segunda dibuja
// sobre un canvas ya del tamaño exacto, escalado ×2 para que se vea nítido
// aunque lo abran con zoom en WhatsApp. El ancho varía por formato; el alto
// siempre es dinámico (nunca una página física de tamaño fijo).
async function generarPNG(ancho: number, dibujar: (ctx: CanvasRenderingContext2D, ancho: number) => number, altoMinimo = 0): Promise<Blob> {
  const medidor = document.createElement('canvas');
  medidor.width = ancho;
  medidor.height = 8000;
  const ctxMedidor = medidor.getContext('2d');
  if (!ctxMedidor) throw new Error('No se pudo generar el documento');
  const altoFinal = Math.max(dibujar(ctxMedidor, ancho), altoMinimo);

  const canvas = document.createElement('canvas');
  canvas.width = ancho * ESCALA;
  canvas.height = Math.ceil(altoFinal) * ESCALA;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo generar el documento');
  ctx.scale(ESCALA, ESCALA);
  dibujar(ctx, ancho);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('No se pudo generar el documento'))), 'image/png');
  });
}

function descargarBlob(blob: Blob, nombreArchivo: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// El share sheet solo tiene sentido en el teléfono, que es donde vive este
// flujo (el cajero comparte a mano, eligiendo WhatsApp y el contacto). En
// escritorio, Chrome expone navigator.share con soporte de archivos igual
// que en Android — pero ahí abre el "compartir" nativo de Windows/macOS,
// lleno de apps de oficina sin relación con WhatsApp, que solo confunde.
// Ahí conviene ir directo a la descarga.
function esMovil(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// Comparte por el share sheet nativo (WhatsApp, Telegram, correo, guardar
// archivo — lo que sea que el sistema operativo ofrezca) cuando está
// disponible y tiene sentido (teléfono). Nunca deja al usuario sin salida:
// si no aplica, descarga el archivo directo.
async function compartirArchivo(blob: Blob, nombreArchivo: string, titulo: string): Promise<'compartido' | 'descargado'> {
  const archivo = new File([blob], nombreArchivo, { type: 'image/png' });

  const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
  const puedeCompartirArchivo =
    esMovil() &&
    typeof nav.share === 'function' &&
    (typeof nav.canShare !== 'function' || nav.canShare({ files: [archivo] }));

  if (puedeCompartirArchivo) {
    try {
      await nav.share({ files: [archivo], title: titulo });
      return 'compartido';
    } catch (err) {
      // AbortError: el usuario cerró el menú de compartir sin elegir nada —
      // no es una falla real, no hace falta caer al fallback de descarga.
      if ((err as { name?: string }).name === 'AbortError') return 'compartido';
      // Cualquier otro error sí cae al fallback de descarga, abajo.
    }
  }

  descargarBlob(blob, nombreArchivo);
  return 'descargado';
}

function fmtFechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-VE', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function fmtFechaSolo(iso: string): string {
  return new Date(iso).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
}

// fecha_vencimiento es un date puro ('YYYY-MM-DD'): parsearlo con `new
// Date(iso)` a secas lo interpreta en UTC y puede mostrar el día anterior
// según la zona horaria — se arma la fecha local a mano para evitarlo.
function fmtFechaCorta(iso: string): string {
  const [anio, mes, dia] = iso.split('-').map(Number);
  return new Date(anio, mes - 1, dia).toLocaleDateString('es-VE', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function dibujarBarraMarca(ctx: CanvasRenderingContext2D, ancho: number, alto: number) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ancho, 8000);
  ctx.fillStyle = VERDE_MARCA;
  ctx.fillRect(0, 0, ancho, alto);
}

// --- Encabezado de dos columnas (carta y media carta) ---
// Estructura aprobada: datos del negocio a la izquierda, título + número +
// fecha a la derecha — reemplaza el encabezado centrado de una sola columna
// que hoy comparten los cinco formatos. El ticket conserva ese encabezado
// centrado (más cercano al de hoy), así que no pasa por esta función.

interface LineaEncabezado { texto: string; font: string; color: string; salto: number; }

function dibujarEncabezadoDosColumnas(
  ctx: CanvasRenderingContext2D,
  ancho: number,
  padX: number,
  y: number,
  izquierda: LineaEncabezado[],
  derecha: LineaEncabezado[],
): number {
  const anchoIzqMax = ancho * 0.55 - padX;

  let yIzq = y;
  ctx.textAlign = 'left';
  for (const linea of izquierda) {
    ctx.font = linea.font;
    ctx.fillStyle = linea.color;
    ctx.fillText(truncar(ctx, linea.texto, anchoIzqMax), padX, yIzq);
    yIzq += linea.salto;
  }

  let yDer = y;
  ctx.textAlign = 'right';
  for (const linea of derecha) {
    ctx.font = linea.font;
    ctx.fillStyle = linea.color;
    ctx.fillText(linea.texto, ancho - padX, yDer);
    yDer += linea.salto;
  }

  return Math.max(yIzq, yDer);
}

// --- Comprobante de venta ---

export interface DatosComprobante {
  negocioNombre: string;
  // Opcional a propósito: si el admin nunca cargó "Datos del negocio", el
  // documento sigue funcionando, solo con el nombre de cuenta de siempre.
  datosNegocio?: DatosNegocio;
  venta: Venta;
  numero: number;
}

function itemsCantidadPrecio(item: VentaItem): { cantidadTexto: string; precioTexto: string } {
  const esPeso = item.gramos !== undefined;
  return {
    cantidadTexto: esPeso ? `${item.gramos}g` : `${item.cantidad}`,
    precioTexto: esPeso ? `${formatBS(item.precioUnitarioBs)}/kg` : formatBS(item.precioUnitarioBs),
  };
}

// --- Ticket (80mm térmico, 302px) — layout centrado de una sola columna ---

function dibujarComprobanteTicket(ctx: CanvasRenderingContext2D, datos: DatosComprobante): number {
  const { negocioNombre, datosNegocio, venta, numero } = datos;
  const ancho = 302;
  const padX = 16;
  const centroX = ancho / 2;
  dibujarBarraMarca(ctx, ancho, 3);
  ctx.textBaseline = 'alphabetic';

  let y = 3 + 22;
  ctx.textAlign = 'center';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillStyle = COLOR_TEXTO;
  ctx.fillText(datosNegocio?.nombreComercial || negocioNombre || 'Negocio', centroX, y);
  y += 18;

  // Datos de contacto — a diferencia del nombre (centrado, como hoy), van
  // alineados a la izquierda por instrucción explícita del brief; el
  // mockup de Diseño los centra igual que el nombre, pero acá se privilegió
  // la instrucción escrita, tal como pide la regla no-negociable del brief.
  ctx.textAlign = 'left';
  ctx.font = '11px sans-serif';
  ctx.fillStyle = COLOR_TEXTO_SUAVE;
  for (const linea of lineasDatosNegocio(datosNegocio)) {
    ctx.fillText(truncar(ctx, linea, ancho - padX * 2), padX, y);
    y += 14;
  }
  y += 4;

  if (venta.anulada) {
    ctx.fillStyle = COLOR_ROJO;
    ctx.fillRect(padX, y, ancho - padX * 2, 24);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('VENTA ANULADA', centroX, y + 16);
    y += 24 + 10;
    if (venta.motivo_anulacion) {
      trazarLinea(ctx, padX, ancho - padX, y, { color: '#AEB7B3', guiones: [3, 3] });
      y += 14;
      ctx.font = 'italic 10px sans-serif';
      ctx.fillStyle = COLOR_TEXTO_SUAVE;
      ctx.fillText(truncar(ctx, `Motivo: ${venta.motivo_anulacion}`, ancho - padX * 2), centroX, y);
      y += 16;
    }
    y += 4;
  }

  trazarLinea(ctx, padX, ancho - padX, y, { color: '#AEB7B3', guiones: [3, 3] });
  y += 20;

  ctx.textAlign = 'center';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = COLOR_TEXTO;
  ctx.fillText('COMPROBANTE DE VENTA', centroX, y);
  y += 18;

  ctx.font = '500 11px sans-serif';
  ctx.fillStyle = COLOR_TEXTO_SUAVE;
  ctx.textAlign = 'left';
  ctx.fillText(`Venta #${numero}`, padX, y);
  ctx.textAlign = 'right';
  ctx.fillText(fmtFechaHora(venta.fecha), ancho - padX, y);
  y += 18;

  trazarLinea(ctx, padX, ancho - padX, y, { color: '#AEB7B3', guiones: [3, 3] });
  y += 18;

  for (const item of venta.items) {
    const { cantidadTexto, precioTexto } = itemsCantidadPrecio(item);
    ctx.font = '600 11.5px sans-serif';
    ctx.fillStyle = COLOR_TEXTO;
    ctx.textAlign = 'left';
    ctx.fillText(truncar(ctx, item.nombre, ancho - padX * 2), padX, y);
    y += 14;
    ctx.font = '11px sans-serif';
    ctx.fillStyle = COLOR_TEXTO_SUAVE;
    ctx.fillText(`${cantidadTexto} × ${precioTexto}`, padX, y);
    ctx.textAlign = 'right';
    ctx.font = '600 12px sans-serif';
    ctx.fillStyle = COLOR_TEXTO;
    ctx.fillText(formatBS(item.subtotal_bs), ancho - padX, y);
    y += 16;
  }

  trazarLinea(ctx, padX, ancho - padX, y, { color: '#AEB7B3', guiones: [3, 3] });
  y += 16;

  ctx.font = '11px sans-serif';
  ctx.fillStyle = COLOR_TEXTO_SUAVE;
  ctx.textAlign = 'left';
  ctx.fillText(resumenProductosUnidades(venta.items), padX, y);
  ctx.textAlign = 'right';
  ctx.fillText(`Subtotal ${formatBS(venta.total_bs)}`, ancho - padX, y);
  y += 18;

  ctx.font = 'bold 10px sans-serif';
  ctx.fillStyle = COLOR_TEXTO_SUAVE;
  ctx.textAlign = 'left';
  ctx.fillText('PAGO', padX, y);
  y += 16;

  for (const fila of construirFilasPago(venta.pagos)) {
    ctx.font = '500 11.5px sans-serif';
    ctx.fillStyle = fila.color;
    ctx.textAlign = 'left';
    ctx.fillText(fila.metodo, padX, y);
    ctx.textAlign = 'right';
    ctx.fillText(fila.monto, ancho - padX, y);
    y += 14;
    if (fila.nota) {
      ctx.font = '10.5px sans-serif';
      ctx.fillStyle = fila.colorNota;
      ctx.textAlign = 'right';
      ctx.fillText(fila.nota, ancho - padX, y);
      y += 14;
    }
  }

  trazarLinea(ctx, padX, ancho - padX, y, { color: '#AEB7B3', guiones: [3, 3] });
  y += 20;

  ctx.textAlign = 'left';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillStyle = COLOR_TEXTO;
  ctx.fillText('TOTAL', padX, y);
  ctx.textAlign = 'right';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(formatBS(venta.total_bs), ancho - padX, y);
  y += 18;

  ctx.font = '11px sans-serif';
  ctx.fillStyle = COLOR_TEXTO_SUAVE;
  ctx.textAlign = 'right';
  const tasaTxt = venta.tasa_usada.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  ctx.fillText(`Ref. ${formatUSD(venta.total_usd)} · tasa ${tasaTxt}`, ancho - padX, y);
  y += 20;

  trazarLinea(ctx, padX, ancho - padX, y, { color: '#AEB7B3', guiones: [3, 3] });
  y += 14;

  y = dibujarLeyendaFiscal(ctx, padX, ancho - padX * 2, y, { tamano: 11, centrado: true });
  y += 14;

  return y;
}

// --- Carta (816×1056, dos columnas) ---

function dibujarComprobanteCarta(ctx: CanvasRenderingContext2D, datos: DatosComprobante): number {
  const { negocioNombre, datosNegocio, venta, numero } = datos;
  const ancho = 816;
  const padX = 60;
  dibujarBarraMarca(ctx, ancho, 4);
  ctx.textBaseline = 'alphabetic';

  const nombre = datosNegocio?.nombreComercial || negocioNombre || 'Negocio';
  const izquierda: LineaEncabezado[] = [
    { texto: nombre, font: 'bold 24px sans-serif', color: COLOR_TEXTO, salto: 26 },
    ...lineasDatosNegocio(datosNegocio).map(t => ({ texto: t, font: '13px sans-serif', color: COLOR_TEXTO_SUAVE, salto: 18 })),
  ];
  const derecha: LineaEncabezado[] = [
    { texto: 'COMPROBANTE DE VENTA', font: 'bold 13px sans-serif', color: COLOR_TEXTO, salto: 22 },
    { texto: `Venta #${numero}`, font: 'bold 22px sans-serif', color: COLOR_TEXTO, salto: 26 },
    { texto: fmtFechaHora(venta.fecha), font: '13px sans-serif', color: COLOR_TEXTO_SUAVE, salto: 18 },
  ];
  let y = dibujarEncabezadoDosColumnas(ctx, ancho, padX, 56, izquierda, derecha) + 24;

  if (venta.anulada) {
    ctx.fillStyle = COLOR_ROJO;
    ctx.fillRect(padX, y, ancho - padX * 2, 30);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('VENTA ANULADA', padX + 16, y + 20);
    y += 30 + 8;
    if (venta.motivo_anulacion) {
      ctx.font = 'italic 13px sans-serif';
      ctx.fillStyle = COLOR_TEXTO_SUAVE;
      ctx.fillText(truncar(ctx, `Motivo: ${venta.motivo_anulacion}`, ancho - padX * 2), padX, y);
      y += 20;
    }
    y += 6;
  }

  const cols = columnasCarta(ancho, padX);
  dibujarEncabezadoTabla(ctx, padX, y, cols, 11);
  y += 10;
  trazarLinea(ctx, padX, ancho - padX, y, { color: COLOR_TINTA, grosor: 1.5 });
  y += 24;

  for (const item of venta.items) {
    const { cantidadTexto, precioTexto } = itemsCantidadPrecio(item);
    ctx.font = '500 14px sans-serif';
    ctx.fillStyle = COLOR_TEXTO;
    ctx.textAlign = 'left';
    ctx.fillText(truncar(ctx, item.nombre, cols.descAnchoMax), padX, y);
    ctx.textAlign = 'right';
    ctx.font = '14px sans-serif';
    ctx.fillStyle = COLOR_TEXTO_SUAVE;
    ctx.fillText(cantidadTexto, cols.cantX, y);
    ctx.fillText(precioTexto, cols.precioX, y);
    ctx.font = '600 14px sans-serif';
    ctx.fillStyle = COLOR_TEXTO;
    ctx.fillText(formatBS(item.subtotal_bs), cols.totalX, y);
    y += 14;
    trazarLinea(ctx, padX, ancho - padX, y, { color: COLOR_DIVISOR });
    y += 20;
  }

  ctx.font = '13px sans-serif';
  ctx.fillStyle = COLOR_TEXTO_SUAVE;
  ctx.textAlign = 'left';
  ctx.fillText(resumenProductosUnidades(venta.items), padX, y);
  ctx.textAlign = 'right';
  const tasaTxt = venta.tasa_usada.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  ctx.fillText(`Tasa del día: Bs ${tasaTxt} por 1 USD`, ancho - padX, y);
  y += 32;

  const anchoTotales = 300;
  const xTotalesInicio = ancho - padX - anchoTotales;
  const xPagoFin = xTotalesInicio - 40;

  const yPagosInicio = y;
  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = COLOR_TEXTO_SUAVE;
  ctx.textAlign = 'left';
  ctx.fillText('PAGO', padX, y);
  y += 22;

  for (const fila of construirFilasPago(venta.pagos)) {
    ctx.font = '500 14px sans-serif';
    ctx.fillStyle = fila.color;
    ctx.textAlign = 'left';
    ctx.fillText(fila.metodo, padX, y);
    ctx.textAlign = 'right';
    ctx.font = '600 14px sans-serif';
    ctx.fillStyle = COLOR_TEXTO;
    const anchoMonto = ctx.measureText(fila.monto).width;
    ctx.fillText(fila.monto, xPagoFin, y);
    if (fila.nota) {
      ctx.font = '12px sans-serif';
      ctx.fillStyle = fila.colorNota;
      ctx.fillText(fila.nota, xPagoFin - anchoMonto - 10, y);
    }
    y += 12;
    trazarLinea(ctx, padX, xPagoFin, y, { color: '#C9D0CD', guiones: [2, 2] });
    y += 20;
  }

  const yTotales = yPagosInicio + 14;
  ctx.textAlign = 'right';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = COLOR_TEXTO;
  ctx.fillText('TOTAL', ancho - padX, yTotales);
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText(formatBS(venta.total_bs), ancho - padX, yTotales + 34);
  ctx.font = '13px sans-serif';
  ctx.fillStyle = COLOR_TEXTO_SUAVE;
  ctx.fillText(`Ref. ${formatUSD(venta.total_usd)}`, ancho - padX, yTotales + 54);
  trazarLinea(ctx, xTotalesInicio, ancho - padX, yTotales - 18, { color: COLOR_TINTA, grosor: 2 });

  y = Math.max(y, yTotales + 66) + 24;

  y = dibujarLeyendaFiscal(ctx, padX, ancho - padX * 2, y, {
    tamano: 14, textoDerecha: `Venta #${numero} · ${fmtFechaHora(venta.fecha)}`, tamanoDerecha: 12,
  });
  y += 30;

  return y;
}

// --- Media carta (816×528, mitad de una carta) ---

function dibujarComprobanteMediaCarta(ctx: CanvasRenderingContext2D, datos: DatosComprobante): number {
  const { negocioNombre, datosNegocio, venta, numero } = datos;
  const ancho = 816;
  const padX = 40;
  dibujarBarraMarca(ctx, ancho, 4);
  ctx.textBaseline = 'alphabetic';

  const nombre = datosNegocio?.nombreComercial || negocioNombre || 'Negocio';
  const datosLinea = lineasDatosNegocio(datosNegocio).join(' · ');
  const izquierda: LineaEncabezado[] = [
    { texto: nombre, font: 'bold 18px sans-serif', color: COLOR_TEXTO, salto: 20 },
    ...(datosLinea ? [{ texto: datosLinea, font: '11.5px sans-serif', color: COLOR_TEXTO_SUAVE, salto: 16 }] : []),
  ];
  const derecha: LineaEncabezado[] = [
    { texto: 'COMPROBANTE DE VENTA', font: 'bold 11px sans-serif', color: COLOR_TEXTO, salto: 16 },
    { texto: `Venta #${numero}`, font: 'bold 17px sans-serif', color: COLOR_TEXTO, salto: 19 },
    { texto: fmtFechaHora(venta.fecha), font: '11.5px sans-serif', color: COLOR_TEXTO_SUAVE, salto: 15 },
  ];
  let y = dibujarEncabezadoDosColumnas(ctx, ancho, padX, 26 + 4, izquierda, derecha) + 12;

  if (venta.anulada) {
    ctx.fillStyle = COLOR_ROJO;
    ctx.font = 'bold 12px sans-serif';
    const anchoBadge = ctx.measureText('VENTA ANULADA').width + 24;
    ctx.fillRect(padX, y, anchoBadge, 20);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText('VENTA ANULADA', padX + 12, y + 14);
    if (venta.motivo_anulacion) {
      ctx.font = 'italic 11.5px sans-serif';
      ctx.fillStyle = COLOR_TEXTO_SUAVE;
      ctx.fillText(truncar(ctx, `Motivo: ${venta.motivo_anulacion}`, ancho - padX * 2 - anchoBadge - 12), padX + anchoBadge + 12, y + 14);
    }
    y += 20 + 12;
  }

  const cols = columnasMedia(ancho, padX);
  dibujarEncabezadoTabla(ctx, padX, y, cols, 10);
  y += 8;
  trazarLinea(ctx, padX, ancho - padX, y, { color: COLOR_TINTA, grosor: 1.5 });
  y += 18;

  for (const item of venta.items) {
    const { cantidadTexto, precioTexto } = itemsCantidadPrecio(item);
    ctx.font = '500 12px sans-serif';
    ctx.fillStyle = COLOR_TEXTO;
    ctx.textAlign = 'left';
    ctx.fillText(truncar(ctx, item.nombre, cols.descAnchoMax), padX, y);
    ctx.textAlign = 'right';
    ctx.font = '12px sans-serif';
    ctx.fillStyle = COLOR_TEXTO_SUAVE;
    ctx.fillText(cantidadTexto, cols.cantX, y);
    ctx.fillText(precioTexto, cols.precioX, y);
    ctx.font = '600 12px sans-serif';
    ctx.fillStyle = COLOR_TEXTO;
    ctx.fillText(formatBS(item.subtotal_bs), cols.totalX, y);
    y += 10;
    trazarLinea(ctx, padX, ancho - padX, y, { color: COLOR_DIVISOR });
    y += 16;
  }
  y += 4;

  const anchoTotales = 240;
  const xTotalesInicio = ancho - padX - anchoTotales;
  const xPagoFin = xTotalesInicio - 32;

  const yPagosInicio = y;
  ctx.font = 'bold 10px sans-serif';
  ctx.fillStyle = COLOR_TEXTO_SUAVE;
  ctx.textAlign = 'left';
  ctx.fillText('PAGO', padX, y);
  y += 18;

  for (const fila of construirFilasPago(venta.pagos)) {
    ctx.font = '500 12px sans-serif';
    ctx.fillStyle = fila.color;
    ctx.textAlign = 'left';
    ctx.fillText(fila.metodo, padX, y);
    ctx.textAlign = 'right';
    ctx.font = '600 12px sans-serif';
    ctx.fillStyle = COLOR_TEXTO;
    const anchoMonto = ctx.measureText(fila.monto).width;
    ctx.fillText(fila.monto, xPagoFin, y);
    if (fila.nota) {
      ctx.font = '11px sans-serif';
      ctx.fillStyle = fila.colorNota;
      ctx.fillText(fila.nota, xPagoFin - anchoMonto - 8, y);
    }
    y += 18;
  }

  const yTotales = yPagosInicio + 12;
  ctx.textAlign = 'right';
  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = COLOR_TEXTO;
  ctx.fillText('TOTAL', ancho - padX, yTotales);
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText(formatBS(venta.total_bs), ancho - padX, yTotales + 26);
  ctx.font = '11.5px sans-serif';
  ctx.fillStyle = COLOR_TEXTO_SUAVE;
  const tasaTxt = venta.tasa_usada.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  ctx.fillText(`Ref. ${formatUSD(venta.total_usd)} · tasa ${tasaTxt}`, ancho - padX, yTotales + 44);
  trazarLinea(ctx, xTotalesInicio, ancho - padX, yTotales - 14, { color: COLOR_TINTA, grosor: 2 });

  y = Math.max(y, yTotales + 54) + 18;

  y = dibujarLeyendaFiscal(ctx, padX, ancho - padX * 2, y, {
    tamano: 12, textoDerecha: resumenProductosUnidades(venta.items), tamanoDerecha: 11, padding: 8,
  });
  y += 18;

  return y;
}

export async function generarComprobantePNG(datos: DatosComprobante): Promise<{ blob: Blob; nombreArchivo: string }> {
  const formato = datos.datosNegocio?.formatoComprobante ?? 'ticket';
  const dibujar = formato === 'carta' ? dibujarComprobanteCarta
    : formato === 'media_carta' ? dibujarComprobanteMediaCarta
    : dibujarComprobanteTicket;
  const ancho = formato === 'ticket' ? 302 : 816;
  const altoMinimo = formato === 'carta' ? 1056 : formato === 'media_carta' ? 528 : 0;
  const blob = await generarPNG(ancho, ctx => dibujar(ctx, datos), altoMinimo);
  // Nunca "factura" en el nombre del archivo — regla del proyecto.
  return { blob, nombreArchivo: `comprobante-venta-${datos.numero}.png` };
}

export async function compartirComprobante(datos: DatosComprobante): Promise<'compartido' | 'descargado'> {
  const { blob, nombreArchivo } = await generarComprobantePNG(datos);
  return compartirArchivo(blob, nombreArchivo, 'Comprobante de venta');
}

// --- Presupuesto ---

export interface DatosPresupuesto {
  negocioNombre: string;
  // Opcional a propósito: si el admin nunca cargó "Datos del negocio", el
  // documento sigue funcionando, solo sin ese bloque.
  datosNegocio?: DatosNegocio;
  presupuesto: Presupuesto;
  // Correlativo calculado en el cliente — mismo criterio que "Venta #N" en
  // Resumen, nunca una columna en la base.
  numero: number;
}

function itemPresupuestoCantidadPrecioMonto(item: PresupuestoItem): { cantidadTexto: string; precioTexto: string; subtotalBs: number } {
  const esPeso = item.gramos !== undefined;
  const subtotalBs = esPeso
    ? item.precioUnitarioBs * ((item.gramos ?? 0) / 1000)
    : item.precioUnitarioBs * item.cantidad;
  return {
    cantidadTexto: esPeso ? `${item.gramos}g` : `${item.cantidad}`,
    precioTexto: esPeso ? `${formatBS(item.precioUnitarioBs)}/kg` : formatBS(item.precioUnitarioBs),
    subtotalBs,
  };
}

// Recuadro "Válido hasta el ..." — sin cambios de estilo respecto a hoy
// (fondo/tinta ámbar, sin borde: no es la leyenda fiscal, no aplica la
// regla del borde de tinta), solo reubicado dentro del layout de dos
// columnas de carta/media.
function dibujarRecuadroVigencia(ctx: CanvasRenderingContext2D, x: number, y: number, ancho: number, alto: number, texto1: string, texto2: string, tam1: number, tam2: number) {
  ctx.fillStyle = COLOR_NARANJA_BG;
  ctx.fillRect(x, y, ancho, alto);
  ctx.textAlign = 'left';
  ctx.fillStyle = COLOR_NARANJA;
  ctx.font = `bold ${tam1}px sans-serif`;
  ctx.fillText(texto1, x + 14, y + tam1 + 8);
  ctx.font = `${tam2}px sans-serif`;
  ctx.fillText(texto2, x + 14, y + tam1 + tam2 + 14);
}

function dibujarPresupuestoCarta(ctx: CanvasRenderingContext2D, datos: DatosPresupuesto): number {
  const { negocioNombre, datosNegocio, presupuesto, numero } = datos;
  const ancho = 816;
  const padX = 60;
  dibujarBarraMarca(ctx, ancho, 4);
  ctx.textBaseline = 'alphabetic';

  const nombre = datosNegocio?.nombreComercial || negocioNombre || 'Negocio';
  const izquierda: LineaEncabezado[] = [
    { texto: nombre, font: 'bold 24px sans-serif', color: COLOR_TEXTO, salto: 26 },
    ...lineasDatosNegocio(datosNegocio).map(t => ({ texto: t, font: '13px sans-serif', color: COLOR_TEXTO_SUAVE, salto: 18 })),
  ];
  const derecha: LineaEncabezado[] = [
    { texto: 'PRESUPUESTO', font: 'bold 13px sans-serif', color: COLOR_TEXTO, salto: 22 },
    { texto: `Presupuesto #${numero}`, font: 'bold 22px sans-serif', color: COLOR_TEXTO, salto: 26 },
    { texto: `Emitido el ${fmtFechaSolo(presupuesto.creado_en)}`, font: '13px sans-serif', color: COLOR_TEXTO_SUAVE, salto: 18 },
  ];
  let y = dibujarEncabezadoDosColumnas(ctx, ancho, padX, 56, izquierda, derecha) + 24;

  const anchoVigencia = 300;
  const xVigencia = ancho - padX - anchoVigencia;
  const altoFila = 62;
  trazarLinea(ctx, padX, ancho - padX, y, { color: COLOR_DIVISOR });
  const yTextos = y + 24;
  ctx.textAlign = 'left';
  ctx.font = '14px sans-serif';
  if (presupuesto.cliente_nombre) {
    ctx.fillStyle = COLOR_TEXTO_SUAVE;
    ctx.fillText('Cliente:', padX, yTextos);
    ctx.font = '600 14px sans-serif';
    ctx.fillStyle = COLOR_TEXTO;
    ctx.fillText(truncar(ctx, presupuesto.cliente_nombre, xVigencia - padX - 90), padX + 82, yTextos);
  }
  ctx.font = '14px sans-serif';
  ctx.fillStyle = COLOR_TEXTO_SUAVE;
  ctx.fillText('Atendió:', padX, yTextos + 22);
  ctx.font = '600 14px sans-serif';
  ctx.fillStyle = COLOR_TEXTO;
  ctx.fillText(presupuesto.creado_por_nombre || '—', padX + 82, yTextos + 22);

  dibujarRecuadroVigencia(
    ctx, xVigencia, y, anchoVigencia, altoFila,
    `Válido hasta el ${fmtFechaCorta(presupuesto.fecha_vencimiento)}`,
    'Los precios en bolívares pueden cambiar después de esa fecha.',
    17, 12,
  );
  y += altoFila;
  trazarLinea(ctx, padX, ancho - padX, y, { color: COLOR_DIVISOR });
  y += 28;

  const cols = columnasCarta(ancho, padX);
  dibujarEncabezadoTabla(ctx, padX, y, cols, 11);
  y += 10;
  trazarLinea(ctx, padX, ancho - padX, y, { color: COLOR_TINTA, grosor: 1.5 });
  y += 24;

  const items = presupuesto.items ?? [];
  for (const item of items) {
    const { cantidadTexto, precioTexto, subtotalBs } = itemPresupuestoCantidadPrecioMonto(item);
    ctx.font = '500 14px sans-serif';
    ctx.fillStyle = COLOR_TEXTO;
    ctx.textAlign = 'left';
    ctx.fillText(truncar(ctx, item.nombre, cols.descAnchoMax), padX, y);
    ctx.textAlign = 'right';
    ctx.font = '14px sans-serif';
    ctx.fillStyle = COLOR_TEXTO_SUAVE;
    ctx.fillText(cantidadTexto, cols.cantX, y);
    ctx.fillText(precioTexto, cols.precioX, y);
    ctx.font = '600 14px sans-serif';
    ctx.fillStyle = COLOR_TEXTO;
    ctx.fillText(formatBS(subtotalBs), cols.totalX, y);
    y += 14;
    trazarLinea(ctx, padX, ancho - padX, y, { color: COLOR_DIVISOR });
    y += 20;
  }

  const tasaTxt = presupuesto.tasa_al_crear.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const yPie = y;
  ctx.font = '13px sans-serif';
  ctx.fillStyle = COLOR_TEXTO_SUAVE;
  ctx.textAlign = 'left';
  const notaPie = `Tasa del día: Bs ${tasaTxt} por 1 USD. ${resumenProductosUnidades(items)}.`;
  const anchoNotaPie = ancho - padX * 2 - 300 - 40;
  const notaPieLineas = envolverTexto(ctx, notaPie, anchoNotaPie);
  let yNota = yPie;
  for (const linea of notaPieLineas) {
    ctx.fillText(linea, padX, yNota);
    yNota += 18;
  }

  // Al revés que en el comprobante de venta: acá el dólar es lo único que
  // se sostiene hasta que esto se convierta en venta, así que es el número
  // grande. El bolívar es apenas una proyección a la tasa de hoy — texto
  // secundario. (Punto ya resuelto con Juan — no es un desvío del mockup
  // de Diseño, que sí lo muestra al revés.)
  ctx.textAlign = 'right';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = COLOR_TEXTO;
  ctx.fillText('TOTAL', ancho - padX, yPie);
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText(formatUSD(presupuesto.total_usd), ancho - padX, yPie + 34);
  ctx.font = '13px sans-serif';
  ctx.fillStyle = COLOR_TEXTO_SUAVE;
  ctx.fillText(`≈ ${formatBS(presupuesto.total_bs_estimado)}`, ancho - padX, yPie + 54);
  trazarLinea(ctx, ancho - padX - 300, ancho - padX, yPie - 18, { color: COLOR_TINTA, grosor: 2 });

  y = Math.max(yNota, yPie + 66) + 24;

  y = dibujarLeyendaFiscal(ctx, padX, ancho - padX * 2, y, {
    tamano: 14, textoDerecha: `Presupuesto #${numero} · ${fmtFechaSolo(presupuesto.creado_en)}`, tamanoDerecha: 12,
  });
  y += 30;

  return y;
}

function dibujarPresupuestoMediaCarta(ctx: CanvasRenderingContext2D, datos: DatosPresupuesto): number {
  const { negocioNombre, datosNegocio, presupuesto, numero } = datos;
  const ancho = 816;
  const padX = 40;
  dibujarBarraMarca(ctx, ancho, 4);
  ctx.textBaseline = 'alphabetic';

  const nombre = datosNegocio?.nombreComercial || negocioNombre || 'Negocio';
  const datosLinea = lineasDatosNegocio(datosNegocio).join(' · ');
  const izquierda: LineaEncabezado[] = [
    { texto: nombre, font: 'bold 18px sans-serif', color: COLOR_TEXTO, salto: 20 },
    ...(datosLinea ? [{ texto: datosLinea, font: '11.5px sans-serif', color: COLOR_TEXTO_SUAVE, salto: 16 }] : []),
  ];
  // A diferencia de carta, media carta no repite la etiqueta "PRESUPUESTO"
  // encima del número — mismo criterio que la referencia de Diseño, que
  // acá comprime el encabezado a dos líneas en vez de tres.
  const derecha: LineaEncabezado[] = [
    { texto: `Presupuesto #${numero}`, font: 'bold 17px sans-serif', color: COLOR_TEXTO, salto: 19 },
    { texto: `Emitido el ${fmtFechaSolo(presupuesto.creado_en)}`, font: '11.5px sans-serif', color: COLOR_TEXTO_SUAVE, salto: 15 },
  ];
  let y = dibujarEncabezadoDosColumnas(ctx, ancho, padX, 26 + 4, izquierda, derecha) + 14;

  const anchoVigencia = 220;
  const xVigencia = ancho - padX - anchoVigencia;
  const altoFila = 42;
  ctx.textAlign = 'left';
  ctx.font = '12px sans-serif';
  let xCursor = padX;
  if (presupuesto.cliente_nombre) {
    ctx.fillStyle = COLOR_TEXTO_SUAVE;
    ctx.fillText('Cliente: ', xCursor, y + altoFila / 2 + 4);
    xCursor += ctx.measureText('Cliente: ').width;
    ctx.font = '600 12px sans-serif';
    ctx.fillStyle = COLOR_TEXTO;
    const clienteTxt = truncar(ctx, presupuesto.cliente_nombre, xVigencia - xCursor - 100);
    ctx.fillText(clienteTxt, xCursor, y + altoFila / 2 + 4);
    xCursor += ctx.measureText(clienteTxt).width + 24;
    ctx.font = '12px sans-serif';
  }
  ctx.fillStyle = COLOR_TEXTO_SUAVE;
  ctx.fillText('Atendió: ', xCursor, y + altoFila / 2 + 4);
  xCursor += ctx.measureText('Atendió: ').width;
  ctx.font = '600 12px sans-serif';
  ctx.fillStyle = COLOR_TEXTO;
  ctx.fillText(presupuesto.creado_por_nombre || '—', xCursor, y + altoFila / 2 + 4);

  dibujarRecuadroVigencia(
    ctx, xVigencia, y, anchoVigencia, altoFila,
    `Válido hasta el ${fmtFechaCorta(presupuesto.fecha_vencimiento)}`,
    'Los precios en Bs pueden cambiar después',
    13.5, 10.5,
  );
  y += altoFila + 14;

  const cols = columnasMedia(ancho, padX);
  dibujarEncabezadoTabla(ctx, padX, y, cols, 10);
  y += 8;
  trazarLinea(ctx, padX, ancho - padX, y, { color: COLOR_TINTA, grosor: 1.5 });
  y += 18;

  const items = presupuesto.items ?? [];
  for (const item of items) {
    const { cantidadTexto, precioTexto, subtotalBs } = itemPresupuestoCantidadPrecioMonto(item);
    ctx.font = '500 12px sans-serif';
    ctx.fillStyle = COLOR_TEXTO;
    ctx.textAlign = 'left';
    ctx.fillText(truncar(ctx, item.nombre, cols.descAnchoMax), padX, y);
    ctx.textAlign = 'right';
    ctx.font = '12px sans-serif';
    ctx.fillStyle = COLOR_TEXTO_SUAVE;
    ctx.fillText(cantidadTexto, cols.cantX, y);
    ctx.fillText(precioTexto, cols.precioX, y);
    ctx.font = '600 12px sans-serif';
    ctx.fillStyle = COLOR_TEXTO;
    ctx.fillText(formatBS(subtotalBs), cols.totalX, y);
    y += 10;
    trazarLinea(ctx, padX, ancho - padX, y, { color: COLOR_DIVISOR });
    y += 16;
  }
  y += 6;

  const anchoTotales = 240;
  const xTotalesInicio = ancho - padX - anchoTotales;
  const yFilaFinal = y;

  const tasaTxt = presupuesto.tasa_al_crear.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  ctx.font = '11px sans-serif';
  ctx.fillStyle = COLOR_TEXTO_SUAVE;
  ctx.textAlign = 'left';
  ctx.fillText(`Tasa del día: Bs ${tasaTxt} por 1 USD`, padX, y);
  y += 20;
  y = dibujarLeyendaFiscal(ctx, padX, xTotalesInicio - 24 - padX, y, {
    tamano: 11.5, centrado: false, padding: 6,
  });

  ctx.textAlign = 'right';
  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = COLOR_TEXTO;
  ctx.fillText('TOTAL', ancho - padX, yFilaFinal);
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText(formatUSD(presupuesto.total_usd), ancho - padX, yFilaFinal + 26);
  ctx.font = '11.5px sans-serif';
  ctx.fillStyle = COLOR_TEXTO_SUAVE;
  ctx.fillText(`≈ ${formatBS(presupuesto.total_bs_estimado)}`, ancho - padX, yFilaFinal + 44);
  trazarLinea(ctx, xTotalesInicio, ancho - padX, yFilaFinal - 14, { color: COLOR_TINTA, grosor: 2 });

  y = Math.max(y, yFilaFinal + 54) + 12;

  return y;
}

export async function generarPresupuestoPNG(datos: DatosPresupuesto): Promise<{ blob: Blob; nombreArchivo: string }> {
  const formato = datos.datosNegocio?.formatoPresupuesto ?? 'media_carta';
  const dibujar = formato === 'carta' ? dibujarPresupuestoCarta : dibujarPresupuestoMediaCarta;
  const blob = await generarPNG(816, ctx => dibujar(ctx, datos), formato === 'carta' ? 1056 : 528);
  return { blob, nombreArchivo: `presupuesto-${datos.numero}.png` };
}

export async function compartirPresupuesto(datos: DatosPresupuesto): Promise<'compartido' | 'descargado'> {
  const { blob, nombreArchivo } = await generarPresupuestoPNG(datos);
  return compartirArchivo(blob, nombreArchivo, 'Presupuesto');
}
