import { NextResponse } from 'next/server';
import { z } from 'zod';

const inputSchema = z.object({
  query: z.string().trim().min(1).max(80),
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
});

export async function POST(request: Request) {
  const key = process.env.KAKAO_REST_API_KEY?.trim();
  if (!key) return NextResponse.json({ error: '장소 검색 API 설정이 필요합니다.', code: 'NOT_CONFIGURED' }, { status: 503 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '검색 요청을 확인해 주세요.' }, { status: 400 });
  const params = new URLSearchParams({ query: parsed.data.query, x: String(parsed.data.longitude), y: String(parsed.data.latitude), radius: '10000', size: '15', sort: 'distance' });
  try {
    const response = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?${params}`, { headers: { Authorization: `KakaoAK ${key}` }, signal: AbortSignal.timeout(7000) });
    if (!response.ok) return NextResponse.json({ error: '장소 검색을 완료하지 못했습니다.' }, { status: 502 });
    const data = await response.json() as { documents?: Array<Record<string, string>> };
    const places = (data.documents ?? []).flatMap((place) => {
      const longitude = Number(place.x); const latitude = Number(place.y);
      return Number.isFinite(longitude) && Number.isFinite(latitude) ? [{ id: place.id, name: place.place_name, address: place.road_address_name || place.address_name, category: place.category_name, longitude, latitude, distanceM: Number(place.distance) || 0 }] : [];
    });
    return NextResponse.json({ places });
  } catch {
    return NextResponse.json({ error: '장소 검색 연결이 지연되고 있습니다. 다시 시도해 주세요.' }, { status: 504 });
  }
}
