// Copies the mermaid ESM bundle installed by `npm install` into vendor/mermaid/.
// MV3 extensions cannot load remote code, so mermaid ships with the extension.
// The split ESM build is used (rather than the single 5 MB mermaid.min.js) because
// addons.mozilla.org rejects JavaScript files that are too large to parse, and it
// only loads the code of the diagram types actually rendered.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = path.dirname(require.resolve('mermaid/package.json', { paths: [root] }));
const { version } = require(path.join(source, 'package.json'));
const target = path.join(root, 'vendor', 'mermaid');

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.join(target, 'chunks'), { recursive: true });

fs.copyFileSync(path.join(source, 'dist', 'mermaid.esm.min.mjs'), path.join(target, 'mermaid.esm.min.mjs'));
fs.cpSync(path.join(source, 'dist', 'chunks', 'mermaid.esm.min'), path.join(target, 'chunks', 'mermaid.esm.min'), {
  recursive: true,
  filter: (file) => !file.endsWith('.map'),
});
fs.copyFileSync(path.join(source, 'LICENSE'), path.join(target, 'LICENSE'));
fs.writeFileSync(path.join(target, 'VERSION'), `${version}\n`);

console.log(`vendor/mermaid updated to mermaid ${version}`);
