// Add keyboard controls to Docsify's static-image zoom without touching GIFs.
(function () {
  var currentZoom;
  var closeButton;

  document.addEventListener('keydown', function (event) {
    if (!closeButton) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      currentZoom.close();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      closeButton.focus();
    }
  });

  window.$docsify.plugins.push(function (hook) {
    hook.doneEach(function () {
      document.querySelectorAll('.markdown-section img.medium-zoom-image').forEach(function (image) {
        image.tabIndex = 0;
        image.setAttribute('role', 'button');
        image.setAttribute('aria-label', '放大图片：' + (image.alt || '教学插图'));
        image.setAttribute('aria-expanded', 'false');
        image.title = '点击放大；按 Esc 返回正文';
        image.addEventListener('keydown', function (event) {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          image.click();
        });
        image.addEventListener('medium-zoom:open', function (event) {
          currentZoom = event.detail.zoom;
          image.setAttribute('aria-expanded', 'true');
          closeButton = document.createElement('button');
          closeButton.className = 'image-zoom-close';
          closeButton.textContent = '关闭放大 ×';
          closeButton.addEventListener('click', function () { currentZoom.close(); });
          document.body.appendChild(closeButton);
        });
        image.addEventListener('medium-zoom:opened', function () {
          document.querySelectorAll('.medium-zoom-image--opened').forEach(function (clone) {
            clone.tabIndex = -1;
            clone.setAttribute('role', 'img');
            clone.removeAttribute('aria-expanded');
            clone.removeAttribute('aria-label');
          });
          if (closeButton) closeButton.focus({ preventScroll: true });
        });
        image.addEventListener('medium-zoom:closed', function () {
          image.setAttribute('aria-expanded', 'false');
          if (closeButton) closeButton.remove();
          closeButton = null;
          currentZoom = null;
          if (image.isConnected) image.focus({ preventScroll: true });
        });
      });
    });
  });
}());
