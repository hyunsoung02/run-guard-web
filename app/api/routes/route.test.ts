import { afterEach, describe, expect, it, vi } from 'vitest';
import { distanceM } from '@/lib/domain';
import type { LngLat } from '@/types/run-guard';
import { POST } from './route';

const originalKey = process.env.ORS_API_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env.ORS_API_KEY;
  else process.env.ORS_API_KEY = originalKey;
});

const requestFor = (targetDistanceM: number) => new Request('http://localhost/api/routes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ start: [126.978, 37.5665], targetDistanceM, safetyPoints: [], safetyAvailable: false }),
});

describe('POST /api/routes target distance', () => {
  it.each([1000, 5000, 8000, 10000, 15000, 20000])('accepts %im and scales all three route candidates', async (targetDistanceM) => {
    process.env.ORS_API_KEY = 'test-key';
    const requestBodies: Array<{ coordinates: LngLat[] }> = [];
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { coordinates: LngLat[] };
      requestBodies.push(body);
      return new Response(JSON.stringify({
        features: [{
          geometry: { coordinates: body.coordinates },
          properties: { summary: { distance: targetDistanceM, duration: targetDistanceM / 2 }, segments: [] },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(requestFor(targetDistanceM));
    const data = await response.json() as { candidates: Array<{ distanceM: number }> };

    expect(response.status).toBe(200);
    expect(data.candidates).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.heigit.org/openrouteservice/v2/directions/foot-walking/geojson',
      expect.any(Object),
    );
    for (const body of requestBodies) {
      expect(distanceM(body.coordinates[0], body.coordinates[1])).toBeCloseTo(targetDistanceM * 0.375, -1);
    }
  });

  it.each([0, 999, 1500, 20001, 21000])('rejects unsupported target %im before calling ORS', async (targetDistanceM) => {
    process.env.ORS_API_KEY = 'test-key';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(requestFor(targetDistanceM));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stops immediately when ORS rate limits the request', async () => {
    process.env.ORS_API_KEY = 'test-key';
    const fetchMock = vi.fn(async () => new Response(null, { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(requestFor(5000));
    const data = await response.json() as { error: string; code: string };

    expect(response.status).toBe(429);
    expect(data).toEqual({
      error: '경로 요청이 잠시 많습니다. 잠시 후 다시 시도해 주세요.',
      code: 'RATE_LIMITED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
