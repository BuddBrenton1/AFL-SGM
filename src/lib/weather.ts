import type { WeatherSnapshot } from "./types";

/** Venue climate profiles + day-of synthetic forecast for SGM modelling. */
const VENUE_CLIMATE: Record<
  string,
  { baseTemp: number; windBias: number; rainBias: number; roof?: boolean }
> = {
  "M.C.G.": { baseTemp: 12, windBias: 18, rainBias: 0.35 },
  Docklands: { baseTemp: 14, windBias: 8, rainBias: 0.05, roof: true },
  Gabba: { baseTemp: 20, windBias: 12, rainBias: 0.2 },
  Carrara: { baseTemp: 21, windBias: 14, rainBias: 0.25 },
  "S.C.G.": { baseTemp: 16, windBias: 16, rainBias: 0.3 },
  "Sydney Showground": { baseTemp: 16, windBias: 14, rainBias: 0.28 },
  "Adelaide Oval": { baseTemp: 14, windBias: 15, rainBias: 0.25 },
  "Kardinia Park": { baseTemp: 13, windBias: 22, rainBias: 0.4 },
  "Perth Stadium": { baseTemp: 18, windBias: 14, rainBias: 0.2 },
  "Mars Stadium": { baseTemp: 11, windBias: 20, rainBias: 0.35 },
  "York Park": { baseTemp: 10, windBias: 18, rainBias: 0.4 },
  "Traeger Park": { baseTemp: 24, windBias: 10, rainBias: 0.1 },
  "Bellerive Oval": { baseTemp: 11, windBias: 20, rainBias: 0.4 },
};

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export function getWeatherForFixture(
  venue: string,
  dateIso: string,
  gameId: number,
): WeatherSnapshot {
  const climate = VENUE_CLIMATE[venue] ?? {
    baseTemp: 15,
    windBias: 14,
    rainBias: 0.25,
  };

  if (climate.roof) {
    return {
      venue,
      condition: "clear",
      tempC: climate.baseTemp + 4,
      windKmh: 4,
      rainChance: 0,
      summary: "Roof closed — neutral scoring conditions",
      goalMultiplier: 1,
      disposalMultiplier: 1.02,
      tackleMultiplier: 0.95,
    };
  }

  const seed = hashSeed(`${gameId}:${dateIso}:${venue}`);
  const month = new Date(dateIso.replace(" ", "T")).getMonth() + 1;
  const winter = month >= 5 && month <= 8;
  const rainRoll = seed;
  const windRoll = hashSeed(`wind:${gameId}`);
  const rainChance = Math.min(
    0.85,
    climate.rainBias + (winter ? 0.15 : 0) + (seed - 0.5) * 0.2,
  );

  let condition: WeatherSnapshot["condition"] = "clear";
  let goalMultiplier = 1;
  let disposalMultiplier = 1;
  let tackleMultiplier = 1;
  let summary = "Fine conditions — standard scoring expected";

  const windKmh = Math.round(climate.windBias + windRoll * 18);
  const tempC = Math.round(
    climate.baseTemp + (winter ? -2 : 3) + (seed - 0.5) * 6,
  );

  if (rainRoll < rainChance * 0.35) {
    condition = "heavy-rain";
    goalMultiplier = 0.78;
    disposalMultiplier = 0.9;
    tackleMultiplier = 1.22;
    summary = "Heavy rain — suppress goals, lift tackle markets";
  } else if (rainRoll < rainChance * 0.7) {
    condition = "light-rain";
    goalMultiplier = 0.88;
    disposalMultiplier = 0.95;
    tackleMultiplier = 1.12;
    summary = "Light rain — slightly lower scoring, contested ball up";
  } else if (windKmh >= 30) {
    condition = "windy";
    goalMultiplier = 0.85;
    disposalMultiplier = 0.97;
    tackleMultiplier = 1.05;
    summary = "Strong wind — accuracy down, set-shot variance up";
  } else if (rainChance > 0.4) {
    condition = "cloudy";
    goalMultiplier = 0.96;
    summary = "Cloudy with showers nearby — mild scoring drag";
  }

  return {
    venue,
    condition,
    tempC,
    windKmh,
    rainChance: Math.round(rainChance * 100),
    summary,
    goalMultiplier,
    disposalMultiplier,
    tackleMultiplier,
  };
}
