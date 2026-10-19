import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { dinero, fechaCorta } from "../format";
import { ETIQUETA_TIPO_CUENTA, type ResumenTarjeta, type Saldo, type TipoCuenta } from "../types";

export default function Resumen({ version }: { version: number }) {
  const [tarjetas, setTarjetas] = useState<ResumenTarjeta[]>([]);
  const [saldos, setSaldos] = useState<Saldo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [t, s] = await Promise.all([
        supabase.from("v_tarjetas_resumen").select("*").order("nombre"),
        supabase.from("v_saldos").select("*").order("nombre"),
      ]);
      if (t.error || s.error) setError((t.error ?? s.error)!.message);
      else {
        setTarjetas(t.data as ResumenTarjeta[]);
        setSaldos(s.data as Saldo[]);
      }
    })();
  }, [version]);

  if (error) return <p className="error">{error}</p>;

  const otros = saldos.filter((s) => s.tipo !== "credito");
  const orden: TipoCuenta[] = ["debito", "alto_rendimiento", "broker"];
  const totalPEN = otros.filter((s) => s.moneda === "PEN").reduce((a, s) => a + Number(s.saldo), 0);
  const totalUSD = otros.filter((s) => s.moneda === "USD").reduce((a, s) => a + Number(s.saldo), 0);

  return (
    // Dos columnas: tarjetas de crédito a la izquierda, cuentas a la derecha (arriba)
    <div className="resumen">
      <section>
        <h2>Tarjetas de crédito</h2>
        {tarjetas.length === 0 && <p className="suave">Aún no tienes tarjetas de crédito. Agrégalas en la pestaña Cuentas.</p>}
        <div className="rejilla">
          {tarjetas.map((t) => (
            <article className="tarjeta" key={t.cuenta_id}>
              <h3>{t.nombre}</h3>
              <p className="etiqueta">A pagar (ciclo cerrado)</p>
              <p className="grande">{dinero(Number(t.deuda_ciclo_cerrado), t.moneda)}</p>
              <p className="suave">
                {Number(t.deuda_ciclo_cerrado) > 0
                  ? `Vence el ${fechaCorta(t.pago_ciclo_cerrado)} (${t.dias_para_pago} días)`
                  : "Sin deuda pendiente del ciclo cerrado"}
              </p>
              <hr />
              <p className="etiqueta">Ciclo abierto</p>
              <p className="medio">{dinero(Number(t.gasto_ciclo_abierto), t.moneda)}</p>
              <p className="suave">
                Corta el {fechaCorta(t.proximo_corte)} · se paga el {fechaCorta(t.pago_ciclo_abierto)}
              </p>
              {t.linea_credito != null && (
                <p className="suave">Disponible aprox.: {dinero(Number(t.linea_credito) - Number(t.deuda_total), t.moneda)}</p>
              )}
            </article>
          ))}
        </div>
      </section>

      <section>
        <h2>Saldos</h2>
        <div className="total">
          <div>
            <span className="etiqueta">Total en soles</span>
            <strong>{dinero(totalPEN, "PEN")}</strong>
          </div>
          <div>
            <span className="etiqueta">Total en dólares</span>
            <strong>{dinero(totalUSD, "USD")}</strong>
          </div>
        </div>
        {orden.map((tipo) => {
          const lista = otros.filter((s) => s.tipo === tipo);
          if (lista.length === 0) return null;
          const titulo = tipo === "alto_rendimiento" ? "Tarjeta de alto rendimiento" : ETIQUETA_TIPO_CUENTA[tipo];
          return (
            <div key={tipo} className="grupo">
              <h3>{titulo}</h3>
              <ul className="lista">
                {lista.map((s) => (
                  <li key={s.cuenta_id}>
                    <div className="cuenta-info">
                      <span className="cuenta-nombre">{s.nombre}</span>
                      {s.banco && s.banco !== s.nombre ? <span className="suave">{s.banco}</span> : null}
                    </div>
                    <strong>{dinero(Number(s.saldo), s.moneda)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>
    </div>
  );
}
