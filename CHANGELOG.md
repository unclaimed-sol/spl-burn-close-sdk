# Changelog

## 1.4.0

- Add `buildCloseEmptyTokenAccountsInstruction` and
  `buildCloseEmptyTokenAccountsTransactions` for opt-in execution-time empty-account
  checks. They emit exact data `[2]` with the Rust program's existing token account
  layout, support classic SPL Token and Token-2022, and never fall back to burning.
- Reuse unsigned batching, `BuildOptions`, blockhash/expiry handling, fee payer
  support and the 1,232-byte limit. The instruction helper makes no RPC calls.
- Verify the ABI against Rust commit `1f2b10ae668c47de97627de69cdf656878ed9b0e`
  and its deterministic fixture. Extend regression, browser-data and packed-package
  coverage across CJS, ESM and TypeScript bundler resolution.
- Document deployment prerequisites, skipped targets, funded/unsynchronized WSOL
  exclusion, unchanged fees and the limits of preview and signature-based reporting.

Existing burn-and-close APIs, selector `[0]`, defaults and behavior are preserved.
Consumers must explicitly switch builders after the program upgrade is deployed;
an SDK dependency update alone does not protect existing cleanup calls. This release
does not add checked buffer approvals or guarantee exact preview proceeds.

## 1.3.0

- Preserve the fetched blockhash's `lastValidBlockHeight` on built transactions and add
  an optional matching height for caller-supplied blockhashes.
- Reject non-finite, non-positive, and fractional `chunkSize` values at build time,
  including on empty input. The default remains 12.
- Validate unsigned serialization during building. Oversized transactions raise a clear
  size error at build time instead of failing later when sent; other serialization failures
  (for example an invalid blockhash or account key) report the original error as `cause`.
  Choose a smaller chunk size; additional caller instructions still count against 1,232 bytes.
- Fix CommonJS TypeScript resolution with separate import/require declaration exports.
- Correct the documented hybrid fee and confirmation examples; describe compute-budget
  considerations without adding a default compute-budget instruction.
- Add instruction, batching, expiry, documentation and packed-package tests with CI.

Existing instruction encoding, asynchronous helpers and return types remain unchanged.
