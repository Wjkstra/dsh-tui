#!/usr/bin/env node
/**
 * dsh-cli — a Claude-Code-style terminal client for DeepSeek Harness.
 *
 * Design notes (why this looks the way it does):
 *  - Append-only rendering. Nothing is repainted in place except one single
 *    input line, so a terminal that renders a character at a different width
 *    than we measure can never desynchronise a whole frame.
 *  - Permission modes map onto DSH's launch-time `DSH_PERMISSION_MODE`
 *    (workspace-write / read-only / danger-full-access); switching a mode that
 *    changes the sandbox relaunches the runtime and resumes the same session.
 *  - The workspace is the directory the client is started in, and it must be
 *    trusted first (like Claude Code's folder trust prompt).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const VERSION = '1.0.0'
const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const CLIENT_HOME = path.join(os.homedir(), '.dsh-cli')
const TRUST_FILE = path.join(CLIENT_HOME, 'trusted.json')
const RUNTIME = process.env.DSH_CLI_RUNTIME || path.join(CLIENT_HOME, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const PROVIDER = process.env.DSH_CLI_PROVIDER || 'deepseek-account'
const MODEL = process.env.DSH_CLI_MODEL || 'deepseek-flash'
const INIT_TIMEOUT = Number(process.env.DSH_CLI_INIT_TIMEOUT_MS || 180000)

const ansi = (process.stdout.isTTY || process.env.DSH_CLI_FORCE_ANSI === '1') && !process.env.NO_COLOR
const paint = (code, text) => (ansi ? `\u001b[${code}m${text}\u001b[0m` : text)
const dim = (t) => paint('2', t)
const bold = (t) => paint('1', t)
const red = (t) => paint('31', t)
const green = (t) => paint('32', t)
const yellow = (t) => paint('33', t)
const cyan = (t) => paint('36', t)

/** Permission modes, in Shift+Tab order. `env` is the DSH_PERMISSION_MODE. */
const MODES = [
  { id: 'default', label: '默认（逐次询问）', env: 'workspace-write', ask: true },
  { id: 'auto', label: '自动（工作区内）', env: 'workspace-write', ask: false },
  { id: 'plan', label: '计划（只读）', env: 'read-only', ask: false, plan: true },
  { id: 'full', label: '完全访问', env: 'danger-full-access', ask: false },
]

let promptVisible = false
const out = (t = '') => {
  if (promptVisible && process.stdout.isTTY) {
    process.stdout.write('\r\u001b[K')
    promptVisible = false
  }
  process.stdout.write(`${t}\n`)
}

// ---------------------------------------------------------------------------
// splash: pixel whale + block wordmark (art from dsh-tui, MIT, by @lhh010)
// ---------------------------------------------------------------------------
const SPLASH = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'splash-data.json'), 'utf8'))
  } catch {
    return null
  }
})()

const WHALE_PALETTE = {
  D: [20, 38, 96],
  B: [78, 111, 255],
  L: [190, 225, 255],
  W: [255, 255, 255],
  H: [204, 51, 153],
  Z: [128, 128, 128],
}

const fg24 = (rgb) => `\u001b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`
const bg24 = (rgb) => `\u001b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m`

/** Render the sprite grid as half-block cells (two sprite rows per text row). */
function renderWhale(rows) {
  const lines = []
  for (let y = 0; y < rows.length; y += 2) {
    const top = rows[y] ?? ''
    const bottom = rows[y + 1] ?? ''
    const width = Math.max(top.length, bottom.length)
    let line = ''
    for (let x = 0; x < width; x += 1) {
      const topColor = WHALE_PALETTE[top[x]]
      const bottomColor = WHALE_PALETTE[bottom[x]]
      if (topColor && bottomColor) {
        line += fg24(topColor) + bg24(bottomColor) + '▀'
      } else if (topColor) {
        line += fg24(topColor) + '\u001b[49m▀'
      } else if (bottomColor) {
        line += fg24(bottomColor) + '\u001b[49m▄'
      } else {
        line += (line.includes('\u001b') ? '\u001b[0m ' : ' ')
      }
    }
    lines.push(line + '\u001b[0m')
  }
  return lines
}

function renderWordmark(rows, rgb, limit) {
  const columns = limit ?? process.stdout.columns ?? 100
  return rows.map((row) => {
    const clean = row.replace(/[\u00b7\u2027]/g, ' ')
    const fitted = clean.length > columns - 1 ? clean.slice(0, Math.max(0, columns - 1)) : clean
    return fg24(rgb) + fitted + '\u001b[0m'
  })
}

function renderSplash(mode) {
  if (!ansi || !SPLASH) return
  const columns = Number(process.env.DSH_CLI_COLUMNS) || process.stdout.columns || 100
  const rows = Number(process.env.DSH_CLI_ROWS) || process.stdout.rows || 30
  const whale = renderWhale(SPLASH.whaleRows)
  const whaleWidth = Math.max(...whale.map((line) => stripAnsi(line).length))
  const titleWidth = Math.max(...SPLASH.deepseek.map((r) => r.replace(/[\u00b7\u2027]/g, ' ').length))
  const info = [
    dim(`${MODEL}  ·  ${process.env.DSH_CLI_EFFORT ?? 'high'} effort`),
    dim(process.cwd()),
    dim('Tip: shift+tab 切换权限模式  ·  /help 查看命令'),
  ]
  const roomForTitle = columns >= titleWidth + 1 && rows >= 30
  const roomForSideBySide = roomForTitle && columns >= whaleWidth + 3 + titleWidth + 1 && rows >= 32
  const roomForWhale = rows >= 16

  out('')
  if (roomForSideBySide) {
    const limit = columns - whaleWidth - 3
    const title = [
      ...renderWordmark(SPLASH.deepseek, [122, 168, 255], limit),
      '',
      ...renderWordmark(SPLASH.harness, [96, 122, 176], limit),
    ]
    const right = ['', ...title, ...info]
    const height = Math.max(whale.length, right.length)
    for (let i = 0; i < height; i += 1) {
      const left = whale[i] ?? ''
      const pad = ' '.repeat(Math.max(0, whaleWidth - stripAnsi(left).length))
      out(left + pad + '   ' + (right[i] ?? ''))
    }
  } else if (roomForTitle) {
    if (roomForWhale) {
      for (const line of whale) out(line)
      out('')
    }
    for (const line of renderWordmark(SPLASH.deepseek, [122, 168, 255], columns)) out(line)
    out('')
    for (const line of renderWordmark(SPLASH.harness, [96, 122, 176], columns)) out(line)
    out('')
    for (const line of info) out(line)
  } else {
    if (roomForWhale) {
      for (const line of whale) out(line)
      out('')
    }
    out(fg24([122, 168, 255]) + 'DEEPSEEK HARNESS\u001b[0m')
    for (const line of info) out(line)
  }
  out('')
  out('探索未至之境！')
  out(dim(`模式 ${mode.label}`))
  out('')
}

function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '')
}


// ---------------------------------------------------------------------------
// workspace trust
// ---------------------------------------------------------------------------
function readTrusted() {
  try {
    const parsed = JSON.parse(fs.readFileSync(TRUST_FILE, 'utf8'))
    return Array.isArray(parsed.dirs) ? parsed.dirs : []
  } catch {
    return []
  }
}

function trustDir(dir) {
  const dirs = new Set(readTrusted())
  dirs.add(path.resolve(dir))
  fs.mkdirSync(CLIENT_HOME, { recursive: true })
  fs.writeFileSync(TRUST_FILE, `${JSON.stringify({ dirs: [...dirs] }, null, 2)}\n`)
}

// ---------------------------------------------------------------------------
// session store (shared with the desktop app)
// ---------------------------------------------------------------------------
const slug = (cwd) => `--${cwd.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}--`

function listSessions(cwd) {
  const dir = path.join(HOME, 'sessions', slug(cwd))
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('session-'))
    .map((e) => {
      const log = path.join(dir, e.name, 'session.v4.jsonl.zstd')
      let mtime = 0
      try { mtime = fs.statSync(log).mtimeMs } catch { /* empty session */ }
      return { id: e.name, mtime }
    })
    .sort((a, b) => b.mtime - a.mtime)
}

const shortId = (id) => id.replace(/^session-/, '').slice(0, 8)

function printSessions(cwd) {
  const sessions = listSessions(cwd)
  if (!sessions.length) { out(dim('no sessions in this workspace')); return }
  out('')
  sessions.forEach((s, i) => {
    const when = s.mtime ? new Date(s.mtime).toISOString().slice(5, 16).replace('T', ' ') : '-'
    out(dim(`  ${String(i + 1).padStart(2)}. `) + shortId(s.id) + `  ${when}`)
  })
  out(dim('  /resume <n|id>'))
  out('')
}

// ---------------------------------------------------------------------------
// rendering (append-only, ASCII markers)
// ---------------------------------------------------------------------------
function toolArgSummary(raw) {
  try {
    const parsed = JSON.parse(raw)
    for (const key of ['path', 'file_path', 'command', 'query', 'url', 'goal', 'description', 'pattern']) {
      if (typeof parsed[key] === 'string') return `${key}: ${parsed[key].replace(/\s+/g, ' ').slice(0, 90)}`
    }
    const first = Object.entries(parsed)[0]
    if (first) return `${first[0]}: ${String(first[1]).replace(/\s+/g, ' ').slice(0, 90)}`
  } catch { /* raw */ }
  return (raw || '').replace(/\s+/g, ' ').slice(0, 90)
}

function resultText(message) {
  const blocks = Array.isArray(message?.content) ? message.content : []
  return blocks.filter((b) => b?.type === 'text').map((b) => b.text).join('\n')
}

class Printer {
  constructor() {
    this.chain = Promise.resolve()
    this.tools = []
  }

  enqueue(task) {
    this.chain = this.chain.then(task).catch(() => {})
    return this.chain
  }

  idle() {
    return this.chain
  }

  expandLast() {
    const entry = this.tools[this.tools.length - 1]
    if (!entry) {
      out(dim('  no tool output to expand'))
      return
    }
    out('')
    out(dim(`  ---- ${entry.name} (${entry.ok ? 'ok' : 'fail'}) ----`))
    for (const line of entry.lines) out(dim('  | ') + line)
    out(dim('  ---- end ----'))
    out('')
  }
}

const printer = new Printer()

/** Minimal markdown: fenced code, headings, inline code and bold. */
function renderMarkdown(text) {
  const result = []
  let inFence = false
  for (const raw of text.split('\n')) {
    if (/^\s*```/.test(raw)) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      result.push(dim(`  ${raw}`))
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(raw)
    if (heading) {
      result.push(bold(heading[2]))
      continue
    }
    result.push(
      raw
        .replace(/`([^`]+)`/g, (_, code) => cyan(code))
        .replace(/\*\*([^*]+)\*\*/g, (_, strong) => bold(strong)),
    )
  }
  return result.join('\n')
}

/** Progressive output: tokens are written in small ticks so it reads like streaming. */
async function typeWrite(text) {
  if (!ansi || process.env.DSH_CLI_NO_TYPING === '1') {
    process.stdout.write(text)
    return
  }
  const tokens = text.match(/\u001b\[[0-9;]*m|[\s\S]/gu) ?? []
  const perTick = Math.max(2, Math.round(tokens.length / 220))
  for (let i = 0; i < tokens.length; i += perTick) {
    process.stdout.write(tokens.slice(i, i + perTick).join(''))
    if (i + perTick < tokens.length) await new Promise((resolve) => setTimeout(resolve, 12))
  }
}

function makeRenderer(sessionId, ui) {
  const calls = new Map()

  return function render(notification) {
    if (notification.method !== 'session.event') return
    const payload = notification.params ?? {}
    if (payload.sessionId !== sessionId) return
    const event = payload.event
    if (!event?.type) return

    switch (event.type) {
      case 'assistant/message': {
        const content = Array.isArray(event.data?.message?.content) ? event.data.message.content : []
        const text = content.filter((b) => b?.type === 'text').map((b) => b.text).join('')
        const reasoning = content.filter((b) => b?.type === 'reasoning').map((b) => b.text).join('')
        if (reasoning && process.env.DSH_CLI_SHOW_REASONING === '1') {
          printer.enqueue(async () => {
            ui.clearInput()
            out(dim(reasoning.trim().slice(0, 600)))
            ui.renderInput()
          })
        }
        if (text.trim()) {
          printer.enqueue(async () => {
            ui.clearInput()
            out('')
            await typeWrite(renderMarkdown(text.trimEnd()))
            out('')
            ui.renderInput()
          })
        }
        break
      }
      case 'tool/call': {
        const data = event.data ?? {}
        calls.set(data.callId, data.name)
        printer.enqueue(async () => {
          ui.clearInput()
          out('')
          out(dim('> ') + `${data.name}(${toolArgSummary(data.arguments)})`)
          ui.renderInput()
        })
        break
      }
      case 'tool/result': {
        const data = event.data ?? {}
        const name = calls.get(data.message?.toolCallId) ?? ''
        calls.delete(data.message?.toolCallId)
        const full = resultText(data.message)
        const lines = full.split('\n').filter((line) => line.length > 0)
        const ok = data.message?.isError !== true
        printer.tools.push({ name, ok, lines })
        printer.enqueue(async () => {
          ui.clearInput()
          const head = lines[0] ? lines[0].replace(/\s+/g, ' ').slice(0, 110) : ''
          const rest = lines.length > 1 ? ` (+${lines.length - 1} lines, ctrl+o)` : ''
          out(dim(ok ? '  [ok]   ' : '  [fail] ') + `${name} ${head}${rest}`)
          ui.renderInput()
        })
        break
      }
      case 'turn/end': {
        const kind = event.data?.reason?.kind
        if (kind && kind !== 'completed' && kind !== 'stop') {
          printer.enqueue(async () => {
            ui.clearInput()
            out(dim(`  [${kind}]`))
            ui.renderInput()
          })
        }
        break
      }
      default:
        break
    }
  }
}

// ---------------------------------------------------------------------------
// one input line: raw mode with a tiny editor, line mode when not a TTY
// ---------------------------------------------------------------------------
class LineInput {
  constructor({ onMode, onSubmit, onKey }) {
    this.buffer = ''
    this.cursor = 0
    this.busy = false
    this.history = []
    this.historyIndex = -1
    this.onMode = onMode
    this.onSubmit = onSubmit
    this.onKey = onKey
    this.resolveLine = null
    this.raw = Boolean(process.stdin.isTTY)
  }

  start() {
    if (this.raw) {
      process.stdin.setRawMode(true)
      process.stdin.resume()
      process.stdin.setEncoding('utf8')
      process.stdin.on('data', (chunk) => this.handleKeys(chunk))
    } else {
      process.stdin.setEncoding('utf8')
      let partial = ''
      let chain = Promise.resolve()
      process.stdin.on('data', (chunk) => {
        partial += chunk
        let index
        while ((index = partial.indexOf('\n')) >= 0) {
          const line = partial.slice(0, index).replace(/\r$/, '')
          partial = partial.slice(index + 1)
          chain = chain.then(() => this.onSubmit(line)).catch(() => {})
        }
      })
    }
  }

  stop() {
    if (this.raw) {
      try { process.stdin.setRawMode(false) } catch { /* ignore */ }
      process.stdin.pause()
    }
  }

  setBusy(busy) { this.busy = busy }

  renderInput() {
    if (!this.raw) return
    const promptText = cyan('> ')
    process.stdout.write(`\r\u001b[K${promptText}${this.buffer}`)
    promptVisible = true
    const back = this.buffer.length - this.cursor
    if (back > 0) process.stdout.write(`\u001b[${back}D`)
  }

  clearInput() {
    promptVisible = false
    if (!this.raw) return
    process.stdout.write('\r\u001b[K')
  }

  handleKeys(chunk) {
    if (this.busy && !this.expectInput) {
      if (chunk.includes('\u0003')) this.onKey('interrupt')
      if (chunk.includes('\u000f')) this.onKey('expand')
      return
    }
    let i = 0
    while (i < chunk.length) {
      const ch = chunk[i]
      if (ch === '\u001b' && chunk[i + 1] === '[') {
        const rest = chunk.slice(i)
        if (rest.startsWith('\u001b[Z')) { this.onMode(); i += 3; continue }
        if (rest.startsWith('\u001b[A')) { this.historyPrev(); i += 3; continue }
        if (rest.startsWith('\u001b[B')) { this.historyNext(); i += 3; continue }
        if (rest.startsWith('\u001b[C')) { this.cursor = Math.min(this.buffer.length, this.cursor + 1); i += 3; continue }
        if (rest.startsWith('\u001b[D')) { this.cursor = Math.max(0, this.cursor - 1); i += 3; continue }
        if (rest.startsWith('\u001b[H')) { this.cursor = 0; i += 3; continue }
        if (rest.startsWith('\u001b[F')) { this.cursor = this.buffer.length; i += 3; continue }
        // Bracketed paste: drop the markers, keep the text.
        if (rest.startsWith('\u001b[200~')) {
          const end = rest.indexOf('\u001b[201~')
          const body = end >= 0 ? rest.slice(6, end) : rest.slice(6)
          this.insert(body.replace(/\r/g, ''))
          i += end >= 0 ? end + 6 : rest.length
          continue
        }
        i += 1
        continue
      }
      if (ch === '\r' || ch === '\n') {
        this.submit()
        i += 1
        continue
      }
      if (ch === '\u007f' || ch === '\b') {
        if (this.cursor > 0) {
          this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor)
          this.cursor -= 1
        }
        i += 1
        continue
      }
      if (ch === '\u0001') { this.cursor = 0; i += 1; continue }
      if (ch === '\u0005') { this.cursor = this.buffer.length; i += 1; continue }
      if (ch === '\u0003') { this.onKey('ctrl-c'); i += 1; continue }
      if (ch === '\u0004') { this.onKey('ctrl-d'); i += 1; continue }
      if (ch === '\u000f') { this.onKey('expand'); i += 1; continue }
      if (ch === '\u0015') { this.buffer = this.buffer.slice(this.cursor); this.cursor = 0; i += 1; continue }
      if (ch < ' ') { i += 1; continue }
      this.insert(ch)
      i += 1
    }
    this.renderInput()
  }

  insert(text) {
    this.buffer = this.buffer.slice(0, this.cursor) + text + this.buffer.slice(this.cursor)
    this.cursor += text.length
  }

  submit() {
    const line = this.buffer.trim()
    this.buffer = ''
    this.cursor = 0
    process.stdout.write('\r\u001b[K')
    if (line) {
      this.history.push(line)
      this.historyIndex = this.history.length
      this.onSubmit(line)
    } else {
      this.renderInput()
    }
  }

  historyPrev() {
    if (!this.history.length) return
    this.historyIndex = Math.max(0, Math.min(this.historyIndex, this.history.length) - 1)
    this.buffer = this.history[this.historyIndex] ?? ''
    this.cursor = this.buffer.length
  }

  historyNext() {
    if (!this.history.length) return
    this.historyIndex = Math.min(this.history.length, this.historyIndex + 1)
    this.buffer = this.history[this.historyIndex] ?? ''
    this.cursor = this.buffer.length
  }

  /** Read one line, used by approvals and questions while a turn runs. */
  readLine(questionText) {
    this.expectInput = true
    process.stdout.write(questionText)
    if (!this.raw) return Promise.resolve('')
    return new Promise((resolve) => {
      const previous = this.onSubmit
      this.onSubmit = (line) => { this.onSubmit = previous; this.expectInput = false; resolve(line) }
    })
  }
}

// ---------------------------------------------------------------------------
// harness management
// ---------------------------------------------------------------------------
async function createHarness(mode, callbacks) {
  const { DeepSeekHarness } = await import('@deepseek-ai/dsh-sdk-client')
  const harness = new DeepSeekHarness({
    dshHome: HOME,
    cwd: process.cwd(),
    provider: PROVIDER,
    model: MODEL,
    approvalRequests: true,
    initializeTimeoutMs: INIT_TIMEOUT,
    env: { ...process.env, DSH_PERMISSION_MODE: mode.env },
    onUserQuestion: callbacks.onUserQuestion,
  })
  await harness.client.start()
  harness.client.onRequest(async (method, params) => {
    if (method !== 'approval/request') throw new Error(`unsupported request: ${method}`)
    return callbacks.onApproval(params)
  })
  await harness.start()
  return harness
}

// ---------------------------------------------------------------------------
// main interactive loop
// ---------------------------------------------------------------------------
async function mainInteractive(cli) {
  const cwd = process.cwd()
  if (!cli.resume && !cli.continue) {
    const trusted = readTrusted().map((d) => path.resolve(d))
    if (!trusted.includes(path.resolve(cwd))) {
      out('')
      out(bold(`Do you trust the files in this folder?`) + ` ${cwd}`)
      out(dim('  dsh-cli will be able to read files and run commands here.'))
      process.stdout.write('  Trust this folder? [y/N] ')
      const answer = await readOneLineFromStdin()
      if (!/^y(es)?$/i.test(answer.trim())) {
        out('')
        out(dim('Not trusted. Re-run to confirm, or use a trusted directory.'))
        return 0
      }
      trustDir(cwd)
      out(dim('  trusted: yes'))
      out('')
    }
  }

  let modeIndex = Math.max(0, MODES.findIndex((m) => m.id === cli.mode))
  if (modeIndex < 0) modeIndex = 0
  let mode = MODES[modeIndex]
  let harness = null
  let session = null
  let currentSessionId = null
  let planOn = false

  const input = new LineInput({
    onMode: () => { cycleMode().catch((error) => out(red(`! ${error?.message ?? error}`))) },
    onSubmit: (line) => { handleLine(line).catch((error) => out(red(`! ${error?.message ?? error}`))) },
    onKey: (key) => {
      if (key === 'interrupt' || key === 'ctrl-c') {
        input.stop()
        out('')
        out(dim('interrupted — session history is saved'))
        process.exit(130)
      }
      if (key === 'expand') {
        printer.expandLast()
        return
      }
      if (key === 'ctrl-d') {
        input.stop()
        process.exit(0)
      }
    },
  })

  async function startHarness(nextMode, resumeId) {
    harness?.close?.().catch(() => {})
    harness = await createHarness(nextMode, {
      onUserQuestion: async (request) => {
        const questions = Array.isArray(request.questions) ? request.questions : []
        const answers = []
        for (const q of questions) {
          out('')
          out(yellow('? ') + (q.question ?? q.header ?? 'question'))
          const options = Array.isArray(q.options) ? q.options : []
          options.forEach((o, i) => out(dim(`  ${i + 1}. ${o.label ?? ''}${o.description ? ` — ${o.description}` : ''}`)))
          const raw = (await input.readLine(dim('  answer (number or text): '))).trim()
          if (!raw) { answers.push({ id: q.id, selected: [], custom: '' }); continue }
          const numbers = raw.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= options.length)
          if (options.length && numbers.length) answers.push({ id: q.id, selected: numbers.map((n) => options[n - 1].label) })
          else answers.push({ id: q.id, selected: [], custom: raw })
        }
        return { answers }
      },
      onApproval: async (params) => {
        if (!nextMode.ask) return { outcome: 'allowed-once' }
        out('')
        out(yellow('! ') + `approval required: ${params.toolName ?? 'tool'}${params.reason ? ` — ${params.reason}` : ''}`)
        const answer = (await input.readLine(dim('  allow? [y]once / [a]lways / [N]o: '))).trim().toLowerCase()
        if (answer === 'a') { nextMode.ask = false; return { outcome: 'allowed-once' } }
        return { outcome: answer === 'y' ? 'allowed-once' : 'rejected' }
      },
    })
    session = resumeId ? await harness.resumeSession(resumeId) : harness.session()
    currentSessionId = session.id
    return session
  }

  async function applyMode(nextMode, { relanch }) {
    const sandboxChanged = nextMode.env !== mode.env
    mode = nextMode
    if (relanch && sandboxChanged) {
      out(dim(`[mode] ${mode.label} — restarting runtime...`))
      await startHarness(mode, currentSessionId)
    }
    if (mode.plan !== planOn) {
      planOn = Boolean(mode.plan)
      await runTurn(planOn ? '/plan' : '/plan off', { quiet: true })
    }
    out(dim(`[mode] ${mode.label}`))
  }

  async function cycleMode() {
    if (input.busy) return
    const next = MODES[(modeIndex + 1) % MODES.length]
    modeIndex = (modeIndex + 1) % MODES.length
    await applyMode(next, { relanch: true })
  }

  const rendererFor = (sessionId) => makeRenderer(sessionId, input)

  async function runTurn(text, options = {}) {
    input.busy = true
    input.setBusy(true)
    if (!options.quiet) {
      input.clearInput()
      out('')
      out(dim('> ') + text)
    }
    const started = Date.now()
    try {
      const result = await session.run(text, { onNotification: options.quiet ? () => {} : rendererFor(session.id) })
      await printer.idle()
      if (!options.quiet && result.finalResponse?.trim()) {
        // nothing: the renderer already printed committed assistant messages
      }
      out(dim(`  ${((Date.now() - started) / 1000).toFixed(1)}s`))
    } catch (error) {
      out(red(`! ${error?.message ?? error}`))
    } finally {
      input.busy = false
      input.setBusy(false)
      input.renderInput()
    }
  }

  async function handleLine(line) {
    if (!line.startsWith('/')) { await runTurn(line); return }
    const [command, ...rest] = line.slice(1).split(/\s+/)
    const arg = rest.join(' ').trim()
    switch (command.toLowerCase()) {
      case 'exit':
      case 'quit':
        input.stop()
        await harness?.close?.()
        process.exit(0)
      case 'help':
        out(HELP)
        return
      case 'mode':
        out(MODES.map((m, i) => `  ${i + 1}. ${m.label}${m.id === mode.id ? ' *' : ''}`).join('\n'))
        if (arg) {
          const index = Number(arg) - 1
          if (Number.isInteger(index) && MODES[index]) { modeIndex = index; await applyMode(MODES[index], { relanch: true }) }
        }
        return
      case 'plan':
        planOn = !planOn
        await runTurn(planOn ? '/plan' : '/plan off', { quiet: true })
        out(dim(`[plan] ${planOn ? 'on' : 'off'}`))
        return
      case 'new':
        session = harness.session()
        currentSessionId = session.id
        out(dim(`[new] ${shortId(session.id)}`))
        return
      case 'list':
        printSessions(cwd)
        return
      case 'resume': {
        const sessions = listSessions(cwd)
        const id = /^\d+$/.test(arg) ? sessions[Number(arg) - 1]?.id : (arg.startsWith('session-') ? arg : sessions.find((s) => shortId(s.id) === arg)?.id)
        if (!id) { out(red('no such session')); return }
        try {
          session = await harness.resumeSession(id)
          currentSessionId = id
          out(dim(`[resume] ${shortId(id)}`))
        } catch (error) { out(red(`! ${error?.message ?? error}`)) }
        return
      }
      case 'status':
        out(dim(`session ${currentSessionId}  mode ${mode.label}  model ${PROVIDER}/${MODEL}`))
        return
      case 'compact':
      case 'goal':
      case 'permission':
        await runTurn(line)
        return
      default:
        out(red(`unknown command: /${command}`))
    }
  }

  const initialMode = MODES[modeIndex]
  const resumeId = cli.resume ?? (cli.continue ? listSessions(cwd)[0]?.id : null)
  renderSplash(initialMode)
  out(dim('starting runtime...'))
  await startHarness(initialMode, resumeId)
  out(dim(`ready  ·  session ${shortId(currentSessionId)}  ·  ${cwd}`))
  out('')
  input.start()
  input.renderInput()

  // Keep the process alive; input drives everything.
  await new Promise(() => {})
}

// ---------------------------------------------------------------------------
// non-interactive helpers
// ---------------------------------------------------------------------------
function readOneLineFromStdin() {
  return new Promise((resolve) => {
    let buffer = ''
    const onData = (chunk) => {
      buffer += chunk
      const index = buffer.indexOf('\n')
      if (index >= 0) {
        process.stdin.off('data', onData)
        process.stdin.pause()
        resolve(buffer.slice(0, index).replace(/\r$/, ''))
      }
    }
    process.stdin.setEncoding('utf8')
    process.stdin.resume()
    process.stdin.on('data', onData)
  })
}

async function runOneShot(cli) {
  const { DeepSeekHarness } = await import('@deepseek-ai/dsh-sdk-client')
  const mode = MODES.find((m) => m.id === cli.mode) ?? MODES[0]
  const harness = new DeepSeekHarness({
    dshHome: HOME,
    cwd: process.cwd(),
    provider: PROVIDER,
    model: MODEL,
    approvalRequests: false,
    initializeTimeoutMs: INIT_TIMEOUT,
    env: { ...process.env, DSH_PERMISSION_MODE: mode.env },
  })
  try {
    await harness.start()
    const id = cli.resume ?? (cli.continue ? listSessions(process.cwd())[0]?.id : null)
    const session = id ? await harness.resumeSession(id) : harness.session()
    const result = await session.run(cli.print, { onNotification: () => {} })
    out(result.finalResponse)
    return result.finishReason === 'error' ? 1 : 0
  } finally {
    await harness.close()
  }
}

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const cli = { mode: 'default', print: null, resume: null, continue: false, list: false, help: false, version: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--help' || a === '-h') cli.help = true
    else if (a === '--version' || a === '-v') cli.version = true
    else if (a === '--list' || a === '-l') cli.list = true
    else if (a === '--print' || a === '-p') cli.print = argv[++i] ?? ''
    else if (a === '--resume' || a === '-r') cli.resume = argv[++i] ?? null
    else if (a === '--continue' || a === '-c') cli.continue = true
    else if (a === '--mode') cli.mode = argv[++i] ?? 'default'
    else if (a === '--splash') cli.splash = true
    else if (a.startsWith('-')) throw new Error(`unknown option: ${a}`)
    else if (cli.print === null) cli.print = a
    else cli.print += ` ${a}`
  }
  return cli
}

const HELP = `${bold('dsh-cli')} ${VERSION} — Claude-style terminal client for DeepSeek Harness

  dsh-cli                 start in the current directory (asks to trust it first)
  dsh-cli -c              continue the most recent session in this directory
  dsh-cli -r <id>         resume a specific session
  dsh-cli -p "prompt"     one-shot, print the final answer
  dsh-cli --list          list sessions in this workspace

keys
  shift+tab               cycle permission modes: 默认 -> 自动(工作区内) -> 计划 -> 完全访问
  ctrl+c                  interrupt/exit, ctrl+d exit, up/down history

commands
  /mode [n]  /plan  /new  /list  /resume <n|id>  /status  /compact  /exit
`

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------
async function main() {
  let cli
  try {
    cli = parseArgs(process.argv.slice(2))
  } catch (error) {
    out(red(`! ${error.message}`))
    out(HELP)
    return 2
  }
  if (cli.help) { out(HELP); return 0 }
  if (cli.version) { out(`dsh-cli ${VERSION}`); return 0 }
  if (cli.list) { printSessions(process.cwd()); return 0 }
  if (cli.splash) { renderSplash(MODES[0]); return 0 }
  if (cli.print !== null) return runOneShot(cli)
  return mainInteractive(cli)
}

main()
  .then((code) => { if (typeof code === 'number') process.exitCode = code })
  .catch((error) => {
    out(red(`! ${error?.stack ?? error}`))
    process.exitCode = 1
  })
