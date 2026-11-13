#!/usr/bin/env node
/**
 * dsh-cli — a Claude-Code-style terminal client for DeepSeek Harness.
 *
 * Durable messages stay in terminal scrollback. The input, status and live
 * response preview occupy a small footer on interactive terminals.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { clean, oneLine, previousCharacter, nextCharacter, TerminalFooter } from './terminal.mjs'

const VERSION = '1.1.0'
const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const CLIENT_HOME = path.join(os.homedir(), '.dsh-cli')
const TRUST_FILE = path.join(CLIENT_HOME, 'trusted.json')
const RUNTIME = process.env.DSH_CLI_RUNTIME || undefined
const PROVIDER = process.env.DSH_CLI_PROVIDER || 'deepseek-account'
const MODEL = process.env.DSH_CLI_MODEL || 'deepseek-flash'
const EFFORT = process.env.DSH_CLI_EFFORT?.trim() || undefined
const INIT_TIMEOUT = Number(process.env.DSH_CLI_INIT_TIMEOUT_MS || 180000)
const SHOW_REASONING = process.env.DSH_CLI_SHOW_REASONING === '1'
const INTERACTIVE_TERMINAL = Boolean(process.stdin.isTTY && process.stdout.isTTY && process.env.TERM !== 'dumb')

const ansi = (process.stdout.isTTY || process.env.DSH_CLI_FORCE_ANSI === '1') && !process.env.NO_COLOR
const paint = (code, text) => (ansi ? `\u001b[${code}m${text}\u001b[0m` : text)
const dim = (t) => paint('2', t)
const bold = (t) => paint('1', t)
const red = (t) => paint('31', t)
const green = (t) => paint('32', t)
const yellow = (t) => paint('33', t)
const cyan = (t) => paint('36', t)

/** Permission presets, in Shift+Tab order. */
const MODES = [
  { id: 'default', label: '默认 · 按需审批', preset: 'workspace-write', sandbox: 'workspace-write', approval: 'ask' },
  { id: 'auto', label: '自动 · 仅工作区', preset: 'cli-workspace-only', sandbox: 'workspace-write', approval: 'never' },
  { id: 'plan', label: '计划 · 只读', preset: 'read-only', sandbox: 'read-only', approval: 'ask', plan: true },
  { id: 'full', label: '完全访问', preset: 'danger-full-access', sandbox: 'danger-full-access', approval: 'never' },
]

let footer
const out = (t = '') => {
  if (footer) footer.print(t)
  else process.stdout.write(`${t}\n`)
}

// ---------------------------------------------------------------------------
// splash: pixel whale + block wordmark (art from dsh-tui, MIT, by @lhh010)
// ---------------------------------------------------------------------------
const SPLASH = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL('./splash-data.json', import.meta.url), 'utf8'))
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
    dim(`${MODEL}  ·  推理 ${EFFORT ?? '自动'}`),
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

const elapsed = (started) => `${((performance.now() - started) / 1000).toFixed(1)}s`
const liveLabels = {
  startup: '正在启动运行时', waiting: '等待模型响应', thinking: '正在思考',
  answer: '正在回答', preparingTool: '正在准备工具调用', tools: '正在运行工具',
  retry: '正在重试', finishing: '正在收尾',
}

class TurnDisplay {
  constructor() {
    this.started = performance.now()
    this.phase = 'waiting'
    this.preview = ''
    this.thinkingSince = null
    this.calls = new Map()
    this.printedText = ''
    this.error = ''
  }

  setPhase(phase) {
    if (this.phase === phase) return
    this.phase = phase
    this.preview = ''
  }

  stream({ phase, text }) {
    if (phase === 'thinking' && this.thinkingSince === null) this.thinkingSince = performance.now()
    if (phase === 'answer' || phase === 'preparingTool' || phase === 'waiting') this.endThinking()
    this.setPhase(phase)
    if (text) this.preview = (this.preview + clean(text)).slice(-240)
  }

  endThinking(reasoning) {
    if (this.thinkingSince === null && !reasoning) return
    const duration = this.thinkingSince === null ? '' : ` ${elapsed(this.thinkingSince)}`
    this.thinkingSince = null
    out(dim(`· 已思考${duration}`))
  }

  event(event, saveTool) {
    const data = event.data ?? {}
    switch (event.type) {
      case 'step/start':
        this.setPhase('waiting')
        break
      case 'llm/retry':
      case 'llm/retry-started':
        this.endThinking()
        this.setPhase('retry')
        break
      case 'assistant/message': {
        const content = data.message?.content ?? []
        const text = clean(content.filter((b) => b.type === 'text').map((b) => b.text).join('')).trimEnd()
        const reasoning = content.filter((b) => b.type === 'reasoning').map((b) => b.text).join('')
        if (this.phase !== 'answer' && this.phase !== 'preparingTool') this.endThinking(reasoning)
        this.setPhase('finishing')
        if (SHOW_REASONING && reasoning.trim()) out(dim(clean(reasoning.trim())))
        if (text.trim()) {
          this.printedText = text
          out(`● ${renderMarkdown(text)}\n`)
        }
        break
      }
      case 'tool/call': {
        const name = oneLine(data.name ?? 'tool')
        this.calls.set(data.callId, name)
        this.setPhase('tools')
        out(dim('> ') + `${name}(${oneLine(toolArgSummary(data.arguments))})`)
        break
      }
      case 'tool/result': {
        const callId = data.message?.toolCallId
        const name = this.calls.get(callId) ?? ''
        this.calls.delete(callId)
        const lines = clean(resultText(data.message)).split('\n').filter(Boolean)
        const ok = data.message?.isError !== true
        saveTool({ name, ok, lines })
        const head = oneLine(lines[0] ?? '').slice(0, 110)
        const rest = lines.length > 1 ? ` (+${lines.length - 1} lines, Ctrl+O)` : ''
        out(dim(ok ? '  [ok]   ' : '  [fail] ') + `${name} ${head}${rest}`)
        if (this.calls.size === 0) this.setPhase('finishing')
        break
      }
      case 'turn/end':
        this.endThinking()
        this.setPhase('finishing')
        this.error = data.reason?.error?.message ?? ''
        break
    }
  }
}

// ---------------------------------------------------------------------------
// one input line: raw mode with a tiny editor, line mode when not a TTY
// ---------------------------------------------------------------------------
class LineInput {
  constructor({ onMode, onSubmit, onKey, onChange, onEnd }) {
    this.buffer = ''
    this.cursor = 0
    this.busy = false
    this.history = []
    this.historyIndex = -1
    this.onMode = onMode
    this.onSubmit = onSubmit
    this.onKey = onKey
    this.onChange = onChange
    this.onEnd = onEnd
    this.resolveLine = null
    this.question = ''
    this.escape = ''
    this.paste = null
    this.raw = INTERACTIVE_TERMINAL
  }

  start() {
    if (this.raw) {
      process.stdin.setRawMode(true)
      this.onData = (chunk) => this.handleKeys(chunk)
    } else {
      let partial = ''
      let chain = Promise.resolve()
      this.onData = (chunk) => {
        partial += chunk
        let index
        while ((index = partial.indexOf('\n')) >= 0) {
          const line = partial.slice(0, index).replace(/\r$/, '')
          partial = partial.slice(index + 1)
          chain = chain.then(() => this.onSubmit(line))
        }
      }
      this.onEof = () => {
        if (partial.trim()) chain = chain.then(() => this.onSubmit(partial.trim()))
        void chain.then(this.onEnd)
      }
      process.stdin.once('end', this.onEof)
    }
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', this.onData)
    process.stdin.resume()
  }

  stop() {
    if (this.onData) process.stdin.off('data', this.onData)
    if (this.onEof) process.stdin.off('end', this.onEof)
    if (this.raw && process.stdin.isRaw) process.stdin.setRawMode(false)
    process.stdin.pause()
    this.answer('')
  }

  handleKeys(chunk) {
    chunk = this.escape + chunk
    this.escape = ''
    let i = 0
    while (i < chunk.length) {
      if (this.paste !== null) {
        const end = chunk.indexOf('\u001b[201~', i)
        if (end === -1) {
          // Retain only a possible partial closing marker for the next chunk.
          const lastEscape = chunk.lastIndexOf('\u001b')
          if (lastEscape >= i && '\u001b[201~'.startsWith(chunk.slice(lastEscape))) {
            this.escape = chunk.slice(lastEscape)
            this.paste += chunk.slice(i, lastEscape)
          } else this.paste += chunk.slice(i)
          return
        }
        if (!this.busy || this.resolveLine) this.insert(clean(this.paste + chunk.slice(i, end)))
        this.paste = null
        i = end + 6
        continue
      }
      const ch = chunk[i]
      if (ch === '\u001b') {
        const rest = chunk.slice(i)
        const key = /^\u001b(?:\[[0-?]*[ -/]*[@-~]|O[A-Za-z])/.exec(rest)?.[0]
        if (!key && /^\u001b(?:\[[0-?]*[ -/]*|O)?$/.test(rest)) {
          this.escape = rest
          break
        }
        i += key?.length ?? 1
        if (key === '\u001b[200~') { this.paste = ''; continue }
        if (this.busy && !this.resolveLine) continue
        switch (key) {
          case '\u001b[Z': if (!this.resolveLine) this.onMode(); break
          case '\u001b[A': if (!this.resolveLine) this.historyPrev(); break
          case '\u001b[B': if (!this.resolveLine) this.historyNext(); break
          case '\u001b[C': this.cursor = nextCharacter(this.buffer, this.cursor); break
          case '\u001b[D': this.cursor = previousCharacter(this.buffer, this.cursor); break
          case '\u001b[H': case '\u001bOH': this.cursor = 0; break
          case '\u001b[F': case '\u001bOF': this.cursor = this.buffer.length; break
          case '\u001b[3~': this.buffer = this.buffer.slice(0, this.cursor) + this.buffer.slice(nextCharacter(this.buffer, this.cursor)); break
        }
        continue
      }
      if (ch === '\u0003') { this.onKey('ctrl-c'); return }
      if (ch === '\u000f') { this.onKey('expand'); i += 1; continue }
      if (this.busy && !this.resolveLine) { i += 1; continue }
      if (ch === '\r' || ch === '\n') {
        this.submit()
        i += chunk.startsWith('\r\n', i) ? 2 : 1
        continue
      }
      if (ch === '\u007f' || ch === '\b') {
        if (this.cursor > 0) {
          const previous = previousCharacter(this.buffer, this.cursor)
          this.buffer = this.buffer.slice(0, previous) + this.buffer.slice(this.cursor)
          this.cursor = previous
        }
        i += 1
        continue
      }
      if (ch === '\u0001') { this.cursor = 0; i += 1; continue }
      if (ch === '\u0005') { this.cursor = this.buffer.length; i += 1; continue }
      if (ch === '\u0004') {
        if (this.resolveLine) {
          this.answer('')
          i += 1
          continue
        }
        this.onKey('ctrl-d')
        return
      }
      if (ch === '\u0015') { this.buffer = this.buffer.slice(this.cursor); this.cursor = 0; i += 1; continue }
      if (ch < ' ') { i += 1; continue }
      this.insert(ch)
      i += 1
    }
    this.onChange()
  }

  insert(text) {
    this.buffer = this.buffer.slice(0, this.cursor) + text + this.buffer.slice(this.cursor)
    this.cursor += text.length
  }

  submit() {
    const line = this.buffer.trim()
    this.buffer = ''
    this.cursor = 0
    if (this.resolveLine) this.answer(line)
    else if (line) {
      this.history.push(line)
      this.historyIndex = this.history.length
      this.onSubmit(line)
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
  readLine(questionText, signal) {
    if (!this.raw) return Promise.resolve('')
    return new Promise((resolve) => {
      this.question = questionText
      const abort = () => this.answer('')
      this.resolveLine = (line) => {
        signal?.removeEventListener('abort', abort)
        resolve(line)
      }
      if (signal?.aborted) abort()
      else signal?.addEventListener('abort', abort, { once: true })
      this.onChange()
    })
  }

  answer(line) {
    const resolve = this.resolveLine
    if (!resolve) return
    this.resolveLine = null
    this.question = ''
    this.buffer = ''
    this.cursor = 0
    resolve(line)
    this.onChange()
  }
}

// ---------------------------------------------------------------------------
// harness management
// ---------------------------------------------------------------------------
async function createHarness(mode, callbacks) {
  const { DeepSeekHarness } = await import('@deepseek-ai/dsh-sdk-client')
  const harness = new DeepSeekHarness({
    dshBin: RUNTIME,
    dshHome: HOME,
    cwd: process.cwd(),
    provider: PROVIDER,
    model: MODEL,
    reasoningEffort: EFFORT,
    approvalRequests: true,
    initializeTimeoutMs: INIT_TIMEOUT,
    patches: [fileURLToPath(new URL('./runtime-ui.yml', import.meta.url))],
    env: {
      ...process.env,
      DSH_PERMISSION_MODE: mode.sandbox,
      DSH_CLI_LIVE_UI: INTERACTIVE_TERMINAL ? '1' : '0',
      DSH_CLI_ROUTE: JSON.stringify({ provider: PROVIDER, model: MODEL, reasoningEffort: EFFORT }),
    },
    onUserQuestion: callbacks.onUserQuestion,
  })
  await harness.client.start()
  harness.client.onRequest(async (method, params) => {
    if (method !== 'approval/request') throw new Error(`unsupported request: ${method}`)
    return callbacks.onApproval(params)
  })
  callbacks.onClient(harness.client)
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

  const initialMode = MODES.find((mode) => mode.id === cli.mode) ?? MODES[0]
  let harness = null
  let session = null
  let state = {}
  let defaults = { model: MODEL, provider: PROVIDER, reasoningEffort: EFFORT,
    sandbox: MODES[0].sandbox, approval: MODES[0].approval }
  let turn = null
  let lastTool = null
  let closing = false
  let interactions = Promise.resolve()
  let finish
  const done = new Promise((resolve) => { finish = resolve })
  const launch = performance.now()

  function resetState() {
    state = { ...defaults, cwd, plan: false, opened: false }
    lastTool = null
  }
  resetState()

  const currentMode = () => MODES.find((mode) => mode.sandbox === state.sandbox
    && mode.approval === state.approval && Boolean(mode.plan) === state.plan)
  const modeLabel = () => currentMode()?.label ?? `${state.plan ? '计划 · ' : ''}${state.approval === 'never' ? '免审批' : '按需审批'}`
  const modelLabel = () => `${oneLine(state.model)} · 推理 ${oneLine(state.reasoningEffort ?? '自动')}`
  const redraw = () => footer?.draw()

  async function close(code = 0) {
    if (closing) return
    closing = true
    input.stop()
    clearInterval(ticker)
    footer?.stop()
    footer = null
    try {
      await harness?.close()
    } finally {
      finish(code)
    }
  }

  function showError(error) {
    out(red(`! ${clean(error?.message ?? error)}`))
  }

  async function action(task) {
    if (input.busy || closing) return
    input.busy = true
    try {
      await task()
    } catch (error) {
      if (!closing) showError(error)
    } finally {
      input.busy = false
      redraw()
    }
  }

  const input = new LineInput({
    onMode: () => action(() => {
      const index = MODES.indexOf(currentMode())
      return applyMode(MODES[(index + 1) % MODES.length])
    }),
    onSubmit: (line) => action(() => handleLine(line)),
    onChange: redraw,
    onEnd: () => close().catch(showError),
    onKey: (key) => {
      if (key === 'ctrl-c') void close(130).catch(showError)
      if (key === 'ctrl-d') void close().catch(showError)
      if (key === 'expand') {
        if (!lastTool) { out(dim('  暂无工具输出')); return }
        out(dim(`  ── ${lastTool.name} (${lastTool.ok ? 'ok' : 'fail'}) ──`))
        if (lastTool.lines.length) out(lastTool.lines.map((line) => dim('  | ') + line).join('\n'))
      }
    },
  })

  const serializeInteraction = (task) => {
    const pending = interactions.then(() => closing ? undefined : task())
    interactions = pending.catch(() => {})
    return pending
  }

  function callbacks() {
    return {
      onClient: observeClient,
      onUserQuestion: (request, { signal }) => serializeInteraction(async () => {
        const questions = Array.isArray(request.questions) ? request.questions : []
        const answers = []
        for (const q of questions) {
          signal.throwIfAborted()
          out(yellow('? ') + clean(q.question ?? q.header ?? 'question'))
          if (q.detail) out(clean(q.detail))
          const options = Array.isArray(q.options) ? q.options : []
          options.forEach((o, i) => out(dim(`  ${i + 1}. ${oneLine(o.label ?? '')}${o.description ? ` — ${oneLine(o.description)}` : ''}`)))
          const raw = await input.readLine('回答（序号或文字）> ', signal)
          if (!raw) { answers.push({ id: q.id, selected: [], custom: '' }); continue }
          const numbers = raw.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= options.length)
          if (options.length && numbers.length) answers.push({ id: q.id, selected: numbers.map((n) => options[n - 1].label) })
          else answers.push({ id: q.id, selected: [], custom: raw })
        }
        return { answers }
      }),
      onApproval: (params) => serializeInteraction(async () => {
        out(yellow('! ') + `需要审批 · ${oneLine(params.toolName ?? 'tool')}${params.reason ? ` — ${oneLine(params.reason)}` : ''}`)
        const answer = (await input.readLine('允许本次执行？[y/N] > ')).toLowerCase()
        return { outcome: answer === 'y' ? 'allowed-once' : 'rejected' }
      }),
    }
  }

  const metadata = new Set(['model/selection', 'request/header', 'sandbox/mode', 'approval/policy', 'plan/mode', 'working-directory/change'])

  function observeClient(client) {
    const changes = client.subscribe((note) => note.method === 'dsh-cli.state' || note.method === 'dsh-cli.config'
      || (note.method === 'session.event' && metadata.has(note.params.event?.type)))
    void (async () => {
      try {
        for await (const note of changes) observeState(note)
      } catch (error) {
        if (harness && !closing) showError(error)
      }
    })()
  }

  function observeState(notification) {
    const { sessionId, event } = notification.params
    if (notification.method === 'dsh-cli.config') {
      const { selection, preset } = notification.params
      const mode = MODES.find((item) => item.preset === preset)
      const { model, provider, reasoningEffort } = selection
      defaults = { model, provider, reasoningEffort, sandbox: mode?.sandbox ?? defaults.sandbox,
        approval: mode?.approval ?? defaults.approval }
      if (!state.opened) Object.assign(state, defaults)
      redraw()
      return
    }
    if (sessionId !== session?.id) return
    state.opened = true
    if (notification.method === 'dsh-cli.state') {
      const { sandbox, approval, plan, selection } = notification.params
      if (sandbox) state.sandbox = sandbox
      if (approval) state.approval = approval
      if (typeof plan === 'boolean') state.plan = plan
      if (selection) {
        const effort = selection.model === defaults.model && selection.provider === defaults.provider ? defaults.reasoningEffort : undefined
        Object.assign(state, { ...selection, reasoningEffort: selection.reasoningEffort ?? effort })
      }
    } else {
      const data = event.data
      switch (event.type) {
        case 'request/header': {
          const { model, provider, reasoningEffort } = data.header.config
          Object.assign(state, { model, provider, reasoningEffort })
          break
        }
        case 'model/selection': Object.assign(state, { ...data, reasoningEffort: data.reasoningEffort }); break
        case 'sandbox/mode': state.sandbox = data.mode; break
        case 'approval/policy': state.approval = data.policy; break
        case 'plan/mode': state.plan = data.active; break
        case 'working-directory/change': state.cwd = data.cwd; break
      }
    }
    redraw()
  }

  async function selectSession(id) {
    const previous = { session, state, lastTool }
    session = harness.session(id)
    resetState()
    try {
      if (id) {
        session = await harness.resumeSession(id)
        state.cwd = await session.getWorkingDirectory()
      }
    } catch (error) {
      session = previous.session
      state = previous.state
      lastTool = previous.lastTool
      throw error
    }
  }

  async function applyMode(mode) {
    if (state.plan && !mode.plan) await runCommand('/plan off')
    await runCommand(`/permission ${mode.preset}`)
    if (mode.plan && !state.plan) await runCommand('/plan')
    if (!footer) out(dim(`权限 ${modeLabel()} · ${state.sandbox}`))
  }

  async function runCommand(command) {
    const result = await session.run(command)
    if (result.finishReason === 'error') throw new Error(result.finalResponse || command)
    return result.finalResponse
  }

  async function runTurn(text) {
    turn = new TurnDisplay()
    out(`\n${bold('> ')}${clean(text)}\n`)
    if (!footer) out(dim('· 等待模型响应…'))
    try {
      const result = await session.run(text, {
        onNotification(notification) {
          if (closing || notification.params.sessionId !== session.id) return
          if (notification.method === 'dsh-cli.stream') turn.stream(notification.params)
          if (notification.method === 'session.event') turn.event(notification.params.event, (tool) => { lastTool = tool })
        },
      })
      if (closing) return
      turn.endThinking()
      const answer = clean(result.finalResponse ?? '').trimEnd()
      if (result.finishReason === 'error') throw new Error(turn.error || answer || '运行失败')
      if (answer && answer !== turn.printedText) out(renderMarkdown(answer))
      const kind = result.finishReason
      const complete = !kind || ['completed', 'stop', 'success', 'ok'].includes(kind)
      const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
      out(dim(`└ ${complete ? '完成' : kind} · ${elapsed(turn.started)} · ${time}`))
    } catch (error) {
      if (!closing) {
        turn.endThinking()
        showError(error)
        out(dim(`└ 失败 · ${elapsed(turn.started)}`))
      }
    } finally {
      turn = null
      redraw()
    }
  }

  async function handleLine(line) {
    if (!line.trim()) return
    if (!line.startsWith('/')) { await runTurn(line); return }
    const [command, ...rest] = line.slice(1).split(/\s+/)
    const arg = rest.join(' ').trim()
    switch (command.toLowerCase()) {
      case 'exit':
      case 'quit':
        await close()
        return
      case 'help':
        out(HELP)
        return
      case 'mode': {
        if (!arg) { out(MODES.map((mode, i) => `  ${i + 1}. ${mode.label}${mode === currentMode() ? ' *' : ''}`).join('\n')); return }
        const mode = MODES.find((entry, i) => String(i + 1) === arg || entry.id === arg)
        if (!mode) throw new Error('用法 /mode <1–4>')
        await applyMode(mode)
        return
      }
      case 'plan':
        if (!arg || arg === 'off') await applyMode(arg === 'off' || state.plan ? MODES[0] : MODES[2])
        else { await applyMode(MODES[2]); await runTurn(line) }
        return
      case 'new':
        await selectSession()
        out(dim(`[new] ${shortId(session.id)}`))
        return
      case 'list':
        printSessions(cwd)
        return
      case 'resume': {
        const sessions = listSessions(cwd)
        const id = /^\d+$/.test(arg) ? sessions[Number(arg) - 1]?.id : (arg.startsWith('session-') ? arg : sessions.find((s) => shortId(s.id) === arg)?.id)
        if (!id) { out(red('no such session')); return }
        await selectSession(id)
        out(dim(`[resume] ${shortId(id)}`))
        return
      }
      case 'status':
        out(`会话 ${session.id}\n模型 ${oneLine(state.provider)}/${modelLabel()}\n权限 ${modeLabel()} · ${state.sandbox}\n工作区 ${cwd}\n当前目录 ${state.cwd}\n会话库 ${HOME}`)
        return
      case 'compact':
      case 'goal':
        await runTurn(line)
        return
      case 'permission':
        if (arg) await runTurn(line)
        else out(`权限 ${modeLabel()} · ${state.sandbox}\n${dim('/mode 查看权限模式')}`)
        return
      default:
        out(red(`未知命令 /${oneLine(command)} · /help 查看命令`))
    }
  }

  out(`\n${cyan('◆')} ${bold('DeepSeek Harness')} ${dim(`dsh-cli v${VERSION}`)}\n  ${dim(cwd)}\n`)
  if (input.raw) {
    footer = new TerminalFooter(process.stdout, { dim, accent: cyan }, () => {
      const phase = harness ? turn?.phase : 'startup'
      const started = turn?.started ?? launch
      const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'][Math.floor((performance.now() - started) / 90) % 10]
      const status = input.question ? '等待你的输入' : phase ? `${spinner} ${liveLabels[phase]} · ${elapsed(started)}` : ''
      return {
        status,
        preview: input.question ? '' : oneLine(turn?.preview ?? '').slice(-100),
        prompt: input.question || '> ', buffer: input.buffer, cursor: input.cursor,
        model: modelLabel(), permission: `${modeLabel()} · ${state.sandbox} · Shift+Tab`,
      }
    })
    footer.start()
  } else out(dim('正在启动运行时…'))
  const ticker = setInterval(() => { if (turn || !harness) redraw() }, 90)
  ticker.unref()
  try {
    harness = await createHarness(MODES[0], callbacks())
    const resumeId = cli.resume ?? (cli.continue ? listSessions(cwd)[0]?.id : null)
    await selectSession(resumeId ?? undefined)
    if (cli.mode) await applyMode(initialMode)
    out(dim(`就绪 · 会话 ${shortId(session.id)} · /help`))
    input.start()
    return await done
  } finally {
    await close()
  }
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
    dshBin: RUNTIME,
    dshHome: HOME,
    cwd: process.cwd(),
    provider: PROVIDER,
    model: MODEL,
    reasoningEffort: EFFORT,
    approvalRequests: false,
    initializeTimeoutMs: INIT_TIMEOUT,
    env: { ...process.env, DSH_PERMISSION_MODE: mode.sandbox },
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
  const cli = { mode: null, print: null, resume: null, continue: false, list: false, help: false, version: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--help' || a === '-h') cli.help = true
    else if (a === '--version' || a === '-v') cli.version = true
    else if (a === '--list' || a === '-l') cli.list = true
    else if (a === '--print' || a === '-p') cli.print = argv[++i] ?? ''
    else if (a === '--resume' || a === '-r') cli.resume = argv[++i] ?? null
    else if (a === '--continue' || a === '-c') cli.continue = true
    else if (a === '--mode') {
      cli.mode = argv[++i]
      if (!MODES.some((mode) => mode.id === cli.mode)) throw new Error('--mode <default|auto|plan|full>')
    }
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
  dsh-cli --splash        preview the full splash artwork
  dsh-cli --mode <mode>   default, auto, plan or full

keys
  shift+tab               cycle permission modes: 默认 -> 自动(工作区内) -> 计划 -> 完全访问
  ctrl+c / ctrl+d         interrupt and exit / exit
  ctrl+o                  expand the last tool output
  up/down                 input history

commands
  /mode [n]  /plan [off]  /permission [preset]  /new  /list
  /resume <n|id>  /status  /compact  /goal  /exit

environment
  DSH_CLI_PROVIDER / DSH_CLI_MODEL / DSH_CLI_EFFORT  configure the model route
  DSH_CLI_SHOW_REASONING=1                          show model reasoning text
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
    out(red(`! ${clean(process.env.DSH_CLI_DEBUG === '1' ? (error?.stack ?? error) : (error?.message ?? error))}`))
    process.exitCode = 1
  })
