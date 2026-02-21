/**
 * Jest global setup — runs before every test file in the jsdom environment.
 *
 * Provides browser APIs that jsdom does not implement natively but that the
 * plugin scripts depend on.
 */

// IntersectionObserver — not available in jsdom.
// The mock records all constructor calls and exposes per-instance jest.fn()
// spies for observe() and disconnect() so tests can assert on them.
global.IntersectionObserver = jest.fn().mockImplementation(function (callback) {
  this.observe     = jest.fn();
  this.disconnect  = jest.fn();
  // Expose the callback so tests can simulate intersection events.
  this._callback   = callback;
});
