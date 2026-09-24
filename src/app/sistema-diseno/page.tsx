'use client';

// Página de revisión temporal del sistema de diseño (Brief 01). No llega a
// producción — se borra en el commit final antes de pedir el merge. Sin
// enlace desde ninguna parte de la app; se entra escribiendo la URL.
import { useState } from 'react';
import ThemeToggle from '@/components/ThemeToggle';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import ChipFiltro from '@/components/ui/ChipFiltro';
import TarjetaTinta from '@/components/ui/TarjetaTinta';
import BottomSheet from '@/components/ui/BottomSheet';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Toast from '@/components/ui/Toast';
import Icon from '@/components/ui/Icon';
import { ICONOS, TAMANO_ICONO, type NombreIcono } from '@/components/ui/iconos';

const SWATCHES: { grupo: string; items: { nombre: string; clase: string }[] }[] = [
  {
    grupo: 'Marca',
    items: [
      { nombre: 'marca', clase: 'bg-marca' },
      { nombre: 'marca-presion', clase: 'bg-marca-presion' },
      { nombre: 'marca-suave', clase: 'bg-marca-suave' },
      { nombre: 'foco', clase: 'bg-foco' },
    ],
  },
  {
    grupo: 'Tinta (fija en los dos modos)',
    items: [
      { nombre: 'tinta', clase: 'bg-tinta' },
      { nombre: 'tinta-etiqueta', clase: 'bg-tinta-etiqueta' },
    ],
  },
  {
    grupo: 'Superficies',
    items: [
      { nombre: 'superficie', clase: 'bg-superficie border border-borde-tarjeta' },
      { nombre: 'tarjeta', clase: 'bg-tarjeta border border-borde-tarjeta' },
      { nombre: 'tarjeta-hundida', clase: 'bg-tarjeta-hundida' },
      { nombre: 'superficie-barra', clase: 'bg-superficie-barra border border-borde-tarjeta' },
    ],
  },
  {
    grupo: 'Bordes',
    items: [
      { nombre: 'borde-tarjeta', clase: 'bg-borde-tarjeta' },
      { nombre: 'borde-campo', clase: 'bg-borde-campo' },
      { nombre: 'borde-divisor', clase: 'bg-borde-divisor' },
    ],
  },
  {
    grupo: 'Texto',
    items: [
      { nombre: 'texto', clase: 'bg-texto' },
      { nombre: 'texto-2', clase: 'bg-texto-2' },
      { nombre: 'texto-3', clase: 'bg-texto-3' },
      { nombre: 'texto-4', clase: 'bg-texto-4' },
    ],
  },
  {
    grupo: 'Riesgo',
    items: [
      { nombre: 'negativo', clase: 'bg-negativo' },
      { nombre: 'negativo-fondo', clase: 'bg-negativo-fondo border border-negativo-borde' },
      { nombre: 'deuda', clase: 'bg-deuda' },
      { nombre: 'deuda-fondo', clase: 'bg-deuda-fondo' },
      { nombre: 'aviso', clase: 'bg-aviso' },
      { nombre: 'aviso-fondo', clase: 'bg-aviso-fondo border border-aviso-borde' },
      { nombre: 'informativo', clase: 'bg-informativo' },
      { nombre: 'informativo-fondo', clase: 'bg-informativo-fondo' },
    ],
  },
];

const TAMANOS_DEMO: { etiqueta: string; valor: number }[] = [
  { etiqueta: 'chip (12)', valor: TAMANO_ICONO.chip },
  { etiqueta: 'secundario (16)', valor: TAMANO_ICONO.secundario },
  { etiqueta: 'buscar/toggle (20)', valor: TAMANO_ICONO.buscarYToggle },
  { etiqueta: 'barra inferior (24)', valor: TAMANO_ICONO.barraInferior },
  { etiqueta: 'grilla Más (28)', valor: TAMANO_ICONO.grillaMas },
  { etiqueta: 'login (44)', valor: TAMANO_ICONO.login },
];

export default function SistemaDisenoPage() {
  const [chipActivo, setChipActivo] = useState('todos');
  const [hojaAbierta, setHojaAbierta] = useState(false);
  const [confirmAbierto, setConfirmAbierto] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);

  const mostrarToast = () => {
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2500);
  };

  return (
    <div className="bg-superficie min-h-screen pb-24">
      <header className="bg-marca text-texto-invertido px-4 pt-4 pb-3 flex items-center justify-between sticky top-0 z-30">
        <div>
          <h1 className="text-xl font-bold font-caja">Sistema de diseño</h1>
          <p className="text-sm opacity-80 font-caja">Brief 01 — página temporal, se borra antes del merge</p>
        </div>
        <ThemeToggle />
      </header>

      <div className="p-4 space-y-8">
        {/* Tipografía */}
        <section>
          <h2 className="font-caja text-lg font-bold text-texto mb-3">Tipografía</h2>
          <div className="bg-tarjeta border border-borde-tarjeta rounded-[12px] p-4 space-y-2">
            <p className="font-caja text-[36px] font-bold text-texto tracking-[-0.02em]">Caja</p>
            <p className="font-caja text-base text-texto-2">Inter autoalojada — .font-caja</p>
            <p className="font-caja text-[24px] font-bold text-texto cifra">Bs 1.240,00 · $ 10,00</p>
            <p className="font-caja text-sm text-texto-3">.cifra — tabular-nums + cero rasurado (compará el 0 de arriba con este: 1.000.000)</p>
          </div>
        </section>

        {/* Color */}
        <section>
          <h2 className="font-caja text-lg font-bold text-texto mb-3">Color</h2>
          <div className="space-y-4">
            {SWATCHES.map(grupo => (
              <div key={grupo.grupo}>
                <p className="font-caja text-sm font-semibold text-texto-3 mb-2">{grupo.grupo}</p>
                <div className="flex flex-wrap gap-3">
                  {grupo.items.map(item => (
                    <div key={item.nombre} className="flex flex-col items-center gap-1 w-20">
                      <div className={['w-16 h-16 rounded-[12px]', item.clase].join(' ')} />
                      <span className="font-caja text-[11px] text-texto-3 text-center break-all">{item.nombre}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Íconos */}
        <section>
          <h2 className="font-caja text-lg font-bold text-texto mb-3">Íconos (Lucide)</h2>
          <p className="font-caja text-sm text-texto-3 mb-3">Grosor fijo (strokeWidth 2). Tamaños reales del Design System:</p>
          <div className="flex flex-wrap items-end gap-4 mb-4 bg-tarjeta border border-borde-tarjeta rounded-[12px] p-4">
            {TAMANOS_DEMO.map(t => (
              <div key={t.etiqueta} className="flex flex-col items-center gap-1">
                <Icon nombre="caja" tamano={t.valor} className="text-marca" />
                <span className="font-caja text-[11px] text-texto-3">{t.etiqueta}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
            {(Object.keys(ICONOS) as NombreIcono[]).map(nombre => (
              <div key={nombre} className="flex flex-col items-center gap-1 bg-tarjeta border border-borde-tarjeta rounded-[12px] p-2">
                <Icon nombre={nombre} tamano={TAMANO_ICONO.barraInferior} className="text-texto-2" />
                <span className="font-caja text-[10px] text-texto-3 text-center break-all">{nombre}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Botones */}
        <section>
          <h2 className="font-caja text-lg font-bold text-texto mb-3">Botón</h2>
          <div className="bg-tarjeta border border-borde-tarjeta rounded-[12px] p-4 space-y-3">
            <div className="flex gap-3 flex-wrap">
              <Button variante="primario">Primario</Button>
              <Button variante="secundario">Secundario</Button>
              <Button variante="destructivo">Destructivo</Button>
            </div>
            <div className="flex gap-3 flex-wrap">
              <Button variante="primario" disabled>Primario</Button>
              <Button variante="secundario" disabled>Secundario</Button>
              <Button variante="destructivo" disabled>Destructivo</Button>
            </div>
            <div className="flex gap-3 flex-wrap">
              <Button variante="primario" compacto>Compacto (44px)</Button>
            </div>
          </div>
        </section>

        {/* Campo de texto */}
        <section>
          <h2 className="font-caja text-lg font-bold text-texto mb-3">Campo de texto</h2>
          <div className="bg-tarjeta border border-borde-tarjeta rounded-[12px] p-4 space-y-3">
            <Input label="Nombre del producto" placeholder="Ej. Harina P.A.N. 1kg" />
            <Input label="Precio" defaultValue="No puede estar vacío" error="Ingresa un precio válido" />
          </div>
        </section>

        {/* Chip de filtro */}
        <section>
          <h2 className="font-caja text-lg font-bold text-texto mb-3">Chip de filtro</h2>
          <div className="bg-tarjeta border border-borde-tarjeta rounded-[12px] p-4 flex gap-2 flex-wrap">
            {['todos', 'bajo', 'sin', 'desactivados'].map(id => (
              <ChipFiltro key={id} activo={chipActivo === id} onClick={() => setChipActivo(id)}>
                {id === 'todos' ? 'Todos' : id === 'bajo' ? 'Stock bajo' : id === 'sin' ? 'Sin stock' : 'Desactivados'}
              </ChipFiltro>
            ))}
          </div>
        </section>

        {/* Tarjeta tinta */}
        <section>
          <h2 className="font-caja text-lg font-bold text-texto mb-3">Tarjeta tinta</h2>
          <TarjetaTinta etiqueta="Total por cobrar" valor="$ 128,50" referencia="Bs 4.712,35 de referencia" />
        </section>

        {/* Hoja inferior / confirmación / toast */}
        <section>
          <h2 className="font-caja text-lg font-bold text-texto mb-3">Hoja inferior, confirmación y toast</h2>
          <div className="bg-tarjeta border border-borde-tarjeta rounded-[12px] p-4 flex gap-3 flex-wrap">
            <Button variante="secundario" onClick={() => setHojaAbierta(true)}>Abrir hoja</Button>
            <Button variante="secundario" onClick={() => setConfirmAbierto(true)}>Abrir confirmación</Button>
            <Button variante="secundario" onClick={mostrarToast}>Mostrar toast</Button>
          </div>
        </section>
      </div>

      <BottomSheet abierto={hojaAbierta} onCerrar={() => setHojaAbierta(false)} titulo="Hoja inferior de ejemplo">
        <p className="font-caja text-texto-2 text-sm">
          Todo lo que interrumpe entra por acá — hoja de cobro, detalle de producto, armado de presupuesto.
        </p>
      </BottomSheet>

      <ConfirmDialog
        abierto={confirmAbierto}
        titulo="Eliminar producto"
        mensaje="Esta acción no se puede deshacer."
        textoConfirmar="Eliminar"
        varianteConfirmar="destructivo"
        onCancelar={() => setConfirmAbierto(false)}
        onConfirmar={() => setConfirmAbierto(false)}
      />

      <Toast visible={toastVisible} mensaje="3 cambios guardados en el dispositivo" />
    </div>
  );
}
