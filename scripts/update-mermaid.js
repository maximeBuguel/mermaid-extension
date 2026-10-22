// Copies the mermaid bundle installed by `npm install` into vendor/.
// Chrome MV3 extensions cannot load remote code, so mermaid ships with the extension.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = path.dirname(require.resolve('mermaid/package.json', { paths: [root] }));
const { version } = require(path.join(source, 'package.json'));

fs.copyFileSync(path.join(source, 'dist', 'mermaid.min.js'), path.join(root, 'vendor', 'mermaid.min.js'));
fs.copyFileSync(path.join(source, 'LICENSE'), path.join(root, 'vendor', 'MERMAID_LICENSE'));
console.log(`vendor/mermaid.min.js updated to mermaid ${version}`);
