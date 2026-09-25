'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { DatosNegocio } from '@/types';
import { setCachedDatosNegocio } from '@/lib/db';
import { encolarActualizarDatosNegocio } from '@/lib/outbox';
import { updateDatosNegocio } from '@/lib/sync';
import { useApp } from '@/components/Providers';
import { useGuardarRuta } from '@/lib/useGuardarRuta';
import ThemeToggle from '@/components/ThemeToggle';
import Icon from '@/components/ui/Icon';
import type { NombreIcono } from '@/components/ui/iconos';

interface CampoContacto {
  id: 'nombreComercial' | 'direccion' | 'telefono' | 'correo' | 'rif';
  etiqueta: string;
  icono: NombreIcono;
}

const CAMPOS: CampoContacto[] = [
  { id: 'nombreComercial', etiqueta: 'Nombre comercial', icono: 'campoNombreComercial' },
  { id: 'direccion', etiqueta: 'Dirección', icono: 'campoDireccion' },
  { id: 'telefono', etiqueta: 'Teléfono', icono: 'campoTelefono' },
  { id: 'correo', etiqueta: 'Correo', icono: 'campoCorreo' },
  { id: 'rif', etiqueta: 'RIF', icono: 'campoRif' },
];

type FormatoComprobante = NonNullable<DatosNegocio['formatoComprobante']>;
type FormatoPresupuesto = NonNullable<DatosNegocio['formatoPresupuesto']>;

interface FormatoSpec {
  label: string;
  medida: string;
  ancho: string;
  alto: string;
  pad: string;
  gap: string;
  linea: string;
  total: string;
  tituloAncho: string;
  totalAncho: string;
  lineas: { w: string; c: string }[];
}

// Proporción real de cada formato, a escala de miniatura — tomado literal
// del mockup de Diseño (referencias-diseno: "Datos del negocio - movil").
const GRIS_OSCURO = '#D8DEDB';
const GRIS_CLARO = '#EAEEEC';

const FORMATOS: Record<FormatoComprobante | FormatoPresupuesto, FormatoSpec> = {
  ticket: {
    label: 'Ticket', medida: '80 mm', ancho: '40px', alto: '104px', pad: '4px 3px', gap: '2.5px', linea: '2px', total: '3px',
    tituloAncho: '72%', totalAncho: '58%',
    lineas: [
      { w: '86%', c: GRIS_CLARO }, { w: '70%', c: GRIS_CLARO }, { w: '80%', c: GRIS_CLARO },
      { w: '62%', c: GRIS_CLARO }, { w: '76%', c: GRIS_CLARO }, { w: '54%', c: GRIS_CLARO },
    ],
  },
  carta: {
    label: 'Carta', medida: '21,6 × 27,9 cm', ancho: '80px', alto: '103px', pad: '6px 5px', gap: '3px', linea: '2px', total: '4px',
    tituloAncho: '52%', totalAncho: '34%',
    lineas: [
      { w: '100%', c: GRIS_OSCURO }, { w: '88%', c: GRIS_CLARO }, { w: '94%', c: GRIS_CLARO },
      { w: '70%', c: GRIS_CLARO }, { w: '90%', c: GRIS_CLARO }, { w: '64%', c: GRIS_CLARO },
    ],
  },
  media_carta: {
    label: 'Media carta', medida: '21,6 × 14 cm', ancho: '80px', alto: '52px', pad: '5px', gap: '2.5px', linea: '2px', total: '4px',
    tituloAncho: '46%', totalAncho: '30%',
    lineas: [
      { w: '100%', c: GRIS_OSCURO }, { w: '84%', c: GRIS_CLARO }, { w: '92%', c: GRIS_CLARO }, { w: '66%', c: GRIS_CLARO },
    ],
  },
};

function TarjetaFormato({
  id, activo, alturaMiniatura, onSeleccionar,
}: {
  id: FormatoComprobante | FormatoPresupuesto;
  activo: boolean;
  alturaMiniatura: number;
  onSeleccionar: () => void;
}) {
  const f = FORMATOS[id];
  return (
    <button
      onClick={onSeleccionar}
      className={`flex flex-col items-center gap-2 p-3 rounded-2xl border-[1.5px] transition-colors ${
        activo
          ? 'border-[#04875A] bg-[#E7F6EF] dark:border-emerald-500 dark:bg-emerald-900/20'
          : 'border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800'
      }`}
    >
      <span className="flex items-start justify-center" style={{ height: alturaMiniatura }}>
        <span
          className="flex flex-col box-border bg-white border border-gray-300 rounded-sm shadow-sm overflow-hidden"
          style={{ width: f.ancho, height: f.alto, padding: f.pad, gap: f.gap }}
        >
          <span className="block rounded-[1px]" style={{ width: f.tituloAncho, height: f.linea, background: '#04875A' }} />
          {f.lineas.map((l, i) => (
            <span key={i} className="block rounded-[1px]" style={{ width: l.w, height: f.linea, background: l.c }} />
          ))}
          <span className="flex-1" />
          <span className="flex items-center justify-end">
            <span className="block rounded-[1px]" style={{ width: f.totalAncho, height: f.total, background: '#0C1A14' }} />
          </span>
        </span>
      </span>
      <span className="flex flex-col items-center gap-0.5">
        <span className={`text-[13px] ${activo ? 'font-bold text-[#036B48] dark:text-emerald-400' : 'font-medium text-gray-900 dark:text-white'}`}>
          {f.label}
        </span>
        <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 whitespace-nowrap">{f.medida}</span>
      </span>
    </button>
  );
}

export default function DatosNegocioPage() {
  const permitida = useGuardarRuta();
  const router = useRouter();
  const { negocioId, isOnline, datosNegocio, setDatosNegocio } = useApp();

  const [nombreComercial, setNombreComercial] = useState('');
  const [direccion, setDireccion] = useState('');
  const [telefono, setTelefono] = useState('');
  const [correo, setCorreo] = useState('');
  const [rif, setRif] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [editando, setEditando] = useState(false);
  const [toast, setToast] = useState('');

  // Se sincroniza con el contexto (no solo al montar): si otra pestaña o el
  // sync de sesión trae datos más recientes, el formulario los refleja.
  useEffect(() => {
    setNombreComercial(datosNegocio.nombreComercial ?? '');
    setDireccion(datosNegocio.direccion ?? '');
    setTelefono(datosNegocio.telefono ?? '');
    setCorreo(datosNegocio.correo ?? '');
    setRif(datosNegocio.rif ?? '');
  }, [datosNegocio]);

  if (!permitida) return null;

  // Si ya hay algo guardado, el formulario arranca bloqueado (modo lectura)
  // y hay que tocar "Editar" para cambiarlo — evita que alguien lo borre por
  // accidente sin querer editarlo.
  const hayDatosGuardados = Boolean(
    datosNegocio.nombreComercial || datosNegocio.direccion || datosNegocio.telefono || datosNegocio.correo || datosNegocio.rif
  );
  const bloqueado = hayDatosGuardados && !editando;

  // La base los trae NOT NULL con default (ticket / media_carta) — si el
  // negocio nunca los tocó, datosNegocio los trae undefined y hay que tratar
  // ese default como si ya estuviera seleccionado.
  const formatoComprobante: FormatoComprobante = datosNegocio.formatoComprobante ?? 'ticket';
  const formatoPresupuesto: FormatoPresupuesto = datosNegocio.formatoPresupuesto ?? 'media_carta';

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const cancelar = () => {
    setNombreComercial(datosNegocio.nombreComercial ?? '');
    setDireccion(datosNegocio.direccion ?? '');
    setTelefono(datosNegocio.telefono ?? '');
    setCorreo(datosNegocio.correo ?? '');
    setRif(datosNegocio.rif ?? '');
    setEditando(false);
  };

  // Mismo patrón exacto que usa_costos/usa_stock: optimista + verificado, y
  // encolable si no hay red — un update directo a negocios, sin RPC. Se
  // parte del datosNegocio actual (no de un objeto armado desde cero) para
  // no pisar formatoComprobante/formatoPresupuesto, que este formulario no
  // toca.
  const guardar = async () => {
    if (!negocioId) return;
    const anterior = datosNegocio;
    const nuevo: DatosNegocio = {
      ...datosNegocio,
      nombreComercial: nombreComercial.trim() || undefined,
      direccion: direccion.trim() || undefined,
      telefono: telefono.trim() || undefined,
      correo: correo.trim() || undefined,
      rif: rif.trim() || undefined,
    };

    setGuardando(true);
    await setCachedDatosNegocio(nuevo);
    setDatosNegocio(nuevo);

    if (!isOnline) {
      await encolarActualizarDatosNegocio(nuevo, negocioId);
      setGuardando(false);
      setEditando(false);
      showToast('Guardado localmente — se sincronizará cuando haya conexión');
      return;
    }

    const resultado = await updateDatosNegocio(nuevo, negocioId);
    setGuardando(false);
    if (!resultado.ok) {
      if (resultado.permanente === false) {
        await encolarActualizarDatosNegocio(nuevo, negocioId);
        setEditando(false);
        showToast('Guardado localmente — se sincronizará cuando haya conexión');
        return;
      }
      await setCachedDatosNegocio(anterior);
      setDatosNegocio(anterior);
      showToast('No se pudo guardar el cambio. Intenta de nuevo.');
      return;
    }
    setEditando(false);
    showToast('Datos guardados');
  };

  // El formato de documentos no pasa por "Editar": es una preferencia de
  // impresión, no un dato sensible — tocar una tarjeta guarda de inmediato,
  // mismo patrón optimista + cola offline que el resto de la pantalla.
  const guardarFormato = async (campo: 'formatoComprobante' | 'formatoPresupuesto', valor: string) => {
    if (!negocioId) return;
    if (datosNegocio[campo] === valor) return;
    const anterior = datosNegocio;
    const nuevo: DatosNegocio = { ...datosNegocio, [campo]: valor };

    await setCachedDatosNegocio(nuevo);
    setDatosNegocio(nuevo);

    if (!isOnline) {
      await encolarActualizarDatosNegocio(nuevo, negocioId);
      showToast('Guardado localmente — se sincronizará cuando haya conexión');
      return;
    }

    const resultado = await updateDatosNegocio(nuevo, negocioId);
    if (!resultado.ok) {
      if (resultado.permanente === false) {
        await encolarActualizarDatosNegocio(nuevo, negocioId);
        showToast('Guardado localmente — se sincronizará cuando haya conexión');
        return;
      }
      await setCachedDatosNegocio(anterior);
      setDatosNegocio(anterior);
      showToast('No se pudo guardar el cambio. Intenta de nuevo.');
      return;
    }
    showToast('Formato actualizado');
  };

  const camposConValor = CAMPOS
    .map(c => ({ ...c, valor: (datosNegocio[c.id] ?? '').trim() }))
    .filter(c => c.valor);

  return (
    <div>
      <header className="bg-white dark:bg-[#151B18] border-b border-[#E4E7E6] dark:border-[#2A332E] px-4 pt-3.5 pb-3 flex items-center gap-2.5">
        <button onClick={() => router.back()} className="p-1 -ml-1 flex-shrink-0 text-[#5C6663] dark:text-[#A3ADA8]" aria-label="Volver">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-[#111614] dark:text-[#F1F4F2] truncate">Datos del negocio</h1>
          <p className="text-[11px] font-medium text-[#5C6663] dark:text-[#A3ADA8] truncate">
            {bloqueado ? 'Bloqueada · toca Editar para cambiar' : 'Editando · nada se guarda hasta confirmar'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-none">
          {bloqueado && (
            <button
              onClick={() => setEditando(true)}
              className="min-h-[40px] px-3.5 rounded-xl border border-[#E4E7E6] dark:border-[#2A332E] bg-[#F0F2F1] dark:bg-[#1E2622] text-[#111614] dark:text-[#F1F4F2] flex items-center gap-1.5 font-semibold text-sm"
            >
              <Icon nombre="editar" tamano={15} />
              Editar
            </button>
          )}
          <ThemeToggle />
        </div>
      </header>

      <div className="p-4 space-y-5">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Datos de contacto
            </span>
            <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">todos opcionales</span>
          </div>

          {bloqueado ? (
            <>
              <div className="flex flex-col gap-px bg-gray-100 dark:bg-slate-700 border border-gray-100 dark:border-slate-700 rounded-2xl overflow-hidden">
                {camposConValor.map(c => (
                  <div key={c.id} className="flex items-start gap-3 px-3.5 py-3 bg-white dark:bg-slate-800">
                    <Icon nombre={c.icono} tamano={18} className="flex-none mt-0.5 text-gray-400 dark:text-gray-500" />
                    <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                      <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{c.etiqueta}</span>
                      <span className="text-[15px] leading-snug font-medium text-gray-900 dark:text-white break-words">{c.valor}</span>
                    </div>
                  </div>
                ))}
                {camposConValor.length === 0 && (
                  <div className="px-3.5 py-3 bg-white dark:bg-slate-800 text-sm text-gray-400 dark:text-gray-500">
                    Ningún dato cargado todavía.
                  </div>
                )}
              </div>
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-slate-700/50 border border-gray-100 dark:border-slate-700">
                <Icon nombre="info" tamano={15} className="flex-none mt-0.5 text-gray-400 dark:text-gray-500" />
                <p className="flex-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                  Aparecen en el presupuesto y en el comprobante de venta. Para cambiarlos, toca &quot;Editar&quot;.
                </p>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre comercial</label>
                <input
                  type="text"
                  value={nombreComercial}
                  onChange={e => setNombreComercial(e.target.value)}
                  placeholder="Ej: Charcutería Mayga"
                  className="w-full border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-3 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Dirección</label>
                <input
                  type="text"
                  value={direccion}
                  onChange={e => setDireccion(e.target.value)}
                  placeholder="Ej: Av. Principal, local 3"
                  className="w-full border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-3 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Teléfono</label>
                <input
                  type="tel"
                  value={telefono}
                  onChange={e => setTelefono(e.target.value)}
                  placeholder="Ej: 0414-1234567"
                  className="w-full border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-3 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Correo</label>
                <input
                  type="email"
                  value={correo}
                  onChange={e => setCorreo(e.target.value)}
                  placeholder="Ej: contacto@negocio.com"
                  className="w-full border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-3 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">RIF</label>
                <input
                  type="text"
                  value={rif}
                  onChange={e => setRif(e.target.value)}
                  placeholder="Ej: J-12345678-9"
                  className="w-full border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-3 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-400"
                />
              </div>

              <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                Aparecen en el presupuesto y en el comprobante de venta. Puedes dejar en blanco los que no uses.
              </p>
            </div>
          )}
        </div>

        <div className="space-y-2.5">
          <span className="block text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Formato de documentos
          </span>

          <div className="space-y-2.5">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">Comprobante de venta</div>
            <div className="grid grid-cols-3 gap-2.5">
              {(['ticket', 'carta', 'media_carta'] as const).map(id => (
                <TarjetaFormato
                  key={id}
                  id={id}
                  activo={formatoComprobante === id}
                  alturaMiniatura={96}
                  onSeleccionar={() => guardarFormato('formatoComprobante', id)}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">Presupuesto</div>
            <div className="grid grid-cols-2 gap-2.5">
              {(['carta', 'media_carta'] as const).map(id => (
                <TarjetaFormato
                  key={id}
                  id={id}
                  activo={formatoPresupuesto === id}
                  alturaMiniatura={112}
                  onSeleccionar={() => guardarFormato('formatoPresupuesto', id)}
                />
              ))}
            </div>
          </div>

          <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            Se usa cada vez que generes un comprobante o presupuesto — no se pregunta al momento de cobrar.
          </p>
        </div>

        {!bloqueado && (
          <div className="flex gap-3">
            {hayDatosGuardados && (
              <button
                onClick={cancelar}
                disabled={guardando}
                className="flex-1 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200 py-3.5 rounded-xl font-bold disabled:opacity-40"
              >
                Cancelar
              </button>
            )}
            <button
              onClick={guardar}
              disabled={guardando}
              className="flex-1 bg-emerald-600 text-white py-3.5 rounded-xl font-bold disabled:opacity-40"
            >
              {guardando ? 'Guardando...' : hayDatosGuardados ? 'Actualizar' : 'Guardar'}
            </button>
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-5 py-2.5 rounded-xl text-sm font-medium z-50 shadow-lg max-w-xs text-center">
          {toast}
        </div>
      )}
    </div>
  );
}
