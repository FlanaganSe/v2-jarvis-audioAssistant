import { describe, it, expect, vi } from 'vitest';
import {
  describeWeatherCode,
  geocode,
  fetchForecast,
  getWeather,
  handleWeather,
  WEATHER_TOOL_DEF,
} from './weather.js';

const mockGeoResponse = {
  results: [
    {
      name: 'San Francisco',
      latitude: 37.7749,
      longitude: -122.4194,
      country: 'United States',
      admin1: 'California',
    },
  ],
};

const mockForecastResponse = {
  current: {
    time: '2026-03-26T14:00',
    temperature_2m: 18.5,
    relative_humidity_2m: 65,
    weather_code: 2,
    wind_speed_10m: 12.3,
  },
  current_units: {
    temperature_2m: '°C',
    relative_humidity_2m: '%',
    wind_speed_10m: 'km/h',
  },
};

const mockFetch = (responses: Array<{ ok: boolean; json: unknown }>): typeof fetch => {
  let callIndex = 0;
  return vi.fn(async () => {
    const resp = responses[callIndex++];
    return new Response(JSON.stringify(resp.json), {
      status: resp.ok ? 200 : 500,
    });
  }) as unknown as typeof fetch;
};

describe('describeWeatherCode', () => {
  it('returns description for known codes', () => {
    expect(describeWeatherCode(0)).toBe('Clear sky');
    expect(describeWeatherCode(63)).toBe('Moderate rain');
    expect(describeWeatherCode(95)).toBe('Thunderstorm');
  });

  it('returns unknown for unrecognized codes', () => {
    expect(describeWeatherCode(999)).toBe('Unknown (code 999)');
  });
});

describe('geocode', () => {
  it('returns first result on success', async () => {
    const fetcher = mockFetch([{ ok: true, json: mockGeoResponse }]);
    const result = await geocode('San Francisco', fetcher);
    expect(result).toEqual(mockGeoResponse.results[0]);
  });

  it('returns null when no results', async () => {
    const fetcher = mockFetch([{ ok: true, json: {} }]);
    const result = await geocode('Nonexistent', fetcher);
    expect(result).toBeNull();
  });

  it('returns null on HTTP error', async () => {
    const fetcher = mockFetch([{ ok: false, json: {} }]);
    const result = await geocode('London', fetcher);
    expect(result).toBeNull();
  });
});

describe('fetchForecast', () => {
  it('returns forecast data on success', async () => {
    const fetcher = mockFetch([{ ok: true, json: mockForecastResponse }]);
    const result = await fetchForecast(37.77, -122.42, fetcher);
    expect(result?.current.temperature_2m).toBe(18.5);
  });

  it('returns null on HTTP error', async () => {
    const fetcher = mockFetch([{ ok: false, json: {} }]);
    const result = await fetchForecast(0, 0, fetcher);
    expect(result).toBeNull();
  });
});

describe('getWeather', () => {
  it('returns full weather result with evidence', async () => {
    const fetcher = mockFetch([
      { ok: true, json: mockGeoResponse },
      { ok: true, json: mockForecastResponse },
    ]);
    const result = await getWeather('San Francisco', fetcher);
    expect(result).not.toBeNull();
    expect(result!.location).toBe('San Francisco, California, United States');
    expect(result!.temperature).toBe('18.5°C');
    expect(result!.conditions).toBe('Partly cloudy');
    expect(result!.humidity).toBe('65%');
    expect(result!.wind).toBe('12.3km/h');
    expect(result!.evidence.sourceType).toBe('weather');
    expect(result!.evidence.sourceUrl).toBe('https://open-meteo.com/');
  });

  it('returns null when geocoding fails', async () => {
    const fetcher = mockFetch([{ ok: true, json: {} }]);
    const result = await getWeather('Nonexistent City', fetcher);
    expect(result).toBeNull();
  });
});

describe('handleWeather', () => {
  it('returns weather data with evidence', async () => {
    const fetcher = mockFetch([
      { ok: true, json: mockGeoResponse },
      { ok: true, json: mockForecastResponse },
    ]);
    const result = await handleWeather({ city: 'San Francisco' }, fetcher);
    expect(result.location).toBe('San Francisco, California, United States');
    expect(result.evidence).toBeDefined();
  });

  it('returns error for empty city', async () => {
    const result = await handleWeather({});
    expect(result.error).toBe('City name is required');
    expect(result.evidence).toBeNull();
  });

  it('returns error when city not found', async () => {
    const fetcher = mockFetch([{ ok: true, json: {} }]);
    const result = await handleWeather({ city: 'ZZZZZ' }, fetcher);
    expect(result.error).toContain('Could not find weather');
    expect(result.evidence).toBeNull();
  });
});

describe('WEATHER_TOOL_DEF', () => {
  it('has correct shape', () => {
    expect(WEATHER_TOOL_DEF.type).toBe('function');
    expect(WEATHER_TOOL_DEF.name).toBe('get_weather');
    expect(WEATHER_TOOL_DEF.parameters.properties.city).toBeDefined();
    expect(WEATHER_TOOL_DEF.parameters.required).toEqual(['city']);
  });
});
