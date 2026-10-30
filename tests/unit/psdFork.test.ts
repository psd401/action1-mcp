// ABOUTME: Rules the PSD fork adds on top of upstream: bun as the package manager,
// ABOUTME: OIDC only for PSD401 reusable workflows, and the PSD401 reusable CI callers.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), "utf8");
const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n");

const dir = ".github/workflows/";
const workflows = Object.fromEntries(
  readdirSync(new URL(dir, root))
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => [f, read(dir + f)]),
);

/** `jobs:` of a workflow, keyed by job id, each with its raw text. */
function jobs(workflow: string): Map<string, string> {
  const body = workflow.slice(workflow.indexOf("\njobs:\n") + "\njobs:\n".length);
  const out = new Map<string, string>();
  const heads = [...body.matchAll(/^ {2}([a-z0-9-]+):\n/gm)];
  heads.forEach((m, i) => {
    out.set(m[1]!, body.slice(m.index, heads[i + 1]?.index ?? body.length));
  });
  return out;
}

const PSD_REUSABLE =
  /^ {4}uses: PSD401\/\.github\/\.github\/workflows\/reusable-[a-z-]+\.yml@[0-9a-f]{40}/m;

describe("package manager", () => {
  it("tracks bun.lock and no npm lockfile", () => {
    expect(tracked).toContain("bun.lock");
    expect(tracked).not.toContain("package-lock.json");
  });

  it("package.json scripts never call npm or npx", () => {
    const { scripts } = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    const offenders = Object.entries(scripts).filter(([, cmd]) => /\b(npm|npx)\b/.test(cmd));
    expect(offenders).toEqual([]);
  });

  it("no workflow runs npm or npx", () => {
    const offenders: string[] = [];
    for (const [file, text] of Object.entries(workflows)) {
      text.split("\n").forEach((line, i) => {
        if (/^\s*#/.test(line)) return;
        if (/\b(npm|npx)\b/.test(line)) offenders.push(`${file}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("no script under scripts/ runs or names npm or npx outside a comment", () => {
    const offenders: string[] = [];
    for (const f of tracked.filter((t) => t.startsWith("scripts/"))) {
      read(f)
        .split("\n")
        .forEach((line, i) => {
          if (/^\s*(#|\/\/|\*)/.test(line)) return;
          if (/\b(npm|npx)\b/.test(line)) offenders.push(`${f}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("every workflow install uses the frozen bun lockfile", () => {
    const loose: string[] = [];
    for (const [file, text] of Object.entries(workflows)) {
      text.split("\n").forEach((line, i) => {
        if (/^\s*#/.test(line)) return;
        if (/\bbun install\b/.test(line) && !/--frozen-lockfile\b/.test(line)) {
          loose.push(`${file}:${i + 1}`);
        }
      });
    }
    expect(loose).toEqual([]);
  });
});

describe("OIDC", () => {
  it("grants id-token: write only to jobs that call a PSD401 reusable workflow", () => {
    const offenders: string[] = [];
    for (const [file, text] of Object.entries(workflows)) {
      const header = text
        .slice(0, text.indexOf("\njobs:\n"))
        .split("\n")
        .filter((line) => !/^\s*#/.test(line))
        .join("\n");
      if (/id-token: write/.test(header)) offenders.push(`${file} (workflow level)`);
      for (const [id, job] of jobs(text)) {
        if (/id-token: write/.test(job) && !PSD_REUSABLE.test(job)) offenders.push(`${file} ${id}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("PSD401 reusable CI", () => {
  it.each([
    ["psd-ci.yml", "psd-ci", "reusable-psd-ci.yml"],
    ["security-scan.yml", "security-scan", "reusable-security-scan.yml"],
    ["claude-review.yml", "claude-review", "reusable-claude-review.yml"],
    ["license-check.yml", "license-check", "reusable-license-check.yml"],
  ])("%s calls %s through the pinned %s", (file, jobId, reusable) => {
    const job = jobs(workflows[file] ?? "").get(jobId) ?? "";
    expect(job).toMatch(PSD_REUSABLE);
    expect(job).toContain(`/${reusable}@`);
  });
});
