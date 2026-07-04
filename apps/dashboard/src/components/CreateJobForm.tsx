import { useState } from "react";
import { api } from "../api";

const HANDLERS = ["send-email", "resize-image", "send-digest", "refund", "generate-report"];

export function CreateJobForm({ queueId, onCreated }: { queueId: string; onCreated: () => void }) {
  const [name, setName] = useState(HANDLERS[0]!);
  const [payloadText, setPayloadText] = useState("{}");
  const [delay, setDelay] = useState(0);
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
      await api(`/queues/${queueId}/jobs`, {
        method: "POST",
        body: JSON.stringify({
          name,
          payload,
          ...(delay > 0 ? { delaySeconds: delay } : {}),
        }),
      });
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
        <textarea rows={4} value={payloadText} onChange={(e) => setPayloadText(e.target.value)} />
      </label>
      <label>
        Delay (seconds, 0 = run now)
        <input type="number" min={0} value={delay} onChange={(e) => setDelay(Number(e.target.value))} />
      </label>
      <label className="row">
        <input type="checkbox" style={{ width: "auto" }} checked={fail} onChange={(e) => setFail(e.target.checked)} />
        Simulate failure (exercises retries → DLQ)
      </label>
      {error && <div className="error">{error}</div>}
      <button className="primary">Create job</button>
    </form>
  );
}
