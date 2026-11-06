import {useEffect, useState} from 'react';
import {isAddress} from 'viem';
import {abis} from '../abi/index.js';
import {useData} from '../state/data.jsx';
import {useTx} from '../state/tx.jsx';
import {useWallet} from '../state/wallet.jsx';
import {CATEGORIES, COUNTRIES, TRANSFER_CODES, fmtAmount, fmtDate, parseAmount, toNum} from '../lib/format.js';
import {PageHeader} from '../components/PageHeader.jsx';
import {Action, Field, Ledger, Needs, Panel, Tag} from '../components/ui.jsx';

function Eligibility() {
  const {me} = useData();
  const id = me.identity;
  const now = Date.now() / 1000;
  const rows = [
    ['KYC / AML', id.kyc, id.kyc ? 'Completed' : 'Not on file'],
    ['Investor status', id.accredited, id.accredited ? CATEGORIES[id.category] : (id.kyc ? 'Not eligible (counterparty)' : 'Not on file')],
    ['Jurisdiction', id.kyc && id.country !== 408, COUNTRIES[id.country] ?? 'Not on file'],
    ['Valid until', Number(id.expiresAt) > now, id.expiresAt > 0n ? fmtDate(id.expiresAt) : 'Not on file'],
  ];
  return (
    <Panel title="Investor profile" aside={<Tag tone={me.verified ? 'ok' : 'alert'}>{me.verified ? 'Eligible' : 'Not eligible'}</Tag>}
      note="Holdings and transfers are checked against the on-chain identity registry (ERC-3643 model).">
      <ul className="checklist">
        {rows.map(([label, ok, value]) => (
          <li key={label}><span>{label}</span><span className={ok ? 'pos' : 'neg'}>{value}</span></li>
        ))}
      </ul>
      <Needs ok={me.verified}>Wallet must be onboarded by Parapet Operations before subscribing.</Needs>
    </Panel>
  );
}

function Position() {
  const data = useData();
  const {run} = useTx();
  const {explorer} = useWallet();
  const {me, info, programme} = data;
  const supply = toNum(info.phase === 0 ? info.totalSubscribed : info.principal) || 1;
  const share = (toNum(me.notes) / supply) * 100;
  const claim = () => run('Claim coupons', [{label: 'Claim', address: programme, abi: abis.programme, functionName: 'claimCoupon'}]);
  const redeem = () => run('Redeem notes', [{label: 'Redeem', address: programme, abi: abis.programme, functionName: 'redeem', args: [me.notes]}]);
  return (
    <Panel title="Position" aside={explorer && <a href={`${explorer}/token/${programme}?a=${me.address}`} target="_blank" rel="noreferrer">Etherscan</a>}>
      <Ledger rows={[
        ['Holding', `${fmtAmount(me.notes)} ${info.symbol}`, 'is-strong'],
        ['Share of issue', `${share.toFixed(2)}%`],
        ['Principal value', fmtAmount(me.redeemableValue)],
        ['Accrued coupon', fmtAmount(me.pendingCoupon, 2), 'is-live'],
        ['Coupons received', fmtAmount(me.claimedCoupons, 2)],
        me.frozen && ['Status', 'Frozen by transfer agent', 'is-alert'],
      ]} />
      <div className="actions" style={{marginTop: 12}}>
        <Action onClick={claim} disabled={me.pendingCoupon === 0n}>Claim {fmtAmount(me.pendingCoupon, 2)} tUSDC</Action>
        {info.phase === 3 && <Action onClick={redeem} disabled={me.notes === 0n}>Redeem all notes</Action>}
      </div>
    </Panel>
  );
}

function Subscribe() {
  const data = useData();
  const {run} = useTx();
  const {me, info, contracts, programme} = data;
  const remaining = toNum(info.targetSize) - toNum(info.totalSubscribed);
  const [amount, setAmount] = useState('');
  const value = amount === '' ? Math.min(remaining, toNum(me.usdc)) : Number(amount.replace(/,/g, ''));
  const raw = parseAmount(String(value || 0));

  if (remaining <= 0) {
    return <Panel title="Primary subscription"><p className="muted">Fully subscribed at {fmtAmount(info.targetSize)}. Awaiting book close.</p></Panel>;
  }
  const subscribe = () => {
    const steps = [];
    if (me.allowance.programme < raw) {
      steps.push({label: 'Approve tUSDC', address: contracts.usdc, abi: abis.usdc, functionName: 'approve', args: [programme, raw]});
    }
    steps.push({label: 'Subscribe', address: programme, abi: abis.programme, functionName: 'subscribe', args: [raw]});
    run(`Subscribe ${fmtAmount(value)} tUSDC`, steps, {onDone: () => setAmount('')});
  };
  const faucet = () => run('Get 10,000,000 test tUSDC', [{
    label: 'Faucet', address: contracts.usdc, abi: abis.usdc, functionName: 'faucet', args: [10_000_000_000_000n],
  }]);
  return (
    <Panel title="Primary subscription" aside={`Available ${fmtAmount(remaining)}`}
      note={`Issue price 1.00 tUSDC per note. Minimum 250,000. Cash balance ${fmtAmount(me.usdc)} tUSDC.`}>
      <div className="form-row">
        <Field label="Amount (tUSDC)">
          <input inputMode="decimal" value={amount} placeholder={fmtAmount(value)} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Action onClick={subscribe} disabled={!me.verified || !(value > 0)}>Subscribe {value > 0 ? fmtAmount(value) : ''}</Action>
        <Action kind="quiet" onClick={faucet}>Get test tUSDC</Action>
      </div>
    </Panel>
  );
}

function Transfer() {
  const data = useData();
  const {publicClient} = useWallet();
  const {run} = useTx();
  const {me, identities, programme} = data;
  const [to, setTo] = useState('');
  const [custom, setCustom] = useState('');
  const [amount, setAmount] = useState('1,000,000');
  const [check, setCheck] = useState(null);
  const target = to === 'custom' ? custom : to;
  const raw = (() => { try { return parseAmount(amount); } catch { return 0n; } })();

  useEffect(() => {
    let live = true;
    if (!isAddress(target || '')) { setCheck(null); return undefined; }
    publicClient.readContract({address: programme, abi: abis.programme, functionName: 'canTransfer', args: [me.address, target, raw]})
      .then((code) => live && setCheck(Number(code))).catch(() => live && setCheck(null));
    return () => { live = false; };
  }, [target, raw, me.address, programme, publicClient, me.notes]);

  const send = () => run(`Transfer ${amount} notes`, [{
    label: 'Transfer', address: programme, abi: abis.programme, functionName: 'transfer', args: [target, raw],
  }]);
  return (
    <Panel title="Secondary transfer" aside="Pre-trade compliance check">
      <div className="form-row">
        <Field label="Counterparty">
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Select wallet</option>
            {identities.filter((i) => i.address.toLowerCase() !== me.address.toLowerCase()).map((i) => (
              <option key={i.address} value={i.address}>{i.identity.displayName || i.address}</option>
            ))}
            <option value="custom">Other address</option>
          </select>
        </Field>
        {to === 'custom' && <Field label="Address"><input value={custom} onChange={(e) => setCustom(e.target.value.trim())} placeholder="0x" /></Field>}
        <Field label="Notes"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Action onClick={send} disabled={check !== 0}>Transfer</Action>
      </div>
      {check != null && (
        <p className={check === 0 ? 'compliance ok' : 'compliance no'} role="status">
          {check === 0 ? 'Compliance: pass' : `Compliance: blocked (code ${check}). ${TRANSFER_CODES[check]}`}
        </p>
      )}
    </Panel>
  );
}

export default function Invest() {
  const data = useData();
  const {mode} = useWallet();
  if (!data.me) return <div className="view"><PageHeader title="Invest" /><p className="empty">Connect a wallet.</p></div>;
  const {info, programme} = data;
  const addToWallet = () => window.ethereum.request({
    method: 'wallet_watchAsset',
    params: {type: 'ERC20', options: {address: programme, symbol: info.symbol.slice(0, 11), decimals: 6}},
  });
  return (
    <div className="view">
      <PageHeader crumbs={`Programmes / ${info.symbol}`} title="Invest"
        meta={mode === 'injected' && window.ethereum && <button type="button" className="link" onClick={addToWallet}>Add {info.symbol} to MetaMask</button>} />
      <div className="grid-2">
        <Eligibility />
        <Position />
      </div>
      {info.phase === 0 && <Subscribe />}
      <Transfer />
    </div>
  );
}
