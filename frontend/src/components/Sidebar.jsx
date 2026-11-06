import {useState} from 'react';
import {deployments} from '../config.js';
import {useWallet} from '../state/wallet.jsx';
import {useData} from '../state/data.jsx';
import {describeError} from '../lib/errors.js';
import {fmtAmount, short} from '../lib/format.js';

function Mark() {
  return (
    <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M3 28V11h5.5v5h4v-5h7v5h4v-5H29v17z" />
    </svg>
  );
}

const NETWORK_NAMES = {31337: 'Local (Anvil)', 11155111: 'Sepolia', 84532: 'Base Sepolia'};

export function Sidebar({tab, setTab, tabs}) {
  const w = useWallet();
  const data = useData();
  const [err, setErr] = useState('');
  const me = data.me;
  const r = me?.roles ?? {};
  const roles = [
    r.manager && 'Manager', r.agent && 'Transfer agent', r.guardian && 'Guardian',
    r.provider && 'Data provider', r.issuer && 'Issuer', me?.verified && 'Eligible investor',
  ].filter(Boolean);
  const connect = () => w.connectBrowser().catch((e) => setErr(describeError(e)));

  return (
    <aside className="sidebar">
      <a className="brand" href="#overview" onClick={() => setTab('overview')}>
        <Mark />
        <span>
          <span className="brand-name">Parapet</span>
          <span className="brand-sub">ParaCat platform</span>
        </span>
      </a>

      <nav className="nav" aria-label="Sections">
        {tabs.map(([key, label]) => (
          <a key={key} href={`#${key}`} className={tab === key ? 'is-active' : undefined}
            aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>
            {label}
          </a>
        ))}
      </nav>

      <div className="side-foot">
        <div className="side-section">
          <span className="side-label">Network</span>
          {deployments.length > 1 ? (
            <select aria-label="Network" value={w.deployment?.chainId} onChange={(e) => w.switchNetwork(e.target.value)}>
              {deployments.map((d) => <option key={d.chainId} value={d.chainId}>{NETWORK_NAMES[d.chainId] ?? `Chain ${d.chainId}`}</option>)}
            </select>
          ) : (
            <span>{NETWORK_NAMES[w.deployment?.chainId] ?? `Chain ${w.deployment?.chainId}`}</span>
          )}
          <span className="status-line" title={data.error || undefined}>
            <i className={`dot ${data.error ? 'is-down' : ''}`} aria-hidden="true" />
            {data.error ? 'Reconnecting' : `Synced, block ${data.blockNumber?.toLocaleString('en-US') ?? '…'}`}
          </span>
        </div>

        <div className="side-section">
          <span className="side-label">Account</span>
          {w.mode === 'demo' && (
            <select className="actor" aria-label="Acting as" value={w.actorKey} onChange={(e) => w.setActorKey(e.target.value)}>
              {w.actors.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
            </select>
          )}
          {w.mode !== 'demo' && !w.account && (
            <button type="button" className="btn btn-primary" disabled={!w.privyReady} onClick={connect}>Connect wallet</button>
          )}
          {me && (
            <div className="account">
              <strong>{data.nameOf(me.address)}</strong>
              <code>{short(me.address)}</code>
              <span>{fmtAmount(me.usdc)} tUSDC, {fmtAmount(me.notes)} {data.info?.symbol}</span>
              {roles.length > 0 && <span className="account-roles">{roles.join(', ')}</span>}
            </div>
          )}
          <div className="side-actions">
            {w.isLocal && w.mode === 'demo' && <button type="button" className="link" onClick={connect}>Use browser wallet</button>}
            {w.isLocal && w.mode !== 'demo' && <button type="button" className="link" onClick={w.selectDemo}>Use demo accounts</button>}
            {w.mode !== 'demo' && w.account && <button type="button" className="link" onClick={w.disconnect}>Disconnect</button>}
          </div>
          {err && <p className="needs" role="alert">{err}</p>}
        </div>
      </div>
    </aside>
  );
}
