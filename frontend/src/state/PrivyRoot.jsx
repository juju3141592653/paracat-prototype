import {PrivyProvider, useConnectWallet, usePrivy, useWallets} from '@privy-io/react-auth';
import App from '../App.jsx';
import {chainFor, pickDeployment} from '../config.js';

function Bridge() {
  const {ready} = usePrivy();
  const {wallets} = useWallets();
  const {connectWallet} = useConnectWallet();
  return <App privy={{ready, wallets, connectWallet}} />;
}

export default function PrivyRoot({appId}) {
  const chain = chainFor(pickDeployment()?.chainId ?? 11155111);
  return (
    <PrivyProvider appId={appId} config={{
      supportedChains: [chain],
      defaultChain: chain,
      appearance: {walletChainType: 'ethereum-only', walletList: ['metamask', 'detected_wallets']},
    }}>
      <Bridge />
    </PrivyProvider>
  );
}
