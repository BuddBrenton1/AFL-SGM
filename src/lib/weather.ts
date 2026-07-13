import type { WeatherSnapshot } from "./types";
import { resolveVenueCoords } from "./venues";

/** Venue climate profiles used only when live forecast fetch fails. */
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

function buildFromConditions(opts: {
  venue: string;
  tempC: number;
  windKmh: number;
  rainChance: number;
  precipMm: number;
  weatherCode: number;
  source: "open-meteo" | "synthetic";
}): WeatherSnapshot {
  const { venue, tempC, windKmh, rainChance, precipMm, weatherCode, source } =
    opts;
  const coords = resolveVenueCoords(venue);

  let condition: WeatherSnapshot["condition"] = "clear";
  let goalMultiplier = 1;
  let disposalMultiplier = 1;
  let tackleMultiplier = 1;
  let summary = "Fine conditions — standard scoring expected";

  if (coords.roof) {
    return {
      venue,
      condition: "clear",
      tempC,
      windKmh: Math.min(windKmh, 8),
      rainChance: 0,
      summary:
        source === "open-meteo"
          ? "Roof venue — live forecast ignored for rain/wind"
          : "Roof closed — neutral scoring conditions",
      goalMultiplier: 1,
      disposalMultiplier: 1.02,
      tackleMultiplier: 0.95,
    };
  }

  const heavyRain =
    precipMm >= 1.5 ||
    weatherCode >= 65 ||
    weatherCode === 82 ||
    weatherCode === 95;
  const lightRain =
    precipMm >= 0.2 ||
    rainChance >= 55 ||
    (weatherCode >= 51 && weatherCode <= 67) ||
    (weatherCode >= 80 && weatherCode <= 81);

  if (heavyRain) {
    condition = "heavy-rain";
    goalMultiplier = 0.78;
    disposalMultiplier = 0.9;
    tackleMultiplier = 1.22;
    summary = "Heavy rain — suppress goals, lift tackle markets";
  } else if (lightRain) {
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
  } else if (rainChance > 40 || weatherCode >= 2) {
    condition = "cloudy";
    goalMultiplier = 0.96;
    summary = "Cloudy with showers nearby — mild scoring drag";
  }

  if (source === "open-meteo") {
    summary = `${summary} · Open-Meteo`;
  }

  return {
    venue,
    condition,
    tempC,
    windKmh,
    rainChance,
    summary,
    goalMultiplier,
    disposalMultiplier,
    tackleMultiplier,
  };
}

function syntheticWeather(
  venue: string,
  dateIso: string,
  gameId: number,
): WeatherSnapshot {
  const climate = VENUE_CLIMATE[venue] ?? {
    baseTemp: 15,
    windBias: 14,
    rainBias: 0.25,
  };
  const seed = hashSeed(`${gameId}:${dateIso}:${venue}`);
  const month = new Date(dateIso.replace(" ", "T")).getMonth() + 1;
  const winter = month >= 5 && month <= 8;
  const rainChance = Math.min(
    85,
    Math.round(
      (climate.rainBias + (winter ? 0.15 : 0) + (seed - 0.5) * 0.2) * 100,
    ),
  );
  const windKmh = Math.round(climate.windBias + hashSeed(`wind:${gameId}`) * 18);
  const tempC = Math.round(
    climate.baseTemp + (winter ? -2 : 3) + (seed - 0.5) * 6,
  );
  const precipMm = rainChance > 60 ? 1.2 : rainChance > 40 ? 0.4 : 0;
  return buildFromConditions({
    venue,
    tempC,
    windKmh,
    rainChance,
    precipMm,
    weatherCode: precipMm >= 1 ? 63 : precipMm > 0 ? 51 : windKmh >= 30 ? 0 : 1,
    source: "synthetic",
  });
}

interface OpenMeteoHourly {
  time: string[];
  temperature_2m: number[];
  precipitation_probability: number[];
  precipitation: number[];
  wind_speed_10m: number[];
  weather_code: number[];
}

function closestHourIndex(times: string[], targetLocal: Date): number {
  let best = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  const target = targetLocal.getTime();
  for (let i = 0; i < times.length; i++) {
    const t = new Date(times[i]).getTime();
    const diff = Math.abs(t - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

async function fetchOpenMeteo(
  venue: string,
  dateIso: string,
): Promise<WeatherSnapshot | null> {
  const coords = resolveVenueCoords(venue);
  const matchLocal = new Date(dateIso.replace(" ", "T"));
  if (Number.isNaN(matchLocal.getTime())) return null;

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(coords.lat));
  url.searchParams.set("longitude", String(coords.lon));
  url.searchParams.set(
    "hourly",
    "temperature_2m,precipitation_probability,precipitation,wind_speed_10m,weather_code",
  );
  url.searchParams.set("timezone", coords.timezone);
  url.searchParams.set("forecast_days", "16");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    next: { revalidate: 1800 },
  });
  if (!res.ok) return null;

  const data = (await res.json()) as { hourly?: OpenMeteoHourly };
  const hourly = data.hourly;
  if (!hourly?.time?.length) return null;

  const i = closestHourIndex(hourly.time, matchLocal);
  return buildFromConditions({
    venue,
    tempC: Math.round(hourly.temperature_2m[i] ?? 15),
    windKmh: Math.round(hourly.wind_speed_10m[i] ?? 12),
    rainChance: Math.round(hourly.precipitation_probability[i] ?? 20),
    precipMm: hourly.precipitation[i] ?? 0,
    weatherCode: hourly.weather_code[i] ?? 0,
    source: "open-meteo",
  });
}

/** Live Open-Meteo forecast for kickoff hour, with synthetic venue fallback. */
export async function getWeatherForFixture(
  venue: string,
  dateIso: string,
  gameId: number,
): Promise<WeatherSnapshot> {
  try {
    const live = await fetchOpenMeteo(venue, dateIso);
    if (live) return live;
  } catch {
    /* fall through */
  }
  return syntheticWeather(venue, dateIso, gameId);
}
