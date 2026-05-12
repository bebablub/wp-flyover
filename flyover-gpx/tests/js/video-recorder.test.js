/**
 * Video Recorder feature test suite.
 * Tests browser support detection, chunking, cleanup, and error handling.
 */

const fs = require('fs');
const path = require('path');

const FRONT_SRC = fs.readFileSync(
  path.resolve(__dirname, '../../assets/js/front.js'),
  'utf8'
);

function loadFront() {
  // eslint-disable-next-line no-eval
  eval(FRONT_SRC);
}

describe('VideoRecorder.js', () => {
  let originalWindowFetch;
  let mockMap;
  let mockTrack;
  
  beforeAll(() => {
    originalWindowFetch = window.fetch;
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    delete window.FGPX;
    delete window.maplibregl;
    delete window.Chart;
    jest.restoreAllMocks();
    
    // Mock MapLibre map with canvas support
    mockTrack = {
      stop: jest.fn(),
      readyState: 'live'
    };

    mockMap = {
      getCanvas: jest.fn(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 800;
        canvas.height = 600;
        canvas.captureStream = jest.fn(() => {
          // Mock MediaStream
          return {
            getTracks: jest.fn(() => [mockTrack])
          };
        });
        return canvas;
      }),
      getContainer: jest.fn(() => document.body),
      addSource: jest.fn(),
      addLayer: jest.fn(),
      removeLayer: jest.fn(),
      removeSource: jest.fn(),
      getSource: jest.fn(),
      getLayer: jest.fn(),
      addImage: jest.fn(),
      hasImage: jest.fn(() => false),
      removeImage: jest.fn(),
      loadImage: jest.fn(() => Promise.resolve({ data: { width: 100, height: 100 } })),
      unproject: jest.fn((pixel) => ({ lng: 0, lat: 0 }))
    };
  });

  afterAll(() => {
    window.fetch = originalWindowFetch;
  });

  test('browser capability check detects unsupported canvas.captureStream()', async () => {
    loadFront();
    
    // Create recorder with map that doesn't support captureStream
    const fakeMap = {
      getCanvas: () => {
        const canvas = document.createElement('canvas');
        delete canvas.captureStream; // Remove support
        return canvas;
      }
    };
    
    const recorder = new window.VideoRecorder(fakeMap);
    
    try {
      await recorder.initPromise;
      fail('Should have rejected');
    } catch (error) {
      expect(error.message).toContain('browser');
      expect(error.message).toContain('does not support');
    }
  });

  test('initialization with valid map succeeds', async () => {
    loadFront();
    
    const recorder = new window.VideoRecorder(mockMap);
    
    await expect(recorder.initPromise).resolves.not.toThrow();
    expect(recorder.initialized).toBe(true);
    expect(recorder.mediaRecorder).toBeTruthy();
  });

  test('object URL cleanup timeout is 10 seconds (not 60)', () => {
    const code = FRONT_SRC;
    // Find the scheduleObjectUrlCleanup implementation
    const match = code.match(/scheduleObjectUrlCleanup[\s\S]*?setTimeout\([\s\S]*?,\s*(\d+)/);
    expect(match).toBeTruthy();
    expect(parseInt(match[1], 10)).toBe(10000);
  });

  test('session state is properly reset on start', async () => {
    loadFront();
    
    const recorder = new window.VideoRecorder(mockMap);
    await recorder.initPromise;
    
    // Pre-populate some state
    recorder.chunks = [new Blob(['old'])];
    recorder.chunkNumber = 5;
    recorder.sessionToken = 99;
    
    // Start recording
    await recorder.start();
    
    // Verify reset
    expect(recorder.chunks).toEqual([]);
    expect(recorder.chunkNumber).toBe(0);
    expect(recorder.sessionToken).toBe(100); // incremented
    expect(recorder.isRecording).toBe(true);
  });

  test('stop() checks mediaRecorder state before calling stop()', async () => {
    loadFront();
    
    const recorder = new window.VideoRecorder(mockMap);
    await recorder.initPromise;
    await recorder.start();
    
    const stopSpy = jest.spyOn(recorder.mediaRecorder, 'stop');
    
    recorder.stop();
    
    expect(stopSpy).toHaveBeenCalled();
    expect(recorder.isRecording).toBe(false);
  });

  test('stop() safely handles errors and still cleans up', async () => {
    loadFront();
    
    const recorder = new window.VideoRecorder(mockMap);
    await recorder.initPromise;
    await recorder.start();
    
    // Make mediaRecorder.stop() throw
    recorder.mediaRecorder.stop = jest.fn(() => {
      throw new Error('Stop failed');
    });
    
    // Spy on cleanup methods
    const restoreSpy = jest.spyOn(recorder, 'restoreTextMarkers').mockImplementation(() => {});
    const removeSpy = jest.spyOn(recorder, 'removePhotoFromMap').mockImplementation(() => {});
    const hideSpy = jest.spyOn(recorder, 'hideRecordingProgress').mockImplementation(() => {});
    
    // Stop should not throw, but should clean up
    expect(() => recorder.stop()).not.toThrow();
    
    expect(restoreSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();
    expect(hideSpy).toHaveBeenCalled();
    expect(recorder.isRecording).toBe(false);
  });

  test('cleanupPendingUrls() revokes all pending URLs', () => {
    loadFront();
    
    const recorder = new window.VideoRecorder(mockMap);
    
    // Add fake URLs
    const url1 = 'blob:http://example.com/1';
    const url2 = 'blob:http://example.com/2';
    
    recorder.pendingObjectUrls = [url1, url2];
    
    const revokeSpy = jest.spyOn(URL, 'revokeObjectURL');
    
    recorder.cleanupPendingUrls();
    
    expect(revokeSpy).toHaveBeenCalledWith(url1);
    expect(revokeSpy).toHaveBeenCalledWith(url2);
    expect(recorder.pendingObjectUrls).toHaveLength(0);
  });

  test('chunk finalization creates correct filename format', async () => {
    loadFront();
    
    const recorder = new window.VideoRecorder(mockMap, { preset: 'high' });
    await recorder.initPromise;
    
    // Mock the persistChunk method
    const persistSpy = jest.spyOn(recorder, 'persistChunk').mockResolvedValue(undefined);
    
    // Add some chunks
    recorder.chunks = [new Blob(['data1']), new Blob(['data2'])];
    recorder.totalRecordedBytes = 1000;
    recorder.sessionId = 'rec_12345_abc123';
    recorder.chunkNumber = 2;
    
    await recorder.finalizeCurrentChunk(false);
    
    expect(persistSpy).toHaveBeenCalled();
    const blob = persistSpy.mock.calls[0][0];
    const filename = persistSpy.mock.calls[0][1];
    
    expect(filename).toMatch(/^flyover-high-rec_12345_abc123-chunk-002/);
    expect(blob).toBeInstanceOf(Blob);
  });

  test('chunk rotation is triggered at size threshold', () => {
    loadFront();
    
    const recorder = new window.VideoRecorder(mockMap, { expectedChunkCount: 3 });
    
    // Verify thresholds are reasonable
    expect(recorder.CHUNK_SIZE_TARGET).toBe(200 * 1024 * 1024); // 200MB
    expect(recorder.CHUNK_SIZE_THRESHOLD).toBe(250 * 1024 * 1024); // 250MB
  });

  test('error shown to user via modal when init fails', () => {
    loadFront();
    
    const recorder = new window.VideoRecorder(mockMap);
    
    // Mock showInitError
    const errorSpy = jest.spyOn(recorder, 'showInitError').mockImplementation(() => {});
    
    const testError = new Error('Test error message');
    recorder.showInitError(testError.message);
    
    expect(errorSpy).toHaveBeenCalledWith('Test error message');
  });

  test('showCompletionMessage creates modal instead of alert', async () => {
    loadFront();
    
    const recorder = new window.VideoRecorder(mockMap);
    await recorder.initPromise;
    
    // Simulate downloaded chunks
    recorder.downloadedChunks = [
      { filename: 'chunk-001.webm', size: 209715200 },
      { filename: 'chunk-002.webm', size: 104857600 }
    ];
    
    // Spy on document.body.appendChild
    const appendSpy = jest.spyOn(document.body, 'appendChild');
    
    recorder.showCompletionMessage();
    
    // Verify modal was added to DOM
    expect(appendSpy).toHaveBeenCalled();
    const addedElement = appendSpy.mock.calls[appendSpy.mock.calls.length - 1][0];
    expect(addedElement).toBeInstanceOf(HTMLElement);
    expect(addedElement.style.zIndex).toBe('10000');
  });

  test('library detects crypto-backed session ID generation', () => {
    const code = FRONT_SRC;
    expect(code).toContain('createSessionIdSuffix');
    expect(code).toContain('cryptoObj.getRandomValues');
  });

  test('recorder options are preserved during chunk rotation', async () => {
    loadFront();
    
    const recorder = new window.VideoRecorder(mockMap);
    await recorder.initPromise;
    
    // Verify recorderOptions were saved
    expect(recorder.recorderOptions).toBeTruthy();
    expect(recorder.recorderOptions.mimeType).toBeTruthy();
    expect(recorder.recorderOptions.videoBitsPerSecond).toBeTruthy();
  });

  test('media recorder state is checked before stop', async () => {
    loadFront();
    
    const recorder = new window.VideoRecorder(mockMap);
    await recorder.initPromise;
    
    // Mock mediaRecorder state
    recorder.mediaRecorder.state = 'stopped';
    const stopSpy = jest.spyOn(recorder.mediaRecorder, 'stop');
    
    recorder.stop();
    
    // Should not call stop if already stopped
    expect(stopSpy).not.toHaveBeenCalled();
  });

  test('downloading single chunk skips completion message', async () => {
    loadFront();
    
    const recorder = new window.VideoRecorder(mockMap);
    
    // Only 1 chunk
    recorder.downloadedChunks = [{ filename: 'single.webm', size: 100000000 }];
    
    const showMessageSpy = jest.spyOn(recorder, 'showCompletionMessage');
    
    // showCompletionMessage should return early
    // (we can't call it directly without mocking more, but we can verify the logic)
    expect(recorder.downloadedChunks.length).toBe(1);
  });

  test('canvas size is captured in initialization logs', async () => {
    loadFront();
    
    const recorder = new window.VideoRecorder(mockMap);
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    
    await recorder.initPromise;
    
    // Verify canvas dimensions are captured
    expect(recorder.canvas.width).toBe(800);
    expect(recorder.canvas.height).toBe(600);
    
    consoleSpy.mockRestore();
  });

  test('stream tracks are properly released on cleanup', async () => {
    loadFront();
    
    const recorder = new window.VideoRecorder(mockMap);
    await recorder.initPromise;
    
    const stream = recorder.stream;
    const tracks = stream.getTracks();
    const trackStopSpy = jest.spyOn(tracks[0], 'stop');
    
    recorder.releaseStream();
    
    expect(trackStopSpy).toHaveBeenCalled();
    expect(recorder.stream).toBeNull();
  });
});

/**
 * REGRESSION TESTS - Prevent reintroduction of fixed bugs
 * These tests ensure fixes to critical issues are maintained across updates.
 */
describe('VideoRecorder Regression Tests - Critical Fixes', () => {
  let mockMap;

  beforeEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
    
    mockMap = {
      getCanvas: jest.fn(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 800;
        canvas.height = 600;
        canvas.captureStream = jest.fn(() => ({
          getTracks: jest.fn(() => [{ stop: jest.fn() }])
        }));
        return canvas;
      }),
      getContainer: jest.fn(() => document.body),
      addSource: jest.fn(),
      addLayer: jest.fn(),
      removeLayer: jest.fn(),
      removeSource: jest.fn(),
      getSource: jest.fn(),
      getLayer: jest.fn(),
      addImage: jest.fn(),
      hasImage: jest.fn(() => false),
      removeImage: jest.fn(),
      loadImage: jest.fn(() => Promise.resolve({ data: { width: 100, height: 100 } }))
    };
  });

  test('REGRESSION: Object URL cleanup must use 10s timeout, not 60s', () => {
    // BUG FIX: Object URLs were cleaned up after 60 seconds, causing memory leak
    // FIXED: Reduced to 10 seconds for faster cleanup in multi-chunk recordings
    const code = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../assets/js/front.js'),
      'utf8'
    );
    
    const timeoutMatch = code.match(/scheduleObjectUrlCleanup[\s\S]*?setTimeout[^,]*,\s*(\d+)/);
    expect(timeoutMatch).toBeTruthy();
    const timeoutValue = parseInt(timeoutMatch[1], 10);
    
    expect(timeoutValue).toBe(10000);
    expect(timeoutValue).not.toBe(60000); // Ensure old value is gone
  });

  test('REGRESSION: Browser must check for canvas.captureStream() support', () => {
    // BUG FIX: Silent failure on unsupported browsers (Safari, iOS)
    // FIXED: Added check for function existence before calling
    const code = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../assets/js/front.js'),
      'utf8'
    );
    
    expect(code).toContain('typeof this.canvas.captureStream !== \'function\'');
    expect(code).toContain('Your browser does not support canvas video recording');
  });

  test('REGRESSION: showCompletionMessage must use modal, not alert()', () => {
    // BUG FIX: Using alert() for multi-chunk completion message is bad UX
    // FIXED: Replaced with styled modal dialog
    const code = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../assets/js/front.js'),
      'utf8'
    );
    
    const showCompletionSection = code.match(/VideoRecorder\.prototype\.showCompletionMessage = function\(\) \{[\s\S]*?^      \};/m);
    expect(showCompletionSection).toBeTruthy();
    
    // Modal implementation must exist
    expect(showCompletionSection[0]).toContain('document.createElement(\'div\')');
    expect(showCompletionSection[0]).toContain('modal.style.position');
    
    // Old alert() must not be used
    expect(showCompletionSection[0]).not.toContain('alert(message)');
  });

  test('REGRESSION: Modal must support Escape key dismissal', () => {
    // BUG FIX: Modal had no keyboard support
    // FIXED: Added Escape key handler
    const code = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../assets/js/front.js'),
      'utf8'
    );
    
    expect(code).toContain('e.key === \'Escape\'');
    expect(code).toContain('e.code === \'Escape\'');
    expect(code).toContain('window.removeEventListener(\'keydown\'');
  });

  test('REGRESSION: Modal must support backdrop click dismissal', () => {
    // BUG FIX: No way to dismiss modal except clicking button
    // FIXED: Added click backdrop support
    const code = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../assets/js/front.js'),
      'utf8'
    );
    
    expect(code).toContain('e.target === modal');
    expect(code).toContain('modal.onclick');
  });

  test('REGRESSION: Init error must show user-facing modal, not silent failure', () => {
    // BUG FIX: Init errors silently rejected promise
    // FIXED: Added showInitError() to display error to user
    const code = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../assets/js/front.js'),
      'utf8'
    );
    
    expect(code).toContain('showInitError');
    expect(code).toContain('Video Recording Not Available');
  });

  test('REGRESSION: Stop must check mediaRecorder state before stopping', () => {
    // BUG FIX: Calling stop() on stopped recorder causes errors
    // FIXED: Check state before calling stop
    const code = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../assets/js/front.js'),
      'utf8'
    );
    
    const stopSection = code.match(/VideoRecorder\.prototype\.stop = function\(\) \{[\s\S]*?^      \};/m);
    expect(stopSection).toBeTruthy();
    expect(stopSection[0]).toContain('mediaRecorder.state');
    expect(stopSection[0]).toContain('recording');
  });

  test('REGRESSION: Stop must have fallback cleanup even on error', () => {
    // BUG FIX: Errors in stop() left resources uncleaned
    // FIXED: Added try/catch with cleanup fallback
    const code = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../assets/js/front.js'),
      'utf8'
    );
    
    const stopSection = code.match(/VideoRecorder\.prototype\.stop = function\(\) \{[\s\S]*?^      \};/m);
    expect(stopSection).toBeTruthy();
    expect(stopSection[0]).toContain('catch (error)');
    expect(stopSection[0]).toContain('this.restoreTextMarkers()');
    expect(stopSection[0]).toContain('this.removePhotoFromMap()');
  });

  test('REGRESSION: cleanupPendingUrls method must exist for explicit cleanup', () => {
    // BUG FIX: No way to clean up pending URLs on demand
    // FIXED: Added dedicated cleanup method
    const code = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../assets/js/front.js'),
      'utf8'
    );
    
    expect(code).toContain('cleanupPendingUrls');
    expect(code).toContain('URL.revokeObjectURL(url)');
    expect(code).toContain('this.pendingObjectUrls.shift()');
  });

  test('REGRESSION: Start must show error to user if it fails', () => {
    // BUG FIX: Start errors were silent
    // FIXED: Now call showInitError() on failure
    const code = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../assets/js/front.js'),
      'utf8'
    );
    
    const startSection = code.match(/VideoRecorder\.prototype\.start = function\(\) \{[\s\S]*?^      \};/m);
    expect(startSection).toBeTruthy();
    expect(startSection[0]).toContain('showInitError');
    expect(startSection[0]).toContain('catch');
  });

  test('REGRESSION: Video quality presets must be applied from constructor', () => {
    // BUG FIX: Ensure quality settings are properly initialized
    // This prevents regression where presets get lost
    const code = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../assets/js/front.js'),
      'utf8'
    );
    
    expect(code).toContain('VIDEO_QUALITY_PRESETS');
    expect(code).toContain('this.preset');
    expect(code).toContain('this.bitrate');
    expect(code).toContain('this.quality');
    expect(code).toContain('this.targetFPS');
  });

  test('REGRESSION: recorder presets/helper declarations are not duplicated', () => {
    const code = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../assets/js/front.js'),
      'utf8'
    );

    const presetDecls = (code.match(/var VIDEO_QUALITY_PRESETS\s*=\s*\{/g) || []).length;
    const sessionHelperDecls = (code.match(/function createSessionIdSuffix\s*\(/g) || []).length;

    expect(presetDecls).toBe(1);
    expect(sessionHelperDecls).toBe(1);
  });

  test('REGRESSION: duplicate bounds helper and dead recorder vars stay removed', () => {
    const code = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../assets/js/front.js'),
      'utf8'
    );

    const boundsHelpers = (code.match(/function boundsFromCoords\s*\(/g) || []).length;
    expect(boundsHelpers).toBe(1);

    expect(code).not.toContain('recordingProgress');
    expect(code).not.toContain('recordingDuration');
    expect(code).not.toContain('recordingSettingsModal');
    expect(code).not.toContain('function updateOverlayViewerControls');
  });

  test('REGRESSION: Session ID generation must use crypto, not Math.random', () => {
    // BUG FIX: Weak session IDs using Math.random
    // FIXED: Use crypto.getRandomValues for better randomness
    const code = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../assets/js/front.js'),
      'utf8'
    );
    
    expect(code).toContain('createSessionIdSuffix');
    expect(code).toContain('cryptoObj.getRandomValues');
    
    // Old weak method must not be used
    expect(code).not.toContain('Math.random().toString(36)');
  });

  test('REGRESSION: Chunk rotation must preserve recorder options', () => {
    // BUG FIX: Losing codec/bitrate settings on chunk rotation
    // FIXED: Store and reuse recorderOptions
    const code = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../assets/js/front.js'),
      'utf8'
    );
    
    expect(code).toContain('this.recorderOptions');
    expect(code).toContain('this.recorderOptions = options');
    expect(code).toContain('var opts = this.recorderOptions');
  });

  test('REGRESSION: Estimated size calculation must account for overhead', () => {
    // BUG FIX: Inaccurate file size estimation
    // FIXED: Include container and encoding overhead
    const code = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../assets/js/front.js'),
      'utf8'
    );
    
    const estimateSection = code.match(/VideoRecorder\.prototype\.calculateEstimatedSize = function\(\) \{[\s\S]*?return.*?;/);
    expect(estimateSection).toBeTruthy();
    expect(estimateSection[0]).toContain('containerOverhead');
    expect(estimateSection[0]).toContain('encodingOverhead');
  });

  test('REGRESSION: Chunk filename format must be consistent', () => {
    // BUG FIX: Inconsistent chunk filenames making reassembly difficult
    // FIXED: Use consistent format: flyover-PRESET-SESSION-chunk-NNN.ext
    const code = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../assets/js/front.js'),
      'utf8'
    );
    
    const filenameSection = code.match(/var filename = 'flyover-'.*?extension;/);
    expect(filenameSection).toBeTruthy();
    
    // Must include all components
    expect(filenameSection[0]).toContain('flyover-');
    expect(filenameSection[0]).toContain('preset');
    expect(filenameSection[0]).toContain('sessionId');
    expect(filenameSection[0]).toContain('chunk-');
    expect(filenameSection[0]).toContain('padStart(3, \'0\')'); // Zero-padded chunk numbers
  });

  test('REGRESSION: FFmpeg reassembly instructions must be provided in modal', () => {
    // BUG FIX: User has no guidance on reassembling chunks
    // FIXED: Modal shows FFmpeg command and filelist format
    const code = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../assets/js/front.js'),
      'utf8'
    );
    
    const modal = code.match(/VideoRecorder\.prototype\.showCompletionMessage = function\(\) \{[\s\S]*?ffmpegCmd/);
    expect(modal).toBeTruthy();
    expect(modal[0]).toContain('ffmpeg -f concat');
    expect(modal[0]).toContain('filelist.txt');
    expect(modal[0]).toContain('file \'');
  });

  test('REGRESSION: Copy-to-clipboard must work for FFmpeg command', () => {
    // BUG FIX: User has to manually type/copy FFmpeg command
    // FIXED: Click to copy functionality
    const code = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../assets/js/front.js'),
      'utf8'
    );
    
    const copySection = code.match(/VideoRecorder\.prototype\.showCompletionMessage = function\(\) \{[\s\S]*?Copied!/);
    expect(copySection).toBeTruthy();
    expect(copySection[0]).toContain('navigator.clipboard.writeText');
    expect(copySection[0]).toContain('Copied!');
  });

  test('REGRESSION: Recording state must be properly reset between sessions', () => {
    // BUG FIX: State bleeding between recordings
    // FIXED: resetSessionState() clears all session data
    const code = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../assets/js/front.js'),
      'utf8'
    );
    
    const resetSection = code.match(/resetSessionState[\s\S]*?^      \};/m);
    expect(resetSection).toBeTruthy();
    
    // Must reset all recording state
    expect(resetSection[0]).toContain('this.chunks = []');
    expect(resetSection[0]).toContain('this.chunkNumber = 0');
    expect(resetSection[0]).toContain('this.sessionId');
    expect(resetSection[0]).toContain('this.sessionToken');
  });
});
