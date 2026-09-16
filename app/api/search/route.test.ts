import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const originalKey = process.env.KAKAO_REST_API_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env.KAKAO_REST_API_KEY;
  else process.env.KAKAO_REST_API_KEY = originalKey;
});

describe('POST /api/search', () => {
  it('searches without GPS coordinates and parses Kakao x/y as longitude/latitude', async () => {
    process.env.KAKAO_REST_API_KEY = 'test-key';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ documents: [{
      id: '1', place_name: '광명역', road_address_name: '경기 광명시 광명역로 21', address_name: '경기 광명시 일직동', category_name: '교통 > 기차역', x: '126.884916', y: '37.416658', distance: '',
    }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(request({ query: '광명역' }));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const upstreamUrl = new URL(url);

    expect(response.status).toBe(200);
    expect(upstreamUrl.searchParams.get('query')).toBe('광명역');
    expect(upstreamUrl.searchParams.has('x')).toBe(false);
    expect(upstreamUrl.searchParams.has('radius')).toBe(false);
    expect(init.headers).toEqual({ Authorization: 'KakaoAK test-key' });
    await expect(response.json()).resolves.toMatchObject({ places: [{ name: '광명역', longitude: 126.884916, latitude: 37.416658 }] });
  });

  it('uses an available origin without forcing distance sorting or restricting the search radius', async () => {
    process.env.KAKAO_REST_API_KEY = 'test-key';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ documents: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(request({ query: '서울', longitude: 126.978, latitude: 37.5665 }));
    const upstreamUrl = new URL(fetchMock.mock.calls[0][0] as string);

    expect(response.status).toBe(200);
    expect(upstreamUrl.searchParams.get('x')).toBe('126.978');
    expect(upstreamUrl.searchParams.get('y')).toBe('37.5665');
    expect(upstreamUrl.searchParams.has('sort')).toBe(false);
    expect(upstreamUrl.searchParams.has('radius')).toBe(false);
    await expect(response.json()).resolves.toEqual({ places: [] });
  });

  it('returns a generic user-facing error without exposing upstream details', async () => {
    process.env.KAKAO_REST_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 })));

    const response = await POST(request({ query: '서울' }));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: '장소 검색 중 오류가 발생했습니다.' });
  });
});

function request(body: unknown) {
  return new Request('http://localhost/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
