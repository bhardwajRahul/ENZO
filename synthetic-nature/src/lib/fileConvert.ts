// ENZO — fileConvert.ts
// In-chat file conversion & table extraction. Everything here runs in the
// browser: attached files are parsed client-side (pdfjs-dist text layer,
// exceljs sheets, native CSV) and never leave the device — only the agent's
// reasoning step uses the user's own key, exactly like normal chat.
//
// The pipeline is two primitives: extract-to-rows/text (pdf → x-aligned
// column heuristic, xlsx → sheets, csv/tsv → RFC4180, json → object rows)
// and serialize-to-target (csv / xlsx / json / md / txt). The agent does the
// interpretation; this module does the parsing, serialization and the
// download blobs.

import type * as ExcelTypes from 'exceljs'

// ── detection ────────────────────────────────────────────────────────────────

export type ConvertKind =
  | 'pdf'
  | 'xlsx'
  | 'csv'
  | 'tsv'
  | 'json'
  | 'md'
  | 'text'
  | 'image'
  | 'unknown'

export interface ParsedTable {
  page?: number // pdf page, 1-based
  sheet?: string // xlsx sheet name
  header: string[]
  rows: string[][]
}

export interface ParsedAttachment {
  kind: ConvertKind
  tables: ParsedTable[]
  text: string // extracted text (pdf) or file content (text-ish kinds)
  noTextLayer: boolean // pdf whose pages yielded no text (scanned image pdf)
  sheetNames: string[]
  charCount: number
}

const EXT_KINDS: Record<string, ConvertKind> = {
  pdf: 'pdf',
  xlsx: 'xlsx',
  xlsm: 'xlsx',
  xlsb: 'xlsx',
  xls: 'xlsx',
  csv: 'csv',
  tsv: 'tsv',
  tab: 'tsv',
  json: 'json',
  jsonl: 'json',
  ndjson: 'json',
  md: 'md',
  markdown: 'md',
  txt: 'text',
  text: 'text',
  log: 'text',
}

export function detectConvertKind(name: string, mime = ''): ConvertKind {
  const ext = name.includes('.') ? (name.split('.').pop() || '').toLowerCase() : ''
  if (ext && EXT_KINDS[ext]) return EXT_KINDS[ext]
  if (mime.startsWith('image/')) return 'image'
  const m = mime.split(';')[0].trim().toLowerCase()
  if (m === 'application/pdf') return 'pdf'
  if (m === 'text/csv') return 'csv'
  if (m === 'text/tab-separated-values') return 'tsv'
  if (m === 'application/json') return 'json'
  if (m === 'text/markdown') return 'md'
  if (m.startsWith('text/')) return 'text'
  return 'unknown'
}

// ── delimited text (csv / tsv) — RFC4180: quoted fields, escaped quotes,
// embedded delimiters and newlines ────────────────────────────────────────────

export function parseDelimited(text: string, delim: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text // strip BOM
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === delim) {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\r') {
      if (src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += ch
    i++
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  // Sheet editors end files with newlines — drop fully-empty trailing rows.
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop()
  return rows.map((r) => r.map((c) => c.trim()))
}

export function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? ''
  const tabs = (first.match(/\t/g) || []).length
  const commas = (first.match(/,/g) || []).length
  return parseDelimited(text, tabs > commas ? '\t' : ',')
}

// ── serializers ──────────────────────────────────────────────────────────────

function csvEscape(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export function rowsToCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\n')
}

export function rowsToMarkdown(rows: string[][]): string {
  if (rows.length === 0) return ''
  const width = Math.max(...rows.map((r) => r.length))
  const pad = (r: string[]) => {
    const c = r.slice()
    while (c.length < width) c.push('')
    return c
  }
  const esc = (v: string) => v.replace(/\|/g, '\\|')
  const [head, ...body] = rows
  const h = pad(head).map(esc)
  return [
    `| ${h.join(' | ')} |`,
    `| ${h.map(() => '---').join(' | ')} |`,
    ...(body.length > 0 ? body : [['']]).map((r) => `| ${pad(r).map(esc).join(' | ')} |`),
  ].join('\n')
}

const NUMERIC = /^-?\d{1,15}(\.\d+)?$/
const cellValue = (v: string): string | number => (v !== '' && NUMERIC.test(v) ? Number(v) : v)

export function rowsToJson(rows: string[][]): string {
  if (rows.length === 0) return '[]'
  const [head, ...body] = rows
  const keys = head.map((h, i) => (h.trim() === '' ? `col_${i + 1}` : h.trim()))
  const objs = body.map((r) => {
    const o: Record<string, string | number> = {}
    keys.forEach((k, i) => {
      o[k] = cellValue(r[i] ?? '')
    })
    return o
  })
  return JSON.stringify(objs, null, 2)
}

export function jsonToRows(json: string): string[][] | null {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return null
  }
  const toStr = (v: unknown): string => {
    if (v == null) return ''
    if (typeof v === 'object') return JSON.stringify(v)
    return String(v)
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return null
    if (data.every((r) => Array.isArray(r))) return (data as unknown[][]).map((r) => r.map(toStr))
    if (data.every((r) => typeof r === 'object' && r !== null && !Array.isArray(r))) {
      const objs = data as Record<string, unknown>[]
      const keys: string[] = []
      for (const o of objs) for (const k of Object.keys(o)) if (!keys.includes(k)) keys.push(k)
      return [keys, ...objs.map((o) => keys.map((k) => toStr(o[k])))]
    }
    return null // array of scalars — not tabular
  }
  if (typeof data === 'object' && data !== null) {
    const o = data as Record<string, unknown>
    const vals = Object.values(o)
    if (vals.length > 0 && vals.every((v) => Array.isArray(v))) {
      // object of parallel columns
      const cols = vals as unknown[][]
      const width = Math.max(...cols.map((c) => c.length))
      const rows: string[][] = [Object.keys(o)]
      for (let r = 0; r < width; r++) rows.push(cols.map((c) => toStr(c[r] ?? '')))
      return rows
    }
    if (vals.every((v) => typeof v !== 'object' || v === null)) {
      return [Object.keys(o), Object.values(o).map(toStr)]
    }
  }
  return null
}

// ── pdf — pdfjs-dist text layer; tables via x-aligned column heuristic ───────

interface PdfItem {
  str: string
  x: number
  endX: number
  y: number
  h: number
}

let workerPort: Worker | null = null

// The worker ships as an ESM asset; Vite's ?worker suffix emits it as its own
// chunk and hands back a constructor. Skipped outside the browser (node
// self-checks use pdfjs' fake-worker path instead).
async function ensurePdfWorker(): Promise<void> {
  if (workerPort || typeof Worker === 'undefined') return
  const Ctor = (await import('pdfjs-dist/build/pdf.worker.min.mjs?worker')).default
  const pdfjs = await import('pdfjs-dist')
  const port = new Ctor()
  pdfjs.GlobalWorkerOptions.workerPort = port
  workerPort = port
}

// Group text items into visual lines by baseline y (tolerance scales with the
// item's own height), left-to-right within a line. PDF y grows upward, so
// descending y = the page's reading order (top line first).
function pdfLines(items: PdfItem[]): PdfItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: PdfItem[][] = []
  let cur: PdfItem[] = []
  for (const it of sorted) {
    const tol = Math.max(2, it.h * 0.5)
    if (cur.length === 0 || Math.abs(it.y - cur[0].y) <= tol) {
      cur.push(it)
    } else {
      cur.sort((a, b) => a.x - b.x)
      lines.push(cur)
      cur = [it]
    }
  }
  if (cur.length > 0) {
    cur.sort((a, b) => a.x - b.x)
    lines.push(cur)
  }
  return lines
}

// Split one visual line into table cells: a new cell starts where the gap
// between items is wider than the line's median glyph run (words inside a
// cell sit close together; column gaps don't).
function splitCells(line: PdfItem[]): string[] {
  if (line.length === 1) return [line[0].str.trim()].filter((c) => c !== '')
  const widths = line
    .map((it) => it.endX - it.x)
    .filter((w) => w > 0)
    .sort((a, b) => a - b)
  const median = widths.length > 0 ? widths[Math.floor(widths.length / 2)] : 0
  const gapThreshold = Math.max(4, median * 1.2)
  const cells: string[] = []
  let buf = line[0].str
  for (let i = 1; i < line.length; i++) {
    const gap = line[i].x - line[i - 1].endX
    if (gap > gapThreshold) {
      cells.push(buf.trim())
      buf = line[i].str
    } else {
      buf += (buf.endsWith(' ') || line[i].str.startsWith(' ') ? '' : ' ') + line[i].str
    }
  }
  cells.push(buf.trim())
  return cells.filter((c) => c !== '')
}

// Runs of lines with >= 3 aligned cells read as tables; the 3-column floor
// keeps a research paper's two-column body text from reading as a table (the
// full text still goes to the agent, so a 2-column table isn't lost — it
// arrives as text and the agent can lay it out on request).
function pageTables(lines: PdfItem[][], page: number): ParsedTable[] {
  const tables: ParsedTable[] = []
  let run: string[][] = []
  const flush = () => {
    if (run.length >= 2) {
      const counts = run.map((r) => r.length).sort((a, b) => a - b)
      const modal = counts[Math.floor(counts.length / 2)]
      const lens = run.flat().map((c) => c.length).sort((a, b) => a - b)
      const medianLen = lens[Math.floor(lens.length / 2)]
      if (modal >= 3 && medianLen <= 80) {
        tables.push({ page, header: run[0], rows: run.slice(1) })
      }
    }
    run = []
  }
  for (const line of lines) {
    if (line.length === 0) continue
    const cells = splitCells(line)
    if (cells.length >= 3) run.push(cells)
    else flush()
  }
  flush()
  return tables
}

export async function parsePdfTables(data: ArrayBuffer): Promise<ParsedAttachment> {
  await ensurePdfWorker()
  const pdfjs = await import('pdfjs-dist')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise
  const tables: ParsedTable[] = []
  let text = ''
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const tc = await page.getTextContent()
    const items: PdfItem[] = []
    for (const it of tc.items) {
      if (!('str' in it) || it.str.trim() === '') continue
      const tr = it.transform as number[]
      items.push({
        str: it.str,
        x: tr[4],
        endX: tr[4] + (it.width || 0),
        y: tr[5],
        h: Math.abs(tr[3]) || (it.height as number) || 10,
      })
    }
    tables.push(...pageTables(pdfLines(items), p))
    text += items.map((it) => it.str).join(' ') + '\n'
    page.cleanup()
  }
  doc.destroy()
  const trimmed = text.trim()
  return {
    kind: 'pdf',
    tables,
    text: trimmed,
    noTextLayer: trimmed.length < 20,
    sheetNames: [],
    charCount: trimmed.length,
  }
}

// ── xlsx — exceljs (Vite resolves its browser-field bundle) ──────────────────

type XlsxCell = string | number | boolean | Date | { text?: unknown; result?: unknown } | null | undefined

const normCell = (v: XlsxCell): string => {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    if (typeof v.text === 'string') return v.text // rich text
    if ('result' in v) return normCell((v.result ?? '') as XlsxCell) // formula cell
    return JSON.stringify(v)
  }
  return String(v)
}

export async function parseXlsxSheets(data: ArrayBuffer): Promise<ParsedAttachment> {
  const mod = await import('exceljs')
  // exceljs is CJS: node's import() puts module.exports on `default`, Vite's
  // esbuild interop provides it too — fall back to the namespace for runtimes
  // without a default.
  const Excel = ((mod as { default?: unknown }).default ?? mod) as typeof mod
  const wb = new Excel.Workbook()
  await wb.xlsx.load(data as ExcelTypes.Buffer)
  const tables: ParsedTable[] = []
  const sheetNames: string[] = []
  wb.eachSheet((ws) => {
    sheetNames.push(ws.name)
    const raw = ws.getSheetValues() as XlsxCell[][] // 1-indexed, sparse
    const grid: string[][] = []
    for (let r = 1; r < raw.length; r++) {
      const row = raw[r] ?? []
      const cells: string[] = []
      for (let c = 1; c < row.length; c++) cells.push(normCell(row[c]))
      if (cells.some((v) => v !== '')) grid.push(cells.map((v) => v.trim()))
    }
    while (grid.length > 0 && grid[grid.length - 1].every((c) => c === '')) grid.pop()
    if (grid.length > 0) tables.push({ sheet: ws.name, header: grid[0], rows: grid.slice(1) })
  })
  return { kind: 'xlsx', tables, text: '', noTextLayer: false, sheetNames, charCount: 0 }
}

// ── dispatch + conversion matrix ─────────────────────────────────────────────

export async function parseAttachment(file: File): Promise<ParsedAttachment> {
  const kind = detectConvertKind(file.name, file.type)
  if (kind === 'pdf') return parsePdfTables(await file.arrayBuffer())
  if (kind === 'xlsx') return parseXlsxSheets(await file.arrayBuffer())
  if (kind === 'csv' || kind === 'tsv') {
    const text = await file.text()
    const rows = parseCsv(text)
    const [header = [''], ...body] = rows
    return { kind, tables: [{ header, rows: body }], text, noTextLayer: false, sheetNames: [], charCount: text.length }
  }
  if (kind === 'json') {
    const text = await file.text()
    const rows = jsonToRows(text)
    if (rows) {
      const [header = [''], ...body] = rows
      return { kind, tables: [{ header, rows: body }], text, noTextLayer: false, sheetNames: [], charCount: text.length }
    }
    return { kind, tables: [], text, noTextLayer: false, sheetNames: [], charCount: text.length }
  }
  // md / text / image / unknown — text passthrough (the old readAsText path)
  const text = await file.text()
  return { kind, tables: [], text, noTextLayer: false, sheetNames: [], charCount: text.length }
}

export type ConvertTarget = 'csv' | 'xlsx' | 'json' | 'md' | 'txt'

const TARGET_MIME: Record<ConvertTarget, string> = {
  csv: 'text/csv;charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json;charset=utf-8',
  md: 'text/markdown;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
}

export async function rowsToExcel(rows: string[][], sheetName = 'Sheet1'): Promise<Blob> {
  const mod = await import('exceljs')
  const Excel = ((mod as { default?: unknown }).default ?? mod) as typeof mod
  const wb = new Excel.Workbook()
  const ws = wb.addWorksheet(sheetName.replace(/[[\]:*?/\\]/g, '_') || 'Sheet1')
  rows.forEach((r) => ws.addRow(r))
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: TARGET_MIME.xlsx })
}

// Every detected table under one grid — the "extract every table and merge
// into one CSV" path. Tables whose header matches the first one (case/space
// insensitive) contribute data rows only; different headers are kept as rows
// so nothing silently disappears.
export function mergeTables(tables: ParsedTable[]): { header: string[]; rows: string[][] } {
  const [first, ...rest] = tables
  if (!first) return { header: [], rows: [] }
  const base = (h: string) => h.replace(/\s+/g, ' ').trim().toLowerCase()
  const rows = [...first.rows]
  for (const t of rest) {
    const sameHeader =
      t.header.length === first.header.length && t.header.every((h, i) => base(h) === base(first.header[i]))
    if (!sameHeader) rows.push(t.header)
    rows.push(...t.rows)
  }
  return { header: first.header, rows }
}

export interface ConversionResult {
  blob: Blob
  filename: string
  mime: string
}

export async function convertAttachment(file: File, target: ConvertTarget): Promise<ConversionResult> {
  const parsed = await parseAttachment(file)
  const base = file.name.replace(/\.[^.]+$/, '') || 'file'
  const grid = parsed.tables.length > 0 ? mergeTablesGrid(parsed) : null
  let filename = `${base}.${target === 'xlsx' ? 'xlsx' : target}`
  let payload: string | Blob
  if (grid) {
    if (target === 'xlsx') payload = await rowsToExcel(grid, base.slice(0, 30) || 'Sheet1')
    else if (target === 'csv') payload = rowsToCsv(grid)
    else if (target === 'json') payload = rowsToJson(grid)
    else if (target === 'md') payload = rowsToMarkdown(grid)
    else payload = grid.map((r) => r.join('\t')).join('\n')
  } else if (target === 'md' || target === 'txt') {
    payload = parsed.text
  } else if (target === 'json') {
    payload = JSON.stringify({ text: parsed.text }, null, 2)
  } else {
    // text-only source → sheet target: single-column grid, honest about what
    // extraction could get (scanned pdfs have no text layer to convert).
    const single = [['text'], [parsed.text]]
    payload = target === 'xlsx' ? await rowsToExcel(single) : rowsToCsv(single)
    filename = `${base}.${target}`
  }
  const blob = payload instanceof Blob ? payload : new Blob([payload], { type: TARGET_MIME[target] })
  return { blob, filename, mime: TARGET_MIME[target] }
}

function mergeTablesGrid(parsed: ParsedAttachment): string[][] {
  const { header, rows } = mergeTables(parsed.tables)
  return [header, ...rows]
}

// ── reply tables — markdown table blocks in an agent reply become
// downloadable CSV/Excel on the message ───────────────────────────────────────

function splitMdRow(line: string): string[] {
  let inner = line.trim()
  if (inner.startsWith('|')) inner = inner.slice(1)
  if (inner.endsWith('|')) inner = inner.slice(0, -1)
  const cells: string[] = []
  let buf = ''
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (ch === '\\' && inner[i + 1] === '|') {
      buf += '|'
      i++
      continue
    }
    if (ch === '|') {
      cells.push(buf.trim())
      buf = ''
      continue
    }
    buf += ch
  }
  cells.push(buf.trim())
  return cells
}

export function extractReplyTables(text: string): ParsedTable[] {
  const lines = text.split(/\r?\n/)
  const tables: ParsedTable[] = []
  let i = 0
  while (i < lines.length) {
    const isRow = /^\s*\|.*\|\s*$/.test(lines[i])
    const next = lines[i + 1] ?? ''
    const isSep = isRow && next.includes('-') && /^\s*\|?[\s:|-]+\|?\s*$/.test(next)
    if (isRow && isSep) {
      const header = splitMdRow(lines[i])
      i += 2
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(splitMdRow(lines[i]))
        i++
      }
      if (header.some((h) => h !== '')) {
        tables.push({ header, rows: rows.filter((r) => r.some((c) => c !== '')) })
      }
      continue
    }
    i++
  }
  return tables
}

// ── downloads ────────────────────────────────────────────────────────────────

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function downloadCsv(rows: string[][], filename: string): void {
  const name = filename.endsWith('.csv') ? filename : `${filename}.csv`
  downloadBlob(new Blob([rowsToCsv(rows)], { type: TARGET_MIME.csv }), name)
}

export async function downloadExcel(rows: string[][], filename: string): Promise<void> {
  const blob = await rowsToExcel(rows)
  const name = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  downloadBlob(blob, name)
}

// ── self-check — round-trips over the pure paths (xlsx works in-process;
// pdf needs the browser worker, verified on the running app instead).
// Run under tsx from the repo root or in the browser console. ─────────────────

export async function selfCheck(): Promise<string[]> {
  const failures: string[] = []
  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const grid = [
    ['name', 'score', 'note'],
    ['alpha', '91', 'quoted, field'],
    ['beta', '84', 'say "hi"'],
  ]

  if (!eq(parseCsv(rowsToCsv(grid)), grid)) failures.push('csv round trip')
  if (!eq(parseDelimited('a\tb\tc\n1\t2\t3', '\t'), [['a', 'b', 'c'], ['1', '2', '3']])) failures.push('tsv parse')
  if (!eq(extractReplyTables(rowsToMarkdown(grid))[0]?.rows, grid.slice(1))) failures.push('markdown round trip')
  const jsonBack = jsonToRows(rowsToJson(grid))
  if (!jsonBack || !eq(jsonBack[0], grid[0])) failures.push('json header round trip')
  if (detectConvertKind('paper.PDF') !== 'pdf' || detectConvertKind('sheet.XLSX') !== 'xlsx') {
    failures.push('kind detection')
  }

  try {
    const blob = await rowsToExcel(grid)
    const parsed = await parseXlsxSheets(await blob.arrayBuffer())
    const got = parsed.tables[0]
    if (!got || !eq(got.header, grid[0]) || !eq(got.rows, grid.slice(1))) failures.push('xlsx round trip')
  } catch (e) {
    failures.push(`xlsx round trip threw: ${e instanceof Error ? e.message : String(e)}`)
  }

  return failures
}
