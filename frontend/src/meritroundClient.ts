import { createClient } from "genlayer-js";
import { localnet } from "genlayer-js/chains";
import {
  ExecutionResult,
  GenLayerClient,
  TransactionHash,
  TransactionStatus,
} from "genlayer-js/types";
import type { Account, Address } from "viem";

export type RoundState =
  | "DRAFT"
  | "OPEN"
  | "LOCKED"
  | "EVALUATING"
  | "FINALIZED"
  | "INCONCLUSIVE";

export interface RoundView {
  round_id: string;
  organizer: Address;
  title: string;
  description: string;
  rubric: string;
  state: RoundState;
  submission_ids: string[];
  finalist_ids: string[];
  evaluation_universe_digest: string;
}

export interface ResultView {
  exists: boolean;
  round_id?: string;
  outcome?: "WINNER" | "INCONCLUSIVE";
  submission_id?: string;
  result_digest?: string;
  evaluation_universe_digest?: string;
  resolver?: Address;
}

export interface TransactionStore {
  read(operationId: string): TransactionHash | undefined;
  write(operationId: string, hash: TransactionHash): void;
}

export class MemoryTransactionStore implements TransactionStore {
  private readonly hashes = new Map<string, TransactionHash>();

  read(operationId: string): TransactionHash | undefined {
    return this.hashes.get(operationId);
  }

  write(operationId: string, hash: TransactionHash): void {
    this.hashes.set(operationId, hash);
  }
}

export class MeritRoundClient {
  readonly client: GenLayerClient<any>;
  private readonly address: Address;
  private readonly transactions: TransactionStore;

  constructor(
    contractAddress: Address,
    options: {
      endpoint?: string;
      account?: Account | Address;
      transactionStore?: TransactionStore;
    } = {},
  ) {
    this.address = contractAddress;
    this.transactions = options.transactionStore ?? new MemoryTransactionStore();
    this.client = createClient({
      chain: localnet,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      ...(options.account ? { account: options.account } : {}),
    });
  }

  async getRound(roundId: string): Promise<RoundView> {
    return (await this.client.readContract({
      address: this.address,
      functionName: "get_round",
      args: [roundId],
    })) as unknown as RoundView;
  }

  async getResult(roundId: string): Promise<ResultView> {
    return (await this.client.readContract({
      address: this.address,
      functionName: "get_result",
      args: [roundId],
    })) as unknown as ResultView;
  }

  async getRoundIds(): Promise<string[]> {
    return (await this.client.readContract({
      address: this.address,
      functionName: "get_round_ids",
      args: [],
    })) as unknown as string[];
  }

  async sendWriteOnce(
    operationId: string,
    functionName: string,
    args: Array<string>,
  ): Promise<TransactionHash> {
    const existingHash = this.transactions.read(operationId);
    if (existingHash) {
      return existingHash;
    }

    const hash = (await this.client.writeContract({
      address: this.address,
      functionName,
      args,
      value: 0n,
    })) as TransactionHash;

    // Persist before any polling or readback. A refresh must reconcile this hash.
    this.transactions.write(operationId, hash);
    return hash;
  }

  async reconcileWrite(
    hash: TransactionHash,
    expectedReadback: () => Promise<unknown>,
  ): Promise<unknown> {
    const receipt = await this.client.waitForTransactionReceipt({
      hash,
      status: TransactionStatus.FINALIZED,
    });

    if (receipt.statusName !== TransactionStatus.FINALIZED) {
      throw new Error("Transaction did not reach FINALIZED status");
    }
    if (receipt.txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN) {
      throw new Error(
        `Transaction execution did not succeed: ${receipt.txExecutionResultName ?? "UNKNOWN"}`,
      );
    }

    return expectedReadback();
  }
}
