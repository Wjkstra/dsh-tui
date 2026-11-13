import { stripVTControlCharacters } from 'node:util'

const segmenter = new Intl.Segmenter()

function cellWidth(segment) {
  if (/^\p{Mark}/u.test(segment)) return 0
  if (/\p{Emoji_Presentation}|\p{Regional_Indicator}|\uFE0F/u.test(segment)) return 2
  const code = segment.codePointAt(0)
  const wide = (code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0xa4cf)
    || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe10 && code <= 0xfe6f) || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6) || code >= 0x20000
  return wide ? 2 : 1
}

export function clean(text) {
  return stripVTControlCharacters(String(text)).replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
}

export function oneLine(text) {
  return clean(text).replace(/\s+/g, ' ').trim()
}

export function fit(text, columns) {
  let result = ''
  let width = 0
  for (const { segment } of segmenter.segment(text)) {
    width += cellWidth(segment)
    if (width > columns) break
    result += segment
  }
  return result
}

export function previousCharacter(text, cursor) {
  return cursor > 0 ? segmenter.segment(text).containing(cursor - 1).index : 0
}

export function nextCharacter(text, cursor) {
  const part = segmenter.segment(text).containing(cursor)
  return part ? part.index + part.segment.length : text.length
}

function inputWindow(buffer, cursor, columns) {
  if (columns <= 0) return { text: '', offset: 0 }
  const visible = buffer.replace(/\n/g, '↵').replace(/\t/g, '⇥')
  let start = cursor
  let width = 0
  const parts = segmenter.segment(visible)
  while (start > 0) {
    const part = parts.containing(start - 1)
    const nextWidth = width + cellWidth(part.segment)
    if (nextWidth > columns - 1) break
    width = nextWidth
    start = part.index
  }
  const prefix = start > 0 ? '‹' : ''
  const text = fit(visible.slice(start), columns - prefix.length)
  return { text: prefix + text, offset: prefix.length + width }
}

const at = (row, column = 1) => `\x1b[${row};${column}H`
const eraseLine = '\x1b[2K'
const save = '\x1b7'
const restore = '\x1b8'
const clearFooter = restore + '\x1b[J'
const layouts = [[2], [2, 5], [0, 2, 5], [0, 2, 4, 5], [0, 1, 2, 4, 5], [0, 1, 2, 3, 4, 5]]

/** Keep the transcript on the normal screen and reserve the last rows for the editor. */
export class TerminalFooter {
  constructor(stdout, colors, view) {
    this.stdout = stdout
    this.colors = colors
    this.view = view
    this.rows = 0
    this.height = 0
    this.onResize = () => {
      this.stdout.write(clearFooter)
      this.reserve()
      this.draw()
    }
  }

  start() {
    this.reserve()
    this.stdout.on('resize', this.onResize)
    this.stdout.write('\x1b[?2004h')
    this.draw()
  }

  reserve() {
    this.rows = this.stdout.rows || 24
    this.height = Math.min(6, Math.max(1, this.rows - 1))
    this.stdout.write('\r\n'.repeat(this.height) + `\x1b[${this.height}A` + save)
    this.lines = []
    this.cursor = ''
  }

  print(text) {
    this.stdout.write(clearFooter + text.replace(/\r?\n/g, '\r\n') + '\r\n')
    this.reserve()
    this.draw()
  }

  draw() {
    const { status, preview, prompt, buffer, cursor, model, permission } = this.view()
    const { dim, accent } = this.colors
    const columns = Math.max(1, (this.stdout.columns || 80) - 1)
    const rule = dim('─'.repeat(columns))
    const label = fit(prompt, Math.min(columns - 1, Math.max(2, columns - 8)))
    const labelWidth = [...segmenter.segment(label)].reduce((width, { segment }) => width + cellWidth(segment), 0)
    const input = inputWindow(buffer, cursor, Math.max(0, columns - labelWidth))
    const rows = [dim(fit([status, preview].filter(Boolean).join('  '), columns)), rule,
      accent(label) + input.text, rule, dim(fit(model, columns)), accent(fit(permission, columns))]
    const indexes = layouts[this.height - 1]
    const first = this.rows - indexes.length + 1
    const cursorRow = first + indexes.indexOf(2)
    const cursorPosition = at(cursorRow, Math.min(columns + 1, labelWidth + input.offset + 1))
    const lines = indexes.map((index) => rows[index])
    const changed = lines.map((line, i) => line === this.lines[i] ? '' : at(first + i) + eraseLine + line).join('')
    if (changed || cursorPosition !== this.cursor) this.stdout.write(changed + cursorPosition)
    this.lines = lines
    this.cursor = cursorPosition
  }

  stop() {
    this.stdout.off('resize', this.onResize)
    this.stdout.write('\x1b[?2004l' + clearFooter)
  }
}
