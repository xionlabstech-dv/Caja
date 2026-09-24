import { MotivoMovimiento } from '@/types';

// Fuente única para el formulario de "Registrar movimiento" — lo usan
// src/app/movimientos/page.tsx y el atajo del mismo formulario dentro de
// src/app/inventario/page.tsx. Nadie edita el motivo de un tipo en un lado
// sin que se le note en el otro.
export type TipoUI = 'entrada' | 'salida' | 'ajuste';

export const TIPO_TAB_LABELS: Record<TipoUI, string> = {
  entrada: 'Entrada',
  salida: 'Salida',
  ajuste: 'Ajuste por conteo',
};

// "Salida" solo trae devolución a proveedor — los otros cuatro motivos que
// tenía (consumo propio, daño, vencido, pérdida) ahora viven exclusivamente
// en "Registrar merma" (src/app/inventario/page.tsx), para no tener el
// mismo motivo disponible desde dos formularios distintos.
export const MOTIVOS: Record<TipoUI, { value: MotivoMovimiento; label: string }[]> = {
  entrada: [
    { value: 'compra', label: 'Compra' },
    { value: 'devolucion_cliente', label: 'Devolución de cliente' },
  ],
  salida: [
    { value: 'devolucion_proveedor', label: 'Devolución a proveedor' },
  ],
  ajuste: [{ value: 'conteo_fisico', label: 'Conteo físico' }],
};
