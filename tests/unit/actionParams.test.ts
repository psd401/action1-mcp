// ABOUTME: Tests for the pre-flight check of action params (deploy_package, uninstall_program, run_script).
// ABOUTME: Cases come from two live 2026-11-10 failures: a version id sent as the version, and run_script_params "".
import { describe, expect, it, vi } from "vitest";
import { checkActionParams, orgIdFromActionPath } from "../../src/tools/actionParams.js";
import { Action1ApiError } from "../../src/client/errors.js";
import type { Action1Client } from "../../src/client/action1Client.js";

const ORG = "11111111-1111-1111-1111-111111111111";
const PKG = "CrowdStrike_Falcon_Sensor_1787097061145";

function repoClient(packages: Record<string, { id: string; version: string }[]>): {
  client: Action1Client;
  request: ReturnType<typeof vi.fn>;
} {
  const request = vi.fn(async (path: string) => {
    const m = /^\/software-repository\/[^/]+\/([^/?]+)$/.exec(path);
    const id = m ? decodeURIComponent(m[1]!) : "";
    if (!(id in packages)) {
      throw new Action1ApiError({ status: 404, url: "https://x" + path, method: "GET", body: "" });
    }
    return { id, versions: packages[id] };
  });
  return { client: { request } as unknown as Action1Client, request };
}

const REPO = { [PKG]: [{ id: "7.39.21108_1787098706695", version: "7.39.21108.0" }] };

function deployAction(version: unknown): unknown {
  return {
    template_id: "deploy_package",
    name: "Deploy Software",
    params: {
      display_summary: "CrowdStrike",
      packages: [{ [PKG]: version }],
      reboot_options: { auto_reboot: "no" },
    },
  };
}

function libraryScriptAction(runScriptParams: unknown): unknown {
  return {
    template_id: "run_script",
    name: "Run Script",
    params: {
      run_script_id: "SentinelOne___Uninstall_1787626092390",
      run_script_params: runScriptParams,
    },
  };
}

describe("checkActionParams: deploy_package", () => {
  it("accepts the version text from the software repository", async () => {
    const { client, request } = repoClient(REPO);
    await expect(
      checkActionParams(client, ORG, [deployAction("7.39.21108.0")]),
    ).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith(
      `/software-repository/${ORG}/${PKG}`,
      expect.objectContaining({ method: "GET", query: { fields: "versions" } }),
    );
  });

  it("rejects a version id and names the version text to send instead", async () => {
    const { client } = repoClient(REPO);
    await expect(
      checkActionParams(client, ORG, [deployAction("7.39.21108_1787098706695")]),
    ).rejects.toThrow(/version id.*"7\.39\.21108\.0"/s);
  });

  it("rejects a version the package does not have and lists the ones it has", async () => {
    const { client } = repoClient(REPO);
    await expect(checkActionParams(client, ORG, [deployAction("9.9.9")])).rejects.toThrow(
      /9\.9\.9.*7\.39\.21108\.0/s,
    );
  });

  it("rejects a package id the repository does not have", async () => {
    const { client } = repoClient({});
    await expect(checkActionParams(client, ORG, [deployAction("7.39.21108.0")])).rejects.toThrow(
      /not found in the software repository/,
    );
  });

  it("rejects a non-string version", async () => {
    const { client, request } = repoClient(REPO);
    await expect(checkActionParams(client, ORG, [deployAction(7)])).rejects.toThrow(/string/);
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects missing or empty packages, display_summary and reboot_options", async () => {
    const { client } = repoClient(REPO);
    const bad = { template_id: "deploy_package", name: "x", params: { packages: [] } };
    await expect(checkActionParams(client, ORG, [bad])).rejects.toThrow(
      /packages.*display_summary.*reboot_options/s,
    );
  });
});

describe("checkActionParams: deleted package", () => {
  // Measured 2026-11-10: for a package no longer in the repository Action1
  // answers HTTP 200 with an empty text/html body, not 404. The client
  // returns that body as a string.
  it("treats an empty non-JSON answer as package not found", async () => {
    const client = { request: vi.fn(async () => "") } as unknown as Action1Client;
    await expect(checkActionParams(client, ORG, [deployAction("7.39.21108.0")])).rejects.toThrow(
      /not found in the software repository/,
    );
  });
});

describe("checkActionParams: repository read failures", () => {
  it("reports a 403 on the version read as a failed check, naming the status", async () => {
    const client = {
      request: vi.fn(async () => {
        throw new Action1ApiError({ status: 403, url: "https://x/y", method: "GET", body: "" });
      }),
    } as unknown as Action1Client;
    await expect(checkActionParams(client, ORG, [deployAction("7.39.21108.0")])).rejects.toThrow(
      /could not check the versions of .*HTTP 403/s,
    );
  });

  it("reports a non-empty non-JSON answer as a failed read, not as not found", async () => {
    const client = {
      request: vi.fn(async () => "<html>maintenance</html>"),
    } as unknown as Action1Client;
    await expect(checkActionParams(client, ORG, [deployAction("7.39.21108.0")])).rejects.toThrow(
      /could not check the versions of .*not a package record/s,
    );
  });

  it("passes the caller's abort signal to the version read", async () => {
    const { client, request } = repoClient(REPO);
    const signal = new AbortController().signal;
    await checkActionParams(client, ORG, [deployAction("7.39.21108.0")], signal);
    expect(request).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal }));
  });

  it("reads a package listed twice only once", async () => {
    const { client, request } = repoClient(REPO);
    const twice = {
      template_id: "deploy_package",
      name: "Deploy Software",
      params: {
        display_summary: "CrowdStrike",
        packages: [{ [PKG]: "7.39.21108.0" }, { [PKG]: "7.39.21108.0" }],
        reboot_options: { auto_reboot: "no" },
      },
    };
    await expect(checkActionParams(client, ORG, [twice])).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("collects the problems of every action in one error", async () => {
    const { client } = repoClient(REPO);
    await expect(
      checkActionParams(client, ORG, [
        deployAction("7.39.21108_1787098706695"),
        libraryScriptAction(""),
      ]),
    ).rejects.toThrow(/actions\[0\].*version id.*actions\[1\].*run_script_params/s);
  });
});

describe("checkActionParams: run_script", () => {
  it("accepts a library script with run_script_params []", async () => {
    const { client } = repoClient({});
    await expect(
      checkActionParams(client, ORG, [libraryScriptAction([])]),
    ).resolves.toBeUndefined();
  });

  it('rejects run_script_params "" and says it must be a list', async () => {
    const { client } = repoClient({});
    await expect(checkActionParams(client, ORG, [libraryScriptAction("")])).rejects.toThrow(
      /run_script_params.*list/s,
    );
  });

  it("never echoes the run_script_params value, only its type", async () => {
    const { client } = repoClient({});
    const err = await checkActionParams(client, ORG, [
      libraryScriptAction({ api_key: "sk-SECRET-VALUE" }),
    ]).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain("got an object");
    expect(err!.message).not.toContain("sk-SECRET-VALUE");
  });

  it("rejects a missing run_script_params", async () => {
    const { client } = repoClient({});
    await expect(checkActionParams(client, ORG, [libraryScriptAction(undefined)])).rejects.toThrow(
      /run_script_params/,
    );
  });

  it("rejects a run_script action with neither run_script_id nor run_script_text", async () => {
    const { client } = repoClient({});
    const bad = { template_id: "run_script", name: "x", params: { run_script_params: [] } };
    await expect(checkActionParams(client, ORG, [bad])).rejects.toThrow(
      /run_script_id.*run_script_text/s,
    );
  });
});

describe("checkActionParams: uninstall_program", () => {
  it("accepts name: entries with a '*' version", async () => {
    const { client } = repoClient({});
    const ok = {
      template_id: "uninstall_program",
      name: "Uninstall",
      params: {
        display_summary: "PDQ",
        packages: [{ "name:PDQConnectAgent.msi": "*" }],
        reboot_options: { auto_reboot: "no" },
      },
    };
    await expect(checkActionParams(client, ORG, [ok])).resolves.toBeUndefined();
  });

  it("rejects a non-string version", async () => {
    const { client } = repoClient({});
    const bad = {
      template_id: "uninstall_program",
      name: "Uninstall",
      params: {
        display_summary: "PDQ",
        packages: [{ "name:PDQConnectAgent.msi": ["*"] }],
        reboot_options: { auto_reboot: "no" },
      },
    };
    await expect(checkActionParams(client, ORG, [bad])).rejects.toThrow(/string/);
  });
});

describe("checkActionParams: other actions", () => {
  it("leaves templates it does not check alone and ignores a non-array", async () => {
    const { client, request } = repoClient({});
    await expect(
      checkActionParams(client, ORG, [{ template_id: "reboot", name: "r", params: {} }]),
    ).resolves.toBeUndefined();
    await expect(checkActionParams(client, ORG, undefined)).resolves.toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  });
});

describe("orgIdFromActionPath", () => {
  it("reads the org from the action create paths only", () => {
    expect(orgIdFromActionPath(`/policies/instances/${ORG}`)).toBe(ORG);
    expect(orgIdFromActionPath(`/automations/instances/${ORG}`)).toBe(ORG);
    expect(orgIdFromActionPath(`/automations/schedules/${ORG}`)).toBe(ORG);
    expect(orgIdFromActionPath(`/automations/schedules/${ORG}/abc`)).toBe(ORG);
    expect(orgIdFromActionPath(`/endpoints/managed/${ORG}`)).toBeUndefined();
  });

  it("matches percent-encoded and mixed-case spellings of the action paths", () => {
    expect(orgIdFromActionPath(`/%61utomations/instances/${ORG}`)).toBe(ORG);
    expect(orgIdFromActionPath(`/Automations/Instances/${ORG}`)).toBe(ORG);
    expect(orgIdFromActionPath(`/POLICIES/instances/${ORG}?x=1`)).toBe(ORG);
  });
});
