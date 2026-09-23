# Smartsheet MCP

A Model Context Protocol (MCP) toolkit that connects AI assistants to Smartsheet. It gives AI tools the ability to read and write sheets, update rows, manage columns, post row discussions, and create workspaces.

This repository includes two delivery targets:
1. **Local MCP Server (stdio):** For VS Code, GitHub Copilot, Claude Desktop, and Cursor. Runs locally on your machine and connects using a personal Smartsheet API access token.
2. **Microsoft Copilot Cowork Plugin:** A cloud connector in `cowork-plugin/` for Microsoft 365 Copilot Cowork, authenticated via Smartsheet OAuth per user.

---

## Quick Start: Download or Clone

You can get this code in two ways:
- **Clone with Git:**
  ```bash
  git clone https://github.com/ddaou-eb/smartsheet-mcp.git
  ```
- **Download as a ZIP:** Click the green **Code** button at the top of the GitHub page, then select **Download ZIP**. Extract the folder to your machine.

---

## Option 1: VS Code, GitHub Copilot, and Claude Desktop

The local server runs via stdio. Your AI assistant starts the server as a background process and communicates with it directly.

### 1. Requirements

- [Node.js](https://nodejs.org/) (v18 or newer)
- A Smartsheet account with API access

### 2. Get your Smartsheet API Access Token

1. Log in to [Smartsheet](https://app.smartsheet.com).
2. Click **Account** (profile icon in bottom-left) > **Apps & Integrations** > **API Access**.
3. Click **Generate new access token**. Give it a descriptive name (such as "VS Code MCP").
4. Copy the token immediately. Smartsheet will not display it again.

### 3. Setup and Configuration

1. In the repository root, install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   (On Windows PowerShell: `Copy-Item .env.example .env`)
3. Open `.env` and paste your access token:
   ```env
   SMARTSHEET_ACCESS_TOKEN=your_token_here
   ```

### 4. Connect to Your AI Assistant

#### VS Code (GitHub Copilot)
Add the server to your workspace or global `.vscode/mcp.json`:
```json
{
  "servers": {
    "smartsheet": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/smartsheet-mcp/server.mjs"],
      "envFile": "/path/to/smartsheet-mcp/.env"
    }
  }
}
```

#### Claude Desktop
Add to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "smartsheet": {
      "command": "node",
      "args": ["/path/to/smartsheet-mcp/server.mjs"],
      "env": {
        "SMARTSHEET_ACCESS_TOKEN": "your_token_here"
      }
    }
  }
}
```

Restart your editor. Ask your AI assistant: *"List my favorite Smartsheet sheets."*

---

## Option 2: Microsoft Copilot Cowork Plugin

If you use Microsoft Copilot Cowork, the toolset is packaged as a ready-to-upload Teams connector in `cowork-plugin/`.

- **Pre-packaged ZIP:** Download `cowork-plugin/smartsheet-cowork-plugin.zip`.
- **How it works:** Connects Cowork to a remote HTTPS MCP endpoint. Each user logs in through their own Smartsheet account via OAuth rather than sharing a single token.
- **Detailed setup guide:** See [cowork-plugin/README.md](cowork-plugin/README.md) for full instructions on setting up OAuth in Smartsheet, registering in the Teams Developer Portal, and deploying to Vercel.

To rebuild the Cowork zip package after modifying the manifest or icons:
```bash
npm run package:cowork
```

---

## Available Tools

| Tool | Description |
|---|---|
| `smartsheet_list_my_sheets` | Lists sheets in your personal Home tab (owned by or shared directly with you). Recommended for general requests. |
| `smartsheet_list_favorite_sheets` | Lists sheets you have starred as favorites in Smartsheet. Fastest way to access your key sheets. |
| `smartsheet_list_sheets` | Lists all sheets across the entire organization visible to your account. |
| `smartsheet_get_sheet` | Reads a sheet's columns and rows by `sheetId` or exact `sheetName`. |
| `smartsheet_add_row` | Appends a new row to a sheet, keyed by column titles. Supports text, numbers, dropdowns, and contact emails. |
| `smartsheet_update_row` | Updates cells on an existing row using the row's ID and column titles. |
| `smartsheet_create_sheet` | Creates a new sheet from a column definition, optionally inside a specific workspace. |
| `smartsheet_create_workspace` | Creates a new empty Smartsheet workspace. |
| `smartsheet_list_discussions` | Reads comment threads on a sheet, or for a specific row. |
| `smartsheet_add_comment` | Posts a new discussion comment on a sheet or a specific row. |
| `smartsheet_add_column` | Adds a new column to an existing sheet with a specified type and title. |
| `smartsheet_update_column` | Renames, retypes, reorders, or updates dropdown options for an existing column. |

---

## Security and Privacy

- **Your credentials stay local:** When using the local MCP server, your API token lives in your local `.env` file and is never uploaded or shared.
- **Git protection:** `.env` is listed in `.gitignore` so personal tokens cannot be committed.
- **Permissions:** The tools operate strictly within the permissions of your Smartsheet user account. They cannot access sheets that have not been shared with you.

---

## Updates

Maintained by [Daniel Daou](mailto:ddaou@eidebailly.com). Pull the latest commits or download the latest zip whenever new features are added.
