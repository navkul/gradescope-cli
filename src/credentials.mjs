import fs from "node:fs/promises";
import { promptLine, promptSecret } from "./ui.mjs";

export async function loadCredentialFile(filePath) {
  const content = await fs.readFile(filePath, "utf8").catch((error) => {
    throw new Error(`read credentials file: ${error.message}`);
  });

  try {
    const parsed = JSON.parse(content);
    return {
      email: String(parsed.email || "").trim(),
      password: String(parsed.password || "").trim(),
    };
  } catch {
    const credentials = {
      email: "",
      password: "",
    };

    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      const parts = line.split("=");
      if (parts.length < 2) {
        continue;
      }

      const key = parts[0].trim();
      const value = parts.slice(1).join("=").trim().replace(/^["']|["']$/g, "");
      if (key === "email" || key === "GRADESCOPE_EMAIL") {
        credentials.email = value;
      }
      if (key === "password" || key === "GRADESCOPE_PASSWORD") {
        credentials.password = value;
      }
    }

    return credentials;
  }
}

export async function loadCredentials(options = {}, { promptForMissing = false } = {}) {
  let email = String(options.email || "").trim();
  let password = String(options.password || "").trim();

  if (options.credentialsFile) {
    const fileCredentials = await loadCredentialFile(options.credentialsFile);
    email = email || fileCredentials.email;
    password = password || fileCredentials.password;
  }

  if (!password && options.passwordFile) {
    password = (await fs.readFile(options.passwordFile, "utf8").catch((error) => {
      throw new Error(`read password file: ${error.message}`);
    })).trim();
  }

  email = email || String(process.env.GRADESCOPE_EMAIL || "").trim();
  password = password || String(process.env.GRADESCOPE_PASSWORD || "").trim();

  if (promptForMissing) {
    if (!email) {
      email = await promptLine("Gradescope email: ");
    }
    if (!password) {
      password = await promptSecret("Gradescope password: ");
    }
  }

  if (!email) {
    throw new Error("missing email");
  }
  if (!password) {
    throw new Error("missing password");
  }

  return { email, password };
}
