'use client';

import { useApp } from '@/components/Providers';
import BottomSheet from '@/components/ui/BottomSheet';
import Button from '@/components/ui/Button';
import Icon from '@/components/ui/Icon';
import type { NombreIcono } from '@/components/ui/iconos';

const ITEMS: { icono: NombreIcono; titulo: string; descripcion: string }[] = [
  {
    icono: 'caja',
    titulo: 'Registra una venta',
    descripcion: 'Agrega productos al carrito, cobra en bolívares o dólares, y listo.',
  },
  {
    icono: 'fiado',
    titulo: 'Lleva el fiado de tus clientes',
    descripcion: 'Quién debe, cuánto, y cuándo pagó, todo organizado.',
  },
  {
    icono: 'tasaDelDia',
    titulo: 'Revisa la tasa del día',
    descripcion: 'Se actualiza sola, pero como Caja funciona sin internet, dale un vistazo si no sincronizó.',
  },
  {
    icono: 'resumen',
    titulo: 'Consulta tu resumen',
    descripcion: 'Cuánto vendiste, en qué método de pago, cuándo quieras.',
  },
];

interface ChecklistBienvenidaProps {
  onCerrar: () => void;
}

// Bottom sheet de bienvenida (Brief: checklist de primer login). Se monta
// desde dos lugares (Caja al detectar tutorial_visto=false, y el botón "Ver
// tutorial de bienvenida" de /perfil) — cerrarlo de cualquier forma (velo, X,
// o el botón final) cuenta como "visto" y llama al RPC acá mismo, para que
// ninguno de los dos puntos de montaje tenga que duplicar esa llamada.
export default function ChecklistBienvenida({ onCerrar }: ChecklistBienvenidaProps) {
  const { marcarTutorialVisto } = useApp();

  const cerrar = () => {
    marcarTutorialVisto();
    onCerrar();
  };

  return (
    <BottomSheet abierto onCerrar={cerrar} titulo="¡Bienvenido a Caja!">
      <div className="space-y-5">
        <div className="flex flex-col gap-4">
          {ITEMS.map(item => (
            <div key={item.titulo} className="flex items-start gap-3">
              <span className="flex-none w-10 h-10 rounded-[10px] bg-marca-suave text-marca-suave-texto flex items-center justify-center">
                <Icon nombre={item.icono} tamano={20} />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-[15px] font-semibold text-texto leading-snug">{item.titulo}</p>
                <p className="text-sm text-texto-3 leading-relaxed mt-0.5">{item.descripcion}</p>
              </div>
            </div>
          ))}
        </div>
        <Button variante="primario" onClick={cerrar} className="w-full">
          Entendido, empezar
        </Button>
      </div>
    </BottomSheet>
  );
}
