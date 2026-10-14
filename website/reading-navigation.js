(function () {
  'use strict';

  const wide = window.matchMedia('(min-width: 1280px)');
  let sidebarObserver = null;
  let contentObserver = null;
  let headings = [];
  let links = new Map();
  let disclosure = null;
  let tocViewport = null;
  let activeHeading = null;
  let scrollFrame = 0;

  function routePath(hash) {
    try { return decodeURIComponent(hash.split('?')[0]).replace(/\.md$/, '').replace(/\/$/, ''); }
    catch { return hash.split('?')[0]; }
  }

  function syncSidebar() {
    document.querySelectorAll('.sidebar-nav button[data-sidebar-toggle]').forEach(button => {
      const folder = button.parentElement;
      const expanded = (folder.classList.contains('open') || folder.classList.contains('active'))
        && !folder.classList.contains('collapse');
      button.setAttribute('aria-expanded', String(expanded));
      button.setAttribute('aria-label', `${expanded ? '收起' : '展开'}${button.dataset.folderTitle}目录`);
    });
  }

  function revealCurrentSidebar() {
    const sidebar = document.querySelector('.sidebar-nav');
    const scroller = sidebar?.closest('.sidebar');
    const current = sidebar && Array.from(sidebar.querySelectorAll('a'))
      .find(link => routePath(link.hash) === routePath(location.hash));
    if (!current || !scroller) return;
    const item = current.getBoundingClientRect();
    const viewport = scroller.getBoundingClientRect();
    if (item.top < viewport.top + 12 || item.bottom > viewport.bottom - 64) {
      scroller.scrollTop += item.top - viewport.top - 80;
    }
  }

  function attachSidebar() {
    const sidebar = document.querySelector('.sidebar-nav');
    if (!sidebar) return;
    sidebar.setAttribute('aria-label', '课程章节');
    sidebar.querySelectorAll('li').forEach((folder, index) => {
      const children = folder.querySelector(':scope > ul');
      const title = folder.querySelector(':scope > a, :scope > p');
      if (!children || !title) return;
      children.id = `chapter-navigation-${index}`;
      if (!folder.querySelector(':scope > button[data-sidebar-toggle]')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.sidebarToggle = '';
        button.dataset.folderTitle = title.textContent.trim();
        button.className = 'chapter-toggle';
        button.textContent = '›';
        button.setAttribute('aria-controls', children.id);
        folder.insertBefore(button, title);
      }
    });

    // The current chapter must also open when arriving from search or a shared link.
    const current = Array.from(sidebar.querySelectorAll('a')).find(link => routePath(link.hash) === routePath(location.hash));
    for (let node = current?.parentElement; node && node !== sidebar; node = node.parentElement) {
      if (node.tagName === 'LI' && node.querySelector(':scope > ul')) {
        node.classList.add('open');
        node.classList.remove('collapse');
      }
    }
    sidebarObserver = new MutationObserver(syncSidebar);
    sidebarObserver.observe(sidebar, { subtree: true, attributes: true, attributeFilter: ['class'] });
    syncSidebar();
    revealCurrentSidebar();
  }

  function markCurrent(heading) {
    if (!heading || heading === activeHeading) return;
    activeHeading = heading;
    for (const [id, link] of links) {
      const current = id === heading.id;
      link.classList.toggle('active', current);
      if (current) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
    const activeLink = links.get(heading.id);
    if (wide.matches && activeLink && tocViewport) {
      const item = activeLink.getBoundingClientRect();
      const viewport = tocViewport.getBoundingClientRect();
      if (item.top < viewport.top || item.bottom > viewport.bottom) {
        tocViewport.scrollTop += item.top - viewport.top - 16;
      }
    }
  }

  function updateCurrent() {
    scrollFrame = 0;
    let current = headings[0];
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top > 110) break;
      current = heading;
    }
    markCurrent(current);
  }

  function onScroll() {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(updateCurrent);
  }

  function attachToc() {
    const nav = document.querySelector('aside.nav');
    const toc = nav?.querySelector('.page_toc');
    const path = routePath(location.hash);
    const sourcePage = /\/(?:code|source)\//.test(path)
      || /\.(?:[cm]?[jt]sx?|json|py|sh|css|html|ya?ml|txt)$/.test(path);
    headings = Array.from(document.querySelectorAll('.markdown-section h2[id], .markdown-section h3[id]'));
    if (!nav) return;
    nav.classList.add('reading-nav');
    nav.hidden = sourcePage || !toc || headings.length < 2;
    document.body.classList.toggle('has-reading-nav', !nav.hidden);
    if (nav.hidden) return;

    document.querySelector('.content').prepend(nav);
    nav.setAttribute('aria-label', '本页导航');
    toc.querySelector('.title')?.remove();
    toc.classList.add('lesson-toc-list');
    toc.setAttribute('role', 'navigation');
    toc.setAttribute('aria-label', '本页小节');
    toc.querySelectorAll('ul').forEach(list => list.setAttribute('role', 'list'));
    disclosure = document.createElement('details');
    disclosure.className = 'lesson-toc';
    disclosure.open = wide.matches;
    const summary = document.createElement('summary');
    summary.textContent = '本页导航';
    disclosure.append(summary, toc);
    nav.replaceChildren(disclosure);
    tocViewport = toc;
    links = new Map();

    toc.querySelectorAll('a').forEach(link => {
      const id = new URLSearchParams(link.hash.split('?')[1] || '').get('id');
      const heading = headings.find(item => item.id === id);
      if (!heading) return;
      links.set(id, link);
      link.textContent = heading.textContent.trim();
      link.addEventListener('click', event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const target = new URL(link.href);
        if (target.origin !== location.origin || target.pathname !== location.pathname
          || routePath(target.hash) !== routePath(location.hash)) return;
        // Keep this same-document jump out of Docsify's competing hashchange animation.
        event.preventDefault();
        event.stopPropagation();
        if (target.href !== location.href) history.pushState(null, '', target.href);
        if (!wide.matches) disclosure.open = false;
        heading.setAttribute('tabindex', '-1');
        heading.scrollIntoView({ block: 'start', behavior: 'instant' });
        heading.focus({ preventScroll: true });
        markCurrent(heading);
      });
    });
    window.addEventListener('scroll', onScroll, { passive: true });
    contentObserver = new ResizeObserver(onScroll);
    contentObserver.observe(document.querySelector('.markdown-section'));
    updateCurrent();
  }

  function cleanup() {
    sidebarObserver?.disconnect();
    sidebarObserver = null;
    contentObserver?.disconnect();
    contentObserver = null;
    window.removeEventListener('scroll', onScroll);
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    headings = [];
    links = new Map();
    disclosure = tocViewport = activeHeading = null;
  }

  wide.addEventListener('change', () => {
    if (disclosure) disclosure.open = wide.matches;
    revealCurrentSidebar();
    onScroll();
  });

  window.$docsify.plugins = [].concat(window.$docsify.plugins || [], function (hook, vm) {
    hook.beforeEach(content => { cleanup(); return content; });
    hook.doneEach(() => {
      cleanup();
      if (vm.route.path === '/') {
        document.body.classList.remove('has-reading-nav');
        return;
      }
      attachSidebar();
      attachToc();
    });
  });
})();
