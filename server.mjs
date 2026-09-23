import 'dotenv/config'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const { SMARTSHEET_ACCESS_TOKEN } = process.env

function assertConfigured() {
  if (!SMARTSHEET_ACCESS_TOKEN) throw new Error('Missing environment variable: SMARTSHEET_ACCESS_TOKEN')
}

const API_HOST = 'https://api.smartsheet.com/2.0'

async function smartsheetRequest(method, path, body) {
  assertConfigured()
  const response = await fetch(`${API_HOST}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${SMARTSHEET_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) throw new Error(`Smartsheet ${method} ${path} -> ${response.status}: ${(await response.text()).slice(0, 500)}`)
  return response.status === 204 ? null : response.json()
}

async function listSheets() {
  const result = await smartsheetRequest('GET', '/sheets?includeAll=true')
  return (result.data ?? []).map((sheet) => ({ id: sheet.id, name: sheet.name, permalink: sheet.permalink }))
}

// Home tab contents: sheets owned by or shared directly to this token's user, not the whole org.
async function listMySheets() {
  const home = await smartsheetRequest('GET', '/folders/personal')
  const sheets = []
  function walk(folder) {
    for (const sheet of folder.sheets ?? []) sheets.push({ id: sheet.id, name: sheet.name, permalink: sheet.permalink })
    for (const sub of folder.folders ?? []) walk(sub)
  }
  walk(home)
  return sheets
}

async function listFavoriteSheets() {
  const [favorites, allSheets] = await Promise.all([smartsheetRequest('GET', '/favorites?includeAll=true'), listSheets()])
  const sheetsById = new Map(allSheets.map((sheet) => [String(sheet.id), sheet]))
  return (favorites.data ?? [])
    .filter((favorite) => favorite.type === 'sheet')
    .map((favorite) => sheetsById.get(String(favorite.objectId)))
    .filter(Boolean)
}

async function resolveSheetId({ sheetId, sheetName }) {
  if (sheetId) return sheetId
  if (!sheetName) throw new Error('Provide either sheetId or sheetName.')
  const sheets = await listSheets()
  const matches = sheets.filter((sheet) => sheet.name.toLowerCase() === sheetName.toLowerCase())
  if (matches.length === 0) throw new Error(`No sheet named "${sheetName}".`)
  if (matches.length > 1) throw new Error(`Multiple sheets named "${sheetName}". Use sheetId instead: ${matches.map((sheet) => sheet.id).join(', ')}`)
  return matches[0].id
}

async function getSheet(sheetId) {
  return smartsheetRequest('GET', `/sheets/${sheetId}`)
}

async function listWorkspaces() {
  const result = await smartsheetRequest('GET', '/workspaces?includeAll=true')
  return (result.data ?? []).map((workspace) => ({ id: workspace.id, name: workspace.name }))
}

async function resolveWorkspaceId({ workspaceId, workspaceName }) {
  if (workspaceId) return workspaceId
  if (!workspaceName) throw new Error('Provide either workspaceId or workspaceName.')
  const workspaces = await listWorkspaces()
  const matches = workspaces.filter((workspace) => workspace.name.toLowerCase() === workspaceName.toLowerCase())
  if (matches.length === 0) throw new Error(`No workspace named "${workspaceName}".`)
  if (matches.length > 1) throw new Error(`Multiple workspaces named "${workspaceName}". Use workspaceId instead: ${matches.map((workspace) => workspace.id).join(', ')}`)
  return matches[0].id
}

async function createWorkspace(name) {
  const result = await smartsheetRequest('POST', '/workspaces', { name })
  return result.result
}

async function createSheet({ name, columns, workspaceId }) {
  const body = { name, columns }
  const path = workspaceId ? `/workspaces/${workspaceId}/sheets` : '/sheets'
  const result = await smartsheetRequest('POST', path, body)
  return result.result
}

function rowToRecord(row, columnsById) {
  const cells = {}
  for (const cell of row.cells ?? []) {
    const column = columnsById.get(cell.columnId)
    if (column) cells[column.title] = cell.value ?? cell.displayValue ?? null
  }
  return { rowId: row.id, cells }
}

function cellsFromRecord(cellRecord, columnsByTitle) {
  return Object.entries(cellRecord).map(([title, value]) => {
    const column = columnsByTitle.get(title.toLowerCase())
    if (!column) throw new Error(`Unknown column "${title}". Check smartsheet_get_sheet for valid column titles.`)
    const isContactColumn = column.type === 'CONTACT_LIST' || column.title.toLowerCase() === 'owner'
    if (isContactColumn && typeof value === 'string') return { columnId: column.id, objectValue: { email: value } }
    if (isContactColumn && value && typeof value === 'object' && !Array.isArray(value) && 'email' in value) {
      return { columnId: column.id, objectValue: value }
    }
    return { columnId: column.id, value }
  })
}

// Columns Smartsheet wires into a sheet's project/Gantt settings; it rejects type changes on them.
const IMMUTABLE_COLUMN_TAGS = new Set([
  'CALENDAR_END_DATE',
  'CALENDAR_START_DATE',
  'CARD_DONE',
  'GANTT_ALLOCATION',
  'GANTT_ASSIGNED_RESOURCE',
  'GANTT_DISPLAY_LABEL',
  'GANTT_DURATION',
  'GANTT_END_DATE',
  'GANTT_PERCENT_COMPLETE',
  'GANTT_PREDECESSOR',
  'GANTT_START_DATE',
  'BASELINE_START_DATE',
  'BASELINE_END_DATE',
  'BASELINE_VARIANCE',
])

function resolveColumn(sheet, { columnId, columnTitle }) {
  if (columnId) {
    const match = sheet.columns.find((column) => String(column.id) === String(columnId))
    if (!match) throw new Error(`No column with ID ${columnId} on sheet "${sheet.name}".`)
    return match
  }
  if (!columnTitle) throw new Error('Provide either columnTitle or columnId.')
  const matches = sheet.columns.filter((column) => column.title.toLowerCase() === columnTitle.toLowerCase())
  if (matches.length === 0) throw new Error(`No column titled "${columnTitle}" on sheet "${sheet.name}".`)
  if (matches.length > 1) throw new Error(`Multiple columns titled "${columnTitle}". Use columnId instead: ${matches.map((column) => column.id).join(', ')}`)
  return matches[0]
}

function assertColumnEditable(column) {
  if (column.primary) throw new Error(`"${column.title}" is the sheet's primary column. This tool will not change it.`)
  if (column.systemColumnType) throw new Error(`"${column.title}" is a system column (${column.systemColumnType}). This tool will not change it.`)
  const blocked = (column.tags ?? []).filter((tag) => IMMUTABLE_COLUMN_TAGS.has(tag))
  if (blocked.length > 0) throw new Error(`"${column.title}" is part of the sheet's project/Gantt setup (${blocked.join(', ')}). This tool will not change it.`)
}

function columnUpdateBody(column, { newTitle, type, options, index }) {
  const body = {}
  if (newTitle !== undefined) body.title = newTitle
  if (index !== undefined) body.index = index
  if (options !== undefined) {
    // Smartsheet requires type alongside an options change, and only accepts options on a dropdown.
    const effectiveType = type ?? column.type
    if (effectiveType !== 'PICKLIST') throw new Error(`Options only apply to a PICKLIST column. "${column.title}" is ${effectiveType}.`)
    body.type = 'PICKLIST'
    body.options = options
  } else if (type !== undefined) {
    body.type = type
  }
  if (Object.keys(body).length === 0) throw new Error('Nothing to change. Provide newTitle, type, options, or index.')
  return body
}

function discussionsPath(sheetId, rowId) {
  return rowId ? `/sheets/${sheetId}/rows/${rowId}/discussions` : `/sheets/${sheetId}/discussions`
}

function summarizeDiscussion(discussion) {
  return {
    discussionId: discussion.id,
    title: discussion.title ?? null,
    lastCommentedAt: discussion.lastCommentedAt ?? null,
    comments: (discussion.comments ?? []).map((comment) => ({
      commentId: comment.id,
      text: comment.text,
      createdBy: comment.createdBy?.email ?? comment.createdBy?.name ?? null,
      createdAt: comment.createdAt ?? null,
    })),
  }
}

const server = new McpServer({ name: 'smartsheet', version: '0.1.0' })

server.registerTool(
  'smartsheet_list_sheets',
  { description: 'List all Smartsheet sheets available to this token, with their IDs and names. This can include sheets across the whole organization the token can see, not just your own. Prefer smartsheet_list_my_sheets or smartsheet_list_favorite_sheets unless you specifically need the full org-wide list.', inputSchema: {} },
  async () => {
    const sheets = await listSheets()
    return { content: [{ type: 'text', text: JSON.stringify({ count: sheets.length, sheets }, null, 2) }] }
  },
)

server.registerTool(
  'smartsheet_list_my_sheets',
  { description: "List sheets in the current user's own Home tab (owned by them or shared directly to them), the same set shown when they log into Smartsheet. Use this instead of smartsheet_list_sheets to avoid pulling in the whole organization's sheets.", inputSchema: {} },
  async () => {
    const sheets = await listMySheets()
    return { content: [{ type: 'text', text: JSON.stringify({ count: sheets.length, sheets }, null, 2) }] }
  },
)

server.registerTool(
  'smartsheet_list_favorite_sheets',
  { description: "List sheets the current user has starred as favorites in Smartsheet.", inputSchema: {} },
  async () => {
    const sheets = await listFavoriteSheets()
    return { content: [{ type: 'text', text: JSON.stringify({ count: sheets.length, sheets }, null, 2) }] }
  },
)

server.registerTool(
  'smartsheet_get_sheet',
  {
    description: 'Read a sheet\'s columns and rows. Identify the sheet by sheetId or sheetName.',
    inputSchema: {
      sheetId: z.string().optional().describe('Smartsheet sheet ID.'),
      sheetName: z.string().optional().describe('Exact sheet name, used if sheetId is not given.'),
    },
  },
  async ({ sheetId, sheetName }) => {
    const resolvedId = await resolveSheetId({ sheetId, sheetName })
    const sheet = await getSheet(resolvedId)
    const columnsById = new Map(sheet.columns.map((column) => [column.id, column]))
    const rows = sheet.rows.map((row) => rowToRecord(row, columnsById))
    const columns = sheet.columns.map((column) => ({ id: column.id, title: column.title, type: column.type }))
    return {
      content: [{ type: 'text', text: JSON.stringify({ sheetId: sheet.id, name: sheet.name, columns, rowCount: rows.length, rows }, null, 2) }],
    }
  },
)

server.registerTool(
  'smartsheet_add_row',
  {
    description: 'Add a new row to a sheet. Cells are keyed by column title, matching what smartsheet_get_sheet returns.',
    inputSchema: {
      sheetId: z.string().optional().describe('Smartsheet sheet ID.'),
      sheetName: z.string().optional().describe('Exact sheet name, used if sheetId is not given.'),
      cells: z.record(z.any()).describe('Column title -> value for the new row. For CONTACT_LIST columns, use an email string or an object such as {"email":"person@example.com"}.'),
      position: z.enum(['top', 'bottom']).default('bottom').describe('Where to add the row.'),
    },
  },
  async ({ sheetId, sheetName, cells, position }) => {
    const resolvedId = await resolveSheetId({ sheetId, sheetName })
    const sheet = await getSheet(resolvedId)
    const columnsByTitle = new Map(sheet.columns.map((column) => [column.title.toLowerCase(), column]))
    const rowBody = {
      [position === 'top' ? 'toTop' : 'toBottom']: true,
      cells: cellsFromRecord(cells, columnsByTitle),
    }
    const result = await smartsheetRequest('POST', `/sheets/${resolvedId}/rows`, [rowBody])
    return { content: [{ type: 'text', text: JSON.stringify(result.result?.[0] ?? result, null, 2) }] }
  },
)

server.registerTool(
  'smartsheet_update_row',
  {
    description: 'Update cells on an existing row. Cells are keyed by column title, matching what smartsheet_get_sheet returns.',
    inputSchema: {
      sheetId: z.string().optional().describe('Smartsheet sheet ID.'),
      sheetName: z.string().optional().describe('Exact sheet name, used if sheetId is not given.'),
      rowId: z.string().describe('ID of the row to update, from smartsheet_get_sheet.'),
      cells: z.record(z.any()).describe('Column title -> new value. For CONTACT_LIST columns, use an email string or an object such as {"email":"person@example.com"}.'),
    },
  },
  async ({ sheetId, sheetName, rowId, cells }) => {
    const resolvedId = await resolveSheetId({ sheetId, sheetName })
    const sheet = await getSheet(resolvedId)
    const columnsByTitle = new Map(sheet.columns.map((column) => [column.title.toLowerCase(), column]))
    const rowBody = { id: rowId, cells: cellsFromRecord(cells, columnsByTitle) }
    const result = await smartsheetRequest('PUT', `/sheets/${resolvedId}/rows`, [rowBody])
    return { content: [{ type: 'text', text: JSON.stringify(result.result?.[0] ?? result, null, 2) }] }
  },
)

server.registerTool(
  'smartsheet_create_workspace',
  {
    description: 'Create a new, empty Smartsheet workspace to hold sheets. Returns the new workspace ID.',
    inputSchema: {
      name: z.string().describe('Name for the new workspace.'),
    },
  },
  async ({ name }) => {
    const workspace = await createWorkspace(name)
    return { content: [{ type: 'text', text: JSON.stringify(workspace, null, 2) }] }
  },
)

server.registerTool(
  'smartsheet_create_sheet',
  {
    description: 'Create a new sheet from a column definition, optionally inside a workspace. Each column needs a title and a type (e.g. TEXT_NUMBER, DATE, PICKLIST, CHECKBOX, CONTACT_LIST). Exactly one column must be marked primary, and the primary column must be of type TEXT_NUMBER and come first. For a PICKLIST column, include an "options" array of the allowed values.',
    inputSchema: {
      name: z.string().describe('Name for the new sheet.'),
      workspaceId: z.string().optional().describe('Workspace to create the sheet in, if any.'),
      workspaceName: z.string().optional().describe('Exact workspace name, used if workspaceId is not given.'),
      columns: z
        .array(
          z.object({
            title: z.string(),
            type: z.enum(['TEXT_NUMBER', 'DATE', 'PICKLIST', 'CHECKBOX', 'CONTACT_LIST']),
            primary: z.boolean().optional(),
            options: z.array(z.string()).optional().describe('Allowed values, for PICKLIST columns.'),
          }),
        )
        .describe('Column definitions, in left-to-right order. The primary column must come first.'),
    },
  },
  async ({ name, workspaceId, workspaceName, columns }) => {
    const resolvedWorkspaceId = workspaceId || workspaceName ? await resolveWorkspaceId({ workspaceId, workspaceName }) : undefined
    const sheet = await createSheet({ name, columns, workspaceId: resolvedWorkspaceId })
    return { content: [{ type: 'text', text: JSON.stringify(sheet, null, 2) }] }
  },
)

server.registerTool(
  'smartsheet_list_discussions',
  {
    description: "Read the comment threads (discussions) on a sheet, or on one row of it. Give rowId to read a single row's conversation, omit it to read the whole sheet's. Returns each thread with its comments.",
    inputSchema: {
      sheetId: z.string().optional().describe('Smartsheet sheet ID.'),
      sheetName: z.string().optional().describe('Exact sheet name, used if sheetId is not given.'),
      rowId: z.string().optional().describe("Row ID from smartsheet_get_sheet. Omit to read the whole sheet's discussions."),
    },
  },
  async ({ sheetId, sheetName, rowId }) => {
    const resolvedId = await resolveSheetId({ sheetId, sheetName })
    const result = await smartsheetRequest('GET', `${discussionsPath(resolvedId, rowId)}?include=comments&includeAll=true`)
    const discussions = (result.data ?? []).map(summarizeDiscussion)
    return { content: [{ type: 'text', text: JSON.stringify({ sheetId: resolvedId, rowId: rowId ?? null, count: discussions.length, discussions }, null, 2) }] }
  },
)

server.registerTool(
  'smartsheet_add_comment',
  {
    description: "Post a comment on a sheet, or on one row of it. This starts a new comment thread (Smartsheet calls it a discussion); it does not reply to an existing thread. On a row, the comment appears in that row's conversation pane in Smartsheet.",
    inputSchema: {
      sheetId: z.string().optional().describe('Smartsheet sheet ID.'),
      sheetName: z.string().optional().describe('Exact sheet name, used if sheetId is not given.'),
      rowId: z.string().optional().describe('Row ID from smartsheet_get_sheet. Omit to comment on the sheet as a whole.'),
      text: z.string().describe('The comment text.'),
    },
  },
  async ({ sheetId, sheetName, rowId, text }) => {
    const resolvedId = await resolveSheetId({ sheetId, sheetName })
    const result = await smartsheetRequest('POST', discussionsPath(resolvedId, rowId), { comment: { text } })
    return { content: [{ type: 'text', text: JSON.stringify(summarizeDiscussion(result.result ?? {}), null, 2) }] }
  },
)

server.registerTool(
  'smartsheet_add_column',
  {
    description: 'Add a new column to an existing sheet. Appends to the right unless index is given. For a PICKLIST column, include an "options" array of the allowed values.',
    inputSchema: {
      sheetId: z.string().optional().describe('Smartsheet sheet ID.'),
      sheetName: z.string().optional().describe('Exact sheet name, used if sheetId is not given.'),
      title: z.string().describe('Title for the new column.'),
      type: z.enum(['TEXT_NUMBER', 'DATE', 'PICKLIST', 'CHECKBOX', 'CONTACT_LIST']).describe('Column type.'),
      options: z.array(z.string()).optional().describe('Allowed values, for PICKLIST columns.'),
      index: z.number().int().min(0).optional().describe('Zero-based position. Omit to append to the right of the existing columns.'),
    },
  },
  async ({ sheetId, sheetName, title, type, options, index }) => {
    const resolvedId = await resolveSheetId({ sheetId, sheetName })
    const sheet = await getSheet(resolvedId)
    if (sheet.columns.some((column) => column.title.toLowerCase() === title.toLowerCase())) {
      throw new Error(`Sheet "${sheet.name}" already has a column titled "${title}".`)
    }
    if (options !== undefined && type !== 'PICKLIST') throw new Error('Options only apply to a PICKLIST column.')
    const body = { title, type, index: index ?? sheet.columns.length }
    if (options !== undefined) body.options = options
    const result = await smartsheetRequest('POST', `/sheets/${resolvedId}/columns`, [body])
    return { content: [{ type: 'text', text: JSON.stringify(result.result?.[0] ?? result, null, 2) }] }
  },
)

server.registerTool(
  'smartsheet_update_column',
  {
    description: 'Rename, retype, reorder, or change the dropdown options of an existing column. Identify the column by its exact title or by columnId. Refuses to touch the primary column, system columns, and project/Gantt columns. Changing a column type converts every cell in it and clears its validation, so confirm with the user first.',
    inputSchema: {
      sheetId: z.string().optional().describe('Smartsheet sheet ID.'),
      sheetName: z.string().optional().describe('Exact sheet name, used if sheetId is not given.'),
      columnTitle: z.string().optional().describe('Exact current title of the column to change.'),
      columnId: z.string().optional().describe('Column ID, used instead of columnTitle when the title is ambiguous.'),
      newTitle: z.string().optional().describe('New title for the column.'),
      type: z.enum(['TEXT_NUMBER', 'DATE', 'PICKLIST', 'CHECKBOX', 'CONTACT_LIST']).optional().describe('New column type. Converts existing cell values.'),
      options: z.array(z.string()).optional().describe('Replacement list of allowed values, for PICKLIST columns.'),
      index: z.number().int().min(0).optional().describe('Zero-based position to move the column to.'),
    },
  },
  async ({ sheetId, sheetName, columnTitle, columnId, newTitle, type, options, index }) => {
    const resolvedId = await resolveSheetId({ sheetId, sheetName })
    const sheet = await getSheet(resolvedId)
    const column = resolveColumn(sheet, { columnId, columnTitle })
    assertColumnEditable(column)
    const body = columnUpdateBody(column, { newTitle, type, options, index })
    const result = await smartsheetRequest('PUT', `/sheets/${resolvedId}/columns/${column.id}`, body)
    return { content: [{ type: 'text', text: JSON.stringify(result.result ?? result, null, 2) }] }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
