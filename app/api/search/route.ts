import { NextResponse } from 'next/server';
import { z } from 'zod';

const inputSchema = z.object({
  query: z.string().trim().min(1).max(80),
  longitude: z.number().min(-180).max(180).optional(),
  latitude: z.number().min(-90).max(90).optional(),
});

const logSearch = (details: Record<string, unknown>) => {
  if (process.env.NODE_ENV !== 'production') console.info('[PLACE_SEARCH]', details);
};

export async function POST(request: Request) {
  const key = process.env.KAKAO_REST_API_KEY?.trim();
  if (!key) {
    logSearch({ stage: 'configuration-error', message: 'KAKAO_REST_API_KEY is not configured' });
    return NextResponse.json({ error: '장소 검색 중 오류가 발생했습니다.', code: 'NOT_CONFIGURED' }, { status: 503 });
  }
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '검색 요청을 확인해 주세요.' }, { status: 400 });
  const { query, longitude, latitude } = parsed.data;
  const params = new URLSearchParams({ query, size: '15' });
  if (longitude !== undefined && latitude !== undefined) {
    params.set('x', String(longitude));
    params.set('y', String(latitude));
  }
  logSearch({ query, stage: 'request-start', hasOrigin: longitude !== undefined && latitude !== undefined });
  try {
    const response = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?${params}`, { headers: { Authorization: `KakaoAK ${key}` }, signal: AbortSignal.timeout(7000) });
    logSearch({ query, stage: 'response', status: response.status });
    if (!response.ok) return NextResponse.json({ error: '장소 검색 중 오류가 발생했습니다.' }, { status: 502 });
    const data = await response.json() as { documents?: Array<Record<string, string>> };
    if (!Array.isArray(data.documents)) throw new Error('Kakao response did not include documents');
    const places = data.documents.flatMap((place) => {
      const longitude = Number(place.x); const latitude = Number(place.y);
      return Number.isFinite(longitude) && Number.isFinite(latitude) ? [{ id: place.id, name: place.place_name, address: place.road_address_name || place.address_name, category: place.category_name, longitude, latitude, distanceM: Number(place.distance) || 0 }] : [];
    });
    logSearch({ query, stage: 'parsed', resultCount: places.length });
    return NextResponse.json({ places });
  } catch (error) {
    logSearch({ query, stage: 'error', message: error instanceof Error ? error.message : 'Unknown error' });
    return NextResponse.json({ error: '장소 검색 중 오류가 발생했습니다.' }, { status: 502 });
  }
}
