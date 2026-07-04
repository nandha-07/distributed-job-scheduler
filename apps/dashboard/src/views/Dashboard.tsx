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
  const [queues, setQueues] = useState<Queue[]>([]);
  const [queueId, setQueueId] = useState<string | null>(null);
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [throughput, setThroughput] = useState<ThroughputPoint[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [tab, setTab] = useState<Tab>("jobs");
  const [tick, setTick] = useState(0); // children re-fetch when this changes

  const queue = queues.find((q) => q.id === queueId) ?? null;

  // Initial load: first project -> its queues -> select first queue.
  useEffect(() => {
    void (async () => {
      const projects = await api<Paginated<Project>>("/projects");
      const first = projects.data[0];
      if (!first) return;
      setProject(first);
      const qs = await api<Paginated<Queue>>(`/projects/${first.id}/queues`);
      setQueues(qs.data);
      if (qs.data[0]) setQueueId(qs.data[0].id);
    })();
  }, []);

  // Poll loop: refresh queue list, stats, workers, and bump children.
  const refresh = useCallback(async () => {
    if (!project) return;
    const [qs, w] = await Promise.all([
      api<Paginated<Queue>>(`/projects/${project.id}/queues`),
      api<{ workers: Worker[] }>("/workers"),
    ]);
    setQueues(qs.data);
    setWorkers(w.workers);
    if (queueId) {
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

  async function togglePause() {
    if (!queue) return;
    await api(`/queues/${queue.id}/${queue.is_paused ? "resume" : "pause"}`, { method: "POST" });
    await refresh();
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
      </div>

      <div className="panel">
        {queue ? (
          <>
            <div className="topbar" style={{ marginBottom: 12 }}>
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
            {tab === "settings" && <QueueSettings queue={queue} onSaved={() => void refresh()} />}
          </>
        ) : (
          <p className="muted">No queue selected.</p>
        )}
      </div>

      <WorkersPanel workers={workers} />
    </div>
  );
}
