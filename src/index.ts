import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  Commitment,
} from "@solana/web3.js";

/** Exporting on-chain program ID for convenience */
export const PROGRAM_ID = new PublicKey("UNCaXzXkR3vp8mbCJyxWUvwuRk5uHgzrwe6jcWPfiUR");

/** Hardcoded fee recipient on-chain expectation */
export const FEE_RECIPIENT = new PublicKey(
  "uncNCRycMtNPj2kXHfwiCgNrzCTnC9xU5FS8ZeWyn3M"
);

export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

export const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);

export type Pair = { mint: PublicKey; ata: PublicKey };

export type BuildOptions = {
  /** Max pairs per transaction (default: 12) */
  chunkSize?: number;
  /** Use this commitment when fetching blockhash (default: "confirmed") */
  commitment?: Commitment;
  /**
   * Optional explicit fee payer (defaults to `user`)
   * Note: whoever signs must cover fees on-chain.
   */
  feePayer?: PublicKey;
  /**
   * Provide your own recent blockhash (advanced). If omitted,
   * we fetch a fresh one and reuse it for all built transactions.
   */
  recentBlockhash?: string;
};

/**
 * Build *unsigned* transactions that call the on-chain burn+close program.
 * You sign and send them yourself (frontend wallet or backend keypair).
 *
 * @param connection      Solana RPC connection
 * @param programId       Your deployed program ID
 * @param user            The user whose ATAs will be burned/closed
 * @param pairs           Array of { mint, ata } to process
 * @param options         Chunking / blockhash / payer tweaks
 * @param tokenProgramId  Support for multiple Token programs
 * @returns               Array of *unsigned* Transaction objects
 */
export async function buildBurnAndCloseTransactions(
  connection: Connection,
  programId: PublicKey,
  user: PublicKey,
  pairs: Pair[],
  options: BuildOptions = {},
  tokenProgramId = TOKEN_PROGRAM_ID
): Promise<Transaction[]> {
  if (!pairs.length) return [];

  const chunkSize = Math.max(1, options.chunkSize ?? 12);
  const commitment = options.commitment ?? "confirmed";
  const feePayer = options.feePayer ?? user;

  // Split into chunks so we stay under CU / account limits
  const chunks: Pair[][] = [];
  for (let i = 0; i < pairs.length; i += chunkSize) {
    chunks.push(pairs.slice(i, i + chunkSize));
  }

  // Instruction data: [selector=0]
  // Use Uint8Array (browser-safe) and cast for web3.js' Buffer typing.
  const data = new Uint8Array([0]) as unknown as Buffer;

  const recentBlockhash =
    options.recentBlockhash ??
    (await connection.getLatestBlockhash({ commitment })).blockhash;

  const txs: Transaction[] = [];
  for (const chunk of chunks) {
    const keys = [
      // NOTE: Mark the user as signer in the instruction meta;
      // the caller must actually sign the Transaction later.
      { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    for (const { mint, ata } of chunk) {
      keys.push(
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: ata, isSigner: false, isWritable: true }
      );
    }

    const ix = new TransactionInstruction({
      programId,
      keys,
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = feePayer;
    tx.recentBlockhash = recentBlockhash;

    txs.push(tx);
  }

  return txs;
}

/**
 * Build a single **TransactionInstruction** that calls the on-chain
 * burn+close program for a specific Token Program (either SPL Token or Token-2022).
 *
 * Unlike `buildBurnAndCloseTransactions`, this helper does **not**
 * create or sign full transactions — it only constructs one
 * instruction for a batch of (mint, ATA) pairs.
 */
export async function buildBurnAndCloseInstruction(
  programId: PublicKey,
  user: PublicKey,
  pairs: Pair[],
  tokenProgramId: PublicKey
): Promise<TransactionInstruction | null> {
  if (!pairs.length) {
    return null;
  }

  // instruction data selector: 0 = burn_and_close_token_accounts
  const data = new Uint8Array([0]) as unknown as Buffer;

  // accounts order MUST match the on-chain program's expectation:
  // [0] fee_recipient_account (your fee recipient)
  // [1] user_wallet_account (the signer)
  // [2] token_program_account (SPL Token program or Token-2022 program)
  // [3] system_program_account
  // then repeating (mint, ata) pairs, both writable
  const keys = [
    { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: tokenProgramId, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  for (const { mint, ata } of pairs) {
    keys.push(
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true }
    );
  }

  return new TransactionInstruction({
    programId,
    keys,
    data,
  });
}
