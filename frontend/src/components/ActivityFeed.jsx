import {useMemo, useState} from 'react';
import {useData} from '../state/data.jsx';
import {CATEGORIES, COUNTRIES, fmtAmount, fmtDateTime, fmtLevel, fmtPct, fmtRain} from '../lib/format.js';
import {TxLink} from './ui.jsx';

const ZERO = '0x0000000000000000000000000000000000000000';

/** Decoded contract events as log lines: [type, description] or null to skip. */
function describe(e, ctx) {
  const a = e.args;
  const n = ctx.nameOf;
  const loc = (i) => ctx.locations?.[Number(i)]?.location.name ?? `Location ${i}`;
  const amt = (v) => fmtAmount(v);
  switch (e.eventName) {
    case 'ProgrammeCreated':
      return ['platform', `Programme issued: ${a.symbol}, notional ${amt(a.targetSize)}, issuance fee ${amt(a.issuanceFee)}`];
    case 'Subscribed':
      return ['investor', `Subscription: ${n(a.investor)}, ${amt(a.amount)}`];
    case 'SubscriptionClosed':
      return ['collateral', `Book closed at ${amt(a.principal)}. Buffer ${amt(a.buffer)}, tMMF ${amt(a.invested)}`];
    case 'PremiumPaid':
      return ['insurer', `Premium: ${loc(a.locationId)}, ${amt(a.amount)} (holders ${amt(a.toHolders)}, fee ${amt(a.fee)})`];
    case 'CollateralYieldDistributed':
      return ['collateral', `Collateral yield distributed: ${amt(a.amount)}`];
    case 'CouponClaimed':
      return ['investor', `Coupon claimed: ${n(a.holder)}, ${amt(a.amount)}`];
    case 'ObservationSubmitted':
      return ['oracle', `${ctx.cityOf(a.stationId)}: ${fmtRain(a.rainfallMmX10)}, ${fmtLevel(a.riverLevelCm)} (${n(a.provider)})`];
    case 'TriggerProposed':
      return ['trigger', `Proposed: ${loc(a.locationId)} tier ${a.tierIndex + 1} (${fmtPct(a.targetBps, 0)}), ${fmtRain(a.rainfallMmX10)}, ${fmtLevel(a.riverLevelCm)}, ${a.sources} sources`];
    case 'TriggerDisputed':
      return ['trigger', `Disputed: ${loc(a.locationId)} by ${n(a.guardian)}. ${a.reason}`];
    case 'PayoutExecuted':
      return ['payout', `Payout: ${loc(a.locationId)} to ${n(a.cedent)}, ${amt(a.amount)} (instant ${amt(a.paidInstantly)}${a.queued > 0n ? `, queued ${amt(a.queued)}` : ''})`];
    case 'PayoutSettled':
      return ['payout', `Settled from tMMF: ${n(a.cedent)}, ${amt(a.amount)}`];
    case 'AllocationPlanUpdated':
      return ['insurer', `Allocation plan: ${loc(a.locationId)}, ${a.districts} districts`];
    case 'IdentityRegistered':
      return ['compliance', `Onboarded: ${a.displayName}, ${COUNTRIES[a.country] ?? a.country}, ${CATEGORIES[a.category]}${a.accredited ? '' : ' (counterparty)'}`];
    case 'IdentityRevoked':
      return ['compliance', `Identity revoked: ${n(a.wallet)}`];
    case 'CountryRestrictionSet':
      return ['compliance', `Jurisdiction ${a.restricted ? 'restricted' : 'unrestricted'}: ${COUNTRIES[a.country] ?? a.country}`];
    case 'AddressFrozen':
      return ['compliance', `${a.frozen ? 'Frozen' : 'Unfrozen'}: ${n(a.account)}`];
    case 'ForcedTransfer':
      return ['compliance', `Forced transfer: ${amt(a.amount)} from ${n(a.from)} to ${n(a.to)}`];
    case 'Transfer':
      if (e.address.toLowerCase() !== ctx.programme?.toLowerCase()) return null;
      if (a.from === ZERO || a.to === ZERO) return null;
      return ['investor', `Transfer: ${amt(a.value)} from ${n(a.from)} to ${n(a.to)}`];
    case 'MaturityStarted':
      return ['collateral', 'Maturity started, tMMF redemption queued'];
    case 'ProgrammeMatured':
      return ['collateral', `Matured: redemption pool ${amt(a.redemptionPool)} for ${amt(a.supply)} notes`];
    case 'NotesRedeemed':
      return ['investor', `Redemption: ${n(a.holder)}, ${amt(a.notes)} notes for ${amt(a.amount)}`];
    case 'Paused':
      return ['compliance', `Programme paused by ${n(a.account)}`];
    case 'Unpaused':
      return ['compliance', `Programme unpaused by ${n(a.account)}`];
    default:
      return null;
  }
}

const TYPE_LABEL = {
  oracle: 'Oracle', trigger: 'Trigger', payout: 'Payout', investor: 'Investor', insurer: 'Cedent',
  collateral: 'Collateral', compliance: 'Compliance', platform: 'Platform',
};
const FILTERS = [['all', 'All'], ['oracle', 'Oracle'], ['trigger', 'Trigger'], ['payout', 'Payout'],
  ['investor', 'Investor'], ['insurer', 'Cedent'], ['collateral', 'Collateral'], ['compliance', 'Compliance']];

export function ActivityFeed({limit = 40}) {
  const data = useData();
  const [filter, setFilter] = useState('all');
  const cityOf = (id) => data.stations?.[id]?.station.city ?? 'Station';
  const items = useMemo(() => data.events
    .map((e) => ({e, d: describe(e, {...data, cityOf})}))
    .filter((x) => x.d && (filter === 'all' || x.d[0] === filter))
    .slice(0, limit),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [data.events, data.names, filter, limit]);

  return (
    <>
      <div className="log-tools">
        <div className="segmented" role="group" aria-label="Filter events">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" className={filter === k ? 'is-on' : undefined} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
        <span className="muted small">{items.length} events</span>
      </div>
      <div className="log-scroll">
        <table className="tbl">
          <thead><tr><th>Time</th><th>Type</th><th>Event</th><th className="num">Block</th></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={4} className="muted">No events</td></tr>}
            {items.map(({e, d}) => (
              <tr key={`${e.transactionHash}-${e.logIndex}`}>
                <td className="muted" style={{whiteSpace: 'nowrap'}}>{fmtDateTime(e.time)}</td>
                <td><span className={`log-type type-${d[0]}`}>{TYPE_LABEL[d[0]]}</span></td>
                <td>{d[1]}</td>
                <td className="num"><TxLink hash={e.transactionHash}><span className="mono">{String(e.blockNumber)}</span></TxLink></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
