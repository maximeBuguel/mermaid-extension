const test = require('node:test');
const assert = require('node:assert/strict');
const { looksLikeMermaid, firstMeaningfulLine } = require('../src/detect.js');

test('detects common diagram headers', () => {
  const samples = [
    'graph TD\n  A --> B',
    'flowchart LR\nA-->B',
    'graph TD; A-->B',
    'sequenceDiagram\n  Alice->>Bob: Hi',
    'classDiagram\n  Animal <|-- Duck',
    'stateDiagram-v2\n  [*] --> Still',
    'erDiagram\n  CUSTOMER ||--o{ ORDER : places',
    'gantt\n  title A Gantt Diagram',
    'pie title Pets\n  "Dogs" : 386',
    'pie\n  "Dogs" : 386',
    'gitGraph\n  commit',
    'gitGraph:\n  commit',
    'mindmap\n  root((mindmap))',
    'timeline\n  title History',
    'xychart-beta\n  x-axis [a, b]',
    'C4Context\n  title System',
    'architecture-beta\n  group api(cloud)[API]',
  ];
  for (const sample of samples) assert.equal(looksLikeMermaid(sample), true, sample);
});

test('skips front matter, directives and comments', () => {
  const code = [
    '',
    '---',
    'title: Example',
    '---',
    '%%{init: {"theme": "forest"}}%%',
    '%% a comment',
    'flowchart TB',
    '  a --> b',
  ].join('\n');
  assert.equal(firstMeaningfulLine(code), 'flowchart TB');
  assert.equal(looksLikeMermaid(code), true);
});

test('handles Windows line endings and indentation', () => {
  assert.equal(looksLikeMermaid('\r\n   sequenceDiagram\r\n  A->>B: x'), true);
});

test('ignores regular code', () => {
  const samples = [
    '',
    'const graph = buildGraph();',
    'graph = nx.Graph()',
    'graph.addNode(a)',
    'pie.slice(0, 2)',
    'function gantt() {}',
    'SELECT * FROM journey',
    'flowchart: true',
    '# graph TD',
    'npm install mermaid',
  ];
  for (const sample of samples) assert.equal(looksLikeMermaid(sample), false, sample);
});
