import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve('.');
const temp = mkdtempSync(join(tmpdir(), 'spl-burn-close-package-'));
const run = (command, args, cwd = temp) => execFileSync(command, args, { cwd, stdio: 'inherit' });
try {
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', temp], { cwd: root, encoding: 'utf8' }));
  assert.deepEqual(packed[0].files.map(file => file.path).sort(), [
    'CHANGELOG.md', 'README.md', 'dist/index.cjs', 'dist/index.d.cts',
    'dist/index.d.ts', 'dist/index.js', 'package.json',
  ].sort(), 'Package must contain only public documentation, manifest, JS and declarations');
  // Preserve the repository's transitive dependency graph: fresh web3.js installs can
  // select ESM-only transitive packages that no longer support Node 18 require().
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const manifest = { name: 'sdk-package-smoke', version: '1.0.0', private: true, devDependencies: lock.packages[''].devDependencies };
  lock.name = manifest.name;
  lock.version = manifest.version;
  lock.packages[''] = manifest;
  writeFileSync(join(temp, 'package.json'), JSON.stringify(manifest));
  writeFileSync(join(temp, 'package-lock.json'), JSON.stringify(lock));
  // Install the actual tarball, with the same peer/compiler versions used by this checkout.
  const version = (name) => JSON.parse(execFileSync(process.execPath, ['-p', `JSON.stringify(require('${name}/package.json').version)`], { cwd: root, encoding: 'utf8' }));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(temp, packed[0].filename), `@solana/web3.js@${version('@solana/web3.js')}`, `typescript@${version('typescript')}`]);
  const source = `import { buildBurnAndCloseInstruction, buildBurnAndCloseTransactions, buildCloseEmptyTokenAccountsInstruction, buildCloseEmptyTokenAccountsTransactions, PROGRAM_ID, FEE_RECIPIENT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, type Pair, type BuildOptions } from '@unclaimedsol/spl-burn-close-sdk';
import { Connection, type Transaction, type TransactionInstruction } from '@solana/web3.js';
const pairs: Pair[] = [{ mint: PROGRAM_ID, ata: FEE_RECIPIENT }];
const options: BuildOptions = { chunkSize: 3, recentBlockhash: PROGRAM_ID.toBase58(), lastValidBlockHeight: 123 };
const txs: Promise<Transaction[]> = buildBurnAndCloseTransactions(new Connection('http://localhost:8899'), PROGRAM_ID, FEE_RECIPIENT, pairs, options, TOKEN_2022_PROGRAM_ID);
const ix: Promise<TransactionInstruction | null> = buildBurnAndCloseInstruction(PROGRAM_ID, FEE_RECIPIENT, pairs, TOKEN_PROGRAM_ID);
const emptyTxs: Promise<Transaction[]> = buildCloseEmptyTokenAccountsTransactions(new Connection('http://localhost:8899'), PROGRAM_ID, FEE_RECIPIENT, pairs, options, TOKEN_2022_PROGRAM_ID);
const defaultTxs: Promise<Transaction[]> = buildCloseEmptyTokenAccountsTransactions(new Connection('http://localhost:8899'), PROGRAM_ID, FEE_RECIPIENT, pairs);
const emptyIx: Promise<TransactionInstruction | null> = buildCloseEmptyTokenAccountsInstruction(PROGRAM_ID, FEE_RECIPIENT, pairs, TOKEN_PROGRAM_ID);
// @ts-expect-error The instruction helper requires an explicit token program.
buildCloseEmptyTokenAccountsInstruction(PROGRAM_ID, FEE_RECIPIENT, pairs);
void txs; void ix; void emptyTxs; void defaultTxs; void emptyIx;
`;
  for (const [file, module, resolution] of [['consumer.cts', 'Node16', 'Node16'], ['consumer.mts', 'Node16', 'Node16'], ['consumer.ts', 'ESNext', 'Bundler']]) {
    writeFileSync(join(temp, file), source);
    run(process.execPath, [join(temp, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2020', '--module', module, '--moduleResolution', resolution, file]);
  }
  const names = ['PROGRAM_ID', 'FEE_RECIPIENT', 'TOKEN_PROGRAM_ID', 'TOKEN_2022_PROGRAM_ID', 'buildBurnAndCloseInstruction', 'buildBurnAndCloseTransactions', 'buildCloseEmptyTokenAccountsInstruction', 'buildCloseEmptyTokenAccountsTransactions'].sort();
  writeFileSync(join(temp, 'runtime.cjs'), `const assert = require('node:assert/strict');
const { PublicKey } = require('@solana/web3.js');
(async () => {
  for (const sdk of [require('@unclaimedsol/spl-burn-close-sdk'), await import('@unclaimedsol/spl-burn-close-sdk')]) {
    assert.deepEqual(Object.keys(sdk).sort(), ${JSON.stringify(names)});
    const user = new PublicKey(new Uint8Array(32).fill(1));
    const pairs = [{ mint: new PublicKey(new Uint8Array(32).fill(2)), ata: new PublicKey(new Uint8Array(32).fill(3)) }];
    const noRpc = { getLatestBlockhash() { throw new Error('Unexpected RPC'); } };
    for (const token of [sdk.TOKEN_PROGRAM_ID, sdk.TOKEN_2022_PROGRAM_ID]) {
      for (const [instruction, transactions, selector] of [
        [sdk.buildBurnAndCloseInstruction, sdk.buildBurnAndCloseTransactions, 0],
        [sdk.buildCloseEmptyTokenAccountsInstruction, sdk.buildCloseEmptyTokenAccountsTransactions, 2],
      ]) {
        const ix = await instruction(sdk.PROGRAM_ID, user, pairs, token);
        assert.deepEqual([...ix.data], [selector]);
        assert.equal(Buffer.isBuffer(ix.data), false);
        const [tx] = await transactions(noRpc, sdk.PROGRAM_ID, user, pairs, { recentBlockhash: user.toBase58() }, token);
        assert.deepEqual(tx.instructions, [ix]);
        assert.ok(tx.signatures.every(({ signature }) => signature === null));
        assert.equal(await instruction(sdk.PROGRAM_ID, user, [], token), null);
        assert.deepEqual(await transactions(noRpc, sdk.PROGRAM_ID, user, []), []);
      }
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
`);
  run(process.execPath, ['runtime.cjs']);
  console.log('Package contents, CJS-node16, ESM-node16, bundler types and runtime checks passed.');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
