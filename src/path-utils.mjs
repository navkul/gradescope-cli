import fs from "node:fs/promises";
import path from "node:path";
import { normalizeStringList } from "./submission-options.mjs";

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

export function resolveUploadPaths(rawPaths, cwd = process.cwd()) {
  const values = normalizeStringList(rawPaths);
  if (values.length === 0) {
    throw new Error("missing file path");
  }

  return values.map((rawPath) => resolveUploadPath(rawPath, cwd));
}

export async function validateUploadPaths(rawPaths, cwd = process.cwd()) {
  const resolvedPaths = resolveUploadPaths(rawPaths, cwd);
  const validated = [];

  for (const resolvedPath of resolvedPaths) {
    const info = await fs.stat(resolvedPath.absolutePath).catch((error) => {
      throw new Error(`submission file ${resolvedPath.absolutePath}: ${error.message}`);
    });

    if (info.isDirectory()) {
      throw new Error(`submission file ${resolvedPath.absolutePath} is a directory`);
    }

    validated.push(resolvedPath);
  }

  return validated;
}
