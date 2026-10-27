/*
 * Runs inside the preview iframe: receives mermaid code from the content
 * script, renders it and reports the natural size of the result back so the
 * tooltip can be sized accordingly. Large diagrams can then be zoomed (toolbar,
 * Ctrl + wheel, double click, keyboard) and panned (drag, wheel) in the frame.
 */
import mermaid from '../vendor/mermaid/mermaid.esm.min.mjs';

const MESSAGE_SOURCE = 'mermaid-preview';
const container = document.getElementById('diagram');
const viewport = document.getElementById('viewport');
const toolbar = document.getElementById('toolbar');
const zoomInButton = document.getElementById('zoom-in');
const zoomOutButton = document.getElementById('zoom-out');
const zoomResetButton = document.getElementById('zoom-reset');

const ZOOM_STEP = 1.25;
const MAX_ZOOM = 8; // relative to the initial (fit-to-width) zoom
const KEYBOARD_PAN = 40;

let renderCounter = 0;
let latestRequestId = 0;
// mermaid keeps global state, so renders are serialized.
let queue = Promise.resolve();

function reply(message) {
  window.parent.postMessage({ source: MESSAGE_SOURCE, ...message }, '*');
}

/** Intrinsic size of the rendered SVG; its displayed size is set by applyView(). */
function measureSvg(svg) {
  const viewBox = svg.viewBox && svg.viewBox.baseVal;
  let width = viewBox && viewBox.width;
  let height = viewBox && viewBox.height;
  if (!width || !height) {
    const box = svg.getBoundingClientRect();
    width = box.width;
    height = box.height;
  }
  svg.removeAttribute('style');
  return { width: Math.ceil(width), height: Math.ceil(height) };
}

// -----------------------------------------------------------------------------
// Zoom & pan

/** Intrinsic size of the current diagram, null when an error is shown. */
let diagram = null;
/** `scale` is relative to the intrinsic size; `x`/`y` position the diagram in the frame. */
const view = { scale: 1, x: 0, y: 0, touched: false };

/** Initial zoom: the diagram fits the frame width (never enlarged). */
function fitScale() {
  return Math.min(1, window.innerWidth / diagram.width);
}

function scaleBounds() {
  const fitAll = Math.min(fitScale(), window.innerHeight / diagram.height);
  return { min: fitAll / 2, max: fitScale() * MAX_ZOOM };
}

/** Centers the diagram on an axis where it fits, otherwise keeps the frame covered. */
function clampAxis(position, size, available) {
  if (size <= available) return (available - size) / 2;
  return Math.min(0, Math.max(available - size, position));
}

function applyView() {
  if (!diagram) return;
  const svg = container.querySelector('svg');
  const width = diagram.width * view.scale;
  const height = diagram.height * view.scale;
  view.x = clampAxis(view.x, width, window.innerWidth);
  view.y = clampAxis(view.y, height, window.innerHeight);

  // Resizing the SVG (rather than a CSS scale) keeps the text sharp at any zoom.
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  container.style.transform = `translate(${view.x}px, ${view.y}px)`;

  const { min, max } = scaleBounds();
  zoomOutButton.disabled = view.scale <= min * 1.001;
  zoomInButton.disabled = view.scale >= max * 0.999;
  zoomResetButton.textContent = `${Math.round((view.scale / fitScale()) * 100)} %`;
  document.body.classList.toggle(
    'pannable',
    width > window.innerWidth + 0.5 || height > window.innerHeight + 0.5
  );
}

function resetView() {
  view.scale = fitScale();
  view.x = 0;
  view.y = 0;
  view.touched = false;
  applyView();
}

/** Tells the content script to keep the tooltip open while the user explores the diagram. */
function interacted() {
  view.touched = true;
  reply({ type: 'interact' });
}

/** Zooms by `factor`, keeping the point (`cx`, `cy`) of the frame still. */
function zoomAt(factor, cx = window.innerWidth / 2, cy = window.innerHeight / 2) {
  if (!diagram) return;
  const { min, max } = scaleBounds();
  const scale = Math.min(max, Math.max(min, view.scale * factor));
  const ratio = scale / view.scale;
  view.x = cx - (cx - view.x) * ratio;
  view.y = cy - (cy - view.y) * ratio;
  view.scale = scale;
  applyView();
  interacted();
}

function panBy(dx, dy) {
  if (!diagram) return false;
  const before = `${view.x},${view.y}`;
  view.x += dx;
  view.y += dy;
  applyView();
  if (`${view.x},${view.y}` === before) return false;
  interacted();
  return true;
}

zoomInButton.addEventListener('click', () => zoomAt(ZOOM_STEP));
zoomOutButton.addEventListener('click', () => zoomAt(1 / ZOOM_STEP));
zoomResetButton.addEventListener('click', () => {
  resetView();
  interacted();
});

viewport.addEventListener(
  'wheel',
  (event) => {
    if (!diagram) return;
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
    // Ctrl/Cmd + wheel (and trackpad pinch, reported with ctrlKey) zooms.
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      zoomAt(Math.exp(-event.deltaY * unit * 0.002), event.clientX, event.clientY);
      return;
    }
    let dx = event.deltaX * unit;
    let dy = event.deltaY * unit;
    // Shift + wheel, or a diagram that only overflows sideways, pans horizontally.
    const overflowsY = diagram.height * view.scale > window.innerHeight + 0.5;
    if (!dx && (event.shiftKey || !overflowsY)) [dx, dy] = [dy, 0];
    // Only swallow the event when the diagram actually moved, so that the page
    // still scrolls when there is nothing to pan.
    if (panBy(-dx, -dy)) event.preventDefault();
  },
  { passive: false }
);

viewport.addEventListener('dblclick', (event) => {
  zoomAt(event.shiftKey ? 1 / ZOOM_STEP : ZOOM_STEP, event.clientX, event.clientY);
});

let drag = null;
viewport.addEventListener('pointerdown', (event) => {
  if (!diagram || event.button !== 0 || !document.body.classList.contains('pannable')) return;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  viewport.setPointerCapture(event.pointerId);
  document.body.classList.add('panning');
  event.preventDefault();
});
viewport.addEventListener('pointermove', (event) => {
  if (!drag || event.pointerId !== drag.id) return;
  panBy(event.clientX - drag.x, event.clientY - drag.y);
  drag.x = event.clientX;
  drag.y = event.clientY;
});
function endDrag(event) {
  if (!drag || event.pointerId !== drag.id) return;
  drag = null;
  document.body.classList.remove('panning');
}
viewport.addEventListener('pointerup', endDrag);
viewport.addEventListener('pointercancel', endDrag);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    reply({ type: 'close' });
    return;
  }
  if (!diagram || event.ctrlKey || event.metaKey || event.altKey) return;
  const actions = {
    '+': () => zoomAt(ZOOM_STEP),
    '=': () => zoomAt(ZOOM_STEP),
    '-': () => zoomAt(1 / ZOOM_STEP),
    0: () => {
      resetView();
      interacted();
    },
    ArrowLeft: () => panBy(KEYBOARD_PAN, 0),
    ArrowRight: () => panBy(-KEYBOARD_PAN, 0),
    ArrowUp: () => panBy(0, KEYBOARD_PAN),
    ArrowDown: () => panBy(0, -KEYBOARD_PAN),
  };
  if (actions[event.key]) {
    event.preventDefault();
    actions[event.key]();
  }
});

// The content script resizes the frame once it knows the diagram size.
window.addEventListener('resize', () => {
  if (!diagram) return;
  if (view.touched) applyView();
  else resetView();
});

// -----------------------------------------------------------------------------
// Rendering

function showError(error) {
  const box = document.createElement('div');
  box.className = 'error';
  const title = document.createElement('strong');
  title.textContent = 'Diagramme Mermaid invalide';
  box.append(title, String((error && error.message) || error).trim());
  container.replaceChildren(box);
  container.style.transform = '';
  diagram = null;
  toolbar.hidden = true;
  document.body.classList.remove('pannable', 'panning');
  const rect = box.getBoundingClientRect();
  return { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
}

async function render({ requestId, code, theme, keepView }) {
  if (requestId !== latestRequestId) return;

  document.body.classList.toggle('dark', theme === 'dark');
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: theme === 'dark' ? 'dark' : 'default',
  });

  const id = `mermaid-preview-${++renderCounter}`;
  let size;
  try {
    const { svg, bindFunctions } = await mermaid.render(id, code);
    if (requestId !== latestRequestId) return;
    // Parsed in an inert document; mermaid already sanitized it (securityLevel: 'strict').
    const parsed = new DOMParser().parseFromString(svg, 'text/html');
    const element = document.importNode(parsed.querySelector('svg'), true);
    container.replaceChildren(element);
    if (bindFunctions) bindFunctions(container);
    size = { ...measureSvg(element), kind: 'diagram' };

    const hadDiagram = diagram !== null;
    diagram = size;
    toolbar.hidden = false;
    if (keepView && hadDiagram && view.touched) {
      const { min, max } = scaleBounds();
      view.scale = Math.min(max, Math.max(min, view.scale));
      applyView();
    } else {
      resetView();
    }
  } catch (error) {
    // mermaid may leave its temporary render node behind on failure.
    document.getElementById(`d${id}`)?.remove();
    if (requestId !== latestRequestId) return;
    size = { ...showError(error), kind: 'error' };
  }
  reply({ type: 'rendered', requestId, ...size });
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  const data = event.data;
  if (!data || data.source !== MESSAGE_SOURCE || data.type !== 'render') return;
  if (typeof data.code !== 'string') return;

  latestRequestId = data.requestId;
  queue = queue.then(() => render(data)).catch(() => {});
});

reply({ type: 'ready' });
