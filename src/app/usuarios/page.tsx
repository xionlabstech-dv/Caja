'use client';

import { useState, useEffect, useCallback } from 'react';
import { useApp } from '@/components/Providers';
import { useGuardarRuta } from '@/lib/useGuardarRuta';
import { LIMITE_USUARIOS_POR_NEGOCIO } from '@/lib/roles';
import { listarUsuarios, crearUsuario, cambiarRol, cambiarActivo, UsuarioNegocio } from '@/lib/usuarios';
import { Rol } from '@/types';
import ThemeToggle from '@/components/ThemeToggle';

function usernameDe(email: string): string {
  return email.split('@')[0];
}

const FORM_VACIO = { usuario: '', password: '', nombre: '', rol: 'cajero' as Rol };

export default function UsuariosPage() {
  useGuardarRuta();
  const { user, negocioId, isOnline } = useApp();

  const [usuarios, setUsuarios] = useState<UsuarioNegocio[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [huboError, setHuboError] = useState(false);

  const [showCrear, setShowCrear] = useState(false);
  const [form, setForm] = useState(FORM_VACIO);
  const [creando, setCreando] = useState(false);
  const [errorForm, setErrorForm] = useState('');

  const [toast, setToast] = useState('');
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  const cargar = useCallback(async () => {
    if (!isOnline) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setHuboError(false);
    const lista = await listarUsuarios();
    if (lista === null) {
      setHuboError(true);
    } else {
      setUsuarios(lista);
    }
    setLoading(false);
  }, [isOnline]);

  useEffect(() => { cargar(); }, [cargar]);

  const activos = usuarios?.filter(u => u.activo) ?? [];
  const enLimite = activos.length >= LIMITE_USUARIOS_POR_NEGOCIO;

  const abrirCrear = () => {
    setForm(FORM_VACIO);
    setErrorForm('');
    setShowCrear(true);
  };

  const validarUsuario = (v: string) => /^[a-zA-Z0-9-]+$/.test(v);

  const handleCrear = async () => {
    setErrorForm('');
    if (!form.nombre.trim()) { setErrorForm('El nombre es obligatorio'); return; }
    if (!validarUsuario(form.usuario)) {
      setErrorForm('Usuario inválido: solo letras, números y guiones, sin espacios');
      return;
    }
    if (form.password.length < 6) { setErrorForm('La contraseña debe tener al menos 6 caracteres'); return; }
    if (!negocioId) { setErrorForm('No se pudo determinar tu negocio'); return; }

    setCreando(true);
    const resultado = await crearUsuario({
      usuario: form.usuario.trim(),
      password: form.password,
      nombre: form.nombre.trim(),
      rol: form.rol,
      negocioId,
    });
    setCreando(false);

    if (resultado.ok) {
      setShowCrear(false);
      showToast('Usuario creado');
      cargar();
    } else {
      setErrorForm(resultado.error);
    }
  };

  const handleCambiarRol = async (u: UsuarioNegocio, nuevoRol: Rol) => {
    if (u.id === user?.id) return; // nunca degradarse a sí mismo
    const prev = usuarios;
    setUsuarios(list => list?.map(x => x.id === u.id ? { ...x, rol: nuevoRol } : x) ?? null);
    const ok = await cambiarRol(u.id, nuevoRol);
    if (!ok) {
      setUsuarios(prev ?? null);
      showToast('No se pudo cambiar el rol');
    }
  };

  const handleToggleActivo = async (u: UsuarioNegocio) => {
    if (u.id === user?.id) return; // nunca desactivarse a sí mismo
    const nuevoActivo = !u.activo;
    const prev = usuarios;
    setUsuarios(list => list?.map(x => x.id === u.id ? { ...x, activo: nuevoActivo } : x) ?? null);
    const ok = await cambiarActivo(u.id, nuevoActivo);
    if (!ok) {
      setUsuarios(prev ?? null);
      showToast('No se pudo actualizar el estado');
    } else {
      showToast(nuevoActivo ? 'Usuario activado' : 'Usuario desactivado');
    }
  };

  return (
    <div>
      <header className="bg-emerald-600 text-white px-4 pt-4 pb-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Usuarios</h1>
          <p className="text-emerald-200 text-sm mt-0.5">
            {usuarios ? `${activos.length} de ${LIMITE_USUARIOS_POR_NEGOCIO} usuarios` : 'Gestión de acceso'}
          </p>
        </div>
        <ThemeToggle />
      </header>

      <div className="p-4 space-y-4">
        {!isOnline ? (
          <div className="text-center text-gray-400 py-16">
            <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3" />
            </svg>
            <p className="font-medium">La gestión de usuarios necesita conexión a internet</p>
          </div>
        ) : loading ? (
          <div className="text-center text-gray-400 py-16">
            <svg className="w-8 h-8 mx-auto mb-3 text-emerald-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : huboError ? (
          <div className="text-center text-gray-400 py-16">
            <p className="font-medium">No se pudo cargar la lista de usuarios</p>
            <button onClick={cargar} className="mt-3 text-emerald-600 font-semibold text-sm">Reintentar</button>
          </div>
        ) : (
          <>
            <button
              onClick={abrirCrear}
              disabled={enLimite}
              className="w-full bg-emerald-600 text-white py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Crear usuario
            </button>
            {enLimite && (
              <p className="text-center text-xs text-gray-400 -mt-2">
                Llegaste al máximo de {LIMITE_USUARIOS_POR_NEGOCIO} usuarios activos. Desactiva a alguien para poder agregar otro.
              </p>
            )}

            <div className="space-y-2">
              {(usuarios ?? []).map(u => {
                const esYo = u.id === user?.id;
                return (
                  <div key={u.id} className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-slate-700">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-gray-900 dark:text-white truncate">
                            {u.nombre || usernameDe(u.email)}
                          </p>
                          {esYo && <span className="text-xs text-gray-400 flex-shrink-0">(tú)</span>}
                        </div>
                        <p className="text-xs text-gray-400 font-mono">{usernameDe(u.email)}</p>
                      </div>
                      <span className={`flex-shrink-0 text-xs font-semibold px-2 py-1 rounded-full ${
                        u.activo ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-gray-400'
                      }`}>
                        {u.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 dark:border-slate-700">
                      <div className="flex gap-1.5">
                        {(['admin', 'cajero'] as Rol[]).map(r => (
                          <button
                            key={r}
                            onClick={() => handleCambiarRol(u, r)}
                            disabled={esYo}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                              u.rol === r
                                ? 'bg-emerald-600 text-white'
                                : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300'
                            }`}
                          >
                            {r === 'admin' ? 'Admin' : 'Cajero'}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => handleToggleActivo(u)}
                        disabled={esYo}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed ${
                          u.activo
                            ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                            : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        {u.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                    {esYo && (
                      <p className="text-xs text-gray-400 mt-2">
                        No puedes cambiar tu propio rol ni desactivarte — pídeselo a otro admin.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Crear usuario */}
      {showCrear && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => !creando && setShowCrear(false)} />
          <div className="relative w-full max-w-lg mx-auto bg-white dark:bg-slate-800 rounded-t-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-slate-700">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Nuevo usuario</h2>
              <button onClick={() => setShowCrear(false)} className="p-1 text-gray-400">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Nombre visible
                </label>
                <input
                  type="text"
                  value={form.nombre}
                  onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Ej: Carlos"
                  className="w-full border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-3 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-400"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Usuario
                </label>
                <input
                  type="text"
                  value={form.usuario}
                  onChange={e => setForm(f => ({ ...f, usuario: e.target.value }))}
                  autoCapitalize="none"
                  autoCorrect="off"
                  placeholder="Ej: carlos"
                  className="w-full border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-3 font-mono bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-400"
                />
                <p className="text-xs text-gray-400 mt-1">Solo letras, números y guiones, sin espacios</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Contraseña
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="Mínimo 6 caracteres"
                  className="w-full border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-3 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Rol
                </label>
                <div className="flex gap-2">
                  {(['cajero', 'admin'] as Rol[]).map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, rol: r }))}
                      className={`flex-1 py-3 rounded-xl font-semibold transition-colors ${
                        form.rol === r
                          ? 'bg-emerald-600 text-white'
                          : 'bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {r === 'admin' ? 'Admin' : 'Cajero'}
                    </button>
                  ))}
                </div>
              </div>

              {errorForm && <p className="text-red-500 text-sm">{errorForm}</p>}
            </div>

            <div className="p-4 border-t border-gray-100 dark:border-slate-700">
              <button
                onClick={handleCrear}
                disabled={creando}
                className="w-full bg-emerald-600 text-white py-4 rounded-xl text-lg font-bold disabled:opacity-40"
              >
                {creando ? 'Creando...' : 'Crear usuario'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-5 py-2.5 rounded-xl text-sm font-medium z-50 shadow-lg whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  );
}
