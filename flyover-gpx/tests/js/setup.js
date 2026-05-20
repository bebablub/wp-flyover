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

// MediaRecorder mock for Node.js/JSDOM (video-recorder tests)
if (typeof global.MediaRecorder === 'undefined') {
  global.MediaRecorder = class {
    constructor(stream, options) {
      this.stream = stream;
      this.options = options;
      this.state = 'inactive';
      this.ondataavailable = null;
      this.onstop = null;
      this.onerror = null;
    }
    start(timeslice) {
      this.state = 'recording';
      if (typeof this.ondataavailable === 'function') {
        setTimeout(() => {
          this.ondataavailable({ data: Buffer.from('mockdata') });
        }, 10);
      }
    }
    stop() {
      this.state = 'inactive';
      if (typeof this.onstop === 'function') {
        setTimeout(() => this.onstop(), 10);
      }
    }
    pause() { this.state = 'paused'; }
    resume() { this.state = 'recording'; }
    requestData() {}
    static isTypeSupported() { return true; }
  };
}

if (typeof URL !== 'undefined') {
  if (typeof URL.createObjectURL !== 'function') {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: jest.fn(() => 'blob:http://example.com/mock-object-url'),
    });
  }

  if (typeof URL.revokeObjectURL !== 'function') {
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: jest.fn(),
    });
  }
}
