import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ensureLocalAppServer } from "./lib/server-bootstrap.mjs";

const inputPath = resolve("data/test-addresses.csv");
const outputPath = resolve("data/validation-output.json");
const baseUrl = process.env.CLIMATEGUARD_BASE_URL ?? "http://localhost:3000";

function inferExpectedHazard(riskProfile) {
  const profile = (riskProfile ?? "").toLowerCase();

  if (/(wildfire|fire)/.test(profile)) {
    return "wildfire";
  }

  if (/(flood|surge|tidal|erosion|coastal|riverine|rain)/.test(profile)) {
    return "flood";
  }

  if (/(heat|hot|drought|dehydration)/.test(profile)) {
    return "heat";
  }

  if (/(wind|hurricane|tornado|storm|cyclone)/.test(profile)) {
    return "severeWeather";
  }

  return "flood";
}

function parseCsv(csvText) {
  const [headerLine, ...rows] = csvText.trim().split("\n");
  const headers = headerLine.split(",").map((header) => header.trim());

  return rows
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const parts = line.split(",");
      const item = {};

      headers.forEach((header, index) => {
        item[header] = (parts[index] ?? "").trim();
      });

      return item;
    });
}

async function scoreAddress(address) {
  const response = await fetch(`${baseUrl}/api/risk`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ address }),
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed for ${address}`);
  }

  return payload;
}

async function main() {
  const server = await ensureLocalAppServer(baseUrl);

  const csvText = await readFile(inputPath, "utf8");
  const rows = parseCsv(csvText);
  const report = [];
  let completedCount = 0;
  let dominantHazardMatches = 0;
  let usableCount = 0;

  try {
    for (const row of rows) {
      const submittedAddress = `${row.address}, ${row.city}, ${row.state} ${row.zip}`;
      process.stdout.write(`Scoring ${row.label}: ${submittedAddress}\n`);
      const expectedHazard = inferExpectedHazard(row.risk_profile);

      try {
        const result = await scoreAddress(submittedAddress);
        const actionCount = Array.isArray(result.actions) ? result.actions.length : 0;
        const alertCount = Array.isArray(result.activeAlerts) ? result.activeAlerts.length : 0;
        const expectedHazardMatched = result.topHazard === expectedHazard;

        completedCount += 1;
        dominantHazardMatches += expectedHazardMatched ? 1 : 0;
        usableCount += actionCount >= 3 ? 1 : 0;

        report.push({
          label: row.label,
          submittedAddress,
          expectedRiskProfile: row.risk_profile,
          expectedDominantHazard: expectedHazard,
          score: result.fiveYearRiskScore,
          riskLevel: result.riskLevel,
          breakdown: result.breakdown,
          topHazard: result.topHazard,
          expectedHazardMatched,
          activeAlertsCount: alertCount,
          actionCount,
          confidence: result.confidence,
          generatedAt: result.generatedAt,
          dataSourceStates: Array.isArray(result.dataSources)
            ? result.dataSources.map((source) => ({
                name: source.name,
                status: source.status,
              }))
            : [],
        });
      } catch (error) {
        report.push({
          label: row.label,
          submittedAddress,
          expectedRiskProfile: row.risk_profile,
          expectedDominantHazard: expectedHazard,
          error: error instanceof Error ? error.message : "Unknown validation error",
        });
      }
    }

    const total = rows.length;

    await writeFile(
      outputPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          baseUrl,
          summary: {
            total,
            completedCount,
            completionRatePct: total > 0 ? Number(((completedCount / total) * 100).toFixed(2)) : 0,
            dominantHazardMatchCount: dominantHazardMatches,
            dominantHazardMatchRatePct:
              total > 0 ? Number(((dominantHazardMatches / total) * 100).toFixed(2)) : 0,
            usableOutputsCount: usableCount,
            usableOutputsRatePct: total > 0 ? Number(((usableCount / total) * 100).toFixed(2)) : 0,
          },
          results: report,
        },
        null,
        2,
      ),
      "utf8",
    );

    process.stdout.write(`Validation report written to ${outputPath}\n`);
  } finally {
    await server?.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
