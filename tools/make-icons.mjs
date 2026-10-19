/**
 * Render the Lilac Fragment icon tile to the extension's toolbar icons.
 * Same tile as Fragment's desktop app: the "/." mark on black, 24 percent radius.
 *
 * Usage: node tools/make-icons.mjs (needs sharp resolvable, e.g. NODE_PATH at a node_modules that has it)
 */
import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "extension", "icons");

const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">
  <rect x="0" y="0" width="100" height="100" rx="24" fill="#000000"/>
  <g transform="translate(50 50) scale(0.66) translate(-50 -50)">
    <polygon fill="#ffffff" points="22,92 40,92 66,8 48,8"/>
    <circle fill="#C1B0FE" cx="78" cy="82" r="10"/>
  </g>
</svg>`);

for (const size of [16, 48, 128]) {
  await sharp(svg).resize(size, size).png().toFile(path.join(out, `icon${size}.png`));
  console.log(`wrote icon${size}.png`);
}
