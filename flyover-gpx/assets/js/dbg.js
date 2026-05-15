/**
 * Flyover GPX — Central Debug Logger (dbg.js)
 *
 * Provides conditional debug logging that respects the admin setting
 * "Output detailed console debug messages". All debug messages are
 * prefixed with [FGPX] for easy identification and filtering.
 *
 * Features:
 * - Zero performance overhead when debug logging is disabled
 * - Graceful fallback if console is unavailable
 * - Consistent message formatting across the application
 * - Performance timing utilities for optimization analysis
 *
 * Exposed as window.DBG so every script (front.js, timeline.js, gallery.js, …)
 * can call DBG.log / DBG.warn / DBG.time / DBG.timeEnd directly.
 */
(function () {
  'use strict';

  /**
   * Check if debug logging is enabled via admin settings.
   * @returns {boolean} True if debug logging should be active
   */
  function isEnabled() {
    return !!(window.FGPX && window.FGPX.debugLogging);
  }

  /**
   * Log informational debug message.
   * @param {...*} args - Arguments to log (same as console.info)
   */
  function log() {
    if (!isEnabled()) return;
    try {
      console.info.apply(console, ['[FGPX]'].concat([].slice.call(arguments)));
    } catch (e) {
      /* console unavailable */
    }
  }

  /**
   * Log warning debug message.
   * @param {...*} args - Arguments to log (same as console.warn)
   */
  function warn() {
    if (!isEnabled()) return;
    try {
      console.warn.apply(console, ['[FGPX]'].concat([].slice.call(arguments)));
    } catch (e) {
      /* console unavailable */
    }
  }

  /**
   * Start performance timer.
   * @param {string} label - Timer label for identification
   */
  function time(label) {
    if (!isEnabled()) return;
    try {
      console.time('[FGPX] ' + label);
    } catch (e) {
      /* console unavailable */
    }
  }

  /**
   * End performance timer and log duration.
   * @param {string} label - Timer label to end
   */
  function timeEnd(label) {
    if (!isEnabled()) return;
    try {
      console.timeEnd('[FGPX] ' + label);
    } catch (e) {
      /* console unavailable */
    }
  }

  window.DBG = { isEnabled: isEnabled, log: log, warn: warn, time: time, timeEnd: timeEnd };
})();
