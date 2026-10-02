import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { expectedExecution, checkpointWrite } from "./verify-v25.mjs";

const success = { statusName: "FINALIZED", resultName: "AGREE", executionResultName: "FINISHED_WITH_RETURN", rotationsLeft: 0 };

test("successful finality is required for a successful write", () => {
  assert.equal(expectedExecution(success), true);
  assert.equal(expectedExecution({ ...success, statusName: "PROPOSING", resultName: "IDLE" }), false);
  assert.throws(() => expectedExecution({ ...success, resultName: "IDLE" }), /failed consensus/);
  assert.throws(() => expectedExecution({ ...success, executionResultName: "FINISHED_WITH_ERROR" }), /unexpected execution/);
});

test("expected reverts cannot be satisfied by a successful or consensus-failed transaction", () => {
  assert.equal(expectedExecution({ ...success, executionResultName: "FINISHED_WITH_ERROR" }, true), true);
  assert.throws(() => expectedExecution(success, true), /unexpected execution/);
  assert.throws(() => expectedExecution({ ...success, resultName: "DISAGREE", executionResultName: "FINISHED_WITH_ERROR" }, true), /failed consensus/);
});

test("active rotations remain pending, exhausted rotations fail promptly", () => {
  const timeout = { statusName: "VALIDATORS_TIMEOUT", resultName: "TIMEOUT", executionResultName: "", rotationsLeft: 1 };
  assert.equal(expectedExecution(timeout), false);
  assert.throws(() => expectedExecution({ ...timeout, rotationsLeft: 0 }), /failed consensus/);
});

test("a receipt timeout preserves the broadcast and resumes without sending again", async () => {
  const path = join(tmpdir(), `verdictproof-checkpoint-${randomUUID()}.json`);
  const state = { transactions: {}, _checkpointPath: path };
  const request = { account: { address: "0xsender" }, address: "0xcontract", functionName: "submit_proof", args: [1n], value: 10n };
  try {
    await assert.rejects(checkpointWrite({}, state, "submit", "Submit", request, async (_, save, prior) => {
      assert.equal(prior, undefined);
      save("0xevm");
      throw new Error("receipt timeout");
    }), /receipt timeout/);
    const recovered = { ...JSON.parse(readFileSync(path, "utf8")), _checkpointPath: path };
    assert.equal(recovered.evmTransactions.submit, "0xevm");
    await assert.rejects(checkpointWrite({}, recovered, "submit", "Submit", { ...request, value: 20n }), /request changed/);
    const hash = await checkpointWrite({}, recovered, "submit", "Submit", request, async (_, save, prior) => {
      assert.equal(prior, "0xevm");
      return "0xgenlayer";
    });
    assert.equal(hash, "0xgenlayer");
    assert.equal(JSON.parse(readFileSync(path, "utf8")).transactions.submit, "0xgenlayer");
  } finally {
    unlinkSync(path);
  }
});

test("resumed GenLayer checkpoints must belong to the expected signer and amount", async () => {
  const request = { account: { address: "0xsender" }, address: "0xcontract", functionName: "submit_proof", args: [1n], value: 10n };
  const tx = { recipient: "0xcontract", sender: "0xother", value: 10n,
    txDataDecoded: { callData: { method: "submit_proof", args: [1n] } } };
  const client = { getTransaction: async () => tx };
  await assert.rejects(checkpointWrite(client, { transactions: { submit: "0xgenlayer" } }, "submit", "Submit", request), /exact sender, value/);
  tx.sender = "0xsender";
  tx.value = 9n;
  await assert.rejects(checkpointWrite(client, { transactions: { submit: "0xgenlayer" } }, "submit", "Submit", request), /exact sender, value/);
});
