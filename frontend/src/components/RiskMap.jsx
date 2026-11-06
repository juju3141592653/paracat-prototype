import {useData} from '../state/data.jsx';
import {useNow, chainNow} from '../lib/useNow.js';
import {fmtCompact} from '../lib/format.js';
import {locationStatus} from '../lib/status.js';
import {BORDERS, GRATICULE, LAND, MAP_H, MAP_W, POINTS} from '../lib/seaMap.js';

const KEYS = {'Metro Manila': 'manila', 'Ho Chi Minh City': 'hcmc', Jakarta: 'jakarta'};
const FALLBACK = ['manila', 'hcmc', 'jakarta'];
const LEFT = new Set(['hcmc', 'singapore']);

function Label({x, y, side, title, sub}) {
  const dx = side === 'left' ? -20 : 20;
  const anchor = side === 'left' ? 'end' : 'start';
  return (
    <g>
      <text x={x + dx} y={y - 2} textAnchor={anchor} className="map-text">{title}</text>
      <text x={x + dx} y={y + 26} textAnchor={anchor} className="map-text map-text-sub">{sub}</text>
    </g>
  );
}

/** Exposure map: covered cities, coloured by live trigger status, and the collateral vault. */
export function RiskMap() {
  const data = useData();
  const now = chainNow(data, useNow(1000));
  const vault = POINTS.singapore;
  const cities = data.locations.map((l, i) => {
    const key = KEYS[l.location.name] ?? FALLBACK[i % 3];
    const status = locationStatus(l, data.stations[l.location.stationId], data.oracle.quorum, now);
    return {l, key, pt: POINTS[key], status};
  });

  return (
    <div className="map">
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Exposure map">
        <path d={GRATICULE} className="map-grid" />
        <path d={LAND} className="map-land" />
        <path d={BORDERS} className="map-border" />
        {cities.map((c) => (
          <line key={`r${c.key}`} x1={vault[0]} y1={vault[1]} x2={c.pt[0]} y2={c.pt[1]} className="map-route" />
        ))}
        <g className="map-vault"><rect x={vault[0] - 7} y={vault[1] - 7} width="14" height="14" /></g>
        <Label x={vault[0]} y={vault[1]} side="left" title="Collateral vault" sub="Singapore" />
        {cities.map((c) => (
          <g key={c.key} className={`map-city tone-${c.status.tone}`}>
            {(c.status.tone === 'alert' || c.status.tone === 'warn') && <circle cx={c.pt[0]} cy={c.pt[1]} r="19" className="halo" />}
            <circle cx={c.pt[0]} cy={c.pt[1]} r="11" />
            <Label x={c.pt[0]} y={c.pt[1]} side={LEFT.has(c.key) ? 'left' : 'right'}
              title={c.l.location.name} sub={`${fmtCompact(c.l.limit)}, ${c.status.label.toLowerCase()}`} />
          </g>
        ))}
      </svg>
      <div className="map-legend">
        <span><i className="lg lg-ok" />Normal</span>
        <span><i className="lg lg-warn" />Tier met</span>
        <span><i className="lg lg-alert" />Trigger</span>
        <span><i className="lg lg-paid" />Paid</span>
        <span><i className="lg lg-vault" />Vault</span>
      </div>
    </div>
  );
}
