import {createContext, useCallback, useContext, useState} from 'react';
import {describeError} from '../lib/errors.js';
import {useWallet} from './wallet.jsx';
import {useData} from './data.jsx';

const TxContext = createContext(null);
export const useTx = () => useContext(TxContext);

let nextId = 1;

/**
 * Every transaction follows the flow taught in the lab:
 * simulate (catches reverts with a readable reason) -> sign -> submit -> wait for receipt -> refresh.
 */
export function TxProvider({children}) {
  const {publicClient, getWalletClient, explorer} = useWallet();
  const {refresh} = useData();
  const [toasts, setToasts] = useState([]);
  const [pending, setPending] = useState(null);

  const update = (id, patch) => setToasts((all) => all.map((t) => (t.id === id ? {...t, ...patch} : t)));
  const dismiss = useCallback((id) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  /**
   * steps: [{label, address, abi, functionName, args, as?}] run in order.
   * `as` lets the local demo sign one step as a specific actor (e.g. both oracle feeds).
   */
  const run = useCallback(async (title, steps, {onDone} = {}) => {
    const id = nextId++;
    setPending(title);
    setToasts((all) => [{id, title, status: 'working', detail: 'Preparing transaction'}, ...all].slice(0, 5));
    try {
      let lastHash;
      for (const [i, step] of steps.entries()) {
        const prefix = steps.length > 1 ? `Step ${i + 1} of ${steps.length}: ` : '';
        update(id, {detail: `${prefix}${step.label}. Simulating`});
        const wallet = await getWalletClient(step.as);
        const {request} = await publicClient.simulateContract({
          address: step.address, abi: step.abi, functionName: step.functionName,
          args: step.args ?? [], account: wallet.account,
        });
        update(id, {detail: `${prefix}${step.label}. Waiting for signature`});
        const hash = await wallet.writeContract(request);
        lastHash = hash;
        update(id, {detail: `${prefix}${step.label}. Confirming`, hash});
        const receipt = await publicClient.waitForTransactionReceipt({hash});
        if (receipt.status !== 'success') throw new Error('The transaction reverted on-chain.');
      }
      update(id, {status: 'done', detail: 'Confirmed on-chain', hash: lastHash});
      setTimeout(() => dismiss(id), 9_000);
      await refresh();
      onDone?.();
      return true;
    } catch (error) {
      update(id, {status: 'error', detail: describeError(error)});
      setTimeout(() => dismiss(id), 20_000);
      return false;
    } finally {
      setPending(null);
    }
  }, [publicClient, getWalletClient, refresh, dismiss]);

  /** Raw JSON-RPC helper for the local chain's time controls. */
  const rpc = useCallback(async (title, calls) => {
    const id = nextId++;
    setToasts((all) => [{id, title, status: 'working', detail: 'Updating local chain'}, ...all].slice(0, 5));
    try {
      for (const [method, params] of calls) await publicClient.request({method, params});
      update(id, {status: 'done', detail: 'Done'});
      setTimeout(() => dismiss(id), 5_000);
      await refresh();
    } catch (error) {
      update(id, {status: 'error', detail: describeError(error)});
    }
  }, [publicClient, refresh, dismiss]);

  return (
    <TxContext.Provider value={{run, rpc, pending, toasts, dismiss, explorer}}>
      {children}
    </TxContext.Provider>
  );
}
