# Setup guide for instructors

This guide gets the ParaCat Recovery Notes prototype running on your own computer: you run the
automated contract tests, start a local blockchain, deploy the contracts to it and open the web app.
Everything runs locally. You need no wallet, no cryptocurrency and no API keys.

**Time needed:** about 10–15 minutes the first time (mostly downloads), then about 1 minute after that.

---

## 1. Install the prerequisites

| Tool | Version | Used for |
| --- | --- | --- |
| [Git](https://git-scm.com/downloads) | any recent | Downloading the code |
| [Node.js](https://nodejs.org/) | **22.12 or newer** (the current LTS is fine) | Running the web app |
| [Foundry](https://getfoundry.sh) (`forge`, `anvil`) | any recent | Compiling, testing and deploying the smart contracts |

### macOS or Linux

1. Install Git and Node.js from the links above. On macOS, `brew install git node` also works.
2. Install Foundry:

   ```sh
   curl -L https://foundry.paradigm.xyz | bash
   ```

   Open a **new** terminal window, then run:

   ```sh
   foundryup
   ```

### Windows

Foundry runs on Windows through **WSL** (Windows Subsystem for Linux).

1. Open PowerShell as Administrator and run `wsl --install`, then restart the computer.
2. Open the **Ubuntu** app. From here on, run **every** command in this guide inside that Ubuntu terminal.
3. Inside Ubuntu, install Git, Node.js and Foundry:

   ```sh
   sudo apt update && sudo apt install -y git curl
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
   source ~/.bashrc
   nvm install --lts
   curl -L https://foundry.paradigm.xyz | bash
   source ~/.bashrc
   foundryup
   ```

### Check that everything is installed

```sh
git --version
node --version     # should print v22.12.0 or higher
forge --version
anvil --version
```

---

## 2. Download the code

```sh
git clone https://github.com/juju3141592653/paracat-prototype.git
cd paracat-prototype
```

(You can also click **Code → Download ZIP** on GitHub and unzip it. Windows users should unzip it inside
the Ubuntu terminal's home folder.)

The Solidity libraries (OpenZeppelin 5.4.0 and forge-std) are already included in `contracts/lib/`,
so you do not need to install them separately.

---

## 3. Run the smart contract tests

```sh
cd contracts
forge test
```

On the first run, Foundry downloads the Solidity 0.8.24 compiler (this needs internet) and compiles
everything, which takes about a minute. You should then see:

```text
Ran 1 test suite ...: 27 tests passed, 0 failed, 0 skipped (27 total tests)
```

For the name of each test as it runs, use `forge test -vv`. The README lists what the tests cover.

---

## 4. Run the full demo

You need **three terminal windows**, all opened in the `paracat-prototype` folder. Keep each one running.

### Terminal 1: start a local blockchain

```sh
anvil --block-time 1
```

Leave this running. It prints a list of test accounts and then `Listening on 127.0.0.1:8545`.

### Terminal 2: deploy the contracts

```sh
cd contracts
forge script script/Deploy.s.sol:Deploy \
  --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --broadcast
```

That private key is Anvil's **public** test key #0, published by Foundry for local testing. It only
holds play money on your local chain.

When it finishes you should see `ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.` The script deploys all six
contracts, issues the first US$20m programme, onboards the demo investors and insurers, seeds US$12m of
subscriptions and writes the contract addresses into the web app.

### Terminal 3: start the web app

```sh
cd frontend
npm ci
npm run dev
```

`npm ci` installs the app's dependencies (first run only, about 1–2 minutes). Then open the address it
prints, normally **<http://localhost:5174>**.

---

## 5. Try it out

On the local chain the app has built-in demo accounts, so you don't need MetaMask. Use the **Account**
menu in the left sidebar to switch between roles (Parapet Operations, investors, insurers, oracle
feeds and the guardian).

A short tour of the main flow:

1. **Overview**: the programme, exposure map, cover layers and river gauges.
2. **Invest**: switch to **Harbour Bay ILS Fund** and click **Subscribe 8,000,000**. In
   **Secondary transfer**, choose *Luzon Mutual Insurance* as the counterparty to see the compliance
   check block a transfer to an ineligible holder.
3. **Operations**: switch to **Parapet Operations** and click **Close subscription**.
4. **Cedents**: switch to **Luzon Mutual Insurance** and click **Pay quarterly premium of 160,000**.
5. **Trigger monitor**: click **Sensor fault**, then **Check trigger** (rejected: one faulty sensor
   can't trigger a payout). Then click **Tier 2 event**, **Check trigger**, **Skip to end of window
   (local)** and **Execute payout**. Finish with **Skip fund settlement (local)** and **Settle now**.
6. **Overview → Event log**: every step above is recorded on-chain.

[`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) has the full click-by-click walkthrough with explanations.

---

## 6. Stop or reset

- **Stop:** press `Ctrl + C` in each of the three terminals.
- **Start again from a clean state:** restart Anvil (Terminal 1), then rerun the deploy command
  (Terminal 2). Reload the browser page. The local chain keeps nothing between restarts.

---

## Troubleshooting

| What you see | What to do |
| --- | --- |
| `Address already in use` when starting Anvil | Another Anvil is already running on port 8545. Close that terminal, or on macOS/Linux find it with `lsof -i :8545` and stop it, then try again. |
| App says **"Can't reach the chain"** | Terminal 1 (Anvil) isn't running. Start it, rerun the deploy (Terminal 2), then reload the page. |
| App says **"No deployment found"** | Run the deploy command in Terminal 2. |
| **"Not enough fresh oracle readings"** on the Trigger monitor | Readings expire after a time skip. Click **Baseline**, then the event scenario again. |
| `npm ci` fails or Vite won't start | Check `node --version` is 22.12 or newer, then delete `frontend/node_modules` and rerun `npm ci`. |
| `forge` can't download the compiler | It needs internet the first time to fetch Solidity 0.8.24. Check your connection and run `forge test` again. |
| `forge` / `anvil`: command not found | Open a new terminal after installing Foundry (or run `source ~/.bashrc`), then run `foundryup`. |
| Port 5174 is busy | Vite automatically uses the next free port. Open the address printed in Terminal 3. |
| Windows: commands not found | Make sure you are in the **Ubuntu (WSL)** terminal, not PowerShell or Command Prompt. |

---

## Optional: Sepolia public testnet

The steps above are all you need to assess the prototype. The project can also be deployed to the
Sepolia public testnet with Etherscan source verification. That needs a MetaMask wallet with test ETH,
an Alchemy RPC URL and an Etherscan API key. See **"Deploy to Sepolia"** in the [README](README.md).
