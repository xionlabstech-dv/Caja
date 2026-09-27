'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Producto, MovimientoStock, TipoMovimiento, MotivoMovimiento } from '@/types';
import { getProductos, saveMovimiento, getMovimientos, actualizarStockLocal } from '@/lib/db';
import { encolarAplicarMovimientoStock } from '@/lib/outbox';
import { getMovimientosRemoto, aplicarMovimientoStockRemoto } from '@/lib/sync';
import { TipoUI, TIPO_TAB_LABELS, MOTIVOS } from '@/lib/tiposMovimiento';
import { useApp } from '@/components/Providers';
import { useGuardarRuta } from '@/lib/useGuardarRuta';
import Scanner from '@/components/Scanner';
import ThemeToggle from '@/components/ThemeToggle';
import Icon from '@/components/ui/Icon';
import { TAMANO_ICONO } from '@/components/ui/iconos';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import BottomSheet from '@/components/ui/BottomSheet';
import ChipFiltro from '@/components/ui/ChipFiltro';

function formatearNombre(nombre: string): string {
  return nombre
    .toLowerCase()
    .split(' ')
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

function fmtFecha(iso: string) {
  return new Date(iso).toLocaleDateString('es-VE', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function fmtCantidad(n: number) {
  return n.toLocaleString('es-VE', { maximumFractionDigits: 3 });
}

const TIPO_LABELS: Record<TipoMovimiento, string> = {
  entrada: 'Entrada', salida: 'Salida', ajuste: 'Ajuste', venta: 'Venta', anulacion: 'Anulación',
};

const MOTIVO_LABELS: Record<MotivoMovimiento, string> = {
  compra: 'Compra',
  devolucion_cliente: 'Devolución de cliente',
  consumo_propio: 'Consumo propio',
  dano: 'Daño',
  vencido: 'Vencido',
  perdida: 'Pérdida',
  devolucion_proveedor: 'Devolución a proveedor',
  conteo_fisico: 'Conteo físico',
  correccion: 'Corrección',
  venta: 'Venta',
};

// El motivo de un movimiento 'anulacion' es texto libre (lo que el admin
// escribió al anular la venta), no uno de los valores fijos de arriba —
// se muestra tal cual cuando no matchea ninguno de esos valores conocidos.
function motivoLabel(motivo: string): string {
  return MOTIVO_LABELS[motivo as MotivoMovimiento] ?? motivo;
}

const TIPO_COLORS: Record<TipoMovimiento, string> = {
  entrada: 'bg-marca-suave text-marca-suave-texto',
  salida: 'bg-negativo-fondo text-negativo',
  ajuste: 'bg-informativo-fondo text-informativo',
  venta: 'bg-tarjeta-hundida text-texto-2',
  anulacion: 'bg-aviso-fondo text-aviso',
};

export default function MovimientosPage() {
  const permitida = useGuardarRuta();
  const router = useRouter();
  const { negocioId, isOnline, user, userNombre } = useApp();

  const [productos, setProductos] = useState<Producto[]>([]);
  const [movimientos, setMovimientos] = useState<MovimientoStock[]>([]);
  const [cargando, setCargando] = useState(true);
  const [soloDispositivo, setSoloDispositivo] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [productoSel, setProductoSel] = useState<Producto | null>(null);
  const [busquedaProducto, setBusquedaProducto] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [tipo, setTipo] = useState<TipoUI>('entrada');
  const [motivo, setMotivo] = useState<MotivoMovimiento>('compra');
  const [cantidad, setCantidad] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const [filtroProductoId, setFiltroProductoId] = useState<string>('');
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const cargar = async () => {
    setCargando(true);
    const [prods, movsLocal] = await Promise.all([getProductos(), getMovimientos()]);
    setProductos(prods);

    // Igual que en Resumen: base offline-first (lo local siempre se
    // muestra), completado con el resto del negocio cuando hay red — un
    // admin necesita ver movimientos hechos en otros dispositivos, no solo
    // los de este.
    let final = movsLocal;
    let completo = false;
    if (isOnline && negocioId) {
      const remotos = await getMovimientosRemoto(negocioId);
      if (remotos !== null) {
        completo = true;
        const porId = new Map(movsLocal.map(m => [m.id, m]));
        for (const r of remotos) {
          if (!porId.has(r.id)) porId.set(r.id, r);
        }
        final = Array.from(porId.values()).sort((a, b) => b.ocurrido_en.localeCompare(a.ocurrido_en));
      }
    }
    setMovimientos(final);
    setSoloDispositivo(!completo);
    setCargando(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { cargar(); }, [isOnline]);

  if (!permitida) return null;

  const abrirForm = () => {
    setProductoSel(null);
    setBusquedaProducto('');
    setTipo('entrada');
    setMotivo('compra');
    setCantidad('');
    setNota('');
    setError('');
    setShowForm(true);
  };

  const cambiarTipo = (t: TipoUI) => {
    setTipo(t);
    setMotivo(MOTIVOS[t][0].value);
    setCantidad('');
    setError('');
  };

  const productosFiltrados = busquedaProducto.trim()
    ? productos
        .filter(p =>
          p.nombre.toLowerCase().includes(busquedaProducto.toLowerCase()) ||
          (p.codigo_barra && p.codigo_barra.includes(busquedaProducto))
        )
        .slice(0, 8)
    : [];

  const handleScanProducto = (codigo: string) => {
    setShowScanner(false);
    const p = productos.find(x => x.codigo_barra === codigo);
    if (p) {
      setProductoSel(p);
      setBusquedaProducto('');
    } else {
      showToast('Código no encontrado');
    }
  };

  // Ajuste por conteo: lo que se ingresa es la cantidad REAL contada, no la
  // diferencia — la app la calcula sola contra la existencia actual.
  const cantidadNum = parseFloat(cantidad);
  const stockActualSel = productoSel?.stock ?? 0;
  const diferenciaConteo =
    tipo === 'ajuste' && cantidad.trim() && !isNaN(cantidadNum) ? cantidadNum - stockActualSel : null;

  const guardarMovimiento = async () => {
    if (!productoSel) { setError('Selecciona un producto'); return; }
    if (!negocioId) return;
    if (!cantidad.trim() || isNaN(cantidadNum)) { setError('Ingresa una cantidad válida'); return; }
    if (tipo !== 'ajuste' && cantidadNum <= 0) { setError('La cantidad debe ser mayor a 0'); return; }

    let cantidadAplicada: number;
    if (tipo === 'ajuste') {
      cantidadAplicada = diferenciaConteo ?? 0;
      if (cantidadAplicada === 0) {
        setError('El conteo coincide con la existencia actual — no hay nada que ajustar');
        return;
      }
    } else {
      cantidadAplicada = tipo === 'entrada' ? cantidadNum : -cantidadNum;
    }

    setGuardando(true);
    setError('');

    const now = new Date().toISOString();
    const stockDespues = (productoSel.stock ?? 0) + cantidadAplicada;
    const movimiento: MovimientoStock = {
      id: crypto.randomUUID(),
      producto_id: productoSel.id,
      producto_nombre: productoSel.nombre,
      tipo,
      motivo,
      cantidad: cantidadAplicada,
      stock_resultante: stockDespues,
      usuario_id: user?.id,
      usuario_nombre: userNombre || undefined,
      nota: nota.trim() || undefined,
      ocurrido_en: now,
      sincronizado: false,
    };

    // Optimista, igual que una venta o un cierre: el movimiento ya ocurrió
    // en la realidad (llegó mercancía, se dañó algo, se contó el estante) —
    // se aplica local de inmediato y nunca se revierte solo porque la red
    // falle en ese instante. Si falla la confirmación, queda encolado.
    await saveMovimiento(movimiento);
    await actualizarStockLocal(productoSel.id, stockDespues);

    if (!isOnline) {
      await encolarAplicarMovimientoStock(movimiento.id, negocioId);
      setGuardando(false);
      setShowForm(false);
      await cargar();
      showToast('Guardado localmente — se sincronizará cuando haya conexión');
      return;
    }

    const resultado = await aplicarMovimientoStockRemoto(movimiento);
    setGuardando(false);

    if (resultado.permanente) {
      // El servidor respondió y rechazó el movimiento de forma definitiva —
      // no tiene sentido encolarlo para reintentar algo que ya sabemos que
      // va a volver a fallar. El movimiento ya aplicado localmente se deja
      // como está (mismo criterio que una venta: ya ocurrió en la realidad).
      showToast(`No se pudo registrar: ${resultado.mensaje ?? 'el servidor lo rechazó'}`);
      setShowForm(false);
      await cargar();
      return;
    }

    if (!resultado.ok) {
      await encolarAplicarMovimientoStock(movimiento.id, negocioId);
      setShowForm(false);
      await cargar();
      showToast('Guardado localmente — no se pudo confirmar con el servidor todavía, se reintentará');
      return;
    }

    await saveMovimiento({ ...movimiento, sincronizado: true, stock_resultante: resultado.nuevoStock });
    setShowForm(false);
    await cargar();
    showToast('Movimiento registrado');
  };

  const movimientosFiltrados = filtroProductoId
    ? movimientos.filter(m => m.producto_id === filtroProductoId)
    : movimientos;

  return (
    <div>
      <header className="bg-superficie-barra border-b border-borde-divisor px-4 pt-3.5 pb-3 flex items-center gap-2">
        <button onClick={() => router.back()} className="p-1 -ml-1 flex-shrink-0 text-texto-3" aria-label="Volver">
          <Icon nombre="flechaAbajo" tamano={TAMANO_ICONO.buscarYToggle} className="rotate-90" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-texto truncate">Movimientos</h1>
          <p className="text-[11px] font-medium text-texto-3 truncate">Entradas, salidas y ajustes de inventario</p>
        </div>
        <ThemeToggle variant="neutro" />
      </header>

      {!isOnline && (
        <div className="mx-4 mt-3 p-2.5 bg-tarjeta-hundida border border-borde-campo rounded-xl text-texto-2 text-xs text-center">
          Sin conexión — los movimientos se guardan en el dispositivo y se sincronizan al reconectar
        </div>
      )}

      <div className="p-4 space-y-4">
        <Button variante="primario" onClick={abrirForm} className="w-full">
          <Icon nombre="agregar" tamano={TAMANO_ICONO.buscarYToggle} />
          Registrar movimiento
        </Button>

        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-texto-2">Historial</h2>
          {productos.length > 0 && (
            <select
              value={filtroProductoId}
              onChange={e => setFiltroProductoId(e.target.value)}
              className="h-[34px] px-3 rounded-lg border border-borde-campo bg-tarjeta text-texto-2 text-xs font-semibold outline-none focus:border-foco"
            >
              <option value="">Todos los productos</option>
              {productos.map(p => (
                <option key={p.id} value={p.id}>{formatearNombre(p.nombre)}</option>
              ))}
            </select>
          )}
        </div>

        {soloDispositivo && (
          <div className="p-2.5 bg-tarjeta-hundida border border-borde-campo rounded-xl text-texto-2 text-xs text-center">
            Mostrando solo los movimientos de este dispositivo — puede haber más de otros usuarios
          </div>
        )}

        {cargando ? (
          <div className="text-center text-texto-4 py-16">
            <Icon nombre="cargando" tamano={32} className="mx-auto mb-3 text-marca animate-spin" />
          </div>
        ) : movimientosFiltrados.length === 0 ? (
          <div className="text-center text-texto-4 py-12">
            <p className="font-medium">Sin movimientos registrados</p>
          </div>
        ) : (
          <div className="space-y-2">
            {movimientosFiltrados.map(m => (
              <div key={m.id} className="bg-tarjeta rounded-2xl border border-borde-tarjeta p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-texto truncate">
                      {formatearNombre(m.producto_nombre)}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TIPO_COLORS[m.tipo]}`}>
                        {TIPO_LABELS[m.tipo]}
                      </span>
                      <span className="text-xs text-texto-4">{motivoLabel(m.motivo)}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`font-bold text-sm ${m.cantidad >= 0 ? 'text-marca' : 'text-negativo'}`}>
                      {m.cantidad >= 0 ? '+' : ''}{fmtCantidad(m.cantidad)}
                    </p>
                    {m.stock_resultante != null && (
                      <p className="text-xs text-texto-4">→ {fmtCantidad(m.stock_resultante)}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-borde-divisor text-xs text-texto-4">
                  <span>{m.usuario_nombre || '—'}</span>
                  <span>{fmtFecha(m.ocurrido_en)}</span>
                </div>
                {m.nota && <p className="text-xs text-texto-3 mt-1.5 italic">{m.nota}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Registrar movimiento */}
      <BottomSheet
        abierto={showForm}
        onCerrar={() => !guardando && setShowForm(false)}
        titulo="Registrar movimiento"
      >
        <div className="space-y-5">
          <div>
            <label className="font-caja block text-sm text-texto-3 mb-1.5">Producto</label>
            {productoSel ? (
              <div className="flex items-center justify-between bg-tarjeta-hundida rounded-xl p-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm text-texto truncate">
                    {formatearNombre(productoSel.nombre)}
                  </p>
                  <p className="text-xs text-texto-4">
                    Existencia actual: {productoSel.stock != null ? fmtCantidad(productoSel.stock) : 'sin inicializar'}
                    {productoSel.por_peso ? ' kg' : ''}
                  </p>
                </div>
                <button
                  onClick={() => setProductoSel(null)}
                  className="flex-shrink-0 text-marca text-sm font-semibold"
                >
                  Cambiar
                </button>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={busquedaProducto}
                    onChange={e => setBusquedaProducto(e.target.value)}
                    placeholder="Buscar por nombre o código..."
                    className="flex-1 h-[52px] px-3.5 rounded-xl bg-tarjeta-hundida border border-borde-campo text-base text-texto placeholder:text-texto-4 focus:outline-none focus:border-foco"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowScanner(true)}
                    className="flex-shrink-0 w-[52px] h-[52px] rounded-xl bg-marca text-texto-invertido flex items-center justify-center active:bg-marca-presion"
                    aria-label="Escanear código"
                  >
                    <Icon nombre="escanearCodigoBarras" tamano={TAMANO_ICONO.buscarYToggle} />
                  </button>
                </div>
                {productosFiltrados.length > 0 && (
                  <div className="mt-2 max-h-48 overflow-y-auto space-y-1.5">
                    {productosFiltrados.map(p => (
                      <button
                        key={p.id}
                        onClick={() => { setProductoSel(p); setBusquedaProducto(''); }}
                        className="w-full text-left px-3.5 py-2.5 rounded-xl bg-tarjeta-hundida active:bg-tarjeta"
                      >
                        <p className="font-medium text-sm text-texto">{formatearNombre(p.nombre)}</p>
                        <p className="text-xs text-texto-4">
                          Existencia: {p.stock != null ? fmtCantidad(p.stock) : 'sin inicializar'}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div>
            <p className="font-caja text-sm font-semibold text-texto-3 mb-2">Tipo</p>
            <div className="flex gap-2">
              {(['entrada', 'salida', 'ajuste'] as TipoUI[]).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => cambiarTipo(t)}
                  className={`flex-1 py-2.5 rounded-[12px] text-sm font-semibold transition-colors ${
                    tipo === t ? 'bg-marca text-texto-invertido' : 'bg-tarjeta-hundida text-texto-2'
                  }`}
                >
                  {TIPO_TAB_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {tipo !== 'ajuste' && (
            <div>
              <p className="font-caja text-sm font-semibold text-texto-3 mb-2">Motivo</p>
              <div className="flex flex-wrap gap-2">
                {MOTIVOS[tipo].map(m => (
                  <ChipFiltro key={m.value} activo={motivo === m.value} onClick={() => setMotivo(m.value)}>
                    {m.label}
                  </ChipFiltro>
                ))}
              </div>
            </div>
          )}

          <Input
            label={
              tipo === 'ajuste'
                ? `Cantidad real contada${productoSel?.por_peso ? ' (kilos)' : ''}`
                : `Cantidad${productoSel?.por_peso ? ' (kilos)' : ''}`
            }
            type="number"
            step="0.001"
            value={cantidad}
            onChange={e => setCantidad(e.target.value)}
            placeholder="0"
          />

          {diferenciaConteo !== null && (
            <p className={`font-caja text-sm font-medium ${diferenciaConteo >= 0 ? 'text-marca' : 'text-negativo'}`}>
              Diferencia: {diferenciaConteo >= 0 ? '+' : ''}{fmtCantidad(diferenciaConteo)}
            </p>
          )}

          <Input
            label="Nota (opcional)"
            type="text"
            value={nota}
            onChange={e => setNota(e.target.value)}
            placeholder="Ej: Compra semanal"
          />

          {error && <p className="font-caja text-sm text-negativo">{error}</p>}

          <Button variante="primario" disabled={guardando} onClick={guardarMovimiento} className="w-full">
            {guardando ? 'Guardando...' : 'Registrar'}
          </Button>
        </div>
      </BottomSheet>

      {showScanner && <Scanner onDetect={handleScanProducto} onClose={() => setShowScanner(false)} />}

      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-toast-fondo text-toast-texto px-5 py-2.5 rounded-xl text-sm font-medium z-50 shadow-lg max-w-xs text-center">
          {toast}
        </div>
      )}
    </div>
  );
}
