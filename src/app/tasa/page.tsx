'use client';

import { useState, useRef } from 'react';
import { saveConfiguracion, deleteConfiguracion, getConfiguracion } from '@/lib/db';
import { encolarActualizarTasa } from '@/lib/outbox';
import { updateTasa } from '@/lib/sync';
import { useApp } from '@/components/Providers';
import { useGuardarRuta } from '@/lib/useGuardarRuta';
import ThemeToggle from '@/components/ThemeToggle';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Icon from '@/components/ui/Icon';
import { TAMANO_ICONO } from '@/components/ui/iconos';

export default function TasaPage() {
  const permitida = useGuardarRuta();
  const { tasa, setTasa, configuracion, isOnline, negocioId } = useApp();
  const [input, setInput] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  if (!permitida) return null;

  // Atajo de conveniencia desde el aviso de "chequeo automático fallido" —
  // no toca nada de handleGuardar, solo lleva el foco al campo de abajo.
  const enfocarFormulario = () => {
    inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    inputRef.current?.focus();
  };

  const handleGuardar = async () => {
    const nueva = parseFloat(input.replace(',', '.'));
    if (!nueva || nueva <= 0) {
      setError('Ingresa una tasa válida');
      return;
    }

    setGuardando(true);
    setError('');

    const tasaAnterior = tasa;
    const configAnterior = configuracion;
    const now = new Date().toISOString();

    // Optimista: se aplica local de inmediato para que la UI responda al
    // instante. saveConfiguracion reemplaza el registro completo (put) — se
    // lee lo que ya había en caché y se mezcla antes de guardar, si no un
    // guardado manual borraría tasa_oficial/tasa_oficial_actualizada_en/
    // tasa_actualizacion_fallida hasta el próximo sync completo.
    const actual = await getConfiguracion();
    await saveConfiguracion({ ...actual, id: 1, tasa: nueva, tasa_actualizada_en: now });
    setTasa(nueva);

    if (!isOnline) {
      // Sin red no hay forma de confirmar el guardado ahora — se encola
      // para reintentar al reconectar. El estado local ya quedó aplicado.
      await encolarActualizarTasa(nueva, negocioId!);
      setInput('');
      setGuardando(false);
      setMensaje('Guardada localmente — se sincronizará cuando haya conexión');
      setTimeout(() => setMensaje(''), 3000);
      return;
    }

    // Con red: se confirma la escritura antes de dar el guardado por hecho.
    // updateTasa ahora verifica que el UPDATE haya afectado una fila real
    // (ver comentario en sync.ts) — si no, no hay que dejar la UI mostrando
    // una tasa que nunca se persistió.
    const resultado = await updateTasa(nueva, negocioId!);
    setGuardando(false);
    if (!resultado.ok) {
      if (resultado.permanente === false) {
        // No hubo respuesta real (sin señal, timeout) — no es un rechazo
        // del servidor (ni siquiera llegó a validarse contra el piso), no
        // hay que revertir: se encola igual que si hubiera estado offline.
        await encolarActualizarTasa(nueva, negocioId!);
        setInput('');
        setMensaje('Guardada localmente — se sincronizará cuando haya conexión');
        setTimeout(() => setMensaje(''), 3000);
        return;
      }
      if (configAnterior) await saveConfiguracion(configAnterior);
      else await deleteConfiguracion();
      setTasa(tasaAnterior);
      // Un trigger en Supabase rechaza el UPDATE si la tasa manual queda
      // por debajo de la tasa oficial del día (la que carga /api/actualizar-tasa
      // automáticamente) — el mensaje trae el piso exacto entre paréntesis,
      // ej. "La tasa no puede ser menor a la tasa oficial (848.5458)". Se
      // extrae el número para mostrarlo con el formato de esta pantalla en
      // vez del mensaje crudo de Postgres.
      const piso = resultado.mensaje?.match(/tasa oficial \(([\d.]+)\)/)?.[1];
      setError(
        piso
          ? `La tasa no puede ser menor a la oficial de hoy: $${piso}`
          : 'No se pudo guardar la tasa. Intenta de nuevo.'
      );
      return;
    }
    setInput('');
    setMensaje('Tasa actualizada correctamente');
    setTimeout(() => setMensaje(''), 3000);
  };

  const fechaActualizada = configuracion?.tasa_actualizada_en
    ? new Date(configuracion.tasa_actualizada_en).toLocaleDateString('es-VE', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <div>
      <header className="bg-superficie-barra border-b border-borde-divisor px-4 pt-3.5 pb-3 flex items-center gap-2.5">
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-texto truncate">Tasa BCV</h1>
          <p className="text-[11px] font-medium text-texto-3 truncate">Define los precios en Bs de todo el día</p>
        </div>
        <ThemeToggle variant="neutro" />
      </header>

      <div className="px-4 py-3.5 flex flex-col gap-3.5">
        {/* Tasa actual */}
        <div className="p-5 rounded-2xl bg-tinta">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-tinta-etiqueta">Bs por 1 USD</p>
            {tasa > 0 && (
              configuracion?.tasa_actualizacion_fallida ? (
                <span className="flex-none h-6 px-2.5 inline-flex items-center rounded-full bg-aviso-fondo text-aviso text-[11px] font-bold whitespace-nowrap">
                  Sin verificar
                </span>
              ) : (
                <span className="flex-none h-6 px-2.5 inline-flex items-center rounded-full bg-marca-suave text-marca-suave-texto text-[11px] font-bold whitespace-nowrap">
                  Verificada
                </span>
              )
            )}
          </div>
          {tasa > 0 ? (
            <>
              <p className="mt-1.5 text-4xl font-extrabold text-tinta-texto tracking-tight tabular-nums">
                {tasa.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              {fechaActualizada && (
                <p className="mt-1 text-tinta-etiqueta">Actualizada: {fechaActualizada}</p>
              )}
            </>
          ) : (
            <p className="mt-1.5 text-2xl text-tinta-etiqueta font-medium">No configurada</p>
          )}
        </div>

        {/* Aviso: el último chequeo automático contra el BCV falló */}
        {configuracion?.tasa_actualizacion_fallida && (
          <div className="p-3.5 rounded-[12px] bg-aviso-fondo border border-aviso-borde flex flex-col gap-2.5">
            <p className="text-sm text-aviso">
              El último chequeo automático contra la tasa oficial no se pudo completar. Puede que sigas con una
              tasa desactualizada — revisa y ajusta si hace falta.
            </p>
            <Button variante="primario" compacto onClick={enfocarFormulario} className="self-start">
              <Icon nombre="editar" tamano={TAMANO_ICONO.secundario} />
              Ajustar a mano
            </Button>
          </div>
        )}

        {/* Conversión de referencia */}
        {tasa > 0 && (
          <div className="bg-tarjeta rounded-2xl border border-borde-tarjeta p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-texto-3 mb-2">Con esta tasa</p>
            <div className="divide-y divide-borde-divisor">
              {[1, 5, 10, 20, 50, 100].map(usd => (
                <div key={usd} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-texto-3">$ {usd}</span>
                  <span className="font-semibold text-texto tabular-nums">
                    Bs {(usd * tasa).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actualizar tasa */}
        <div className="bg-tarjeta rounded-2xl border border-borde-tarjeta p-4">
          <h2 className="font-semibold text-texto mb-3">Actualizar tasa</h2>

          {!isOnline && (
            <div className="mb-3 p-3 rounded-[12px] bg-aviso-fondo border border-aviso-borde text-aviso text-sm">
              Sin conexión — se guarda en el dispositivo y se sincroniza al reconectar
            </div>
          )}

          <div className="flex gap-2 w-full items-start">
            <div className="flex-1 min-w-0">
              <Input
                ref={inputRef}
                id="tasa-input"
                type="number"
                step="0.01"
                value={input}
                onChange={e => { setInput(e.target.value); setError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleGuardar()}
                placeholder={tasa > 0 ? tasa.toFixed(2) : 'Ej: 55.80'}
              />
            </div>
            <Button variante="primario" onClick={handleGuardar} disabled={guardando || !input} className="flex-shrink-0">
              {guardando ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>

          {error && <p className="mt-2 text-negativo text-sm">{error}</p>}
          {mensaje && (
            <div className="mt-2 flex items-center gap-2 text-marca-suave-texto text-sm font-medium">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" className="flex-shrink-0">
                <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="2" />
                <path
                  className="animate-check-path"
                  d="M5.5 10.5l3.5 3.5 5.5-7"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
              {mensaje}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
