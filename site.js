window.$docsify = {
  name: 'Hello, My Agent',
  nameLink: '#/',
  homepage: 'content/README.md',
  loadSidebar: true,
  loadNavbar: true,
  alias: { '/.*/_sidebar.md': '/_sidebar.md', '/.*/_navbar.md': '/_navbar.md' },
  subMaxLevel: 2,
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
    hook.doneEach(function () {
      document.title = (document.querySelector('.markdown-section h1')?.textContent || 'Hello, My Agent') + ' · Hello, My Agent';
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
