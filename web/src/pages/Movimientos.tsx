import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { dinero, fechaCorta } from "../format";
import { ETIQUETA_MOVIMIENTO, type Movimiento } from "../types";

export default function Movimientos({ version }: { version: number }) {
  const [filas, setFilas] = useState<Movimiento[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("movimientos")
      .select("*, cuentas(nombre)")
      .order("fecha", { ascending: false })
      .order("creado_en", { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setFilas((data ?? []) as unknown as Movimiento[]);
      });
  }, [version]);

  if (error) return <p className="error">{error}</p>;

  return (
    <section>
      <h2>Últimos movimientos</h2>
      {filas.length === 0 && <p className="suave">Todavía no hay movimientos.</p>}
      <div className="tabla-scroll">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Cuenta</th>
              <th>Tipo</th>
              <th className="num">Monto</th>
              <th className="num">TC SBS compra / venta</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((m) => (
              <tr key={m.id}>
                <td>{fechaCorta(m.fecha)}</td>
                <td>{m.cuentas?.nombre}</td>
                <td>{ETIQUETA_MOVIMIENTO[m.tipo] ?? m.tipo}</td>
                <td className="num">{dinero(Number(m.monto), m.moneda)}</td>
                <td className="num">
                  {m.moneda === "USD" || m.tc_pendiente ? (
                    m.tc_compra != null ? (
                      <>
                        {Number(m.tc_compra).toFixed(3)} / {Number(m.tc_venta).toFixed(3)}
                        {m.tc_pendiente && <span className="aviso"> provisional</span>}
                        {!m.tc_pendiente && m.tc_fecha_dato && m.tc_fecha_dato !== m.fecha && (
                          <span className="suave"> (dato del {fechaCorta(m.tc_fecha_dato)})</span>
                        )}
                      </>
                    ) : (
                      <span className="aviso">pendiente</span>
                    )
                  ) : (
                    <span className="suave">—</span>
                  )}
                </td>
                <td>
                  {[m.categoria, m.origen, m.descripcion].filter(Boolean).join(" · ")}
                  {m.origen_registro === "telegram" && <span className="suave"> · Telegram</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
