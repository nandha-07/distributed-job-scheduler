import { useState } from "react";
import { api } from "../api";
import { HANDLERS } from "../handlers";

export function CreateJobForm({ queueId, onCreated }: { queueId: string; onCreated: () => void }) {
  const [name, setName] = useState<string>(HANDLERS[0]);
  const [payloadText, setPayloadText] = useState("{}");
  const [delay, setDelay] = useState(0);
  const [count, setCount] = useState(1);
  const [dependsOn, setDependsOn] = useState("");
  const [fail, setFail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(payloadText || "{}");
    } catch {
      setError("Payload must be valid JSON");
      return;
    }
    if (fail) payload["simulateFailure"] = true;

    try {
      if (count > 1) {
        // Batch creation: one atomic transaction on the server.
        await api(`/queues/${queueId}/jobs/batch`, {
          method: "POST",
          body: JSON.stringify({
            jobs: Array.from({ length: count }, () => ({ name, payload })),
          }),
        });
      } else {
        await api(`/queues/${queueId}/jobs`, {
          method: "POST",
          body: JSON.stringify({
            name,
            payload,
            ...(delay > 0 ? { delaySeconds: delay } : {}),
            ...(dependsOn.trim() ? { dependsOn: [dependsOn.trim()] } : {}),
          }),
        });
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create job");
    }
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <label>
        Handler
        <select value={name} onChange={(e) => setName(e.target.value)}>
          {HANDLERS.map((h) => <option key={h}>{h}</option>)}
        </select>
      </label>
      <label>
        Payload (JSON)
        <textarea rows={3} value={payloadText} onChange={(e) => setPayloadText(e.target.value)} />
      </label>
      <div className="row">
        <label style={{ flex: 1 }}>
          Delay (seconds)
          <input type="number" min={0} value={delay} onChange={(e) => setDelay(Number(e.target.value))} />
        </label>
        <label style={{ flex: 1 }}>
          Copies (&gt;1 creates a batch)
          <input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Number(e.target.value))} />
        </label>
      </div>
      <label>
        Depends on job ID <span className="muted">(optional — runs only after that job completes)</span>
        <input value={dependsOn} onChange={(e) => setDependsOn(e.target.value)} placeholder="paste a job id" />
      </label>
      <label className="row">
        <input type="checkbox" style={{ width: "auto" }} checked={fail} onChange={(e) => setFail(e.target.checked)} />
        Simulate failure (exercises retries → DLQ)
      </label>
      {error && <div className="error">{error}</div>}
      <button className="primary">{count > 1 ? `Create ${count} jobs` : "Create job"}</button>
    </form>
  );
}
