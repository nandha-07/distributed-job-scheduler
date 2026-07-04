import { useEffect, useState } from "react";
import { api } from "../api";
import type { Job, JobExecution, JobLog, Paginated } from "../types";

const STATES = ["", "queued", "scheduled", "running", "completed", "failed", "dead_letter", "cancelled"];

export function JobsTable({ queueId, tick }: { queueId: string; tick: number }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ executions: JobExecution[]; logs: JobLog[] } | null>(null);

  useEffect(() => {
    const qs = state ? `?state=${state}&limit=25` : "?limit=25";
    void api<Paginated<Job>>(`/queues/${queueId}/jobs${qs}`).then((r) => {
      setJobs(r.data);
      setTotal(r.pagination.total);
    });
  }, [queueId, state, tick]);

  async function open(job: Job) {
    if (openId === job.id) {
      setOpenId(null);
      return;
    }
    setOpenId(job.id);
    const d = await api<{ executions: JobExecution[]; logs: JobLog[] }>(`/jobs/${job.id}`);
    setDetail({ executions: d.executions, logs: d.logs });
  }

  async function cancel(job: Job, e: React.MouseEvent) {
    e.stopPropagation();
    await api(`/jobs/${job.id}/cancel`, { method: "POST" });
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <select value={state} onChange={(e) => setState(e.target.value)} style={{ width: 180 }}>
          {STATES.map((s) => (
            <option key={s} value={s}>{s === "" ? "All states" : s}</option>
          ))}
        </select>
        <span className="muted">{total} job(s)</span>
      </div>
      <table>
        <thead>
          <tr><th>Name</th><th>State</th><th>Attempts</th><th>Run at</th><th></th></tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <JobRow key={j.id} job={j} open={openId === j.id} detail={detail}
              onClick={() => void open(j)} onCancel={(e) => void cancel(j, e)} />
          ))}
        </tbody>
      </table>
    </>
  );
}

function JobRow({ job, open, detail, onClick, onCancel }: {
  job: Job; open: boolean;
  detail: { executions: JobExecution[]; logs: JobLog[] } | null;
  onClick: () => void; onCancel: (e: React.MouseEvent) => void;
}) {
  const cancellable = job.state === "queued" || job.state === "scheduled";
  return (
    <>
      <tr className="clickable" onClick={onClick}>
        <td>{job.name}</td>
        <td><span className={`badge ${job.state}`}>{job.state}</span></td>
        <td>{job.attempts}/{job.max_attempts}</td>
        <td className="muted">{new Date(job.run_at).toLocaleTimeString()}</td>
        <td>{cancellable && <button className="danger" onClick={onCancel}>Cancel</button>}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5}>
            <div className="detail">
              {job.last_error && <code className="err">{job.last_error}</code>}
              <h3>Executions</h3>
              {detail?.executions.map((e) => (
                <div key={e.id} className="log">
                  #{e.attempt} — <span className={`badge ${e.state === "succeeded" ? "completed" : "failed"}`}>{e.state}</span>
                  {" "}{e.duration_ms != null ? `${e.duration_ms}ms` : ""} {e.error_message ?? ""}
                </div>
              )) ?? <span className="muted">loading…</span>}
              <h3>Logs</h3>
              {detail?.logs.slice(0, 20).map((l) => (
                <div key={l.id} className="log">[{l.level}] {l.message}</div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
