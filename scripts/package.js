// Builds the store packages:
//   dist/mermaid-preview-<version>-chrome.zip   → Chrome Web Store
//   dist/mermaid-preview-<version>-firefox.zip  → addons.mozilla.org
// Usage: node scripts/package.js [chrome|firefox]  (both when omitted)
//
// Only the files the extension needs at runtime are included, with manifest.json at the root.
// Written without dependencies so it runs on any OS without `zip` installed.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.join(__dirname, '..');
const INCLUDE = ['manifest.json', 'icons', 'src', 'preview', 'vendor'];

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

// manifest.json targets Chrome; Firefox needs a few extra keys.
const TARGETS = {
  chrome: (base) => base,
  firefox: (base) => ({
    ...base,
    browser_specific_settings: {
      gecko: {
        // Permanent identifier of the add-on on addons.mozilla.org: never change it once published.
        id: 'mermaid-preview@maximebuguel',
        // First version supporting `data_collection_permissions`.
        strict_min_version: '140.0',
        // The extension does not collect or transmit any data.
        data_collection_permissions: { required: ['none'] },
      },
      // Same key on Firefox for Android, where it is supported from 142.
      gecko_android: { strict_min_version: '142.0' },
    },
  }),
};

function listFiles(relative) {
  const absolute = path.join(root, relative);
  if (!fs.statSync(absolute).isDirectory()) return [relative];
  return fs
    .readdirSync(absolute)
    .filter((name) => !name.startsWith('.'))
    .sort()
    .flatMap((name) => listFiles(path.posix.join(relative, name)));
}

/** Fails early if the manifest points to a file that would be missing from the zip. */
function checkManifestReferences(files) {
  const referenced = [
    ...Object.values(manifest.icons || {}),
    ...(manifest.content_scripts || []).flatMap((script) => [...(script.js || []), ...(script.css || [])]),
    ...(manifest.web_accessible_resources || []).flatMap((entry) => entry.resources),
  ];
  const missing = referenced.filter((file) => !files.includes(file));
  if (missing.length) throw new Error(`Files referenced by manifest.json are missing: ${missing.join(', ')}`);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/** `entries`: [{ name, data, mtime }] */
function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const data = entry.data;
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(data);
    const { time, day } = dosDateTime(entry.mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 file names
    local.writeUInt16LE(8, 8); // compression: deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra field length

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory header signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed to extract
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42); // offset of the local header

    localParts.push(local, name, compressed);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

const requested = process.argv.slice(2);
const unknown = requested.filter((target) => !TARGETS[target]);
if (unknown.length) {
  console.error(`Unknown target: ${unknown.join(', ')} (expected: ${Object.keys(TARGETS).join(', ')})`);
  process.exit(1);
}

const files = INCLUDE.flatMap(listFiles);
checkManifestReferences(files);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });

for (const target of requested.length ? requested : Object.keys(TARGETS)) {
  const targetManifest = Buffer.from(`${JSON.stringify(TARGETS[target](manifest), null, 2)}\n`);
  const entries = files.map((file) => ({
    name: file,
    data: file === 'manifest.json' ? targetManifest : fs.readFileSync(path.join(root, file)),
    mtime: fs.statSync(path.join(root, file)).mtime,
  }));

  const output = path.join(root, 'dist', `mermaid-preview-${manifest.version}-${target}.zip`);
  fs.writeFileSync(output, buildZip(entries));
  const size = (fs.statSync(output).size / 1024 / 1024).toFixed(2);
  console.log(`${path.relative(root, output)} (${files.length} files, ${size} MB)`);
}
