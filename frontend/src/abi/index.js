import usdc from './MockUSDC.json';
import fund from './TokenisedMMF.json';
import registry from './IdentityRegistry.json';
import oracle from './FloodOracle.json';
import programme from './ParaCatProgramme.json';
import factory from './ParaCatFactory.json';

export const abis = {usdc, fund, registry, oracle, programme, factory};

// One ABI with every event and custom error, for decoding logs and revert reasons.
const seen = new Set();
export const allEventsAndErrors = [usdc, fund, registry, oracle, programme, factory]
  .flat()
  .filter((item) => item.type === 'event' || item.type === 'error')
  .filter((item) => {
    const sig = `${item.type}:${item.name}:${item.inputs.map((i) => i.type).join(',')}`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
