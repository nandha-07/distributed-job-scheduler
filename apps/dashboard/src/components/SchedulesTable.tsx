import { useEffect, useState } from "react";
import { api } from "../api";
import type { Schedule } from "../types";

export function SchedulesTable({ queueId, tick }: { queueId: string; tick: number }) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);

  useEffect(() => {
    void api<{ schedules: Schedule[] }>(`/queues/${queueId}/schedules`).then((r) =>
      setSchedules(r.schedules),
    );
  }, [queueId, tick]);

  async function toggle(s: Schedule) {
    await api(`/schedules/${s.id}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: !s.is_active }),
    });
  }

  if (schedules.length === 0) return <p className="muted">No recurring schedules on this queue.</p>;
  return (
    <table>
      <thead>
        <tr><th>Name</th><th>Cron</th><th>Spawns</th><th>Next run</th><th>Status</th><th></th></tr>
      </thead>
      <tbody>
        {schedules.map((s) => (
          <tr key={s.id}>
            <td>{s.name}</td>
            <td><code>{s.cron_expression}</code> <span className="muted">{s.timezone}</span></td>
            <td>{s.job_name}</td>
            <td className="muted">{s.next_run_at ? new Date(s.next_run_at).toLocaleTimeString() : "—"}</td>
            <td><span className={`badge ${s.is_active ? "completed" : "cancelled"}`}>{s.is_active ? "active" : "off"}</span></td>
            <td><button onClick={() => void toggle(s)}>{s.is_active ? "Deactivate" : "Activate"}</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
