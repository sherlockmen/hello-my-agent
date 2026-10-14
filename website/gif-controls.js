(function () {
  'use strict';

  let active = null;
  const records = new Set();

  function label(record, state) {
    record.state = state;
    record.node.dataset.gifState = state;
    const labels = { idle: '开始播放', loading: '加载中…', playing: '暂停', paused: '继续播放', error: '重试播放' };
    record.text.textContent = labels[state];
    record.icon.textContent = state === 'playing' ? 'Ⅱ' : state === 'loading' ? '◌' : '▶';
    record.button.setAttribute('aria-label', `${labels[state]}动图：${record.alt}`);
    record.button.setAttribute('aria-pressed', String(state === 'playing'));
    record.button.disabled = state === 'loading';
  }

  function release(record) {
    record.controller?.abort();
    const animator = record.loader?.animator;
    if (animator) {
      animator.stop();
      for (const frame of animator.frames) {
        frame.pixels = null;
        if (frame.buffer) frame.buffer.width = frame.buffer.height = 0;
        frame.buffer = null;
      }
      animator.frames.length = 0;
      animator.reader = animator.onFrame = animator.onDrawFrame = animator.disposeFrame = null;
    }
    if (record.loader) record.loader.animator = null;
    record.loader = record.controller = null;
    record.canvas.width = record.canvas.height = 0;
    record.canvas.hidden = true;
    record.cover.hidden = false;
    record.status.textContent = '';
    label(record, 'idle');
    if (active === record) active = null;
  }

  async function toggle(record) {
    if (record.state === 'loading') return;
    if (record.loader?.animator) {
      const animator = record.loader.animator;
      if (animator.running) {
        animator.stop();
        label(record, 'paused');
      } else {
        animator.start();
        label(record, 'playing');
      }
      return;
    }

    if (active && active !== record) release(active);
    active = record;
    label(record, 'loading');
    record.status.textContent = '正在准备动图';
    const controller = new AbortController();
    const loader = new window.HmaGifControl.Loader();
    record.controller = controller;
    record.loader = loader;
    loader._xhr = async function (source) {
      const response = await fetch(source, { signal: controller.signal });
      if (!response.ok) throw new Error(`GIF HTTP ${response.status}`);
      return response.arrayBuffer();
    };

    const animator = await loader.load(record.source, record.canvas);
    if (controller.signal.aborted || !records.has(record) || active !== record) {
      if (animator) { animator.stop(); animator.frames.length = 0; }
      return;
    }
    if (!animator) {
      record.loader = record.controller = null;
      record.status.textContent = '动图加载失败，请点击重试';
      label(record, 'error');
      return;
    }
    record.canvas.hidden = false;
    record.cover.hidden = true;
    record.node.style.removeProperty('width');
    record.node.style.removeProperty('height');
    record.status.textContent = '';
    animator.start();
    label(record, 'playing');
  }

  function attach() {
    for (const image of document.querySelectorAll('.markdown-section img[data-gif-src]')) {
      if (image.closest('.gif-player') || image.hasAttribute('data-gifcontrol-disabled')) continue;
      const node = document.createElement('span');
      node.className = 'gif-player';
      const canvas = document.createElement('canvas');
      canvas.hidden = true;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', image.alt || '教程动图');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gif-player-toggle';
      const badge = document.createElement('span');
      badge.className = 'gif-player-badge';
      const icon = document.createElement('span');
      icon.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      const status = document.createElement('span');
      status.className = 'gif-player-status';
      status.setAttribute('role', 'status');
      badge.append(icon, text);
      button.append(badge);
      image.replaceWith(node);
      image.classList.add('gif-player-cover');
      node.append(image, canvas, button, status);
      const record = { node, canvas, button, icon, text, status, cover: image, alt: image.alt || '教程动图', source: new URL(image.dataset.gifSrc, document.baseURI).href };
      records.add(record);
      label(record, 'idle');
      button.addEventListener('click', () => toggle(record));
    }
  }

  function clear() {
    for (const record of records) release(record);
    records.clear();
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && active?.state === 'playing') {
      active.loader.animator.stop();
      label(active, 'paused');
    }
  });

  window.$docsify.plugins = [].concat(window.$docsify.plugins || [], function (hook, vm) {
    hook.beforeEach(function (content) { clear(); return content; });
    hook.doneEach(function () {
      // An onlyCover route does not pass through Markdown's beforeEach hook.
      if (vm.route.path === '/') clear();
      else attach();
    });
  });
})();
