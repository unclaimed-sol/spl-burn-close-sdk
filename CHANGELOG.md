# Changelog

## 1.3.0

- Preserve the fetched blockhash's `lastValidBlockHeight` on built transactions and add
  an optional matching height for caller-supplied blockhashes.
- Reject non-finite, non-positive, and fractional `chunkSize` values at build time,
  including on empty input. The default remains 12.
- Validate unsigned serialization during building. Oversized transactions and serialization
  failures now raise a clear SDK error at build time instead of failing later when sent.
  Choose a smaller chunk size; additional caller instructions still count against 1,232 bytes.
- Fix CommonJS TypeScript resolution with separate import/require declaration exports.
- Correct the documented hybrid fee and confirmation examples; describe compute-budget
  considerations without adding a default compute-budget instruction.
- Add instruction, batching, expiry, documentation and packed-package tests with CI.

Existing instruction encoding, asynchronous helpers and return types remain unchanged.
