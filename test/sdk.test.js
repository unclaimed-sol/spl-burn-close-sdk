import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { buildBurnAndCloseInstruction as instruction, buildBurnAndCloseTransactions as transactions, PROGRAM_ID, FEE_RECIPIENT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '../dist/index.js';

const key = (n) => { const bytes = new Uint8Array(32); new DataView(bytes.buffer).setUint32(28, n); return new PublicKey(bytes); };
const user = key(1);
const blockhash = key(2).toBase58();
const pairs = (count, shared = false) => Array.from({ length: count }, (_, i) => ({ mint: key(shared ? 100 : 100 + i), ata: key(200 + i) }));
const noRpc = { getLatestBlockhash() { throw new Error('Unexpected RPC'); } };
const build = (items, options = {}, token = TOKEN_PROGRAM_ID) => transactions(noRpc, PROGRAM_ID, user, items, { recentBlockhash: blockhash, ...options }, token);
const size = (tx) => tx.serialize({ requireAllSignatures: false }).length;

for (const token of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
  test(`instruction contract: ${token}`, async () => {
    const items = pairs(3);
    const ix = await instruction(PROGRAM_ID, user, items, token);
    assert.ok(ix.programId.equals(PROGRAM_ID));
    assert.deepEqual([...ix.data], [0]);
    assert.equal(ix.keys.length, 4 + 2 * items.length);
    assert.deepEqual(ix.keys, [
      { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: token, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ...items.flatMap(({ mint, ata }) => [mint, ata].map(pubkey => ({ pubkey, isSigner: false, isWritable: true }))),
    ]);
    const [tx] = await build(items, {}, token);
    assert.deepEqual(tx.instructions[0], ix);
  });
}

test('batch sizes, serialization boundaries and shared mints', async () => {
  assert.equal(size((await build(pairs(12)))[0]), 1062);
  assert.equal(size((await build(pairs(14), { chunkSize: 14 }))[0]), 1194);
  for (const [count, options] of [[14, { feePayer: key(3) }], [15, {}], [30, {}]]) {
    await assert.rejects(build(pairs(count), { chunkSize: count, ...options }), /Burn and close: transaction could not be serialized within the 1,232-byte limit/);
  }
  assert.equal(size((await build(pairs(24, true), { chunkSize: 24 }))[0]), 1118);
  for (const [chunkSize, token] of [[12, TOKEN_PROGRAM_ID], [10, TOKEN_PROGRAM_ID], [3, TOKEN_2022_PROGRAM_ID]]) {
    const items = pairs(25);
    const txs = await build(items, { chunkSize }, token);
    assert.equal(txs.length, Math.ceil(items.length / chunkSize));
    for (const [i, tx] of txs.entries()) {
      assert.deepEqual(tx.instructions[0], await instruction(PROGRAM_ID, user, items.slice(i * chunkSize, (i + 1) * chunkSize), token));
      assert.ok(tx.feePayer.equals(user));
    }
  }
});

test('empty inputs and invalid chunk sizes', async () => {
  assert.deepEqual(await transactions(noRpc, PROGRAM_ID, user, []), []);
  assert.equal(await instruction(PROGRAM_ID, user, [], TOKEN_PROGRAM_ID), null);
  for (const chunkSize of [0, -1, NaN, 1.5, Infinity, -Infinity]) {
    for (const items of [[], pairs(1)]) await assert.rejects(build(items, { chunkSize }), /chunkSize must be a finite positive integer/);
  }
});

test('blockhash and expiry stay paired across batches', async () => {
  let calls = 0;
  const connection = { async getLatestBlockhash(options) { calls++; assert.deepEqual(options, { commitment: 'finalized' }); return { blockhash, lastValidBlockHeight: 456 }; } };
  const txs = await transactions(connection, PROGRAM_ID, user, pairs(13), { commitment: 'finalized', lastValidBlockHeight: 999 });
  assert.equal(calls, 1);
  for (const tx of txs) { assert.equal(tx.recentBlockhash, blockhash); assert.equal(tx.lastValidBlockHeight, 456); }
  const [explicit] = await build(pairs(1), { lastValidBlockHeight: 123, feePayer: key(3) });
  assert.equal(explicit.recentBlockhash, blockhash);
  assert.equal(explicit.lastValidBlockHeight, 123);
  assert.ok(explicit.feePayer.equals(key(3)));
  assert.equal((await build(pairs(1)))[0].lastValidBlockHeight, undefined);
  await transactions({ async getLatestBlockhash(options) { assert.deepEqual(options, { commitment: 'confirmed' }); return { blockhash, lastValidBlockHeight: 456 }; } }, PROGRAM_ID, user, pairs(1));
});

test('README fee vector and confirmation examples', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const fee = Math.max(Math.floor(2039280 * 200 / 10000), 2039280 - 2000000);
  assert.equal(fee, 40785);
  assert.ok(readme.includes(`For 2,039,280 lamports recovered, the fee is ${fee.toLocaleString('en-US')} lamports.`));
  const examples = [...readme.matchAll(/```typescript\n([\s\S]*?)```/g)];
  assert.equal(examples.length, 2);
  for (const [, code] of examples) {
    assert.ok(!code.includes('getLatestBlockhash'));
    assert.match(code, /blockhash: tx.recentBlockhash!/);
    assert.match(code, /lastValidBlockHeight: tx.lastValidBlockHeight!/);
    assert.match(code, /if \(confirmation.value.err\) \{\s+throw new Error/);
    assert.ok(code.indexOf('confirmation.value.err') < code.indexOf('console.log'));
  }
});
