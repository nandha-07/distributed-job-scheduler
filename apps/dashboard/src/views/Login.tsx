import { useState } from "react";
import { api, setToken } from "../api";

type Mode = "login" | "register";

export function Login({ onLogin }: { onLogin: () => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === "login"
          ? await api<{ token: string }>("/auth/login", {
              method: "POST",
              body: JSON.stringify({ email, password }),
            })
          : await api<{ token: string }>("/auth/register", {
              method: "POST",
              body: JSON.stringify({ name, email, password }),
            });
      setToken(res.token);
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="brand">
          <div className="brand-mark">⚙</div>
          <div className="brand-name">Job Scheduler</div>
        </div>
        <p className="login-sub">
          {mode === "login"
            ? "Sign in to monitor queues, jobs and workers."
            : "Create an account — your workspace is set up automatically."}
        </p>
        {mode === "register" && (
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
          </label>
        )}
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === "register" ? 8 : 1}
            placeholder={mode === "register" ? "At least 8 characters" : ""}
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy}>
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
        <div className="auth-switch">
          {mode === "login" ? (
            <>New here? <a onClick={() => { setMode("register"); setError(null); }}>Create an account</a></>
          ) : (
            <>Already registered? <a onClick={() => { setMode("login"); setError(null); }}>Sign in</a></>
          )}
        </div>
      </form>
    </div>
  );
}
