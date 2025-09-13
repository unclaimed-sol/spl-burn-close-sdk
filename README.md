# Burn and Close Solana SPL Tokens SDK

A lightweight Solana SDK to **burn SPL tokens and close token accounts** with a **fixed 5%** protocol fee.
This library only **builds unsigned transactions** – you handle signing and sending them, whether in the browser (Wallet Adapter) or server (Keypair).

## ✨ Features

- 🔥 Burn all tokens in provided ATAs.
- 🧹 Close token accounts, reclaiming rent to the user.
- 💸 Automatic 5% protocol fee (hardcoded in program).
- ⚡ Automatic batching (default 12 ATAs per transaction).
- 🔐 Supports **frontend partial signing** and **backend full signing** workflows.
- 🚀 No hidden config: single function to integrate.

---

## 📦 Installation

```bash
npm i @unclaimedsol/spl-burn-close-sdk @solana/web3.js
```

We use peerDependencies to avoid version conflicts.

Requires Node 18+.

## 🔑 Usage

### Signing with Keypair

```typescript
import { Connection, Keypair } from "@solana/web3.js";
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
  let latestBlockhash = await connection.getLatestBlockhash(
    connection.commitment
  );
  await connection.confirmTransaction({
    signature: sig,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  });
  console.log("✅ Sent:", sig);
}
```

### Signing with Wallet Adapter

```typescript
import { Connection, PublicKey } from "@solana/web3.js";
import {
  buildBurnAndCloseTransactions,
  PROGRAM_ID,
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

// Sign
const signed = wallet.signAllTransactions
  ? await wallet.signAllTransactions(txs)
  : await Promise.all(txs.map((t) => wallet.signTransaction!(t)));

// Send
for (const stx of signed) {
  const sig = await connection.sendRawTransaction(tx.serialize());
  let latestBlockhash = await connection.getLatestBlockhash(
    connection.commitment
  );
  await connection.confirmTransaction({
    signature: sig,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  });
  console.log("✅ Sent:", sig);
}
```

## 🧩 How It Works

1. The SDK prepares TransactionInstructions for your on-chain burn+close program.
2. Program burns tokens in each ATA, then closes it, sending rent back to the owner.
3. A 5% fee is enforced on-chain and sent to the hardcoded recipient.
4. The SDK never asks for private keys — you sign & send transactions yourself.

## 📜 License

MIT © [Unclaimed SOL](https://unclaimedsol.com)
