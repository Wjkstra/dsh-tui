# 发布到插件市场（dsh-cli）

DSH 的「发现」页只读取**索引（index.json）**，索引条目是本仓库这样的 bundle 包。官方市场尚未上线，
所以发布 = 把仓库推上 Gitee/GitHub + 托管一份 index.json + 在桌面端添加该索引地址。

## 0. 前置

- 仓库已就绪（本地已 `git init` 并打了 `v0.1.0` 标签）。
- 生成索引需要 `pnpm` 与 DSH 源码 checkout：`D:\apps\deep\deepseek-harness`。

## 1. 创建远程仓库并推送

```bash
cd C:\Users\wjping19\dsh-cli-pkg
git remote add origin https://gitee.com/wjping19/dsh-cli.git   # 先在 Gitee 网页建空仓库
git push -u origin master --tags
```

> 版本号来自 Git 标签：`v0.1.0`。以后发新版改 `package.json` 的 version 并打同名标签。

## 2. 生成市场索引

在 checkout 里运行（`--input` 就是本仓库的 `plugins.txt`）：

```powershell
cd D:\apps\deep\deepseek-harness
pnpm --filter @deepseek-ai/dsh-plugin-market-generator start `
  --input C:\Users\wjping19\dsh-cli-pkg\plugins.txt `
  --output C:\Users\wjping19\dsh-cli-pkg\docs\index.json `
  --title "dsh-cli Market" `
  --description "Terminal front door for DeepSeek Harness"
```

成功后 `docs/index.json` 里会出现 `dsh-cli` 的条目（名称、版本、图标、作者、兼容范围）。
把 `docs/index.json` 提交并推送：

```bash
cd C:\Users\wjping19\dsh-cli-pkg
git add docs/index.json && git commit -m "chore: publish market index" && git push
```

## 3. 托管 index.json（二选一）

- **GitHub Pages**：仓库 Settings → Pages → Source 选 `master` / `/docs`，得到
  `https://<user>.github.io/dsh-cli/index.json`
- **Gitee Pages**：仓库「服务 → Gitee Pages」开启（需实名），得到
  `https://wjping19.gitee.io/dsh-cli/index.json`

## 4. 在 DSH 里添加索引并安装

桌面端 **插件 → 发现 → 索引来源 → 添加**，填入上面的 URL；刷新后即可看到 `dsh-cli`，
安装到任意 profile，然后：

```powershell
dsh --profile <该 profile>      # 进入终端界面
```

## 5. 可选的 npm 分发

如果之后拿到 npm 账号（且 `registry.npmjs.org` 可达）：

```bash
npm publish --access public
npm install -g dsh-cli
dsh-cli
```

## 备注

- bundle 组合：本包 patch 只有一层空层，终端界面层直接引用依赖
  `@deepseek-harness-tui/dsh-tui` 的 `cordis.patch.yml`（MIT，未复制代码）。
- 兼容性：`@deepseek-ai/dsh` 依赖钉在 `0.2.2-rc.1`，与目标桌面版一致。
- 索引生成器会读取默认分支与标签；私有仓库需要你的 Git 凭据可用。
