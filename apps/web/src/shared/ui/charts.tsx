import type { ActivityDay, Performance } from '@ipc/contracts';

/* Charts are inline SVG and plain divs — no chart library.
   Series colours come from the validated token set (--s1/--s2/--s3).
   Every chart carries a legend and direct labels: the amber series runs
   under 3:1 against white, so colour alone is never the encoding. */

const SERIES = {
  courses: 'var(--s1)',
  workshops: 'var(--s2)',
  library: 'var(--s3)',
} as const;

export function ProgressRing({
  value,
  size = 28,
  color = 'var(--s1)',
}: {
  value: number;
  size?: number;
  color?: string;
}) {
  const r = 11;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(100, value)) / 100;
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" role="img" aria-label={`${value} percent complete`}>
      <circle cx="14" cy="14" r={r} fill="none" stroke="var(--track)" strokeWidth="5" />
      {value > 0 && (
        <circle
          cx="14"
          cy="14"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${(c * filled).toFixed(1)} ${(c * (1 - filled)).toFixed(1)}`}
          transform="rotate(-90 14 14)"
        />
      )}
    </svg>
  );
}

/** The grouped pill-bar chart from the design: one group per weekday. */
export function ActivityChart({ days }: { days: ActivityDay[] }) {
  const max = Math.max(1, ...days.flatMap((d) => [d.courses, d.workshops, d.library]));
  const PLOT = 168;
  const px = (minutes: number) => Math.max(6, Math.round((minutes / max) * PLOT));
  const labels: Record<ActivityDay['day'], string> = {
    mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
  };

  return (
    <>
      <div className="legend">
        <span className="legend-item"><span className="swatch" style={{ background: SERIES.courses }} />Courses</span>
        <span className="legend-item"><span className="swatch" style={{ background: SERIES.workshops }} />Workshops</span>
        <span className="legend-item"><span className="swatch" style={{ background: SERIES.library }} />Library</span>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div className="axis" style={{ height: PLOT + 24 }}>
          <span>8h</span><span>6h</span><span>4h</span><span>2h</span><span>0h</span>
        </div>
        <div className="bars">
          {days.map((d) => (
            <div className="bar-group" key={d.day}>
              <div className="bar-stack" style={{ height: PLOT }}>
                <div className="bar" style={{ height: px(d.courses), background: SERIES.courses }} title={`Courses ${d.courses}m`} />
                <div className="bar" style={{ height: px(d.workshops), background: SERIES.workshops }} title={`Workshops ${d.workshops}m`} />
                <div className="bar" style={{ height: px(d.library), background: SERIES.library }} title={`Library ${d.library}m`} />
              </div>
              <span style={{ fontSize: 10 }} className="dim">{labels[d.day]}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/** Semicircular gauge with the score in the middle, as in the design. */
export function ScoreGauge({ performance, width = 160 }: { performance: Performance; width?: number }) {
  const arc = 'M22 84 A58 58 0 0 1 138 84';
  const len = Math.PI * 58;
  const seg = (pct: number) => (pct / 100) * len;
  const { participation, quiz, exam } = performance.breakdown;

  return (
    <svg
      width={width}
      height={(width / 160) * 96}
      viewBox="0 0 160 96"
      role="img"
      aria-label={`Total score ${performance.totalScore} percent: participation ${participation}, quiz ${quiz}, exam ${exam}`}
    >
      <path d={arc} fill="none" stroke="var(--track)" strokeWidth="17" strokeLinecap="round" />
      <path d={arc} fill="none" stroke="var(--s1)" strokeWidth="17" strokeLinecap="round"
        strokeDasharray={`${seg(participation)} ${len}`} />
      <path d={arc} fill="none" stroke="var(--s2)" strokeWidth="17"
        strokeDasharray={`${seg(quiz)} ${len}`} strokeDashoffset={-seg(participation) - 3} />
      <path d={arc} fill="none" stroke="var(--s3)" strokeWidth="17" strokeLinecap="round"
        strokeDasharray={`${seg(exam)} ${len}`} strokeDashoffset={-seg(participation + quiz) - 6} />
      <text x="80" y="66" textAnchor="middle" fontSize="10" fill="var(--ink-3)">Total Score</text>
      <text x="80" y="86" textAnchor="middle" fontSize="24" fontWeight="600" fill="var(--ink)">
        {performance.totalScore}%
      </text>
    </svg>
  );
}

/** Pink trend line with a soft area fill. */
export function TrendLine({
  points,
  width = 318,
  height = 86,
}: {
  points: { label: string; value: number }[];
  width?: number;
  height?: number;
}) {
  if (points.length === 0) return null;
  const pad = 8;
  const step = (width - pad * 2) / Math.max(1, points.length - 1);
  const y = (v: number) => height - pad - (v / 100) * (height - pad * 2);
  const coords = points.map((p, i) => ({ x: pad + i * step, y: y(p.value), ...p }));
  const line = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const area = `M${coords[0]!.x} ${coords[0]!.y} ${coords
    .slice(1)
    .map((c) => `L${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(' ')} L${coords.at(-1)!.x} ${height} L${coords[0]!.x} ${height} Z`;
  const last = coords.at(-1)!;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Score trend from ${points[0]!.label} to ${last.label}, ${points[0]!.value} to ${last.value} percent`}
      >
        <path d={area} fill="#fcebf2" />
        <polyline points={line} fill="none" stroke="var(--s1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {coords.map((c, i) =>
          i === coords.length - 1 ? (
            <circle key={c.label} cx={c.x} cy={c.y} r="4.5" fill="#fff" stroke="var(--s1)" strokeWidth="2.5" />
          ) : (
            <circle key={c.label} cx={c.x} cy={c.y} r="3.5" fill="var(--s1)" />
          ),
        )}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 2px' }}>
        {points.map((p) => (
          <span key={p.label} style={{ fontSize: 9 }} className="dim">{p.label}</span>
        ))}
      </div>
    </div>
  );
}
