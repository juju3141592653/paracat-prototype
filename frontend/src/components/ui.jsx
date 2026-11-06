import {useData} from '../state/data.jsx';
import {useTx} from '../state/tx.jsx';
import {useWallet} from '../state/wallet.jsx';
import {short} from '../lib/format.js';

export function Addr({address, plain = false}) {
  const {nameOf} = useData();
  const {explorer} = useWallet();
  if (!address) return null;
  const label = nameOf(address);
  const isName = !label.includes('…');
  const body = <>{label}{isName && !plain && <span className="addr-hex"> {short(address)}</span>}</>;
  return explorer
    ? <a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer">{body}</a>
    : <span title={address}>{body}</span>;
}

export function TxLink({hash, children}) {
  const {explorer} = useWallet();
  if (!hash) return null;
  return explorer
    ? <a href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer">{children ?? short(hash)}</a>
    : <span title={hash}>{children ?? short(hash)}</span>;
}

/** A button wired to the transaction runner: disabled while anything is signing. */
export function Action({onClick, disabled, kind = 'primary', children, title}) {
  const {pending} = useTx();
  return (
    <button type="button" className={`btn btn-${kind}`} onClick={onClick}
      disabled={disabled || Boolean(pending)} title={title}>
      {children}
    </button>
  );
}

export function Needs({ok, children}) {
  if (ok) return null;
  return <p className="needs">{children}</p>;
}

export function Field({label, hint, children}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Panel({title, aside, flush = false, note, className = '', children}) {
  return (
    <section className={`panel ${className}`}>
      {(title || aside) && (
        <header className="panel-head">
          {title && <h2>{title}</h2>}
          {aside && <div className="panel-aside">{aside}</div>}
        </header>
      )}
      <div className={flush ? 'panel-body flush' : 'panel-body'}>{children}</div>
      {note && <div className="panel-note">{note}</div>}
    </section>
  );
}

export function Ledger({rows}) {
  return (
    <dl className="kv">
      {rows.filter(Boolean).map(([k, v, cls]) => (
        <div key={k} className={cls}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tag({tone = 'muted', children}) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}
