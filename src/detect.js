/*
 * Mermaid snippet detection.
 *
 * Loaded as a content script (exposes `globalThis.MermaidPreviewDetect`) and
 * as a CommonJS module by the unit tests.
 */
(function (root) {
  'use strict';

  // Diagram headers, aligned with the detectors shipped in mermaid itself.
  // Each keyword must be followed by whitespace, ':' or the end of the line so
  // that ordinary code such as `graph = build()` or `pie.slice()` is ignored.
  const DIAGRAM_HEADER = new RegExp(
    '^(?:' +
      [
        '(?:graph|flowchart(?:-elk)?)(?:\\s+(?:TB|TD|BT|RL|LR))?\\s*(?:;.*)?$',
        'sequenceDiagram',
        'classDiagram(?:-v2)?',
        'stateDiagram(?:-v2)?',
        'erDiagram',
        'journey',
        'gantt',
        'pie',
        'quadrantChart',
        'requirement(?:Diagram)?',
        'gitGraph',
        'C4(?:Context|Container|Component|Dynamic|Deployment)',
        'mindmap',
        'timeline',
        'sankey(?:-beta)?',
        'xychart(?:-beta)?',
        'block(?:-beta)?',
        'packet(?:-beta)?',
        'architecture(?:-beta)?',
        'kanban',
        'radar-beta',
        'treemap(?:-beta)?',
        'treeView-beta',
        'venn-beta',
        'wardley-beta',
        'cynefin-beta',
        'ishikawa(?:-beta)?',
        'usecase-beta',
        'swimlane-beta',
        'agentflow-beta',
        'eventmodeling',
        'railroad(?:-abnf|-ebnf|-peg)?-beta',
      ].join('|') +
      ')(?:[\\s:].*)?$'
  );

  const LANGUAGE_CLASS = /(?:^|\s)(?:language|lang)-mermaid(?:\s|$)/i;
  const LANGUAGE_ATTRIBUTES = ['data-language', 'data-lang', 'data-code-lang', 'lang'];

  /** Returns the first line that actually carries diagram content. */
  function firstMeaningfulLine(text) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    let i = 0;

    // Skip leading blank lines.
    while (i < lines.length && lines[i].trim() === '') i++;

    // Skip YAML front matter (`---` ... `---`).
    if (i < lines.length && lines[i].trim() === '---') {
      i++;
      while (i < lines.length && lines[i].trim() !== '---') i++;
      i++;
    }

    for (; i < lines.length; i++) {
      const line = lines[i].trim();
      // Blank lines, `%% comments` and `%%{init: ...}%%` directives.
      if (line === '' || line.startsWith('%%')) continue;
      return line;
    }
    return '';
  }

  /** True when `text` looks like a mermaid diagram definition. */
  function looksLikeMermaid(text) {
    if (!text || text.length > 200000) return false;
    return DIAGRAM_HEADER.test(firstMeaningfulLine(text));
  }

  /**
   * True when the element (or one of its close ancestors) explicitly declares
   * the snippet as mermaid, e.g. `<code class="language-mermaid">` or
   * `<pre data-language="mermaid">`.
   */
  function hasMermaidLanguageHint(element) {
    let node = element;
    for (let depth = 0; node && node.nodeType === 1 && depth < 4; depth++) {
      if (LANGUAGE_CLASS.test(node.getAttribute('class') || '')) return true;
      for (const attr of LANGUAGE_ATTRIBUTES) {
        const value = node.getAttribute(attr);
        if (value && value.trim().toLowerCase() === 'mermaid') return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  const api = { looksLikeMermaid, hasMermaidLanguageHint, firstMeaningfulLine };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.MermaidPreviewDetect = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
