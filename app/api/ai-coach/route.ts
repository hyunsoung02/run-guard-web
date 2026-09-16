import { NextResponse } from 'next/server';
import { z } from 'zod';

const planSchema = z.object({
  runnerLevel: z.enum(['초급', '중급', '상급']), goal: z.string().min(1).max(120), weeklySummary: z.string().min(1).max(220),
  sessions: z.array(z.object({ day: z.string().min(1).max(20), type: z.string().min(1).max(40), distanceKm: z.number().min(0).max(50), intensity: z.string().min(1).max(40), description: z.string().min(1).max(200) })).min(1).max(7),
  coachComment: z.string().min(1).max(400), safetyNote: z.string().min(1).max(300),
});
const inputSchema = z.object({ message: z.string().trim().min(1).max(800), history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(1200), plan: planSchema.optional() })).max(12), records: z.array(z.object({ distanceKm: z.number(), durationSeconds: z.number(), averagePaceSecondsPerKm: z.number().nullable(), date: z.string() })).max(10), currentPlan: planSchema.nullable().optional(), targetDistanceKm: z.number().int().min(1).max(20).optional() });
const buckets = new Map<string, { count: number; resetAt: number }>();

type AiErrorCategory = 'not_configured' | 'bad_request' | 'unauthorized' | 'forbidden' | 'model_not_found' | 'rate_limited' | 'upstream_5xx' | 'timeout' | 'network' | 'malformed_response';

function logDiagnostic(model: string, status: number | null, category: AiErrorCategory) {
  if (process.env.NODE_ENV !== 'development') return;
  console.info('[AI-COACH]', { keyConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()), model, status, category });
}

function upstreamError(status: number, model: string) {
  if (status === 400) { logDiagnostic(model, status, 'bad_request'); return NextResponse.json({ error: 'AI 코치 요청을 처리하지 못했습니다. 다시 시도해 주세요.', code: 'BAD_REQUEST' }, { status: 502 }); }
  if (status === 401) { logDiagnostic(model, status, 'unauthorized'); return NextResponse.json({ error: 'AI 코치 인증 설정을 확인해 주세요.', code: 'UNAUTHORIZED' }, { status: 502 }); }
  if (status === 403) { logDiagnostic(model, status, 'forbidden'); return NextResponse.json({ error: 'AI 코치 API 사용 권한을 확인해 주세요.', code: 'FORBIDDEN' }, { status: 502 }); }
  if (status === 404) { logDiagnostic(model, status, 'model_not_found'); return NextResponse.json({ error: 'AI 코치 모델 설정을 확인해 주세요.', code: 'MODEL_NOT_FOUND' }, { status: 502 }); }
  if (status === 429) { logDiagnostic(model, status, 'rate_limited'); return NextResponse.json({ error: 'AI 코치 사용량이 잠시 많습니다. 잠시 후 다시 시도해 주세요.', code: 'RATE_LIMITED' }, { status: 429 }); }
  logDiagnostic(model, status, 'upstream_5xx');
  return NextResponse.json({ error: 'AI 코치 서비스 연결이 원활하지 않습니다. 다시 시도해 주세요.', code: 'UPSTREAM_ERROR' }, { status: 502 });
}

export async function POST(request: Request) {
  const key = process.env.GEMINI_API_KEY?.trim();
  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-3.6-flash';
  if (!key) { logDiagnostic(model, null, 'not_configured'); return NextResponse.json({ error: 'AI 코치 설정이 아직 완료되지 않았습니다.', code: 'NOT_CONFIGURED' }, { status: 503 }); }
  const client = request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'local';
  const now = Date.now(); const bucket = buckets.get(client);
  if (bucket && bucket.resetAt > now && bucket.count >= 12) return NextResponse.json({ error: '요청이 많습니다. 잠시 후 다시 시도해 주세요.', code: 'RATE_LIMITED' }, { status: 429 });
  buckets.set(client, bucket && bucket.resetAt > now ? { ...bucket, count: bucket.count + 1 } : { count: 1, resetAt: now + 60_000 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '메시지 형식을 확인해 주세요.' }, { status: 400 });
  const system = `당신은 RUN Guard의 러닝 플랜 코치입니다. 사용자의 기록, 가능한 요일, 목표와 이전 대화를 유지해 주간 계획을 수정하세요. 안전도나 경로를 AI가 계산한다고 말하지 마세요. 통증·부상 증상이 있으면 운동 중단과 전문가 상담을 간결히 권하세요. 과훈련을 피하고 현실적인 계획을 만드세요. 반드시 지정된 JSON 스키마만 반환하세요.`;
  const contents = [{ role: 'user', parts: [{ text: `${system}\n\nRUN Guard 기록/대화 컨텍스트:\n${JSON.stringify(parsed.data)}\n\n최신 사용자 요청: ${parsed.data.message}` }] }];
  const schema = { type: 'OBJECT', required: ['runnerLevel', 'goal', 'weeklySummary', 'sessions', 'coachComment', 'safetyNote'], properties: { runnerLevel: { type: 'STRING', enum: ['초급', '중급', '상급'] }, goal: { type: 'STRING' }, weeklySummary: { type: 'STRING' }, sessions: { type: 'ARRAY', items: { type: 'OBJECT', required: ['day', 'type', 'distanceKm', 'intensity', 'description'], properties: { day: { type: 'STRING' }, type: { type: 'STRING' }, distanceKm: { type: 'NUMBER' }, intensity: { type: 'STRING' }, description: { type: 'STRING' } } } }, coachComment: { type: 'STRING' }, safetyNote: { type: 'STRING' } } };
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents, generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.35 } }), signal: AbortSignal.timeout(20000) });
    if (!response.ok) return upstreamError(response.status, model);
    let data: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    try { data = await response.json() as typeof data; }
    catch { logDiagnostic(model, response.status, 'malformed_response'); return NextResponse.json({ error: 'AI 응답을 처리하지 못했습니다. 다시 시도해 주세요.', code: 'MALFORMED_RESPONSE' }, { status: 502 }); }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    let rawPlan: unknown = null;
    try { rawPlan = text ? JSON.parse(text) : null; }
    catch { logDiagnostic(model, response.status, 'malformed_response'); return NextResponse.json({ error: 'AI 응답을 처리하지 못했습니다. 다시 시도해 주세요.', code: 'MALFORMED_RESPONSE' }, { status: 502 }); }
    const validated = planSchema.safeParse(rawPlan);
    if (!validated.success) { logDiagnostic(model, response.status, 'malformed_response'); return NextResponse.json({ error: 'AI 응답을 처리하지 못했습니다. 다시 시도해 주세요.', code: 'MALFORMED_RESPONSE' }, { status: 502 }); }
    if (process.env.NODE_ENV === 'development') console.info('[AI-COACH]', { keyConfigured: true, model, status: response.status, category: 'success' });
    return NextResponse.json({ plan: validated.data });
  } catch (error) {
    const category: AiErrorCategory = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : 'network';
    logDiagnostic(model, null, category);
    return NextResponse.json({ error: 'AI 코치 연결이 지연되고 있습니다. 다시 시도해 주세요.' }, { status: 504 });
  }
}
