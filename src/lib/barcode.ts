// Heurística para distinguir "el usuario escaneó/escribió un código de
// barra" de "el usuario escribió un nombre para buscar": solo dígitos y
// largo mínimo de 6. Los códigos de barra reales (EAN-8, UPC-A, EAN-13...)
// son siempre numéricos de 8+ dígitos; 6 da margen sin arriesgar que un
// nombre de producto (que normalmente trae letras) dispare el flujo de
// código por error.
export function pareceCodigoBarra(texto: string): boolean {
  return /^\d{6,}$/.test(texto.trim());
}
