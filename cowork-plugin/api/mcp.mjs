// Remote MCP server for the Cowork "Smartsheet Tools" connector, deployed as a
// Vercel serverless function. Cowork calls this over HTTPS with JSON-RPC 2.0
// messages (tools/list, tools/call). Each request carries the signed-in user's
// own Smartsheet access token as a Bearer header (from the OAuth login Cowork
// manages) -- this server never stores a token itself.
import { readFileSync } from 'node:fs'
import { createSmartsheetClient } from '../lib/smartsheet-client.mjs'

const TOOLS = JSON.parse(readFileSync(new URL('../tools/smartsheet-tools.json', import.meta.url)))

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result }
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function toolResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function toolError(message) {
  return { content: [{ type: 'text', text: message }], isError: true }
}

async function callTool(name, args, accessToken) {
  const client = createSmartsheetClient(accessToken)
  switch (name) {
    case 'smartsheet_list_sheets': {
      const sheets = await client.listSheets()
      return toolResult({ count: sheets.length, sheets })
    }
    case 'smartsheet_list_my_sheets': {
      const sheets = await client.listMySheets()
      return toolResult({ count: sheets.length, sheets })
    }
    case 'smartsheet_list_favorite_sheets': {
      const sheets = await client.listFavoriteSheets()
      return toolResult({ count: sheets.length, sheets })
    }
    case 'smartsheet_get_sheet':
      return toolResult(await client.getSheetFormatted(args))
    case 'smartsheet_add_row':
      return toolResult(await client.addRow(args))
    case 'smartsheet_update_row':
      return toolResult(await client.updateRow(args))
    case 'smartsheet_create_workspace':
      return toolResult(await client.createWorkspace(args.name))
    case 'smartsheet_create_sheet': {
      const workspaceId = args.workspaceId || args.workspaceName ? await client.resolveWorkspaceId(args) : undefined
      return toolResult(await client.createSheet({ name: args.name, columns: args.columns, workspaceId }))
    }
    case 'smartsheet_list_discussions':
      return toolResult(await client.listDiscussions(args))
    case 'smartsheet_add_comment':
      return toolResult(await client.addComment(args))
    case 'smartsheet_add_column':
      return toolResult(await client.addColumn(args))
    case 'smartsheet_update_column':
      return toolResult(await client.updateColumn(args))
    default:
      throw new Error(`Unknown tool "${name}".`)
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'This endpoint only accepts POST JSON-RPC requests.' })
    return
  }

  const message = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  const { id, method, params } = message ?? {}

  try {
    if (method === 'initialize') {
      res.status(200).json(
        jsonRpcResult(id, {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'smartsheet-cowork', version: '0.1.0' },
        }),
      )
      return
    }

    if (method === 'notifications/initialized') {
      res.status(202).end()
      return
    }

    if (method === 'tools/list') {
      res.status(200).json(jsonRpcResult(id, { tools: TOOLS }))
      return
    }

    if (method === 'tools/call') {
      const authHeader = req.headers.authorization ?? ''
      const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
      if (!accessToken) {
        res.status(200).json(jsonRpcResult(id, toolError('No Smartsheet login found on this request. Sign in to the Smartsheet connector and try again.')))
        return
      }
      try {
        const result = await callTool(params.name, params.arguments ?? {}, accessToken)
        res.status(200).json(jsonRpcResult(id, result))
      } catch (error) {
        res.status(200).json(jsonRpcResult(id, toolError(error.message)))
      }
      return
    }

    res.status(200).json(jsonRpcError(id, -32601, `Method not found: ${method}`))
  } catch (error) {
    res.status(200).json(jsonRpcError(id, -32000, error.message))
  }
}
