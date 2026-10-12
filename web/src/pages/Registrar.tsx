import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { hoyLima } from "../format";
import { CATEGORIAS_GASTO, ORIGENES_INGRESO, type Cuenta, type Moneda } from "../types";

type Operacion = "gasto" | "ingreso" | "interes" | "transferencia";
const OPERACIONES: { id: Operacion; titulo: string }[] = [
  { id: "gasto", titulo: "Gasto" },
  { id: "ingreso", titulo: "Ingreso (agregar saldo)" },
  { id: "interes", titulo: "Interés ganado" },
  { id: "transferencia", titulo: "Transferencia / pago de tarjeta" },
];

export default function Registrar({ onGuardado }: { onGuardado: () => void }) {
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [op, setOp] = useState<Operacion>("gasto");
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  // campos del formulario
  const [cuentaId, setCuentaId] = useState("");
  const [destinoId, setDestinoId] = useState("");
  const [monto, setMonto] = useState("");
  const [montoDestino, setMontoDestino] = useState("");
  const [moneda, setMoneda] = useState<Moneda>("PEN");
  const [fecha, setFecha] = useState(hoyLima());
  const [categoria, setCategoria] = useState(CATEGORIAS_GASTO[0]);
  const [origen, setOrigen] = useState(ORIGENES_INGRESO[0]);
  const [descripcion, setDescripcion] = useState("");

  useEffect(() => {
    supabase
      .from("cuentas")
      .select("*")
      .eq("activa", true)
      .order("nombre")
      .then(({ data }) => setCuentas((data ?? []) as Cuenta[]));
  }, []);

  // Cuentas que aplican a cada operación
  const permitidas: Record<Operacion, Cuenta["tipo"][]> = {
    gasto: ["credito", "debito"],
    ingreso: ["debito", "alto_rendimiento", "broker"],
    interes: ["alto_rendimiento"],
    transferencia: ["debito", "alto_rendimiento", "broker", "credito"],
  };
  const opciones = cuentas.filter((c) => permitidas[op].includes(c.tipo));
  const origenes = cuentas.filter((c) => c.tipo !== "credito");
  const cuentaSel = cuentas.find((c) => c.id === cuentaId);
  const destinoSel = cuentas.find((c) => c.id === destinoId);
  const origenSel = cuentas.find((c) => c.id === cuentaId);
  const monedasDistintas = op === "transferencia" && origenSel && destinoSel && origenSel.moneda !== destinoSel.moneda;

  function cambiarOperacion(o: Operacion) {
    setOp(o);
    setCuentaId("");
    setDestinoId("");
    setMensaje(null);
  }

  function seleccionarCuenta(id: string) {
    setCuentaId(id);
    const c = cuentas.find((x) => x.id === id);
    if (c && op !== "gasto") setMoneda(c.moneda);
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setMensaje(null);
    const valor = Number(monto);
    if (!cuentaId || !(valor > 0)) return setMensaje({ ok: false, texto: "Completa la cuenta y un monto mayor que 0" });
    setEnviando(true);

    let error: { message: string } | null = null;
    if (op === "transferencia") {
      if (!destinoId) {
        setEnviando(false);
        return setMensaje({ ok: false, texto: "Elige la cuenta de destino" });
      }
      const dest = monedasDistintas ? Number(montoDestino) : null;
      if (monedasDistintas && !(dest! > 0)) {
        setEnviando(false);
        return setMensaje({ ok: false, texto: "Las monedas son distintas: indica cuánto llegó al destino" });
      }
      const r = await supabase.rpc("registrar_transferencia", {
        p_origen: cuentaId,
        p_destino: destinoId,
        p_monto_origen: valor,
        p_monto_destino: dest,
        p_fecha: fecha,
        p_descripcion: descripcion || null,
        p_origen_registro: "web",
      });
      error = r.error;
    } else {
      const tipo = op; // gasto | ingreso | interes
      const r = await supabase.from("movimientos").insert({
        cuenta_id: cuentaId,
        tipo,
        fecha,
        monto: valor,
        moneda: op === "gasto" ? moneda : (cuentaSel?.moneda ?? moneda),
        categoria: op === "gasto" ? categoria : null,
        origen: op === "ingreso" ? origen : null,
        descripcion: descripcion || null,
        origen_registro: "web",
      });
      error = r.error;
    }

    setEnviando(false);
    if (error) return setMensaje({ ok: false, texto: error.message });
    setMensaje({ ok: true, texto: "Guardado. El tipo de cambio SBS se asignó solo si aplica." });
    setMonto("");
    setMontoDestino("");
    setDescripcion("");
    onGuardado();
  }

  return (
    <section>
      <h2>Registrar</h2>
      <div className="segmentos">
        {OPERACIONES.map((o) => (
          <button key={o.id} type="button" className={o.id === op ? "tab activa" : "tab"} onClick={() => cambiarOperacion(o.id)}>
            {o.titulo}
          </button>
        ))}
      </div>

      <form className="tarjeta formulario" onSubmit={guardar}>
        <label>
          {op === "transferencia" ? "Cuenta de origen" : op === "gasto" ? "Tarjeta" : "Cuenta"}
          <select value={cuentaId} onChange={(e) => seleccionarCuenta(e.target.value)} required>
            <option value="">Elige…</option>
            {(op === "transferencia" ? origenes : opciones).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre} ({c.moneda})
              </option>
            ))}
          </select>
        </label>

        {op === "transferencia" && (
          <label>
            Cuenta de destino (si es una tarjeta de crédito, es un pago)
            <select value={destinoId} onChange={(e) => setDestinoId(e.target.value)} required>
              <option value="">Elige…</option>
              {opciones
                .filter((c) => c.id !== cuentaId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre} ({c.moneda})
                  </option>
                ))}
            </select>
          </label>
        )}

        <div className="fila">
          <label>
            Monto{op === "transferencia" && origenSel ? ` (${origenSel.moneda})` : ""}
            <input type="number" step="0.01" min="0" value={monto} onChange={(e) => setMonto(e.target.value)} required />
          </label>
          {op === "gasto" && (
            <label>
              Moneda
              <select value={moneda} onChange={(e) => setMoneda(e.target.value as Moneda)}>
                <option value="PEN">Soles</option>
                <option value="USD">Dólares</option>
              </select>
            </label>
          )}
          {monedasDistintas && (
            <label>
              Monto que llegó ({destinoSel!.moneda})
              <input type="number" step="0.01" min="0" value={montoDestino} onChange={(e) => setMontoDestino(e.target.value)} required />
            </label>
          )}
          <label>
            Fecha
            <input type="date" value={fecha} max={hoyLima()} onChange={(e) => setFecha(e.target.value)} required />
          </label>
        </div>

        {op === "gasto" && (
          <label>
            Categoría
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              {CATEGORIAS_GASTO.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        )}
        {op === "ingreso" && (
          <label>
            Origen
            <select value={origen} onChange={(e) => setOrigen(e.target.value)}>
              {ORIGENES_INGRESO.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        )}

        <label>
          Descripción (opcional)
          <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
        </label>

        {mensaje && <p className={mensaje.ok ? "ok" : "error"}>{mensaje.texto}</p>}
        <button className="primario" disabled={enviando}>
          {enviando ? "Guardando…" : "Guardar"}
        </button>
      </form>
    </section>
  );
}
