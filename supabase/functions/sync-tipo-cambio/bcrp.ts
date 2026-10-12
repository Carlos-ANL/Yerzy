// Lectura del tipo de cambio "Sistema bancario SBS" desde la API pública del BCRP.
// Series: PD04639PD = compra, PD04640PD = venta (S/ por US$).
// Ojo: el BCRP suele publicar con 2-3 días de retraso; los días sin dato llegan como "n.d.".

export interface FilaTC {
  fecha: string; // YYYY-MM-DD
  compra: number;
  venta: number;
}

const MESES: Record<string, string> = {
  ene: "01", feb: "02", mar: "03", abr: "04", may: "05", jun: "06",
  jul: "07", ago: "08", set: "09", sep: "09", oct: "10", nov: "11", dic: "12",
};

// "01.Oct.26" -> "2026-10-01"
export function parsearFechaBCRP(nombre: string): string | null {
  const m = nombre.trim().match(/^(\d{1,2})\.([A-Za-zñÑ]{3})\.(\d{2,4})$/);
  if (!m) return null;
  const mes = MESES[m[2].toLowerCase()];
  if (!mes) return null;
  const anio = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${anio}-${mes}-${m[1].padStart(2, "0")}`;
}

export function parsearRespuestaBCRP(json: unknown): FilaTC[] {
  const periodos = (json as { periods?: { name: string; values: string[] }[] })?.periods;
  if (!Array.isArray(periodos)) throw new Error("Respuesta del BCRP sin 'periods'");
  const filas: FilaTC[] = [];
  for (const p of periodos) {
    const fecha = parsearFechaBCRP(p.name);
    const compra = Number(p.values?.[0]);
    const venta = Number(p.values?.[1]);
    if (!fecha || !Number.isFinite(compra) || !Number.isFinite(venta)) continue; // "n.d." -> se omite
    filas.push({ fecha, compra: Math.round(compra * 10000) / 10000, venta: Math.round(venta * 10000) / 10000 });
  }
  return filas;
}

export function urlBCRP(desde: string, hasta: string): string {
  return `https://estadisticas.bcrp.gob.pe/estadisticas/series/api/PD04639PD-PD04640PD/json/${desde}/${hasta}/esp`;
}
