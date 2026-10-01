import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {analyze, atomic, render, validate, buildConfig, toPlain} from './lab.mjs';
const low = JSON.parse(readFileSync(new URL('./low-fee.json', import.meta.url)));
const high = {...low, feeBps:100};
test('quotes use official SDK integer output regression', () => {
  const r=analyze(low);
  assert.equal(r.quotes[0].raw.outputAmount,'332397757064');
  assert.equal(r.quotes[0].output,'332397.757064');
  assert.equal(r.quotes[0].minimumOutput,'329073.779493');
});
test('fee decomposition balances to exact input', () => {
  for(const q of analyze(low).quotes.filter(q=>q.status==='quoted')) {
    const x=q.raw;
    assert.equal(BigInt(x.excludedFeeInputAmount)+BigInt(x.tradingFee)+BigInt(x.protocolFee)+BigInt(x.referralFee),BigInt(x.includedFeeInputAmount));
  }
});
test('higher fees reduce output with equal curve settings', () => {
  assert.ok(Number(analyze(high).quotes[0].output)<Number(analyze(low).quotes[0].output));
});
test('slippage changes floor and not output', () => {
  const a=analyze(low).quotes[0], b=analyze({...low,slippageBps:0}).quotes[0];
  assert.equal(a.output,b.output); assert.equal(b.minimumOutput,b.output);
  assert.ok(Number(a.minimumOutput)<Number(a.output));
});
test('oversized swap rejected visibly', () => {
  assert.equal(analyze(low).quotes.at(-1).status,'quote_rejected');
});
test('each quote is independent of previous inputs', () => {
  const r=analyze({...low,quoteAmounts:['1','0.01']});
  assert.equal(r.quotes[1].output,analyze(low).quotes[0].output);
});
test('migration and locking policy retained', () => {
  const c=toPlain(buildConfig(low));
  assert.equal(c.partnerPermanentLockedLiquidityPercentage,100);
  assert.equal(c.creatorLiquidityPercentage,0);
  assert.equal(c.migrationQuoteThreshold,'85994066487');
});
test('integer precision above JS safe range', () => {
  assert.equal(atomic('9007199.254740993',9).toString(),'9007199254740993');
});
test('invalid amount spellings fail', () => {
  for(const amount of ['-1','0','1e3','01','NaN','0.0000000001',2,'18446744074']) assert.throws(()=>atomic(amount,9));
});
test('invalid numeric parameters fail before simulation', () => {
  for(const patch of [{feeBps:0},{feeBps:1001},{slippageBps:10001},{baseDecimals:4},{totalSupply:1e12,baseDecimals:9},{migrationMarketCap:1},{initialMarketCap:NaN},{totalSupply:0.1}]) assert.throws(()=>validate({...low,...patch}));
});
test('unknown fields and empty arrays fail', () => {
  assert.throws(()=>validate({...low,quoteAmounts:[]}));
  assert.throws(()=>validate({...low,privateKey:'never accepted'}));
  assert.throws(()=>validate({...low,name:''}));
});
test('config integers serialized as decimal strings', () => {
  const r=analyze(low);
  assert.match(r.config.curve[0].liquidity,/^[0-9]+$/);
  assert.equal(typeof r.config.sqrtStartPrice,'string');
});
test('reproducible input digest changes on meaningful input', () => {
  assert.equal(analyze(low).inputSha256,analyze(low).inputSha256);
  assert.notEqual(analyze(low).inputSha256,analyze(high).inputSha256);
});
test('HTML escapes user-controlled title and embeds no external scripts', () => {
  const html=render([analyze({...low,name:'<script>alert(1)</script>'})]);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('fresh pool'));
});
test('CLI outputs usable JSON and rejects malformed invocation', () => {
  const r=spawnSync(process.execPath,['cli.mjs','low-fee.json'],{encoding:'utf8'});
  assert.equal(r.status,0); assert.equal(JSON.parse(r.stdout)[0].name,low.name);
  assert.equal(spawnSync(process.execPath,['cli.mjs'],{encoding:'utf8'}).status,2);
});
