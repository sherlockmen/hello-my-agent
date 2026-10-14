window.$docsify = {
  name: 'Hello, My Agent',
  nameLink: '#/',
  homepage: 'content/README.md',
  coverpage: '_coverpage.html',
  onlyCover: false,
  loadSidebar: true,
  loadNavbar: true,
  alias: { '/.*/_sidebar.md': '/_sidebar.md', '/.*/_navbar.md': '/_navbar.md' },
  subMaxLevel: 0,
  sidebarDisplayLevel: 0,
  toc: { headings: 'h2, h3', scope: '.markdown-section', title: '本页导航' },
  auto2top: true,
  mergeNavbar: true,
  maxLevel: 4,
  themeColor: '#16766b',
  externalLinkTarget: '_blank',
  search: {
    paths: 'auto',
    placeholder: '搜索教程',
    noData: '没有找到相关内容',
    depth: 3,
    namespace: 'hello-my-agent-tutorial-v1'
  },
  copyCode: { buttonText: '复制代码', errorText: '请手动复制', successText: '已复制' },
  pagination: { previousText: '上一节', nextText: '下一节', crossChapter: true, crossChapterText: true },
  gifcontrol: { mode: 'click', managed: true, iconColor: '#16766b', errorText: '动图加载失败，请重试' },
  plugins: [function (hook, vm) {
    hook.init(function () {
      // A slow cover request must not hide a chapter reached in the meantime.
      const renderCover = vm._renderCover;
      vm._renderCover = function (content, onlyCover) {
        if (content && this.route.path !== '/') return;
        return renderCover.call(this, content, onlyCover);
      };
    });
    hook.doneEach(function () {
      document.title = vm.route.path === '/'
        ? 'Hello, My Agent · 动手构建你的 Agent'
        : (document.querySelector('.markdown-section h1')?.textContent || '课程') + ' · Hello, My Agent';
      document.querySelector('.markdown-section')?.setAttribute('aria-label', '教程正文');
      const search = document.querySelector('.search input');
      if (search) search.setAttribute('aria-label', '搜索教程');
      const toggle = document.querySelector('.sidebar-toggle');
      if (toggle) toggle.setAttribute('aria-label', '打开或收起章节目录');
      document.querySelectorAll('.markdown-section img').forEach(image => { image.loading = 'lazy'; });
      document.querySelectorAll('.markdown-section a').forEach(link => {
        if (/\.(png|jpe?g|webp)$/i.test(link.pathname)) {
          link.removeAttribute('target');
        }
      });
    });
  }]
};
