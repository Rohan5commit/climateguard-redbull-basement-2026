import { getProgramsForState } from "@/lib/programs";
import type {
  ActiveAlert,
  DataSourceStatus,
  GeocodedLocation,
  HazardKey,
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
  "storm surge",
  "tropical storm",
  "typhoon",
];

const WILDFIRE_INCIDENT_KEYWORDS = ["fire", "wildfire", "smoke"];
const HEAT_INCIDENT_KEYWORDS = ["heat", "drought"];

const SEVERE_WEATHER_KEYWORDS = [
  "tornado",
  "wind",
  "hail",
  "winter storm",
  "ice storm",
  "freezing",
  "cold",
  "thunderstorm",
];

const NRI_SERVICE_ROOT =
  "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services";

const COMMON_NRI_OUT_FIELDS = [
  "STATE",
  "COUNTY",
  "STCOFIPS",
  "RISK_SCORE",
  "RISK_RATNG",
  "CFLD_RISKS",
  "IFLD_RISKS",
  "WFIR_RISKS",
  "HWAV_RISKS",
  "DRGT_RISKS",
  "HRCN_RISKS",
  "TRND_RISKS",
  "SWND_RISKS",
  "SOVI_SCORE",
  "RESL_SCORE",
];

interface SourceResult<T> {
  value: T;
  source: DataSourceStatus;
}

interface NriSignals {
  geography: string;
  compositeScore: number | null;
  compositeRating?: string;
  coastalFlood: number | null;
  inlandFlood: number | null;
  wildfire: number | null;
  heat: number | null;
  drought: number | null;
  hurricane: number | null;
  tornado: number | null;
  strongWind: number | null;
  socialVulnerability: number | null;
  resilience: number | null;
}

interface WeatherSignals {
  flood: number;
  wildfire: number;
  heat: number;
  severeWeather: number;
  alertCount: number;
  alerts: ActiveAlert[];
}

interface HistorySignals {
  flood: number;
  wildfire: number;
  heat: number;
  severeWeather: number;
  totalDeclarations: number;
}

interface AdvisoryResult {
  text: string;
  source: DataSourceStatus;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface FetchWithRetryOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  baseBackoffMs?: number;
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const DEFAULT_FETCH_TIMEOUT_MS = 8_000;
const DEFAULT_FETCH_RETRIES = 2;
const DEFAULT_FETCH_BACKOFF_MS = 180;

const GEOCODE_CACHE_TTL_MS = 30 * 60 * 1000;
const NRI_CACHE_TTL_MS = 60 * 60 * 1000;
const FEMA_HISTORY_CACHE_TTL_MS = 60 * 60 * 1000;
const NOAA_CACHE_TTL_MS = 5 * 60 * 1000;
const ADVISORY_CACHE_TTL_MS = 10 * 60 * 1000;

const geocodeCache = new Map<string, CacheEntry<SourceResult<GeocodedLocation>>>();
const nriTractCache = new Map<string, CacheEntry<SourceResult<NriSignals | null>>>();
const nriCountyCache = new Map<string, CacheEntry<SourceResult<NriSignals | null>>>();
const femaHistoryCache = new Map<string, CacheEntry<SourceResult<HistorySignals>>>();
const noaaCache = new Map<string, CacheEntry<SourceResult<WeatherSignals>>>();
const advisoryCache = new Map<string, CacheEntry<AdvisoryResult>>();

const geocodeInFlight = new Map<string, Promise<SourceResult<GeocodedLocation>>>();
const nriTractInFlight = new Map<string, Promise<SourceResult<NriSignals | null>>>();
const nriCountyInFlight = new Map<string, Promise<SourceResult<NriSignals | null>>>();
const femaHistoryInFlight = new Map<string, Promise<SourceResult<HistorySignals>>>();
const noaaInFlight = new Map<string, Promise<SourceResult<WeatherSignals>>>();
const advisoryInFlight = new Map<string, Promise<AdvisoryResult>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const cached = cache.get(key);

  if (!cached) {
    return undefined;
  }

  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }

  return cached.value;
}

async function withTtlCache<T>(
  cache: Map<string, CacheEntry<T>>,
  inFlight: Map<string, Promise<T>>,
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const cached = getCachedValue(cache, key);

  if (cached !== undefined) {
    return cached;
  }

  const active = inFlight.get(key);

  if (active) {
    return active;
  }

  const pending = loader()
    .then((value) => {
      cache.set(key, {
        value,
        expiresAt: Date.now() + ttlMs,
      });
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, pending);
  return pending;
}

function shouldRetryStatus(status: number): boolean {
  return RETRYABLE_STATUS_CODES.has(status);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function fetchWithRetry(
  input: string | URL,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
    retries = DEFAULT_FETCH_RETRIES,
    baseBackoffMs = DEFAULT_FETCH_BACKOFF_MS,
    signal: externalSignal,
    ...requestInit
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    const abortListener = () => {
      controller.abort();
    };

    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener("abort", abortListener, { once: true });
      }
    }

    try {
      const response = await fetch(input, {
        ...requestInit,
        signal: controller.signal,
      });

      if (shouldRetryStatus(response.status) && attempt < retries) {
        await sleep(baseBackoffMs * (attempt + 1));
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;

      if (attempt >= retries || externalSignal?.aborted) {
        break;
      }

      await sleep(baseBackoffMs * (attempt + 1));
    } finally {
      clearTimeout(timeoutId);

      if (externalSignal) {
        externalSignal.removeEventListener("abort", abortListener);
      }
    }
  }

  if (isAbortError(lastError)) {
    throw new Error(`Request timed out after ${timeoutMs}ms.`);
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error("External request failed.");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundToOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
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

function titleCase(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  return value
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

const COUNTY_DESIGNATOR_PATTERN =
  /\b(city and borough|county|parish|borough|census area|municipality|independent city|city)\b/gi;
const COUNTY_ENDING_PATTERN =
  /\b(city and borough|county|parish|borough|census area|municipality|independent city|city)\b$/i;

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

function formatCountyForAction(county: string): string {
  const cleaned = county.trim().replace(/\s+/g, " ");

  if (!cleaned) {
    return county;
  }

  if (COUNTY_ENDING_PATTERN.test(cleaned)) {
    return cleaned;
  }

  return `${cleaned} County`;
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

function maxDefined(...values: Array<number | null | undefined>): number | null {
  const filtered = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return filtered.length > 0 ? Math.max(...filtered) : null;
}

function blend(primary: number | null, secondary: number | null, primaryWeight: number): number {
  const secondaryWeight = 1 - primaryWeight;

  if (primary === null && secondary === null) {
    return 0;
  }

  if (primary === null) {
    return secondary ?? 0;
  }

  if (secondary === null) {
    return primary;
  }

  return primary * primaryWeight + secondary * secondaryWeight;
}

function toScoreFromCount(count: number, highCountThreshold: number): number {
  if (highCountThreshold <= 0) {
    return 0;
  }

  return clamp((count / highCountThreshold) * 10, 0, 10);
}

function hazardLabel(hazard: HazardKey): string {
  switch (hazard) {
    case "flood":
      return "Flood";
    case "wildfire":
      return "Wildfire";
    case "heat":
      return "Heat";
    case "severeWeather":
      return "Severe Weather";
    default:
      return "Climate";
  }
}

function readEnv(name: string): string | undefined {
  const trimmed = process.env[name]?.trim();
  return trimmed ? trimmed : undefined;
}

function toRiskLevel(score: number): RiskLevel {
  if (score >= 82) {
    return "Severe";
  }

  if (score >= 58) {
    return "High";
  }

  if (score >= 35) {
    return "Moderate";
  }

  return "Low";
}

function topHazardFromBreakdown(breakdown: RiskBreakdown): HazardKey {
  const maxValue = Math.max(
    breakdown.flood,
    breakdown.wildfire,
    breakdown.heat,
    breakdown.severeWeather,
  );

  // In coastal and riverine corridors, flood exposure often drives the practical
  // homeowner impact even when wind or heat scores are nearly identical.
  if (breakdown.flood >= 8.5 && maxValue - breakdown.flood <= 0.5) {
    return "flood";
  }

  const ordered = [
    { key: "flood" as const, value: breakdown.flood },
    { key: "wildfire" as const, value: breakdown.wildfire },
    { key: "heat" as const, value: breakdown.heat },
    { key: "severeWeather" as const, value: breakdown.severeWeather },
  ];

  ordered.sort((left, right) => right.value - left.value);
  return ordered[0]?.key ?? "flood";
}

function confidenceFromSources(dataSources: DataSourceStatus[]): "Low" | "Medium" | "High" {
  const liveCount = dataSources.filter((source) => source.status === "live").length;

  if (liveCount >= 5) {
    return "High";
  }

  if (liveCount >= 3) {
    return "Medium";
  }

  return "Low";
}

async function geocodeWithCensusAddress(address: string): Promise<SourceResult<GeocodedLocation> | null> {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress");
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("vintage", "Current_Current");
  url.searchParams.set("format", "json");

  const response = await fetchWithRetry(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "User-Agent": "ClimateGuardMVP/1.0",
    },
    timeoutMs: 6_000,
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    result?: {
      addressMatches?: Array<{
        matchedAddress?: string;
        coordinates?: {
          x?: number;
          y?: number;
        };
        addressComponents?: {
          city?: string;
          state?: string;
          zip?: string;
        };
        geographies?: {
          Counties?: Array<{
            GEOID?: string;
            NAME?: string;
          }>;
          States?: Array<{
            STUSAB?: string;
          }>;
          "Census Tracts"?: Array<{
            GEOID?: string;
          }>;
        };
      }>;
    };
  };

  const match = payload.result?.addressMatches?.[0];
  const lat = coerceNumber(match?.coordinates?.y);
  const lon = coerceNumber(match?.coordinates?.x);

  if (lat === null || lon === null) {
    return null;
  }

  const county = match?.geographies?.Counties?.[0];
  const state = match?.geographies?.States?.[0];
  const tract = match?.geographies?.["Census Tracts"]?.[0];

  return {
    value: {
      lat,
      lon,
      city: titleCase(match?.addressComponents?.city),
      county: county?.NAME,
      state: normalizeStateCode(state?.STUSAB ?? match?.addressComponents?.state),
      countyFips: county?.GEOID,
      tractFips: tract?.GEOID,
      postalCode: match?.addressComponents?.zip,
      resolvedAddress: match?.matchedAddress ?? address,
    },
    source: {
      name: "U.S. Census Geocoder",
      status: "live",
      note: "Address matched with U.S. Census geographies for county and tract-level risk lookup.",
    },
  };
}

async function reverseCensusGeographies(
  lat: number,
  lon: number,
): Promise<Partial<GeocodedLocation> | null> {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/geographies/coordinates");
  url.searchParams.set("x", String(lon));
  url.searchParams.set("y", String(lat));
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("vintage", "Current_Current");
  url.searchParams.set("format", "json");

  const response = await fetchWithRetry(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "User-Agent": "ClimateGuardMVP/1.0",
    },
    timeoutMs: 6_000,
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    result?: {
      geographies?: {
        Counties?: Array<{
          GEOID?: string;
          NAME?: string;
        }>;
        States?: Array<{
          STUSAB?: string;
        }>;
        "Census Tracts"?: Array<{
          GEOID?: string;
        }>;
      };
    };
  };

  const county = payload.result?.geographies?.Counties?.[0];
  const state = payload.result?.geographies?.States?.[0];
  const tract = payload.result?.geographies?.["Census Tracts"]?.[0];

  return {
    county: county?.NAME,
    state: normalizeStateCode(state?.STUSAB),
    countyFips: county?.GEOID,
    tractFips: tract?.GEOID,
  };
}

async function geocodeWithNominatim(address: string): Promise<SourceResult<GeocodedLocation> | null> {
  const nominatimUrl = new URL("https://nominatim.openstreetmap.org/search");
  nominatimUrl.searchParams.set("q", /\b(usa|united states|us)\b/i.test(address) ? address : `${address}, USA`);
  nominatimUrl.searchParams.set("format", "json");
  nominatimUrl.searchParams.set("limit", "1");
  nominatimUrl.searchParams.set("addressdetails", "1");
  nominatimUrl.searchParams.set("countrycodes", "us");

  const response = await fetchWithRetry(nominatimUrl, {
    cache: "no-store",
    headers: {
      "User-Agent": "ClimateGuardMVP/1.0",
      Accept: "application/json",
    },
    timeoutMs: 6_000,
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as Array<{
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

  const first = payload[0];
  const lat = coerceNumber(first?.lat);
  const lon = coerceNumber(first?.lon);

  if (lat === null || lon === null) {
    return null;
  }

  const censusGeo = await reverseCensusGeographies(lat, lon).catch(() => null);

  return {
    value: {
      lat,
      lon,
      city: titleCase(first?.address?.city ?? first?.address?.town ?? first?.address?.village),
      county: censusGeo?.county ?? first?.address?.county,
      state: censusGeo?.state ?? normalizeStateCode(first?.address?.state),
      countyFips: censusGeo?.countyFips,
      tractFips: censusGeo?.tractFips,
      postalCode: first?.address?.postcode,
      resolvedAddress: first?.display_name ?? address,
    },
    source: {
      name: "OpenStreetMap Nominatim",
      status: "fallback",
      note: "Census address match was unavailable; geocoded with OpenStreetMap and backfilled with Census geographies when possible.",
    },
  };
}

async function geocodeFromZip(
  zipCode: string,
  priorFailureNote: string,
): Promise<SourceResult<GeocodedLocation> | null> {
  const response = await fetchWithRetry(`https://api.zippopotam.us/us/${zipCode}`, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
    timeoutMs: 4_500,
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    "post code"?: string;
    places?: Array<{
      "place name"?: string;
      state?: string;
      "state abbreviation"?: string;
      latitude?: string;
      longitude?: string;
    }>;
  };

  const firstPlace = payload.places?.[0];
  const lat = coerceNumber(firstPlace?.latitude);
  const lon = coerceNumber(firstPlace?.longitude);

  if (lat === null || lon === null) {
    return null;
  }

  const censusGeo = await reverseCensusGeographies(lat, lon).catch(() => null);
  const stateCode = censusGeo?.state ?? normalizeStateCode(firstPlace?.["state abbreviation"] ?? firstPlace?.state);
  const city = titleCase(firstPlace?.["place name"]);

  return {
    value: {
      lat,
      lon,
      city,
      county: censusGeo?.county,
      state: stateCode,
      countyFips: censusGeo?.countyFips,
      tractFips: censusGeo?.tractFips,
      postalCode: zipCode,
      resolvedAddress: city && stateCode ? `${city}, ${stateCode} ${zipCode}` : `${zipCode}, USA`,
    },
    source: {
      name: "ZIP Centroid Geocoder",
      status: "fallback",
      note: `${priorFailureNote} Used ZIP centroid fallback via Zippopotam.us and Census geographies.`,
    },
  };
}

async function geocodeAddress(address: string): Promise<SourceResult<GeocodedLocation>> {
  const cacheKey = address.trim().toLowerCase();

  return withTtlCache(geocodeCache, geocodeInFlight, cacheKey, GEOCODE_CACHE_TTL_MS, async () => {
    try {
      const censusMatch = await geocodeWithCensusAddress(address);

      if (censusMatch) {
        return censusMatch;
      }
    } catch {
      // Continue to fallback geocoders.
    }

    try {
      const nominatimMatch = await geocodeWithNominatim(address);

      if (nominatimMatch) {
        return nominatimMatch;
      }
    } catch {
      // Continue to ZIP fallback when possible.
    }

    const zipMatch = address.match(/\b(\d{5})(?:-\d{4})?\b/);
    const zipCode = zipMatch?.[1];

    if (zipCode) {
      const zipFallback = await geocodeFromZip(
        zipCode,
        "Address-level geocoders were unavailable or returned no match.",
      ).catch(() => null);

      if (zipFallback) {
        return zipFallback;
      }
    }

    throw new Error("Unable to geocode this address.");
  });
}

function buildNriSourceName(scope: "tract" | "county"): string {
  return scope === "tract"
    ? "FEMA National Risk Index (Census tract)"
    : "FEMA National Risk Index (County)";
}

async function fetchNriRecord(
  scope: "tract" | "county",
  fips?: string,
): Promise<SourceResult<NriSignals | null>> {
  const label = buildNriSourceName(scope);

  if (!fips) {
    return {
      value: null,
      source: {
        name: label,
        status: "fallback",
        note:
          scope === "tract"
            ? "Census tract could not be resolved, so tract-level FEMA risk data is unavailable."
            : "County FIPS could not be resolved, so county-level FEMA risk data is unavailable.",
      },
    };
  }

  const service =
    scope === "tract"
      ? "National_Risk_Index_Census_Tracts"
      : "National_Risk_Index_Counties";
  const fieldName = scope === "tract" ? "TRACTFIPS" : "STCOFIPS";
  const outFields =
    scope === "tract" ? [...COMMON_NRI_OUT_FIELDS, "TRACTFIPS"] : COMMON_NRI_OUT_FIELDS;
  const url = new URL(`${NRI_SERVICE_ROOT}/${service}/FeatureServer/0/query`);
  url.searchParams.set("where", `${fieldName}='${fips}'`);
  url.searchParams.set("resultRecordCount", "1");
  url.searchParams.set("outFields", outFields.join(","));
  url.searchParams.set("f", "json");

  try {
    const response = await fetchWithRetry(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
      timeoutMs: 8_000,
    });

    if (!response.ok) {
      return {
        value: null,
        source: {
          name: label,
          status: "fallback",
          note: `FEMA National Risk Index request failed with HTTP ${response.status}.`,
        },
      };
    }

    const payload = (await response.json()) as {
      features?: Array<{
        attributes?: Record<string, unknown>;
      }>;
    };

    const attributes = payload.features?.[0]?.attributes;

    if (!attributes) {
      return {
        value: null,
        source: {
          name: label,
          status: "fallback",
          note: `No FEMA National Risk Index record was returned for ${fips}.`,
        },
      };
    }

    const geography =
      scope === "tract"
        ? `Tract ${String(attributes.TRACTFIPS ?? fips)}`
        : `${String(attributes.COUNTY ?? "County")}, ${String(attributes.STATE ?? "")}`.trim();

    return {
      value: {
        geography,
        compositeScore: coerceNumber(attributes.RISK_SCORE),
        compositeRating: typeof attributes.RISK_RATNG === "string" ? attributes.RISK_RATNG : undefined,
        coastalFlood: coerceNumber(attributes.CFLD_RISKS),
        inlandFlood: coerceNumber(attributes.IFLD_RISKS),
        wildfire: coerceNumber(attributes.WFIR_RISKS),
        heat: coerceNumber(attributes.HWAV_RISKS),
        drought: coerceNumber(attributes.DRGT_RISKS),
        hurricane: coerceNumber(attributes.HRCN_RISKS),
        tornado: coerceNumber(attributes.TRND_RISKS),
        strongWind: coerceNumber(attributes.SWND_RISKS),
        socialVulnerability: coerceNumber(attributes.SOVI_SCORE),
        resilience: coerceNumber(attributes.RESL_SCORE),
      },
      source: {
        name: label,
        status: "live",
        note: `Loaded FEMA National Risk Index ${scope}-level record for ${geography}.`,
      },
    };
  } catch (error) {
    return {
      value: null,
      source: {
        name: label,
        status: "fallback",
        note:
          error instanceof Error
            ? `FEMA National Risk Index request failed: ${error.message}`
            : "FEMA National Risk Index request failed.",
      },
    };
  }
}

async function fetchNriTractSignals(tractFips?: string): Promise<SourceResult<NriSignals | null>> {
  return withTtlCache(
    nriTractCache,
    nriTractInFlight,
    tractFips ?? "missing",
    NRI_CACHE_TTL_MS,
    () => fetchNriRecord("tract", tractFips),
  );
}

async function fetchNriCountySignals(countyFips?: string): Promise<SourceResult<NriSignals | null>> {
  return withTtlCache(
    nriCountyCache,
    nriCountyInFlight,
    countyFips ?? "missing",
    NRI_CACHE_TTL_MS,
    () => fetchNriRecord("county", countyFips),
  );
}

async function fetchFemaHistory(
  stateCode?: string,
  county?: string,
): Promise<SourceResult<HistorySignals>> {
  const cacheKey = `${stateCode ?? "none"}|${normalizeCountyLabel(county ?? "")}`;

  return withTtlCache(
    femaHistoryCache,
    femaHistoryInFlight,
    cacheKey,
    FEMA_HISTORY_CACHE_TTL_MS,
    async () => {
      if (!stateCode) {
        return {
          value: {
            flood: 0,
            wildfire: 0,
            heat: 0,
            severeWeather: 0,
            totalDeclarations: 0,
          },
          source: {
            name: "FEMA Disaster Declarations",
            status: "fallback",
            note: "State could not be resolved, so historical FEMA declaration weighting was skipped.",
          },
        };
      }

      const sinceYear = new Date().getUTCFullYear() - 10;
      const filter = `state eq '${stateCode}' and declarationDate ge '${sinceYear}-01-01T00:00:00.000Z'`;
      const url = new URL("https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries");
      url.searchParams.set("$filter", filter);
      url.searchParams.set("$top", "1000");
      url.searchParams.set("$select", "incidentType,designatedArea");

      try {
        const response = await fetchWithRetry(url, {
          cache: "no-store",
          timeoutMs: 8_000,
        });

        if (!response.ok) {
          return {
            value: {
              flood: 0,
              wildfire: 0,
              heat: 0,
              severeWeather: 0,
              totalDeclarations: 0,
            },
            source: {
              name: "FEMA Disaster Declarations",
              status: "fallback",
              note: `FEMA declaration history request failed with HTTP ${response.status}.`,
            },
          };
        }

        const payload = (await response.json()) as {
          DisasterDeclarationsSummaries?: Array<{ incidentType?: string; designatedArea?: string }>;
        };

        const rows = payload.DisasterDeclarationsSummaries ?? [];
        const requestedCounty = county?.trim();
        const countyRows = requestedCounty
          ? rows.filter((row) => countyMatchesDesignatedArea(requestedCounty, row.designatedArea))
          : [];
        const scopedRows = countyRows.length > 0 ? countyRows : rows;

        const counts = {
          flood: 0,
          wildfire: 0,
          heat: 0,
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

          if (HEAT_INCIDENT_KEYWORDS.some((keyword) => type.includes(keyword))) {
            counts.heat += 1;
          }

          if (SEVERE_WEATHER_KEYWORDS.some((keyword) => type.includes(keyword))) {
            counts.severeWeather += 1;
          }
        }

        return {
          value: {
            flood: toScoreFromCount(counts.flood, 14),
            wildfire: toScoreFromCount(counts.wildfire, 8),
            heat: toScoreFromCount(counts.heat, 6),
            severeWeather: toScoreFromCount(counts.severeWeather, 16),
            totalDeclarations: scopedRows.length,
          },
          source: {
            name: "FEMA Disaster Declarations",
            status: "live",
            note:
              requestedCounty && countyRows.length > 0
                ? `Used ${scopedRows.length} county-level declarations from the last 10 years.`
                : `Used ${scopedRows.length} state-level declarations from the last 10 years.`,
          },
        };
      } catch (error) {
        return {
          value: {
            flood: 0,
            wildfire: 0,
            heat: 0,
            severeWeather: 0,
            totalDeclarations: 0,
          },
          source: {
            name: "FEMA Disaster Declarations",
            status: "fallback",
            note:
              error instanceof Error
                ? `FEMA declaration history request failed: ${error.message}`
                : "FEMA declaration history request failed.",
          },
        };
      }
    },
  );
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
  const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)}`;

  return withTtlCache(noaaCache, noaaInFlight, cacheKey, NOAA_CACHE_TTL_MS, async () => {
    const url = new URL("https://api.weather.gov/alerts/active");
    url.searchParams.set("point", `${lat.toFixed(4)},${lon.toFixed(4)}`);

    try {
      const response = await fetchWithRetry(url, {
        cache: "no-store",
        headers: {
          Accept: "application/geo+json",
          "User-Agent": "ClimateGuardMVP/1.0",
        },
        timeoutMs: 7_000,
      });

      if (!response.ok) {
        return {
          value: {
            flood: 0,
            wildfire: 0,
            heat: 0,
            severeWeather: 0,
            alertCount: 0,
            alerts: [],
          },
          source: {
            name: "NOAA/NWS Active Alerts",
            status: "fallback",
            note: `NOAA alert service returned HTTP ${response.status}; live alert weighting was skipped.`,
          },
        };
      }

      const payload = (await response.json()) as {
        features?: Array<{
          properties?: {
            event?: string;
            severity?: string;
            headline?: string;
          };
        }>;
      };

      const alerts = payload.features ?? [];
      let floodPoints = 0;
      let wildfirePoints = 0;
      let heatPoints = 0;
      let severePoints = 0;

      const visibleAlerts: ActiveAlert[] = [];

      for (const feature of alerts) {
        const event = (feature.properties?.event ?? "").toLowerCase();
        const severity = feature.properties?.severity ?? "Unknown";
        const headline = feature.properties?.headline ?? feature.properties?.event ?? "Weather alert";
        const weight = severityWeight(severity);

        if (/(flood|hurricane|storm surge|coastal flood|flash flood|tropical)/.test(event)) {
          floodPoints += weight;
        }

        if (/(fire|red flag|smoke)/.test(event)) {
          wildfirePoints += weight;
        }

        if (/(heat|excessive heat|hot|drought)/.test(event)) {
          heatPoints += weight;
        }

        if (/(thunderstorm|tornado|wind|hail|winter|ice|cold)/.test(event)) {
          severePoints += weight;
        }

        if (visibleAlerts.length < 4) {
          visibleAlerts.push({
            event: feature.properties?.event ?? "Weather Alert",
            severity,
            headline,
          });
        }
      }

      return {
        value: {
          flood: clamp((floodPoints / 6) * 10, 0, 10),
          wildfire: clamp((wildfirePoints / 6) * 10, 0, 10),
          heat: clamp((heatPoints / 6) * 10, 0, 10),
          severeWeather: clamp((severePoints / 6) * 10, 0, 10),
          alertCount: alerts.length,
          alerts: visibleAlerts,
        },
        source: {
          name: "NOAA/NWS Active Alerts",
          status: "live",
          note: `${alerts.length} active regional alerts processed.`,
        },
      };
    } catch (error) {
      return {
        value: {
          flood: 0,
          wildfire: 0,
          heat: 0,
          severeWeather: 0,
          alertCount: 0,
          alerts: [],
        },
        source: {
          name: "NOAA/NWS Active Alerts",
          status: "fallback",
          note:
            error instanceof Error
              ? `NOAA alert request failed: ${error.message}`
              : "NOAA alert request failed.",
        },
      };
    }
  });
}

function computeBaseBreakdown(
  tract: NriSignals | null,
  county: NriSignals | null,
): RiskBreakdown {
  const tractFlood = maxDefined(tract?.coastalFlood, tract?.inlandFlood);
  const countyFlood = maxDefined(county?.coastalFlood, county?.inlandFlood);

  const tractHeat = maxDefined(tract?.heat, tract?.drought);
  const countyHeat = maxDefined(county?.heat, county?.drought);

  const tractSevere = maxDefined(tract?.hurricane, tract?.tornado, tract?.strongWind);
  const countySevere = maxDefined(county?.hurricane, county?.tornado, county?.strongWind);

  return {
    flood: roundToOne(clamp(blend(tractFlood, countyFlood, 0.8) / 10, 0, 10)),
    wildfire: roundToOne(clamp(blend(tract?.wildfire ?? null, county?.wildfire ?? null, 0.95) / 10, 0, 10)),
    heat: roundToOne(clamp(blend(tractHeat, countyHeat, 0.55) / 10, 0, 10)),
    severeWeather: roundToOne(clamp(blend(tractSevere, countySevere, 0.8) / 10, 0, 10)),
  };
}

function applyLiveSignals(
  base: RiskBreakdown,
  weather: WeatherSignals,
  history: HistorySignals,
): RiskBreakdown {
  return {
    flood: roundToOne(clamp(base.flood + weather.flood * 0.2 + history.flood * 0.15, 0, 10)),
    wildfire: roundToOne(clamp(base.wildfire + weather.wildfire * 0.25 + history.wildfire * 0.12, 0, 10)),
    heat: roundToOne(clamp(base.heat + weather.heat * 0.25 + history.heat * 0.12, 0, 10)),
    severeWeather: roundToOne(
      clamp(base.severeWeather + weather.severeWeather * 0.2 + history.severeWeather * 0.12, 0, 10),
    ),
  };
}

function communityStressScore(tract: NriSignals | null, county: NriSignals | null): number {
  const socialVulnerability = blend(
    tract?.socialVulnerability ?? null,
    county?.socialVulnerability ?? null,
    0.7,
  );
  const resilience = blend(tract?.resilience ?? null, county?.resilience ?? null, 0.7);

  return clamp((socialVulnerability + (100 - resilience)) / 20, 0, 10);
}

function buildKeyDrivers(
  breakdown: RiskBreakdown,
  topHazard: HazardKey,
  tract: NriSignals | null,
  county: NriSignals | null,
  weather: WeatherSignals,
  communityStress: number,
): string[] {
  const drivers: string[] = [];

  if (topHazard === "flood") {
    drivers.push("Flood and surge signals are elevated at the address level and across the surrounding county.");
  }

  if (topHazard === "wildfire") {
    drivers.push("Wildfire risk stands out relative to the other major hazards in this area.");
  }

  if (topHazard === "heat") {
    drivers.push("Heat and long-duration hot-weather stress are materially above average here.");
  }

  if (topHazard === "severeWeather") {
    drivers.push("Wind, storm, and hurricane-related loss patterns materially lift the five-year outlook.");
  }

  if ((county?.compositeScore ?? tract?.compositeScore ?? 0) >= 85) {
    drivers.push("County-wide FEMA risk remains elevated, which can drive insurance pressure even when block-by-block exposure varies.");
  }

  if (weather.alertCount > 0) {
    drivers.push(`There ${weather.alertCount === 1 ? "is" : "are"} ${weather.alertCount} active NOAA alert${weather.alertCount === 1 ? "" : "s"} near this location right now.`);
  }

  if (communityStress >= 7) {
    drivers.push("High social vulnerability paired with lower resilience increases recovery friction after disruption.");
  }

  return drivers.slice(0, 4);
}

function buildActions(
  breakdown: RiskBreakdown,
  topHazard: HazardKey,
  stateCode?: string,
  county?: string,
): string[] {
  const actions = new Set<string>();

  if (breakdown.flood >= 6 || topHazard === "flood") {
    actions.add("Get a flood endorsement quote now and compare NFIP pricing before renewal season.");
    actions.add("Document drainage paths, first-floor elevation, and valuables so a future claim is easier to prove.");
  }

  if (breakdown.wildfire >= 6 || topHazard === "wildfire") {
    actions.add("Create a 5-foot noncombustible zone and clear roof, gutter, and fence-line fuels.");
    actions.add("Request a wildfire-hardening inspection and keep the paperwork for underwriting conversations.");
  }

  if (breakdown.heat >= 6 || topHazard === "heat") {
    actions.add("Add backup cooling, shade, and hydration planning before the hottest months begin.");
    actions.add("Check AC performance now and keep a list of cooling centers and power-outage backup options.");
  }

  if (breakdown.severeWeather >= 6 || topHazard === "severeWeather") {
    actions.add("Reinforce wind weak points such as roof attachment, shutters, and garage-door protection.");
    actions.add("Prepare backup power and a communication plan for multi-day storm disruption.");
  }

  actions.add("Set a 90-day insurance renewal alert to avoid surprise non-renewals or premium spikes.");

  if (stateCode && county) {
    actions.add(
      `Track ${formatCountyForAction(county)} and ${stateCode} emergency management updates for grant windows and mitigation deadlines.`,
    );
  }

  return Array.from(actions).slice(0, 5);
}

function advisoryPrompt(
  location: GeocodedLocation,
  score: number,
  riskLevel: RiskLevel,
  breakdown: RiskBreakdown,
  topHazard: HazardKey,
  actions: string[],
  alerts: ActiveAlert[],
): string {
  const alertText =
    alerts.length > 0
      ? `Active alerts: ${alerts.map((alert) => `${alert.event} (${alert.severity})`).join("; ")}`
      : "Active alerts: none";

  return [
    `Location: ${location.resolvedAddress}`,
    `Five-year climate risk score: ${score}/100 (${riskLevel})`,
    `Top hazard: ${hazardLabel(topHazard)}`,
    `Flood score: ${breakdown.flood}/10`,
    `Wildfire score: ${breakdown.wildfire}/10`,
    `Heat score: ${breakdown.heat}/10`,
    `Severe weather score: ${breakdown.severeWeather}/10`,
    alertText,
    "Write a plain-English advisory under 180 words for a homeowner or renter.",
    "Include: practical meaning, urgency, top three actions, and a note to check federal/state assistance programs.",
    `Suggested actions: ${actions.join("; ")}`,
    "No jargon. No buzzwords. No legal disclaimer.",
  ].join("\n");
}

function buildTemplateAdvisory(
  score: number,
  riskLevel: RiskLevel,
  location: GeocodedLocation,
  topHazard: HazardKey,
  actions: string[],
  alerts: ActiveAlert[],
): string {
  const urgencyLine =
    riskLevel === "Severe"
      ? "This address sits in a severe five-year risk band and should be treated as an immediate planning priority."
      : riskLevel === "High"
        ? "This address trends high risk over the next five years, so mitigation and insurance planning should start now."
        : riskLevel === "Moderate"
          ? "This location shows meaningful climate risk signals and justifies preventative action."
          : "Current signals are lower, but climate losses can still escalate quickly.";

  const selectedActions = actions.slice(0, 3).map((action, index) => `${index + 1}. ${action}`);
  const alertNote =
    alerts.length > 0
      ? `Current NOAA alerts nearby include ${alerts.map((alert) => alert.event).join(", ")}.`
      : "There are no active NOAA alerts in the immediate area right now.";

  return [
    `${urgencyLine} ClimateGuard estimates a ${score}/100 outlook for ${location.resolvedAddress}, with ${hazardLabel(topHazard).toLowerCase()} as the leading hazard.`,
    alertNote,
    "Priority moves:",
    ...selectedActions,
    "Check federal and state assistance programs before renewal or post-disaster deadlines close.",
  ].join(" ");
}

async function generateAdvisory(
  location: GeocodedLocation,
  score: number,
  riskLevel: RiskLevel,
  breakdown: RiskBreakdown,
  topHazard: HazardKey,
  actions: string[],
  alerts: ActiveAlert[],
): Promise<AdvisoryResult> {
  const azureEndpoint = readEnv("AZURE_OPENAI_ENDPOINT");
  const azureApiKey = readEnv("AZURE_OPENAI_KEY");
  const azureDeployment = readEnv("AZURE_OPENAI_DEPLOYMENT") ?? "gpt-4o";
  const azureApiVersion = readEnv("AZURE_OPENAI_API_VERSION") ?? "2024-02-01";
  const geminiApiKey = readEnv("GEMINI_API_KEY");
  const geminiModel = readEnv("GEMINI_MODEL") ?? "gemini-2.0-flash";
  const nimApiKey = readEnv("NVIDIA_NIM_API_KEY");
  const nimBaseUrl = readEnv("NVIDIA_NIM_BASE_URL") ?? "https://integrate.api.nvidia.com/v1";
  const nimModel = readEnv("NVIDIA_NIM_MODEL") ?? "meta/llama-3.1-8b-instruct";
  const prompt = advisoryPrompt(location, score, riskLevel, breakdown, topHazard, actions, alerts);
  const cacheKey = JSON.stringify({
    location: location.resolvedAddress,
    score,
    riskLevel,
    breakdown,
    topHazard,
    actions,
    alerts,
    providers: {
      azure: Boolean(azureEndpoint && azureApiKey),
      gemini: Boolean(geminiApiKey),
      nim: Boolean(nimApiKey),
    },
    azureDeployment,
    geminiModel,
    nimModel,
  });

  return withTtlCache(advisoryCache, advisoryInFlight, cacheKey, ADVISORY_CACHE_TTL_MS, async () => {
    if (azureEndpoint && azureApiKey) {
      try {
        const base = azureEndpoint.endsWith("/") ? azureEndpoint : `${azureEndpoint}/`;
        const url = new URL(
          `openai/deployments/${encodeURIComponent(azureDeployment)}/chat/completions`,
          base,
        );
        url.searchParams.set("api-version", azureApiVersion);

        const response = await fetchWithRetry(url, {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            "api-key": azureApiKey,
          },
          body: JSON.stringify({
            messages: [
              {
                role: "system",
                content:
                  "You are ClimateGuard, a climate risk advisor. Be concrete, specific, and practical.",
              },
              {
                role: "user",
                content: prompt,
              },
            ],
            temperature: 0.3,
            max_tokens: 260,
          }),
          timeoutMs: 12_000,
        });

        if (response.ok) {
          const payload = (await response.json()) as {
            choices?: Array<{
              message?: {
                content?: string;
              };
            }>;
          };

          const advisory = payload.choices?.[0]?.message?.content?.trim();

          if (advisory) {
            return {
              text: advisory,
              source: {
                name: "Azure OpenAI Advisory",
                status: "live",
                note: `Advisory generated by Azure OpenAI (${azureDeployment}).`,
              },
            };
          }
        }
      } catch (error) {
        console.error("Azure OpenAI advisory generation failed", error);
      }
    }

    if (geminiApiKey) {
      try {
        const url = new URL(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`,
        );
        url.searchParams.set("key", geminiApiKey);

        const response = await fetchWithRetry(url, {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [
                {
                  text: "You are ClimateGuard, a climate risk advisor. Be concrete, specific, and practical.",
                },
              ],
            },
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: prompt,
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 260,
            },
          }),
          timeoutMs: 12_000,
        });

        if (response.ok) {
          const payload = (await response.json()) as {
            candidates?: Array<{
              content?: {
                parts?: Array<{ text?: string }>;
              };
            }>;
          };

          const advisory = payload.candidates?.[0]?.content?.parts
            ?.map((part) => part.text?.trim() ?? "")
            .join(" ")
            .trim();

          if (advisory) {
            return {
              text: advisory,
              source: {
                name: "Google Gemini Advisory",
                status: "live",
                note: `Advisory generated by Gemini (${geminiModel}).`,
              },
            };
          }
        }
      } catch (error) {
        console.error("Gemini advisory generation failed", error);
      }
    }

    if (nimApiKey) {
      try {
        const nimUrl = new URL("chat/completions", nimBaseUrl.endsWith("/") ? nimBaseUrl : `${nimBaseUrl}/`);
        const response = await fetchWithRetry(nimUrl, {
          method: "POST",
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${nimApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: nimModel,
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
                content: prompt,
              },
            ],
          }),
          timeoutMs: 12_000,
        });

        if (response.ok) {
          const payload = (await response.json()) as {
            choices?: Array<{
              message?: {
                content?: string;
              };
            }>;
          };

          const advisory = payload.choices?.[0]?.message?.content?.trim();

          if (advisory) {
            return {
              text: advisory,
              source: {
                name: "NVIDIA NIM Advisory",
                status: "fallback",
                note: `Primary AI provider unavailable; advisory generated by NVIDIA NIM (${nimModel}).`,
              },
            };
          }
        }
      } catch (error) {
        console.error("NVIDIA NIM advisory generation failed", error);
      }
    }

    return {
      text: buildTemplateAdvisory(score, riskLevel, location, topHazard, actions, alerts),
      source: {
        name: "AI Advisory",
        status: "fallback",
        note: "No working AI provider key was available; using a deterministic advisory template.",
      },
    };
  });
}

export async function generateRiskAssessment(inputAddress: string): Promise<RiskResponse> {
  const dataSources: DataSourceStatus[] = [];

  const geocoded = await geocodeAddress(inputAddress);
  dataSources.push(geocoded.source);

  const [tractSignals, countySignals, weatherSignals, historySignals] = await Promise.all([
    fetchNriTractSignals(geocoded.value.tractFips),
    fetchNriCountySignals(geocoded.value.countyFips),
    fetchNoaaAlerts(geocoded.value.lat, geocoded.value.lon),
    fetchFemaHistory(geocoded.value.state, geocoded.value.county),
  ]);

  dataSources.push(
    tractSignals.source,
    countySignals.source,
    historySignals.source,
    weatherSignals.source,
  );

  const baseBreakdown = computeBaseBreakdown(tractSignals.value, countySignals.value);
  const breakdown = applyLiveSignals(baseBreakdown, weatherSignals.value, historySignals.value);
  const communityStress = communityStressScore(tractSignals.value, countySignals.value);
  const topHazard = topHazardFromBreakdown(breakdown);
  const hazardWeighted =
    breakdown.flood * 0.25 +
    breakdown.wildfire * 0.35 +
    breakdown.heat * 0.15 +
    breakdown.severeWeather * 0.25;
  const maxHazard = Math.max(
    breakdown.flood,
    breakdown.wildfire,
    breakdown.heat,
    breakdown.severeWeather,
  );
  const communityModifier = clamp(((communityStress * 10) - 50) * 0.18, -6, 12);
  const extremeHazardModifier = maxHazard >= 9 ? 3 : maxHazard >= 8 ? 1.5 : 0;
  const composite = Math.round(
    clamp(hazardWeighted * 10 + communityModifier + extremeHazardModifier, 0, 100),
  );
  const riskLevel = toRiskLevel(composite);
  const keyDrivers = buildKeyDrivers(
    breakdown,
    topHazard,
    tractSignals.value,
    countySignals.value,
    weatherSignals.value,
    communityStress,
  );
  const actions = buildActions(
    breakdown,
    topHazard,
    geocoded.value.state,
    geocoded.value.county,
  );

  const advisoryResult = await generateAdvisory(
    geocoded.value,
    composite,
    riskLevel,
    breakdown,
    topHazard,
    actions,
    weatherSignals.value.alerts,
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
    topHazard,
    keyDrivers,
    advisory: advisoryResult.text,
    actions,
    activeAlerts: weatherSignals.value.alerts,
    assistancePrograms: getProgramsForState(geocoded.value.state),
    dataSources,
    generatedAt: new Date().toISOString(),
  };
}
