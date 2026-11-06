# Five-minute demo script

For the "Architecture" (1.5 min) and "Live demo" (5 min) slots of the pitch. Each step lists what to click and
what to say. Timings are a guide; rehearse twice with a stopwatch.

## Before you present

- **Redeploy fresh** (local: restart Anvil and rerun the deploy command; Sepolia: rerun the deploy script).
  Demo yield runs one minute = one day, and oracle readings expire after six hours.
- Open the app on the **Overview** tab, browser zoom at 110–125% so the back row can read it.
- **Record a backup video** of the full run the night before. If Wi-Fi or the testnet misbehaves, switch to it
  without apology: "Here is the same flow recorded this morning."
- Local chain: no wallet needed, switch roles with the **Account** menu in the sidebar. Sepolia: MetaMask connected with your deployer
  wallet and a little Sepolia ETH; each step is one or two MetaMask confirmations.

## Architecture (1.5 minutes, slide: `architecture.png`)

> "Three layers. On the right, the smart contracts on Sepolia. One audited template, the ParaCat programme,
> does the jobs a traditional cat bond spreads across an SPV, a trustee and a paying agent: it is the permissioned
> note, the collateral vault, the parametric trigger and the coupon engine. A factory issues each new deal as a
> cheap clone of that template, which is how we make a US$20m regional programme economic.
>
> Around it: an identity registry for KYC and eligibility, an oracle that only accepts flood data when independent
> feeds agree, a tokenised money-market fund that holds the collateral, and a test stablecoin.
>
> In the middle, the web app every party uses: investors, insurers, Parapet operations and the data providers.
> Everything you are about to see is read from, and written to, the blockchain live."

## Live demo (5 minutes)

### 1. The programme (0:00–0:40) · Overview

Point at the exposure map, then the cover layers table and key terms.

> "This is ParaCat Recovery Notes 2026-A: US$20m of flood cover across Manila, Ho Chi Minh City and Jakarta,
> each ceded by a local insurer and backed by a collateral vault in Singapore. The table shows each layer's
> limit, rate on line and trigger levels. US$12m is already subscribed by a pension fund and a family office."

After the book closes (step 3), come back here: the Collateral and Accrued collateral yield figures in the top
strip tick up as the tokenised fund earns yield. The river gauges below show each trigger tier like an official
flood alert level.

### 2. An investor buys in (0:40–1:20) · Invest

Local: account **Harbour Bay ILS Fund** (sidebar). Sepolia: your wallet already is.

> "Harbour Bay, a Hong Kong ILS fund, is onboarded: KYC, accredited, permitted jurisdiction, all checked
> on-chain."

Click **Subscribe 8,000,000**. While it confirms:

> "Notes are a permissioned security token. Watch what happens if Harbour Bay tries to pass notes to an insurer,
> who is a counterparty, not an eligible investor."

In **Secondary transfer**, choose *Luzon Mutual Insurance* as counterparty. The check reads *Compliance: blocked
(code 4). Recipient is not an eligible, verified investor.*

> "The compliance rule runs inside the token on every transfer. No back office can forget it."

### 3. Close the book (1:20–1:50) · Operations

Local: account **Parapet Operations**. Click **Close subscription**.

> "At close, 20% stays as an instant stablecoin buffer and 80% goes into a tokenised government money-market
> fund."

Switch to **Overview** for two seconds: the Collateral and Accrued collateral yield figures ticking up.

> "Collateral is never idle. That number is yield accruing live, and anyone can verify the collateral at any
> moment instead of waiting for a trustee statement."

### 4. The insurer pays premium (1:50–2:10) · Cedents

Local: account **Luzon Mutual Insurance**. Click **Pay quarterly premium of 160,000**.

> "Luzon Mutual pays its quarterly premium. 95% goes straight to note holders as coupon; 5% is Parapet's
> servicing fee. That is our business model, in code."

### 5. Typhoon season (2:10–4:20) · Trigger monitor, Metro Manila

**a. A broken sensor.** Click the **Sensor fault** scenario, then **Check trigger**. The notification says no tier is met.

> "One feed says catastrophic flood, the other says normal. We take the lower median of independent feeds, so
> one faulty or manipulated sensor can never trigger a payout. This is our answer to oracle risk."

*(Optional, if time: **Rain only** then **Check trigger**: also rejected. "Both rainfall and river
level must pass. That is the dual trigger, our main tool against basis risk.")*

**b. The real flood.** Click **Tier 2 event**. The water on the gauge rises past both tier lines.

> "Now both feeds agree: 324 millimetres of rain in 24 hours and the Marikina at nearly 20 metres."

Click **Check trigger**. The trigger workflow moves to the dispute window and counts down.

> "No claims adjuster, no loss assessment. The contract proposes the payout and opens a dispute window, 60
> seconds here, 72 hours in production, where an independent guardian can challenge a bad reading. Once it
> closes, nobody, including us, can block the payout."

Local: click **Skip to end of window (local)**. Sepolia: keep talking for the remaining seconds.

Click **Execute payout**. Scroll to **Recoveries**.

> "US$8m to Luzon Mutual. US$4m landed instantly from the stablecoin buffer; the other US$4m is being
> redeemed from the money-market fund, which settles T+1. That is why we keep a 20% buffer: cash on day one,
> the rest on day two, instead of 12 to 24 months."

Local: click **Skip fund settlement (local)**, then **Settle now**. Sepolia: settle after 90 seconds, or leave it pending and return
to it in Q&A.

### 6. Where the money goes, and the audit trail (4:20–5:00) · Cedents, then Overview

On **Cedents**, point at the district allocation plan.

> "Our product ends at the insurer's wallet. Luzon Mutual agreed in advance how a payout splits across Marikina,
> Pasig, Quezon City and Rizal, and that plan is published on-chain, so recovery teams know their budget before
> the water rises. Distributing it is the insurer's job."

On **Overview**, scroll to the **Event log**.

> "Every step you just saw, subscription, premium, readings, trigger, payout, is a permanent, verifiable record.
> For an investor, that is the difference between trusting a PDF and checking the chain."

## If something goes wrong

| What you see | Say and do |
| --- | --- |
| A transaction is slow on Sepolia | "Public testnets confirm in about 12 seconds; mainnet-grade networks are similar." Keep narrating. |
| "Not enough fresh oracle readings" | Readings expired. Click **Baseline** then the event scenario again. |
| Anything stuck | Switch to the backup video. |
