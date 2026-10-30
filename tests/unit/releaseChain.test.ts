// ABOUTME: Build and supply-chain rules that live in workflow files and docs: the bun deploy
// ABOUTME: path, the bundle gate, no publishing, the server.json identity, and workflow hygiene.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The workflows are read as text (no YAML parser in the tree); jobs are
// the two-space-indented keys under `jobs:`.

const root = new URL("../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), "utf8");

/** `jobs:` of a workflow, keyed by job id, each with its raw text. */
function jobs(workflow: string): Map<string, string> {
  const body = workflow.slice(workflow.indexOf("\njobs:\n") + "\njobs:\n".length);
  const out = new Map<string, string>();
  const re = /^ {2}([a-z0-9-]+):\n/gm;
  const heads = [...body.matchAll(re)];
  heads.forEach((m, i) => {
    out.set(m[1]!, body.slice(m.index, heads[i + 1]?.index ?? body.length));
  });
  return out;
}

/** The `run:` commands of a job, one entry per line of each script. */
function runLines(job: string): string[] {
  const lines: string[] = [];
  const all = job.split("\n");
  all.forEach((line, i) => {
    const single = /^\s*(?:- )?run: (?!\|)(.+)$/.exec(line);
    if (single) lines.push(single[1]!.replace(/^["']|["']$/g, ""));
    else if (/^\s*(?:- )?run: \|\s*$/.test(line)) {
      const indent = /^\s*/.exec(all[i + 1] ?? "")![0].length;
      for (let j = i + 1; j < all.length; j++) {
        const next = all[j]!;
        if (next.trim() && /^\s*/.exec(next)![0].length < indent) break;
        lines.push(next.trim());
      }
    }
  });
  return lines.filter(Boolean);
}

/** Index of the first line containing `needle` at or after `from`, or -1. */
function after(lines: string[], needle: string, from = 0): number {
  const i = lines.slice(from).findIndex((l) => l.includes(needle));
  return i < 0 ? -1 : from + i;
}

const dir = ".github/workflows/";
const workflows = Object.fromEntries(
  readdirSync(new URL(dir, root))
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => [f, read(dir + f)]),
);
const ci = read(".github/workflows/ci.yml");
const ciJobs = jobs(ci);
const pkg = JSON.parse(read("package.json")) as {
  name: string;
  version: string;
  mcpName: string;
  private?: boolean;
  repository: { url: string };
};

const INSTALL = "bun install --frozen-lockfile";
const PROD_INSTALL = "bun install --frozen-lockfile --production --ignore-scripts";
const DROP_MODULES = "rm -rf node_modules";

describe("production deploy path (docs/DEPLOYMENT.md)", () => {
  const blocks = [...read("docs/DEPLOYMENT.md").matchAll(/```bash\n([\s\S]*?)```/g)].map((m) =>
    m[1]!.split("\n"),
  );
  const installs = blocks.filter((b) => b.some((l) => l.trim() === "bun run build"));

  // `bun install --production` over a full install keeps the dev packages,
  // so the docs drop node_modules and install the runtime tree fresh.
  it("reinstalls only the runtime dependencies after every source build", () => {
    expect(installs.length).toBeGreaterThan(0);
    for (const block of installs) {
      const build = after(block, "bun run build");
      expect(after(block, INSTALL), block.join("\n")).toBeLessThan(build);
      const drop = after(block, DROP_MODULES, build);
      expect(drop, block.join("\n")).toBeGreaterThan(build);
      expect(after(block, PROD_INSTALL, drop), block.join("\n")).toBeGreaterThan(drop);
    }
  });

  it("is run by CI, which checks no dev package is left and starts the server", () => {
    const job = ciJobs.get("deploy-path");
    expect(job, "ci.yml job deploy-path").toBeDefined();
    const run = runLines(job!);
    const install = after(run, INSTALL);
    const build = after(run, "bun run build", install);
    const drop = after(run, DROP_MODULES, build);
    const prod = after(run, PROD_INSTALL, drop);
    expect(install).toBeGreaterThanOrEqual(0);
    expect(build).toBeGreaterThan(install);
    expect(drop).toBeGreaterThan(build);
    expect(prod).toBeGreaterThan(drop);
    expect(after(run, "devDependencies", prod)).toBeGreaterThan(prod);
    expect(after(run, "scripts/tools-list-snapshot.mjs", prod)).toBeGreaterThan(prod);
  });
});

describe("MCPB reproducibility gate", () => {
  it("CI builds the bundle twice in separate checkouts and compares SHA-256", () => {
    const job = ciJobs.get("mcpb-reproducible");
    expect(job, "ci.yml job mcpb-reproducible").toBeDefined();
    const run = runLines(job!).join("\n");
    expect(run).toContain("bun run build:mcpb");
    expect(run).toContain("sha256sum");
    expect(job!.match(/path: /g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

describe("no publishing", () => {
  it("has no release or MCP Registry workflow", () => {
    expect(Object.keys(workflows)).not.toContain("release.yml");
    expect(Object.keys(workflows)).not.toContain("mcp-registry.yml");
  });

  it("no workflow publishes a package, a release or a registry entry", () => {
    const offenders: string[] = [];
    for (const [file, text] of Object.entries(workflows)) {
      if (
        /\b(npm publish|bun publish|mcp-publisher|softprops\/action-gh-release|gh release)\b/.test(
          text,
        )
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("package.json is private, so npm and bun refuse to publish it", () => {
    expect(pkg.private).toBe(true);
  });
});

describe("server.json", () => {
  const server = JSON.parse(read("server.json")) as {
    $schema: string;
    name: string;
    version: string;
    repository: { url: string; source: string };
    packages?: unknown[];
  };

  it("names this fork under its own repository and the package.json version", () => {
    expect(server.$schema).toMatch(
      /^https:\/\/static\.modelcontextprotocol\.io\/schemas\/\d{4}-\d{2}-\d{2}\/server\.schema\.json$/,
    );
    expect(server.name).toBe("io.github.psd401/action1-mcp");
    expect(pkg.mcpName).toBe(server.name);
    expect(server.repository).toEqual({
      url: "https://github.com/psd401/action1-mcp",
      source: "github",
    });
    expect(pkg.repository.url).toContain(server.repository.url.replace("https://", ""));
    expect(server.version).toBe(pkg.version);
  });

  it("lists no installable package", () => {
    expect(server.packages ?? []).toEqual([]);
  });
});

describe("workflow hygiene", () => {
  it("covers every workflow file", () => {
    expect(Object.keys(workflows).sort()).toEqual([
      "ci.yml",
      "claude-review.yml",
      "license-check.yml",
      "psd-ci.yml",
      "security-scan.yml",
      "spec-drift.yml",
    ]);
  });

  it("every job that runs steps has a timeout", () => {
    const missing: string[] = [];
    for (const [file, text] of Object.entries(workflows)) {
      for (const [id, job] of jobs(text)) {
        // A job that calls a reusable workflow cannot set one.
        if (/^ {4}uses: /m.test(job)) continue;
        if (!/^ {4}timeout-minutes: \d+$/m.test(job)) missing.push(`${file} ${id}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every action is pinned to a full commit SHA", () => {
    const unpinned: string[] = [];
    for (const [file, text] of Object.entries(workflows)) {
      for (const m of text.matchAll(/^\s*(?:- )?uses: ([^\s#]+)/gm)) {
        const ref = m[1]!;
        if (ref.startsWith("./")) continue;
        if (!/@[0-9a-f]{40}$/.test(ref)) unpinned.push(`${file}: ${ref}`);
      }
    }
    expect(unpinned).toEqual([]);
  });

  it("CI fails on high or critical advisories in bun.lock", () => {
    expect(runLines(ciJobs.get("audit") ?? "")).toContain("bun audit --audit-level=high");
  });
});

describe("docs/maintainers/repo-settings.md", () => {
  it("names every CI job as a required check", () => {
    const doc = read("docs/maintainers/repo-settings.md");
    for (const id of ciJobs.keys()) expect(doc, id).toContain(`\`${id}`);
  });
});

const trackedText = () =>
  execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.(md|sh|json|mjs|ts|ya?ml)$/.test(f));

describe("pinned tools", () => {
  it("every bunx or npx call of the MCP inspector names a version", () => {
    const unpinned: string[] = [];
    for (const f of trackedText()) {
      read(f)
        .split("\n")
        .forEach((line, i) => {
          if (/\b(bunx|npx)\b[^\n]*@modelcontextprotocol\/inspector(?!@\d)/.test(line)) {
            unpinned.push(`${f}:${i + 1}`);
          }
        });
    }
    expect(unpinned).toEqual([]);
  });
});

describe("npm distribution in the docs", () => {
  // The fork installs from its own checkout (docs/INSTALLATION.md); the
  // upstream npm package is not vetted for PSD machines (standards/07-mcp).
  it("no document tells anyone to install or run the npm package", () => {
    const files = execFileSync("git", ["ls-files", "*.md"], { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter((f) => f && f !== "CHANGELOG.md" && !f.startsWith("docs/adr/"));
    const run = new RegExp(
      `\\b(?:npx(?: -y)?|bunx|npm (?:i|install)(?: -g)?|bun (?:add|install)(?: -g)?) ${pkg.name}\\b`,
    );
    const hits: string[] = [];
    for (const f of files) {
      read(f)
        .split("\n")
        .forEach((line, i) => {
          if (run.test(line)) hits.push(`${f}:${i + 1}`);
        });
    }
    expect(hits).toEqual([]);
  });
});

describe("Glama listing (glama.json)", () => {
  it("names mguttmann as maintainer under Glama's server schema", () => {
    const glama = JSON.parse(read("glama.json")) as { $schema: string; maintainers: string[] };
    expect(glama.$schema).toBe("https://glama.ai/mcp/schemas/server.json");
    expect(glama.maintainers).toEqual(["mguttmann"]);
  });
});
