import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve('.');
const temp = mkdtempSync(join(tmpdir(), 'spl-burn-close-package-'));
const run = (command, args, cwd = temp) => execFileSync(command, args, { cwd, stdio: 'inherit' });
try {
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', temp], { cwd: root, encoding: 'utf8' }));
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
  const source = `import { buildBurnAndCloseInstruction, buildBurnAndCloseTransactions, PROGRAM_ID, FEE_RECIPIENT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, type Pair, type BuildOptions } from '@unclaimedsol/spl-burn-close-sdk';
import { Connection, type Transaction, type TransactionInstruction } from '@solana/web3.js';
const pairs: Pair[] = [{ mint: PROGRAM_ID, ata: FEE_RECIPIENT }];
const options: BuildOptions = { chunkSize: 3, recentBlockhash: PROGRAM_ID.toBase58(), lastValidBlockHeight: 123 };
const txs: Promise<Transaction[]> = buildBurnAndCloseTransactions(new Connection('http://localhost:8899'), PROGRAM_ID, FEE_RECIPIENT, pairs, options, TOKEN_2022_PROGRAM_ID);
const ix: Promise<TransactionInstruction | null> = buildBurnAndCloseInstruction(PROGRAM_ID, FEE_RECIPIENT, pairs, TOKEN_PROGRAM_ID);
void txs; void ix;
`;
  for (const [file, module, resolution] of [['consumer.cts', 'Node16', 'Node16'], ['consumer.mts', 'Node16', 'Node16'], ['consumer.ts', 'ESNext', 'Bundler']]) {
    writeFileSync(join(temp, file), source);
    run(process.execPath, [join(temp, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2020', '--module', module, '--moduleResolution', resolution, file]);
  }
  const names = ['PROGRAM_ID', 'FEE_RECIPIENT', 'TOKEN_PROGRAM_ID', 'TOKEN_2022_PROGRAM_ID', 'buildBurnAndCloseInstruction', 'buildBurnAndCloseTransactions'].sort();
  writeFileSync(join(temp, 'runtime.cjs'), `const assert = require('node:assert/strict');\n(async () => { for (const sdk of [require('@unclaimedsol/spl-burn-close-sdk'), await import('@unclaimedsol/spl-burn-close-sdk')]) assert.deepEqual(Object.keys(sdk).sort(), ${JSON.stringify(names)}); })().catch(error => { console.error(error); process.exitCode = 1; });\n`);
  run(process.execPath, ['runtime.cjs']);
  console.log('Packed CJS-node16, ESM-node16, bundler and runtime checks passed.');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
