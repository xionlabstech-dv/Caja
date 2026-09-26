export type TipoPeriodo = 'hoy' | 'semana' | 'mes' | 'personalizado';

// "Personalizado" no calcula un rango propio (ver rangoPeriodo) — al
// tocarlo se abre la hoja de rango con sus atajos; el rango elegido ahí se
// guarda aparte (rangoPersonalizado en la página), no acá.
export const PERIODOS: { tipo: TipoPeriodo; label: string }[] = [
  { tipo: 'hoy', label: 'Hoy' },
  { tipo: 'semana', label: 'Semana' },
  { tipo: 'mes', label: 'Mes' },
  { tipo: 'personalizado', label: 'Personalizado' },
];

// hasta siempre es exclusivo (el instante donde empieza el día/semana/mes
// siguiente) — mismo criterio en los tres casos, y en el rango personalizado
// armado a mano en la página (que suma un día a la fecha "hasta" elegida por
// el usuario, que sí es inclusiva).
export function rangoPeriodo(tipo: 'hoy' | 'semana' | 'mes'): { desde: Date; hasta: Date } {
  const now = new Date();

  switch (tipo) {
    case 'hoy': {
      const desde = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const hasta = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      return { desde, hasta };
    }
    case 'semana': {
      const dia = now.getDay(); // 0=domingo
      const diffALunes = (dia + 6) % 7;
      const inicioSemana = now.getDate() - diffALunes;
      const desde = new Date(now.getFullYear(), now.getMonth(), inicioSemana);
      const hasta = new Date(now.getFullYear(), now.getMonth(), inicioSemana + 7);
      return { desde, hasta };
    }
    case 'mes': {
      const desde = new Date(now.getFullYear(), now.getMonth(), 1);
      const hasta = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { desde, hasta };
    }
  }
}
