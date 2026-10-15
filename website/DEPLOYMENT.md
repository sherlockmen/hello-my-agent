# 教程网站的维护

正文继续在各章节的 Markdown 中编辑。网站构建时自动收集章节、练习、引用图片和源码页，无需复制正文到另一份目录。可运行的配套源码、原生 Markdown 与配图保存在 [master 分支](https://github.com/sherlockmen/hello-my-agent/tree/master)，读者按环境准备页取得。Docsify 外壳、插件、发布脚本与完整教学内容另存于 [codex/teaching-site 分支](https://github.com/sherlockmen/hello-my-agent/tree/codex/teaching-site)；生成的公开网站由 `gh-pages` 发布。

先在网站分支的独立工作区操作，下面的 `site:*` 命令只存在于该分支。不要在已有源码工作区直接切换分支覆盖文件。

```bash
git clone --branch codex/teaching-site --single-branch https://github.com/sherlockmen/hello-my-agent.git hello-my-agent-site
cd hello-my-agent-site
npm ci
```

```bash
npm run site:build
npm run site:check
npm run site:serve
```

本地打开 `http://127.0.0.1:4173/hello-my-agent/`。这个路径与 GitHub Pages 的项目子目录一致，可提前发现路径错误。

确认内容后发布：

```bash
npm run site:deploy
```

发布命令先把经过筛选的完整教学源码同步到 `codex/teaching-site`，再把生成的网站发布到 `gh-pages`。操作在临时目录中完成，不切换当前工作区，也不提交或推送 `master`；需要现有 GitHub 登录有此仓库的推送权限。首次发布也会启用 Pages，使用 `gh-pages` 根目录。线上地址为 <https://sherlockmen.github.io/hello-my-agent/>。

只同步配套源码时可运行 `npm run site:source`。网站和配套快照都由当前网站工作区生成，因此发布前先同步已确认的正文和代码。同步 `master` 的章节目录、验收脚本、`scripts/compile.mjs` 和公开文档；`package.json` 只同步课程命令和依赖，保留网站分支的 `site:*` 命令。两分支的 `.gitignore` 分别维护，不用整分支合并来同步课程。

`website/` 是网站外壳和固定版本插件，`scripts/build-site.mjs` 生成 `site-dist/`。`site-dist/` 不加入当前分支；部署时仅发布生成目录中的公开教学内容。私有编审记录、`.work`、环境变量、未引用的图片候选稿和依赖目录不会发布。

网站中的 GIF 默认是静态封面；点击图上的按钮后播放，再点暂停，再点从暂停处继续。切换到另一张图时释放旧播放器，返回原图会从头播放。现有 Markdown 的下方播放控件保持原样。

代码支持 TypeScript / TSX / Bash / JSON 等高亮与复制；保留原文中的展开/收起代码块。源码链接会进入站内可阅读的代码页。

章节目录默认收起，点击章节旁的箭头可展开，章节名称仍直接进入概览。当前章节自动展开。长文右侧提供“本页导航”，窄屏下可在正文开头展开导航；点击可跳到对应二三级标题，阅读时同步标记当前位置。

静态插图点击或按 Enter / 空格可原地放大；再次点击、点击关闭按钮或按 Esc 返回正文。动图继续使用图上的播放与暂停按钮。

浏览器资源固定版本后保存在 `website/vendor/`，读者打开网站时不依赖 CDN。重新获取时运行：

```bash
node scripts/vendor-site.mjs
node scripts/vendor-gifcontrol.mjs
```

授权与来源见 [THIRD_PARTY.md](THIRD_PARTY.md)。
