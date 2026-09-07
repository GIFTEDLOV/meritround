import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ExecutionResult,
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

  if (receipt.txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN) {
    throw new Error(`Deployment execution failed: ${JSON.stringify(receipt)}`);
  }

  console.log("Contract deployed successfully.", {
    transactionHash: deployTransaction,
    contractAddress: receipt.data?.contract_address,
  });
}
