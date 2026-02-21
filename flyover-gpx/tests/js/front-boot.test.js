/**
 * Tests for the top-level bootstrap behaviour of front.js.
 *
 * Strategy
 * --------
 * front.js is a ~8 700-line IIFE.  We eval() it into the jsdom context after
 * setting up window.FGPX, avoiding a full WordPress + MapLibre environment.
 *
 * Two observable side-effects are tested:
 *
 *   1. deferViewport = true  → the IIFE registers window.FGPX.boot without
 *      doing anything else.  This is the normal "lazy" path: boot() will be
 *      called later by fgpx-lazy.js after scripts have loaded.
 *
 *   2. deferViewport = false → the IIFE calls __fgpxRunInit() immediately,
 *      which loops every .fgpx container and calls initContainer(el).
 *      initContainer() guards itself:
 *        if (!el || typeof window.maplibregl === 'undefined' || ...) return;
 *      So without maplibregl the function exits cleanly — no crash.
 *
 * Loading front.js once per describe block (beforeAll) avoids re-eval-ing
 * 400 KB on every test while keeping test isolation via beforeEach state reset.
 */

const fs   = require('fs');
const path = require('path');

const FRONT_SRC = fs.readFileSync(
  path.resolve(__dirname, '../../assets/js/front.js'),
  'utf8'
);

function loadFront() {
  // eslint-disable-next-line no-eval
  eval(FRONT_SRC);
}

// ---------------------------------------------------------------------------
// Lazy (deferred) mode
// ---------------------------------------------------------------------------
describe('front.js — deferViewport = true (lazy boot registration)', () => {

  beforeAll(() => {
    // Set up FGPX before eval so the IIFE takes the lazy branch.
    window.FGPX = {
      deferViewport: true,
      debugLogging:  false,
    };
    loadFront();
  });

  beforeEach(() => {
    // Reset only the boot-state flags; keep the registered boot function.
    delete window.FGPX._bootDone;
  });

  test('registers window.FGPX.boot as a function', () => {
    expect(typeof window.FGPX.boot).toBe('function');
  });

  test('_bootDone is not set before boot() is called', () => {
    expect(window.FGPX._bootDone).toBeFalsy();
  });

  test('calling boot() sets _bootDone to true', () => {
    window.FGPX.boot();
    expect(window.FGPX._bootDone).toBe(true);
  });

  test('calling boot() a second time does not throw', () => {
    window.FGPX.boot();
    expect(() => window.FGPX.boot()).not.toThrow();
  });

  test('_bootDone remains true after repeated boot() calls', () => {
    window.FGPX.boot();
    window.FGPX.boot();
    window.FGPX.boot();
    expect(window.FGPX._bootDone).toBe(true);
  });

});

// ---------------------------------------------------------------------------
// Eager mode — verifies no crash without MapLibre / Chart
// ---------------------------------------------------------------------------
describe('front.js — deferViewport = false (eager mode, missing deps)', () => {

  beforeEach(() => {
    delete window.FGPX;
    delete window.maplibregl;
    delete window.Chart;
    document.body.innerHTML = '';
  });

  test('loading the script does not throw when maplibregl and Chart are absent', () => {
    window.FGPX = { deferViewport: false, debugLogging: false };
    expect(() => loadFront()).not.toThrow();
  });

  test('does not throw with a .fgpx container in the DOM when maplibregl is missing', () => {
    window.FGPX = { deferViewport: false, debugLogging: false };
    document.body.innerHTML = '<div id="fgpx-app" class="fgpx" data-track-id="1"></div>';
    expect(() => loadFront()).not.toThrow();
  });

  test('does not throw with multiple .fgpx containers when maplibregl is missing', () => {
    window.FGPX = { deferViewport: false, debugLogging: false };
    document.body.innerHTML =
      '<div id="fgpx-app"   class="fgpx" data-track-id="1"></div>' +
      '<div id="fgpx-app-2" class="fgpx" data-track-id="2"></div>';
    expect(() => loadFront()).not.toThrow();
  });

});
