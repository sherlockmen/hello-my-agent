# 教程网站的维护

正文继续在各章节的 Markdown 中编辑。网站构建时自动收集章节、练习、引用图片和源码页，无需复制正文到另一份目录。公开的配套源码和网站维护文件保存在 [codex/teaching-site 分支](https://github.com/sherlockmen/hello-my-agent/tree/codex/teaching-site)，新电脑可按环境准备页的命令取得完整版本。

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

只同步配套源码时可运行 `npm run site:source`。网站和源码都由当前工作区的文件生成，因此发布前先确认正文与代码已经完成。

`website/` 是网站外壳和固定版本插件，`scripts/build-site.mjs` 生成 `site-dist/`。`site-dist/` 不加入当前分支；部署时仅发布生成目录中的公开教学内容。私有编审记录、`.work`、环境变量、未引用的图片候选稿和依赖目录不会发布。

网站中的 GIF 默认是静态封面；点击图上的按钮后播放，再点暂停，再点从暂停处继续。切换到另一张图时释放旧播放器，返回原图会从头播放。现有 Markdown 的下方播放控件保持原样。

代码支持 TypeScript / TSX / Bash / JSON 等高亮与复制；保留原文中的展开/收起代码块。源码链接会进入站内可阅读的代码页。

浏览器资源固定版本后保存在 `website/vendor/`，读者打开网站时不依赖 CDN。重新获取时运行：

```bash
node scripts/vendor-site.mjs
node scripts/vendor-gifcontrol.mjs
```

授权与来源见 [THIRD_PARTY.md](THIRD_PARTY.md)。
