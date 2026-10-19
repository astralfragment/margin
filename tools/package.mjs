import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXT = join(ROOT, 'extension');
const DIST = join(ROOT, 'dist');
const SKIPPED = /(^|[\\/])\.|\.pem$|Thumbs\.db$/i;

/**
 * Lists every file under a folder that belongs in a release, as paths relative to it.
 * @param {string} dir The folder to walk.
 */
function filesIn(dir) {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((path) => !SKIPPED.test(path) && statSync(join(dir, path)).isFile())
    .map((path) => path.replaceAll('\\', '/'))
    .sort();
}

/**
 * Builds a zip archive with every entry deflated.
 * @param {{ name: string, data: Buffer }[]} entries Archive paths with forward slashes, and their contents.
 */
function zip(entries) {
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/**
 * The extension ID Chrome derives from the manifest's public key.
 * @param {string} key The base64 public key from the manifest.
 */
function extensionId(key) {
  return [...createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32)]
    .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
    .join('');
}

const manifestText = readFileSync(join(EXT, 'manifest.json'), 'utf8');
const manifest = JSON.parse(manifestText);
if (!manifest.key) throw new Error('manifest.json has no key, so every install would get a different ID');
const { version } = manifest;
const id = extensionId(manifest.key);
const teamZip = `margin-${version}.zip`;
const storeZip = `margin-${version}-web-store.zip`;

/**
 * Fills a document template from tools/ with this build's details.
 * @param {string} file The template file name.
 */
function fill(file) {
  const text = readFileSync(join(ROOT, 'tools', file), 'utf8')
    .replaceAll('{{version}}', version)
    .replaceAll('{{id}}', id)
    .replaceAll('{{teamZip}}', teamZip)
    .replaceAll('{{storeZip}}', storeZip);
  return Buffer.from(text);
}

const files = filesIn(EXT);
const read = (path) => readFileSync(join(EXT, path));
const { key, ...storeManifest } = manifest;

mkdirSync(DIST, { recursive: true });
writeFileSync(
  join(DIST, teamZip),
  zip([
    { name: 'Install and update Margin.html', data: fill('install-guide.html') },
    ...files.map((path) => ({ name: `Margin/${path}`, data: read(path) })),
  ]),
);
writeFileSync(
  join(DIST, storeZip),
  zip(
    files.map((path) => ({
      name: path,
      data: path === 'manifest.json' ? Buffer.from(`${JSON.stringify(storeManifest, null, 2)}\n`) : read(path),
    })),
  ),
);
writeFileSync(join(DIST, 'Web Store listing.html'), fill('store-listing.html'));

console.log(`Margin ${version}, extension ID ${id}, ${files.length} files`);
for (const name of [teamZip, storeZip, 'Web Store listing.html']) {
  console.log(`  ${relative(ROOT, join(DIST, name))}  ${Math.round(statSync(join(DIST, name)).size / 1024)} KB`);
}
