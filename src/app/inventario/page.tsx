'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Producto, MovimientoStock, MotivoMovimiento } from '@/types';
import { TipoUI, TIPO_TAB_LABELS, MOTIVOS } from '@/lib/tiposMovimiento';
import { getProductos, saveProducto, deleteProductoDB, saveMovimiento, actualizarStockLocal } from '@/lib/db';
import { encolarCrearProducto, encolarEditarProducto, encolarEliminarProducto, encolarAplicarMovimientoStock } from '@/lib/outbox';
import { createProductoSupabase, updateProductoSupabase, softDeleteProducto, aplicarMovimientoStockRemoto } from '@/lib/sync';
import { precioBS, precioUSD, formatBS, formatUSD } from '@/lib/precio';
import { stockBajo, debeOcultarStock } from '@/lib/stock';
import { pareceCodigoBarra } from '@/lib/barcode';
import { useApp } from '@/components/Providers';
import { useGuardarRuta } from '@/lib/useGuardarRuta';
import Scanner from '@/components/Scanner';
import ThemeToggle from '@/components/ThemeToggle';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import BottomSheet from '@/components/ui/BottomSheet';
import ChipFiltro from '@/components/ui/ChipFiltro';
import Icon from '@/components/ui/Icon';
import { TAMANO_ICONO } from '@/components/ui/iconos';

// Los 4 motivos de merma que se registran desde acá — un subconjunto fijo
// de MotivoMovimiento. El resto (compra, devolución, conteo físico...)
// sigue viviendo solo en Movimientos.
type MotivoMerma = 'dano' | 'vencido' | 'perdida' | 'consumo_propio';
const MOTIVOS_MERMA: { value: MotivoMerma; label: string }[] = [
  { value: 'dano', label: 'Daño' },
  { value: 'vencido', label: 'Vencido' },
  { value: 'perdida', label: 'Pérdida' },
  { value: 'consumo_propio', label: 'Consumo propio' },
];

function fmtCantidad(n: number): string {
  return n.toLocaleString('es-VE', { maximumFractionDigits: 3 });
}

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
  const permitida = useGuardarRuta();
  const router = useRouter();
  const { tasa, isOnline, negocioId, productosVersion, rol, usaCostos, usaStock, ultimaSincronizacion, user, userNombre } = useApp();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargandoProductos, setCargandoProductos] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [chip, setChip] = useState<'todos' | 'bajo' | 'sin'>('todos');
  const [orden, setOrden] = useState<'stock' | 'nombre'>('stock');
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
  // Sheet de "Registrar merma" — se abre encima del sheet de editar
  // producto, nunca reemplaza sus datos (editando/form siguen intactos).
  const [showMerma, setShowMerma] = useState(false);
  const [motivoMerma, setMotivoMerma] = useState<MotivoMerma | null>(null);
  // Cantidad en unidades (stepper) — solo se usa si el producto NO es por
  // peso. Por peso pide gramos directo, igual que agregarPorPeso() en Caja
  // (src/app/page.tsx, sheet "Pesar"), y se convierte a kg más abajo.
  const [cantidadMerma, setCantidadMerma] = useState(1);
  const [gramosMerma, setGramosMerma] = useState('');
  const [notaMerma, setNotaMerma] = useState('');
  const [guardandoMerma, setGuardandoMerma] = useState(false);
  // Sheet de "Registrar movimiento" — mismo formulario de Movimientos
  // (src/app/movimientos/page.tsx), pero sin buscador: el producto ya es
  // editando, fijo desde el principio.
  const [showRegistroMovimiento, setShowRegistroMovimiento] = useState(false);
  const [tipoRM, setTipoRM] = useState<TipoUI>('entrada');
  const [motivoRM, setMotivoRM] = useState<MotivoMovimiento>('compra');
  const [cantidadRM, setCantidadRM] = useState('');
  const [notaRM, setNotaRM] = useState('');
  const [guardandoRM, setGuardandoRM] = useState(false);
  const [errorRM, setErrorRM] = useState('');
  // Calculadora auxiliar "costo desde caja/bulto" — nada de esto se
  // persiste, solo el costo unitario resultante se escribe en form.costo.
  const [showCalcCaja, setShowCalcCaja] = useState(false);
  const [unidadesCaja, setUnidadesCaja] = useState('');
  const [costoCaja, setCostoCaja] = useState('');
  // "Costo y margen" — colapsado por defecto dentro del sheet de
  // editar/nuevo producto (decisión #3 del brief de rediseño).
  const [costosAbiertos, setCostosAbiertos] = useState(false);

  const cargar = async () => {
    const prods = await getProductos();
    setProductos(prods);
    setCargandoProductos(false);
  };

  // productosVersion: ver comentario en src/app/page.tsx — misma corrida de
  // carrera entre el sync inicial de Providers y el primer fetch local.
  useEffect(() => { cargar(); }, [productosVersion]);

  if (!permitida) return null;

  // Mismos buckets del mockup (Inventario - movil): "bajo" y "sin" excluyen
  // productos sin control de stock y, en el caso de "bajo", además exigen
  // stock > 0 (si no, un producto en cero contaría dos veces). La lista de
  // Inventario, con cualquier chip, siempre queda restringida a activos —
  // no hay chip "Desactivados" (decisión de Juan: eliminar se presenta y se
  // entiende como permanente, no habría nada real que mostrar ahí).
  const activos = productos.filter(p => p.activo);
  const conControl = activos.filter(p => p.controla_stock !== false);
  const bajos = conControl.filter(p => stockBajo(p.stock, p.stock_minimo) && (p.stock ?? 0) > 0);
  const ceros = conControl.filter(p => p.stock != null && p.stock <= 0);

  const q = busqueda.trim().toLowerCase();
  let filtrados = productos.filter(p => {
    if (!p.activo) return false;
    if (chip === 'bajo' && !(p.controla_stock !== false && stockBajo(p.stock, p.stock_minimo) && (p.stock ?? 0) > 0)) return false;
    if (chip === 'sin' && !(p.controla_stock !== false && p.stock != null && p.stock <= 0)) return false;
    if (q && !(p.nombre.toLowerCase().includes(q) || (p.codigo_barra ?? '').toLowerCase().includes(q))) return false;
    return true;
  });
  // Por defecto lo más urgente arriba: existencia más baja primero, y los
  // que no llevan control al final (no tienen nada que agotarse).
  filtrados = filtrados.slice().sort((a, b) => {
    if (orden === 'nombre') return a.nombre.localeCompare(b.nombre, 'es');
    const aControla = a.controla_stock !== false;
    const bControla = b.controla_stock !== false;
    if (aControla !== bControla) return aControla ? -1 : 1;
    return (a.stock ?? 0) - (b.stock ?? 0);
  });

  const abrirNuevo = () => {
    setEditando(null);
    setForm(PRODUCTO_VACIO);
    setCampoActivo('precio');
    setShowCalcCaja(false);
    setUnidadesCaja('');
    setCostoCaja('');
    setCostosAbiertos(false);
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
    setCostosAbiertos(false);
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
      // Con movimientos, "stock" ni se parsea: no puede llegar a incluirse
      // en el payload del update pase lo que pase (ver más abajo).
      if (!existenciaBloqueada && form.stock.trim()) {
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
        // La defensa real está acá, no en que el input esté deshabilitado:
        // con movimientos, la llave "stock" ni se incluye en el payload —
        // ni siquiera con el mismo valor que ya tenía.
        if (!existenciaBloqueada) {
          datos.stock = stock;
        }
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
      if (!resultado.ok) {
        if (resultado.permanente === false) {
          // No hubo respuesta real (sin señal, timeout) — no es un rechazo
          // del servidor, no hay que revertir: se encola igual que si
          // hubiera estado offline desde el principio.
          await encolarEditarProducto(editando.id, datos);
          await cargar();
          setShowModal(false);
          showToast('Guardado localmente — se sincronizará cuando haya conexión');
          return;
        }
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
      if (!resultado.ok) {
        if (resultado.permanente === false) {
          await encolarCrearProducto(nuevo, negocioId!);
          await cargar();
          setShowModal(false);
          showToast('Guardado localmente — se sincronizará cuando haya conexión');
          return;
        }
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

    const resultado = await softDeleteProducto(p.id);
    if (!resultado.ok) {
      if (resultado.permanente === false) {
        await encolarEliminarProducto(p.id);
        await cargar();
        showToast('Eliminado localmente — se sincronizará cuando haya conexión');
        return;
      }
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

  // Gramos → kg, igual que agregarPorPeso() en Caja: precio * (g / 1000).
  const gramosMermaNum = parseFloat(gramosMerma);
  const cantidadMermaAplicada = editando?.por_peso
    ? (gramosMermaNum > 0 ? gramosMermaNum / 1000 : 0)
    : cantidadMerma;

  const abrirMerma = () => {
    setMotivoMerma(null);
    setCantidadMerma(1);
    setGramosMerma('');
    setNotaMerma('');
    setShowMerma(true);
  };

  const guardarMerma = async () => {
    if (!editando || !motivoMerma || !negocioId || cantidadMermaAplicada <= 0) return;

    setGuardandoMerma(true);

    const now = new Date().toISOString();
    const stockActual = editando.stock ?? 0;
    const stockDespues = stockActual - cantidadMermaAplicada;
    const movimiento: MovimientoStock = {
      id: crypto.randomUUID(),
      producto_id: editando.id,
      producto_nombre: editando.nombre,
      tipo: 'salida',
      motivo: motivoMerma,
      cantidad: -cantidadMermaAplicada,
      stock_resultante: stockDespues,
      usuario_id: user?.id,
      usuario_nombre: userNombre || undefined,
      nota: notaMerma.trim() || undefined,
      ocurrido_en: now,
      sincronizado: false,
    };

    // Mismo camino que Movimientos: optimista local primero, nunca se
    // revierte solo porque falle la red — la merma ya ocurrió en la
    // realidad. Este sheet no bloquea nada más de la app mientras está
    // abierto, así que tampoco puede bloquear un cobro si queda olvidado.
    await saveMovimiento(movimiento);
    await actualizarStockLocal(editando.id, stockDespues);
    setEditando(e => (e ? { ...e, stock: stockDespues } : e));
    setForm(f => ({ ...f, stock: String(stockDespues) }));

    if (!isOnline) {
      await encolarAplicarMovimientoStock(movimiento.id, negocioId);
      setGuardandoMerma(false);
      setShowMerma(false);
      await cargar();
      showToast('Guardado localmente — se sincronizará cuando haya conexión');
      return;
    }

    const resultado = await aplicarMovimientoStockRemoto(movimiento);
    setGuardandoMerma(false);

    if (resultado.permanente) {
      showToast(`No se pudo registrar: ${resultado.mensaje ?? 'el servidor lo rechazó'}`);
      setShowMerma(false);
      await cargar();
      return;
    }

    if (!resultado.ok) {
      await encolarAplicarMovimientoStock(movimiento.id, negocioId);
      setShowMerma(false);
      await cargar();
      showToast('Guardado localmente — no se pudo confirmar con el servidor todavía, se reintentará');
      return;
    }

    await saveMovimiento({ ...movimiento, sincronizado: true, stock_resultante: resultado.nuevoStock });
    setShowMerma(false);
    await cargar();
    showToast('Merma registrada');
  };

  const abrirRegistroMovimiento = () => {
    setTipoRM('entrada');
    setMotivoRM(MOTIVOS.entrada[0].value);
    setCantidadRM('');
    setNotaRM('');
    setErrorRM('');
    setShowRegistroMovimiento(true);
  };

  const cambiarTipoRM = (t: TipoUI) => {
    setTipoRM(t);
    setMotivoRM(MOTIVOS[t][0].value);
    setCantidadRM('');
    setErrorRM('');
  };

  // Mismo patrón que Movimientos: en ajuste se ingresa la cantidad REAL
  // contada, no la diferencia — se calcula sola contra la existencia actual.
  const cantidadRMNum = parseFloat(cantidadRM);
  const stockActualRM = editando?.stock ?? 0;
  const diferenciaConteoRM =
    tipoRM === 'ajuste' && cantidadRM.trim() && !isNaN(cantidadRMNum) ? cantidadRMNum - stockActualRM : null;

  const guardarRM = async () => {
    if (!editando || !negocioId) return;
    if (!cantidadRM.trim() || isNaN(cantidadRMNum)) { setErrorRM('Ingresa una cantidad válida'); return; }
    if (tipoRM !== 'ajuste' && cantidadRMNum <= 0) { setErrorRM('La cantidad debe ser mayor a 0'); return; }

    let cantidadAplicada: number;
    if (tipoRM === 'ajuste') {
      cantidadAplicada = diferenciaConteoRM ?? 0;
      if (cantidadAplicada === 0) {
        setErrorRM('El conteo coincide con la existencia actual — no hay nada que ajustar');
        return;
      }
    } else {
      // A diferencia de merma (siempre salida): acá el tipo lo elige el
      // usuario — en entrada la cantidad suma al stock, en salida resta.
      cantidadAplicada = tipoRM === 'entrada' ? cantidadRMNum : -cantidadRMNum;
    }

    setGuardandoRM(true);
    setErrorRM('');

    const now = new Date().toISOString();
    const stockDespues = (editando.stock ?? 0) + cantidadAplicada;
    const movimiento: MovimientoStock = {
      id: crypto.randomUUID(),
      producto_id: editando.id,
      producto_nombre: editando.nombre,
      tipo: tipoRM,
      motivo: motivoRM,
      cantidad: cantidadAplicada,
      stock_resultante: stockDespues,
      usuario_id: user?.id,
      usuario_nombre: userNombre || undefined,
      nota: notaRM.trim() || undefined,
      ocurrido_en: now,
      sincronizado: false,
    };

    // Mismo camino offline-first que ya usa "Registrar merma" en este mismo
    // archivo — optimista local primero, nunca se revierte solo porque
    // falle la red.
    await saveMovimiento(movimiento);
    await actualizarStockLocal(editando.id, stockDespues);
    setEditando(e => (e ? { ...e, stock: stockDespues } : e));
    setForm(f => ({ ...f, stock: String(stockDespues) }));

    if (!isOnline) {
      await encolarAplicarMovimientoStock(movimiento.id, negocioId);
      setGuardandoRM(false);
      setShowRegistroMovimiento(false);
      await cargar();
      showToast('Guardado localmente — se sincronizará cuando haya conexión');
      return;
    }

    const resultado = await aplicarMovimientoStockRemoto(movimiento);
    setGuardandoRM(false);

    if (resultado.permanente) {
      showToast(`No se pudo registrar: ${resultado.mensaje ?? 'el servidor lo rechazó'}`);
      setShowRegistroMovimiento(false);
      await cargar();
      return;
    }

    if (!resultado.ok) {
      await encolarAplicarMovimientoStock(movimiento.id, negocioId);
      setShowRegistroMovimiento(false);
      await cargar();
      showToast('Guardado localmente — no se pudo confirmar con el servidor todavía, se reintentará');
      return;
    }

    await saveMovimiento({ ...movimiento, sincronizado: true, stock_resultante: resultado.nuevoStock });
    setShowRegistroMovimiento(false);
    await cargar();
    showToast('Movimiento registrado');
  };

  // Se bloquea "Existencia actual" en cuanto el producto tiene aunque sea
  // un movimiento registrado — la única vía para tocarla a partir de ahí es
  // Movimientos, nunca un UPDATE directo sin motivo/usuario/rastro. Un
  // producto nuevo (editando === null) o sin movimientos sigue editable
  // libre, para poder cargar el inventario inicial. tiene_movimientos la
  // mantiene un trigger en Supabase — de solo lectura acá.
  const existenciaBloqueada = !!editando?.tiene_movimientos;

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

  // No usa handleCostoChange: ese recalcula margen/precio a partir de
  // campoActivo, y si el activo era "precio" terminaría mezclando el precio
  // VIEJO con el costo nuevo recién calculado. Acá se limpian los 3 campos
  // derivados (margen, ganancia, precio) a propósito: que el comerciante
  // decida un margen y precio frescos (a mano o con los atajos) a partir
  // del costo real que acaba de cargar, sin arrastrar nada calculado contra
  // el costo anterior.
  const usarCostoDeCaja = () => {
    if (costoUnitarioCaja === null) return;
    setCampoActivo('margen');
    setForm(f => ({ ...f, costo: costoUnitarioCaja, margen: '', ganancia: '', precio: '' }));
    cerrarCalcCaja();
  };

  // Suma al precio de venta (no al costo) — misma fórmula que el mockup:
  // valorUsd = Σ precioUSD(p) × stock, sobre activos que llevan control.
  const valorInventarioUsd = conControl.reduce((s, p) => s + precioUSD(p, tasa) * (p.stock ?? 0), 0);

  return (
    <div>
      <header className="bg-superficie-barra border-b border-borde-divisor px-4 pt-3.5 pb-3 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-texto truncate">Inventario</h1>
          <p className="text-[11px] font-medium text-texto-3 truncate">
            {activos.length} productos · {bajos.length} por reponer
          </p>
        </div>
        <ThemeToggle variant="neutro" />
        {usaStock && rol === 'admin' && (
          <button
            onClick={() => router.push('/movimientos')}
            className="flex-none w-11 h-11 flex items-center justify-center rounded-xl bg-tarjeta-hundida text-texto-2"
            aria-label="Movimientos de stock"
          >
            <Icon nombre="registrarMovimiento" tamano={TAMANO_ICONO.secundario} />
          </button>
        )}
        <button
          onClick={abrirNuevo}
          className="flex-none h-11 px-4 rounded-xl bg-marca text-texto-invertido font-semibold text-sm flex items-center gap-1.5 active:bg-marca-presion"
        >
          <Icon nombre="agregar" tamano={TAMANO_ICONO.secundario} />
          Agregar
        </button>
      </header>

      <div className="px-4 pt-3 pb-4 bg-superficie-barra border-b border-borde-divisor flex flex-col gap-2.5">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Icon
              nombre="buscar"
              tamano={TAMANO_ICONO.buscarYToggle}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-texto-3"
            />
            <input
              type="text"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && pareceCodigoBarra(busqueda)) handleScanInventario(busqueda.trim());
              }}
              placeholder="Buscar por nombre o código"
              className="w-full pl-9 pr-4 h-11 rounded-xl bg-tarjeta border border-borde-campo text-sm text-texto placeholder:text-texto-4 outline-none focus:border-foco"
            />
          </div>
          <button
            onClick={() => setShowScannerBuscar(true)}
            className="flex-none w-11 h-11 rounded-xl bg-marca text-texto-invertido flex items-center justify-center active:bg-marca-presion"
            aria-label="Escanear código"
          >
            <Icon nombre="escanearCodigoBarras" tamano={TAMANO_ICONO.buscarYToggle} />
          </button>
        </div>

        {/* pb-1 + overflow visible: deja aire para que la barra de scroll del
            navegador no quede pegada/pisando los chips (reporte de Preview) */}
        <div className="flex gap-2 -mx-4 px-4 pb-1 overflow-x-auto">
          {[
            { id: 'todos' as const, label: 'Todos', cuenta: activos.length },
            { id: 'bajo' as const, label: 'Stock bajo', cuenta: bajos.length },
            { id: 'sin' as const, label: 'Sin stock', cuenta: ceros.length },
          ].map(c => {
            const activo = chip === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setChip(c.id)}
                className={`flex-shrink-0 h-[34px] px-3.5 rounded-full text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors border ${
                  activo ? 'bg-marca-suave text-marca-suave-texto border-marca' : 'bg-transparent text-texto-3 border-borde-campo'
                }`}
              >
                {c.label}
                <span className="tabular-nums opacity-70">{c.cuenta}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-4 py-3.5 flex flex-col gap-3.5">
        {!cargandoProductos && usaStock && rol === 'admin' && (
          <div className="flex flex-col gap-2.5">
            <div className="p-5 rounded-2xl bg-tinta">
              <p className="text-[11px] font-bold uppercase tracking-wide text-tinta-etiqueta">
                Valor del inventario
              </p>
              <p className="mt-1.5 text-4xl font-extrabold text-tinta-texto tracking-tight tabular-nums">
                {formatUSD(valorInventarioUsd)}
              </p>
              <p className="mt-1 text-tinta-etiqueta tabular-nums">
                {formatBS(valorInventarioUsd * tasa)} · al precio de venta
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              <div className="p-3 bg-tarjeta border border-borde-tarjeta rounded-2xl flex flex-col gap-1">
                <p className="text-xl font-bold text-texto tabular-nums">{activos.length}</p>
                <p className="text-[11px] font-semibold text-texto-2 leading-tight">Productos activos</p>
              </div>
              <div
                className={`p-3 bg-tarjeta border rounded-2xl flex flex-col gap-1 ${
                  bajos.length > 0 ? 'border-aviso-borde' : 'border-borde-tarjeta'
                }`}
              >
                <p className={`text-xl font-bold tabular-nums ${bajos.length > 0 ? 'text-aviso' : 'text-texto-3'}`}>
                  {bajos.length}
                </p>
                <p className="text-[11px] font-semibold text-texto-2 leading-tight">En stock bajo</p>
              </div>
              <div
                className={`p-3 bg-tarjeta border rounded-2xl flex flex-col gap-1 ${
                  ceros.length > 0 ? 'border-negativo-borde' : 'border-borde-tarjeta'
                }`}
              >
                <p className={`text-xl font-bold tabular-nums ${ceros.length > 0 ? 'text-negativo' : 'text-texto-3'}`}>
                  {ceros.length}
                </p>
                <p className="text-[11px] font-semibold text-texto-2 leading-tight">En cero</p>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-texto-2">Catálogo</p>
          <button
            onClick={() => setOrden(o => (o === 'stock' ? 'nombre' : 'stock'))}
            className="h-[34px] px-3 rounded-full border border-borde-campo bg-tarjeta text-texto-2 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
          >
            <Icon nombre="ordenar" tamano={14} />
            {orden === 'stock' ? 'Existencia' : 'Nombre'}
          </button>
        </div>

        {cargandoProductos ? (
          <div className="text-center text-texto-3 py-16">
            <svg className="w-8 h-8 mx-auto mb-3 text-marca animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm">Cargando productos...</p>
          </div>
        ) : filtrados.length === 0 ? (
          <div className="text-center text-texto-3 py-16">
            <Icon nombre="inventario" tamano={48} className="mx-auto mb-3 text-texto-4" />
            <p className="font-medium">{busqueda ? `Sin resultados para "${busqueda}"` : 'Sin productos'}</p>
            {!busqueda && (
              <button onClick={abrirNuevo} className="mt-3 text-marca font-semibold text-sm">
                Agregar el primero
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {filtrados.map(p => {
              const pbs = tasa > 0 ? precioBS(p, tasa) : null;
              const pusd = tasa > 0 ? precioUSD(p, tasa) : null;
              const controla = p.controla_stock !== false;
              const cero = controla && p.stock != null && p.stock <= 0;
              const bajo = controla && !cero && stockBajo(p.stock, p.stock_minimo);

              // Sin chip "Desactivados", esta lista nunca incluye productos
              // inactivos (ver filtro de "filtrados" más arriba) — no hace
              // falta esa etiqueta acá.
              let etiqueta: { texto: string; bg: string; tx: string } | null = null;
              if (!controla) etiqueta = { texto: 'Sin control', bg: 'bg-tarjeta-hundida', tx: 'text-texto-2' };
              else if (cero) etiqueta = { texto: 'En cero', bg: 'bg-negativo-fondo', tx: 'text-negativo' };
              else if (bajo) etiqueta = { texto: 'Stock bajo', bg: 'bg-aviso-fondo', tx: 'text-aviso' };

              const umbral = p.stock_minimo ?? 0;
              const pct =
                !controla || p.stock == null
                  ? 0
                  : Math.max(cero ? 0 : 4, Math.min(100, (p.stock / Math.max(umbral * 3, 1)) * 100));
              const barColor = cero ? 'bg-negativo' : bajo ? 'bg-aviso' : 'bg-marca';
              // Mismo criterio que StockBadge (versión anterior de esta
              // pantalla): con stock bajo/en cero y la sincronización posible-
              // mente vieja (offline o hace más de HORAS_LIMITE_CONFIANZA), no
              // se muestra el número — otro dispositivo pudo haber agotado el
              // producto y el cajero no debe confiar en un dato desactualizado.
              const ocultarStock = controla && debeOcultarStock(p.stock, p.stock_minimo, isOnline, ultimaSincronizacion);
              const stockTexColor = ocultarStock
                ? 'text-aviso'
                : cero
                ? 'text-negativo'
                : bajo
                ? 'text-aviso'
                : 'text-texto-3';
              const stockTexto = ocultarStock
                ? 'Consultar'
                : !controla
                ? 'No lleva control'
                : p.stock == null
                ? 'Sin inicializar'
                : p.por_peso
                ? `${fmtCantidad(p.stock)} kg`
                : `${fmtCantidad(p.stock)} ${Math.round(p.stock) === 1 ? 'unidad' : 'unidades'}`;

              return (
                <button
                  key={p.id}
                  onClick={() => abrirEditar(p)}
                  className={`text-left p-3 bg-tarjeta border rounded-2xl flex flex-col gap-2.5 transition-transform active:scale-[0.99] ${
                    cero ? 'border-negativo-borde' : 'border-borde-tarjeta'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 flex flex-col gap-1.5">
                      <p className="font-semibold text-[15px] text-texto leading-tight text-pretty">
                        {formatearNombre(p.nombre)}
                        {p.por_peso && <span className="font-medium text-texto-2"> / kg</span>}
                      </p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-medium text-texto-2 tabular-nums">
                          {p.codigo_barra || 'Sin código'}
                        </span>
                        {etiqueta && (
                          <span
                            className={`h-5 px-1.5 inline-flex items-center rounded-full text-[11px] font-bold whitespace-nowrap ${etiqueta.bg} ${etiqueta.tx}`}
                          >
                            {etiqueta.texto}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-bold text-lg text-texto tabular-nums whitespace-nowrap">
                        {pbs !== null ? formatBS(pbs) : `${p.precio} ${p.moneda}`}
                        {p.por_peso && <span className="text-sm font-normal text-texto-2"> / kg</span>}
                      </p>
                      {pbs !== null && (
                        <p className="text-sm font-medium text-texto-2 tabular-nums whitespace-nowrap">
                          {pusd !== null ? formatUSD(pusd) : ''}
                        </p>
                      )}
                    </div>
                  </div>
                  {usaStock && (
                    <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 items-center">
                      <div className="h-1.5 rounded-full bg-tarjeta-hundida overflow-hidden">
                        <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                      </div>
                      <p className={`text-right text-sm font-bold tabular-nums whitespace-nowrap ${stockTexColor}`}>
                        {stockTexto}
                      </p>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Editar / Nuevo producto */}
      <BottomSheet
        abierto={showModal}
        onCerrar={() => setShowModal(false)}
        titulo={editando ? 'Editar producto' : 'Nuevo producto'}
      >
        <div className="space-y-5">
          {!isOnline && (
            <div className="p-3 rounded-[12px] bg-aviso-fondo border border-aviso-borde text-aviso text-sm">
              Sin conexión — se guarda en el dispositivo y se sincroniza al reconectar
            </div>
          )}

          <Input
            label="Nombre"
            type="text"
            value={form.nombre}
            onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
            placeholder="Nombre del producto"
            autoFocus
          />

          <div className="flex items-center justify-between py-1">
            <div>
              <p className="text-sm font-medium text-texto">Se vende por peso</p>
              <p className="text-xs text-texto-3 mt-0.5">El precio será por kilo (kg)</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.por_peso}
              onClick={() => setForm(f => ({ ...f, por_peso: !f.por_peso }))}
              className={`relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                form.por_peso ? 'bg-marca' : 'bg-tarjeta-hundida'
              }`}
            >
              <span
                className={`inline-block w-5 h-5 m-0.5 bg-tarjeta rounded-full shadow-sm transition-transform ${
                  form.por_peso ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-texto-3">Código de barra</label>
            <div className="flex gap-2">
              <Input
                type="text"
                value={form.codigo_barra}
                onChange={e => setForm(f => ({ ...f, codigo_barra: e.target.value }))}
                className="font-mono"
                placeholder="Opcional"
              />
              <button
                type="button"
                onClick={() => setShowScanner(true)}
                className="flex-none w-[52px] h-[52px] rounded-[12px] border border-borde-campo bg-tarjeta-hundida text-texto-2 flex items-center justify-center"
                aria-label="Escanear código de barra"
              >
                <Icon nombre="escanearCodigoBarras" tamano={20} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 items-end">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-texto-3">
                {form.por_peso ? 'Precio por kilo' : 'Precio'} <span className="text-negativo">*</span>
              </label>
              <div className="flex items-center gap-2 h-[52px] px-3.5 rounded-[12px] bg-tarjeta border border-borde-campo focus-within:border-foco">
                <span className="text-texto-3 font-medium">{form.moneda === 'USD' ? '$' : 'Bs'}</span>
                <input
                  type="number"
                  step="0.01"
                  value={form.precio}
                  onChange={e =>
                    mostrarCosto ? handlePrecioChange(e.target.value) : setForm(f => ({ ...f, precio: e.target.value }))
                  }
                  className="flex-1 min-w-0 bg-transparent outline-none text-lg font-bold text-texto tabular-nums"
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-texto-3">Moneda</label>
              <div className="flex gap-1.5">
                {(['USD', 'VES'] as const).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, moneda: m }))}
                    className={`flex-1 h-[52px] rounded-[12px] font-bold text-sm ${
                      form.moneda === m ? 'bg-marca text-texto-invertido' : 'bg-tarjeta-hundida text-texto-2'
                    }`}
                  >
                    {m === 'USD' ? '$ USD' : 'Bs VES'}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {tasa > 0 && form.precio && parseFloat(form.precio) > 0 && (
            <p className="text-sm text-texto-3 -mt-3">
              {form.moneda === 'USD'
                ? `Bs ${(parseFloat(form.precio) * tasa).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : `$ ${(parseFloat(form.precio) / tasa).toFixed(2)}`}
              {form.por_peso ? ' / kg' : ''}
            </p>
          )}
          {costoMayorQuePrecio && (
            <p className="text-sm text-negativo font-medium -mt-3">El costo es mayor que el precio de venta</p>
          )}

          {usaStock && rol === 'admin' && (
            <>
              <div className="h-px bg-borde-divisor" />

              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-sm font-medium text-texto">Llevar control de este producto</p>
                  <p className="text-xs text-texto-3 mt-0.5">Apágalo para granel o servicios</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.controla_stock}
                  onClick={() => setForm(f => ({ ...f, controla_stock: !f.controla_stock }))}
                  className={`relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                    form.controla_stock ? 'bg-marca' : 'bg-tarjeta-hundida'
                  }`}
                >
                  <span
                    className={`inline-block w-5 h-5 m-0.5 bg-tarjeta rounded-full shadow-sm transition-transform ${
                      form.controla_stock ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {form.controla_stock && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <label className="text-sm text-texto-3">
                        Existencia actual {form.por_peso ? '(kilos)' : ''}
                      </label>
                      {existenciaBloqueada && (
                        <span className="h-[22px] px-2 inline-flex items-center gap-1 rounded-full bg-informativo-fondo text-informativo text-[11px] font-bold whitespace-nowrap">
                          <Icon nombre="candado" tamano={12} />
                          Con movimientos
                        </span>
                      )}
                    </div>
                    <input
                      type="number"
                      step="0.001"
                      value={form.stock}
                      onChange={e => setForm(f => ({ ...f, stock: e.target.value }))}
                      disabled={existenciaBloqueada}
                      className={`h-[52px] px-3.5 rounded-[12px] border outline-none text-lg font-bold tabular-nums ${
                        existenciaBloqueada
                          ? 'bg-tarjeta-hundida border-borde-campo text-texto-3 cursor-not-allowed'
                          : 'bg-tarjeta border-borde-campo text-texto focus:border-foco'
                      }`}
                      placeholder="Opcional"
                    />
                    {existenciaBloqueada ? (
                      <div className="p-3 rounded-[12px] bg-informativo-fondo border border-informativo flex flex-col gap-2">
                        <p className="text-sm text-informativo leading-relaxed text-pretty">
                          Este producto ya tiene movimientos registrados. La existencia se calcula sola a partir de
                          ellos: cambiarla a mano dejaría el inventario sin explicación de por qué cambió.
                        </p>
                        <button
                          type="button"
                          onClick={() => router.push('/movimientos')}
                          className="self-start h-11 px-3.5 flex items-center gap-2 rounded-[10px] border border-informativo bg-tarjeta text-informativo font-bold text-sm"
                        >
                          <Icon nombre="registrarMovimiento" tamano={16} />
                          Movimientos → Ajuste por conteo
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-texto-2 leading-snug text-pretty">
                        Sin movimientos todavía — puedes cargar la existencia inicial a mano.
                      </p>
                    )}
                  </div>

                  {editando && (
                    <>
                      <button
                        type="button"
                        onClick={abrirMerma}
                        className="w-full flex items-center gap-3 min-h-[56px] px-3.5 py-2.5 rounded-[12px] border border-borde-campo bg-tarjeta text-texto text-left"
                      >
                        <span className="flex-none w-9 h-9 rounded-[10px] bg-tarjeta-hundida text-texto-2 flex items-center justify-center">
                          <Icon nombre="registrarMerma" tamano={18} />
                        </span>
                        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                          <span className="font-semibold text-[15px]">Registrar merma</span>
                          <span className="text-xs text-texto-3">Daño, vencido, pérdida o consumo propio</span>
                        </span>
                        <Icon nombre="flechaDerecha" tamano={16} className="flex-none text-texto-4" />
                      </button>
                      <button
                        type="button"
                        onClick={abrirRegistroMovimiento}
                        className="w-full flex items-center gap-3 min-h-[56px] px-3.5 py-2.5 rounded-[12px] border border-borde-campo bg-tarjeta text-texto text-left"
                      >
                        <span className="flex-none w-9 h-9 rounded-[10px] bg-tarjeta-hundida text-texto-2 flex items-center justify-center">
                          <Icon nombre="registrarMovimiento" tamano={18} />
                        </span>
                        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                          <span className="font-semibold text-[15px]">Registrar movimiento</span>
                          <span className="text-xs text-texto-3">Entrada, salida o ajuste por conteo</span>
                        </span>
                        <Icon nombre="flechaDerecha" tamano={16} className="flex-none text-texto-4" />
                      </button>
                    </>
                  )}

                  <Input
                    label={`Alerta cuando quede menos de ${form.por_peso ? '(kilos)' : ''}`}
                    type="number"
                    step="0.001"
                    value={form.stock_minimo}
                    onChange={e => setForm(f => ({ ...f, stock_minimo: e.target.value }))}
                    placeholder="Opcional"
                  />
                </>
              )}
            </>
          )}

          {mostrarCosto && (
            <>
              <div className="h-px bg-borde-divisor" />

              <button
                type="button"
                onClick={() => setCostosAbiertos(v => !v)}
                className="w-full flex items-center justify-between gap-2 min-h-11"
              >
                <span className="text-sm font-semibold text-texto-2">Costo y margen</span>
                <span className="flex items-center gap-1.5 text-xs font-medium text-texto-3">
                  {!costosAbiertos &&
                    (form.margen.trim() && !isNaN(parseNum(form.margen)) ? `${form.margen} %` : 'Opcional')}
                  <Icon
                    nombre="flechaDerecha"
                    tamano={16}
                    className={`transition-transform ${costosAbiertos ? 'rotate-90' : ''}`}
                  />
                </span>
              </button>

              {costosAbiertos && (
                <div className="flex flex-col gap-4 p-3 rounded-[12px] bg-tarjeta-hundida border border-borde-campo">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-sm text-texto-3">
                        {form.por_peso ? 'Costo por kilo' : 'Costo'} ({form.moneda})
                      </label>
                      <button
                        type="button"
                        onClick={() => (showCalcCaja ? cerrarCalcCaja() : setShowCalcCaja(true))}
                        className="text-xs font-bold text-marca"
                      >
                        {form.por_peso ? 'Calcular desde bulto' : 'Calcular desde caja'}
                      </button>
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      value={form.costo}
                      onChange={e => handleCostoChange(e.target.value)}
                      disabled={showCalcCaja}
                      className={`w-full h-12 px-3 rounded-[10px] bg-tarjeta border border-borde-campo outline-none text-base font-semibold ${
                        showCalcCaja ? 'text-texto-3 cursor-not-allowed' : 'text-texto focus:border-foco'
                      }`}
                      placeholder="Opcional"
                    />
                    {showCalcCaja && (
                      <div className="mt-2 p-3 bg-tarjeta border border-borde-campo rounded-[12px] flex flex-col gap-2">
                        <div>
                          <label className="text-xs font-medium text-texto-3 mb-1 block">
                            {form.por_peso ? 'Kilos por bulto' : 'Unidades por caja'}
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={unidadesCaja}
                            onChange={e => setUnidadesCaja(e.target.value)}
                            className="w-full h-10 px-3 rounded-[8px] bg-tarjeta-hundida border border-borde-campo text-sm text-texto outline-none focus:border-foco"
                            placeholder={form.por_peso ? 'Ej: 20' : 'Ej: 24'}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-texto-3 mb-1 block">
                            {form.por_peso ? 'Costo total del bulto' : 'Costo total de la caja'} ({form.moneda})
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={costoCaja}
                            onChange={e => setCostoCaja(e.target.value)}
                            className="w-full h-10 px-3 rounded-[8px] bg-tarjeta-hundida border border-borde-campo text-sm text-texto outline-none focus:border-foco"
                            placeholder="Ej: 18,00"
                          />
                        </div>
                        <p className="text-sm text-texto-2">
                          {form.por_peso ? 'Costo por kilo' : 'Costo por unidad'}: {costoUnitarioCaja ?? '—'}
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={cerrarCalcCaja}
                            className="flex-1 py-2 rounded-[8px] text-xs font-bold bg-tarjeta text-texto-2"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            disabled={costoUnitarioCaja === null}
                            onClick={usarCostoDeCaja}
                            className="flex-1 py-2 rounded-[8px] text-xs font-bold bg-marca text-texto-invertido disabled:opacity-40"
                          >
                            Usar este costo
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="text-sm text-texto-3 mb-1.5 block">Margen sobre costo (%)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={form.margen}
                      onChange={e => handleMargenChange(e.target.value)}
                      className="w-full h-12 px-3 rounded-[10px] bg-tarjeta border border-borde-campo outline-none text-base font-semibold text-texto focus:border-foco"
                      placeholder="Ej: 33,5"
                    />
                    <div className="flex gap-2 mt-2">
                      {MARGENES_RAPIDOS.map(pct => (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => aplicarMargenRapido(pct)}
                          className="flex-1 py-1.5 rounded-[8px] text-xs font-bold bg-tarjeta text-texto-2"
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-sm text-texto-3 mb-1.5 block">
                      Ganancia {form.por_peso ? 'por kilo' : ''} ({form.moneda})
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={form.ganancia}
                      onChange={e => handleGananciaChange(e.target.value)}
                      className="w-full h-12 px-3 rounded-[10px] bg-tarjeta border border-borde-campo outline-none text-base font-semibold text-texto focus:border-foco"
                      placeholder="Ej: 1,50"
                    />
                  </div>

                  <p className="text-xs text-texto-2 leading-snug">
                    Casi ningún negocio lleva costos — si lo dejas vacío no se guarda nada.
                  </p>
                </div>
              )}
            </>
          )}

          {error && <p className="text-negativo text-sm">{error}</p>}

          <div className="flex gap-2">
            {editando && (
              <button
                type="button"
                onClick={() => {
                  setShowModal(false);
                  setConfirmDelete(editando);
                }}
                aria-label="Eliminar producto"
                className="flex-none w-[52px] h-[52px] rounded-[14px] border border-negativo-borde bg-negativo-fondo text-negativo flex items-center justify-center"
              >
                <Icon nombre="eliminar" tamano={20} />
              </button>
            )}
            <Button variante="primario" disabled={guardando} onClick={guardar} className="flex-1">
              {guardando ? 'Guardando...' : editando ? 'Actualizar' : 'Agregar producto'}
            </Button>
          </div>
        </div>
      </BottomSheet>

      {/* Registrar merma — atajo desde el sheet de editar producto, solo admin */}
      <BottomSheet abierto={showMerma} onCerrar={() => setShowMerma(false)} titulo="Registrar merma">
        {editando && (
          <div className="space-y-5">
            <div>
              <p className="font-caja font-semibold text-texto">{formatearNombre(editando.nombre)}</p>
              <p className="font-caja text-sm text-texto-3">
                Quedan {fmtCantidad(editando.stock ?? 0)} {editando.por_peso ? 'kg' : 'uds'}
              </p>
            </div>

            <div>
              <p className="font-caja text-sm font-semibold text-texto-3 mb-2">Motivo</p>
              <div className="flex flex-wrap gap-2">
                {MOTIVOS_MERMA.map(m => (
                  <ChipFiltro key={m.value} activo={motivoMerma === m.value} onClick={() => setMotivoMerma(m.value)}>
                    {m.label}
                  </ChipFiltro>
                ))}
              </div>
            </div>

            {editando.por_peso ? (
              <div>
                <p className="font-caja text-sm font-semibold text-texto-3 mb-2">Cantidad (gramos)</p>
                <input
                  type="number"
                  inputMode="numeric"
                  step="1"
                  min="1"
                  value={gramosMerma}
                  onChange={e => setGramosMerma(e.target.value)}
                  placeholder="Gramos"
                  className="font-caja w-full rounded-[12px] border border-borde-campo bg-tarjeta text-texto px-4 py-4 text-3xl font-bold text-center outline-none focus:border-foco"
                  autoFocus
                />
              </div>
            ) : (
              <div>
                <p className="font-caja text-sm font-semibold text-texto-3 mb-2">Cantidad</p>
                <div className="flex items-center justify-center gap-4">
                  <button
                    type="button"
                    onClick={() => setCantidadMerma(c => Math.max(1, c - 1))}
                    className="w-11 h-11 rounded-full bg-tarjeta-hundida flex items-center justify-center text-xl font-bold text-texto-2"
                    aria-label="Restar"
                  >
                    −
                  </button>
                  <span className="font-caja cifra text-2xl font-bold text-texto w-24 text-center">
                    {fmtCantidad(cantidadMerma)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCantidadMerma(c => c + 1)}
                    className="w-11 h-11 rounded-full bg-marca-suave flex items-center justify-center text-xl font-bold text-marca-suave-texto"
                    aria-label="Sumar"
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            {cantidadMermaAplicada > (editando.stock ?? 0) && (
              <p className="font-caja text-sm text-aviso bg-aviso-fondo border border-aviso-borde rounded-[12px] px-3 py-2">
                Supera la existencia actual — igual se puede registrar.
              </p>
            )}

            <div>
              <label className="font-caja text-sm font-semibold text-texto-3 mb-2 block">Nota (opcional)</label>
              <textarea
                value={notaMerma}
                onChange={e => setNotaMerma(e.target.value)}
                rows={2}
                className="font-caja w-full rounded-[12px] border border-borde-campo bg-tarjeta text-texto text-base px-4 py-3 placeholder:text-texto-4 outline-none focus:border-foco"
                placeholder="Opcional"
              />
            </div>

            <Button
              variante="primario"
              disabled={!motivoMerma || cantidadMermaAplicada <= 0 || guardandoMerma}
              onClick={guardarMerma}
              className="w-full"
            >
              {guardandoMerma
                ? 'Guardando...'
                : `Registrar ${fmtCantidad(cantidadMermaAplicada)} ${editando.por_peso ? 'kg' : 'uds'}`}
            </Button>
          </div>
        )}
      </BottomSheet>

      {/* Registrar movimiento — mismo formulario de Movimientos, sin buscador
          (el producto ya es "editando"), atajo desde el sheet de editar
          producto, solo admin */}
      <BottomSheet
        abierto={showRegistroMovimiento}
        onCerrar={() => setShowRegistroMovimiento(false)}
        titulo="Registrar movimiento"
      >
        {editando && (
          <div className="space-y-5">
            <div>
              <p className="font-caja font-semibold text-texto">{formatearNombre(editando.nombre)}</p>
              <p className="font-caja text-sm text-texto-3">
                Existencia actual: {editando.stock != null ? fmtCantidad(editando.stock) : 'sin inicializar'}
                {editando.por_peso ? ' kg' : ''}
              </p>
            </div>

            <div>
              <p className="font-caja text-sm font-semibold text-texto-3 mb-2">Tipo</p>
              <div className="flex gap-2">
                {(['entrada', 'salida', 'ajuste'] as TipoUI[]).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => cambiarTipoRM(t)}
                    className={`flex-1 py-2.5 rounded-[12px] text-sm font-semibold transition-colors ${
                      tipoRM === t ? 'bg-marca text-texto-invertido' : 'bg-tarjeta-hundida text-texto-2'
                    }`}
                  >
                    {TIPO_TAB_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>

            {tipoRM !== 'ajuste' && (
              <div>
                <p className="font-caja text-sm font-semibold text-texto-3 mb-2">Motivo</p>
                <div className="flex flex-wrap gap-2">
                  {MOTIVOS[tipoRM].map(m => (
                    <ChipFiltro key={m.value} activo={motivoRM === m.value} onClick={() => setMotivoRM(m.value)}>
                      {m.label}
                    </ChipFiltro>
                  ))}
                </div>
              </div>
            )}

            <Input
              label={
                tipoRM === 'ajuste'
                  ? `Cantidad real contada${editando.por_peso ? ' (kilos)' : ''}`
                  : `Cantidad${editando.por_peso ? ' (kilos)' : ''}`
              }
              type="number"
              step="0.001"
              value={cantidadRM}
              onChange={e => setCantidadRM(e.target.value)}
              placeholder="0"
            />

            {diferenciaConteoRM !== null && (
              <p className={`font-caja text-sm font-medium ${diferenciaConteoRM >= 0 ? 'text-marca' : 'text-negativo'}`}>
                Diferencia: {diferenciaConteoRM >= 0 ? '+' : ''}{fmtCantidad(diferenciaConteoRM)}
              </p>
            )}

            <Input
              label="Nota (opcional)"
              type="text"
              value={notaRM}
              onChange={e => setNotaRM(e.target.value)}
              placeholder="Opcional"
            />

            {errorRM && <p className="font-caja text-sm text-negativo">{errorRM}</p>}

            <Button variante="primario" disabled={guardandoRM} onClick={guardarRM} className="w-full">
              {guardandoRM ? 'Guardando...' : 'Registrar'}
            </Button>
          </div>
        )}
      </BottomSheet>

      {/* Confirmar eliminación */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-overlay" onClick={() => setConfirmDelete(null)} />
          <div className="relative bg-tarjeta rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-bold text-texto mb-2">Eliminar producto</h3>
            <p className="text-texto-3 mb-5">
              ¿Eliminar <strong className="text-texto">{confirmDelete.nombre}</strong>? Esta acción no se puede
              deshacer.
            </p>
            <div className="flex gap-3">
              <Button variante="secundario" onClick={() => setConfirmDelete(null)} className="flex-1">
                Cancelar
              </Button>
              <Button variante="destructivo" onClick={() => eliminar(confirmDelete)} className="flex-1">
                Eliminar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-toast-fondo text-toast-texto px-5 py-2.5 rounded-xl text-sm font-medium z-50 shadow-lg whitespace-nowrap">
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

      {/* Barcode scanner — renders on top de todos los modales (último en el DOM) */}
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
