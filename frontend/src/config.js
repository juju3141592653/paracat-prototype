import {defineChain} from 'viem';
import {sepolia, baseSepolia} from 'viem/chains';

// Every `forge script ... Deploy.s.sol --broadcast` writes src/deployments/<chainId>.json.
const files = import.meta.glob('./deployments/*.json', {eager: true, import: 'default'});
export const deployments = Object.values(files).sort((a, b) => a.chainId - b.chainId);

const anvil = defineChain({
  id: 31337,
  name: 'Local Anvil chain',
  nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18},
  rpcUrls: {default: {http: ['http://127.0.0.1:8545']}},
  testnet: true,
});

const knownChains = {31337: anvil, 11155111: sepolia, 84532: baseSepolia};

export function chainFor(chainId) {
  const base = knownChains[chainId] ?? defineChain({
    id: chainId, name: `Chain ${chainId}`,
    nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18},
    rpcUrls: {default: {http: []}},
  });
  // A configured RPC URL (e.g. your Alchemy Sepolia endpoint) wins over the public default.
  const override = Number(import.meta.env.VITE_CHAIN_ID) === chainId && import.meta.env.VITE_RPC_URL;
  return override
    ? {...base, rpcUrls: {...base.rpcUrls, default: {http: [import.meta.env.VITE_RPC_URL]}}}
    : base;
}

export function explorerFor(chainId) {
  return knownChains[chainId]?.blockExplorers?.default?.url ?? null;
}

export const NETWORK_KEY = 'paracat.network';

export function pickDeployment() {
  let saved = null;
  try { saved = Number(localStorage.getItem(NETWORK_KEY)); } catch { /* storage unavailable */ }
  const wanted = saved || Number(import.meta.env.VITE_CHAIN_ID) || null;
  return deployments.find((d) => d.chainId === wanted)
    ?? deployments.find((d) => d.profile === 'testnet')
    ?? deployments[0]
    ?? null;
}

export const privyAppId = import.meta.env.VITE_PRIVY_APP_ID || '';

// Anvil's public test mnemonic. These keys are published by Foundry and only ever hold
// worthless local test funds. Never use them on a public network.
export const ANVIL_MNEMONIC = 'test test test test test test test test test test test junk';

// The cast of the local demo. `index` is the account index in Anvil's mnemonic.
export const LOCAL_ACTORS = [
  {key: 'ops', index: 0, name: 'Parapet Operations', role: 'Issuer, servicing and transfer agent'},
  {key: 'liveInvestor', index: 5, name: 'Harbour Bay ILS Fund', role: 'Investor (Hong Kong)'},
  {key: 'investorA', index: 3, name: 'Straits Pension Fund', role: 'Investor (Singapore)'},
  {key: 'investorB', index: 4, name: 'Lion City Family Office', role: 'Investor (Singapore)'},
  {key: 'cedentManila', index: 6, name: 'Luzon Mutual Insurance', role: 'Insurer, Metro Manila'},
  {key: 'cedentHcmc', index: 7, name: 'Mekong General Insurance', role: 'Insurer, Ho Chi Minh City'},
  {key: 'cedentJakarta', index: 8, name: 'Nusantara Mutual Assurance', role: 'Insurer, Jakarta'},
  {key: 'feedA', index: 1, name: 'Feed A', role: 'Oracle: river gauge telemetry'},
  {key: 'feedB', index: 2, name: 'Feed B', role: 'Oracle: satellite rainfall'},
  {key: 'guardian', index: 9, name: 'Independent Dispute Committee', role: 'Guardian'},
];
