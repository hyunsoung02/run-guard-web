'use client';

import { useEffect } from 'react';
import { calculateMobileViewportMetrics, MOBILE_KEYBOARD_MIN_HEIGHT_PX } from '@/lib/mobileViewport';

const VIEWPORT_RESTORE_DELAY_MS = 250;
const MOBILE_MEDIA_QUERY = '(max-width: 767px)';

function isEditableElement(element: Element | null): boolean {
  return element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || (element instanceof HTMLElement && element.isContentEditable);
}

export function useMobileViewport() {
  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY);
    if (!mediaQuery.matches) return;

    const root = document.documentElement;
    const viewport = window.visualViewport;
    let stableLayoutHeight = Math.max(window.innerHeight, viewport?.height ?? 0);
    let frameId: number | null = null;
    let restoreTimer: number | null = null;
    let keyboardWasOpen = false;

    const restoreDocumentOffset = () => {
      if (isEditableElement(document.activeElement)) return;
      const visibleHeight = viewport?.height ?? window.innerHeight;
      const expanded = stableLayoutHeight - visibleHeight < MOBILE_KEYBOARD_MIN_HEIGHT_PX;
      if (expanded && (window.scrollY !== 0 || document.documentElement.scrollTop !== 0 || document.body.scrollTop !== 0)) {
        // Mobile browsers can leave their automatic focus pan on the document after the keyboard closes.
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      }
    };

    const measure = () => {
      frameId = null;
      const editableFocused = isEditableElement(document.activeElement);
      const visualHeight = viewport?.height ?? window.innerHeight;
      const visualOffsetTop = viewport?.offsetTop ?? 0;
      const metrics = calculateMobileViewportMetrics({
        visualHeight,
        visualOffsetTop,
        fallbackHeight: window.innerHeight,
        stableLayoutHeight,
        editableFocused,
      });

      if (!metrics.keyboardOpen && metrics.viewportHeight > stableLayoutHeight - MOBILE_KEYBOARD_MIN_HEIGHT_PX) {
        stableLayoutHeight = Math.max(metrics.viewportHeight + metrics.viewportOffsetTop, window.innerHeight);
      }

      root.style.setProperty('--app-viewport-height', `${metrics.viewportHeight}px`);
      root.style.setProperty('--app-viewport-offset-top', `${metrics.viewportOffsetTop}px`);
      root.style.setProperty('--app-layout-viewport-height', `${stableLayoutHeight}px`);
      root.classList.toggle('is-keyboard-open', metrics.keyboardOpen);

      if (keyboardWasOpen && !metrics.keyboardOpen) restoreDocumentOffset();
      keyboardWasOpen = metrics.keyboardOpen;
    };

    const scheduleMeasure = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(measure);
    };

    const scheduleFinalRestore = () => {
      scheduleMeasure();
      if (restoreTimer !== null) window.clearTimeout(restoreTimer);
      restoreTimer = window.setTimeout(() => {
        measure();
        restoreDocumentOffset();
      }, VIEWPORT_RESTORE_DELAY_MS);
    };

    const handleOrientationChange = () => {
      stableLayoutHeight = 0;
      scheduleFinalRestore();
    };

    measure();
    viewport?.addEventListener('resize', scheduleMeasure);
    viewport?.addEventListener('scroll', scheduleMeasure);
    window.addEventListener('resize', scheduleMeasure);
    window.addEventListener('orientationchange', handleOrientationChange);
    document.addEventListener('focusin', scheduleMeasure);
    document.addEventListener('focusout', scheduleFinalRestore);

    return () => {
      viewport?.removeEventListener('resize', scheduleMeasure);
      viewport?.removeEventListener('scroll', scheduleMeasure);
      window.removeEventListener('resize', scheduleMeasure);
      window.removeEventListener('orientationchange', handleOrientationChange);
      document.removeEventListener('focusin', scheduleMeasure);
      document.removeEventListener('focusout', scheduleFinalRestore);
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      if (restoreTimer !== null) window.clearTimeout(restoreTimer);
      root.classList.remove('is-keyboard-open');
      root.style.removeProperty('--app-viewport-height');
      root.style.removeProperty('--app-viewport-offset-top');
      root.style.removeProperty('--app-layout-viewport-height');
    };
  }, []);
}
