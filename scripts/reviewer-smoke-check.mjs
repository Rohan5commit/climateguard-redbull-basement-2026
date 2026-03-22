import assert from "node:assert/strict";

import { chromium } from "playwright";

import { ensureLocalAppServer } from "./lib/server-bootstrap.mjs";

const BASE_URL = process.env.CLIMATEGUARD_BASE_URL ?? "http://localhost:3000";

const API_CASES = [
  "1100 S Ocean Dr, Miami Beach, FL 33139",
  "1411 Clark Rd, Paradise, CA 95969",
  "1000 Bagby St, Houston, TX 77002",
];

function validateRiskResponse(payload, address) {
  assert.equal(typeof payload, "object", `API payload was not an object for ${address}`);
  assert.equal(typeof payload.resolvedAddress, "string", `Missing resolvedAddress for ${address}`);
  assert.equal(
    typeof payload.fiveYearRiskScore,
    "number",
    `Missing fiveYearRiskScore for ${address}`,
  );
  assert.ok(
    ["Low", "Moderate", "High", "Severe"].includes(payload.riskLevel),
    `Invalid risk level for ${address}: ${payload.riskLevel}`,
  );
  assert.ok(
    ["flood", "wildfire", "heat", "severeWeather"].includes(payload.topHazard),
    `Invalid top hazard for ${address}: ${payload.topHazard}`,
  );

  for (const key of ["flood", "wildfire", "heat", "severeWeather"]) {
    assert.equal(
      typeof payload.breakdown?.[key],
      "number",
      `Missing breakdown.${key} for ${address}`,
    );
  }

  assert.ok(
    Array.isArray(payload.actions) && payload.actions.length >= 3,
    `Expected at least 3 actions for ${address}`,
  );
  assert.ok(
    Array.isArray(payload.assistancePrograms) && payload.assistancePrograms.length >= 1,
    `Expected assistance programs for ${address}`,
  );
  assert.ok(
    Array.isArray(payload.dataSources) && payload.dataSources.length >= 1,
    `Expected data sources for ${address}`,
  );
  assert.ok(
    Array.isArray(payload.activeAlerts),
    `Expected activeAlerts array for ${address}`,
  );
  assert.equal(typeof payload.advisory, "string", `Missing advisory text for ${address}`);
  assert.ok(payload.advisory.trim().length >= 40, `Advisory was too short for ${address}`);
  assert.equal(typeof payload.generatedAt, "string", `Missing generatedAt for ${address}`);
}

async function runApiChecks() {
  for (const address of API_CASES) {
    const response = await fetch(`${BASE_URL}/api/risk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ address }),
    });

    assert.equal(response.ok, true, `API request failed for ${address} with HTTP ${response.status}`);
    const payload = await response.json();
    validateRiskResponse(payload, address);
  }
}

async function runUiChecks() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    colorScheme: "light",
    viewport: {
      width: 1440,
      height: 1200,
    },
  });

  const pageErrors = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "ClimateGuard" }).waitFor();
  await page.getByLabel("Address or ZIP code").fill(API_CASES[0]);
  await page.getByRole("button", { name: "Assess 5-Year Risk" }).click();
  await page.getByRole("heading", { name: "AI 5-year outlook" }).waitFor({ timeout: 90_000 });

  await page.getByText("Top hazard:", { exact: false }).waitFor();
  await page.getByRole("heading", { name: "Assistance programs" }).waitFor();
  await page.getByRole("heading", { name: "Data source status" }).waitFor();

  assert.equal(pageErrors.length, 0, `UI emitted page errors: ${pageErrors.join(" | ")}`);

  await browser.close();
}

async function main() {
  const server = await ensureLocalAppServer(BASE_URL);

  try {
    await runApiChecks();
    await runUiChecks();
    process.stdout.write("Reviewer smoke check passed.\n");
  } finally {
    await server?.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
