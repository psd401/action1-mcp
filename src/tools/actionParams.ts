// ABOUTME: Pre-flight check of action params before an automation or policy instance is created or previewed.
// ABOUTME: Shapes follow the pinned spec (DeployPackage, UninstallPackage, RunScript); deploy versions are read live.
import type { Action1Client } from "../client/action1Client.js";
import { Action1ApiError } from "../client/errors.js";

/**
 * Raised when an action's params would be accepted by Action1's create
 * call but fail on the endpoint, or are malformed. Runs before the
 * destructive guard, so a dry run reports it instead of echoing the
 * request.
 */
export class ActionParamsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionParamsError";
  }
}

const ACTION_PATH = /^\/(?:automations|policies)\/(?:instances|schedules)\/([^/?]+)/;

/** Org id of an action create or update path, undefined for any other path. */
export function orgIdFromActionPath(path: string): string | undefined {
  const m = ACTION_PATH.exec(path);
  return m ? decodeURIComponent(m[1]!) : undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** packages: non-empty array of objects whose values are all strings. */
function packageEntries(where: string, packages: unknown, problems: string[]): [string, string][] {
  if (!Array.isArray(packages) || packages.length === 0) {
    problems.push(
      `${where}.packages must be a non-empty list of {"<package id>": "<version>"} objects`,
    );
    return [];
  }
  const out: [string, string][] = [];
  packages.forEach((entry, i) => {
    if (!isRecord(entry) || Object.keys(entry).length === 0) {
      problems.push(`${where}.packages[${i}] must be an object {"<package id>": "<version>"}`);
      return;
    }
    for (const [id, version] of Object.entries(entry)) {
      if (typeof version !== "string") {
        problems.push(
          `${where}.packages[${i}]["${id}"] must be a string version, got ${typeof version}`,
        );
      } else {
        out.push([id, version]);
      }
    }
  });
  return out;
}

function describeType(v: unknown): string {
  if (v === undefined) return "nothing";
  if (v === null) return "null";
  if (typeof v === "string") return v === "" ? "an empty string" : "a string";
  if (typeof v === "object") return "an object";
  return `a ${typeof v}`;
}

function requireCommon(where: string, params: Record<string, unknown>, problems: string[]): void {
  if (typeof params.display_summary !== "string") {
    problems.push(`${where}.display_summary is required (string)`);
  }
  if (!isRecord(params.reboot_options)) {
    problems.push(`${where}.reboot_options is required (object, e.g. {"auto_reboot": "no"})`);
  }
}

function checkRunScript(where: string, params: Record<string, unknown>, problems: string[]): void {
  if (!Array.isArray(params.run_script_params)) {
    // Only the type is reported: script parameters can carry credentials.
    const got = describeType(params.run_script_params);
    problems.push(
      `${where}.run_script_params must be a list (send [] for a script without parameters), got ${got}`,
    );
  }
  const hasId = typeof params.run_script_id === "string" && params.run_script_id.length > 0;
  const hasText = typeof params.run_script_text === "string" && params.run_script_text.length > 0;
  if (!hasId && !hasText) {
    problems.push(
      `${where} needs run_script_id (a library script) or run_script_text with run_script_language`,
    );
  }
}

interface RepoVersion {
  id?: unknown;
  version?: unknown;
}

type RepoRead = { versions: RepoVersion[] } | { missing: true } | { failed: string };

async function readVersions(
  client: Action1Client,
  orgId: string,
  packageId: string,
  signal: AbortSignal | undefined,
): Promise<RepoRead> {
  try {
    // The client returns a non-JSON body as text, so the answer is unknown.
    const pkg = await client.request<unknown>(
      `/software-repository/${encodeURIComponent(orgId)}/${encodeURIComponent(packageId)}`,
      { method: "GET", query: { fields: "versions" }, ...(signal ? { signal } : {}) },
    );
    // A package that is no longer in the repository comes back as
    // HTTP 200 with an empty text/html body (measured 2026-11-10), not 404.
    if (pkg === "" || pkg === undefined || pkg === null) return { missing: true };
    if (typeof pkg !== "object") return { failed: "the answer was not a package record" };
    const versions = (pkg as { versions?: unknown }).versions;
    if (!Array.isArray(versions)) return { failed: "no versions list in the answer" };
    return { versions: versions as RepoVersion[] };
  } catch (err) {
    if (err instanceof Action1ApiError) {
      if (err.status === 404) return { missing: true };
      return { failed: `HTTP ${err.status}` };
    }
    throw err;
  }
}

async function checkDeployVersions(
  client: Action1Client,
  orgId: string,
  where: string,
  entries: [string, string][],
  problems: string[],
  signal: AbortSignal | undefined,
  reads: Map<string, Promise<RepoRead>>,
): Promise<void> {
  for (const [packageId, version] of entries) {
    let read = reads.get(packageId);
    if (!read) {
      read = readVersions(client, orgId, packageId, signal);
      reads.set(packageId, read);
    }
    const result = await read;
    if ("missing" in result) {
      problems.push(`${where}: package "${packageId}" not found in the software repository`);
      continue;
    }
    if ("failed" in result) {
      problems.push(
        `${where}: could not check the versions of "${packageId}" in the software repository (${result.failed}); nothing is sent unless the version can be checked`,
      );
      continue;
    }
    const versions = result.versions;
    const texts = versions.map((v) => v.version).filter((v): v is string => typeof v === "string");
    if (texts.includes(version)) continue;
    const byId = versions.find((v) => v.id === version);
    if (byId && typeof byId.version === "string") {
      problems.push(
        `${where}: "${version}" is the version id of "${packageId}"; deploy_package takes the version text "${byId.version}"`,
      );
    } else {
      problems.push(
        `${where}: "${packageId}" has no version "${version}"; versions in the repository: ${
          texts.length ? texts.map((t) => `"${t}"`).join(", ") : "none"
        }`,
      );
    }
  }
}

/**
 * Validate every action in `actions`. Templates without a check here
 * pass through. Throws ActionParamsError listing every problem found.
 * deploy_package versions are compared with the live software
 * repository, so this makes one GET per package, dry run included.
 */
export async function checkActionParams(
  client: Action1Client,
  orgId: string,
  actions: unknown,
  signal?: AbortSignal,
): Promise<void> {
  if (!Array.isArray(actions)) return;
  const problems: string[] = [];
  const reads = new Map<string, Promise<RepoRead>>();
  for (const [i, action] of actions.entries()) {
    if (!isRecord(action)) continue;
    const where = `actions[${i}].params`;
    const params = isRecord(action.params) ? action.params : {};
    switch (action.template_id) {
      case "deploy_package": {
        const entries = packageEntries(where, params.packages, problems);
        requireCommon(where, params, problems);
        await checkDeployVersions(client, orgId, where, entries, problems, signal, reads);
        break;
      }
      case "uninstall_program":
        packageEntries(where, params.packages, problems);
        requireCommon(where, params, problems);
        break;
      case "run_script":
        checkRunScript(where, params, problems);
        break;
      default:
        break;
    }
  }
  if (problems.length > 0) {
    throw new ActionParamsError(
      "Action params rejected before sending (nothing was started):\n" +
        problems.map((p) => `  - ${p}`).join("\n"),
    );
  }
}
