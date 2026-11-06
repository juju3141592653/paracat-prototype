import {useState} from 'react';
import {abis} from '../abi/index.js';
import {useData} from '../state/data.jsx';
import {useTx} from '../state/tx.jsx';
import {useWallet} from '../state/wallet.jsx';
import {useNow, chainNow} from '../lib/useNow.js';
import {fmtAmount, fmtCountdown, fmtDateTime, fmtDuration, fmtLevel, fmtPct, fmtRain, toNum} from '../lib/format.js';
import {locationStatus, tierMet} from '../lib/status.js';
import {StaffGauge, RainBar} from '../components/Gauge.jsx';
import {PageHeader} from '../components/PageHeader.jsx';
import {Action, Addr, Field, Needs, Panel, Tag} from '../components/ui.jsx';
import {LocationTabs, Payouts} from './Insurer.jsx';

/** Demo scenarios derived from each location's thresholds. Values: [rain mm x10, level cm] per feed. */
function scenarios(tiers) {
  const t1 = tiers[0];
  const t2 = tiers[tiers.length - 1];
  const r1 = Number(t1.rainfallMmX10), l1 = Number(t1.riverLevelCm);
  const r2 = Number(t2.rainfallMmX10), l2 = Number(t2.riverLevelCm);
  return [
    {key: 'normal', label: 'Baseline', a: [r1 * 0.22, l1 * 0.72], b: [r1 * 0.24, l1 * 0.73]},
    {key: 'rainonly', label: 'Rain only', a: [r2 * 1.2, l1 * 0.9], b: [r2 * 1.25, l1 * 0.91]},
    {key: 'faulty', label: 'Sensor fault', a: [r1 * 0.25, l1 * 0.74], b: [r2 * 1.6, l2 * 1.15]},
    {key: 'tier1', label: 'Tier 1 event', a: [(r1 + r2) / 2, (l1 + l2) / 2], b: [(r1 + r2) / 2 * 1.04, (l1 + l2) / 2 * 1.01]},
    {key: 'tier2', label: 'Tier 2 event', a: [r2 * 1.08, l2 * 1.03], b: [r2 * 1.12, l2 * 1.04]},
  ];
}

function Observations({loc, station}) {
  const data = useData();
  const w = useWallet();
  const {run} = useTx();
  const now = chainNow(data, useNow(1000));
  const [rain, setRain] = useState('');
  const [level, setLevel] = useState('');
  const c = station.consensus;
  const sid = loc.location.stationId;
  const demo = w.mode === 'demo';
  const canReport = demo || data.me?.roles.provider;
  const observedAt = () => BigInt(Math.floor(now) - 2);

  const submit = (title, readings) => run(title, readings.map(([as, r, l, ref]) => ({
    label: as ? `${as === 'feedA' ? 'Feed A' : 'Feed B'} submits` : 'Submit observation',
    as, address: data.contracts.oracle, abi: abis.oracle, functionName: 'submitObservation',
    args: [sid, Math.round(r), Math.round(l), observedAt(), ref],
  })));
  const runScenario = (s) => submit(`${s.label}: ${loc.location.name}`, demo
    ? [['feedA', ...s.a, `gauge-${s.key}`], ['feedB', ...s.b, `satellite-${s.key}`]]
    : [[undefined, ...s.a, `gauge-${s.key}`]]);
  const submitManual = () => submit(`Observation: ${loc.location.name}`,
    [[demo ? 'feedA' : undefined, Number(rain) * 10, Number(level) * 100, 'manual']]);

  return (
    <Panel title="Observations" aside={`Quorum ${data.oracle.quorum}, lower median, max age ${fmtDuration(data.oracle.maxAge)}`} flush>
      <table className="tbl">
        <thead><tr><th>Provider</th><th className="num">24h rainfall</th><th className="num">River level</th><th>Observed</th></tr></thead>
        <tbody>
          {station.readings.map((r) => {
            const fresh = r.observedAt > 0n && Number(r.observedAt) + data.oracle.maxAge >= now;
            return (
              <tr key={r.provider} className={fresh ? '' : 'is-stale'}>
                <td><Addr address={r.provider} plain /></td>
                <td className="num">{r.observedAt > 0n ? fmtRain(r.rainfallMmX10) : '-'}</td>
                <td className="num">{r.observedAt > 0n ? fmtLevel(r.riverLevelCm) : '-'}</td>
                <td className="muted">{r.observedAt > 0n ? `${fmtDateTime(r.observedAt)}${fresh ? '' : ', stale'}` : 'None'}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>Consensus</td>
            <td className="num">{c.ok ? fmtRain(c.rainfallMmX10) : '-'}</td>
            <td className="num">{c.ok ? fmtLevel(c.riverLevelCm) : '-'}</td>
            <td>{c.ok ? `${c.sources} sources` : 'No quorum'}</td>
          </tr>
        </tfoot>
      </table>
      <div className="panel-body" style={{display: 'grid', gap: 12}}>
        <div style={{display: 'grid', gap: 6}}>
          <span className="field-label">Scenario {demo ? '(both feeds submit)' : '(your wallet submits)'}</span>
          <div className="segmented">
            {scenarios(loc.tiers).map((s) => (
              <button key={s.key} type="button" className={`scenario-${s.key}`} disabled={!canReport} onClick={() => runScenario(s)}>{s.label}</button>
            ))}
          </div>
        </div>
        <div className="form-row">
          <Field label="24h rainfall (mm)"><input inputMode="decimal" value={rain} onChange={(e) => setRain(e.target.value)} placeholder="320" /></Field>
          <Field label="River level (m)"><input inputMode="decimal" value={level} onChange={(e) => setLevel(e.target.value)} placeholder="19.40" /></Field>
          <Action kind="quiet" onClick={submitManual} disabled={!canReport || !rain || !level}>Submit{demo ? ' as Feed A' : ''}</Action>
        </div>
        <Needs ok={canReport}>Requires the data provider role.</Needs>
      </div>
    </Panel>
  );
}

function Workflow({loc, station}) {
  const data = useData();
  const w = useWallet();
  const {run, rpc} = useTx();
  const now = chainNow(data, useNow(500));
  const [reason, setReason] = useState('Gauge maintenance, reading not representative');
  const {info, programme, oracle} = data;
  const c = station.consensus;
  const p = loc.pending;
  const paid = Number(loc.location.paidBps);
  const met = c.ok ? tierMet(loc.tiers, c.rainfallMmX10, c.riverLevelCm) : -1;
  const newTier = met >= 0 && Number(loc.tiers[met].payoutBps) > (p.active ? Number(p.targetBps) : paid);
  const left = p.active ? Number(p.executableAt) - now : 0;
  const windowSecs = Number(info.disputeWindow);
  const due = p.active ? (toNum(loc.limit) * (Number(p.targetBps) - paid)) / 10_000 : 0;
  const guardian = w.mode === 'demo' || data.me?.roles.guardian;
  const call = (title, fn, args, as) => run(title, [{label: title, as, address: programme, abi: abis.programme, functionName: fn, args}]);
  const skip = (secs) => rpc(`Skip ${fmtDuration(secs)} (local)`, [['evm_increaseTime', [secs]], ['evm_mine', []]]);

  const s1 = c.ok ? 'done' : 'now';
  const s2 = newTier && !p.active ? 'now' : (p.active || paid > 0 ? 'done' : '');
  const s3 = p.active ? (left > 0 ? 'now' : 'done') : (paid > 0 && !newTier ? 'done' : '');
  const s4 = p.active && left <= 0 ? 'now' : (paid > 0 && !p.active && !newTier ? 'done' : '');
  const status = locationStatus(loc, station, oracle.quorum, now);

  return (
    <Panel title="Trigger workflow" aside={<Tag tone={status.tone}>{status.label}</Tag>} flush>
      <div className="flow">
        <div className={`flow-step is-${s1}`}>
          <span className="flow-n">1</span><span className="flow-t">Observation</span>
          <span className="flow-s">{c.ok ? `${fmtRain(c.rainfallMmX10)}, ${fmtLevel(c.riverLevelCm)}` : 'No quorum'}</span>
        </div>
        <div className={`flow-step is-${s2}`}>
          <span className="flow-n">2</span><span className="flow-t">Trigger check</span>
          <span className="flow-s">{p.active ? `Tier ${p.tierIndex + 1} proposed` : (met >= 0 ? `Tier ${met + 1} met` : 'No tier met')}</span>
        </div>
        <div className={`flow-step is-${s3}`}>
          <span className="flow-n">3</span><span className="flow-t">Dispute window</span>
          <span className="flow-s">{p.active ? (left > 0 ? `${fmtCountdown(left)} remaining` : 'Closed') : fmtDuration(windowSecs)}</span>
        </div>
        <div className={`flow-step is-${s4}`}>
          <span className="flow-n">4</span><span className="flow-t">Payout</span>
          <span className="flow-s">{p.active ? `${fmtAmount(due)} due` : `${fmtPct(paid, 0)} of limit paid`}</span>
        </div>
      </div>
      <div className="flow-detail">
        {info.phase !== 1 && <p className="needs" style={{marginTop: 0}}>Triggers are only active during the risk period.</p>}
        {p.active && (
          <div style={{display: 'grid', gap: 6}}>
            <span>Tier {p.tierIndex + 1} proposed on {fmtRain(p.rainfallMmX10)} and {fmtLevel(p.riverLevelCm)} ({p.sources} sources).
              {' '}{left > 0 ? <span className="countdown">Executable in {fmtCountdown(left)}</span> : 'Dispute window closed.'}</span>
            {left > 0 && <div className="progress"><span style={{width: `${Math.max(0, (left / Math.max(1, windowSecs)) * 100)}%`}} /></div>}
          </div>
        )}
        <div className="actions">
          <Action kind={p.active ? 'quiet' : 'primary'} onClick={() => call(`Check trigger: ${loc.location.name}`, 'checkTrigger', [loc.index])} disabled={info.phase !== 1}>Check trigger</Action>
          <Action onClick={() => call(`Execute payout: ${loc.location.name}`, 'executePayout', [loc.index])} disabled={!p.active || left > 0}>Execute payout</Action>
          {p.active && left > 0 && w.isLocal && <button type="button" className="link" onClick={() => skip(Math.ceil(left) + 1)}>Skip to end of window (local)</button>}
          {w.isLocal && data.payoutRequests.some((r) => !r.settled && Number(r.fund.claimableAt) > now) && (
            <button type="button" className="link" onClick={() => skip(data.fund.settlementDelay + 1)}>Skip fund settlement (local)</button>
          )}
        </div>
        {p.active && left > 0 && guardian && (
          <div className="form-row">
            <Field label="Dispute reason"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <Action kind="danger" onClick={() => call('Dispute trigger', 'disputeTrigger', [loc.index, reason], w.mode === 'demo' ? 'guardian' : undefined)}>Dispute as guardian</Action>
          </div>
        )}
      </div>
    </Panel>
  );
}

export default function Trigger({initial = 0}) {
  const data = useData();
  const [pick, setPick] = useState(initial);
  const loc = data.locations[pick];
  const station = data.stations[loc.location.stationId];
  const c = station.consensus;
  return (
    <div className="view">
      <PageHeader crumbs={`Programmes / ${data.info.symbol}`} title="Trigger monitor" />
      <LocationTabs value={pick} onChange={setPick} />
      <div className="grid-trigger">
        <Panel title={station.station.river} aside={station.station.name}>
          <StaffGauge tiers={loc.tiers} levelCm={c.ok ? c.riverLevelCm : null} paidBps={loc.location.paidBps} stale={!c.ok} />
          <RainBar tiers={loc.tiers} rainMmX10={c.ok ? c.rainfallMmX10 : null} />
        </Panel>
        <Observations loc={loc} station={station} />
      </div>
      <Workflow loc={loc} station={station} />
      <Payouts loc={loc} />
    </div>
  );
}
