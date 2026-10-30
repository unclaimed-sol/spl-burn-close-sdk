# Burn and Close Solana SPL Tokens SDK

A lightweight Solana SDK for intentional token burning and opt-in empty-token-account cleanup, with the existing Unclaimed SOL token cleanup fee policy.
This library only **builds unsigned transactions** – you handle signing and sending them, whether in the browser (Wallet Adapter) or server (Keypair).

`buildBurnAndCloseInstruction` and `buildBurnAndCloseTransactions` intentionally burn
and close (selector 0). They keep their existing behavior, including burning tokens
that arrive after an RPC balance check. Updating this dependency alone does not
change existing callers.

`buildCloseEmptyTokenAccountsInstruction` and `buildCloseEmptyTokenAccountsTransactions`
request execution-time empty-account checks (selector 2) and never burn. The program
upgrade must be deployed before consumers use these builders. This SDK does not
probe deployment or fall back to burn-and-close if selector 2 is unsupported.

## ✨ Features

- 🔥 Burn all tokens in provided ATAs.
- 🧹 Close token accounts, reclaiming rent to the user.
- Opt-in empty-account cleanup that preserves tokens deposited after a preview.
- 💸 On-chain fee recipient is enforced by the program.
- 🧾 Hybrid cleanup fee: `max(floor(gross * 200 / 10000), gross - 2,000,000)` lamports per closed account. For 2,039,280 lamports recovered, the fee is 40,785 lamports.
- ⚡ Automatic batching (default 12 ATAs per transaction).
- 🪙 Supports SPL Token and Token-2022.
- 🔐 Supports **frontend partial signing** and **backend full signing** workflows.
- 🚀 No hidden config: single function to integrate.

---

## 🧩 How It Works

1. The SDK prepares instructions for the selected cleanup path.
2. The legacy path burns and closes. The new close-empty path closes only eligible
   empty accounts, returning their lamports to the wallet without burning tokens.
3. The program sends the greater of 2% of recovered rent (rounded down) or the amount above 2,000,000 lamports to the hardcoded fee recipient, per successfully closed account.
4. The SDK never asks for private keys — you sign & send transactions yourself.

---

## 📦 Installation

```bash
npm i @unclaimedsol/spl-burn-close-sdk
```

We use @solana/web3.js in peerDependencies to avoid version conflicts, so make sure you already have it installed.

Requires Node 18+. On Node 18, use a compatible locked dependency graph for web3.js;
fresh dependency resolution can select an ESM-only `uuid` through `rpc-websockets`
that breaks CommonJS loading. CI tests the repository’s locked dependency graph.

---

## 🔑 Usage

### Empty-account cleanup (requires the program upgrade)

```typescript
import { Connection, PublicKey } from "@solana/web3.js";
import {
  buildCloseEmptyTokenAccountsInstruction,
  buildCloseEmptyTokenAccountsTransactions,
  PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@unclaimedsol/spl-burn-close-sdk";

const connection = new Connection("https://api.mainnet-beta.solana.com");
declare const user: PublicKey;
declare const pairs: { mint: PublicKey; ata: PublicKey }[];

// Instruction only: no RPC calls. Returns null for an empty list.
const ix = await buildCloseEmptyTokenAccountsInstruction(
  PROGRAM_ID, user, pairs, TOKEN_PROGRAM_ID
);

// Unsigned batches: fetches one blockhash unless supplied in BuildOptions.
// Returns [] for an empty list. The default token program is classic SPL Token.
const txs = await buildCloseEmptyTokenAccountsTransactions(
  connection, PROGRAM_ID, user, pairs, { chunkSize: 12 }, TOKEN_PROGRAM_ID
);
// Sign and send using your wallet only after confirming upgrade availability.
```

Use `TOKEN_2022_PROGRAM_ID` for Token-2022. Each instruction uses one token program;
group accounts by program and build separate instructions or batches. `Pair.ata`
can also name a non-ATA token account. Both transaction builders use the same
`BuildOptions`, expiry metadata, fee payer defaults and packet-size checks below.

Eligibility is enforced by the upgraded program at execution, not by SDK RPC
balance checks. Ineligible targets may be skipped while eligible siblings close;
an entirely skipped batch may succeed. A built transaction or successful signature
alone does not prove every requested account closed. Check resulting account state
and execution results before reporting recovered amounts.

Funded WSOL, including unsynchronized SOL deposits, is excluded. A native account
must have zero token amount and lamports exactly equal to its recorded reserve.
The program does not burn, unwrap funded principal, or call `SyncNative` on this path.
Token-2022 support is conservative: supported account extensions are `ImmutableOwner`
and `TransferFeeAmount`, with `TransferFeeConfig` on mints. Other extensions are
skipped. Eligible withheld transfer fees may be harvested to the mint before closure.

The existing per-account fee policy applies only to successful closures; skipped
targets incur no service fee, though network transaction fees still apply. This
change addresses empty-token cleanup. It does not introduce checked buffer approvals
or guarantee exact preview proceeds. Buffer, reward and stake paths are outside this API.

Selector 2 validates effective transaction-wide privileges. Keep the fee recipient,
mints and token accounts nonsigners, and the token/system programs read-only. A
custom fee payer must not alias these accounts; the signing wallet may be the payer
but cannot also be the fee recipient. Instructions added to the same transaction
must preserve these requirements.

The ABI is verified against Rust commit
[`1f2b10ae668c47de97627de69cdf656878ed9b0e`](https://github.com/nedim1511/unclaimed-sol-close-token-program/commit/1f2b10ae668c47de97627de69cdf656878ed9b0e),
its [instruction specification](https://github.com/nedim1511/unclaimed-sol-close-token-program/blob/1f2b10ae668c47de97627de69cdf656878ed9b0e/docs/close-empty-token-accounts.md)
and [deterministic fixture](https://github.com/nedim1511/unclaimed-sol-close-token-program/blob/1f2b10ae668c47de97627de69cdf656878ed9b0e/tests/fixtures/close_empty_token_accounts.json).
Exact data is `[2]`; metas are writable fee recipient, writable signing wallet,
read-only token and system programs, then writable mint/token-account pairs.
Source and local runtime verification do not establish deployment.

### Intentional burning: signing with Keypair

```typescript
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  buildBurnAndCloseTransactions,
  PROGRAM_ID,
} from "@unclaimedsol/spl-burn-close-sdk";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const keypair = Keypair.fromSecretKey(/* Uint8Array */);
const user = keypair.publicKey;

// You can get easily obtain pairs using getTokenAccountsByOwner method
const pairs = [{ mint: new PublicKey("MINT_1"), ata: new PublicKey("ATA_1") }];

const txs = await buildBurnAndCloseTransactions(
  connection,
  PROGRAM_ID,
  user,
  pairs
);

for (const tx of txs) {
  tx.partialSign(keypair);
  const sig = await connection.sendRawTransaction(tx.serialize());
  const confirmation = await connection.confirmTransaction({
    signature: sig,
    blockhash: tx.recentBlockhash!,
    lastValidBlockHeight: tx.lastValidBlockHeight!,
  });
  if (confirmation.value.err) {
    throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  }
  console.log("✅ Confirmed:", sig);
}
```

### Intentional burning: signing with Wallet Adapter

```typescript
import { Connection, PublicKey } from "@solana/web3.js";
import {
  buildBurnAndCloseTransactions,
  PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@unclaimedsol/spl-burn-close-sdk";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const user = wallet.publicKey; // Wallet Adapter

// You can get easily obtain pairs using getTokenAccountsByOwner method
const pairs = [
  { mint: new PublicKey("MINT_1"), ata: new PublicKey("ATA_1") },
  { mint: new PublicKey("MINT_2"), ata: new PublicKey("ATA_2") },
];

const txs = await buildBurnAndCloseTransactions(
  connection,
  PROGRAM_ID,
  user,
  pairs
);

// For Token-2022 accounts, pass TOKEN_2022_PROGRAM_ID and consider using a smaller chunkSize:
// const txs = await buildBurnAndCloseTransactions(
//   connection,
//   PROGRAM_ID,
//   user,
//   pairs,
//   { chunkSize: 3 },
//   TOKEN_2022_PROGRAM_ID
// );

// Sign
const signed = wallet.signAllTransactions
  ? await wallet.signAllTransactions(txs)
  : await Promise.all(txs.map((t) => wallet.signTransaction!(t)));

// Send
for (const [index, stx] of signed.entries()) {
  // Wallets may reconstruct transactions and omit expiry metadata.
  const tx = txs[index];
  const sig = await connection.sendRawTransaction(stx.serialize());
  const confirmation = await connection.confirmTransaction({
    signature: sig,
    blockhash: tx.recentBlockhash!,
    lastValidBlockHeight: tx.lastValidBlockHeight!,
  });
  if (confirmation.value.err) {
    throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  }
  console.log("✅ Confirmed:", sig);
}
```

---

## Batching and blockhash expiry

`chunkSize` defaults to 12 and must be a finite positive integer. Invalid values and
transactions that cannot serialize within the legacy 1,232-byte limit now throw during
building. Size depends on unique accounts and signers, including a separate fee payer;
there is no fixed pair cap. Instructions added afterwards (including compute budget or
memo instructions) count against the same limit, so recheck size after adding them.

The app uses batches of 10 classic token accounts or 3 Token-2022 accounts and also adds
a compute-unit limit. These are production configuration values, not a guarantee for
every workload; this release did not simulate their compute usage. The SDK adds no
compute-budget instruction. Choose a batch size and compute budget for your workload.

Fetched transactions carry `recentBlockhash` and its matching `lastValidBlockHeight`.
If you supply `recentBlockhash`, supply its matching `lastValidBlockHeight` too when using
the confirmation examples above. Without an explicit height it remains undefined; the
SDK never fetches a height for a caller-supplied blockhash. A height supplied without a
blockhash is ignored in favor of the fetched pair. Confirm using the original transaction
metadata, even if the wallet returns a reconstructed signed transaction.

Instruction data is a browser-safe `Uint8Array` typed as `Buffer` for web3.js compatibility;
do not call Buffer-only methods on it.

## 🌐 Cluster support

This SDK targets the Unclaimed SOL mainnet program (`PROGRAM_ID`) and fee recipient (`FEE_RECIPIENT`).
Transactions will only succeed on a cluster where that program is deployed.

## Verification

Run `npm test` for encoding, unsigned transaction behavior and legacy regressions.
Run `npm run test:package` to pack the actual package, verify its contents, load
CJS/ESM exports and compile consumers with Node16 and bundler type resolution.

For local runtime evidence, run `npm run test:runtime` with the Rust repository
at `../unclaimed-sol-rust-program`, its verified SBF artifact already built, and
`solana-test-validator` installed. An alternative Rust checkout can be supplied
with `npm run test:runtime -- /path/to/unclaimed-sol-rust-program`.
The harness checks the pinned Rust commit and artifact hash, starts an isolated
validator on local ports 18899–18940, and uses generated test keys and synthetic
accounts. It verifies closures, fees, late deposits, WSOL exclusions and legacy
burning for both token programs. Temporary ledger/log files are retained at the
printed path. The runtime harness is excluded from the published package.

Local runtime success does not verify a deployed cluster or certify future token
program versions. See [the 1.4.0 release handoff](https://github.com/unclaimed-sol/spl-burn-close-sdk/blob/main/docs/release-1.4.0.md)
in the source repository for evidence limits and MCP adoption steps.

---

## 💻 Demo

There is a nice tutorial guide with a demo repository that shows the usage of the SDK to burn and close all token accounts for the wallet. You can find it [here](https://blog.unclaimedsol.com/close-burn-solana-tokens-web3js-sdk/).

---

## 📜 Disclaimer

This SDK only **builds instructions and unsigned transactions** for the selected cleanup path. You are solely responsible for signing and sending them. We are not liable for any loss of funds.

---

## 📃 License

MIT © [Unclaimed SOL](https://unclaimedsol.com)
