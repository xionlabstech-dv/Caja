'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/components/Providers';
import { useGuardarRuta } from '@/lib/useGuardarRuta';
import { listarUsuarios, crearUsuario, cambiarRol, cambiarActivo, eliminarUsuario, usernameDe, UsuarioNegocio } from '@/lib/usuarios';
import { Rol } from '@/types';
import ThemeToggle from '@/components/ThemeToggle';
import Icon from '@/components/ui/Icon';

const FORM_VACIO = { usuario: '', password: '', nombre: '', rol: 'cajero' as Rol };

export default function UsuariosPage() {
  const permitida = useGuardarRuta();
  const router = useRouter();
  const { user, negocioId, isOnline, limiteUsuarios } = useApp();

  const [usuarios, setUsuarios] = useState<UsuarioNegocio[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [huboError, setHuboError] = useState(false);

  const [showCrear, setShowCrear] = useState(false);
  const [form, setForm] = useState(FORM_VACIO);
  const [creando, setCreando] = useState(false);
  const [errorForm, setErrorForm] = useState('');

  const [confirmEliminar, setConfirmEliminar] = useState<UsuarioNegocio | null>(null);
  const [eliminando, setEliminando] = useState(false);

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

  if (!permitida) return null;

  const activos = usuarios?.filter(u => u.activo) ?? [];
  const enLimite = activos.length >= limiteUsuarios;

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

  const handleEliminar = async () => {
    if (!confirmEliminar || confirmEliminar.id === user?.id) return; // nunca eliminarse a sí mismo
    setEliminando(true);
    const resultado = await eliminarUsuario(confirmEliminar.id);
    setEliminando(false);
    if (resultado.ok) {
      setUsuarios(list => list?.filter(x => x.id !== confirmEliminar.id) ?? null);
      showToast('Usuario eliminado');
      setConfirmEliminar(null);
    } else {
      showToast(resultado.error);
    }
  };

  return (
    <div>
      <header className="bg-superficie-barra border-b border-borde-divisor px-4 pt-3.5 pb-3 flex items-center gap-2.5">
        <button onClick={() => router.back()} className="p-1 -ml-1 flex-shrink-0 text-texto-3" aria-label="Volver">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-texto truncate">Usuarios</h1>
          <p className="text-[11px] font-medium text-texto-3 truncate">
            {usuarios ? `${activos.length} de ${limiteUsuarios} usuarios` : 'Gestión de acceso'}
          </p>
        </div>
        <ThemeToggle variant="neutro" />
      </header>

      <div className="p-4 space-y-4">
        {!isOnline ? (
          <div className="text-center text-texto-3 py-16">
            <Icon nombre="sinConexion" tamano={48} className="mx-auto mb-3 text-texto-4" />
            <p className="font-medium">La gestión de usuarios necesita conexión a internet</p>
          </div>
        ) : loading ? (
          <div className="text-center text-texto-3 py-16">
            <svg className="w-8 h-8 mx-auto mb-3 text-marca animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : huboError ? (
          <div className="text-center text-texto-3 py-16">
            <p className="font-medium">No se pudo cargar la lista de usuarios</p>
            <button onClick={cargar} className="mt-3 text-marca font-semibold text-sm">Reintentar</button>
          </div>
        ) : (
          <>
            <button
              onClick={abrirCrear}
              disabled={enLimite}
              className="w-full bg-marca text-texto-invertido py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Icon nombre="agregar" tamano={20} />
              Crear usuario
            </button>
            {enLimite && (
              <p className="text-center text-xs text-texto-3 -mt-2">
                Llegaste al máximo de {limiteUsuarios} usuarios activos. Desactiva a alguien, o escríbenos a xionlabstech@gmail.com si necesitas más.
              </p>
            )}

            <div className="space-y-2">
              {(usuarios ?? []).map(u => {
                const esYo = u.id === user?.id;
                return (
                  <div key={u.id} className="bg-tarjeta rounded-xl p-4 shadow-sm border border-borde-tarjeta">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-texto truncate">
                            {u.nombre || usernameDe(u.email)}
                          </p>
                          {esYo && <span className="text-xs text-texto-4 flex-shrink-0">(tú)</span>}
                        </div>
                        <p className="text-xs text-texto-4 font-mono">{usernameDe(u.email)}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                          u.activo ? 'bg-marca-suave text-marca-suave-texto' : 'bg-tarjeta-hundida text-texto-3'
                        }`}>
                          {u.activo ? 'Activo' : 'Inactivo'}
                        </span>
                        {!esYo && (
                          <button
                            onClick={() => setConfirmEliminar(u)}
                            className="p-1 text-texto-4 hover:text-negativo active:text-negativo"
                            aria-label={`Eliminar a ${u.nombre || usernameDe(u.email)}`}
                          >
                            <Icon nombre="eliminar" tamano={16} />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-borde-tarjeta">
                      <div className="flex gap-1.5">
                        {(['admin', 'cajero'] as Rol[]).map(r => (
                          <button
                            key={r}
                            onClick={() => handleCambiarRol(u, r)}
                            disabled={esYo}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                              u.rol === r
                                ? 'bg-marca text-texto-invertido'
                                : 'bg-tarjeta-hundida text-texto-3'
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
                            ? 'bg-negativo-fondo text-negativo'
                            : 'bg-marca-suave text-marca-suave-texto'
                        }`}
                      >
                        {u.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                    {esYo && (
                      <p className="text-xs text-texto-4 mt-2">
                        No puedes cambiar tu propio rol, desactivarte ni eliminarte — pídeselo a otro admin.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Crear usuario — mismo patrón de hoja que "Cambiar contraseña" en /perfil */}
      {showCrear && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-overlay" onClick={() => !creando && setShowCrear(false)} />
          <div className="relative w-full max-w-lg mx-auto bg-tarjeta rounded-t-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-center px-4 pt-4 pb-2">
              <div className="w-8 h-1 bg-borde-tarjeta rounded-full" />
            </div>
            <div className="p-4 pt-1 pb-6 space-y-4">
              <p className="text-base font-bold text-texto">Nuevo usuario</p>

              <div>
                <label className="block text-sm font-medium text-texto-2 mb-1">
                  Nombre visible
                </label>
                <input
                  type="text"
                  value={form.nombre}
                  onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Ej: Carlos"
                  className="w-full border border-borde-campo rounded-xl px-4 py-3 bg-tarjeta text-texto placeholder:text-texto-4 focus:outline-none focus:border-marca"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-texto-2 mb-1">
                  Usuario
                </label>
                <input
                  type="text"
                  value={form.usuario}
                  onChange={e => setForm(f => ({ ...f, usuario: e.target.value }))}
                  autoCapitalize="none"
                  autoCorrect="off"
                  placeholder="Ej: carlos"
                  className="w-full border border-borde-campo rounded-xl px-4 py-3 font-mono bg-tarjeta text-texto placeholder:text-texto-4 focus:outline-none focus:border-marca"
                />
                <p className="text-xs text-texto-4 mt-1">Solo letras, números y guiones, sin espacios</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-texto-2 mb-1">
                  Contraseña
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="Mínimo 6 caracteres"
                  className="w-full border border-borde-campo rounded-xl px-4 py-3 bg-tarjeta text-texto placeholder:text-texto-4 focus:outline-none focus:border-marca"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-texto-2 mb-1">
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
                          ? 'bg-marca text-texto-invertido'
                          : 'bg-tarjeta-hundida text-texto-2'
                      }`}
                    >
                      {r === 'admin' ? 'Admin' : 'Cajero'}
                    </button>
                  ))}
                </div>
              </div>

              {errorForm && <p className="text-negativo text-sm">{errorForm}</p>}

              <button
                onClick={handleCrear}
                disabled={creando}
                className="w-full bg-marca text-texto-invertido py-4 rounded-xl text-lg font-bold disabled:opacity-40"
              >
                {creando ? 'Creando...' : 'Crear usuario'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Eliminar usuario — mismo patrón que "Confirmar activación de inventario" en /perfil */}
      {confirmEliminar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-overlay"
            onClick={() => { if (!eliminando) setConfirmEliminar(null); }}
          />
          <div className="relative bg-tarjeta rounded-2xl w-full max-w-sm shadow-xl p-5">
            <h2 className="text-xl font-bold text-texto mb-1">Eliminar usuario</h2>
            <p className="text-sm text-texto-3 mb-3">
              Se eliminará a <strong>{confirmEliminar.nombre || usernameDe(confirmEliminar.email)}</strong> definitivamente.
              No podrá volver a iniciar sesión.
            </p>
            <p className="text-xs text-texto-4 mb-4">
              Sus ventas y cierres anteriores se conservan en el historial con su nombre.
            </p>
            <p className="text-xs text-texto-4 text-center mb-4">Esta acción no se puede deshacer.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmEliminar(null)}
                disabled={eliminando}
                className="flex-1 py-3 rounded-xl bg-tarjeta-hundida text-texto font-semibold disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                onClick={handleEliminar}
                disabled={eliminando}
                className="flex-1 py-3 rounded-xl bg-red-600 active:bg-red-700 text-white font-bold disabled:opacity-40"
              >
                {eliminando ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-toast-fondo text-toast-texto px-5 py-2.5 rounded-xl text-sm font-medium z-50 shadow-lg whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  );
}
