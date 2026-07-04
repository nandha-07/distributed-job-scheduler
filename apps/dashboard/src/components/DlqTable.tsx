import { useEffect, useState } from "react";
import { api } from "../api";
import type { DlqEntry, Paginated } from "../types";

export function DlqTable({ queueId, tick, onChanged }: {
  queueId: string; tick: number; onChanged: () => void;
}) {
  const [entries, setEntries] = useState<DlqEntry[]>([]);

  useEffect(() => {
    void api<Paginated<DlqEntry>>(`/queues/${queueId}/dlq`).then((r) => setEntries(r.data));
  }, [queueId, tick]);

  async function retry(entry: DlqEntry) {
    await api(`/jobs/${entry.job_id}/retry`, { method: "POST" });
    onChanged();
  }

  if (entries.length === 0) return <p className="muted">Dead letter queue is empty. 🎉</p>;
  return (
    <table>
      <thead>
        <tr><th>Job</th><th>Final error</th><th>Attempts</th><th>Dead since</th><th></th></tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.id}>
            <td>{e.job_name}</td>
            <td><code className="err">{e.final_error}</code></td>
            <td>{e.attempts_used}</td>
            <td className="muted">{new Date(e.moved_at).toLocaleString()}</td>
            <td>
              {e.retried_at
                ? <span className="muted">retried</span>
                : <button className="primary" onClick={() => void retry(e)}>Retry</button>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
