import { Venta, MetodoPago, Presupuesto, DatosNegocio } from '@/types';
import { formatBS, formatUSD } from './precio';

// Documentos de venta y de presupuesto — NUNCA fiscales (ver la leyenda que
// se dibuja en cada uno). Se generan como imagen PNG dibujada a mano en un
// <canvas>, no como PDF: el proyecto no tenía ninguna librería de PDF
// instalada y esta es una PWA que corre en teléfonos de gama baja con mala
// señal — una imagen pesa menos, no agrega dependencias al bundle, y además
// se previsualiza mejor dentro del chat de WhatsApp que un PDF.

const METODO_LABELS: Record<MetodoPago, string> = {
  efectivo_bs: 'Efectivo Bs',
  pago_movil: 'Pago Móvil',
  biopago: 'Biopago',
  tarjeta: 'Tarjeta',
  efectivo_usd: 'Efectivo $',
  fiado: 'Fiado',
};

const ANCHO = 560;
const PAD = 24;
const ESCALA = 2;

function trazarLinea(ctx: CanvasRenderingContext2D, ancho: number, y: number) {
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(ancho - PAD, y);
  ctx.stroke();
}

function truncar(ctx: CanvasRenderingContext2D, texto: string, anchoMax: number): string {
  if (ctx.measureText(texto).width <= anchoMax) return texto;
  let corto = texto;
  while (corto.length > 1 && ctx.measureText(corto + '…').width > anchoMax) {
    corto = corto.slice(0, -1);
  }
  return corto + '…';
}

// Encabezado compartido por los dos documentos: negocio + título + leyenda
// de no validez fiscal. Devuelve el y donde sigue el resto del contenido.
function dibujarEncabezado(ctx: CanvasRenderingContext2D, ancho: number, negocioNombre: string, titulo: string): number {
  const centroX = ancho / 2;
  let y = 32;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ancho, 8000);
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = '#111827';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(negocioNombre || 'Negocio', centroX, y);
  y += 30;

  ctx.font = 'bold 16px sans-serif';
  ctx.fillText(titulo, centroX, y);
  y += 20;

  ctx.font = 'italic 11px sans-serif';
  ctx.fillStyle = '#6b7280';
  ctx.fillText('Este documento no tiene validez fiscal', centroX, y);
  y += 20;

  return y;
}

// Genera el PNG final en dos pasadas: la primera mide el alto real
// dibujando sobre un canvas provisional bien alto (dibujar es una función
// pura del contenido, así que el resultado es idéntico), la segunda dibuja
// sobre un canvas ya del tamaño exacto, escalado ×2 para que se vea nítido
// aunque lo abran con zoom en WhatsApp.
async function generarPNG(dibujar: (ctx: CanvasRenderingContext2D, ancho: number) => number): Promise<Blob> {
  const medidor = document.createElement('canvas');
  medidor.width = ANCHO;
  medidor.height = 8000;
  const ctxMedidor = medidor.getContext('2d');
  if (!ctxMedidor) throw new Error('No se pudo generar el documento');
  const altoFinal = dibujar(ctxMedidor, ANCHO);

  const canvas = document.createElement('canvas');
  canvas.width = ANCHO * ESCALA;
  canvas.height = Math.ceil(altoFinal) * ESCALA;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo generar el documento');
  ctx.scale(ESCALA, ESCALA);
  dibujar(ctx, ANCHO);

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

// --- Comprobante de venta ---

export interface DatosComprobante {
  negocioNombre: string;
  venta: Venta;
  numero: number;
}

function dibujarComprobante(ctx: CanvasRenderingContext2D, ancho: number, datos: DatosComprobante): number {
  const { negocioNombre, venta, numero } = datos;
  const centroX = ancho / 2;
  let y = dibujarEncabezado(ctx, ancho, negocioNombre, 'Comprobante de venta');

  if (venta.anulada) {
    y += 6;
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(PAD, y - 15, ancho - PAD * 2, 26);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('VENTA ANULADA', centroX, y + 3);
    y += 30;

    if (venta.motivo_anulacion) {
      // Discreto a propósito — el banner de arriba ya dice lo importante
      // (que se anuló); esto es el detalle para quien quiera leerlo.
      ctx.font = 'italic 10px sans-serif';
      ctx.fillStyle = '#6b7280';
      ctx.textAlign = 'center';
      const motivoLinea = truncar(ctx, `Motivo: ${venta.motivo_anulacion}`, ancho - PAD * 2);
      ctx.fillText(motivoLinea, centroX, y);
      y += 16;
    }
  }

  y += 8;
  trazarLinea(ctx, ancho, y);
  y += 22;

  ctx.textAlign = 'left';
  ctx.fillStyle = '#374151';
  ctx.font = '12px sans-serif';
  const fecha = new Date(venta.fecha).toLocaleString('es-VE', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  ctx.fillText(fecha, PAD, y);
  ctx.textAlign = 'right';
  ctx.fillText(`Venta #${numero}`, ancho - PAD, y);
  y += 20;

  ctx.textAlign = 'left';
  ctx.fillStyle = '#6b7280';
  ctx.font = '11px sans-serif';
  ctx.fillText(`Atendió: ${venta.usuario_nombre || '—'}`, PAD, y);
  y += 18;

  trazarLinea(ctx, ancho, y);
  y += 24;

  for (const item of venta.items) {
    const esPeso = item.gramos !== undefined;
    const etiquetaCantidad = esPeso ? `${item.gramos}g` : `${item.cantidad}×`;

    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#111827';
    ctx.textAlign = 'left';
    const nombreLinea = truncar(ctx, `${etiquetaCantidad} ${item.nombre}`, ancho - PAD * 2 - 90);
    ctx.fillText(nombreLinea, PAD, y);
    ctx.textAlign = 'right';
    ctx.fillText(formatBS(item.subtotal_bs), ancho - PAD, y);
    y += 16;

    const detalleUnitario = esPeso
      ? `${formatBS(item.precioUnitarioBs)} / kg`
      : item.cantidad > 1
        ? `${formatBS(item.precioUnitarioBs)} c/u`
        : '';
    if (detalleUnitario) {
      ctx.font = '10px sans-serif';
      ctx.fillStyle = '#9ca3af';
      ctx.textAlign = 'left';
      ctx.fillText(detalleUnitario, PAD, y);
      y += 14;
    }
    y += 6;
  }

  trazarLinea(ctx, ancho, y);
  y += 28;

  ctx.textAlign = 'center';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillStyle = '#111827';
  ctx.fillText(formatBS(venta.total_bs), centroX, y);
  y += 22;

  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#6b7280';
  ctx.fillText(formatUSD(venta.total_usd), centroX, y);
  y += 20;

  ctx.font = '11px sans-serif';
  ctx.fillText(
    `Tasa: Bs ${venta.tasa_usada.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} por $`,
    centroX, y
  );
  y += 26;

  trazarLinea(ctx, ancho, y);
  y += 22;

  ctx.textAlign = 'left';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#374151';
  ctx.fillText('Forma de pago', PAD, y);
  y += 20;

  for (const pago of venta.pagos) {
    const esFiado = pago.metodo === 'fiado';
    ctx.font = '12px sans-serif';
    ctx.fillStyle = esFiado ? '#c2410c' : '#111827';
    ctx.textAlign = 'left';
    ctx.fillText(METODO_LABELS[pago.metodo], PAD, y);
    ctx.textAlign = 'right';
    ctx.fillText(formatBS(pago.monto_bs), ancho - PAD, y);
    y += 16;
    if (esFiado) {
      ctx.font = 'italic 10px sans-serif';
      ctx.fillStyle = '#c2410c';
      ctx.textAlign = 'left';
      ctx.fillText('Pendiente de pago', PAD, y);
      y += 16;
    }
  }

  y += 12;
  return y;
}

export async function generarComprobantePNG(datos: DatosComprobante): Promise<{ blob: Blob; nombreArchivo: string }> {
  const blob = await generarPNG((ctx, ancho) => dibujarComprobante(ctx, ancho, datos));
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

function fmtFechaCorta(iso: string): string {
  // fecha_vencimiento es un date puro ('YYYY-MM-DD'): parsearlo con `new
  // Date(iso)` a secas lo interpreta en UTC y puede mostrar el día anterior
  // según la zona horaria — se arma la fecha local a mano para evitarlo.
  const [anio, mes, dia] = iso.split('-').map(Number);
  return new Date(anio, mes - 1, dia).toLocaleDateString('es-VE', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

// Debajo del nombre del negocio, los datos de contacto que estén cargados
// — nunca los cuatro fijos: el que falte simplemente no ocupa una línea,
// no hay "No especificado" ni renglones en blanco.
function dibujarDatosNegocio(ctx: CanvasRenderingContext2D, ancho: number, y: number, datos?: DatosNegocio): number {
  if (!datos) return y;
  const lineas: string[] = [];
  if (datos.direccion?.trim()) lineas.push(datos.direccion.trim());
  if (datos.telefono?.trim()) lineas.push(datos.telefono.trim());
  if (datos.correo?.trim()) lineas.push(datos.correo.trim());
  if (datos.rif?.trim()) lineas.push(`RIF: ${datos.rif.trim()}`);
  if (lineas.length === 0) return y;

  ctx.textAlign = 'center';
  ctx.font = '10px sans-serif';
  ctx.fillStyle = '#6b7280';
  for (const linea of lineas) {
    ctx.fillText(linea, ancho / 2, y);
    y += 13;
  }
  return y + 4;
}

// Columnas de la tabla de items — Descripción / Cantidad / Precio unitario
// / Total, en vez de la lista simple de antes. Los bordes derechos de cada
// columna (el texto crece hacia la izquierda desde ahí).
const COL_CANT_X = ANCHO - PAD - 180;
const COL_PRECIO_X = ANCHO - PAD - 90;
const COL_TOTAL_X = ANCHO - PAD;
const COL_DESC_ANCHO_MAX = COL_CANT_X - PAD - 10;

function dibujarPresupuesto(ctx: CanvasRenderingContext2D, ancho: number, datos: DatosPresupuesto): number {
  const { negocioNombre, datosNegocio, presupuesto, numero } = datos;
  const centroX = ancho / 2;
  let y = dibujarEncabezado(ctx, ancho, negocioNombre, 'Presupuesto');
  y = dibujarDatosNegocio(ctx, ancho, y, datosNegocio);

  // La fecha de vencimiento es lo que le avisa al cliente que el precio en
  // bolívares no es eterno — se destaca en un recuadro, no como una línea
  // más de texto.
  y += 6;
  ctx.fillStyle = '#fff7ed';
  ctx.fillRect(PAD, y - 15, ancho - PAD * 2, 26);
  ctx.fillStyle = '#c2410c';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`Válido hasta el ${fmtFechaCorta(presupuesto.fecha_vencimiento)}`, centroX, y + 3);
  y += 30;

  y += 8;
  trazarLinea(ctx, ancho, y);
  y += 22;

  ctx.textAlign = 'left';
  ctx.fillStyle = '#374151';
  ctx.font = '12px sans-serif';
  const fechaCreacion = new Date(presupuesto.creado_en).toLocaleDateString('es-VE', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
  ctx.fillText(fechaCreacion, PAD, y);
  ctx.textAlign = 'right';
  ctx.fillText(`Presupuesto #${numero}`, ancho - PAD, y);
  y += 20;

  // Etiqueta delante del nombre — sin esto el dato quedaba pelado, sin
  // decir qué es.
  if (presupuesto.cliente_nombre) {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#374151';
    ctx.font = '12px sans-serif';
    const clienteLinea = truncar(ctx, `Cliente: ${presupuesto.cliente_nombre}`, ancho - PAD * 2);
    ctx.fillText(clienteLinea, PAD, y);
    y += 20;
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = '#6b7280';
  ctx.font = '11px sans-serif';
  ctx.fillText(`Atendió: ${presupuesto.creado_por_nombre || '—'}`, PAD, y);
  y += 18;

  trazarLinea(ctx, ancho, y);
  y += 20;

  ctx.font = 'bold 10px sans-serif';
  ctx.fillStyle = '#9ca3af';
  ctx.textAlign = 'left';
  ctx.fillText('DESCRIPCIÓN', PAD, y);
  ctx.textAlign = 'right';
  ctx.fillText('CANT.', COL_CANT_X, y);
  ctx.fillText('P. UNIT.', COL_PRECIO_X, y);
  ctx.fillText('TOTAL', COL_TOTAL_X, y);
  y += 12;
  trazarLinea(ctx, ancho, y);
  y += 20;

  for (const item of presupuesto.items ?? []) {
    const esPeso = item.gramos !== undefined;
    const subtotalBs = esPeso
      ? item.precioUnitarioBs * ((item.gramos ?? 0) / 1000)
      : item.precioUnitarioBs * item.cantidad;
    const cantidadTexto = esPeso ? `${item.gramos}g` : `${item.cantidad}`;
    const precioTexto = esPeso ? `${formatBS(item.precioUnitarioBs)}/kg` : formatBS(item.precioUnitarioBs);

    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#111827';
    ctx.textAlign = 'left';
    ctx.fillText(truncar(ctx, item.nombre, COL_DESC_ANCHO_MAX), PAD, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#374151';
    ctx.fillText(cantidadTexto, COL_CANT_X, y);
    ctx.fillText(precioTexto, COL_PRECIO_X, y);
    ctx.fillStyle = '#111827';
    ctx.fillText(formatBS(subtotalBs), COL_TOTAL_X, y);
    y += 20;
  }

  trazarLinea(ctx, ancho, y);
  y += 28;

  // Al revés que en el comprobante de venta: acá el dólar es lo único que
  // se sostiene hasta que esto se convierta en venta, así que es el número
  // grande. El bolívar es apenas una proyección a la tasa de hoy — texto
  // secundario, con su propia aclaración de por qué puede cambiar.
  ctx.textAlign = 'center';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillStyle = '#111827';
  ctx.fillText(formatUSD(presupuesto.total_usd), centroX, y);
  y += 22;

  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#6b7280';
  ctx.fillText(formatBS(presupuesto.total_bs_estimado), centroX, y);
  y += 16;

  ctx.font = 'italic 10px sans-serif';
  ctx.fillStyle = '#9ca3af';
  ctx.fillText('Bs estimado a la tasa de hoy — se recalcula el día del pago', centroX, y);
  y += 18;

  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#6b7280';
  ctx.fillText(
    `Tasa: Bs ${presupuesto.tasa_al_crear.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} por $`,
    centroX, y
  );
  y += 20;

  return y;
}

export async function generarPresupuestoPNG(datos: DatosPresupuesto): Promise<{ blob: Blob; nombreArchivo: string }> {
  const blob = await generarPNG((ctx, ancho) => dibujarPresupuesto(ctx, ancho, datos));
  return { blob, nombreArchivo: `presupuesto-${datos.numero}.png` };
}

export async function compartirPresupuesto(datos: DatosPresupuesto): Promise<'compartido' | 'descargado'> {
  const { blob, nombreArchivo } = await generarPresupuestoPNG(datos);
  return compartirArchivo(blob, nombreArchivo, 'Presupuesto');
}
