# Smartsheet Cowork Plugin

A Microsoft 365 Copilot Cowork connector plugin that gives Cowork live access to Smartsheet. Each user signs in with their own Smartsheet account via OAuth.

## Install (for users)

The backend service is already deployed and registered for Eide Bailly. You do not need to configure Vercel, create an OAuth app, or write code.

1. Download [smartsheet-cowork-plugin.zip](smartsheet-cowork-plugin.zip) (also available on the [Releases page](https://github.com/ddaou-eb/smartsheet-mcp/releases)).
2. Sideload the zip into Teams / Cowork:
   - **Option A (Teams UI):** In Teams, go to **Apps** > **Manage your apps** > **Upload an app** > **Upload a custom app**, and select `smartsheet-cowork-plugin.zip`.
   - **Option B (CLI):** Run:
     ```powershell
     npm install -g @microsoft/m365agentstoolkit-cli
     atk auth login
     atk install --file-path "smartsheet-cowork-plugin.zip" --scope Personal
     ```
3. Open Cowork, enable **Smartsheet Tools** under your plugins/connectors, and run a prompt (such as "List my favorite Smartsheet sheets").
4. Follow the prompt to sign in to your Smartsheet account to authorize access.

---

## Developer and maintenance notes

The notes below are only for maintaining or redeploying the backend infrastructure.

### Production architecture
- **Hosting:** Deployed to Vercel at `https://cowork-plugin.vercel.app/api/mcp` under the Eide Bailly team.
- **Manifest:** `manifest.json` points to the Vercel endpoint and includes the pre-configured Microsoft OAuth registration ID.
- **OAuth flow:** Handled by Microsoft Teams OAuth Vault connecting to Smartsheet's OAuth endpoints. Scopes: `READ_SHEETS WRITE_SHEETS CREATE_SHEETS ADMIN_WORKSPACES ADMIN_SHEETS`.

### Rebuilding the zip
If you modify `manifest.json` or icons:
```powershell
npm run package
```

### Redeploying the endpoint
To deploy changes to `api/mcp.mjs` or `lib/smartsheet-client.mjs`:
```powershell
npx vercel --prod
```

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
