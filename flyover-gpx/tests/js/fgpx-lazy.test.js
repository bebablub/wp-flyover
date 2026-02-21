/**
 * Tests for fgpx-lazy.js — the IntersectionObserver-based lazy loader.
 *
 * Strategy
 * --------
 * The file is a self-contained IIFE that reads window.FGPX and runs
 * immediately.  We eval() it into the jsdom global context after setting up
 * window.FGPX for each test.
 *
 * Key observations that make the async chain testable:
 *   - Setting lazyStyles:[] + lazyScripts:[] causes loadStyles() and
 *     loadScriptsSequential() to resolve instantly via empty Promise.all /
 *     Array.reduce chains.
 *   - Two microtask ticks (await Promise.resolve() twice) are enough to let
 *     the entire .then() chain complete and window.FGPX.boot() be called.
 *   - _bootStarted is set *synchronously* inside bootstrap(), making it
 *     observable right after eval() returns.
 */

const fs   = require('fs');
const path = require('path');

const LAZY_SRC = fs.readFileSync(
  path.resolve(__dirname, '../../assets/js/fgpx-lazy.js'),
  'utf8'
);

/** Execute the lazy-loader IIFE in the current jsdom window context. */
function loadLazy() {
  // eslint-disable-next-line no-eval
  eval(LAZY_SRC);
}

/** Build a minimal window.FGPX fixture. */
function makeFGPX(overrides = {}) {
  return Object.assign(
    {
      deferViewport: false,
      lazyStyles:    [],       // empty → Promise resolves immediately
      lazyScripts:   [],       // empty → Promise resolves immediately
      boot:          jest.fn(),
      debugLogging:  false,
    },
    overrides
  );
}

// ---------------------------------------------------------------------------
beforeEach(() => {
  delete window.FGPX;
  document.body.innerHTML = '';
  IntersectionObserver.mockClear();
});

// ---------------------------------------------------------------------------
describe('immediate mode (deferViewport = false)', () => {

  test('sets _bootStarted synchronously', () => {
    window.FGPX = makeFGPX();
    loadLazy();
    expect(window.FGPX._bootStarted).toBe(true);
  });

  test('calls window.FGPX.boot() after the load-chain Promises resolve', async () => {
    window.FGPX = makeFGPX();
    loadLazy();
    // One tick for loadStyles, one for loadScriptsSequential
    await Promise.resolve();
    await Promise.resolve();
    expect(window.FGPX.boot).toHaveBeenCalledTimes(1);
  });

  test('does not call boot() a second time when _bootStarted is already true', async () => {
    const boot = jest.fn();
    window.FGPX = makeFGPX({ _bootStarted: true, boot });
    loadLazy();                         // bootstrap() returns early
    await Promise.resolve();
    await Promise.resolve();
    expect(boot).not.toHaveBeenCalled();
  });

});

// ---------------------------------------------------------------------------
describe('deferred mode (deferViewport = true)', () => {

  test('bootstraps immediately when no .fgpx element exists in the DOM', () => {
    window.FGPX = makeFGPX({ deferViewport: true });
    // document.body is empty → querySelector returns null → immediate fallback
    loadLazy();
    expect(window.FGPX._bootStarted).toBe(true);
  });

  test('bootstraps immediately when IntersectionObserver is unavailable', () => {
    window.FGPX = makeFGPX({ deferViewport: true });
    document.body.innerHTML = '<div class="fgpx"></div>';
    const saved = global.IntersectionObserver;
    delete global.IntersectionObserver;

    loadLazy();

    global.IntersectionObserver = saved;
    expect(window.FGPX._bootStarted).toBe(true);
  });

  test('sets up IntersectionObserver for every .fgpx container', () => {
    window.FGPX = makeFGPX({ deferViewport: true });
    document.body.innerHTML =
      '<div class="fgpx"></div>' +
      '<div class="fgpx"></div>' +
      '<div class="fgpx"></div>';

    loadLazy();

    // Should not bootstrap yet
    expect(window.FGPX._bootStarted).toBeUndefined();
    // One observer instance, observe() called once per container
    const io = IntersectionObserver.mock.instances[0];
    expect(io.observe).toHaveBeenCalledTimes(3);
  });

  test('triggers bootstrap when any container enters the viewport', async () => {
    window.FGPX = makeFGPX({ deferViewport: true });
    document.body.innerHTML =
      '<div class="fgpx"></div>' +
      '<div class="fgpx"></div>';

    loadLazy();

    // Simulate the first element entering the viewport
    const io = IntersectionObserver.mock.instances[0];
    io._callback([{ isIntersecting: true }]);

    await Promise.resolve();
    await Promise.resolve();

    expect(window.FGPX.boot).toHaveBeenCalledTimes(1);
  });

  test('only bootstraps once even if multiple entries intersect simultaneously', async () => {
    window.FGPX = makeFGPX({ deferViewport: true });
    document.body.innerHTML =
      '<div class="fgpx"></div>' +
      '<div class="fgpx"></div>';

    loadLazy();

    const io = IntersectionObserver.mock.instances[0];
    // Fire both entries intersecting at once
    io._callback([
      { isIntersecting: true },
      { isIntersecting: true },
    ]);

    await Promise.resolve();
    await Promise.resolve();

    expect(window.FGPX.boot).toHaveBeenCalledTimes(1);
  });

});
