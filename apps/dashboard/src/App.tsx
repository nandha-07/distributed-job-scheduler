import { useState } from "react";
import { hasToken, setToken } from "./api";
import { Login } from "./views/Login";
import { Dashboard } from "./views/Dashboard";

export function App() {
  const [authed, setAuthed] = useState(hasToken());

  if (!authed) return <Login onLogin={() => setAuthed(true)} />;
  return (
    <Dashboard
      onLogout={() => {
        setToken(null);
        setAuthed(false);
      }}
    />
  );
}
