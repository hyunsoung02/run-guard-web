import { NextResponse } from 'next/server';
import { z } from 'zod';
import { destinationPoint, distanceAccuracyScore, distancePointToRouteM, MAX_TARGET_DISTANCE_KM, MIN_TARGET_DISTANCE_KM, recommendationScore, safetyScoreFromWarnings } from '@/lib/domain';
import type { LngLat, NavigationStep, WarningPoint } from '@/types/run-guard';

const inputSchema = z.object({
  start: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
  targetDistanceM: z.number().int().min(MIN_TARGET_DISTANCE_KM * 1000).max(MAX_TARGET_DISTANCE_KM * 1000).multipleOf(1000),
  safetyPoints: z.array(z.object({ id: z.string(), coordinate: z.tuple([z.number(), z.number()]), name: z.string(), accidentCount: z.number(), deathCount: z.number().optional(), seriousInjuryCount: z.number().optional() })).max(200).default([]),
  safetyAvailable: z.boolean().default(false),
});

const bearings = [45, 165, 285];
const maneuverMap: Record<number, string> = { 0: 'left', 1: 'right', 2: 'sharp-left', 3: 'sharp-right', 4: 'slight-left', 5: 'slight-right', 6: 'straight', 7: 'straight', 8: 'straight', 9: 'u-turn', 10: 'arrive', 11: 'straight', 12: 'slight-left', 13: 'slight-right' };

function logRouteDiagnostic(status: number | null, category: string, details: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV !== 'development') return;
  console.info('[ROUTES]', { keyConfigured: Boolean(process.env.ORS_API_KEY?.trim()), status, category, ...details });
}

export async function POST(request: Request) {
  const key = process.env.ORS_API_KEY?.trim();
  if (!key) { logRouteDiagnostic(null, 'not_configured'); return NextResponse.json({ error: '경로 API 설정이 필요합니다.', code: 'NOT_CONFIGURED' }, { status: 503 }); }
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '경로 요청을 확인해 주세요.' }, { status: 400 });
  const { start, targetDistanceM, safetyPoints, safetyAvailable } = parsed.data;
  const candidates = [];
  for (let variant = 0; variant < bearings.length; variant += 1) {
    let radiusScale = 0.75;
    let closest: { coordinates: LngLat[]; turnaroundCoordinate: LngLat; distanceM: number; durationSeconds: number; steps: NavigationStep[] } | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const turnaround = destinationPoint(start, (targetDistanceM / 2) * radiusScale, bearings[variant]);
      try {
        const response = await fetch('https://api.openrouteservice.org/v2/directions/foot-walking/geojson', { method: 'POST', headers: { Authorization: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ coordinates: [start, turnaround, start], instructions: true, geometry_simplify: false }), signal: AbortSignal.timeout(15000) });
        if (!response.ok) { logRouteDiagnostic(response.status, 'ors_error', { variant: variant + 1, attempt: attempt + 1 }); continue; }
        const data = await response.json() as { features?: Array<{ geometry?: { coordinates?: LngLat[] }; properties?: { summary?: { distance?: number; duration?: number }; segments?: Array<{ steps?: Array<{ instruction?: string; distance?: number; type?: number; way_points?: [number, number] }> }> } }> };
        const feature = data.features?.[0];
        const coordinates = feature?.geometry?.coordinates;
        const distanceM = feature?.properties?.summary?.distance;
        if (!coordinates || coordinates.length < 2 || !distanceM || !Number.isFinite(distanceM)) continue;
        const steps = (feature.properties?.segments ?? []).flatMap((segment) => segment.steps ?? []).map((step) => ({ instruction: step.instruction || '코스를 따라 직진하세요.', distanceM: step.distance || 0, coordinateIndex: step.way_points?.[0] || 0, maneuver: maneuverMap[step.type ?? -1] ?? 'unknown' }));
        closest = { coordinates, turnaroundCoordinate: turnaround, distanceM, durationSeconds: feature.properties?.summary?.duration || 0, steps };
        const tolerance = Math.max(200, targetDistanceM * 0.03);
        if (Math.abs(targetDistanceM - distanceM) <= tolerance) break;
        radiusScale = Math.min(1.1, Math.max(0.25, radiusScale * (targetDistanceM / distanceM)));
      } catch { /* try the next correction */ }
    }
    if (!closest) continue;
    const warningPoints: WarningPoint[] = safetyPoints.flatMap((point) => {
      const routeDistance = distancePointToRouteM(point.coordinate, closest!.coordinates);
      if (!Number.isFinite(routeDistance) || routeDistance > 200) return [];
      const severity: WarningPoint['severity'] = routeDistance <= 50 ? 'high' : routeDistance <= 100 ? 'medium' : 'low';
      return [{ id: point.id, coordinate: point.coordinate, name: point.name, distanceFromRouteM: routeDistance, accidentCount: point.accidentCount, severity }];
    }).sort((a, b) => a.distanceFromRouteM - b.distanceFromRouteM);
    const accuracy = distanceAccuracyScore(targetDistanceM, closest.distanceM);
    const safety = safetyAvailable ? safetyScoreFromWarnings(warningPoints) : null;
    candidates.push({ id: `candidate-${variant + 1}`, coordinates: closest.coordinates, turnaroundCoordinate: closest.turnaroundCoordinate, distanceM: closest.distanceM, durationSeconds: closest.durationSeconds, navigationSteps: closest.steps, warningPoints, distanceAccuracyScore: accuracy, safetyScore: safety, recommendationScore: recommendationScore(safety, accuracy) });
  }
  if (!candidates.length) { logRouteDiagnostic(502, 'no_candidates'); return NextResponse.json({ error: '현재 위치에서 코스를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 502 }); }
  candidates.sort((a, b) => (b.recommendationScore ?? b.distanceAccuracyScore) - (a.recommendationScore ?? a.distanceAccuracyScore));
  logRouteDiagnostic(200, 'success', { candidateCount: candidates.length, selectedId: candidates[0].id, selectedCoordinateCount: candidates[0].coordinates.length });
  return NextResponse.json({ candidates, recommendedId: candidates[0].id, reason: candidates[0].safetyScore === null ? '안전 데이터가 없어 목표 거리에 가장 가까운 코스를 추천합니다.' : '상대 안전도 70%와 거리 정확도 30%를 반영한 추천입니다.' });
}
