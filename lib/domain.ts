import type { LngLat, LocationPoint, RunningRecord, WarningPoint } from '@/types/run-guard';

export const LOCATION_MAX_AGE_MS = 60_000;
export const MAX_ACCEPTABLE_ACCURACY_M = 50;
export const MAX_PLAUSIBLE_RUNNING_SPEED_MPS = 15;
export const MIN_MEANINGFUL_MOVEMENT_M = 2;
export const MAX_LOCATION_GAP_MS = 10_000;
export const LOCATION_STALE_AFTER_MS = 15_000;
export const OFF_ROUTE_DISTANCE_M = 60;
export const ROUTE_DISTANCE_TOLERANCE_M = 200;
export const ROUTE_DISTANCE_TOLERANCE_RATIO = 0.03;
export const WARNING_DISTANCE_LIMIT_M = 200;

const EARTH_RADIUS_M = 6_371_000;
const rad = (degrees: number) => (degrees * Math.PI) / 180;

export function distanceM(a: LngLat, b: LngLat): number {
  const latDelta = rad(b[1] - a[1]);
  const lngDelta = rad(b[0] - a[0]);
  const firstLat = rad(a[1]);
  const secondLat = rad(b[1]);
  const value = Math.sin(latDelta / 2) ** 2 + Math.cos(firstLat) * Math.cos(secondLat) * Math.sin(lngDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
}

export function destinationPoint(start: LngLat, meters: number, bearingDegrees: number): LngLat {
  const [longitude, latitude] = start;
  const lat = rad(latitude);
  const lng = rad(longitude);
  const bearing = rad(bearingDegrees);
  const angular = meters / EARTH_RADIUS_M;
  const targetLat = Math.asin(Math.sin(lat) * Math.cos(angular) + Math.cos(lat) * Math.sin(angular) * Math.cos(bearing));
  const targetLng = lng + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat), Math.cos(angular) - Math.sin(lat) * Math.sin(targetLat));
  return [(targetLng * 180) / Math.PI, (targetLat * 180) / Math.PI];
}

export function isLocationUsable(point: LocationPoint, now = Date.now()): boolean {
  return Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && point.accuracyM !== null && point.accuracyM >= 0 && point.accuracyM <= MAX_ACCEPTABLE_ACCURACY_M && now - point.timestampMs >= 0 && now - point.timestampMs <= LOCATION_MAX_AGE_MS;
}

export function acceptRunningPoint(previous: LocationPoint | undefined, next: LocationPoint): { accepted: boolean; segmentDistanceM: number; reason?: string } {
  if (!isLocationUsable(next)) return { accepted: false, segmentDistanceM: 0, reason: 'weak-signal' };
  if (!previous) return { accepted: true, segmentDistanceM: 0 };
  const gap = next.timestampMs - previous.timestampMs;
  if (gap <= 0 || gap > MAX_LOCATION_GAP_MS) return { accepted: false, segmentDistanceM: 0, reason: 'stale' };
  const segment = distanceM([previous.longitude, previous.latitude], [next.longitude, next.latitude]);
  const speed = segment / (gap / 1000);
  if (speed > MAX_PLAUSIBLE_RUNNING_SPEED_MPS) return { accepted: false, segmentDistanceM: 0, reason: 'speed' };
  if (segment < MIN_MEANINGFUL_MOVEMENT_M) return { accepted: false, segmentDistanceM: 0, reason: 'noise' };
  return { accepted: true, segmentDistanceM: segment };
}

export const distanceAccuracyScore = (targetM: number, actualM: number) => Math.max(0, Math.min(100, 100 - (Math.abs(targetM - actualM) / targetM) * 200));
export const recommendationScore = (safety: number | null, accuracy: number) => safety === null ? null : Math.max(0, Math.min(100, safety * 0.7 + accuracy * 0.3));

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatPace(distanceMeters: number, durationSeconds: number): string {
  if (distanceMeters < 20 || durationSeconds <= 0) return '--′--″';
  const pace = durationSeconds / (distanceMeters / 1000);
  return `${Math.floor(pace / 60)}′${String(Math.round(pace % 60)).padStart(2, '0')}″`;
}

export function createSplits(points: LocationPoint[], totalDistanceM: number, totalSeconds: number): RunningRecord['splits'] {
  if (points.length < 2 || totalDistanceM < 20) return [];
  const splits: RunningRecord['splits'] = [];
  let cumulative = 0;
  let splitStartSeconds = 0;
  let nextMark = 1000;
  for (let index = 1; index < points.length; index += 1) {
    cumulative += distanceM([points[index - 1].longitude, points[index - 1].latitude], [points[index].longitude, points[index].latitude]);
    while (cumulative >= nextMark) {
      const endSeconds = points[index].sessionElapsedSeconds ?? totalSeconds * (nextMark / totalDistanceM);
      const duration = Math.max(1, endSeconds - splitStartSeconds);
      splits.push({ distanceKm: 1, durationSeconds: Math.round(duration), paceSecondsPerKm: duration });
      splitStartSeconds = endSeconds;
      nextMark += 1000;
    }
  }
  const remainderM = totalDistanceM - (nextMark - 1000);
  if (remainderM >= 20) {
    const duration = Math.max(1, totalSeconds - splitStartSeconds);
    splits.push({ distanceKm: remainderM / 1000, durationSeconds: Math.round(duration), paceSecondsPerKm: duration / (remainderM / 1000) });
  }
  return splits;
}

export function safetyScoreFromWarnings(points: WarningPoint[]): number {
  const deduction = points.reduce((sum, point) => {
    const proximity = point.distanceFromRouteM <= 50 ? 25 : point.distanceFromRouteM <= 100 ? 15 : 8;
    return sum + Math.min(40, proximity + Math.min(point.accidentCount * 2, 10));
  }, 0);
  return Math.max(0, Math.min(100, Math.round(100 - deduction)));
}

function projectMeters(point: LngLat, referenceLat: number): [number, number] {
  return [rad(point[0]) * EARTH_RADIUS_M * Math.cos(rad(referenceLat)), rad(point[1]) * EARTH_RADIUS_M];
}

export function distancePointToRouteM(point: LngLat, route: LngLat[]): number {
  let closest = Infinity;
  for (let index = 0; index < route.length - 1; index += 1) {
    const referenceLat = (route[index][1] + route[index + 1][1] + point[1]) / 3;
    const [px, py] = projectMeters(point, referenceLat);
    const [ax, ay] = projectMeters(route[index], referenceLat);
    const [bx, by] = projectMeters(route[index + 1], referenceLat);
    const dx = bx - ax;
    const dy = by - ay;
    const denominator = dx * dx + dy * dy;
    const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denominator));
    closest = Math.min(closest, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return closest;
}
