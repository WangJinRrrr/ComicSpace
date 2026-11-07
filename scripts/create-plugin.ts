import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const id = process.argv[2]?.trim();
const displayName = process.argv[3]?.trim() || id;

if (!id || !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(id)) {
  console.error(
    "Usage: pnpm plugin:new <id> [display name]\nid must match ^[a-z0-9][a-z0-9_-]{1,63}$",
  );
  process.exit(1);
}

const template = path.join(root, "templates", "plugin");
const target = path.join(root, "plugins", id);
if (fs.existsSync(target)) {
  console.error(`Plugin already exists: ${target}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.cpSync(template, target, { recursive: true });

const manifestPath = path.join(target, "plugin.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<
  string,
  unknown
>;
manifest.id = id;
manifest.name = displayName;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Created plugins/${id}`);
console.log("Next: edit plugin.json + index.ts, then reload plugins in Settings.");
