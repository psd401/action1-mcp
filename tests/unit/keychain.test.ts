// ABOUTME: Tests for the macOS Keychain credential lookup (src/keychain.ts) and its use by
// ABOUTME: loadConfig under ACTION1_KEYCHAIN: env first, Keychain second, errors name keys only.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ConfigError, loadConfig, resetConfigCache } from "../../src/config.js";
import { KEYCHAIN_KEYS, KeychainError, readKeychainItem } from "../../src/keychain.js";

const darwin = process.platform === "darwin";
const dir = mkdtempSync(join(tmpdir(), "action1-keychain-"));
const keychain = join(dir, "test.keychain-db");
const account = "action1-test";

/** An executable stand-in for /usr/bin/security that runs `body`. */
function fakeSecurity(name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

/** Store one item in the test keychain the way scripts/keychain-store.sh does. */
function store(service: string, value: string): void {
  const quoted = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  execFileSync("/usr/bin/security", ["-i"], {
    input: `add-generic-password -U -s ${service} -a "${account}" -w "${quoted}" "${keychain}"\n`,
    stdio: ["pipe", "ignore", "inherit"],
  });
}

beforeAll(() => {
  if (darwin) {
    execFileSync("/usr/bin/security", ["create-keychain", "-p", "test-pass", keychain]);
  }
});

afterAll(() => {
  if (darwin) execFileSync("/usr/bin/security", ["delete-keychain", keychain]);
  rmSync(dir, { recursive: true, force: true });
});

describe("readKeychainItem", () => {
  it.runIf(darwin)("returns undefined when the item is not in the keychain", () => {
    expect(readKeychainItem("ACTION1_CLIENT_ID", { file: keychain, account })).toBeUndefined();
  });

  it.runIf(darwin)("returns a stored value byte for byte, quotes and backslashes included", () => {
    const value = 'se"cr\\et with space';
    store("ACTION1_CLIENT_SECRET", value);
    expect(readKeychainItem("ACTION1_CLIENT_SECRET", { file: keychain, account })).toBe(value);
  });

  it("throws a KeychainError naming the key, never the output, on any other failure", () => {
    const securityPath = fakeSecurity("fails", "echo leaked-value; echo leaked-err >&2; exit 51");
    let caught: unknown;
    try {
      readKeychainItem("ACTION1_CLIENT_SECRET", { securityPath, account });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(KeychainError);
    const message = (caught as Error).message;
    expect(message).toContain("ACTION1_CLIENT_SECRET");
    expect(message).toContain("51");
    expect(message).not.toContain("leaked");
  });

  it("gives up after the timeout instead of waiting on a prompt", () => {
    const securityPath = fakeSecurity("hangs", "exec sleep 5");
    expect(() =>
      readKeychainItem("ACTION1_CLIENT_ID", { securityPath, account, timeoutMs: 200 }),
    ).toThrow(/ACTION1_CLIENT_ID.*timed out/);
  });
});

describe("loadConfig with ACTION1_KEYCHAIN", () => {
  const ENV_KEYS = [...KEYCHAIN_KEYS, "ACTION1_KEYCHAIN"];
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

  function setEnv(vars: Record<string, string>): void {
    for (const k of ENV_KEYS) delete process.env[k];
    Object.assign(process.env, vars);
    resetConfigCache();
  }

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetConfigCache();
  });

  const marker = join(dir, "called");
  const recording = () => fakeSecurity("records", `touch "${marker}"; exit 44`);

  it("does not run the Keychain lookup when the flag is unset", () => {
    rmSync(marker, { force: true });
    setEnv({});
    expect(() => loadConfig({ keychain: { securityPath: recording(), account } })).toThrow(
      ConfigError,
    );
    expect(existsSync(marker)).toBe(false);
  });

  it("does not run the lookup when the flag value is invalid, and reports the flag", () => {
    rmSync(marker, { force: true });
    setEnv({ ACTION1_KEYCHAIN: "ture" });
    expect(() => loadConfig({ keychain: { securityPath: recording(), account } })).toThrow(
      /ACTION1_KEYCHAIN is invalid/,
    );
    expect(existsSync(marker)).toBe(false);
  });

  it.runIf(darwin)("fills unset keys from the Keychain and keeps values set in the env", () => {
    store("ACTION1_BASE_URL", "https://app.action1.com/api/3.0");
    store("ACTION1_CLIENT_ID", "id-from-keychain");
    store("ACTION1_CLIENT_SECRET", "secret-from-keychain");
    setEnv({ ACTION1_KEYCHAIN: "true", ACTION1_CLIENT_ID: "id-from-env" });
    const cfg = loadConfig({ keychain: { file: keychain, account } });
    expect(cfg.baseUrl).toBe("https://app.action1.com/api/3.0");
    expect(cfg.clientId).toBe("id-from-env");
    expect(cfg.clientSecret).toBe("secret-from-keychain");
  });

  it("says a key is missing from both the env and the Keychain", () => {
    const securityPath = fakeSecurity("empty", "exit 44");
    setEnv({ ACTION1_KEYCHAIN: "true" });
    expect(() => loadConfig({ keychain: { securityPath, account, platform: "darwin" } })).toThrow(
      /ACTION1_CLIENT_SECRET is not set in the environment or the macOS Keychain\./,
    );
  });

  it("reports a failed lookup as a config issue naming the key", () => {
    const securityPath = fakeSecurity("broken", "echo leaked-value; exit 51");
    setEnv({ ACTION1_KEYCHAIN: "true" });
    let caught: unknown;
    try {
      loadConfig({ keychain: { securityPath, account, platform: "darwin" } });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    const issues = (caught as ConfigError).issues.join("\n");
    expect(issues).toMatch(/ACTION1_CLIENT_SECRET.*Keychain/);
    expect(issues).not.toContain("leaked");
  });

  it("stops at the first failed lookup, so a blocked Keychain costs one timeout, not five", () => {
    const calls = join(dir, "calls");
    rmSync(calls, { force: true });
    const securityPath = fakeSecurity("counts", `echo x >> "${calls}"; exit 51`);
    setEnv({ ACTION1_KEYCHAIN: "true" });
    expect(() => loadConfig({ keychain: { securityPath, account, platform: "darwin" } })).toThrow(
      ConfigError,
    );
    expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("refuses the flag on a platform without a macOS Keychain", () => {
    setEnv({ ACTION1_KEYCHAIN: "true" });
    expect(() => loadConfig({ keychain: { platform: "linux" } })).toThrow(
      /ACTION1_KEYCHAIN is invalid: the macOS Keychain is only available on macOS/,
    );
  });
});
