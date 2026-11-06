# Technical Q&A preparation

Short answers for the 15-minute Q&A. Owner: the prototype presenter, with Jenna for regulation.

**Why does this need a blockchain? Wouldn't a database do?**
A shared database still needs one party everyone trusts to run it. Here four parties with different incentives
(investors, insurers, Parapet, data providers) need the same answer to "is the collateral there?" and "did the
trigger fire?". On-chain, the rules execute themselves, the collateral is verifiable by anyone at any time, and
the payout cannot be withheld once the dispute window passes. The tokenised MMF collateral also only works
because the fund itself is on-chain.

**What if the oracle is wrong or hacked?**
Three layers. Quorum: at least two independent providers must report. Lower median: a single extreme feed cannot
move the consensus (we demo this). Freshness: readings older than six hours are ignored. Then a dispute window lets
an independent guardian cancel a proposed trigger. In production the feeds would come through Chainlink with
signed data.

**What about basis risk: the trigger fires when losses are small, or doesn't when they are large?**
Dual trigger (rainfall and river level must both pass), tiers (50% then 100%) instead of all-or-nothing, and the
thresholds are calibrated per gauge. A small indemnity top-up can cover the residual gap. We say this openly
because it is the main trade-off of any parametric product.

**What happens if Parapet disappears?**
The contracts keep running without us. Anyone can check a trigger, execute a confirmed payout, settle a fund
redemption or start maturity. Parapet's roles are servicing and onboarding, not custody.

**Can Parapet freeze or seize investors' notes?**
The transfer agent role can freeze a wallet or force a transfer, which regulated securities require (lost keys,
court orders, sanctions). That is the same model as ERC-3643, used in Project Guardian. In production that role
sits with a licensed transfer agent under MAS rules, and every use is logged on-chain.

**Can you pause the programme and keep the money?**
The guardian can pause subscriptions, transfers and new triggers in an emergency. A trigger that has passed its
dispute window can always be executed, paused or not. We test this explicitly.

**Is the code audited? What about smart contract risk?**
It is a prototype: unaudited, tested with 27 automated tests including a fuzz test that coupons owed can never
exceed the cash reserved for them. It uses OpenZeppelin's audited libraries. Production would need an external
audit, and the clone design means one template is audited once for every future programme.

**Why EIP-1167 clones?**
Each programme is a tiny proxy pointing at one shared implementation, so issuing a new deal costs a fraction of
deploying the full contract, and every deal runs identical, audited code. That is the "standardised issuance"
value proposition in our press release.

**Why Sepolia and not a permissioned chain like GL1 or Canton?**
Sepolia lets anyone verify the demo on Etherscan. The contracts are standard EVM, so they would deploy unchanged
on a permissioned EVM network such as those used in Project Guardian, which is where a regulated version would live.

**Why keep 20% in stablecoin when the MMF pays yield?**
Fund redemptions settle T+1. The buffer pays the insurer instantly; the rest follows when the fund settles. It
trades a little yield for guaranteed day-one liquidity, which is the reason insurers buy parametric cover.

**What is mocked in the demo?**
The stablecoin, the money-market fund (its yield is accelerated: one minute equals one day), the oracle feeds
(wallets that sign readings), and short timers (60-second dispute window, 90-second settlement). The contract logic
is real.

**How does the legal side work?**
The notes would be issued by a Singapore special purpose reinsurance vehicle (ideally a cell of a protected cell
company) under MAS's ILS framework, backed by a reinsurance agreement with each insurer. The token records who
owns the notes and executes payments; it sits on top of the legal contract, it does not replace it.

**Why not just let people bet on floods on Polymarket?**
Prediction markets are not collateralised for tail events, are illegal gambling in Singapore, give insurers no
regulatory capital relief, and are priced by sentiment rather than catastrophe models. ParaCat borrows the good
part, instant data-settled payouts, and puts it inside a regulated, fully collateralised security.

**How do premiums and coupons work if notes change hands?**
Coupons accrue per note. When notes are transferred, coupons earned so far stay with the seller and future coupons
go to the buyer, settled automatically in the transfer. Tested in `test_AccruedCouponStaysWithSellerAfterTransfer`.

**How much gas does it cost?**
Deploying the whole platform with seeding is about 21 million gas on Sepolia. Issuing each new programme from
the template costs about 1.3 million gas, roughly a quarter of deploying the contract from scratch. Day-to-day
actions are cheap: subscribing about 130,000 gas, checking a trigger about 100,000, a full two-tranche payout
about 320,000 (measured in the test suite with `forge test --gas-report`).
