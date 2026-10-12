import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { dinero, hoyLima } from "../format";
import { ETIQUETA_TIPO_CUENTA, type Cuenta, type Moneda, type TipoCuenta } from "../types";

export default function Cuentas({ version, onGuardado }: { version: number; onGuardado: () => void }) {
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);

  // formulario de cuenta nueva
  const [tipo, setTipo] = useState<TipoCuenta>("debito");
  const [nombre, setNombre] = useState("");
  const [banco, setBanco] = useState("");
  const [moneda, setMoneda] = useState<Moneda>("PEN");
  const [corte, setCorte] = useState("10");
  const [pago, setPago] = useState("5");
  const [linea, setLinea] = useState("");
  const [saldoInicial, setSaldoInicial] = useState("0");
  const [fechaSaldo, setFechaSaldo] = useState(hoyLima());

  // formulario de tasa (alto rendimiento)
  const [tasaCuenta, setTasaCuenta] = useState("");
  const [tasaPct, setTasaPct] = useState("");
  const [tasaDesde, setTasaDesde] = useState(hoyLima());

  useEffect(() => {
    supabase
      .from("cuentas")
      .select("*")
      .order("tipo")
      .order("nombre")
      .then(({ data }) => setCuentas((data ?? []) as Cuenta[]));
  }, [version]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setMensaje(null);
    const esCredito = tipo === "credito";
    const { error } = await supabase.from("cuentas").insert({
      tipo,
      nombre,
      banco: banco || null,
      moneda,
      dia_corte: esCredito ? Number(corte) : null,
      dia_pago: esCredito ? Number(pago) : null,
      linea_credito: esCredito && linea ? Number(linea) : null,
      // En tarjetas de crédito el saldo inicial es la deuda: va en negativo
      saldo_inicial: esCredito ? -Math.abs(Number(saldoInicial) || 0) : Number(saldoInicial) || 0,
      fecha_saldo_inicial: fechaSaldo,
    });
    if (error) return setMensaje({ ok: false, texto: error.message });
    setMensaje({ ok: true, texto: "Cuenta creada" });
    setNombre("");
    setBanco("");
    setSaldoInicial("0");
    onGuardado();
  }

  async function guardarTasa(e: React.FormEvent) {
    e.preventDefault();
    setMensaje(null);
    const tea = Number(tasaPct) / 100;
    if (!tasaCuenta || !(tea > 0)) return setMensaje({ ok: false, texto: "Elige la cuenta e ingresa la tasa (%)" });
    const { error } = await supabase.from("tasas_cuenta").upsert(
      { cuenta_id: tasaCuenta, vigente_desde: tasaDesde, tea },
      { onConflict: "cuenta_id,vigente_desde" },
    );
    if (error) return setMensaje({ ok: false, texto: error.message });
    setMensaje({ ok: true, texto: "Tasa guardada en el historial" });
    setTasaPct("");
  }

  const altoRend = cuentas.filter((c) => c.tipo === "alto_rendimiento");

  return (
    <>
      <section>
        <h2>Mis cuentas</h2>
        {cuentas.length === 0 && <p className="suave">Crea tu primera cuenta abajo.</p>}
        <ul className="lista">
          {cuentas.map((c) => (
            <li key={c.id}>
              <span>
                {c.nombre} <span className="suave">· {ETIQUETA_TIPO_CUENTA[c.tipo]} · {c.moneda}</span>
                {c.tipo === "credito" && (
                  <span className="suave">
                    {" "}
                    · corte {c.dia_corte}, pago {c.dia_pago}
                  </span>
                )}
              </span>
              <span className="suave">saldo inicial {dinero(Number(c.saldo_inicial), c.moneda)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Agregar cuenta o tarjeta</h2>
        <form className="tarjeta formulario" onSubmit={crear}>
          <div className="fila">
            <label>
              Tipo
              <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoCuenta)}>
                {(Object.keys(ETIQUETA_TIPO_CUENTA) as TipoCuenta[]).map((t) => (
                  <option key={t} value={t}>
                    {ETIQUETA_TIPO_CUENTA[t]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Moneda
              <select value={moneda} onChange={(e) => setMoneda(e.target.value as Moneda)}>
                <option value="PEN">Soles</option>
                <option value="USD">Dólares</option>
              </select>
            </label>
          </div>
          <div className="fila">
            <label>
              Nombre
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} required />
            </label>
            <label>
              Banco o broker
              <input value={banco} onChange={(e) => setBanco(e.target.value)} />
            </label>
          </div>
          {tipo === "credito" && (
            <div className="fila">
              <label>
                Día de corte
                <input type="number" min="1" max="31" value={corte} onChange={(e) => setCorte(e.target.value)} required />
              </label>
              <label>
                Día de pago
                <input type="number" min="1" max="31" value={pago} onChange={(e) => setPago(e.target.value)} required />
              </label>
              <label>
                Línea de crédito
                <input type="number" step="0.01" min="0" value={linea} onChange={(e) => setLinea(e.target.value)} />
              </label>
            </div>
          )}
          <div className="fila">
            <label>
              {tipo === "credito" ? "Deuda inicial" : "Saldo inicial"}
              <input type="number" step="0.01" min="0" value={saldoInicial} onChange={(e) => setSaldoInicial(e.target.value)} />
            </label>
            <label>
              Al día
              <input type="date" value={fechaSaldo} onChange={(e) => setFechaSaldo(e.target.value)} required />
            </label>
          </div>
          {mensaje && <p className={mensaje.ok ? "ok" : "error"}>{mensaje.texto}</p>}
          <button className="primario">Crear</button>
        </form>
      </section>

      {altoRend.length > 0 && (
        <section>
          <h2>Tasa de cuenta de alto rendimiento</h2>
          <p className="suave">La tasa cambia: cada vez que varíe, guarda la nueva con su fecha para conservar el historial.</p>
          <form className="tarjeta formulario" onSubmit={guardarTasa}>
            <div className="fila">
              <label>
                Cuenta
                <select value={tasaCuenta} onChange={(e) => setTasaCuenta(e.target.value)} required>
                  <option value="">Elige…</option>
                  {altoRend.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                TEA (%)
                <input type="number" step="0.01" min="0" value={tasaPct} onChange={(e) => setTasaPct(e.target.value)} required />
              </label>
              <label>
                Vigente desde
                <input type="date" value={tasaDesde} onChange={(e) => setTasaDesde(e.target.value)} required />
              </label>
            </div>
            <button className="primario">Guardar tasa</button>
          </form>
        </section>
      )}
    </>
  );
}
