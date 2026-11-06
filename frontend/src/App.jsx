import {useEffect, useState} from 'react';
import {WalletProvider, useWallet} from './state/wallet.jsx';
import {DataProvider, useData} from './state/data.jsx';
import {TxProvider} from './state/tx.jsx';
import {Sidebar} from './components/Sidebar.jsx';
import {Toasts} from './components/Toasts.jsx';
import Overview from './views/Overview.jsx';
import Invest from './views/Invest.jsx';
import Insurer from './views/Insurer.jsx';
import Trigger from './views/Trigger.jsx';
import Operations from './views/Operations.jsx';

const TABS = [
  ['overview', 'Overview'],
  ['invest', 'Invest'],
  ['insurer', 'Cedents'],
  ['trigger', 'Trigger monitor'],
  ['operations', 'Operations'],
];

const fromHash = () => {
  const h = window.location.hash.replace('#', '');
  return TABS.some(([k]) => k === h) ? h : 'overview';
};

function Shell() {
  const w = useWallet();
  const data = useData();
  const [tab, setTab] = useState(fromHash);
  const [triggerLoc, setTriggerLoc] = useState(0);
  useEffect(() => {
    const on = () => setTab(fromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const goTrigger = (i) => { setTriggerLoc(i); setTab('trigger'); window.location.hash = 'trigger'; };

  if (!w.deployment) {
    return (
      <main className="setup">
        <h1>No deployment found</h1>
        <p>Run the deploy script. It writes <code>src/deployments/&lt;chainId&gt;.json</code>, which this app reads.</p>
      </main>
    );
  }

  let body;
  if (data.loading) body = <p className="empty">Loading programme data</p>;
  else if (!data.info) {
    body = (
      <div className="setup">
        <h1>Chain unavailable</h1>
        <p>{data.error}</p>
        <p className="muted">{w.isLocal ? 'Start the local node (anvil --block-time 1), deploy, then reload.' : 'Check VITE_RPC_URL in .env.local.'}</p>
      </div>
    );
  } else {
    body = {
      overview: <Overview goTrigger={goTrigger} />,
      invest: <Invest />,
      insurer: <Insurer />,
      trigger: <Trigger key={triggerLoc} initial={triggerLoc} />,
      operations: <Operations />,
    }[tab];
  }

  return (
    <div className="app">
      <Sidebar tab={tab} setTab={setTab} tabs={TABS} />
      <main className="main">
        {data.error && data.info && <p className="banner" style={{marginTop: 16}}>RPC error: {data.error}. Retrying.</p>}
        {body}
        <p className="foot">Parapet Digital (fictional) prototype on {w.isLocal ? 'a local test chain' : 'a public testnet'}. Test assets only. Thresholds and counterparties are illustrative.</p>
      </main>
      <Toasts />
    </div>
  );
}

export default function App({privy}) {
  return (
    <WalletProvider privy={privy}>
      <DataProvider>
        <TxProvider>
          <Shell />
        </TxProvider>
      </DataProvider>
    </WalletProvider>
  );
}
