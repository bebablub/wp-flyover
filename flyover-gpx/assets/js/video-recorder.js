/**
 * Flyover GPX - VideoRecorder (video-recorder.js)
 *
 * Self-contained video recording module. Captures MapLibre map playback
 * via the canvas MediaStream API and downloads as chunked WebM/MP4 files.
 *
 * Exposes window.VideoRecorder and window.VideoRecorder.PRESETS.
 * Requires dbg.js to be loaded first; falls back to no-op if missing.
 */
(function () {
  'use strict';

  // Debug logger - provided by dbg.js.
  var _noop = function () {};
  var _noopDBG = { isEnabled: function () { return false; }, log: _noop, warn: _noop, time: _noop, timeEnd: _noop };
  var DBG = window.DBG || _noopDBG;

  // -------- Helpers --------

  var VIDEO_QUALITY_PRESETS = {
    ultra: {
      name: 'Ultra HD',
      description: '4K quality for professional use',
      fps: 60,
      bitrate: 15000000, // 15 Mbps
      quality: 0.95,
      resolution: { width: 3840, height: 2160 },
      fileSize: 'Very Large (~180MB/min)',
      useCase: 'Professional presentations, high-end displays',
    },
    high: {
      name: 'High Definition',
      description: '1080p quality for general use',
      fps: 30,
      bitrate: 5000000, // 5 Mbps
      quality: 0.9,
      resolution: { width: 1920, height: 1080 },
      fileSize: 'Large (~60MB/min)',
      useCase: 'YouTube uploads, presentations',
    },
    medium: {
      name: 'Standard Definition',
      description: 'Balanced quality and file size',
      fps: 30,
      bitrate: 4000000, // 4 Mbps
      resolution: { width: 1280, height: 720 },
      useCase: 'Web sharing, social media',
    },
    low: {
      name: 'Compressed',
      description: 'Small file size for quick sharing',
      fps: 24,
      bitrate: 1000000, // 1 Mbps
      quality: 0.6,
      resolution: { width: 854, height: 480 },
      fileSize: 'Small (~12MB/min)',
      useCase: 'Mobile viewing, slow connections',
    },
    minimal: {
      name: 'Ultra Compressed',
      description: 'Minimal file size for previews',
      fps: 15,
      bitrate: 500000, // 0.5 Mbps
      quality: 0.5,
      resolution: { width: 640, height: 360 },
      fileSize: 'Very Small (~6MB/min)',
      useCase: 'Quick previews, thumbnails',
    },
  };

  /**
   * Generate a random session ID suffix for unique identification.
   * @param {number} length
   * @returns {string}
   */
  function createSessionIdSuffix(length) {
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var targetLength = Math.max(1, length || 9);
    var result = '';
    var cryptoObj = null;

    if (
      typeof globalThis !== 'undefined' &&
      globalThis.crypto &&
      typeof globalThis.crypto.getRandomValues === 'function'
    ) {
      cryptoObj = globalThis.crypto;
    } else if (typeof window !== 'undefined') {
      var windowCrypto = window.crypto || window.msCrypto;
      if (windowCrypto && typeof windowCrypto.getRandomValues === 'function') {
        cryptoObj = windowCrypto;
      }
    }

    if (cryptoObj) {
      var bytes = new Uint8Array(targetLength);
      cryptoObj.getRandomValues(bytes);
      for (var i = 0; i < targetLength; i++) {
        result += chars.charAt(bytes[i] % chars.length);
      }
      return result;
    }

    for (var j = 0; j < targetLength; j++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return result;
  }

  /**
   * Polyfill for MediaRecorder used in VideoRecorder fallback.
   * @constructor
   * @param {MediaStream} stream
   * @param {Object} [options]
   */
  function createVideoRecorderMediaRecorder(stream, options) {
    this.stream = stream;
    this.options = options || {};
    this.state = 'inactive';
    this.ondataavailable = null;
    this.onstop = null;
    this.onerror = null;
  }

  createVideoRecorderMediaRecorder.isTypeSupported = function () {
    return true;
  };

  createVideoRecorderMediaRecorder.prototype.start = function () {
    this.state = 'recording';
  };

  createVideoRecorderMediaRecorder.prototype.stop = function () {
    if (this.state !== 'recording') return;
    this.state = 'inactive';
    if (typeof this.ondataavailable === 'function') {
      this.ondataavailable({ data: new Blob([]) });
    }
    if (typeof this.onstop === 'function') {
      this.onstop();
    }
  };

  /**
   * Returns the appropriate MediaRecorder constructor for the environment.
   * @returns {Function}
   */
  function getVideoRecorderConstructor() {
    if (typeof MediaRecorder === 'function') {
      return MediaRecorder;
    }
    return createVideoRecorderMediaRecorder;
  }

  /**
   * Compute estimated video file size per minute for a given recorder.
   * @param {Object} recorder
   * @returns {number}
   */
  function computeEstimatedSize(recorder) {
    return recorder.calculateEstimatedSize();
  }

  /**
   * Resolve chunk sizing configuration based on device memory and expected chunk count.
   * @param {number} expectedChunkCount
   * @returns {Object}
   */
  function resolveChunkSizingConfig(expectedChunkCount) {
    var safeExpectedChunks = Math.max(1, Number(expectedChunkCount) || 1);
    var deviceMemoryGb = Number(
      (typeof navigator !== 'undefined' && navigator && navigator.deviceMemory) || 0
    );

    if (deviceMemoryGb > 0 && deviceMemoryGb <= 2) {
      return {
        profile: 'low-memory',
        targetBytes: 128 * 1024 * 1024,
        thresholdBytes: 160 * 1024 * 1024,
      };
    }

    if (deviceMemoryGb > 0 && deviceMemoryGb <= 4) {
      return {
        profile: 'mid-memory',
        targetBytes: 160 * 1024 * 1024,
        thresholdBytes: 208 * 1024 * 1024,
      };
    }

    if (safeExpectedChunks >= 8) {
      return {
        profile: 'high-chunk-count',
        targetBytes: 160 * 1024 * 1024,
        thresholdBytes: 208 * 1024 * 1024,
      };
    }

    if (deviceMemoryGb >= 8) {
      return {
        profile: 'high-memory',
        targetBytes: 256 * 1024 * 1024,
        thresholdBytes: 320 * 1024 * 1024,
      };
    }

    return {
      profile: 'default',
      targetBytes: 200 * 1024 * 1024,
      thresholdBytes: 250 * 1024 * 1024,
    };
  }

  function VideoRecorder(map, options) {
    this.map = map;
    this.options = options || {};
    this.preset = this.options.preset || 'medium';
    this.customSettings = this.options.customSettings || null;
    this.root = this.options.root || null;
    this.overlayElement = this.options.overlayElement || null;
    this.mapContainer =
      this.options.mapContainer ||
      (this.map && typeof this.map.getContainer === 'function'
        ? this.map.getContainer()
        : null);
    this.progressHost = this.options.progressHost || this.mapContainer || document.body;
    this.outputMode = this.options.outputMode || 'download';
    this.outputDirectoryHandle = this.options.outputDirectoryHandle || null;
    this.expectedChunkCount = Math.max(1, Number(this.options.expectedChunkCount) || 1);

    // Apply preset or custom settings
    var settings = this.customSettings || VIDEO_QUALITY_PRESETS[this.preset];
    if (!settings) {
      DBG.warn('Invalid video quality preset:', this.preset, 'falling back to medium');
      settings = VIDEO_QUALITY_PRESETS['medium'];
      this.preset = 'medium';
    }

    this.canvas = null;
    this.stream = null;
    this.mediaRecorder = null;
    this.mimeType = '';
    this.chunks = [];
    this.isRecording = false;
    this.startTime = 0;
    this.frameCount = 0;
    this.targetFPS = settings.fps;
    this.frameInterval = 1000 / this.targetFPS;
    this.lastFrameTime = 0;
    this.quality = settings.quality;
    this.bitrate = settings.bitrate;
    this.initialized = false;
    this.initPromise = null;

    // Chunked download configuration
    var chunkSizing = resolveChunkSizingConfig(this.expectedChunkCount);
    this.chunkSizingProfile = chunkSizing.profile;
    this.CHUNK_SIZE_THRESHOLD = chunkSizing.thresholdBytes;
    this.CHUNK_SIZE_TARGET = chunkSizing.targetBytes;
    this.currentChunkSize = 0;
    this.chunkNumber = 0;
    this.sessionId = 'rec_' + Date.now() + '_' + createSessionIdSuffix(9);
    this.downloadedChunks = [];
    this.totalRecordedBytes = 0;
    this.progressElement = null;
    this.recordingImageIds = [];
    this.pendingObjectUrls = [];
    this.sessionToken = 0;
    this.stopRequested = false;
    // Recorder rotation state to ensure each chunk starts with fresh headers
    this.isRotatingChunk = false;
    this.recorderOptions = null;

    // File size estimation
    this.estimatedSizePerMinute = this.calculateEstimatedSize();

    DBG.log('VideoRecorder initialized with preset', {
      preset: this.preset,
      fps: this.targetFPS,
      bitrate: this.bitrate,
      quality: this.quality,
      estimatedSizePerMinute: Math.round(this.estimatedSizePerMinute / 1024 / 1024) + 'MB',
      chunkThreshold: this.formatFileSize(this.CHUNK_SIZE_THRESHOLD),
      chunkProfile: this.chunkSizingProfile,
      sessionId: this.sessionId,
    });

    this.initPromise = this.init();
  }

  /**
   * Creates a new unique session ID for the video recording session.
   * @returns {string} Session ID.
   */
  VideoRecorder.prototype.createSessionId = function () {
    return 'rec_' + Date.now() + '_' + createSessionIdSuffix(9);
  };

  /**
   * Resets the internal state for a new recording session.
   */
  VideoRecorder.prototype.resetSessionState = function () {
    this.chunks = [];
    this.currentChunkSize = 0;
    this.chunkNumber = 0;
    this.downloadedChunks = [];
    this.totalRecordedBytes = 0;
    this.startTime = 0;
    this.frameCount = 0;
    this.lastFrameTime = 0;
    this.stopRequested = false;
    this.isRotatingChunk = false;
    this.sessionId = this.createSessionId();
    this.sessionToken += 1;
  };

  /**
   * Checks if there is an active media stream for recording.
   * @returns {boolean} True if active stream exists.
   */
  VideoRecorder.prototype.hasActiveStream = function () {
    if (!this.stream || typeof this.stream.getTracks !== 'function') return false;
    var tracks = this.stream.getTracks();
    if (!tracks || tracks.length === 0) return false;
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i] && tracks[i].readyState === 'live') return true;
    }
    return false;
  };

  /**
   * Releases the current media stream and stops all tracks.
   */
  VideoRecorder.prototype.releaseStream = function () {
    if (!this.stream || typeof this.stream.getTracks !== 'function') return;
    try {
      this.stream.getTracks().forEach(function (track) {
        try {
          track.stop();
        } catch (_) {}
      });
    } catch (_) {}
    this.stream = null;
  };

  /**
   * Gets the overlay element for video recording, if available.
   * @returns {HTMLElement|null} Overlay element or null.
   */
  VideoRecorder.prototype.getOverlayElement = function () {
    if (this.overlayElement && this.overlayElement.isConnected) {
      return this.overlayElement;
    }
    if (this.mapContainer && typeof this.mapContainer.querySelector === 'function') {
      return this.mapContainer.querySelector('.fgpx-photo-overlay');
    }
    return null;
  };

  /**
   * Gets all marker elements from the map container.
   * @returns {NodeList} NodeList of marker elements.
   */
  VideoRecorder.prototype.getMarkerElements = function () {
    if (!this.mapContainer || typeof this.mapContainer.querySelectorAll !== 'function') {
      return [];
    }
    return this.mapContainer.querySelectorAll('.maplibregl-marker');
  };

  /**
   * Recreates the MediaRecorder instance with the current settings.
   */
  VideoRecorder.prototype.recreateMediaRecorder = function () {
    var opts = this.recorderOptions || {
      mimeType: this.getSupportedMimeType(),
      videoBitsPerSecond: this.bitrate,
    };
    this.mediaRecorder = new MediaRecorder(this.stream, opts);
    this.setupEventHandlers();
  };

  /**
   * Schedules cleanup of an object URL after a short delay.
   * @param {string} url - Object URL to revoke.
   */
  VideoRecorder.prototype.scheduleObjectUrlCleanup = function (url) {
    var self = this;
    this.pendingObjectUrls.push(url);
    setTimeout(function () {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {}
      self.pendingObjectUrls = self.pendingObjectUrls.filter(function (entry) {
        return entry !== url;
      });
    }, 10000); // 10 seconds: enough time for download to complete, quick cleanup
  };

  /**
   * Writes a video chunk to the output directory using the File System Access API.
   * @param {Blob} blob - Video chunk blob.
   * @param {string} filename - Filename to write.
   * @returns {Promise<void>} Resolves when write is complete.
   */
  VideoRecorder.prototype.writeChunkToDirectory = function (blob, filename) {
    var self = this;
    if (!this.outputDirectoryHandle) {
      return Promise.reject(new Error('No output directory selected'));
    }
    return this.outputDirectoryHandle
      .getFileHandle(filename, { create: true })
      .then(function (fileHandle) {
        return fileHandle.createWritable();
      })
      .then(function (writable) {
        return writable.write(blob).then(
          function () {
            return writable.close();
          },
          function (error) {
            try {
              return writable.abort().finally(function () {
                throw error;
              });
            } catch (_) {
              throw error;
            }
          }
        );
      })
      .catch(function (error) {
        DBG.warn(
          'Failed to write recording chunk to selected directory, falling back to browser download',
          error
        );
        self.outputMode = 'download';
        self.outputDirectoryHandle = null;
        return self.triggerChunkDownload(blob, filename);
      });
  };

  /**
   * Triggers a download of a video chunk by creating a temporary link.
   * @param {Blob} blob - Video chunk blob.
   * @param {string} filename - Filename for download.
   * @returns {Promise<void>} Resolves when download is triggered.
   */
  VideoRecorder.prototype.triggerChunkDownload = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    this.scheduleObjectUrlCleanup(url);
    return Promise.resolve();
  };

  /**
   * Persists a video chunk, either by writing to directory or triggering download.
   * @param {Blob} blob - Video chunk blob.
   * @param {string} filename - Filename for saving.
   * @returns {Promise<void>} Resolves when chunk is persisted.
   */
  VideoRecorder.prototype.persistChunk = function (blob, filename) {
    if (this.outputMode === 'directory' && this.outputDirectoryHandle) {
      return this.writeChunkToDirectory(blob, filename);
    }
    return this.triggerChunkDownload(blob, filename);
  };

  /**
   * Finalizes the current video chunk and triggers persistence.
   * @param {boolean} isFinalChunk - If true, this is the last chunk.
   * @returns {Promise<void>} Resolves when chunk is finalized.
   */
  VideoRecorder.prototype.finalizeCurrentChunk = function (isFinalChunk) {
    var self = this;
    if (this.chunks.length === 0) return Promise.resolve();

    var mimeType = this.mimeType || this.getSupportedMimeType();
    var blob = new Blob(this.chunks, { type: mimeType });
    var extension = mimeType.indexOf('mp4') !== -1 ? '.mp4' : '.webm';
    var preset = this.preset.charAt(0).toUpperCase() + this.preset.slice(1);
    var chunkPadded = String(this.chunkNumber).padStart(3, '0');
    var filename =
      'flyover-' + preset + '-' + this.sessionId + '-chunk-' + chunkPadded + extension;

    return this.persistChunk(blob, filename).then(function () {
      self.downloadedChunks.push({
        number: self.chunkNumber,
        filename: filename,
        size: blob.size,
        isFinal: !!isFinalChunk,
      });

      DBG.log('Chunk persisted', {
        chunkNumber: self.chunkNumber,
        filename: filename,
        size: self.formatFileSize(blob.size),
        isFinal: !!isFinalChunk,
        outputMode: self.outputMode,
        sessionId: self.sessionId,
      });

      self.chunks = [];
      self.currentChunkSize = 0;
      if (!isFinalChunk) {
        self.chunkNumber += 1;
      }
    });
  };

  /**
   * Initializes the video recorder and prepares for recording.
   * @returns {Promise<void>} Resolves when initialization is complete.
   */
  VideoRecorder.prototype.init = function () {
    var self = this;
    return new Promise(function (resolve, reject) {
      try {
        // Get the map's canvas - this is the key to capturing photo overlays!
        self.canvas = self.map.getCanvas();
        if (!self.canvas) {
          throw new Error('Map canvas not available');
        }

        // Use direct canvas recording (keeps photo overlays working)
        self.initWithCanvas();
        self.initialized = true;
        resolve();
      } catch (error) {
        var msg =
          error && error.message ? error.message : 'Video recording could not be initialized';
        DBG.warn('VideoRecorder init failed', error);
        // Show user-facing error
        self.showInitError(msg);
        reject(error);
      }
    });
  };

  /**
   * Initializes the video recorder with a canvas element.
   */
  VideoRecorder.prototype.initWithCanvas = function () {
    try {
      // Check browser support for canvas.captureStream()
      if (typeof this.canvas.captureStream !== 'function') {
        throw new Error(
          'Your browser does not support canvas video recording. Please use Chrome, Firefox, or Edge.'
        );
      }

      // Use direct canvas recording - this captures all map layers including photos!
      // Use manual frame capture (0) so frames are pushed explicitly from the animation
      // loop via captureFrame(). This prevents duplicate/stale frames when requestAnimationFrame
      // is throttled (background tab, CPU spike). Falls back to automatic mode on browsers
      // that don't support requestFrame() (e.g. Safari).
      this.stream = this.canvas.captureStream(0);
      this.manualFrameCapture = !!(
        this.stream &&
        typeof this.stream.getVideoTracks === 'function' &&
        this.stream.getVideoTracks().length > 0 &&
        typeof this.stream.getVideoTracks()[0].requestFrame === 'function'
      );
      if (!this.manualFrameCapture) {
        // Safari / fallback: re-capture with automatic frame rate so recording still works
        this.stream = this.canvas.captureStream(this.targetFPS);
      }

      // Configure MediaRecorder with compression
      var mimeType = this.getSupportedMimeType();
      this.mimeType = mimeType;
      var options = {
        mimeType: mimeType,
        videoBitsPerSecond: this.bitrate,
      };
      // Preserve options for recorder re-creation during rotation
      this.recorderOptions = options;

      this.recreateMediaRecorder();

      DBG.log('VideoRecorder initialized with canvas', {
        preset: this.preset,
        mimeType: mimeType,
        fps: this.targetFPS,
        bitrate: this.bitrate,
        canvasSize: { width: this.canvas.width, height: this.canvas.height },
      });
    } catch (error) {
      DBG.warn('Canvas recording init failed', error);
      throw error;
    }
  };

  /**
   * Sets up the composite canvas for video rendering.
   */
  VideoRecorder.prototype.setupCompositeCanvas = function () {
    try {
      // Create composite canvas for recording that includes markers
      this.compositeCanvas = document.createElement('canvas');
      this.compositeCanvas.width = this.canvas.width;
      this.compositeCanvas.height = this.canvas.height;
      this.compositeCtx = this.compositeCanvas.getContext('2d');
      DBG.log('Composite canvas created for marker recording');
    } catch (error) {
      DBG.warn('Failed to create composite canvas', error);
      this.compositeCanvas = null;
      this.compositeCtx = null;
    }
  };

  /**
   * Gets the best supported MIME type for video recording based on preset.
   * @returns {string} Supported MIME type.
   */
  VideoRecorder.prototype.getSupportedMimeType = function () {
    var codecs = [
      {
        mimeType: 'video/webm;codecs=vp9,opus',
        name: 'WebM VP9 (Best Compression)',
        efficiency: 'high',
        compatibility: 'modern',
      },
      {
        mimeType: 'video/webm;codecs=vp8,vorbis',
        name: 'WebM VP8 (Good Compression)',
        efficiency: 'medium',
        compatibility: 'good',
      },
      {
        mimeType: 'video/mp4;codecs=avc1.42E01E',
        name: 'MP4 H.264 (Best Compatibility)',
        efficiency: 'medium',
        compatibility: 'excellent',
      },
      {
        mimeType: 'video/webm;codecs=vp9',
        name: 'WebM VP9',
        efficiency: 'high',
        compatibility: 'modern',
      },
      {
        mimeType: 'video/webm;codecs=vp8',
        name: 'WebM VP8',
        efficiency: 'medium',
        compatibility: 'good',
      },
      {
        mimeType: 'video/webm',
        name: 'WebM',
        efficiency: 'medium',
        compatibility: 'good',
      },
      {
        mimeType: 'video/mp4;codecs=h264',
        name: 'MP4 H.264',
        efficiency: 'medium',
        compatibility: 'excellent',
      },
      {
        mimeType: 'video/mp4',
        name: 'MP4',
        efficiency: 'medium',
        compatibility: 'excellent',
      },
    ];

    // Select optimal codec based on preset
    var supportedCodecs = codecs.filter(function (codec) {
      return MediaRecorder.isTypeSupported(codec.mimeType);
    });

    if (supportedCodecs.length === 0) {
      return 'video/webm'; // fallback
    }

    // For high quality presets, prefer VP9 for better compression
    if (['ultra', 'high'].includes(this.preset)) {
      var vp9Codec = supportedCodecs.find(function (c) {
        return c.mimeType.includes('vp9');
      });
      if (vp9Codec) return vp9Codec.mimeType;
    }

    // For compatibility, prefer H.264
    if (this.preset === 'medium') {
      var h264Codec = supportedCodecs.find(function (c) {
        return c.mimeType.includes('avc1') || c.mimeType.includes('h264');
      });
      if (h264Codec) return h264Codec.mimeType;
    }

    // Return first supported codec
    return supportedCodecs[0].mimeType;
  };

  /**
   * Sets up event handlers for the MediaRecorder instance.
   */
  VideoRecorder.prototype.setupEventHandlers = function () {
    var self = this;

    this.mediaRecorder.ondataavailable = function (event) {
      if (event.data && event.data.size > 0) {
        self.chunks.push(event.data);
        self.currentChunkSize += event.data.size;
        self.totalRecordedBytes += event.data.size;

        // Rotate recorder at threshold to finalize a playable segment with fresh headers
        if (
          self.currentChunkSize >= self.CHUNK_SIZE_TARGET &&
          self.chunks.length > 10 &&
          !self.isRotatingChunk
        ) {
          DBG.log('Chunk threshold reached - rotating recorder', {
            chunkSize: self.formatFileSize(self.currentChunkSize),
            chunkNumber: self.chunkNumber,
          });
          self.isRotatingChunk = true;
          try {
            self.mediaRecorder.stop();
          } catch (e) {
            DBG.warn('Failed to stop MediaRecorder for rotation', e);
            self.isRotatingChunk = false;
          }
        }

        // Update progress display
        self.updateRecordingProgress();
      }
    };

    this.mediaRecorder.onstop = function () {
      var rotating = !!self.isRotatingChunk;
      var shouldRestart = rotating && !self.stopRequested && self.isRecording;
      self.isRotatingChunk = false;

      DBG.log('MediaRecorder stopped', {
        rotating: rotating,
        restart: shouldRestart,
        stopRequested: !!self.stopRequested,
      });

      self
        .finalizeCurrentChunk(!shouldRestart)
        .then(function () {
          if (shouldRestart) {
            try {
              self.recreateMediaRecorder();
              self.mediaRecorder.start(100);
              DBG.log('MediaRecorder rotated and restarted', {
                nextChunkNumber: self.chunkNumber,
              });
              return;
            } catch (err) {
              DBG.warn('Failed to restart MediaRecorder after rotation', err);
            }
          }
          self.onRecordingComplete();
        })
        .catch(function (error) {
          DBG.warn('Failed to finalize recorder chunk', error);
          self.onRecordingComplete();
        });
    };

    this.mediaRecorder.onerror = function (event) {
      DBG.warn('MediaRecorder error', event.error);
      self.stop();
    };
  };

  /**
   * Draws a photo overlay on the video during recording.
   * @param {Object} photoData - Photo data to overlay.
   */
  VideoRecorder.prototype.drawPhotoOverlay = function (photoData) {
    if (!this.isRecording) return;

    var self = this;
    var sessionToken = this.sessionToken;

    // Store the original photo data for use in map layer
    this.currentPhotoData = photoData;

    // Wait longer for DOM overlay animation to complete and avoid distorted frames
    setTimeout(function () {
      if (!self.isRecording || self.sessionToken !== sessionToken) return;
      var overlay = self.getOverlayElement();
      var img = overlay ? overlay.querySelector('img') : null;

      // Only add to map if overlay is fully visible and stable
      if (
        overlay &&
        img &&
        overlay.style.opacity === '1' &&
        img.complete &&
        img.naturalWidth > 0
      ) {
        self.addPhotoToMap();
      }
    }, 500); // Increased delay to ensure animation is complete

    DBG.log('Photo overlay will be added to map for recording', photoData);
  };

  /**
   * Clears the photo overlay from the video.
   */
  VideoRecorder.prototype.clearPhotoOverlay = function () {
    DBG.log('clearPhotoOverlay called - removing map layer');
    this.removePhotoFromMap();
    DBG.log('Photo overlay removed from map');
  };

  /**
   * Adds a photo overlay to the map during video recording.
   */
  VideoRecorder.prototype.addPhotoToMap = function () {
    try {
      var overlay = this.getOverlayElement();
      if (!overlay) return;

      var isVisible =
        overlay.style.display !== 'none' &&
        overlay.style.opacity !== '0' &&
        getComputedStyle(overlay).display !== 'none' &&
        parseFloat(getComputedStyle(overlay).opacity) > 0;

      if (!isVisible) return;

      var img = overlay.querySelector('img');
      if (!img || !img.src) return;

      // Remove existing photo overlay
      this.removePhotoFromMap();

      // Use map layer approach with different positioning to minimize terrain contours
      this.addPhotoAsTopLayer(img, overlay);
    } catch (error) {
      DBG.warn('Failed to add photo to map', error);
    }
  };

  /**
   * Adds a photo as a top layer on the map for video recording.
   * @param {HTMLImageElement} img - Image element.
   * @param {Object} overlay - Overlay data.
   */
  VideoRecorder.prototype.addPhotoAsTopLayer = function (img, overlay) {
    try {
      var self = this;
      var sessionToken = this.sessionToken;
      var originalImageUrl =
        (self.currentPhotoData &&
          (self.currentPhotoData.fullUrl || self.currentPhotoData.thumbUrl)) ||
        img.src;

      var center = this.map.getCenter();

      // Try symbol layer approach - this should not interact with terrain
      self.map
        .loadImage(originalImageUrl)
        .then(function (response) {
          if (!self.isRecording || self.sessionToken !== sessionToken) {
            return;
          }
          var image = response.data;

          // Calculate proper aspect ratio to match browser overlay
          var canvas = self.map.getCanvas();
          var canvasWidth = canvas.width;
          var canvasHeight = canvas.height;
          var imageAspect = image.width / image.height;
          var canvasAspect = canvasWidth / canvasHeight;
          var overlayRect = null;
          var imgRect = null;
          try {
            overlayRect = overlay && typeof overlay.getBoundingClientRect === 'function'
              ? overlay.getBoundingClientRect()
              : null;
            imgRect = img && typeof img.getBoundingClientRect === 'function'
              ? img.getBoundingClientRect()
              : null;
          } catch (_) {}

          // Browser overlay uses max height with black borders on sides
          // So we need to calculate the size that maintains aspect ratio within canvas height
          var iconSize;
          // Prefer actual rendered DOM size to match browser overlay 1:1.
          if (imgRect && isFinite(imgRect.width) && isFinite(imgRect.height) && imgRect.width > 0 && imgRect.height > 0) {
            iconSize = Math.min(imgRect.width / image.width, imgRect.height / image.height);
          } else if (imageAspect > canvasAspect) {
            // Image is wider than canvas - limit by canvas width (like browser does with height)
            iconSize = canvasWidth / image.width;
          } else {
            // Image is taller than canvas - limit by canvas height
            iconSize = canvasHeight / image.height;
          }

          // Scale down a bit to match browser overlay padding/margins
          if (!(imgRect && imgRect.width > 0 && imgRect.height > 0)) {
            iconSize *= 0.9;
          }
          if (!isFinite(iconSize) || iconSize <= 0) {
            iconSize = 0.9 * Math.min(canvasWidth / image.width, canvasHeight / image.height);
          }

          // Add image to map sprite
          if (!self.map.hasImage('photo-overlay-icon')) {
            self.map.addImage('photo-overlay-icon', image);
          }

          // Create GeoJSON source with center point
          self.map.addSource('photo-overlay-recording', {
            type: 'geojson',
            data: {
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: [center.lng, center.lat],
              },
            },
          });

          // First add a background layer for the dark grey background
          self.map.addLayer({
            id: 'photo-overlay-background-layer',
            type: 'background',
            paint: {
              'background-color': '#2a2a2a', // Dark grey to match plugin theme
            },
          });

          // Add symbol layer with calculated aspect ratio on top
          self.map.addLayer({
            id: 'photo-overlay-recording-layer',
            type: 'symbol',
            source: 'photo-overlay-recording',
            layout: {
              'icon-image': 'photo-overlay-icon',
              'icon-size': iconSize,
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
              'icon-anchor': 'center',
            },
            paint: {
              'icon-opacity': 1.0,
            },
          });

          DBG.log('Added photo as symbol layer with proper aspect ratio', {
            imageUrl: originalImageUrl,
            center: center,
            imageSize: { width: image.width, height: image.height },
            canvasSize: { width: canvasWidth, height: canvasHeight },
            overlaySize: overlayRect ? { width: overlayRect.width, height: overlayRect.height } : null,
            overlayImageSize: imgRect ? { width: imgRect.width, height: imgRect.height } : null,
            calculatedIconSize: iconSize,
            imageAspect: imageAspect,
            canvasAspect: canvasAspect,
          });
        })
        .catch(function (error) {
          DBG.warn('Failed to load image for symbol layer', error);
        });
    } catch (error) {
      DBG.warn('Failed to add photo as symbol layer', error);

      // Fallback to raster approach
      self.addPhotoAsRasterFallback(originalImageUrl);
    }
  };

  /**
   * Adds a photo as a raster fallback layer if top layer fails.
   * @param {string} originalImageUrl - Image URL.
   */
  VideoRecorder.prototype.addPhotoAsRasterFallback = function (originalImageUrl) {
    try {
      var bounds = this.map.getBounds();

      this.map.addSource('photo-overlay-recording', {
        type: 'image',
        url: originalImageUrl,
        coordinates: [
          [bounds.getWest(), bounds.getNorth()],
          [bounds.getEast(), bounds.getNorth()],
          [bounds.getEast(), bounds.getSouth()],
          [bounds.getWest(), bounds.getSouth()],
        ],
      });

      this.map.addLayer({
        id: 'photo-overlay-recording-layer',
        type: 'raster',
        source: 'photo-overlay-recording',
        paint: {
          'raster-opacity': 1.0,
        },
      });

      DBG.log('Added photo as raster fallback');
    } catch (error) {
      DBG.warn('Raster fallback also failed', error);
    }
  };

  /**
   * Keep recording photo overlay aligned with the live camera view.
   * This is called on map render frames while recording is active.
   */
  VideoRecorder.prototype.syncPhotoOverlayToCamera = function () {
    try {
      if (!this.map) return;
      if (!this.map.getSource || !this.map.getLayer) return;
      if (!this.map.getSource('photo-overlay-recording')) return;

      // Symbol-path: keep source centered on current camera center so screen-space overlay stays fixed.
      if (this.map.getLayer('photo-overlay-recording-layer')) {
        try {
          var center = this.map.getCenter();
          var src = this.map.getSource('photo-overlay-recording');
          if (src && typeof src.setData === 'function' && center) {
            src.setData({
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: [center.lng, center.lat],
              },
            });
          }
        } catch (_) {}
      }

      // Raster fallback path: refresh image coordinates to current bounds.
      try {
        var rasterLayer = this.map.getLayer('photo-overlay-recording-layer');
        var srcFallback = this.map.getSource('photo-overlay-recording');
        if (
          rasterLayer &&
          rasterLayer.type === 'raster' &&
          srcFallback &&
          typeof srcFallback.setCoordinates === 'function'
        ) {
          var b = this.map.getBounds();
          srcFallback.setCoordinates([
            [b.getWest(), b.getNorth()],
            [b.getEast(), b.getNorth()],
            [b.getEast(), b.getSouth()],
            [b.getWest(), b.getSouth()],
          ]);
        }
      } catch (_) {}
    } catch (_) {}
  };

  /**
   * Renders a photo and overlay to the video canvas.
   * @param {HTMLImageElement} img - Image element.
   * @param {Object} overlay - Overlay data.
   */
  VideoRecorder.prototype.renderPhotoToCanvas = function (img, overlay) {
    try {
      var self = this;
      var canvas = this.canvas;
      var ctx = canvas.getContext('2d');

      // Get original photo URL to avoid distorted frames
      var originalImageUrl =
        (self.currentPhotoData &&
          (self.currentPhotoData.fullUrl || self.currentPhotoData.thumbUrl)) ||
        img.src;

      // Create new image for canvas rendering
      var canvasImg = new Image();
      canvasImg.crossOrigin = 'anonymous';

      canvasImg.onload = function () {
        try {
          // Store current canvas state
          self.canvasImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

          // Start continuous rendering loop
          self.startPhotoCanvasRendering(canvasImg, overlay);

          DBG.log('Started canvas-based photo overlay rendering', {
            imageUrl: originalImageUrl,
            canvasSize: { width: canvas.width, height: canvas.height },
          });
        } catch (error) {
          DBG.warn('Failed to start canvas photo rendering', error);
        }
      };

      canvasImg.onerror = function () {
        // Fallback to DOM img if original URL fails
        if (img.complete && img.naturalWidth > 0) {
          try {
            self.canvasImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            self.startPhotoCanvasRendering(img, overlay);
            DBG.log('Using DOM image for canvas photo overlay');
          } catch (error) {
            DBG.warn('Fallback canvas rendering also failed', error);
          }
        }
      };

      canvasImg.src = originalImageUrl;
    } catch (error) {
      DBG.warn('Failed to setup canvas photo rendering', error);
    }
  };

  /**
   * Starts rendering a photo overlay to the canvas for video recording.
   * @param {HTMLImageElement} img - Image element.
   * @param {Object} overlay - Overlay data.
   */
  VideoRecorder.prototype.startPhotoCanvasRendering = function (img, overlay) {
    var self = this;
    var canvas = this.canvas;
    var ctx = canvas.getContext('2d');

    function renderFrame() {
      if (!self.isRecording || !overlay || overlay.style.display === 'none') {
        return;
      }

      try {
        // Restore original canvas content first
        if (self.canvasImageData) {
          ctx.putImageData(self.canvasImageData, 0, 0);
        }

        // Draw photo overlay on top
        self.drawPhotoOnCanvas(ctx, img, overlay, canvas);

        // Continue rendering
        requestAnimationFrame(renderFrame);
      } catch (error) {
        DBG.warn('Photo canvas rendering error', error);
      }
    }

    // Start rendering loop
    requestAnimationFrame(renderFrame);
  };

  /**
   * Draws a photo and overlay onto a canvas context.
   * @param {CanvasRenderingContext2D} ctx - Canvas context.
   * @param {HTMLImageElement} img - Image element.
   * @param {Object} overlay - Overlay data.
   * @param {HTMLCanvasElement} canvas - Canvas element.
   */
  VideoRecorder.prototype.drawPhotoOnCanvas = function (ctx, img, overlay, canvas) {
    try {
      // Draw overlay background
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Calculate photo dimensions (match browser overlay scaling)
      var maxWidth = canvas.width * 0.9;
      var maxHeight = canvas.height;
      var imgAspect = img.naturalWidth / img.naturalHeight;
      var containerAspect = maxWidth / maxHeight;

      var drawWidth, drawHeight;
      if (imgAspect > containerAspect) {
        drawWidth = Math.min(img.naturalWidth, maxWidth);
        drawHeight = drawWidth / imgAspect;
      } else {
        drawHeight = Math.min(img.naturalHeight, maxHeight);
        drawWidth = drawHeight * imgAspect;
      }

      var drawX = (canvas.width - drawWidth) / 2;
      var drawY = (canvas.height - drawHeight) / 2;

      // Draw photo
      ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

      // Draw caption if present
      var caption = overlay.querySelector('div');
      if (caption && caption.textContent && caption.style.display !== 'none') {
        var text = caption.textContent;
        ctx.font = '500 14px system-ui, Segoe UI, Roboto, Arial, sans-serif';
        var textWidth = ctx.measureText(text).width;
        var padding = 8;
        var captionWidth = textWidth + padding * 2;
        var captionHeight = 24;
        var captionX = canvas.width - captionWidth - 12;
        var captionY = canvas.height - captionHeight - 10;

        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(captionX, captionY, captionWidth, captionHeight);

        ctx.fillStyle = '#fff';
        ctx.fillText(text, captionX + padding, captionY + 16);
      }
    } catch (error) {
      DBG.warn('Failed to draw photo on canvas', error);
    }
  };

  /**
   * Adds a photo overlay to the map using a canvas and bounds.
   * @param {HTMLImageElement} img - Image element.
   * @param {Object} overlay - Overlay data.
   * @param {Array} bounds - Map bounds for overlay.
   */
  VideoRecorder.prototype.addPhotoToMapWithCanvas = function (img, overlay, bounds) {
    try {
      // Create canvas with overlay background and image
      var canvas = document.createElement('canvas');
      canvas.width = this.canvas.width;
      canvas.height = this.canvas.height;
      var ctx = canvas.getContext('2d');

      // Draw overlay background
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      var self = this;

      // Wait for image to be fully loaded
      if (img.complete && img.naturalWidth > 0) {
        this.drawImageToCanvas(ctx, img, canvas, overlay, bounds);
      } else {
        img.onload = function () {
          self.drawImageToCanvas(ctx, img, canvas, overlay, bounds);
        };
      }
    } catch (error) {
      DBG.warn('Failed to create canvas-based photo overlay', error);
    }
  };

  /**
   * Draws an image and overlay to a canvas with bounds.
   * @param {CanvasRenderingContext2D} ctx - Canvas context.
   * @param {HTMLImageElement} img - Image element.
   * @param {HTMLCanvasElement} canvas - Canvas element.
   * @param {Object} overlay - Overlay data.
   * @param {Array} bounds - Map bounds for overlay.
   */
  VideoRecorder.prototype.drawImageToCanvas = function (ctx, img, canvas, overlay, bounds) {
    try {
      // Match browser overlay scaling: max-width:90%; max-height:100%; object-fit:contain
      var maxWidth = canvas.width * 0.9;
      var maxHeight = canvas.height;
      var imgAspect = img.naturalWidth / img.naturalHeight;
      var containerAspect = maxWidth / maxHeight;

      var drawWidth, drawHeight;
      if (imgAspect > containerAspect) {
        drawWidth = Math.min(img.naturalWidth, maxWidth);
        drawHeight = drawWidth / imgAspect;
      } else {
        drawHeight = Math.min(img.naturalHeight, maxHeight);
        drawWidth = drawHeight * imgAspect;
      }

      var drawX = (canvas.width - drawWidth) / 2;
      var drawY = (canvas.height - drawHeight) / 2;
      ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

      // Draw caption if present
      var caption = overlay.querySelector('div');
      if (caption && caption.textContent && caption.style.display !== 'none') {
        var text = caption.textContent;
        ctx.font = '500 14px system-ui, Segoe UI, Roboto, Arial, sans-serif';
        var textWidth = ctx.measureText(text).width;
        var padding = 8;
        var captionWidth = textWidth + padding * 2;
        var captionHeight = 24;
        var captionX = canvas.width - captionWidth - 12;
        var captionY = canvas.height - captionHeight - 10;

        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(captionX, captionY, captionWidth, captionHeight);

        ctx.fillStyle = '#fff';
        ctx.fillText(text, captionX + padding, captionY + 16);
      }

      // Convert to data URL and add as map layer
      var dataURL = canvas.toDataURL('image/png');

      this.map.addSource('photo-overlay-recording', {
        type: 'image',
        url: dataURL,
        coordinates: [
          [bounds.getWest(), bounds.getNorth()],
          [bounds.getEast(), bounds.getNorth()],
          [bounds.getEast(), bounds.getSouth()],
          [bounds.getWest(), bounds.getSouth()],
        ],
      });

      // Add layer at the bottom of the layer stack so it's behind other map content
      var layers = this.map.getStyle().layers;
      var firstSymbolId = null;
      for (var i = 0; i < layers.length; i++) {
        if (layers[i].type === 'symbol') {
          firstSymbolId = layers[i].id;
          break;
        }
      }

      this.map.addLayer(
        {
          id: 'photo-overlay-recording-layer',
          type: 'raster',
          source: 'photo-overlay-recording',
          paint: {
            'raster-opacity': 1.0, // Full opacity for testing - make it clearly visible
          },
        },
        firstSymbolId
      ); // Add before first symbol layer

      DBG.log('Added canvas-based photo overlay to map');
    } catch (error) {
      DBG.warn('Failed to draw image to canvas', error);
    }
  };

  /**
   * Removes the photo overlay from the map.
   */
  VideoRecorder.prototype.removePhotoFromMap = function () {
    try {
      DBG.log('removePhotoFromMap: Starting removal process');

      // Stop canvas rendering loop
      this.stopPhotoCanvasRendering();

      // Remove symbol layer
      if (this.map.getLayer('photo-overlay-recording-layer')) {
        this.map.removeLayer('photo-overlay-recording-layer');
        DBG.log('removePhotoFromMap: Removed symbol layer');
      }

      // Remove background layer
      if (this.map.getLayer('photo-overlay-background-layer')) {
        this.map.removeLayer('photo-overlay-background-layer');
        DBG.log('removePhotoFromMap: Removed background layer');
      }

      // Remove source
      if (this.map.getSource('photo-overlay-recording')) {
        this.map.removeSource('photo-overlay-recording');
        DBG.log('removePhotoFromMap: Removed source');
      }

      // Remove image from sprite
      if (this.map.hasImage('photo-overlay-icon')) {
        this.map.removeImage('photo-overlay-icon');
        DBG.log('removePhotoFromMap: Removed image from sprite');
      }

      DBG.log('removePhotoFromMap: Removal process completed');
    } catch (error) {
      DBG.warn('removePhotoFromMap: Error during removal', error);
    }
  };

  /**
   * Stops rendering the photo overlay to the canvas.
   */
  VideoRecorder.prototype.stopPhotoCanvasRendering = function () {
    try {
      // Restore original canvas content if we have it stored
      if (this.canvasImageData && this.canvas) {
        var ctx = this.canvas.getContext('2d');
        ctx.putImageData(this.canvasImageData, 0, 0);
        this.canvasImageData = null;
      }
    } catch (error) {
      DBG.warn('Failed to restore canvas content', error);
    }
  };

  /**
   * Starts the video recording process.
   */
  VideoRecorder.prototype.start = function () {
    var self = this;
    if (this.isRecording) return Promise.resolve();

    if (!this.mediaRecorder || !this.hasActiveStream()) {
      this.initPromise = this.init();
    }

    return this.initPromise
      .then(function () {
        if (!self.mediaRecorder) {
          throw new Error('MediaRecorder not initialized');
        }

        try {
          self.resetSessionState();
          self.isRecording = true;
          self.startTime = performance.now();

          // Ensure all map markers are visible for recording
          self.ensureMarkersVisible();

          // Start recording with small time slices for better memory management
          self.mediaRecorder.start(100);

          // Show recording progress
          self.showRecordingProgress();

          DBG.log('Video recording started', {
            preset: self.preset,
            fps: self.targetFPS,
            bitrate: Math.round(self.bitrate / 1000) + 'k',
            canvasSize: { width: self.canvas.width, height: self.canvas.height },
          });
        } catch (error) {
          DBG.warn('Failed to start recording', error);
          self.isRecording = false;
          self.showInitError(
            'Recording failed to start: ' + (error.message || 'unknown error')
          );
          throw error;
        }
      })
      .catch(function (error) {
        DBG.warn('Recording start rejected', error);
        self.isRecording = false;
        return Promise.reject(error);
      });
  };

  /**
   * Ensures that map markers are visible during video recording.
   */
  VideoRecorder.prototype.ensureMarkersVisible = function () {
    // Convert text markers to map layers for recording (photos stay as DOM)
    this.convertTextMarkersToLayers();
  };

  /**
   * Converts text markers to map layers for video rendering.
   */
  VideoRecorder.prototype.convertTextMarkersToLayers = function () {
    var self = this;
    var sessionToken = this.sessionToken;
    this.recordingTextLayers = [];
    this.hiddenTextMarkers = [];
    this.recordingImageIds = [];

    try {
      // Find all markers (text markers AND photo thumbnails)
      var allMarkers = this.getMarkerElements();
      var convertedCount = 0;

      allMarkers.forEach(function (markerEl, index) {
        try {
          // Skip if already hidden
          if (markerEl.style.display === 'none' || markerEl.style.visibility === 'hidden')
            return;

          // Check if this is a photo thumbnail (has img element)
          var hasImage = markerEl.querySelector('img');
          var textContent = markerEl.textContent || '';

          // Skip if neither text nor image
          if (!hasImage && !textContent.trim()) return;

          // Skip text markers that contain emoji SVGs (max speed/elevation)
          if (
            hasImage &&
            textContent.trim() &&
            (textContent.includes('Max Speed') || textContent.includes('Max Elev'))
          ) {
            DBG.log('Skipping text marker with emoji, will handle as text-only', {
              textContent: textContent,
            });
            hasImage = null; // Treat as text marker instead
          }

          // Extract coordinates from DOM marker position using map.unproject()
          var lngLat = null;

          try {
            // Get marker's screen position
            var markerRect = markerEl.getBoundingClientRect();
            var mapRect = self.map.getContainer().getBoundingClientRect();

            // Calculate pixel position relative to map container
            // For thumbnails, use center; for text markers, use bottom anchor point
            var pixelX = markerRect.left - mapRect.left + markerRect.width / 2;
            var pixelY = hasImage
              ? markerRect.top - mapRect.top + markerRect.height / 2 // Center for thumbnails
              : markerRect.top - mapRect.top + markerRect.height; // Bottom for text

            // Convert pixel position to geographic coordinates
            lngLat = self.map.unproject([pixelX, pixelY]);

            DBG.log('Extracted coordinates from DOM position', {
              hasImage: !!hasImage,
              textContent: textContent,
              pixelPos: [pixelX, pixelY],
              coordinates: [lngLat.lng, lngLat.lat],
            });
          } catch (error) {
            DBG.warn('Failed to extract coordinates from marker position', error);
            return;
          }

          if (!lngLat) {
            DBG.warn('Could not extract coordinates, skipping marker');
            return;
          }
          var layerId = 'recording-marker-' + index;

          if (hasImage) {
            // Handle photo thumbnail marker
            var img = hasImage;
            DBG.log('Processing photo thumbnail', {
              src: img.src,
              complete: img.complete,
              naturalWidth: img.naturalWidth,
              coordinates: [lngLat.lng, lngLat.lat],
            });

            if (img.src && img.complete && img.naturalWidth > 0) {
              // Create source immediately to reserve the layer ID
              self.map.addSource(layerId, {
                type: 'geojson',
                data: {
                  type: 'Feature',
                  geometry: {
                    type: 'Point',
                    coordinates: [lngLat.lng, lngLat.lat],
                  },
                },
              });

              self.map
                .loadImage(img.src)
                .then(function (response) {
                  if (!self.isRecording || self.sessionToken !== sessionToken) {
                    try {
                      if (self.map.getSource(layerId)) {
                        self.map.removeSource(layerId);
                      }
                    } catch (_) {}
                    return;
                  }
                  var image = response.data;

                  var iconId = 'thumbnail-' + index;
                  if (!self.map.hasImage(iconId)) {
                    self.map.addImage(iconId, image);
                    self.recordingImageIds.push(iconId);
                  }

                  // Create a square cropped version of the image
                  var canvas = document.createElement('canvas');
                  var ctx = canvas.getContext('2d');
                  var size = Math.min(image.width, image.height);
                  canvas.width = size;
                  canvas.height = size;

                  // Calculate crop position to center the image
                  var cropX = (image.width - size) / 2;
                  var cropY = (image.height - size) / 2;

                  // Draw cropped square image
                  ctx.drawImage(image, cropX, cropY, size, size, 0, 0, size, size);

                  // Convert canvas to ImageData for MapLibre
                  var imageData = ctx.getImageData(0, 0, size, size);
                  var squareImage = {
                    width: size,
                    height: size,
                    data: imageData.data,
                  };

                  // Add the square image to map
                  var squareIconId = iconId + '-square';
                  if (!self.map.hasImage(squareIconId)) {
                    self.map.addImage(squareIconId, squareImage);
                    self.recordingImageIds.push(squareIconId);
                  }

                  self.map.addLayer({
                    id: layerId,
                    type: 'symbol',
                    source: layerId,
                    layout: {
                      'icon-image': squareIconId,
                      'icon-size': 0.25, // Much smaller to match DOM thumbnail size
                      'icon-allow-overlap': true,
                      'icon-ignore-placement': true,
                      'icon-anchor': 'center',
                    },
                  });

                  DBG.log('Added photo thumbnail layer', { layerId: layerId, iconId: iconId });
                })
                .catch(function (error) {
                  DBG.warn('Failed to load thumbnail image, skipping', {
                    src: img.src,
                    error: error.message || error,
                  });
                  // Remove the source we created since we can't add the layer
                  try {
                    if (self.map.getSource(layerId)) {
                      self.map.removeSource(layerId);
                    }
                  } catch (_) {}
                });

              self.recordingTextLayers.push(layerId);
            } else {
              DBG.warn('Photo thumbnail image not ready', {
                src: img.src,
                complete: img.complete,
                naturalWidth: img.naturalWidth,
              });
            }
          } else if (textContent.trim()) {
            // Handle text marker - create as image instead of text to avoid glyph issues
            try {
              // Create canvas with text
              var canvas = document.createElement('canvas');
              var ctx = canvas.getContext('2d');

              // Set font and measure text
              ctx.font = '600 12px system-ui, Segoe UI, Roboto, Arial, sans-serif';
              var textMetrics = ctx.measureText(textContent);
              var textWidth = textMetrics.width;
              var textHeight = 16; // Approximate height

              // Set canvas size with padding for card-style appearance
              var padding = 12;
              var shadowOffset = 4;
              canvas.width = textWidth + padding * 2 + shadowOffset;
              canvas.height = textHeight + padding * 2 + shadowOffset;

              // Helper function for rounded rectangles (fallback for older browsers)
              function drawRoundedRect(ctx, x, y, width, height, radius) {
                if (typeof ctx.roundRect === 'function') {
                  ctx.roundRect(x, y, width, height, radius);
                } else {
                  // Fallback for browsers without roundRect support
                  ctx.moveTo(x + radius, y);
                  ctx.lineTo(x + width - radius, y);
                  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
                  ctx.lineTo(x + width, y + height - radius);
                  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
                  ctx.lineTo(x + radius, y + height);
                  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
                  ctx.lineTo(x, y + radius);
                  ctx.quadraticCurveTo(x, y, x + radius, y);
                }
              }

              // Draw shadow first
              ctx.fillStyle = 'rgba(0,0,0,0.15)';
              ctx.beginPath();
              drawRoundedRect(
                ctx,
                shadowOffset,
                shadowOffset,
                canvas.width - shadowOffset,
                canvas.height - shadowOffset,
                8
              );
              ctx.fill();

              // Draw main card background with gradient
              var gradient = ctx.createLinearGradient(0, 0, 0, canvas.height - shadowOffset);
              gradient.addColorStop(0, '#ffffff');
              gradient.addColorStop(1, '#f8f9fa');
              ctx.fillStyle = gradient;
              ctx.beginPath();
              drawRoundedRect(
                ctx,
                0,
                0,
                canvas.width - shadowOffset,
                canvas.height - shadowOffset,
                8
              );
              ctx.fill();

              // Draw subtle border
              ctx.strokeStyle = 'rgba(0,0,0,0.12)';
              ctx.lineWidth = 1;
              ctx.beginPath();
              drawRoundedRect(
                ctx,
                0.5,
                0.5,
                canvas.width - shadowOffset - 1,
                canvas.height - shadowOffset - 1,
                8
              );
              ctx.stroke();

              // Draw text with better positioning
              ctx.font = '600 12px system-ui, Segoe UI, Roboto, Arial, sans-serif';
              ctx.fillStyle = '#2c3e50';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(
                textContent,
                (canvas.width - shadowOffset) / 2,
                (canvas.height - shadowOffset) / 2
              );

              // Convert canvas to ImageData
              var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              var textImage = {
                width: canvas.width,
                height: canvas.height,
                data: imageData.data,
              };

              // Add text image to map
              var textIconId = 'text-marker-' + index;
              if (!self.map.hasImage(textIconId)) {
                self.map.addImage(textIconId, textImage);
                self.recordingImageIds.push(textIconId);
              }

              // Create source and layer
              self.map.addSource(layerId, {
                type: 'geojson',
                data: {
                  type: 'Feature',
                  geometry: {
                    type: 'Point',
                    coordinates: [lngLat.lng, lngLat.lat],
                  },
                },
              });

              self.map.addLayer({
                id: layerId,
                type: 'symbol',
                source: layerId,
                layout: {
                  'icon-image': textIconId,
                  'icon-size': 1.0,
                  'icon-allow-overlap': true,
                  'icon-ignore-placement': true,
                  'icon-anchor': 'bottom',
                },
              });

              self.recordingTextLayers.push(layerId);

              DBG.log('Added text marker as image', {
                textContent: textContent,
                layerId: layerId,
              });
            } catch (error) {
              DBG.warn('Failed to create text marker image', error);
            }
          }

          // Hide DOM marker during recording
          self.hiddenTextMarkers.push({
            element: markerEl,
            originalVisibility: markerEl.style.visibility,
          });
          markerEl.style.visibility = 'hidden';

          convertedCount++;
        } catch (error) {
          DBG.warn('Error converting text marker', index, error);
          // Continue with other markers
        }
      });

      DBG.log('Converted markers to map layers', {
        converted: convertedCount,
        layers: self.recordingTextLayers.length,
      });
    } catch (error) {
      DBG.warn('Error in convertTextMarkersToLayers', error);
      // Fallback: restore any hidden markers
      self.restoreTextMarkers();
    }
  };

  /**
   * Restores DOM text markers and removes any temporary map layers created for recording.
   */
  VideoRecorder.prototype.restoreTextMarkers = function () {
    var self = this;

    try {
      // Remove recording layers
      if (this.recordingTextLayers) {
        this.recordingTextLayers.forEach(function (layerId) {
          try {
            if (self.map.getLayer(layerId)) {
              self.map.removeLayer(layerId);
            }
            if (self.map.getSource(layerId)) {
              self.map.removeSource(layerId);
            }
          } catch (e) {
            DBG.warn('Error removing recording layer', layerId, e);
          }
        });
        this.recordingTextLayers = [];
      }

      if (this.recordingImageIds) {
        this.recordingImageIds.forEach(function (imageId) {
          try {
            if (self.map.hasImage(imageId)) {
              self.map.removeImage(imageId);
            }
          } catch (e) {
            DBG.warn('Error removing recording image', imageId, e);
          }
        });
        this.recordingImageIds = [];
      }

      // Restore DOM marker visibility
      if (this.hiddenTextMarkers) {
        this.hiddenTextMarkers.forEach(function (markerInfo) {
          try {
            markerInfo.element.style.visibility = markerInfo.originalVisibility || 'visible';
          } catch (e) {
            DBG.warn('Error restoring marker visibility', e);
          }
        });
        this.hiddenTextMarkers = [];
      }

      DBG.log('Restored markers from recording layers');
    } catch (error) {
      DBG.warn('Error restoring text markers', error);
    }
  };

  /**
   * Starts the compositing loop to draw all visible map markers to the composite canvas during recording.
   */
  VideoRecorder.prototype.startMarkerCompositing = function () {
    if (!this.compositeCanvas || !this.isRecording) return;

    var self = this;

    function composite() {
      if (!self.isRecording || !self.compositeCtx) return;

      try {
        // Clear composite canvas
        self.compositeCtx.clearRect(
          0,
          0,
          self.compositeCanvas.width,
          self.compositeCanvas.height
        );

        // Draw map canvas
        self.compositeCtx.drawImage(self.canvas, 0, 0);

        // Draw all MapLibre markers
        self.drawMarkersToCanvas();

        // Continue compositing
        requestAnimationFrame(composite);
      } catch (error) {
        DBG.warn('Marker compositing error', error);
      }
    }

    requestAnimationFrame(composite);
  };

  /**
   * Draws all visible map markers to the composite recording canvas.
   * Iterates over marker elements, renders each to a temporary canvas, and draws them onto the main composite canvas.
   */
  VideoRecorder.prototype.drawMarkersToCanvas = function () {
    var markers = this.getMarkerElements();
    var mapRect = this.canvas.getBoundingClientRect();

    markers.forEach(
      function (marker) {
        if (marker.style.display === 'none') return;

        try {
          var markerRect = marker.getBoundingClientRect();

          // Calculate position relative to map canvas
          var x = markerRect.left - mapRect.left + markerRect.width / 2;
          var y = markerRect.top - mapRect.top + markerRect.height;

          // Skip if marker is outside canvas bounds
          if (x < 0 || y < 0 || x > mapRect.width || y > mapRect.height) return;

          // Create temporary canvas to render marker
          var tempCanvas = document.createElement('canvas');
          var tempCtx = tempCanvas.getContext('2d');
          tempCanvas.width = markerRect.width;
          tempCanvas.height = markerRect.height;

          // Draw marker content to temp canvas
          this.renderMarkerToCanvas(marker, tempCtx, markerRect.width, markerRect.height);

          // Draw temp canvas to composite canvas
          this.compositeCtx.drawImage(
            tempCanvas,
            x - markerRect.width / 2,
            y - markerRect.height
          );
        } catch (error) {
          // Skip problematic markers
        }
      }.bind(this)
    );
  };

  /**
   * Renders a single marker element onto a canvas context for video recording.
   * @param {HTMLElement} marker - Marker DOM element.
   * @param {CanvasRenderingContext2D} ctx - Canvas context.
   * @param {number} width - Canvas width.
   * @param {number} height - Canvas height.
   */
  VideoRecorder.prototype.renderMarkerToCanvas = function (marker, ctx, width, height) {
    // Get marker styles
    var computedStyle = window.getComputedStyle(marker);
    var text = marker.textContent || '';

    // Draw marker background
    ctx.fillStyle = computedStyle.backgroundColor || '#ffffff';
    var borderRadius = parseInt(computedStyle.borderRadius) || 6;
    this.drawRoundedRect(ctx, 0, 0, width, height, borderRadius);
    ctx.fill();

    // Draw border if present
    if (computedStyle.border && computedStyle.border !== 'none') {
      ctx.strokeStyle = computedStyle.borderColor || '#000000';
      ctx.lineWidth = parseInt(computedStyle.borderWidth) || 1;
      this.drawRoundedRect(ctx, 0, 0, width, height, borderRadius);
      ctx.stroke();
    }

    // Draw text
    if (text) {
      ctx.fillStyle = computedStyle.color || '#000000';
      ctx.font = computedStyle.font || '12px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, width / 2, height / 2);
    }
  };

  /**
   * Draws a rounded rectangle path on a canvas context.
   * @param {CanvasRenderingContext2D} ctx - Canvas context.
   * @param {number} x - X coordinate.
   * @param {number} y - Y coordinate.
   * @param {number} width - Rectangle width.
   * @param {number} height - Rectangle height.
   * @param {number} radius - Corner radius.
   */
  VideoRecorder.prototype.drawRoundedRect = function (ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  };

  /**
   * Stops the video recording process and performs cleanup.
   */
  VideoRecorder.prototype.stop = function () {
    if (!this.isRecording) return;

    try {
      this.stopRequested = true;
      this.isRecording = false;

      // Safely stop the media recorder
      if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
        this.mediaRecorder.stop();
      }

      // Restore text markers first
      this.restoreTextMarkers();

      // Clean up map layers
      this.removePhotoFromMap();

      // Clean up overlay canvas
      this.cleanupOverlayCanvas();

      // Hide recording progress
      this.hideRecordingProgress();

      // Clean up pending object URLs on explicit stop
      this.cleanupPendingUrls();

      DBG.log('Video recording stopped', {
        preset: this.preset,
        duration: ((performance.now() - this.startTime) / 1000).toFixed(2) + 's',
      });
    } catch (error) {
      DBG.warn('Failed to stop recording', error);
      // Still try to clean up even if stop failed
      try {
        this.restoreTextMarkers();
        this.removePhotoFromMap();
        this.hideRecordingProgress();
      } catch (_) {}
    }
  };

  /**
   * Cleans up any pending object URLs created during recording.
   */
  VideoRecorder.prototype.cleanupPendingUrls = function () {
    try {
      while (this.pendingObjectUrls.length > 0) {
        var url = this.pendingObjectUrls.shift();
        try {
          URL.revokeObjectURL(url);
        } catch (_) {}
      }
    } catch (error) {
      DBG.warn('Error cleaning up pending object URLs', error);
    }
  };

  /**
   * Cleans up and resets the overlay canvas used for recording.
   */
  VideoRecorder.prototype.cleanupOverlayCanvas = function () {
    if (this.compositeCanvas) {
      this.compositeCanvas.width = 0;
      this.compositeCanvas.height = 0;
      this.compositeCanvas = null;
      this.compositeCtx = null;
    }
    DBG.log('Recording cleanup completed');
  };

  /**
   * Handles actions to perform when recording is complete, such as releasing resources and showing completion UI.
   */
  VideoRecorder.prototype.onRecordingComplete = function () {
    try {
      var totalSize = this.downloadedChunks.reduce(function (total, chunk) {
        return total + chunk.size;
      }, 0);
      var duration = Math.max((performance.now() - this.startTime) / 1000, 0.001);
      var actualBitrate = (totalSize * 8) / duration; // bits per second

      DBG.log('Recording complete', {
        preset: this.preset,
        totalSize: this.formatFileSize(totalSize),
        duration: duration.toFixed(2) + 's',
        frames: this.frameCount,
        avgFPS: (this.frameCount / duration).toFixed(1),
        targetBitrate: Math.round(this.bitrate / 1000) + 'k',
        actualBitrate: Math.round(actualBitrate / 1000) + 'k',
        compressionRatio: (actualBitrate / this.bitrate).toFixed(2),
        chunksDownloaded: this.downloadedChunks.length,
        sessionId: this.sessionId,
      });

      this.releaseStream();

      // Show completion message with reassembly instructions
      this.showCompletionMessage();
    } catch (error) {
      DBG.warn('Failed to process recording', error);
    }
  };

  /**
   * Finalizes and downloads the current video chunk.
   * @param {boolean} isFinalChunk - If true, marks this as the final chunk.
   * @returns {Promise<void>} Resolves when download is complete.
   */
  VideoRecorder.prototype.downloadCurrentChunk = function (isFinalChunk) {
    return this.finalizeCurrentChunk(isFinalChunk);
  };

  /**
   * Triggers download of the entire video as a single file (legacy, for small recordings).
   * @param {Blob} blob - Video blob to download.
   */
  VideoRecorder.prototype.downloadVideo = function (blob) {
    // Legacy method - now handled by chunked downloads
    // Only used for small files that don't exceed chunk threshold
    try {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      var mimeType = this.getSupportedMimeType();
      var extension = mimeType.indexOf('mp4') !== -1 ? '.mp4' : '.webm';
      var timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      var preset = this.preset.charAt(0).toUpperCase() + this.preset.slice(1);
      a.download = 'flyover-' + preset + '-' + timestamp + extension;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      DBG.log('Video download started (single file)', {
        preset: this.preset,
        mimeType: mimeType,
        extension: extension,
        filename: a.download,
        size: this.formatFileSize(blob.size),
      });
    } catch (error) {
      DBG.warn('Failed to download video', error);
    }
  };

  // File size estimation and utility methods
  /**
   * Estimates the file size per minute for the current recording settings.
   * @returns {number} Estimated bytes per minute.
   */
  VideoRecorder.prototype.calculateEstimatedSize = function () {
    // Base calculation: bitrate * duration
    var bitsPerSecond = this.bitrate;
    var bytesPerSecond = bitsPerSecond / 8;
    var bytesPerMinute = bytesPerSecond * 60;

    // Add overhead for container format (WebM/MP4)
    var containerOverhead = 1.1; // 10% overhead

    // Add overhead for variable bitrate encoding
    var encodingOverhead = 1.2; // 20% overhead for peaks

    return bytesPerMinute * containerOverhead * encodingOverhead;
  };

  /**
   * Formats a file size in bytes as a human-readable string.
   * @param {number} bytes - File size in bytes.
   * @returns {string} Human-readable file size.
   */
  VideoRecorder.prototype.formatFileSize = function (bytes) {
    if (bytes < 1024 * 1024) {
      return Math.round(bytes / 1024) + ' KB';
    } else if (bytes < 1024 * 1024 * 1024) {
      return Math.round(bytes / (1024 * 1024)) + ' MB';
    } else {
      return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
    }
  };

  /**
   * Calculates the expected number of chunks for a given recording duration.
   * @param {number} durationMinutes - Recording duration in minutes.
   * @returns {number} Expected chunk count.
   */
  VideoRecorder.prototype.calculateExpectedChunks = function (durationMinutes) {
    var estimatedTotalSize = this.estimatedSizePerMinute * durationMinutes;
    if (estimatedTotalSize <= this.CHUNK_SIZE_THRESHOLD) {
      return 1; // Single file download
    }
    return Math.ceil(estimatedTotalSize / this.CHUNK_SIZE_TARGET);
  };

  /**
   * Displays a modal dialog with instructions for reassembling chunked video files after recording.
   */
  VideoRecorder.prototype.showCompletionMessage = function () {
    if (this.downloadedChunks.length <= 1) return; // Single file, no message needed

    var self = this;
    var extension = (this.mimeType || '').indexOf('mp4') !== -1 ? 'mp4' : 'webm';
    var ffmpegCmd = 'ffmpeg -f concat -safe 0 -i filelist.txt -c copy output.' + extension;

    // Create file list content
    var fileListLines = [];
    this.downloadedChunks.forEach(function (chunk) {
      fileListLines.push("file '" + chunk.filename + "'");
    });
    var fileListContent = fileListLines.join('\n');

    // Create modal dialog instead of alert
    var modal = document.createElement('div');
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.background = 'rgba(0,0,0,0.6)';
    modal.style.zIndex = '10000';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.fontFamily = 'sans-serif';

    var content = document.createElement('div');
    content.style.background = 'white';
    content.style.padding = '24px';
    content.style.borderRadius = '8px';
    content.style.maxWidth = '600px';
    content.style.maxHeight = '80vh';
    content.style.overflowY = 'auto';
    content.style.boxShadow = '0 4px 20px rgba(0,0,0,0.3)';

    var title = document.createElement('h2');
    title.textContent = 'Recording Complete';
    title.style.margin = '0 0 16px 0';

    var summary = document.createElement('p');
    summary.textContent =
      this.downloadedChunks.length +
      ' chunk file' +
      (this.downloadedChunks.length !== 1 ? 's' : '') +
      ' downloaded.';
    summary.style.fontWeight = 'bold';
    summary.style.marginBottom = '16px';

    var instructionsHeading = document.createElement('h3');
    instructionsHeading.textContent = 'To reassemble:';
    instructionsHeading.style.marginTop = '16px';
    instructionsHeading.style.marginBottom = '8px';

    var instructions = document.createElement('ol');
    instructions.style.margin = '0';
    instructions.style.paddingLeft = '20px';
    var li1 = document.createElement('li');
    li1.textContent = 'Keep all chunk files in the same folder';
    var li2 = document.createElement('li');
    li2.textContent = 'Create a file list filelist.txt with contents (see below)';
    var li3 = document.createElement('li');
    li3.textContent = 'Run the FFmpeg command (see below)';
    instructions.appendChild(li1);
    instructions.appendChild(li2);
    instructions.appendChild(li3);

    var fileListLabel = document.createElement('h3');
    fileListLabel.textContent = 'filelist.txt contents:';
    fileListLabel.style.marginTop = '16px';
    fileListLabel.style.marginBottom = '8px';

    var fileListCode = document.createElement('pre');
    fileListCode.textContent = fileListContent;
    fileListCode.style.background = '#f5f5f5';
    fileListCode.style.padding = '12px';
    fileListCode.style.borderRadius = '4px';
    fileListCode.style.overflowX = 'auto';
    fileListCode.style.fontSize = '12px';
    fileListCode.style.margin = '0 0 16px 0';

    var cmdLabel = document.createElement('h3');
    cmdLabel.textContent = 'FFmpeg command:';
    cmdLabel.style.marginTop = '16px';
    cmdLabel.style.marginBottom = '8px';

    var cmdCode = document.createElement('pre');
    cmdCode.textContent = ffmpegCmd;
    cmdCode.style.background = '#f5f5f5';
    cmdCode.style.padding = '12px';
    cmdCode.style.borderRadius = '4px';
    cmdCode.style.overflowX = 'auto';
    cmdCode.style.fontSize = '12px';
    cmdCode.style.margin = '0 0 16px 0';
    cmdCode.style.cursor = 'pointer';
    cmdCode.style.border = '1px solid #ddd';
    cmdCode.title = 'Click to copy';
    cmdCode.onclick = function () {
      navigator.clipboard
        .writeText(ffmpegCmd)
        .then(function () {
          var original = cmdCode.textContent;
          cmdCode.textContent = 'Copied!';
          setTimeout(function () {
            cmdCode.textContent = original;
          }, 2000);
        })
        .catch(function () {
          alert('Failed to copy. Please copy manually.');
        });
    };

    var filesHeading = document.createElement('h3');
    filesHeading.textContent = 'Your files:';
    filesHeading.style.marginTop = '16px';
    filesHeading.style.marginBottom = '8px';

    var files = document.createElement('div');
    this.downloadedChunks.forEach(function (chunk) {
      var item = document.createElement('div');
      item.style.padding = '6px 0';
      item.style.fontSize = '13px';
      item.style.color = '#555';
      item.textContent = chunk.filename + ' (' + self.formatFileSize(chunk.size) + ')';
      files.appendChild(item);
    });

    var closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.padding = '10px 20px';
    closeBtn.style.background = '#007bff';
    closeBtn.style.color = 'white';
    closeBtn.style.border = 'none';
    closeBtn.style.borderRadius = '4px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.fontSize = '14px';
    closeBtn.style.marginTop = '16px';
    closeBtn.onclick = function () {
      modal.remove();
    };

    content.appendChild(title);
    content.appendChild(summary);
    content.appendChild(instructionsHeading);
    content.appendChild(instructions);
    content.appendChild(fileListLabel);
    content.appendChild(fileListCode);
    content.appendChild(cmdLabel);
    content.appendChild(cmdCode);
    content.appendChild(filesHeading);
    content.appendChild(files);
    content.appendChild(closeBtn);

    modal.appendChild(content);
    document.body.appendChild(modal);

    // Keyboard and backdrop support
    var dismissModal = function () {
      modal.remove();
    };

    // Click backdrop to close
    modal.onclick = function (e) {
      if (e.target === modal) {
        dismissModal();
      }
    };

    // Escape key to close
    var onKeyDown = function (e) {
      if ((e.key === 'Escape' || e.code === 'Escape') && !e.defaultPrevented) {
        e.preventDefault();
        dismissModal();
        window.removeEventListener('keydown', onKeyDown);
      }
    };
    window.addEventListener('keydown', onKeyDown);

    DBG.log('Chunked recording completion dialog shown', {
      totalChunks: this.downloadedChunks.length,
      sessionId: this.sessionId,
      files: this.downloadedChunks.map(function (c) {
        return c.filename;
      }),
    });
  };

  /**
   * Displays a modal dialog with an error message if video recording initialization fails.
   * @param {string} message - Error message to display.
   */
  VideoRecorder.prototype.showInitError = function (message) {
    var modal = document.createElement('div');
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.background = 'rgba(0,0,0,0.6)';
    modal.style.zIndex = '10000';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.fontFamily = 'sans-serif';

    var content = document.createElement('div');
    content.style.background = 'white';
    content.style.padding = '24px';
    content.style.borderRadius = '8px';
    content.style.maxWidth = '500px';
    content.style.boxShadow = '0 4px 20px rgba(0,0,0,0.3)';
    content.style.borderLeft = '4px solid #dc3545';

    var title = document.createElement('h2');
    title.textContent = 'Video Recording Not Available';
    title.style.margin = '0 0 12px 0';
    title.style.color = '#dc3545';

    var text = document.createElement('p');
    text.textContent = message;
    text.style.margin = '0 0 16px 0';
    text.style.color = '#666';
    text.style.lineHeight = '1.5';

    var closeBtn = document.createElement('button');
    closeBtn.textContent = 'OK';
    closeBtn.style.padding = '8px 16px';
    closeBtn.style.background = '#dc3545';
    closeBtn.style.color = 'white';
    closeBtn.style.border = 'none';
    closeBtn.style.borderRadius = '4px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.onclick = function () {
      modal.remove();
    };

    content.appendChild(title);
    content.appendChild(text);
    content.appendChild(closeBtn);

    modal.appendChild(content);
    document.body.appendChild(modal);

    // Keyboard and backdrop support
    var dismissModal = function () {
      modal.remove();
    };

    // Click backdrop to close
    modal.onclick = function (e) {
      if (e.target === modal) {
        dismissModal();
      }
    };

    // Escape key to close
    var onKeyDown = function (e) {
      if ((e.key === 'Escape' || e.code === 'Escape') && !e.defaultPrevented) {
        e.preventDefault();
        dismissModal();
        window.removeEventListener('keydown', onKeyDown);
      }
    };
    window.addEventListener('keydown', onKeyDown);

    DBG.warn('Video recorder init error shown to user', message);
  };

  // Removed complex canvas scaling - keep it simple and working!

  /**
   * Updates the UI with the current recording progress and bitrate.
   */
  VideoRecorder.prototype.updateRecordingProgress = function () {
    if (!this.isRecording) return;

    var currentTime = performance.now();
    var elapsed = (currentTime - this.startTime) / 1000; // seconds
    var currentSize = this.totalRecordedBytes;
    var actualBitrate = elapsed > 0 ? (currentSize * 8) / elapsed : 0; // bits per second

    // Update progress UI if it exists
    var progressElement = this.progressElement;
    if (progressElement) {
      progressElement.innerHTML =
        '<div class="fgpx-progress-stats">' +
        '<div class="fgpx-progress-time">Recording: ' +
        Math.floor(elapsed) +
        's</div>' +
        '<div class="fgpx-progress-size">Size: ' +
        this.formatFileSize(currentSize) +
        '</div>' +
        '<div class="fgpx-progress-bitrate">Bitrate: ' +
        Math.round(actualBitrate / 1000) +
        'k</div>' +
        '</div>';
    }
  };

  /**
   * Shows the recording progress UI overlay.
   */
  VideoRecorder.prototype.showRecordingProgress = function () {
    // Create progress display if it doesn't exist
    var existing = this.progressElement;
    if (existing) {
      existing.style.display = 'block';
      return;
    }

    var progressDiv = document.createElement('div');
    progressDiv.className = 'fgpx-recording-progress';
    progressDiv.style.cssText =
      'position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.8); ' +
      'color: white; padding: 8px 12px; border-radius: 4px; font-size: 12px; ' +
      'z-index: 1000; font-family: monospace;';

    // Add to map container
    if (this.progressHost) {
      this.progressHost.appendChild(progressDiv);
    }
    this.progressElement = progressDiv;
  };

  /**
   * Hides the recording progress UI overlay.
   */
  VideoRecorder.prototype.hideRecordingProgress = function () {
    var progressElement = this.progressElement;
    if (progressElement) {
      progressElement.style.display = 'none';
    }
  };

  /**
   * Determines if a new video frame should be captured based on the target FPS.
   * @param {number} currentTime - Current time in milliseconds.
   * @returns {boolean} True if a frame should be captured.
   */
  VideoRecorder.prototype.shouldCaptureFrame = function (currentTime) {
    if (!this.isRecording) return false;

    var timeSinceLastFrame = currentTime - this.lastFrameTime;
    if (timeSinceLastFrame >= this.frameInterval) {
      this.lastFrameTime = currentTime;
      this.frameCount++;
      return true;
    }
    return false;
  };

  /**
   * Push one frame immediately, bypassing FPS throttling.
   * Use this for edge-cases where state changed abruptly (seek, end-stop)
   * and we must guarantee at least one up-to-date frame in the recording.
   */
  VideoRecorder.prototype.captureFrameNow = function () {
    if (!this.isRecording || !this.manualFrameCapture) return;
    try {
      var now = performance.now();
      var track = this.stream && typeof this.stream.getVideoTracks === 'function'
        ? this.stream.getVideoTracks()[0]
        : null;
      if (track && track.readyState === 'live' && typeof track.requestFrame === 'function') {
        track.requestFrame();
        this.lastFrameTime = now;
        this.frameCount++;
      }
    } catch (_) {}
  };

  window.VideoRecorder = VideoRecorder;

    /**
     * Explicitly push one video frame to the MediaRecorder stream.
     * Called from the animation loop on every rendered frame.
     * Throttled to targetFPS via shouldCaptureFrame().
     * No-op when manualFrameCapture is not supported (Safari fallback).
     * @param {number} [currentTime] - Timestamp in ms (defaults to performance.now()).
     */
    VideoRecorder.prototype.captureFrame = function (currentTime) {
      if (!this.isRecording || !this.manualFrameCapture) return;
      var now = currentTime !== undefined ? currentTime : performance.now();
      if (!this.shouldCaptureFrame(now)) return;
      try {
        var track = this.stream.getVideoTracks()[0];
        if (track && track.readyState === 'live') {
          track.requestFrame();
        }
      } catch (_) {}
    };
  window.VideoRecorder.PRESETS = VIDEO_QUALITY_PRESETS;
})();
