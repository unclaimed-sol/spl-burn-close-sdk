# Burn and Close Solana SPL Tokens SDK

A lightweight Solana SDK to **burn SPL tokens and close token accounts** with the June 2026 Unclaimed SOL token cleanup fee policy.
This library only **builds unsigned transactions** – you handle signing and sending them, whether in the browser (Wallet Adapter) or server (Keypair).

## ✨ Features

- 🔥 Burn all tokens in provided ATAs.
- 🧹 Close token accounts, reclaiming rent to the user.
- 💸 On-chain fee recipient is enforced by the program.
- 🧾 Hybrid cleanup fee: `max(floor(gross * 200 / 10000), gross - 2,000,000)` lamports per closed account. For 2,039,280 lamports recovered, the fee is 40,785 lamports.
- ⚡ Automatic batching (default 12 ATAs per transaction).
- 🪙 Supports SPL Token and Token-2022.
- 🔐 Supports **frontend partial signing** and **backend full signing** workflows.
- 🚀 No hidden config: single function to integrate.

---

## 🧩 How It Works

1. The SDK prepares TransactionInstructions for your on-chain burn+close program.
2. Program burns tokens in each ATA, then closes it, sending rent back to the owner.
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

### Signing with Keypair

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

### Signing with Wallet Adapter

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

---

## 💻 Demo

There is a nice tutorial guide with a demo repository that shows the usage of the SDK to burn and close all token accounts for the wallet. You can find it [here](https://blog.unclaimedsol.com/close-burn-solana-tokens-web3js-sdk/).

---

## 📜 Disclaimer

This SDK only **builds transactions** to burn tokens and close accounts. You are solely responsible for signing and sending them. We are not liable for any loss of funds.

---

## 📃 License

MIT © [Unclaimed SOL](https://unclaimedsol.com)
