export type RiskLevel = "Low" | "Moderate" | "High" | "Severe";
export type DataSourceState = "live" | "fallback" | "unavailable";

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
  postalCode?: string;
  resolvedAddress: string;
}

export interface RiskBreakdown {
  flood: number;
  wildfire: number;
  severeWeather: number;
}

export interface RiskResponse {
  inputAddress: string;
  resolvedAddress: string;
  location: GeocodedLocation;
  fiveYearRiskScore: number;
  riskLevel: RiskLevel;
  confidence: "Low" | "Medium" | "High";
  breakdown: RiskBreakdown;
  keyDrivers: string[];
  advisory: string;
  actions: string[];
  assistancePrograms: AssistanceProgram[];
  dataSources: DataSourceStatus[];
  generatedAt: string;
}
