#!/usr/bin/env node
/**
 * dsh-cli — a terminal front-end for DeepSeek Harness.
 *
 * It drives a real DSH runtime (`sdk` profile) over the official SDK JSON-RPC
 * protocol while reusing the desktop app's Harness home (~/.dsh). Sessions are
 * stored in the same session store the desktop app reads, so a conversation
 * started here shows up on the desktop side and vice versa.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline'

const VERSION = '0.2.0'
const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const CWD = process.env.DSH_CLI_CWD || process.cwd()
const DEFAULT_PROVIDER = process.env.DSH_CLI_PROVIDER || 'deepseek-account'
const DEFAULT_MODEL = process.env.DSH_CLI_MODEL || 'deepseek-flash'
const INIT_TIMEOUT = Number(process.env.DSH_CLI_INIT_TIMEOUT_MS || 180000)

const ansi = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code, text) => (ansi ? `\u001b[${code}m${text}\u001b[0m` : text)
const dim = (t) => paint('2', t)
const bold = (t) => paint('1', t)
const cyan = (t) => paint('36', t)
const green = (t) => paint('32', t)
const yellow = (t) => paint('33', t)
const red = (t) => paint('31', t)
const gray = (t) => paint('90', t)

// ---------------------------------------------------------------------------
// arguments
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {
    mode: 'repl',
    prompt: null,
    resume: null,
    cont: false,
    json: false,
    model: DEFAULT_MODEL,
    provider: DEFAULT_PROVIDER,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') out.mode = 'help'
    else if (arg === '--version' || arg === '-v') out.mode = 'version'
    else if (arg === '--print' || arg === '-p') out.prompt = argv[++i] ?? ''
    else if (arg === '--resume' || arg === '-r') out.resume = argv[++i] ?? null
    else if (arg === '--continue' || arg === '-c') out.cont = true
    else if (arg === '--list' || arg === '-l') out.mode = 'list'
    else if (arg === '--json') out.json = true
    else if (arg === '--model') out.model = argv[++i] ?? DEFAULT_MODEL
    else if (arg === '--provider') out.provider = argv[++i] ?? DEFAULT_PROVIDER
    else if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`)
    else if (out.prompt === null) out.prompt = arg
    else out.prompt += ` ${arg}`
  }
  if (out.prompt !== null) out.mode = 'oneshot'
  return out
}

const HELP = `${bold('dsh-cli')} ${VERSION} — DeepSeek Harness 终端会话

用法:
  dsh-cli                         进入交互式会话（当前目录作为 workspace）
  dsh-cli -p "问题"               单轮提问并输出最终回答
  dsh-cli -c                      继续当前目录最近的可用会话
  dsh-cli -r <session-id>         恢复指定会话（与桌面端共用会话库）
  dsh-cli --list                  列出当前 workspace 的会话

交互命令:
  /help  /new  /list  /resume <id|序号>  /cwd [目录]
  /model [名称]  /status  /exit
  其它斜杠命令（/compact、/plan、/goal ...）会原样交给 DSH 运行时。

环境变量:
  DSH_HOME                        Harness home（默认 ~/.dsh，与桌面端相同）
  DSH_CLI_PROVIDER/DSH_CLI_MODEL  模型路由（默认 deepseek-account / deepseek-flash）
  DSH_CLI_SHOW_REASONING=1        显示模型思考片段
  NO_COLOR                        禁用颜色
`

// ---------------------------------------------------------------------------
// session store helpers (shared with the desktop app)
// ---------------------------------------------------------------------------
function workspaceSlug(cwd) {
  const body = cwd.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `--${body}--`
}

function sessionDirsFor(cwd) {
  const dir = path.join(HOME, 'sessions', workspaceSlug(cwd))
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('session-'))
    .map((entry) => {
      const full = path.join(dir, entry.name)
      const log = path.join(full, 'session.v4.jsonl.zstd')
      let mtime = 0
      try { mtime = fs.statSync(log).mtimeMs } catch { /* not persisted yet */ }
      return { id: entry.name, dir: full, mtime }
    })
    .sort((a, b) => b.mtime - a.mtime)
}

function readProjection(id) {
  const file = path.join(HOME, 'storages', 'session_projcache', 'sessions', `${id}.json`)
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8')).record
    const title = record?.rows?.title?.val
    const firstPrompt = record?.rows?.titleInput?.val?.first?.text
    return { title: title || firstPrompt || '' }
  } catch {
    return { title: '' }
  }
}

function listSessions(cwd) {
  return sessionDirsFor(cwd).map((entry) => ({ ...entry, ...readProjection(entry.id) }))
}

const shortId = (id) => id.replace(/^session-/, '').slice(0, 8)

function formatTime(ms) {
  if (!ms) return '-'
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function resolveSessionRef(ref, cwd) {
  const sessions = listSessions(cwd)
  if (/^\d+$/.test(ref)) return sessions[Number(ref) - 1]?.id ?? null
  if (ref.startsWith('session-')) return ref
  return sessions.find((entry) => shortId(entry.id) === ref)?.id ?? null
}

function printSessions(cwd) {
  const sessions = listSessions(cwd)
  if (!sessions.length) {
    out(dim('当前 workspace 还没有会话'))
    return
  }
  out('')
  out(bold(`会话 (${cwd})`))
  sessions.forEach((entry, index) => {
    const title = (entry.title || '(无标题)').replace(/\s+/g, ' ').slice(0, 60)
    out(dim(`  ${String(index + 1).padStart(2)}. `) + gray(shortId(entry.id)) + `  ${formatTime(entry.mtime)}  ${title}`)
  })
  out(dim('  /resume <序号|id> 恢复；桌面端的会话同样出现在这里'))
  out('')
}

// ---------------------------------------------------------------------------
// output helpers
// ---------------------------------------------------------------------------
function out(text = '') {
  process.stdout.write(`${text}\n`)
}

class Spinner {
  constructor() {
    this.timer = null
    this.start = 0
  }
  begin(label) {
    if (!ansi) return
    this.start = Date.now()
    this.timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - this.start) / 1000)
      process.stdout.write(`\r${dim(`· ${label} ${seconds}s`)}\u001b[K`)
    }, 500)
  }
  end() {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
    if (ansi) process.stdout.write('\r\u001b[K')
  }
}

const spinner = new Spinner()

// ---------------------------------------------------------------------------
// event rendering
// ---------------------------------------------------------------------------
function summarizeArgs(raw) {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      const keys = ['path', 'file_path', 'command', 'query', 'url', 'goal', 'description', 'pattern', 'target']
      for (const key of keys) {
        if (typeof parsed[key] === 'string') {
          return `${key}: ${parsed[key].replace(/\s+/g, ' ').slice(0, 100)}`
        }
      }
      const first = Object.entries(parsed)[0]
      if (first) return `${first[0]}: ${String(first[1]).replace(/\s+/g, ' ').slice(0, 100)}`
    }
  } catch { /* keep the raw text */ }
  return (raw || '').replace(/\s+/g, ' ').slice(0, 100)
}

function resultText(message) {
  const blocks = Array.isArray(message?.content) ? message.content : []
  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

function createRenderer(sessionId, state) {
  const pendingCalls = new Map()

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
          out(dim(`  thinking · ${reasoning.replace(/\s+/g, ' ').slice(0, 400)}`))
        }
        if (text.trim()) {
          state.sawText = true
          out('')
          out(green('● ') + text.trimEnd())
        }
        break
      }
      case 'tool/call': {
        const data = event.data ?? {}
        pendingCalls.set(data.callId, data.name)
        out('')
        out(yellow('⚙ ') + bold(data.name ?? 'tool') + dim(` ${summarizeArgs(data.arguments)}`))
        break
      }
      case 'tool/result': {
        const data = event.data ?? {}
        const name = pendingCalls.get(data.message?.toolCallId) ?? ''
        pendingCalls.delete(data.message?.toolCallId)
        const body = resultText(data.message).replace(/\s+/g, ' ').slice(0, 160)
        const failed = data.message?.isError
        out((failed ? red('  ✗ ') : green('  ✓ ')) + dim(`${name}${body ? ` — ${body}` : ''}`))
        break
      }
      case 'turn/end': {
        const kind = event.data?.reason?.kind
        if (kind && kind !== 'completed' && kind !== 'stop') out(dim(`  turn ended: ${kind}`))
        break
      }
      case 'session/title':
        if (event.data?.title) state.title = event.data.title
        break
      default:
        break
    }
  }
}

// ---------------------------------------------------------------------------
// input hub: one queue shared by the REPL, approvals and user questions
// ---------------------------------------------------------------------------
class InputHub {
  constructor(rl) {
    this.queue = []
    this.waiters = []
    this.closed = false
    rl.on('line', (line) => {
      const waiter = this.waiters.shift()
      if (waiter) waiter(line)
      else this.queue.push(line)
    })
    rl.on('close', () => {
      this.closed = true
      while (this.waiters.length) this.waiters.shift()(null)
    })
  }

  async read(promptText = '') {
    if (!this.queue.length) process.stdout.write(promptText)
    if (this.queue.length) return this.queue.shift()
    if (this.closed) return null
    return new Promise((resolve) => this.waiters.push(resolve))
  }
}

async function answerQuestion(request, hub) {
  const questions = Array.isArray(request.questions) ? request.questions : []
  const answers = []
  for (const question of questions) {
    out('')
    out(yellow('? ') + bold(question.question ?? question.header ?? 'question'))
    const options = Array.isArray(question.options) ? question.options : []
    options.forEach((option, index) => {
      out(dim(`  ${index + 1}. `) + (option.label ?? '') + (option.description ? dim(` — ${option.description}`) : ''))
    })
    if (options.length) out(dim('  也可直接输入自定义回答；回车跳过'))
    const raw = ((await hub.read(dim('  回答: '))) ?? '').trim()
    if (!raw) {
      answers.push({ id: question.id, selected: [], custom: '' })
      continue
    }
    const indexes = raw
      .split(/[,\s]+/)
      .map((part) => Number(part))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= options.length)
    if (options.length && indexes.length) {
      answers.push({ id: question.id, selected: indexes.map((n) => options[n - 1].label) })
    } else {
      answers.push({ id: question.id, selected: [], custom: raw })
    }
  }
  return { answers }
}

async function answerApproval(params, hub) {
  out('')
  out(yellow('⚑ ') + `需要批准: ${bold(params.toolName ?? 'tool')}` + (params.reason ? dim(` — ${params.reason}`) : ''))
  const answer = ((await hub.read(dim('  允许本次执行? [y/N] '))) ?? '').trim().toLowerCase()
  return { outcome: answer === 'y' || answer === 'yes' ? 'allowed-once' : 'rejected' }
}

// ---------------------------------------------------------------------------
// errors and session opening
// ---------------------------------------------------------------------------
function friendlyError(error) {
  const message = String(error?.message ?? error)
  if (/active write handle/i.test(message)) {
    return '该会话正被桌面端占用：同一会话同一时刻只能有一个写入方。请先在桌面端关闭它（或退出应用），再用 /resume 继续。'
  }
  if (/not found/i.test(message) && /session/i.test(message)) {
    return `会话不存在或已删除。${message}`
  }
  return message
}

async function openSession(harness, preferredId, { fallback = true } = {}) {
  const candidates = []
  if (preferredId) candidates.push(preferredId)
  if (fallback) {
    for (const entry of listSessions(CWD)) {
      if (!candidates.includes(entry.id)) candidates.push(entry.id)
    }
  }
  let lastError = null
  for (const id of candidates.slice(0, 8)) {
    try {
      return { session: await harness.resumeSession(id), resumed: id }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error('没有可恢复的会话')
}

async function withHarness(options, fn) {
  const { DeepSeekHarness } = await import('@deepseek-ai/dsh-sdk-client')
  const hub = options.hub ?? null
  const harness = new DeepSeekHarness({
    dshHome: HOME,
    cwd: CWD,
    provider: options.provider,
    model: options.model,
    approvalRequests: Boolean(hub),
    initializeTimeoutMs: INIT_TIMEOUT,
    onUserQuestion: hub ? (request) => answerQuestion(request, hub) : undefined,
  })
  try {
    if (hub) {
      await harness.client.start()
      harness.client.onRequest(async (method, params) => {
        if (method === 'approval/request') return answerApproval(params, hub)
        throw new Error(`unsupported request: ${method}`)
      })
    }
    await harness.start()
    return await fn(harness)
  } finally {
    spinner.end()
    await harness.close()
  }
}

// ---------------------------------------------------------------------------
// one-shot mode
// ---------------------------------------------------------------------------
async function runOneshot(cli) {
  const requestedId = cli.resume ?? (cli.cont ? listSessions(CWD)[0]?.id : null)
  return withHarness({ provider: cli.provider, model: cli.model, hub: null }, async (harness) => {
    const session = requestedId
      ? (await openSession(harness, requestedId)).session
      : harness.session()
    const result = await session.run(cli.prompt, { onNotification: () => {} })
    if (cli.json) {
      out(JSON.stringify({
        sessionId: result.sessionId,
        finishReason: result.finishReason,
        finalResponse: result.finalResponse,
      }, null, 2))
    } else {
      out(result.finalResponse)
      out(dim(`会话 ${shortId(result.sessionId)} 已写入 ${path.join(HOME, 'sessions')}（与桌面端共用）`))
    }
    return result.finishReason === 'error' ? 1 : 0
  })
}

// ---------------------------------------------------------------------------
// interactive mode
// ---------------------------------------------------------------------------
async function runRepl(cli) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const hub = new InputHub(rl)

  let harness = null
  let session = null
  let provider = cli.provider
  let model = cli.model
  const state = { sawText: false, title: '' }

  async function ensureHarness() {
    if (harness) return
    const { DeepSeekHarness } = await import('@deepseek-ai/dsh-sdk-client')
    harness = new DeepSeekHarness({
      dshHome: HOME,
      cwd: CWD,
      provider,
      model,
      approvalRequests: true,
      initializeTimeoutMs: INIT_TIMEOUT,
      onUserQuestion: (request) => answerQuestion(request, hub),
    })
    await harness.client.start()
    harness.client.onRequest(async (method, params) => {
      if (method === 'approval/request') return answerApproval(params, hub)
      throw new Error(`unsupported request: ${method}`)
    })
    await harness.start()
  }

  async function startSession(id, options = {}) {
    await ensureHarness()
    session = id ? (await openSession(harness, id, options)).session : harness.session()
    state.sawText = false
    return session
  }

  function banner() {
    out('')
    out(bold('dsh-cli ') + dim(VERSION) + dim('  ·  ') + gray(CWD))
    out(dim(`model ${provider}/${model}  ·  home ${HOME}`))
    if (session) out(dim(`session ${session.id}`))
    out(dim('/help 查看命令  ·  /exit 退出'))
    out('')
  }

  async function turn(input) {
    state.sawText = false
    const render = createRenderer(session.id, state)
    spinner.begin('thinking')
    try {
      const result = await session.run(input, { onNotification: render })
      spinner.end()
      if (!state.sawText && result.finalResponse?.trim()) out(green('● ') + result.finalResponse.trimEnd())
      if (result.finishReason && !['completed', 'stop'].includes(result.finishReason)) {
        out(dim(`  [${result.finishReason}]`))
      }
      return result
    } catch (error) {
      spinner.end()
      out(red('✗ ') + friendlyError(error))
      return null
    }
  }

  const initialId = cli.resume ?? (cli.cont ? listSessions(CWD)[0]?.id : null)
  await ensureHarness()
  await startSession(initialId ?? null, { fallback: Boolean(cli.cont) })
  if (cli.cont && initialId && session.id !== initialId) {
    out(dim(`（最近会话被占用或已删除，已改恢复 ${shortId(session.id)}）`))
  }
  banner()

  if (cli.prompt) {
    await turn(cli.prompt)
    rl.close()
    await harness?.close()
    return 0
  }

  for (;;) {
    const raw = await hub.read(cyan('› '))
    if (raw === null) break
    const line = raw.trim()
    if (!line) continue

    try {
      if (!line.startsWith('/')) {
        await turn(line)
        continue
      }

      const [command, ...rest] = line.slice(1).split(/\s+/)
      const argument = rest.join(' ').trim()

      switch (command.toLowerCase()) {
        case 'exit':
        case 'quit':
        case 'q':
          rl.close()
          await harness?.close()
          return 0
        case 'help':
          out(HELP)
          continue
        case 'new':
          await startSession(null)
          out(dim(`新会话 ${session.id}`))
          continue
        case 'list':
          printSessions(CWD)
          continue
        case 'resume': {
          if (!argument) {
            printSessions(CWD)
            out(dim('用 /resume <序号|id> 恢复'))
            continue
          }
          const id = resolveSessionRef(argument, CWD)
          if (!id) {
            out(red('✗ ') + `找不到会话: ${argument}`)
            continue
          }
          try {
            await startSession(id, { fallback: false })
            out(dim(`已恢复 ${session.id}`))
          } catch (error) {
            out(red('✗ ') + friendlyError(error))
          }
          continue
        }
        case 'cwd': {
          if (!argument) {
            out(gray(CWD))
            continue
          }
          const target = path.resolve(CWD, argument)
          try {
            await session.setWorkingDirectory(target)
            out(dim(`工作目录 -> ${target}`))
          } catch (error) {
            out(red('✗ ') + friendlyError(error))
          }
          continue
        }
        case 'model': {
          if (!argument) {
            out(dim(`${provider}/${model}`))
            continue
          }
          if (argument === model) {
            out(dim(`已经是 ${provider}/${model}`))
            continue
          }
          const currentId = session?.id
          const onDisk = currentId
            ? fs.existsSync(path.join(HOME, 'sessions', workspaceSlug(CWD), currentId))
            : false
          const previous = model
          const reopen = async (nextModel) => {
            await harness?.close()
            harness = null
            model = nextModel
            await ensureHarness()
            if (onDisk && currentId) {
              try {
                session = await harness.resumeSession(currentId)
                return
              } catch { /* fall through to a fresh session */ }
            }
            session = harness.session()
          }
          try {
            await reopen(argument)
            out(dim(`模型 -> ${provider}/${model}（会话 ${shortId(session.id)}）`))
          } catch (error) {
            out(red('✗ ') + `模型切换失败: ${friendlyError(error)}`)
            try {
              await reopen(previous)
              out(dim(`已回退到 ${provider}/${model}`))
            } catch (rollbackError) {
              out(red('✗ ') + `回退失败，请重启 dsh-cli: ${friendlyError(rollbackError)}`)
              rl.close()
              return 1
            }
          }
          continue
        }
        case 'status':
          out(dim(`session ${session.id}  ·  model ${provider}/${model}  ·  cwd ${CWD}`))
          out(dim(`store ${path.join(HOME, 'sessions', workspaceSlug(CWD))}`))
          continue
        default:
          break
      }

      if (['compact', 'plan', 'goal', 'permission', 'sandbox', 'init'].includes(command.toLowerCase())) {
        await turn(line)
        continue
      }
      out(red('✗ ') + `未知命令: /${command}（/help 查看）`)
    } catch (error) {
      out(red('✗ ') + friendlyError(error))
    }
  }

  rl.close()
  await harness?.close()
  return 0
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  let cli
  try {
    cli = parseArgs(process.argv.slice(2))
  } catch (error) {
    out(red('✗ ') + String(error.message))
    out(HELP)
    return 2
  }

  if (cli.mode === 'help') { out(HELP); return 0 }
  if (cli.mode === 'version') { out(`dsh-cli ${VERSION}`); return 0 }
  if (cli.mode === 'list') { printSessions(CWD); return 0 }

  if (!process.stdin.isTTY && cli.mode === 'repl' && process.env.DSH_CLI_FORCE_REPL !== '1') {
    const chunks = []
    for await (const chunk of process.stdin) chunks.push(chunk)
    cli.prompt = Buffer.concat(chunks).toString('utf8').trim()
    if (!cli.prompt) { out(HELP); return 0 }
    cli.mode = 'oneshot'
  }

  return cli.mode === 'oneshot' ? runOneshot(cli) : runRepl(cli)
}

process.on('SIGINT', () => {
  spinner.end()
  out('')
  out(dim('已中断（会话历史已保存）'))
  process.exit(130)
})

main()
  .then((code) => { if (typeof code === 'number') process.exitCode = code })
  .catch((error) => {
    spinner.end()
    out(red('✗ ') + friendlyError(error))
    if (process.env.DSH_CLI_DEBUG === '1') out(dim(String(error?.stack ?? error)))
    process.exitCode = 1
  })
