import type { Moneda } from "./types";

export function dinero(valor: number, moneda: Moneda): string {
  return new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: moneda,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
  }).format(valor);
}

export function fechaCorta(iso: string): string {
  // iso = YYYY-MM-DD; se arma a mano para evitar corrimientos por zona horaria
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
}

export function hoyLima(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
}
