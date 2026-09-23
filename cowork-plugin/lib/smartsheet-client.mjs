// Same Smartsheet REST calls as ../../server.mjs, but parameterized by an OAuth
// access token instead of a shared .env secret, since each Cowork user signs in
// with their own Smartsheet account.

const API_HOST = 'https://api.smartsheet.com/2.0'

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

export function createSmartsheetClient(accessToken) {
  if (!accessToken) throw new Error('Missing Smartsheet access token.')

  async function request(method, path, body) {
    const response = await fetch(`${API_HOST}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) throw new Error(`Smartsheet ${method} ${path} -> ${response.status}: ${(await response.text()).slice(0, 500)}`)
    return response.status === 204 ? null : response.json()
  }

  async function listSheets() {
    const result = await request('GET', '/sheets?includeAll=true')
    return (result.data ?? []).map((sheet) => ({ id: sheet.id, name: sheet.name, permalink: sheet.permalink }))
  }

  async function listMySheets() {
    const home = await request('GET', '/folders/personal')
    const sheets = []
    function walk(folder) {
      for (const sheet of folder.sheets ?? []) sheets.push({ id: sheet.id, name: sheet.name, permalink: sheet.permalink })
      for (const sub of folder.folders ?? []) walk(sub)
    }
    walk(home)
    return sheets
  }

  async function listFavoriteSheets() {
    const [favorites, allSheets] = await Promise.all([request('GET', '/favorites?includeAll=true'), listSheets()])
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
    return request('GET', `/sheets/${sheetId}`)
  }

  async function listWorkspaces() {
    const result = await request('GET', '/workspaces?includeAll=true')
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
    const result = await request('POST', '/workspaces', { name })
    return result.result
  }

  async function createSheet({ name, columns, workspaceId }) {
    const body = { name, columns }
    const path = workspaceId ? `/workspaces/${workspaceId}/sheets` : '/sheets'
    const result = await request('POST', path, body)
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

  async function addRow({ sheetId, sheetName, cells, position }) {
    const resolvedId = await resolveSheetId({ sheetId, sheetName })
    const sheet = await getSheet(resolvedId)
    const columnsByTitle = new Map(sheet.columns.map((column) => [column.title.toLowerCase(), column]))
    const rowBody = {
      [position === 'top' ? 'toTop' : 'toBottom']: true,
      cells: cellsFromRecord(cells, columnsByTitle),
    }
    const result = await request('POST', `/sheets/${resolvedId}/rows`, [rowBody])
    return result.result?.[0] ?? result
  }

  async function updateRow({ sheetId, sheetName, rowId, cells }) {
    const resolvedId = await resolveSheetId({ sheetId, sheetName })
    const sheet = await getSheet(resolvedId)
    const columnsByTitle = new Map(sheet.columns.map((column) => [column.title.toLowerCase(), column]))
    const rowBody = { id: rowId, cells: cellsFromRecord(cells, columnsByTitle) }
    const result = await request('PUT', `/sheets/${resolvedId}/rows`, [rowBody])
    return result.result?.[0] ?? result
  }

  async function getSheetFormatted({ sheetId, sheetName }) {
    const resolvedId = await resolveSheetId({ sheetId, sheetName })
    const sheet = await getSheet(resolvedId)
    const columnsById = new Map(sheet.columns.map((column) => [column.id, column]))
    const rows = sheet.rows.map((row) => rowToRecord(row, columnsById))
    const columns = sheet.columns.map((column) => ({ id: column.id, title: column.title, type: column.type }))
    return { sheetId: sheet.id, name: sheet.name, columns, rowCount: rows.length, rows }
  }

  function discussionsPath(sheetId, rowId) {
    return rowId ? `/sheets/${sheetId}/rows/${rowId}/discussions` : `/sheets/${sheetId}/discussions`
  }

  async function listDiscussions({ sheetId, sheetName, rowId }) {
    const resolvedId = await resolveSheetId({ sheetId, sheetName })
    const result = await request('GET', `${discussionsPath(resolvedId, rowId)}?include=comments&includeAll=true`)
    const discussions = (result.data ?? []).map(summarizeDiscussion)
    return { sheetId: resolvedId, rowId: rowId ?? null, count: discussions.length, discussions }
  }

  async function addComment({ sheetId, sheetName, rowId, text }) {
    const resolvedId = await resolveSheetId({ sheetId, sheetName })
    const result = await request('POST', discussionsPath(resolvedId, rowId), { comment: { text } })
    return summarizeDiscussion(result.result ?? {})
  }

  async function addColumn({ sheetId, sheetName, title, type, options, index }) {
    const resolvedId = await resolveSheetId({ sheetId, sheetName })
    const sheet = await getSheet(resolvedId)
    if (sheet.columns.some((column) => column.title.toLowerCase() === title.toLowerCase())) {
      throw new Error(`Sheet "${sheet.name}" already has a column titled "${title}".`)
    }
    if (options !== undefined && type !== 'PICKLIST') throw new Error('Options only apply to a PICKLIST column.')
    const body = { title, type, index: index ?? sheet.columns.length }
    if (options !== undefined) body.options = options
    const result = await request('POST', `/sheets/${resolvedId}/columns`, [body])
    return result.result?.[0] ?? result
  }

  async function updateColumn({ sheetId, sheetName, columnTitle, columnId, newTitle, type, options, index }) {
    const resolvedId = await resolveSheetId({ sheetId, sheetName })
    const sheet = await getSheet(resolvedId)
    const column = resolveColumn(sheet, { columnId, columnTitle })
    assertColumnEditable(column)
    const body = columnUpdateBody(column, { newTitle, type, options, index })
    const result = await request('PUT', `/sheets/${resolvedId}/columns/${column.id}`, body)
    return result.result ?? result
  }

  return {
    listSheets,
    listMySheets,
    listFavoriteSheets,
    getSheetFormatted,
    addRow,
    updateRow,
    createWorkspace,
    createSheet,
    resolveWorkspaceId,
    listDiscussions,
    addComment,
    addColumn,
    updateColumn,
  }
}
