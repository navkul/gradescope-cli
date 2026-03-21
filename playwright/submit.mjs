#!/usr/bin/env node

import fs from "node:fs/promises";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch (error) {
  console.error(
    "playwright is not installed. Run `npm install` and `npx playwright install chromium` from the repo root.",
  );
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error("usage: node playwright/submit.mjs <input.json> <output.json>");
  process.exit(1);
}

const request = JSON.parse(await fs.readFile(inputPath, "utf8"));
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext();
  await context.addCookies(normalizeCookies(request.cookies ?? [], request.baseUrl));

  const page = await context.newPage();
  page.setDefaultTimeout(request.timeoutMs ?? 45000);

  const assignmentURL = new URL(
    `/courses/${request.courseId}/assignments/${request.assignmentId}`,
    request.baseUrl,
  ).toString();

  await page.goto(assignmentURL, { waitUntil: "domcontentloaded" });
  await waitForNetworkIdle(page);
  ensureAuthenticated(page);

  await openSubmitFlow(page);
  await chooseVariableLengthPDF(page);
  await attachSubmissionFile(page, request.filePath);
  await submitUpload(page);
  await finalizeIfSelectPages(page);

  if (!page.url().includes("/submissions/")) {
    await page.goto(assignmentURL, { waitUntil: "domcontentloaded" });
    await waitForNetworkIdle(page);
  }

  if (!page.url().includes("/submissions/")) {
    throw new Error(`submit did not reach a submission page; final URL was ${page.url()}`);
  }

  await page.waitForTimeout(1500);

  await fs.writeFile(
    outputPath,
    JSON.stringify(
      {
        finalUrl: page.url(),
        html: await page.content(),
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}

function normalizeCookies(cookies, baseUrl) {
  return cookies.map((cookie) => {
    const item = {
      name: cookie.name,
      value: cookie.value,
      path: cookie.path || "/",
      secure: Boolean(cookie.secure),
      httpOnly: Boolean(cookie.httpOnly),
      sameSite: "Lax",
    };

    if (cookie.expires && cookie.expires > 0) {
      item.expires = cookie.expires;
    }

    if (cookie.domain) {
      item.domain = cookie.domain;
    } else {
      item.url = baseUrl;
    }

    return item;
  });
}

function ensureAuthenticated(page) {
  if (page.url().includes("/login")) {
    throw new Error("saved session is not authenticated; run `gradescope-cli login` first");
  }
}

async function waitForNetworkIdle(page) {
  try {
    await page.waitForLoadState("networkidle", { timeout: 15000 });
  } catch {
    // Gradescope keeps some background requests open; DOM state is enough here.
  }
}

async function openSubmitFlow(page) {
  if (await hasVisibleFileInput(page)) {
    return;
  }

  const opener = await firstVisible([
    page.locator(".js-submitAssignment").first(),
    page.getByRole("button", { name: /^(resubmit|submit)$/i }).first(),
    page.getByRole("link", { name: /^(resubmit|submit)$/i }).first(),
  ]);

  if (!opener) {
    throw new Error(`could not find a Submit or Resubmit control on ${page.url()}`);
  }

  await clickAndSettle(page, opener);
}

async function chooseVariableLengthPDF(page) {
  const pdfChoice = await firstVisible([
    page.locator("#submit-variable-length-pdf").first(),
    page.getByRole("button", { name: /submit pdf/i }).first(),
  ]);

  if (pdfChoice) {
    await clickAndSettle(page, pdfChoice);
  }
}

async function attachSubmissionFile(page, filePath) {
  const input = await firstVisible([
    page.locator("#submission_pdf_attachment").first(),
    page.locator("#submission_file").first(),
    page.locator("input[type=file]").first(),
  ]);

  if (!input) {
    throw new Error(`could not find a file input after opening the submit flow at ${page.url()}`);
  }

  await input.setInputFiles(filePath);
}

async function submitUpload(page) {
  const submitter = await firstVisible([
    page.locator("#submit-fixed-length-form input[type=submit]").first(),
    page.locator(".js-submitTypedDocumentForm input[type=submit]").first(),
    page.getByRole("button", { name: /^(upload|submit assignment|submit)$/i }).first(),
    page.locator("input[type=submit][value*='Upload'], input[type=submit][value*='Submit']").first(),
  ]);

  if (!submitter) {
    throw new Error(`could not find the final upload button at ${page.url()}`);
  }

  await clickAndSettle(page, submitter);
}

async function finalizeIfSelectPages(page) {
  if (!page.url().includes("/select_pages")) {
    return;
  }

  const finalize = await firstVisible([
    page.getByRole("button", { name: /submit assignment/i }).first(),
    page.getByRole("button", { name: /^submit$/i }).first(),
    page.locator("input[type=submit][value*='Submit']").first(),
  ]);

  if (!finalize) {
    throw new Error(
      `upload reached the page-assignment flow at ${page.url()}, but no final Submit button was visible`,
    );
  }

  await clickAndSettle(page, finalize);
}

async function clickAndSettle(page, locator) {
  await Promise.allSettled([
    page.waitForLoadState("domcontentloaded", { timeout: 15000 }),
    locator.click(),
  ]);
  await waitForNetworkIdle(page);
}

async function hasVisibleFileInput(page) {
  const input = await firstVisible([
    page.locator("#submission_pdf_attachment").first(),
    page.locator("#submission_file").first(),
    page.locator("input[type=file]").first(),
  ]);
  return Boolean(input);
}

async function firstVisible(locators) {
  for (const locator of locators) {
    try {
      if ((await locator.count()) > 0 && (await locator.isVisible())) {
        return locator;
      }
    } catch {
      // Ignore transient locator errors while the page is still rendering.
    }
  }

  return null;
}
