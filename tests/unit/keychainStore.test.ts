// ABOUTME: Tests for scripts/keychain-store.sh: name checks, the no-terminal refusal, and a
// ABOUTME: round-trip through a temp keychain driven by expect, read back with readKeychainItem.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readKeychainItem } from "../../src/keychain.js";

const script = fileURLToPath(new URL("../../scripts/keychain-store.sh", import.meta.url));
const canDrive = process.platform === "darwin" && existsSync("/usr/bin/expect");
const dir = mkdtempSync(join(tmpdir(), "action1-keychain-store-"));
const keychain = join(dir, "store.keychain-db");
const account = "action1-store-test";

// Answers each prompt in turn, then exits with the script's exit status.
const DRIVER = `
log_user 0
spawn -noecho bash $env(SCRIPT) --keychain $env(KC) {*}$env(NAMES)
foreach answer [split $env(ANSWERS) "\\n"] {
  expect -re {[A-Z_]+: $}
  send -- "$answer\\r"
}
expect eof
lassign [wait] pid spawnid os code
exit $code
`;

/** Run the store script in a pty, typing `answers` at its prompts; returns the exit status. */
function drive(names: string[], answers: string[]): number | null {
  return spawnSync("/usr/bin/expect", ["-c", DRIVER], {
    env: {
      PATH: process.env.PATH,
      USER: account,
      SCRIPT: script,
      KC: keychain,
      NAMES: names.join(" "),
      ANSWERS: answers.join("\n"),
    },
    stdio: "ignore",
    timeout: 20_000,
  }).status;
}

beforeAll(() => {
  if (canDrive) execFileSync("/usr/bin/security", ["create-keychain", "-p", "test-pass", keychain]);
});

afterAll(() => {
  if (canDrive) execFileSync("/usr/bin/security", ["delete-keychain", keychain]);
  rmSync(dir, { recursive: true, force: true });
});

describe("scripts/keychain-store.sh", () => {
  it("rejects a name that is not a Keychain key", () => {
    const r = spawnSync("bash", [script, "ACTION1_LOG_LEVEL"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Unknown name: ACTION1_LOG_LEVEL");
  });

  it.runIf(process.platform === "darwin")("refuses to run without a terminal", () => {
    const r = spawnSync("bash", [script], { encoding: "utf8", input: "value\n" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Run this script in a terminal");
  });

  it.runIf(canDrive)("stores what is typed at the prompts, byte for byte", () => {
    const secret = 'se"cr\\et with space';
    const status = drive(["ACTION1_CLIENT_ID", "ACTION1_CLIENT_SECRET"], ["id-1", secret]);
    expect(status).toBe(0);
    expect(readKeychainItem("ACTION1_CLIENT_ID", { file: keychain, account })).toBe("id-1");
    expect(readKeychainItem("ACTION1_CLIENT_SECRET", { file: keychain, account })).toBe(secret);
  });

  it.runIf(canDrive)("stores nothing when any answer is empty", () => {
    const status = drive(["ACTION1_BASE_URL", "ACTION1_ORG_ID"], ["https://x.example", "  "]);
    expect(status).toBe(1);
    expect(readKeychainItem("ACTION1_BASE_URL", { file: keychain, account })).toBeUndefined();
  });
});
