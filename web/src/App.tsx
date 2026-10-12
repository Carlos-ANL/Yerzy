import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import Login from "./pages/Login";
import Resumen from "./pages/Resumen";
import Registrar from "./pages/Registrar";
import Movimientos from "./pages/Movimientos";
import Cuentas from "./pages/Cuentas";

const TABS = ["Resumen", "Registrar", "Movimientos", "Cuentas"] as const;
type Tab = (typeof TABS)[number];

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [cargando, setCargando] = useState(true);
  const [tab, setTab] = useState<Tab>("Resumen");
  const [version, setVersion] = useState(0); // sube cuando se guarda algo, para refrescar las listas

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCargando(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Garantiza que exista la fila de configuración del usuario (tasa 5 %, aviso 7 pm, etc.)
  useEffect(() => {
    if (session) {
      supabase.from("configuracion").upsert({ user_id: session.user.id }, { onConflict: "user_id", ignoreDuplicates: true }).then(() => {});
    }
  }, [session]);

  if (cargando) return <div className="centro">Cargando…</div>;
  if (!session) return <Login />;

  const refrescar = () => setVersion((v) => v + 1);

  return (
    <div className="app">
      <header className="barra">
        <h1>Mis inversiones</h1>
        <nav>
          {TABS.map((t) => (
            <button key={t} className={t === tab ? "tab activa" : "tab"} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
        <button className="salir" onClick={() => supabase.auth.signOut()}>
          Salir
        </button>
      </header>
      <main>
        {tab === "Resumen" && <Resumen version={version} />}
        {tab === "Registrar" && <Registrar onGuardado={refrescar} />}
        {tab === "Movimientos" && <Movimientos version={version} />}
        {tab === "Cuentas" && <Cuentas version={version} onGuardado={refrescar} />}
      </main>
    </div>
  );
}
