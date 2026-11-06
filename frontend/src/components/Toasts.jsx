import {useTx} from '../state/tx.jsx';
import {TxLink} from './ui.jsx';

export function Toasts() {
  const {toasts, dismiss} = useTx();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.status}`}>
          <div className="toast-body">
            <strong>{t.title}</strong>
            <span>{t.detail}</span>
            {t.hash && <TxLink hash={t.hash}>View transaction</TxLink>}
          </div>
          {t.status !== 'working' && (
            <button type="button" className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss">×</button>
          )}
        </div>
      ))}
    </div>
  );
}
