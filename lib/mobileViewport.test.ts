import { describe, expect, it } from 'vitest';
import { calculateMobileViewportMetrics } from './mobileViewport';

describe('mobile viewport metrics', () => {
  it('uses the visible viewport and detects a real keyboard-sized occlusion', () => {
    expect(calculateMobileViewportMetrics({ visualHeight: 500, visualOffsetTop: 42, fallbackHeight: 500, stableLayoutHeight: 812, editableFocused: true })).toEqual({
      viewportHeight: 500,
      viewportOffsetTop: 42,
      layoutHeight: 812,
      keyboardOpen: true,
    });
  });

  it('does not treat focus or browser chrome movement alone as a keyboard', () => {
    expect(calculateMobileViewportMetrics({ visualHeight: 760, visualOffsetTop: 20, fallbackHeight: 780, stableLayoutHeight: 812, editableFocused: true }).keyboardOpen).toBe(false);
    expect(calculateMobileViewportMetrics({ visualHeight: 500, visualOffsetTop: 0, fallbackHeight: 500, stableLayoutHeight: 812, editableFocused: false }).keyboardOpen).toBe(false);
  });
});
