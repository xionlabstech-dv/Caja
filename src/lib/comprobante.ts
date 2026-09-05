import { Venta, MetodoPago } from '@/types';
import { formatBS, formatUSD } from './precio';

// Comprobante de venta — NUNCA un documento fiscal (ver la leyenda que se
// dibuja en el propio comprobante). Se genera como imagen PNG dibujada a
// mano en un <canvas>, no como PDF: el proyecto no tenía ninguna librería
// de PDF instalada y esta es una PWA que corre en teléfonos de gama baja
// con mala señal — una imagen pesa menos, no agrega dependencias al bundle,
// y además se previsualiza mejor dentro del chat de WhatsApp que un PDF.
export interface DatosComprobante {
  negocioNombre: string;
  venta: Venta;
  numero: number;
}

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

// Dibuja el comprobante completo empezando en y=0 y devuelve el alto real
// que ocupó el contenido. Se llama dos veces (ver generarComprobantePNG):
// una para medir sobre un canvas provisional bien alto, y otra sobre el
// canvas final ya con ese alto exacto — es una función pura del contenido
// de la venta, así que dibujar dos veces da siempre el mismo resultado.
function dibujarComprobante(ctx: CanvasRenderingContext2D, ancho: number, datos: DatosComprobante): number {
  const { negocioNombre, venta, numero } = datos;
  const centroX = ancho / 2;
  let y = 32;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ancho, 6000);
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = '#111827';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(negocioNombre || 'Negocio', centroX, y);
  y += 30;

  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('Comprobante de venta', centroX, y);
  y += 20;

  ctx.font = 'italic 11px sans-serif';
  ctx.fillStyle = '#6b7280';
  ctx.fillText('Este documento no tiene validez fiscal', centroX, y);
  y += 20;

  if (venta.anulada) {
    y += 6;
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(PAD, y - 15, ancho - PAD * 2, 26);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px sans-serif';
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
  // Pase 1: mide el alto real dibujando sobre un canvas provisional bien
  // alto — dibujarComprobante es una función pura del contenido, así que
  // el resultado es idéntico al del pase final.
  const medidor = document.createElement('canvas');
  medidor.width = ANCHO;
  medidor.height = 4000;
  const ctxMedidor = medidor.getContext('2d');
  if (!ctxMedidor) throw new Error('No se pudo generar el comprobante');
  const altoFinal = dibujarComprobante(ctxMedidor, ANCHO, datos);

  // Pase 2: canvas del tamaño exacto, escalado ×2 para que se vea nítido
  // aunque lo abran con zoom en WhatsApp.
  const canvas = document.createElement('canvas');
  canvas.width = ANCHO * ESCALA;
  canvas.height = Math.ceil(altoFinal) * ESCALA;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo generar el comprobante');
  ctx.scale(ESCALA, ESCALA);
  dibujarComprobante(ctx, ANCHO, datos);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('No se pudo generar el comprobante'))), 'image/png');
  });

  // Nunca "factura" en el nombre del archivo — regla del proyecto.
  return { blob, nombreArchivo: `comprobante-venta-${datos.numero}.png` };
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

// Comparte por el share sheet nativo (WhatsApp, Telegram, correo, guardar
// archivo — lo que sea que el sistema operativo ofrezca) cuando está
// disponible. Nunca deja al usuario sin salida: si navigator.share no
// existe o no soporta archivos (escritorio, navegador viejo), descarga el
// archivo directo.
export async function compartirComprobante(datos: DatosComprobante): Promise<'compartido' | 'descargado'> {
  const { blob, nombreArchivo } = await generarComprobantePNG(datos);
  const archivo = new File([blob], nombreArchivo, { type: 'image/png' });

  const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
  const puedeCompartirArchivo =
    typeof nav.share === 'function' &&
    (typeof nav.canShare !== 'function' || nav.canShare({ files: [archivo] }));

  if (puedeCompartirArchivo) {
    try {
      await nav.share({ files: [archivo], title: 'Comprobante de venta' });
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
