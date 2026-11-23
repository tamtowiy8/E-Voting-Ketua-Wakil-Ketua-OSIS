import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isValidAdminPanelTab,
  resolveFullscreenChangeTransition,
  resolveInitialProjectorMode,
  shouldSkipSplashForProjector,
} from './projectorMode.ts';

test('resolveInitialProjectorMode retains Proyektor mode after reload even without native fullscreenElement', () => {
  assert.equal(resolveInitialProjectorMode(true, false), true);
  assert.equal(resolveInitialProjectorMode(true, true), true);
  assert.equal(resolveInitialProjectorMode(false, true), true);
  assert.equal(resolveInitialProjectorMode(false, false), false);
});

test('resolveFullscreenChangeTransition preserves persisted Proyektor state until native fullscreen was genuinely exited', () => {
  // Reload occurred while persistedProjector was true, browser blocked native fullscreen -> keep true
  assert.deepEqual(
    resolveFullscreenChangeTransition({
      persistedProjector: true,
      sawNativeFullscreen: false,
      hasNativeFullscreen: false,
    }),
    { nextProjector: true, nextSawNativeFullscreen: false }
  );

  // User entered native fullscreen
  assert.deepEqual(
    resolveFullscreenChangeTransition({
      persistedProjector: true,
      sawNativeFullscreen: false,
      hasNativeFullscreen: true,
    }),
    { nextProjector: true, nextSawNativeFullscreen: true }
  );

  // User then pressed Escape or exited native fullscreen -> exit Proyektor mode
  assert.deepEqual(
    resolveFullscreenChangeTransition({
      persistedProjector: true,
      sawNativeFullscreen: true,
      hasNativeFullscreen: false,
    }),
    { nextProjector: false, nextSawNativeFullscreen: false }
  );
});

test('shouldSkipSplashForProjector skips SplashIntro when autostart=1 or Proyektor mode is active', () => {
  assert.equal(shouldSkipSplashForProjector('', false), false);
  assert.equal(shouldSkipSplashForProjector('?autostart=1', false), true);
  assert.equal(shouldSkipSplashForProjector('', true), true);
});

test('isValidAdminPanelTab validates allowed admin tabs', () => {
  assert.equal(isValidAdminPanelTab('dpt'), true);
  assert.equal(isValidAdminPanelTab('overview'), true);
  assert.equal(isValidAdminPanelTab('invalid_tab'), false);
  assert.equal(isValidAdminPanelTab(null), false);
});
