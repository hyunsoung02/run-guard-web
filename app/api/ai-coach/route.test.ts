import { afterEach, describe, expect, it } from 'vitest';
import { POST } from './route';

const originalKey = process.env.GEMINI_API_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalKey;
});

describe('POST /api/ai-coach', () => {
  it('returns the configuration-specific message when the API key is absent', async () => {
    delete process.env.GEMINI_API_KEY;
    const response = await POST(new Request('http://localhost/api/ai-coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '주 3회 달리고 싶어요.', history: [], records: [], currentPlan: null }),
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'AI 코치 설정이 아직 완료되지 않았습니다.', code: 'NOT_CONFIGURED' });
  });
});
