import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_MAX_REDIRECTS = 8;

export class CookieJar {
  constructor(cookies = []) {
    this.cookies = new Map();
    for (const cookie of cookies) {
      this.setCookieObject(cookie);
    }
  }

  static async fromStorageState(sessionFile) {
    const content = await fs.readFile(sessionFile, "utf8").catch((error) => {
      throw new Error(`no saved session at ${sessionFile}; run \`gradescope-cli login\` first`);
    });

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new Error(`read session file ${sessionFile}: ${error.message}`);
    }

    return new CookieJar(Array.isArray(parsed?.cookies) ? parsed.cookies : []);
  }

  setCookieObject(cookie) {
    const name = String(cookie?.name || "").trim();
    if (!name) {
      return;
    }

    const domain = String(cookie.domain || "").trim();
    const item = {
      name,
      value: String(cookie.value ?? ""),
      domain,
      path: String(cookie.path || "/"),
      expires: normalizeExpires(cookie.expires),
      httpOnly: Boolean(cookie.httpOnly),
      secure: Boolean(cookie.secure),
      sameSite: cookie.sameSite || "Lax",
    };
    this.cookies.set(cookieKey(item), item);
  }

  setCookieHeader(header, responseUrl) {
    for (const raw of splitSetCookieHeaders(header)) {
      const cookie = parseSetCookie(raw, responseUrl);
      if (cookie) {
        this.setCookieObject(cookie);
      }
    }
  }

  cookieHeader(url) {
    const target = new URL(url);
    const nowSeconds = Date.now() / 1000;
    const pairs = [];

    for (const [key, cookie] of this.cookies) {
      if (cookie.expires && cookie.expires > 0 && cookie.expires < nowSeconds) {
        this.cookies.delete(key);
        continue;
      }
      if (!cookieMatches(cookie, target)) {
        continue;
      }
      pairs.push(`${cookie.name}=${cookie.value}`);
    }

    return pairs.join("; ");
  }

  toStorageState() {
    return {
      cookies: [...this.cookies.values()],
      origins: [],
    };
  }
}

export class GradescopeHttpClient {
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl || "https://www.gradescope.com").replace(/\/+$/, "");
    this.sessionFile = options.sessionFile ? path.resolve(String(options.sessionFile)) : "";
    this.jar = options.jar || new CookieJar();
    this.lastUrl = this.baseUrl;
  }

  static async fromSession(options = {}) {
    const sessionFile = path.resolve(String(options.sessionFile || ""));
    const jar = await CookieJar.fromStorageState(sessionFile);
    return new GradescopeHttpClient({
      ...options,
      sessionFile,
      jar,
    });
  }

  async saveSession(sessionFile = this.sessionFile) {
    if (!sessionFile) {
      return;
    }
    await fs.mkdir(path.dirname(sessionFile), { recursive: true });
    await fs.writeFile(sessionFile, `${JSON.stringify(this.jar.toStorageState(), null, 2)}\n`);
  }

  async get(target, options = {}) {
    return this.request("GET", target, options);
  }

  async post(target, body, options = {}) {
    return this.request("POST", target, {
      ...options,
      body,
    });
  }

  async request(method, target, options = {}) {
    let url = this.absoluteUrl(target);
    let redirects = 0;
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

    while (true) {
      const headers = new Headers(options.headers || {});
      const cookie = this.jar.cookieHeader(url);
      if (cookie && !headers.has("cookie")) {
        headers.set("cookie", cookie);
      }
      if (!headers.has("user-agent")) {
        headers.set("user-agent", "gradescope-cli/0.3");
      }
      if (!headers.has("accept")) {
        headers.set("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
      }

      const response = await fetch(url, {
        method,
        headers,
        body: options.body,
        redirect: "manual",
      });

      readSetCookieHeaders(response.headers).forEach((value) => this.jar.setCookieHeader(value, url));

      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          return buildHttpResponse(response, url);
        }
        if (redirects >= maxRedirects) {
          throw new Error(`too many redirects while requesting ${url}`);
        }

        url = new URL(location, url).toString();
        this.lastUrl = url;
        redirects += 1;
        if (response.status === 303 || (response.status !== 307 && response.status !== 308)) {
          method = "GET";
          options = { ...options, body: undefined };
        }
        continue;
      }

      this.lastUrl = url;
      return buildHttpResponse(response, url);
    }
  }

  absoluteUrl(target) {
    return new URL(String(target || "/"), this.baseUrl).toString();
  }
}

function buildHttpResponse(response, url) {
  return {
    ok: response.ok,
    status: response.status,
    url,
    headers: response.headers,
    text: () => response.text(),
    arrayBuffer: () => response.arrayBuffer(),
  };
}

function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

function readSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const value = headers.get("set-cookie");
  return value ? splitSetCookieHeaders(value) : [];
}

function splitSetCookieHeaders(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(splitSetCookieHeaders);
  }

  const text = String(value);
  const result = [];
  let start = 0;
  let inExpires = false;
  for (let index = 0; index < text.length; index += 1) {
    const rest = text.slice(index).toLowerCase();
    if (rest.startsWith("expires=")) {
      inExpires = true;
    }
    const char = text[index];
    if (inExpires && char === ";") {
      inExpires = false;
    }
    if (!inExpires && char === "," && /\s*[^=;,]+=/u.test(text.slice(index + 1, index + 80))) {
      result.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  result.push(text.slice(start).trim());
  return result.filter(Boolean);
}

function parseSetCookie(raw, responseUrl) {
  const parts = String(raw || "").split(";").map((part) => part.trim()).filter(Boolean);
  const [nameValue, ...attributes] = parts;
  const separatorIndex = nameValue.indexOf("=");
  if (separatorIndex <= 0) {
    return null;
  }

  const target = new URL(responseUrl);
  const cookie = {
    name: nameValue.slice(0, separatorIndex),
    value: nameValue.slice(separatorIndex + 1),
    domain: target.hostname,
    path: defaultCookiePath(target.pathname),
    expires: -1,
    httpOnly: false,
    secure: target.protocol === "https:",
    sameSite: "Lax",
  };

  for (const attribute of attributes) {
    const [rawName, ...rawValueParts] = attribute.split("=");
    const name = rawName.toLowerCase();
    const value = rawValueParts.join("=");
    if (name === "domain") {
      cookie.domain = value.replace(/^\./, "");
    } else if (name === "path") {
      cookie.path = value || "/";
    } else if (name === "expires") {
      cookie.expires = Math.floor(Date.parse(value) / 1000) || -1;
    } else if (name === "max-age") {
      const seconds = Number.parseInt(value, 10);
      cookie.expires = Number.isFinite(seconds) ? Math.floor(Date.now() / 1000) + seconds : -1;
    } else if (name === "httponly") {
      cookie.httpOnly = true;
    } else if (name === "secure") {
      cookie.secure = true;
    } else if (name === "samesite") {
      cookie.sameSite = value || "Lax";
    }
  }

  return cookie;
}

function defaultCookiePath(pathname) {
  const value = String(pathname || "/");
  if (!value.startsWith("/") || value === "/") {
    return "/";
  }
  return value.slice(0, value.lastIndexOf("/") || 1);
}

function normalizeExpires(value) {
  if (value === undefined || value === null || value === "") {
    return -1;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : -1;
}

function cookieKey(cookie) {
  return `${cookie.domain || ""}\t${cookie.path || "/"}\t${cookie.name}`;
}

function cookieMatches(cookie, target) {
  const domain = String(cookie.domain || target.hostname).replace(/^\./, "");
  const hostname = target.hostname;
  const domainMatches = hostname === domain || hostname.endsWith(`.${domain}`);
  if (!domainMatches) {
    return false;
  }

  const cookiePath = cookie.path || "/";
  if (!target.pathname.startsWith(cookiePath)) {
    return false;
  }

  return !cookie.secure || target.protocol === "https:";
}
