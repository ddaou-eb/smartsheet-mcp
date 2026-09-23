# smartsheet-mcp

Model Context Protocol (MCP) server connecting AI assistants to Smartsheet. Lets tools list and read sheets, add or update rows, manage columns, post comments, and create workspaces.

Works two ways:
- **VS Code, GitHub Copilot, and Claude Desktop:** A local process (`server.mjs`) using a personal Smartsheet API token.
- **Microsoft Copilot Cowork:** A cloud connector in `cowork-plugin/` using per-user Smartsheet OAuth.

## Install

Clone the repo or download it as a zip (Code > Download ZIP on GitHub):

```bash
git clone https://github.com/ddaou-eb/smartsheet-mcp.git
cd smartsheet-mcp
npm install
```

## Local setup (VS Code and Claude Desktop)

### 1. Get an API token
1. In Smartsheet, go to **Account** > **Apps & Integrations** > **API Access**.
2. Click **Generate new access token** and copy it.

### 2. Set credentials
Copy `.env.example` to `.env` and paste your token:

```bash
cp .env.example .env
```

```env
SMARTSHEET_ACCESS_TOKEN=your_token_here
```

### 3. Register the server

**VS Code (`.vscode/mcp.json`):**
```json
{
  "servers": {
    "smartsheet": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/server.mjs"],
      "envFile": "${workspaceFolder}/.env"
    }
  }
}
```

**Claude Desktop (`claude_desktop_config.json`):**
```json
{
  "mcpServers": {
    "smartsheet": {
      "command": "node",
      "args": ["/absolute/path/to/smartsheet-mcp/server.mjs"],
      "env": {
        "SMARTSHEET_ACCESS_TOKEN": "your_token_here"
      }
    }
  }
}
```

## Microsoft Copilot Cowork

The Cowork plugin lives in `cowork-plugin/`.

1. Download the pre-built `smartsheet-cowork-plugin.zip` from [Releases](https://github.com/ddaou-eb/smartsheet-mcp/releases) or the `cowork-plugin/` folder.
2. Follow the setup in [cowork-plugin/README.md](cowork-plugin/README.md) to register your Smartsheet OAuth app and sideload the plugin.

## Tools

| Tool | What it does |
|---|---|
| `smartsheet_list_my_sheets` | Sheets in your personal Home tab. Best default for general requests. |
| `smartsheet_list_favorite_sheets` | Sheets you starred as favorites in Smartsheet. |
| `smartsheet_list_sheets` | All sheets across your organization visible to your account. |
| `smartsheet_get_sheet` | Read columns and rows by `sheetId` or `sheetName`. |
| `smartsheet_add_row` | Append a row keyed by column title. Handles text, numbers, dropdowns, and contact emails. |
| `smartsheet_update_row` | Update cells on an existing row by row ID. |
| `smartsheet_create_sheet` | Create a sheet with column definitions, optionally in a workspace. |
| `smartsheet_create_workspace` | Create a new workspace. |
| `smartsheet_list_discussions` | Read comment threads on a sheet or a specific row. |
| `smartsheet_add_comment` | Post a comment on a sheet or a specific row. |
| `smartsheet_add_column` | Add a column with a title and type. |
| `smartsheet_update_column` | Rename, retype, reorder, or update dropdown options for a column. |

## Updates

Maintained by [Daniel Daou](mailto:ddaou@eidebailly.com). Pull the latest commits or download a new zip when updates are published.
