import { describe, expect, it } from "vitest";
import type { Action1Client } from "../../src/client/action1Client.js";
import { Action1ApiError } from "../../src/client/errors.js";
import { createdDespite400 } from "../../src/tools/startAction.js";

// The read-back after Action1's 400 "automation instance with id=<id> not
// found": a cancelled call must surface as cancelled, while any other
// read-back failure leaves the outcome inconclusive.

const ORG = "00000000-0000-0000-0000-000000000001";
const RUN_ID = "Deploy_test_1794871237344_2026-11-16_23-20-37";
const notFound = new Action1ApiError({
  method: "POST",
  url: `https://app.eu.action1.test/api/3.0/policies/instances/${ORG}`,
  status: 400,
  body: JSON.stringify({ developer_message: `automation instance with id=${RUN_ID} not found` }),
});

function clientThatFails(onRequest: () => void, failure: Error): Action1Client {
  return {
    request: async () => {
      onRequest();
      throw failure;
    },
  } as unknown as Action1Client;
}

describe("createdDespite400 read-back failures", () => {
  it("re-throws when the call is cancelled during the read-back", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    const client = clientThatFails(() => controller.abort(), abortError);
    await expect(
      createdDespite400(client, `/policies/instances/${ORG}`, notFound, controller.signal),
    ).rejects.toBe(abortError);
  });

  it("is inconclusive when the read-back fails without a cancel", async () => {
    const controller = new AbortController();
    const client = clientThatFails(() => undefined, new Error("connection reset"));
    const result = await createdDespite400(
      client,
      `/policies/instances/${ORG}`,
      notFound,
      controller.signal,
    );
    expect(result).toMatchObject({ kind: "inconclusive", runId: RUN_ID });
  });
});
