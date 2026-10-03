import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { testnetBradbury } from "genlayer-js/chains";

const root = fileURLToPath(new URL("../../", import.meta.url));
const checkpoint = resolve(root, "deploy/.bradbury-v26-r2-sponsor-funding.json");
const env = Object.fromEntries(readFileSync(resolve(root, ".env"), "utf8").split(/\r?\n/)
  .map(line => line.trim()).filter(line => line && !line.startsWith("#") && line.includes("="))
  .map(line => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]));

async function main() {
  const raw = env.ACCOUNT_PRIVATE_KEY;
  const account = privateKeyToAccount(raw.startsWith("0x") ? raw : `0x${raw}`);
  if (account.address.toLowerCase() !== env.EXPECTED_WALLET_ADDRESS.toLowerCase()) throw new Error("Deployment signer mismatch");
  const rawSponsor = env.VERDICTPROOF_SPONSOR_PRIVATE_KEY;
  const sponsor = privateKeyToAccount(rawSponsor.startsWith("0x") ? rawSponsor : `0x${rawSponsor}`);
  if (sponsor.address.toLowerCase() !== env.VERDICTPROOF_SPONSOR_ADDRESS.toLowerCase()) throw new Error("Sponsor signer mismatch");
  const value = parseEther("0.6");
  const client = createPublicClient({ chain: testnetBradbury, transport: http() });
  let state = existsSync(checkpoint) ? JSON.parse(readFileSync(checkpoint, "utf8")) : {
    from: account.address, to: sponsor.address, amountAtto: value.toString()
  };
  if (state.from !== account.address || state.to !== sponsor.address || state.amountAtto !== value.toString()) throw new Error("Funding checkpoint mismatch");
  if (!state.hash) {
    const wallet = createWalletClient({ account, chain: testnetBradbury, transport: http(testnetBradbury.rpcUrls.default.http[0], { retryCount: 0 }) });
    state.hash = await wallet.sendTransaction({ account, chain: testnetBradbury, to: sponsor.address,
      value, gas: 21000n, gasPrice: await client.getGasPrice(), type: "legacy" });
    writeFileSync(checkpoint, JSON.stringify(state, null, 2));
  }
  const [receipt, tx] = await Promise.all([client.waitForTransactionReceipt({ hash: state.hash }), client.getTransaction({ hash: state.hash })]);
  if (receipt.status !== "success" || tx.from.toLowerCase() !== state.from.toLowerCase() || tx.to.toLowerCase() !== state.to.toLowerCase() || tx.value !== value) throw new Error("Funding receipt mismatch");
  state.status = "SUCCESS";
  writeFileSync(checkpoint, JSON.stringify(state, null, 2));
  console.log(JSON.stringify({ ...state, sponsorBalanceAtto: String(await client.getBalance({ address: sponsor.address })) }));
}
main().catch(error => { console.error(String(error?.shortMessage ?? error?.message ?? error).split("\n")[0]); process.exitCode = 1; });
