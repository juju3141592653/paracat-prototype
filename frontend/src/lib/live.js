import {useData} from '../state/data.jsx';
import {useNow} from './useNow.js';
import {BPS, toNum} from './format.js';

const YEAR = 365 * 86400;

/** Collateral keeps earning between polls; extrapolate so the yield visibly accrues. */
export function useLiveCollateral(interval = 250) {
  const data = useData();
  const now = useNow(interval);
  const info = data.info;
  if (!info || !data.fund) return null;
  const fundValue = toNum(info.fundValue);
  const perSecond = (fundValue * (data.fund.apyBps / BPS) * data.fund.accel) / YEAR;
  const dt = Math.max(0, (now - data.fetchedAt) / 1000);
  const liveFund = fundValue + perSecond * dt;
  const excess = Math.max(0, toNum(info.bufferBalance) + liveFund - toNum(info.remainingPrincipal));
  return {liveFund, excess, perSecond, perDay: perSecond * 86400 / data.fund.accel};
}


/** Indicative running yield to note holders, in basis points: premiums after Parapet's fee plus collateral yield. */
export function indicativeYield(data) {
  const {info, locations, fund} = data;
  const limitTotal = locations.reduce((s, l) => s + toNum(l.limit), 0) || 1;
  const premiumRate = locations.reduce((s, l) => s + toNum(l.limit) * Number(l.location.premiumRateBps), 0) / limitTotal;
  const toHolders = premiumRate * (1 - Number(info.servicingFeeBps) / BPS);
  const collateral = fund.apyBps * (1 - Number(info.bufferBps) / BPS);
  return {total: toHolders + collateral, premium: toHolders, collateral};
}
