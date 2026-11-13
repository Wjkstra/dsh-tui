// The SDK forwards durable events. This launch-only overlay forwards transient
// assistant chunks on the same newline-delimited JSON-RPC stream.
function notify(method, sessionId, data) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method, params: { sessionId, ...data } })}\n`)
}

export function apply(ctx) {
  // Resolve the same route the SDK initializes so its default effort is visible
  // before opening a session. The request header remains authoritative.
  if (process.env.DSH_CLI_ROUTE) setImmediate(async () => {
    try {
      await ctx.get('loader')?.await()
      const route = JSON.parse(process.env.DSH_CLI_ROUTE)
      const selection = await ctx.get('llm').resolveCallConfig(route)
      notify('dsh-cli.config', null, { selection, preset: ctx.get('permissionPresets')?.defaultPreset })
    } catch { /* The SDK reports initialize failures. */ }
  })

  ctx.on('agent/created', ({ agent }) => {
    const { session } = agent
    notify('dsh-cli.state', session.id, {
      selection: agent.model.current(),
      sandbox: ctx.get('sandboxPolicy')?.resolve({ session }).mode,
      approval: ctx.get('approval')?.effectivePolicy(session),
      plan: ctx.get('planMode')?.loggedActive(session),
    })
  }, { global: true })

  if (process.env.DSH_CLI_LIVE_UI !== '1') return
  const showReasoning = process.env.DSH_CLI_SHOW_REASONING === '1'
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (frame.type === 'start') {
      notify('dsh-cli.stream', agent.session.id, { phase: 'waiting' })
      return
    }
    if (frame.type !== 'chunk') return
    const { chunk } = frame
    if (chunk.type === 'text-delta' && chunk.text) {
      notify('dsh-cli.stream', agent.session.id, { phase: 'answer', text: chunk.text })
    } else if (chunk.type === 'reasoning-delta' && chunk.text) {
      notify('dsh-cli.stream', agent.session.id, { phase: 'thinking', ...(showReasoning ? { text: chunk.text } : {}) })
    } else if (chunk.type === 'tool-call-delta' && chunk.name) {
      notify('dsh-cli.stream', agent.session.id, { phase: 'preparingTool' })
    }
  }, { global: true })
}
