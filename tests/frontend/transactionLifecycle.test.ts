import { describe, expect, it, vi, afterEach } from "vitest";
import {
  MemoryTransactionStore,
  MeritRoundClient,
  PersistentTransactionStore,
  type Eip1193Provider,
  type MeritRoundConfig,
  type TransactionRecord,
} from "../../frontend/src/meritroundClient";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const CONTRACT = "0x2222222222222222222222222222222222222222" as `0x${string}`;
const ROUND_ID = "a".repeat(64);
const SUBMISSION_ID = "b".repeat(64);
const TX_ID = "0x" + "c".repeat(64);

const config: MeritRoundConfig = {
  network: "studionet",
  endpoint: "https://studio.genlayer.com/api",
  chainId: 61999,
  contractAddress: CONTRACT,
};

function round(state: "DRAFT" | "OPEN" | "LOCKED" | "FINALIZED" | "INCONCLUSIVE" = "OPEN") {
  return {
    round_id: ROUND_ID,
    organizer: ACCOUNT,
    title: "Test round",
    description: "Description",
    rubric: "Rubric",
    state,
    submission_ids: [SUBMISSION_ID, "d".repeat(64)],
    finalist_ids: state === "LOCKED" || state === "FINALIZED" || state === "INCONCLUSIVE" ? [SUBMISSION_ID, "d".repeat(64)] : [],
    evaluation_universe_digest: "e".repeat(64),
  };
}

function record(overrides: Partial<TransactionRecord> = {}): TransactionRecord {
  return {
    operationId: "operation-1",
    txId: TX_ID,
    network: "studionet",
    chainId: 61999,
    contractAddress: CONTRACT,
    method: "open_round",
    argsDigest: "f".repeat(64),
    roundId: ROUND_ID,
    expectedState: { kind: "round-state", roundId: ROUND_ID, state: "OPEN" },
    submittedAt: "2026-09-07T12:00:00.000Z",
    updatedAt: "2026-09-07T12:00:00.000Z",
    phase: "SUBMITTED",
    terminal: false,
    ...overrides,
  };
}

function attachWriteClient(client: MeritRoundClient, writeContract: ReturnType<typeof vi.fn>) {
  (client as any).writeClient = { writeContract };
  (client as any).account = ACCOUNT;
}

function attachReadClient(client: MeritRoundClient, transaction: unknown, roundState = "OPEN") {
  const readClient = client.readClient as any;
  readClient.getTransaction = vi.fn().mockResolvedValue(transaction);
  readClient.readContract = vi.fn().mockImplementation(({ functionName }: { functionName: string }) => {
    if (functionName === "get_round") return Promise.resolve(round(roundState as any));
    if (functionName === "get_result") return Promise.resolve({ exists: true, outcome: "INCONCLUSIVE", submission_id: "" });
    if (functionName === "get_submission") return Promise.resolve({ submission_id: SUBMISSION_ID, round_id: ROUND_ID });
    return Promise.resolve({});
  });
}

const finalizedSuccess = {
  status_name: "FINALIZED",
  result_name: "MAJORITY_AGREE",
  consensus_data: { leader_receipt: [{ execution_result: "SUCCESS" }] },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MeritRound transaction lifecycle", () => {
  it("broadcasts once and persists the returned transaction ID immediately", async () => {
    const store = new MemoryTransactionStore();
    const client = new MeritRoundClient(config, store);
    const writeContract = vi.fn().mockResolvedValue(TX_ID);
    attachWriteClient(client, writeContract);

    const operation = {
      operationId: "fixed-operation",
      method: "open_round",
      args: [ROUND_ID],
      expectedState: { kind: "round-state" as const, roundId: ROUND_ID, state: "OPEN" as const },
      roundId: ROUND_ID,
    };
    const first = await client.sendWriteOnce(operation);
    const second = await client.sendWriteOnce(operation);

    expect(writeContract).toHaveBeenCalledTimes(1);
    expect(second.txId).toBe(first.txId);
    expect(store.get("fixed-operation")?.txId).toBe(TX_ID);
  });

  it("does not broadcast if pre-broadcast metadata preparation fails", async () => {
    const store = new MemoryTransactionStore();
    const client = new MeritRoundClient(config, store);
    const writeContract = vi.fn().mockResolvedValue(TX_ID);
    attachWriteClient(client, writeContract);
    vi.stubGlobal("crypto", undefined);

    await expect(
      client.sendWriteOnce({
        operationId: "digest-failure",
        method: "open_round",
        args: [ROUND_ID],
        expectedState: { kind: "round-state", roundId: ROUND_ID, state: "OPEN" },
        roundId: ROUND_ID,
      }),
    ).rejects.toThrow("SHA-256 is unavailable");

    expect(writeContract).not.toHaveBeenCalled();
    expect(store.list()).toEqual([]);
  });

  it("does not write when the contract is unconfigured", async () => {
    const client = new MeritRoundClient({ ...config, contractAddress: undefined }, new MemoryTransactionStore());
    await expect(client.getRound(ROUND_ID)).rejects.toThrow("MERITROUND_NOT_CONFIGURED");
  });

  it("uses finalized reads for authoritative contract state", async () => {
    const client = new MeritRoundClient(config, new MemoryTransactionStore());
    const readContract = (client.readClient as any).readContract = vi.fn().mockResolvedValue(round());
    await client.getRound(ROUND_ID);
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ transactionHashVariant: "latest-final" }));
  });

  it("recovers the same persisted transaction after refresh and verifies state", async () => {
    const store = new MemoryTransactionStore();
    const client = new MeritRoundClient(config, store);
    const saved = record();
    store.upsert(saved);
    attachReadClient(client, finalizedSuccess);

    const result = await client.reconcile(saved);

    expect(result.success).toBe(true);
    expect(result.record.phase).toBe("RESOLVED");
    expect((client.readClient as any).getTransaction).toHaveBeenCalledWith({ hash: TX_ID });
  });

  it("never rebroadcasts after a tracking timeout", async () => {
    const store = new MemoryTransactionStore();
    const client = new MeritRoundClient(config, store);
    const writeContract = vi.fn().mockResolvedValue("0x" + "d".repeat(64));
    attachWriteClient(client, writeContract);
    const saved = record();
    store.upsert(saved);
    (client.readClient as any).getTransaction = vi.fn().mockRejectedValue(new Error("RPC timeout"));

    const result = await client.trackUntilTerminal(saved, () => undefined, { intervalMs: 0, attempts: 2 });

    expect(result.phase).toBe("TRACKING_INTERRUPTED");
    expect(writeContract).not.toHaveBeenCalled();
    expect(store.get(saved.operationId)?.txId).toBe(TX_ID);
  });

  it("does not treat finalized execution failure as success", async () => {
    const client = new MeritRoundClient(config, new MemoryTransactionStore());
    attachReadClient(client, { statusName: "FINALIZED", consensus_data: { leader_receipt: [{ execution_result: "ERROR" }] } });
    const result = await client.reconcile(record());
    expect(result.success).toBe(false);
    expect(result.record.phase).toBe("FAILED");
    expect(result.record.terminal).toBe(true);
  });

  it("does not treat a wrong finalized readback as success", async () => {
    const client = new MeritRoundClient(config, new MemoryTransactionStore());
    attachReadClient(client, finalizedSuccess, "DRAFT");
    const result = await client.reconcile(record());
    expect(result.success).toBe(false);
    expect(result.record.error).toContain("expected contract state");
  });

  it("requires the expected result readback for a terminal evaluation", async () => {
    const client = new MeritRoundClient(config, new MemoryTransactionStore());
    attachReadClient(client, finalizedSuccess, "FINALIZED");
    const result = await client.reconcile(record({ method: "resolve_round", expectedState: { kind: "round-terminal", roundId: ROUND_ID, states: ["FINALIZED", "INCONCLUSIVE"] } }));
    expect(result.success).toBe(true);
    expect(result.record.phase).toBe("RESOLVED");
  });

  it("ignores malformed persisted records safely", () => {
    const storage = {
      getItem: vi.fn().mockReturnValue(JSON.stringify([{ txId: "not-a-hash" }, { operationId: "valid?" }])),
      setItem: vi.fn(),
    };
    const store = new PersistentTransactionStore(storage);
    expect(store.list()).toEqual([]);
  });

  it("does not reconcile records belonging to another network or contract", async () => {
    const store = new MemoryTransactionStore();
    const client = new MeritRoundClient(config, store);
    const other = record({ network: "localnet", chainId: 61127 });
    store.upsert(other);
    const getTransaction = (client.readClient as any).getTransaction = vi.fn();
    expect(await client.recoverPending()).toEqual([]);
    expect(getTransaction).not.toHaveBeenCalled();
  });

  it("handles an absent EIP-1193 wallet without creating an account", async () => {
    vi.stubGlobal("window", undefined);
    const client = new MeritRoundClient(config, new MemoryTransactionStore());
    await expect(client.connectWallet()).rejects.toMatchObject({ code: "WALLET_UNAVAILABLE" });
  });

  it("distinguishes wallet rejection from network rejection", async () => {
    const provider: Eip1193Provider = { request: vi.fn().mockRejectedValue(new Error("user rejected")) };
    vi.stubGlobal("window", { ethereum: provider });
    const client = new MeritRoundClient(config, new MemoryTransactionStore());
    await expect(client.connectWallet()).rejects.toMatchObject({ code: "WALLET_REJECTED" });
  });

  it("blocks writes on a wrong selected chain", async () => {
    const provider: Eip1193Provider = {
      request: vi.fn().mockImplementation(({ method }) => method === "eth_requestAccounts" ? Promise.resolve([ACCOUNT]) : Promise.resolve("0x1")),
    };
    vi.stubGlobal("window", { ethereum: provider });
    const client = new MeritRoundClient(config, new MemoryTransactionStore());
    await expect(client.connectWallet()).rejects.toMatchObject({ code: "WRONG_NETWORK" });
  });
});
