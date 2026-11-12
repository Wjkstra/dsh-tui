# dsh-cli

**DeepSeek Harness（DSH）的终端入口。**

本包是一个 DSH **bundle**：装进 profile 后会把该 profile 组合成终端界面；同一个包还附带
`dsh-cli` 启动命令，可在普通终端里直接使用。会话存放在共享的 Harness home（`~/.dsh`），
终端会话与桌面端看到的是同一份历史。

## 从插件市场安装

1. 桌面端打开 **插件 → 发现**，添加本仓库发布的 `index.json` 索引地址，然后把 `dsh-cli`
   安装到某个 profile。
2. 启动终端 profile：

   ```sh
   dsh --profile <profile-name>
   ```

## 只安装启动命令

```sh
npm install -g dsh-cli
dsh-cli                  # 在当前目录开始交互式会话
dsh-cli -p "解释这个仓库"
dsh-cli -c               # 继续最近的会话
dsh-cli --list           # 列出会话（含桌面端创建的）
```

## bundle 如何组合

`package.json` 声明：

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

- `./cordis.patch.yml` 是本包自己的层（目前为空，留给后续覆盖项）。
- 第二项是终端前端层，直接取自
  [`@deepseek-harness-tui/dsh-tui`](https://github.com/ccch1mneyyy/dsh-TUI) 依赖，
  而不是把它的代码复制进来：其 patch 与插件保持唯一权威，升级通过依赖获得。

## 会话与互通

- 会话日志：`<DSH_HOME>/sessions/<workspace-slug>/session-<id>/session.v4.jsonl.zstd`
- 投影元数据：`<DSH_HOME>/storages/session_projcache/sessions/<id>.json`
- 桌面端与本 CLI 读写同样两处：`dsh-cli --list` 能看到桌面端会话，桌面端重新读取 workspace
  后也能看到 CLI 会话。
- 同一会话同一时刻只能有一个写入方：桌面端打开着的会话，CLI 需等它关闭后再 `/resume`，
  反之亦然。

## 环境要求

- Node.js `^22.19 || >=24`
- DSH `0.2.2-rc.1`（通过所组合的 base profile 声明兼容性）

## 许可

MIT。终端界面层由 `@deepseek-harness-tui/dsh-tui`（MIT，© chimney）以依赖形式提供，
本包不内联其代码。
