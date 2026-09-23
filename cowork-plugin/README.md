# Smartsheet Cowork plugin

A Microsoft 365 Copilot Cowork **plugin** (connector-only, no custom skill) that
gives Cowork the same Smartsheet read/write tools as the VS Code MCP server in
[../server.mjs](../server.mjs), but reachable from Microsoft's cloud and signed in
as **you personally** (Smartsheet OAuth), not a shared token.

Personal use only: sideloaded to Daniel's own Cowork account, not published to the
team or the tenant.

## How it's different from the VS Code server

| | VS Code (`../server.mjs`) | This plugin |
|---|---|---|
| Transport | stdio, local process | HTTPS, hosted on Vercel |
| Auth | one shared `.env` token | your own Smartsheet login (OAuth), per Cowork user |
| Runs | only while VS Code is open | always on (serverless) |

`lib/smartsheet-client.mjs` is a copy of the same Smartsheet REST calls, just
parameterized by an access token instead of reading `.env`.

## One-time setup

Do these in order. Steps 1, 3, and 6 need your own logins and can't be done for you.

### 1. Register a Smartsheet OAuth app

1. In the Smartsheet app: **Account** icon (bottom-left) → **Developer Tools...** → **Create Developer Profile** (name it anything, e.g. "Cowork plugin").
2. Still in Developer Tools, **Create New App**:
   - **App name**: `Smartsheet Tools for Cowork`
   - **App redirect URL**: `https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect` — this exact URL, it's fixed by Microsoft, not something you choose.
   - Other fields (description, app URL, contact) can be anything reasonable.
3. Save. Smartsheet shows an **App client ID** and **App secret** — copy both, you'll need them in step 3.

If your Eide Bailly Smartsheet account needs approval to use Developer Tools, that request happens on this same page; it may need Smartsheet or an admin to approve before you can register an app.

### 2. Deploy the server to Vercel

Done. The project is `cowork-plugin` under the **eidebailly** Vercel team, and the stable production URL is:

```
https://cowork-plugin.vercel.app/api/mcp
```

That URL is already set in [manifest.json](manifest.json). To push changes later, from the repo root:

```powershell
npx vercel --prod --cwd initiatives/smartsheet-mcp/cowork-plugin
```

[vercel.json](vercel.json) tells Vercel to bundle `tools/` with the function; without it, the tool schemas aren't on disk at runtime and `tools/list` fails.

### 3. Register the OAuth client with Microsoft

1. Open the [Teams Developer Portal](https://dev.teams.microsoft.com/tools) → **OAuth client registration** → **Register client** (or **New OAuth client registration**).
2. Fill in:
   - **Registration name**: `Smartsheet Tools for Cowork`
   - **Base URL**: `https://cowork-plugin.vercel.app`
   - **Restrict usage by org**: *My organization only* (fine for personal use)
   - **Restrict usage by app**: *Any Teams app*
   - **Client ID** / **Client secret**: the Smartsheet App client ID / secret from step 1
   - **Authorization endpoint**: `https://app.smartsheet.com/b/authorize`
   - **Token endpoint**: `https://api.smartsheet.com/2.0/token`
   - **Refresh endpoint**: `https://api.smartsheet.com/2.0/token` (same URL; Smartsheet uses one endpoint for both, distinguished by a `grant_type` field)
   - **Scope**: `READ_SHEETS WRITE_SHEETS CREATE_SHEETS ADMIN_WORKSPACES ADMIN_SHEETS`
   - **Enable PKCE**: turn this **off**. Smartsheet's OAuth flow doesn't support PKCE, only a client secret.
3. Save. Copy the **OAuth client registration ID** it generates.

`ADMIN_SHEETS` is what Smartsheet requires to change a sheet's structure, which is what the two column tools do. `WRITE_SHEETS` covers comments. If you registered this client before the column tools existed, edit the registration to add `ADMIN_SHEETS` and then sign out of the Smartsheet connector in Cowork and sign back in: the old consent doesn't cover the new scope, so column calls fail with a permissions error until you re-consent.

Paste that ID into [manifest.json](manifest.json) as `REPLACE_WITH_OAUTH_CLIENT_REGISTRATION_ID`.

### 4. Package the plugin

```powershell
# From repo root:
npm run package:cowork

# Or from inside cowork-plugin:
npm run package
```

Produces `smartsheet-cowork-plugin.zip` (manifest and the two icons) in this folder. Re-run whenever `manifest.json` changes.

The zip does **not** contain the tool schemas. Manifest 1.29 supports dynamic tool discovery: because `mcpToolDescription` is omitted, Cowork calls `tools/list` on the live endpoint instead, so tool changes ship by redeploying to Vercel rather than by repackaging and reinstalling.

### 5. Install it to your own Cowork

```powershell
npm install -g @microsoft/m365agentstoolkit-cli
atk --version
atk auth login
atk install --file-path "cowork-plugin/smartsheet-cowork-plugin.zip" --scope Personal
```

`atk auth login` uses your Microsoft 365 work account. Save the `TitleId`/`AppId` it prints if you ever need to update or remove it.

Done. The installed app is:

```
TitleId: T_04e2bd16-4c73-2a6d-56b2-8240e67af25a
AppId:   b1316832-9e4b-4b91-b50d-7513ec6b314b
```

### 6. Test in Cowork

Open Cowork, enable the plugin under **Sources & Skills → Plugins**, and try something like:

- "List my Smartsheet sheets"
- "What's in my favorited Smartsheet sheets?"
- "Add a row to [sheet name] with [values]"

The first call to a tool prompts you to sign in to Smartsheet (OAuth consent). After that, Cowork remembers it.

## Tools exposed

Same twelve as the VS Code server — see [tools/smartsheet-tools.json](tools/smartsheet-tools.json) for the exact schemas, or [../README.md](../README.md) for the plain-language list. Reads (`list_sheets`, `list_my_sheets`, `list_favorite_sheets`, `get_sheet`, `list_discussions`) run without confirmation; writes (`add_row`, `update_row`, `create_workspace`, `create_sheet`, `add_comment`, `add_column`, `update_column`) prompt you to approve each call.

A row comment creates a real Smartsheet discussion on that row, the same thing you'd see in the row's conversation pane. It does not write into any column.

## Files

- `manifest.json` — the M365 app manifest (connector only, no `agentSkills`).
- `tools/smartsheet-tools.json` — tool schemas, served by the live endpoint's `tools/list` response. Not packaged in the zip; changes take effect on redeploy.
- `lib/smartsheet-client.mjs` — the Smartsheet REST calls, copied from `../server.mjs` and parameterized by an access token.
- `api/mcp.mjs` — the Vercel serverless function implementing the MCP JSON-RPC endpoint.
- `vercel.json` — deploy config; its only job is bundling `tools/` into the function.
- `scripts/generate-icons.mjs` — regenerates the placeholder `color.png`/`outline.png` (solid Eide Bailly navy). Replace with real art before sharing this beyond yourself.
- `scripts/package.ps1` — builds the zip. It adds entries by hand because `Compress-Archive` writes backslash paths, which the Teams package validator rejects.
- `color.png`, `outline.png` — generated, not hand-drawn. Gitignored is only the zip and `.vercel/`; these two are committed so the package always has valid icons.

## Known limitations

- **Placeholder icons.** Solid color squares, not real artwork.
- **Personal only.** `manifest.json`'s `id` is a fixed GUID picked for this project; if this is ever shared with teammates or published, keep that GUID stable across versions (don't regenerate it).
- **Smartsheet access tokens expire in ~7 days**; Cowork's Enterprise Token Store refreshes them automatically using the refresh endpoint registered in step 3, so this shouldn't surface as a problem day to day.
