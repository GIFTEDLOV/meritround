import { readFileSync } from "node:fs";
import path from "node:path";
import {
  GenLayerClient,
  TransactionHash,
  TransactionStatus,
} from "genlayer-js/types";

export default async function main(client: GenLayerClient<any>) {
  const filePath = path.resolve(process.cwd(), "contracts/meritround.py");
  const contractCode = new Uint8Array(readFileSync(filePath));

  const deployTransaction = await client.deployContract({
    code: contractCode,
    args: [],
  });

  const receipt = await client.waitForTransactionReceipt({
    hash: deployTransaction as TransactionHash,
    status: TransactionStatus.FINALIZED,
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

  if (statusName !== TransactionStatus.FINALIZED) {
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

  console.log("Contract deployed successfully.", {
    transactionHash: deployTransaction,
    contractAddress,
    executionResult,
    contractInfo: info,
  });
}
