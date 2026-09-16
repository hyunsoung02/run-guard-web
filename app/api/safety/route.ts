import { NextResponse } from 'next/server';
import { z } from 'zod';

const inputSchema = z.object({ longitude: z.number().min(124).max(132), latitude: z.number().min(32.5).max(39.5) });

function xmlValue(block: string, key: string) {
  return block.match(new RegExp(`<${key}>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?</${key}>`, 's'))?.[1]?.trim() ?? '';
}

function extractItems(value: unknown, depth = 0): Array<Record<string, unknown>> {
  if (depth > 6) return [];
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item));
  if (typeof value !== 'object' || value === null) return [];
  const record = value as Record<string, unknown>;
  const looksLikeItem = 'lo_crd' in record || 'la_crd' in record || 'longitude' in record || 'latitude' in record;
  if (looksLikeItem) return [record];
  for (const key of ['items', 'item', 'data', 'list', 'result', 'body', 'response']) {
    if (key in record) { const result = extractItems(record[key], depth + 1); if (result.length) return result; }
  }
  for (const child of Object.values(record)) { const result = extractItems(child, depth + 1); if (result.length) return result; }
  return [];
}

export async function POST(request: Request) {
  const kakaoKey = process.env.KAKAO_REST_API_KEY?.trim();
  const publicKey = process.env.PUBLIC_DATA_API_KEY?.trim();
  if (!kakaoKey || !publicKey) return NextResponse.json({ status: 'unavailable', points: [], message: '안전 공공데이터 API 설정이 필요합니다.', code: 'NOT_CONFIGURED' }, { status: 503 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ status: 'unavailable', points: [], message: '현재 위치를 확인할 수 없습니다.' }, { status: 400 });
  try {
    const regionParams = new URLSearchParams({ x: String(parsed.data.longitude), y: String(parsed.data.latitude), input_coord: 'WGS84', output_coord: 'WGS84' });
    const regionResponse = await fetch(`https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?${regionParams}`, { headers: { Authorization: `KakaoAK ${kakaoKey}` }, signal: AbortSignal.timeout(4000) });
    if (!regionResponse.ok) throw new Error('region');
    const regionData = await regionResponse.json() as { documents?: Array<{ region_type: string; code: string }> };
    const code = regionData.documents?.find((item) => item.region_type === 'B')?.code;
    if (!code || !/^\d{5,}$/.test(code)) throw new Error('region-code');
    const query = new URLSearchParams({ serviceKey: publicKey, searchYearCd: '2024', siDo: code.slice(0, 2), guGun: code.slice(2, 5), type: 'json', numOfRows: '100', pageNo: '1' });
    const response = await fetch(`https://apis.data.go.kr/B552061/frequentzoneOldman/getRestFrequentzoneOldman?${query}`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error('public-data');
    const raw = await response.text();
    let items: Array<Record<string, unknown>> = [];
    try {
      const json = JSON.parse(raw) as unknown;
      items = extractItems(json);
    } catch {
      const resultCode = xmlValue(raw, 'resultCode');
      if (resultCode && !['00', '0000'].includes(resultCode)) throw new Error('api-result');
      items = [...raw.matchAll(/<item>(.*?)<\/item>/gs)].map((match) => ({
        afos_fid: xmlValue(match[1], 'afos_fid'), spot_nm: xmlValue(match[1], 'spot_nm'), lo_crd: xmlValue(match[1], 'lo_crd'), la_crd: xmlValue(match[1], 'la_crd'), occrrnc_cnt: xmlValue(match[1], 'occrrnc_cnt'), dth_dnv_cnt: xmlValue(match[1], 'dth_dnv_cnt'), se_dnv_cnt: xmlValue(match[1], 'se_dnv_cnt'),
      }));
    }
    const points = items.flatMap((item, index) => {
      const longitude = Number(item.lo_crd ?? item.longitude ?? item.x);
      const latitude = Number(item.la_crd ?? item.latitude ?? item.y);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return [];
      return [{ id: String(item.afos_fid ?? `oldman-${index}`), coordinate: [longitude, latitude], name: String(item.spot_nm ?? `보행노인 사고 다발지역 ${index + 1}`), accidentCount: Number(item.occrrnc_cnt) || 0, deathCount: Number(item.dth_dnv_cnt) || 0, seriousInjuryCount: Number(item.se_dnv_cnt) || 0 }];
    });
    if (!points.length) return NextResponse.json({ status: 'unavailable', points: [], message: '이 지역의 안전 데이터가 제공되지 않습니다.' });
    return NextResponse.json({ status: 'available', points, evaluatedYear: 2024 });
  } catch {
    return NextResponse.json({ status: 'unavailable', points: [], message: '안전 데이터를 불러오지 못했습니다. 경로 거리 기준으로 추천합니다.' }, { status: 502 });
  }
}
