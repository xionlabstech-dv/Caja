export const HORAS_LIMITE_CONFIANZA = 2;

// El stock tiene distintos grados de confiabilidad. Sin conexión (o hace
// rato que no se sincroniza), un número ALTO sigue siendo útil — es poco
// probable que ya se haya agotado. Pero un número BAJO es peligroso: otro
// dispositivo pudo haber vendido lo último sin que este se entere. Por eso
// el corte de "no mostrar el número" aplica solo cuando el stock YA está en
// zona de alerta y además la información puede estar desactualizada — no en
// cualquier caso desactualizado.
export function debeOcultarStock(
  stock: number | null | undefined,
  stockMinimo: number | null | undefined,
  isOnline: boolean,
  ultimaSincronizacion: string | null,
): boolean {
  if (stock == null || stockMinimo == null) return false;
  if (!stockBajo(stock, stockMinimo)) return false;

  const desactualizado =
    !isOnline ||
    !ultimaSincronizacion ||
    Date.now() - new Date(ultimaSincronizacion).getTime() > HORAS_LIMITE_CONFIANZA * 60 * 60 * 1000;

  return desactualizado;
}

// stock NULL ("nunca inicializado") nunca cuenta como bajo — es distinto de
// cero y no debe disparar alertas.
export function stockBajo(stock: number | null | undefined, stockMinimo: number | null | undefined): boolean {
  return stock != null && stockMinimo != null && stock <= stockMinimo;
}
