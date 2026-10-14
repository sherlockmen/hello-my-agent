// The cover and course share one document: entering the course scrolls, not routes.
(function () {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let cover = null;
  let observer = null;
  let pendingStart = null;
  let courseReady = false;

  function markPending(pending) {
    const link = document.querySelector('.cover-primary');
    if (!link) return;
    if (pending) link.setAttribute('aria-busy', 'true');
    else link.removeAttribute('aria-busy');
    link.querySelector('span').textContent = pending ? '…' : '↓';
  }

  function startReading(immediate) {
    const heading = document.querySelector('.markdown-section h1');
    if (!courseReady || !heading) {
      // The cover can arrive first on a slow connection. Retain the reading intent.
      pendingStart = { immediate };
      markPending(true);
      return;
    }
    pendingStart = null;
    markPending(false);
    if (immediate || reducedMotion.matches) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
    document.querySelector('main').scrollIntoView({
      block: 'start', behavior: immediate || reducedMotion.matches ? 'instant' : 'smooth'
    });
  }

  function updateCover() {
    const visible = cover?.classList.contains('show') && cover.getBoundingClientRect().bottom > 1;
    document.body.classList.toggle('cover-visible', Boolean(visible));
    // Docsify only updates this on desktop; the mobile menu needs the same boundary.
    document.body.classList.toggle('sticky', !visible);
  }

  window.addEventListener('scroll', updateCover, { passive: true });
  window.addEventListener('resize', updateCover, { passive: true });

  window.$docsify.plugins.push(function (hook, vm) {
    hook.init(function () {
      const renderCover = vm._renderCover;
      vm._renderCover = function (content, onlyCover) {
        const result = renderCover.call(this, content, onlyCover);
        cover = document.querySelector('section.cover');
        observer?.disconnect();
        observer = new ResizeObserver(updateCover);
        if (cover) observer.observe(cover);
        markPending(Boolean(pendingStart));
        updateCover();
        return result;
      };

      document.addEventListener('click', function (event) {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const start = event.target.closest('.cover-primary');
        const home = event.target.closest('.app-name-link, .cover-brand');
        if (!start && !(home && vm.route.path === '/')) return;
        event.preventDefault();
        event.stopPropagation();
        const immediate = reducedMotion.matches || event.detail === 0;
        if (start) return startReading(immediate);
        pendingStart = null;
        markPending(false);
        if (window.matchMedia('(max-width: 768px)').matches) document.body.classList.remove('close');
        if (immediate) document.querySelector('.cover-primary')?.focus({ preventScroll: true });
        cover?.scrollIntoView({ block: 'start', behavior: immediate ? 'instant' : 'smooth' });
      }, true);
    });

    hook.beforeEach(function (content) {
      courseReady = false;
      if (vm.route.path !== '/') pendingStart = null;
      return content;
    });

    hook.doneEach(function () {
      courseReady = vm.route.path === '/';
      // Keep the desktop navigation beside the course when it sits below the cover.
      const nav = document.querySelector('body > .app-nav');
      if (nav) document.querySelector('main')?.prepend(nav);
      updateCover();
      if (pendingStart) {
        // Let the remaining Docsify hooks finish arranging the navigation first.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (pendingStart && vm.route.path === '/') startReading(pendingStart.immediate);
        }));
      }
    });
  });
}());
