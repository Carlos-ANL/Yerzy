import { useState } from "react";
import { supabase } from "../supabase";

// Solo inicio de sesión. El registro público se desactiva en Supabase
// (Authentication > Sign In / Providers > "Allow new users to sign up" = apagado).
export default function Login() {
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password: clave });
    if (error) setError("Correo o contraseña incorrectos");
    setEnviando(false);
  }

  return (
    <div className="centro">
      <form className="tarjeta login" onSubmit={entrar}>
        <h1>Mis inversiones</h1>
        <label>
          Correo
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label>
          Contraseña
          <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primario" disabled={enviando}>
          {enviando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
