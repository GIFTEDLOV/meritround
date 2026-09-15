import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  GenLayerClient,
  TransactionHash,
  TransactionFeeOptions,
  TransactionStatus,
} from "genlayer-js/types";

const FINALIZED_STATUS = "FINALIZED" as TransactionStatus;
const TARGET_NETWORK = "studio-dev";
const TARGET_RPC = "https://studio-dev.genlayer.com/api";
const TARGET_CHAIN_ID = 61997;

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, jsonSafe(entry)]),
    );
  }
  return value;
}

export default async function main(client: GenLayerClient<any>) {
  // V2 deployment is intentionally not configurable by a caller-provided
  // path. This prevents a stale V1 file from being selected by accident.
  // The GenLayer CLI transpiles this file into a temporary directory before
  // execution, so import.meta.url is not the repository location. The CLI
  // preserves the caller's working directory; use it as the project root.
  const repoRoot = path.resolve(process.cwd());
  const filePath = path.resolve(repoRoot, "contracts/meritround_v2.py");
  const manifestPath = path.resolve(repoRoot, "deployments/v2/SOURCE_MANIFEST.json");
  const pendingPath = path.resolve(
    repoRoot,
    "deployments/v2/studio-dev-deployment.corrected.pending.json",
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    source_path?: string;
    source_sha256?: string;
    source_bytes?: number;
  };
  const relativeSourcePath = path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
  if (manifest.source_path !== "contracts/meritround_v2.py" || manifest.source_path !== relativeSourcePath) {
    throw new Error(`Frozen manifest does not name the V2 source: ${manifest.source_path ?? "missing"}`);
  }

  // Re-read and hash immediately before the single high-level SDK broadcast.
  const sourceBytes = readFileSync(filePath);
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  if (sourceSha256 !== manifest.source_sha256 || sourceBytes.byteLength !== manifest.source_bytes) {
    throw new Error("V2 source does not match the frozen release manifest");
  }
  const contractCode = new Uint8Array(sourceBytes);

  const clientChain = (client as any).chain;
  const clientRpc = clientChain?.rpcUrls?.default?.http?.[0];
  if (Number(clientChain?.id) !== TARGET_CHAIN_ID || clientRpc !== TARGET_RPC) {
    throw new Error(
      `Deployment requires ${TARGET_NETWORK} at ${TARGET_RPC} on chain ${TARGET_CHAIN_ID}; got ${String(clientRpc)} on chain ${String(clientChain?.id)}`,
    );
  }

  // genlayer-js defaults an omitted fees object to a zero-value distribution.
  // Studio-based networks reject that outer EVM transaction before a GenLayer
  // tx exists.
  // Estimate and pass the complete official fee options on this exact deploy.
  const feeEstimate = await client.estimateTransactionFees();
  if (feeEstimate.feeValue <= 0n) {
    throw new Error("Fresh Studio Dev deployment fee estimate returned zero feeValue");
  }
  const fees: TransactionFeeOptions = {
    distribution: feeEstimate.distribution,
    ...(feeEstimate.messageAllocations
      ? { messageAllocations: feeEstimate.messageAllocations }
      : {}),
    feeValue: feeEstimate.feeValue,
  };
  console.log("Fresh Studio Dev deployment fee estimate.", jsonSafe(feeEstimate));

  const persist = (extra: Record<string, unknown>) => {
    writeFileSync(
      pendingPath,
      `${JSON.stringify(
        jsonSafe({
      mode: "MERITROUND_V2_STUDIO_DEV_DEPLOYMENT",
          network: TARGET_NETWORK,
          rpc: TARGET_RPC,
          chain_id: TARGET_CHAIN_ID,
          sender: (client as any).account?.address ?? null,
          source_path: relativeSourcePath,
          source_sha256: sourceSha256,
          source_bytes: sourceBytes.byteLength,
          fee_estimate: feeEstimate,
          deployment_attempt_count: 1,
          rebroadcast: false,
          ...extra,
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
  };

  let deployTransaction: TransactionHash;
  try {
    deployTransaction = (await client.deployContract({
      code: contractCode,
      args: [],
      fees,
    })) as TransactionHash;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const evmHash = message.match(/EVM tx (0x[0-9a-fA-F]+)/)?.[1] ?? null;
    if (evmHash) {
      persist({
        evm_tx: evmHash,
        genlayer_transaction_id: null,
        final_status: "SUBMISSION_ERROR_RECONCILIATION_REQUIRED",
        execution: "UNKNOWN",
        error: message,
      });
    }
    throw error;
  }

  // Persist the returned outer EVM hash before any polling or reconciliation.
  persist({
    evm_tx: deployTransaction,
    genlayer_transaction_id: deployTransaction,
    final_status: "BROADCAST",
    execution: "PENDING",
  });

  const receipt = await client.waitForTransactionReceipt({
    hash: deployTransaction as TransactionHash,
    status: FINALIZED_STATUS,
    retries: 200,
  });

  const transaction = await client.getTransaction({
    hash: deployTransaction as TransactionHash,
  });
  const statusName =
    (transaction as any).statusName ?? (transaction as any).status_name;
  const leaderReceipt = Array.isArray(transaction.consensus_data?.leader_receipt)
    ? transaction.consensus_data.leader_receipt[0]
    : transaction.consensus_data?.leader_receipt;
  const executionResult =
    (transaction as any).txExecutionResultName ??
    (transaction as any).tx_execution_result_name ??
    leaderReceipt?.execution_result;

  if (statusName !== FINALIZED_STATUS) {
    throw new Error(`Deployment did not finalize: ${statusName ?? "UNKNOWN"}`);
  }
  if (
    executionResult !== "FINISHED_WITH_RETURN" &&
    executionResult !== "SUCCESS"
  ) {
    throw new Error(
      `Deployment execution failed: ${executionResult ?? "UNKNOWN"}`,
    );
  }

  const contractAddress =
    (receipt.data as any)?.contract_address ??
    (transaction.data as any)?.contract_address;
  if (!contractAddress) {
    throw new Error("Deployment finalized without a contract address");
  }

  const info = await client.readContract({
    address: contractAddress,
    functionName: "contract_info",
    args: [],
  });
  if ((info as any)?.name !== "MeritRound") {
    throw new Error(`Unexpected deployed contract identity: ${JSON.stringify(info)}`);
  }
  if (String((info as any)?.version) !== "2") {
    throw new Error(`Unexpected MeritRound contract version: ${JSON.stringify(info)}`);
  }
  if ((info as any)?.evidence_mode !== "PINNED_EXACT_BYTES_ONLY") {
    throw new Error(`Unexpected MeritRound evidence mode: ${JSON.stringify(info)}`);
  }

  console.log("Contract deployed successfully.", {
    transactionHash: deployTransaction,
    contractAddress,
    executionResult,
    sourcePath: relativeSourcePath,
    sourceSha256,
    sourceBytes: sourceBytes.byteLength,
    contractInfo: info,
  });

  persist({
    evm_tx: deployTransaction,
    genlayer_transaction_id: deployTransaction,
    final_status: statusName,
    execution: executionResult,
    contract_address: contractAddress,
    contract_info: info,
  });
}
