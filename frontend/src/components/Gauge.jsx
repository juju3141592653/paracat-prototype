import {fmtLevel, fmtPct, fmtRain} from '../lib/format.js';

const H = 270;
const TOP = 16;
const BOTTOM = H - 18;

function niceStep(max, ticks = 8) {
  const raw = max / ticks;
  return [10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => s >= raw) ?? 1000;
}

/**
 * A river staff gauge: the black-and-white graduated post you see on a riverbank,
 * with this location's trigger tiers marked like flood alert levels.
 */
export function StaffGauge({tiers, levelCm, paidBps, stale}) {
  // Zoom the staff onto the range that matters, like a real gauge board mounted near alert level.
  const lo = Number(tiers[0].riverLevelCm) * 0.55;
  const hi = Number(tiers[tiers.length - 1].riverLevelCm) * 1.15;
  const step = niceStep(hi - lo);
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const y = (v) => BOTTOM - ((Math.min(Math.max(Number(v), min), max) - min) / (max - min)) * (BOTTOM - TOP);
  const marks = [];
  for (let v = min; v <= max; v += step) marks.push(v);
  const level = levelCm == null ? null : Number(levelCm);
  const waterY = level == null ? BOTTOM : y(level);
  const labelEvery = marks.length > 9 ? 2 : 1;

  return (
    <svg className="staff" viewBox={`0 0 236 ${H}`} role="img"
      aria-label={level == null ? 'No river reading yet' : `River level ${fmtLevel(level)}`}>
      <rect className="staff-water" x="58" y={waterY} width="94" height={BOTTOM - waterY}
        style={{opacity: stale ? 0.35 : 1}} />
      <line className="staff-bed" x1="30" x2="158" y1={BOTTOM} y2={BOTTOM} />
      <rect className="staff-post" x="60" y={TOP - 4} width="26" height={BOTTOM - TOP + 4} />
      {marks.slice(0, -1).map((v) => (
        <rect key={v} className="staff-block" x={(v / step) % 2 ? 73 : 60} y={y(v + step)} width="13" height={y(v) - y(v + step)} />
      ))}
      {marks.map((v, i) => (i % labelEvery === 0) && v !== min && (
        <text key={`t${v}`} className="staff-num" x="54" y={y(v) + 4} textAnchor="end">
          {step >= 100 ? v / 100 : (v / 100).toFixed(1)}
        </text>
      ))}
      {tiers.map((t, i) => {
        const ty = y(t.riverLevelCm);
        const paid = Number(paidBps) >= Number(t.payoutBps);
        // Higher tiers label above their line, lower tiers below, so close thresholds never collide.
        const top = i === tiers.length - 1;
        return (
          <g key={i} className={`staff-tier tier-${i + 1}${paid ? ' is-paid' : ''}`}>
            <line x1="26" x2="152" y1={ty} y2={ty} />
            <text x="156" y={top ? ty - 16 : ty + 4}>Tier {i + 1}</text>
            <text x="156" y={top ? ty - 4 : ty + 16} className="staff-tier-sub">{fmtPct(t.payoutBps, 0)} of limit</text>
          </g>
        );
      })}
      {level != null && (
        <g className="staff-reading">
          <line x1="86" x2="152" y1={waterY} y2={waterY} />
          {/* An opaque chip on the water surface, so tier lines never cut through the reading. */}
          <rect x="92" y={waterY - 10} width="58" height="20" rx="3" />
          <text x="121" y={waterY + 4} textAnchor="middle">{fmtLevel(level)}</text>
        </g>
      )}
    </svg>
  );
}

/** 24-hour rainfall against the tier thresholds. */
export function RainBar({tiers, rainMmX10}) {
  const max = Number(tiers[tiers.length - 1].rainfallMmX10) * 1.3;
  const pct = (v) => `${Math.min(100, (Number(v) / max) * 100)}%`;
  const rain = rainMmX10 == null ? null : Number(rainMmX10);
  return (
    <div className="rainbar" role="img" aria-label={rain == null ? 'No rainfall reading' : `24-hour rainfall ${fmtRain(rain)}`}>
      <div className="rainbar-track">
        {rain != null && <div className="rainbar-fill" style={{width: pct(rain)}} />}
        {tiers.map((t, i) => (
          <span key={i} className={`rainbar-tick tier-${i + 1}`} style={{left: pct(t.rainfallMmX10)}}
            title={`Tier ${i + 1}: ${fmtRain(t.rainfallMmX10)}`} />
        ))}
      </div>
      <div className="rainbar-legend">
        <span>{rain == null ? 'Rainfall: no data' : `Rainfall ${fmtRain(rain)} / 24h`}</span>
        <span>T1 {Number(tiers[0].rainfallMmX10) / 10}, T2 {Number(tiers[tiers.length - 1].rainfallMmX10) / 10} mm</span>
      </div>
    </div>
  );
}
