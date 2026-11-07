import fs from "node:fs";
import path from "node:path";
import { extensionForMime } from "../cache/key.js";

export function downloadDir(root: string, id: number): string {
  return path.join(root, String(id));
}

export function downloadPagePath(
  dir: string,
  index: number,
  mime: string,
): string {
  const name = `${String(index).padStart(5, "0")}.${extensionForMime(mime)}`;
  return path.join(dir, name);
}

export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative !== "" &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

export async function removeDir(dir: string): Promise<void> {
  await fs.promises.rm(dir, { recursive: true, force: true });
}
