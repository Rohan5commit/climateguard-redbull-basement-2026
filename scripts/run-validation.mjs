import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const inputPath = resolve("data/test-addresses.csv");
const outputPath = resolve("data/validation-output.json");
const baseUrl = process.env.CLIMATEGUARD_BASE_URL ?? "http://localhost:3000";

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
  const csvText = await readFile(inputPath, "utf8");
  const rows = parseCsv(csvText);
  const report = [];

  for (const row of rows) {
    const submittedAddress = `${row.address}, ${row.city}, ${row.state} ${row.zip}`;
    process.stdout.write(`Scoring ${row.label}: ${submittedAddress}\n`);

    try {
      const result = await scoreAddress(submittedAddress);
      report.push({
        label: row.label,
        submittedAddress,
        expectedRiskProfile: row.risk_profile,
        score: result.fiveYearRiskScore,
        riskLevel: result.riskLevel,
        breakdown: result.breakdown,
        confidence: result.confidence,
        generatedAt: result.generatedAt,
      });
    } catch (error) {
      report.push({
        label: row.label,
        submittedAddress,
        expectedRiskProfile: row.risk_profile,
        error: error instanceof Error ? error.message : "Unknown validation error",
      });
    }
  }

  await writeFile(
    outputPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseUrl,
        results: report,
      },
      null,
      2,
    ),
    "utf8",
  );

  process.stdout.write(`Validation report written to ${outputPath}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
