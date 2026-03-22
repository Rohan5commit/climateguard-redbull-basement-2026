export type RiskLevel = "Low" | "Moderate" | "High" | "Severe";
export type DataSourceState = "live" | "fallback" | "unavailable";
export type HazardKey = "flood" | "wildfire" | "heat" | "severeWeather";

export interface DataSourceStatus {
  name: string;
  status: DataSourceState;
  note: string;
}

export interface AssistanceProgram {
  name: string;
  url: string;
  summary: string;
  scope: "federal" | "state";
}

export interface GeocodedLocation {
  lat: number;
  lon: number;
  city?: string;
  county?: string;
  state?: string;
  countyFips?: string;
  tractFips?: string;
  postalCode?: string;
  resolvedAddress: string;
}

export interface RiskBreakdown {
  flood: number;
  wildfire: number;
  heat: number;
  severeWeather: number;
}

export interface ActiveAlert {
  event: string;
  severity: string;
  headline: string;
}

export interface RiskResponse {
  inputAddress: string;
  resolvedAddress: string;
  location: GeocodedLocation;
  fiveYearRiskScore: number;
  riskLevel: RiskLevel;
  confidence: "Low" | "Medium" | "High";
  breakdown: RiskBreakdown;
  topHazard: HazardKey;
  keyDrivers: string[];
  advisory: string;
  actions: string[];
  activeAlerts: ActiveAlert[];
  assistancePrograms: AssistanceProgram[];
  dataSources: DataSourceStatus[];
  generatedAt: string;
}
