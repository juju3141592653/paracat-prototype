import {formatUnits, parseUnits} from 'viem';

export const DECIMALS = 6;
export const BPS = 10_000;

export const toNum = (raw) => Number(formatUnits(BigInt(raw ?? 0), DECIMALS));
export const parseAmount = (text) => parseUnits(String(text || '0').replace(/,/g, ''), DECIMALS);

const whole = new Intl.NumberFormat('en-US', {maximumFractionDigits: 0});
const two = new Intl.NumberFormat('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});

/** 20,000,000 */
export const fmtAmount = (raw, digits = 0) =>
  (digits ? two : whole).format(typeof raw === 'number' ? raw : toNum(raw));

/** $20.0m, $152k, $950 */
export function fmtCompact(raw) {
  const n = typeof raw === 'number' ? raw : toNum(raw);
  const abs = Math.abs(n);
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(abs >= 1e8 ? 0 : 2).replace(/\.?0+$/, '')}m`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(abs >= 1e5 ? 0 : 1).replace(/\.0$/, '')}k`;
  return n === 0 ? '$0' : `$${n.toFixed(2)}`;
}

export const fmtPct = (bps, digits = 1) => `${(Number(bps) / 100).toFixed(digits)}%`;
export const fmtRain = (mmX10) => `${(Number(mmX10) / 10).toFixed(1)} mm`;
export const fmtLevel = (cm) => `${(Number(cm) / 100).toFixed(2)} m`;
export const short = (addr) => (addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '');

export function fmtDate(seconds) {
  if (!seconds) return 'Not set';
  return new Date(Number(seconds) * 1000).toLocaleDateString('en-SG', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

export function fmtDateTime(seconds) {
  if (!seconds) return '';
  return new Date(Number(seconds) * 1000).toLocaleString('en-SG', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

/** 2d 4h, 3h 12m, 0:42 */
export function fmtCountdown(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtDuration(seconds) {
  const s = Number(seconds);
  const unit = (n, word) => `${+n.toFixed(1)} ${word}${+n.toFixed(1) === 1 ? '' : 's'}`;
  if (s >= 365 * 86400) return unit(s / (365 * 86400), 'year');
  if (s >= 86400) return unit(s / 86400, 'day');
  if (s >= 3600) return unit(s / 3600, 'hour');
  if (s >= 60) return unit(s / 60, 'minute');
  return unit(s, 'second');
}

/** 60s, 5 min, 72 h, 3 days */
export function fmtShortDuration(seconds) {
  const s = Number(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${+(s / 60).toFixed(1)} min`;
  if (s < 2 * 86400) return `${+(s / 3600).toFixed(1)} h`;
  return `${+(s / 86400).toFixed(1)} days`;
}

/** Keep names like "2026-A" from breaking at the hyphen. */
export const noBreak = (text) => String(text).replace(/-/g, '\u2011');

export const PHASES = ['Subscription open', 'Risk period active', 'Maturing', 'Matured'];

export const COUNTRIES = {
  702: 'Singapore', 344: 'Hong Kong', 608: 'Philippines', 704: 'Vietnam', 360: 'Indonesia',
  458: 'Malaysia', 764: 'Thailand', 392: 'Japan', 826: 'United Kingdom', 840: 'United States',
  756: 'Switzerland', 408: 'North Korea (restricted)',
};

export const CATEGORIES = [
  'Not registered', 'Institution', 'Family office', 'Accredited individual', 'Insurer', 'Service provider',
];

export const TRANSFER_CODES = [
  'Transfer allowed',
  'Programme is paused',
  'Sender wallet is frozen',
  'Recipient wallet is frozen',
  'Recipient is not an eligible, verified investor',
  'Not enough notes',
];
