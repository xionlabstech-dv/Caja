'use client';

import { useState } from 'react';
import { saveConfiguracion, deleteConfiguracion } from '@/lib/db';
import { encolarActualizarTasa } from '@/lib/outbox';
import { updateTasa } from '@/lib/sync';
import { useApp } from '@/components/Providers';
import { useGuardarRuta } from '@/lib/useGuardarRuta';
import ThemeToggle from '@/components/ThemeToggle';

export default function TasaPage() {
  useGuardarRuta();
  const { tasa, setTasa, configuracion, isOnline, negocioId } = useApp();
  const [input, setInput] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');

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
    // instante.
    await saveConfiguracion({ id: 1, tasa: nueva, tasa_actualizada_en: now });
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
    const ok = await updateTasa(nueva, negocioId!);
    setGuardando(false);
    if (!ok) {
      if (configAnterior) await saveConfiguracion(configAnterior);
      else await deleteConfiguracion();
      setTasa(tasaAnterior);
      setError('No se pudo guardar la tasa. Intenta de nuevo.');
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
      <header className="bg-emerald-600 text-white px-4 pt-4 pb-3 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">Tasa BCV</h1>
          <p className="text-emerald-200 text-sm mt-0.5">Tipo de cambio Bs / $</p>
        </div>
        <ThemeToggle />
      </header>

      <div className="p-4 space-y-4">
        {/* Tasa actual */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 text-center">
          <p className="text-gray-500 text-sm mb-1">Tasa actual</p>
          {tasa > 0 ? (
            <>
              <p className="text-4xl font-bold text-gray-900">
                {tasa.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-gray-400 text-sm mt-1">Bs por 1 USD</p>
            </>
          ) : (
            <p className="text-2xl text-gray-400 font-medium">No configurada</p>
          )}
          {fechaActualizada && (
            <p className="text-gray-400 text-xs mt-3">Actualizada: {fechaActualizada}</p>
          )}
        </div>

        {/* Ejemplo de conversión */}
        {tasa > 0 && (
          <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100">
            <p className="text-emerald-700 text-sm font-medium mb-2">Conversión de referencia</p>
            <div className="space-y-1 text-sm">
              {[1, 5, 10, 20, 50, 100].map(usd => (
                <div key={usd} className="flex justify-between">
                  <span className="text-gray-500">$ {usd}</span>
                  <span className="font-semibold text-gray-800">
                    Bs {(usd * tasa).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actualizar tasa */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <h2 className="font-semibold text-gray-700 mb-3">Actualizar tasa</h2>

          {!isOnline && (
            <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm">
              Sin conexión — se guarda en el dispositivo y se sincroniza al reconectar
            </div>
          )}

          <div className="flex gap-2 w-full">
            <input
              type="number"
              step="0.01"
              value={input}
              onChange={e => { setInput(e.target.value); setError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleGuardar()}
              placeholder={tasa > 0 ? tasa.toFixed(2) : 'Ej: 55.80'}
              className="flex-1 min-w-0 border border-gray-200 rounded-xl px-4 py-3 text-lg font-semibold focus:outline-none focus:border-emerald-400"
            />
            <button
              onClick={handleGuardar}
              disabled={guardando || !input}
              className="shrink-0 bg-emerald-600 text-white px-4 py-3 rounded-xl font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </div>

          {error && (
            <p className="mt-2 text-red-500 text-sm">{error}</p>
          )}
          {mensaje && (
            <div className="mt-2 flex items-center gap-2 text-emerald-600 text-sm font-medium">
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
