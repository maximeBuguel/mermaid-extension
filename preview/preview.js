/*
 * Runs inside the preview iframe: receives mermaid code from the content
 * script, renders it and reports the natural size of the result back so the
 * tooltip can be sized accordingly.
 */
import mermaid from '../vendor/mermaid/mermaid.esm.min.mjs';

const MESSAGE_SOURCE = 'mermaid-preview';
const container = document.getElementById('diagram');

let renderCounter = 0;
let latestRequestId = 0;
// mermaid keeps global state, so renders are serialized.
let queue = Promise.resolve();

function reply(message) {
  window.parent.postMessage({ source: MESSAGE_SOURCE, ...message }, '*');
}

/** Gives the SVG its intrinsic size; CSS scales it down to the frame width. */
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
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  return { width: Math.ceil(width), height: Math.ceil(height) };
}

function showError(error) {
  const box = document.createElement('div');
  box.className = 'error';
  const title = document.createElement('strong');
  title.textContent = 'Diagramme Mermaid invalide';
  box.append(title, String((error && error.message) || error).trim());
  container.replaceChildren(box);
  const rect = box.getBoundingClientRect();
  return { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
}

async function render({ requestId, code, theme }) {
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
    size = measureSvg(element);
  } catch (error) {
    // mermaid may leave its temporary render node behind on failure.
    document.getElementById(`d${id}`)?.remove();
    if (requestId !== latestRequestId) return;
    size = showError(error);
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
