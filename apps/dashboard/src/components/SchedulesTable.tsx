import { useEffect, useState } from "react";
import { api } from "../api";
import type { Schedule } from "../types";
import { HANDLERS } from "../handlers";

const CRON_EXAMPLES = [
  { expr: "* * * * *", label: "every minute" },
  { expr: "*/5 * * * *", label: "every 5 minutes" },
  { expr: "0 * * * *", label: "hourly" },
  { expr: "0 9 * * 1-5", label: "weekdays 09:00" },
  { expr: "0 0 * * *", label: "daily midnight" },
];

export function SchedulesTable({ queueId, tick }: { queueId: string; tick: number }) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [cron, setCron] = useState("*/5 * * * *");
  const [timezone, setTimezone] = useState("UTC");
  const [jobName, setJobName] = useState<string>(HANDLERS[0]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ schedules: Schedule[] }>(`/queues/${queueId}/schedules`).then((r) =>
      setSchedules(r.schedules),
    );
  }, [queueId, tick]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api(`/queues/${queueId}/schedules`, {
        method: "POST",
        body: JSON.stringify({ name, cronExpression: cron, timezone, jobName }),
      });
      setShowForm(false);
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create schedule");
    }
  }

  async function toggle(s: Schedule) {
    await api(`/schedules/${s.id}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: !s.is_active }),
    });
  }

  async function remove(s: Schedule) {
    if (!window.confirm(`Delete schedule "${s.name}"? Already-spawned jobs are kept.`)) return;
    await api(`/schedules/${s.id}`, { method: "DELETE" });
    setSchedules((prev) => prev.filter((x) => x.id !== s.id));
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "+ New schedule"}
        </button>
      </div>

      {showForm && (
        <form className="form-grid detail" onSubmit={create}>
          <label>
            Schedule name
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} placeholder="e.g. nightly-report" />
          </label>
          <label>
            Cron expression <span className="muted">(minute hour day month weekday)</span>
            <input value={cron} onChange={(e) => setCron(e.target.value)} required />
          </label>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {CRON_EXAMPLES.map((c) => (
              <button type="button" key={c.expr} className="ghost chip" onClick={() => setCron(c.expr)}>
                <code>{c.expr}</code> {c.label}
              </button>
            ))}
          </div>
          <label>
            Timezone
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {["UTC", "Asia/Kolkata", "America/New_York", "Europe/London", "Asia/Tokyo"].map((tz) => (
                <option key={tz}>{tz}</option>
              ))}
            </select>
          </label>
          <label>
            Job to spawn
            <select value={jobName} onChange={(e) => setJobName(e.target.value)}>
              {HANDLERS.map((h) => <option key={h}>{h}</option>)}
            </select>
          </label>
          {error && <div className="error">{error}</div>}
          <button className="primary">Create schedule</button>
        </form>
      )}

      {schedules.length === 0 && !showForm ? (
        <p className="muted">No recurring schedules on this queue yet.</p>
      ) : schedules.length > 0 && (
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
                <td className="row">
                  <button onClick={() => void toggle(s)}>{s.is_active ? "Deactivate" : "Activate"}</button>
                  <button className="danger" onClick={() => void remove(s)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
