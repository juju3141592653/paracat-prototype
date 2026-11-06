import {fmtCountdown, fmtPct} from './format.js';

/** Highest tier met by a reading, mirroring the contract's dual-trigger rule. */
export function tierMet(tiers, rain, level) {
  let best = -1;
  tiers.forEach((t, i) => {
    if (Number(rain) >= Number(t.rainfallMmX10) && Number(level) >= Number(t.riverLevelCm)) best = i;
  });
  return best;
}

/** Trigger status for a location: tone (for colour), a short tag label and a one-line detail. */
export function locationStatus(loc, station, quorum, now) {
  const paid = Number(loc.location.paidBps);
  const p = loc.pending;
  if (p.active) {
    const left = Number(p.executableAt) - now;
    return left > 0
      ? {tone: 'alert', label: 'Trigger proposed', text: `Tier ${p.tierIndex + 1}, executable in ${fmtCountdown(left)}`}
      : {tone: 'alert', label: 'Trigger confirmed', text: `Tier ${p.tierIndex + 1}, ready to pay`};
  }
  if (paid >= 10_000) return {tone: 'paid', label: 'Exhausted', text: '100% of limit paid'};
  const c = station?.consensus;
  const met = c?.ok ? tierMet(loc.tiers, c.rainfallMmX10, c.riverLevelCm) : -1;
  if (met >= 0 && Number(loc.tiers[met].payoutBps) > paid) {
    return {tone: 'warn', label: `Tier ${met + 1} met`, text: 'Awaiting trigger check'};
  }
  if (paid > 0) return {tone: 'paid', label: `${fmtPct(paid, 0)} paid`, text: 'Remaining limit in force'};
  if (!c?.ok) return {tone: 'muted', label: 'No quorum', text: `${quorum} fresh feeds required`};
  return {tone: 'ok', label: 'Normal', text: 'Below trigger levels'};
}
