# Installation Guide

This guide installs **action1-mcp-server** and connects it to the MCP host
of your choice. Pick the section that matches your setup.

This is an unofficial project, not affiliated with or endorsed by Action1.

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 22.12 or newer | `engines` in `package.json`; CI tests 22, 24 and 26. The server runs on Node. `bun run inspector` needs 22.19 or newer. |
| bun | 1.3 or newer | Package manager and script runner for the build. `bun install --frozen-lockfile` installs exactly the versions in `bun.lock`. |
| An Action1 account | any tier | Cloud or trial. |
| API credentials | `client_id` + `client_secret` | Issued in *Settings > API Credentials*. See [Getting credentials](#getting-action1-api-credentials). |

Every install path starts from a clone of
<https://github.com/psd401/action1-mcp>. This fork publishes no npm
package, GitHub release or registry entry. The upstream npm package
`action1-mcp-server` and upstream's release downloads are not vetted for
PSD machines (PSD standard 07-mcp).

## Getting Action1 API credentials

1. Sign in to your Action1 console.
2. Open **Settings > API Credentials**.
3. Click **Add API Credentials** and give it a descriptive name (e.g.
   `claude-mcp`).
4. Assign a **role**. The role decides which API operations succeed.
   Start with a read-only role; [`permissions.md`](permissions.md) lists
   the permission each tool needs. Avoid the *Owner* role.
5. Copy the `client_id` (looks like `api-key-...@action1.com`) and the
   `client_secret`. The secret is shown **once**; store it in a password
   manager. Do not paste it into a chat with an AI assistant.
6. Note the base URL of your region:

   | Region | Base URL |
   |---|---|
   | Europe | `https://app.eu.action1.com/api/3.0` |
   | North America | `https://app.action1.com/api/3.0` |
   | North America 2 | `https://app.na-2.action1.com/api/3.0` |
   | United Kingdom | `https://app.uk.action1.com/api/3.0` |
   | Australia | `https://app.au.action1.com/api/3.0` |

7. Note your `org_id`: copy it from the console URL inside an
   organization, or call `action1_list_organizations` later.

## Step 1: Install the server

### Option A: MCPB bundle for Claude Desktop

Build `dist/action1-mcp-<version>.mcpb` from the checkout and continue
with [Claude Desktop](#claude-desktop-macos--windows). Claude Desktop
runs the bundle with its built-in Node.js.

### Option B: from source (every MCP host)

```bash
git clone https://github.com/psd401/action1-mcp.git
cd action1-mcp
bun install --frozen-lockfile
bun run build
```

`bun run build` compiles to `dist/` (TypeScript only; `bun run check`
runs lint, typecheck, format check and the tests). `dist/index.js` is the entry point.

### Option C: other stdio hosts

Build from source (Option B), then point the MCP host at
`node /absolute/path/to/action1-mcp/dist/index.js`. The settings come
from the environment the MCP host passes to the process (the `env` block
of its configuration, or `-e` for Claude Code). See
[Claude Code](#claude-code-cli) and
[generic stdio clients](#continuedev--cody--generic-stdio-clients).
On macOS, Step 2 stores the credentials in the Keychain, and the host
passes only `ACTION1_KEYCHAIN=true`.

## Step 2: Store the credentials (source install)

On macOS, store the credentials in your login Keychain. Run the script
in your own terminal, not through an AI agent or a chat:

```bash
scripts/keychain-store.sh
```

The script prompts for `ACTION1_BASE_URL`, `ACTION1_ORG_ID`,
`ACTION1_CLIENT_ID` and `ACTION1_CLIENT_SECRET` with hidden input. Each
value becomes a Keychain item: service = variable name, account = your
login user. Run the script again to change a value.

Start the server with `ACTION1_KEYCHAIN=true`. It then reads every
credential the environment leaves unset from the Keychain. Environment
values win over the Keychain. A value missing from both stops the server
with `<NAME> is not set in the environment or the macOS Keychain.`

Non-secret settings go in the host's `env` block, its `-e` flags or your
shell:

```dotenv
# Recommended: only these organizations may be addressed
ACTION1_ALLOWED_ORG_IDS=<your-org-uuid>
# Leave off for read-only use; true allows tools that change state
ACTION1_ALLOW_DESTRUCTIVE=false
```

All settings are listed in the [README](../README.md#configuration) and
in `node dist/index.js --help`.

The Keychain path needs macOS. A Linux server reads one root-owned
environment file outside the checkout, see
[`DEPLOYMENT.md`](DEPLOYMENT.md#bare-metal--vm). On Windows or a Linux
workstation, put the credentials in the host's `env` block (see
[generic stdio clients](#continuedev--cody--generic-stdio-clients)).
Never put a secret in a `.env` file in the checkout.

## Step 3: Smoke test (source install)

```bash
ACTION1_KEYCHAIN=true node dist/index.js --help
```

prints the version and the settings. To open the MCP Inspector against the
built server (Node 22.19 or newer):

```bash
bun run inspector
```

In the UI, open **Tools** and list them: you should see the `action1_*`
tools. Call `action1_list_organizations` (no parameters); if it returns
your organization, the install works.

One-shot call from the command line:

```bash
bunx @modelcontextprotocol/inspector@2.12.0 --cli \
  -e ACTION1_KEYCHAIN=true node dist/index.js \
  --method tools/call --tool-name action1_list_organizations
```

## Step 4: Connect to your MCP host

### Claude Code (CLI)

Store the credentials in the Keychain first (Step 2). `-e` sets each
environment variable for the server. Claude Code stores these flags in
its configuration (`~/.claude.json` for the local and user scopes,
`.mcp.json` in the repository for the project scope). The credentials
stay in the Keychain.

```bash
# stdio (recommended for local use)
claude mcp add action1 \
  -e ACTION1_KEYCHAIN=true \
  -e ACTION1_ALLOWED_ORG_IDS=<your-org-uuid> \
  -- node /absolute/path/to/action1-mcp/dist/index.js

# scope: user (everywhere) or project (current repo)
claude mcp add --scope user action1 -e ACTION1_KEYCHAIN=true -- node /abs/path/to/dist/index.js
```

If you replace `node` with an absolute path, pick one that stays put.
Under fnm, `$(command -v node)` returns a temporary per-shell path that
is deleted when the shell exits. Use the stable alias instead, for
example `/Users/<you>/.local/share/fnm/aliases/default/bin/node`.

Verify with `claude mcp list`. `claude mcp get action1` shows the saved
command. In a Claude Code session, `/mcp` shows the loaded servers and
their tools.

### Claude Desktop (macOS / Windows)

Two installation paths. **Option A is recommended**: Claude Desktop asks
for the settings on install, no Keychain setup or config editing needed.

#### Option A: MCPB bundle (recommended)

1. **Build the bundle** from a clone of this repository:

   ```bash
   git clone https://github.com/psd401/action1-mcp.git
   cd action1-mcp
   bun install --frozen-lockfile
   bun run build:mcpb        # writes dist/action1-mcp-<version>.mcpb
   ```

   On Windows, run the build in Git Bash (part of Git for Windows): the
   build script needs bash.

2. **Install into Claude Desktop**: double-click the `.mcpb` file, drag it
   onto the Claude Desktop window, or open Settings > Extensions >
   *Install from file*.

3. **Fill in the wizard**:

   | Field | Where to get it |
   |---|---|
   | **Action1 API base URL** | Your region, see [Getting credentials](#getting-action1-api-credentials). Default: Europe. |
   | **Default organization ID** | The organization UUID from the console URL. |
   | **API client ID** | Action1 console > Settings > API Credentials, looks like `api-key-...@action1.com`. |
   | **API client secret** | Shown **once** when you create the credential. |
   | **Allow destructive operations** | A checkbox. Leave it unchecked for read-only use. Checked, tools that change state may execute, still only with per-call `confirm: "YES"` and `dry_run: false`. |

   Type the client ID and secret only into this dialog. Account
   operations (users, roles, organizations, enterprise) stay disabled in
   the bundle.

4. **Restart Claude Desktop** if the tools do not appear. In a new chat,
   ask *"What Action1 tools are available?"*: you should see a long list
   of `action1_*` tools. Try `action1_list_organizations` as a read-only
   smoke test.

> **Updating later**: download or build the new `.mcpb` and install it
> again from Settings > Extensions. Settings carry over.

#### Option B: manual JSON config (advanced)

Use this only to run a specific build or to manage the configuration
yourself.

Edit the config file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Store the credentials in the Keychain first (Step 2). Then add to the
`mcpServers` map:

```jsonc
{
  "mcpServers": {
    "action1": {
      "command": "node",
      "args": ["/absolute/path/to/action1-mcp/dist/index.js"],
      "env": { "ACTION1_KEYCHAIN": "true" }
    }
  }
}
```

Quit and restart Claude Desktop. The tools appear in the connector menu.

> **Note**: Claude Desktop ignores remote HTTP MCP servers in this file.

### Claude.ai (web)

Claude.ai connects to remote MCP servers through *Custom Connectors*
(Settings > Connectors > Add custom connector). That needs the
**Streamable HTTP** transport on a server reachable over HTTPS.

Run the server on loopback behind a TLS reverse proxy, as described in
[`DEPLOYMENT.md`](DEPLOYMENT.md#streamable-http-hosted). Its systemd unit
binds to `127.0.0.1:3000` and reads `/etc/action1-mcp/env`. That
root-owned file holds the credentials, `MCP_HTTP_TOKEN`,
`MCP_HTTP_ALLOWED_HOSTS` and `TRUST_PROXY`.

```bash
# On your server
sudo systemctl enable --now action1-mcp
```

In Claude.ai:

1. Settings > Connectors > **Add custom connector**.
2. URL: `https://<your-public-name>/mcp` (the reverse proxy, not port 3000
   directly).
3. Add the request header `Authorization: Bearer <MCP_HTTP_TOKEN value>`.

Do not bind the server to `0.0.0.0` without a proxy, and do not enable
`ACTION1_ALLOW_DESTRUCTIVE` on a server you have not secured with TLS, a
token and `ACTION1_ALLOWED_ORG_IDS`.

### Cursor

Cursor reads `~/.cursor/mcp.json` (per user) or `.cursor/mcp.json` (per
repository).

```jsonc
{
  "mcpServers": {
    "action1": {
      "command": "node",
      "args": ["/abs/path/to/dist/index.js"],
      "env": { "ACTION1_KEYCHAIN": "true" }
    }
  }
}
```

Restart Cursor; the tools appear in the chat UI.

### Continue.dev / Cody / generic stdio clients

Any MCP client that speaks stdio works. With the server built from
source (Option C) and the credentials in the Keychain (Step 2), the
usual JSON configuration (`mcpServers` in Claude Desktop, Cursor and
most other hosts) is:

```json
{
  "mcpServers": {
    "action1": {
      "command": "node",
      "args": ["/absolute/path/to/action1-mcp/dist/index.js"],
      "env": {
        "ACTION1_KEYCHAIN": "true",
        "ACTION1_ALLOWED_ORG_IDS": "<your-org-uuid>"
      }
    }
  }
}
```

The command line is:

```bash
ACTION1_KEYCHAIN=true node /abs/path/dist/index.js
```

On Windows or a Linux workstation, put `ACTION1_BASE_URL`,
`ACTION1_ORG_ID`, `ACTION1_CLIENT_ID` and `ACTION1_CLIENT_SECRET` in the
`env` block instead of `ACTION1_KEYCHAIN`. That file then holds the credential. Keep it readable for your
user only and out of version control.

For HTTP clients, `--http` needs `MCP_HTTP_TOKEN`. Store it once with
`scripts/keychain-store.sh MCP_HTTP_TOKEN`, then start the server:

```bash
ACTION1_KEYCHAIN=true node dist/index.js --http
# endpoint: http://127.0.0.1:3000/mcp, header Authorization: Bearer <token>
```

For a quick local test without a token, `MCP_HTTP_ALLOW_NO_AUTH=true`
works on a loopback bind only.

## Step 5: Verify connectivity

In your MCP host, ask:

> List my Action1 organizations.

The model calls `action1_list_organizations`. You should see your
organization. If not:

1. Check that `ACTION1_BASE_URL` is your region.
2. Check `ACTION1_CLIENT_ID` and `ACTION1_CLIENT_SECRET`.
3. Read the server's stderr: the structured logger prints auth and tool
   events.
4. Read [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

## Updating

Update the checkout and rebuild:

```bash
cd action1-mcp
git pull
bun install --frozen-lockfile
bun run build
```

Restart your MCP host; the tool list refreshes on the next connect. Read
the [`CHANGELOG`](../CHANGELOG.md) for changed settings.

Action1 can change its API independently of this project. `bun run
spec:check` compares the pinned spec with the one Action1 serves; the
tests only check that the committed spec and the generated tools match
each other. [`CONTRIBUTING.md`](CONTRIBUTING.md#re-running-codegen)
explains how to adopt a new spec.

## Uninstall

- Remove the server entry from your MCP host's configuration (or the
  extension from Claude Desktop).
- Delete the cloned repository (source install).
- Revoke the API credential in the Action1 console if you no longer need
  it.

---

## Frequently asked install questions

### Do I need to clone the repo, or is there a one-click installer?

Clone this repository in every case. This fork publishes no installer.

1. **MCPB bundle (Claude Desktop only)**: `bun run build:mcpb` in the
   checkout, then double-click the `.mcpb`.
2. **Build from source**: any stdio host runs
   `node /absolute/path/to/action1-mcp/dist/index.js`.

### Does the server stay running, or does it start per call?

stdio mode: one process per MCP host connection, alive while the host is
connected. HTTP mode: one long-running process serves many clients and
creates a fresh MCP server instance per request.

### Where does the server log?

Always to **stderr**; stdout is reserved for MCP JSON-RPC. To see the
logs:

- Claude Code: start it with `claude --debug`.
- Claude Desktop: the MCP log files in `~/Library/Logs/Claude/` (macOS)
  or `%APPDATA%\Claude\logs` (Windows).
- HTTP mode: the process output (`journalctl -u action1-mcp`, ...).

Set `ACTION1_LOG_LEVEL=debug` for more detail.

### Can I run multiple instances at once?

Yes. Each instance needs its own environment and, in HTTP mode, its own
port. This connects two Action1 organizations or credentials to the same
host; register them under different names (`action1-prod`,
`action1-staging`).

### How do I check the install worked without a chat?

```bash
bunx @modelcontextprotocol/inspector@2.12.0 --cli \
  -e ACTION1_KEYCHAIN=true node dist/index.js --method tools/list | jq '.tools | length'
```

A non-zero number means the server starts and registers its tools.

### Can I hide the generated tools and only use the curated ones?

Yes: `ACTION1_TOOLSETS=curated`. `ACTION1_TOOLSETS=read` keeps only
read-only tools, and `curated,read` combines both.

### Can I add my own tools?

Yes, see [`CONTRIBUTING.md`](CONTRIBUTING.md). Either fork or build your
own server around this one's `Action1Client`.

## Other resources

- [`USAGE.md`](USAGE.md): what each tool does.
- [`EXAMPLES.md`](EXAMPLES.md): copy-paste recipes.
- [`FAQ.md`](FAQ.md): questions across topics.
- [`DEPLOYMENT.md`](DEPLOYMENT.md): production hosting.
- [`SECURITY.md`](SECURITY.md): threat model and safeguards.
- [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md): failure modes.
