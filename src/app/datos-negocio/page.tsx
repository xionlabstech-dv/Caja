'use client';

import { useState, useEffect } from 'react';
import { DatosNegocio } from '@/types';
import { setCachedDatosNegocio } from '@/lib/db';
import { encolarActualizarDatosNegocio } from '@/lib/outbox';
import { updateDatosNegocio } from '@/lib/sync';
import { useApp } from '@/components/Providers';
import { useGuardarRuta } from '@/lib/useGuardarRuta';
import ThemeToggle from '@/components/ThemeToggle';

export default function DatosNegocioPage() {
  useGuardarRuta();
  const { negocioId, isOnline, datosNegocio, setDatosNegocio } = useApp();

  const [direccion, setDireccion] = useState('');
  const [telefono, setTelefono] = useState('');
  const [correo, setCorreo] = useState('');
  const [rif, setRif] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [toast, setToast] = useState('');

  // Se sincroniza con el contexto (no solo al montar): si otra pestaña o el
  // sync de sesión trae datos más recientes, el formulario los refleja.
  useEffect(() => {
    setDireccion(datosNegocio.direccion ?? '');
    setTelefono(datosNegocio.telefono ?? '');
    setCorreo(datosNegocio.correo ?? '');
    setRif(datosNegocio.rif ?? '');
  }, [datosNegocio]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  // Mismo patrón exacto que usa_costos/usa_stock: optimista + verificado, y
  // encolable si no hay red — un update directo a negocios, sin RPC.
  const guardar = async () => {
    if (!negocioId) return;
    const anterior = datosNegocio;
    const nuevo: DatosNegocio = {
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
      showToast('Guardado localmente — se sincronizará cuando haya conexión');
      return;
    }

    const ok = await updateDatosNegocio(nuevo, negocioId);
    setGuardando(false);
    if (!ok) {
      await setCachedDatosNegocio(anterior);
      setDatosNegocio(anterior);
      showToast('No se pudo guardar el cambio. Intenta de nuevo.');
      return;
    }
    showToast('Datos guardados');
  };

  return (
    <div>
      <header className="bg-emerald-600 text-white px-4 pt-4 pb-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Datos del negocio</h1>
          <p className="text-emerald-200 text-sm">Aparecen en el presupuesto</p>
        </div>
        <ThemeToggle />
      </header>

      <div className="p-4 space-y-4">
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-slate-700 space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Todos los campos son opcionales — completa solo los que quieras que aparezcan.
          </p>

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
        </div>

        <button
          onClick={guardar}
          disabled={guardando}
          className="w-full bg-emerald-600 text-white py-3.5 rounded-xl font-bold disabled:opacity-40"
        >
          {guardando ? 'Guardando...' : 'Guardar'}
        </button>
      </div>

      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-5 py-2.5 rounded-xl text-sm font-medium z-50 shadow-lg max-w-xs text-center">
          {toast}
        </div>
      )}
    </div>
  );
}
