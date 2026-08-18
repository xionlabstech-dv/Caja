'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Producto } from '@/types';
import { getProductos, saveProducto, deleteProductoDB } from '@/lib/db';
import { encolarCrearProducto, encolarEditarProducto, encolarEliminarProducto } from '@/lib/outbox';
import { createProductoSupabase, updateProductoSupabase, softDeleteProducto } from '@/lib/sync';
import { precioBS, precioUSD, formatBS, formatUSD } from '@/lib/precio';
import { stockBajo } from '@/lib/stock';
import { useApp } from '@/components/Providers';
import { useGuardarRuta } from '@/lib/useGuardarRuta';
import Scanner from '@/components/Scanner';
import ThemeToggle from '@/components/ThemeToggle';
import StockBadge from '@/components/StockBadge';

function formatearNombre(nombre: string): string {
  return nombre
    .toLowerCase()
    .split(' ')
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

let audioCtx: AudioContext | null = null;

function reproducirBeep() {
  try {
    if (!audioCtx) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audioCtx = new ((window as any).AudioContext || (window as any).webkitAudioContext)();
    }
    const osc = audioCtx!.createOscillator();
    const gain = audioCtx!.createGain();
    osc.connect(gain);
    gain.connect(audioCtx!.destination);
    osc.frequency.value = 1800;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.15, audioCtx!.currentTime);
    osc.start();
    osc.stop(audioCtx!.currentTime + 0.1);
  } catch {
    // Audio not supported
  }
}

const PRODUCTO_VACIO = {
  nombre: '',
  codigo_barra: '',
  precio: '',
  moneda: 'USD' as 'USD' | 'VES',
  activo: true,
  por_peso: false,
  costo: '',
  margen: '',
  ganancia: '',
  stock: '',
  stock_minimo: '',
  controla_stock: true,
};

const MARGENES_RAPIDOS = [10, 20, 30, 50];

// Acepta coma o punto como separador decimal (el margen se escribe a mano,
// a diferencia de costo/precio que usan <input type="number">).
function parseNum(s: string): number {
  return parseFloat(s.trim().replace(',', '.'));
}

export default function InventarioPage() {
  useGuardarRuta();
  const router = useRouter();
  const { tasa, isOnline, negocioId, productosVersion, rol, usaCostos, usaStock, ultimaSincronizacion } = useApp();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargandoProductos, setCargandoProductos] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [soloStockBajo, setSoloStockBajo] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editando, setEditando] = useState<Producto | null>(null);
  const [form, setForm] = useState(PRODUCTO_VACIO);
  // Cuál de margen/precio/ganancia editó el usuario por última vez — los
  // otros dos son los que se recalculan cuando cambia el costo. Mientras el
  // usuario escribe en un campo, ESE campo nunca se sobreescribe a sí mismo;
  // solo se recalculan los que no está tocando en el momento (evita bucles
  // de recálculo).
  const [campoActivo, setCampoActivo] = useState<'margen' | 'precio' | 'ganancia'>('precio');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Producto | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [showScannerBuscar, setShowScannerBuscar] = useState(false);
  const [toast, setToast] = useState('');
  // Calculadora auxiliar "costo desde caja/bulto" — nada de esto se
  // persiste, solo el costo unitario resultante se escribe en form.costo.
  const [showCalcCaja, setShowCalcCaja] = useState(false);
  const [unidadesCaja, setUnidadesCaja] = useState('');
  const [costoCaja, setCostoCaja] = useState('');

  const cargar = async () => {
    const prods = await getProductos();
    setProductos(prods);
    setCargandoProductos(false);
  };

  // productosVersion: ver comentario en src/app/page.tsx — misma corrida de
  // carrera entre el sync inicial de Providers y el primer fetch local.
  useEffect(() => { cargar(); }, [productosVersion]);

  const filtrados = productos
    .filter(p =>
      busqueda
        ? p.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
          (p.codigo_barra && p.codigo_barra.includes(busqueda))
        : true
    )
    .filter(p => (soloStockBajo ? p.controla_stock !== false && stockBajo(p.stock, p.stock_minimo) : true));

  const abrirNuevo = () => {
    setEditando(null);
    setForm(PRODUCTO_VACIO);
    setCampoActivo('precio');
    setShowCalcCaja(false);
    setUnidadesCaja('');
    setCostoCaja('');
    setError('');
    setShowModal(true);
  };

  const abrirEditar = (p: Producto) => {
    setEditando(p);
    // Margen y ganancia sobre costo (markup), derivados del costo y precio
    // ya guardados — no se persisten en Supabase, se recalculan cada vez
    // que se abre el formulario.
    const margenInicial =
      p.costo != null && p.costo > 0
        ? (((p.precio - p.costo) / p.costo) * 100).toFixed(1)
        : '';
    const gananciaInicial = p.costo != null ? (p.precio - p.costo).toFixed(2) : '';
    setForm({
      nombre: p.nombre,
      codigo_barra: p.codigo_barra || '',
      precio: p.precio.toString(),
      moneda: p.moneda,
      activo: p.activo,
      por_peso: p.por_peso ?? false,
      costo: p.costo != null ? String(p.costo) : '',
      margen: margenInicial,
      ganancia: gananciaInicial,
      stock: p.stock != null ? String(p.stock) : '',
      stock_minimo: p.stock_minimo != null ? String(p.stock_minimo) : '',
      controla_stock: p.controla_stock ?? true,
    });
    // precio es el valor ya confirmado del producto; si el admin edita el
    // costo sin tocar nada más, se recalculan margen y ganancia, y se
    // preserva el precio existente (no al revés).
    setCampoActivo('precio');
    setShowCalcCaja(false);
    setUnidadesCaja('');
    setCostoCaja('');
    setError('');
    setShowModal(true);
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  // Margen SOBRE EL COSTO (markup) — costo 10, margen 50% → precio 15. Es
  // como razona un comerciante minorista, a diferencia del margen sobre
  // venta que se usaba antes. Debe quedar consistente con Reportes.
  //
  // Costo, margen%, ganancia y precio se calculan entre sí. campoActivo
  // guarda cuál de los tres (margen/precio/ganancia) editó el usuario por
  // última vez — es la pareja "costo + campoActivo" la que manda; los otros
  // dos se derivan de esa pareja. Así, escribir en costo nunca pisa el
  // campo que el usuario acaba de tocar.
  const handleCostoChange = (v: string) => {
    setForm(f => {
      const nuevo = { ...f, costo: v };
      const costoNum = v.trim() ? parseFloat(v) : NaN;
      if (isNaN(costoNum) || costoNum < 0) return nuevo;
      if (campoActivo === 'margen' && f.margen.trim()) {
        const margenNum = parseNum(f.margen);
        if (!isNaN(margenNum)) {
          const precioNum = costoNum * (1 + margenNum / 100);
          nuevo.precio = precioNum.toFixed(2);
          nuevo.ganancia = (precioNum - costoNum).toFixed(2);
        }
      } else if (campoActivo === 'ganancia' && f.ganancia.trim()) {
        const gananciaNum = parseNum(f.ganancia);
        if (!isNaN(gananciaNum)) {
          const precioNum = costoNum + gananciaNum;
          nuevo.precio = precioNum.toFixed(2);
          nuevo.margen = costoNum > 0 ? ((gananciaNum / costoNum) * 100).toFixed(1) : '';
        }
      } else if (campoActivo === 'precio' && f.precio.trim() && costoNum > 0) {
        const precioNum = parseFloat(f.precio);
        if (!isNaN(precioNum)) {
          nuevo.margen = (((precioNum - costoNum) / costoNum) * 100).toFixed(1);
          nuevo.ganancia = (precioNum - costoNum).toFixed(2);
        }
      }
      return nuevo;
    });
  };

  const handleMargenChange = (v: string) => {
    setCampoActivo('margen');
    setForm(f => {
      const nuevo = { ...f, margen: v };
      const costoNum = f.costo.trim() ? parseFloat(f.costo) : NaN;
      const margenNum = v.trim() ? parseNum(v) : NaN;
      // Si el margen queda vacío o inválido, NO se tocan precio/ganancia —
      // se dejan los últimos valores calculados, tal como pide el ajuste.
      if (!isNaN(costoNum) && costoNum >= 0 && !isNaN(margenNum)) {
        const precioNum = costoNum * (1 + margenNum / 100);
        nuevo.precio = precioNum.toFixed(2);
        nuevo.ganancia = (precioNum - costoNum).toFixed(2);
      }
      return nuevo;
    });
  };

  const aplicarMargenRapido = (pct: number) => handleMargenChange(String(pct));

  const handleGananciaChange = (v: string) => {
    setCampoActivo('ganancia');
    setForm(f => {
      const nuevo = { ...f, ganancia: v };
      const costoNum = f.costo.trim() ? parseFloat(f.costo) : NaN;
      const gananciaNum = v.trim() ? parseNum(v) : NaN;
      // Igual que con margen: si la ganancia queda vacía o inválida, no se
      // tocan precio/margen.
      if (!isNaN(costoNum) && costoNum >= 0 && !isNaN(gananciaNum)) {
        const precioNum = costoNum + gananciaNum;
        nuevo.precio = precioNum.toFixed(2);
        nuevo.margen = costoNum > 0 ? ((gananciaNum / costoNum) * 100).toFixed(1) : '';
      }
      return nuevo;
    });
  };

  const handlePrecioChange = (v: string) => {
    setCampoActivo('precio');
    setForm(f => {
      const nuevo = { ...f, precio: v };
      const costoNum = f.costo.trim() ? parseFloat(f.costo) : NaN;
      const precioNum = v.trim() ? parseFloat(v) : NaN;
      if (!isNaN(costoNum) && costoNum > 0 && !isNaN(precioNum)) {
        nuevo.margen = (((precioNum - costoNum) / costoNum) * 100).toFixed(1);
        nuevo.ganancia = (precioNum - costoNum).toFixed(2);
      }
      return nuevo;
    });
  };

  const guardar = async () => {
    if (!form.nombre.trim()) { setError('El nombre es obligatorio'); return; }
    const precio = parseFloat(form.precio);
    if (!precio || precio <= 0) { setError('El precio debe ser mayor a 0'); return; }

    const codigoBarra = form.codigo_barra.trim() || null;
    // Chequeo local contra el catálogo ya descargado — cubre el caso común
    // (mismo código escaneado dos veces). Un choque contra datos que solo
    // existen en el servidor y aún no bajaron al dispositivo no se detecta
    // aquí; se resuelve al sincronizar.
    if (codigoBarra) {
      const colision = productos.find(
        p => p.codigo_barra === codigoBarra && p.id !== editando?.id
      );
      if (colision) {
        setError('Ya existe un producto con ese código de barras en tu negocio');
        return;
      }
    }

    let costo: number | null = null;
    if (usaCostos && rol === 'admin' && form.costo.trim()) {
      costo = parseFloat(form.costo);
      if (isNaN(costo) || costo < 0) { setError('El costo no es válido'); return; }
    }

    let stock: number | null = null;
    let stockMinimo: number | null = null;
    if (usaStock && rol === 'admin' && form.controla_stock) {
      if (form.stock.trim()) {
        stock = parseFloat(form.stock);
        if (isNaN(stock)) { setError('La existencia no es válida'); return; }
      }
      if (form.stock_minimo.trim()) {
        stockMinimo = parseFloat(form.stock_minimo);
        if (isNaN(stockMinimo) || stockMinimo < 0) { setError('El umbral de alerta no es válido'); return; }
      }
    }

    setGuardando(true);
    setError('');

    const datos: {
      nombre: string;
      codigo_barra: string | null;
      precio: number;
      moneda: 'USD' | 'VES';
      activo: boolean;
      por_peso: boolean;
      costo?: number | null;
      stock?: number | null;
      stock_minimo?: number | null;
      controla_stock?: boolean;
    } = {
      nombre: form.nombre.trim(),
      codigo_barra: codigoBarra,
      precio,
      moneda: form.moneda,
      activo: true,
      por_peso: form.por_peso,
    };
    // El campo costo solo se toca si de verdad estaba visible y editable en
    // este guardado — si usa_costos está apagado (o el rol no es admin), NO
    // se incluye la llave en absoluto, para no pisar con null un costo que
    // ya estaba guardado de cuando el control de costos sí estaba activo.
    if (usaCostos && rol === 'admin') {
      datos.costo = costo;
    }
    // Mismo criterio para stock: controla_stock siempre se guarda si el
    // bloque estaba visible (el admin lo apagó o dejó prendido a
    // propósito), pero stock/stock_minimo solo se tocan si controla_stock
    // estaba activo — si lo apagó, sus cantidades existentes se preservan
    // por si se reactiva el control más adelante.
    if (usaStock && rol === 'admin') {
      datos.controla_stock = form.controla_stock;
      if (form.controla_stock) {
        datos.stock = stock;
        datos.stock_minimo = stockMinimo;
      }
    }

    // Optimista: se guarda en IndexedDB de inmediato (la UI responde al
    // instante). Sin red, no hay forma de confirmar nada ahora — se encola
    // para reintentar al reconectar. Con red, se espera la confirmación
    // real de Supabase antes de cerrar el modal; si la escritura no afectó
    // ninguna fila (ej. RLS la bloqueó en silencio), se revierte el
    // catálogo local en vez de dejarlo mostrando un cambio que nunca se
    // persistió.
    if (editando) {
      const original = editando;
      const actualizado = { ...editando, ...datos };
      await saveProducto(actualizado);

      if (!isOnline) {
        await encolarEditarProducto(editando.id, datos);
        await cargar();
        setShowModal(false);
        setGuardando(false);
        showToast('Guardado localmente — se sincronizará cuando haya conexión');
        return;
      }

      const resultado = await updateProductoSupabase(editando.id, datos);
      setGuardando(false);
      if (resultado === false) {
        await saveProducto(original);
        await cargar();
        setError('No se pudo guardar el producto. Intenta de nuevo.');
        return;
      }
      await cargar();
      setShowModal(false);
      showToast('Producto guardado');
    } else {
      const nuevo: Producto = { id: crypto.randomUUID(), ...datos };
      await saveProducto(nuevo);

      if (!isOnline) {
        await encolarCrearProducto(nuevo, negocioId!);
        await cargar();
        setShowModal(false);
        setGuardando(false);
        showToast('Guardado localmente — se sincronizará cuando haya conexión');
        return;
      }

      const resultado = await createProductoSupabase(nuevo, negocioId!);
      setGuardando(false);
      if (resultado === null) {
        await deleteProductoDB(nuevo.id);
        await cargar();
        setError('No se pudo guardar el producto. Intenta de nuevo.');
        return;
      }
      await cargar();
      setShowModal(false);
      showToast('Producto guardado');
    }
  };

  const handleScanInventario = (codigo: string) => {
    setShowScannerBuscar(false);
    const encontrado = productos.find(p => p.codigo_barra === codigo);
    reproducirBeep();
    if (encontrado) {
      abrirEditar(encontrado);
    } else {
      setEditando(null);
      setForm({ ...PRODUCTO_VACIO, codigo_barra: codigo });
      setError('');
      setShowModal(true);
      showToast('Código no encontrado — completa los datos para agregarlo');
    }
  };

  const eliminar = async (p: Producto) => {
    await deleteProductoDB(p.id);
    setConfirmDelete(null);

    if (!isOnline) {
      await encolarEliminarProducto(p.id);
      await cargar();
      showToast('Eliminado localmente — se sincronizará cuando haya conexión');
      return;
    }

    const ok = await softDeleteProducto(p.id);
    if (!ok) {
      // No se borró de verdad (ej. RLS lo bloqueó en silencio) — restaurar
      // en vez de dejarlo desaparecido de la lista sin haberse eliminado.
      await saveProducto(p);
      await cargar();
      showToast('No se pudo eliminar el producto. Intenta de nuevo.');
      return;
    }
    await cargar();
    showToast('Producto eliminado');
  };

  const mostrarCosto = usaCostos && rol === 'admin';
  const precioFormNum = parseFloat(form.precio);
  const costoFormNum = form.costo.trim() ? parseFloat(form.costo) : null;
  const costoMayorQuePrecio =
    mostrarCosto && precioFormNum > 0 && costoFormNum !== null && !isNaN(costoFormNum) && costoFormNum > precioFormNum;

  // Calculadora "costo desde caja/bulto": costo unitario en vivo, redondeado
  // a 2 decimales. Nunca se persiste — solo alimenta el campo Costo cuando
  // el usuario confirma con "Usar este costo".
  const unidadesCajaNum = unidadesCaja.trim() ? parseNum(unidadesCaja) : NaN;
  const costoCajaNum = costoCaja.trim() ? parseNum(costoCaja) : NaN;
  const costoUnitarioCaja =
    !isNaN(unidadesCajaNum) && unidadesCajaNum > 0 && !isNaN(costoCajaNum) && costoCajaNum >= 0
      ? (costoCajaNum / unidadesCajaNum).toFixed(2)
      : null;

  const cerrarCalcCaja = () => {
    setShowCalcCaja(false);
    setUnidadesCaja('');
    setCostoCaja('');
  };

  const usarCostoDeCaja = () => {
    if (costoUnitarioCaja === null) return;
    handleCostoChange(costoUnitarioCaja);
    cerrarCalcCaja();
  };

  return (
    <div>
      <header className="bg-emerald-600 text-white px-4 pt-4 pb-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Inventario</h1>
          <p className="text-emerald-200 text-sm">{productos.length} productos</p>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {usaStock && rol === 'admin' && (
            <button
              onClick={() => router.push('/movimientos')}
              className="bg-white/20 text-white p-2.5 rounded-xl flex items-center justify-center"
              aria-label="Movimientos de stock"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </button>
          )}
          <button
            onClick={abrirNuevo}
            className="bg-white text-emerald-700 px-4 py-2 rounded-xl font-semibold text-sm flex items-center gap-1.5"
          >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          Agregar
          </button>
        </div>
      </header>

      <div className="px-4 py-3 bg-white border-b border-gray-100 flex gap-2">
        <div className="flex-1 relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && busqueda.trim()) handleScanInventario(busqueda.trim());
            }}
            placeholder="Buscar por nombre o código..."
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-400"
          />
        </div>
        <button
          onClick={() => setShowScannerBuscar(true)}
          className="bg-emerald-600 text-white p-2.5 rounded-xl flex items-center justify-center"
          aria-label="Escanear código"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
            />
          </svg>
        </button>
      </div>

      {usaStock && (
        <div className="px-4 py-2 bg-white border-b border-gray-100">
          <button
            onClick={() => setSoloStockBajo(v => !v)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
              soloStockBajo ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
            }`}
          >
            Stock bajo
          </button>
        </div>
      )}

      <div className="p-4 space-y-2">
        {cargandoProductos ? (
          <div className="text-center text-gray-400 py-16">
            <svg className="w-8 h-8 mx-auto mb-3 text-emerald-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm">Cargando productos...</p>
          </div>
        ) : filtrados.length === 0 ? (
          <div className="text-center text-gray-400 py-16">
            <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
            </svg>
            <p className="font-medium">{busqueda ? `Sin resultados para "${busqueda}"` : 'Sin productos'}</p>
            {!busqueda && (
              <button onClick={abrirNuevo} className="mt-3 text-emerald-600 font-semibold text-sm">
                Agregar el primero
              </button>
            )}
          </div>
        ) : (
          filtrados.map(p => {
            const pbs = tasa > 0 ? precioBS(p, tasa) : null;
            const pusd = tasa > 0 ? precioUSD(p, tasa) : null;

            return (
              <div key={p.id} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900">{formatearNombre(p.nombre)}</p>
                    {p.por_peso && (
                      <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium flex-shrink-0">
                        /kg
                      </span>
                    )}
                  </div>
                  {p.codigo_barra && (
                    <p className="text-xs text-gray-400 font-mono">{p.codigo_barra}</p>
                  )}
                  {pbs !== null ? (
                    <div className="mt-1">
                      <p className="font-bold text-gray-900 text-lg">
                        {formatBS(pbs)}
                        {p.por_peso && <span className="text-sm font-normal text-gray-400"> / kg</span>}
                      </p>
                      <p className="text-xs text-gray-400">{pusd !== null ? formatUSD(pusd) : ''}{p.por_peso ? ' / kg' : ''}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400 mt-1">
                      {p.precio} {p.moneda}{p.por_peso ? ' / kg' : ''}
                    </p>
                  )}
                  {usaStock && (
                    <div className="mt-1">
                      <StockBadge
                        stock={p.stock}
                        stockMinimo={p.stock_minimo}
                        controlaStock={p.controla_stock}
                        esPorPeso={p.por_peso}
                        isOnline={isOnline}
                        ultimaSincronizacion={ultimaSincronizacion}
                      />
                    </div>
                  )}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => abrirEditar(p)}
                    className="p-2 rounded-lg bg-gray-100 text-gray-600"
                    aria-label="Editar"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                      />
                    </svg>
                  </button>
                  <button
                    onClick={() => setConfirmDelete(p)}
                    className="p-2 rounded-lg bg-red-50 text-red-500"
                    aria-label="Eliminar"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowModal(false)} />
          <div className="relative w-full max-w-lg mx-auto bg-white rounded-t-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h2 className="text-lg font-bold">
                {editando ? 'Editar producto' : 'Nuevo producto'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1 text-gray-400">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {!isOnline && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm">
                  Sin conexión — se guarda en el dispositivo y se sincroniza al reconectar
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nombre <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.nombre}
                  onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-emerald-400"
                  placeholder="Nombre del producto"
                  autoFocus
                />
              </div>

              {/* Toggle por peso */}
              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-sm font-medium text-gray-700">Se vende por peso</p>
                  <p className="text-xs text-gray-400 mt-0.5">El precio será por kilo (kg)</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.por_peso}
                  onClick={() => setForm(f => ({ ...f, por_peso: !f.por_peso }))}
                  className={`relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                    form.por_peso ? 'bg-emerald-600' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block w-5 h-5 m-0.5 bg-white rounded-full shadow-sm transition-transform ${
                      form.por_peso ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Código de barra
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.codigo_barra}
                    onChange={e => setForm(f => ({ ...f, codigo_barra: e.target.value }))}
                    className="flex-1 border border-gray-200 rounded-xl px-4 py-3 font-mono focus:outline-none focus:border-emerald-400"
                    placeholder="Opcional"
                  />
                  <button
                    type="button"
                    onClick={() => setShowScanner(true)}
                    className="flex-shrink-0 px-3 py-3 rounded-xl bg-gray-100 text-gray-600 flex items-center justify-center"
                    aria-label="Escanear código de barra"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M7 8v8M12 8v8M17 8v8" />
                    </svg>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Moneda
                </label>
                <div className="flex gap-2">
                  {(['USD', 'VES'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setForm(f => ({ ...f, moneda: m }))}
                      className={`flex-1 py-3 rounded-xl font-semibold transition-colors ${
                        form.moneda === m
                          ? 'bg-emerald-600 text-white'
                          : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {m === 'USD' ? '$ USD' : 'Bs VES'}
                    </button>
                  ))}
                </div>
              </div>

              {mostrarCosto ? (
                <>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-sm font-medium text-gray-700">
                        {form.por_peso ? 'Costo por kilo' : 'Costo'} ({form.moneda})
                      </label>
                      <button
                        type="button"
                        onClick={() => (showCalcCaja ? cerrarCalcCaja() : setShowCalcCaja(true))}
                        className="text-xs font-semibold text-emerald-600"
                      >
                        {form.por_peso ? 'Calcular desde bulto' : 'Calcular desde caja'}
                      </button>
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      value={form.costo}
                      onChange={e => handleCostoChange(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 text-lg font-semibold focus:outline-none focus:border-emerald-400"
                      placeholder="Opcional"
                    />
                    {showCalcCaja && (
                      <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-2">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">
                            {form.por_peso ? 'Kilos por bulto' : 'Unidades por caja'}
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={unidadesCaja}
                            onChange={e => setUnidadesCaja(e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-400"
                            placeholder={form.por_peso ? 'Ej: 20' : 'Ej: 24'}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">
                            {form.por_peso ? 'Costo total del bulto' : 'Costo total de la caja'} ({form.moneda})
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={costoCaja}
                            onChange={e => setCostoCaja(e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-400"
                            placeholder="Ej: 18,00"
                          />
                        </div>
                        <p className="text-sm text-gray-600">
                          {form.por_peso ? 'Costo por kilo' : 'Costo por unidad'}: {costoUnitarioCaja ?? '—'}
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={cerrarCalcCaja}
                            className="flex-1 py-2 rounded-lg text-xs font-semibold bg-gray-200 text-gray-600"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            disabled={costoUnitarioCaja === null}
                            onClick={usarCostoDeCaja}
                            className="flex-1 py-2 rounded-lg text-xs font-semibold bg-emerald-600 text-white disabled:opacity-40"
                          >
                            Usar este costo
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Margen sobre costo (%)
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={form.margen}
                      onChange={e => handleMargenChange(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 text-lg font-semibold focus:outline-none focus:border-emerald-400"
                      placeholder="Ej: 33,5"
                    />
                    <div className="flex gap-2 mt-2">
                      {MARGENES_RAPIDOS.map(pct => (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => aplicarMargenRapido(pct)}
                          className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-600"
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Ganancia {form.por_peso ? 'por kilo' : ''} ({form.moneda})
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={form.ganancia}
                      onChange={e => handleGananciaChange(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 text-lg font-semibold focus:outline-none focus:border-emerald-400"
                      placeholder="Ej: 1,50"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {form.por_peso ? 'Precio por kilo' : 'Precio'} ({form.moneda}) <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={form.precio}
                      onChange={e => handlePrecioChange(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 text-lg font-semibold focus:outline-none focus:border-emerald-400"
                      placeholder="0.00"
                    />
                    {tasa > 0 && form.precio && parseFloat(form.precio) > 0 && (
                      <p className="text-sm text-gray-400 mt-1">
                        {form.moneda === 'USD'
                          ? `Bs ${(parseFloat(form.precio) * tasa).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : `$ ${(parseFloat(form.precio) / tasa).toFixed(2)}`}
                        {form.por_peso ? ' / kg' : ''}
                      </p>
                    )}
                    {costoMayorQuePrecio && (
                      <p className="text-sm text-red-500 font-medium mt-1">
                        El costo es mayor que el precio de venta
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {form.por_peso ? 'Precio por kilo' : 'Precio'} ({form.moneda}) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.precio}
                    onChange={e => setForm(f => ({ ...f, precio: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-lg font-semibold focus:outline-none focus:border-emerald-400"
                    placeholder="0.00"
                  />
                  {tasa > 0 && form.precio && parseFloat(form.precio) > 0 && (
                    <p className="text-sm text-gray-400 mt-1">
                      {form.moneda === 'USD'
                        ? `Bs ${(parseFloat(form.precio) * tasa).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : `$ ${(parseFloat(form.precio) / tasa).toFixed(2)}`}
                      {form.por_peso ? ' / kg' : ''}
                    </p>
                  )}
                </div>
              )}

              {usaStock && rol === 'admin' && (
                <div className="space-y-4 pt-1 border-t border-gray-100">
                  <div className="flex items-center justify-between py-1 pt-3">
                    <div>
                      <p className="text-sm font-medium text-gray-700">Llevar control de este producto</p>
                      <p className="text-xs text-gray-400 mt-0.5">Apágalo para granel o servicios</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={form.controla_stock}
                      onClick={() => setForm(f => ({ ...f, controla_stock: !f.controla_stock }))}
                      className={`relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                        form.controla_stock ? 'bg-emerald-600' : 'bg-gray-200'
                      }`}
                    >
                      <span
                        className={`inline-block w-5 h-5 m-0.5 bg-white rounded-full shadow-sm transition-transform ${
                          form.controla_stock ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {form.controla_stock && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Existencia actual {form.por_peso ? '(kilos)' : ''}
                        </label>
                        <input
                          type="number"
                          step="0.001"
                          value={form.stock}
                          onChange={e => setForm(f => ({ ...f, stock: e.target.value }))}
                          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-lg font-semibold focus:outline-none focus:border-emerald-400"
                          placeholder="Opcional"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Alerta cuando quede menos de {form.por_peso ? '(kilos)' : ''}
                        </label>
                        <input
                          type="number"
                          step="0.001"
                          value={form.stock_minimo}
                          onChange={e => setForm(f => ({ ...f, stock_minimo: e.target.value }))}
                          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-lg font-semibold focus:outline-none focus:border-emerald-400"
                          placeholder="Opcional"
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              {error && <p className="text-red-500 text-sm">{error}</p>}
            </div>

            <div className="p-4 border-t border-gray-100">
              <button
                onClick={guardar}
                disabled={guardando}
                className="w-full bg-emerald-600 text-white py-4 rounded-xl text-lg font-bold disabled:opacity-40"
              >
                {guardando ? 'Guardando...' : editando ? 'Actualizar' : 'Agregar producto'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmDelete(null)} />
          <div className="relative bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-bold mb-2">Eliminar producto</h3>
            <p className="text-gray-500 mb-5">
              ¿Eliminar <strong>{confirmDelete.nombre}</strong>? Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-700 font-semibold"
              >
                Cancelar
              </button>
              <button
                onClick={() => eliminar(confirmDelete)}
                className="flex-1 py-3 rounded-xl bg-red-500 text-white font-semibold"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-5 py-2.5 rounded-xl text-sm font-medium z-50 shadow-lg whitespace-nowrap">
          {toast}
        </div>
      )}

      {/* Header scanner — buscar producto o abrir nuevo con código pre-llenado */}
      {showScannerBuscar && (
        <Scanner
          onDetect={handleScanInventario}
          onClose={() => setShowScannerBuscar(false)}
        />
      )}

      {/* Barcode scanner — renders on top of all modals (last in DOM) */}
      {showScanner && (
        <Scanner
          onDetect={code => {
            setForm(f => ({ ...f, codigo_barra: code }));
            setShowScanner(false);
          }}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  );
}
