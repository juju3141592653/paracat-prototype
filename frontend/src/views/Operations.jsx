import {useState} from 'react';
import {isAddress, keccak256, toBytes} from 'viem';
import {abis} from '../abi/index.js';
import {useData} from '../state/data.jsx';
import {useTx} from '../state/tx.jsx';
import {useWallet} from '../state/wallet.jsx';
import {useNow, chainNow} from '../lib/useNow.js';
import {CATEGORIES, COUNTRIES, PHASES, fmtAmount, fmtCountdown, fmtDate, fmtDuration, fmtPct, parseAmount, short, toNum} from '../lib/format.js';
import {useLiveCollateral} from '../lib/live.js';
import {PageHeader} from '../components/PageHeader.jsx';
import {Action, Addr, Field, Ledger, Needs, Panel, Tag} from '../components/ui.jsx';
import {PHASE_TONE} from './Overview.jsx';

function Lifecycle() {
  const data = useData();
  const {run} = useTx();
  const live = useLiveCollateral();
  const now = chainNow(data, useNow(1000));
  const {info, me, programme} = data;
  const call = (title, fn, args = []) => run(title, [{label: title, address: programme, abi: abis.programme, functionName: fn, args}]);
  const riskOver = info.phase === 1 && now > Number(info.riskEnd);
  const queued = data.payoutRequests.filter((r) => !r.settled).length;

  const rows = [
    {
      step: 'Close book', when: info.phase === 0 && Boolean(me?.roles.manager) && info.totalSubscribed > 0n, done: info.phase > 0,
      detail: `${fmtAmount(info.totalSubscribed)} subscribed. Allocates ${fmtPct(info.bufferBps, 0)} to stablecoin buffer, remainder to tMMF. Starts ${fmtDuration(info.termSeconds)} risk period.`,
      action: <Action onClick={() => call('Close subscription', 'closeSubscription')} disabled={info.phase !== 0 || !me?.roles.manager || info.totalSubscribed === 0n}>Close subscription</Action>,
    },
    {
      step: 'Distribute collateral yield', when: info.phase === 1 && info.excessCollateral > 0n, done: false,
      detail: info.phase === 1 ? `${fmtAmount(live?.excess ?? 0, 2)} accrued above outstanding principal.` : 'Available during the risk period.',
      action: <Action kind="quiet" onClick={() => call('Distribute collateral yield', 'distributeCollateralYield')} disabled={info.phase !== 1 || info.excessCollateral === 0n}>Distribute collateral yield</Action>,
    },
    {
      step: 'Begin maturity', when: info.phase === 1 && (riskOver || info.remainingPrincipal === 0n), done: info.phase > 1,
      detail: info.phase === 1 ? `Risk period ends ${fmtDate(info.riskEnd)}${riskOver ? '' : ` (${fmtCountdown(Number(info.riskEnd) - now)})`}. Redeems all tMMF.` : 'Queues tMMF redemption after the risk period.',
      action: <Action kind="quiet" onClick={() => call('Begin maturity', 'beginMaturity')} disabled={info.phase !== 1 || (!riskOver && info.remainingPrincipal > 0n)}>Begin maturity</Action>,
    },
    {
      step: 'Finalise maturity', when: info.phase === 2, done: info.phase > 2,
      detail: info.phase === 3 ? `Redemption pool ${fmtAmount(info.redemptionPool)} for ${fmtAmount(info.supplyAtMaturity)} notes.` : `After tMMF settlement (${fmtDuration(data.fund.settlementDelay)}).`,
      action: <Action kind="quiet" onClick={() => call('Finalise maturity', 'finaliseMaturity')} disabled={info.phase !== 2}>Finalise maturity</Action>,
    },
  ];

  return (
    <Panel title="Programme lifecycle" aside={<Tag tone={PHASE_TONE[info.phase]}>{PHASES[info.phase]}</Tag>} flush
      note={queued > 0 ? `${queued} recovery tranche(s) pending tMMF settlement.` : 'Pause halts subscriptions, transfers and new triggers. Confirmed payouts remain executable.'}>
      <table className="tbl">
        <thead><tr><th>Step</th><th>Detail</th><th className="num">Action</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.step}>
              <td style={{whiteSpace: 'nowrap'}}>{r.step}{r.done && <span className="sub pos">Done</span>}{r.when && !r.done && <span className="sub" style={{color: 'var(--brand)'}}>Available</span>}</td>
              <td className="muted">{r.detail}</td>
              <td className="num">{r.action}</td>
            </tr>
          ))}
          <tr>
            <td>Emergency pause</td>
            <td className="muted">{info.paused ? 'Programme is paused.' : 'Guardian role required.'}</td>
            <td className="num">{!info.paused
              ? <Action kind="danger" onClick={() => call('Pause programme', 'pause')} disabled={!me?.roles.guardian}>Pause</Action>
              : <Action onClick={() => call('Unpause programme', 'unpause')} disabled={!me?.roles.admin}>Unpause</Action>}</td>
          </tr>
        </tbody>
      </table>
    </Panel>
  );
}

function Onboarding() {
  const data = useData();
  const {run} = useTx();
  const {identities, me, contracts} = data;
  const [form, setForm] = useState({wallet: '', name: '', country: '702', category: '1', accredited: true});
  const set = (k) => (e) => setForm((f) => ({...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value}));
  const agent = me?.roles.registryAgent;
  const R = abis.registry;
  const register = () => run(`Onboard ${form.name}`, [{
    label: 'Register identity', address: contracts.registry, abi: R, functionName: 'registerIdentity',
    args: [form.wallet, Number(form.country), Number(form.category), form.accredited,
      BigInt(Math.floor(Date.now() / 1000) + 2 * 365 * 86400), form.name],
  }], {onDone: () => setForm((f) => ({...f, wallet: '', name: ''}))});
  const revoke = (w) => run('Revoke identity', [{label: 'Revoke', address: contracts.registry, abi: R, functionName: 'revokeIdentity', args: [w]}]);
  const freeze = (w, on) => run(on ? 'Freeze wallet' : 'Unfreeze wallet', [{
    label: on ? 'Freeze' : 'Unfreeze', address: data.programme, abi: abis.programme, functionName: 'setFrozen', args: [w, on],
  }]);

  return (
    <Panel title="Identity registry" aside={`${identities.length} wallets`} flush>
      <div className="tbl-scroll">
        <table className="tbl">
          <thead><tr><th>Entity</th><th>Jurisdiction</th><th>Type</th><th>Status</th><th className="num">Actions</th></tr></thead>
          <tbody>
            {identities.map(({address, identity}) => {
              const eligible = identity.kyc && identity.accredited && identity.country !== 408;
              return (
                <tr key={address}>
                  <td className="nowrap">{identity.displayName}<span className="sub mono">{address}</span></td>
                  <td>{COUNTRIES[identity.country] ?? identity.country}</td>
                  <td>{CATEGORIES[identity.category]}</td>
                  <td>{!identity.kyc ? <Tag tone="alert">Revoked</Tag> : eligible ? <Tag tone="ok">Eligible</Tag> : <Tag>Counterparty</Tag>}</td>
                  <td className="num"><div className="row-actions" style={{justifyContent: 'flex-end'}}>
                    {identity.kyc && <button type="button" className="link" disabled={!agent} onClick={() => revoke(address)}>Revoke</button>}
                    {eligible && <button type="button" className="link" disabled={!me?.roles.agent} onClick={() => freeze(address, true)}>Freeze</button>}
                    <button type="button" className="link" disabled={!me?.roles.agent} onClick={() => freeze(address, false)}>Unfreeze</button>
                  </div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="panel-body" style={{borderTop: '1px solid var(--line)'}}>
        <h3 style={{marginBottom: 10}}>Onboard wallet</h3>
        <div className="form-row">
          <Field label="Wallet address"><input value={form.wallet} onChange={set('wallet')} placeholder="0x" /></Field>
          <Field label="Legal name"><input value={form.name} onChange={set('name')} /></Field>
          <Field label="Jurisdiction">
            <select value={form.country} onChange={set('country')}>
              {Object.entries(COUNTRIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Type">
            <select value={form.category} onChange={set('category')}>
              {CATEGORIES.slice(1).map((c, i) => <option key={c} value={i + 1}>{c}</option>)}
            </select>
          </Field>
          <label className="check"><input type="checkbox" checked={form.accredited} onChange={set('accredited')} /> Accredited / institutional</label>
          <Action onClick={register} disabled={!agent || !isAddress(form.wallet) || !form.name}>Register</Action>
        </div>
        <Needs ok={agent}>Requires the registry agent role.</Needs>
      </div>
    </Panel>
  );
}

const STATION_KEYS = ['PH-MARIKINA-STO-NINO', 'VN-SAIGON-PHU-AN', 'ID-CILIWUNG-MANGGARAI'];

function Platform() {
  const data = useData();
  const {run} = useTx();
  const {me, contracts, locations, programmes, issuanceFeeBps} = data;
  const [f, setF] = useState({name: 'ParaCat Recovery Notes 2026-B', symbol: 'PRN26B', size: '15000000', termDays: '365', termMinutes: '', dispute: '60'});
  const set = (k) => (e) => setF((s) => ({...s, [k]: e.target.value}));
  let size = 0n;
  try { size = parseAmount(f.size); } catch { /* invalid input */ }
  const fee = (size * BigInt(issuanceFeeBps)) / 10_000n;
  const term = f.termMinutes ? Number(f.termMinutes) * 60 : Number(f.termDays) * 86400;

  const issue = () => {
    const locs = locations.map((l, i) => ({
      name: l.location.name, country: l.location.country,
      stationId: l.location.stationId ?? keccak256(toBytes(STATION_KEYS[i])),
      cedent: l.location.cedent, cedentName: l.location.cedentName,
      sublimitBps: Number(l.location.sublimitBps), premiumRateBps: Number(l.location.premiumRateBps),
      tiers: l.tiers.map((t) => ({rainfallMmX10: Number(t.rainfallMmX10), riverLevelCm: Number(t.riverLevelCm), payoutBps: Number(t.payoutBps)})),
    }));
    const cfg = {
      name: f.name, symbol: f.symbol, peril: data.info.peril, admin: me.address,
      targetSize: size, minSubscription: 250_000_000_000n, termSeconds: BigInt(term),
      disputeWindow: BigInt(Number(f.dispute)), bufferBps: 2_000, servicingFeeBps: 500,
    };
    const steps = [];
    if (me.allowance.factory < fee) {
      steps.push({label: 'Approve issuance fee', address: contracts.usdc, abi: abis.usdc, functionName: 'approve', args: [contracts.factory, fee]});
    }
    steps.push({label: 'Issue programme', address: contracts.factory, abi: abis.factory, functionName: 'createProgramme', args: [cfg, locs]});
    run(`Issue ${f.name}`, steps);
  };

  return (
    <Panel title="Issuance" aside="EIP-1167 template clones">
      <Ledger rows={[
        ['Programmes', programmes.length],
        ['Issuance fee', `${fmtPct(issuanceFeeBps, 2)} of notional`],
        ['Servicing fee', `${fmtPct(data.info.servicingFeeBps, 0)} of premium`],
        ['Treasury', fmtAmount(data.balances.treasury), 'is-strong'],
      ]} />
      <div style={{marginTop: 12}}>
        <Field label="Active programme">
          <select value={data.programme} onChange={(e) => data.setProgramme(e.target.value)}>
            {programmes.map((p, i) => <option key={p} value={p}>{i + 1}. {short(p)}</option>)}
          </select>
        </Field>
      </div>
      <h3 style={{margin: '18px 0 10px'}}>New programme</h3>
      <div className="form-grid">
        <Field label="Name"><input value={f.name} onChange={set('name')} /></Field>
        <Field label="Symbol"><input value={f.symbol} onChange={set('symbol')} /></Field>
        <Field label="Notional (tUSDC)"><input inputMode="decimal" value={f.size} onChange={set('size')} /></Field>
        <Field label="Term (days)"><input inputMode="numeric" value={f.termDays} onChange={set('termDays')} disabled={Boolean(f.termMinutes)} /></Field>
        <Field label="Term (minutes, demo)"><input inputMode="numeric" value={f.termMinutes} onChange={set('termMinutes')} /></Field>
        <Field label="Dispute window (s)"><input inputMode="numeric" value={f.dispute} onChange={set('dispute')} /></Field>
      </div>
      <p className="muted small" style={{margin: '8px 0 12px'}}>Uses the current locations, cedents and trigger tiers.</p>
      <Action onClick={issue} disabled={!me?.roles.issuer || size === 0n || !(term > 0)}>Issue programme ({fmtAmount(fee)} fee)</Action>
      <Needs ok={me?.roles.issuer}>Requires the issuer role.</Needs>
    </Panel>
  );
}

function DemoTools() {
  const data = useData();
  const w = useWallet();
  const {run, rpc} = useTx();
  const now = chainNow(data, useNow(1000));
  const skip = (secs, label) => rpc(label, [['evm_increaseTime', [Math.ceil(secs)]], ['evm_mine', []]]);
  const faucet = () => run('Get 10,000,000 test tUSDC', [{
    label: 'Faucet', address: data.contracts.usdc, abi: abis.usdc, functionName: 'faucet', args: [10_000_000_000_000n],
  }]);
  return (
    <Panel title="Test environment" note={<>Factory <Addr address={data.contracts.factory} plain />, oracle <Addr address={data.contracts.oracle} plain />, registry <Addr address={data.contracts.registry} plain />, tMMF <Addr address={data.contracts.fund} plain /></>}>
      <div className="actions">
        <Action kind="quiet" onClick={faucet} disabled={!data.me}>Faucet: 10m tUSDC</Action>
        {data.me && <span className="muted small">Gas balance {(Number(data.me.eth) / 1e18).toFixed(4)} ETH</span>}
      </div>
      {w.isLocal && (
        <>
          <p className="muted small" style={{margin: '12px 0 8px'}}>Chain time {new Date(now * 1000).toLocaleString('en-SG')}. Observations older than 6 hours expire after a time skip.</p>
          <div className="actions">
            <button type="button" className="btn btn-quiet" onClick={() => skip(60, 'Skip 1 minute')}>+1 min</button>
            <button type="button" className="btn btn-quiet" onClick={() => skip(3600, 'Skip 1 hour')}>+1 h</button>
            <button type="button" className="btn btn-quiet" onClick={() => skip(86400 * 30, 'Skip 30 days')}>+30 d</button>
            {data.info.phase === 1 && (
              <button type="button" className="btn btn-quiet" onClick={() => skip(Number(data.info.riskEnd) - now + 5, 'Skip to end of risk period')}>End of risk period</button>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}

export default function Operations() {
  const data = useData();
  return (
    <div className="view">
      <PageHeader crumbs={`Programmes / ${data.info.symbol}`} title="Operations" />
      <Lifecycle />
      <Onboarding />
      <div className="grid-2">
        <Platform />
        <DemoTools />
      </div>
    </div>
  );
}
