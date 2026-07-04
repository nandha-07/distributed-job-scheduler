import type { Worker } from "../types";

function heartbeatAge(iso: string): string {
  const sec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  return sec < 60 ? `${sec}s ago` : `${Math.round(sec / 60)}m ago`;
}

export function WorkersPanel({ workers }: { workers: Worker[] }) {
  const live = workers.filter((w) => w.state === "online" || w.state === "draining");
  const rest = workers.filter((w) => !live.includes(w)).slice(0, 5);
  return (
    <div className="panel">
      <h2>Workers ({live.length} online)</h2>
      {[...live, ...rest].map((w) => (
        <div className="worker" key={w.id}>
          <div className="nm">{w.name}</div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className={`badge ${w.state}`}>{w.state}</span>
            <span className="muted">♥ {heartbeatAge(w.last_heartbeat_at)}</span>
          </div>
        </div>
      ))}
      {workers.length === 0 && <p className="muted">No workers registered yet.</p>}
    </div>
  );
}
