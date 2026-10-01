import { createHash } from 'node:crypto';
import BN from 'bn.js';
import Decimal from 'decimal.js';
import { Connection } from '@solana/web3.js';
import { DynamicBondingCurveClient, buildCurveWithMarketCap, getPriceFromSqrtPrice,
  getMigrationThresholdPrice, ActivationType, TokenType, TokenAuthorityOption,
  BaseFeeMode, CollectFeeMode, MigrationOption, MigrationFeeOption } from '@meteora-ag/dynamic-bonding-curve-sdk';

export function atomic(text, decimals) {
  if (typeof text !== 'string' || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(text)) throw new Error('amount must be a positive decimal string');
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > decimals) throw new Error('amount exceeds quote precision');
  const value = new BN(whole + fraction.padEnd(decimals, '0'));
  if (value.lten(0) || value.bitLength() > 64) throw new Error('amount must fit positive u64');
  return value;
}

export function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('object required');
  const fields = ['name', 'totalSupply', 'initialMarketCap', 'migrationMarketCap', 'baseDecimals', 'quoteDecimals', 'feeBps', 'slippageBps', 'quoteAmounts'];
  if (Object.keys(input).some(k => !fields.includes(k))) throw new Error('unknown input field');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) throw new Error('name required (1–100 characters)');
  for (const key of ['totalSupply', 'initialMarketCap', 'migrationMarketCap']) {
    if (typeof input[key] !== 'number' || !Number.isFinite(input[key]) || input[key] <= 0 || input[key] > 1e12) throw new Error(`${key} must be positive and <= 1e12`);
  }
  if (!Number.isSafeInteger(input.totalSupply)) throw new Error('totalSupply must be an integer');
  if (input.migrationMarketCap <= input.initialMarketCap) throw new Error('migration market cap must exceed initial market cap');
  for (const key of ['baseDecimals', 'quoteDecimals']) {
    if (!Number.isInteger(input[key]) || input[key] < 6 || input[key] > 9) throw new Error(`${key} must be 6–9`);
  }
  if (new Decimal(input.totalSupply).mul(new Decimal(10).pow(input.baseDecimals)).gt('18446744073709551615')) throw new Error('token supply exceeds u64');
  if (!Number.isInteger(input.feeBps) || input.feeBps < 1 || input.feeBps > 1000) throw new Error('feeBps must be 1–1000');
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 0 || input.slippageBps > 1000) throw new Error('slippageBps must be 0–1000');
  if (!Array.isArray(input.quoteAmounts) || input.quoteAmounts.length < 1 || input.quoteAmounts.length > 50) throw new Error('provide 1–50 quote amounts');
  input.quoteAmounts.forEach(x => atomic(x, input.quoteDecimals));
  return input;
}

export function buildConfig(input) {
  validate(input);
  return buildCurveWithMarketCap({
    token: { tokenType: TokenType.SPLToken, tokenBaseDecimal: input.baseDecimals,
      tokenQuoteDecimal: input.quoteDecimals, tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: input.totalSupply, leftover: 0 },
    fee: { baseFeeParams: { baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
      feeSchedulerParam: { startingFeeBps: input.feeBps, endingFeeBps: input.feeBps, numberOfPeriod: 0, totalDuration: 0 } },
      dynamicFeeEnabled: false, collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 0, poolCreationFee: 0, enableFirstSwapWithMinFee: false },
    migration: { migrationOption: MigrationOption.MET_DAMM_V2, migrationFeeOption: MigrationFeeOption.FixedBps100,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 } },
    liquidityDistribution: { partnerLiquidityPercentage: 0, partnerPermanentLockedLiquidityPercentage: 100,
      creatorLiquidityPercentage: 0, creatorPermanentLockedLiquidityPercentage: 0 },
    lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0,
      totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
    activationType: ActivationType.Slot,
    initialMarketCap: input.initialMarketCap, migrationMarketCap: input.migrationMarketCap,
  });
}

export function decimalUnits(value, decimals) {
  return new Decimal(value.toString()).div(new Decimal(10).pow(decimals)).toFixed();
}

export function analyze(input) {
  const config = buildConfig(input);
  // The service's initial-pool quote helper is pure math. Any unexpected RPC fails closed.
  const connection = new Connection('http://127.0.0.1:1', {fetch: async () => {throw new Error('network access is disabled');}});
  const client = DynamicBondingCurveClient.create(connection);
  const quotes = input.quoteAmounts.map(amount => {
    const amountIn = atomic(amount, input.quoteDecimals);
    try {
      const quote = client.pool.getQuoteFromInputAmount({config, amountIn, swapBaseForQuote: false,
        slippageBps: input.slippageBps, hasReferral: false});
      return {input: amount, status: 'quoted', output: decimalUnits(quote.outputAmount, input.baseDecimals),
        minimumOutput: decimalUnits(quote.minimumAmountOut, input.baseDecimals),
        raw: toPlain(quote)};
    } catch (error) {
      return {input: amount, status: 'quote_rejected', reason: error.message};
    }
  });
  const end = getMigrationThresholdPrice(config.migrationQuoteThreshold, config.sqrtStartPrice, config.curve);
  return {schemaVersion: 1, name: input.name, sdkVersion: '1.5.13',
    inputSha256: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    assumptions: {quoteUnit: 'quote token (not USD)', freshPoolPerQuote: true, constantFeeBps: input.feeBps,
      dynamicFees: false, migration: 'DAMM v2, fixed 100 bps', permanentLockedLiquidityPercent: 100,
      executesTransactions: false},
    startPrice: getPriceFromSqrtPrice(config.sqrtStartPrice, input.baseDecimals, input.quoteDecimals).toString(),
    migrationPrice: getPriceFromSqrtPrice(end, input.baseDecimals, input.quoteDecimals).toString(),
    migrationQuoteThreshold: decimalUnits(config.migrationQuoteThreshold, input.quoteDecimals),
    quotes, config: toPlain(config),
    limitations: 'Independent launch-state SDK simulations. No cumulative trading, RPC, mainnet usage, live quotes, or executed DAMM migration is claimed.'};
}

export function toPlain(value) {
  if (BN.isBN(value)) return value.toString(10);
  if (Array.isArray(value)) return value.map(toPlain);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,toPlain(v)]));
  return value;
}

const escape = value => String(value).replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
export function render(reports) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>DBC Config Lab</title>
<style>body{font:16px system-ui;background:#101827;color:#eef4ff;max-width:1100px;margin:40px auto;padding:24px}h1{font-size:42px}section{background:#1c2940;padding:24px;border-radius:14px;margin:20px 0}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:12px;border-bottom:1px solid #465574}code{overflow-wrap:anywhere}small{color:#bbcbdf}summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>
<h1>DBC Config Lab</h1><p>Compare launch configurations using Meteora's official SDK. Amounts are in quote tokens, not dollars.</p><p>Every quote starts from a fresh pool. No funds, wallet connection, or transactions.</p>
${reports.map(r => `<section><h2>${escape(r.name)}</h2><p>Initial price: ${escape(r.startPrice)} · Migration price: ${escape(r.migrationPrice)}</p><p>Migration threshold: ${escape(r.migrationQuoteThreshold)} quote tokens · Fee: ${r.assumptions.constantFeeBps} bps</p><table><thead><tr><th>Quote input</th><th>Base output</th><th>Minimum output</th><th>Result</th></tr></thead><tbody>${r.quotes.map(q => `<tr><td>${escape(q.input)}</td><td>${escape(q.output ?? '—')}</td><td>${escape(q.minimumOutput ?? '—')}</td><td>${escape(q.status === 'quoted' ? 'SDK quote' : q.reason)}</td></tr>`).join('')}</tbody></table><p><small>${escape(r.limitations)}</small></p><details><summary>Config and reproducibility evidence</summary><pre>${escape(JSON.stringify(r,null,2))}</pre></details></section>`).join('')}</html>`;
}
