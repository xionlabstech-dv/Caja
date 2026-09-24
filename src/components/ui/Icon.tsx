// Envoltorio central de íconos (Brief 01 — sistema de diseño). Las pantallas
// nuevas usan <Icon nombre="..." /> en vez de importar de "lucide-react"
// directo — así el grosor de trazo y los tamaños quedan fijos en un solo
// lugar y nadie los cambia pantalla por pantalla.
import { ICONOS, GROSOR_ICONO, TAMANO_ICONO, type NombreIcono } from './iconos';

interface IconProps {
  nombre: NombreIcono;
  tamano?: number;
  className?: string;
}

export default function Icon({ nombre, tamano = TAMANO_ICONO.barraInferior, className }: IconProps) {
  const LucideIcon = ICONOS[nombre];
  return <LucideIcon size={tamano} strokeWidth={GROSOR_ICONO} className={className} aria-hidden="true" />;
}
