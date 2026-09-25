/**
 * codeExtract.ts — pure parsers over coding-mode replies.
 *
 * extractPreviewHtml pulls a previewable HTML document out of an assistant
 * reply, extractProjectFiles splits a ```file: fenced multi-file project, and
 * codingReplyIncompleteReason is the frontend twin of the server's build check
 * that drives the browser auto-continue safety net. No React, no network —
 * everything here is testable in isolation.
 */

/**
 * Pull a live-previewable HTML document out of an assistant reply.
 * Accepts a ```html fence (the common coding-mode shape) or a bare document,
 * but only when it actually looks like a real page — small inline snippets and
 * non-HTML code blocks are ignored so we never open a preview for e.g. a
 * python script.
 */
export function extractPreviewHtml(text: string): string | null {
  if (!text || typeof text !== 'string') return null
  const fence = text.match(/```(?:html|HTML)\s*\n([\s\S]*?)```/)
  const body = (fence ? fence[1] : text).trim()
  if (!body) return null

  const lower = body.toLowerCase()
  const isDocument =
    lower.includes('<!doctype html') ||
    lower.includes('<html') ||
    lower.includes('<body') ||
    lower.includes('</body>') ||
    lower.includes('</html>') ||
    (lower.includes('</') && (lower.includes('<style') || lower.includes('<script') || lower.includes('<header') || lower.includes('<nav') || lower.includes('<main') || lower.includes('<section')))
  if (!isDocument) return null
  if (body.length < 120 && !lower.includes('<!doctype') && !lower.includes('<html')) return null

  return body
}

/**
 * Extract a multi-file project from a coding reply. The model emits one fence
 * per file using the path as its label:
 *   ```file:index.html ... ```
 *   ```file:css/styles.css ... ```
 *   ```file:js/app.js ... ```
 * Returns { "path": content } or null when no ```file: blocks are present.
 *
 * `salvage` (used when a reply is FINALIZED — stream end or user stop)
 * rescues the LAST file fence when generation was cut mid-file: its partial
 * content is kept instead of silently dropped, so an interrupted build never
 * loses the file it was writing. A later "continue" overwrites it with the
 * completed version.
 */
export function extractProjectFiles(text: string, salvage = false): Record<string, string> | null {
  if (!text || typeof text !== 'string') return null
  const files: Record<string, string> = {}
  const re = /```file:([^\n]+?)\s*\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const p = m[1].trim().replace(/^\/+/, '').replace(/\\/g, '/')
    if (!p || p.includes('..') || p.length > 200) continue
    files[p] = m[2].replace(/\n+$/, '')
  }
  if (salvage) {
    // Find the last ```file: opener and check whether it ever closed.
    const openers = Array.from(text.matchAll(/```file:([^\n]+?)\s*\n/g))
    const last = openers[openers.length - 1]
    if (last && last.index !== undefined) {
      const contentStart = last.index + last[0].length
      const after = text.slice(contentStart)
      const closerIdx = after.indexOf('\n```')
      if (closerIdx === -1) {
        // Unterminated final fence → generation was cut inside this file.
        const p = last[1].trim().replace(/^\/+/, '').replace(/\\/g, '/')
        const partial = after.replace(/\n+$/, '')
        if (p && !p.includes('..') && p.length <= 200 && partial.trim().length > 0) {
          files[p] = partial
        }
      }
    }
  }
  return Object.keys(files).length >= 1 ? files : null
}

/**
 * Frontend twin of the server's codingReplyIncompleteReason: is a finished
 * coding reply still structurally incomplete (open fence, missing referenced
 * css/js, no closing </html>, an empty file)? Returns a reason or '' when whole.
 * Drives the browser auto-continue safety net so a build that ends short gets
 * "continue" re-sent automatically instead of the user typing it.
 */
export function codingReplyIncompleteReason(text: string): string {
  if (!text) return ''
  const openers = (text.match(/^```[^`\s][^\n]*$/gm) || []).length
  const closers = (text.match(/^```\s*$/gm) || []).length
  if (openers > closers) return 'an open code fence was never closed'
  const files = extractProjectFiles(text)
  // Coding mode must produce a persistent project, not stop after a plan or a
  // prose explanation. A missing file fence is therefore incomplete and lets
  // the browser continuation safety net request the implementation again.
  if (!files) return 'no project files were emitted'
  const paths = new Set(Object.keys(files))
  const indexKey = Object.keys(files).find((p) => p === 'index.html' || p.endsWith('/index.html'))
  if (indexKey) {
    const html = files[indexKey]
    if (!/<\/html\s*>/i.test(html)) return 'index.html has no closing </html> tag'
    if (!/<\/body\s*>/i.test(html)) return 'index.html has no closing </body> tag'
    const refs = [...html.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/gi)]
      .map((m) => m[1])
      .filter((r) => r && !/^(?:https?:|data:|#|mailto:|\/\/)/i.test(r))
      .map((r) => r.replace(/^\.?\//, '').split(/[?#]/)[0])
    for (const ref of refs) {
      if (/\.(?:css|js|mjs)$/i.test(ref) && !paths.has(ref)) return `references ${ref} which was not emitted yet`
    }
  }
  for (const [p, content] of Object.entries(files)) {
    if (content.trim().length === 0) return `file ${p} is empty`
  }
  return ''
}
