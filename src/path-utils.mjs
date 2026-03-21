import fs from "node:fs/promises";
import path from "node:path";

export function resolveUploadPath(rawPath, cwd = process.cwd()) {
  const trimmed = String(rawPath || "").trim();
  if (!trimmed) {
    throw new Error("missing file path");
  }

  const absolutePath = path.resolve(cwd, trimmed);
  const relativePath = path.relative(cwd, absolutePath);
  const displayPath = !relativePath.startsWith("..") && !path.isAbsolute(relativePath)
    ? relativePath || path.basename(absolutePath)
    : absolutePath;

  return {
    absolutePath,
    displayPath,
  };
}

export async function validateUploadPath(rawPath, cwd = process.cwd()) {
  const resolved = resolveUploadPath(rawPath, cwd);
  const info = await fs.stat(resolved.absolutePath).catch((error) => {
    throw new Error(`submission file ${resolved.absolutePath}: ${error.message}`);
  });

  if (info.isDirectory()) {
    throw new Error(`submission file ${resolved.absolutePath} is a directory`);
  }

  return resolved;
}
