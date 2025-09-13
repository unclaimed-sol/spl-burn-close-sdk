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

/** Fixed fee percentage enforced by the program (5%) */
export const FIXED_FEE_PERCENTAGE = 5; // do not change

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
   * we fetch a fresh one per transaction.
   */
  recentBlockhash?: string;
};

/**
 * Build *unsigned* transactions that call the on-chain burn+close program.
 * You sign and send them yourself (frontend wallet or backend keypair).
 *
 * @param connection  Solana RPC connection
 * @param programId   Your deployed program ID
 * @param user        The user whose ATAs will be burned/closed
 * @param pairs       Array of { mint, ata } to process
 * @param options     Chunking / blockhash / payer tweaks
 * @returns           Array of *unsigned* Transaction objects
 */
export async function buildBurnAndCloseTransactions(
  connection: Connection,
  programId: PublicKey,
  user: PublicKey,
  pairs: Pair[],
  options: BuildOptions = {}
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

  // Instruction data: [selector=0, fee_pct=5]
  const data = Buffer.from([0, FIXED_FEE_PERCENTAGE]);

  const txs: Transaction[] = [];
  for (const chunk of chunks) {
    const keys = [
      // NOTE: Mark the user as signer in the instruction meta;
      // the caller must actually sign the Transaction later.
      { pubkey: FEE_RECIPIENT,           isSigner: false, isWritable: true },
      { pubkey: user,                    isSigner: true,  isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID,        isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    for (const { mint, ata } of chunk) {
      keys.push(
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: ata,  isSigner: false, isWritable: true },
      );
    }

    const ix = new TransactionInstruction({
      programId,
      keys,
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = feePayer;
    // Use provided blockhash or fetch one
    if (options.recentBlockhash) {
      tx.recentBlockhash = options.recentBlockhash;
    } else {
      const { blockhash } = await connection.getLatestBlockhash({ commitment });
      tx.recentBlockhash = blockhash;
    }

    txs.push(tx);
  }

  return txs;
}
