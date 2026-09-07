import { MetodoPago } from '@/types';

// Único lugar que define los métodos de pago y sus labels — usado en el
// selector de una venta (Caja) y en el selector de abono (Fiado), para que
// ambos se mantengan en sincronía sin duplicar la lista.
export const METODOS_PAGO: { id: MetodoPago; label: string }[] = [
  { id: 'efectivo_bs', label: 'Efectivo Bs' },
  { id: 'pago_movil', label: 'Pago Móvil' },
  { id: 'biopago', label: 'Biopago' },
  { id: 'tarjeta', label: 'Tarjeta' },
  { id: 'efectivo_usd', label: 'Efectivo $' },
  { id: 'fiado', label: 'Fiado' },
];
