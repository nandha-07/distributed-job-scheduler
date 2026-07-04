import { useEffect, useState } from "react";
import { api } from "../api";
import type { Queue } from "../types";

/** Queue configuration editor: PATCHes only the fields the user changed. */
export function QueueSettings({ queue, onSaved }: { queue: Queue; onSaved: () => void }) {
  const [maxConcurrency, setMaxConcurrency] = useState(queue.max_concurrency);
  const [priority, setPriority] = useState(queue.priority);
  const [rateLimit, setRateLimit] = useState<string>(
    queue.rate_limit_per_sec != null ? String(queue.rate_limit_per_sec) : "",
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-sync when the user switches queues.
  useEffect(() => {
    setMaxConcurrency(queue.max_concurrency);
    setPriority(queue.priority);
    setRateLimit(queue.rate_limit_per_sec != null ? String(queue.rate_limit_per_sec) : "");
    setMsg(null);
    setError(null);
  }, [queue.id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    const body: Record<string, unknown> = {};
    if (maxConcurrency !== queue.max_concurrency) body["maxConcurrency"] = maxConcurrency;
    if (priority !== queue.priority) body["priority"] = priority;
    const rl = rateLimit === "" ? null : Number(rateLimit);
    if (rl !== null && rl !== queue.rate_limit_per_sec) body["rateLimitPerSec"] = rl;
    if (Object.keys(body).length === 0) {
      setMsg("Nothing changed.");
      return;
    }
    try {
      await api(`/queues/${queue.id}`, { method: "PATCH", body: JSON.stringify(body) });
      setMsg("Saved ✓");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    }
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <label>
        Max concurrency (jobs in flight across all workers)
        <input type="number" min={1} max={1000} value={maxConcurrency}
          onChange={(e) => setMaxConcurrency(Number(e.target.value))} />
      </label>
      <label>
        Queue priority (higher = claimed first)
        <input type="number" min={-100} max={100} value={priority}
          onChange={(e) => setPriority(Number(e.target.value))} />
      </label>
      <label>
        Rate limit (claims/second — leave empty for unlimited)
        <input type="number" min={1} max={10000} value={rateLimit}
          onChange={(e) => setRateLimit(e.target.value)} placeholder="unlimited" />
      </label>
      <div className="row">
        <button className="primary">Save settings</button>
        {msg && <span className="muted">{msg}</span>}
      </div>
      {error && <div className="error">{error}</div>}
      <p className="muted">
        Changing settings requires the admin role. Retry policy defaults are
        managed via the API (retry policies are project-level resources).
      </p>
    </form>
  );
}
