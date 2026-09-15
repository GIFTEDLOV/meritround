import { createClient } from "genlayer-js";
import { localnet, studionet, testnetBradbury } from "genlayer-js/chains";
import { TransactionHashVariant, TransactionStatus } from "genlayer-js/types";
import type { GenLayerClient, TransactionHash } from "genlayer-js/types";
import { getAddress } from "viem";
import type { Address } from "viem";

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
  selected_ids: string[];
  selected_count: number;
  finalist_ids: string[];
  evaluation_universe_digest: string;
}

export type SelectionState = "REGISTERED" | "SELECTED" | "LOCKED_FINALIST";

export type EvidenceStatus = "NOT_PINNED" | "READY";

export interface SubmissionView {
  submission_id: string;
  round_id: string;
  submitter: Address;
  title: string;
  evidence_url: string;
  expected_sha256: string;
  selection_state: SelectionState;
}

export interface EvidenceStatusView {
  round_id: string;
  submission_id: string;
  status: EvidenceStatus;
  expected_sha256: string;
  snapshot_sha256: string;
  source_url: string;
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

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

export type MeritRoundNetwork = "localnet" | "studio-dev" | "studionet" | "bradbury";

export interface MeritRoundConfig {
  network: MeritRoundNetwork;
  endpoint: string;
  chainId: number;
  contractAddress?: Address;
}

const DEFAULT_NETWORKS: Record<MeritRoundNetwork, Omit<MeritRoundConfig, "network">> = {
  localnet: { endpoint: "http://127.0.0.1:4000/api", chainId: 61127 },
  "studio-dev": { endpoint: "https://studio-dev.genlayer.com/api", chainId: 61997 },
  studionet: { endpoint: "https://studio.genlayer.com/api", chainId: 61999 },
  bradbury: { endpoint: "https://rpc-bradbury.genlayer.com", chainId: 4221 },
};

export function loadMeritRoundConfig(): MeritRoundConfig {
  const rawNetwork = import.meta.env.VITE_MERITROUND_NETWORK?.trim().toLowerCase() || "studionet";
  if (rawNetwork !== "localnet" && rawNetwork !== "studio-dev" && rawNetwork !== "studionet" && rawNetwork !== "bradbury") {
    throw new Error(`MERITROUND_INVALID_NETWORK: ${rawNetwork}`);
  }
  const network = rawNetwork as MeritRoundNetwork;
  const defaults = DEFAULT_NETWORKS[network];
  const endpoint = import.meta.env.VITE_GENLAYER_ENDPOINT?.trim() || defaults.endpoint;
  const chainId = Number(import.meta.env.VITE_GENLAYER_CHAIN_ID || defaults.chainId);
  if (!Number.isInteger(chainId) || chainId !== defaults.chainId) {
    throw new Error(`MERITROUND_INVALID_CHAIN_ID: expected ${defaults.chainId}`);
  }
  if (network !== "localnet" && !endpoint.startsWith("https://")) {
    throw new Error("MERITROUND_INVALID_ENDPOINT: public networks require HTTPS");
  }
  const rawAddress = import.meta.env.VITE_MERITROUND_CONTRACT_ADDRESS?.trim();
  if (rawAddress && !/^0x[0-9a-fA-F]{40}$/.test(rawAddress)) {
    throw new Error("MERITROUND_INVALID_CONTRACT_ADDRESS");
  }
  const contractAddress = rawAddress ? getAddress(rawAddress) : undefined;
  return {
    network,
    endpoint,
    chainId,
    ...(contractAddress ? { contractAddress } : {}),
  };
}

export function getInjectedProvider(): Eip1193Provider | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { ethereum?: Eip1193Provider }).ethereum;
}

export type WalletConnectionStatus =
  | "unavailable"
  | "disconnected"
  | "connected"
  | "wrong-network";

export interface WalletState {
  status: WalletConnectionStatus;
  address?: Address;
  chainId?: number;
}

export class WalletError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "WalletError";
  }
}

function chainIdHex(chainId: number): string {
  return `0x${chainId.toString(16)}`;
}

function normalizeAccounts(value: unknown): Address[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((account): account is string => typeof account === "string")
    .map((account) => getAddress(account));
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface TransactionExpectedState {
  kind:
    | "round-created"
    | "round-state"
    | "round-selection"
    | "round-locked"
    | "evidence-ready"
    | "submission-registered"
    | "round-result"
    | "round-terminal";
  roundId?: string;
  submissionId?: string;
  state?: RoundState;
  outcome?: "WINNER" | "INCONCLUSIVE";
  states?: RoundState[];
  selected?: boolean;
  finalistIds?: string[];
}

export type TransactionPhase =
  | "PREPARING"
  | "WAITING_FOR_WALLET"
  | "SUBMITTED"
  | "QUEUED"
  | "DECISION_AVAILABLE"
  | "WAITING_FOR_FINALITY"
  | "EXECUTION_VERIFIED"
  | "RESOLVED"
  | "FAILED"
  | "TRACKING_INTERRUPTED";

export interface TransactionRecord {
  operationId: string;
  txId: TransactionHash;
  evmTxHash?: TransactionHash;
  network: MeritRoundNetwork;
  chainId: number;
  contractAddress: Address;
  method: string;
  argsDigest: string;
  roundId?: string;
  submissionId?: string;
  expectedState: TransactionExpectedState;
  submittedAt: string;
  updatedAt: string;
  phase: TransactionPhase;
  latestStatus?: string;
  latestResult?: string;
  latestExecution?: string;
  queuePosition?: number;
  terminal: boolean;
  error?: string;
}

export interface TransactionStore {
  get(operationId: string): TransactionRecord | undefined;
  list(): TransactionRecord[];
  upsert(record: TransactionRecord): void;
}

const STORAGE_KEY = "meritround:transactions:v2";

export class MemoryTransactionStore implements TransactionStore {
  private readonly records = new Map<string, TransactionRecord>();

  get(operationId: string): TransactionRecord | undefined {
    return this.records.get(operationId);
  }

  list(): TransactionRecord[] {
    return [...this.records.values()];
  }

  upsert(record: TransactionRecord): void {
    this.records.set(record.operationId, record);
  }
}

export class PersistentTransactionStore implements TransactionStore {
  constructor(
    private readonly storage: StorageLike,
    private readonly key = STORAGE_KEY,
  ) {}

  get(operationId: string): TransactionRecord | undefined {
    return this.list().find((record) => record.operationId === operationId);
  }

  list(): TransactionRecord[] {
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isTransactionRecord);
    } catch {
      return [];
    }
  }

  upsert(record: TransactionRecord): void {
    const records = this.list().filter(
      (candidate) => candidate.operationId !== record.operationId,
    );
    records.push(record);
    this.storage.setItem(this.key, JSON.stringify(records));
  }
}

export function createBrowserTransactionStore(): TransactionStore {
  if (typeof window === "undefined" || !window.localStorage) {
    return new MemoryTransactionStore();
  }
  return new PersistentTransactionStore(window.localStorage);
}

function isTransactionRecord(value: unknown): value is TransactionRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<TransactionRecord>;
  return (
    typeof record.operationId === "string" &&
    typeof record.txId === "string" &&
    /^0x[0-9a-fA-F]+$/.test(record.txId) &&
    (record.network === "localnet" || record.network === "studio-dev" || record.network === "studionet" || record.network === "bradbury") &&
    typeof record.chainId === "number" &&
    typeof record.contractAddress === "string" &&
    typeof record.method === "string" &&
    typeof record.argsDigest === "string" &&
    typeof record.expectedState === "object" &&
    record.expectedState !== null &&
    typeof record.submittedAt === "string" &&
    typeof record.updatedAt === "string" &&
    typeof record.phase === "string" &&
    typeof record.terminal === "boolean"
  );
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function sha256Hex(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("SHA-256 is unavailable in this browser context");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[^\u0000-\u007F]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export async function computeRoundId(
  organizer: Address,
  title: string,
  description: string,
  rubric: string,
): Promise<string> {
  return sha256Hex(
    asciiJson([
      "MERITROUND_ROUND_V2",
      getAddress(organizer),
      title,
      description,
      rubric,
    ]),
  );
}

export async function computeSubmissionId(
  roundId: string,
  submitter: Address,
  title: string,
  _evidenceUrl: string,
  expectedSha256: string,
): Promise<string> {
  return sha256Hex(
    asciiJson([
      "MERITROUND_SUBMISSION_V2",
      roundId,
      getAddress(submitter),
      title,
      expectedSha256,
    ]),
  );
}

export async function makeOperationId(
  config: MeritRoundConfig,
  account: Address,
  method: string,
  args: unknown[],
): Promise<string> {
  return `${config.network}:${config.chainId}:${config.contractAddress}:${getAddress(account)}:${method}:${await sha256Hex(stableSerialize(args))}`;
}

export interface NormalizedTransaction {
  statusName: string;
  resultName?: string;
  executionResultName: string;
  queuePosition?: number;
  raw: Record<string, any>;
}

export function normalizeTransaction(transaction: unknown): NormalizedTransaction {
  const raw = (transaction ?? {}) as Record<string, any>;
  const leaderReceipt = Array.isArray(raw.consensus_data?.leader_receipt)
    ? raw.consensus_data.leader_receipt[0]
    : raw.consensus_data?.leader_receipt;
  return {
    statusName: String(raw.statusName ?? raw.status_name ?? "UNINITIALIZED"),
    resultName: raw.resultName ?? raw.result_name,
    executionResultName: String(
      raw.txExecutionResultName ??
        raw.tx_execution_result_name ??
        leaderReceipt?.execution_result ??
        "NOT_VOTED",
    ),
    queuePosition:
      raw.queuePosition === undefined && raw.queue_position === undefined
        ? undefined
        : Number(raw.queuePosition ?? raw.queue_position),
    raw,
  };
}

function executionSucceeded(executionResultName: string): boolean {
  return executionResultName === "FINISHED_WITH_RETURN" || executionResultName === "SUCCESS";
}

function isDecisionAvailable(statusName: string): boolean {
  return statusName === "ACCEPTED" || statusName === "FINALIZED";
}

function isFinalized(statusName: string): boolean {
  return statusName === "FINALIZED";
}

function isTerminalFailure(statusName: string): boolean {
  return ["CANCELED", "UNDETERMINED", "VALIDATORS_TIMEOUT", "LEADER_TIMEOUT"].includes(statusName);
}

function phaseFor(statusName: string): TransactionPhase {
  if (statusName === "PENDING" || statusName === "PROPOSING") return "QUEUED";
  if (isDecisionAvailable(statusName)) return "DECISION_AVAILABLE";
  return "WAITING_FOR_FINALITY";
}

interface ContractClientSurface {
  readContract(args: Record<string, unknown>): Promise<unknown>;
  writeContract(args: Record<string, unknown>): Promise<TransactionHash>;
  getTransaction(args: { hash: TransactionHash }): Promise<unknown>;
  waitForTransactionReceipt(args: {
    hash: TransactionHash;
    status?: TransactionStatus;
    interval?: number;
    retries?: number;
  }): Promise<unknown>;
}

export interface WriteOperation {
  operationId: string;
  method: string;
  args: unknown[];
  expectedState: TransactionExpectedState;
  roundId?: string;
  submissionId?: string;
}

export interface ReconcileResult {
  record: TransactionRecord;
  normalized?: NormalizedTransaction;
  success: boolean;
}

export class MeritRoundClient {
  readonly config: MeritRoundConfig;
  readonly readClient: GenLayerClient<any>;
  private writeClient?: GenLayerClient<any>;
  private provider?: Eip1193Provider;
  private account?: Address;
  readonly transactions: TransactionStore;

  constructor(
    config: MeritRoundConfig,
    transactions: TransactionStore = createBrowserTransactionStore(),
  ) {
    this.config = config;
    this.transactions = transactions;
    this.readClient = this.buildClient();
  }

  get isConfigured(): boolean {
    return Boolean(this.config.contractAddress);
  }

  get walletAddress(): Address | undefined {
    return this.account;
  }

  get walletProvider(): Eip1193Provider | undefined {
    return this.provider;
  }

  private chain() {
    if (this.config.network === "localnet") return localnet;
    if (this.config.network === "bradbury") return testnetBradbury;
    return studionet;
  }

  private buildClient(account?: Address, provider?: Eip1193Provider): GenLayerClient<any> {
    return createClient({
      chain: this.chain(),
      endpoint: this.config.endpoint,
      ...(account ? { account } : {}),
      ...(provider ? { provider: provider as any } : {}),
    });
  }

  private contractAddress(): Address {
    if (!this.config.contractAddress) {
      throw new Error("MERITROUND_NOT_CONFIGURED: set VITE_MERITROUND_CONTRACT_ADDRESS");
    }
    return this.config.contractAddress;
  }

  private async read(functionName: string, args: unknown[] = []): Promise<unknown> {
    return this.readClient.readContract({
      address: this.contractAddress(),
      functionName,
      args: args as any,
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    });
  }

  async getRound(roundId: string): Promise<RoundView> {
    return (await this.read("get_round", [roundId])) as unknown as RoundView;
  }

  async getRoundIds(): Promise<string[]> {
    return (await this.read("get_round_ids")) as unknown as string[];
  }

  async getSubmission(submissionId: string): Promise<SubmissionView> {
    return (await this.read("get_submission", [submissionId])) as unknown as SubmissionView;
  }

  async getEvidenceStatus(roundId: string, submissionId: string): Promise<EvidenceStatusView> {
    return (await this.read("get_evidence_status", [roundId, submissionId])) as unknown as EvidenceStatusView;
  }

  async getResult(roundId: string): Promise<ResultView> {
    return (await this.read("get_result", [roundId])) as unknown as ResultView;
  }

  async getContractInfo(): Promise<Record<string, unknown>> {
    return (await this.read("contract_info")) as Record<string, unknown>;
  }

  async getWalletState(): Promise<WalletState> {
    const provider = getInjectedProvider();
    if (!provider) return { status: "unavailable" };
    const accounts = normalizeAccounts(await provider.request({ method: "eth_accounts" }));
    if (accounts.length === 0) return { status: "disconnected" };
    const chainId = parseInt(String(await provider.request({ method: "eth_chainId" })), 16);
    return {
      status: chainId === this.config.chainId ? "connected" : "wrong-network",
      address: accounts[0],
      chainId,
    };
  }

  async connectWallet(): Promise<WalletState> {
    const provider = getInjectedProvider();
    if (!provider) {
      throw new WalletError("WALLET_UNAVAILABLE", "Install or unlock an EIP-1193 browser wallet to continue.");
    }
    let accounts: Address[];
    try {
      accounts = normalizeAccounts(await provider.request({ method: "eth_requestAccounts" }));
    } catch {
      throw new WalletError("WALLET_REJECTED", "The transaction was not approved in your wallet.");
    }
    if (accounts.length === 0) {
      throw new WalletError("WALLET_DISCONNECTED", "No wallet account is connected.");
    }
    const chainId = parseInt(String(await provider.request({ method: "eth_chainId" })), 16);
    this.account = accounts[0];
    this.provider = provider;
    if (chainId !== this.config.chainId) {
      throw new WalletError("WRONG_NETWORK", `Switch to ${this.config.network} (chain ${this.config.chainId}) to continue.`);
    }
    this.writeClient = this.buildClient(this.account, provider);
    return { status: "connected", address: this.account, chainId };
  }

  async switchToConfiguredNetwork(): Promise<void> {
    const provider = this.provider ?? getInjectedProvider();
    if (!provider) throw new WalletError("WALLET_UNAVAILABLE", "No browser wallet found.");
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex(this.config.chainId) }],
    });
    await this.connectWallet();
  }

  subscribeWallet(onChange: () => void): () => void {
    const provider = getInjectedProvider();
    if (!provider?.on) return () => undefined;
    provider.on("accountsChanged", onChange);
    provider.on("chainChanged", onChange);
    return () => {
      provider.removeListener?.("accountsChanged", onChange);
      provider.removeListener?.("chainChanged", onChange);
    };
  }

  private requireWritableClient(): ContractClientSurface {
    if (!this.writeClient || !this.account) {
      throw new WalletError("WALLET_NOT_READY", "Connect a wallet on the configured network before writing.");
    }
    return this.writeClient as unknown as ContractClientSurface;
  }

  async sendWriteOnce(operation: WriteOperation): Promise<TransactionRecord> {
    const existing = this.transactions.get(operation.operationId);
    if (existing) {
      if (
        existing.network !== this.config.network ||
        existing.chainId !== this.config.chainId ||
        existing.contractAddress !== this.contractAddress()
      ) {
        throw new Error("TRANSACTION_RECORD_SCOPE_MISMATCH");
      }
      return existing;
    }

    // Compute optional metadata before broadcasting. Once a protocol ID exists,
    // every subsequent failure must remain recoverable by that exact ID.
    const argsDigest = await sha256Hex(stableSerialize(operation.args));
    const startedAt = new Date().toISOString();
    let txId: TransactionHash;
    let evmTxHash: TransactionHash | undefined;
    const makeRecord = (id: TransactionHash, error?: string): TransactionRecord => ({
      operationId: operation.operationId,
      txId: id,
      ...(evmTxHash ? { evmTxHash } : {}),
      network: this.config.network,
      chainId: this.config.chainId,
      contractAddress: this.contractAddress(),
      method: operation.method,
      argsDigest,
      ...(operation.roundId ? { roundId: operation.roundId } : {}),
      ...(operation.submissionId ? { submissionId: operation.submissionId } : {}),
      expectedState: operation.expectedState,
      submittedAt: startedAt,
      updatedAt: startedAt,
      phase: "SUBMITTED",
      terminal: false,
      ...(error ? { error } : {}),
    });

    try {
      const client = this.requireWritableClient();
      txId = await client.writeContract({
        address: this.contractAddress(),
        functionName: operation.method,
        args: operation.args,
        value: 0n,
      });
      if (typeof txId !== "string" || !/^0x[0-9a-fA-F]+$/.test(txId)) {
        throw new Error("GENLAYER_WRITE_HASH_MISSING: refusing to track a write without its transaction ID");
      }
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "The wallet or network rejected the transaction.");
    }

    const record = makeRecord(txId);

    // Persist the exact ID before any polling or retry. Refresh recovery reconciles this record.
    this.transactions.upsert(record);
    return record;
  }

  private async verifyExpectedState(expected: TransactionExpectedState): Promise<boolean> {
    switch (expected.kind) {
      case "round-created":
        if (!expected.roundId) return false;
        await this.getRound(expected.roundId);
        return true;
      case "round-state":
        if (!expected.roundId || !expected.state) return false;
        return (await this.getRound(expected.roundId)).state === expected.state;
      case "round-selection":
        if (!expected.roundId || !expected.submissionId || expected.selected === undefined) return false;
        {
          const selected = (await this.getRound(expected.roundId)).selected_ids;
          return selected.includes(expected.submissionId) === expected.selected;
        }
      case "round-locked":
        if (!expected.roundId || !expected.finalistIds) return false;
        {
          const finalists = (await this.getRound(expected.roundId)).finalist_ids;
          return finalists.length === expected.finalistIds.length &&
            finalists.every((id, index) => id === expected.finalistIds?.[index]);
        }
      case "evidence-ready":
        if (!expected.roundId || !expected.submissionId) return false;
        return (await this.getEvidenceStatus(expected.roundId, expected.submissionId)).status === "READY";
      case "submission-registered":
        if (!expected.submissionId) return false;
        await this.getSubmission(expected.submissionId);
        return true;
      case "round-result":
        if (!expected.roundId || !expected.outcome) return false;
        {
          const result = await this.getResult(expected.roundId);
          return result.exists === true && result.outcome === expected.outcome;
        }
      case "round-terminal":
        if (!expected.roundId || !expected.states?.length) return false;
        {
          const round = await this.getRound(expected.roundId);
          const result = await this.getResult(expected.roundId);
          return expected.states.includes(round.state) && result.exists === true;
        }
    }
  }

  async reconcile(record: TransactionRecord): Promise<ReconcileResult> {
    let transaction: unknown;
    try {
      transaction = await this.readClient.getTransaction({ hash: record.txId });
    } catch (error) {
      const interrupted: TransactionRecord = {
        ...record,
        phase: "TRACKING_INTERRUPTED",
        updatedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Transaction tracking interrupted",
      };
      this.transactions.upsert(interrupted);
      return { record: interrupted, success: false };
    }

    const normalized = normalizeTransaction(transaction);
    let next: TransactionRecord = {
      ...record,
      updatedAt: new Date().toISOString(),
      latestStatus: normalized.statusName,
      ...(normalized.resultName ? { latestResult: normalized.resultName } : {}),
      latestExecution: normalized.executionResultName,
      ...(normalized.queuePosition !== undefined ? { queuePosition: normalized.queuePosition } : {}),
      phase: phaseFor(normalized.statusName),
      error: undefined,
    };

    if (isTerminalFailure(normalized.statusName)) {
      next = { ...next, phase: "FAILED", terminal: true, error: "Validators could not establish a final decision." };
      this.transactions.upsert(next);
      return { record: next, normalized, success: false };
    }

    if (isFinalized(normalized.statusName)) {
      if (!executionSucceeded(normalized.executionResultName)) {
        next = { ...next, phase: "FAILED", terminal: true, error: "The transaction reached finality but contract execution failed." };
        this.transactions.upsert(next);
        return { record: next, normalized, success: false };
      }
      try {
        if (!(await this.verifyExpectedState(record.expectedState))) {
          next = { ...next, phase: "FAILED", terminal: true, error: "Execution succeeded but expected contract state was not observed." };
          this.transactions.upsert(next);
          return { record: next, normalized, success: false };
        }
      } catch (error) {
        next = { ...next, phase: "TRACKING_INTERRUPTED", error: error instanceof Error ? error.message : "Final state readback interrupted" };
        this.transactions.upsert(next);
        return { record: next, normalized, success: false };
      }
      next = { ...next, phase: "RESOLVED", terminal: true };
    }

    this.transactions.upsert(next);
    return { record: next, normalized, success: next.phase === "RESOLVED" };
  }

  async waitForFinality(record: TransactionRecord): Promise<ReconcileResult> {
    await this.readClient.waitForTransactionReceipt({
      hash: record.txId,
      status: TransactionStatus.FINALIZED,
      interval: 5_000,
      retries: 120,
    });
    return this.reconcile(record);
  }

  async recoverPending(): Promise<TransactionRecord[]> {
    const pending = this.transactions.list().filter(
      (record) =>
        !record.terminal &&
        record.network === this.config.network &&
        record.chainId === this.config.chainId &&
        record.contractAddress === this.config.contractAddress,
    );
    const recovered: TransactionRecord[] = [];
    for (const record of pending) recovered.push((await this.reconcile(record)).record);
    return recovered;
  }

  async trackUntilTerminal(
    record: TransactionRecord,
    onUpdate: (record: TransactionRecord) => void,
    options: { intervalMs?: number; attempts?: number } = {},
  ): Promise<TransactionRecord> {
    const intervalMs = options.intervalMs ?? 3_000;
    const attempts = options.attempts ?? 40;
    let current = record;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const result = await this.reconcile(current);
      current = result.record;
      onUpdate(current);
      if (current.terminal) return current;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    const interrupted: TransactionRecord = {
      ...current,
      phase: "TRACKING_INTERRUPTED",
      updatedAt: new Date().toISOString(),
      error: "Tracking timed out; the same transaction ID remains recoverable.",
    };
    this.transactions.upsert(interrupted);
    onUpdate(interrupted);
    return interrupted;
  }
}
