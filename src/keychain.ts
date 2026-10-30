// ABOUTME: Reads Action1 credentials from the macOS Keychain with /usr/bin/security. Each item's
// ABOUTME: service is the env var name and its account is the login user (standards/04 rule 15a).
import { spawnSync } from "node:child_process";
import { userInfo } from "node:os";

/** Env vars the server looks up in the Keychain when ACTION1_KEYCHAIN is on. */
export const KEYCHAIN_KEYS = [
  "ACTION1_BASE_URL",
  "ACTION1_ORG_ID",
  "ACTION1_CLIENT_ID",
  "ACTION1_CLIENT_SECRET",
  "MCP_HTTP_TOKEN",
] as const;

export interface KeychainOptions {
  /** Keychain file to search; default is the user's keychain search list. */
  file?: string;
  /** Item account; default is $USER, then the OS login name. */
  account?: string;
  /** Platform the lookup runs on; default process.platform. */
  platform?: NodeJS.Platform;
  /** Path of the security binary; default /usr/bin/security. */
  securityPath?: string;
  /** Upper bound for one lookup in ms; default 10000. */
  timeoutMs?: number;
}

/** A Keychain lookup failed for a reason other than "item not found". */
export class KeychainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeychainError";
  }
}

// `security find-generic-password` exits 44 (errSecItemNotFound) when no item matches.
const NOT_FOUND = 44;
const DEFAULT_TIMEOUT_MS = 10_000;

function defaultAccount(): string {
  return process.env.USER || userInfo().username;
}

/**
 * The password of the generic-password item `service` for the account,
 * or undefined when there is none. The value travels only through the
 * child's stdout pipe. Error messages name the service and the exit
 * status, never the child's output.
 */
export function readKeychainItem(
  service: string,
  options: KeychainOptions = {},
): string | undefined {
  const args = ["find-generic-password", "-s", service, "-a", options.account ?? defaultAccount()];
  args.push("-w");
  if (options.file) args.push(options.file);
  const result = spawnSync(options.securityPath ?? "/usr/bin/security", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ETIMEDOUT") {
      throw new KeychainError(`Keychain lookup of ${service} timed out.`);
    }
    throw new KeychainError(`Keychain lookup of ${service} could not run security (${code}).`);
  }
  if (result.status === NOT_FOUND) return undefined;
  if (result.status !== 0) {
    throw new KeychainError(
      `Keychain lookup of ${service} failed: security exited ${result.status ?? result.signal}.`,
    );
  }
  return result.stdout.replace(/\n$/, "");
}
