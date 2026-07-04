import type { QueueStats } from "../types";

const ORDER = ["queued", "scheduled", "running", "completed", "failed", "dead_letter", "cancelled"];

export function StatsCards({ stats }: { stats: QueueStats }) {
  return (
    <div className="stat-grid">
      {ORDER.filter((s) => stats.byState[s] !== undefined).map((s) => (
        <div className="stat" key={s}>
          <div className="n">{stats.byState[s]}</div>
          <div className="l">{s.replace("_", " ")}</div>
        </div>
      ))}
      <div className="stat">
        <div className="n">{stats.completedLastHour}</div>
        <div className="l">done / hour</div>
      </div>
      <div className="stat">
        <div className="n">{stats.failedLastHour}</div>
        <div className="l">failed / hour</div>
      </div>
    </div>
  );
}
