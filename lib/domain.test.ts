import { describe, expect, it } from 'vitest';
import { acceptRunningPoint, calculateEstimatedRunMinutes, DEFAULT_RUNNING_PACE_SEC_PER_KM, distanceAccuracyScore, formatPace, getEstimatedRunningPace, isLocationUsable, normalizeTargetDistanceKm, recommendationScore } from './domain';
import type { RunningRecord } from '@/types/run-guard';

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
  it('estimates route time from the most recent valid running pace', () => {
    const record = { startedAtMs: 2, distanceM: 5_000, durationSeconds: 1_950 } as RunningRecord;
    expect(getEstimatedRunningPace([record])).toBe(390);
    expect(calculateEstimatedRunMinutes(8_160, [record])).toBe(53);
  });
  it('falls back to 7:00/km when records are missing or invalid', () => {
    const invalid = { startedAtMs: 3, distanceM: 0, durationSeconds: Number.NaN } as RunningRecord;
    expect(getEstimatedRunningPace([invalid])).toBe(DEFAULT_RUNNING_PACE_SEC_PER_KM);
    expect(calculateEstimatedRunMinutes(5_000, [invalid])).toBe(35);
    expect(calculateEstimatedRunMinutes(20_000, [])).toBe(140);
  });
  it('skips a corrupt latest record in favor of the latest valid one', () => {
    const valid = { startedAtMs: 2, distanceM: 10_000, durationSeconds: 3_600 } as RunningRecord;
    const corrupt = { startedAtMs: 3, distanceM: 1_000, durationSeconds: 30 } as RunningRecord;
    expect(getEstimatedRunningPace([valid, corrupt])).toBe(360);
  });
});
