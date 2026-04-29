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

// Canvas 2D context — jsdom does not implement it by default.
if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    writable: true,
    value: jest.fn().mockImplementation(function getContext(type) {
      if (type !== '2d') return null;
      return {
        canvas: this,
        clearRect: jest.fn(),
        fillRect: jest.fn(),
        strokeRect: jest.fn(),
        beginPath: jest.fn(),
        closePath: jest.fn(),
        moveTo: jest.fn(),
        lineTo: jest.fn(),
        arc: jest.fn(),
        fill: jest.fn(),
        stroke: jest.fn(),
        save: jest.fn(),
        restore: jest.fn(),
        translate: jest.fn(),
        rotate: jest.fn(),
        scale: jest.fn(),
        setTransform: jest.fn(),
        drawImage: jest.fn(),
        fillText: jest.fn(),
        strokeText: jest.fn(),
        measureText: jest.fn().mockReturnValue({ width: 0 }),
        createLinearGradient: jest.fn().mockReturnValue({ addColorStop: jest.fn() }),
        createRadialGradient: jest.fn().mockReturnValue({ addColorStop: jest.fn() }),
        getImageData: jest.fn().mockReturnValue({ data: new Uint8ClampedArray(4) }),
        putImageData: jest.fn(),
      };
    }),
  });
}
