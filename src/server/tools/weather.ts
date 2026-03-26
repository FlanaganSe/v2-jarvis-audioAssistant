import { createEvidence, type Evidence } from './evidence.js';

interface GeocodingResult {
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly country: string;
  readonly admin1?: string;
}

interface GeocodingResponse {
  readonly results?: readonly GeocodingResult[];
}

interface CurrentWeather {
  readonly time: string;
  readonly temperature_2m: number;
  readonly relative_humidity_2m: number;
  readonly weather_code: number;
  readonly wind_speed_10m: number;
}

interface CurrentUnits {
  readonly temperature_2m: string;
  readonly relative_humidity_2m: string;
  readonly wind_speed_10m: string;
}

interface ForecastResponse {
  readonly current: CurrentWeather;
  readonly current_units: CurrentUnits;
}

const WMO_DESCRIPTIONS: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  71: 'Slight snow fall',
  73: 'Moderate snow fall',
  75: 'Heavy snow fall',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

export const describeWeatherCode = (code: number): string =>
  WMO_DESCRIPTIONS[code] ?? `Unknown (code ${code})`;

export const geocode = async (
  city: string,
  fetchFn: typeof fetch = fetch,
): Promise<GeocodingResult | null> => {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  const res = await fetchFn(url);
  if (!res.ok) return null;
  const data = (await res.json()) as GeocodingResponse;
  return data.results?.[0] ?? null;
};

export const fetchForecast = async (
  lat: number,
  lon: number,
  fetchFn: typeof fetch = fetch,
): Promise<ForecastResponse | null> => {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`;
  const res = await fetchFn(url);
  if (!res.ok) return null;
  return (await res.json()) as ForecastResponse;
};

export interface WeatherResult {
  readonly location: string;
  readonly temperature: string;
  readonly conditions: string;
  readonly humidity: string;
  readonly wind: string;
  readonly evidence: Evidence;
}

export const getWeather = async (
  city: string,
  fetchFn: typeof fetch = fetch,
): Promise<WeatherResult | null> => {
  const geo = await geocode(city, fetchFn);
  if (!geo) return null;

  const forecast = await fetchForecast(geo.latitude, geo.longitude, fetchFn);
  if (!forecast) return null;

  const { current, current_units } = forecast;
  const location = [geo.name, geo.admin1, geo.country].filter(Boolean).join(', ');

  return {
    location,
    temperature: `${current.temperature_2m}${current_units.temperature_2m}`,
    conditions: describeWeatherCode(current.weather_code),
    humidity: `${current.relative_humidity_2m}${current_units.relative_humidity_2m}`,
    wind: `${current.wind_speed_10m}${current_units.wind_speed_10m}`,
    evidence: createEvidence(
      'weather',
      `https://open-meteo.com/`,
      `Current weather for ${location}: ${describeWeatherCode(current.weather_code)}, ${current.temperature_2m}${current_units.temperature_2m}`,
    ),
  };
};

export const WEATHER_TOOL_DEF = {
  type: 'function' as const,
  name: 'get_weather',
  description:
    'Get current weather for a city. Use when the user asks about weather, temperature, or conditions in a location.',
  parameters: {
    type: 'object',
    properties: {
      city: {
        type: 'string',
        description: 'The city name to get weather for (e.g., "San Francisco", "London")',
      },
    },
    required: ['city'],
  },
};

export const handleWeather = async (
  args: Record<string, unknown>,
  fetchFn: typeof fetch = fetch,
): Promise<Record<string, unknown>> => {
  const city = typeof args.city === 'string' ? args.city : '';
  if (!city) {
    return { error: 'City name is required', evidence: null };
  }

  const result = await getWeather(city, fetchFn);
  if (!result) {
    return {
      error: `Could not find weather for "${city}". Please check the city name and try again.`,
      evidence: null,
    };
  }

  return {
    location: result.location,
    temperature: result.temperature,
    conditions: result.conditions,
    humidity: result.humidity,
    wind: result.wind,
    evidence: {
      sourceType: result.evidence.sourceType,
      sourceUrl: result.evidence.sourceUrl,
      snippet: result.evidence.snippet,
    },
  };
};
