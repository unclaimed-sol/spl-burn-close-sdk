import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Message, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import * as sdk from '../dist/index.js';
import { PROGRAM_ID, FEE_RECIPIENT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '../dist/index.js';

const key = (n) => { const bytes = new Uint8Array(32); new DataView(bytes.buffer).setUint32(28, n); return new PublicKey(bytes); };
const user = key(1);
const blockhash = key(2).toBase58();
const pairs = (count, shared = false) => Array.from({ length: count }, (_, i) => ({ mint: key(shared ? 100 : 100 + i), ata: key(200 + i) }));
const noRpc = { getLatestBlockhash() { throw new Error('Unexpected RPC'); } };
for (const [name, instruction, transactions, selector] of [
  ['Burn and close', sdk.buildBurnAndCloseInstruction, sdk.buildBurnAndCloseTransactions, 0],
  ['Close empty token accounts', sdk.buildCloseEmptyTokenAccountsInstruction, sdk.buildCloseEmptyTokenAccountsTransactions, 2],
]) {
  const build = (items, options = {}, token = TOKEN_PROGRAM_ID) => transactions(noRpc, PROGRAM_ID, user, items, { recentBlockhash: blockhash, ...options }, token);
  const size = (tx) => tx.serialize({ requireAllSignatures: false }).length;

  for (const token of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    test(`${name}: instruction contract: ${token}`, async () => {
      const items = pairs(3);
      const ix = await instruction(PROGRAM_ID, user, items, token);
      assert.ok(ix.programId.equals(PROGRAM_ID));
      assert.deepEqual([...ix.data], [selector]);
      assert.ok(ix.data instanceof Uint8Array);
      assert.equal(Buffer.isBuffer(ix.data), false);
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

  test(`${name}: batch sizes, serialization boundaries and shared mints`, async () => {
    assert.equal(size((await build(pairs(12)))[0]), 1062);
    assert.equal(size((await build(pairs(14), { chunkSize: 14 }))[0]), 1194);
    for (const [count, options] of [[14, { feePayer: key(3) }], [15, {}], [30, {}]]) {
      await assert.rejects(build(pairs(count), { chunkSize: count, ...options }), new RegExp(`${name}: transaction could not be serialized within the 1,232-byte limit`));
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

  test(`${name}: empty inputs and invalid chunk sizes`, async () => {
    assert.deepEqual(await transactions(noRpc, PROGRAM_ID, user, []), []);
    assert.equal(await instruction(PROGRAM_ID, user, [], TOKEN_PROGRAM_ID), null);
    for (const chunkSize of [0, -1, NaN, 1.5, Infinity, -Infinity]) {
      for (const items of [[], pairs(1)]) await assert.rejects(build(items, { chunkSize }), /chunkSize must be a finite positive integer/);
    }
  });

  test(`${name}: non-size serialization failures keep their original cause`, async () => {
    const invalidMint = key(100);
    invalidMint.toString = () => { throw new RangeError('Invalid account key range'); };
    for (const [options, items, cause] of [
      [{ recentBlockhash: '' }, pairs(1), /recentBlockhash required/],
      [{}, [{ mint: 'not-a-key', ata: key(200) }], /./],
      [{}, [{ mint: invalidMint, ata: key(200) }], /Invalid account key range/],
    ]) {
      await assert.rejects(build(items, options), (error) => {
        assert.match(error.message, new RegExp(`^${name}: transaction could not be serialized\\. Check the supplied transaction inputs`));
        assert.doesNotMatch(error.message, /1,232-byte|chunkSize/);
        assert.ok(error.cause instanceof Error);
        assert.match(error.cause.message, cause);
        return true;
      });
    }
  });

  test(`${name}: blockhash and expiry stay paired across batches`, async () => {
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
    for (const tx of [...txs, explicit]) {
      assert.equal(tx.signature, null);
      assert.ok(tx.signatures.every(({ signature }) => signature === null));
    }
    assert.deepEqual(explicit.signatures.map(({ publicKey }) => publicKey.toBase58()).sort(), [user, key(3)].map(k => k.toBase58()).sort());
    await transactions({ async getLatestBlockhash(options) { assert.deepEqual(options, { commitment: 'confirmed' }); return { blockhash, lastValidBlockHeight: 456 }; } }, PROGRAM_ID, user, pairs(1));
  });

}

test('README fee vector and confirmation examples', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const fee = Math.max(Math.floor(2039280 * 200 / 10000), 2039280 - 2000000);
  assert.equal(fee, 40785);
  assert.ok(readme.includes(`For 2,039,280 lamports recovered, the fee is ${fee.toLocaleString('en-US')} lamports.`));
  const examples = [...readme.matchAll(/```typescript\n([\s\S]*?)```/g)];
  const sendingExamples = examples.filter(([, code]) => code.includes('sendRawTransaction'));
  assert.equal(sendingExamples.length, 2);
  for (const [, code] of sendingExamples) {
    assert.ok(!code.includes('getLatestBlockhash'));
    assert.match(code, /blockhash: tx.recentBlockhash!/);
    assert.match(code, /lastValidBlockHeight: tx.lastValidBlockHeight!/);
    assert.match(code, /if \(confirmation.value.err\) \{\s+throw new Error/);
    assert.ok(code.indexOf('confirmation.value.err') < code.indexOf('console.log'));
  }
});

const fixture = JSON.parse(readFileSync(new URL('./fixtures/close_empty_token_accounts.json', import.meta.url), 'utf8'));
const fixturePairs = [4, 6].map(i => ({ mint: new PublicKey(fixture.accounts[i].pubkey), ata: new PublicKey(fixture.accounts[i + 1].pubkey) }));
const metas = ix => ix.keys.map(({ pubkey, ...flags }) => ({ pubkey: pubkey.toBase58(), ...flags }));

test('close-empty bytes and ordered metas match the committed Rust fixture', async () => {
  const wallet = new PublicKey(fixture.accounts[1].pubkey);
  const ix = await sdk.buildCloseEmptyTokenAccountsInstruction(new PublicKey(fixture.programId), wallet, fixturePairs, TOKEN_PROGRAM_ID);
  assert.equal(ix.programId.toBase58(), fixture.programId);
  assert.deepEqual([...ix.data], fixture.data);
  assert.equal(Buffer.from(ix.data).toString('hex'), fixture.dataHex);
  assert.equal(Buffer.from(ix.data).toString('base64'), fixture.dataBase64);
  assert.deepEqual(metas(ix), fixture.accounts);

  // Rust and web3.js may sort the legacy message key table differently.
  // Decode the Rust message and compare the effective instruction and privileges.
  const rustMessage = Message.from(Buffer.from(fixture.legacyMessage.hex, 'hex'));
  const decoded = Transaction.populate(rustMessage);
  assert.deepEqual([...decoded.instructions[0].data], [...ix.data]);
  assert.deepEqual(metas(decoded.instructions[0]), metas(ix));
  assert.ok(decoded.instructions[0].programId.equals(ix.programId));
  const [tx] = await sdk.buildCloseEmptyTokenAccountsTransactions(noRpc, ix.programId, wallet, fixturePairs, {
    recentBlockhash: fixture.legacyMessage.recentBlockhash,
  });
  assert.deepEqual(tx.instructions, [ix]);
  assert.ok(tx.feePayer.equals(decoded.feePayer));
  assert.equal(tx.recentBlockhash, decoded.recentBlockhash);
});

test('legacy fixture layout still uses selector zero for intentional burning', async () => {
  const ix = await sdk.buildBurnAndCloseInstruction(PROGRAM_ID, new PublicKey(fixture.accounts[1].pubkey), fixturePairs, TOKEN_PROGRAM_ID);
  assert.deepEqual([...ix.data], [0]);
  assert.deepEqual(metas(ix), fixture.accounts);
});

test('instruction builders work without a global Buffer or RPC', async () => {
  const savedBuffer = globalThis.Buffer;
  const program = new PublicKey(fixture.programId);
  const wallet = new PublicKey(fixture.accounts[1].pubkey);
  try {
    globalThis.Buffer = undefined;
    for (const builder of [sdk.buildBurnAndCloseInstruction, sdk.buildCloseEmptyTokenAccountsInstruction]) {
      const ix = await builder(program, wallet, fixturePairs, TOKEN_2022_PROGRAM_ID);
      assert.ok(ix.data instanceof Uint8Array);
      assert.equal(ix.data.byteLength, 1);
    }
  } finally {
    globalThis.Buffer = savedBuffer;
  }
});
