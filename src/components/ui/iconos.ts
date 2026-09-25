// Mapa central de íconos (Brief 01 — sistema de diseño).
//
// Las pantallas nuevas importan íconos desde acá, nunca directo de
// "lucide-react" — así un mismo concepto de negocio usa siempre el mismo
// ícono en toda la app. Hoy cada pantalla dibuja su propio SVG a mano y hay
// duplicados accidentales (Fiado y Usuarios comparten el mismo dibujo de
// "personas"; "Escanear código de barras" tiene dos dibujos distintos según
// la pantalla) — este mapa es la fuente única que reemplaza eso, pantalla
// por pantalla, en briefs futuros. Ninguna pantalla existente se tocó en
// este brief.
//
// La mitad de las entradas reproduce el ícono que ya usa el código real
// (Caja, Resumen, Inventario, Reportes, Tasa, Datos del negocio, Buscar,
// Agregar, Editar, Eliminar, modo oscuro/claro). La otra mitad no tenía
// ícono en el producto (Fiado, Usuarios, Movimientos, Perfil, Escanear,
// Cerrar sesión, En línea/Sin conexión, Registrar merma, y los métodos de
// pago) — son decisión propia, con mejor criterio, aprobada en el Paso 0.
import {
  ShoppingCart,
  House,
  BarChart3,
  ClipboardList,
  FileText,
  HandCoins,
  Package,
  PackageMinus,
  PackageOpen,
  History,
  CircleDollarSign,
  Users,
  Building2,
  CircleUserRound,
  Moon,
  Sun,
  ScanBarcode,
  Search,
  Plus,
  Pencil,
  Trash2,
  LogOut,
  Wifi,
  WifiOff,
  Banknote,
  Smartphone,
  Fingerprint,
  CreditCard,
  X,
  MapPin,
  Phone,
  Mail,
  Info,
  Lock,
  ChevronRight,
  RotateCw,
  type LucideIcon,
} from 'lucide-react';
import type { MetodoPago } from '@/types';

export const ICONOS = {
  // Navegación / pantallas principales
  caja: ShoppingCart,
  inicio: House,
  resumen: ClipboardList,
  fiado: HandCoins,
  inventario: Package,
  movimientos: History,
  reportes: BarChart3,
  presupuestos: FileText,
  tasaDelDia: CircleDollarSign,
  usuarios: Users,
  datosDelNegocio: Building2,
  perfil: CircleUserRound,

  // Tema
  modoOscuro: Moon,
  modoClaro: Sun,

  // Acciones
  escanearCodigoBarras: ScanBarcode,
  buscar: Search,
  agregar: Plus,
  editar: Pencil,
  eliminar: Trash2,
  registrarMerma: PackageMinus,
  registrarMovimiento: PackageOpen,
  cerrarSesion: LogOut,
  cerrar: X, // no es un concepto de negocio del brief: cierre de hoja/modal/toast
  info: Info,

  // Conexión
  enLinea: Wifi,
  sinConexion: WifiOff,

  // Campos de "Datos del negocio" (Brief: rediseño de esta pantalla)
  campoNombreComercial: House,
  campoDireccion: MapPin,
  campoTelefono: Phone,
  campoCorreo: Mail,
  campoRif: FileText,

  // Pantalla "Perfil" (rediseño)
  candado: Lock,
  flechaDerecha: ChevronRight,
  cancelarSolicitud: RotateCw,

  // Métodos de pago
  metodoEfectivoBs: Banknote,
  metodoEfectivoUsd: Banknote,
  metodoPagoMovil: Smartphone,
  metodoBiopago: Fingerprint,
  metodoTarjeta: CreditCard,
  metodoFiado: HandCoins,
} as const satisfies Record<string, LucideIcon>;

export type NombreIcono = keyof typeof ICONOS;

export const ICONO_METODO_PAGO: Record<MetodoPago, NombreIcono> = {
  efectivo_bs: 'metodoEfectivoBs',
  efectivo_usd: 'metodoEfectivoUsd',
  pago_movil: 'metodoPagoMovil',
  biopago: 'metodoBiopago',
  tarjeta: 'metodoTarjeta',
  fiado: 'metodoFiado',
};

// Tamaños reales documentados en design-system/readme.md — no "2 o 3"
// tamaños genéricos: el propio Design System ya usa 6, cada uno con un rol
// fijo. Nadie los cambia pantalla por pantalla.
export const TAMANO_ICONO = {
  chip: 12,
  secundario: 16,
  buscarYToggle: 20,
  barraInferior: 24,
  grillaMas: 28,
  login: 44,
} as const;

// Grosor de línea fijo — el valor por defecto de Lucide.
export const GROSOR_ICONO = 2;
