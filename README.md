# dsh-cli

**Terminal front door for DeepSeek Harness (DSH).**

This package is a DSH **bundle**: installing it into a profile composes the terminal UI for that
profile, and the same package ships the `dsh-cli` launcher for plain-terminal use. Sessions live in
the shared Harness home (`~/.dsh`), so terminal sessions and the desktop app see the same history.

## Install from the plugin market

1. In the desktop app open **Plugins → Discover**, add the market index URL (the `index.json`
   published from this repository), then install `dsh-cli` into a profile.
2. Start the terminal profile:

   ```sh
   dsh --profile <profile-name>
   ```

## Install the launcher only

```sh
npm install -g dsh-cli
dsh-cli                  # interactive session in the current directory
dsh-cli -p "explain this repo"
dsh-cli -c               # continue the most recent session
dsh-cli --list           # list sessions, including desktop ones
```

## How the bundle is composed

`package.json` declares:

```json
"dsh": {
  "bundle": {
    "patch": [
      "./cordis.patch.yml",
      "./node_modules/@deepseek-harness-tui/dsh-tui/cordis.patch.yml"
    ]
  }
}
```

- `./cordis.patch.yml` is this package's own layer (currently empty, reserved for overrides).
- The second entry is the terminal front-end layer, taken from the
  [`@deepseek-harness-tui/dsh-tui`](https://github.com/ccch1mneyyy/dsh-TUI) dependency instead of
  being copied here, so its patch and plugins stay authoritative and updates arrive through the
  dependency.

## Sessions and interop

- Session logs: `<DSH_HOME>/sessions/<workspace-slug>/session-<id>/session.v4.jsonl.zstd`
- Projection metadata: `<DSH_HOME>/storages/session_projcache/sessions/<id>.json`
- The desktop app and this CLI read and write the same two places, so `dsh-cli --list` shows
  desktop sessions and desktop sessions appear after the client re-reads the workspace.
- One writer per session at a time: a session open in the desktop app cannot be resumed by the CLI
  until it is closed there (and vice versa).

## Requirements

- Node.js `^22.19 || >=24`
- DSH `0.2.2-rc.1` (the bundle declares its compatibility through the base profile it composes)

## License

MIT. The terminal UI layer is provided by `@deepseek-harness-tui/dsh-tui` (MIT, © chimney) and is
used as a dependency, not vendored.
