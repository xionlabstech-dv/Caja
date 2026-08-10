export type TipoPeriodo = 'hoy' | 'semana' | 'mes' | 'mes_pasado';

export const PERIODOS: { tipo: TipoPeriodo; label: string }[] = [
  { tipo: 'hoy', label: 'Hoy' },
  { tipo: 'semana', label: 'Esta semana' },
  { tipo: 'mes', label: 'Este mes' },
  { tipo: 'mes_pasado', label: 'Mes pasado' },
];

// offset=0 es el período seleccionado; offset=-1 es el período inmediatamente
// anterior de la misma duración (para la comparación).
export function rangoPeriodo(tipo: TipoPeriodo, offset = 0): { desde: Date; hasta: Date } {
  const now = new Date();

  switch (tipo) {
    case 'hoy': {
      const desde = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
      const hasta = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset + 1);
      return { desde, hasta };
    }
    case 'semana': {
      const dia = now.getDay(); // 0=domingo
      const diffALunes = (dia + 6) % 7;
      const inicioSemana = now.getDate() - diffALunes + offset * 7;
      const desde = new Date(now.getFullYear(), now.getMonth(), inicioSemana);
      const hasta = new Date(now.getFullYear(), now.getMonth(), inicioSemana + 7);
      return { desde, hasta };
    }
    case 'mes': {
      const desde = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const hasta = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
      return { desde, hasta };
    }
    case 'mes_pasado': {
      // "mes pasado" ya es un período fijo (el mes calendario anterior al
      // actual); su "anterior" es un mes más atrás todavía.
      const desde = new Date(now.getFullYear(), now.getMonth() - 1 + offset, 1);
      const hasta = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      return { desde, hasta };
    }
  }
}

export function labelPeriodoAnterior(tipo: TipoPeriodo): string {
  switch (tipo) {
    case 'hoy': return 'Ayer';
    case 'semana': return 'Semana pasada';
    case 'mes': return 'Mes pasado';
    case 'mes_pasado': return 'El mes anterior';
  }
}
