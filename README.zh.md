# dsh-cli

**DeepSeek Harness 的终端客户端（Claude 风格）。**

v1.0 起是一个独立的行式 CLI：只追加输出、不做整屏 diff，因此在中文字体/旧控制台下也不会出现整屏错位。
启动时保留蓝色像素鲸鱼 + `DEEPSEEK HARNESS` 大字开屏。

## 使用

```powershell
dsh-cli                 # 在当前目录开始（首次会问是否信任该目录）
dsh-cli -c              # 继续本目录最近的会话
dsh-cli -r <id>         # 恢复指定会话
dsh-cli -p "问题"        # 单轮提问，只打印最终回答
dsh-cli --list          # 列出本目录会话（含桌面端创建的）
dsh-cli --splash        # 只预览开屏
```

按键与命令：

| 操作 | 作用 |
|---|---|
| `Shift+Tab` | 权限模式循环：默认（逐次询问）→ 自动（工作区内）→ 计划（只读）→ 完全访问 |
| `Ctrl+O` | 展开最近一次工具输出的完整内容 |
| `Ctrl+C` / `Ctrl+D` | 中断 / 退出 |
| `/mode [n]` `/plan` `/new` `/list` `/resume <n|id>` `/status` `/compact` `/exit` | 交互命令 |

权限模式映射到 DSH 的 `DSH_PERMISSION_MODE`（`workspace-write` / `read-only` / `danger-full-access`），
切换需要重启运行时并自动 `resumeSession` 同一会话。会话写入 `~/.dsh`，与桌面端共用。

## 目录与信任

工作区 = 启动时的当前目录。首次在该目录使用会询问是否信任，记录在 `~/.dsh-cli/trusted.json`。

## 开屏

开屏素材来自 dsh-tui 的像素鲸鱼帧与大字字形表（MIT，作者 @lhh010），已抽取为 `bin/splash-data.json`，
运行时按真彩半块渲染；窗口不足时依次降级为「鲸鱼+信息」「鲸鱼+单行标题」。

## 插件市场

仓库仍声明 `dsh.bundle`（组合 dsh-tui 的界面层），因此可以在插件市场安装为 profile 层；
`bin/dsh-cli` 与 bundle 是两条独立入口：前者是行式 CLI，后者在 `dsh --profile <name>` 下提供全屏界面。

## 环境要求

Node.js `^22.19 || >=24`；DSH 运行时 `0.2.2-rc.1`（本地安装于 `~/.dsh-cli/node_modules`）。
