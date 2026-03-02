import { AzureOpenAI, OpenAI } from "openai";

import { getProgramsForState } from "@/lib/programs";
import type {
  DataSourceStatus,
  GeocodedLocation,
  RiskBreakdown,
  RiskLevel,
  RiskResponse,
} from "@/lib/types";

const STATE_NAME_TO_CODE: Record<string, string> = {
  Alabama: "AL",
  Alaska: "AK",
  Arizona: "AZ",
  Arkansas: "AR",
  California: "CA",
  Colorado: "CO",
  Connecticut: "CT",
  Delaware: "DE",
  Florida: "FL",
  Georgia: "GA",
  Hawaii: "HI",
  Idaho: "ID",
  Illinois: "IL",
  Indiana: "IN",
  Iowa: "IA",
  Kansas: "KS",
  Kentucky: "KY",
  Louisiana: "LA",
  Maine: "ME",
  Maryland: "MD",
  Massachusetts: "MA",
  Michigan: "MI",
  Minnesota: "MN",
  Mississippi: "MS",
  Missouri: "MO",
  Montana: "MT",
  Nebraska: "NE",
  Nevada: "NV",
  "New Hampshire": "NH",
  "New Jersey": "NJ",
  "New Mexico": "NM",
  "New York": "NY",
  "North Carolina": "NC",
  "North Dakota": "ND",
  Ohio: "OH",
  Oklahoma: "OK",
  Oregon: "OR",
  Pennsylvania: "PA",
  "Rhode Island": "RI",
  "South Carolina": "SC",
  "South Dakota": "SD",
  Tennessee: "TN",
  Texas: "TX",
  Utah: "UT",
  Vermont: "VT",
  Virginia: "VA",
  Washington: "WA",
  "West Virginia": "WV",
  Wisconsin: "WI",
  Wyoming: "WY",
  "District of Columbia": "DC",
};

const FLOOD_INCIDENT_KEYWORDS = [
  "flood",
  "hurricane",
  "coastal storm",
  "tropical storm",
  "storm surge",
  "typhoon",
];

const WILDFIRE_INCIDENT_KEYWORDS = ["fire", "wildfire"];

const SEVERE_WEATHER_KEYWORDS = [
  "severe storm",
  "tornado",
  "wind",
  "hail",
  "winter storm",
  "snowstorm",
  "ice storm",
  "freezing",
  "heat",
  "drought",
  "cold",
];

interface FirstStreetSignals {
  flood: number | null;
  wildfire: number | null;
  severeWeather: number | null;
}

interface SourceResult<T> {
  value: T;
  source: DataSourceStatus;
}

interface WeatherSignals {
  flood: number;
  wildfire: number;
  severeWeather: number;
  alertCount: number;
}

interface FemaSignals {
  flood: number;
  wildfire: number;
  severeWeather: number;
  totalDeclarations: number;
}

interface AdvisoryResult {
  text: string;
  source: DataSourceStatus;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundToOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizeStateCode(input?: string): string | undefined {
  if (!input) {
    return undefined;
  }

  if (input.length === 2) {
    return input.toUpperCase();
  }

  return STATE_NAME_TO_CODE[input.trim()];
}

const COUNTY_DESIGNATOR_PATTERN =
  /\b(city and borough|county|parish|borough|census area|municipality|independent city|city)\b/gi;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeCountyLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[.&]/g, " ")
    .replace(/\bst\b/g, "saint")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(COUNTY_DESIGNATOR_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countyMatchesDesignatedArea(county: string, designatedArea?: string): boolean {
  if (!designatedArea) {
    return false;
  }

  const normalizedCounty = normalizeCountyLabel(county);

  if (!normalizedCounty) {
    return false;
  }

  const normalizedAreaParts = designatedArea
    .split(/,|\/|;|\band\b/gi)
    .map((part) => normalizeCountyLabel(part))
    .filter(Boolean);

  if (normalizedAreaParts.some((part) => part === normalizedCounty)) {
    return true;
  }

  const normalizedArea = normalizeCountyLabel(designatedArea);

  if (!normalizedArea) {
    return false;
  }

  const countyPattern = new RegExp(`\\b${escapeRegExp(normalizedCounty)}\\b`, "i");
  return countyPattern.test(normalizedArea);
}

function toScoreFromCount(count: number, highCountThreshold: number): number {
  if (highCountThreshold <= 0) {
    return 0;
  }

  return clamp((count / highCountThreshold) * 10, 0, 10);
}

function toRiskLevel(score: number): RiskLevel {
  if (score >= 75) {
    return "Severe";
  }

  if (score >= 55) {
    return "High";
  }

  if (score >= 35) {
    return "Moderate";
  }

  return "Low";
}

function weightedAverage(
  values: Array<{ value: number | null; weight: number }>,
  fallback = 0,
): number {
  let weightedTotal = 0;
  let totalWeight = 0;

  for (const item of values) {
    if (item.value === null || Number.isNaN(item.value)) {
      continue;
    }

    weightedTotal += item.value * item.weight;
    totalWeight += item.weight;
  }

  if (totalWeight === 0) {
    return fallback;
  }

  return clamp(weightedTotal / totalWeight, 0, 10);
}

function getPathValue(payload: unknown, path: string): unknown {
  if (payload === null || typeof payload !== "object") {
    return undefined;
  }

  return path.split(".").reduce<unknown>((accumulator, key) => {
    if (accumulator === null || typeof accumulator !== "object") {
      return undefined;
    }

    return (accumulator as Record<string, unknown>)[key];
  }, payload);
}

function normalizeExternalFactor(rawValue: number): number {
  if (rawValue <= 10) {
    return rawValue;
  }

  if (rawValue <= 100) {
    return rawValue / 10;
  }

  return rawValue / 100;
}

function pickNumeric(payload: unknown, paths: string[]): number | null {
  for (const path of paths) {
    const candidate = getPathValue(payload, path);

    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return clamp(normalizeExternalFactor(candidate), 0, 10);
    }

    if (typeof candidate === "string") {
      const parsed = Number(candidate);

      if (Number.isFinite(parsed)) {
        return clamp(normalizeExternalFactor(parsed), 0, 10);
      }
    }
  }

  return null;
}

function buildKeyDrivers(breakdown: RiskBreakdown, riskLevel: RiskLevel): string[] {
  const drivers: string[] = [];

  if (breakdown.flood >= 6.5) {
    drivers.push("Flood and storm-surge exposure is elevated in this area.");
  }

  if (breakdown.wildfire >= 6.5) {
    drivers.push("Wildfire-related loss signals are materially above average.");
  }

  if (breakdown.severeWeather >= 6.5) {
    drivers.push("Severe-weather declarations and alerts indicate recurring disruption risk.");
  }

  if (drivers.length === 0) {
    drivers.push("Current signals are lower than most high-loss U.S. zones, but risk is not zero.");
  }

  if (riskLevel === "Severe") {
    drivers.push("Insurer retreat pressure may increase over the next five years in similar risk clusters.");
  }

  return drivers;
}

function buildActions(
  breakdown: RiskBreakdown,
  stateCode?: string,
  county?: string,
): string[] {
  const actions = new Set<string>();

  if (breakdown.flood >= 6) {
    actions.add("Get a flood endorsement quote now and compare NFIP pricing before renewal season.");
    actions.add("Document first-floor elevation, drainage paths, and valuables inventory for faster claims.");
  }

  if (breakdown.wildfire >= 6) {
    actions.add("Create a 5-foot noncombustible zone around the structure and clear roof/gutter fuels.");
    actions.add("Request a wildfire-hardening inspection and keep records to support underwriting.");
  }

  if (breakdown.severeWeather >= 6) {
    actions.add("Install impact-rated protections (roof attachment, shutters, or reinforced garage door).");
    actions.add("Prepare backup power and a communication plan for multi-day weather disruptions.");
  }

  actions.add("Set a 90-day insurance renewal alert to avoid surprise cancellations.");

  if (stateCode && county) {
    actions.add(`Track ${county} County and ${stateCode} emergency alerts for grant windows and mitigation deadlines.`);
  }

  return Array.from(actions).slice(0, 5);
}

async function geocodeAddress(address: string): Promise<SourceResult<GeocodedLocation>> {
  const azureMapsKey = process.env.AZURE_MAPS_KEY;
  const enrichedQuery = /\b(usa|united states|us)\b/i.test(address)
    ? address
    : `${address}, USA`;

  if (azureMapsKey) {
    const azureUrl = new URL("https://atlas.microsoft.com/search/address/json");
    azureUrl.searchParams.set("api-version", "1.0");
    azureUrl.searchParams.set("subscription-key", azureMapsKey);
    azureUrl.searchParams.set("query", enrichedQuery);
    azureUrl.searchParams.set("limit", "1");
    azureUrl.searchParams.set("countrySet", "US");

    const response = await fetch(azureUrl, { cache: "no-store" });

    if (response.ok) {
      const payload = (await response.json()) as {
        results?: Array<{
          position?: { lat?: number; lon?: number };
          address?: {
            freeformAddress?: string;
            municipality?: string;
            countrySecondarySubdivision?: string;
            countrySubdivisionCode?: string;
            postalCode?: string;
          };
        }>;
      };

      const firstResult = payload.results?.[0];
      const lat = firstResult?.position?.lat;
      const lon = firstResult?.position?.lon;

      if (typeof lat === "number" && typeof lon === "number") {
        return {
          value: {
            lat,
            lon,
            city: firstResult?.address?.municipality,
            county: firstResult?.address?.countrySecondarySubdivision,
            state: normalizeStateCode(firstResult?.address?.countrySubdivisionCode),
            postalCode: firstResult?.address?.postalCode,
            resolvedAddress: firstResult?.address?.freeformAddress ?? enrichedQuery,
          },
          source: {
            name: "Azure Maps Geocoding",
            status: "live",
            note: "Address geocoded with Azure Maps.",
          },
        };
      }
    }
  }

  const nominatimUrl = new URL("https://nominatim.openstreetmap.org/search");
  nominatimUrl.searchParams.set("q", enrichedQuery);
  nominatimUrl.searchParams.set("format", "json");
  nominatimUrl.searchParams.set("limit", "1");
  nominatimUrl.searchParams.set("addressdetails", "1");
  nominatimUrl.searchParams.set("countrycodes", "us");

  const nominatimResponse = await fetch(nominatimUrl, {
    cache: "no-store",
    headers: {
      "User-Agent": "ClimateGuardMVP/1.0",
      Accept: "application/json",
    },
  });

  if (!nominatimResponse.ok) {
    throw new Error("Unable to geocode this address.");
  }

  const nominatimPayload = (await nominatimResponse.json()) as Array<{
    lat?: string;
    lon?: string;
    display_name?: string;
    address?: {
      city?: string;
      town?: string;
      village?: string;
      county?: string;
      state?: string;
      postcode?: string;
    };
  }>;

  const first = nominatimPayload[0];
  const lat = Number(first?.lat);
  const lon = Number(first?.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("Address lookup succeeded but coordinates were missing.");
  }

  return {
    value: {
      lat,
      lon,
      city: first?.address?.city ?? first?.address?.town ?? first?.address?.village,
      county: first?.address?.county,
      state: normalizeStateCode(first?.address?.state),
      postalCode: first?.address?.postcode,
      resolvedAddress: first?.display_name ?? enrichedQuery,
    },
    source: {
      name: "Azure Maps Geocoding",
      status: "fallback",
      note: "AZURE_MAPS_KEY missing or unavailable, using OpenStreetMap geocoding fallback.",
    },
  };
}

async function fetchFemaSignals(stateCode?: string, county?: string): Promise<SourceResult<FemaSignals>> {
  if (!stateCode) {
    return {
      value: {
        flood: 4,
        wildfire: 4,
        severeWeather: 4,
        totalDeclarations: 0,
      },
      source: {
        name: "FEMA Disaster Declarations",
        status: "fallback",
        note: "State could not be resolved, using neutral historical baseline.",
      },
    };
  }

  const sinceYear = new Date().getUTCFullYear() - 10;
  const filter = `state eq '${stateCode}' and declarationDate ge '${sinceYear}-01-01T00:00:00.000Z'`;
  const url = new URL("https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries");
  url.searchParams.set("$filter", filter);
  url.searchParams.set("$top", "1000");
  url.searchParams.set("$select", "incidentType,designatedArea");

  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    return {
      value: {
        flood: 4.5,
        wildfire: 4.2,
        severeWeather: 4.4,
        totalDeclarations: 0,
      },
      source: {
        name: "FEMA Disaster Declarations",
        status: "fallback",
        note: "FEMA API unavailable during request; neutral baseline applied.",
      },
    };
  }

  const payload = (await response.json()) as {
    DisasterDeclarationsSummaries?: Array<{ incidentType?: string; designatedArea?: string }>;
  };

  const rows = payload.DisasterDeclarationsSummaries ?? [];
  const stateDeclarationCount = rows.length;

  if (stateDeclarationCount === 0) {
    return {
      value: {
        flood: 4,
        wildfire: 4,
        severeWeather: 4,
        totalDeclarations: 0,
      },
      source: {
        name: "FEMA Disaster Declarations",
        status: "fallback",
        note: `No state-level declarations returned for ${stateCode} in the selected period.`,
      },
    };
  }

  const requestedCounty = county?.trim();
  const countyRows = requestedCounty
    ? rows.filter((row) => countyMatchesDesignatedArea(requestedCounty, row.designatedArea))
    : [];
  const scopedRows = countyRows.length > 0 ? countyRows : rows;
  const totalDeclarations = scopedRows.length;

  const counts = {
    flood: 0,
    wildfire: 0,
    severeWeather: 0,
  };

  for (const row of scopedRows) {
    const type = (row.incidentType ?? "").toLowerCase();

    if (FLOOD_INCIDENT_KEYWORDS.some((keyword) => type.includes(keyword))) {
      counts.flood += 1;
    }

    if (WILDFIRE_INCIDENT_KEYWORDS.some((keyword) => type.includes(keyword))) {
      counts.wildfire += 1;
    }

    if (SEVERE_WEATHER_KEYWORDS.some((keyword) => type.includes(keyword))) {
      counts.severeWeather += 1;
    }
  }

  const note = requestedCounty
    ? countyRows.length > 0
      ? `Used ${totalDeclarations} county declarations from the last 10 years (${requestedCounty}, ${stateCode}).`
      : `No county-level matches for ${requestedCounty}; used ${totalDeclarations} state declarations from the last 10 years (${stateCode}).`
    : `Used ${totalDeclarations} state declarations from the last 10 years (${stateCode}).`;

  return {
    value: {
      flood: toScoreFromCount(counts.flood, 30),
      wildfire: toScoreFromCount(counts.wildfire, 20),
      severeWeather: toScoreFromCount(counts.severeWeather, 35),
      totalDeclarations,
    },
    source: {
      name: "FEMA Disaster Declarations",
      status: "live",
      note,
    },
  };
}

function severityWeight(severity?: string): number {
  switch ((severity ?? "").toLowerCase()) {
    case "extreme":
      return 3;
    case "severe":
      return 2;
    case "moderate":
      return 1.2;
    case "minor":
      return 0.7;
    default:
      return 1;
  }
}

async function fetchNoaaAlerts(lat: number, lon: number): Promise<SourceResult<WeatherSignals>> {
  const url = new URL("https://api.weather.gov/alerts/active");
  url.searchParams.set("point", `${lat.toFixed(4)},${lon.toFixed(4)}`);

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/geo+json",
      "User-Agent": "ClimateGuardMVP/1.0",
    },
  });

  if (!response.ok) {
    return {
      value: {
        flood: 0,
        wildfire: 0,
        severeWeather: 0,
        alertCount: 0,
      },
      source: {
        name: "NOAA/NWS Active Alerts",
        status: "fallback",
        note: "NOAA alert service unavailable for this request; current-alert weighting skipped.",
      },
    };
  }

  const payload = (await response.json()) as {
    features?: Array<{
      properties?: {
        event?: string;
        severity?: string;
      };
    }>;
  };

  const alerts = payload.features ?? [];
  let floodPoints = 0;
  let wildfirePoints = 0;
  let weatherPoints = 0;

  for (const feature of alerts) {
    const event = (feature.properties?.event ?? "").toLowerCase();
    const weight = severityWeight(feature.properties?.severity);

    if (/(flood|hurricane|storm surge|coastal flood|flash flood|tropical)/.test(event)) {
      floodPoints += weight;
    }

    if (/(fire|red flag|smoke)/.test(event)) {
      wildfirePoints += weight;
    }

    if (/(thunderstorm|tornado|wind|hail|heat|cold|winter|ice)/.test(event)) {
      weatherPoints += weight;
    }
  }

  return {
    value: {
      flood: clamp((floodPoints / 8) * 10, 0, 10),
      wildfire: clamp((wildfirePoints / 8) * 10, 0, 10),
      severeWeather: clamp((weatherPoints / 8) * 10, 0, 10),
      alertCount: alerts.length,
    },
    source: {
      name: "NOAA/NWS Active Alerts",
      status: "live",
      note: `${alerts.length} active regional weather alerts processed.`,
    },
  };
}

async function fetchFirstStreetSignals(
  lat: number,
  lon: number,
): Promise<SourceResult<FirstStreetSignals>> {
  const apiKey = process.env.FIRST_STREET_API_KEY;
  const apiBase = process.env.FIRST_STREET_API_BASE ?? "https://api.firststreet.org/v1";

  if (!apiKey) {
    return {
      value: {
        flood: null,
        wildfire: null,
        severeWeather: null,
      },
      source: {
        name: "First Street Risk API",
        status: "unavailable",
        note: "FIRST_STREET_API_KEY is not configured.",
      },
    };
  }

  const url = new URL("property/summary", apiBase.endsWith("/") ? apiBase : `${apiBase}/`);
  url.searchParams.set("lat", `${lat}`);
  url.searchParams.set("lng", `${lon}`);

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      apikey: apiKey,
      "x-api-key": apiKey,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    return {
      value: {
        flood: null,
        wildfire: null,
        severeWeather: null,
      },
      source: {
        name: "First Street Risk API",
        status: "fallback",
        note: `Request failed with HTTP ${response.status}; continuing with FEMA and NOAA signals.`,
      },
    };
  }

  const payload = await response.json();
  const flood = pickNumeric(payload, [
    "floodFactor",
    "flood.score",
    "flood.factor",
    "data.floodFactor",
  ]);
  const wildfire = pickNumeric(payload, [
    "fireFactor",
    "wildfireFactor",
    "fire.score",
    "data.fireFactor",
  ]);
  const severeWeather = pickNumeric(payload, [
    "windFactor",
    "heatFactor",
    "wind.score",
    "heat.score",
    "data.windFactor",
    "data.heatFactor",
  ]);

  if (flood === null && wildfire === null && severeWeather === null) {
    return {
      value: {
        flood,
        wildfire,
        severeWeather,
      },
      source: {
        name: "First Street Risk API",
        status: "fallback",
        note: "Response received but expected score fields were missing.",
      },
    };
  }

  return {
    value: {
      flood,
      wildfire,
      severeWeather,
    },
    source: {
      name: "First Street Risk API",
      status: "live",
      note: "Property-level climate factors loaded successfully.",
    },
  };
}

function computeCompositeBreakdown(
  firstStreet: FirstStreetSignals,
  fema: FemaSignals,
  weather: WeatherSignals,
): RiskBreakdown {
  const flood = weightedAverage([
    { value: firstStreet.flood, weight: 0.55 },
    { value: fema.flood, weight: 0.35 },
    { value: weather.flood, weight: 0.1 },
  ]);

  const wildfire = weightedAverage([
    { value: firstStreet.wildfire, weight: 0.55 },
    { value: fema.wildfire, weight: 0.35 },
    { value: weather.wildfire, weight: 0.1 },
  ]);

  const severeWeather = weightedAverage([
    { value: firstStreet.severeWeather, weight: 0.5 },
    { value: fema.severeWeather, weight: 0.35 },
    { value: weather.severeWeather, weight: 0.15 },
  ]);

  return {
    flood: roundToOne(flood),
    wildfire: roundToOne(wildfire),
    severeWeather: roundToOne(severeWeather),
  };
}

function confidenceFromSources(dataSources: DataSourceStatus[]): "Low" | "Medium" | "High" {
  const liveCount = dataSources.filter((source) => source.status === "live").length;

  if (liveCount >= 4) {
    return "High";
  }

  if (liveCount >= 2) {
    return "Medium";
  }

  return "Low";
}

function advisoryPrompt(
  location: GeocodedLocation,
  score: number,
  riskLevel: RiskLevel,
  breakdown: RiskBreakdown,
  actions: string[],
): string {
  return [
    `Location: ${location.resolvedAddress}`,
    `Five-year risk score: ${score}/100 (${riskLevel})`,
    `Flood score: ${breakdown.flood}/10`,
    `Wildfire score: ${breakdown.wildfire}/10`,
    `Severe weather score: ${breakdown.severeWeather}/10`,
    "Write a plain-English advisory (max 170 words) for a homeowner or renter.",
    "Include: practical risk meaning, urgency level, top three actions, and a reminder to verify local assistance programs.",
    `Suggested actions: ${actions.join("; ")}`,
    "No buzzwords. No legal disclaimer. Keep it direct and human.",
  ].join("\n");
}

function buildTemplateAdvisory(
  score: number,
  riskLevel: RiskLevel,
  location: GeocodedLocation,
  actions: string[],
): string {
  const urgencyLine =
    riskLevel === "Severe"
      ? "This area is in a severe-risk band. Treat insurance and mitigation as immediate priorities."
      : riskLevel === "High"
        ? "This area trends high risk over the next five years, so preparation should start now."
        : riskLevel === "Moderate"
          ? "This location shows moderate risk signals, with enough volatility to justify preventive upgrades."
          : "Current risk indicators are lower, but climate events remain possible and can change quickly.";

  const selectedActions = actions.slice(0, 3).map((action, index) => `${index + 1}. ${action}`);

  return [
    `${urgencyLine} ClimateGuard estimates a five-year score of ${score}/100 for ${location.resolvedAddress}.`,
    "Priority moves:",
    ...selectedActions,
    "Check federal and state assistance programs early so you can act before renewal or disaster deadlines.",
  ].join(" ");
}

async function generateAdvisory(
  location: GeocodedLocation,
  score: number,
  riskLevel: RiskLevel,
  breakdown: RiskBreakdown,
  actions: string[],
): Promise<AdvisoryResult> {
  const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const azureApiKey = process.env.AZURE_OPENAI_API_KEY;
  const azureDeployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  const azureApiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2024-10-21";

  if (azureEndpoint && azureApiKey && azureDeployment) {
    try {
      const client = new AzureOpenAI({
        endpoint: azureEndpoint,
        apiKey: azureApiKey,
        deployment: azureDeployment,
        apiVersion: azureApiVersion,
      });

      const completion = await client.chat.completions.create({
        model: azureDeployment,
        temperature: 0.3,
        max_tokens: 260,
        messages: [
          {
            role: "system",
            content:
              "You are ClimateGuard, a climate risk advisor. Be concrete, specific, and practical.",
          },
          {
            role: "user",
            content: advisoryPrompt(location, score, riskLevel, breakdown, actions),
          },
        ],
      });

      const advisory = completion.choices[0]?.message?.content?.trim();

      if (advisory) {
        return {
          text: advisory,
          source: {
            name: "Azure OpenAI Advisory",
            status: "live",
            note: "Advisory generated by Azure OpenAI.",
          },
        };
      }
    } catch (error) {
      console.error("Azure OpenAI advisory generation failed", error);
    }
  }

  const openAiApiKey = process.env.OPENAI_API_KEY;

  if (openAiApiKey) {
    try {
      const client = new OpenAI({ apiKey: openAiApiKey });
      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.3,
        max_tokens: 260,
        messages: [
          {
            role: "system",
            content:
              "You are ClimateGuard, a climate risk advisor. Be concrete, specific, and practical.",
          },
          {
            role: "user",
            content: advisoryPrompt(location, score, riskLevel, breakdown, actions),
          },
        ],
      });

      const advisory = completion.choices[0]?.message?.content?.trim();

      if (advisory) {
        return {
          text: advisory,
          source: {
            name: "OpenAI Advisory",
            status: "fallback",
            note: "Azure OpenAI not configured, using OpenAI API fallback.",
          },
        };
      }
    } catch (error) {
      console.error("OpenAI advisory generation failed", error);
    }
  }

  return {
    text: buildTemplateAdvisory(score, riskLevel, location, actions),
    source: {
      name: "AI Advisory",
      status: "fallback",
      note: "No OpenAI key configured, using deterministic advisory template.",
    },
  };
}

export async function generateRiskAssessment(inputAddress: string): Promise<RiskResponse> {
  const dataSources: DataSourceStatus[] = [];

  const geocoded = await geocodeAddress(inputAddress);
  dataSources.push(geocoded.source);

  const [femaSignals, weatherSignals, firstStreetSignals] = await Promise.all([
    fetchFemaSignals(geocoded.value.state, geocoded.value.county),
    fetchNoaaAlerts(geocoded.value.lat, geocoded.value.lon),
    fetchFirstStreetSignals(geocoded.value.lat, geocoded.value.lon),
  ]);

  dataSources.push(femaSignals.source, weatherSignals.source, firstStreetSignals.source);

  const breakdown = computeCompositeBreakdown(
    firstStreetSignals.value,
    femaSignals.value,
    weatherSignals.value,
  );

  const composite = Math.round(
    clamp(
      (breakdown.flood * 0.4 + breakdown.wildfire * 0.35 + breakdown.severeWeather * 0.25) * 10,
      0,
      100,
    ),
  );
  const riskLevel = toRiskLevel(composite);
  const keyDrivers = buildKeyDrivers(breakdown, riskLevel);
  const actions = buildActions(breakdown, geocoded.value.state, geocoded.value.county);

  const advisoryResult = await generateAdvisory(
    geocoded.value,
    composite,
    riskLevel,
    breakdown,
    actions,
  );
  dataSources.push(advisoryResult.source);

  const confidence = confidenceFromSources(dataSources);

  return {
    inputAddress,
    resolvedAddress: geocoded.value.resolvedAddress,
    location: geocoded.value,
    fiveYearRiskScore: composite,
    riskLevel,
    confidence,
    breakdown,
    keyDrivers,
    advisory: advisoryResult.text,
    actions,
    assistancePrograms: getProgramsForState(geocoded.value.state),
    dataSources,
    generatedAt: new Date().toISOString(),
  };
}
