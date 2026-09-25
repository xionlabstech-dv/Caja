'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/components/Providers';
import { useGuardarRuta } from '@/lib/useGuardarRuta';
import { usernameDe } from '@/lib/usuarios';
import { setCachedUsaCostos, setCachedUsaStock, setCachedDatosNegocio } from '@/lib/db';
import { encolarActualizarUsaCostos, encolarActualizarUsaStock } from '@/lib/outbox';
import { updateUsaCostos, updateUsaStock, solicitarEliminacionNegocio, cancelarEliminacionNegocio, conCandado } from '@/lib/sync';
import { supabase } from '@/lib/supabase';
import { DatosNegocio } from '@/types';
import ThemeToggle from '@/components/ThemeToggle';
import Icon from '@/components/ui/Icon';

// Duplicado a propósito — mismo patrón ya usado en page.tsx y en
// presupuestos/nuevo/page.tsx, ninguno de los dos lo comparte desde un lib.
function avatarColor(nombre: string): string {
  const idx = nombre.charCodeAt(0) % 8;
  return ['bg-violet-500', 'bg-blue-500', 'bg-cyan-500', 'bg-teal-500',
    'bg-emerald-500', 'bg-amber-500', 'bg-orange-500', 'bg-pink-500'][idx];
}

function fmtFechaSolicitud(iso: string): string {
  const dia = new Date(iso).toLocaleDateString('es-VE', { day: 'numeric', month: 'long' });
  const hora = new Date(iso).toLocaleTimeString('es-VE', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${dia}, ${hora}`;
}

export default function PerfilPage() {
  const permitida = useGuardarRuta();
  const router = useRouter();
  const {
    user, userNombre, negocioNombre, rol, negocioId, isOnline,
    usaCostos, setUsaCostos, usaStock, setUsaStock,
    datosNegocio, setDatosNegocio, signOut,
  } = useApp();

  const [toast, setToast] = useState('');
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  // Cambiar contraseña — mismo mecanismo de siempre (conCandado + signIn de
  // verificación + updateUser), ahora en su propia hoja de /perfil en vez
  // del sheet de page.tsx.
  const [showPassword, setShowPassword] = useState(false);
  const [passActual, setPassActual] = useState('');
  const [passNueva, setPassNueva] = useState('');
  const [passConfirmar, setPassConfirmar] = useState('');
  const [passError, setPassError] = useState('');
  const [passCargando, setPassCargando] = useState(false);

  const [showConfirmStock, setShowConfirmStock] = useState(false);

  const [showEliminar, setShowEliminar] = useState(false);
  const [confirmacionNombre, setConfirmacionNombre] = useState('');
  const [confirmacionTocada, setConfirmacionTocada] = useState(false);
  const [eliminarCargando, setEliminarCargando] = useState(false);
  const [cancelarCargando, setCancelarCargando] = useState(false);

  if (!permitida) return null;

  const esAdmin = rol === 'admin';
  const nombreMostrado = userNombre || negocioNombre || 'Usuario';

  const abrirPassword = () => {
    setPassActual('');
    setPassNueva('');
    setPassConfirmar('');
    setPassError('');
    setShowPassword(true);
  };

  const cambiarPassword = async () => {
    setPassError('');
    if (passNueva !== passConfirmar) {
      setPassError('Las contraseñas no coinciden');
      return;
    }
    if (passNueva.length < 6) {
      setPassError('La nueva contraseña debe tener al menos 6 caracteres');
      return;
    }
    setPassCargando(true);

    const resultadoSignIn = await conCandado(supabase.auth.signInWithPassword({
      email: user?.email ?? '',
      password: passActual,
    }));
    if (resultadoSignIn === 'candado') {
      setPassError('No se pudo confirmar, verifica tu conexión e intenta de nuevo');
      setPassCargando(false);
      return;
    }
    if (resultadoSignIn.error) {
      setPassError('Contraseña actual incorrecta');
      setPassCargando(false);
      return;
    }

    const resultadoUpdate = await conCandado(supabase.auth.updateUser({ password: passNueva }));
    setPassCargando(false);
    if (resultadoUpdate === 'candado') {
      setPassError('No se pudo confirmar, verifica tu conexión e intenta de nuevo');
      return;
    }
    if (resultadoUpdate.error) {
      setPassError('Error al actualizar la contraseña');
      return;
    }
    setShowPassword(false);
    showToast('Contraseña actualizada');
  };

  // Toggles de costos/inventario — mismo patrón optimista + cola offline que
  // ya tenía el sheet viejo de page.tsx, solo reubicado acá.
  const handleToggleUsaCostos = async () => {
    if (!negocioId) return;
    const anterior = usaCostos;
    const nuevo = !usaCostos;
    await setCachedUsaCostos(nuevo);
    setUsaCostos(nuevo);

    if (!isOnline) {
      await encolarActualizarUsaCostos(nuevo, negocioId);
      showToast('Guardado localmente — se sincronizará cuando haya conexión');
      return;
    }

    const resultado = await updateUsaCostos(nuevo, negocioId);
    if (!resultado.ok) {
      if (resultado.permanente === false) {
        await encolarActualizarUsaCostos(nuevo, negocioId);
        showToast('Guardado localmente — se sincronizará cuando haya conexión');
        return;
      }
      await setCachedUsaCostos(anterior);
      setUsaCostos(anterior);
      showToast('No se pudo guardar el cambio. Intenta de nuevo.');
      return;
    }
    showToast(nuevo ? 'Control de costos activado' : 'Control de costos desactivado');
  };

  // Activar pide confirmación explícita; desactivar no la necesita — no
  // borra datos, solo deja de mostrarlos.
  const handleToggleUsaStock = () => {
    if (!usaStock) {
      setShowConfirmStock(true);
      return;
    }
    aplicarUsaStock(false);
  };

  const confirmarActivarStock = () => {
    setShowConfirmStock(false);
    aplicarUsaStock(true);
  };

  const aplicarUsaStock = async (nuevo: boolean) => {
    if (!negocioId) return;
    const anterior = usaStock;
    await setCachedUsaStock(nuevo);
    setUsaStock(nuevo);

    if (!isOnline) {
      await encolarActualizarUsaStock(nuevo, negocioId);
      showToast('Guardado localmente — se sincronizará cuando haya conexión');
      return;
    }

    const resultado = await updateUsaStock(nuevo, negocioId);
    if (!resultado.ok) {
      if (resultado.permanente === false) {
        await encolarActualizarUsaStock(nuevo, negocioId);
        showToast('Guardado localmente — se sincronizará cuando haya conexión');
        return;
      }
      await setCachedUsaStock(anterior);
      setUsaStock(anterior);
      showToast('No se pudo guardar el cambio. Intenta de nuevo.');
      return;
    }
    showToast(nuevo ? 'Control de inventario activado' : 'Control de inventario desactivado');
  };

  // Zona de riesgo — solicitud_eliminacion_en es de solo lectura desde acá
  // (ver comentario en types/index.ts); las dos únicas formas de cambiarlo
  // son las funciones de abajo, y tras cada una se actualiza datosNegocio a
  // mano (mismo mecanismo de caché que ya tiene ese objeto) para no esperar
  // a la próxima carga del perfil.
  const solicitudActiva = Boolean(datosNegocio.solicitudEliminacionEn);
  const nombreCoincide = confirmacionNombre === negocioNombre;
  const nombreErrado = confirmacionTocada && confirmacionNombre.length > 0 && !nombreCoincide;

  const abrirEliminar = () => {
    setConfirmacionNombre('');
    setConfirmacionTocada(false);
    setShowEliminar(true);
  };

  const confirmarEliminar = async () => {
    if (!nombreCoincide) return;
    setEliminarCargando(true);
    const resultado = await solicitarEliminacionNegocio(confirmacionNombre.trim());
    setEliminarCargando(false);
    if (!resultado.ok) {
      showToast(resultado.mensaje || 'No se pudo registrar la solicitud');
      return;
    }
    const nuevo: DatosNegocio = { ...datosNegocio, solicitudEliminacionEn: new Date().toISOString() };
    await setCachedDatosNegocio(nuevo);
    setDatosNegocio(nuevo);
    setShowEliminar(false);
    showToast('Solicitud registrada · el cierre tarda de 24 a 48 horas');
  };

  const cancelarSolicitud = async () => {
    setCancelarCargando(true);
    const resultado = await cancelarEliminacionNegocio();
    setCancelarCargando(false);
    if (!resultado.ok) {
      showToast(resultado.mensaje || 'No se pudo cancelar la solicitud');
      return;
    }
    const nuevo: DatosNegocio = { ...datosNegocio, solicitudEliminacionEn: null };
    await setCachedDatosNegocio(nuevo);
    setDatosNegocio(nuevo);
    showToast('Solicitud cancelada · la cuenta sigue activa');
  };

  return (
    <div>
      <header className="bg-superficie-barra border-b border-borde-divisor px-4 pt-3.5 pb-3 flex items-center gap-2.5">
        <button onClick={() => router.back()} className="p-1 -ml-1 flex-shrink-0 text-texto-3" aria-label="Volver">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="flex-1 min-w-0 text-base font-bold text-texto truncate">Perfil</h1>
        <ThemeToggle />
      </header>

      <div className="p-4 space-y-5">
        {/* Identidad */}
        <div className="flex items-center gap-3.5 p-4 bg-tarjeta border border-borde-tarjeta rounded-2xl">
          <span className={`flex-none w-14 h-14 rounded-full ${avatarColor(nombreMostrado)} flex items-center justify-center text-white text-xl font-bold`}>
            {nombreMostrado.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-[17px] font-bold text-texto leading-tight truncate">{nombreMostrado}</p>
            {user?.email && <p className="text-sm font-medium text-texto-3">@{usernameDe(user.email)}</p>}
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              <span className={`h-[22px] px-2 inline-flex items-center rounded-full text-[11px] font-bold ${
                esAdmin ? 'bg-marca-suave text-marca-suave-texto' : 'bg-tarjeta-hundida text-texto-3'
              }`}>
                {esAdmin ? 'Administrador' : 'Cajero'}
              </span>
              <span className="text-xs font-medium text-texto-3 truncate">{negocioNombre}</span>
            </div>
          </div>
        </div>

        {/* Tu cuenta */}
        <div className="space-y-2">
          <span className="block text-[11px] font-bold uppercase tracking-wide text-texto-3">Tu cuenta</span>
          <div className="flex flex-col gap-px bg-borde-divisor rounded-2xl overflow-hidden">
            <button onClick={abrirPassword} className="flex items-center gap-3 min-h-[56px] px-3.5 py-3 bg-tarjeta text-left">
              <span className="flex-none w-9 h-9 rounded-[10px] bg-tarjeta-hundida text-texto-3 flex items-center justify-center">
                <Icon nombre="candado" tamano={18} />
              </span>
              <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold text-texto">Cambiar mi contraseña</span>
                <span className="text-xs text-texto-3">Solo cambia la tuya, no la de los demás</span>
              </span>
              <Icon nombre="flechaDerecha" tamano={16} className="flex-none text-texto-4" />
            </button>
          </div>
        </div>

        {/* Preferencias del negocio — no viene del HTML de Design (Juan lo
            confirmó igual), reubicado acá desde el sheet viejo de page.tsx. */}
        {esAdmin && (
          <div className="space-y-2">
            <span className="block text-[11px] font-bold uppercase tracking-wide text-texto-3">Preferencias del negocio</span>
            <div className="flex flex-col gap-px bg-borde-divisor rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between gap-3 min-h-[56px] px-3.5 py-3 bg-tarjeta">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-texto">Llevar control de costos y ganancias</p>
                  <p className="text-xs text-texto-3 mt-0.5">Agrega costo a productos y ganancia a reportes</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={usaCostos}
                  onClick={handleToggleUsaCostos}
                  className={`relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 ${usaCostos ? 'bg-marca' : 'bg-tarjeta-hundida'}`}
                >
                  <span className={`inline-block w-5 h-5 m-0.5 bg-white rounded-full shadow-sm transition-transform ${usaCostos ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
              <div className="flex items-center justify-between gap-3 min-h-[56px] px-3.5 py-3 bg-tarjeta">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-texto">Control de inventario</p>
                  <p className="text-xs text-texto-3 mt-0.5">Descuenta existencias al vender y avisa stock bajo</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={usaStock}
                  onClick={handleToggleUsaStock}
                  className={`relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 ${usaStock ? 'bg-marca' : 'bg-tarjeta-hundida'}`}
                >
                  <span className={`inline-block w-5 h-5 m-0.5 bg-white rounded-full shadow-sm transition-transform ${usaStock ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Administración del negocio — el HTML trae acá "Datos del negocio
            y usuarios" apuntando a /datos-negocio; Juan confirmó que texto y
            destino están mal ahí, la fila real es esta. */}
        {esAdmin && (
          <div className="space-y-2">
            <span className="block text-[11px] font-bold uppercase tracking-wide text-texto-3">Administración del negocio</span>
            <button
              onClick={() => router.push('/usuarios')}
              className="w-full flex items-center gap-3 min-h-[56px] px-3.5 py-3 bg-tarjeta border border-borde-tarjeta rounded-2xl text-left"
            >
              <span className="flex-none w-9 h-9 rounded-[10px] bg-tarjeta-hundida text-texto-3 flex items-center justify-center">
                <Icon nombre="usuarios" tamano={18} />
              </span>
              <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold text-texto">Crear usuarios</span>
                <span className="text-xs text-texto-3">Cajero o admin nuevo para el negocio</span>
              </span>
              <Icon nombre="flechaDerecha" tamano={16} className="flex-none text-texto-4" />
            </button>
          </div>
        )}

        <button
          onClick={signOut}
          className="w-full h-[52px] rounded-2xl border border-borde-tarjeta bg-tarjeta text-texto font-bold text-[15px] flex items-center justify-center gap-2"
        >
          <Icon nombre="cerrarSesion" tamano={18} />
          Cerrar sesión
        </button>

        {/* Zona de riesgo */}
        {esAdmin && (
          <div className="pt-5 mt-1 border-t border-borde-tarjeta space-y-2.5">
            <span className="block text-[11px] font-bold uppercase tracking-wide text-negativo">Zona de riesgo</span>

            {solicitudActiva ? (
              <div className="p-3.5 rounded-2xl bg-aviso-fondo border border-aviso-borde space-y-2">
                <p className="text-[15px] font-bold text-aviso leading-snug">Ya pediste cerrar la cuenta</p>
                <p className="text-sm text-aviso leading-relaxed">
                  Lo pediste el {fmtFechaSolicitud(datosNegocio.solicitudEliminacionEn as string)}. El cierre lo hace el equipo de Caja y puede tardar de 24 a 48 horas. Mientras tanto el negocio sigue funcionando normal.
                </p>
                <button
                  onClick={cancelarSolicitud}
                  disabled={cancelarCargando}
                  className="h-11 px-4 rounded-xl border border-aviso-borde bg-tarjeta text-aviso font-bold text-sm flex items-center gap-2 disabled:opacity-40"
                >
                  <Icon nombre="cancelarSolicitud" tamano={16} />
                  {cancelarCargando ? 'Cancelando...' : 'Cancelar solicitud'}
                </button>
                <div className="pt-2 border-t border-aviso-borde text-xs text-aviso leading-relaxed">
                  Para dudas sobre el cierre, escribe a <span className="font-bold">xionlabstech@gmail.com</span>
                </div>
              </div>
            ) : (
              <div className="p-3.5 rounded-2xl bg-tarjeta border border-negativo-borde space-y-2.5">
                <p className="text-[15px] font-bold text-negativo leading-snug">Eliminar cuenta</p>
                <p className="text-sm text-texto-3 leading-relaxed">
                  Se borran para siempre los productos, ventas, fiado, presupuestos y usuarios de {negocioNombre}. No se puede deshacer.
                </p>
                <button
                  onClick={abrirEliminar}
                  className="h-11 px-4 rounded-xl border border-negativo-borde bg-negativo-fondo text-negativo font-bold text-sm flex items-center gap-2"
                >
                  <Icon nombre="eliminar" tamano={16} />
                  Eliminar cuenta
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Hoja: cambiar contraseña */}
      {showPassword && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-overlay" onClick={() => setShowPassword(false)} />
          <div className="relative w-full max-w-lg mx-auto bg-tarjeta rounded-t-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-center px-4 pt-4 pb-2">
              <div className="w-8 h-1 bg-borde-tarjeta rounded-full" />
            </div>
            <div className="p-4 pt-1 pb-6 space-y-3">
              <p className="text-base font-bold text-texto">Cambiar contraseña</p>
              <input
                type="password"
                value={passActual}
                onChange={e => { setPassActual(e.target.value); setPassError(''); }}
                placeholder="Contraseña actual"
                className="w-full border border-borde-campo rounded-xl px-4 py-3 text-base bg-tarjeta text-texto placeholder:text-texto-4 focus:outline-none focus:border-marca"
              />
              <input
                type="password"
                value={passNueva}
                onChange={e => { setPassNueva(e.target.value); setPassError(''); }}
                placeholder="Nueva contraseña"
                className="w-full border border-borde-campo rounded-xl px-4 py-3 text-base bg-tarjeta text-texto placeholder:text-texto-4 focus:outline-none focus:border-marca"
              />
              <input
                type="password"
                value={passConfirmar}
                onChange={e => { setPassConfirmar(e.target.value); setPassError(''); }}
                placeholder="Confirmar nueva contraseña"
                className="w-full border border-borde-campo rounded-xl px-4 py-3 text-base bg-tarjeta text-texto placeholder:text-texto-4 focus:outline-none focus:border-marca"
              />
              {passError && <p className="text-negativo text-sm">{passError}</p>}
              <button
                onClick={cambiarPassword}
                disabled={passCargando || !passActual || !passNueva || !passConfirmar}
                className="w-full bg-marca text-texto-invertido py-3 rounded-xl font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {passCargando ? 'Guardando...' : 'Guardar contraseña'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmar activación de control de inventario */}
      {showConfirmStock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-overlay" onClick={() => setShowConfirmStock(false)} />
          <div className="relative bg-tarjeta rounded-2xl w-full max-w-sm shadow-xl p-5">
            <h2 className="text-xl font-bold text-texto mb-2">Activar control de inventario</h2>
            <p className="text-sm text-texto-3 mb-5">
              El control de inventario solo funciona si registras la mercancía que entra.
              Si no lo haces, las existencias dejarán de ser confiables en pocas semanas.
              ¿Activar?
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowConfirmStock(false)} className="flex-1 py-3 rounded-xl bg-tarjeta-hundida text-texto font-semibold">
                Cancelar
              </button>
              <button onClick={confirmarActivarStock} className="flex-1 py-3 rounded-xl bg-marca text-texto-invertido font-bold">
                Sí, activar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hoja: confirmar eliminación de la cuenta */}
      {showEliminar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-overlay" onClick={() => setShowEliminar(false)} />
          <div className="relative w-full max-w-sm max-h-[85vh] flex flex-col bg-tarjeta border border-borde-tarjeta rounded-2xl shadow-xl">
            <div className="flex-none flex items-center gap-2 px-4 pt-4 pb-2.5">
              <h2 className="flex-1 min-w-0 text-lg font-bold text-negativo">Eliminar cuenta</h2>
              <button onClick={() => setShowEliminar(false)} aria-label="Cerrar" className="flex-none w-9 h-9 flex items-center justify-center text-texto-4">
                <Icon nombre="cerrar" tamano={20} />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-2 space-y-3.5">
              <p className="text-sm text-texto leading-relaxed">
                Esto borra <strong className="font-bold">para siempre</strong> el negocio <strong className="font-bold">{negocioNombre}</strong>: sus productos, ventas, fiado, presupuestos y usuarios. No se puede deshacer.
              </p>

              <div className="p-3 rounded-xl bg-aviso-fondo border border-aviso-borde space-y-1.5">
                <p className="text-sm font-bold text-aviso">El cierre no es inmediato</p>
                <p className="text-sm text-aviso leading-relaxed">
                  Al confirmar queda registrada la solicitud. El equipo de Caja la ejecuta en 24 a 48 horas. Hasta entonces puedes seguir cobrando, y puedes cancelar la solicitud desde esta misma pantalla.
                </p>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-semibold text-texto-3">
                  Para confirmar, escribe el nombre exacto: <span className="font-bold text-texto">{negocioNombre}</span>
                </label>
                <input
                  value={confirmacionNombre}
                  onChange={e => { setConfirmacionNombre(e.target.value); setConfirmacionTocada(true); }}
                  placeholder="Nombre del negocio"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className={`w-full h-[52px] px-3.5 rounded-xl bg-tarjeta-hundida border outline-none text-[15px] font-semibold text-texto ${
                    nombreErrado ? 'border-negativo-borde' : 'border-borde-campo'
                  }`}
                />
                {nombreErrado && (
                  <p className="text-xs text-negativo leading-relaxed">
                    El nombre no coincide. Escríbelo tal cual: {negocioNombre}
                  </p>
                )}
              </div>
            </div>
            <div className="flex-none px-4 pt-3 pb-4 border-t border-borde-tarjeta space-y-2">
              <button
                onClick={confirmarEliminar}
                disabled={!nombreCoincide || eliminarCargando}
                className="w-full h-[52px] rounded-2xl bg-red-600 active:bg-red-700 text-white font-bold text-[17px] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {eliminarCargando ? 'Enviando...' : nombreCoincide ? 'Pedir el cierre de la cuenta' : 'Escribe el nombre para confirmar'}
              </button>
              <button onClick={() => setShowEliminar(false)} className="w-full h-11 rounded-xl border border-borde-tarjeta text-texto-3 font-semibold text-[15px]">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-toast-fondo text-toast-texto px-5 py-2.5 rounded-xl text-sm font-medium z-50 shadow-lg max-w-xs text-center">
          {toast}
        </div>
      )}
    </div>
  );
}
