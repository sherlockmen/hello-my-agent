# 网站使用的开源组件

网站将固定版本的浏览器文件一同发布，不在读者打开页面时连接 CDN。

| 组件 | 版本 | 用途 | 授权 |
| --- | --- | --- | --- |
| [Docsify](https://github.com/docsifyjs/docsify) | 4.13.1 | Markdown 页面、导航与搜索 | MIT |
| [Prism](https://github.com/PrismJS/prism) | 1.30.0 | TypeScript、TSX、命令与配置高亮 | MIT |
| [docsify-copy-code](https://github.com/jperasmus/docsify-copy-code) | 3.0.2 | 复制代码 | MIT |
| [docsify-pagination](https://github.com/imyelo/docsify-pagination) | 2.10.1 | 上下章节 | MIT |
| [docsify-gifcontrol](https://github.com/gbodigital/docsify-gifcontrol) | 0.2.1 | GIF 解码、播放与暂停 | MIT；内含 omggif、core-js、regenerator-runtime（MIT）及 gifler（Apache 2.0） |

授权文件保留在 `vendor/`。上游样式还包含 [Font Awesome Free](https://fontawesome.com/license/free) 图标（CC BY 4.0），本站播放按钮使用文字标识。

GIF 控件由本站接管初始化：点击才解码，切换动图或章节时释放旧播放器；暂停后保留当前帧，继续时从暂停处播放。上游加载器补充了取消入口，并关闭默认自动初始化。播放器修改与再生成方法见仓库 `scripts/vendor-gifcontrol.mjs`。
