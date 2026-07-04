import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Paginated, Project, Queue, QueueStats, ThroughputPoint, Worker } from "../types";
import { StatsCards } from "../components/StatsCards";
import { ThroughputChart } from "../components/ThroughputChart";
import { JobsTable } from "../components/JobsTable";
import { DlqTable } from "../components/DlqTable";
import { SchedulesTable } from "../components/SchedulesTable";
import { CreateJobForm } from "../components/CreateJobForm";
import { QueueSettings } from "../components/QueueSettings";
import { WorkersPanel } from "../components/WorkersPanel";

type Tab = "jobs" | "dlq" | "schedules" | "create" | "settings";
const POLL_MS = 3000;

export function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [project, setProject] = useState<Project | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [queueId, setQueueId] = useState<string | null>(null);
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [throughput, setThroughput] = useState<ThroughputPoint[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [tab, setTab] = useState<Tab>("jobs");
  const [tick, setTick] = useState(0);
  const [showNewQueue, setShowNewQueue] = useState(false);
  const [newQueueName, setNewQueueName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const queue = queues.find((q) => q.id === queueId) ?? null;

  async function loadProject(): Promise<void> {
    const projects = await api<Paginated<Project>>("/projects");
    const first = projects.data[0] ?? null;
    setProject(first);
    setLoaded(true);
    if (first) {
      const qs = await api<Paginated<Queue>>(`/projects/${first.id}/queues`);
      setQueues(qs.data);
      if (qs.data[0] && !queueId) setQueueId(qs.data[0].id);
    }
  }

  useEffect(() => {
    void loadProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async () => {
    if (!project) return;
    const [qs, w] = await Promise.all([
      api<Paginated<Queue>>(`/projects/${project.id}/queues`),
      api<{ workers: Worker[] }>("/workers"),
    ]);
    setQueues(qs.data);
    setWorkers(w.workers);
    if (queueId && qs.data.some((q) => q.id === queueId)) {
      const [s, t] = await Promise.all([
        api<{ stats: QueueStats }>(`/queues/${queueId}/stats`),
        api<{ throughput: ThroughputPoint[] }>(`/queues/${queueId}/throughput`),
      ]);
      setStats(s.stats);
      setThroughput(t.throughput);
    }
    setTick((t) => t + 1);
  }, [project, queueId]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh().catch(() => {}), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const input = (e.target as HTMLFormElement).elements.namedItem("pname") as HTMLInputElement;
    try {
      await api("/projects", { method: "POST", body: JSON.stringify({ name: input.value }) });
      await loadProject();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create project");
    }
  }

  async function createQueue(e: React.FormEvent) {
    e.preventDefault();
    if (!project) return;
    setFormError(null);
    try {
      const res = await api<{ queue: Queue }>(`/projects/${project.id}/queues`, {
        method: "POST",
        body: JSON.stringify({ name: newQueueName }),
      });
      setShowNewQueue(false);
      setNewQueueName("");
      setQueueId(res.queue.id);
      await refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create queue");
    }
  }

  async function togglePause() {
    if (!queue) return;
    await api(`/queues/${queue.id}/${queue.is_paused ? "resume" : "pause"}`, { method: "POST" });
    await refresh();
  }

  // ── Empty state: brand-new account with no project yet ──
  if (loaded && !project) {
    return (
      <div className="login-wrap">
        <form className="login-card" onSubmit={createProject}>
          <div className="brand">
            <div className="brand-mark">⚙</div>
            <div className="brand-name">Job Scheduler</div>
          </div>
          <p className="login-sub">Welcome! Create your first project to get started.</p>
          <label>
            Project name
            <input name="pname" required maxLength={100} placeholder="e.g. my-app" />
          </label>
          {formError && <div className="error">{formError}</div>}
          <button className="primary">Create project</button>
          <div className="auth-switch"><a onClick={onLogout}>Log out</a></div>
        </form>
      </div>
    );
  }

  return (
    <div className="layout">
      <div className="topbar">
        <h1>
          <span className="brand-mark" style={{ width: 30, height: 30, fontSize: 15 }}>⚙</span>
          Job Scheduler
        </h1>
        <button onClick={onLogout}>Log out</button>
      </div>

      <div className="panel">
        <h2>Queues</h2>
        {queues.map((q) => (
          <div
            key={q.id}
            className={"queue-item" + (q.id === queueId ? " active" : "")}
            onClick={() => setQueueId(q.id)}
          >
            <span>{q.name}</span>
            {q.is_paused && <span className="badge scheduled">paused</span>}
          </div>
        ))}
        {showNewQueue ? (
          <form onSubmit={createQueue} style={{ display: "grid", gap: 8, marginTop: 10 }}>
            <input autoFocus value={newQueueName} onChange={(e) => setNewQueueName(e.target.value)}
              placeholder="queue name" required maxLength={100} />
            {formError && <div className="error">{formError}</div>}
            <div className="row">
              <button className="primary">Create</button>
              <button type="button" className="ghost" onClick={() => setShowNewQueue(false)}>Cancel</button>
            </div>
          </form>
        ) : (
          <button className="ghost" style={{ width: "100%", marginTop: 10 }} onClick={() => { setShowNewQueue(true); setFormError(null); }}>
            + New queue
          </button>
        )}
      </div>

      <div className="panel">
        {queue ? (
          <>
            <div className="topbar" style={{ marginBottom: 12, position: "static", background: "none", padding: 0 }}>
              <h2 style={{ margin: 0 }}>
                {queue.name} <span className="muted">(concurrency {queue.max_concurrency})</span>
              </h2>
              <button onClick={() => void togglePause()}>
                {queue.is_paused ? "▶ Resume" : "⏸ Pause"}
              </button>
            </div>
            {stats && <StatsCards stats={stats} />}
            <ThroughputChart points={throughput} />
            <div className="tabs">
              {(["jobs", "dlq", "schedules", "create", "settings"] as Tab[]).map((t) => (
                <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                  {t === "dlq" ? "Dead letters" : t === "create" ? "+ New job" : t === "settings" ? "⚙ Settings" : t[0]!.toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            {tab === "jobs" && <JobsTable queueId={queue.id} tick={tick} />}
            {tab === "dlq" && <DlqTable queueId={queue.id} tick={tick} onChanged={() => void refresh()} />}
            {tab === "schedules" && <SchedulesTable queueId={queue.id} tick={tick} />}
            {tab === "create" && <CreateJobForm queueId={queue.id} onCreated={() => { setTab("jobs"); void refresh(); }} />}
            {tab === "settings" && (
              <QueueSettings
                queue={queue}
                onSaved={() => void refresh()}
                onDeleted={() => {
                  setQueueId(null);
                  setTab("jobs");
                  void refresh();
                }}
              />
            )}
          </>
        ) : (
          <p className="muted">No queue selected — create one with “+ New queue” on the left.</p>
        )}
      </div>

      <WorkersPanel workers={workers} />
    </div>
  );
}
