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

终端界面层来自 `@deepseek-harness-tui/dsh-tui@0.19.0` 的 patch。该 patch 里有两条针对
DSH 0.1.x 的遗留行（`@deepseek-ai/dsh-code-runtime-worker-thread`、`@deepseek-ai/dsh-agent-presets`），
在 0.2.2-rc.1 上不存在。`--dump-config` 组合正常（119 行、无告警），但
`--dump-config-schema` 会报这两条 import 失败。若真实终端启动报缺包，需要把这两条行
从 `vendor/dsh-tui/cordis.patch.yml` 中移除后再发版。
