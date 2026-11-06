import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {keccak256, parseEventLogs, toBytes, zeroHash} from 'viem';
import {abis, allEventsAndErrors} from '../abi/index.js';
import {useWallet} from './wallet.jsx';

const DataContext = createContext(null);
export const useData = () => useContext(DataContext);

const role = (name) => keccak256(toBytes(name));
export const ROLES = {
  admin: zeroHash,
  manager: role('MANAGER_ROLE'),
  agent: role('AGENT_ROLE'),
  guardian: role('GUARDIAN_ROLE'),
  provider: role('PROVIDER_ROLE'),
  issuer: role('ISSUER_ROLE'),
};

let logChunk = 2_000n; // shrinks automatically if the RPC provider limits eth_getLogs ranges

export function DataProvider({children}) {
  const {deployment, publicClient, account, isLocal, actors} = useWallet();
  const c = deployment?.contracts;
  const [programme, setProgramme] = useState(c?.programme ?? null);
  const [state, setState] = useState({loading: true});
  const [events, setEvents] = useState([]);
  const logCursor = useRef(null);
  const blockTimes = useRef(new Map());
  const busy = useRef(false);
  const [tick, setTick] = useState(0);

  useEffect(() => { setProgramme(c?.programme ?? null); }, [c?.programme]);
  useEffect(() => { logCursor.current = null; setEvents([]); }, [programme, deployment]);

  const read = useCallback((address, abi, functionName, args = []) =>
    publicClient.readContract({address, abi, functionName, args}), [publicClient]);

  const load = useCallback(async () => {
    if (!publicClient || !c || !programme) return;
    const P = abis.programme;
    const [block, programmes, info, payoutRequests, quorum, maxAge, providers, nav, apyBps, accel,
      settlementDelay, instantLimit, issuanceFeeBps, wallets] = await Promise.all([
      publicClient.getBlock(),
      read(c.factory, abis.factory, 'getProgrammes'),
      read(programme, P, 'programmeInfo'),
      read(programme, P, 'getPayoutRequests'),
      read(c.oracle, abis.oracle, 'quorum'),
      read(c.oracle, abis.oracle, 'maxAge'),
      read(c.oracle, abis.oracle, 'getProviders'),
      read(c.fund, abis.fund, 'navPerShare'),
      read(c.fund, abis.fund, 'apyBps'),
      read(c.fund, abis.fund, 'timeAcceleration'),
      read(c.fund, abis.fund, 'settlementDelay'),
      read(c.fund, abis.fund, 'instantLiquidityLimit'),
      read(c.factory, abis.factory, 'issuanceFeeBps'),
      read(c.registry, abis.registry, 'getWallets'),
    ]);

    const count = Number(info.locationCount);
    const locations = await Promise.all(
      Array.from({length: count}, (_, i) => read(programme, P, 'getLocation', [BigInt(i)])
        .then((v) => ({...v, index: i}))),
    );

    const stations = {};
    await Promise.all(locations.map(async (l) => {
      const id = l.location.stationId;
      const [station, consensus, readings] = await Promise.all([
        read(c.oracle, abis.oracle, 'station', [id]),
        read(c.oracle, abis.oracle, 'consensus', [id]),
        read(c.oracle, abis.oracle, 'getReadings', [id]),
      ]);
      stations[id] = {station, consensus, readings: readings[0].map((p, i) => ({provider: p, ...readings[1][i]}))};
    }));

    const providerNames = await Promise.all(providers.map((p) => read(c.oracle, abis.oracle, 'providerName', [p])));
    const identities = await Promise.all(wallets.map((w) => read(c.registry, abis.registry, 'identityOf', [w])
      .then((identity) => ({address: w, identity}))));

    const fundRequests = await Promise.all(payoutRequests.map((r) =>
      read(c.fund, abis.fund, 'getRequest', [r.fundRequestId])));

    const cedents = [...new Set(locations.map((l) => l.location.cedent))];
    const [treasuryBal, ...cedentBals] = await Promise.all([
      read(c.usdc, abis.usdc, 'balanceOf', [deployment.actors.treasury]),
      ...cedents.map((a) => read(c.usdc, abis.usdc, 'balanceOf', [a])),
    ]);

    let me = null;
    if (account) {
      const [usdc, info2, identity, allowP, allowF, manager, agent, guardian, admin, provider, regAgent, issuer, eth] =
        await Promise.all([
          read(c.usdc, abis.usdc, 'balanceOf', [account]),
          read(programme, P, 'accountInfo', [account]),
          read(c.registry, abis.registry, 'identityOf', [account]),
          read(c.usdc, abis.usdc, 'allowance', [account, programme]),
          read(c.usdc, abis.usdc, 'allowance', [account, c.factory]),
          read(programme, P, 'hasRole', [ROLES.manager, account]),
          read(programme, P, 'hasRole', [ROLES.agent, account]),
          read(programme, P, 'hasRole', [ROLES.guardian, account]),
          read(programme, P, 'hasRole', [ROLES.admin, account]),
          read(c.oracle, abis.oracle, 'hasRole', [ROLES.provider, account]),
          read(c.registry, abis.registry, 'hasRole', [ROLES.agent, account]),
          read(c.factory, abis.factory, 'hasRole', [ROLES.issuer, account]),
          publicClient.getBalance({address: account}),
        ]);
      me = {
        address: account, usdc, ...info2, identity, eth,
        allowance: {programme: allowP, factory: allowF},
        roles: {manager, agent, guardian, admin, provider, registryAgent: regAgent, issuer},
      };
    }

    // Activity feed: decode every event from our contracts since the last poll.
    const latest = block.number;
    let from = logCursor.current ?? BigInt(deployment.startBlock ?? 0);
    const fresh = [];
    while (from <= latest) {
      const to = from + logChunk - 1n < latest ? from + logChunk - 1n : latest;
      let logs;
      try {
        logs = await publicClient.getLogs({
          address: [programme, c.oracle, c.registry, c.factory], fromBlock: from, toBlock: to,
        });
      } catch (error) {
        if (logChunk > 50n) { logChunk /= 4n; continue; }
        throw error;
      }
      fresh.push(...parseEventLogs({abi: allEventsAndErrors, logs}));
      from = to + 1n;
    }
    logCursor.current = latest + 1n;
    if (fresh.length) {
      const missing = [...new Set(fresh.map((l) => l.blockNumber))].filter((b) => !blockTimes.current.has(b));
      const blocks = await Promise.all(missing.map((n) => publicClient.getBlock({blockNumber: n})));
      blocks.forEach((b) => blockTimes.current.set(b.number, Number(b.timestamp)));
      const newestFirst = fresh.map((l) => ({...l, time: blockTimes.current.get(l.blockNumber)})).reverse();
      setEvents((prev) => [...newestFirst, ...prev].slice(0, 400));
    }

    const names = new Map();
    providers.forEach((p, i) => names.set(p.toLowerCase(), providerNames[i]));
    identities.forEach(({address, identity}) => identity.displayName && names.set(address.toLowerCase(), identity.displayName));
    actors.forEach((a) => !names.has(a.address.toLowerCase()) && names.set(a.address.toLowerCase(), a.name));
    names.set(deployment.actors.treasury.toLowerCase(), 'Parapet treasury');
    if (!names.has(deployment.actors.ops.toLowerCase())) names.set(deployment.actors.ops.toLowerCase(), 'Parapet Operations');
    locations.forEach((l) => names.set(l.location.cedent.toLowerCase(), l.location.cedentName));
    names.set(programme.toLowerCase(), info.symbol);

    setState({
      loading: false, error: null,
      chainTime: Number(block.timestamp), fetchedAt: Date.now(), blockNumber: Number(block.number),
      programmes, info, locations, stations,
      payoutRequests: payoutRequests.map((r, i) => ({...r, index: i, fund: fundRequests[i]})),
      oracle: {quorum: Number(quorum), maxAge: Number(maxAge), providers: providers.map((p, i) => ({address: p, name: providerNames[i]}))},
      fund: {nav, apyBps: Number(apyBps), accel: Number(accel), settlementDelay: Number(settlementDelay), instantLimit},
      issuanceFeeBps: Number(issuanceFeeBps),
      identities,
      balances: {treasury: treasuryBal, cedents: Object.fromEntries(cedents.map((a, i) => [a.toLowerCase(), cedentBals[i]]))},
      me, names,
    });
  }, [publicClient, c, programme, account, deployment, actors, read]);

  useEffect(() => {
    let alive = true;
    let timer;
    const loop = async () => {
      if (!alive) return;
      if (!busy.current) {
        busy.current = true;
        try { await load(); } catch (error) {
          setState((s) => ({...s, loading: false, error: error.shortMessage || error.message}));
        } finally { busy.current = false; }
      }
      timer = setTimeout(loop, isLocal ? 1_500 : 5_000);
    };
    loop();
    return () => { alive = false; clearTimeout(timer); };
  }, [load, isLocal, tick]);

  const refresh = useCallback(async () => {
    if (busy.current) { setTick((t) => t + 1); return; }
    busy.current = true;
    try { await load(); } finally { busy.current = false; }
  }, [load]);

  const nameOf = useCallback((addr) => {
    if (!addr) return '';
    return state.names?.get(addr.toLowerCase()) ?? `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  }, [state.names]);

  const value = useMemo(() => ({
    ...state, events, programme, setProgramme, refresh, nameOf, contracts: c,
  }), [state, events, programme, refresh, nameOf, c]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
