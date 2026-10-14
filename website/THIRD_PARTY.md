# 网站使用的开源组件

网站将固定版本的浏览器文件一同发布，不在读者打开页面时连接 CDN。

| 组件 | 版本 | 用途 | 授权 |
| --- | --- | --- | --- |
| [Docsify](https://github.com/docsifyjs/docsify) | 4.13.1 | Markdown 页面、导航与搜索 | MIT |
| [Prism](https://github.com/PrismJS/prism) | 1.30.0 | TypeScript、TSX、命令与配置高亮 | MIT |
| [docsify-copy-code](https://github.com/jperasmus/docsify-copy-code) | 3.0.2 | 复制代码 | MIT |
| [docsify-pagination](https://github.com/imyelo/docsify-pagination) | 2.10.1 | 上下章节 | MIT |
| [docsify-toc](https://github.com/mrpotatoes/docsify-toc) | 1.1.0 | 本页二三级标题导航 | MIT（按随包 LICENSE；npm 元数据标为 ISC） |
| [docsify-sidebar-collapse](https://github.com/iPeng6/docsify-sidebar-collapse) | 1.3.5 | 折叠章节导航 | MIT |
| [Docsify zoom-image](https://docsify.js.org/#/plugins?id=zoom-image) / [medium-zoom](https://github.com/francoischalifour/medium-zoom) | 4.13.1 / 1.0.8 | 静态插图原地放大 | MIT |
| [docsify-gifcontrol](https://github.com/gbodigital/docsify-gifcontrol) | 0.2.1 | GIF 解码、播放与暂停 | MIT；内含 omggif、core-js、regenerator-runtime（MIT）及 gifler（Apache 2.0） |

授权文件保留在 `vendor/`。上游样式还包含 [Font Awesome Free](https://fontawesome.com/license/free) 图标（CC BY 4.0），本站播放按钮使用文字标识。

GIF 控件由本站接管初始化：点击才解码，切换动图或章节时释放旧播放器；暂停后保留当前帧，继续时从暂停处播放。上游加载器补充了取消入口，并关闭默认自动初始化。播放器修改与再生成方法见仓库 `scripts/vendor-gifcontrol.mjs`。

导航与图片插件做了本站适配：TOC 修正标题选择范围，使用本站响应式样式；侧栏去掉额外手机导航，用独立按钮展开章节；图片放大复用同一实例，切换页面前关闭，并补充转场完成保障与键盘操作。所有上游修改均在 `scripts/vendor-site.mjs` 中可重复生成；上游结构变化会使补丁明确报错。动图封面带 `data-no-zoom`，由播放控件管理。
