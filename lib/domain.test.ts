import { describe, expect, it } from 'vitest';
import { acceptRunningPoint, distanceAccuracyScore, formatPace, isLocationUsable, normalizeTargetDistanceKm, recommendationScore } from './domain';

const point = { latitude: 37.5, longitude: 127, accuracyM: 10, altitudeM: null, speedMps: null, headingDegrees: null, timestampMs: Date.now() };

describe('RUN Guard shared domain', () => {
  it('preserves Android location accuracy threshold', () => {
    expect(isLocationUsable(point)).toBe(true);
    expect(isLocationUsable({ ...point, accuracyM: 51 })).toBe(false);
  });
  it('rejects GPS noise under two meters', () => {
    expect(acceptRunningPoint(point, { ...point, longitude: 127.000001, timestampMs: point.timestampMs + 1000 }).accepted).toBe(false);
  });
  it('weights route ranking 70/30', () => {
    expect(distanceAccuracyScore(5000, 5250)).toBe(90);
    expect(recommendationScore(80, 90)).toBe(83);
  });
  it('does not claim pace from a tiny sample', () => {
    expect(formatPace(10, 20)).toBe('--′--″');
  });
  it('normalizes target distance to whole kilometers from 1 through 20', () => {
    expect(normalizeTargetDistanceKm(-4)).toBe(1);
    expect(normalizeTargetDistanceKm(7.32)).toBe(7);
    expect(normalizeTargetDistanceKm(20.8)).toBe(20);
    expect(normalizeTargetDistanceKm(Number.NaN)).toBe(5);
  });
});
