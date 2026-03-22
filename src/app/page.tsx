"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";

import type { RiskResponse } from "@/lib/types";

import styles from "./page.module.css";

const SAMPLE_ADDRESSES = [
  {
    label: "Miami Beach",
    value: "1100 S Ocean Dr, Miami Beach, FL 33139",
  },
  {
    label: "Paradise",
    value: "1411 Clark Rd, Paradise, CA 95969",
  },
  {
    label: "Houston",
    value: "1000 Bagby St, Houston, TX 77002",
  },
  {
    label: "Galveston",
    value: "2100 Harborside Dr, Galveston, TX 77550",
  },
  {
    label: "Palm Springs",
    value: "100 E Tahquitz Canyon Way, Palm Springs, CA 92262",
  },
];

const RISK_COLORS: Record<RiskResponse["riskLevel"], string> = {
  Low: "#7bf2b5",
  Moderate: "#ffd86a",
  High: "#ff8b5d",
  Severe: "#ff5c70",
};

const SOURCE_BADGE_LABEL: Record<string, string> = {
  live: "Live",
  fallback: "Fallback",
  unavailable: "Unavailable",
};

const HAZARD_LABELS: Record<RiskResponse["topHazard"], string> = {
  flood: "Flood",
  wildfire: "Wildfire",
  heat: "Heat",
  severeWeather: "Severe Weather",
};

export default function Home() {
  const [address, setAddress] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RiskResponse | null>(null);

  const scoreColor = useMemo(() => {
    if (!result) {
      return "#7bf2b5";
    }

    return RISK_COLORS[result.riskLevel];
  }, [result]);

  async function submitAssessment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!address.trim()) {
      setError("Enter an address or ZIP code.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/risk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address: address.trim() }),
      });

      const payload = (await response.json()) as RiskResponse | { error?: string };

      if (!response.ok) {
        setResult(null);
        setError((payload as { error?: string }).error ?? "Could not score this address.");
        return;
      }

      setResult(payload as RiskResponse);
    } catch (requestError) {
      console.error(requestError);
      setResult(null);
      setError("Request failed. Check your network and try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.ambientGlow} aria-hidden="true" />
      <main className={styles.main}>
        <section className={styles.hero}>
          <p className={styles.kicker}>Red Bull Basement 2026 MVP</p>
          <h1>ClimateGuard</h1>
          <p className={styles.heroText}>
            Household climate-risk advisor for renters and homeowners. Enter any U.S. address to
            get a five-year outlook grounded in Census geographies, FEMA National Risk Index data,
            NOAA alerts, and plain-language action steps.
          </p>
        </section>

        <section className={styles.panel}>
          <form onSubmit={submitAssessment} className={styles.form}>
            <label htmlFor="address" className={styles.label}>
              Address or ZIP code
            </label>
            <div className={styles.formRow}>
              <input
                id="address"
                name="address"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="e.g. 123 Main St, Miami, FL 33101"
                autoComplete="street-address"
                className={styles.input}
              />
              <button type="submit" className={styles.submitButton} disabled={isLoading}>
                {isLoading ? "Scanning..." : "Assess 5-Year Risk"}
              </button>
            </div>
            <div className={styles.sampleRow}>
              {SAMPLE_ADDRESSES.map((sampleAddress) => (
                <button
                  key={sampleAddress.value}
                  type="button"
                  className={styles.sampleButton}
                  onClick={() => setAddress(sampleAddress.value)}
                >
                  {sampleAddress.label}
                </button>
              ))}
            </div>
          </form>

          {error ? <p className={styles.error}>{error}</p> : null}
        </section>

        {result ? (
          <section className={styles.resultsGrid}>
            <article className={styles.scoreCard}>
              <header className={styles.scoreHeader}>
                <p>{result.resolvedAddress}</p>
                <span className={styles.confidence}>Confidence: {result.confidence}</span>
              </header>

              <div className={styles.gaugeWrap}>
                <div
                  className={styles.gauge}
                  style={{
                    ["--score" as string]: String(result.fiveYearRiskScore),
                    ["--risk-color" as string]: scoreColor,
                  }}
                >
                  <div className={styles.gaugeCenter}>
                    <strong>{result.fiveYearRiskScore}</strong>
                    <span>/100</span>
                  </div>
                </div>
                <div>
                  <p className={styles.riskPill}>{result.riskLevel} Risk</p>
                  <p className={styles.topHazard}>Top hazard: {HAZARD_LABELS[result.topHazard]}</p>
                  <ul className={styles.metricList}>
                    <li>
                      <span>Flood</span>
                      <strong>{result.breakdown.flood}/10</strong>
                    </li>
                    <li>
                      <span>Wildfire</span>
                      <strong>{result.breakdown.wildfire}/10</strong>
                    </li>
                    <li>
                      <span>Heat</span>
                      <strong>{result.breakdown.heat}/10</strong>
                    </li>
                    <li>
                      <span>Severe weather</span>
                      <strong>{result.breakdown.severeWeather}/10</strong>
                    </li>
                  </ul>
                </div>
              </div>

              <div className={styles.driverBlock}>
                <h2>Why this score</h2>
                <ul>
                  {result.keyDrivers.map((driver) => (
                    <li key={driver}>{driver}</li>
                  ))}
                </ul>
              </div>
            </article>

            <article className={styles.advisoryCard}>
              <h2>AI 5-year outlook</h2>
              <p>{result.advisory}</p>

              <h3>Top mitigation actions</h3>
              <ol className={styles.actionList}>
                {result.actions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ol>

              <h3>Active alerts</h3>
              {result.activeAlerts.length > 0 ? (
                <ul className={styles.alertList}>
                  {result.activeAlerts.map((alert) => (
                    <li key={`${alert.event}-${alert.headline}`}>
                      <strong>{alert.event}</strong>
                      <span>{alert.severity}</span>
                      <p>{alert.headline}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.alertFallback}>No active NOAA alerts at this moment.</p>
              )}
            </article>

            <article className={styles.programsCard}>
              <h2>Assistance programs</h2>
              <ul className={styles.programList}>
                {result.assistancePrograms.map((program) => (
                  <li key={program.name}>
                    <p>
                      <span>{program.scope === "federal" ? "Federal" : "State"}</span>
                      <Link href={program.url} target="_blank" rel="noreferrer">
                        {program.name}
                      </Link>
                    </p>
                    <p>{program.summary}</p>
                  </li>
                ))}
              </ul>
            </article>

            <article className={styles.sourcesCard}>
              <h2>Data source status</h2>
              <ul className={styles.sourcesList}>
                {result.dataSources.map((source) => (
                  <li key={`${source.name}-${source.note}`}>
                    <div>
                      <p>{source.name}</p>
                      <span>{source.note}</span>
                    </div>
                    <span
                      className={`${styles.sourceBadge} ${styles[`badge${source.status[0].toUpperCase()}${source.status.slice(1)}`]}`}
                    >
                      {SOURCE_BADGE_LABEL[source.status]}
                    </span>
                  </li>
                ))}
              </ul>
              <p className={styles.generatedAt}>
                Generated {new Date(result.generatedAt).toLocaleString()}
              </p>
            </article>
          </section>
        ) : null}
      </main>
    </div>
  );
}
