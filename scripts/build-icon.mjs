// Renders apps/desktop/build/icon.svg into the PNG/ICO assets electron-builder
// picks up from buildResources. Re-run after editing the SVG.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharp = createRequire(path.join(repoRoot, "apps", "server", "package.json"))("sharp");

const buildDir = path.join(repoRoot, "apps", "desktop", "build");
const svg = fs.readFileSync(path.join(buildDir, "icon.svg"));
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function renderPng(size) {
  return sharp(svg, { density: 384 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function packIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;

  images.forEach(({ size, data }, index) => {
    const entry = index * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, entry);
    directory.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    directory.writeUInt8(0, entry + 2); // palette count
    directory.writeUInt8(0, entry + 3); // reserved
    directory.writeUInt16LE(1, entry + 4); // color planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });

  return Buffer.concat([header, directory, ...images.map((image) => image.data)]);
}

const images = [];
for (const size of ICO_SIZES) {
  images.push({ size, data: await renderPng(size) });
}

fs.writeFileSync(path.join(buildDir, "icon.ico"), packIco(images));
fs.writeFileSync(path.join(buildDir, "icon.png"), await renderPng(512));

console.log(
  `[build-icon] icon.ico (${ICO_SIZES.join(", ")}) + icon.png → ${buildDir}`,
);
