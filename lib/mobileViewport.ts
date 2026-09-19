export const MOBILE_KEYBOARD_MIN_HEIGHT_PX = 120;

export type MobileViewportMetrics = {
  viewportHeight: number;
  viewportOffsetTop: number;
  layoutHeight: number;
  keyboardOpen: boolean;
};

export function calculateMobileViewportMetrics({
  visualHeight,
  visualOffsetTop,
  fallbackHeight,
  stableLayoutHeight,
  editableFocused,
}: {
  visualHeight: number;
  visualOffsetTop: number;
  fallbackHeight: number;
  stableLayoutHeight: number;
  editableFocused: boolean;
}): MobileViewportMetrics {
  const safeVisualHeight = Math.max(1, Math.round(visualHeight));
  const safeOffsetTop = Math.max(0, Math.round(visualOffsetTop));
  const layoutHeight = Math.max(
    safeVisualHeight + safeOffsetTop,
    Math.round(fallbackHeight),
    Math.round(stableLayoutHeight),
  );
  const occludedHeight = Math.max(0, layoutHeight - safeVisualHeight - safeOffsetTop);

  return {
    viewportHeight: safeVisualHeight,
    viewportOffsetTop: safeOffsetTop,
    layoutHeight,
    keyboardOpen: editableFocused && occludedHeight >= MOBILE_KEYBOARD_MIN_HEIGHT_PX,
  };
}
