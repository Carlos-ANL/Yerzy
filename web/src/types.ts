export type TipoCuenta = "credito" | "debito" | "alto_rendimiento" | "broker";
export type Moneda = "PEN" | "USD";

export interface Cuenta {
  id: string;
  tipo: TipoCuenta;
  nombre: string;
  banco: string | null;
  moneda: Moneda;
  dia_corte: number | null;
  dia_pago: number | null;
  linea_credito: number | null;
  saldo_inicial: number;
  fecha_saldo_inicial: string;
  activa: boolean;
}

export interface Saldo {
  cuenta_id: string;
  tipo: TipoCuenta;
  nombre: string;
  banco: string | null;
  moneda: Moneda;
  saldo: number;
}

export interface ResumenTarjeta {
  cuenta_id: string;
  nombre: string;
  moneda: Moneda;
  linea_credito: number | null;
  deuda_total: number;
  gasto_ciclo_abierto: number;
  deuda_ciclo_cerrado: number;
  proximo_corte: string;
  pago_ciclo_abierto: string;
  ultimo_corte: string;
  pago_ciclo_cerrado: string;
  dias_para_pago: number;
}

export interface Movimiento {
  id: string;
  cuenta_id: string;
  tipo: string;
  fecha: string;
  monto: number;
  moneda: Moneda;
  monto_cuenta: number;
  tc_fecha_dato: string | null;
  tc_compra: number | null;
  tc_venta: number | null;
  tc_pendiente: boolean;
  categoria: string | null;
  origen: string | null;
  descripcion: string | null;
  origen_registro: string;
  cuentas?: { nombre: string } | null;
}

export const CATEGORIAS_GASTO = ["comida", "transporte", "servicios", "salud", "ocio", "compras", "otros"];
export const ORIGENES_INGRESO = ["sueldo", "DEHSE", "contratos", "otros"];

export const ETIQUETA_TIPO_CUENTA: Record<TipoCuenta, string> = {
  credito: "Tarjeta de crédito",
  debito: "Tarjeta de débito",
  alto_rendimiento: "Alto rendimiento",
  broker: "Broker",
};

export const ETIQUETA_MOVIMIENTO: Record<string, string> = {
  gasto: "Gasto",
  ingreso: "Ingreso",
  pago_tarjeta: "Pago de tarjeta",
  transferencia_salida: "Transferencia (sale)",
  transferencia_entrada: "Transferencia (entra)",
  interes: "Interés",
  deposito: "Depósito",
  retiro: "Retiro",
  comision: "Comisión",
  compra_etf: "Compra ETF",
  venta_etf: "Venta ETF",
  dividendo: "Dividendo",
};
