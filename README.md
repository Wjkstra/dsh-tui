# dsh-cli

**A Claude-style terminal client for DeepSeek Harness.**

The interactive terminal has a compact header and a fixed input area that shows the model, reasoning
effort, permission mode, and sandbox. A timer starts on submission and tracks live reasoning, reply,
and tool activity. The complete answer goes into the terminal scrollback.

## Usage

```powershell
dsh-cli                 # start here (asks to trust the folder on first use)
dsh-cli -c              # continue the most recent session in this folder
dsh-cli -r <id>         # resume a specific session
dsh-cli -p "prompt"     # one-shot, print the final answer
dsh-cli --list          # list sessions (including desktop-created ones)
dsh-cli --splash        # preview the splash only
```

| Key / command | Effect |
|---|---|
| `Shift+Tab` | permission cycles: default (ask) → auto (workspace) → plan (read-only) → full access |
| `Ctrl+O` | expand the last tool result in full |
| `Ctrl+C` / `Ctrl+D` | interrupt / exit |
| `/mode [n]` `/plan` `/new` `/list` `/resume <n|id>` `/status` `/compact` `/exit` | in-session commands |

Permission changes take effect in the current DSH session. Auto mode allows work within the workspace
and rejects escalation requests. Sessions live in `~/.dsh` and are shared with the desktop app.

Set `DSH_CLI_PROVIDER`, `DSH_CLI_MODEL`, or `DSH_CLI_EFFORT` to select a model route and reasoning effort.
Set `DSH_CLI_SHOW_REASONING=1` to display reasoning text supplied by the model.

## Workspace trust

The workspace is the directory you start in. The first use there asks whether to trust it and records the
answer in `~/.dsh-cli/trusted.json`.

## Splash

`--splash` uses dsh-tui's whale frames and block wordmark (MIT, by @lhh010), extracted into
`bin/splash-data.json` and rendered as true-colour half blocks. Narrow or short terminals degrade to
"whale + info" and then "whale + plain title".

## Plugin market

The package still declares `dsh.bundle` (composing dsh-tui's UI layer), so it can be installed from the
plugin market as a profile layer. `bin/dsh-cli` and the bundle are independent entry points: the former is
this line CLI, the latter provides the full-screen UI under `dsh --profile <name>`.

## Requirements

Node.js `^22.19 || >=24`; DSH runtime `0.2.2-rc.1` (installed locally in `~/.dsh-cli/node_modules`).
