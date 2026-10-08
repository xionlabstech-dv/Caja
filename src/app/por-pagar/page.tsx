'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Acreedor, TipoAcreedor } from '@/types';
import { getAcreedores, saveAcreedor } from '@/lib/db';
import { encolarCrearAcreedor } from '@/lib/outbox';
import { formatBS, formatUSD } from '@/lib/precio';
import { useApp } from '@/components/Providers';
import { useGuardarRuta } from '@/lib/useGuardarRuta';
import ThemeToggle from '@/components/ThemeToggle';
import Button from '@/components/ui/Button';
import BottomSheet from '@/components/ui/BottomSheet';
import ChipFiltro from '@/components/ui/ChipFiltro';
import Icon from '@/components/ui/Icon';
import { TAMANO_ICONO } from '@/components/ui/iconos';

const TIPOS: { id: TipoAcreedor; label: string; labelPlural: string }[] = [
  { id: 'proveedor', label: 'Proveedor', labelPlural: 'Proveedores' },
  { id: 'servicio', label: 'Servicio', labelPlural: 'Servicios' },
  { id: 'persona', label: 'Persona', labelPlural: 'Personas' },
];

function labelTipo(tipo: TipoAcreedor): string {
  return TIPOS.find(t => t.id === tipo)?.label ?? tipo;
}

// Saldos que quedaron en centavos de nada por redondeo no cuentan como
// deuda real — mismo margen que usa Fiado, y el mismo que acreedores_listar
// usa internamente para decidir `vencido`: tienen que coincidir.
const EPSILON_SALDO = 0.005;

// proximo_vencimiento es un 'date' puro de Postgres ('YYYY-MM-DD'):
// parsearlo con `new Date(iso)` a secas lo interpreta en UTC y puede
// mostrar el día anterior según la zona horaria (mismo cuidado que
// fmtFechaCorta en presupuestos/page.tsx).
function fmtVencimiento(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return new Date(anio, mes - 1, dia).toLocaleDateString('es-VE', { day: 'numeric', month: 'long' });
}

export default function PorPagarPage() {
  const permitida = useGuardarRuta();
  const { tasa, isOnline, negocioId, usaCuentasPagar, productosVersion } = useApp();
  const router = useRouter();

  const [acreedores, setAcreedores] = useState<Acreedor[]>([]);
  const [cargando, setCargando] = useState(true);
  const [chip, setChip] = useState<'todos' | TipoAcreedor>('todos');

  const [creando, setCreando] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [tipoNuevo, setTipoNuevo] = useState<TipoAcreedor | null>(null);
  const [notaNuevo, setNotaNuevo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [errorNuevo, setErrorNuevo] = useState('');
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  // Módulo opcional apagado por default: useGuardarRuta ya cubre rol/estado
  // (la ruta vive en RUTAS_ADMIN/RUTAS_OCULTAS_RESTRINGIDO), pero no sabe de
  // usa_cuentas_pagar — un admin con el módulo apagado tiene la ruta
  // permitida y llegaría a esta pantalla escribiendo la URL a mano.
  useEffect(() => {
    if (!usaCuentasPagar) router.replace('/');
  }, [usaCuentasPagar, router]);

  // acreedores viaja en el mismo sync periódico que productos (ver
  // syncFromSupabase) — se relee de IndexedDB con el mismo disparador que
  // usa Fiado, funciona sin conexión con el último dato sincronizado. A
  // diferencia de getProductos(), getAcreedores() no filtra por `activo` —
  // se filtra acá, o se mostrarían proveedores ya dados de baja.
  useEffect(() => {
    let cancelado = false;
    getAcreedores().then(as => {
      if (cancelado) return;
      setAcreedores(as.filter(a => a.activo));
      setCargando(false);
    });
    return () => { cancelado = true; };
  }, [productosVersion]);

  // Recién ahora, con todos los hooks ya llamados, se puede cortar el
  // render — mismo criterio que Fiado, evita un frame de contenido indebido
  // antes de que el redirect del efecto de arriba (o useGuardarRuta) actúe.
  if (!permitida || !usaCuentasPagar) return null;

  const conDeuda = acreedores.filter(a => a.saldo_usd > EPSILON_SALDO);
  const vencidos = conDeuda.filter(a => a.vencido);

  const totalDeudaUsd = conDeuda.reduce((s, a) => s + a.saldo_usd, 0);
  const totalDeudaBs = tasa > 0 ? totalDeudaUsd * tasa : 0;
  const montoVencidoUsd = vencidos.reduce((s, a) => s + a.saldo_usd, 0);

  // El RPC ya los devuelve ordenados (saldo_usd desc, nombre) pero sin
  // conexión los datos salen de IndexedDB, donde ese orden no está
  // garantizado — se ordena también acá.
  const acreedoresFiltrados = acreedores
    .filter(a => (chip === 'todos' ? true : a.tipo === chip))
    .sort((a, b) => b.saldo_usd - a.saldo_usd || a.nombre.localeCompare(b.nombre, 'es'));

  const abrirCrear = () => {
    setNombreNuevo('');
    setTipoNuevo(null);
    setNotaNuevo('');
    setErrorNuevo('');
    setCreando(true);
  };

  const cerrarCrear = () => {
    if (guardando) return;
    setCreando(false);
  };

  const confirmarCrear = async () => {
    if (!negocioId) return;
    const nombre = nombreNuevo.trim();
    if (!nombre) {
      setErrorNuevo('Ingresa un nombre');
      return;
    }
    if (!tipoNuevo) {
      setErrorNuevo('Elige un tipo');
      return;
    }

    setGuardando(true);
    const nuevo: Acreedor = {
      id: crypto.randomUUID(),
      negocio_id: negocioId,
      nombre,
      tipo: tipoNuevo,
      saldo_usd: 0,
      nota: notaNuevo.trim() || null,
      activo: true,
      creado_en: new Date().toISOString(),
      movimientos: 0,
      ultimo_movimiento_en: null,
      proximo_vencimiento: null,
      vencido: false,
    };

    try {
      // Offline-first: igual que crearClienteFiado (src/app/page.tsx) — se
      // guarda local primero y se encola, nunca se espera al servidor para
      // mostrarlo.
      await saveAcreedor(nuevo);
      setAcreedores(prev => [...prev, nuevo]);
      await encolarCrearAcreedor(nuevo, negocioId);
      setCreando(false);
      showToast('Acreedor agregado');
    } catch {
      // Si IndexedDB falla, lo único inaceptable es dejar al usuario
      // encerrado en la hoja: cerrarCrear() no responde mientras
      // `guardando` esté en true, y el BottomSheet solo se cierra por ahí.
      setErrorNuevo('No se pudo guardar en este teléfono. Intenta de nuevo.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div>
      <header className="bg-superficie-barra border-b border-borde-divisor px-4 pt-3.5 pb-3 flex items-center gap-2.5">
        <button onClick={() => router.back()} className="p-1 -ml-1 flex-shrink-0 text-texto-3" aria-label="Volver">
          <Icon nombre="flechaAbajo" tamano={TAMANO_ICONO.buscarYToggle} className="rotate-90" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-texto truncate">Por pagar</h1>
          <p className="text-[11px] font-medium text-texto-3 truncate">Lo que le debes a otros</p>
        </div>
        <div className={`flex-none flex items-center gap-1.5 h-7 px-2.5 rounded-full ${isOnline ? 'bg-marca-suave' : 'bg-aviso-fondo'}`}>
          <Icon
            nombre={isOnline ? 'enLinea' : 'sinConexion'}
            tamano={TAMANO_ICONO.chip}
            className={isOnline ? 'text-marca-suave-texto' : 'text-aviso'}
          />
          <span className={`text-[11px] font-semibold whitespace-nowrap ${isOnline ? 'text-marca-suave-texto' : 'text-aviso'}`}>
            {isOnline ? 'En línea' : 'Sin conexión'}
          </span>
        </div>
        <ThemeToggle variant="neutro" />
        <button
          onClick={abrirCrear}
          className="flex-none h-11 px-4 rounded-xl bg-marca text-texto-invertido font-semibold text-sm flex items-center gap-1.5 active:bg-marca-presion"
        >
          <Icon nombre="agregar" tamano={TAMANO_ICONO.secundario} />
          Agregar
        </button>
      </header>

      {/* pb-1 + overflow visible: mismo arreglo que Fiado/Inventario para
          que la barra de scroll del navegador no pise los chips */}
      <div className="px-4 pt-3 pb-4 bg-superficie-barra border-b border-borde-divisor">
        <div className="flex gap-2 -mx-4 px-4 pb-1 overflow-x-auto">
          <ChipFiltro activo={chip === 'todos'} onClick={() => setChip('todos')}>Todos</ChipFiltro>
          {TIPOS.map(t => (
            <ChipFiltro key={t.id} activo={chip === t.id} onClick={() => setChip(t.id)}>
              {t.labelPlural}
            </ChipFiltro>
          ))}
        </div>
      </div>

      <div className="px-4 py-3.5 flex flex-col gap-3.5">
        <div className="p-5 rounded-2xl bg-tinta">
          <p className="text-[11px] font-bold uppercase tracking-wide text-tinta-etiqueta">Total por pagar</p>
          <p className="mt-1.5 text-4xl font-extrabold text-tinta-texto tracking-tight tabular-nums">
            {formatUSD(totalDeudaUsd)}
          </p>
          <p className="mt-1 text-tinta-etiqueta tabular-nums">
            {formatBS(totalDeudaBs)} · {conDeuda.length} {conDeuda.length === 1 ? 'acreedor debe' : 'acreedores deben'}
          </p>
          {vencidos.length > 0 && (
            <>
              <div className="h-px bg-[rgba(255,255,255,0.14)] my-3" />
              <div className="flex items-center gap-2 flex-wrap">
                <span className="h-6 px-2.5 inline-flex items-center rounded-full bg-negativo-fondo text-negativo text-[11px] font-bold whitespace-nowrap">
                  {vencidos.length} {vencidos.length === 1 ? 'vencido' : 'vencidos'}
                </span>
                <span className="text-tinta-etiqueta text-sm">{formatUSD(montoVencidoUsd)} con vencimiento pasado</span>
              </div>
            </>
          )}
        </div>

        {cargando ? (
          <div className="text-center text-texto-3 py-16">
            <Icon nombre="cargando" tamano={32} className="mx-auto mb-3 text-marca animate-spin" />
          </div>
        ) : acreedores.length === 0 ? (
          <div className="text-center text-texto-3 py-16">
            <Icon nombre="sinProductos" tamano={48} className="mx-auto mb-3 text-texto-4" />
            <p className="font-medium">Todavía no hay acreedores</p>
            <p className="text-sm mt-1">Agrega un proveedor, servicio o persona a quien le debas</p>
          </div>
        ) : acreedoresFiltrados.length === 0 ? (
          <div className="text-center text-texto-3 py-12">
            <p className="font-medium">Nada en este filtro</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {acreedoresFiltrados.map(a => {
              const debe = a.saldo_usd > EPSILON_SALDO;

              return (
                <div
                  key={a.id}
                  className={`bg-tarjeta rounded-2xl border p-3.5 flex items-center gap-3 ${a.vencido ? 'border-negativo-borde' : 'border-borde-tarjeta'}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="font-semibold text-[15px] text-texto truncate">{a.nombre}</p>
                      <span className="flex-none h-5 px-1.5 inline-flex items-center rounded-full bg-tarjeta-hundida text-texto-3 text-[11px] font-semibold">
                        {labelTipo(a.tipo)}
                      </span>
                      {a.vencido && (
                        <span className="flex-none h-5 px-1.5 inline-flex items-center rounded-full bg-negativo-fondo text-negativo text-[11px] font-bold">
                          Vencido
                        </span>
                      )}
                    </div>
                    {(a.movimientos > 0 || a.proximo_vencimiento) && (
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {a.movimientos > 0 && (
                          <p className="text-xs text-texto-3">
                            {a.movimientos} {a.movimientos === 1 ? 'movimiento' : 'movimientos'}
                          </p>
                        )}
                        {a.proximo_vencimiento && (
                          <p className="flex items-center gap-1 text-xs text-texto-3">
                            <Icon nombre="calendario" tamano={TAMANO_ICONO.chip} />
                            Vence el {fmtVencimiento(a.proximo_vencimiento)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    {debe ? (
                      <>
                        <p className="font-bold text-lg text-aviso tabular-nums">{formatUSD(a.saldo_usd)}</p>
                        {tasa > 0 && <p className="text-xs text-texto-2 tabular-nums">{formatBS(a.saldo_usd * tasa)}</p>}
                      </>
                    ) : (
                      <p className="font-medium text-texto-2">Al día</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Crear acreedor */}
      <BottomSheet abierto={creando} onCerrar={cerrarCrear} titulo="Nuevo acreedor">
        <div className="space-y-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-texto-3 mb-2">Nombre</p>
            <input
              type="text"
              value={nombreNuevo}
              onChange={e => { setNombreNuevo(e.target.value); setErrorNuevo(''); }}
              placeholder="Ej. Distribuidora La Central"
              className="w-full h-[52px] px-3.5 rounded-[12px] bg-tarjeta border border-borde-campo focus:outline-none focus:border-foco text-base text-texto"
              autoFocus
            />
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-texto-3 mb-2">Tipo</p>
            <div className="grid grid-cols-3 gap-2">
              {TIPOS.map(t => {
                const activo = tipoNuevo === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => { setTipoNuevo(t.id); setErrorNuevo(''); }}
                    className={`h-[52px] rounded-[12px] border flex items-center justify-center text-sm font-semibold ${
                      activo ? 'bg-marca-suave text-marca-suave-texto border-marca' : 'bg-tarjeta-hundida text-texto-2 border-borde-campo'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-texto-3 mb-2">Nota (opcional)</p>
            <input
              type="text"
              value={notaNuevo}
              onChange={e => setNotaNuevo(e.target.value)}
              placeholder="Ej. Pago los días 15 y 30"
              className="w-full h-[52px] px-3.5 rounded-[12px] bg-tarjeta border border-borde-campo focus:outline-none focus:border-foco text-base text-texto"
            />
          </div>

          {errorNuevo && <p className="text-sm text-negativo">{errorNuevo}</p>}

          <Button variante="primario" disabled={guardando} onClick={confirmarCrear} className="w-full">
            {guardando ? 'Guardando...' : 'Agregar acreedor'}
          </Button>
        </div>
      </BottomSheet>

      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-toast-fondo text-toast-texto px-5 py-2.5 rounded-xl text-sm font-medium z-50 shadow-lg max-w-xs text-center">
          {toast}
        </div>
      )}
    </div>
  );
}
