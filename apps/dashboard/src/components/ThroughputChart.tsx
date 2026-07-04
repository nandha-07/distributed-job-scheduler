import type { ThroughputPoint } from "../types";

const MINUTES = 30;

/**
 * Pure-SVG throughput chart: one bar per minute for the last 30 minutes,
 * completed (green) stacked under failed (red). No chart library — full
 * control, zero dependencies, ~1 KB.
 */
export function ThroughputChart({ points }: { points: ThroughputPoint[] }) {
  // Build a dense 30-minute window (API only returns non-empty minutes).
  const byMinute = new Map(points.map((p) => [p.minute.slice(0, 16), p]));
  const now = Date.now();
  const buckets = Array.from({ length: MINUTES }, (_, i) => {
    const d = new Date(now - (MINUTES - 1 - i) * 60_000);
    const key = d.toISOString().slice(0, 16);
    const p = byMinute.get(key);
    return {
      label: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      completed: p?.completed ?? 0,
      failed: p?.failed ?? 0,
    };
  });

  const max = Math.max(1, ...buckets.map((b) => b.completed + b.failed));
  const W = 600, H = 110, PAD = 2;
  const bw = W / MINUTES - PAD;

  return (
    <div className="chart-card">
      <div className="chart-head">
        <span>Throughput — last 30 min</span>
        <span className="chart-legend">
          <i className="dot dot-green" /> completed
          <i className="dot dot-red" /> failed
          <span className="muted">peak {max}/min</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" preserveAspectRatio="none">
        {buckets.map((b, i) => {
          const total = b.completed + b.failed;
          const x = i * (bw + PAD);
          const hDone = (b.completed / max) * (H - 4);
          const hFail = (b.failed / max) * (H - 4);
          return (
            <g key={i}>
              <title>{`${b.label} — ${b.completed} completed, ${b.failed} failed`}</title>
              {/* faint track so empty minutes are still visible */}
              <rect x={x} y={0} width={bw} height={H} fill="rgba(255,255,255,0.02)" />
              {total > 0 && (
                <>
                  <rect x={x} y={H - hDone} width={bw} height={hDone} rx={1.5} fill="#34d399" />
                  {b.failed > 0 && (
                    <rect x={x} y={H - hDone - hFail} width={bw} height={hFail} rx={1.5} fill="#f87171" />
                  )}
                </>
              )}
            </g>
          );
        })}
      </svg>
      <div className="chart-axis">
        <span>{buckets[0]!.label}</span>
        <span>{buckets[MINUTES - 1]!.label}</span>
      </div>
    </div>
  );
}
