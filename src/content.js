/*
 * Content script: finds mermaid snippets in the page, pins an icon to the
 * top-right corner of each one and shows the rendered diagram in a tooltip
 * when the icon is hovered.
 *
 * Rendering happens inside an extension iframe (preview/preview.html) so that
 * neither the page's CSP nor its stylesheets can interfere with mermaid, and
 * so that the (large) mermaid bundle is only loaded once a preview is needed.
 */
(function () {
  'use strict';

  if (window.__mermaidPreviewLoaded) return;
  window.__mermaidPreviewLoaded = true;

  const { looksLikeMermaid, hasMermaidLanguageHint } = globalThis.MermaidPreviewDetect;

  const PREVIEW_URL = chrome.runtime.getURL('preview/preview.html');
  const PREVIEW_ORIGIN = new URL(PREVIEW_URL).origin;
  const MESSAGE_SOURCE = 'mermaid-preview';

  const ICON_SIZE = 22;
  const ICON_INSET = 6;
  const TOOLTIP_GAP = 8;
  const VIEWPORT_MARGIN = 12;
  const HIDE_DELAY = 250;
  // Leaves room for the zoom toolbar of the preview.
  const MIN_DIAGRAM_WIDTH = 140;
  const MIN_DIAGRAM_HEIGHT = 80;
  const SCAN_DELAY = 300;

  // Elements whose text is decoration rather than code (line numbers, etc.).
  const DECORATION_SELECTOR = [
    '[data-ds--line-number]',
    '.linenumber',
    '.line-number',
    '.line-numbers',
    '.linenos',
    '[aria-hidden="true"]',
  ].join(',');

  // Pictogram of a small diagram: two boxes linked to a third one.
  const ICON_PATH =
    'M3 4h7v6H3zm11 0h7v6h-7zM8.5 14h7v6h-7z' +
    'M6 10h1.5v2.25h9.5V10h1.5v3.75h-5.75V14h-1.5v-.25H6z';

  const STYLE = `
    :host { all: initial; }
    .icon {
      position: fixed;
      z-index: 2147483646;
      width: ${ICON_SIZE}px;
      height: ${ICON_SIZE}px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      border-radius: 5px;
      border: 1px solid rgba(255, 54, 112, 0.45);
      background: rgba(255, 255, 255, 0.92);
      color: #ff3670;
      cursor: pointer;
      box-shadow: 0 1px 3px rgba(9, 30, 66, 0.25);
      opacity: 0.75;
      transition: opacity 120ms ease, transform 120ms ease;
    }
    .icon:hover, .icon.active { opacity: 1; transform: scale(1.08); }
    .icon[hidden] { display: none; }
    .tooltip {
      position: fixed;
      z-index: 2147483647;
      box-sizing: border-box;
      padding: 8px;
      border-radius: 8px;
      background: #ffffff;
      border: 1px solid rgba(9, 30, 66, 0.14);
      box-shadow: 0 8px 24px rgba(9, 30, 66, 0.25);
      font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #44546f;
    }
    .tooltip.dark {
      background: #22272b;
      border-color: rgba(255, 255, 255, 0.12);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
      color: #9fadbc;
    }
    .tooltip[hidden] { display: none; }
    .tooltip iframe {
      display: block;
      border: 0;
      background: transparent;
      color-scheme: normal;
    }
    .tooltip.loading iframe { visibility: hidden; position: absolute; }
    .loader { display: none; padding: 6px 10px; white-space: nowrap; }
    .tooltip.loading .loader { display: block; }
  `;

  /** element -> { icon, text, isMermaid } */
  const tracked = new Map();

  let shadow = null;
  let tooltip = null;
  let iframe = null;
  let iframeReady = false;
  let pendingRequest = null;

  let activeElement = null;
  let pinned = false;
  let hideTimer = null;
  let requestCounter = 0;
  let currentRequestId = 0;
  let previewSize = null;
  let lastRenderedElement = null;

  // ---------------------------------------------------------------------------
  // Overlay (shadow DOM, isolated from page styles)

  function ensureOverlay() {
    if (shadow && shadow.host.isConnected) return;
    const host = document.createElement('mermaid-preview-overlay');
    host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;';
    shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    shadow.appendChild(style);
    // Constructed stylesheets are not subject to the page's CSP `style-src`,
    // which some browsers (Firefox) may apply to the <style> element above.
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLE);
      shadow.adoptedStyleSheets = [sheet];
    } catch {
      // Not supported here: the <style> element is enough.
    }
    document.documentElement.appendChild(host);

    // Icons and tooltip from a previous (removed) overlay must be recreated.
    for (const entry of tracked.values()) {
      if (entry.icon) shadow.appendChild(entry.icon);
    }
    tooltip = null;
    iframe = null;
    iframeReady = false;
  }

  function createIconSvg() {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('d', ICON_PATH);
    svg.appendChild(path);
    return svg;
  }

  function createIcon(element) {
    const icon = document.createElement('div');
    icon.className = 'icon';
    icon.title = 'Aperçu du diagramme Mermaid';
    icon.setAttribute('role', 'button');
    icon.setAttribute('aria-label', 'Aperçu du diagramme Mermaid');
    icon.appendChild(createIconSvg());
    icon.hidden = true;

    icon.addEventListener('mouseenter', () => showTooltip(element));
    icon.addEventListener('mouseleave', scheduleHide);
    icon.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (pinned && activeElement === element) {
        hideTooltip();
      } else {
        showTooltip(element);
        pinned = true;
      }
    });
    // Keep the page (e.g. an editor) from stealing focus/selection.
    icon.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    shadow.appendChild(icon);
    return icon;
  }

  // ---------------------------------------------------------------------------
  // Snippet discovery

  function readCode(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll(DECORATION_SELECTOR).forEach((node) => node.remove());
    clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    return clone.textContent;
  }

  function candidates() {
    const result = [];
    for (const element of document.querySelectorAll('pre, code')) {
      if (element.tagName === 'CODE') {
        // `<pre><code>` is handled through the `<pre>`; skip inline `code`.
        if (element.closest('pre')) continue;
        if (!/\n/.test(element.textContent) && !element.querySelector('br')) continue;
      }
      result.push(element);
    }
    return result;
  }

  function scan() {
    ensureOverlay();
    const seen = new Set();

    for (const element of candidates()) {
      seen.add(element);
      const raw = element.textContent;
      let entry = tracked.get(element);
      if (entry && entry.raw === raw) continue;

      const code = readCode(element);
      const isMermaid =
        code.trim() !== '' && (hasMermaidLanguageHint(element) || looksLikeMermaid(code));

      if (!entry) {
        entry = { raw, isMermaid: false, icon: null };
        tracked.set(element, entry);
      }
      entry.raw = raw;

      if (isMermaid && !entry.icon) {
        entry.icon = createIcon(element);
        resizeObserver.observe(element);
      } else if (!isMermaid && entry.icon) {
        removeIcon(element, entry);
      }
      entry.isMermaid = isMermaid;

      // Live update of an open preview while the snippet is being edited.
      if (isMermaid && element === activeElement && tooltip && !tooltip.hidden) {
        requestRender(element);
      }
    }

    for (const [element, entry] of tracked) {
      if (!seen.has(element)) {
        removeIcon(element, entry);
        tracked.delete(element);
      }
    }

    schedulePositionUpdate();
  }

  function removeIcon(element, entry) {
    if (!entry.icon) return;
    entry.icon.remove();
    entry.icon = null;
    resizeObserver.unobserve(element);
    if (activeElement === element) hideTooltip();
  }

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, SCAN_DELAY);
  }

  // ---------------------------------------------------------------------------
  // Icon positioning

  /** Visible part of `element`, clipped by its scrolling ancestors. */
  function visibleRect(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    let top = Math.max(rect.top, 0);
    let right = Math.min(rect.right, window.innerWidth);
    let bottom = Math.min(rect.bottom, window.innerHeight);
    let left = Math.max(rect.left, 0);

    for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const clip = node.getBoundingClientRect();
      top = Math.max(top, clip.top);
      right = Math.min(right, clip.right);
      bottom = Math.min(bottom, clip.bottom);
      left = Math.max(left, clip.left);
    }

    if (right - left < ICON_SIZE || bottom - top < ICON_SIZE) return null;
    return { top, right, bottom, left, element: rect };
  }

  function updatePositions() {
    for (const [element, entry] of tracked) {
      if (!entry.icon) continue;
      const rect = element.isConnected ? visibleRect(element) : null;
      if (!rect) {
        entry.icon.hidden = true;
        continue;
      }
      const x = Math.min(rect.element.right, rect.right) - ICON_INSET - ICON_SIZE;
      const y = Math.max(rect.element.top, rect.top) + ICON_INSET;
      entry.icon.style.left = `${Math.round(x)}px`;
      entry.icon.style.top = `${Math.round(y)}px`;
      entry.icon.hidden = false;
    }

    if (activeElement && tooltip && !tooltip.hidden) {
      const entry = tracked.get(activeElement);
      if (!entry || !entry.icon || entry.icon.hidden) hideTooltip();
      else positionTooltip();
    }
  }

  let positionFrame = 0;
  function schedulePositionUpdate() {
    if (positionFrame) return;
    positionFrame = requestAnimationFrame(() => {
      positionFrame = 0;
      updatePositions();
    });
  }

  const resizeObserver = new ResizeObserver(schedulePositionUpdate);

  // ---------------------------------------------------------------------------
  // Tooltip

  function isDarkPage() {
    const root = document.documentElement;
    // Atlassian products set `data-color-mode`; many other sites use `data-theme`.
    const mode = (root.getAttribute('data-color-mode') || root.getAttribute('data-theme') || '').trim();
    if (mode === 'dark') return true;
    if (mode === 'light') return false;

    for (const node of [document.body, root]) {
      if (!node) continue;
      const match = getComputedStyle(node).backgroundColor.match(/[\d.]+/g);
      if (!match) continue;
      const [r, g, b, a = 1] = match.map(Number);
      if (a === 0) continue;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function ensureTooltip() {
    ensureOverlay();
    if (tooltip) return;

    tooltip = document.createElement('div');
    tooltip.className = 'tooltip loading';
    tooltip.hidden = true;
    tooltip.addEventListener('mouseenter', cancelHide);
    tooltip.addEventListener('mouseleave', scheduleHide);

    const loader = document.createElement('div');
    loader.className = 'loader';
    loader.textContent = 'Rendu du diagramme…';
    tooltip.appendChild(loader);

    iframe = document.createElement('iframe');
    iframe.src = PREVIEW_URL;
    iframe.title = 'Aperçu Mermaid';
    iframe.setAttribute('scrolling', 'auto');
    tooltip.appendChild(iframe);

    shadow.appendChild(tooltip);
  }

  function showTooltip(element) {
    cancelHide();
    ensureTooltip();

    if (activeElement !== element) {
      setActiveIcon(element);
      pinned = false;
      previewSize = null;
      tooltip.classList.add('loading');
    }
    tooltip.classList.toggle('dark', isDarkPage());
    tooltip.hidden = false;
    requestRender(element);
    positionTooltip();
  }

  function hideTooltip() {
    cancelHide();
    pinned = false;
    setActiveIcon(null);
    if (tooltip) tooltip.hidden = true;
  }

  function setActiveIcon(element) {
    const previous = activeElement && tracked.get(activeElement);
    if (previous && previous.icon) previous.icon.classList.remove('active');
    activeElement = element;
    const next = element && tracked.get(element);
    if (next && next.icon) next.icon.classList.add('active');
  }

  function scheduleHide() {
    if (pinned) return;
    cancelHide();
    hideTimer = setTimeout(hideTooltip, HIDE_DELAY);
  }

  function cancelHide() {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  function maxTooltipSize() {
    return {
      width: Math.min(960, window.innerWidth - 2 * VIEWPORT_MARGIN) - 18,
      height: Math.min(720, window.innerHeight - 2 * VIEWPORT_MARGIN) - 18,
    };
  }

  function applyPreviewSize() {
    if (!iframe || !previewSize) return;
    const max = maxTooltipSize();
    const isDiagram = previewSize.kind === 'diagram';
    const width = Math.max(isDiagram ? MIN_DIAGRAM_WIDTH : 80, Math.min(previewSize.width, max.width));
    // When the diagram is scaled down to fit the width, its height shrinks too...
    const scale = Math.min(1, width / previewSize.width);
    let height = previewSize.height * scale;
    // ...which turns wide diagrams into a thin strip: leave room to zoom into them.
    if (isDiagram && scale < 1) height = Math.max(height, Math.min(previewSize.height, max.height / 2));
    height = Math.max(isDiagram ? MIN_DIAGRAM_HEIGHT : 40, Math.min(Math.ceil(height), max.height));
    iframe.style.width = `${Math.ceil(width)}px`;
    iframe.style.height = `${height}px`;
  }

  function positionTooltip() {
    const entry = activeElement && tracked.get(activeElement);
    if (!tooltip || !entry || !entry.icon) return;

    applyPreviewSize();
    const icon = entry.icon.getBoundingClientRect();
    const box = tooltip.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Below the icon, right-aligned with it; flipped above if there is no room.
    let left = icon.right - box.width;
    let top = icon.bottom + TOOLTIP_GAP;
    if (top + box.height > vh - VIEWPORT_MARGIN && icon.top - TOOLTIP_GAP - box.height >= VIEWPORT_MARGIN) {
      top = icon.top - TOOLTIP_GAP - box.height;
    }
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - VIEWPORT_MARGIN - box.width));
    top = Math.max(VIEWPORT_MARGIN, Math.min(top, vh - VIEWPORT_MARGIN - box.height));

    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  }

  // ---------------------------------------------------------------------------
  // Communication with the preview iframe

  function requestRender(element) {
    currentRequestId = ++requestCounter;
    const message = {
      source: MESSAGE_SOURCE,
      type: 'render',
      requestId: currentRequestId,
      code: readCode(element),
      theme: isDarkPage() ? 'dark' : 'default',
      // Keep the zoom level when the same snippet is shown again or edited.
      keepView: element === lastRenderedElement,
    };
    lastRenderedElement = element;
    if (iframeReady) {
      iframe.contentWindow.postMessage(message, PREVIEW_ORIGIN);
    } else {
      pendingRequest = message;
    }
  }

  window.addEventListener('message', (event) => {
    if (!iframe || event.source !== iframe.contentWindow || event.origin !== PREVIEW_ORIGIN) return;
    const data = event.data;
    if (!data || data.source !== MESSAGE_SOURCE) return;

    if (data.type === 'ready') {
      iframeReady = true;
      if (pendingRequest) {
        iframe.contentWindow.postMessage(pendingRequest, PREVIEW_ORIGIN);
        pendingRequest = null;
      }
    } else if (data.type === 'rendered' && data.requestId === currentRequestId) {
      previewSize = { width: data.width, height: data.height, kind: data.kind };
      tooltip.classList.remove('loading');
      positionTooltip();
    } else if (data.type === 'interact' && tooltip && !tooltip.hidden) {
      // The user is zooming or panning: keep the tooltip open until Escape or a click outside.
      cancelHide();
      pinned = true;
    } else if (data.type === 'close') {
      hideTooltip();
    }
  });

  // ---------------------------------------------------------------------------
  // Wiring

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && tooltip && !tooltip.hidden) hideTooltip();
  }, true);

  document.addEventListener('mousedown', (event) => {
    // Clicks inside the shadow root are retargeted to its host.
    if (pinned && shadow && event.target !== shadow.host) hideTooltip();
  }, true);

  window.addEventListener('scroll', schedulePositionUpdate, { capture: true, passive: true });
  window.addEventListener('resize', schedulePositionUpdate, { passive: true });

  // Mutations inside our (closed) shadow root are not reported here.
  new MutationObserver(() => {
    scheduleScan();
    schedulePositionUpdate();
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  scan();
})();
