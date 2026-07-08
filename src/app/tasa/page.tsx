'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { updateTasa } from '@/lib/sync';
import { useApp } from '@/components/Providers';

export default function TasaPage() {
  const { tasa, setTasa, configuracion, isOnline } = useApp();
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

    if (!isOnline) {
      setError('Necesitas conexión para actualizar la tasa');
      return;
    }

    setGuardando(true);
    setError('');
    const ok = await updateTasa(nueva);
    setGuardando(false);

    if (ok) {
      setTasa(nueva);
      setInput('');
      setMensaje('Tasa actualizada correctamente');
      setTimeout(() => setMensaje(''), 3000);
    } else {
      setError('Error al guardar. Verifica tu conexión.');
    }
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
      <header className="bg-emerald-600 text-white px-4 pt-4 pb-3">
        <h1 className="text-xl font-bold">Tasa BCV</h1>
        <p className="text-emerald-200 text-sm mt-0.5">Tipo de cambio Bs / $</p>
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
            <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
              Sin conexión — la tasa no puede guardarse
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
              disabled={guardando || !input || !isOnline}
              className="shrink-0 bg-emerald-600 text-white px-4 py-3 rounded-xl font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </div>

          {error && (
            <p className="mt-2 text-red-500 text-sm">{error}</p>
          )}
          {mensaje && (
            <p className="mt-2 text-emerald-600 text-sm font-medium">{mensaje}</p>
          )}
        </div>
      </div>
    </div>
  );
}
