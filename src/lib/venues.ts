/** AFL venue coordinates for live weather lookups (Open-Meteo). */
export const VENUE_COORDS: Record<
  string,
  { lat: number; lon: number; timezone: string; roof?: boolean }
> = {
  "M.C.G.": {
    lat: -37.8199,
    lon: 144.9834,
    timezone: "Australia/Melbourne",
  },
  Docklands: {
    lat: -37.8166,
    lon: 144.9475,
    timezone: "Australia/Melbourne",
    roof: true,
  },
  Gabba: { lat: -27.4858, lon: 153.0381, timezone: "Australia/Brisbane" },
  Carrara: { lat: -28.0064, lon: 153.367, timezone: "Australia/Brisbane" },
  "S.C.G.": { lat: -33.8917, lon: 151.2247, timezone: "Australia/Sydney" },
  "Sydney Showground": {
    lat: -33.843,
    lon: 151.0677,
    timezone: "Australia/Sydney",
  },
  "Adelaide Oval": {
    lat: -34.9155,
    lon: 138.5961,
    timezone: "Australia/Adelaide",
  },
  "Kardinia Park": {
    lat: -38.158,
    lon: 144.3546,
    timezone: "Australia/Melbourne",
  },
  "Perth Stadium": {
    lat: -31.9505,
    lon: 115.889,
    timezone: "Australia/Perth",
  },
  "Mars Stadium": {
    lat: -37.55,
    lon: 143.848,
    timezone: "Australia/Melbourne",
  },
  "York Park": {
    lat: -41.4259,
    lon: 147.139,
    timezone: "Australia/Hobart",
  },
  "Traeger Park": {
    lat: -23.709,
    lon: 133.875,
    timezone: "Australia/Darwin",
  },
  "Bellerive Oval": {
    lat: -42.872,
    lon: 147.374,
    timezone: "Australia/Hobart",
  },
};

export function resolveVenueCoords(venue: string) {
  return (
    VENUE_COORDS[venue] ?? {
      lat: -37.8136,
      lon: 144.9631,
      timezone: "Australia/Melbourne",
    }
  );
}
