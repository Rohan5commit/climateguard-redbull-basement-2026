import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "playwright";

import { ensureLocalAppServer } from "./lib/server-bootstrap.mjs";

const BASE_URL = process.env.CLIMATEGUARD_BASE_URL ?? "http://localhost:3000";
const OUTPUT_DIR = resolve("docs/demo-screenshots");

const DEMO_CASES = [
  {
    address: "1100 S Ocean Dr, Miami Beach, FL 33139",
    filename: "miami-flood-risk.png",
  },
  {
    address: "1411 Clark Rd, Paradise, CA 95969",
    filename: "paradise-wildfire-risk.png",
  },
  {
    address: "1000 Bagby St, Houston, TX 77002",
    filename: "houston-hurricane-risk.png",
  },
];

async function captureCase(page, { address, filename }) {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.getByLabel("Address or ZIP code").fill(address);
  await page.getByRole("button", { name: "Assess 5-Year Risk" }).click();
  await page.getByRole("heading", { name: "AI 5-year outlook" }).waitFor({ timeout: 90_000 });
  await page.waitForTimeout(750);
  await page.screenshot({
    path: resolve(OUTPUT_DIR, filename),
    fullPage: true,
  });
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const server = await ensureLocalAppServer(BASE_URL);

  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      colorScheme: "light",
      viewport: {
        width: 1440,
        height: 1800,
      },
    });

    for (const demoCase of DEMO_CASES) {
      process.stdout.write(`Capturing ${demoCase.filename}\n`);
      await captureCase(page, demoCase);
    }

    await browser.close();
  } finally {
    await server?.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
