# SDK 1.4.0 release handoff

Prepared 2026-10-30. SDK baseline: `02a2f50`, version `1.3.0`, clean working tree.
`npm view @unclaimedsol/spl-burn-close-sdk version dist-tags versions --json`
reported `latest: 1.3.0` and no newer version. No additional repository release
policy was found. The two additive public APIs therefore prepare minor version
`1.4.0`; `package.json` and the lockfile agree. No dependency versions changed.
Publication remains for the coordinated release step.

## Authoritative Rust contract

The merged Rust commit is `1f2b10ae668c47de97627de69cdf656878ed9b0e`
(implementation `c5e478e`, final PR head `85a7504`). The reviewed sources are
`src/lib.rs`, `src/close_empty.rs`, `docs/close-empty-token-accounts.md`,
`docs/close-empty-deployment-handoff.md` and
`tests/fixtures/close_empty_token_accounts.json` in the Rust repository.
The SDK copies that JSON fixture byte for byte into `test/fixtures`.

Selector 2 requires exact data `[2]`. Ordered metas are writable nonsigning fee
recipient, writable signing wallet, read-only nonsigning token program, read-only
nonsigning System Program, then writable nonsigning mint/token-account pairs.
Each instruction selects one token program. The fixed program and fee recipient
IDs match the existing SDK constants. The program performs eligibility checks at
execution and never invokes burns on this path. Legacy selector 0 remains available.

The Rust handoff records the candidate as not deployed. This SDK work performed
no live deployment checks and makes no claim about current mainnet availability.
Consumers must wait for the program upgrade and explicitly adopt the new API.

## Verification and limits

- `npm test`: 16 passing tests. Both API families cover classic SPL Token and
  Token-2022, byte/meta contracts, empty input, chunking, invalid sizes, custom
  payer, fetched/supplied blockhash and expiry, unsigned output, serialization
  errors and the 1,232-byte limit. The Rust fixture is an independent encoding
  oracle. Its legacy message is decoded for semantic comparison because Rust
  and web3.js can sort message account tables differently. Instruction data
  construction also passes with the global `Buffer` removed.
- `npm run test:package`: passes package-content assertions, runtime loading of
  both API families in CJS and ESM, and declaration checks for CJS/ESM Node16 and
  bundler resolution. The tarball contains only the manifest, README, changelog,
  two JavaScript builds and two declaration files.
- `node scripts/test-runtime.js /Users/nedim/unclaimed-sol-rust-program`: passes
  against the actual UnclaimedSOL SBF artifact in `solana-test-validator 2.1.0`
  (`c1080de4`, feature set `3176011155`) with its bundled token programs. For
  both classic and Token-2022, SDK-built instructions and transactions close
  eligible empty accounts, charge exact fees, preserve actual late token
  transfers and funded/unsynchronized WSOL, and allow all-skipped successful
  batches. The legacy SDK builder then intentionally burns the deposited tokens.
  Tests assert account removal, preserved data/lamports/owners, unchanged mint
  supply on the new path, wallet/recipient balances and execution logs.
- SBF SHA-256: `40c9eb68c0a6e835d8789e87da2aa5f67b9cb18498814078b75e2129b44054aa`.
  The harness requires that hash and the pinned Rust commit before starting.
  All signing keys and balances are synthetic and local. This is runtime
  evidence, separate from unit/fixture encoding checks.

Local tooling: Node `24.22.1`, web3.js `1.98.4`, TypeScript `5.9.2`. The repository
CI matrix remains Node 18/22; those runtimes were not executed locally in this task.
Browser safety is checked at the instruction-data boundary, not through a browser
application. Runtime coverage uses base token accounts; Token-2022 extension
matrices, CPI rollback and SBF build tests belong to the Rust suite and were not
rerun here. This work did not benchmark production batch compute capacity, run
funded cluster tests, verify deployed bytes, publish npm, or change consumers.

Observed setup failures were resolved: npm cache writes and validator sockets
required sandbox escalation; genesis SBF programs required waiting beyond their
deployment slot. Runtime account comparisons exclude only `rentEpoch`, which
the bank normalizes on first use; all account data, lamports, ownership and
executable/space fields remain compared. The initial full equality assertion
failed on that metadata alone. No SDK eligibility rule was relaxed.

## Exact MCP follow-up

The inspected MCP branch is `fix/mcp-security-and-contract-hardening` at
`1aa0053`, the unpublished 2.0.0 work for PR #5. Its dependency is pinned to SDK
`1.3.0`, and `src/services/transaction.ts` calls `buildBurnAndCloseInstruction`.
Its existing unrelated work was left untouched.

After deployment availability and the SDK release are coordinated:

1. Update `@unclaimedsol/spl-burn-close-sdk` to exact `1.4.0` in MCP's
   `package.json` and regenerate `package-lock.json` from the published release
   (including the package version, resolved tarball and integrity). Do not only
   change the manifest or use a local tarball as the final release dependency.
2. In `src/services/transaction.ts`, replace the token cleanup import and call
   of `buildBurnAndCloseInstruction` with
   `buildCloseEmptyTokenAccountsInstruction`. Preserve grouping by token program,
   mint/account pairing, chunking and custom payer behavior. Keep RPC checks for
   previews; execution-time safety comes from selector 2. Never silently retry
   with selector 0 when the instruction is unsupported.
3. Update `test/services/transaction-builder.test.ts` and relevant transaction
   program tests. The current mock emits selector 0 and a header/layout that
   differs from the real SDK. Assert real SDK selector `[2]`, exact metas and
   one token program per instruction; update or remove that stale mock.
4. Add MCP integration tests against the upgraded local program for empty
   closures, post-preview token deposits, funded and unsynchronized WSOL,
   mixed eligible/skipped targets, all-skipped success, unsupported selector
   rejection without fallback, and accurate post-execution reporting. Exercise
   both token programs and ensure previews are not presented as exact proceeds.
   Any simulation no-recovery handling must recognize selector 2 and
   `us:event:close_empty_summary closed=0 recovered=0 fee=0`, with invocation
   attribution and ambiguous/truncated-log safeguards preserved.

MCP buffer, reward and stake paths are outside this change. This SDK release
neither introduces checked buffer approvals nor changes those paths. Updating
the dependency without replacing the cleanup builder leaves the legacy
deposit-to-burn race intact.
