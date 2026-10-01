# DBC Config Lab

Compare launch-state configurations with Meteora's official Dynamic Bonding
Curve SDK 1.5.13. CLI output includes exact integer quote evidence, migration
threshold, reproducible config and input digest. An HTML report presents preset
comparisons without a server or wallet. Node 22+ recommended.

```sh
npm ci
npm test
node cli.mjs --html low-fee.json high-fee.json > demo.html
node cli.mjs low-fee.json high-fee.json > comparison.json
```

Open `demo.html`. Each row is an **independent fresh-pool** quote, not a sequence
of trades. Values are quote-token units, not USD. Oversized swaps are visibly
rejected. Decimal inputs convert to BN integers without JavaScript float
rounding. The SDK's native bigint binding may fall back to its JS implementation;
that does not skip tests or swap calculations.

## Supported configuration

Integer supply, base/quote decimals 6-9, initial/migration market caps expressed
in quote units, constant fees 1-1000 bps, slippage 0-1000 bps, 1-50 quote amounts.
Config generation fixes SPL Token, immutable authority, disabled dynamic fees,
100% permanent partner liquidity lock and DAMM v2 migration at 100 bps.
These choices are explicit assumptions, not recommendations to deploy a token.
The tool uses buildCurveWithMarketCap, getMigrationThresholdPrice and
PoolService.getQuoteFromInputAmount. Unexpected RPC requests are rejected.

## Validation

15 tests cover SDK quote regression values, fee conservation, independent quote
state, slippage bounds, migration configuration, u64 precision, invalid inputs,
HTML escaping and CLI behavior. The suite passes in Node 22 and 24. No tests skip. The suite tests this application,
not the entire upstream SDK. No mainnet transactions, real trading volume,
cumulative pool simulation or executed DAMM migration is claimed.

## Competition

Prepared for https://superteam.fun/earn/listing/meteora-dbc
The fetched public listing is OPEN and closes 2026-10-13 06:59 UTC. It explicitly
includes developer tooling. Its judge criteria favor meaningful Meteora usage,
code quality, originality, impact and live traction. This is an offline MVP with
zero claimed users or mainnet traction. No prize is assured.

The listing metadata marks agentAccess HUMAN_ONLY. The owner must review and
submit through their participant profile and answer the Colosseum submission
question truthfully. Do not use an agent identity as the human participant.
Submission needs a public GitHub URL and a pitch or video link.

MIT license. AI-assisted implementation by OpenAI Codex for cuentapraces07-ops.

## Sources

- https://github.com/MeteoraAg/dynamic-bonding-curve-sdk
- https://docs.meteora.ag/developer-guides/dbc
- https://docs.meteora.ag/developer-guides/damm-v2
