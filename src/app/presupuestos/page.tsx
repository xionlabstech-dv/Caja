'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Presupuesto, Producto, ItemCarrito } from '@/types';
import { getPresupuestos, savePresupuesto, getProductos } from '@/lib/db';
import { getPresupuestoItemsRemoto } from '@/lib/sync';
import { encolarActualizarPresupuesto } from '@/lib/outbox';
import { formatBS, formatUSD } from '@/lib/precio';
import { compartirPresupuesto } from '@/lib/comprobante';
import { useApp } from '@/components/Providers';
import { useGuardarRuta } from '@/lib/useGuardarRuta';
import ThemeToggle from '@/components/ThemeToggle';

function formatearNombre(nombre: string): string {
  return nombre
    .toLowerCase()
    .split(' ')
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

// fecha_vencimiento/creado_en de un presupuesto son 'date' puros
// ('YYYY-MM-DD'): parsearlos con `new Date(iso)` a secas los interpreta en
// UTC y puede mostrar el día anterior según la zona horaria.
function fmtFechaCorta(iso: string): string {
  const [anio, mes, dia] = iso.split('-').map(Number);
  return new Date(anio, mes - 1, dia).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
}

function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const ESTADO_LABELS: Record<Presupuesto['estado'], string> = {
  vigente: 'Vigente',
  convertido: 'Convertido',
  anulado: 'Anulado',
};

const ESTADO_COLORS: Record<Presupuesto['estado'], string> = {
  vigente: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  convertido: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  anulado: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

export default function PresupuestosPage() {
  useGuardarRuta();
  const router = useRouter();
  const { negocioNombre, datosNegocio, negocioId, isOnline, productosVersion, setCarrito, setPresupuestoConvirtiendoId, setPresupuestoClienteNombre } = useApp();

  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [cargandoItems, setCargandoItems] = useState<string | null>(null);
  const [convirtiendo, setConvirtiendo] = useState<string | null>(null);
  const [compartiendo, setCompartiendo] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  const [anulando, setAnulando] = useState<Presupuesto | null>(null);
  const [motivoAnular, setMotivoAnular] = useState('');
  const [guardandoAnulacion, setGuardandoAnulacion] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  const cargar = async () => {
    setCargando(true);
    const local = await getPresupuestos();
    setPresupuestos(local);
    setCargando(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { cargar(); }, [productosVersion]);

  const abrirAnular = (p: Presupuesto) => {
    setAnulando(p);
    setMotivoAnular('');
  };

  const confirmarAnular = async () => {
    if (!anulando || !motivoAnular.trim() || !negocioId) return;
    setGuardandoAnulacion(true);
    const actualizado: Presupuesto = {
      ...anulando,
      estado: 'anulado',
      anulado_en: new Date().toISOString(),
      motivo_anulacion: motivoAnular.trim(),
      sincronizado: false,
    };
    // Offline-first: nunca requiere conexión para anular (a diferencia de
    // anular una venta, esto es un UPDATE directo sin RPC) — se aplica
    // local de inmediato y se encola.
    await savePresupuesto(actualizado);
    await encolarActualizarPresupuesto(actualizado.id, negocioId);
    setPresupuestos(prev => prev.map(p => (p.id === actualizado.id ? actualizado : p)));
    setGuardandoAnulacion(false);
    setAnulando(null);
    setMotivoAnular('');
    showToast('Presupuesto anulado');
  };

  // Los items no viajan en presupuestos_listar (solo el resumen para la
  // lista) — un presupuesto creado en otro dispositivo, o que se limpió de
  // IndexedDB, llega sin ellos. Se piden bajo demanda al expandir, mismo
  // criterio y misma función que ya usa convertirPresupuesto, y se cachean
  // en el presupuesto local para no volver a pedirlos la próxima vez.
  const alExpandir = async (p: Presupuesto) => {
    const abrir = expandido !== p.id;
    setExpandido(abrir ? p.id : null);
    if (!abrir || (p.items && p.items.length > 0) || !isOnline) return;

    setCargandoItems(p.id);
    const remotos = await getPresupuestoItemsRemoto(p.id);
    if (remotos && remotos.length > 0) {
      const actualizado = { ...p, items: remotos };
      await savePresupuesto(actualizado);
      setPresupuestos(prev => prev.map(x => (x.id === p.id ? actualizado : x)));
    }
    setCargandoItems(null);
  };

  // Disponible para cualquier presupuesto, no solo los vigentes — si no se
  // compartió al crearlo, esta es la única forma de generar el documento
  // después.
  const compartir = async (p: Presupuesto) => {
    setCompartiendo(p.id);
    try {
      // Mismo criterio que "Venta #N": correlativo por orden de creación,
      // calculado sobre lo que este dispositivo conoce.
      const ordenados = [...presupuestos].sort((a, b) => a.creado_en.localeCompare(b.creado_en));
      const numero = ordenados.findIndex(x => x.id === p.id) + 1;
      await compartirPresupuesto({
        negocioNombre: negocioNombre || '',
        datosNegocio,
        presupuesto: p,
        numero: numero > 0 ? numero : ordenados.length,
      });
    } catch {
      showToast('No se pudo generar el documento');
    } finally {
      setCompartiendo(null);
    }
  };

  const convertirPresupuesto = async (p: Presupuesto) => {
    setConvirtiendo(p.id);
    try {
      let items = p.items;
      if (!items || items.length === 0) {
        if (!isOnline) {
          showToast('Sin conexión: no se pueden cargar los datos de este presupuesto todavía');
          return;
        }
        const remotos = await getPresupuestoItemsRemoto(p.id);
        if (!remotos || remotos.length === 0) {
          showToast('No se pudieron cargar los productos de este presupuesto');
          return;
        }
        items = remotos;
        await savePresupuesto({ ...p, items });
      }

      const productosLocal = await getProductos();
      const porId = new Map(productosLocal.map(pr => [pr.id, pr]));
      const avisos: string[] = [];

      const carritoNuevo: ItemCarrito[] = items.map(item => {
        const real = item.producto_id ? porId.get(item.producto_id) : undefined;
        const esPeso = item.gramos !== undefined;
        const cantidadNecesaria = esPeso ? (item.gramos ?? 0) / 1000 : item.cantidad;

        if (!real) {
          avisos.push(`${item.nombre}: ya no está en el catálogo`);
        } else if (real.controla_stock !== false && real.stock != null && real.stock < cantidadNecesaria) {
          avisos.push(`${item.nombre}: solo quedan ${real.stock}`);
        }

        // Producto "congelado": conserva el id/stock reales del catálogo
        // (necesarios para el descuento de stock al confirmar) pero fuerza
        // el precio en USD que se cotizó — nunca el que tenga hoy el
        // catálogo, aunque haya cambiado. El bolívar se recalcula a la
        // tasa de HOY al cobrar, como cualquier producto en USD: lo
        // congelado es el dólar cotizado, no el bolívar estimado.
        // costo: null a propósito — si el producto real tenía costo
        // registrado en VES, forzar moneda 'USD' encima lo interpretaría
        // como si fuera dólares. No hay un costo "congelado" confiable acá,
        // así que se trata como no registrado en vez de arriesgar un
        // margen de ganancia incorrecto en los reportes del admin.
        const productoCongelado: Producto = real
          ? { ...real, precio: item.precioUnitarioUsd, moneda: 'USD', costo: null }
          : {
              id: item.producto_id ?? item.id,
              codigo_barra: null,
              nombre: item.nombre,
              moneda: 'USD',
              precio: item.precioUnitarioUsd,
              activo: true,
              por_peso: esPeso,
            };

        return esPeso
          ? {
              lineId: crypto.randomUUID(),
              producto: productoCongelado,
              cantidad: 1,
              esPorPeso: true,
              gramos: item.gramos,
              precioCalculadoBase: item.precioUnitarioUsd * ((item.gramos ?? 0) / 1000),
            }
          : { lineId: crypto.randomUUID(), producto: productoCongelado, cantidad: item.cantidad };
      });

      // Nunca bloquea la conversión — el cajero decide cómo seguir (quitar
      // esa línea, avisar al cliente, lo que corresponda).
      if (avisos.length > 0) showToast(avisos.join(' · '));

      setCarrito(carritoNuevo);
      setPresupuestoConvirtiendoId(p.id);
      // No une clientes_fiado con presupuestos (son tablas distintas a
      // propósito) — solo le ahorra al cajero escribir de nuevo el nombre
      // que ya se cotizó si elige fiar parte de esta venta.
      setPresupuestoClienteNombre(p.cliente_nombre ?? null);
      router.push('/');
    } finally {
      setConvirtiendo(null);
    }
  };

  const hoy = hoyISO();

  return (
    <div>
      <header className="bg-emerald-600 text-white px-4 pt-4 pb-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Presupuestos</h1>
          <p className="text-emerald-200 text-sm">Cotizaciones para clientes</p>
        </div>
        <ThemeToggle />
      </header>

      <div className="p-4 space-y-4">
        <button
          onClick={() => router.push('/presupuestos/nuevo')}
          className="w-full bg-emerald-600 text-white py-3.5 rounded-xl font-bold flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nuevo presupuesto
        </button>

        {cargando ? (
          <div className="text-center text-gray-400 py-16">
            <svg className="w-8 h-8 mx-auto mb-3 text-emerald-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : presupuestos.length === 0 ? (
          <div className="text-center text-gray-400 py-12">
            <p className="font-medium">Sin presupuestos todavía</p>
          </div>
        ) : (
          <div className="space-y-2">
            {presupuestos.map(p => {
              const vencido = p.estado === 'vigente' && p.fecha_vencimiento < hoy;
              const isOpen = expandido === p.id;
              return (
                <div key={p.id} className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between p-4 text-left"
                    onClick={() => alExpandir(p)}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-800 dark:text-white truncate">
                        {p.cliente_nombre ? formatearNombre(p.cliente_nombre) : 'Sin nombre de cliente'}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ESTADO_COLORS[p.estado]}`}>
                          {ESTADO_LABELS[p.estado]}
                        </span>
                        {vencido && (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                            Vencido
                          </span>
                        )}
                        <span className="text-xs text-gray-400">Vence {fmtFechaCorta(p.fecha_vencimiento)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="text-right">
                        <p className="font-bold text-gray-900 dark:text-white">{formatUSD(p.total_usd)}</p>
                        <p className="text-xs text-gray-400">{formatBS(p.total_bs_estimado)}</p>
                      </div>
                      <svg
                        className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-gray-100 dark:border-slate-700 px-4 pb-4 pt-3 space-y-2">
                      {cargandoItems === p.id ? (
                        <p className="text-xs text-gray-400 py-1">Cargando...</p>
                      ) : !p.items || p.items.length === 0 ? (
                        <p className="text-xs text-gray-400 py-1">
                          {isOnline ? 'Sin detalle disponible' : 'Sin conexión — hace falta señal para ver el detalle'}
                        </p>
                      ) : (
                        p.items.map(item => (
                          <div key={item.id} className="flex justify-between text-sm">
                            <span className="text-gray-600 dark:text-gray-300">
                              {item.gramos !== undefined ? `${item.gramos}g ` : `${item.cantidad}× `}
                              {formatearNombre(item.nombre)}
                            </span>
                            <span className="font-medium text-gray-700 dark:text-gray-200">
                              {formatBS(
                                item.gramos !== undefined
                                  ? item.precioUnitarioBs * (item.gramos / 1000)
                                  : item.precioUnitarioBs * item.cantidad
                              )}
                            </span>
                          </div>
                        ))
                      )}
                      <div className="border-t border-gray-100 dark:border-slate-700 pt-2 flex justify-between text-sm">
                        <span className="text-gray-500">Equivalente</span>
                        <span className="text-gray-600 dark:text-gray-300">{formatUSD(p.total_usd)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Creado por</span>
                        <span className="text-gray-600 dark:text-gray-300">{p.creado_por_nombre || '—'}</span>
                      </div>

                      {p.estado === 'anulado' && (
                        <p className="text-sm text-red-700 bg-red-50 dark:bg-red-900/20 dark:text-red-400 rounded-lg px-2.5 py-2 mt-1">
                          Motivo: {p.motivo_anulacion || '—'}
                        </p>
                      )}

                      <button
                        onClick={() => compartir(p)}
                        disabled={compartiendo === p.id}
                        className="w-full py-2.5 rounded-xl text-sm font-semibold bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200 disabled:opacity-50 mt-1"
                      >
                        {compartiendo === p.id ? 'Generando...' : 'Compartir'}
                      </button>

                      {p.estado === 'vigente' && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => convertirPresupuesto(p)}
                            disabled={convirtiendo === p.id}
                            className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-emerald-600 text-white disabled:opacity-50"
                          >
                            {convirtiendo === p.id ? 'Cargando...' : 'Convertir en venta'}
                          </button>
                          <button
                            onClick={() => abrirAnular(p)}
                            className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-50 text-red-600"
                          >
                            Anular
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Anular presupuesto */}
      {anulando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => { if (!guardandoAnulacion) setAnulando(null); }} />
          <div className="relative bg-white dark:bg-slate-800 rounded-2xl w-full max-w-sm shadow-xl overflow-hidden">
            <div className="p-5">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Anular presupuesto</h2>
              <p className="text-sm text-gray-500 mb-4">
                {anulando.cliente_nombre ? formatearNombre(anulando.cliente_nombre) : 'Sin nombre de cliente'} · {formatBS(anulando.total_bs_estimado)}
              </p>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Motivo</label>
              <textarea
                value={motivoAnular}
                onChange={e => setMotivoAnular(e.target.value)}
                rows={3}
                className="w-full border border-gray-200 dark:border-slate-600 rounded-xl px-3 py-2 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-400"
                placeholder="Ej: El cliente ya no lo necesita"
                autoFocus
              />
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => setAnulando(null)}
                  disabled={guardandoAnulacion}
                  className="flex-1 py-3 rounded-xl bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200 font-semibold disabled:opacity-40"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmarAnular}
                  disabled={guardandoAnulacion || !motivoAnular.trim()}
                  className="flex-1 py-3 rounded-xl bg-red-600 text-white font-bold disabled:opacity-40"
                >
                  {guardandoAnulacion ? 'Anulando...' : 'Anular'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-5 py-2.5 rounded-xl text-sm font-medium z-50 shadow-lg max-w-xs text-center">
          {toast}
        </div>
      )}
    </div>
  );
}
