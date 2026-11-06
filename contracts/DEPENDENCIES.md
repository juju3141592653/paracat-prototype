# Vendored dependencies

Dependencies are committed so a local clone can compile without fetching Solidity libraries.

- OpenZeppelin Contracts 5.4.0: Solidity source from the installed official npm package `@openzeppelin/contracts`. Generated build artifacts omitted. Upstream: https://github.com/OpenZeppelin/openzeppelin-contracts/tree/v5.4.0. MIT license retained alongside the contracts directory.
- forge-std 1.16.2: vendored source snapshot; see `lib/forge-std/package.json`. MIT/Apache licenses retained. Upstream: https://github.com/foundry-rs/forge-std. Upstream test suite omitted; we run our own `contracts/test/` suite.

These are source dependencies, not deployed services. Remappings in `foundry.toml` keep imports inside this project. Solidity 0.8.24 must already be installed for a fully offline build.
