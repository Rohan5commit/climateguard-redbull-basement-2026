import type { AssistanceProgram } from "@/lib/types";

const FEDERAL_PROGRAMS: AssistanceProgram[] = [
  {
    name: "FEMA Individuals and Households Program",
    url: "https://www.fema.gov/assistance/individual/program",
    summary: "Grants for housing, repairs, and other disaster-related needs after a declared event.",
    scope: "federal",
  },
  {
    name: "NFIP Flood Insurance",
    url: "https://www.floodsmart.gov/",
    summary: "Official flood insurance marketplace and educational resources for homeowners and renters.",
    scope: "federal",
  },
  {
    name: "FEMA Hazard Mitigation Assistance",
    url: "https://www.fema.gov/grants/mitigation",
    summary: "Funding for long-term projects that reduce flood, wildfire, and severe-weather losses.",
    scope: "federal",
  },
];

const STATE_PROGRAMS: Record<string, AssistanceProgram[]> = {
  CA: [
    {
      name: "California Office of Emergency Services",
      url: "https://www.caloes.ca.gov/",
      summary: "State disaster alerts, preparedness resources, and recovery program links.",
      scope: "state",
    },
    {
      name: "California FAIR Plan",
      url: "https://www.cfpnet.com/",
      summary: "Last-resort home insurance option for high-risk wildfire areas.",
      scope: "state",
    },
  ],
  FL: [
    {
      name: "Florida Division of Emergency Management",
      url: "https://www.floridadisaster.org/",
      summary: "Preparedness guidance, evacuation data, and post-storm recovery support.",
      scope: "state",
    },
    {
      name: "My Safe Florida Home",
      url: "https://mysafeflhome.com/",
      summary: "Inspection and mitigation support for strengthening homes against storms.",
      scope: "state",
    },
  ],
  TX: [
    {
      name: "Texas Division of Emergency Management",
      url: "https://tdem.texas.gov/",
      summary: "Texas hazard alerts, county guidance, and resilience information.",
      scope: "state",
    },
    {
      name: "Texas Windstorm Insurance Association",
      url: "https://www.twia.org/",
      summary: "Property coverage option for eligible coastal households.",
      scope: "state",
    },
  ],
  LA: [
    {
      name: "Louisiana GOHSEP",
      url: "https://gohsep.la.gov/",
      summary: "State emergency preparedness, declarations, and disaster assistance routing.",
      scope: "state",
    },
  ],
  NY: [
    {
      name: "New York Division of Homeland Security and Emergency Services",
      url: "https://www.dhses.ny.gov/",
      summary: "Risk reduction resources, preparedness tools, and disaster recovery guidance.",
      scope: "state",
    },
  ],
};

const GENERIC_STATE_PROGRAM: AssistanceProgram = {
  name: "State Emergency Management Directory",
  url: "https://www.usa.gov/state-emergency-management",
  summary: "Directory to locate your state emergency management agency and local assistance pathways.",
  scope: "state",
};

export function getProgramsForState(stateCode?: string): AssistanceProgram[] {
  const normalized = (stateCode ?? "").toUpperCase();
  const statePrograms = STATE_PROGRAMS[normalized] ?? [GENERIC_STATE_PROGRAM];
  return [...FEDERAL_PROGRAMS, ...statePrograms];
}
