// ABOUTME: End-to-end (MCP client to stubbed Action1 HTTP) proof that bad action params fail before any POST.
// ABOUTME: Covers deploy_package and uninstall_program, execute_and_wait, generated instance, schedule create and update, and raw_request.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@modelcontextprotocol/client";

const ORG = "00000000-0000-0000-0000-000000000001";
const EP = "aaaa1111-2222-3333-4444-555555555555";
const PKG = "CrowdStrike_Falcon_Sensor_1787097061145";
const VERSION_ID = "7.39.21108_1787098706695";
const VERSION_TEXT = "7.39.21108.0";
const BASE = {
  ACTION1_BASE_URL: "https://app.eu.action1.test/api/3.0",
  ACTION1_CLIENT_ID: "client-id-test",
  ACTION1_CLIENT_SECRET: "client-secret-test",
  ACTION1_ORG_ID: ORG,
  ACTION1_ALLOW_DESTRUCTIVE: "true",
};

let saved: NodeJS.ProcessEnv;
let open: { client: Client; close: () => Promise<void> } | undefined;

beforeEach(() => {
  saved = { ...process.env };
  Object.assign(process.env, BASE);
  vi.resetModules();
});

afterEach(async () => {
  await open?.close();
  open = undefined;
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function connect(): Promise<Client> {
  const { resetConfigCache } = await import("../../src/config.js");
  resetConfigCache();
  const { buildServer } = await import("../../src/server.js");
  const { Client } = await import("@modelcontextprotocol/client");
  const { InMemoryTransport } = await import("@modelcontextprotocol/server");
  const [clientTx, serverTx] = InMemoryTransport.createLinkedPair();
  const built = buildServer();
  await built.server.connect(serverTx);
  const client = new Client({ name: "action-params-test", version: "0.0.0" });
  await client.connect(clientTx);
  open = {
    client,
    close: async () => {
      await client.close();
      await built.server.close();
    },
  };
  return client;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Stub Action1: token, one repository package, one Windows endpoint, and instance creation. */
function upstream(): string[] {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.endsWith("/oauth2/token")) return json({ access_token: "tkn", expires_in: 3600 });
      const method = init.method ?? "GET";
      const path = new URL(url).pathname;
      calls.push(`${method} ${path}`);
      if (path.endsWith(`/software-repository/${ORG}/Deleted_Package_1`)) {
        // Measured 2026-11-10: a package no longer in the repository answers
        // 200 with an empty text/html body.
        return new Response("", {
          status: 200,
          headers: { "Content-Type": "text/html; charset=UTF-8" },
        });
      }
      if (path.endsWith(`/software-repository/${ORG}/${PKG}`)) {
        return json({ id: PKG, versions: [{ id: VERSION_ID, version: VERSION_TEXT }] });
      }
      if (path.endsWith(`/endpoints/managed/${ORG}/${EP}`)) {
        return json({ id: EP, name: "host", OS: "Windows 11", status: "Connected" });
      }
      if (method === "POST") return json({ id: "instance-1" });
      return json({ error: "no route" }, 404);
    }),
  );
  return calls;
}

function textOf(r: { content?: unknown }): string {
  return (r.content as { text?: string }[] | undefined)?.[0]?.text ?? "";
}

const deployParams = (version: string) => ({
  display_summary: "CrowdStrike",
  packages: [{ [PKG]: version }],
  reboot_options: { auto_reboot: "no" },
});

const posts = (calls: string[]) => calls.filter((c) => c.startsWith("POST "));

describe("action params are checked before the guard", () => {
  it("action1_deploy_package: a version id fails in the dry run and names the version text", async () => {
    const calls = upstream();
    const client = await connect();
    const r = await client.callTool({
      name: "action1_deploy_package",
      arguments: { endpoint_id: EP, params: deployParams(VERSION_ID) },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain(`version text "${VERSION_TEXT}"`);
    expect(posts(calls)).toEqual([]);
  });

  it("action1_deploy_package: a version id fails with confirm YES too, and nothing is posted", async () => {
    const calls = upstream();
    const client = await connect();
    const r = await client.callTool({
      name: "action1_deploy_package",
      arguments: {
        endpoint_id: EP,
        params: deployParams(VERSION_ID),
        dry_run: false,
        confirm: "YES",
      },
    });
    expect(r.isError).toBe(true);
    expect(posts(calls)).toEqual([]);
  });

  it("action1_deploy_package: the version text passes the dry run", async () => {
    const calls = upstream();
    const client = await connect();
    const r = await client.callTool({
      name: "action1_deploy_package",
      arguments: { endpoint_id: EP, params: deployParams(VERSION_TEXT) },
    });
    expect(r.isError ?? false).toBe(false);
    expect(textOf(r)).toContain("dry_run");
    expect(posts(calls)).toEqual([]);
  });

  it("action1_execute_and_wait template mode: a version id fails before any POST", async () => {
    const calls = upstream();
    const client = await connect();
    const r = await client.callTool({
      name: "action1_execute_and_wait",
      arguments: {
        endpoint_id: EP,
        mode: "template",
        template_id: "deploy_package",
        params: deployParams(VERSION_ID),
        skip_connectivity_check: true,
        dry_run: false,
        confirm: "YES",
      },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("version id");
    expect(posts(calls)).toEqual([]);
  });

  it('action1_create_automation_instance: run_script_params "" fails in the dry run', async () => {
    const calls = upstream();
    const client = await connect();
    const r = await client.callTool({
      name: "action1_create_automation_instance",
      arguments: {
        body: {
          name: "Run Script: SentinelOne - Uninstall",
          retry_minutes: "1440",
          endpoints: [{ id: EP, type: "Endpoint" }],
          actions: [
            {
              template_id: "run_script",
              name: "Run Script",
              params: {
                run_script_id: "SentinelOne___Uninstall_1787626092390",
                run_script_params: "",
              },
            },
          ],
        },
      },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/run_script_params must be a list/);
    expect(posts(calls)).toEqual([]);
  });

  it("action1_create_automation_instance: run_script_params [] passes the dry run", async () => {
    upstream();
    const client = await connect();
    const r = await client.callTool({
      name: "action1_create_automation_instance",
      arguments: {
        body: {
          name: "Run Script: SentinelOne - Uninstall",
          retry_minutes: "1440",
          endpoints: [{ id: EP, type: "Endpoint" }],
          actions: [
            {
              template_id: "run_script",
              name: "Run Script",
              params: {
                run_script_id: "SentinelOne___Uninstall_1787626092390",
                run_script_params: [],
              },
            },
          ],
        },
      },
    });
    expect(r.isError ?? false).toBe(false);
  });

  it("a deleted package (200, empty text/html) is reported as not found through the real client", async () => {
    const calls = upstream();
    const client = await connect();
    const r = await client.callTool({
      name: "action1_deploy_package",
      arguments: {
        endpoint_id: EP,
        params: {
          display_summary: "x",
          packages: [{ Deleted_Package_1: "1" }],
          reboot_options: { auto_reboot: "no" },
        },
      },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/Deleted_Package_1.*not found in the software repository/s);
    expect(posts(calls)).toEqual([]);
  });

  it("action1_create_automation_schedule: a version id fails in the dry run", async () => {
    const calls = upstream();
    const client = await connect();
    const r = await client.callTool({
      name: "action1_create_automation_schedule",
      arguments: {
        body: {
          name: "Weekly CrowdStrike",
          settings: "ENABLED EVERY:360 AT:08-32-00 DATE:2026-11-11",
          retry_minutes: "1440",
          endpoints: [{ id: EP, type: "Endpoint" }],
          actions: [
            {
              template_id: "deploy_package",
              name: "Deploy Software",
              params: deployParams(VERSION_ID),
            },
          ],
        },
      },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain(`version text "${VERSION_TEXT}"`);
    expect(posts(calls)).toEqual([]);
  });

  it("action1_update_automation: a PATCH that sends bad actions fails in the dry run", async () => {
    const calls = upstream();
    const client = await connect();
    const r = await client.callTool({
      name: "action1_update_automation",
      arguments: {
        automation_id: "sched-1",
        body: {
          actions: [
            {
              template_id: "run_script",
              name: "Run Script",
              params: {
                run_script_id: "SentinelOne___Uninstall_1787626092390",
                run_script_params: "",
              },
            },
          ],
        },
      },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/run_script_params must be a list/);
    expect(calls.filter((c) => c.startsWith("PATCH "))).toEqual([]);
  });

  it("action1_raw_request: a POST to automation instances with bad params fails in the dry run", async () => {
    process.env.ACTION1_ALLOW_ACCOUNT_OPS = "true";
    const calls = upstream();
    const client = await connect();
    const r = await client.callTool({
      name: "action1_raw_request",
      arguments: {
        method: "POST",
        path: `/automations/instances/${ORG}`,
        body: {
          name: "Run Script",
          retry_minutes: "1440",
          endpoints: [{ id: EP, type: "Endpoint" }],
          actions: [
            {
              template_id: "run_script",
              name: "Run Script",
              params: {
                run_script_id: "SentinelOne___Uninstall_1787626092390",
                run_script_params: "",
              },
            },
          ],
        },
      },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/run_script_params must be a list/);
    expect(posts(calls)).toEqual([]);
  });

  it("action1_uninstall_program: params without packages fail in the dry run", async () => {
    const calls = upstream();
    const client = await connect();
    const r = await client.callTool({
      name: "action1_uninstall_program",
      arguments: { endpoint_id: EP, params: { program: "AnyDesk" } },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/packages must be a non-empty list/);
    expect(posts(calls)).toEqual([]);
  });
});
