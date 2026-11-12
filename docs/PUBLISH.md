# dsh-cli 上架状态

- 仓库：<https://github.com/Wjkstra/dsh-tui>
- 最新版本：`0.1.2`（Git 标签 `v0.1.2`）
- 市场索引：<https://raw.githubusercontent.com/Wjkstra/dsh-tui/main/docs/index.json>

索引由官方生成器产出，已包含 `dsh-cli` 条目（图标、中英文案、作者、来源提交、兼容声明）。
GitHub Pages 未开启，也不需要：DSH 只要求索引是一个可访问的 https URL。

## 在 DSH 中添加索引

桌面端需要挂载插件市场服务（`@deepseek-ai/dsh-plugin-market-bundle`）后，「插件 → 发现 →
索引来源 → 添加」填入上面的 index.json 地址，即可安装 `dsh-cli` 到任意 profile。

对应的 Host 配置键（`plugin-market` 行）：

```yaml
- id: plugin-market
  config:
    indexes:
      - https://raw.githubusercontent.com/Wjkstra/dsh-tui/main/docs/index.json
```

## 发新版

```bash
# 改 package.json 的 version，然后
git commit -am "release: x.y.z"
git tag -a vX.Y.Z -m "dsh-cli X.Y.Z"
git push origin main --tags

# 重新生成索引并提交
cd D:\apps\deep\deepseek-harness
pnpm --filter @deepseek-ai/dsh-plugin-market-generator start \
  --input C:\Users\wjping19\dsh-cli-pkg\plugins.txt \
  --output C:\Users\wjping19\dsh-cli-pkg\docs\index.json \
  --title "dsh-cli Market" --description "Terminal front door for DeepSeek Harness"
cd C:\Users\wjping19\dsh-cli-pkg && git add docs/index.json && git commit -m "chore: market index" && git push
```

## 已知风险

终端界面层来自 `@deepseek-harness-tui/dsh-tui@0.19.0` 的 patch。它带有两条 DSH 0.1.x 的兜底行
（`@deepseek-ai/dsh-code-runtime-worker-thread`、`@deepseek-ai/dsh-agent-presets`）。这两条在
0.2.2 上只能靠 `require.resolve` 探测来禁用，而 bundle 目录解析不到宿主包，会误启用并导致
`Cannot find package`。0.1.3 起已从 `vendor/dsh-tui/cordis.patch.yml` 中移除这两条（0.2.2 已无对应概念）。

验证：`dsh --profile <p> --dump-config` 组合通过；`--dump-config-schema` 不再报缺包，
但退出码仍为 1 —— 因为 TUI 的若干 `config` 使用 transform 回调，schema dump 无法投影（仅 warning）。