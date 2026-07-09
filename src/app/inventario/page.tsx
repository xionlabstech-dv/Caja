'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { Producto } from '@/types';
import { getProductos, saveProducto, deleteProductoDB } from '@/lib/db';
import { createProductoSupabase, updateProductoSupabase, softDeleteProducto } from '@/lib/sync';
import { precioBS, precioUSD, formatBS, formatUSD } from '@/lib/precio';
import { useApp } from '@/components/Providers';
import Scanner from '@/components/Scanner';
import ThemeToggle from '@/components/ThemeToggle';

function formatearNombre(nombre: string): string {
  return nombre
    .toLowerCase()
    .split(' ')
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

const PRODUCTO_VACIO = {
  nombre: '',
  codigo_barra: '',
  precio: '',
  moneda: 'USD' as 'USD' | 'VES',
  activo: true,
  por_peso: false,
};

export default function InventarioPage() {
  const { tasa, isOnline } = useApp();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editando, setEditando] = useState<Producto | null>(null);
  const [form, setForm] = useState(PRODUCTO_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Producto | null>(null);
  const [showScanner, setShowScanner] = useState(false);

  const cargar = async () => {
    const prods = await getProductos();
    setProductos(prods);
  };

  useEffect(() => { cargar(); }, []);

  const filtrados = busqueda
    ? productos.filter(
        p =>
          p.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
          (p.codigo_barra && p.codigo_barra.includes(busqueda))
      )
    : productos;

  const abrirNuevo = () => {
    setEditando(null);
    setForm(PRODUCTO_VACIO);
    setError('');
    setShowModal(true);
  };

  const abrirEditar = (p: Producto) => {
    setEditando(p);
    setForm({
      nombre: p.nombre,
      codigo_barra: p.codigo_barra || '',
      precio: p.precio.toString(),
      moneda: p.moneda,
      activo: p.activo,
      por_peso: p.por_peso ?? false,
    });
    setError('');
    setShowModal(true);
  };

  const guardar = async () => {
    if (!form.nombre.trim()) { setError('El nombre es obligatorio'); return; }
    const precio = parseFloat(form.precio);
    if (!precio || precio <= 0) { setError('El precio debe ser mayor a 0'); return; }
    if (!isOnline) { setError('Necesitas conexión para guardar'); return; }

    setGuardando(true);
    setError('');

    const datos = {
      nombre: form.nombre.trim(),
      codigo_barra: form.codigo_barra.trim() || null,
      precio,
      moneda: form.moneda,
      activo: true,
      por_peso: form.por_peso,
    };

    if (editando) {
      const ok = await updateProductoSupabase(editando.id, datos);
      if (ok) {
        const actualizado = { ...editando, ...datos };
        await saveProducto(actualizado);
        await cargar();
        setShowModal(false);
      } else {
        setError('Error al actualizar');
      }
    } else {
      const nuevo = await createProductoSupabase(datos);
      if (nuevo) {
        await saveProducto(nuevo);
        await cargar();
        setShowModal(false);
      } else {
        setError('Error al crear el producto');
      }
    }

    setGuardando(false);
  };

  const eliminar = async (p: Producto) => {
    if (!isOnline) { setError('Necesitas conexión para eliminar'); return; }
    const ok = await softDeleteProducto(p.id);
    if (ok) {
      await deleteProductoDB(p.id);
      await cargar();
    }
    setConfirmDelete(null);
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

      <div className="px-4 py-3 bg-white border-b border-gray-100">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o código..."
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-400"
          />
        </div>
      </div>

      <div className="p-4 space-y-2">
        {filtrados.length === 0 ? (
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
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
                  Sin conexión — no se puede guardar
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

              {error && <p className="text-red-500 text-sm">{error}</p>}
            </div>

            <div className="p-4 border-t border-gray-100">
              <button
                onClick={guardar}
                disabled={guardando || !isOnline}
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
