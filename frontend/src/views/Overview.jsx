import {useData} from '../state/data.jsx';
import {useWallet} from '../state/wallet.jsx';
import {useNow, chainNow} from '../lib/useNow.js';
import {PHASES, fmtShortDuration, fmtAmount, fmtCompact, fmtDate, fmtDuration, fmtLevel, fmtPct, fmtRain, noBreak, short, toNum} from '../lib/format.js';
import {locationStatus} from '../lib/status.js';
import {indicativeYield, useLiveCollateral} from '../lib/live.js';
import {StaffGauge, RainBar} from '../components/Gauge.jsx';
import {ActivityFeed} from '../components/ActivityFeed.jsx';
import {RiskMap} from '../components/RiskMap.jsx';
import {PageHeader} from '../components/PageHeader.jsx';
import {Ledger, Panel, Tag} from '../components/ui.jsx';

export const PHASE_TONE = ['brand', 'ok', 'warn', 'paid'];

function Kpis() {
  const data = useData();
  const live = useLiveCollateral(200);
  const info = data.info;
  const y = indicativeYield(data);
  const subscribed = toNum(info.totalSubscribed);
  const target = toNum(info.targetSize);
  const collateral = info.phase === 0 ? subscribed : toNum(info.bufferBalance) + (live?.liveFund ?? 0);
  return (
    <div className="kpis">
      <div className="kpi">
        <span className="kpi-k">Notional</span>
        <span className="kpi-v">{fmtAmount(target)}<small>USD</small></span>
        <span className="kpi-s">{data.locations.length} locations</span>
      </div>
      <div className="kpi">
        <span className="kpi-k">Subscribed</span>
        <span className="kpi-v">{fmtAmount(subscribed)}</span>
        <div className="bar" aria-hidden="true"><span style={{width: `${Math.min(100, (subscribed / target) * 100)}%`}} /></div>
      </div>
      <div className="kpi">
        <span className="kpi-k">{info.phase === 0 ? 'Escrow' : 'Collateral'}</span>
        <span className="kpi-v">{fmtAmount(collateral, 2)}</span>
        <span className="kpi-s">{info.phase === 0 ? 'Until book close' : `${fmtPct(info.bufferBps, 0)} stablecoin, ${fmtPct(10_000 - Number(info.bufferBps), 0)} tMMF`}</span>
      </div>
      <div className="kpi">
        <span className="kpi-k">Accrued collateral yield</span>
        <span className="kpi-v">{fmtAmount(live?.excess ?? 0, 2)}</span>
        <span className="kpi-s">tMMF at {fmtPct(data.fund.apyBps, 2)}</span>
      </div>
      <div className="kpi">
        <span className="kpi-k">Indicative yield</span>
        <span className="kpi-v">{fmtPct(y.total, 2)}</span>
        <span className="kpi-s">{fmtPct(y.premium, 2)} premium, {fmtPct(y.collateral, 2)} collateral</span>
      </div>
      <div className="kpi">
        <span className="kpi-k">Paid to cedents</span>
        <span className="kpi-v">{fmtAmount(info.totalPaidOut)}</span>
        <span className="kpi-s">{fmtPct(toNum(info.principal) ? (toNum(info.totalPaidOut) / toNum(info.principal)) * 10_000 : 0, 1)} of principal</span>
      </div>
    </div>
  );
}

function CoverTable({onPick}) {
  const data = useData();
  const now = chainNow(data, useNow(1000));
  return (
    <Panel title="Cover layers" aside="Trigger: 24h rainfall and river level" flush>
      <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr><th>Location / cedent</th><th className="num">Limit / ROL</th><th>Tier 1 (50%)</th><th>Tier 2 (100%)</th><th>Status</th></tr>
          </thead>
          <tbody>
            {data.locations.map((l) => {
              const s = locationStatus(l, data.stations[l.location.stationId], data.oracle.quorum, now);
              const t1 = l.tiers[0];
              const t2 = l.tiers[l.tiers.length - 1];
              return (
                <tr key={l.index}>
                  <td>
                    {onPick ? <button type="button" className="link" onClick={() => onPick(l.index)}>{l.location.name}</button> : l.location.name}
                    <span className="sub">{l.location.cedentName}</span>
                  </td>
                  <td className="num">{fmtAmount(l.limit)}<span className="sub">{fmtPct(l.location.premiumRateBps, 2)}</span></td>
                  <td className="nowrap">{Number(t1.rainfallMmX10) / 10} mm<span className="sub">{fmtLevel(t1.riverLevelCm)}</span></td>
                  <td className="nowrap">{Number(t2.rainfallMmX10) / 10} mm<span className="sub">{fmtLevel(t2.riverLevelCm)}</span></td>
                  <td><Tag tone={s.tone}>{s.label}</Tag></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Terms />
    </Panel>
  );
}

function Terms() {
  const {info, fund, issuanceFeeBps} = useData();
  const rows = [
    ['Issuer', 'ParaCat SPRV (Singapore)'],
    ['Instrument', 'Permissioned token, 6 dp'],
    ['Issue price', '1.00 tUSDC'],
    ['Minimum', fmtAmount(info.minSubscription)],
    ['Coupon', 'Premium + tMMF yield'],
    ['Trigger', 'Parametric, dual, 2 tiers'],
    ['Dispute window', fmtDuration(info.disputeWindow)],
    ['Settlement', `Instant + ${fmtShortDuration(fund.settlementDelay)}`],
    ['Issuance fee', fmtPct(issuanceFeeBps, 2)],
    ['Servicing fee', `${fmtPct(info.servicingFeeBps, 0)} of premium`],
  ];
  return (
    <div className="terms">
      <h3>Key terms</h3>
      <dl>
        {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
    </div>
  );
}

export function Gauges() {
  const data = useData();
  const now = chainNow(data, useNow(1000));
  return (
    <Panel title="River gauges" aside={`Oracle quorum ${data.oracle.quorum}, max age ${fmtDuration(data.oracle.maxAge)}`} flush>
      <div className="gauges">
        {data.locations.map((l) => {
          const st = data.stations[l.location.stationId];
          const c = st?.consensus;
          const s = locationStatus(l, st, data.oracle.quorum, now);
          const fresh = st?.readings.filter((r) => r.observedAt > 0n && Number(r.observedAt) + data.oracle.maxAge >= now).length ?? 0;
          return (
            <div key={l.index} className="gauge-cell">
              <div className="gauge-head">
                <div><h3>{l.location.name}</h3><p>{st?.station.river}, {st?.station.name}</p></div>
                <Tag tone={s.tone}>{s.label}</Tag>
              </div>
              <StaffGauge tiers={l.tiers} levelCm={c?.ok ? c.riverLevelCm : null} paidBps={l.location.paidBps} stale={!c?.ok} />
              <RainBar tiers={l.tiers} rainMmX10={c?.ok ? c.rainfallMmX10 : null} />
              <span className="muted small">{fresh} of {st?.readings.length ?? 0} feeds fresh</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function Collateral() {
  const data = useData();
  const live = useLiveCollateral();
  const info = data.info;
  const buffer = toNum(info.bufferBalance);
  const queued = data.payoutRequests.filter((r) => !r.settled).reduce((s, r) => s + toNum(r.amount), 0);
  const accel = data.fund.accel > 1 ? ` Demo clock ${data.fund.accel.toLocaleString('en-US')}x.` : '';
  if (info.phase === 0) {
    return (
      <Panel title="Collateral" note={`Allocation at close: ${fmtPct(info.bufferBps, 0)} stablecoin buffer, remainder in tokenised government MMF.`}>
        <Ledger rows={[
          ['Held in escrow', fmtAmount(info.totalSubscribed)],
          ['tMMF yield', `${fmtPct(data.fund.apyBps, 2)} p.a.`],
          ['Settlement (redemption)', `${fmtDuration(data.fund.settlementDelay)} (T+1 in production)`],
        ]} />
      </Panel>
    );
  }
  return (
    <Panel title="Collateral" note={`tMMF NAV accrues at ${fmtPct(data.fund.apyBps, 2)} p.a.${accel}`}>
      <Ledger rows={[
        ['Stablecoin buffer', fmtAmount(buffer, 2)],
        ['Tokenised MMF', fmtAmount(live?.liveFund ?? 0, 2)],
        ['Total collateral', fmtAmount(buffer + (live?.liveFund ?? 0), 2), 'is-strong'],
        ['Outstanding principal', fmtAmount(info.remainingPrincipal)],
        ['Accrued yield (undistributed)', fmtAmount(live?.excess ?? 0, 2), 'is-live'],
        queued > 0 && ['Pending tMMF settlement', fmtAmount(queued)],
      ]} />
    </Panel>
  );
}

function Income() {
  const data = useData();
  const info = data.info;
  const y = indicativeYield(data);
  return (
    <Panel title="Income and fees" note={`Indicative yield ${fmtPct(y.total, 2)}: premium after servicing fee ${fmtPct(y.premium, 2)}, collateral ${fmtPct(y.collateral, 2)}.`}>
      <Ledger rows={[
        ['Premiums received', fmtAmount(info.totalPremiums)],
        ['Coupons to holders', fmtAmount(info.totalCouponsDistributed)],
        ['of which collateral yield', fmtAmount(info.totalCollateralYield)],
        [`Servicing fees (${fmtPct(info.servicingFeeBps, 0)})`, fmtAmount(info.totalFees)],
        ['Parapet treasury', fmtAmount(data.balances.treasury), 'is-strong'],
      ]} />
    </Panel>
  );
}

export default function Overview({goTrigger}) {
  const data = useData();
  const {explorer} = useWallet();
  const info = data.info;
  return (
    <div className="view">
      <PageHeader
        crumbs={`Programmes / ${info.symbol}`}
        title={noBreak(info.name)}
        tags={<Tag tone={PHASE_TONE[info.phase]}>{PHASES[info.phase]}</Tag>}
        meta={<>
          <span>{info.riskStart > 0n ? `Risk period ${fmtDate(info.riskStart)} to ${fmtDate(info.riskEnd)}` : `Term ${fmtDuration(info.termSeconds)}`}</span>
          <span>Contract {explorer
            ? <a href={`${explorer}/address/${data.programme}`} target="_blank" rel="noreferrer">{short(data.programme)}</a>
            : <code>{short(data.programme)}</code>}</span>
        </>}
      />
      <Kpis />
      <div className="grid-map">
        <Panel title="Exposure" aside={`${fmtCompact(info.targetSize)} across ${data.locations.length} catchments`} flush>
          <RiskMap />
        </Panel>
        <CoverTable onPick={goTrigger} />
      </div>
      <Gauges />
      <div className="grid-2">
        <Collateral />
        <Income />
      </div>
      <Panel title="Event log" aside={`Block ${data.blockNumber?.toLocaleString('en-US')}`} flush>
        <ActivityFeed limit={60} />
      </Panel>
    </div>
  );
}
