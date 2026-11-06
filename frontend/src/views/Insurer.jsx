import {useEffect, useMemo, useState} from 'react';
import {abis} from '../abi/index.js';
import {useData} from '../state/data.jsx';
import {useTx} from '../state/tx.jsx';
import {useWallet} from '../state/wallet.jsx';
import {useNow, chainNow} from '../lib/useNow.js';
import {fmtAmount, fmtCountdown, fmtDateTime, fmtLevel, fmtPct, fmtRain, toNum} from '../lib/format.js';
import {PageHeader} from '../components/PageHeader.jsx';
import {Action, Addr, Ledger, Needs, Panel, Tag, TxLink} from '../components/ui.jsx';

export function LocationTabs({value, onChange}) {
  const {locations} = useData();
  return (
    <div className="loc-tabs" role="tablist">
      {locations.map((l) => (
        <button key={l.index} type="button" role="tab" aria-selected={value === l.index}
          className={value === l.index ? 'loc-tab is-on' : 'loc-tab'} onClick={() => onChange(l.index)}>
          {l.location.name}<small>{l.location.country}</small>
        </button>
      ))}
    </div>
  );
}

function Cover({loc}) {
  const data = useData();
  const {run} = useTx();
  const {me, contracts, programme, info} = data;
  const quarterly = loc.annualPremium / 4n;
  const pay = () => {
    const steps = [];
    if (!me || me.allowance.programme < quarterly) {
      steps.push({label: 'Approve tUSDC', address: contracts.usdc, abi: abis.usdc, functionName: 'approve', args: [programme, quarterly]});
    }
    steps.push({label: 'Pay premium', address: programme, abi: abis.programme, functionName: 'payPremium', args: [loc.index, quarterly]});
    run(`Pay ${loc.location.name} quarterly premium`, steps);
  };
  return (
    <Panel title="Cover terms" aside={<Addr address={loc.location.cedent} />} flush>
      <div className="panel-body">
        <Ledger rows={[
          ['Cedent', loc.location.cedentName],
          ['Limit', fmtAmount(loc.limit), 'is-strong'],
          ['Share of programme', fmtPct(loc.location.sublimitBps, 0)],
          ['Rate on line', `${fmtPct(loc.location.premiumRateBps, 2)} (${fmtAmount(loc.annualPremium)} p.a.)`],
          ['Premiums paid', fmtAmount(loc.location.premiumsPaid)],
          ['Recoveries paid', `${fmtAmount(loc.location.totalPaidOut)} (${fmtPct(loc.location.paidBps, 0)})`],
          ['Cedent cash balance', fmtAmount(data.balances.cedents[loc.location.cedent.toLowerCase()] ?? 0n), 'is-live'],
        ]} />
      </div>
      <table className="tbl">
        <thead><tr><th>Tier</th><th className="num">24h rainfall</th><th className="num">River level</th><th className="num">Recovery</th></tr></thead>
        <tbody>
          {loc.tiers.map((t, i) => (
            <tr key={i}>
              <td>Tier {i + 1}</td>
              <td className="num">{'≥'} {fmtRain(t.rainfallMmX10)}</td>
              <td className="num">{'≥'} {fmtLevel(t.riverLevelCm)}</td>
              <td className="num">{fmtPct(t.payoutBps, 0)} ({fmtAmount((toNum(loc.limit) * Number(t.payoutBps)) / 10_000)})</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="panel-body">
        <div className="actions">
          <Action onClick={pay} disabled={info.phase !== 1 || !me}>Pay quarterly premium of {fmtAmount(quarterly)} tUSDC</Action>
        </div>
        <Needs ok={info.phase === 1}>Premium is payable once the risk period starts.</Needs>
      </div>
    </Panel>
  );
}

function AllocationPlan({loc}) {
  const data = useData();
  const {run} = useTx();
  const {me, programme} = data;
  const initial = useMemo(() => loc.districts.map((d) => ({name: d.name, pct: Number(d.shareBps) / 100})), [loc.districts]);
  const [rows, setRows] = useState(initial);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setRows(initial); }, [initial, dirty]);
  const total = rows.reduce((s, r) => s + (Number(r.pct) || 0), 0);
  const canEdit = me && (me.address.toLowerCase() === loc.location.cedent.toLowerCase() || me.roles.manager);
  const set = (i, k, v) => { setDirty(true); setRows((rs) => rs.map((r, j) => (j === i ? {...r, [k]: v} : r))); };

  const allocs = data.events.filter((e) => e.eventName === 'RecoveryAllocation' && Number(e.args.locationId) === loc.index);
  const lastTx = allocs[0]?.transactionHash;
  const lastSplit = allocs.filter((e) => e.transactionHash === lastTx);

  const save = () => run(`Save ${loc.location.name} allocation plan`, [{
    label: 'Save plan', address: programme, abi: abis.programme, functionName: 'setAllocationPlan',
    args: [loc.index, rows.map((r) => r.name), rows.map((r) => Math.round(Number(r.pct) * 100))],
  }], {onDone: () => setDirty(false)});

  return (
    <Panel title="District allocation plan" aside="Published on-chain, disbursed by cedent" flush
      note={!canEdit ? `Editable by ${loc.location.cedentName} or Parapet.` : undefined}>
      <table className="tbl">
        <thead><tr><th>District</th><th className="num">Share</th>{lastSplit.length > 0 && <th className="num">Last recovery</th>}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td><input className="cell-input" aria-label="District" value={r.name} disabled={!canEdit} onChange={(e) => set(i, 'name', e.target.value)} /></td>
              <td className="num"><input className="cell-input" style={{width: 76, textAlign: 'right'}} aria-label="Share %" inputMode="decimal" value={r.pct} disabled={!canEdit} onChange={(e) => set(i, 'pct', e.target.value)} /> %</td>
              {lastSplit.length > 0 && <td className="num">{fmtAmount(lastSplit.find((e) => e.args.district === r.name)?.args.amount ?? 0n)}</td>}
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td>Total</td><td className={`num ${Math.abs(total - 100) < 0.001 ? '' : 'neg'}`}>{total.toFixed(2)} %</td>{lastSplit.length > 0 && <td />}</tr></tfoot>
      </table>
      {canEdit && (
        <div className="panel-body">
          <div className="actions">
            <button type="button" className="link" disabled={rows.length >= 8} onClick={() => { setDirty(true); setRows((rs) => [...rs, {name: 'New district', pct: 0}]); }}>Add district</button>
            <Action onClick={save} disabled={!dirty || Math.abs(total - 100) > 0.001 || loc.pending.active}>Save plan</Action>
          </div>
        </div>
      )}
    </Panel>
  );
}

export function Payouts({loc}) {
  const data = useData();
  const {run} = useTx();
  const now = chainNow(data, useNow(1000));
  const executed = data.events.filter((e) => e.eventName === 'PayoutExecuted' && Number(e.args.locationId) === loc.index);
  const queued = data.payoutRequests.filter((r) => Number(r.locationId) === loc.index);
  const settle = (r) => run('Settle queued payout', [{
    label: 'Settle', address: data.programme, abi: abis.programme, functionName: 'settlePayout', args: [BigInt(r.index)],
  }]);
  const rows = [];
  executed.forEach((e) => {
    rows.push({key: `${e.transactionHash}-i`, time: e.time, tranche: 'Buffer (instant)', amount: e.args.paidInstantly, status: <Tag tone="ok">Paid</Tag>, tx: e.transactionHash});
    if (e.args.queued > 0n) {
      const req = queued.find((r) => BigInt(r.index) === e.args.payoutRequestId);
      const wait = req ? Number(req.fund.claimableAt) - now : 0;
      const total = req ? Math.max(1, Number(req.fund.claimableAt) - Number(req.fund.requestedAt)) : 1;
      let status;
      if (req?.settled) status = <Tag tone="ok">Settled</Tag>;
      else if (wait > 0) {
        status = (<div style={{display: 'grid', gap: 4, minWidth: 140}}>
          <span className="small">Settles in {fmtCountdown(wait)}</span>
          <div className="progress settle"><span style={{width: `${Math.min(100, (1 - wait / total) * 100)}%`}} /></div>
        </div>);
      } else status = <Action onClick={() => settle(req)}>Settle now</Action>;
      rows.push({key: `${e.transactionHash}-q`, time: e.time, tranche: 'tMMF redemption (T+1)', amount: e.args.queued, status, tx: e.transactionHash});
    }
  });
  return (
    <Panel title="Recoveries" aside={`Paid to ${loc.location.cedentName}`} flush>
      <table className="tbl">
        <thead><tr><th>Executed</th><th>Tranche</th><th className="num">Amount</th><th>Status</th><th className="num">Tx</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={5} className="muted">No recoveries</td></tr>}
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="muted">{fmtDateTime(r.time)}</td>
              <td>{r.tranche}</td>
              <td className="num">{fmtAmount(r.amount)}</td>
              <td>{r.status}</td>
              <td className="num"><TxLink hash={r.tx} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

export default function Insurer() {
  const data = useData();
  const {account} = useWallet();
  const mine = data.locations.find((l) => l.location.cedent.toLowerCase() === account?.toLowerCase());
  const [pick, setPick] = useState(mine?.index ?? 0);
  useEffect(() => { if (mine) setPick(mine.index); }, [mine?.index]); // eslint-disable-line react-hooks/exhaustive-deps
  const loc = data.locations[pick];
  return (
    <div className="view">
      <PageHeader crumbs={`Programmes / ${data.info.symbol}`} title="Cedents" />
      <LocationTabs value={pick} onChange={setPick} />
      <div className="grid-2">
        <Cover loc={loc} />
        <AllocationPlan key={loc.index} loc={loc} />
      </div>
      <Payouts loc={loc} />
    </div>
  );
}
