import {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';
import {createPublicClient, createWalletClient, custom, http} from 'viem';
import {mnemonicToAccount} from 'viem/accounts';
import {ANVIL_MNEMONIC, LOCAL_ACTORS, NETWORK_KEY, chainFor, deployments, explorerFor, pickDeployment} from '../config.js';

const WalletContext = createContext(null);
export const useWallet = () => useContext(WalletContext);

const accountCache = new Map();
function demoAccount(index) {
  if (!accountCache.has(index)) accountCache.set(index, mnemonicToAccount(ANVIL_MNEMONIC, {addressIndex: index}));
  return accountCache.get(index);
}

async function ensureChain(provider, chain) {
  const hex = `0x${chain.id.toString(16)}`;
  try {
    await provider.request({method: 'wallet_switchEthereumChain', params: [{chainId: hex}]});
  } catch (error) {
    if (error?.code !== 4902) throw error;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: hex,
        chainName: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: chain.rpcUrls.default.http,
        blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : undefined,
      }],
    });
  }
}

/**
 * Three ways to sign:
 *  - demo:     Anvil's built-in test accounts, switchable by role (local chain only)
 *  - injected: MetaMask or any EIP-1193 browser wallet
 *  - privy:    Privy wallet login (when VITE_PRIVY_APP_ID is set), as in the course lab
 */
export function WalletProvider({privy, children}) {
  const [deployment, setDeployment] = useState(pickDeployment);
  const chain = useMemo(() => (deployment ? chainFor(deployment.chainId) : null), [deployment]);
  const isLocal = deployment?.profile === 'local';

  // Batch reads through Multicall3 when the network has it (Sepolia does), to stay inside
  // free RPC rate limits; fall back to plain calls otherwise.
  const [multicall, setMulticall] = useState(false);
  useEffect(() => {
    const mc = chain?.contracts?.multicall3?.address;
    setMulticall(false);
    if (!mc) return;
    createPublicClient({chain, transport: http(chain.rpcUrls.default.http[0])})
      .getCode({address: mc}).then((code) => setMulticall(Boolean(code && code !== '0x'))).catch(() => {});
  }, [chain]);

  const publicClient = useMemo(() => {
    if (!chain) return null;
    return createPublicClient({
      chain,
      transport: http(chain.rpcUrls.default.http[0]),
      batch: multicall ? {multicall: true} : undefined,
      pollingInterval: isLocal ? 1_000 : 4_000,
    });
  }, [chain, isLocal, multicall]);

  const [mode, setMode] = useState(isLocal ? 'demo' : null);
  const [actorKey, setActorKey] = useState('ops');
  const [browserAccount, setBrowserAccount] = useState(null);

  const actors = useMemo(() => {
    if (!isLocal) return [];
    return LOCAL_ACTORS.map((a) => ({...a, address: demoAccount(a.index).address}));
  }, [isLocal]);

  const privyWallet = privy?.wallets?.[0] ?? null;

  let account = null;
  if (mode === 'demo') account = actors.find((a) => a.key === actorKey)?.address ?? null;
  if (mode === 'injected') account = browserAccount;
  if (mode === 'privy') account = privyWallet?.address ?? null;

  useEffect(() => {
    if (mode !== 'injected' || !window.ethereum?.on) return undefined;
    const onAccounts = (list) => setBrowserAccount(list?.[0] ?? null);
    window.ethereum.on('accountsChanged', onAccounts);
    return () => window.ethereum.removeListener?.('accountsChanged', onAccounts);
  }, [mode]);

  useEffect(() => {
    if (privyWallet && mode !== 'demo') setMode('privy');
  }, [privyWallet, mode]);

  const connectBrowser = useCallback(async () => {
    if (privy?.connectWallet) {
      privy.connectWallet();
      return;
    }
    if (!window.ethereum) throw new Error('No browser wallet found. Install MetaMask, or use the local demo accounts.');
    const list = await window.ethereum.request({method: 'eth_requestAccounts'});
    await ensureChain(window.ethereum, chain);
    setBrowserAccount(list[0]);
    setMode('injected');
  }, [privy, chain]);

  const selectDemo = useCallback(() => setMode('demo'), []);
  const disconnect = useCallback(() => {
    setBrowserAccount(null);
    setMode(isLocal ? 'demo' : null);
  }, [isLocal]);

  const getWalletClient = useCallback(async (asActorKey) => {
    if (mode === 'demo' || asActorKey) {
      const actor = actors.find((a) => a.key === (asActorKey ?? actorKey));
      if (!actor) throw new Error('Demo accounts only exist on the local chain.');
      return createWalletClient({account: demoAccount(actor.index), chain, transport: http(chain.rpcUrls.default.http[0])});
    }
    if (mode === 'privy' && privyWallet) {
      await privyWallet.switchChain(chain.id);
      const provider = await privyWallet.getEthereumProvider();
      return createWalletClient({account: privyWallet.address, chain, transport: custom(provider)});
    }
    if (mode === 'injected' && browserAccount) {
      await ensureChain(window.ethereum, chain);
      return createWalletClient({account: browserAccount, chain, transport: custom(window.ethereum)});
    }
    throw new Error('Connect a wallet first.');
  }, [mode, actors, actorKey, chain, privyWallet, browserAccount]);

  const switchNetwork = useCallback((chainId) => {
    const next = deployments.find((d) => d.chainId === Number(chainId));
    if (!next) return;
    try { localStorage.setItem(NETWORK_KEY, String(next.chainId)); } catch { /* storage unavailable */ }
    setDeployment(next);
    setMode(next.profile === 'local' ? 'demo' : null);
    setBrowserAccount(null);
  }, []);

  const value = {
    deployment, chain, publicClient, isLocal,
    explorer: deployment ? explorerFor(deployment.chainId) : null,
    mode, account, actors, actorKey, setActorKey,
    connectBrowser, selectDemo, disconnect, getWalletClient, switchNetwork,
    privyEnabled: Boolean(privy), privyReady: privy?.ready ?? true,
  };
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
