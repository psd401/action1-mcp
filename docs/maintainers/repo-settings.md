# Repository settings (maintainers)

The workflows in `.github/workflows/` assume the GitHub settings below.
A workflow cannot set them itself; the repository owner applies them
once, in the web UI or with the `gh api` calls shown. Some features
(rulesets and private vulnerability reporting on a private repository,
CodeQL on a private repository) depend on the repository being public
or on the GitHub plan.

`tests/unit/releaseChain.test.ts` fails when a job is added to
`ci.yml` without being listed in the required checks below.

This fork publishes nothing, so it needs none of upstream's publishing
settings (see [Not used by this fork](#4-not-used-by-this-fork)).

## 1. Ruleset for `main`

Settings > Rules > Rulesets > New branch ruleset.

- Name `main: pull request + green checks`, enforcement **Active**,
  target **Default branch**, bypass actor **Repository admin**.
- **Restrict deletions** and **Block force pushes**.
- **Require a pull request before merging** (required approvals 0, as
  PSD standard 03-code-review requires).
- **Require status checks to pass**, with **Require branches to be up to
  date before merging**. Required checks, GitHub Actions as the source:
  - Job names of `.github/workflows/ci.yml`:
    - `test (22)`, `test (24)`, `test (26)`
    - `node-floor`
    - `format`
    - `coverage`
    - `audit`
    - `deploy-path`
    - `mcpb-reproducible`
    - `codegen-roundtrip`
    - `e2e (22)`, `e2e (24)`
    - `cross-os (windows-latest)`, `cross-os (macos-latest)`
    - `gitleaks`
  - The PSD checks, callers of the `PSD401/.github` reusable workflows.
    GitHub names each check `<caller job> / <reused job>`:
    - `psd-ci / psd-ci` (`psd-ci.yml`)
    - `security-scan / security-scan` (`security-scan.yml`)
    - `claude-review / claude-review` (`claude-review.yml`)
    - `license-check / license-check` (`license-check.yml`)

```bash
gh api -X POST repos/{owner}/{repo}/rulesets --input - <<'EOF'
{
  "name": "main: pull request + green checks",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [ { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" } ],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "test (22)" }, { "context": "test (24)" }, { "context": "test (26)" },
          { "context": "node-floor" },
          { "context": "format" }, { "context": "coverage" }, { "context": "audit" },
          { "context": "deploy-path" }, { "context": "mcpb-reproducible" },
          { "context": "codegen-roundtrip" },
          { "context": "e2e (22)" }, { "context": "e2e (24)" },
          { "context": "cross-os (windows-latest)" }, { "context": "cross-os (macos-latest)" },
          { "context": "gitleaks" },
          { "context": "psd-ci / psd-ci" }, { "context": "security-scan / security-scan" },
          { "context": "claude-review / claude-review" }, { "context": "license-check / license-check" }
        ] } }
  ]
}
EOF
```

## 2. Actions

Settings > Actions > General:

- **Workflow permissions**: *Read repository contents and packages
  permissions*. Every workflow declares its own minimal `permissions`.
  Only the `claude-review` job asks for more (`id-token: write`, for the
  OIDC exchange of the reusable Claude review).
- **Allow GitHub Actions to create and approve pull requests**: off.
- **Actions permissions**: allow actions created by GitHub, plus
  `oven-sh/setup-bun` and the reusable workflows of `PSD401/.github`.
  Every `uses:` is pinned by commit SHA.
- **Fork pull request workflows**: require approval for all outside
  collaborators.

```bash
gh api -X PUT repos/{owner}/{repo}/actions/permissions/workflow \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false
```

## 3. Code security

Settings > Code security:

- **Private vulnerability reporting**: on (the confidential channel
  `docs/SECURITY.md` points to).
- **Dependabot alerts** and **Dependabot security updates**: on.
  Version updates are configured in `.github/dependabot.yml`.
- **Secret scanning** with **push protection**: on. The `gitleaks` job
  scans the full history in CI as well.
- **CodeQL**: default setup for JavaScript/TypeScript and GitHub
  Actions. After its first run, add its check to the `main` ruleset.

```bash
gh api -X PUT repos/{owner}/{repo}/private-vulnerability-reporting
gh api -X PUT repos/{owner}/{repo}/vulnerability-alerts
gh api -X PUT repos/{owner}/{repo}/automated-security-fixes
```

## 4. Not used by this fork

Upstream (mguttmann/action1-mcp) publishes releases. This fork has no
`release.yml` or `mcp-registry.yml` and does not use these settings:

- a tag ruleset for release tags;
- npm trusted publishing, the `NPM_PUBLISH_ENABLED` variable and any npm
  token (`package.json` is `private`, so npm and bun refuse to publish);
- an MCP Registry entry (`server.json` names
  `io.github.psd401/action1-mcp` and lists no package);
- the Glama listing. `glama.json` names the upstream maintainer and
  stays for upstream's listing.

## Check the result

```bash
gh api repos/{owner}/{repo}/rulesets
gh api repos/{owner}/{repo}/actions/permissions/workflow
gh api repos/{owner}/{repo}/private-vulnerability-reporting
gh api repos/{owner}/{repo}/vulnerability-alerts   # 204 when on
```
