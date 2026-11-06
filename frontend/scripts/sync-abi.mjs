// Copies contract ABIs from Foundry's build output into the frontend.
// Run after `forge build` whenever a contract interface changes:  npm run sync-abi
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../contracts/out');
const dest = resolve(here, '../src/abi');
mkdirSync(dest, {recursive: true});

const contracts = [
  'MockUSDC', 'TokenisedMMF', 'IdentityRegistry', 'FloodOracle', 'ParaCatProgramme', 'ParaCatFactory',
];
for (const name of contracts) {
  const artifact = JSON.parse(readFileSync(`${out}/${name}.sol/${name}.json`, 'utf8'));
  writeFileSync(`${dest}/${name}.json`, JSON.stringify(artifact.abi, null, 2));
  console.log(`  ${name}: ${artifact.abi.length} ABI entries`);
}
console.log('ABIs written to src/abi/');
