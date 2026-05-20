/*
 Frontend player for Flyover GPX
 - Fetches GPX-derived data via REST
 - Renders MapLibre map with OSM raster tiles
 - Draws route and animates a marker along time/distance
 - Shows stats panel and elevation chart with a synced cursor
 - Provides play/pause/restart controls and speed selector
*/
(function () {
  'use strict';

  // -------- Utilities --------

  /**
   * Simple DOM selector utility function
   * @param {string} selector - CSS selector string
   * @param {Element} [root=document] - Root element to search within
   * @returns {Element|null} First matching element or null
   */
  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  // Debug logger — provided by dbg.js (loaded before front.js).
  // Fallback no-op keeps front.js safe if dbg.js is missing (e.g. unit tests).
  var _noop = function () {};
  var _noopDBG = {
    isEnabled: function () {
      return false;
    },
    log: _noop,
    warn: _noop,
    time: _noop,
    timeEnd: _noop,
  };
  var DBG = window.DBG || _noopDBG;

  DBG.log('Front.js initialization started');

  // Throttled debug helper to keep verbose diagnostics readable.
  var dbgState = {};
  function dbgAllow(key, intervalMs) {
    if (!DBG.isEnabled()) return false;
    var now = Date.now();
    var last = Number(dbgState[key] || 0);
    if (now - last < intervalMs) return false;
    dbgState[key] = now;
    return true;
  }

  // VideoRecorder — provided by video-recorder.js (loaded before front.js).
  // Fallback null keeps code safe if video recorder is missing.
  var VideoRecorder = window.VideoRecorder || null;
  var VIDEO_QUALITY_PRESETS = (VideoRecorder && VideoRecorder.PRESETS) || {};

  /**
   * Photo Filename Matching Utility
   *
   * Determines if a thumbnail filename corresponds to a full-resolution image
   * by comparing base filenames while ignoring resolution suffixes.
   *
   * This handles cases where WordPress generates multiple image sizes:
   * - Original: IMG_20250824_110202_1.jpg
   * - Thumbnail: IMG_20250824_110202_1-300x225.jpg
   * - Large: IMG_20250824_110202_1-1024x768.jpg
   *
   * @param {string} thumbName - Thumbnail filename (may include resolution suffix)
   * @param {string} fullName - Full-resolution filename
   * @returns {boolean} True if the files appear to be different sizes of the same image
   *
   * @example
   * filenamesMatch('IMG_001-300x225.jpg', 'IMG_001-1024x768.jpg') // returns true
   * filenamesMatch('IMG_001.jpg', 'IMG_001.jpg') // returns true
   * filenamesMatch('IMG_001.jpg', 'IMG_002.jpg') // returns false
   */
  function filenamesMatch(thumbName, fullName) {
    try {
      // Extract base filenames before extension (handle multi-dot filenames like photo.2024.jpg)
      var thumbDot = thumbName.lastIndexOf('.');
      var thumbBase = thumbDot > 0 ? thumbName.substring(0, thumbDot) : thumbName;
      var fullDot = fullName.lastIndexOf('.');
      var fullBase = fullDot > 0 ? fullName.substring(0, fullDot) : fullName;

      // If they're exactly the same, they match
      if (thumbBase === fullBase) {
        return true;
      }

      // Check if they match the pattern: base-*resolution* vs base-*different_resolution*
      // This handles cases like IMG_20250824_110202_1-300x225 vs IMG_20250824_110202_1-1024x768
      var thumbParts = thumbBase.split('-');
      var fullParts = fullBase.split('-');

      // If they have different numbers of parts, they don't match
      if (thumbParts.length !== fullParts.length) {
        return false;
      }

      // Check if all parts except the last (resolution) match
      for (var i = 0; i < thumbParts.length - 1; i++) {
        if (thumbParts[i] !== fullParts[i]) {
          return false;
        }
      }

      // Check if the last part looks like a resolution (contains 'x' and numbers)
      var thumbLast = thumbParts[thumbParts.length - 1];
      var fullLast = fullParts[fullParts.length - 1];

      // Both should contain 'x' and be numeric patterns
      if (thumbLast.includes('x') && fullLast.includes('x')) {
        // Extract numbers before and after 'x'
        var thumbRes = thumbLast.split('x');
        var fullRes = fullLast.split('x');

        if (thumbRes.length === 2 && fullRes.length === 2) {
          // Check if both parts are numeric
          var thumbW = parseInt(thumbRes[0]);
          var thumbH = parseInt(thumbRes[1]);
          var fullW = parseInt(fullRes[0]);
          var fullH = parseInt(fullRes[1]);

          if (!isNaN(thumbW) && !isNaN(thumbH) && !isNaN(fullW) && !isNaN(fullH)) {
            return true; // They match the resolution pattern
          }
        }
      }

      return false;
    } catch (_) {
      return false;
    }
  }

  /**
   * Escape HTML special characters in a string.
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  /**
   * Create a DOM element with optional class and text content.
   * @param {string} tag
   * @param {string} [className]
   * @param {string} [text]
   * @returns {Element}
   */
  function createEl(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = String(text);
    return el;
  }

  /**
   * Format a number to a fixed number of decimals.
   * @param {number} num
   * @param {number} decimals
   * @returns {string}
   */
  function formatNumber(num, decimals) {
    return Number(num).toFixed(decimals);
  }

  /**
   * Format seconds as HH:MM:SS string.
   * @param {number} seconds
   * @returns {string}
   */
  function formatTime(seconds) {
    seconds = Math.max(0, Math.round(seconds));
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = seconds % 60;
    var hh = h.toString().padStart(2, '0');
    var mm = m.toString().padStart(2, '0');
    var ss = s.toString().padStart(2, '0');
    return hh + ':' + mm + ':' + ss;
  }

  /**
   * Extract filename from a URL string.
   * @param {string} url
   * @returns {string}
   */
  function extractFilenameFromUrl(url) {
    if (typeof url !== 'string' || !url) return '';
    try {
      var cleaned = url.split('?')[0].split('#')[0];
      var name = cleaned.split('/').pop() || '';
      return decodeURIComponent(name);
    } catch (_) {
      return '';
    }
  }

  /**
   * Return trimmed string if value is not null/undefined, else empty string.
   * @param {*} value
   * @returns {string}
   */
  function nonEmptyText(value) {
    if (value == null) return '';
    var text = String(value).trim();
    return text;
  }

  /**
   * Set textContent of element if changed.
   * @param {Element} el
   * @param {string} nextText
   */
  function setTextIfChanged(el, nextText) {
    if (!el) return;
    var text = String(nextText);
    if (el.textContent !== text) {
      el.textContent = text;
    }
  }

  /**
   * Linear interpolation between a and b by t.
   * @param {number} a
   * @param {number} b
   * @param {number} t
   * @returns {number}
   */
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /**
   * Cubic ease-in-out interpolation for t in [0,1].
   * @param {number} t
   * @returns {number}
   */
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  /**
   * Calculate bearing in degrees from p1 to p2.
   * @param {Array<number>} p1 [lon, lat]
   * @param {Array<number>} p2 [lon, lat]
   * @returns {number}
   */
  function bearingBetween(p1, p2) {
    var lon1 = (p1[0] * Math.PI) / 180;
    var lat1 = (p1[1] * Math.PI) / 180;
    var lon2 = (p2[0] * Math.PI) / 180;
    var lat2 = (p2[1] * Math.PI) / 180;
    var y = Math.sin(lon2 - lon1) * Math.cos(lat2);
    var x =
      Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
    var brng = (Math.atan2(y, x) * 180) / Math.PI;
    return (brng + 360) % 360;
  }

  /**
   * Compute the shortest angle delta between two degrees.
   * @param {number} fromDeg
   * @param {number} toDeg
   * @returns {number}
   */
  function shortestAngleDelta(fromDeg, toDeg) {
    var delta = ((toDeg - fromDeg + 540) % 360) - 180;
    return delta;
  }

  /**
   * Normalize angle to [0, 360) degrees.
   * @param {number} deg
   * @returns {number}
   */
  function normalizeAngle(deg) {
    return ((deg % 360) + 360) % 360;
  }

  /**
   * Calculate haversine distance in meters between two [lon, lat] points.
   * @param {Array<number>} a
   * @param {Array<number>} b
   * @returns {number}
   */
  function haversineMeters(a, b) {
    var R = 6371000;
    var dLat = ((b[1] - a[1]) * Math.PI) / 180;
    var dLon = ((b[0] - a[0]) * Math.PI) / 180;
    var lat1 = (a[1] * Math.PI) / 180;
    var lat2 = (b[1] * Math.PI) / 180;
    var sinDLat = Math.sin(dLat / 2);
    var sinDLon = Math.sin(dLon / 2);
    var c = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
    var d = 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
    return R * d;
  }

  // New: find nearest route vertex index to a lon/lat point (fast and robust enough for our use)
  /**
   * Find nearest route vertex index to a lon/lat point.
   * @param {Array<number>} pointLonLat
   * @param {Array<Array<number>>} coords
   * @returns {number}
   */
  function nearestCoordIndex(pointLonLat, coords) {
    var bestI = 0,
      bestD = Infinity;
    for (var i = 0; i < coords.length; i++) {
      var c = coords[i];
      var d = haversineMeters([c[0], c[1]], pointLonLat);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    return bestI;
  }

  // Faster nearest-index approximation for large tracks.
  // Uses coarse sampling first, then local refinement around the best coarse hit.
  /**
   * Fast nearest-index approximation for large tracks.
   * @param {Array<number>} pointLonLat
   * @param {Array<Array<number>>} coords
   * @returns {number}
   */
  function nearestCoordIndexFast(pointLonLat, coords) {
    if (!Array.isArray(coords) || coords.length === 0) return 0;
    if (coords.length <= 1200) return nearestCoordIndex(pointLonLat, coords);

    var stride = Math.max(8, Math.floor(coords.length / 400));
    var coarseBestI = 0;
    var coarseBestD = Infinity;
    for (var i = 0; i < coords.length; i += stride) {
      var c0 = coords[i];
      var d0 = haversineMeters([c0[0], c0[1]], pointLonLat);
      if (d0 < coarseBestD) {
        coarseBestD = d0;
        coarseBestI = i;
      }
    }

    var from = Math.max(0, coarseBestI - stride * 2);
    var to = Math.min(coords.length - 1, coarseBestI + stride * 2);
    var bestI = coarseBestI;
    var bestD = coarseBestD;
    for (var j = from; j <= to; j++) {
      var c1 = coords[j];
      var d1 = haversineMeters([c1[0], c1[1]], pointLonLat);
      if (d1 < bestD) {
        bestD = d1;
        bestI = j;
      }
    }
    return bestI;
  }

  // Douglas–Peucker simplification (iterative) that returns kept indices
  /**
   * Douglas–Peucker simplification (iterative) that returns kept indices.
   * @param {Array<Array<number>>} points
   * @param {number} sqTol
   * @returns {Object}
   */
  function simplifyDouglasPeucker(points, sqTol) {
    var len = points.length;
    if (len <= 2) {
      return { indices: [0, len - 1] };
    }
    var markers = new Uint8Array(len);
    var first = 0;
    var last = len - 1;
    var stack = [first, last];
    markers[first] = 1;
    markers[last] = 1;

    function getSqSegDist(p, p1, p2) {
      var x = p1[0];
      var y = p1[1];
      var dx = p2[0] - x;
      var dy = p2[1] - y;
      if (dx !== 0 || dy !== 0) {
        var t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
        if (t > 1) {
          x = p2[0];
          y = p2[1];
        } else if (t > 0) {
          x += dx * t;
          y += dy * t;
        }
      }
      dx = p[0] - x;
      dy = p[1] - y;
      return dx * dx + dy * dy;
    }

    while (stack.length) {
      last = stack.pop();
      first = stack.pop();
      var maxSqDist = 0;
      var index = -1;
      for (var i = first + 1; i < last; i++) {
        var sqDist = getSqSegDist(points[i], points[first], points[last]);
        if (sqDist > maxSqDist) {
          index = i;
          maxSqDist = sqDist;
        }
      }
      if (maxSqDist > sqTol && index !== -1) {
        markers[index] = 1;
        stack.push(first, index);
        stack.push(index, last);
      }
    }

    var out = [];
    for (var j = 0; j < len; j++) {
      if (markers[j]) out.push(j);
    }
    return { indices: out };
  }

  /**
   * Heuristically choose squared tolerance for Douglas–Peucker to hit target count.
   * @param {Array<Array<number>>} points
   * @param {number} targetCount
   * @returns {number}
   */
  function chooseTolerance(points, targetCount) {
    // heuristic range based on bbox diagonal
    var minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    var diag = Math.hypot(maxX - minX, maxY - minY);
    var low = 0,
      high = diag * 0.01; // start small; increase if still too many
    var bestTol = high;
    for (var iter = 0; iter < 10; iter++) {
      var mid = (low + high) / 2;
      var res = simplifyDouglasPeucker(points, mid * mid);
      if (res.indices.length > targetCount) {
        low = mid; // need more tolerance
      } else {
        bestTol = mid;
        high = mid;
      }
    }
    return bestTol * bestTol; // return squared tolerance
  }

  /**
   * Returns default OSM raster style URL.
   * @returns {string}
   */
  function buildOSMRasterStyle() {
    return 'https://api.maptiler.com/maps/base-v4/style.json?key=yuGDmIlURzez57sC1sod';
  }

  /**
   * Build and return the main player layout for a container.
   * @param {Element} container
   * @param {Object} FGPX
   * @returns {Object}
   */
  function buildLayout(container, FGPX) {
    FGPX = FGPX || window.FGPX;
    container.innerHTML = '';
    var spinner = createEl('div', 'fgpx-spinner');
    spinner.innerHTML = '<div class="fgpx-spinner-inner"></div>';
    var error = createEl('div', 'fgpx-error');
    var mapEl = createEl('div', 'fgpx-map');
    var controls = createEl('div', 'fgpx-controls');
    var left = createEl('div', 'fgpx-controls-left');
    var right = createEl('div', 'fgpx-controls-right');
    var I18N = window.FGPX && FGPX.i18n ? FGPX.i18n : {};
    var btnPlay = createEl('button', 'fgpx-btn fgpx-btn-primary', '');
    var btnPause = createEl('button', 'fgpx-btn', '');
    var btnRestart = createEl('button', 'fgpx-btn', '');
    var btnRecord = createEl('button', 'fgpx-btn fgpx-btn-record', '');
    var btnWeather = createEl('button', 'fgpx-btn fgpx-btn-weather', '');
    var btnTemperature = createEl('button', 'fgpx-btn fgpx-btn-temperature', '');
    var btnWind = createEl('button', 'fgpx-btn fgpx-btn-wind', '');
    var btnDayNight = createEl('button', 'fgpx-btn fgpx-btn-daynight', '');
    try {
      // Force text presentation (avoid emoji image replacement) using Variation Selector-15 (\uFE0E)
      var playLabel = I18N.play || 'Play';
      btnPlay.textContent = '▶\uFE0E ' + playLabel;
      btnPlay.setAttribute('aria-label', playLabel);
      btnPlay.setAttribute('title', playLabel);
      btnPause.textContent = '❚❚';
      btnPause.setAttribute('aria-label', I18N.pause || 'Pause');
      btnPause.setAttribute('title', I18N.pause || 'Pause');
      btnRestart.textContent = '↺';
      btnRestart.setAttribute('aria-label', I18N.restart || 'Restart');
      btnRestart.setAttribute('title', I18N.restart || 'Restart');
      btnRecord.textContent = '⏺';
      btnRecord.setAttribute('aria-label', I18N.record || 'Record Video');
      btnRecord.setAttribute('title', I18N.record || 'Record Video');
      btnWeather.textContent = '🌦';
      btnWeather.setAttribute('aria-label', 'Toggle Weather Overlay (Rain/Snow/Fog/Clouds)');
      btnWeather.setAttribute('title', 'Toggle Weather Overlay (Rain/Snow/Fog/Clouds)');
      btnTemperature.textContent = '🌡';
      btnTemperature.setAttribute('aria-label', 'Toggle Temperature Overlay');
      btnTemperature.setAttribute('title', 'Toggle Temperature Overlay');
      btnWind.textContent = '💨';
      btnWind.setAttribute('aria-label', 'Toggle Wind Overlay');
      btnWind.setAttribute('title', 'Toggle Wind Overlay');
      btnDayNight.textContent = '🌙';
      btnDayNight.setAttribute('aria-label', 'Toggle Day/Night Overlay');
      btnDayNight.setAttribute('title', 'Toggle Day/Night Overlay');
    } catch (_) {}
    var speedSel = createEl('select', 'fgpx-select');
    ['1x', '10x', '25x', '50x', '100x', '250x'].forEach(function (lab) {
      var opt = createEl('option');
      opt.value = lab.replace('x', '');
      opt.textContent = lab;
      speedSel.appendChild(opt);
    });
    try {
      speedSel.value =
        window.FGPX && isFinite(Number(FGPX.defaultSpeed))
          ? String(Number(FGPX.defaultSpeed))
          : '25';
    } catch (e) {
      speedSel.value = '25';
    }
    var progressWrap = createEl('div', 'fgpx-progress');
    var progressBar = createEl('div', 'fgpx-progress-bar');
    progressWrap.appendChild(progressBar);
    left.appendChild(btnPlay);
    left.appendChild(btnPause);
    left.appendChild(btnRestart);
    // Show video record button unless explicitly hidden via query param.
    if (FGPX.videoRecordingVisible !== false) {
      left.appendChild(btnRecord);
    }
    // Show weather buttons for real weather or admin-enabled debug weather data.
    if (window.FGPX && (FGPX.weatherEnabled || FGPX.debugWeatherData)) {
      var isCompactViewport = window.innerWidth <= 680;
      DBG.log('Weather button visibility check:', {
        weatherEnabled: FGPX.weatherEnabled,
        debugWeatherData: !!FGPX.debugWeatherData,
        windowWidth: window.innerWidth,
        isCompactViewport: isCompactViewport,
        hasTouch: 'ontouchstart' in window,
        maxTouchPoints: navigator.maxTouchPoints,
      });
      if (!isCompactViewport) {
        // Individual buttons can be suppressed via query params (default visible).
        left.appendChild(btnWeather);
        if (FGPX.weatherTemperatureVisible !== false) {
          left.appendChild(btnTemperature);
        }
        if (FGPX.weatherWindVisible !== false) {
          left.appendChild(btnWind);
        }
        DBG.log('Weather buttons added to UI');
      } else {
        DBG.log('Weather buttons hidden due to compact viewport');
      }
    } else {
      DBG.log('Weather buttons not added:', {
        fgpxExists: !!window.FGPX,
        weatherEnabled: !!(window.FGPX && FGPX.weatherEnabled),
      });
    }
    // Add day/night button if enabled (separate from weather condition)
    if (window.FGPX && FGPX.daynightMapEnabled) {
      var isCompactViewport = window.innerWidth <= 680;
      if (!isCompactViewport) {
        left.appendChild(btnDayNight);
      }
    }
    right.appendChild(createEl('span', 'fgpx-speed-label', I18N.speed || 'Speed'));
    right.appendChild(speedSel);
    if (
      window.FGPX &&
      FGPX.gpxDownloadUrl &&
      FGPX.gpxDownloadNonce &&
      FGPX.gpxDownloadVisible !== false
    ) {
      var btnDownload = document.createElement('button');
      btnDownload.type = 'button';
      btnDownload.className = 'fgpx-btn';
      btnDownload.textContent = '\u2B07\uFE0E'; // ⬇ without emoji variation
      btnDownload.setAttribute('title', 'Download GPX');
      btnDownload.setAttribute('aria-label', 'Download GPX');
      btnDownload.addEventListener('click', function (e) {
        e.preventDefault();
        var endpoint = String(FGPX.gpxDownloadUrl || '');
        var nonce = String(FGPX.gpxDownloadNonce || '');
        var downloadTrackId = String(container.getAttribute('data-track-id') || '');
        if (!endpoint || !nonce || !downloadTrackId) {
          return;
        }

        var form = document.createElement('form');
        form.method = 'POST';
        form.action = endpoint;
        form.style.display = 'none';

        function appendField(name, value) {
          var input = document.createElement('input');
          input.type = 'hidden';
          input.name = name;
          input.value = value;
          form.appendChild(input);
        }

        appendField('action', 'fgpx_download_gpx');
        appendField('id', downloadTrackId);
        appendField('nonce', nonce);

        document.body.appendChild(form);
        form.submit();
        document.body.removeChild(form);
      });
      right.appendChild(btnDownload);
    }
    controls.appendChild(left);
    controls.appendChild(progressWrap);
    controls.appendChild(right);

    var statsChart = createEl('div', 'fgpx-stats-chart');
    var stats = createEl('div', 'fgpx-stats');
    var statDist = createEl('div', 'fgpx-stat');
    var statTime = createEl('div', 'fgpx-stat');
    var statAvg = createEl('div', 'fgpx-stat');
    var statGain = createEl('div', 'fgpx-stat');
    stats.appendChild(statDist);
    stats.appendChild(statTime);
    stats.appendChild(statAvg);
    stats.appendChild(statGain);

    // Tab variables
    var tabElevation,
      tabBiometrics,
      tabTemperature,
      tabPower,
      tabPowerZones,
      tabWindImpact,
      tabWindRose,
      tabAll,
      tabWeatherGrade,
      tabMedia,
      tabWeatherOverview;

    // Show no data message in chart area (will be defined in startPlayer with proper chart reference)
    // No global no-data handler; keep it instance-scoped inside startPlayer.

    // Tab switching functionality (will be defined globally in startPlayer with proper variable references)
    // var switchChartTab = null; // Removed - will be defined globally in startPlayer

    // Chart tabs container
    var chartTabs = createEl('div', 'fgpx-chart-tabs');
    chartTabs.style.cssText =
      'display:flex;border-bottom:1px solid #ddd;background:#f8f9fa;margin-bottom:0';
    var chartTabsHint = createEl('div', 'fgpx-chart-tabs-hint');
    chartTabsHint.textContent = I18N.swipeTabsHint || 'Swipe to see more tabs';
    chartTabsHint.setAttribute('aria-hidden', 'true');

    // Chart legend controls (for All Data tab)
    var chartLegend = createEl('div', 'fgpx-chart-legend');
    chartLegend.style.cssText =
      'display:none;padding:8px 12px;background:#f8f9fa;border-bottom:1px solid #ddd;font-size:12px;';
    var legendTitle = createEl('span');
    legendTitle.textContent = 'Toggle data series: ';
    legendTitle.style.cssText = 'margin-right:12px;font-weight:600;color:#333;';
    chartLegend.appendChild(legendTitle);
    tabElevation = createEl('button', 'fgpx-chart-tab fgpx-chart-tab-active');
    tabElevation.textContent = 'Elevation + Speed';
    tabBiometrics = createEl('button', 'fgpx-chart-tab');
    tabBiometrics.textContent = 'Heart Rate + Cadence';
    tabTemperature = createEl('button', 'fgpx-chart-tab');
    tabTemperature.textContent = 'Temperature';
    tabPower = createEl('button', 'fgpx-chart-tab');
    tabPower.textContent = 'Power';
    tabPowerZones = createEl('button', 'fgpx-chart-tab');
    tabPowerZones.textContent = 'Power Zones';
    tabWindImpact = createEl('button', 'fgpx-chart-tab');
    tabWindImpact.textContent = 'Wind Impact';
    tabWindRose = createEl('button', 'fgpx-chart-tab');
    tabWindRose.textContent = 'Wind Directions';
    tabAll = createEl('button', 'fgpx-chart-tab');
    tabAll.textContent = 'All Data';
    tabWeatherGrade = createEl('button', 'fgpx-chart-tab');
    tabWeatherGrade.textContent = I18N.simulationTab || 'Simulation';
    tabMedia = createEl('button', 'fgpx-chart-tab');
    tabMedia.textContent = 'Media';
    tabWeatherOverview = createEl('button', 'fgpx-chart-tab');
    tabWeatherOverview.textContent = I18N.weatherOverviewTab || 'Weather';
    chartTabs.appendChild(tabElevation);
    chartTabs.appendChild(tabBiometrics);
    chartTabs.appendChild(tabTemperature);
    chartTabs.appendChild(tabPower);
    chartTabs.appendChild(tabPowerZones);
    chartTabs.appendChild(tabWindImpact);
    chartTabs.appendChild(tabWindRose);
    chartTabs.appendChild(tabAll);
    chartTabs.appendChild(tabWeatherGrade);
    chartTabs.appendChild(tabWeatherOverview);
    // Only add media tab if photos are enabled
    if (FGPX.photosEnabled) {
      chartTabs.appendChild(tabMedia);
    }

    // Queue tab requests until startPlayer wires switchChartTab in the map load path.
    // This avoids no-op clicks when users switch tabs immediately after the UI renders.
    container.__fgpxTabsReady = false;
    function queueTabUntilReady(tabType) {
      return function () {
        if (container.__fgpxTabsReady && typeof container.__fgpxSwitchChartTab === 'function') {
          container.__fgpxSwitchChartTab(tabType);
          return;
        }
        container.__fgpxPendingTabType = tabType;
      };
    }
    tabElevation.addEventListener('click', queueTabUntilReady('elevation'));
    tabBiometrics.addEventListener('click', queueTabUntilReady('biometrics'));
    tabTemperature.addEventListener('click', queueTabUntilReady('temperature'));
    tabPower.addEventListener('click', queueTabUntilReady('power'));
    tabPowerZones.addEventListener('click', queueTabUntilReady('powerzones'));
    tabWindImpact.addEventListener('click', queueTabUntilReady('windimpact'));
    tabWindRose.addEventListener('click', queueTabUntilReady('windrose'));
    tabAll.addEventListener('click', queueTabUntilReady('all'));
    tabWeatherGrade.addEventListener('click', queueTabUntilReady('weathergrade'));
    tabWeatherOverview.addEventListener('click', queueTabUntilReady('weatheroverview'));
    if (FGPX.photosEnabled) {
      tabMedia.addEventListener('click', queueTabUntilReady('media'));
    }

    // Event listeners will be added in startPlayer after functions are defined

    var chartWrap = createEl('div', 'fgpx-chart-wrap');
    var canvas = createEl('canvas');
    chartWrap.appendChild(canvas);
    var mediaPanel = createEl('div', 'fgpx-media-panel');
    var weatherOverviewPanel = createEl('div', 'fgpx-weather-overview-panel');
    var weatherOverviewPlayhead = createEl('div', 'fgpx-weather-overview-playhead');
    var weatherOverviewLegend = createEl('div', 'fgpx-weather-legend fgpx-weather-overview-legend');
    weatherOverviewLegend.style.display = 'none';
    weatherOverviewPanel.appendChild(weatherOverviewPlayhead);
    statsChart.appendChild(stats);
    statsChart.appendChild(chartTabs);
    statsChart.appendChild(chartTabsHint);
    statsChart.appendChild(chartLegend);
    statsChart.appendChild(chartWrap);
    statsChart.appendChild(mediaPanel);
    statsChart.appendChild(weatherOverviewPanel);
    statsChart.appendChild(weatherOverviewLegend);

    container.appendChild(spinner);
    container.appendChild(error);
    container.appendChild(mapEl);
    container.appendChild(controls);
    // Charts panel hidden when chartsVisible === false (from query param).
    if (FGPX.chartsVisible !== false) {
      container.appendChild(statsChart);
    }

    return {
      spinner: spinner,
      error: error,
      mapEl: mapEl,
      controls: {
        btnPlay: btnPlay,
        btnPause: btnPause,
        btnRestart: btnRestart,
        btnRecord: btnRecord,
        btnWeather: btnWeather,
        btnTemperature: btnTemperature,
        btnWind: btnWind,
        btnDayNight: btnDayNight,
        speedSel: speedSel,
        progressBar: progressBar,
      },
      stats: { dist: statDist, time: statTime, avg: statAvg, gain: statGain },
      canvas: canvas,
      chartWrap: chartWrap,
      tabs: {
        tabElevation: tabElevation,
        tabBiometrics: tabBiometrics,
        tabTemperature: tabTemperature,
        tabPower: tabPower,
        tabPowerZones: tabPowerZones,
        tabWindImpact: tabWindImpact,
        tabWindRose: tabWindRose,
        tabAll: tabAll,
        tabWeatherGrade: tabWeatherGrade,
        tabMedia: tabMedia,
        tabWeatherOverview: tabWeatherOverview,
      },
      chartLegend: chartLegend,
      mediaPanel: mediaPanel,
      weatherOverviewPanel: weatherOverviewPanel,
      weatherOverviewPlayhead: weatherOverviewPlayhead,
      weatherOverviewLegend: weatherOverviewLegend,
    };
  }

  /**
   * Returns true if the given container element is currently in dark mode,
   * considering a forced data-fgpx-theme attribute first, then OS preference.
   */
  function isDarkMode(containerEl) {
    var attr = containerEl && containerEl.getAttribute('data-fgpx-theme');
    if (attr === 'dark') return true;
    if (attr === 'light') return false;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  /**
   * Parse player-control query parameters from the current URL.
   * Supports both regular search params (?key=val) and params after a hash (#track-1?key=val).
   * Returns only validated boolean overrides; unknown or invalid values are silently ignored.
   * Accepted param names (case-insensitive):
   *   fullscreen, videorecording, weather, temp, wind, daynight, charts, download
   * Truthy values: "1", "true", "yes", "on" → true
   * Falsy values:  "0", "false", "no",  "off" → false
   * Anything else → skipped (no-op, preserves existing config)
   *
   * @returns {Object} Map of camelCase config keys to booleans.
   */
  function parsePlayerQueryParams() {
    var result = {};
    try {
      // Collect raw query string from both ?search and any query-after-hash (#anchor?params)
      var rawSearch = '';
      try {
        rawSearch = window.location.search || '';
      } catch (_) {}
      var rawHash = '';
      try {
        rawHash = window.location.hash || '';
      } catch (_) {}
      // Extract query portion from hash (e.g. "#track-1?weather=1")
      var hashQuery = '';
      var hashQ = rawHash.indexOf('?');
      if (hashQ !== -1) {
        hashQuery = rawHash.slice(hashQ);
      }

      // Merge params: hash-query params take precedence over search params
      var combined = {};
      function parseInto(qs, target) {
        if (!qs || qs.length < 2) return;
        try {
          var usp = new URLSearchParams(qs);
          usp.forEach(function (val, key) {
            target[key.toLowerCase()] = val;
          });
        } catch (_) {
          // Fallback for environments without URLSearchParams
          var parts = qs.replace(/^\?/, '').split('&');
          for (var i = 0; i < parts.length; i++) {
            var pair = parts[i].split('=');
            if (pair.length >= 1 && pair[0]) {
              target[decodeURIComponent(pair[0]).toLowerCase()] =
                pair.length >= 2 ? decodeURIComponent(pair[1]) : '';
            }
          }
        }
      }
      parseInto(rawSearch, combined);
      parseInto(hashQuery, combined); // hash params win

      function parseBool(rawVal) {
        if (typeof rawVal === 'undefined') return undefined;
        var v = String(rawVal).toLowerCase().trim();
        if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
        if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
        return undefined; // unrecognised → ignore
      }

      // Map from URL param name → window.FGPX config key
      var paramMap = {
        fullscreen: 'requestFullscreenOnLoad',
        videorecording: 'videoRecordingVisible',
        weather: 'weatherEnabled',
        temp: 'weatherTemperatureVisible',
        wind: 'weatherWindVisible',
        daynight: 'daynightMapEnabled',
        charts: 'chartsVisible',
        download: 'gpxDownloadVisible',
      };

      for (var param in paramMap) {
        if (!Object.prototype.hasOwnProperty.call(paramMap, param)) continue;
        var parsed = parseBool(combined[param]);
        if (typeof parsed !== 'undefined') {
          result[paramMap[param]] = parsed;
        }
      }
    } catch (_) {}
    return result;
  }

  /**
   * Apply the configured theme mode to the container element.
   * Sets data-fgpx-theme="dark"|"light" or removes it (system mode).
   * For "auto" mode, also schedules a re-evaluation at the next boundary.
   */
  function applyTheme(el, cfg) {
    var mode = cfg.themeMode || 'system';
    if (mode === 'dark') {
      el.setAttribute('data-fgpx-theme', 'dark');
    } else if (mode === 'bright') {
      el.setAttribute('data-fgpx-theme', 'light');
    } else if (mode === 'auto') {
      var parseTime = function (hhmm) {
        var parts = (hhmm || '').split(':');
        return { h: parseInt(parts[0], 10) || 0, m: parseInt(parts[1], 10) || 0 };
      };
      var nowD = new Date();
      var nowMins = nowD.getHours() * 60 + nowD.getMinutes();
      var start = parseTime(cfg.themeAutoDarkStart || '22:00');
      var end = parseTime(cfg.themeAutoDarkEnd || '06:00');
      var startMins = start.h * 60 + start.m;
      var endMins = end.h * 60 + end.m;
      var inDark;
      if (startMins < endMins) {
        // Same-day span (e.g. 08:00–20:00)
        inDark = nowMins >= startMins && nowMins < endMins;
      } else {
        // Overnight span (e.g. 22:00–06:00)
        inDark = nowMins >= startMins || nowMins < endMins;
      }
      el.setAttribute('data-fgpx-theme', inDark ? 'dark' : 'light');
      // Schedule re-evaluation at the next boundary
      var nextBoundaryMins;
      if (inDark) {
        nextBoundaryMins = (endMins - nowMins + 1440) % 1440;
      } else {
        nextBoundaryMins = (startMins - nowMins + 1440) % 1440;
      }
      var msUntilNext = nextBoundaryMins * 60 * 1000 - nowD.getSeconds() * 1000;
      try {
        if (el.__fgpxThemeTimer) {
          clearTimeout(el.__fgpxThemeTimer);
        }
      } catch (_) {}
      el.__fgpxThemeTimer = setTimeout(function () {
        applyTheme(el, cfg);
      }, msUntilNext + 1000);
    } else {
      // system: remove attribute, let CSS @media handle it
      try {
        if (el.__fgpxThemeTimer) {
          clearTimeout(el.__fgpxThemeTimer);
          el.__fgpxThemeTimer = null;
        }
      } catch (_) {}
      el.removeAttribute('data-fgpx-theme');
    }
  }

  function initContainer(el) {
    if (
      !el ||
      typeof window.maplibregl === 'undefined' ||
      typeof window.Chart === 'undefined' ||
      typeof window.FGPX === 'undefined'
    ) {
      return;
    }
    if (el.getAttribute('data-fgpx-initialized') === '1') {
      return;
    }
    el.setAttribute('data-fgpx-initialized', '1');
    var instCfg = (window.FGPX.instances && window.FGPX.instances[el.id]) || {};
    // Query params have highest precedence: they override shortcode attrs and admin settings.
    // Parsed once per boot (cached on window) so multiple containers share the same parsed result.
    if (!window.FGPX._queryParamsParsed) {
      window.FGPX._queryParamsParsed = true;
      window.FGPX._queryParams = parsePlayerQueryParams();
    }
    var FGPX = Object.assign({}, window.FGPX, instCfg, window.FGPX._queryParams);
    el.__fgpxConfig = FGPX;
    if (DBG.isEnabled()) {
      console.log('[FGPX] initContainer', {
        id: el.id,
        instCfg: instCfg,
        mergedFGPX: FGPX,
      });
    }
    applyTheme(el, FGPX);

    var trackId = el.getAttribute('data-track-id');
    var style = el.getAttribute('data-style') || 'default';
    var styleUrl = el.getAttribute('data-style-url');

    var ui;
    try {
      ui = buildLayout(el, FGPX);
    } catch (e) {
      // Release guard so the container can be retried after a transient failure.
      el.removeAttribute('data-fgpx-initialized');
      DBG.warn('initContainer: buildLayout failed, guard released', e);
      return;
    }
    ui.spinner.style.display = 'flex';
    ui.error.style.display = 'none';

    // Determine photo enrichment strategy and build REST URL accordingly
    var hasGalleryStrategy = FGPX && FGPX.galleryPhotoStrategy === 'latest_embed';
    var preferAjaxFirst = !!(FGPX && FGPX.preferAjaxFirst);
    var restUrlParams = [];
    if (hasGalleryStrategy) {
      restUrlParams.push('strategy=latest_embed');
    } else if (window.FGPX && FGPX.hostPostId) {
      restUrlParams.push('host_post=' + encodeURIComponent(String(FGPX.hostPostId)));
    }
    var restUrl =
      String(window.FGPX.restUrl).replace(/\/$/, '') +
      '/track/' +
      encodeURIComponent(trackId) +
      (restUrlParams.length > 0 ? '?' + restUrlParams.join('&') : '');
    var ajaxUrl = window.FGPX && FGPX.ajaxUrl ? String(window.FGPX.ajaxUrl) : null;
    var fetchTimeoutMs = Math.max(
      3000,
      window.FGPX && isFinite(Number(FGPX.fetchTimeoutMs)) ? Number(FGPX.fetchTimeoutMs) : 15000
    );

    if (DBG.isEnabled()) {
      console.log('[FGPX] initContainer starting fetch', {
        trackId: trackId,
        preferAjaxFirst: preferAjaxFirst,
        restUrl: restUrl,
        ajaxUrl: ajaxUrl,
        hasGalleryStrategy: hasGalleryStrategy,
      });
    }

    function isContainerActive() {
      return !!(el && el.isConnected && document.contains(el));
    }

    // Frontend caching for better performance on large tracks
    function getCacheKey() {
      var hostPost = window.FGPX && FGPX.hostPostId ? String(FGPX.hostPostId) : '0';
      var simplify = window.FGPX && FGPX.backendSimplify ? '1' : '0';
      var target =
        window.FGPX && FGPX.backendSimplifyTarget ? String(FGPX.backendSimplifyTarget) : '1200';
      var strategy = hasGalleryStrategy ? 'latest_embed' : 'default';
      var photoCacheVersion =
        window.FGPX && FGPX.photoCacheVersion ? String(FGPX.photoCacheVersion) : '0';
      return (
        'fgpx_cache_v4_' +
        trackId +
        '_hp_' +
        hostPost +
        '_s_' +
        simplify +
        '_t_' +
        target +
        '_st_' +
        strategy +
        '_pcv_' +
        photoCacheVersion
      );
    }

    function getCachedData() {
      try {
        // latest_embed can change when embedding context changes; avoid stale local payloads.
        if (hasGalleryStrategy) return null;
        if (!window.localStorage) return null;
        var cacheKey = getCacheKey();
        var cached = localStorage.getItem(cacheKey);
        if (!cached) return null;

        var data = JSON.parse(cached);
        // Check if cache is still valid (24 hours)
        if (data.timestamp && Date.now() - data.timestamp < 86400000) {
          if (DBG.isEnabled()) {
            console.log('[FGPX] Using cached track data', {
              cacheKey: cacheKey,
              age: Date.now() - data.timestamp,
              photoCount: data.payload && data.payload.photos ? data.payload.photos.length : 0,
            });
          }
          return data.payload;
        } else {
          // Remove expired cache
          localStorage.removeItem(cacheKey);
          return null;
        }
      } catch (e) {
        DBG.warn('Cache read error:', e);
        return null;
      }
    }

    function setCachedData(payload) {
      try {
        if (hasGalleryStrategy) return;
        if (!window.localStorage) return;
        var cacheKey = getCacheKey();

        // Compress payload for storage if it's large
        var payloadStr = JSON.stringify(payload);
        var compressed = false;

        // Simple compression for large payloads (>50KB)
        if (payloadStr.length > 51200) {
          try {
            // Remove unnecessary precision from coordinates for storage
            var compressedPayload = compressPayloadForStorage(payload);
            var compressedStr = JSON.stringify(compressedPayload);
            if (compressedStr.length < payloadStr.length * 0.8) {
              payloadStr = compressedStr;
              compressed = true;
              DBG.log('Payload compressed for cache storage', {
                original:
                  payload.geojson && payload.geojson.coordinates
                    ? payload.geojson.coordinates.length
                    : 0,
                reduction:
                  Math.round((1 - compressedStr.length / JSON.stringify(payload).length) * 100) +
                  '%',
              });
            }
          } catch (compressionError) {
            DBG.warn('Payload compression failed, using original:', compressionError);
          }
        }

        var cacheData = {
          timestamp: Date.now(),
          payload: compressed ? JSON.parse(payloadStr) : payload,
          compressed: compressed,
        };
        localStorage.setItem(cacheKey, JSON.stringify(cacheData));
        DBG.log('Cached track data', {
          cacheKey: cacheKey,
          size: JSON.stringify(cacheData).length,
          compressed: compressed,
        });
      } catch (e) {
        DBG.warn('Cache write error:', e);
        // Clear old fgpx cache entries until enough space is freed (LRU eviction)
        if (e.name === 'QuotaExceededError') {
          try {
            var keysToRemove = [];
            for (var i = 0; i < localStorage.length; i++) {
              var key = localStorage.key(i);
              if (key && key.startsWith('fgpx_cache_')) {
                keysToRemove.push(key);
              }
            }
            for (var ri = 0; ri < keysToRemove.length; ri++) {
              localStorage.removeItem(keysToRemove[ri]);
              try {
                localStorage.setItem(cacheKey, JSON.stringify(cacheData));
                break; // Success — stop removing
              } catch (retryErr) {
                if (ri === keysToRemove.length - 1) {
                  DBG.warn('Cache still full after eviction:', retryErr);
                }
              }
            }
          } catch (clearError) {
            DBG.warn('Cache clear error:', clearError);
          }
        }
      }
    }

    /**
     * Compress payload data for localStorage storage
     *
     * Reduces coordinate precision to save storage space while maintaining
     * visual quality. This is essential for large GPX tracks that would
     * otherwise exceed localStorage limits.
     *
     * @param {Object} payload - The track data payload to compress
     * @param {Object} payload.geojson - GeoJSON track data
     * @param {Array<Array<number>>} payload.geojson.coordinates - Track coordinates [lon, lat, ele?]
     * @returns {Object} Compressed payload with reduced precision coordinates
     *
     * @example
     * // Original: [8.123456789, 47.987654321, 1234.56789]
     * // Compressed: [8.12346, 47.98765, 1234.6]
     */
    function compressPayloadForStorage(payload) {
      if (!payload || !payload.geojson || !payload.geojson.coordinates) {
        return payload;
      }

      var compressed =
        typeof structuredClone !== 'undefined'
          ? structuredClone(payload)
          : JSON.parse(JSON.stringify(payload)); // Deep clone

      // Reduce coordinate precision for storage (visual quality preserved)
      if (compressed.geojson.coordinates) {
        compressed.geojson.coordinates = compressed.geojson.coordinates.map(function (coord) {
          return [
            Math.round(coord[0] * 100000) / 100000, // ~1.1m precision at equator
            Math.round(coord[1] * 100000) / 100000, // ~1.1m precision at equator
            coord[2] ? Math.round(coord[2] * 10) / 10 : coord[2], // 0.1m elevation precision
          ].filter(function (val) {
            return val !== undefined;
          });
        });
      }

      return compressed;
    }

    /**
     * Fetch track data via WordPress REST API
     *
     * Primary method for retrieving track data. Uses WordPress nonce
     * for authentication and proper error handling.
     *
     * @returns {Promise<Object>} Promise resolving to track data JSON
     * @throws {Error} HTTP error if request fails
     */
    function fetchRest() {
      return fetchJsonWithTimeout(
        restUrl,
        { headers: { 'X-WP-Nonce': window.FGPX.nonce } },
        'REST'
      );
    }

    /**
     * Fetch track data via WordPress AJAX (fallback method)
     *
     * Fallback method when REST API is unavailable. Constructs AJAX URL
     * with proper parameters and handles host post context.
     *
     * @returns {Promise<Object>} Promise resolving to track data JSON
     * @throws {Error} If no AJAX URL available or HTTP error
     */
    function fetchAjax() {
      if (!ajaxUrl) return Promise.reject(new Error('No AJAX URL'));
      var u =
        ajaxUrl +
        (ajaxUrl.indexOf('?') === -1 ? '?' : '&') +
        'action=fgpx_track&id=' +
        encodeURIComponent(trackId);
      if (hasGalleryStrategy) {
        u += '&strategy=latest_embed';
      } else if (window.FGPX && FGPX.hostPostId) {
        u += '&host_post=' + encodeURIComponent(String(FGPX.hostPostId));
      }
      return fetchJsonWithTimeout(u, { credentials: 'same-origin' }, 'AJAX');
    }

    function fetchJsonWithTimeout(url, options, label) {
      var controller =
        typeof window.AbortController !== 'undefined' ? new window.AbortController() : null;
      var timeoutId = null;
      var reqOptions = Object.assign({}, options || {});
      if (controller) {
        reqOptions.signal = controller.signal;
      }
      if (controller) {
        timeoutId = setTimeout(function () {
          try {
            controller.abort();
          } catch (_) {}
        }, fetchTimeoutMs);
      }

      var fetchChain = fetch(url, reqOptions)
        .then(function (r) {
          if (!r.ok) {
            return r.text().then(function (raw) {
              var payload = null;
              if (raw) {
                try {
                  payload = JSON.parse(raw);
                } catch (_) {}
              }
              var msg =
                payload && typeof payload.message === 'string' && payload.message.trim()
                  ? payload.message.trim()
                  : 'HTTP ' + r.status;
              throw new Error(msg);
            });
          }
          return r.json();
        })
        .catch(function (err) {
          if (err && err.name === 'AbortError') {
            throw new Error(
              (label || 'Request') + ' timeout after ' + Math.round(fetchTimeoutMs / 1000) + 's'
            );
          }
          throw err;
        })
        .finally(function () {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
        });

      // For browsers without AbortController, use Promise.race as a timeout fallback
      if (!controller) {
        var raceTimeout = new Promise(function (_, reject) {
          timeoutId = setTimeout(function () {
            reject(
              new Error(
                (label || 'Request') + ' timeout after ' + Math.round(fetchTimeoutMs / 1000) + 's'
              )
            );
          }, fetchTimeoutMs);
        });
        return Promise.race([fetchChain, raceTimeout]).finally(function () {
          clearTimeout(timeoutId);
        });
      }
      return fetchChain;
    }

    // Try cache first, then fetch from server
    var cachedData = getCachedData();
    if (cachedData) {
      if (!isContainerActive()) return;
      ui.spinner.style.display = 'none';
      startPlayer(el, ui, cachedData, style, styleUrl, FGPX, isContainerActive);
    } else {
      var primaryFetch = preferAjaxFirst ? fetchAjax() : fetchRest();
      primaryFetch
        .catch(function (primaryErr) {
          DBG.warn(
            preferAjaxFirst
              ? 'AJAX request failed, trying REST fallback'
              : 'REST request failed, trying AJAX fallback',
            {
              trackId: trackId,
              strategy: hasGalleryStrategy ? 'latest_embed' : 'default',
              message: primaryErr && primaryErr.message ? primaryErr.message : String(primaryErr),
            }
          );
          return preferAjaxFirst ? fetchRest() : fetchAjax();
        })
        .then(function (json) {
          if (!isContainerActive()) return;
          if (DBG.isEnabled()) {
            console.log('[FGPX] Data received', {
              source: 'network',
              photoCount: json && json.photos ? json.photos.length : 0,
              photos:
                json && json.photos
                  ? json.photos.map(function (p) {
                      return { title: p.title, lat: p.lat, lon: p.lon, timestamp: p.timestamp };
                    })
                  : [],
              json: json,
            });
          }
          ui.spinner.style.display = 'none';
          // Cache the data for future use
          setCachedData(json);
          startPlayer(el, ui, json, style, styleUrl, FGPX, isContainerActive);
        })
        .catch(function (err) {
          if (!isContainerActive()) return;
          ui.spinner.style.display = 'none';
          ui.error.textContent =
            (window.FGPX && FGPX.i18n && FGPX.i18n.failedLoad
              ? FGPX.i18n.failedLoad
              : 'Failed to load track:') +
            ' ' +
            (err && err.message ? err.message : 'Unknown error');
          ui.error.style.display = 'block';
        });
    }
  }

  function startPlayer(root, ui, payload, style, styleUrl, FGPX, isContainerActive) {
    FGPX = FGPX || root.__fgpxConfig || window.FGPX || {};
    if (DBG.isEnabled()) {
      console.log('[FGPX] startPlayer starting', {
        globalFGPXExists: !!window.FGPX,
        localFGPXExists: typeof FGPX !== 'undefined',
      });
      if (typeof FGPX !== 'undefined') {
        console.log('[FGPX] local FGPX', FGPX);
      }
    }
    var trackId = root.getAttribute('data-track-id');
    DBG.log('Starting player for track', {
      trackId: trackId,
      hasPayload: !!payload,
      coordCount:
        payload && payload.geojson && payload.geojson.coordinates
          ? payload.geojson.coordinates.length
          : 0,
    });

    // Chart variables declared at function scope
    var currentChartTab = 'elevation';
    var chart = null;
    var createChart = null;
    var teardownCallbacks = [];
    var runtimeDestroyed = false;

    function registerTeardown(fn) {
      if (typeof fn === 'function') {
        teardownCallbacks.push(fn);
      }
    }

    function destroyRuntime() {
      if (runtimeDestroyed) return;
      runtimeDestroyed = true;
      try {
        setPlaying(false);
      } catch (_) {}
      while (teardownCallbacks.length > 0) {
        var teardown = teardownCallbacks.pop();
        try {
          teardown();
        } catch (_) {}
      }
      try {
        if (root && root.__fgpxThemeTimer) {
          clearTimeout(root.__fgpxThemeTimer);
          root.__fgpxThemeTimer = null;
        }
      } catch (_) {}
    }

    var coords =
      payload && payload.geojson && payload.geojson.coordinates ? payload.geojson.coordinates : [];
    var props =
      payload && payload.geojson && payload.geojson.properties ? payload.geojson.properties : {};
    var container = root.querySelector('.fgpx-container') || root;

    // Check if we have valid route data
    if (!coords || coords.length === 0) {
      DBG.warn('No route data available for track ID:', payload ? payload.id : 'unknown');

      // Show user-friendly message
      if (container) {
        container.innerHTML =
          '<div class="fgpx-no-data-message" style="padding: 20px; text-align: center; background: #f9f9f9; border: 1px solid #ddd; border-radius: 4px; margin: 20px 0;">' +
          '<h3 style="color: #666; margin: 0 0 10px 0;">No Route Data Available</h3>' +
          '<p style="color: #888; margin: 0;">This track does not have GPS coordinate data yet. ' +
          (payload && payload.name
            ? 'Upload a GPX file to \u201c' +
              escapeHtml(payload.name) +
              '\u201d to display the route.'
            : 'Please upload a GPX file to display the route.') +
          '</p></div>';
      }
      return;
    }
    var timestamps = Array.isArray(props.timestamps) ? props.timestamps : null; // ISO or null
    var cumDist = Array.isArray(props.cumulativeDistance) ? props.cumulativeDistance : null; // meters
    // Note: biometric data (heartRates, cadences, temperatures, powers) will be extracted after simulation
    var windSpeeds = Array.isArray(props.windSpeeds) ? props.windSpeeds : null; // km/h
    var windDirections = Array.isArray(props.windDirections) ? props.windDirections : null; // degrees
    var windImpacts = Array.isArray(props.windImpacts) ? props.windImpacts : null; // impact factor
    var bounds = Array.isArray(payload.bounds) ? payload.bounds : null; // [minLon,minLat,maxLon,maxLat]
    var stats = payload && payload.stats ? payload.stats : {};
    var photos = Array.isArray(payload.photos) ? payload.photos : [];
    var waypoints = Array.isArray(payload.waypoints) ? payload.waypoints : [];

    DBG.log('Track data loaded', {
      coords: coords.length,
      photos: photos.length,
      waypoints: waypoints.length,
      hasTimestamps: !!timestamps,
      serverSimplified: !!(payload && payload.simplified),
    });
    if (DBG.isEnabled()) {
      var wpPreview = [];
      for (var wpp = 0; wpp < Math.min(3, waypoints.length); wpp++) {
        var wp0 = waypoints[wpp] || {};
        wpPreview.push({
          name: (wp0.name || 'POI').toString(),
          distanceMeters: wp0.distanceMeters,
          lat: wp0.lat,
          lon: wp0.lon,
        });
      }
      DBG.log('Waypoint payload preview', { count: waypoints.length, sample: wpPreview });
    }

    if (!coords || coords.length < 2) {
      ui.error.textContent = 'No route data available.';
      ui.error.style.display = 'block';
      return;
    }

    // Optional resampling if very large (skip if backend already simplified)
    var serverSimplified = !!(payload && payload.simplified);
    var keptIndices = null;
    if (!serverSimplified && coords.length > 10000) {
      var pts = coords.map(function (c) {
        return [c[0], c[1]];
      });
      var sqTol = chooseTolerance(pts, 1500);
      var res = simplifyDouglasPeucker(pts, sqTol);
      keptIndices = res.indices;
      coords = keptIndices.map(function (idx) {
        return payload.geojson.coordinates[idx];
      });
      if (cumDist)
        cumDist = keptIndices.map(function (idx) {
          return props.cumulativeDistance[idx];
        });
      if (timestamps)
        timestamps = keptIndices.map(function (idx) {
          return props.timestamps[idx];
        });
    }

    // If cumulative distance missing, compute
    if (!cumDist || cumDist.length !== coords.length) {
      cumDist = new Array(coords.length);
      var acc = 0;
      cumDist[0] = 0;
      for (var i = 1; i < coords.length; i++) {
        acc += haversineMeters(coords[i - 1], coords[i]);
        cumDist[i] = acc;
      }
    }

    // --- Time / timestamp processing (added) ---
    var timeOffsets = null; // seconds from first valid timestamp (array parallel to coords)
    var movingTimeOffsets = null; // optional filtered version (fallback = timeOffsets)
    var totalDuration = null; // total moving time (seconds)
    var hasTimestamps = false;

    if (timestamps && Array.isArray(timestamps) && timestamps.length === coords.length) {
      try {
        // Find first valid timestamp as base
        var baseStr = null;
        for (var iTs0 = 0; iTs0 < timestamps.length; iTs0++) {
          if (timestamps[iTs0]) {
            baseStr = timestamps[iTs0];
            break;
          }
        }
        var baseMs = baseStr ? Date.parse(baseStr) : NaN;
        if (!isNaN(baseMs)) {
          timeOffsets = new Array(timestamps.length);
          var lastValidSec = 0;
          for (var iTs = 0; iTs < timestamps.length; iTs++) {
            var tsStr = timestamps[iTs];
            if (tsStr) {
              var ms = Date.parse(tsStr);
              if (!isNaN(ms)) {
                var sec = (ms - baseMs) / 1000;
                if (sec < 0) sec = 0;
                timeOffsets[iTs] = sec;
                lastValidSec = sec;
              } else {
                timeOffsets[iTs] = null;
              }
            } else {
              timeOffsets[iTs] = null;
            }
          }
          // Forward-fill null gaps (simple)
          var lastSeen = null;
          for (var f1 = 0; f1 < timeOffsets.length; f1++) {
            if (typeof timeOffsets[f1] === 'number') {
              lastSeen = timeOffsets[f1];
            } else if (lastSeen != null) {
              timeOffsets[f1] = lastSeen;
            } else {
              timeOffsets[f1] = 0;
            }
          }
          totalDuration = lastValidSec;
          hasTimestamps = isFinite(totalDuration) && totalDuration > 0.5;
          movingTimeOffsets = timeOffsets.slice(); // (future: could compress pauses)
        }
      } catch (e) {
        timeOffsets = null;
        movingTimeOffsets = null;
        totalDuration = null;
        hasTimestamps = false;
      }
    }

    // --- Elevation & speed extrema (added) ---
    var maxElevVal = -Infinity;
    var maxElevIdx = -1;
    var maxSpeedVal = 0; // m/s
    var maxSpeedIdx = -1;
    try {
      for (var ei = 0; ei < coords.length; ei++) {
        var elevVal = typeof coords[ei][2] === 'number' ? coords[ei][2] : null;
        if (elevVal != null && isFinite(elevVal) && elevVal > maxElevVal) {
          maxElevVal = elevVal;
          maxElevIdx = ei;
        }
      }
      if (hasTimestamps && timeOffsets && timeOffsets.length === coords.length) {
        for (var si = 1; si < coords.length; si++) {
          var dt = Math.max(1e-3, timeOffsets[si] - timeOffsets[si - 1]);
          if (!isFinite(dt) || dt <= 0) continue;
          var dd = Math.max(0, cumDist[si] - cumDist[si - 1]);
          var sp = dd / dt; // m/s
          if (sp > maxSpeedVal) {
            maxSpeedVal = sp;
            maxSpeedIdx = si;
          }
        }
      }
    } catch (e) {
      /* speed calculation error */
    }

    var photoOrderMode =
      window.FGPX && typeof FGPX.photoOrderMode === 'string'
        ? String(FGPX.photoOrderMode)
        : 'geo_first';
    if (photoOrderMode !== 'time_first' && photoOrderMode !== 'geo_first') {
      photoOrderMode = 'geo_first';
    }
    var photoQueueRotationEnabled = !!(
      FGPX &&
      (FGPX.photoQueueRotationEnabled === true || FGPX.photoQueueRotationEnabled === '1')
    );
    var trackStartTimestampMs = NaN;
    if (Array.isArray(timestamps) && timestamps.length > 0) {
      for (var tsi = 0; tsi < timestamps.length; tsi++) {
        if (timestamps[tsi] == null) continue;
        trackStartTimestampMs = Date.parse(timestamps[tsi]);
        if (!isNaN(trackStartTimestampMs)) break;
      }
    }

    function parsePhotoTimestampMs(ph) {
      if (!ph || !ph.timestamp) return NaN;
      var ms = Date.parse(ph.timestamp);
      return isNaN(ms) ? NaN : ms;
    }

    // Precompute per-photo route distance/timestamp metadata and normalize ordering.
    (function preparePhotos() {
      if (!Array.isArray(photos) || photos.length === 0) return;
      var unique = [];
      if (Array.isArray(cumDist) && cumDist.length === coords.length) {
        for (var i = 0; i < photos.length; i++) {
          var ph = photos[i];
          if (typeof ph.lat === 'number' && typeof ph.lon === 'number') {
            var idx = nearestCoordIndex([ph.lon, ph.lat], coords);
            ph._idx = idx;
            ph._distAlong = cumDist[idx]; // meters along the route
            ph._timestampMs = parsePhotoTimestampMs(ph);
            unique.push(ph);
          } else {
            // no GPS → keep; will fallback to timestamp if needed
            ph._timestampMs = parsePhotoTimestampMs(ph);
            unique.push(ph);
          }
        }
        if (photoOrderMode === 'time_first') {
          unique.sort(function (a, b) {
            var ta =
              typeof a._timestampMs === 'number' && isFinite(a._timestampMs)
                ? a._timestampMs
                : Infinity;
            var tb =
              typeof b._timestampMs === 'number' && isFinite(b._timestampMs)
                ? b._timestampMs
                : Infinity;
            if (ta !== tb) return ta - tb;
            var ida = typeof a.id === 'number' ? a.id : Infinity;
            var idb = typeof b.id === 'number' ? b.id : Infinity;
            return ida - idb;
          });
        } else {
          // Ensure geo-cued photos trigger in correct order
          unique.sort(function (a, b) {
            var da = typeof a._distAlong === 'number' ? a._distAlong : Infinity;
            var db = typeof b._distAlong === 'number' ? b._distAlong : Infinity;
            return da - db;
          });
        }
      } else {
        // No route distance available → keep original list (will fall back to timestamp cues)
        unique = photos.slice();
        if (photoOrderMode === 'time_first') {
          unique.sort(function (a, b) {
            var ta = parsePhotoTimestampMs(a);
            var tb = parsePhotoTimestampMs(b);
            var sa = isNaN(ta) ? Infinity : ta;
            var sb = isNaN(tb) ? Infinity : tb;
            if (sa !== sb) return sa - sb;
            var ida = a && typeof a.id === 'number' ? a.id : Infinity;
            var idb = b && typeof b.id === 'number' ? b.id : Infinity;
            return ida - idb;
          });
        }
      }
      photos = unique;
    })();

    DBG.log('photos prepared', photos.length);

    // Helper: map a distance along the route to an interpolated lng/lat
    function positionAtDistance(d) {
      var lo = 0,
        hi = cumDist.length - 1;
      while (lo < hi) {
        var mid = (lo + hi) >>> 1;
        if (cumDist[mid] < d) lo = mid + 1;
        else hi = mid;
      }
      var idx = Math.max(1, lo);
      var d0 = cumDist[idx - 1],
        d1 = cumDist[idx];
      var t = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
      var p0 = coords[idx - 1],
        p1 = coords[idx];
      return [lerp(p0[0], p1[0], t), lerp(p0[1], p1[1], t)];
    }

    var totalDistance = cumDist[cumDist.length - 1]; // meters

    // --- Privacy window (trim playback start/end by distance) ---
    var privacyEnabled = !!(window.FGPX && FGPX.privacyEnabled);
    var privacyMeters = Math.max(
      0,
      (window.FGPX && isFinite(Number(FGPX.privacyKm)) ? Number(FGPX.privacyKm) : 3) * 1000
    );
    var photoMaxDistanceMeters = Math.max(
      1,
      window.FGPX && isFinite(Number(FGPX.photoMaxDistance)) ? Number(FGPX.photoMaxDistance) : 100
    );
    var privacyStartD = 0;
    var privacyEndD = totalDistance;
    if (privacyEnabled && privacyMeters > 0) {
      privacyStartD = Math.min(totalDistance, privacyMeters);
      privacyEndD = Math.max(privacyStartD, totalDistance - privacyMeters);
      if (privacyEndD - privacyStartD < 10) {
        privacyEnabled = false;
        privacyStartD = 0;
        privacyEndD = totalDistance;
      }
    }
    var privacyStartP = privacyStartD / totalDistance;
    var privacyEndP = privacyEndD / totalDistance;
    var dayNightOverlayState = null;
    var progressLineCooldown = 0;
    var progressLastDistance = privacyEnabled ? privacyStartD : 0;
    var progressNeedLineInit = true;
    var progressSegments = [];

    // Compute initial bounds (privacy-trimmed if enabled) BEFORE map creation so we avoid a visible re-fit flash
    var fullBounds =
      Array.isArray(bounds) && bounds.length === 4
        ? [
            [bounds[0], bounds[1]],
            [bounds[2], bounds[3]],
          ]
        : boundsFromCoords(coords);

    // Derive innerBounds (privacy window) early (duplicated logic from later; kept minimal)
    var innerBounds = null;
    if (privacyEnabled && (privacyStartD > 0 || privacyEndD < totalDistance)) {
      try {
        var p0_priv = positionAtDistance(privacyStartD);
        var p1_priv = positionAtDistance(privacyEndD);
        var loIB = 0,
          hiIB = cumDist.length - 1;
        while (loIB < hiIB) {
          var midIB = (loIB + hiIB) >>> 1;
          if (cumDist[midIB] < privacyStartD) loIB = midIB + 1;
          else hiIB = midIB;
        }
        var startIdxIB = Math.max(0, loIB - 1);
        loIB = 0;
        hiIB = cumDist.length - 1;
        while (loIB < hiIB) {
          var midIB2 = (loIB + hiIB) >>> 1;
          if (cumDist[midIB2] < privacyEndD) loIB = midIB2 + 1;
          else hiIB = midIB2;
        }
        var endIdxIB = Math.max(startIdxIB + 1, loIB);
        var segIB = coords.slice(startIdxIB, endIdxIB + 1).map(function (c) {
          return c.slice(0, 2);
        });
        if (segIB.length > 0) {
          segIB[0] = p0_priv.slice(0, 2);
          segIB[segIB.length - 1] = p1_priv.slice(0, 2);
        }
        innerBounds = boundsFromCoords(segIB);
      } catch (e) {
        innerBounds = null;
      }
    }
    var initialBounds = innerBounds || fullBounds;

    // --- Map creation (use bounds to prevent initial zoom flash) ---
    var inlineStyle = null;
    try {
      if (window.FGPX && typeof FGPX.styleJson === 'string' && FGPX.styleJson.trim() !== '') {
        inlineStyle = JSON.parse(FGPX.styleJson);
      }
    } catch (e) {
      DBG.warn('Failed to parse inline style JSON; falling back to default.', e);
      inlineStyle = null;
    }

    // Robust default zoom parsing (accept numbers and numeric strings)
    var defaultZoomSetting =
      window.FGPX && isFinite(Number(FGPX.defaultZoom)) ? Number(FGPX.defaultZoom) : 11;

    // Style resolution: inline JSON takes precedence, then remote URL, then default base style fallback
    // (Backward compat: 'vector' → check URL; 'raster' → use fallback)
    var styleMode = style;
    if (styleMode === 'vector') {
      styleMode = 'url';
    }
    if (styleMode === 'raster') {
      styleMode = 'default';
    }
    var initialStyle =
      inlineStyle || (styleMode === 'url' && styleUrl ? styleUrl : buildOSMRasterStyle());
    var selectorModeRaw = String(
      (window.FGPX && FGPX.mapSelectorDefault) || 'satellite'
    ).toLowerCase();
    var contoursEnabled = !window.FGPX || FGPX.contoursEnabled !== false;
    var contoursTilesUrl = String((window.FGPX && FGPX.contoursTilesUrl) || '');
    var contoursSourceLayer = String((window.FGPX && FGPX.contoursSourceLayer) || 'contour').trim();
    if (!contoursSourceLayer) {
      contoursSourceLayer = 'contour';
    }
    var satelliteLayerId = String((window.FGPX && FGPX.satelliteLayerId) || 'satellite').trim();
    if (!/^[A-Za-z0-9_:\.-]+$/.test(satelliteLayerId)) {
      satelliteLayerId = 'satellite';
    }
    var satelliteTilesUrl = String((window.FGPX && FGPX.satelliteTilesUrl) || '');
    var contoursColor = String((window.FGPX && FGPX.contoursColor) || '#ffffff');
    var contoursWidth =
      window.FGPX && isFinite(Number(FGPX.contoursWidth)) ? Number(FGPX.contoursWidth) : 1.2;
    var contoursOpacity =
      window.FGPX && isFinite(Number(FGPX.contoursOpacity)) ? Number(FGPX.contoursOpacity) : 0.75;
    var contoursMinZoom =
      window.FGPX && isFinite(Number(FGPX.contoursMinZoom)) ? Number(FGPX.contoursMinZoom) : 9;
    var contoursMaxZoom =
      window.FGPX && isFinite(Number(FGPX.contoursMaxZoom)) ? Number(FGPX.contoursMaxZoom) : 16;
    var selectorMode = selectorModeRaw;
    // Back-compat: old value 'basic_contours' maps to 'satellite_contours'
    if (selectorMode === 'basic_contours') {
      selectorMode = 'satellite_contours';
    }
    // 'basic' falls back to 'satellite'
    if (selectorMode === 'basic') {
      selectorMode = 'satellite';
    }
    if (selectorMode !== 'satellite' && selectorMode !== 'satellite_contours') {
      selectorMode = 'satellite';
    }

    // Prefetch master switch (default true if undefined)
    var prefetchEnabled = !(window.FGPX && FGPX.prefetchEnabled === false);

    try {
      if (prefetchEnabled && window.maplibregl && typeof window.maplibregl.prewarm === 'function') {
        window.maplibregl.prewarm();
      }
    } catch (_) {}

    // Replace {{API_KEY}} in any URL MapLibre fetches (covers tile sources, glyphs, sprites,
    // and remote style JSON tile templates that PHP could not see at render time).
    var resolvedApiKey =
      FGPX && typeof FGPX.resolvedApiKey === 'string' && FGPX.resolvedApiKey !== ''
        ? FGPX.resolvedApiKey
        : null;
    var transformRequest = resolvedApiKey
      ? function (url) {
          if (typeof url === 'string' && url.indexOf('{{API_KEY}}') !== -1) {
            return { url: url.replace(/\{\{API_KEY\}\}/g, resolvedApiKey) };
          }
        }
      : undefined;

    function resolveTemplateUrl(url) {
      var raw = String(url || '');
      if (!raw) return '';
      if (raw.indexOf('{{API_KEY}}') !== -1) {
        if (!resolvedApiKey) return '';
        return raw.replace(/\{\{API_KEY\}\}/g, resolvedApiKey);
      }
      return raw;
    }

    var resolvedContoursTilesUrl = resolveTemplateUrl(contoursTilesUrl);
    var resolvedSatelliteTilesUrl = resolveTemplateUrl(satelliteTilesUrl);
    var contoursModeAvailable = contoursEnabled && resolvedContoursTilesUrl !== '';
    var i18nMapMode = window.FGPX && FGPX.i18n ? FGPX.i18n : {};
    if (!contoursModeAvailable && selectorMode === 'satellite_contours') {
      selectorMode = 'satellite';
    }

    var map = new window.maplibregl.Map({
      container: ui.mapEl,
      style: initialStyle,
      bounds: initialBounds, // sets initial camera to full (or privacy) route extent
      fitBoundsOptions: { padding: 40 }, // mimic later fitBounds padding
      pitch: window.FGPX && isFinite(Number(FGPX.defaultPitch)) ? Number(FGPX.defaultPitch) : 30,
      prefetchZoomDelta: prefetchEnabled ? 4 : 0,
      fadeDuration: 100,
      canvasContextAttributes: { antialias: false },
      refreshExpiredTiles: false,
      renderWorldCopies: false,
      maxTileCacheSize: prefetchEnabled ? 2048 : 512, // tighter cache when disabled
      crossSourceCollisions: false,
      cancelPendingTileRequestsWhileZooming: true,
      validateStyle: false,
      localIdeographFontFamily: 'sans-serif',
      transformRequest: transformRequest,
    });
    map.addControl(new window.maplibregl.NavigationControl({ showCompass: true }));
    // Only add fullscreen control on browsers that support the Fullscreen API
    var fullscreenApiSupported = !!(
      document.fullscreenEnabled ||
      document.webkitFullscreenEnabled ||
      document.mozFullScreenEnabled ||
      document.msFullscreenEnabled
    );
    if (fullscreenApiSupported) {
      map.addControl(new window.maplibregl.FullscreenControl({ container: root }));
    }
    // Auto-fullscreen: trigger on first user interaction if requested via query param.
    // Browsers block fullscreen without a user gesture, so we wait for the first click/touch.
    if (FGPX.requestFullscreenOnLoad) {
      var maximizeApplied = false;
      var fullscreenCompleted = false;
      var fullscreenInFlight = false;
      function applyMaximizeFallback() {
        if (maximizeApplied) return;
        maximizeApplied = true;
        root.classList.add('fgpx-maximized');
      }

      function clearMaximizeFallback() {
        maximizeApplied = false;
        root.classList.remove('fgpx-maximized');
      }

      function onFullscreenStateChange() {
        var fsEl =
          document.fullscreenElement ||
          document.webkitFullscreenElement ||
          document.mozFullScreenElement ||
          document.msFullscreenElement ||
          null;
        if (fsEl) {
          fullscreenCompleted = true;
          clearMaximizeFallback();
          removeFullscreenAutoHandlers();
        }
      }

      function removeFullscreenAutoHandlers() {
        document.removeEventListener('fullscreenchange', onFullscreenStateChange);
        document.removeEventListener('webkitfullscreenchange', onFullscreenStateChange);
        document.removeEventListener('mozfullscreenchange', onFullscreenStateChange);
        document.removeEventListener('MSFullscreenChange', onFullscreenStateChange);
        root.removeEventListener('click', onFirstGesture);
        root.removeEventListener('touchend', onFirstGesture);
      }

      document.addEventListener('fullscreenchange', onFullscreenStateChange);
      document.addEventListener('webkitfullscreenchange', onFullscreenStateChange);
      document.addEventListener('mozfullscreenchange', onFullscreenStateChange);
      document.addEventListener('MSFullscreenChange', onFullscreenStateChange);

      if (!fullscreenApiSupported) {
        // No Fullscreen API available: use CSS maximize fallback.
        // Keeps player usable on mobile/legacy browsers with a full-viewport experience.
        applyMaximizeFallback();
      } else {
        function onFirstGesture() {
          if (fullscreenCompleted || fullscreenInFlight) return;
          fullscreenInFlight = true;
          try {
            var target = root;
            if (typeof target.requestFullscreen === 'function') {
              target
                .requestFullscreen()
                .then(function () {
                  fullscreenCompleted = true;
                  clearMaximizeFallback();
                  removeFullscreenAutoHandlers();
                })
                .catch(function () {
                  applyMaximizeFallback();
                })
                .finally(function () {
                  fullscreenInFlight = false;
                });
              return;
            } else if (typeof target.webkitRequestFullscreen === 'function') {
              try {
                target.webkitRequestFullscreen();
              } catch (_) {
                applyMaximizeFallback();
              }
            } else if (typeof target.mozRequestFullScreen === 'function') {
              try {
                target.mozRequestFullScreen();
              } catch (_) {
                applyMaximizeFallback();
              }
            } else if (typeof target.msRequestFullscreen === 'function') {
              try {
                target.msRequestFullscreen();
              } catch (_) {
                applyMaximizeFallback();
              }
            } else {
              applyMaximizeFallback();
            }
          } catch (_) {
            applyMaximizeFallback();
          } finally {
            fullscreenInFlight = false;
          }
        }
        root.addEventListener('click', onFirstGesture, { passive: true });
        root.addEventListener('touchend', onFirstGesture, { passive: true });
      }

      registerTeardown(removeFullscreenAutoHandlers);
    }

    var contourSourceId = 'fgpx-contours-' + (root.id || 'fgpx');
    var contourLayerId = contourSourceId + '-line';
    var fallbackSatelliteSourceId = 'fgpx-satellite-' + (root.id || 'fgpx') + '-source';
    var fallbackSatelliteLayerId = 'fgpx-satellite-' + (root.id || 'fgpx') + '-layer';
    var mapModeControl = null;
    var mapModeControlButton = null;
    // no menu/options needed — button is now a plain contours toggle

    function setLayerVisibilityIfPresent(layerId, visibility) {
      try {
        if (!map.getLayer(layerId)) return;
        var current = map.getLayoutProperty(layerId, 'visibility');
        if (current !== visibility) {
          map.setLayoutProperty(layerId, 'visibility', visibility);
        }
      } catch (_) {}
    }

    function hasConfiguredSatelliteLayer() {
      try {
        return !!map.getLayer(satelliteLayerId);
      } catch (_) {
        return false;
      }
    }

    function hasSatelliteLayer() {
      try {
        return hasConfiguredSatelliteLayer() || !!map.getLayer(fallbackSatelliteLayerId);
      } catch (_) {
        return false;
      }
    }

    function ensureSatelliteLayer() {
      try {
        if (hasConfiguredSatelliteLayer() || map.getLayer(fallbackSatelliteLayerId)) {
          return true;
        }
        if (!resolvedSatelliteTilesUrl) {
          return false;
        }
        if (!map.getSource(fallbackSatelliteSourceId)) {
          map.addSource(fallbackSatelliteSourceId, {
            type: 'raster',
            tiles: [resolvedSatelliteTilesUrl],
            tileSize: 512,
            minzoom: 0,
            maxzoom: 22,
          });
        }
        if (!map.getLayer(fallbackSatelliteLayerId)) {
          var beforeLayer = map.getLayer('fgpx-route-line') ? 'fgpx-route-line' : undefined;
          map.addLayer(
            {
              id: fallbackSatelliteLayerId,
              type: 'raster',
              source: fallbackSatelliteSourceId,
              paint: { 'raster-fade-duration': 100 },
              layout: { visibility: 'none' },
            },
            beforeLayer
          );
        }
        return true;
      } catch (e) {
        DBG.warn('Failed to ensure fallback satellite layer', e);
        return false;
      }
    }

    function ensureContourLayer() {
      if (!contoursModeAvailable) return false;
      try {
        if (!map.getSource(contourSourceId)) {
          map.addSource(contourSourceId, {
            type: 'vector',
            tiles: [resolvedContoursTilesUrl],
            minzoom: Math.max(0, Math.min(22, contoursMinZoom)),
            maxzoom: Math.max(0, Math.min(22, contoursMaxZoom)),
          });
        }
        if (!map.getLayer(contourLayerId)) {
          var beforeLayerId = map.getLayer('fgpx-route-line') ? 'fgpx-route-line' : undefined;
          map.addLayer(
            {
              id: contourLayerId,
              type: 'line',
              source: contourSourceId,
              'source-layer': contoursSourceLayer,
              paint: {
                'line-color': contoursColor,
                'line-width': Math.max(0.1, Math.min(6, contoursWidth)),
                'line-opacity': Math.max(0.1, Math.min(1, contoursOpacity)),
              },
              layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
            },
            beforeLayerId
          );
        }
        return true;
      } catch (e) {
        DBG.warn('Failed to ensure contour layer', e);
        return false;
      }
    }

    function shouldShowMapModeControl() {
      return contoursModeAvailable || !!resolvedSatelliteTilesUrl || hasSatelliteLayer();
    }

    function syncMapModeControl() {
      if (!shouldShowMapModeControl()) {
        if (mapModeControl) {
          try {
            map.removeControl(mapModeControl);
          } catch (_) {}
          mapModeControl = null;
          mapModeControlButton = null;
        }
        if (selectorMode !== 'satellite') {
          selectorMode = 'satellite';
        }
        return;
      }

      if (!mapModeControl) {
        mapModeControl = new MapModeControl();
        map.addControl(mapModeControl, 'top-right');
      }

      if (mapModeControlButton) {
        var contoursOn = selectorMode === 'satellite_contours';
        var mapModeCtrlEl = mapModeControlButton.closest('.fgpx-map-mode-ctrl');
        mapModeControlButton.setAttribute('aria-pressed', contoursOn ? 'true' : 'false');
        if (contoursOn) {
          mapModeControlButton.classList.add('fgpx-map-mode-button-active');
          if (mapModeCtrlEl) {
            mapModeCtrlEl.classList.add('fgpx-map-mode-ctrl-active');
          }
        } else {
          mapModeControlButton.classList.remove('fgpx-map-mode-button-active');
          if (mapModeCtrlEl) {
            mapModeCtrlEl.classList.remove('fgpx-map-mode-ctrl-active');
          }
        }
        mapModeControlButton.setAttribute(
          'title',
          contoursOn
            ? (i18nMapMode.mapModeSatelliteContours || 'Satellite + Contours') +
                ' — click to disable contours'
            : (i18nMapMode.mapModeSatellite || 'Satellite') + ' — click to enable contours'
        );
      }
    }

    function applyMapSelectorMode(mode) {
      var nextMode = String(mode || 'satellite').toLowerCase();
      // Back-compat: old stored value 'basic_contours' → 'satellite_contours', 'basic' → 'satellite'
      if (nextMode === 'basic_contours') {
        nextMode = 'satellite_contours';
      }
      if (nextMode === 'basic') {
        nextMode = 'satellite';
      }
      if (nextMode !== 'satellite' && nextMode !== 'satellite_contours') {
        nextMode = 'satellite';
      }
      if (!contoursModeAvailable && nextMode === 'satellite_contours') {
        nextMode = 'satellite';
      }

      // Both satellite modes need the satellite layer
      ensureSatelliteLayer();
      var satAvailable = hasSatelliteLayer();
      if (!satAvailable) {
        nextMode = 'satellite'; // best we can do without satellite
      }

      var showSat = satAvailable;
      setLayerVisibilityIfPresent(satelliteLayerId, showSat ? 'visible' : 'none');
      setLayerVisibilityIfPresent(fallbackSatelliteLayerId, showSat ? 'visible' : 'none');

      if (nextMode === 'satellite_contours') {
        if (ensureContourLayer()) {
          setLayerVisibilityIfPresent(contourLayerId, 'visible');
        }
      } else {
        setLayerVisibilityIfPresent(contourLayerId, 'none');
      }

      selectorMode = nextMode;
      syncMapModeControl();
    }

    var MapModeControl = function () {};
    MapModeControl.prototype.onAdd = function (ctrlMap) {
      this._map = ctrlMap;
      var container = document.createElement('div');
      container.className = 'maplibregl-ctrl maplibregl-ctrl-group fgpx-map-mode-ctrl';

      function stopControlPropagation(ev) {
        if (!ev) return;
        ev.stopPropagation();
      }

      var stopEvents = [
        'mousedown',
        'mouseup',
        'click',
        'dblclick',
        'touchstart',
        'touchend',
        'pointerdown',
        'pointerup',
      ];
      for (var sei = 0; sei < stopEvents.length; sei++) {
        container.addEventListener(stopEvents[sei], stopControlPropagation);
      }

      var toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'fgpx-map-mode-button';
      var contoursOn = selectorMode === 'satellite_contours';
      toggleBtn.setAttribute('aria-pressed', contoursOn ? 'true' : 'false');
      toggleBtn.setAttribute('aria-label', i18nMapMode.mapModeLabel || 'Toggle contours');
      if (contoursOn) {
        toggleBtn.classList.add('fgpx-map-mode-button-active');
      }

      var icon = document.createElement('span');
      icon.className = 'fgpx-map-mode-button-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = 'C';
      toggleBtn.appendChild(icon);

      toggleBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        // Toggle between satellite and satellite_contours
        var next = selectorMode === 'satellite_contours' ? 'satellite' : 'satellite_contours';
        applyMapSelectorMode(next);
      });

      container.appendChild(toggleBtn);

      mapModeControlButton = toggleBtn;
      this._container = container;
      syncMapModeControl();
      return container;
    };
    MapModeControl.prototype.onRemove = function () {
      if (this._container && this._container.parentNode) {
        this._container.parentNode.removeChild(this._container);
      }
      mapModeControlButton = null;
      this._map = undefined;
    };
    // Do NOT call syncMapModeControl() here — the style hasn't loaded yet, so hasSatelliteLayer()
    // would always return false and the control would be incorrectly hidden for styles that embed
    // a satellite layer without a fallback tile URL. The map.once('load') path calls
    // applyMapSelectorMode() → syncMapModeControl() once actual layer info is available.

    DBG.log('map created', { prefetchEnabled: prefetchEnabled, defaultZoom: defaultZoomSetting });

    // Allow user-initiated zoom/rotate while playing by pausing our camera writes briefly
    var userInteracting = false;
    var userInteractTimer = null;
    function markUserInteracting() {
      userInteracting = true;
      if (userInteractTimer) {
        clearTimeout(userInteractTimer);
        userInteractTimer = null;
      }
    }
    function clearUserInteractingSoon() {
      if (userInteractTimer) {
        clearTimeout(userInteractTimer);
      }
      userInteractTimer = setTimeout(function () {
        userInteracting = false;
      }, 500);
    }
    try {
      map.on('movestart', function (e) {
        if (e && e.originalEvent) markUserInteracting();
      });
      map.on('moveend', function () {
        clearUserInteractingSoon();
      });
      map.on('zoomstart', function (e) {
        if (e && e.originalEvent) markUserInteracting();
      });
      map.on('zoomend', function () {
        clearUserInteractingSoon();
      });
      map.on('rotatestart', function (e) {
        if (e && e.originalEvent) markUserInteracting();
      });
      map.on('rotateend', function () {
        clearUserInteractingSoon();
      });
    } catch (_) {}
    // Ensure map resources (WebGL context, event listeners, DOM) are cleaned up on runtime destroy
    registerTeardown(function () {
      try {
        if (map && typeof map.remove === 'function') map.remove();
      } catch (_) {}
    });

    // URL style: constructor already applied styleUrl via initialStyle;
    // check once for buildings layer to adjust pitch
    if (!inlineStyle && styleMode === 'url' && styleUrl) {
      map.once('styledata', function () {
        try {
          var hasBuildings = false;
          var st = map.getStyle();
          var layers = st && st.layers ? st.layers : [];
          for (var i = 0; i < layers.length; i++) {
            var lid = layers[i] && layers[i].id ? String(layers[i].id) : '';
            if (lid.indexOf('building') !== -1) {
              hasBuildings = true;
              break;
            }
          }
          if (hasBuildings) {
            map.setPitch(65);
          }
        } catch (e2) {
          /* no-op */
        }
      });
    }

    // Prepare GeoJSON source for the route and a separate source for the moving point
    var routeData = {
      type: 'Feature',
      id: 'route',
      geometry: { type: 'LineString', coordinates: coords },
      properties: {},
    };
    var initialPoint = privacyEnabled ? positionAtDistance(privacyStartD) : coords[0].slice(0, 2);
    var pointData = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: initialPoint } }],
    };

    // Add error handling for tile loading failures
    var _tileErrCount = 0;
    var _tileErrResetTimer = null;
    var _tileErrBannerShown = false;
    function showMapBannerOnce(key, message) {
      try {
        if (!ui || !ui.mapEl) return;
        var existing = ui.mapEl.querySelector('[data-fgpx-banner="' + key + '"]');
        if (existing) return;
        var banner = document.createElement('div');
        banner.className = 'fgpx-tile-error-banner';
        banner.setAttribute('role', 'alert');
        banner.setAttribute('data-fgpx-banner', key);
        var bannerMsg = document.createElement('span');
        bannerMsg.textContent = String(message || 'Notice');
        var bannerClose = document.createElement('button');
        bannerClose.type = 'button';
        bannerClose.setAttribute('aria-label', 'Dismiss');
        bannerClose.textContent = '×';
        bannerClose.addEventListener('click', function () {
          if (banner.parentNode) banner.parentNode.removeChild(banner);
        });
        banner.appendChild(bannerMsg);
        banner.appendChild(bannerClose);
        ui.mapEl.appendChild(banner);
      } catch (_) {}
    }
    map.on('error', function (e) {
      if (e && e.error && e.error.status >= 500) {
        DBG.warn('Map tile server error (will retry automatically):', e.error.status, e.error.url);
      } else {
        DBG.warn('Map error:', e);
      }
      // Track repeated tile HTTP failures and show a user-facing banner after 5 errors
      if (!_tileErrBannerShown && e && e.error && e.error.status) {
        _tileErrCount++;
        if (!_tileErrResetTimer) {
          _tileErrResetTimer = setTimeout(function () {
            _tileErrCount = 0;
            _tileErrResetTimer = null;
          }, 30000);
        }
        if (_tileErrCount >= 5) {
          _tileErrBannerShown = true;
          clearTimeout(_tileErrResetTimer);
          showMapBannerOnce(
            'tile-load-error',
            '⚠ Map tiles unavailable. Check your internet connection.'
          );
        }
      }
    });

    map.once('load', function () {
      DBG.log('map load event');

      // If inline style contains a raster-dem source, enable terrain automatically
      var terrainSourceId = null;
      var hasTerrain = false;
      var terrainActive = false;
      var terrainTemporarilyDisabled = false;
      try {
        if (inlineStyle) {
          var st = map.getStyle();
          var srcs = st && st.sources ? st.sources : {};
          for (var sid in srcs) {
            if (Object.prototype.hasOwnProperty.call(srcs, sid)) {
              var sdef = srcs[sid];
              if (sdef && sdef.type === 'raster-dem') {
                terrainSourceId = sid;
                break;
              }
            }
          }
        }
      } catch (_) {}
      // Activate terrain early so DEM tiles load during idle time before playback
      if (terrainSourceId) {
        hasTerrain = true;
        try {
          map.setTerrain({ source: terrainSourceId, exaggeration: 1.0 });
          terrainActive = true;
        } catch (_) {}
      }

      // Compute the lowest source maxzoom across all sources so we never request
      // tiles that don't exist (overzooming causes tile shimmer / blurry fallbacks).
      // Store result in defaultZoomSetting so all downstream consumers use it.
      try {
        var _srcMinMax = Infinity;
        var _styleNow = map.getStyle();
        var _srcs = _styleNow && _styleNow.sources ? _styleNow.sources : {};
        for (var _sid in _srcs) {
          if (!Object.prototype.hasOwnProperty.call(_srcs, _sid)) continue;
          var _src = _srcs[_sid];
          // Only constrain raster and vector tile sources — raster-dem controls terrain mesh
          if (!_src || (_src.type !== 'raster' && _src.type !== 'vector')) continue;
          var _mz = _src.maxzoom;
          if (!isFinite(_mz)) {
            // Try live source object
            try {
              var _live = map.getSource(_sid);
              if (_live && isFinite(_live.maxzoom)) _mz = _live.maxzoom;
            } catch (_) {}
          }
          if (isFinite(_mz)) _srcMinMax = Math.min(_srcMinMax, _mz);
        }
        if (isFinite(_srcMinMax) && _srcMinMax - 1 < defaultZoomSetting) {
          // Use maxzoom - 1 to give MapLibre tile headroom: avoids overzooming that causes
          // blurry stretched parent tiles and terrain mesh popping during bearing changes.
          var clampedZoom = Math.max(1, _srcMinMax - 1);
          DBG.log('playback zoom clamped by source maxzoom - 1', {
            from: defaultZoomSetting,
            to: clampedZoom,
            sourceMaxzoom: _srcMinMax,
          });
          defaultZoomSetting = clampedZoom;
        }
      } catch (_) {}

      map.on('styledata', function () {
        _placeLayers = null;
        weatherTextLayersSupported = null;
        weatherOverlayReduced = null;
        weatherOverlayProfileKey = '';
        applyMapSelectorMode(selectorMode);
      });

      // Precompute cities from MapTiler POI layer for Simulation tab.
      // Re-run on map idle so tiles loaded during playback are included.
      if (simulationCitiesEnabled) {
        var _citiesLastPrecompute = 0;
        var _citiesIdleThrottleMs = 15000;
        try {
          precomputeMapCities(distanceAtPlaybackTime(lastPlaybackSec || 0));
          _citiesLastPrecompute = Date.now();
        } catch (_) {}
        map.on('idle', function () {
          if (!simulationCitiesEnabled) return;
          var now = Date.now();
          if (now - _citiesLastPrecompute < _citiesIdleThrottleMs) return;
          _citiesLastPrecompute = now;
          try {
            precomputeMapCities(distanceAtPlaybackTime(lastPlaybackSec || 0));
          } catch (_) {}
        });
      }

      // Elevation-based coloring helpers
      /**
       * Clamps a number to the range [0, 1].
       * @param {number} x - Value to clamp.
       * @returns {number} Clamped value.
       */
      function clamp01(x) {
        return x < 0 ? 0 : x > 1 ? 1 : x;
      }
      /**
       * Converts a hex color string to an RGB object.
       * @param {string} hex - Hex color string.
       * @returns {{r: number, g: number, b: number}} RGB object.
       */
      function hexToRgb(hex) {
        hex = (hex || '').replace('#', '');
        if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        return {
          r: parseInt(hex.substr(0, 2), 16),
          g: parseInt(hex.substr(2, 2), 16),
          b: parseInt(hex.substr(4, 2), 16),
        };
      }
      /**
       * Converts RGB values to a hex color string.
       * @param {number} r - Red value (0-255).
       * @param {number} g - Green value (0-255).
       * @param {number} b - Blue value (0-255).
       * @returns {string} Hex color string.
       */
      function rgbToHex(r, g, b) {
        return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
      }
      /**
       * Blends two hex colors by a given alpha.
       * @param {string} hex1 - First hex color.
       * @param {string} hex2 - Second hex color.
       * @param {number} alpha - Blend ratio (0-1).
       * @returns {string} Blended hex color.
       */
      function blendHex(hex1, hex2, alpha) {
        var rgb1 = hexToRgb(hex1);
        var rgb2 = hexToRgb(hex2);
        var r = Math.round(rgb1.r + (rgb2.r - rgb1.r) * alpha);
        var g = Math.round(rgb1.g + (rgb2.g - rgb1.g) * alpha);
        var b = Math.round(rgb1.b + (rgb2.b - rgb1.b) * alpha);
        return rgbToHex(r, g, b);
      }

      // Calculate elevation gradients
      /**
       * Calculates elevation gradients for a set of coordinates.
       * @param {Array} coords - Array of coordinates.
       * @param {Array} cumDist - Cumulative distances.
       * @returns {Array} Array of gradients.
       */
      function calculateGradients(coords, cumDist) {
        var gradients = [];
        for (var i = 0; i < coords.length; i++) {
          if (i === 0) {
            gradients.push(0);
            continue;
          }
          var elevDiff = (coords[i][2] || 0) - (coords[i - 1][2] || 0);
          var distDiff = (cumDist[i] || 0) - (cumDist[i - 1] || 0);
          var gradient = distDiff > 0 ? (elevDiff / distDiff) * 100 : 0; // percentage grade
          gradients.push(Math.abs(gradient)); // use absolute value for coloring
        }
        return gradients;
      }

      // Smooth gradients to reduce noise
      /**
       * Smooths an array of gradients using a moving average window.
       * @param {Array} gradients - Array of gradients.
       * @param {number} windowSize - Window size for smoothing.
       * @returns {Array} Smoothed gradients.
       */
      function smoothGradients(gradients, windowSize) {
        var smoothed = [];
        var halfWindow = Math.floor(windowSize / 2);
        for (var i = 0; i < gradients.length; i++) {
          var sum = 0;
          var count = 0;
          for (
            var j = Math.max(0, i - halfWindow);
            j <= Math.min(gradients.length - 1, i + halfWindow);
            j++
          ) {
            sum += gradients[j];
            count++;
          }
          smoothed.push(count > 0 ? sum / count : 0);
        }
        return smoothed;
      }

      // Route source: if privacy enabled, show only trimmed segment to avoid revealing real start/end
      var baseCoords = coords.map(function (c) {
        return c.slice(0, 2);
      });
      var elevationColoring = !!(window.FGPX && FGPX.elevationColoring);
      var elevColorThreshold = parseFloat((window.FGPX && FGPX.elevColorThreshold) || '3'); // 3% grade threshold
      var elevColorMax = parseFloat((window.FGPX && FGPX.elevColorMax) || '8'); // 8% grade for full red

      if (privacyEnabled) {
        try {
          var lo = 0,
            hi = cumDist.length - 1;
          while (lo < hi) {
            var mid = (lo + hi) >>> 1;
            if (cumDist[mid] < privacyStartD) lo = mid + 1;
            else hi = mid;
          }
          var startIdx = Math.max(0, lo - 1);
          lo = 0;
          hi = cumDist.length - 1;
          while (lo < hi) {
            var mid2 = (lo + hi) >>> 1;
            if (cumDist[mid2] < privacyEndD) lo = mid2 + 1;
            else hi = mid2;
          }
          var endIdx = Math.max(startIdx + 1, lo);
          var pStart = positionAtDistance(privacyStartD);
          var pEnd = positionAtDistance(privacyEndD);
          var segBase = baseCoords.slice(startIdx, endIdx + 1);
          if (segBase.length > 0) {
            segBase[0] = pStart.slice(0, 2);
            segBase[segBase.length - 1] = pEnd.slice(0, 2);
          }
          baseCoords = segBase;
        } catch (_) {}
      }

      // Standard single-color background route (faint)
      // Apply light spline smoothing to the background route for nicer curves
      try {
        var baseSmoothed = smoothPolyline(baseCoords, 1);
        routeData.geometry.coordinates = baseSmoothed;
      } catch (_) {
        routeData.geometry.coordinates = baseCoords;
      }
      map.addSource('fgpx-route', { type: 'geojson', data: routeData, lineMetrics: true });
      // Background route (faint)
      map.addLayer({
        id: 'fgpx-route-line',
        type: 'line',
        source: 'fgpx-route',
        paint: { 'line-color': '#cccccc', 'line-width': 2 },
      });
      applyMapSelectorMode(selectorMode);

      // Direction arrows along route:
      // - Undriven section uses muted color
      // - Driven section uses active route color
      // - Bearings are stabilized by using a smoothed source for static route arrows
      // - Icon is rotated 90deg clockwise so arrow head points in travel direction
      var arrowsEnabled = !!(window.FGPX && FGPX.arrowsEnabled);
      var routeArrowSpacingPx = 90;
      var routeArrowUndrivenIconId = 'fgpx-route-dir-arrow-undriven';
      var routeArrowDrivenIconId = 'fgpx-route-dir-arrow-driven';
      if (arrowsEnabled && totalDistance > 0) {
        try {
          var arrowsKm = parseFloat(FGPX.arrowsKm || '5');
          if (!isFinite(arrowsKm) || arrowsKm <= 0) {
            arrowsKm = 5;
          }
          var arrowRepeatPct = ((arrowsKm * 1000) / totalDistance) * 100;
          // Reference viewport width heuristic used to translate distance-based repeats
          // into readable line symbol spacing across typical embed sizes.
          var arrowSpacingReferencePx = 550;
          routeArrowSpacingPx = Math.round(
            arrowSpacingReferencePx / Math.max(arrowRepeatPct, 0.01)
          );
          if (routeArrowSpacingPx < 30) {
            routeArrowSpacingPx = 30;
          }
          if (routeArrowSpacingPx > 300) {
            routeArrowSpacingPx = 300;
          }

          var undrivenArrowColor = '#cccccc';
          var drivenArrowColor =
            (window.FGPX && FGPX.elevationColorFlat) ||
            (window.FGPX && FGPX.chartColor) ||
            '#ff5500';
          var themeMode =
            window.FGPX && typeof FGPX.themeMode === 'string' ? String(FGPX.themeMode) : 'system';
          var arrowStrokeColor =
            themeMode === 'bright' ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.85)';

          function ensureRouteArrowIcon(iconId, fillColor, strokeColor) {
            if (map.hasImage(iconId)) return;
            var ac = document.createElement('canvas');
            ac.width = 20;
            ac.height = 20;
            var actx = ac.getContext('2d');
            if (!actx) {
              throw new Error('Route arrow canvas context unavailable');
            }
            actx.clearRect(0, 0, 20, 20);
            actx.fillStyle = fillColor;
            actx.strokeStyle = strokeColor;
            actx.lineWidth = 1.5;
            actx.beginPath();
            actx.moveTo(10, 1); // tip
            actx.lineTo(18, 18); // bottom-right
            actx.lineTo(10, 14); // inner notch
            actx.lineTo(2, 18); // bottom-left
            actx.closePath();
            actx.fill();
            actx.stroke();
            var imageData = actx.getImageData(0, 0, 20, 20);
            map.addImage(iconId, { width: 20, height: 20, data: imageData.data });
          }

          ensureRouteArrowIcon(routeArrowUndrivenIconId, undrivenArrowColor, arrowStrokeColor);
          ensureRouteArrowIcon(routeArrowDrivenIconId, drivenArrowColor, arrowStrokeColor);

          var arrowRouteData = {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: (function () {
                try {
                  return smoothPolyline(baseCoords, 2);
                } catch (_) {
                  return baseCoords;
                }
              })(),
            },
          };
          map.addSource('fgpx-route-arrows-src', {
            type: 'geojson',
            data: arrowRouteData,
            lineMetrics: true,
          });
          map.addLayer({
            id: 'fgpx-route-arrows-undriven',
            type: 'symbol',
            source: 'fgpx-route-arrows-src',
            layout: {
              'symbol-placement': 'line',
              'symbol-spacing': routeArrowSpacingPx,
              'icon-image': routeArrowUndrivenIconId,
              'icon-size': 0.85,
              'icon-rotation-alignment': 'auto',
              'icon-rotate': 90,
              'icon-allow-overlap': false,
              'icon-keep-upright': false,
            },
          });
        } catch (e) {
          DBG.warn('Route arrow rendering skipped', e);
        }
      }

      // Prepare elevation coloring data for progressive route
      var elevationColoringEnabled = !!(window.FGPX && FGPX.elevationColoring);
      var progressiveGradients = null;
      var progressiveSmoothedGradients = null;
      var progressiveBaseColor = (window.FGPX && FGPX.elevationColorFlat) || '#ff5500';
      var progressiveSteepColor = (window.FGPX && FGPX.elevationColorSteep) || '#ff0000';
      var SEGMENT_POOL_SIZE = 20;
      var segmentPoolReady = false;

      if (elevationColoringEnabled && coords.length > 1) {
        progressiveGradients = calculateGradients(coords, cumDist);
        progressiveSmoothedGradients = smoothGradients(progressiveGradients, 5);
        // Pre-size the segment pool for this track so steep/rolling routes do not
        // truncate late progressive segments when gradient buckets change often.
        try {
          var previewCoords = coords.map(function (c) {
            return [c[0], c[1]];
          });
          var previewSegments = createProgressiveSegments(previewCoords, 0);
          if (Array.isArray(previewSegments) && previewSegments.length > 0) {
            SEGMENT_POOL_SIZE = Math.max(
              SEGMENT_POOL_SIZE,
              Math.min(80, previewSegments.length + 5)
            );
          }
        } catch (_) {}
      }

      // Pre-allocate a fixed pool of segment sources/layers at init.
      // During playback we only call setData() — never add/remove layers.
      var emptyFeatureCollection = { type: 'FeatureCollection', features: [] };
      /**
       * Initializes the pool of segment sources/layers for progressive route coloring.
       */
      function initSegmentPool() {
        for (var i = 0; i < SEGMENT_POOL_SIZE; i++) {
          var srcId = 'fgpx-progress-segment-' + i;
          var layId = 'fgpx-progress-segment-' + i;
          try {
            map.addSource(srcId, { type: 'geojson', data: emptyFeatureCollection });
            var segmentLayerConfig = {
              id: layId,
              type: 'line',
              source: srcId,
              layout: { 'line-join': 'round', 'line-cap': 'round' },
              paint: { 'line-color': progressiveBaseColor, 'line-width': 4, 'line-blur': 0.3 },
            };
            if (map.getLayer('fgpx-point-circle')) {
              map.addLayer(segmentLayerConfig, 'fgpx-point-circle');
            } else {
              map.addLayer(segmentLayerConfig);
            }
          } catch (_) {}
        }
        segmentPoolReady = true;
      }

      // Helper function to clean up progressive segments (resets pool to empty data)
      /**
       * Cleans up progressive segments and resets related caches.
       */
      function cleanupProgressiveSegments() {
        for (var segIdx = 0; segIdx < SEGMENT_POOL_SIZE; segIdx++) {
          try {
            var src = map.getSource('fgpx-progress-segment-' + segIdx);
            if (src) src.setData(emptyFeatureCollection);
          } catch (_) {}
        }
        progressSegments = [];
        segmentLengthCache = [];
        segmentTipCache = [];
        segmentColorCache = [];
      }

      // Helper function to create elevation-colored progressive segments
      /**
       * Creates elevation-colored progressive segments for the route.
       * @param {Array} coordsUpTo - Coordinates up to current progress.
       * @param {number} startIdx - Start index for segmenting.
       * @returns {Array} Array of segment objects.
       */
      function createProgressiveSegments(coordsUpTo, startIdx) {
        if (!elevationColoringEnabled || !progressiveSmoothedGradients) {
          return null; // Use single-color progressive route
        }

        var segments = [];
        var currentSegment = [];
        var currentGradeBucket = null;

        for (var i = 0; i < coordsUpTo.length; i++) {
          var gradientIdx = startIdx + i;
          var gradient =
            progressiveSmoothedGradients[
              Math.min(gradientIdx, progressiveSmoothedGradients.length - 1)
            ] || 0;

          // Calculate color blend factor using configurable thresholds
          var thresholdMin = parseFloat((window.FGPX && FGPX.elevationThresholdMin) || '3');
          var thresholdMax = parseFloat((window.FGPX && FGPX.elevationThresholdMax) || '8');
          var alpha = 0;
          if (gradient > thresholdMin) {
            alpha = (gradient - thresholdMin) / (thresholdMax - thresholdMin);
            alpha = clamp01(alpha);
          }

          // Quantize to reduce segment count (every 20% blend)
          var gradeBucket = Math.floor(alpha * 5) / 5;

          if (currentGradeBucket === null) {
            currentGradeBucket = gradeBucket;
          }

          if (gradeBucket !== currentGradeBucket && currentSegment.length > 0) {
            // Finish current segment
            segments.push({
              coordinates: currentSegment.slice(),
              gradeBucket: currentGradeBucket,
            });
            currentSegment = [coordsUpTo[i - 1]]; // Start new segment with overlap
            currentGradeBucket = gradeBucket;
          }

          currentSegment.push(coordsUpTo[i]);
        }

        // Add final segment
        if (currentSegment.length > 1) {
          segments.push({
            coordinates: currentSegment,
            gradeBucket: currentGradeBucket,
          });
        }

        return segments;
      }

      // Foreground progressive route (stable per-frame GeoJSON)
      var progressData = {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [privacyEnabled ? positionAtDistance(privacyStartD) : coords[0].slice(0, 2)],
        },
      };
      map.addSource('fgpx-route-progress', { type: 'geojson', data: progressData });
      map.addLayer({
        id: 'fgpx-route-progress-line',
        type: 'line',
        source: 'fgpx-route-progress',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color':
            (window.FGPX && FGPX.elevationColorFlat) ||
            (window.FGPX && FGPX.chartColor) ||
            '#ff5500',
          'line-width': 4,
          'line-blur': 0.3,
        },
      });

      if (arrowsEnabled && totalDistance > 0) {
        try {
          map.addLayer({
            id: 'fgpx-route-arrows-driven',
            type: 'symbol',
            source: 'fgpx-route-progress',
            layout: {
              'symbol-placement': 'line',
              'symbol-spacing': routeArrowSpacingPx,
              'icon-image': routeArrowDrivenIconId,
              'icon-size': 0.85,
              'icon-rotation-alignment': 'auto',
              'icon-rotate': 90,
              'icon-allow-overlap': false,
              'icon-keep-upright': false,
            },
          });
        } catch (e) {
          DBG.warn('Driven route arrows skipped', e);
        }
      }

      // Initialize the pre-allocated segment pool for elevation-colored progress line
      if (elevationColoringEnabled) {
        try {
          initSegmentPool();
        } catch (_) {}
      }

      // Create colored arrow icons for different wind speeds and sizes
      /**
       * Creates a canvas arrow icon of a given color and size.
       * @param {string} color - Arrow color.
       * @param {number} [size=72] - Icon size in pixels.
       * @returns {HTMLCanvasElement} Canvas element with arrow.
       */
      function createArrowIcon(color, size) {
        size = size || 72; // Default size
        var canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        var ctx = canvas.getContext('2d');

        // Clear canvas with transparent background
        ctx.clearRect(0, 0, size, size);

        // Scale arrow proportionally to canvas size
        var scale = size / 72;
        var center = size / 2;

        // Draw solid arrow pointing up (north) as one continuous shape
        ctx.fillStyle = color;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1, scale);

        ctx.beginPath();
        // Start from arrow tip and draw complete outline (scaled)
        ctx.moveTo(center, 12 * scale); // Arrow tip (top center)
        ctx.lineTo(center + 18 * scale, 30 * scale); // Right side of arrow head
        ctx.lineTo(center + 9 * scale, 30 * scale); // Right inner corner
        ctx.lineTo(center + 9 * scale, 60 * scale); // Right side of shaft
        ctx.lineTo(center - 9 * scale, 60 * scale); // Bottom right of shaft
        ctx.lineTo(center - 9 * scale, 30 * scale); // Left side of shaft
        ctx.lineTo(center - 18 * scale, 30 * scale); // Left inner corner
        ctx.lineTo(center, 12 * scale); // Back to arrow tip
        ctx.closePath();

        ctx.fill();
        ctx.stroke();

        return canvas;
      }

      // Create multiple colored arrow icons in different sizes
      try {
        var windColors = [
          { name: 'calm', color: '#666666' }, // Dark gray for calm
          { name: 'light', color: '#228b22' }, // Forest green for light breeze
          { name: 'moderate', color: '#ff8c00' }, // Dark orange for moderate wind
          { name: 'strong', color: '#ff4500' }, // Red orange for strong wind
          { name: 'very-strong', color: '#dc143c' }, // Crimson for very strong wind
        ];

        var sizes = [72, 54, 36, 24, 18]; // Main arrow and 4 smaller sizes for circle

        windColors.forEach(function (windColor) {
          sizes.forEach(function (size, sizeIndex) {
            var canvas = createArrowIcon(windColor.color, size);
            var ctx = canvas.getContext('2d');
            var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

            var iconData = {
              width: canvas.width,
              height: canvas.height,
              data: imageData.data,
            };

            var sizeName = sizeIndex === 0 ? '' : '-size' + sizeIndex;
            map.addImage('arrow-' + windColor.name + sizeName, iconData);
          });
        });

        DBG.log('Multiple colored arrow icons in different sizes loaded successfully');
      } catch (error) {
        DBG.warn('Failed to create colored arrow icons:', error);
      }

      // Weather heatmap layer (if weather data is available and enabled)
      /**
       * Converts a value to a boolean, with fallback.
       * @param {*} value - Value to convert.
       * @param {boolean} fallback - Fallback value if conversion fails.
       * @returns {boolean} Boolean result.
       */
      function toBoolOption(value, fallback) {
        if (value === undefined || value === null || value === '') return !!fallback;
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value === 1;
        if (typeof value === 'string') {
          var v = value.toLowerCase();
          if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
          if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
        }
        return !!value;
      }

      var weatherEnabled = toBoolOption(window.FGPX && FGPX.weatherEnabled, false);
      var debugWeatherDataEnabled = toBoolOption(window.FGPX && FGPX.debugWeatherData, false);
      var simulationEnabled = toBoolOption(window.FGPX && FGPX.simulationEnabled, true);
      var simulationWaypointsEnabled =
        simulationEnabled && toBoolOption(window.FGPX && FGPX.simulationWaypointsEnabled, true);
      var simulationCitiesEnabled =
        simulationEnabled && toBoolOption(window.FGPX && FGPX.simulationCitiesEnabled, true);
      var simulationWaypointWindowMeters = Math.max(
        1000,
        Math.min(50000, (Number(window.FGPX && FGPX.simulationWaypointWindowKm) || 10) * 1000)
      );
      var simulationCityWindowMeters = Math.max(
        1000,
        Math.min(50000, (Number(window.FGPX && FGPX.simulationCityWindowKm) || 10) * 1000)
      );
      var effectiveWeatherEnabled = weatherEnabled || debugWeatherDataEnabled;
      var weatherOpacity =
        window.FGPX && isFinite(Number(FGPX.weatherOpacity)) ? Number(FGPX.weatherOpacity) : 0.7;
      var weatherData = payload && payload.weather ? payload.weather : null;
      // In debug weather simulation mode, clone to prevent mutating the shared payload object
      // across multiple instances that reference the same track data.
      if (debugWeatherDataEnabled && weatherData) {
        try {
          weatherData =
            typeof structuredClone !== 'undefined'
              ? structuredClone(weatherData)
              : JSON.parse(JSON.stringify(weatherData));
        } catch (_) {
          /* use original reference if clone fails */
        }
      }
      var weatherGradeAvailable = false;
      var weatherVisible = toBoolOption(window.FGPX && FGPX.weatherVisibleByDefault, false);
      var windCircleLayerIds = [];
      var weatherOverlayPerfMode = String(
        (window.FGPX && FGPX.weatherOverlayPerfMode) || 'full'
      ).toLowerCase(); // auto|full|performance
      var weatherHeatmapConsolidated = toBoolOption(
        window.FGPX && FGPX.weatherHeatmapConsolidated,
        false
      );
      var windSatelliteLayersEnabled = weatherOverlayPerfMode !== 'performance';
      var weatherTextLayersSupported = null;
      var weatherOverlayReduced = null;
      var weatherOverlayProfileKey = '';
      // Explicit product policy: temperature and wind overlays are disabled on mobile.
      var isMobileOverlayDisabled = window.innerWidth <= 680;
      var temperatureVisible = false;
      var windVisible = false;

      // ========== DEBUG WEATHER DATA ==========
      // Add debug weather data when enabled in admin settings
      if (debugWeatherDataEnabled) {
        // If no weather data exists or it's empty, create weather points from track coordinates
        if (
          !weatherData ||
          !weatherData.features ||
          !Array.isArray(weatherData.features) ||
          weatherData.features.length === 0
        ) {
          if (
            payload &&
            payload.geojson &&
            payload.geojson.geometry &&
            payload.geojson.geometry.coordinates
          ) {
            var coordinates = payload.geojson.geometry.coordinates;
            weatherData = {
              type: 'FeatureCollection',
              features: [],
            };

            // Create weather points from track coordinates (sample every 10th point to avoid too many)
            var step = Math.max(1, Math.floor(coordinates.length / 100)); // Max 100 weather points
            for (var i = 0; i < coordinates.length; i += step) {
              weatherData.features.push({
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: [coordinates[i][0], coordinates[i][1]],
                },
                properties: {
                  // Existing properties (will be populated by simulation)
                  rain_mm: 0,
                  temperature_c: 20,
                  wind_speed_kmh: 0,
                  wind_direction_deg: 0,
                  // NEW multi-weather properties (will be populated by simulation)
                  cloud_cover_pct: 0,
                  snowfall_cm: 0,
                  fog_intensity: 0,
                  dew_point_2m_c: 0,
                  temperature_2m_c: 20,
                  relative_humidity_pct: 50,
                  source: 'debug-simulation',
                },
              });
            }
          }
        }

        // Run simulation on weather data (existing or newly created)
        if (
          weatherData &&
          weatherData.features &&
          Array.isArray(weatherData.features) &&
          weatherData.features.length > 0
        ) {
          try {
            var totalRain = 0;
            var wetPoints = 0;
            var maxRain = 0;

            // Generate realistic rain pattern with ~30% coverage and smooth transitions
            var rainClusters = [];
            var numClusters = Math.max(1, Math.floor(weatherData.features.length * 0.1)); // 10% of points become cluster centers

            // Create rain cluster centers
            for (var c = 0; c < numClusters; c++) {
              var centerIndex = Math.floor(Math.random() * weatherData.features.length);
              var intensity = 0.5 + Math.random() * 0.5; // 0.5-1.0 intensity
              var radius = 3 + Math.random() * 4; // 3-7 point radius
              rainClusters.push({ center: centerIndex, intensity: intensity, radius: radius });
            }

            // Apply rain values with smooth transitions
            for (var i = 0; i < weatherData.features.length; i++) {
              if (weatherData.features[i] && weatherData.features[i].properties) {
                var rainValue = 0;

                // Check distance to each rain cluster
                for (var c = 0; c < rainClusters.length; c++) {
                  var cluster = rainClusters[c];
                  var distance = Math.abs(i - cluster.center);

                  if (distance <= cluster.radius) {
                    // Calculate falloff from cluster center
                    var falloff = 1 - distance / cluster.radius;
                    var clusterRain = cluster.intensity * falloff;

                    // Generate rain intensity based on cluster influence
                    if (clusterRain > 0.7) {
                      // Heavy rain near cluster center
                      rainValue = Math.max(rainValue, 4.0 + Math.random() * 4.0); // 4.0-8.0mm
                    } else if (clusterRain > 0.4) {
                      // Moderate rain
                      rainValue = Math.max(rainValue, 1.5 + Math.random() * 2.5); // 1.5-4.0mm
                    } else if (clusterRain > 0.2) {
                      // Light rain at cluster edges
                      rainValue = Math.max(rainValue, 0.1 + Math.random() * 1.4); // 0.1-1.5mm
                    }
                  }
                }

                // Round to 1 decimal place
                rainValue = Math.round(rainValue * 10) / 10;

                weatherData.features[i].properties.rain_mm = rainValue;
                totalRain += rainValue;
                if (rainValue > 0) wetPoints++;
                if (rainValue > maxRain) maxRain = rainValue;

                // ========== REALISTIC MULTI-WEATHER SIMULATION ==========

                // Determine weather scenario for this track (30% chance each for different conditions)
                var trackPosition = i / weatherData.features.length; // 0 to 1
                var scenario = 'temperate'; // default

                // Create varied scenarios across the track for testing
                if (trackPosition < 0.25) {
                  // First quarter: Winter/Cold conditions (snow possible)
                  scenario = Math.random() < 0.5 ? 'cold' : 'temperate';
                } else if (trackPosition < 0.5) {
                  // Second quarter: Temperate (rain/fog possible)
                  scenario = Math.random() < 0.5 ? 'temperate' : 'foggy';
                } else if (trackPosition < 0.75) {
                  // Third quarter: Warm (clouds/clear)
                  scenario = Math.random() < 0.5 ? 'warm' : 'cloudy';
                } else {
                  // Last quarter: Mix
                  var rand = Math.random();
                  scenario = rand < 0.3 ? 'cold' : rand < 0.6 ? 'foggy' : 'warm';
                }

                // Generate base temperature based on scenario
                var baseTemp, tempVariation, dewPointOffset;

                switch (scenario) {
                  case 'cold':
                    baseTemp = -5 + Math.random() * 8; // -5°C to 3°C (snow range)
                    tempVariation = 2;
                    dewPointOffset = 1 + Math.random() * 2; // 1-3°C below temp
                    break;
                  case 'foggy':
                    baseTemp = 5 + Math.random() * 10; // 5°C to 15°C (fog range)
                    tempVariation = 1;
                    dewPointOffset = 0.2 + Math.random() * 1.5; // Very close to temp for fog
                    break;
                  case 'warm':
                    baseTemp = 20 + Math.random() * 10; // 20°C to 30°C
                    tempVariation = 3;
                    dewPointOffset = 5 + Math.random() * 5; // 5-10°C below temp
                    break;
                  case 'cloudy':
                    baseTemp = 12 + Math.random() * 10; // 12°C to 22°C
                    tempVariation = 2;
                    dewPointOffset = 3 + Math.random() * 4; // 3-7°C below temp
                    break;
                  default: // temperate
                    baseTemp = 10 + Math.random() * 15; // 10°C to 25°C
                    tempVariation = 2;
                    dewPointOffset = 2 + Math.random() * 5; // 2-7°C below temp
                }

                // Add smooth variation along track (slight temperature changes)
                var tempNoise = (Math.sin(i * 0.1) * 0.5 + 0.5) * tempVariation;
                var temperature2m = baseTemp + tempNoise;
                temperature2m = Math.round(temperature2m * 10) / 10;

                // Temperature at 80m (slightly different for wind calculations)
                var temperature80m = temperature2m + (Math.random() * 2 - 1); // ±1°C difference
                temperature80m = Math.round(temperature80m * 10) / 10;

                // Dew point (temperature at which air becomes saturated)
                var dewPoint = temperature2m - dewPointOffset;
                dewPoint = Math.round(dewPoint * 10) / 10;

                // Relative humidity based on temperature and dew point
                // Simplified formula: RH ≈ 100 * exp((17.625 * Td)/(243.04 + Td)) / exp((17.625 * T)/(243.04 + T))
                var relativeHumidity =
                  (100 * Math.exp((17.625 * dewPoint) / (243.04 + dewPoint))) /
                  Math.exp((17.625 * temperature2m) / (243.04 + temperature2m));
                relativeHumidity = Math.max(30, Math.min(100, relativeHumidity)); // Clamp 30-100%
                relativeHumidity = Math.round(relativeHumidity);

                // Calculate fog intensity (backend formula: temp - dewpoint < 2°C)
                var tempDiff = temperature2m - dewPoint;
                var fogIntensity = 0;
                if (tempDiff < 2.0) {
                  fogIntensity = (2.0 - tempDiff) / 2.0; // 0 to 1
                  if (relativeHumidity > 90) {
                    fogIntensity = Math.min(1.0, fogIntensity * 1.2); // Boost if very humid
                  }
                }
                fogIntensity = Math.round(fogIntensity * 100) / 100;

                // Snowfall (only when cold enough and some precipitation)
                var snowfall = 0;
                if (temperature2m < 2 && rainValue > 0) {
                  // Convert rain to snow when cold (snow is ~10x volume of equivalent rain)
                  snowfall = rainValue * 0.8; // 0.8cm snow per mm rain (light, fluffy snow)
                  rainValue = rainValue * 0.2; // Reduce rain proportionally
                  snowfall = Math.round(snowfall * 10) / 10;
                  rainValue = Math.round(rainValue * 10) / 10;
                }

                // Cloud cover (correlated with precipitation and humidity)
                var cloudCover = 0;
                if (rainValue > 0 || snowfall > 0) {
                  // Precipitation means lots of clouds
                  cloudCover = 70 + Math.random() * 30; // 70-100%
                } else if (fogIntensity > 0.5) {
                  // Fog means low clouds
                  cloudCover = 80 + Math.random() * 20; // 80-100%
                } else if (scenario === 'cloudy') {
                  // Cloudy scenario
                  cloudCover = 50 + Math.random() * 40; // 50-90%
                } else {
                  // Partial cloud cover based on humidity
                  cloudCover = (relativeHumidity - 30) * 0.7; // 0-49% based on humidity
                  cloudCover += Math.random() * 20 - 10; // Add variation ±10%
                }
                cloudCover = Math.max(0, Math.min(100, cloudCover));
                cloudCover = Math.round(cloudCover);

                // Wind speed (higher in stormy conditions)
                var windSpeed = 5 + Math.random() * 15; // Base 5-20 km/h
                if (rainValue > 3 || snowfall > 2) {
                  windSpeed += 5 + Math.random() * 10; // Stormy conditions: +5-15 km/h
                }
                windSpeed = Math.round(windSpeed * 10) / 10;

                // Wind direction (somewhat consistent but with variation)
                var baseWindDir = 180 + ((i * 2) % 360); // Slowly rotating
                var windDirection = (baseWindDir + (Math.random() * 40 - 20)) % 360; // ±20° variation
                windDirection = Math.round(windDirection);

                // ========== ASSIGN ALL WEATHER PROPERTIES ==========
                // Existing properties
                weatherData.features[i].properties.rain_mm = rainValue;
                weatherData.features[i].properties.temperature_c = temperature80m; // 80m for wind
                weatherData.features[i].properties.wind_speed_kmh = windSpeed;
                weatherData.features[i].properties.wind_direction_deg = windDirection;

                // NEW multi-weather properties
                weatherData.features[i].properties.cloud_cover_pct = cloudCover;
                weatherData.features[i].properties.snowfall_cm = snowfall;
                weatherData.features[i].properties.fog_intensity = fogIntensity;
                weatherData.features[i].properties.dew_point_2m_c = dewPoint;
                weatherData.features[i].properties.temperature_2m_c = temperature2m;
                weatherData.features[i].properties.relative_humidity_pct = relativeHumidity;
              }
            }

            // Update weather summary to reflect debug data
            if (payload.weatherSummary) {
              payload.weatherSummary.max_mm = maxRain;
              payload.weatherSummary.avg_mm =
                Math.round((totalRain / weatherData.features.length) * 10) / 10;
              payload.weatherSummary.wet_points = wetPoints;
              payload.weatherSummary.total_points = weatherData.features.length;
            }

            // Calculate statistics for all weather types
            var rainCoverage = Math.round((wetPoints / weatherData.features.length) * 100);
            var snowPoints = weatherData.features.filter(
              (f) => f.properties.snowfall_cm > 0
            ).length;
            var fogPoints = weatherData.features.filter(
              (f) => f.properties.fog_intensity > 0.3
            ).length;
            var cloudyPoints = weatherData.features.filter(
              (f) => f.properties.cloud_cover_pct > 50
            ).length;

            DBG.log('DEBUG: ===== MULTI-WEATHER SIMULATION =====');
            DBG.log('DEBUG: Total weather points:', weatherData.features.length);
            DBG.log(
              'DEBUG: Rain coverage:',
              rainCoverage + '% (' + wetPoints + '/' + weatherData.features.length + ' points)'
            );
            DBG.log(
              'DEBUG: Snow points:',
              snowPoints +
                ' (' +
                Math.round((snowPoints / weatherData.features.length) * 100) +
                '%)'
            );
            DBG.log(
              'DEBUG: Fog points:',
              fogPoints + ' (' + Math.round((fogPoints / weatherData.features.length) * 100) + '%)'
            );
            DBG.log(
              'DEBUG: Cloudy points (>50%):',
              cloudyPoints +
                ' (' +
                Math.round((cloudyPoints / weatherData.features.length) * 100) +
                '%)'
            );
            DBG.log(
              'DEBUG: Rain clusters:',
              rainClusters.length,
              'with avg intensity:',
              Math.round(
                (rainClusters.reduce((sum, c) => sum + c.intensity, 0) / rainClusters.length) * 100
              ) / 100
            );
          } catch (e) {
            DBG.warn('DEBUG: Failed to add debug weather data:', e);
          }
        }
      }

      // Add debug biometric data (heart rate, cadence, temperature) if enabled and not already present
      if (debugWeatherDataEnabled) {
        DBG.log('DEBUG: Biometric simulation enabled, checking payload structure...');
        DBG.log('DEBUG: payload exists:', !!payload);
        DBG.log('DEBUG: payload.geojson exists:', !!(payload && payload.geojson));
        DBG.log(
          'DEBUG: payload.geojson.properties exists:',
          !!(payload && payload.geojson && payload.geojson.properties)
        );
      }

      if (debugWeatherDataEnabled && payload && payload.geojson && payload.geojson.properties) {
        try {
          // Use existing props and timestamps variables (already defined at lines 711 and 728)
          // No redeclaration to avoid hoisting issues that cause undefined errors
          // Check if data exists AND has meaningful values (not just zeros/nulls)
          var hasHeartRates =
            props.heartRates &&
            props.heartRates.length > 0 &&
            props.heartRates.some(function (hr) {
              return hr && hr > 0;
            });
          var hasCadences =
            props.cadences &&
            props.cadences.length > 0 &&
            props.cadences.some(function (cad) {
              return cad && cad > 0;
            });
          var hasTemperatures =
            props.temperatures &&
            props.temperatures.length > 0 &&
            props.temperatures.some(function (temp) {
              return temp && temp !== 0;
            });
          var hasPowers =
            props.powers &&
            props.powers.length > 0 &&
            props.powers.some(function (pow) {
              return pow && pow > 0;
            });

          DBG.log(
            'DEBUG: Biometric data check - HR:',
            hasHeartRates,
            'Cadence:',
            hasCadences,
            'Temp:',
            hasTemperatures,
            'Power:',
            hasPowers
          );
          DBG.log(
            'DEBUG: Timestamps available:',
            !!(timestamps && timestamps.length > 0),
            'Count:',
            timestamps ? timestamps.length : 0
          );

          // Debug actual data content
          DBG.log(
            'DEBUG: HR data:',
            props.heartRates
              ? 'Length: ' +
                  props.heartRates.length +
                  ', Sample: [' +
                  props.heartRates.slice(0, 3).join(',') +
                  '...]'
              : 'null/undefined'
          );
          DBG.log(
            'DEBUG: Cadence data:',
            props.cadences
              ? 'Length: ' +
                  props.cadences.length +
                  ', Sample: [' +
                  props.cadences.slice(0, 3).join(',') +
                  '...]'
              : 'null/undefined'
          );
          DBG.log(
            'DEBUG: Temp data:',
            props.temperatures
              ? 'Length: ' +
                  props.temperatures.length +
                  ', Sample: [' +
                  props.temperatures.slice(0, 3).join(',') +
                  '...]'
              : 'null/undefined'
          );
          DBG.log(
            'DEBUG: Power data:',
            props.powers
              ? 'Length: ' +
                  props.powers.length +
                  ', Sample: [' +
                  props.powers.slice(0, 3).join(',') +
                  '...]'
              : 'null/undefined'
          );

          if (timestamps && timestamps.length > 0) {
            // Add realistic heart rate data if not present
            if (!hasHeartRates) {
              var heartRates = [];
              var baseHR = 140 + Math.random() * 40; // Base HR 140-180 bpm
              var currentHR = baseHR;

              for (var i = 0; i < timestamps.length; i++) {
                // Simulate realistic heart rate variations
                var variation = (Math.random() - 0.5) * 10; // ±5 bpm variation
                var trend = Math.sin((i / timestamps.length) * Math.PI * 2) * 15; // Gradual trend

                currentHR = Math.max(120, Math.min(200, baseHR + trend + variation));
                heartRates.push(Math.round(currentHR));
              }

              props.heartRates = heartRates;
              DBG.log(
                'DEBUG: Added realistic heart rate data (' +
                  heartRates.length +
                  ' points, range: ' +
                  Math.min(...heartRates) +
                  '-' +
                  Math.max(...heartRates) +
                  ' bpm)'
              );
            }

            // Add realistic cadence data if not present
            if (!hasCadences) {
              var cadences = [];
              var baseCadence = 80 + Math.random() * 20; // Base cadence 80-100 rpm
              var currentCadence = baseCadence;

              for (var i = 0; i < timestamps.length; i++) {
                // Simulate realistic cadence variations
                var variation = (Math.random() - 0.5) * 8; // ±4 rpm variation
                var trend = Math.sin((i / timestamps.length) * Math.PI * 3) * 10; // More frequent changes

                currentCadence = Math.max(60, Math.min(120, baseCadence + trend + variation));
                cadences.push(Math.round(currentCadence));
              }

              props.cadences = cadences;
              DBG.log(
                'DEBUG: Added realistic cadence data (' +
                  cadences.length +
                  ' points, range: ' +
                  Math.min(...cadences) +
                  '-' +
                  Math.max(...cadences) +
                  ' rpm)'
              );
            }

            // Add realistic temperature data if not present
            if (!hasTemperatures) {
              var temperatures = [];
              var baseTemp = 18 + Math.random() * 8; // Base temperature 18-26°C
              var currentTemp = baseTemp;

              for (var i = 0; i < timestamps.length; i++) {
                // Simulate realistic temperature variations
                var variation = (Math.random() - 0.5) * 2; // ±1°C variation
                var trend = Math.sin((i / timestamps.length) * Math.PI * 1.5) * 3; // Gradual temperature changes
                var timeOfDay = Math.sin((i / timestamps.length) * Math.PI * 4) * 2; // Simulate daily temperature cycle

                currentTemp = Math.max(10, Math.min(35, baseTemp + trend + timeOfDay + variation));
                temperatures.push(Math.round(currentTemp * 10) / 10); // Round to 1 decimal place
              }

              props.temperatures = temperatures;
              DBG.log(
                'DEBUG: Added realistic temperature data (' +
                  temperatures.length +
                  ' points, range: ' +
                  Math.min(...temperatures) +
                  '-' +
                  Math.max(...temperatures) +
                  ' °C)'
              );
            }

            if (!hasPowers) {
              DBG.log(
                'DEBUG: No GPX power values in payload; backend estimation should provide power data when available.'
              );
            }
          }
        } catch (e) {
          DBG.warn('DEBUG: Failed to add debug biometric data:', e);
        }
      }
      // ========== END DEBUG WEATHER DATA ==========

      weatherGradeAvailable =
        simulationEnabled && buildWeatherLookup({ weather: weatherData }).length > 0;

      // Extract biometric data after simulation (so we get simulated data if it was generated)
      var heartRates = Array.isArray(props.heartRates) ? props.heartRates : null; // bpm
      var cadences = Array.isArray(props.cadences) ? props.cadences : null; // rpm
      var temperatures = Array.isArray(props.temperatures) ? props.temperatures : null; // °C
      var powers = Array.isArray(props.powers) ? props.powers : null; // watts

      DBG.log(
        'DEBUG: Final biometric data after simulation - HR:',
        !!heartRates,
        'Cadence:',
        !!cadences,
        'Temp:',
        !!temperatures,
        'Power:',
        !!powers
      );

      // ========== LAZY LOADING OPTIMIZATION ==========
      // Cache for processed chart data to avoid reprocessing
      var chartDataCache = {
        elevation: null,
        speed: null,
        heartRate: null,
        cadence: null,
        temperature: null,
        sunAltitude: null,
        moonAltitude: null,
        sunMoonAltitude: null,
        power: null,
        powerZones: null,
        windSpeed: null,
        windImpact: null,
        windDirection: null,
        processed: {},
      };

      // Function to process chart data on demand
      function getChartData(dataType) {
        if (chartDataCache[dataType]) {
          return chartDataCache[dataType];
        }

        DBG.log('Processing chart data for:', dataType);
        var startTime = performance.now();

        switch (dataType) {
          case 'elevation':
            chartDataCache.elevation = xVals.map(function (x, idx) {
              return {
                x: x,
                y: coords[idx] && typeof coords[idx][2] === 'number' ? coords[idx][2] : 0,
              };
            });
            break;

          case 'speed':
            chartDataCache.speed = speedSeries
              ? xVals
                  .map(function (x, idx) {
                    return { x: x, y: speedSeries[idx] || 0 };
                  })
                  .filter(function (p) {
                    return p.y > 0;
                  })
              : [];
            break;

          case 'heartRate':
            chartDataCache.heartRate = Array.isArray(heartRates)
              ? xVals
                  .map(function (x, idx) {
                    return { x: x, y: heartRates[idx] || 0 };
                  })
                  .filter(function (p) {
                    return p.y > 0;
                  })
              : [];
            break;

          case 'cadence':
            chartDataCache.cadence = Array.isArray(cadences)
              ? xVals
                  .map(function (x, idx) {
                    return { x: x, y: cadences[idx] || 0 };
                  })
                  .filter(function (p) {
                    return p.y > 0;
                  })
              : [];
            break;

          case 'temperature':
            chartDataCache.temperature = Array.isArray(temperatures)
              ? xVals
                  .map(function (x, idx) {
                    return { x: x, y: temperatures[idx] };
                  })
                  .filter(function (p) {
                    return p.y !== null && p.y !== undefined && !isNaN(p.y);
                  })
              : [];
            break;

          case 'power':
            chartDataCache.power = Array.isArray(powers)
              ? xVals
                  .map(function (x, idx) {
                    return { x: x, y: powers[idx] || 0 };
                  })
                  .filter(function (p) {
                    return p.y > 0;
                  })
              : [];
            break;

          case 'powerZones':
            chartDataCache.powerZones = Array.isArray(powers)
              ? powers.filter(function (v) {
                  return typeof v === 'number' && v > 0;
                })
              : [];
            break;

          case 'windSpeed':
            chartDataCache.windSpeed = Array.isArray(windSpeeds)
              ? xVals
                  .map(function (x, idx) {
                    return { x: x, y: windSpeeds[idx] || 0 };
                  })
                  .filter(function (p) {
                    return p.y > 0;
                  })
              : [];
            break;

          case 'windImpact':
            chartDataCache.windImpact =
              Array.isArray(windImpacts) && Array.isArray(speedSeries)
                ? xVals
                    .map(function (x, idx) {
                      var impact = windImpacts[idx];
                      var currentSpeed = speedSeries[idx];
                      if (impact && currentSpeed && currentSpeed > 0) {
                        return { x: x, y: (impact - 1.0) * currentSpeed };
                      }
                      return null;
                    })
                    .filter(function (p) {
                      return p !== null;
                    })
                : [];
            break;

          case 'windDirection':
            // Wind direction data is processed differently (for polar chart)
            chartDataCache.windDirection = Array.isArray(windDirections) ? windDirections : [];
            break;

          case 'sunMoonAltitude':
            var sunAlts = [],
              moonAlts = [];
            if (
              typeof window.SunCalc !== 'undefined' &&
              typeof window.SunCalc.getPosition === 'function' &&
              typeof window.SunCalc.getMoonPosition === 'function' &&
              Array.isArray(timestamps) &&
              timestamps.length === coords.length
            ) {
              for (var smi = 0; smi < xVals.length; smi++) {
                var smTs = timestamps[smi];
                var smCoord = coords[smi];
                if (smTs && smCoord && isFinite(smCoord[0]) && isFinite(smCoord[1])) {
                  var smDate = new Date(smTs);
                  if (!isNaN(smDate.getTime())) {
                    var smLat = smCoord[1],
                      smLon = smCoord[0];
                    var sunPos = window.SunCalc.getPosition(smDate, smLat, smLon);
                    var moonPos = window.SunCalc.getMoonPosition(smDate, smLat, smLon);
                    sunAlts.push({
                      x: xVals[smi],
                      y: Math.round(sunPos.altitude * (180 / Math.PI) * 10) / 10,
                    });
                    moonAlts.push({
                      x: xVals[smi],
                      y: Math.round(moonPos.altitude * (180 / Math.PI) * 10) / 10,
                    });
                    continue;
                  }
                }
                sunAlts.push(null);
                moonAlts.push(null);
              }
            }
            chartDataCache.sunAltitude = sunAlts.filter(function (p) {
              return p !== null;
            });
            chartDataCache.moonAltitude = moonAlts.filter(function (p) {
              return p !== null;
            });
            chartDataCache.sunMoonAltitude = chartDataCache.sunAltitude;
            break;
        }

        var processingTime = performance.now() - startTime;
        DBG.log(
          'Chart data processed for ' + dataType + ' in ' + Math.round(processingTime) + 'ms',
          {
            dataPoints: chartDataCache[dataType] ? chartDataCache[dataType].length : 0,
          }
        );

        return chartDataCache[dataType];
      }

      if (
        effectiveWeatherEnabled &&
        weatherData &&
        weatherData.features &&
        Array.isArray(weatherData.features) &&
        weatherData.features.length > 0
      ) {
        try {
          // Add weather heatmap source
          map.addSource('fgpx-weather', { type: 'geojson', data: weatherData });

          // ========== MULTI-WEATHER VISUALIZATION ==========
          // Get admin-configured settings
          var fogThreshold = (window.FGPX && FGPX.weatherFogThreshold) || 0.3;
          var colorSnow = (window.FGPX && FGPX.weatherColorSnow) || '#ff1493';
          var colorRain = (window.FGPX && FGPX.weatherColorRain) || '#4169e1';
          var colorFog = (window.FGPX && FGPX.weatherColorFog) || '#808080';
          var colorClouds = (window.FGPX && FGPX.weatherColorClouds) || '#d3d3d3';
          var initialWeatherVisible = !!(window.FGPX && FGPX.weatherVisibleByDefault);

          DBG.log('Creating multi-weather heatmap layers', {
            points: weatherData.features.length,
            colors: { snow: colorSnow, rain: colorRain, fog: colorFog, clouds: colorClouds },
          });

          // Helper to create color ramp from base color
          function createHeatmapColorRamp(baseColor) {
            var rgb = {
              r: parseInt(baseColor.slice(1, 3), 16),
              g: parseInt(baseColor.slice(3, 5), 16),
              b: parseInt(baseColor.slice(5, 7), 16),
            };
            return [
              'interpolate',
              ['linear'],
              ['heatmap-density'],
              0,
              'rgba(255,255,255,0)',
              0.2,
              'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.4)',
              0.4,
              'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.6)',
              0.6,
              'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.75)',
              0.8,
              'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.85)',
              1,
              'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',1)',
            ];
          }

          // Base heatmap config (shared by all weather types)
          var baseHeatmapConfig = {
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 9, 3],
            'heatmap-radius': [
              'interpolate',
              ['linear'],
              ['zoom'],
              0,
              (window.FGPX && FGPX.weatherHeatmapRadius && FGPX.weatherHeatmapRadius.zoom0) || 20,
              9,
              (window.FGPX && FGPX.weatherHeatmapRadius && FGPX.weatherHeatmapRadius.zoom9) || 200,
              12,
              (window.FGPX && FGPX.weatherHeatmapRadius && FGPX.weatherHeatmapRadius.zoom12) ||
                1000,
              14,
              (window.FGPX && FGPX.weatherHeatmapRadius && FGPX.weatherHeatmapRadius.zoom14) ||
                3000,
              15,
              (window.FGPX && FGPX.weatherHeatmapRadius && FGPX.weatherHeatmapRadius.zoom15) ||
                5000,
            ],
            'heatmap-opacity': [
              'interpolate',
              ['linear'],
              ['zoom'],
              0,
              weatherOpacity,
              15,
              weatherOpacity,
              17,
              0,
            ],
          };

          // Cloud intensity: shared between 3D and classic cloud rendering (0.1–1.0).
          var cloudIntensity =
            window.FGPX && isFinite(Number(FGPX.clouds3dIntensity))
              ? Math.max(0.1, Math.min(1.0, Number(FGPX.clouds3dIntensity)))
              : 0.7;

          // Cloud-specific heatmap config: smaller radius and zoom-fading opacity so
          // clouds don't flood the screen at track-playback zoom levels (12–14).
          // Opacity peaks around zoom 9 (overview) and fades toward zero by zoom 16.
          var cloudHeatmapConfig = {
            'heatmap-intensity': baseHeatmapConfig['heatmap-intensity'],
            'heatmap-radius': [
              'interpolate',
              ['linear'],
              ['zoom'],
              0,
              15,
              9,
              60,
              11,
              100,
              13,
              140,
              15,
              160,
            ],
            'heatmap-opacity': [
              'interpolate',
              ['linear'],
              ['zoom'],
              0,
              0,
              6,
              cloudIntensity * 0.3,
              9,
              cloudIntensity * 0.65,
              11,
              cloudIntensity * 0.5,
              12,
              cloudIntensity * 0.35,
              14,
              cloudIntensity * 0.15,
              16,
              0,
            ],
          };

          // Resolve cloud mode: admin intent (never show classic if 3D chosen) vs
          // runtime eligibility (THREE + FGPXClouds3D actually loaded).
          var clouds3dAdminEnabled = !!(window.FGPX && FGPX.clouds3dEnabled);
          var clouds3dEnabled =
            clouds3dAdminEnabled &&
            !isMobileOverlayDisabled &&
            weatherOverlayPerfMode !== 'performance' &&
            typeof window.THREE !== 'undefined' &&
            typeof window.FGPXClouds3D !== 'undefined';

          if (weatherHeatmapConsolidated) {
            DBG.log('Using consolidated weather heatmap layer (phase3)');
            // When admin enabled 3D clouds, strip cloud data from the consolidated
            // filter/weight. This applies unconditionally — if THREE fails to load,
            // no clouds are shown at all rather than falling back to classic.
            var consolidatedFilter = clouds3dAdminEnabled
              ? [
                  'any',
                  ['>', ['coalesce', ['get', 'snowfall_cm'], 0], 0.1],
                  ['>', ['coalesce', ['get', 'rain_mm'], 0], 0.1],
                  ['>', ['coalesce', ['get', 'fog_intensity'], 0], fogThreshold],
                ]
              : [
                  'any',
                  ['>', ['coalesce', ['get', 'snowfall_cm'], 0], 0.1],
                  ['>', ['coalesce', ['get', 'rain_mm'], 0], 0.1],
                  ['>', ['coalesce', ['get', 'fog_intensity'], 0], fogThreshold],
                  ['>', ['coalesce', ['get', 'cloud_cover_pct'], 0], 50],
                ];
            var consolidatedWeight = clouds3dAdminEnabled
              ? [
                  'max',
                  ['/', ['coalesce', ['get', 'snowfall_cm'], 0], 5],
                  ['/', ['coalesce', ['get', 'rain_mm'], 0], 8],
                  ['coalesce', ['get', 'fog_intensity'], 0],
                ]
              : [
                  'max',
                  ['/', ['coalesce', ['get', 'snowfall_cm'], 0], 5],
                  ['/', ['coalesce', ['get', 'rain_mm'], 0], 8],
                  ['coalesce', ['get', 'fog_intensity'], 0],
                  ['/', ['coalesce', ['get', 'cloud_cover_pct'], 0], 100],
                ];
            map.addLayer({
              id: 'fgpx-weather-heatmap',
              type: 'heatmap',
              source: 'fgpx-weather',
              filter: consolidatedFilter,
              layout: {
                visibility: initialWeatherVisible ? 'visible' : 'none',
              },
              paint: Object.assign(
                {
                  'heatmap-weight': consolidatedWeight,
                  'heatmap-color': [
                    'interpolate',
                    ['linear'],
                    ['heatmap-density'],
                    0,
                    'rgba(255,255,255,0)',
                    0.2,
                    'rgba(118,146,236,0.35)',
                    0.4,
                    'rgba(108,138,226,0.55)',
                    0.6,
                    'rgba(98,130,216,0.7)',
                    0.8,
                    'rgba(88,122,206,0.85)',
                    1,
                    'rgba(78,114,196,1)',
                  ],
                },
                baseHeatmapConfig
              ),
            });
            // Add 3D cloud layer alongside the consolidated heatmap when enabled.
            if (clouds3dEnabled) {
              clouds3dEnabled = (function () {
                var cloudWeatherPoints = [];
                if (weatherData && weatherData.features) {
                  for (var cwi = 0; cwi < weatherData.features.length; cwi++) {
                    var cwf = weatherData.features[cwi];
                    if (cwf && cwf.geometry && cwf.properties) {
                      var cwCover = Number(cwf.properties.cloud_cover_pct) || 0;
                      if (cwCover > 0) {
                        cloudWeatherPoints.push({
                          lng: cwf.geometry.coordinates[0],
                          lat: cwf.geometry.coordinates[1],
                          cloudCoverPct: cwCover,
                        });
                      }
                    }
                  }
                }
                try {
                  var c3dLookupC = buildWeatherLookup({ weather: weatherData });
                  var clouds3dLayerC = window.FGPXClouds3D.create(map, {
                    quality: String((window.FGPX && FGPX.clouds3dQuality) || 'medium'),
                    intensity:
                      window.FGPX && isFinite(FGPX.clouds3dIntensity)
                        ? Math.max(0.1, Math.min(1.0, FGPX.clouds3dIntensity))
                        : 0.7,
                    weatherPoints: cloudWeatherPoints,
                    getCloudCover: function () {
                      if (!weatherVisible) {
                        return 0;
                      }
                      var cond = weatherInterpolateAt(c3dLookupC, getCurrentPlaybackSec());
                      return (cond && Number(cond.cloud_cover_pct)) || 0;
                    },
                    getSunAzimuth: function () {
                      return dayNightOverlayState && isFinite(dayNightOverlayState.azimuth)
                        ? dayNightOverlayState.azimuth
                        : 180;
                    },
                  });
                  map.addLayer(clouds3dLayerC);
                  try {
                    if (!weatherVisible) {
                      map.setLayoutProperty(clouds3dLayerC.id, 'visibility', 'none');
                    }
                  } catch (_) {}
                  registerTeardown(function () {
                    try {
                      if (map.getLayer(clouds3dLayerC.id)) {
                        map.removeLayer(clouds3dLayerC.id);
                      }
                    } catch (_) {}
                  });
                  DBG.log('3D cloud layer added (consolidated path)', {
                    quality: FGPX.clouds3dQuality,
                    points: cloudWeatherPoints.length,
                  });
                  return true;
                } catch (e) {
                  DBG.warn('3D cloud layer failed (consolidated path), no cloud fallback', e);
                  return false;
                }
              })();
            }
          } else {
            // Add snow heatmap layer (highest priority - rendered last/on top)
            map.addLayer({
              id: 'fgpx-weather-heatmap-snow',
              type: 'heatmap',
              source: 'fgpx-weather',
              filter: ['>', ['coalesce', ['get', 'snowfall_cm'], 0], 0.1],
              layout: {
                visibility: initialWeatherVisible ? 'visible' : 'none',
              },
              paint: Object.assign(
                {
                  'heatmap-weight': ['/', ['coalesce', ['get', 'snowfall_cm'], 0], 5],
                  'heatmap-color': createHeatmapColorRamp(colorSnow),
                },
                baseHeatmapConfig
              ),
            });

            // Add rain heatmap layer
            map.addLayer({
              id: 'fgpx-weather-heatmap-rain',
              type: 'heatmap',
              source: 'fgpx-weather',
              filter: [
                'all',
                ['<=', ['coalesce', ['get', 'snowfall_cm'], 0], 0.1], // No snow
                ['>', ['coalesce', ['get', 'rain_mm'], 0], 0.1],
              ],
              layout: {
                visibility: initialWeatherVisible ? 'visible' : 'none',
              },
              paint: Object.assign(
                {
                  'heatmap-weight': ['/', ['coalesce', ['get', 'rain_mm'], 0], 8],
                  'heatmap-color': createHeatmapColorRamp(colorRain),
                },
                baseHeatmapConfig
              ),
            });

            // Add fog heatmap layer
            map.addLayer({
              id: 'fgpx-weather-heatmap-fog',
              type: 'heatmap',
              source: 'fgpx-weather',
              filter: [
                'all',
                ['<=', ['coalesce', ['get', 'snowfall_cm'], 0], 0.1], // No snow
                ['<=', ['coalesce', ['get', 'rain_mm'], 0], 0.1], // No rain
                ['>', ['coalesce', ['get', 'fog_intensity'], 0], fogThreshold],
              ],
              layout: {
                visibility: initialWeatherVisible ? 'visible' : 'none',
              },
              paint: Object.assign(
                {
                  'heatmap-weight': ['coalesce', ['get', 'fog_intensity'], 0],
                  'heatmap-color': createHeatmapColorRamp(colorFog),
                },
                baseHeatmapConfig
              ),
            });

            // Add clouds heatmap layer (lowest priority) OR 3D cloud layer (opt-in)
            // clouds3dEnabled was resolved above before the consolidated/split branch.

            if (clouds3dEnabled) {
              // Collect cloud positions from weather features
              var cloudWeatherPoints = [];
              if (weatherData && weatherData.features) {
                for (var cwi = 0; cwi < weatherData.features.length; cwi++) {
                  var cwf = weatherData.features[cwi];
                  if (cwf && cwf.geometry && cwf.properties) {
                    var cwCover = Number(cwf.properties.cloud_cover_pct) || 0;
                    if (cwCover > 0) {
                      cloudWeatherPoints.push({
                        lng: cwf.geometry.coordinates[0],
                        lat: cwf.geometry.coordinates[1],
                        cloudCoverPct: cwCover,
                      });
                    }
                  }
                }
              }
              try {
                var clouds3dLayer = window.FGPXClouds3D.create(map, {
                  quality: String((window.FGPX && FGPX.clouds3dQuality) || 'medium'),
                  intensity:
                    window.FGPX && isFinite(FGPX.clouds3dIntensity)
                      ? Math.max(0.1, Math.min(1.0, FGPX.clouds3dIntensity))
                      : 0.7,
                  weatherPoints: cloudWeatherPoints,
                  getCloudCover: (function () {
                    // Build the weather lookup now, at map-load time, so it is
                    // immediately available without requiring the Simulation tab to
                    // be opened first. buildWeatherLookup / weatherInterpolateAt are
                    // both in scope here (defined later in the same startPlayer closure).
                    var c3dLookup = buildWeatherLookup({ weather: weatherData });
                    return function () {
                      if (!weatherVisible) {
                        return 0;
                      }
                      var cond3d = weatherInterpolateAt(c3dLookup, getCurrentPlaybackSec());
                      return (cond3d && Number(cond3d.cloud_cover_pct)) || 0;
                    };
                  })(),
                  getSunAzimuth: function () {
                    // reuse existing dayNightOverlayState if available
                    if (dayNightOverlayState && isFinite(dayNightOverlayState.azimuth)) {
                      return dayNightOverlayState.azimuth;
                    }
                    return 180; // noon fallback
                  },
                });
                map.addLayer(clouds3dLayer);
                try {
                  if (!weatherVisible) {
                    map.setLayoutProperty(clouds3dLayer.id, 'visibility', 'none');
                  }
                } catch (_) {}
                registerTeardown(function () {
                  try {
                    if (map.getLayer(clouds3dLayer.id)) {
                      map.removeLayer(clouds3dLayer.id);
                    }
                  } catch (_) {}
                });
                DBG.log('3D cloud layer added', {
                  quality: FGPX.clouds3dQuality,
                  points: cloudWeatherPoints.length,
                });
              } catch (clouds3dErr) {
                DBG.warn('3D cloud layer creation failed', clouds3dErr);
                clouds3dEnabled = false;
              }
            }

            // Classic cloud layer: only created when admin has NOT enabled 3D clouds.
            // If admin enabled 3D but THREE failed load, we show no clouds at all.
            if (!clouds3dAdminEnabled && !clouds3dEnabled) {
              map.addLayer({
                id: 'fgpx-weather-heatmap-clouds',
                type: 'heatmap',
                source: 'fgpx-weather',
                filter: [
                  'all',
                  ['<=', ['coalesce', ['get', 'snowfall_cm'], 0], 0.1],
                  ['<=', ['coalesce', ['get', 'rain_mm'], 0], 0.1],
                  ['<=', ['coalesce', ['get', 'fog_intensity'], 0], fogThreshold],
                  ['>', ['coalesce', ['get', 'cloud_cover_pct'], 0], 50],
                ],
                layout: {
                  visibility: initialWeatherVisible ? 'visible' : 'none',
                },
                paint: Object.assign(
                  {
                    'heatmap-weight': ['/', ['coalesce', ['get', 'cloud_cover_pct'], 0], 100],
                    'heatmap-color': createHeatmapColorRamp(colorClouds),
                  },
                  cloudHeatmapConfig
                ),
              });
            }
          }

          // Add rain circle layer for higher zoom levels (rain only, like old implementation)
          // Uses hardcoded radius sizes based on rain intensity (sharp edges, no blur)
          map.addLayer({
            id: 'fgpx-weather-circle',
            type: 'circle',
            source: 'fgpx-weather',
            minzoom: 12,
            layout: {
              visibility: initialWeatherVisible ? 'visible' : 'none',
            },
            paint: {
              // Size circle radius by RAIN intensity only (hardcoded like old implementation)
              'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                12,
                ['interpolate', ['linear'], ['get', 'rain_mm'], 0, 3, 8, 8],
                18,
                ['interpolate', ['linear'], ['get', 'rain_mm'], 0, 8, 8, 25],
              ],
              // Color by rain intensity - blue tones for rain (same as old)
              'circle-color': [
                'case',
                ['>', ['get', 'rain_mm'], 0],
                [
                  'interpolate',
                  ['linear'],
                  ['get', 'rain_mm'],
                  0.1,
                  'rgba(173,216,230,0.7)',
                  2,
                  'rgba(135,206,250,0.8)',
                  4,
                  'rgba(65,105,225,0.8)',
                  8,
                  'rgba(0,0,139,0.9)',
                ],
                'rgba(255,255,255,0)',
              ],
              // Stroke for circles (same as old)
              'circle-stroke-color': [
                'case',
                ['>', ['get', 'rain_mm'], 0],
                'rgba(255,255,255,0.8)',
                'rgba(100,100,100,0.6)',
              ],
              'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 18, 2],
              // Transition from transparent to visible (same as old)
              'circle-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13, weatherOpacity],
            },
          });

          // Add temperature visualization layer
          map.addLayer({
            id: 'fgpx-temperature-circle',
            type: 'circle',
            source: 'fgpx-weather',
            minzoom: 12,
            layout: {
              visibility: 'none', // Start hidden
            },
            paint: {
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 8, 16, 20],
              'circle-color': [
                'case',
                ['!=', ['get', 'temperature_c'], null],
                [
                  'interpolate',
                  ['linear'],
                  ['get', 'temperature_c'],
                  -20,
                  '#0000ff', // Deep blue for very cold
                  -10,
                  '#4169e1', // Royal blue
                  0,
                  '#87ceeb', // Sky blue
                  10,
                  '#90ee90', // Light green
                  20,
                  '#ffff00', // Yellow
                  25,
                  '#ffa500', // Orange
                  30,
                  '#ff4500', // Red orange
                  35,
                  '#ff0000', // Red
                  40,
                  '#8b0000', // Dark red for very hot
                ],
                '#cccccc', // Gray for missing data
              ],
              'circle-stroke-width': 1,
              'circle-stroke-color': '#ffffff',
              'circle-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13, weatherOpacity],
            },
          });

          // Add temperature text labels layer (with glyph availability check)
          var hasGlyphs = refreshWeatherTextLayerSupport(true);

          if (!hasGlyphs) {
            DBG.log('Temperature text layer skipped - no glyphs available in map style');
          } else {
            DBG.log('Temperature text layer deferred until needed');
          }

          // Add wind arrows layer - wait for colored icons to be loaded
          setTimeout(function () {
            if (map.hasImage('arrow-calm')) {
              // Main center arrow
              map.addLayer({
                id: 'fgpx-wind-arrows',
                type: 'symbol',
                source: 'fgpx-weather',
                minzoom: 12,
                filter: ['!=', ['get', 'wind_speed_kmh'], null], // Only show points with wind data
                layout: {
                  visibility: windVisible && !isMobileOverlayDisabled ? 'visible' : 'none',
                  'icon-image': [
                    'case',
                    ['!=', ['get', 'wind_speed_kmh'], null],
                    [
                      'case',
                      ['<', ['get', 'wind_speed_kmh'], 5],
                      'arrow-calm',
                      ['<', ['get', 'wind_speed_kmh'], 15],
                      'arrow-light',
                      ['<', ['get', 'wind_speed_kmh'], 25],
                      'arrow-moderate',
                      ['<', ['get', 'wind_speed_kmh'], 40],
                      'arrow-strong',
                      'arrow-very-strong',
                    ],
                    'arrow-calm',
                  ],
                  'icon-size': [
                    'interpolate',
                    ['linear'],
                    ['get', 'wind_speed_kmh'],
                    0,
                    0.5,
                    20,
                    0.8,
                    50,
                    1.2,
                  ],
                  'icon-rotate': ['get', 'wind_direction_deg'],
                  'icon-rotation-alignment': 'map',
                  'icon-allow-overlap': true,
                  'icon-ignore-placement': true,
                },
                paint: {
                  'icon-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13, weatherOpacity],
                },
              });

              if (!windSatelliteLayersEnabled) {
                DBG.log('Wind satellite layers skipped in performance mode');
              } else {
                DBG.log('Wind satellite layers deferred until needed');
              }

              // Re-apply profile once deferred wind layers exist.
              try {
                applyWeatherOverlayProfile(true);
              } catch (_) {}

              DBG.log('Wind arrows layer with circle pattern added successfully');
            } else {
              DBG.warn('Arrow icon not found, cannot add wind arrows layer');
            }
          }, 200);

          // Add wind text labels layer lazily only when needed.
          if (!hasGlyphs) {
            DBG.log('Wind text layer skipped - no glyphs available in map style');
          } else {
            DBG.log('Wind text layer deferred until needed');
          }

          DBG.log('Weather layers created:', {
            points: weatherData.features.length,
            layers: '4 heatmaps (snow/rain/fog/clouds), circles, temperature, wind',
          });
        } catch (e) {
          DBG.warn('Failed to add weather layers:', e.message);
        }
      }

      // Add day/night overlay layer if enabled
      if (window.FGPX && FGPX.daynightMapEnabled) {
        try {
          DBG.log('=== CREATING DAY/NIGHT OVERLAY LAYER ===');
          DBG.log('FGPX.daynightMapEnabled:', FGPX.daynightMapEnabled);
          DBG.log('FGPX.daynightMapColor:', FGPX.daynightMapColor);
          DBG.log('FGPX.daynightMapOpacity:', FGPX.daynightMapOpacity);

          // Set an initial day/night state for paused initial view.
          var initialNightOpacity = 0;
          try {
            if (
              typeof window.SunCalc !== 'undefined' &&
              typeof window.SunCalc.getPosition === 'function' &&
              Array.isArray(timestamps) &&
              timestamps.length > 0 &&
              Array.isArray(coords) &&
              coords.length > 0
            ) {
              var startProgress = privacyEnabled ? privacyStartP : 0;
              var startIdx = Math.max(
                0,
                Math.min(timestamps.length - 1, Math.floor(startProgress * (timestamps.length - 1)))
              );
              // Find nearest valid timestamp around start index.
              var tsIdx = startIdx;
              var scan = 0;
              while (scan < timestamps.length && !timestamps[tsIdx]) {
                tsIdx = (startIdx + scan) % timestamps.length;
                scan++;
              }
              if (timestamps[tsIdx]) {
                var dt0 = new Date(timestamps[tsIdx]);
                var lon0 =
                  coords[tsIdx] && typeof coords[tsIdx][0] === 'number'
                    ? coords[tsIdx][0]
                    : coords[0][0];
                var lat0 =
                  coords[tsIdx] && typeof coords[tsIdx][1] === 'number'
                    ? coords[tsIdx][1]
                    : coords[0][1];
                if (!isNaN(dt0.getTime()) && isFinite(lon0) && isFinite(lat0)) {
                  var pos0 = window.SunCalc.getPosition(dt0, lat0, lon0);
                  initialNightOpacity = pos0 && pos0.altitude < 0 ? 1 : 0;
                }
              }
            }
          } catch (e) {
            DBG.warn('Failed to compute initial day/night state:', e);
            initialNightOpacity = 0;
          }

          // Create a full viewport polygon for the night overlay
          var bounds = map.getBounds();
          DBG.log('Map bounds:', bounds);

          var overlayPolygon = {
            type: 'Feature',
            properties: { nightOpacity: initialNightOpacity },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [bounds.getWest(), bounds.getNorth()],
                  [bounds.getEast(), bounds.getNorth()],
                  [bounds.getEast(), bounds.getSouth()],
                  [bounds.getWest(), bounds.getSouth()],
                  [bounds.getWest(), bounds.getNorth()],
                ],
              ],
            },
          };

          var overlayData = { type: 'FeatureCollection', features: [overlayPolygon] };
          DBG.log('Overlay data created:', overlayData);

          map.addSource('fgpx-daynight-overlay', { type: 'geojson', data: overlayData });
          DBG.log('Overlay source added');

          var layerConfig = {
            id: 'fgpx-daynight-overlay',
            type: 'fill',
            source: 'fgpx-daynight-overlay',
            layout: {
              visibility: !!(window.FGPX && FGPX.daynightVisibleByDefault) ? 'visible' : 'none', // Use dedicated day/night setting
            },
            paint: {
              'fill-color': window.FGPX.daynightMapColor || '#000080',
              'fill-opacity': 0,
              'fill-opacity-transition': {
                duration: 2000,
                delay: 0,
              },
            },
          };
          DBG.log('Layer config:', layerConfig);

          // Insert before the point marker if it exists, otherwise add normally
          if (map.getLayer('fgpx-point-circle')) {
            map.addLayer(layerConfig, 'fgpx-point-circle');
          } else {
            map.addLayer(layerConfig);
          }
          DBG.log('Overlay layer added successfully');

          // Verify layer was added
          var addedLayer = map.getLayer('fgpx-daynight-overlay');
          var addedSource = map.getSource('fgpx-daynight-overlay');
          DBG.log(
            'Layer verification - Layer exists:',
            !!addedLayer,
            'Source exists:',
            !!addedSource
          );

          if (addedLayer) {
            var visibility = map.getLayoutProperty('fgpx-daynight-overlay', 'visibility');
            DBG.log('Initial layer visibility:', visibility);
          }
        } catch (e) {
          DBG.warn('Failed to add day/night overlay layer:', e);
        }
      } else {
        DBG.log(
          'Day/night overlay layer creation skipped - enabled:',
          !!(window.FGPX && FGPX.daynightMapEnabled)
        );
      }

      map.addSource('fgpx-point', { type: 'geojson', data: pointData });
      map.addLayer({
        id: 'fgpx-point-circle',
        type: 'circle',
        source: 'fgpx-point',
        paint: {
          'circle-radius': 6,
          'circle-color': '#25ceff',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });

      // Speed-based arrow overlay (static): highlights faster route segments
      // with denser/brighter directional arrows above the marker layer.
      var speedArrowsEnabled = !!(window.FGPX && FGPX.speedArrowsEnabled);
      var speedArrowSeriesReady = Array.isArray(speedSeries) && speedSeries.length > 1;
      if (
        speedArrowsEnabled &&
        !speedArrowSeriesReady &&
        dbgAllow('speed-arrows-missing-series', 10000)
      ) {
        DBG.warn(
          'Speed arrows enabled but cannot render: no usable speed series was resolved for this track'
        );
        var speedArrowsUnavailableMsg =
          (window.FGPX &&
            FGPX.i18n &&
            typeof FGPX.i18n.speedArrowsUnavailable === 'string' &&
            FGPX.i18n.speedArrowsUnavailable) ||
          '⚠ Speed arrows are enabled but this track has no usable speed/timestamp data.';
        showMapBannerOnce('speed-arrows-unavailable', speedArrowsUnavailableMsg);
      }
      if (speedArrowsEnabled && totalDistance > 0 && speedArrowSeriesReady) {
        try {
          var speedThresholdLow = Number(window.FGPX && FGPX.speedArrowsThresholdLow);
          if (!isFinite(speedThresholdLow) || speedThresholdLow <= 0) {
            speedThresholdLow = 18;
          }
          var speedThresholdHigh = Number(window.FGPX && FGPX.speedArrowsThresholdHigh);
          if (!isFinite(speedThresholdHigh) || speedThresholdHigh <= speedThresholdLow) {
            speedThresholdHigh = speedThresholdLow + 1;
          }

          var speedColorLow =
            (window.FGPX && FGPX.speedArrowsColorLow) ||
            (window.FGPX && FGPX.elevationColorFlat) ||
            '#ffd54f';
          var speedColorMid =
            (window.FGPX && FGPX.speedArrowsColorMid) ||
            (window.FGPX && FGPX.elevationColorSteep) ||
            '#ff9800';
          var speedColorHigh = (window.FGPX && FGPX.speedArrowsColorHigh) || '#ff3d00';

          var spacingLowKm = Number(window.FGPX && FGPX.speedArrowsSpacingLowKm);
          if (!isFinite(spacingLowKm) || spacingLowKm <= 0) {
            spacingLowKm = 3.5;
          }
          spacingLowKm = Math.max(0.3, Math.min(25, spacingLowKm));

          var spacingHighKm = Number(window.FGPX && FGPX.speedArrowsSpacingHighKm);
          if (!isFinite(spacingHighKm) || spacingHighKm <= 0) {
            spacingHighKm = 0.8;
          }
          spacingHighKm = Math.max(0.1, Math.min(10, spacingHighKm));
          if (spacingHighKm > spacingLowKm) {
            spacingHighKm = spacingLowKm;
          }
          var spacingMidKm = (spacingLowKm + spacingHighKm) / 2;

          var speedThemeMode =
            window.FGPX && typeof FGPX.themeMode === 'string' ? String(FGPX.themeMode) : 'system';
          var speedArrowStrokeColor =
            speedThemeMode === 'bright' ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.9)';

          function ensureSpeedArrowIcon(iconId, fillColor, strokeColor) {
            if (map.hasImage(iconId)) return;
            var ac = document.createElement('canvas');
            ac.width = 20;
            ac.height = 20;
            var actx = ac.getContext('2d');
            if (!actx) {
              throw new Error('Speed arrow canvas context unavailable');
            }
            actx.clearRect(0, 0, 20, 20);
            actx.fillStyle = fillColor;
            actx.strokeStyle = strokeColor;
            actx.lineWidth = 1.6;
            actx.beginPath();
            actx.moveTo(10, 1);
            actx.lineTo(18, 18);
            actx.lineTo(10, 14);
            actx.lineTo(2, 18);
            actx.closePath();
            actx.fill();
            actx.stroke();
            var imageData = actx.getImageData(0, 0, 20, 20);
            map.addImage(iconId, { width: 20, height: 20, data: imageData.data });
          }

          var speedArrowIcons = {
            medium: 'fgpx-speed-dir-arrow-medium',
            high: 'fgpx-speed-dir-arrow-high',
            veryHigh: 'fgpx-speed-dir-arrow-very-high',
          };

          ensureSpeedArrowIcon(speedArrowIcons.medium, speedColorLow, speedArrowStrokeColor);
          ensureSpeedArrowIcon(speedArrowIcons.high, speedColorMid, speedArrowStrokeColor);
          ensureSpeedArrowIcon(speedArrowIcons.veryHigh, speedColorHigh, speedArrowStrokeColor);

          function speedBucketForValue(speedKmh) {
            if (!isFinite(speedKmh) || speedKmh < speedThresholdLow) {
              return null;
            }
            if (speedKmh >= speedThresholdHigh) {
              return 'veryHigh';
            }
            var middleThreshold = (speedThresholdLow + speedThresholdHigh) / 2;
            return speedKmh >= middleThreshold ? 'high' : 'medium';
          }

          function speedSpacingMeters(bucket) {
            if (bucket === 'veryHigh') return spacingHighKm * 1000;
            if (bucket === 'high') return spacingMidKm * 1000;
            return spacingLowKm * 1000;
          }

          var speedArrowCollections = {
            medium: { type: 'FeatureCollection', features: [] },
            high: { type: 'FeatureCollection', features: [] },
            veryHigh: { type: 'FeatureCollection', features: [] },
          };
          var speedArrowLastPlaced = {
            medium: -Infinity,
            high: -Infinity,
            veryHigh: -Infinity,
          };
          var speedArrowFeatureLimit = Math.max(300, Math.min(2200, Math.floor(coords.length / 3)));
          var speedArrowCandidates = [];
          var speedArrowFeatureCount = 0;
          var speedArrowCapped = false;

          var speedStartD = privacyEnabled ? privacyStartD : 0;
          var speedEndD = privacyEnabled ? privacyEndD : totalDistance;

          for (var sai = 1; sai < coords.length; sai++) {
            var dNow = cumDist[sai];
            if (!isFinite(dNow) || dNow < speedStartD || dNow > speedEndD) {
              continue;
            }
            var bucket = speedBucketForValue(Number(speedSeries[sai]));
            if (!bucket) {
              continue;
            }
            var requiredSpacing = speedSpacingMeters(bucket);
            if (dNow - speedArrowLastPlaced[bucket] < requiredSpacing) {
              continue;
            }
            var pPrev = coords[sai - 1] || coords[sai];
            var pCurr = coords[sai];
            if (!pPrev || !pCurr) {
              continue;
            }
            var arrowBearing = bearingBetween([pPrev[0], pPrev[1]], [pCurr[0], pCurr[1]]);
            speedArrowCandidates.push({
              bucket: bucket,
              feature: {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [pCurr[0], pCurr[1]] },
                properties: { bearing: arrowBearing },
              },
            });
            speedArrowLastPlaced[bucket] = dNow;
          }

          var selectedCandidates = speedArrowCandidates;
          if (speedArrowCandidates.length > speedArrowFeatureLimit) {
            speedArrowCapped = true;
            selectedCandidates = [];
            var step = (speedArrowCandidates.length - 1) / (speedArrowFeatureLimit - 1);
            var lastIdx = -1;
            for (var sci = 0; sci < speedArrowFeatureLimit; sci++) {
              var rawIdx = Math.round(sci * step);
              var candidateIdx = Math.max(lastIdx + 1, rawIdx);
              if (candidateIdx >= speedArrowCandidates.length) {
                candidateIdx = speedArrowCandidates.length - 1;
              }
              if (candidateIdx <= lastIdx) {
                continue;
              }
              selectedCandidates.push(speedArrowCandidates[candidateIdx]);
              lastIdx = candidateIdx;
            }
          }
          speedArrowFeatureCount = selectedCandidates.length;
          for (var sfi = 0; sfi < selectedCandidates.length; sfi++) {
            var selected = selectedCandidates[sfi];
            speedArrowCollections[selected.bucket].features.push(selected.feature);
          }

          if (speedArrowCapped && dbgAllow('speed-arrow-cap', 10000)) {
            DBG.warn('Speed arrow count capped for performance', {
              considered: speedArrowCandidates.length,
              rendered: speedArrowFeatureCount,
              limit: speedArrowFeatureLimit,
            });
          }

          ['medium', 'high', 'veryHigh'].forEach(function (bucketName) {
            var sourceId = 'fgpx-speed-arrows-' + bucketName + '-src';
            var layerId = 'fgpx-speed-arrows-' + bucketName;
            map.addSource(sourceId, {
              type: 'geojson',
              data: speedArrowCollections[bucketName],
            });
            map.addLayer({
              id: layerId,
              type: 'symbol',
              source: sourceId,
              layout: {
                'icon-image': speedArrowIcons[bucketName],
                'icon-size': bucketName === 'veryHigh' ? 0.9 : bucketName === 'high' ? 0.82 : 0.76,
                'icon-rotate': ['coalesce', ['get', 'bearing'], 0],
                'icon-rotation-alignment': 'map',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'icon-keep-upright': false,
              },
            });
          });
        } catch (speedArrowError) {
          DBG.warn('Speed arrow rendering skipped', speedArrowError);
        }
      }

      // Text-only labels (emoji + text) using DOM markers so they work with any style
      if (!window.FGPX || FGPX.showLabels !== false) {
        try {
          var mkStyle =
            'pointer-events:none;white-space:nowrap;font:600 12px system-ui,Segoe UI,Roboto,Arial,sans-serif;color:#000;background:#fff;border-radius:6px;padding:4px 6px;box-shadow:0 1px 4px rgba(0,0,0,0.25);border:1px solid rgba(0,0,0,0.08)';
          if (isFinite(maxElevVal) && maxElevIdx >= 0 && maxElevIdx < coords.length) {
            var mkElev = document.createElement('div');
            mkElev.setAttribute('style', mkStyle);
            mkElev.textContent = '🏔 Max Elev ' + Math.round(maxElevVal) + ' m';
            new window.maplibregl.Marker({ element: mkElev, anchor: 'bottom' })
              .setLngLat(coords[maxElevIdx].slice(0, 2))
              .addTo(map);
          }
          if (maxSpeedIdx >= 0 && maxSpeedIdx < coords.length) {
            var mkSpeed = document.createElement('div');
            mkSpeed.setAttribute('style', mkStyle);
            mkSpeed.textContent =
              maxSpeedVal > 0
                ? '🚀 Max Speed ' + Math.round(maxSpeedVal * 3.6) + ' km/h'
                : '🚀 Max Speed';
            new window.maplibregl.Marker({ element: mkSpeed, anchor: 'bottom' })
              .setLngLat(coords[maxSpeedIdx].slice(0, 2))
              .addTo(map);
          }
        } catch (_) {}
      }

      // Photo thumbnails and overlay
      var photoMarkers = [];
      var photosByDist = null; // [{p, pDist, lngLat}] sorted by distance along route
      var photoDistPtr = 0;
      var overlayActive = false;
      var currentDisplayedPhoto = null; // Track the currently displayed photo for location filtering
      var shownPhotoKeys = new Set();
      var photoQueue = [];
      var mediaItems = [];
      var mediaDisplayItems = [];
      var mediaViewerActive = false;
      var mediaViewerIndex = -1;
      var mediaViewerWasPlaying = false;
      var mediaGridRendered = false; // Memoization flag: grid DOM cached after first render
      var cachedMediaGridDOM = null; // Cached grid DOM and empty state for re-use on tab switch
      var cachedMediaGridPage = -1; // Cached page index to avoid reusing stale page content
      var mediaGridPage = 0; // Current page for pagination (0-indexed)
      var mediaGridPageSize = Math.max(
        4,
        Math.min(48, Number(window.FGPX && window.FGPX.galleryPerPage) || 16)
      ); // Items per page
      var mediaRotationLeadKey = '';
      var mediaRotationTimer = null;
      var mediaAnimationHint = null;
      var lastPlaybackSec = null; // for robust crossing detection at high speeds
      var lastPlaybackDist = null; // meters; for distance-based triggering
      var photosByTime = null; // [{p: photoObject, pSec: number}...] sorted by pSec
      var photoPtr = 0; // moving pointer into photosByTime

      // MapTiler cities/landmarks (POIs from map tiles)
      var CITY_CHUNK_METERS = 10000;
      var CITY_SCAN_HALF_SIZE_PX = 90;
      var CITY_MAX_FEATURES_PER_CHUNK = 30;
      var CITY_BATCH_TIME_BUDGET_MS = 4;
      var HIGH_SPEED_CADENCE_MULTIPLIER = 40;
      var VERY_HIGH_SPEED_CADENCE_MULTIPLIER = 80;
      var cityChunks = {}; // chunkId -> [{name, lat, lon, distanceMeters, type}]
      var cityChunkLoading = {}; // chunkId -> generation token while loading
      var cityChunkGeneration = 0;
      var cityChunkPauseUntilMs = 0;
      var cityChunkPauseReason = '';

      function pauseCityChunkLoadsFor(ms, reason) {
        var waitMs = Math.max(0, Number(ms) || 0);
        if (waitMs <= 0) {
          cityChunkPauseUntilMs = 0;
          cityChunkPauseReason = String(reason || '');
          return;
        }
        var until = Date.now() + waitMs;
        if (until <= cityChunkPauseUntilMs) return;
        cityChunkPauseUntilMs = until;
        cityChunkPauseReason = String(reason || '');
      }

      function isCityChunkLoadPaused(nowMs) {
        return Number(nowMs) < Number(cityChunkPauseUntilMs || 0);
      }

      function cancelScheduledCityScan() {
        cityChunkGeneration += 1;
        cityChunkLoading = {};
      }

      function getCityChunkId(distanceMeters) {
        var dist = Math.max(0, Number(distanceMeters) || 0);
        return Math.max(0, Math.floor(dist / CITY_CHUNK_METERS));
      }

      function getLoadedCityCount() {
        var total = 0;
        for (var key in cityChunks) {
          if (
            Object.prototype.hasOwnProperty.call(cityChunks, key) &&
            Array.isArray(cityChunks[key])
          ) {
            total += cityChunks[key].length;
          }
        }
        return total;
      }

      function getCityScanBbox() {
        if (!map || typeof map.getCanvas !== 'function' || typeof map.project !== 'function') {
          return null;
        }
        try {
          var canvas = map.getCanvas();
          var width = canvas && canvas.clientWidth ? canvas.clientWidth : canvas.width || 0;
          var height = canvas && canvas.clientHeight ? canvas.clientHeight : canvas.height || 0;
          if (!width || !height) return null;
          var center = map.getCenter ? map.getCenter() : null;
          if (!center) return null;
          var centerPx = map.project([center.lng, center.lat]);
          var halfW = Math.min(CITY_SCAN_HALF_SIZE_PX, Math.max(80, Math.round(width * 0.22)));
          var halfH = Math.min(CITY_SCAN_HALF_SIZE_PX, Math.max(80, Math.round(height * 0.22)));
          return [
            [Math.max(0, centerPx.x - halfW), Math.max(0, centerPx.y - halfH)],
            [Math.min(width, centerPx.x + halfW), Math.min(height, centerPx.y + halfH)],
          ];
        } catch (_) {
          return null;
        }
      }

      // Queue city chunk work via idle time when available, with a timeout fallback
      // to guarantee we exit "loading" even under sustained frame pressure.
      function queueCityChunkLoad(fn, timeoutMs) {
        var delay = Math.max(0, Number(timeoutMs) || 0);
        var done = false;
        var idleId = null;
        var timerId = null;

        function run() {
          if (done) return;
          done = true;
          if (timerId) {
            clearTimeout(timerId);
            timerId = null;
          }
          if (idleId != null && typeof window.cancelIdleCallback === 'function') {
            try {
              window.cancelIdleCallback(idleId);
            } catch (_) {}
          }
          fn();
        }

        timerId = setTimeout(run, Math.max(24, delay));
        if (typeof window.requestIdleCallback === 'function') {
          try {
            idleId = window.requestIdleCallback(run, { timeout: Math.max(80, delay + 40) });
          } catch (_) {}
        }
        return timerId;
      }

      function ensureCityChunkLoaded(chunkId) {
        if (!simulationCitiesEnabled || !map || !coords || coords.length === 0) return;
        if (cityChunks[chunkId] || cityChunkLoading[chunkId]) return;
        var nowMs = Date.now();
        if (isCityChunkLoadPaused(nowMs)) {
          if (dbgAllow('city-chunk-paused', 2000)) {
            DBG.log('City chunk load paused', {
              chunkId: chunkId,
              remainingMs: Math.max(0, Math.round(cityChunkPauseUntilMs - nowMs)),
              reason: cityChunkPauseReason || 'cooloff',
            });
          }
          return;
        }
        // Keep city chunk scans strictly serialized to avoid parallel queryRenderedFeatures bursts.
        if (Object.keys(cityChunkLoading).length > 0) return;

        var loadGeneration = cityChunkGeneration;
        cityChunkLoading[chunkId] = loadGeneration;

        queueCityChunkLoad(function () {
          var chunkLoadStartedAt =
            typeof performance !== 'undefined' && typeof performance.now === 'function'
              ? performance.now()
              : Date.now();
          if (
            cityChunkGeneration !== loadGeneration ||
            cityChunkLoading[chunkId] !== loadGeneration
          ) {
            return;
          }

          var layerFilter = _getPlaceLayers();
          if (!Array.isArray(layerFilter) || layerFilter.length === 0) {
            cityChunks[chunkId] = [];
            delete cityChunkLoading[chunkId];
            if (dbgAllow('city-layer-missing', 4000)) {
              DBG.log('City chunk skipped (no place layers)', { chunkId: chunkId });
            }
            return;
          }
          var queryOpts = { layers: layerFilter };
          var bbox = getCityScanBbox();
          var features = [];
          try {
            features = queryOpts
              ? map.queryRenderedFeatures(bbox || undefined, queryOpts)
              : map.queryRenderedFeatures(bbox || undefined);
          } catch (error) {
            features = [];
          }
          if (!Array.isArray(features)) features = [];
          var queryDoneAt =
            typeof performance !== 'undefined' && typeof performance.now === 'function'
              ? performance.now()
              : Date.now();

          var chunkStart = chunkId * CITY_CHUNK_METERS;
          var chunkEnd = chunkStart + CITY_CHUNK_METERS;
          var loadedCities = [];
          var seenKeys = {};
          var seenNames = {};
          var index = 0;
          var batchSize = 8;
          var batchCount = 0;
          var mapCenter = null;
          try {
            mapCenter = map.getCenter ? map.getCenter() : null;
          } catch (_) {
            mapCenter = null;
          }

          function processBatch() {
            if (cityChunkGeneration !== loadGeneration) return;
            batchCount++;
            var startedAt = Date.now();
            var batchEnd = Math.min(features.length, index + batchSize);
            for (; index < batchEnd; index++) {
              var feat = features[index];
              if (!feat || !feat.geometry || feat.geometry.type !== 'Point') continue;
              var props = feat.properties || {};
              var rawClass = (
                props['class'] ||
                props['type'] ||
                props['place'] ||
                props['kind'] ||
                ''
              )
                .toString()
                .toLowerCase();
              var sl = ((feat.layer && feat.layer['source-layer']) || '').toLowerCase();
              var isPlaceFeature =
                /place|settle|locality|city|town|village|hamlet|landmark/.test(rawClass) ||
                /place|settle|locality/.test(sl);
              if (!isPlaceFeature) continue;

              var cityName = (props.name || props.name_en || props['name:en'] || '')
                .toString()
                .trim();
              if (!cityName) continue;
              var nameKey = cityName.toLowerCase();
              if (seenNames[nameKey]) continue;

              var coords2 = feat.geometry.coordinates;
              var featLon = Array.isArray(coords2) ? Number(coords2[0]) : NaN;
              var featLat = Array.isArray(coords2) ? Number(coords2[1]) : NaN;
              if (!isFinite(featLon) || !isFinite(featLat)) continue;

              // Fast guard: skip labels that are far from current camera center.
              if (mapCenter && isFinite(Number(mapCenter.lng)) && isFinite(Number(mapCenter.lat))) {
                var distFromCenter = haversineMeters(
                  [mapCenter.lng, mapCenter.lat],
                  [featLon, featLat]
                );
                if (!isFinite(distFromCenter) || distFromCenter > 15000) continue;
              }

              var nearestIdx = nearestCoordIndexFast([featLon, featLat], coords);
              var cityDistM =
                Array.isArray(cumDist) && nearestIdx < cumDist.length
                  ? Number(cumDist[nearestIdx])
                  : NaN;
              if (!isFinite(cityDistM)) continue;
              if (
                cityDistM < chunkStart - CITY_CHUNK_METERS ||
                cityDistM > chunkEnd + CITY_CHUNK_METERS
              ) {
                continue;
              }

              var nearestCoord = coords[nearestIdx];
              var trackDistanceMeters = haversineMeters(
                [nearestCoord[0], nearestCoord[1]],
                [featLon, featLat]
              );
              if (!isFinite(trackDistanceMeters) || trackDistanceMeters > 1800) {
                continue;
              }

              var dedupeKey = cityName + '|' + Math.round(cityDistM / 50);
              if (seenKeys[dedupeKey]) continue;
              seenKeys[dedupeKey] = true;
              seenNames[nameKey] = true;

              loadedCities.push({
                name: cityName,
                lat: featLat,
                lon: featLon,
                distanceMeters: cityDistM,
                type: rawClass || 'place',
              });

              if (loadedCities.length >= CITY_MAX_FEATURES_PER_CHUNK) {
                index = features.length;
                break;
              }

              if (Date.now() - startedAt >= CITY_BATCH_TIME_BUDGET_MS) {
                batchEnd = Math.min(features.length, index + 1);
              }
            }

            if (index < features.length) {
              queueCityChunkLoad(processBatch, 16);
              return;
            }

            loadedCities.sort(function (a, b) {
              return a.distanceMeters - b.distanceMeters;
            });
            cityChunks[chunkId] = loadedCities;
            delete cityChunkLoading[chunkId];

            var finishedAt =
              typeof performance !== 'undefined' && typeof performance.now === 'function'
                ? performance.now()
                : Date.now();
            var queryMs = queryDoneAt - chunkLoadStartedAt;
            var totalMs = finishedAt - chunkLoadStartedAt;

            DBG.log('City chunk loaded', {
              chunkId: chunkId,
              featuresQueried: features.length,
              loaded: loadedCities.length,
              totalCached: getLoadedCityCount(),
              layersUsed: layerFilter ? layerFilter.length : 'all',
              queryMs: Math.round(queryMs),
              totalMs: Math.round(totalMs),
              batchCount: batchCount,
            });
            if (totalMs >= 80) {
              DBG.warn('City chunk load slow', {
                chunkId: chunkId,
                featuresQueried: features.length,
                loaded: loadedCities.length,
                queryMs: Math.round(queryMs),
                totalMs: Math.round(totalMs),
                batchCount: batchCount,
              });
            }
          }

          processBatch();
        }, 0);
      }

      function ensureCityChunksForDistance(distanceMeters) {
        if (!simulationCitiesEnabled || !isFinite(Number(distanceMeters))) return;

        // Hard guard: do not start any new city chunk work while actively playing.
        if (playing) return;

        var dist = Math.max(0, Number(distanceMeters) || 0);
        var centerChunk = getCityChunkId(dist);
        ensureCityChunkLoaded(centerChunk);

        // Prefetch only one neighbor when close to chunk boundaries.
        var withinChunk = dist - centerChunk * CITY_CHUNK_METERS;
        var edgeThreshold = 1500;
        if (withinChunk <= edgeThreshold && centerChunk > 0) {
          ensureCityChunkLoaded(centerChunk - 1);
        } else if (CITY_CHUNK_METERS - withinChunk <= edgeThreshold) {
          ensureCityChunkLoaded(centerChunk + 1);
        }
      }

      /**
       * Returns a unique key for a media item, used for ordering and deduplication.
       * @param {Object} item - Media item object.
       * @param {number} fallbackIndex - Fallback index if no key found.
       * @returns {string} Unique key string.
       */
      function getMediaItemKey(item, fallbackIndex) {
        if (!item) return String(fallbackIndex || '');
        var ph = item.photo || item;
        return String(
          (ph && (ph.id || ph.fullUrl || ph.thumbUrl || ph.timestamp)) ||
            item.fullUrl ||
            item.thumbUrl ||
            item.title ||
            fallbackIndex ||
            ''
        );
      }

      /**
       * Gets the currently displayed media items (rotated or default order).
       * @returns {Array} Array of media items.
       */
      function getDisplayedMediaItems() {
        return Array.isArray(mediaDisplayItems) && mediaDisplayItems.length > 0
          ? mediaDisplayItems
          : mediaItems;
      }

      /**
       * Gets the current playback time in seconds.
       * @returns {number|null} Playback time in seconds, or null if unavailable.
       */
      function getCurrentPlaybackSec() {
        if (isFinite(Number(tOffset))) return Number(tOffset);
        if (isFinite(lastPlaybackSec)) return Number(lastPlaybackSec);
        if (
          hasTimestamps &&
          Array.isArray(timeOffsets) &&
          timeOffsets.length > 0 &&
          Array.isArray(cumDist) &&
          cumDist.length === timeOffsets.length
        ) {
          var distNow = progress * totalDistance;
          var loSec = 0,
            hiSec = timeOffsets.length - 1;
          while (loSec < hiSec) {
            var midSec = (loSec + hiSec) >>> 1;
            if (cumDist[midSec] < distNow) loSec = midSec + 1;
            else hiSec = midSec;
          }
          var resolvedSec = Number(timeOffsets[Math.max(0, loSec)]);
          return isFinite(resolvedSec) ? resolvedSec : null;
        }
        return null;
      }

      /**
       * Determines if the media queue can be rotated (more than one item and enabled).
       * @returns {boolean} True if rotation is possible.
       */
      function canRotateMediaQueue() {
        return !!(
          FGPX.photosEnabled &&
          photoQueueRotationEnabled &&
          Array.isArray(mediaItems) &&
          mediaItems.length > 1
        );
      }

      /**
       * Builds a rotated array of media items so the upcoming item is first.
       * @returns {Array} Rotated media items.
       */
      function buildRotatedMediaItems() {
        var items = Array.isArray(mediaItems) ? mediaItems.slice() : [];
        var ii;
        for (ii = 0; ii < items.length; ii++) {
          if (items[ii]) items[ii].mediaQueueState = 'upcoming';
        }
        if (!canRotateMediaQueue()) {
          if (items[0]) items[0].mediaQueueState = 'next';
          return items;
        }

        var currentDist = isFinite(progress * totalDistance) ? progress * totalDistance : 0;
        var currentSec = getCurrentPlaybackSec();
        var leadIndex = -1;

        for (ii = 0; ii < items.length; ii++) {
          var item = items[ii];
          if (!item) continue;
          var isUpcoming = false;
          if (photoOrderMode === 'time_first' && currentSec != null && isFinite(item.playbackSec)) {
            isUpcoming = item.playbackSec >= currentSec;
          } else if (isFinite(item.routeDistMeters)) {
            isUpcoming = item.routeDistMeters >= currentDist;
          } else if (
            photoOrderMode === 'time_first' &&
            isFinite(item.playbackSec) &&
            currentSec == null
          ) {
            isUpcoming = true;
          }
          if (isUpcoming) {
            leadIndex = ii;
            break;
          }
        }

        if (leadIndex < 0) {
          for (ii = 0; ii < items.length; ii++) {
            if (items[ii]) items[ii].mediaQueueState = 'passed';
          }
          return items;
        }

        var rotated =
          leadIndex > 0 ? items.slice(leadIndex).concat(items.slice(0, leadIndex)) : items;
        var upcomingCount = rotated.length - leadIndex;
        for (ii = 0; ii < rotated.length; ii++) {
          if (!rotated[ii]) continue;
          if (ii === 0) rotated[ii].mediaQueueState = 'next';
          else if (ii < upcomingCount) rotated[ii].mediaQueueState = 'upcoming';
          else rotated[ii].mediaQueueState = 'passed';
        }
        return rotated;
      }

      /**
       * Checks if the current and next media item orders match.
       * @param {Array} nextItems - Next media items.
       * @returns {boolean} True if orders match.
       */
      function mediaOrdersMatch(nextItems) {
        var currentItems = getDisplayedMediaItems();
        if (!Array.isArray(currentItems) || currentItems.length !== nextItems.length) return false;
        for (var oi = 0; oi < nextItems.length; oi++) {
          if (getMediaItemKey(currentItems[oi], oi) !== getMediaItemKey(nextItems[oi], oi)) {
            return false;
          }
        }
        return true;
      }

      /**
       * Clears the media rotation timer if set.
       */
      function clearMediaRotationTimer() {
        if (mediaRotationTimer !== null) {
          clearTimeout(mediaRotationTimer);
          mediaRotationTimer = null;
        }
      }

      /**
       * Applies a new display order to media items and triggers UI update.
       * @param {Array} nextItems - New media items order.
       * @param {Object|null} animationHint - Animation hint for UI.
       */
      function applyMediaDisplayOrder(nextItems, animationHint) {
        mediaDisplayItems = nextItems;
        mediaRotationLeadKey = nextItems.length > 0 ? getMediaItemKey(nextItems[0], 0) : '';
        mediaAnimationHint = animationHint || null;
        invalidateMediaGridCache(true);
        if (currentChartTab === 'media' && ui.mediaPanel) {
          renderMediaGrid();
        }
      }

      /**
       * Synchronizes the displayed media order with the rotated queue.
       * @param {boolean} force - If true, force update even if order matches.
       */
      function syncMediaDisplayOrder(force) {
        var nextItems = buildRotatedMediaItems();
        if (mediaOrdersMatch(nextItems)) {
          mediaDisplayItems = nextItems;
          mediaRotationLeadKey = nextItems.length > 0 ? getMediaItemKey(nextItems[0], 0) : '';
          return;
        }

        var previousLeadKey = mediaRotationLeadKey;
        var nextLeadKey = nextItems.length > 0 ? getMediaItemKey(nextItems[0], 0) : '';
        clearMediaRotationTimer();

        if (
          !force &&
          canRotateMediaQueue() &&
          previousLeadKey &&
          previousLeadKey !== nextLeadKey &&
          currentChartTab === 'media' &&
          ui.mediaPanel &&
          ui.mediaPanel.style.display !== 'none'
        ) {
          var firstCard = ui.mediaPanel.querySelector('.fgpx-media-card');
          if (firstCard) {
            firstCard.classList.add('fgpx-media-card-exiting');
            mediaRotationTimer = setTimeout(function () {
              mediaRotationTimer = null;
              applyMediaDisplayOrder(nextItems, {
                enteringKey: nextLeadKey,
                tailKey: previousLeadKey,
              });
            }, 180);
            return;
          }
        }

        applyMediaDisplayOrder(
          nextItems,
          !force && previousLeadKey !== nextLeadKey
            ? { enteringKey: nextLeadKey, tailKey: previousLeadKey }
            : null
        );
      }

      registerTeardown(function () {
        clearMediaRotationTimer();
      });

      /**
       * Builds the media items array from available photos and updates display order.
       */
      function buildMediaItems() {
        if (DBG.isEnabled()) {
          console.log('[FGPX] buildMediaItems starting', {
            photosEnabled: FGPX.photosEnabled,
            photosCount: photos.length,
            privacyEnabled: privacyEnabled,
            privacyStartD: privacyStartD,
            privacyEndD: privacyEndD,
          });
        }
        // Only build media items if photos are enabled and available
        if (!FGPX.photosEnabled) {
          mediaItems = [];
          mediaDisplayItems = [];
          return;
        }
        if (!Array.isArray(photos) || photos.length === 0) {
          mediaItems = [];
          mediaDisplayItems = [];
          return;
        }

        function estimatePhotoPlaybackSec(ph) {
          if (!ph || !ph.timestamp || isNaN(trackStartTimestampMs)) return null;
          if (typeof ph._playbackSec === 'number' && isFinite(ph._playbackSec))
            return ph._playbackSec;
          var ts = Date.parse(ph.timestamp);
          if (isNaN(ts)) return null;
          ph._playbackSec = Math.max(0, (ts - trackStartTimestampMs) / 1000);
          return ph._playbackSec;
        }

        function estimatePhotoDistanceAlong(ph) {
          if (!ph) return null;
          if (typeof ph._distAlong === 'number' && isFinite(ph._distAlong)) return ph._distAlong;

          if (
            typeof ph.lon === 'number' &&
            typeof ph.lat === 'number' &&
            Array.isArray(cumDist) &&
            cumDist.length === coords.length
          ) {
            try {
              var idx = nearestCoordIndex([ph.lon, ph.lat], coords);
              if (isFinite(idx) && idx >= 0 && idx < cumDist.length) return Number(cumDist[idx]);
            } catch (_) {}
          }

          if (
            ph.timestamp &&
            Array.isArray(timeOffsets) &&
            timeOffsets.length > 1 &&
            Array.isArray(timestamps) &&
            timestamps.length > 0 &&
            Array.isArray(cumDist) &&
            cumDist.length === coords.length
          ) {
            try {
              var ts = Date.parse(ph.timestamp);
              if (!isNaN(ts)) {
                var baseTsStr = null;
                for (var bt = 0; bt < timestamps.length; bt++) {
                  if (timestamps[bt] != null) {
                    baseTsStr = timestamps[bt];
                    break;
                  }
                }
                var t0 = baseTsStr ? Date.parse(baseTsStr) : NaN;
                if (!isNaN(t0)) {
                  var sec = (ts - t0) / 1000;
                  var lo = 0,
                    hi = timeOffsets.length - 1;
                  while (lo < hi) {
                    var mid = (lo + hi) >>> 1;
                    if (timeOffsets[mid] < sec) lo = mid + 1;
                    else hi = mid;
                  }
                  var i = Math.max(1, lo);
                  var u0 = Number(timeOffsets[i - 1]);
                  var u1 = Number(timeOffsets[i]);
                  var u = isFinite(u0) && isFinite(u1) && u1 > u0 ? (sec - u0) / (u1 - u0) : 0;
                  var d0 = Number(cumDist[i - 1]) || 0;
                  var d1 = Number(cumDist[i]) || d0;
                  return d0 + (d1 - d0) * u;
                }
              }
            } catch (_) {}
          }

          return null;
        }

        var trackLinked = [];
        var offTrack = [];
        var orderedItems = [];
        for (var mi = 0; mi < photos.length; mi++) {
          var ph = photos[mi];
          if (!ph) continue;
          var thumb = String(ph.thumbUrl || ph.fullUrl || '');
          var full = String(ph.fullUrl || ph.thumbUrl || '');
          if (!thumb && !full) continue;
          var routeDistMeters = estimatePhotoDistanceAlong(ph);
          if (privacyEnabled) {
            if (routeDistMeters == null) {
              continue;
            }
            if (routeDistMeters < privacyStartD || routeDistMeters > privacyEndD) {
              continue;
            }
          }
          var title =
            nonEmptyText(ph.caption) ||
            nonEmptyText(ph.description) ||
            nonEmptyText(ph.title) ||
            extractFilenameFromUrl(full || thumb) ||
            'Photo';
          var caption =
            nonEmptyText(ph.caption) ||
            nonEmptyText(ph.description) ||
            nonEmptyText(ph.title) ||
            '';
          var sourceLabel = '';
          if (ph.source_post_id && ph.source_post_id > 0 && ph.source_post_title)
            sourceLabel = String(ph.source_post_title);
          else if (ph.source_post_id && ph.source_post_id > 0) sourceLabel = 'Linked post';
          else sourceLabel = 'Track photo';
          var timeLabel = '';
          if (ph.timestamp) {
            var ts = new Date(ph.timestamp);
            if (!isNaN(ts.getTime())) timeLabel = ts.toLocaleString();
          }
          var playbackSec = estimatePhotoPlaybackSec(ph);
          var routeKm = '';
          if (routeDistMeters != null && isFinite(routeDistMeters)) {
            routeKm = (routeDistMeters / 1000).toFixed(2) + ' km';
          }
          var item = {
            photo: ph,
            thumbUrl: thumb,
            fullUrl: full,
            title: title,
            caption: caption,
            sourceLabel: sourceLabel,
            timeLabel: timeLabel,
            routeKm: routeKm,
            routeDistMeters: routeDistMeters,
            playbackSec: playbackSec,
            isGpsLinked: typeof ph.lat === 'number' && typeof ph.lon === 'number',
          };
          orderedItems.push(item);
          if (item.isGpsLinked) trackLinked.push(item);
          else offTrack.push(item);
        }
        mediaItems = trackLinked.concat(offTrack);
        mediaItems = photoOrderMode === 'time_first' ? orderedItems : trackLinked.concat(offTrack);
        mediaDisplayItems = mediaItems.slice();
        if (DBG.isEnabled()) {
          console.log('[FGPX] buildMediaItems complete', {
            mediaItems: mediaItems.length,
            trackLinked: trackLinked.length,
            offTrack: offTrack.length,
          });
        }
        mediaRotationLeadKey =
          mediaDisplayItems.length > 0 ? getMediaItemKey(mediaDisplayItems[0], 0) : '';
        syncMediaDisplayOrder(true);
      }

      /**
       * Opens the media viewer at the specified index.
       * @param {number} index - Index of the media item to open.
       */
      function openMediaViewerAt(index) {
        var activeMediaItems = getDisplayedMediaItems();
        if (!Array.isArray(activeMediaItems) || activeMediaItems.length === 0) return;
        if (!isFinite(index)) return;
        var safeIndex = Math.max(0, Math.min(activeMediaItems.length - 1, Number(index) | 0));
        var item = activeMediaItems[safeIndex];
        if (!item) return;
        mediaViewerWasPlaying = !!playing;
        if (mediaViewerWasPlaying) {
          setPlaying(false);
        }
        mediaViewerActive = true;
        mediaViewerIndex = safeIndex;
        overlayActive = true;
        currentDisplayedPhoto = item.photo || null;
        showOverlay(
          item.fullUrl || item.thumbUrl || '',
          item.caption || item.title || 'Photo',
          item.photo && item.photo.source_post_id,
          item.photo && item.photo.source_post_title ? item.photo.source_post_title : '',
          item.photo && item.photo.timestamp ? item.photo.timestamp : ''
        );
      }

      // Invalidate media grid cache when track data changes
      /**
       * Invalidates the cached media grid DOM, optionally preserving the current page.
       * @param {boolean} preservePage - If true, keep current page index.
       */
      function invalidateMediaGridCache(preservePage) {
        mediaGridRendered = false;
        cachedMediaGridDOM = null;
        cachedMediaGridPage = -1;
        if (!preservePage) {
          mediaGridPage = 0;
        }
      }

      /**
       * Renders the media grid UI for the current page and items.
       */
      function renderMediaGrid() {
        if (!ui.mediaPanel) return;
        var activeMediaItems = getDisplayedMediaItems();
        if (DBG.isEnabled()) {
          console.log('[FGPX] renderMediaGrid', {
            activeMediaItems: activeMediaItems.length,
            photoQueueRotationEnabled: photoQueueRotationEnabled,
            mediaGridPage: mediaGridPage,
          });
        }
        var allowMediaGridCache = !photoQueueRotationEnabled;
        // If grid already rendered, reuse cached DOM instead of rebuilding
        if (
          allowMediaGridCache &&
          mediaGridRendered &&
          cachedMediaGridDOM !== null &&
          cachedMediaGridPage === mediaGridPage
        ) {
          ui.mediaPanel.innerHTML = '';
          ui.mediaPanel.appendChild(cachedMediaGridDOM.cloneNode(true));
          var startIdx = mediaGridPage * mediaGridPageSize;
          // Re-attach event listeners to cloned cards
          var clonedCards = ui.mediaPanel.querySelectorAll('.fgpx-media-card');
          for (var ci = 0; ci < clonedCards.length; ci++) {
            (function (idx) {
              clonedCards[idx].addEventListener('click', function () {
                openMediaViewerAt(startIdx + idx);
              });
            })(ci);
          }
          // Re-attach pagination button listeners
          var prevBtn = ui.mediaPanel.querySelector('.fgpx-media-page-prev');
          var nextBtn = ui.mediaPanel.querySelector('.fgpx-media-page-next');
          if (prevBtn)
            prevBtn.addEventListener('click', function () {
              mediaGridPage = Math.max(0, mediaGridPage - 1);
              mediaGridRendered = false;
              renderMediaGrid();
            });
          if (nextBtn)
            nextBtn.addEventListener('click', function () {
              var maxPage = Math.ceil(activeMediaItems.length / mediaGridPageSize) - 1;
              mediaGridPage = Math.min(maxPage, mediaGridPage + 1);
              mediaGridRendered = false;
              renderMediaGrid();
            });
          return;
        }
        // First render: build DOM and cache it
        ui.mediaPanel.innerHTML = '';
        if (!Array.isArray(activeMediaItems) || activeMediaItems.length === 0) {
          var empty = document.createElement('div');
          empty.className = 'fgpx-media-empty';
          empty.setAttribute('role', 'status');
          empty.setAttribute('aria-label', 'Media gallery empty');
          var privacyFilteredOut = privacyEnabled && Array.isArray(photos) && photos.length > 0;
          empty.textContent = privacyFilteredOut
            ? 'No photos available in the visible privacy window.'
            : 'No photos available for this track.';
          ui.mediaPanel.appendChild(empty);
          if (allowMediaGridCache) {
            var fragEmpty = document.createDocumentFragment();
            Array.prototype.forEach.call(ui.mediaPanel.childNodes, function (cn) {
              fragEmpty.appendChild(cn.cloneNode(true));
            });
            cachedMediaGridDOM = fragEmpty;
            cachedMediaGridPage = mediaGridPage;
            mediaGridRendered = true;
          }
          return;
        }
        // Calculate pagination
        var totalItems = activeMediaItems.length;
        var totalPages = Math.ceil(totalItems / mediaGridPageSize);
        if (totalPages <= 0) totalPages = 1;
        if (mediaGridPage >= totalPages) mediaGridPage = totalPages - 1;
        if (mediaGridPage < 0) mediaGridPage = 0;
        var startIdx = mediaGridPage * mediaGridPageSize;
        var endIdx = Math.min(startIdx + mediaGridPageSize, totalItems);

        var grid = document.createElement('div');
        grid.className = 'fgpx-media-grid';
        for (var gi = startIdx; gi < endIdx; gi++) {
          (function (index) {
            var item = activeMediaItems[index];
            var itemKey = getMediaItemKey(item, index);
            var card = document.createElement('button');
            card.type = 'button';
            card.className = 'fgpx-media-card';
            card.setAttribute('data-media-key', itemKey);
            if (photoQueueRotationEnabled) {
              if (item.mediaQueueState === 'next') card.className += ' fgpx-media-card-next';
              else if (item.mediaQueueState === 'passed')
                card.className += ' fgpx-media-card-passed';
              else card.className += ' fgpx-media-card-upcoming';
              if (
                mediaAnimationHint &&
                mediaAnimationHint.enteringKey === itemKey &&
                index === startIdx
              ) {
                card.className += ' fgpx-media-card-entering';
              }
              if (
                mediaAnimationHint &&
                mediaAnimationHint.tailKey === itemKey &&
                index === endIdx - 1
              ) {
                card.className += ' fgpx-media-card-tail-entering';
              }
            }
            card.setAttribute('aria-label', 'Open photo ' + String(index + 1));
            var img = document.createElement('img');
            img.className = 'fgpx-media-card-image';
            img.src = item.thumbUrl || item.fullUrl;
            img.alt = item.title || 'Photo';
            var meta = document.createElement('div');
            meta.className = 'fgpx-media-card-meta';
            var title = document.createElement('div');
            title.className = 'fgpx-media-card-title';
            title.textContent = item.title || 'Photo';
            meta.appendChild(title);
            if (item.routeKm) {
              var km = document.createElement('div');
              km.className = 'fgpx-media-card-sub';
              km.textContent = item.routeKm;
              meta.appendChild(km);
            }
            if (item.timeLabel) {
              var time = document.createElement('div');
              time.className = 'fgpx-media-card-sub';
              time.textContent = item.timeLabel;
              meta.appendChild(time);
            }
            card.appendChild(img);
            card.appendChild(meta);
            card.addEventListener('click', function () {
              openMediaViewerAt(index);
            });
            grid.appendChild(card);
          })(gi);
        }
        ui.mediaPanel.appendChild(grid);

        // Add pagination controls if more than one page
        if (totalPages > 1) {
          var pagination = document.createElement('div');
          pagination.className = 'fgpx-media-pagination';

          var prevBtn = document.createElement('button');
          prevBtn.type = 'button';
          prevBtn.className = 'fgpx-media-page-prev';
          prevBtn.textContent = '← Previous';
          prevBtn.disabled = mediaGridPage === 0;
          prevBtn.addEventListener('click', function () {
            mediaGridPage = Math.max(0, mediaGridPage - 1);
            mediaGridRendered = false;
            renderMediaGrid();
          });
          pagination.appendChild(prevBtn);

          var pageInfo = document.createElement('span');
          pageInfo.className = 'fgpx-media-page-info';
          pageInfo.textContent = 'Page ' + (mediaGridPage + 1) + ' of ' + totalPages;
          pagination.appendChild(pageInfo);

          var nextBtn = document.createElement('button');
          nextBtn.type = 'button';
          nextBtn.className = 'fgpx-media-page-next';
          nextBtn.textContent = 'Next →';
          nextBtn.disabled = mediaGridPage >= totalPages - 1;
          nextBtn.addEventListener('click', function () {
            mediaGridPage = Math.min(totalPages - 1, mediaGridPage + 1);
            mediaGridRendered = false;
            renderMediaGrid();
          });
          pagination.appendChild(nextBtn);

          ui.mediaPanel.appendChild(pagination);
        }

        // Cache the rendered media panel for the active page.
        if (allowMediaGridCache) {
          var frag = document.createDocumentFragment();
          Array.prototype.forEach.call(ui.mediaPanel.childNodes, function (cn) {
            frag.appendChild(cn.cloneNode(true));
          });
          cachedMediaGridDOM = frag;
          cachedMediaGridPage = mediaGridPage;
          mediaGridRendered = true;
        } else {
          mediaGridRendered = false;
          cachedMediaGridDOM = null;
          cachedMediaGridPage = -1;
        }
        mediaAnimationHint = null;
      }

      /**
       * Adds photo markers to the map for each photo in the track.
       */
      function addPhotoMarkers() {
        if (!FGPX.photosEnabled || !Array.isArray(photos) || photos.length === 0) {
          return;
        }
        var tmpByDist = [];
        photos.forEach(function (ph) {
          var lngLat = null;
          var pDistApprox = null;

          if (typeof ph.lon === 'number' && typeof ph.lat === 'number') {
            lngLat = [ph.lon, ph.lat];
            // approximate along-route distance (nearest vertex)
            try {
              var idx = nearestCoordIndex(lngLat, coords);
              ph._idx = idx;
              pDistApprox = cumDist[idx] || 0;
            } catch (_) {}
          }

          // Fallback: timestamp → interpolate position
          if (!lngLat && ph.timestamp && Array.isArray(timeOffsets)) {
            try {
              var ts = Date.parse(ph.timestamp);
              if (!isNaN(ts)) {
                var baseTsStr = null;
                for (var bt = 0; bt < timestamps.length; bt++) {
                  if (timestamps[bt] != null) {
                    baseTsStr = timestamps[bt];
                    break;
                  }
                }
                var t0 = baseTsStr ? Date.parse(baseTsStr) : null;
                if (t0 != null && !isNaN(t0)) {
                  var sec = (ts - t0) / 1000;
                  var lo = 0,
                    hi = timeOffsets.length - 1;
                  while (lo < hi) {
                    var mid = (lo + hi) >>> 1;
                    if (timeOffsets[mid] < sec) lo = mid + 1;
                    else hi = mid;
                  }
                  var i = Math.max(1, lo);
                  var u0 = timeOffsets[i - 1],
                    u1 = timeOffsets[i];
                  var u = u1 > u0 ? (sec - u0) / (u1 - u0) : 0;
                  var p0 = coords[i - 1],
                    p1 = coords[i];
                  lngLat = [lerp(p0[0], p1[0], u), lerp(p0[1], p1[1], u)];
                  pDistApprox = (cumDist[i - 1] || 0) + (cumDist[i] - cumDist[i - 1]) * u;
                }
              }
            } catch (_) {}
          }

          if (!lngLat) return;

          // Privacy window filter
          if (privacyEnabled) {
            try {
              var idxP = nearestCoordIndex(lngLat, coords);
              var dAlong = cumDist[idxP] || 0;
              if (dAlong < privacyStartD || dAlong > privacyEndD) {
                return;
              }
            } catch (_) {}
          }

          // Create marker
          try {
            var el = document.createElement('div');
            el.className = 'fgpx-photo-thumb';
            el.style.cssText = 'pointer-events:auto;width:32px;height:32px;';
            var inner = document.createElement('div');
            inner.style.cssText =
              'width:32px;height:32px;border:2px solid #fff;border-radius:4px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.3);transition:transform .15s;transform-origin:center;transform:scale(1)';
            var img = document.createElement('img');
            img.src = (ph.thumbUrl || ph.fullUrl || '').toString();
            img.alt = ph.title || '';
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
            inner.appendChild(img);
            el.appendChild(inner);
            el.addEventListener('mouseenter', function () {
              inner.style.transform = 'scale(1.8)';
            });
            el.addEventListener('mouseleave', function () {
              inner.style.transform = 'scale(1)';
            });
            // Mirror hover scale for touch devices
            el.addEventListener(
              'touchstart',
              function () {
                inner.style.transform = 'scale(1.8)';
              },
              { passive: true }
            );
            el.addEventListener(
              'touchend',
              function () {
                inner.style.transform = 'scale(1)';
              },
              { passive: true }
            );
            el.addEventListener('click', function (e) {
              e.preventDefault();
              e.stopPropagation();
              showOverlay(
                ph.fullUrl || ph.thumbUrl || '',
                nonEmptyText(ph.caption) ||
                  nonEmptyText(ph.description) ||
                  nonEmptyText(ph.title) ||
                  extractFilenameFromUrl(ph.fullUrl || ph.thumbUrl || '') ||
                  'Photo',
                ph.source_post_id,
                ph.source_post_title || '',
                ph.timestamp || ''
              );
            });
            var marker = new window.maplibregl.Marker({ element: el, anchor: 'center' })
              .setLngLat(lngLat)
              .addTo(map);
            photoMarkers.push({ marker: marker, photo: ph, lngLat: lngLat, pDist: pDistApprox });
            if (pDistApprox != null) {
              tmpByDist.push({ p: ph, pDist: pDistApprox, lngLat: lngLat });
            }
          } catch (_) {}
        });

        try {
          tmpByDist.sort(function (a, b) {
            return a.pDist - b.pDist;
          });
          photosByDist = tmpByDist;
          photoDistPtr = 0;
        } catch (_) {
          photosByDist = null;
          photoDistPtr = 0;
        }

        DBG.log('addPhotoMarkers complete', { markers: photoMarkers.length });
      }

      // >>> RESTORED CALL (was missing) <<<
      buildMediaItems();
      addPhotoMarkers();

      // --- Tile prefetch functions (deferred until play button press) ---
      var tilePrefetchPromise = null;
      var preloadOverlay = null;
      var preloadCompleted = false;
      var preloadingInProgress = false;
      var preloadOverlayVisible = false;
      var zoomOverlayTimer = null;
      var countdownOverlay = null;
      var countdownTimer = null;
      var countdownHideTimer = null;
      var startupCountdownDone = false;

      try {
        preloadOverlay = document.createElement('div');
        preloadOverlay.className = 'fgpx-preload';
        preloadOverlay.style.cssText =
          'position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.15);z-index:4;pointer-events:none;color:#fff;font:600 13px system-ui,Segoe UI,Roboto,Arial,sans-serif;text-shadow:0 1px 2px rgba(0,0,0,.6);flex-direction:column;padding-top:60px';
        preloadOverlay.textContent = 'Preloading map tiles for smooth playback…';
        ui.mapEl.appendChild(preloadOverlay);
      } catch (_) {}

      try {
        countdownOverlay = document.createElement('div');
        countdownOverlay.className = 'fgpx-start-countdown';
        countdownOverlay.style.cssText =
          'position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.18);z-index:6;pointer-events:none;color:#fff;font:800 128px/1 system-ui,Segoe UI,Roboto,Arial,sans-serif;text-shadow:0 4px 18px rgba(0,0,0,.65);letter-spacing:0.03em';
        countdownOverlay.textContent = '';
        ui.mapEl.appendChild(countdownOverlay);
      } catch (_) {}

      /**
       * Clears the countdown timer for the startup overlay.
       */
      function clearCountdownTimer() {
        if (countdownTimer) {
          try {
            if (countdownTimer.cancel) {
              countdownTimer.cancel();
            } else {
              clearTimeout(countdownTimer);
            }
          } catch (_) {}
          countdownTimer = null;
        }
      }

      function clearCountdownHideTimer() {
        if (countdownHideTimer) {
          try {
            clearTimeout(countdownHideTimer);
          } catch (_) {}
          countdownHideTimer = null;
        }
      }

      function countdownVeilForValue(value) {
        var num = Number(value);
        if (num === 3) {
          return { opacity: 0.68, bgAlpha: 0.82, blurPx: 3.5 };
        }
        if (num === 2) {
          return { opacity: 0.62, bgAlpha: 0.54, blurPx: 2.5 };
        }
        if (num === 1) {
          return { opacity: 0.56, bgAlpha: 0.28, blurPx: 1.2 };
        }
        return { opacity: 0.55, bgAlpha: 0.22, blurPx: 1.0 };
      }

      /**
       * Hides the countdown overlay and resets its state.
       * @param {boolean} animateOut - Whether to fade out quickly before hiding.
       */
      function hideCountdownOverlay(animateOut) {
        clearCountdownTimer();
        clearCountdownHideTimer();
        try {
          if (!countdownOverlay) return;
          if (animateOut) {
            countdownOverlay.style.transition = 'opacity 0.18s ease';
            countdownOverlay.style.opacity = '0';
            countdownHideTimer = setTimeout(function () {
              try {
                if (!countdownOverlay) return;
                countdownOverlay.style.display = 'none';
                countdownOverlay.textContent = '';
                countdownOverlay.style.transition = 'none';
                countdownOverlay.style.transform = '';
                countdownOverlay.style.opacity = '';
                countdownOverlay.style.background = 'rgba(0,0,0,0.18)';
                countdownOverlay.style.backdropFilter = 'none';
                countdownOverlay.style.webkitBackdropFilter = 'none';
              } catch (_) {}
              countdownHideTimer = null;
            }, 190);
            return;
          }
          countdownOverlay.style.display = 'none';
          countdownOverlay.textContent = '';
          countdownOverlay.style.transition = 'none';
          countdownOverlay.style.transform = '';
          countdownOverlay.style.opacity = '';
          countdownOverlay.style.background = 'rgba(0,0,0,0.18)';
          countdownOverlay.style.backdropFilter = 'none';
          countdownOverlay.style.webkitBackdropFilter = 'none';
        } catch (_) {}
      }
      /**
       * Shows the countdown overlay with the given value and triggers animation.
       * @param {number|string} value - Value to display in the overlay.
       */
      function showCountdownOverlay(value) {
        try {
          if (!countdownOverlay) return;
          clearCountdownHideTimer();
          var veil = countdownVeilForValue(value);
          countdownOverlay.textContent = String(value);
          countdownOverlay.style.display = 'flex';
          countdownOverlay.style.background = 'rgba(0,0,0,' + veil.bgAlpha + ')';
          countdownOverlay.style.backdropFilter = 'blur(' + veil.blurPx + 'px)';
          countdownOverlay.style.webkitBackdropFilter = 'blur(' + veil.blurPx + 'px)';
          // Animate: scale pop + fade pulse so each second has a clear visual beat
          countdownOverlay.style.transition = 'none';
          countdownOverlay.style.transform = 'scale(1.35)';
          countdownOverlay.style.opacity = '1';
          // Force reflow so the starting state is applied before transition
          void countdownOverlay.offsetWidth;
          countdownOverlay.style.transition =
            'transform 0.8s cubic-bezier(0.22,1,0.36,1), opacity 0.8s ease';
          countdownOverlay.style.transform = 'scale(1)';
          countdownOverlay.style.opacity = String(veil.opacity);
        } catch (_) {}
      }
      /**
       * Determines if the startup countdown should run (only once per instance).
       * @returns {boolean} True if countdown should run.
       */
      function shouldRunStartupCountdown() {
        // Run only once per instance after initial splash-based startup.
        return !startupCountdownDone && !isRecording;
      }
      /**
       * Runs the startup countdown overlay for the given number of seconds.
       * @param {number} seconds - Number of seconds for the countdown.
       * @returns {Promise<void>} Resolves when countdown completes.
       */
      function runStartupCountdown(seconds) {
        return new Promise(function (resolve) {
          var total = Math.max(0, Math.floor(Number(seconds) || 0));
          if (total <= 0) {
            startupCountdownDone = true;
            hideCountdownOverlay();
            resolve();
            return;
          }
          var remaining = total;
          clearCountdownTimer();
          showCountdownOverlay(remaining);
          // Use RAF-based timing for frame-accurate 1-second intervals.
          // setTimeout can drift; RAF + performance.now is precise.
          var countdownStartedAt = performance.now();
          var countdownRafId = null;
          function tick() {
            var elapsed = performance.now() - countdownStartedAt;
            var nextRemaining = total - Math.floor(elapsed / 1000);
            if (nextRemaining <= 0) {
              countdownRafId = null;
              startupCountdownDone = true;
              hideCountdownOverlay(true);
              resolve();
              return;
            }
            if (nextRemaining !== remaining) {
              remaining = nextRemaining;
              showCountdownOverlay(remaining);
            }
            countdownRafId = requestAnimationFrame(tick);
          }
          countdownRafId = requestAnimationFrame(tick);
          // Store RAF id in countdownTimer slot so clearCountdownTimer can cancel
          countdownTimer = {
            _raf: countdownRafId,
            cancel: function () {
              if (countdownRafId) {
                try {
                  cancelAnimationFrame(countdownRafId);
                } catch (_) {}
                countdownRafId = null;
              }
            },
          };
        });
      }
      /**
       * Waits for the startup decode to be ready, up to a maximum wait time.
       * @param {number} maxWaitMs - Maximum wait time in milliseconds.
       * @returns {Promise<void>} Resolves when ready or timeout.
       */
      function waitForStartupDecodeReady(maxWaitMs) {
        return new Promise(function (resolve) {
          var started =
            typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
          function isReady() {
            try {
              var styleReady = typeof map.isStyleLoaded === 'function' ? map.isStyleLoaded() : true;
              var tilesReady =
                typeof map.areTilesLoaded === 'function' ? map.areTilesLoaded() : true;
              var idleNow = typeof map.isMoving === 'function' ? !map.isMoving() : true;
              return !!(styleReady && tilesReady && idleNow);
            } catch (_) {
              return true;
            }
          }
          function tick() {
            if (isReady()) {
              resolve('ready');
              return;
            }
            var now =
              typeof performance !== 'undefined' && performance.now
                ? performance.now()
                : Date.now();
            if (now - started >= maxWaitMs) {
              resolve('timeout');
              return;
            }
            try {
              requestAnimationFrame(tick);
            } catch (_) {
              setTimeout(tick, 80);
            }
          }
          tick();
        });
      }

      /**
       * Sets the text content of the preload overlay.
       * @param {string} text - Text to display.
       */
      function setPreloadOverlayText(text) {
        try {
          if (!preloadOverlay) return;
          preloadOverlay.textContent = String(text || 'Preparing playback…');
        } catch (_) {}
      }
      /**
       * Shows the preload overlay with optional text.
       * @param {string} text - Text to display in the overlay.
       */
      function showPreloadOverlay(text) {
        try {
          if (!preloadOverlay) return;
          setPreloadOverlayText(text);
          preloadOverlay.style.display = 'flex';
          preloadOverlayVisible = true;
        } catch (_) {}
      }
      /**
       * Hides the preload overlay and marks it as not visible.
       */
      function hidePreloadOverlay() {
        try {
          if (!preloadOverlay) return;
          preloadOverlay.style.display = 'none';
          preloadOverlayVisible = false;
        } catch (_) {}
      }
      registerTeardown(function () {
        hideCountdownOverlay();
      });

      /**
       * Converts longitude to tile X coordinate at a given zoom level.
       * @param {number} lon - Longitude in degrees.
       * @param {number} z - Zoom level.
       * @returns {number} Tile X coordinate.
       */
      function lon2tileX(lon, z) {
        return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
      }

      /**
       * Converts latitude to tile Y coordinate at a given zoom level.
       * @param {number} lat - Latitude in degrees.
       * @param {number} z - Zoom level.
       * @returns {number} Tile Y coordinate.
       */
      function lat2tileY(lat, z) {
        var rad = (lat * Math.PI) / 180;
        return Math.floor(
          ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z)
        );
      }

      /**
       * Builds a tile URL from a template string and tile coordinates.
       * @param {string} tpl - URL template with {z}, {x}, {y} placeholders.
       * @param {number} z - Zoom level.
       * @param {number} x - Tile X coordinate.
       * @param {number} y - Tile Y coordinate.
       * @returns {string} Tile URL.
       */
      function tileUrlFromTemplate(tpl, z, x, y) {
        return tpl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
      }

      /**
       * Returns an array of tile template metadata for all sources in the current map style.
       * @returns {Array} Array of template metadata objects.
       */
      function getPrefetchTileTemplates() {
        var out = [];
        try {
          var st = map.getStyle();
          var srcs = st && st.sources ? st.sources : {};
          for (var sid in srcs) {
            if (!Object.prototype.hasOwnProperty.call(srcs, sid)) continue;
            var sdef = srcs[sid];
            if (!sdef || (sdef.type !== 'raster' && sdef.type !== 'raster-dem')) continue;

            var foundTiles = [];
            var live = null;
            try {
              live = typeof map.getSource === 'function' ? map.getSource(sid) : null;
              if (live && Array.isArray(live.tiles) && live.tiles.length > 0) {
                foundTiles = live.tiles;
              }
            } catch (_) {}

            // Fall back to style spec tiles array (for sources with direct tiles[] definition)
            if (foundTiles.length === 0 && Array.isArray(sdef.tiles)) {
              foundTiles = sdef.tiles;
            }

            var srcMinZoom = null;
            var srcMaxZoom = null;
            if (live && isFinite(Number(live.minzoom))) srcMinZoom = Number(live.minzoom);
            else if (isFinite(Number(sdef.minzoom))) srcMinZoom = Number(sdef.minzoom);
            if (live && isFinite(Number(live.maxzoom))) srcMaxZoom = Number(live.maxzoom);
            else if (isFinite(Number(sdef.maxzoom))) srcMaxZoom = Number(sdef.maxzoom);

            for (var ti = 0; ti < foundTiles.length; ti++) {
              var t = foundTiles[ti];
              if (typeof t !== 'string' || t.indexOf('{z}') === -1) continue;
              out.push({
                sourceId: sid,
                sourceType: sdef.type,
                template: t,
                minzoom: srcMinZoom,
                maxzoom: srcMaxZoom,
                key: sid + '|' + String(ti),
              });
            }
          }
        } catch (_) {}
        return out;
      }

      /**
       * Clamps the prefetch zoom level to the allowed min/max for the tile source.
       * @param {number} rawZoom - Requested zoom level.
       * @param {Object} templateMeta - Tile template metadata.
       * @returns {number} Clamped zoom level.
       */
      function clampPrefetchZoom(rawZoom, templateMeta) {
        var minZ = 0;
        var maxZ = templateMeta && templateMeta.sourceType === 'raster-dem' ? 14 : 19;
        if (templateMeta && isFinite(Number(templateMeta.minzoom)))
          minZ = Math.round(Number(templateMeta.minzoom));
        if (templateMeta && isFinite(Number(templateMeta.maxzoom)))
          maxZ = Math.round(Number(templateMeta.maxzoom));
        if (maxZ < minZ) maxZ = minZ;
        var z = isFinite(Number(rawZoom)) ? Math.round(Number(rawZoom)) : 12;
        return Math.max(Math.max(1, minZ), Math.min(maxZ, z));
      }

      /**
       * Builds a list of tile keys to prefetch for the route at a given zoom level.
       * @param {number} z - Zoom level.
       * @param {number} maxTiles - Maximum number of tiles to prefetch.
       * @returns {Array} Array of tile key strings.
       */
      function buildPrefetchList(z, maxTiles) {
        var set = new Set();
        try {
          var PAD_TILES = 1;
          var cap = isFinite(Number(maxTiles)) ? Math.max(20, Math.round(Number(maxTiles))) : 300;
          var zUse = Math.max(1, Math.min(19, Math.round(z)));
          // Sample along the privacy window every ~700m
          var dStart = privacyEnabled ? privacyStartD : 0;
          var dEnd = privacyEnabled ? privacyEndD : totalDistance;
          var stepM = 700;
          for (var dCur = dStart; dCur <= dEnd; dCur += stepM) {
            var p = positionAtDistance(dCur);
            var x = lon2tileX(p[0], zUse);
            var y = lat2tileY(p[1], zUse);
            for (var dx = -PAD_TILES; dx <= PAD_TILES; dx++) {
              for (var dy = -PAD_TILES; dy <= PAD_TILES; dy++) {
                set.add(zUse + '/' + (x + dx) + '/' + (y + dy));
                if (set.size >= cap) break;
              }
              if (set.size >= cap) break;
            }
            if (set.size >= cap) break;
          }
          // Ensure start/end tiles
          var pS = positionAtDistance(dStart),
            pE = positionAtDistance(dEnd);
          set.add(zUse + '/' + lon2tileX(pS[0], zUse) + '/' + lat2tileY(pS[1], zUse));
          set.add(zUse + '/' + lon2tileX(pE[0], zUse) + '/' + lat2tileY(pE[1], zUse));
        } catch (_) {}
        return Array.from(set);
      }
      /**
       * Prefetches map tiles for the current route to ensure smooth playback by requesting all needed tiles along the route before animation starts.
       * Handles privacy window, zoom levels, and tile template selection. Updates UI state during preloading.
       * @returns {Promise<void>} Resolves when prefetching is complete or times out.
       */
      function prefetchTilesForRoute() {
        if (preloadCompleted || preloadingInProgress) {
          return Promise.resolve();
        }
        preloadingInProgress = true;
        /**
         * Marks the tile prefetch as finished, updates state and UI.
         * Called internally after prefetch completes or times out.
         */
        function finishPreload() {
          preloadCompleted = true;
          preloadingInProgress = false;
          updateButtonStates();
        }
        try {
          var templates = getPrefetchTileTemplates();
          if (!templates || templates.length === 0) {
            finishPreload();
            return Promise.resolve();
          }
          DBG.time('route-prefetch');
          DBG.log('route-prefetch start');
          // Disable play buttons during preloading
          updateButtonStates();
          var reqs = [];
          var timeoutMs = 3500;
          var controller = null;
          var totalTileBudget = 400;
          var perTemplateBudget = Math.max(
            60,
            Math.floor(totalTileBudget / Math.max(1, templates.length))
          );
          /**
           * For each tile template, builds the prefetch list and issues fetch requests for each tile.
           * @param {Object} meta - Tile template metadata.
           */
          templates.forEach(function (meta) {
            try {
              var zUse = clampPrefetchZoom(defaultZoomSetting, meta);
              var list = buildPrefetchList(zUse, perTemplateBudget);
              list.forEach(function (key) {
                try {
                  var parts = key.split('/');
                  var zt = parseInt(parts[0], 10),
                    xt = parseInt(parts[1], 10),
                    yt = parseInt(parts[2], 10);
                  var url = tileUrlFromTemplate(meta.template, zt, xt, yt);
                  reqs.push(
                    fetch(url, { mode: 'cors', cache: 'force-cache' }).catch(function () {
                      /* ignore */
                    })
                  );
                } catch (_) {}
              });
            } catch (_) {}
          });
          /**
           * Waits for all tile fetches to settle, then marks prefetch as finished.
           * Handles both success and error cases.
           */
          var prefetch = Promise.allSettled(reqs)
            .then(function () {
              finishPreload();
            })
            .catch(function () {
              finishPreload();
            })
            .finally(function () {
              DBG.log('route-prefetch finished');
              DBG.timeEnd('route-prefetch');
            });
          /**
           * Timeout fallback: resolves after a fixed time and marks prefetch as finished.
           * Ensures UI is not blocked if tile fetches hang.
           */
          var timed = new Promise(function (resolve) {
            setTimeout(function () {
              finishPreload();
              resolve();
            }, timeoutMs);
          });
          return Promise.race([prefetch, timed]);
        } catch (_) {
          finishPreload();
          return Promise.resolve();
        }
      }

      // Initialize with resolved promise - preloading will start on first play
      tilePrefetchPromise = Promise.resolve();

      // ---- DEM tile warmup (terrain mesh pre-population) ----
      // Separate from raster preload: warms DEM tiles at multiple zoom levels along the full route.
      // This is the definitive fix for terrain mesh gaps: MapLibre builds the 3D mesh from DEM tiles
      // at the view zoom and 1-2 levels below. Without pre-warming these, the mesh has holes
      // (showing the black background) whenever the camera moves to a not-yet-loaded area.
      var demPrefetchPromise = null;
      /**
       * Prefetches DEM (terrain) tiles for the current route at multiple zoom levels to avoid mesh gaps.
       * Only runs if terrain is enabled and DEM sources are present.
       * @returns {Promise|null} Resolves when DEM prefetch is complete, or null if not applicable.
       */
      function prefetchDemForRoute() {
        if (demPrefetchPromise) return demPrefetchPromise;
        if (!hasTerrain || !terrainSourceId || !prefetchEnabled) return null;
        try {
          var live = typeof map.getSource === 'function' ? map.getSource(terrainSourceId) : null;
          var demTpls = [];
          if (live && Array.isArray(live.tiles) && live.tiles.length > 0) {
            live.tiles.forEach(function (t) {
              if (typeof t === 'string' && t.indexOf('{z}') !== -1) demTpls.push(t);
            });
          }
          if (demTpls.length === 0) return null;
          var demMaxzoom = live && isFinite(live.maxzoom) ? Math.round(live.maxzoom) : 14;
          var z = isFinite(defaultZoomSetting) ? Math.round(defaultZoomSetting) : 12;
          var dStart = privacyEnabled ? privacyStartD : 0;
          var dEnd = privacyEnabled ? privacyEndD : totalDistance;
          // Prefetch at view zoom and immediate parent levels for stable terrain mesh transitions.
          var zLevels = [z, z - 1, z - 2]
            .map(function (lv) {
              return Math.max(1, Math.min(demMaxzoom, lv));
            })
            .filter(function (lv, i, arr) {
              return arr.indexOf(lv) === i;
            });
          var demSet = new Set();
          var maxDem = 120;
          zLevels.forEach(function (zl) {
            var PAD = zl >= z - 1 ? 2 : 3;
            var step = zl >= z - 1 ? 300 : 700;
            for (var dCur = dStart; dCur <= dEnd; dCur += step) {
              var pt = positionAtDistance(Math.min(dEnd, dCur));
              var tx = lon2tileX(pt[0], zl),
                ty = lat2tileY(pt[1], zl);
              for (var dx = -PAD; dx <= PAD; dx++) {
                for (var dy = -PAD; dy <= PAD; dy++) {
                  demSet.add(zl + '/' + (tx + dx) + '/' + (ty + dy));
                  if (demSet.size >= maxDem) break;
                }
                if (demSet.size >= maxDem) break;
              }
              if (demSet.size >= maxDem) break;
            }
          });
          DBG.log('dem-prefetch start', { keys: demSet.size, zLevels: zLevels });
          var reqs = [];
          var demController = null;
          try {
            demController = typeof AbortController !== 'undefined' ? new AbortController() : null;
          } catch (_) {
            demController = null;
          }
          if (demController) {
            try {
              setTimeout(function () {
                try {
                  demController.abort();
                } catch (_) {}
              }, 2500);
            } catch (_) {}
          }
          demSet.forEach(function (key) {
            try {
              var parts = key.split('/');
              var zt = parseInt(parts[0], 10),
                xt = parseInt(parts[1], 10),
                yt = parseInt(parts[2], 10);
              demTpls.forEach(function (tpl) {
                var opt = { mode: 'cors', cache: 'force-cache' };
                if (demController) opt.signal = demController.signal;
                reqs.push(
                  fetch(tileUrlFromTemplate(tpl, zt, xt, yt), opt).catch(function (err) {
                    DBG.log('DEM prefetch tile failed (non-critical):', err && err.message);
                  })
                );
              });
            } catch (_) {}
          });
          demPrefetchPromise = Promise.allSettled(reqs).then(function () {
            DBG.log('dem-prefetch done');
          });
          return demPrefetchPromise;
        } catch (_) {
          return null;
        }
      }

      // --- Video Recording Implementation ---
      var videoRecorder = null;
      var isRecording = false;
      var selectedQualityPreset = 'medium';
      var recordingRenderHookAttached = false;

      function ensureRecordingRenderHook() {
        if (recordingRenderHookAttached) return;
        if (!map || typeof map.on !== 'function') return;
        map.on('render', onRecordingMapRender);
        recordingRenderHookAttached = true;
      }

      function removeRecordingRenderHook() {
        if (!recordingRenderHookAttached) return;
        try {
          if (map && typeof map.off === 'function') {
            map.off('render', onRecordingMapRender);
          }
        } catch (_) {}
        recordingRenderHookAttached = false;
      }

      function onRecordingMapRender() {
        if (!isRecording || !videoRecorder || !videoRecorder.isRecording) return;
        try {
          // Keep recording photo overlay aligned with the live map camera.
          if (typeof videoRecorder.syncPhotoOverlayToCamera === 'function') {
            videoRecorder.syncPhotoOverlayToCamera();
          }
          // Push frame for manual capture mode (no-op on fallback browsers).
          videoRecorder.captureFrame(performance.now());
        } catch (_) {}
      }

      // Dynamic viewport edge prefetcher (5–10 Hz), rotation-aware
      var vpLastPrefetch = 0; // seconds
      var vpInflightKeys = new Set();
      var forwardPrefetchCooldown = 0; // seconds
      var forwardPrefetchInflight = new Set();
      var prefetchBackoffUntilMs = 0; // wall clock ms; suppress prefetch after long stalls

      // Prefetch tiles along the route ahead of current position.
      // Helps high-speed playback (50x+) where camera outpaces normal viewport prefetch.
      function prefetchForwardRoute(currentDist, speedMult) {
        try {
          var nowMs = Date.now();
          if (prefetchBackoffUntilMs > nowMs) return;
          var templates = getPrefetchTileTemplates();
          if (!templates || templates.length === 0) return;
          // Keep look-ahead bounded to avoid heavy main-thread key generation while playing.
          var lookAhead = Math.max(200, Math.min(2200, 150 * Math.max(1, speedMult || 1)));
          var dEnd = privacyEnabled ? privacyEndD : totalDistance;
          var dTarget = Math.min(dEnd, currentDist + lookAhead);
          if (dTarget <= currentDist) return;
          var zNow = Math.round(map.getZoom ? map.getZoom() : defaultZoomSetting);
          var levels = [zNow, zNow + 1];
          var sampleStep = Math.max(260, Math.floor(lookAhead / 5));
          var maxTiles = 24;
          var keys = new Set();
          for (var dCur = currentDist; dCur <= dTarget; dCur += sampleStep) {
            var pt = positionAtDistance(dCur);
            for (var li = 0; li < levels.length; li++) {
              var zl = levels[li];
              var tx = lon2tileX(pt[0], zl);
              var ty = lat2tileY(pt[1], zl);
              for (var dx = -1; dx <= 1; dx++) {
                for (var dy = -1; dy <= 1; dy++) {
                  keys.add(zl + '/' + (tx + dx) + '/' + (ty + dy));
                  if (keys.size >= maxTiles) break;
                }
                if (keys.size >= maxTiles) break;
              }
              if (keys.size >= maxTiles) break;
            }
            if (keys.size >= maxTiles) break;
          }
          keys.forEach(function (key) {
            if (forwardPrefetchInflight.has(key)) return;
            forwardPrefetchInflight.add(key);
            var parts = key.split('/');
            var zt = parseInt(parts[0], 10);
            var xt = parseInt(parts[1], 10);
            var yt = parseInt(parts[2], 10);
            templates.forEach(function (meta) {
              try {
                var z = clampPrefetchZoom(zt, meta);
                if (z !== zt) return;
                var url = tileUrlFromTemplate(meta.template, zt, xt, yt);
                fetch(url, { mode: 'cors', cache: 'force-cache' }).catch(function (err) {
                  DBG.log('Tile prefetch failed (non-critical):', err && err.message);
                });
              } catch (_) {}
            });
            // Limit set growth — clear once it gets large
            if (forwardPrefetchInflight.size > 800) forwardPrefetchInflight.clear();
          });
        } catch (_) {}
      }

      function expandBounds(b, margin, bearingDeg) {
        try {
          var sw = b.getSouthWest();
          var ne = b.getNorthEast();
          var lonSpan = ne.lng - sw.lng;
          var latSpan = ne.lat - sw.lat;
          var lonPad = lonSpan * margin;
          var latPad = latSpan * margin;
          // Shift center forward along bearing so we prefetch more tiles ahead
          var shiftLon = 0,
            shiftLat = 0;
          if (bearingDeg != null && isFinite(bearingDeg)) {
            var rad = (bearingDeg * Math.PI) / 180;
            shiftLon = Math.sin(rad) * lonPad * 0.5;
            shiftLat = Math.cos(rad) * latPad * 0.5;
          }
          return {
            sw: { lon: sw.lng - lonPad + shiftLon, lat: sw.lat - latPad + shiftLat },
            ne: { lon: ne.lng + lonPad + shiftLon, lat: ne.lat + latPad + shiftLat },
          };
        } catch (_) {
          return null;
        }
      }
      // Prefetch tiles at a specific target state (center, zoom, bearing) without relying on current map viewport.
      // Used before zoom-in animation to warm tiles at the correct zoom level.
      function prefetchTilesAtTarget(center, zoom, bearingDeg, margin) {
        try {
          var templates = getPrefetchTileTemplates();
          if (!templates || templates.length === 0) return;
          var z = Math.round(zoom);
          // Approximate viewport extent at target zoom (assume ~512px viewport at z level)
          var metersPerPx = (156543.03 * Math.cos((center[1] * Math.PI) / 180)) / Math.pow(2, z);
          var halfSpanLon = (metersPerPx * 600) / 111320; // ~600px half-width in degrees
          var halfSpanLat = halfSpanLon * 0.75; // approximate aspect ratio
          var pad = margin || 0.3;
          var lonPad = halfSpanLon * (1 + pad);
          var latPad = halfSpanLat * (1 + pad);
          // Shift forward along bearing
          var shiftLon = 0,
            shiftLat = 0;
          if (bearingDeg != null && isFinite(bearingDeg)) {
            var rad = (bearingDeg * Math.PI) / 180;
            shiftLon = Math.sin(rad) * halfSpanLon * 0.4;
            shiftLat = Math.cos(rad) * halfSpanLat * 0.4;
          }
          var ex = {
            sw: { lon: center[0] - lonPad + shiftLon, lat: center[1] - latPad + shiftLat },
            ne: { lon: center[0] + lonPad + shiftLon, lat: center[1] + latPad + shiftLat },
          };
          var levels = [z, z - 1]; // Prefetch current + parent for fallback
          var maxTiles = 500;
          var perTemplateBudget = Math.max(
            40,
            Math.floor(maxTiles / Math.max(1, templates.length))
          );
          var reqs = [];
          templates.forEach(function (meta) {
            try {
              var set = new Set();
              var levelSeen = Object.create(null);
              levels.forEach(function (zz) {
                var zClamped = clampPrefetchZoom(zz, meta);
                if (levelSeen[zClamped]) return;
                levelSeen[zClamped] = true;
                var x0 = lon2tileX(ex.sw.lon, zClamped),
                  x1 = lon2tileX(ex.ne.lon, zClamped);
                var y0 = lat2tileY(ex.ne.lat, zClamped),
                  y1 = lat2tileY(ex.sw.lat, zClamped);
                var minX = Math.min(x0, x1),
                  maxX = Math.max(x0, x1);
                var minY = Math.min(y0, y1),
                  maxY = Math.max(y0, y1);
                for (var x = minX; x <= maxX; x++) {
                  for (var y = minY; y <= maxY; y++) {
                    set.add(zClamped + '/' + x + '/' + y);
                    if (set.size >= perTemplateBudget) break;
                  }
                  if (set.size >= perTemplateBudget) break;
                }
              });
              set.forEach(function (key) {
                try {
                  var inflightKey = meta.key + '/' + key;
                  if (vpInflightKeys.has(inflightKey)) return;
                  vpInflightKeys.add(inflightKey);
                  var parts = key.split('/');
                  var zt = parseInt(parts[0], 10),
                    xt = parseInt(parts[1], 10),
                    yt = parseInt(parts[2], 10);
                  var url = tileUrlFromTemplate(meta.template, zt, xt, yt);
                  reqs.push(
                    fetch(url, { mode: 'cors', cache: 'force-cache' }).catch(function () {})
                  );
                } catch (_) {}
              });
            } catch (_) {}
          });
          Promise.allSettled(reqs).finally(function () {
            if (vpInflightKeys.size > 2000) {
              vpInflightKeys.clear();
            }
          });
        } catch (_) {}
      }
      // Async version that returns a Promise resolving when all prefetch requests complete
      // Only fetches tiles at the single target zoom level for the viewport area
      function prefetchTilesAtTargetAsync(center, zoom, bearingDeg, margin) {
        try {
          var templates = getPrefetchTileTemplates();
          if (!templates || templates.length === 0) return Promise.resolve();
          var z = Math.round(zoom);
          var centerLatRad = (center[1] * Math.PI) / 180;
          var metersPerPx = (156543.03 * Math.cos(centerLatRad)) / Math.pow(2, z);
          var viewW = Math.max(
            320,
            ui && ui.mapEl && ui.mapEl.clientWidth ? ui.mapEl.clientWidth : 1280
          );
          var viewH = Math.max(
            240,
            ui && ui.mapEl && ui.mapEl.clientHeight ? ui.mapEl.clientHeight : 720
          );
          var safetyPx = Math.max(140, Math.round(Math.max(viewW, viewH) * 0.24));
          var halfMetersX = metersPerPx * (viewW / 2 + safetyPx);
          var halfMetersY = metersPerPx * (viewH / 2 + safetyPx);
          var degPerMeterLat = 1 / 110540;
          var cosLat = Math.max(0.2, Math.cos(centerLatRad));
          var degPerMeterLon = 1 / (111320 * cosLat);
          var halfSpanLon = halfMetersX * degPerMeterLon;
          var halfSpanLat = halfMetersY * degPerMeterLat;
          var pad = typeof margin === 'number' ? Math.max(0, margin) : 0.24;
          var lonPad = halfSpanLon * (1 + pad);
          var latPad = halfSpanLat * (1 + pad);
          var ex = {
            sw: { lon: center[0] - lonPad, lat: center[1] - latPad },
            ne: { lon: center[0] + lonPad, lat: center[1] + latPad },
          };

          function queuePrefetchForZoom(zLevel, maxTilesTotal) {
            var perTemplateBudget = Math.max(
              8,
              Math.floor(maxTilesTotal / Math.max(1, templates.length))
            );
            var totalQueued = 0;
            var reqsLocal = [];
            templates.forEach(function (meta) {
              try {
                var zClamped = clampPrefetchZoom(zLevel, meta);
                var worldTiles = Math.pow(2, zClamped);
                var x0 = lon2tileX(ex.sw.lon, zClamped),
                  x1 = lon2tileX(ex.ne.lon, zClamped);
                var y0 = lat2tileY(ex.ne.lat, zClamped),
                  y1 = lat2tileY(ex.sw.lat, zClamped);
                // Clamp to valid tile range and avoid anti-meridian wrap explosions.
                var minX = Math.max(0, Math.min(worldTiles - 1, Math.min(x0, x1)));
                var maxX = Math.max(0, Math.min(worldTiles - 1, Math.max(x0, x1)));
                var minY = Math.max(0, Math.min(worldTiles - 1, Math.min(y0, y1)));
                var maxY = Math.max(0, Math.min(worldTiles - 1, Math.max(y0, y1)));
                var queuedForTemplate = 0;
                for (var x = minX; x <= maxX; x++) {
                  for (var y = minY; y <= maxY; y++) {
                    if (queuedForTemplate >= perTemplateBudget || totalQueued >= maxTilesTotal)
                      break;
                    var inflightKey = meta.key + '/' + zClamped + '/' + x + '/' + y;
                    if (vpInflightKeys.has(inflightKey)) continue;
                    vpInflightKeys.add(inflightKey);
                    var url = tileUrlFromTemplate(meta.template, zClamped, x, y);
                    reqsLocal.push(
                      fetch(url, { mode: 'cors', cache: 'force-cache' }).catch(function () {})
                    );
                    queuedForTemplate++;
                    totalQueued++;
                  }
                  if (queuedForTemplate >= perTemplateBudget || totalQueued >= maxTilesTotal) break;
                }
              } catch (_) {}
            });
            return reqsLocal;
          }

          // Only target zoom level — no extra levels.
          // Keep request volume bounded to avoid runaway network usage.
          var reqs = queuePrefetchForZoom(z, 320);
          DBG.log('prefetch tiles at target zoom', {
            z: z,
            tiles: reqs.length,
            maxTilesTotal: 320,
            viewW: viewW,
            viewH: viewH,
            margin: pad,
            safetyPx: safetyPx,
            bearing: bearingDeg,
          });
          return Promise.allSettled(reqs).then(function () {
            if (vpInflightKeys.size > 2000) {
              vpInflightKeys.clear();
            }
          });
        } catch (_) {
          return Promise.resolve();
        }
      }
      /**
       * Prefetches map tiles for the current viewport area at the current or next zoom level.
       * Used to ensure smooth playback by requesting all needed tiles for the visible map area.
       * @param {number} [margin] - Margin to expand bounds (default 0.2).
       * @param {boolean} [extraZoom] - If true, also prefetch one zoom level higher.
       * @param {number} [bearingDeg] - Map bearing in degrees for rotation-aware prefetch.
       */
      function prefetchViewportTiles(margin, extraZoom, bearingDeg) {
        try {
          var nowMs = Date.now();
          if (prefetchBackoffUntilMs > nowMs) return;
          var templates = getPrefetchTileTemplates();
          if (!templates || templates.length === 0) return;
          var b = map.getBounds();
          if (!b) return;
          var ex = expandBounds(b, margin || 0.2, bearingDeg);
          if (!ex) return;
          var zNow = Math.round(map.getZoom ? map.getZoom() : defaultZoomSetting);
          var levels = [zNow];
          if (extraZoom === true) {
            levels.push(zNow + 1);
          }
          var maxTiles = extraZoom ? 180 : 110;
          var perTemplateBudget = Math.max(
            40,
            Math.floor(maxTiles / Math.max(1, templates.length))
          );
          var reqs = [];
          templates.forEach(function (meta) {
            try {
              var set = new Set();
              var levelSeen = Object.create(null);
              levels.forEach(function (zz) {
                var z = clampPrefetchZoom(zz, meta);
                if (levelSeen[z]) return;
                levelSeen[z] = true;
                var x0 = lon2tileX(ex.sw.lon, z),
                  x1 = lon2tileX(ex.ne.lon, z);
                var y0 = lat2tileY(ex.ne.lat, z),
                  y1 = lat2tileY(ex.sw.lat, z); // note: TMS origin top-left
                var minX = Math.min(x0, x1),
                  maxX = Math.max(x0, x1);
                var minY = Math.min(y0, y1),
                  maxY = Math.max(y0, y1);
                for (var x = minX; x <= maxX; x++) {
                  for (var y = minY; y <= maxY; y++) {
                    set.add(z + '/' + x + '/' + y);
                    if (set.size >= perTemplateBudget) break;
                  }
                  if (set.size >= perTemplateBudget) break;
                }
              });
              set.forEach(function (key) {
                try {
                  var inflightKey = meta.key + '/' + key;
                  if (vpInflightKeys.has(inflightKey)) return;
                  vpInflightKeys.add(inflightKey);
                  var parts = key.split('/');
                  var zt = parseInt(parts[0], 10),
                    xt = parseInt(parts[1], 10),
                    yt = parseInt(parts[2], 10);
                  var url = tileUrlFromTemplate(meta.template, zt, xt, yt);
                  reqs.push(
                    fetch(url, { mode: 'cors', cache: 'force-cache' }).catch(function () {})
                  );
                } catch (_) {}
              });
            } catch (_) {}
          });
          Promise.allSettled(reqs).finally(function () {
            // Trim inflight set occasionally
            if (vpInflightKeys.size > 2000) {
              vpInflightKeys.clear();
            }
          });
        } catch (_) {}
      }
      // Build time-indexed photo list for efficient triggering
      try {
        if (
          Array.isArray(photos) &&
          photos.length > 0 &&
          hasTimestamps &&
          Array.isArray(timeOffsets) &&
          timestamps &&
          timestamps.length > 0
        ) {
          // Use the first non-null track timestamp as base (robust to leading nulls)
          var baseTsStr0 = null;
          for (var bt0 = 0; bt0 < timestamps.length; bt0++) {
            if (timestamps[bt0] != null) {
              baseTsStr0 = timestamps[bt0];
              break;
            }
          }
          var startTs0 = baseTsStr0 ? Date.parse(baseTsStr0) : NaN;
          if (!isNaN(startTs0)) {
            var tmp = [];
            for (var pi0 = 0; pi0 < photos.length; pi0++) {
              var p0 = photos[pi0];
              if (!p0 || !p0.timestamp) continue;
              var pts0 = Date.parse(p0.timestamp);
              if (!isNaN(pts0)) {
                var pSec0 = Math.max(0, (pts0 - startTs0) / 1000);
                tmp.push({ p: p0, pSec: pSec0 });
              }
            }
            tmp.sort(function (a, b) {
              return a.pSec - b.pSec;
            });
            photosByTime = tmp;
            photoPtr = 0;
          }
        }
      } catch (_) {}
      function lowerBoundPhotoIdx(sec) {
        try {
          if (!photosByTime || photosByTime.length === 0) return 0;
          var lo = 0,
            hi = photosByTime.length;
          while (lo < hi) {
            var mid = (lo + hi) >>> 1;
            if (photosByTime[mid].pSec < sec) lo = mid + 1;
            else hi = mid;
          }
          return lo;
        } catch (_) {
          return 0;
        }
      }

      // Fullscreen overlay element
      // Ensure map element can contain absolutely positioned overlay
      try {
        if (window.getComputedStyle && window.getComputedStyle(ui.mapEl).position === 'static') {
          ui.mapEl.style.position = 'relative';
        }
      } catch (_) {}
      // Live metrics overlays (speed, distance, elevation) - optional via settings
      var hudEnabled = !(window.FGPX && FGPX.hudEnabled === false);
      var metricsSpeedLabel = null,
        metricsDistLabel = null,
        metricsElevLabel = null;
      var dirLabel = null; // bottom direction overlay
      if (hudEnabled) {
        var metricsBoxStyle =
          'position:absolute;top:6px;background:rgba(0,0,0,0.50);color:#fff;border-radius:6px;padding:4px 8px;font:600 12px system-ui,Segoe UI,Roboto,Arial,sans-serif;pointer-events:none;z-index:1;white-space:nowrap;';
        var metricsSpeedBox = document.createElement('div');
        metricsSpeedBox.className = 'fgpx-metrics-speed';
        metricsSpeedBox.style.cssText = metricsBoxStyle + 'left:12%;';
        metricsSpeedLabel = document.createElement('span');
        metricsSpeedLabel.textContent = '0 km/h';
        metricsSpeedBox.appendChild(metricsSpeedLabel);
        ui.mapEl.appendChild(metricsSpeedBox);

        var metricsDistBox = document.createElement('div');
        metricsDistBox.className = 'fgpx-metrics-distance';
        metricsDistBox.style.cssText = metricsBoxStyle + 'left:50%;transform:translateX(-50%);';
        metricsDistLabel = document.createElement('span');
        metricsDistLabel.textContent = '0.00 km';
        metricsDistBox.appendChild(metricsDistLabel);
        ui.mapEl.appendChild(metricsDistBox);

        var metricsElevBox = document.createElement('div');
        metricsElevBox.className = 'fgpx-metrics-elevation';
        metricsElevBox.style.cssText = metricsBoxStyle + 'right:12%;';
        metricsElevLabel = document.createElement('span');
        metricsElevLabel.textContent = '+0° / 0m';
        metricsElevBox.appendChild(metricsElevLabel);
        ui.mapEl.appendChild(metricsElevBox);
        // Bottom direction overlay (bearing and cardinal)
        var dirBox = document.createElement('div');
        dirBox.className = 'fgpx-direction';
        dirBox.style.cssText =
          'position:absolute;bottom:6px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.50);color:#fff;border-radius:6px;padding:4px 10px;font:600 12px system-ui,Segoe UI,Roboto,Arial,sans-serif;pointer-events:none;z-index:1;white-space:nowrap;';
        dirLabel = document.createElement('span');
        dirLabel.textContent = '0° — N';
        dirBox.appendChild(dirLabel);
        ui.mapEl.appendChild(dirBox);
      }

      var overlay = document.createElement('div');
      overlay.className = 'fgpx-photo-overlay';
      overlay.style.cssText =
        'position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:#2a2a2a;z-index:9999;pointer-events:auto;opacity:0;transition:opacity .25s ease';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'Photo viewer');
      overlay.setAttribute('aria-hidden', 'true');
      var overlayImg = document.createElement('img');
      overlayImg.style.cssText =
        'max-width:90%;max-height:100%;object-fit:contain;box-shadow:0 2px 10px rgba(0,0,0,.5)';
      overlay.appendChild(overlayImg);
      var overlayCaption = document.createElement('div');
      overlayCaption.style.cssText =
        'position:absolute;right:12px;bottom:10px;color:#fff;background:rgba(0,0,0,0.5);padding:6px 8px;border-radius:4px;font:500 12px system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:50%;pointer-events:none;display:none';
      overlay.appendChild(overlayCaption);
      var overlaySource = document.createElement('div');
      overlaySource.style.cssText =
        'position:absolute;left:12px;top:10px;color:#fff;background:rgba(0,0,0,0.5);padding:6px 8px;border-radius:4px;font:500 11px system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:50%;pointer-events:none;display:none';
      overlay.appendChild(overlaySource);
      var overlayTime = document.createElement('div');
      overlayTime.style.cssText =
        'position:absolute;left:12px;bottom:10px;color:#fff;background:rgba(0,0,0,0.5);padding:6px 8px;border-radius:4px;font:500 11px system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:55%;pointer-events:none;display:none';
      overlay.appendChild(overlayTime);
      var overlayClose = document.createElement('button');
      overlayClose.className = 'fgpx-photo-overlay-close';
      overlayClose.type = 'button';
      overlayClose.textContent = '×';
      overlayClose.setAttribute('aria-label', 'Close photo viewer');
      overlayClose.style.cssText =
        'position:absolute;top:12px;right:14px;width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,0.45);background:rgba(0,0,0,0.55);color:#fff;font-size:24px;line-height:1;cursor:pointer;z-index:3;display:flex;align-items:center;justify-content:center';
      overlay.appendChild(overlayClose);
      ui.mapEl.appendChild(overlay);
      var overlayLastFocusedElement = null;
      function showOverlay(url, caption, sourcePostId, sourcePostTitle, photoTimestamp) {
        DBG.log('overlay show', {
          url: url,
          caption: !!caption,
          sourcePostId: sourcePostId,
          sourcePostTitle: sourcePostTitle,
          photoTimestamp: photoTimestamp,
        });

        // Clear any existing map layer first to prevent distorted frames
        if (videoRecorder && videoRecorder.isRecording) {
          videoRecorder.clearPhotoOverlay();
        }

        overlayImg.src = url;
        overlayCaption.textContent = caption || '';
        overlayCaption.style.display = caption ? 'block' : 'none';

        // Show photo source for both embed and track photos
        if (sourcePostId && sourcePostId > 0 && sourcePostTitle) {
          overlaySource.textContent = '📷 ' + sourcePostTitle;
          overlaySource.style.display = 'block';
        } else if (sourcePostId && sourcePostId > 0) {
          overlaySource.textContent = '📷 Photo from linked post';
          overlaySource.style.display = 'block';
        } else if (sourcePostId === 0 || (sourcePostId && sourcePostId < 1)) {
          overlaySource.textContent = '📷 Photo from track';
          overlaySource.style.display = 'block';
        } else {
          overlaySource.textContent = '';
          overlaySource.style.display = 'none';
        }

        if (photoTimestamp) {
          var dt = new Date(photoTimestamp);
          if (!isNaN(dt.getTime())) {
            overlayTime.textContent = '🕒 ' + dt.toLocaleString();
            overlayTime.style.display = 'block';
          } else {
            overlayTime.textContent = '';
            overlayTime.style.display = 'none';
          }
        } else {
          overlayTime.textContent = '';
          overlayTime.style.display = 'none';
        }

        overlay.style.display = 'flex';
        overlay.setAttribute('aria-hidden', 'false');
        overlayLastFocusedElement = document.activeElement;

        // During recording, use dark grey background to match map layer
        if (videoRecorder && videoRecorder.isRecording) {
          overlay.style.background = '#2a2a2a'; // Dark grey to match map layer
        } else {
          overlay.style.background = 'rgba(0,0,0,0.6)'; // Semi-transparent as normal
        }

        try {
          overlay.offsetHeight;
        } catch (_) {}
        overlay.style.opacity = '1';
        try {
          overlayClose.focus({ preventScroll: true });
        } catch (_) {
          try {
            overlayClose.focus();
          } catch (__) {}
        }
      }
      function hideOverlay() {
        DBG.log('overlay hide start');

        // Force clear map layer immediately when hiding starts
        if (videoRecorder) {
          DBG.log('hideOverlay: Immediately clearing map layer at start');
          videoRecorder.clearPhotoOverlay();
        }

        return new Promise(function (resolve) {
          try {
            overlay.style.opacity = '0';
            var doneFired = false;
            var done = function (ev) {
              if (ev && ev.propertyName && ev.propertyName !== 'opacity') return;
              if (doneFired) return;
              doneFired = true;
              overlay.style.display = 'none';
              overlay.setAttribute('aria-hidden', 'true');
              overlayImg.src = '';
              overlayCaption.textContent = '';
              overlayCaption.style.display = 'none';
              overlaySource.textContent = '';
              overlaySource.style.display = 'none';
              overlayTime.textContent = '';
              overlayTime.style.display = 'none';
              // Reset background to default
              overlay.style.background = 'rgba(0,0,0,0.6)';
              overlay.removeEventListener('transitionend', done);
              // Clear overlay from map canvas if recording
              DBG.log('hideOverlay: videoRecorder exists?', !!videoRecorder);
              DBG.log(
                'hideOverlay: isRecording?',
                videoRecorder ? videoRecorder.isRecording : 'N/A'
              );
              if (videoRecorder && videoRecorder.isRecording) {
                DBG.log('hideOverlay: About to clear photo overlay from map');
                videoRecorder.clearPhotoOverlay();
              } else if (videoRecorder) {
                // Force clear even if not recording to ensure cleanup
                DBG.log(
                  'hideOverlay: Force clearing photo overlay (not recording but videoRecorder exists)'
                );
                videoRecorder.clearPhotoOverlay();
              }
              DBG.log('overlay hide done');
              if (
                overlayLastFocusedElement &&
                typeof overlayLastFocusedElement.focus === 'function' &&
                document.contains(overlayLastFocusedElement)
              ) {
                try {
                  overlayLastFocusedElement.focus({ preventScroll: true });
                } catch (_) {
                  try {
                    overlayLastFocusedElement.focus();
                  } catch (__) {}
                }
              }
              overlayLastFocusedElement = null;
              resolve();
            };
            overlay.addEventListener('transitionend', done);
            setTimeout(function () {
              try {
                done();
              } catch (_) {}
            }, 500); // Increased timeout to ensure map layer is cleared
          } catch (_) {
            overlay.style.display = 'none';
            overlay.setAttribute('aria-hidden', 'true');
            overlayImg.src = '';
            overlayCaption.textContent = '';
            overlayCaption.style.display = 'none';
            overlaySource.textContent = '';
            overlaySource.style.display = 'none';
            overlayTime.textContent = '';
            overlayTime.style.display = 'none';
            // Reset background to default
            overlay.style.background = 'rgba(0,0,0,0.6)';
            // Clear overlay from map canvas if recording
            DBG.log('hideOverlay (catch): videoRecorder exists?', !!videoRecorder);
            DBG.log(
              'hideOverlay (catch): isRecording?',
              videoRecorder ? videoRecorder.isRecording : 'N/A'
            );
            if (videoRecorder && videoRecorder.isRecording) {
              DBG.log('hideOverlay (catch): About to clear photo overlay from map');
              videoRecorder.clearPhotoOverlay();
            } else if (videoRecorder) {
              // Force clear even if not recording to ensure cleanup
              DBG.log(
                'hideOverlay (catch): Force clearing photo overlay (not recording but videoRecorder exists)'
              );
              videoRecorder.clearPhotoOverlay();
            }
            if (
              overlayLastFocusedElement &&
              typeof overlayLastFocusedElement.focus === 'function' &&
              document.contains(overlayLastFocusedElement)
            ) {
              try {
                overlayLastFocusedElement.focus({ preventScroll: true });
              } catch (_) {
                try {
                  overlayLastFocusedElement.focus();
                } catch (__) {}
              }
            }
            overlayLastFocusedElement = null;
            resolve();
          }
        });
      }

      function renderOverlayToMapCanvas() {
        // This function is now just a wrapper for renderOverlayToCanvas
        renderOverlayToCanvas();
      }

      function renderOverlayToCanvas() {
        try {
          var overlay = ui.mapEl.querySelector('.fgpx-photo-overlay');
          DBG.log('renderOverlayToCanvas', {
            hasOverlay: !!overlay,
            display: overlay ? overlay.style.display : 'none',
            opacity: overlay ? overlay.style.opacity : '0',
            computedDisplay: overlay ? getComputedStyle(overlay).display : 'none',
            computedOpacity: overlay ? getComputedStyle(overlay).opacity : '0',
          });

          if (!overlay) {
            return;
          }

          // Check both inline styles and computed styles
          var isVisible =
            overlay.style.display !== 'none' &&
            overlay.style.opacity !== '0' &&
            getComputedStyle(overlay).display !== 'none' &&
            getComputedStyle(overlay).opacity !== '0';

          if (!isVisible) {
            DBG.log('Overlay not visible', {
              inlineDisplay: overlay.style.display,
              inlineOpacity: overlay.style.opacity,
              computedDisplay: getComputedStyle(overlay).display,
              computedOpacity: getComputedStyle(overlay).opacity,
            });
            return;
          }

          DBG.log('Overlay is visible, rendering to canvas');

          var mapCanvas = map.getCanvas();
          var ctx = mapCanvas.getContext('2d');

          // Save current canvas state
          ctx.save();

          // Draw overlay background
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(0, 0, mapCanvas.width, mapCanvas.height);

          // Draw overlay image
          var img = overlay.querySelector('img');
          DBG.log('Image check', {
            hasImg: !!img,
            src: img ? img.src : 'none',
            complete: img ? img.complete : false,
            naturalWidth: img ? img.naturalWidth : 0,
            naturalHeight: img ? img.naturalHeight : 0,
          });

          if (img && img.complete && img.naturalWidth > 0) {
            // Calculate proper scaling
            var imgAspect = img.naturalWidth / img.naturalHeight;
            var canvasAspect = mapCanvas.width / mapCanvas.height;

            var drawWidth, drawHeight, drawX, drawY;
            if (imgAspect > canvasAspect) {
              // Image is wider than canvas
              drawWidth = mapCanvas.width;
              drawHeight = mapCanvas.width / imgAspect;
              drawX = 0;
              drawY = (mapCanvas.height - drawHeight) / 2;
            } else {
              // Image is taller than canvas
              drawHeight = mapCanvas.height;
              drawWidth = mapCanvas.height * imgAspect;
              drawX = (mapCanvas.width - drawWidth) / 2;
              drawY = 0;
            }

            DBG.log('Drawing image', {
              drawX: drawX,
              drawY: drawY,
              drawWidth: drawWidth,
              drawHeight: drawHeight,
            });
            ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

            // Test: Draw a red rectangle to verify canvas drawing is working
            ctx.fillStyle = 'red';
            ctx.fillRect(10, 10, 50, 50);
            DBG.log('Drew test red rectangle');
          } else {
            DBG.log('Image not ready for drawing');
          }

          // Draw caption
          var caption = overlay.querySelector('div');
          DBG.log('Caption check', {
            hasCaption: !!caption,
            textContent: caption ? caption.textContent : 'none',
            hasText: caption && caption.textContent ? true : false,
          });

          if (caption && caption.textContent) {
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(mapCanvas.width - 200, mapCanvas.height - 40, 180, 30);
            ctx.fillStyle = '#fff';
            ctx.font = '12px system-ui, Segoe UI, Roboto, Arial, sans-serif';
            ctx.fillText(caption.textContent, mapCanvas.width - 190, mapCanvas.height - 20);
            DBG.log('Drew caption', { text: caption.textContent });
          }

          // Restore canvas state
          ctx.restore();
        } catch (error) {
          DBG.warn('Failed to render overlay to canvas', error);
        }
      }

      function clearOverlayFromMapCanvas() {
        try {
          // Force map to redraw (this clears any overlay rendering)
          map.triggerRepaint();
        } catch (error) {
          DBG.warn('Failed to clear overlay from map canvas', error);
        }
      }

      // Click anywhere on overlay backdrop to close (but not the close button itself)
      overlay.addEventListener('click', function (e) {
        // Don't handle if clicking on child controls
        if (e.target !== overlay && e.target !== overlayImg) return;
        hideOverlay().then(function () {
          overlayActive = false;
          currentDisplayedPhoto = null;
          mediaViewerActive = false;
          mediaViewerIndex = -1;
          if (isRecording && !playing) {
            setPlaying(true);
            scheduleRaf();
          }
          if (mediaViewerWasPlaying && !playing) {
            setPlaying(true);
            scheduleRaf();
          }
          mediaViewerWasPlaying = false;
        });
      });
      overlayClose.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        hideOverlay().then(function () {
          overlayActive = false;
          currentDisplayedPhoto = null;
          mediaViewerActive = false;
          mediaViewerIndex = -1;
          if (mediaViewerWasPlaying && !playing) {
            setPlaying(true);
            scheduleRaf();
          }
          mediaViewerWasPlaying = false;
        });
      });
      // ESC to close
      var onOverlayKeydown = function (e) {
        if (!document.contains(root)) return;
        if (overlay.style.display !== 'none' && (e.key === 'Tab' || e.code === 'Tab')) {
          e.preventDefault();
          try {
            overlayClose.focus({ preventScroll: true });
          } catch (_) {
            try {
              overlayClose.focus();
            } catch (__) {}
          }
          return;
        }
        if (overlay.style.display !== 'none' && (e.key === 'Escape' || e.code === 'Escape')) {
          hideOverlay().then(function () {
            overlayActive = false;
            currentDisplayedPhoto = null;
            mediaViewerActive = false;
            mediaViewerIndex = -1;
            // Resume playback if still recording
            if (isRecording && !playing) {
              setPlaying(true);
              scheduleRaf();
            }
            if (mediaViewerWasPlaying && !playing) {
              setPlaying(true);
              scheduleRaf();
            }
            mediaViewerWasPlaying = false;
          });
        }
      };
      window.addEventListener('keydown', onOverlayKeydown);
      registerTeardown(function () {
        window.removeEventListener('keydown', onOverlayKeydown);
      });

      function processNextPhoto() {
        DBG.log('processNextPhoto()', { overlayActive: overlayActive, queue: photoQueue.length });

        // Don't start a new photo if one is already active
        if (overlayActive) {
          return;
        }

        var next = photoQueue.shift();
        var pauseForPhoto = speed <= 50;
        if (!next) {
          if (pauseForPhoto) {
            setPlaying(true);
            scheduleRaf();
          }
          return;
        }

        // Verify the photo is still spatially close to current marker position
        // This prevents showing fullscreen for photos that are far from current location
        try {
          var currentPos = currentPosLngLat || positionAtDistance(progress * totalDistance);
          if (typeof next.lon === 'number' && typeof next.lat === 'number') {
            var distToPhoto = haversineMeters(currentPos, [next.lon, next.lat]);
            // If photo is more than configured threshold away from current marker, skip it
            if (distToPhoto > photoMaxDistanceMeters) {
              DBG.log('skip photo (distance>' + photoMaxDistanceMeters + 'm)', distToPhoto);
              // Process next photo immediately
              if (photoQueue.length > 0) {
                processNextPhoto();
              } else if (pauseForPhoto) {
                setPlaying(true);
                scheduleRaf();
              }
              return;
            }
          }
        } catch (_) {}

        if (pauseForPhoto) {
          setPlaying(false);
          // Explicitly cancel RAF to ensure playback pauses immediately
          try {
            if (rafId) {
              window.cancelAnimationFrame(rafId);
              rafId = null;
            }
          } catch (_) {}
        }
        // Keep recording during photo overlay - don't stop recording
        mediaViewerActive = false;
        mediaViewerIndex = -1;
        mediaViewerWasPlaying = false;
        overlayActive = true;
        currentDisplayedPhoto = next; // Track the currently displayed photo
        DBG.log('show photo overlay', { url: next.fullUrl || next.thumbUrl });
        showOverlay(
          next.fullUrl || next.thumbUrl || '',
          nonEmptyText(next.caption) ||
            nonEmptyText(next.description) ||
            nonEmptyText(next.title) ||
            extractFilenameFromUrl(next.fullUrl || next.thumbUrl || '') ||
            'Photo',
          next.source_post_id,
          next.source_post_title || '',
          next.timestamp || ''
        );

        // If recording, also draw the photo overlay on the canvas
        if (videoRecorder && videoRecorder.isRecording) {
          videoRecorder.drawPhotoOverlay(next);
        }

        // Extended duration during recording to keep overlay visible over map layer
        var overlayDuration = videoRecorder && videoRecorder.isRecording ? 5000 : 3000;
        setTimeout(function () {
          hideOverlay().then(function () {
            overlayActive = false;
            currentDisplayedPhoto = null; // Clear the currently displayed photo
            // Resume playback if still recording, regardless of photo queue
            if (pauseForPhoto && isRecording && !playing) {
              setPlaying(true);
              scheduleRaf();
            }
            // Process next photo immediately after overlay is fully hidden
            if (photoQueue.length > 0) {
              processNextPhoto();
            } else if (pauseForPhoto && !isRecording) {
              // Only resume normal playback if not recording
              setPlaying(true);
              scheduleRaf();
            }
          });
        }, overlayDuration);
      }

      // Initial splash play overlay (shown only at initial state)
      var splashDismissed = false;
      var splash = document.createElement('div');
      splash.className = 'fgpx-splash';
      splash.style.cssText =
        'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;background:rgba(0,0,0,0.45);z-index:2;pointer-events:auto';
      var splashBtn = document.createElement('button');
      splashBtn.textContent = '▶ Play';
      splashBtn.className = 'fgpx-btn fgpx-btn-primary';
      splashBtn.style.cssText = 'font-size:20px;padding:10px 18px;margin-bottom:8px';
      var splashTitle = document.createElement('div');
      var titleText =
        window.FGPX && FGPX.hostPostTitle
          ? String(FGPX.hostPostTitle)
          : document && document.title
            ? String(document.title)
            : '';
      splashTitle.textContent = titleText;
      splashTitle.style.cssText =
        'color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.6);font:600 14px system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:80%;text-align:center';

      // Add stats display below title
      var splashStats = document.createElement('div');
      splashStats.style.cssText =
        'color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.6);font:400 12px system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:80%;text-align:center;margin-top:4px;opacity:0.9';

      splash.appendChild(splashBtn);
      splash.appendChild(splashTitle);
      splash.appendChild(splashStats);
      try {
        if (window.getComputedStyle && window.getComputedStyle(ui.mapEl).position === 'static') {
          ui.mapEl.style.position = 'relative';
        }
      } catch (_) {}
      ui.mapEl.appendChild(splash);
      function hideSplash() {
        try {
          splash.style.display = 'none';
          splashDismissed = true;
        } catch (_) {}
      }
      var playbackCountedForRun = false;
      function recordPlaybackStart() {
        try {
          if (playbackCountedForRun) return;
          if (window.FGPX && FGPX.ajaxUrl && FGPX.playbackTrackingNonce && trackId) {
            playbackCountedForRun = true;
            var trackingForm = new FormData();
            trackingForm.append('action', 'fgpx_record_playback');
            trackingForm.append('track_id', trackId);
            trackingForm.append('_wpnonce', FGPX.playbackTrackingNonce);
            fetch(FGPX.ajaxUrl, { method: 'POST', body: trackingForm }).catch(function () {});
          }
        } catch (_) {}
      }
      function startPlaybackWithPreload() {
        if (playing || preloadingInProgress) return;
        // Resume path: skip startup preload/idle gate after first playback has already started.
        if (!firstPlayZoomPending) {
          hidePreloadOverlay();
          syncCameraStateFromMap();
          setPlaying(true);
          scheduleRaf();
          recordPlaybackStart();
          return;
        }
        hideSplash();
        playStartTrace = { startedAt: performance.now() };
        showPreloadOverlay('Preparing playback…');
        DBG.log('play-start stage', { stage: 'gate-open', dtMs: 0 });
        // Also ensure DEM tiles are warmed before play (critical for terrain mesh — see prefetchDemForRoute).
        // Returns the same singleton promise if already in-flight; null if no terrain.
        var demWarmup = prefetchDemForRoute();
        if (hasTerrain && demWarmup) {
          setPreloadOverlayText('Preparing 3D terrain…');
        }
        // Build a gate: no full-route raster prefetch here, only bounded DEM warmup.
        var rasterGate = Promise.resolve();
        var rasterTracked = rasterGate.then(function () {
          if (playStartTrace && playStartTrace.startedAt) {
            DBG.log('play-start stage', {
              stage: 'raster-ready',
              dtMs: Math.round(performance.now() - playStartTrace.startedAt),
            });
          }
        });
        var demGate = demWarmup ? demWarmup : Promise.resolve();
        var demTracked = demGate.then(function () {
          if (playStartTrace && playStartTrace.startedAt) {
            DBG.log('play-start stage', {
              stage: 'dem-ready',
              dtMs: Math.round(performance.now() - playStartTrace.startedAt),
            });
          }
        });
        var gateProm = Promise.all([rasterTracked, demTracked]).then(function () {});
        function doStartAfterGate() {
          // After prefetch/DEM are done, wait for map to reach idle before zooming in.
          // This ensures MapLibre has finished rendering at the overview zoom before we begin
          // the zoom-in, so tiles at the playback zoom level are crisp from the start.
          setPreloadOverlayText('Preparing playback…');
          var mapIdleWait = new Promise(function (resolve) {
            var settled = false;
            // Safety timeout: if map never reaches idle (e.g., offline), proceed after 8s
            var idleWaitTimer = setTimeout(function () {
              DBG.warn('Map idle wait timed out — proceeding with available state');
              done();
            }, 8000);
            function done() {
              if (settled) return;
              settled = true;
              clearTimeout(idleWaitTimer);
              resolve();
            }
            try {
              var idleNow = typeof map.isMoving === 'function' ? !map.isMoving() : true;
              var tilesReady =
                typeof map.areTilesLoaded === 'function' ? map.areTilesLoaded() : true;
              var styleReady = typeof map.isStyleLoaded === 'function' ? map.isStyleLoaded() : true;
              if (idleNow && tilesReady && styleReady) {
                done();
                return;
              }
              map.once('idle', done);
              // In case map already became idle before listener wiring is observed,
              // re-check in next frame and resolve if ready.
              try {
                requestAnimationFrame(function () {
                  try {
                    var _idle = typeof map.isMoving === 'function' ? !map.isMoving() : true;
                    var _tiles =
                      typeof map.areTilesLoaded === 'function' ? map.areTilesLoaded() : true;
                    var _style =
                      typeof map.isStyleLoaded === 'function' ? map.isStyleLoaded() : true;
                    if (_idle && _tiles && _style) done();
                  } catch (_) {}
                });
              } catch (_) {}
            } catch (_) {
              done();
            }
          });
          mapIdleWait.then(function () {
            if (!isContainerActive()) {
              destroyRuntime();
              return;
            }
            if (playStartTrace && playStartTrace.startedAt) {
              DBG.log('play-start stage', {
                stage: 'map-idle-ready',
                dtMs: Math.round(performance.now() - playStartTrace.startedAt),
              });
            }
            if (firstPlayZoomPending) {
              zoomInThenStartPlayback();
            } else {
              syncCameraStateFromMap();
              setPlaying(true);
              scheduleRaf();
              recordPlaybackStart();
            }
          });
        }
        try {
          gateProm.then(doStartAfterGate);
        } catch (_) {
          // Fallback: start immediately if promise fails
          hidePreloadOverlay();
          if (firstPlayZoomPending) {
            zoomInThenStartPlayback();
          } else {
            syncCameraStateFromMap();
            setPlaying(true);
            scheduleRaf();
            recordPlaybackStart();
          }
        }
      }

      splash.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        startPlaybackWithPreload();
      });
      splashBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        startPlaybackWithPreload();
      });

      // Initial stopped view already set via constructor bounds; keep references for later reset/end fits
      var fullBoundsRef = fullBounds;
      var innerBoundsRef = innerBounds;

      // Capture the overview camera state (center + zoom) matching how the map looks before Play.
      // Used by the end-of-track zoom-out to return to exactly this position.
      var overviewCameraState = null;
      try {
        var _ovBounds = innerBoundsRef || fullBoundsRef;
        if (typeof map.cameraForBounds === 'function' && _ovBounds) {
          var _ovDefaultPitch =
            window.FGPX && isFinite(Number(FGPX.defaultPitch)) ? Number(FGPX.defaultPitch) : 30;
          var _ovCam = map.cameraForBounds(_ovBounds, { padding: 40 });
          if (_ovCam && isFinite(Number(_ovCam.zoom))) {
            overviewCameraState = {
              center: _ovCam.center,
              zoom: Number(_ovCam.zoom),
              pitch: 0, // end animation always targets flat top-down view
              bearing: 0,
            };
            DBG.log('[FGPX end-zoom] overviewCameraState captured', overviewCameraState);
          } else {
            DBG.log('[FGPX end-zoom] cameraForBounds returned invalid result', _ovCam);
          }
        }
      } catch (_e) {
        DBG.warn('[FGPX end-zoom] overviewCameraState capture threw', _e);
      }

      // Stats panel
      try {
        var km = totalDistance / 1000;
        var moveS =
          stats.moving_time_s != null
            ? stats.moving_time_s
            : totalDuration != null
              ? totalDuration
              : 0;
        var avgKmh =
          stats.average_speed_m_s != null
            ? stats.average_speed_m_s * 3.6
            : moveS > 0
              ? km / (moveS / 3600)
              : 0;
        var gain = stats.elevation_gain_m != null ? stats.elevation_gain_m : 0;
        var usesEstimatedPower = !!(payload && payload.estimatedPower);
        ui.stats.dist.innerHTML = '<strong>' + formatNumber(km, 2) + '</strong> km';
        ui.stats.time.innerHTML = '<strong>' + formatTime(moveS) + '</strong> time';
        ui.stats.avg.innerHTML = '<strong>' + formatNumber(avgKmh, 1) + '</strong> km/h';
        ui.stats.gain.innerHTML = '<strong>' + Math.round(gain) + '</strong> m gain';
        if (usesEstimatedPower && ui.tabs && ui.tabs.tabPower && ui.tabs.tabPowerZones) {
          ui.tabs.tabPower.textContent = 'Power ~';
          ui.tabs.tabPowerZones.textContent = 'Power Zones ~';
          ui.tabs.tabPower.setAttribute(
            'title',
            'Power data is estimated from speed, slope, and configured system weight.'
          );
          ui.tabs.tabPowerZones.setAttribute(
            'title',
            'Power zones are based on estimated power data.'
          );
        }

        // Update splash stats display
        try {
          if (splashStats && !splashDismissed) {
            splashStats.textContent =
              formatNumber(km, 2) +
              ' km | ' +
              formatTime(moveS) +
              ' | ' +
              formatNumber(avgKmh, 1) +
              ' km/h | ' +
              Math.round(gain) +
              ' m gain';
          }
        } catch (_) {}
      } catch (_) {}

      // Chart.js elevation vs time (if available) else distance
      var useTime = Array.isArray(timeOffsets);
      var xVals = useTime
        ? Array.isArray(movingTimeOffsets)
          ? movingTimeOffsets
          : timeOffsets
        : cumDist.map(function (m) {
            return m / 1000;
          });
      var elev = coords.map(function (c) {
        return typeof c[2] === 'number' ? c[2] : 0;
      });
      // Build speed series (km/h): prefer payload speed values, fall back to distance/time derivation.
      var speedSeries = null;
      var speedSeriesSource = 'none';
      var rawSpeeds = Array.isArray(props.speeds) ? props.speeds : null;
      if (Array.isArray(rawSpeeds) && rawSpeeds.length === coords.length) {
        var speedSeriesFromPayload = new Array(coords.length);
        var speedPayloadValidCount = 0;
        for (var spi = 0; spi < coords.length; spi++) {
          var speedVal = Number(rawSpeeds[spi]);
          if (isFinite(speedVal) && speedVal >= 0) {
            speedSeriesFromPayload[spi] = speedVal;
            speedPayloadValidCount++;
          } else {
            speedSeriesFromPayload[spi] = null;
          }
        }
        if (speedPayloadValidCount > 0) {
          var speedLast = 0;
          for (var spf = 0; spf < speedSeriesFromPayload.length; spf++) {
            if (speedSeriesFromPayload[spf] == null) {
              speedSeriesFromPayload[spf] = speedLast;
            } else {
              speedLast = speedSeriesFromPayload[spf];
            }
          }
          speedSeries = speedSeriesFromPayload;
          speedSeriesSource = 'payload';
        }
      }
      if (!speedSeries && useTime && Array.isArray(cumDist)) {
        try {
          var tSeries = Array.isArray(movingTimeOffsets) ? movingTimeOffsets : timeOffsets;
          speedSeries = new Array(coords.length);
          speedSeries[0] = 0;
          for (var si = 1; si < coords.length; si++) {
            var ddS = Math.max(0, cumDist[si] - cumDist[si - 1]);
            var dtS = Math.max(1e-3, tSeries[si] - tSeries[si - 1]);
            speedSeries[si] = (ddS / dtS) * 3.6;
          }
          speedSeriesSource = 'derived';
        } catch (_) {
          speedSeries = null;
          speedSeriesSource = 'none';
        }
      }
      if (speedSeriesSource === 'none' && dbgAllow('speed-series-missing', 10000)) {
        DBG.warn(
          'Speed series unavailable: speed-based overlays require GPX point speed values or valid track timestamps'
        );
      }
      var cursorX = 0;
      var cursorPlugin = {
        id: 'fgpxCursor',
        // draw the vertical cursor behind datasets so the position dot stays on top
        beforeDatasetsDraw: function (chart, args, pluginOptions) {
          var ctx = chart.ctx;
          var xScale = chart.scales.x;
          if (!xScale) return;

          // Check if cursor should be visible based on zoom state
          var cursorVisible = true;
          if (chart.chartZoomState && chart.chartZoomState.zoomedRange) {
            var zoomRange = chart.chartZoomState.zoomedRange;
            cursorVisible = cursorX >= zoomRange.min && cursorX <= zoomRange.max;
          }

          if (!cursorVisible) return; // Don't draw cursor if outside zoom range

          var xVal = Math.min(Math.max(cursorX, xScale.min), xScale.max);
          var x = xScale.getPixelForValue(xVal);
          ctx.save();
          var _chartContainer =
            ctx.canvas && ctx.canvas.closest ? ctx.canvas.closest('.fgpx') : null;
          ctx.strokeStyle = isDarkMode(_chartContainer)
            ? 'rgba(255,255,255,0.5)'
            : 'rgba(0,0,0,0.5)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, chart.chartArea.top);
          ctx.lineTo(x, chart.chartArea.bottom);
          ctx.stroke();
          ctx.restore();
        },
        // overlay draw for the position dot to guarantee it is above all datasets
        afterDatasetsDraw: function (chart, args, pluginOptions) {
          try {
            // Find the Position dataset dynamically because dataset order varies by tab.
            var ds1 = null;
            if (chart.data && chart.data.datasets) {
              for (var _pi = 0; _pi < chart.data.datasets.length; _pi++) {
                if (chart.data.datasets[_pi].label === 'Position') {
                  ds1 = chart.data.datasets[_pi];
                  break;
                }
              }
            }
            var pt = ds1 && ds1.data && ds1.data[0];
            var xScale = chart.scales.x;
            var yScale = chart.scales.y;
            if (!pt || !xScale || !yScale) return;

            // Check if position dot should be visible based on zoom state
            var dotVisible = true;
            if (chart.chartZoomState && chart.chartZoomState.zoomedRange) {
              var zoomRange = chart.chartZoomState.zoomedRange;
              dotVisible = pt.x >= zoomRange.min && pt.x <= zoomRange.max;
            }

            if (!dotVisible) return; // Don't draw dot if outside zoom range

            // Retry once after a short delay to handle style/image race conditions.
            setTimeout(function () {
              try {
                if (map.hasImage('arrow-calm')) return; // Already loaded.
                var retryColors = [
                  { name: 'calm', color: '#666666' },
                  { name: 'light', color: '#228b22' },
                  { name: 'moderate', color: '#ff8c00' },
                  { name: 'strong', color: '#ff4500' },
                  { name: 'very-strong', color: '#dc143c' },
                ];
                var retrySizes = [72, 54, 36, 24, 18];
                retryColors.forEach(function (wc) {
                  retrySizes.forEach(function (sz, si) {
                    var c = createArrowIcon(wc.color, sz);
                    var cx = c.getContext('2d');
                    var id = cx.getImageData(0, 0, c.width, c.height);
                    var sn = si === 0 ? '' : '-size' + si;
                    map.addImage('arrow-' + wc.name + sn, {
                      width: c.width,
                      height: c.height,
                      data: id.data,
                    });
                  });
                });
                DBG.log('Arrow icons loaded on retry');
              } catch (retryErr) {
                DBG.warn('Arrow icon retry also failed:', retryErr);
              }
            }, 500);
            var xDot = Math.min(Math.max(pt.x, xScale.min), xScale.max);
            var x = xScale.getPixelForValue(xDot);
            var y = yScale.getPixelForValue(pt.y);
            var ctx = chart.ctx;
            ctx.save();
            ctx.fillStyle = '#111';
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          } catch (_) {}
        },
      };
      var chartLineColor = window.FGPX && FGPX.chartColor ? String(FGPX.chartColor) : '#ff5500';
      var chartLineColor2 = window.FGPX && FGPX.chartColor2 ? String(FGPX.chartColor2) : '#1976d2';
      var chartLineColor3 =
        window.FGPX && FGPX.chartColorHr ? String(FGPX.chartColorHr) : '#dc2626'; // Heart rate color
      var chartLineColor4 =
        window.FGPX && FGPX.chartColorCad ? String(FGPX.chartColorCad) : '#7c3aed'; // Cadence color
      var chartLineColor5 =
        window.FGPX && FGPX.chartColorTemp ? String(FGPX.chartColorTemp) : '#f59e0b'; // Temperature color
      var chartLineColor6 =
        window.FGPX && FGPX.chartColorPower ? String(FGPX.chartColorPower) : '#059669'; // Power color
      var chartLineColorWindImpact =
        window.FGPX && FGPX.chartColorWindImpact ? String(FGPX.chartColorWindImpact) : '#ff6b35'; // Wind impact color
      var chartLineColorWindRose =
        window.FGPX && FGPX.chartColorWindRose ? String(FGPX.chartColorWindRose) : '#4ecdc4'; // Wind rose color
      // Wind rose directional colors
      var windRoseColorNorth =
        window.FGPX && FGPX.windRoseColorNorth ? String(FGPX.windRoseColorNorth) : '#3b82f6'; // Blue - Headwind
      var windRoseColorSouth =
        window.FGPX && FGPX.windRoseColorSouth ? String(FGPX.windRoseColorSouth) : '#10b981'; // Green - Tailwind
      var windRoseColorEast =
        window.FGPX && FGPX.windRoseColorEast ? String(FGPX.windRoseColorEast) : '#f59e0b'; // Orange - Right sidewind
      var windRoseColorWest =
        window.FGPX && FGPX.windRoseColorWest ? String(FGPX.windRoseColorWest) : '#ef4444'; // Red - Left sidewind

      // ========== LAZY LOADING: PROCESS ONLY ESSENTIAL DATA INITIALLY ==========
      // Pre-process only elevation data (essential for initial render)
      var points = getChartData('elevation');

      // Lazy-loaded data points (processed on-demand)
      var speedPoints = null;
      var heartRatePoints = null;
      var cadencePoints = null;
      var temperaturePoints = null;
      var sunAltitudePoints = null;
      var moonAltitudePoints = null;
      var powerPoints = null;
      var windSpeedPoints = null;
      var windImpactPoints = null;

      /**
       * Returns data points for a specific chart type (elevation, biometrics, temperature, etc.).
       * @param {string} chartType - The chart type to retrieve data for.
       * @returns {Object} Data points for the chart.
       */
      function getDataPointsForChart(chartType) {
        switch (chartType) {
          case 'elevation':
            return {
              elevation: points,
              speed: speedPoints || getChartData('speed'),
            };
          case 'biometrics':
            return {
              heartRate: heartRatePoints || getChartData('heartRate'),
              cadence: cadencePoints || getChartData('cadence'),
            };
          case 'temperature':
            if (!sunAltitudePoints) {
              getChartData('sunMoonAltitude');
            }
            return {
              temperature: temperaturePoints || getChartData('temperature'),
              sunAltitude: sunAltitudePoints || chartDataCache.sunAltitude || [],
              moonAltitude: moonAltitudePoints || chartDataCache.moonAltitude || [],
            };
          case 'power':
            return {
              power: powerPoints || getChartData('power'),
            };
          case 'powerzones':
            return {
              power: powerPoints || getChartData('power'),
              powerZones: getChartData('powerZones'),
            };
          case 'windimpact':
            return {
              windSpeed: windSpeedPoints || getChartData('windSpeed'),
              windImpact: windImpactPoints || getChartData('windImpact'),
            };
          case 'windrose':
            return {
              windDirection: getChartData('windDirection'),
            };
          case 'all':
            // Load all data for combined chart
            return {
              elevation: points,
              speed: speedPoints || getChartData('speed'),
              heartRate: heartRatePoints || getChartData('heartRate'),
              cadence: cadencePoints || getChartData('cadence'),
              temperature: temperaturePoints || getChartData('temperature'),
              power: powerPoints || getChartData('power'),
            };
          default:
            return {};
        }
      }

      var xMin = xVals.length > 0 ? xVals[0] : 0;
      var xMax = xVals.length > 0 ? xVals[xVals.length - 1] : 1;

      // Define showNoDataMessage function here where createChart can access it
      /**
       * Shows a message in the chart area when no data is available.
       * @param {string} message - The message to display.
       */
      var showNoDataMessageLocal = function (message) {
        if (chart) {
          chart.destroy();
          chart = null;
        }

        // Find chart canvas and replace with message
        var chartWrap = root.querySelector('.fgpx-chart-wrap');
        if (chartWrap) {
          chartWrap.innerHTML =
            '<div style="display:flex;align-items:center;justify-content:center;height:200px;color:#666;font-size:14px;text-align:center;padding:20px;">' +
            message +
            '</div>';
        }
      };

      function scheduleWeatherCinemaRefresh(
        cinemaEl,
        payloadData,
        currentTimeSec,
        isCurrentlyPlaying,
        forceUpdate,
        delayMs
      ) {
        if (!cinemaEl) return;
        var waitMs = Math.max(0, Number(delayMs) || 0);
        cinemaEl._pendingCinemaRefresh = {
          payloadData: payloadData,
          currentTimeSec: currentTimeSec,
          isCurrentlyPlaying: isCurrentlyPlaying,
          forceUpdate: !!forceUpdate,
        };

        if (cinemaEl._pendingCinemaRefreshTimer) {
          clearTimeout(cinemaEl._pendingCinemaRefreshTimer);
          cinemaEl._pendingCinemaRefreshTimer = null;
        }
        if (cinemaEl._pendingCinemaRefreshRaf) {
          try {
            window.cancelAnimationFrame(cinemaEl._pendingCinemaRefreshRaf);
          } catch (_) {}
          cinemaEl._pendingCinemaRefreshRaf = null;
        }

        var runRefresh = function () {
          cinemaEl._pendingCinemaRefreshTimer = null;
          cinemaEl._pendingCinemaRefreshRaf = null;
          var pending = cinemaEl._pendingCinemaRefresh;
          cinemaEl._pendingCinemaRefresh = null;
          if (!pending) return;
          if (cinemaEl.style.display === 'none') return;
          updateWeatherCinema(
            cinemaEl,
            pending.payloadData,
            pending.currentTimeSec,
            pending.isCurrentlyPlaying,
            pending.forceUpdate
          );
        };

        if (waitMs <= 16 && typeof window.requestAnimationFrame === 'function') {
          cinemaEl._pendingCinemaRefreshRaf = window.requestAnimationFrame(runRefresh);
          return;
        }

        cinemaEl._pendingCinemaRefreshTimer = setTimeout(runRefresh, waitMs);
      }

      // Define switchChartTab function here where event listeners can access it
      /**
       * Switches the chart to the specified tab type and updates UI accordingly.
       * @param {string} tabType - The tab type to switch to.
       */
      var switchChartTab = function (tabType) {
        var tabSwitchPerfStart =
          typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
        function finishTabSwitch(branch) {
          var elapsed =
            (typeof performance !== 'undefined' && typeof performance.now === 'function'
              ? performance.now()
              : Date.now()) - tabSwitchPerfStart;
          var payload = {
            branch: branch,
            tabType: tabType,
            ms: Math.round(elapsed),
            playing: !!playing,
            chartExists: !!chart,
          };
          if (elapsed >= 60) {
            DBG.warn('Tab switch slow path', payload);
          } else if (dbgAllow('tab-switch-perf', 1200)) {
            DBG.log('Tab switch perf', payload);
          }
        }

        DBG.log('Switching to tab', { tabType: tabType });
        if (
          (tabType === 'weathergrade' || tabType === 'weatheroverview') &&
          !weatherGradeAvailable
        ) {
          tabType = 'elevation';
        }
        currentChartTab = tabType;
        try {
          applyWeatherOverlayProfile(true);
        } catch (_) {}

        var tabElements = [
          ui.tabs.tabElevation,
          ui.tabs.tabBiometrics,
          ui.tabs.tabTemperature,
          ui.tabs.tabPower,
          ui.tabs.tabPowerZones,
          ui.tabs.tabWindImpact,
          ui.tabs.tabWindRose,
          ui.tabs.tabAll,
          ui.tabs.tabWeatherGrade,
          ui.tabs.tabMedia,
          ui.tabs.tabWeatherOverview,
        ];
        var tabTypes = [
          'elevation',
          'biometrics',
          'temperature',
          'power',
          'powerzones',
          'windimpact',
          'windrose',
          'all',
          'weathergrade',
          'media',
          'weatheroverview',
        ];

        tabElements.forEach(function (tab, index) {
          if (!tab) return; // Skip if tab doesn't exist (e.g., media tab when disabled)
          if (tabTypes[index] === tabType) {
            tab.className = 'fgpx-chart-tab fgpx-chart-tab-active';
          } else {
            tab.className = 'fgpx-chart-tab';
          }
        });

        // Show/hide chart legend controls based on tab type
        if (tabType === 'all') {
          ui.chartLegend.style.display = 'block';
          // Initialize legend controls if not already done
          if (!ui.chartLegend.hasAttribute('data-initialized')) {
            initializeLegendControls();
            ui.chartLegend.setAttribute('data-initialized', 'true');
          }
        } else {
          ui.chartLegend.style.display = 'none';
        }

        // Show weather cinema or chart canvas based on tab
        var weather = tabType === 'weathergrade';
        var media = tabType === 'media';
        var weatherOverview = tabType === 'weatheroverview';
        var cinemaRoot = container || root;
        var cinemaEl = cinemaRoot.querySelector('.fgpx-weather-cinema');
        if (media) {
          ui.chartLegend.style.display = 'none';
          if (ui.canvas.parentElement) ui.canvas.parentElement.style.display = 'none';
          if (cinemaEl) cinemaEl.style.display = 'none';
          if (ui.weatherOverviewPanel) ui.weatherOverviewPanel.style.display = 'none';
          if (ui.weatherOverviewLegend) ui.weatherOverviewLegend.style.display = 'none';
          if (ui.mediaPanel) {
            if (
              (!Array.isArray(mediaItems) || mediaItems.length === 0) &&
              FGPX.photosEnabled &&
              Array.isArray(photos) &&
              photos.length > 0
            ) {
              buildMediaItems();
            }
            syncMediaDisplayOrder(true);
            renderMediaGrid();
            ui.mediaPanel.style.display = 'block';
          }
          finishTabSwitch('media');
          return;
        } else {
          if (ui.mediaPanel) ui.mediaPanel.style.display = 'none';
        }
        if (weatherOverview) {
          ui.chartLegend.style.display = 'none';
          if (ui.canvas.parentElement) ui.canvas.parentElement.style.display = 'none';
          if (cinemaEl) cinemaEl.style.display = 'none';
          if (ui.weatherOverviewPanel) {
            var hasOverviewCards =
              ui.weatherOverviewPanel.querySelectorAll('.fgpx-weather-overview-card').length > 0;
            if (!ui.weatherOverviewPanel.getAttribute('data-rendered') || !hasOverviewCards) {
              var overviewBuildStart =
                typeof performance !== 'undefined' && typeof performance.now === 'function'
                  ? performance.now()
                  : Date.now();
              try {
                var wLookup = buildWeatherLookup({ weather: weatherData });
                var slices = buildWeatherOverviewSlices(wLookup, totalDuration || 0);
                var weatherOverviewI18n = window.FGPX && FGPX.i18n ? FGPX.i18n : {};
                var renderedCount = renderWeatherOverviewPanel(
                  ui.weatherOverviewPanel,
                  slices,
                  weatherOverviewI18n
                );
                renderWeatherOverviewLegend(ui.weatherOverviewLegend, weatherOverviewI18n);
                if (renderedCount > 0) {
                  ui.weatherOverviewPanel.setAttribute('data-rendered', '1');
                  var overviewBuildMs =
                    (typeof performance !== 'undefined' && typeof performance.now === 'function'
                      ? performance.now()
                      : Date.now()) - overviewBuildStart;
                  if (overviewBuildMs >= 50) {
                    DBG.warn('Weather overview build slow', {
                      ms: Math.round(overviewBuildMs),
                      lookupCount: (wLookup && wLookup.length) || 0,
                      sliceCount: (slices && slices.length) || 0,
                      renderedCount: renderedCount,
                    });
                  }
                } else {
                  ui.weatherOverviewPanel.removeAttribute('data-rendered');
                  DBG.warn('Weather overview rendered zero cards', {
                    lookupCount: (wLookup && wLookup.length) || 0,
                    sliceCount: (slices && slices.length) || 0,
                    totalDuration: totalDuration || 0,
                  });
                }
              } catch (weatherOverviewErr) {
                ui.weatherOverviewPanel.removeAttribute('data-rendered');
                DBG.warn('Weather overview render failed', weatherOverviewErr);
              }
            }
            ui.weatherOverviewPanel.style.display = 'flex';
            if (ui.weatherOverviewLegend) ui.weatherOverviewLegend.style.display = 'flex';
          }
          finishTabSwitch('weatheroverview');
          return;
        } else {
          if (ui.weatherOverviewPanel) ui.weatherOverviewPanel.style.display = 'none';
          if (ui.weatherOverviewLegend) ui.weatherOverviewLegend.style.display = 'none';
        }
        if (weather) {
          // Hide chart canvas
          ui.canvas.parentElement.style.display = 'none';
          // Show or create cinema element
          if (!cinemaEl) {
            cinemaEl = createWeatherCinema(
              cinemaRoot,
              payload,
              lastPlaybackSec || 0,
              playing || false
            );
          } else {
            cinemaEl.style.display = 'flex';
          }
          // If POIs for the current route segment are not loaded yet, request them lazily.
          if (simulationCitiesEnabled) {
            if (playing) {
              pauseCityChunkLoadsFor(1400, 'simulation-tab-switch');
            } else {
              try {
                precomputeMapCities(distanceAtPlaybackTime(lastPlaybackSec || 0));
              } catch (_) {}
            }
          }
          // Defer refresh by one short frame while playing to avoid tab-switch frame spikes.
          if (playing) {
            scheduleWeatherCinemaRefresh(
              cinemaEl,
              payload,
              lastPlaybackSec || 0,
              playing || false,
              true,
              40
            );
          } else {
            updateWeatherCinema(cinemaEl, payload, lastPlaybackSec || 0, playing || false, true);
          }
          finishTabSwitch('weathergrade');
          return;
        } else {
          if (ui.canvas.parentElement) ui.canvas.parentElement.style.display = '';
          if (cinemaEl) cinemaEl.style.display = 'none';
        }

        if (chart && chart.chartZoomState && chart.chartZoomState.originalScales) {
          resetChartZoom(chart);
          DBG.log('Chart zoom reset on tab switch');
        }

        // Recreate chart with new configuration if chart creation function exists
        if (typeof createChart === 'function') {
          createChart(tabType);
        }
        finishTabSwitch('chart');
      };
      ui.switchChartTab = switchChartTab;
      root.__fgpxSwitchChartTab = switchChartTab;
      if (container) {
        container.__fgpxSwitchChartTab = switchChartTab;
      }

      // Chart data series visibility state for All Data tab
      var chartDataVisibility = {
        elevation: true,
        speed: true,
        heartRate: true,
        cadence: true,
        temperature: true,
        power: true,
      };

      // Initialize legend controls for All Data tab
      /**
       * Initializes the legend controls for the All Data tab, creating checkboxes for each data series.
       */
      function initializeLegendControls() {
        // Clear existing controls except title
        var title = ui.chartLegend.querySelector('span');
        ui.chartLegend.innerHTML = '';
        ui.chartLegend.appendChild(title);

        // Define available data series with their colors and labels
        // Add null checks for arrays that may not be initialized yet
        var dataSeries = [
          { key: 'elevation', label: 'Elevation', color: chartLineColor, available: true },
          {
            key: 'speed',
            label: 'Speed',
            color: chartLineColor2,
            available: useTime && speedPoints && speedPoints.length > 0,
          },
          {
            key: 'heartRate',
            label: 'Heart Rate',
            color: chartLineColor3,
            available: heartRatePoints && heartRatePoints.length > 0,
          },
          {
            key: 'cadence',
            label: 'Cadence',
            color: chartLineColor4,
            available: cadencePoints && cadencePoints.length > 0,
          },
          {
            key: 'temperature',
            label: 'Temperature',
            color: chartLineColor5,
            available: temperaturePoints && temperaturePoints.length > 0,
          },
          {
            key: 'power',
            label: 'Power',
            color: chartLineColor6,
            available: powerPoints && powerPoints.length > 0,
          },
        ];

        // Create checkbox controls for available data series
        dataSeries.forEach(function (series) {
          if (series.available) {
            var controlWrap = document.createElement('label');
            controlWrap.style.cssText =
              'display:inline-flex;align-items:center;margin-right:16px;cursor:pointer;';

            var checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = chartDataVisibility[series.key];
            checkbox.style.cssText = 'margin-right:4px;';

            var colorBox = document.createElement('span');
            colorBox.style.cssText =
              'display:inline-block;width:12px;height:12px;margin-right:4px;border:1px solid #ccc;background:' +
              series.color +
              ';';

            var label = document.createElement('span');
            label.textContent = series.label;
            label.style.cssText = 'font-size:11px;color:#333;';

            controlWrap.appendChild(checkbox);
            controlWrap.appendChild(colorBox);
            controlWrap.appendChild(label);

            // Add event listener for toggle
            checkbox.addEventListener('change', function () {
              chartDataVisibility[series.key] = checkbox.checked;
              if (typeof createChart === 'function' && currentChartTab === 'all') {
                createChart('all');
              }
            });

            ui.chartLegend.appendChild(controlWrap);
          }
        });
      }

      // Add tab event listeners now that switchChartTab is defined
      if (!weatherGradeAvailable && ui.tabs.tabWeatherGrade) {
        ui.tabs.tabWeatherGrade.style.display = 'none';
      }
      if (!weatherGradeAvailable && ui.tabs.tabWeatherOverview) {
        ui.tabs.tabWeatherOverview.style.display = 'none';
      }
      root.__fgpxTabsReady = true;
      if (container) {
        container.__fgpxTabsReady = true;
      }
      var pendingTabType = '';
      if (
        container &&
        typeof container.__fgpxPendingTabType === 'string' &&
        container.__fgpxPendingTabType !== ''
      ) {
        pendingTabType = container.__fgpxPendingTabType;
      } else if (
        typeof root.__fgpxPendingTabType === 'string' &&
        root.__fgpxPendingTabType !== ''
      ) {
        pendingTabType = root.__fgpxPendingTabType;
      }
      if (pendingTabType !== '') {
        switchChartTab(pendingTabType);
        if (container) container.__fgpxPendingTabType = '';
        root.__fgpxPendingTabType = '';
      }

      // Immediate debug test to verify logging works
      DBG.log('=== DEBUG TEST: Chart creation started ===');
      DBG.log('SunCalc availability check', {
        windowSunCalc: typeof window.SunCalc,
        SunCalcObject: window.SunCalc ? 'loaded' : 'missing',
      });

      // Calculate day/night periods if SunCalc is available and we have timestamps
      var dayNightPeriods = null;
      var dayNightPeriodsSorted = null;
      DBG.log('Day/night calculation check', {
        hasSunCalc: typeof window.SunCalc !== 'undefined',
        hasTimestamps: hasTimestamps,
        timestampsArray: Array.isArray(timestamps),
        coordsArray: Array.isArray(coords),
        timestampsLength: timestamps ? timestamps.length : 0,
        coordsLength: coords ? coords.length : 0,
        timeOffsetsLength: timeOffsets ? timeOffsets.length : 0,
      });

      if (
        typeof window.SunCalc !== 'undefined' &&
        hasTimestamps &&
        Array.isArray(timestamps) &&
        Array.isArray(coords)
      ) {
        try {
          dayNightPeriods = calculateDayNightPeriods(coords, timestamps, timeOffsets);
          if (dayNightPeriods && dayNightPeriods.length > 0) {
            dayNightPeriodsSorted = dayNightPeriods.slice().sort(function (a, b) {
              return a.timeOffset - b.timeOffset;
            });
          }
          DBG.log('Day/night periods calculated', {
            periods: dayNightPeriods ? dayNightPeriods.length : 0,
            periodsData: dayNightPeriods,
          });
        } catch (e) {
          DBG.warn('Failed to calculate day/night periods:', e);
        }
      } else {
        DBG.log('Day/night calculation skipped - requirements not met');
      }

      // Helper function to calculate day/night periods
      /**
       * Calculates day/night periods for the track using SunCalc and timestamps.
       * @param {Array} coordinates - Array of [lon, lat, elev] coordinates.
       * @param {Array} timestampArray - Array of timestamp strings or numbers.
       * @param {Array} timeOffsetsArray - Array of time offsets in seconds.
       * @returns {Array} Array of period objects with type and timeOffset.
       */
      function calculateDayNightPeriods(coordinates, timestampArray, timeOffsetsArray) {
        DBG.log('calculateDayNightPeriods called', {
          coordinatesLength: coordinates.length,
          timestampArrayLength: timestampArray.length,
          timeOffsetsArrayLength: timeOffsetsArray ? timeOffsetsArray.length : 0,
          firstTimestamp: timestampArray[0],
          firstCoord: coordinates[0],
        });

        if (!timeOffsetsArray || timeOffsetsArray.length === 0) {
          DBG.warn('No time offsets available for day/night calculation');
          return [];
        }

        var periods = [];

        // Get first and last points only
        var firstIdx = 0;
        var lastIdx = timestampArray.length - 1;

        // Find first valid point
        while (
          firstIdx < timestampArray.length &&
          (!timestampArray[firstIdx] || !coordinates[firstIdx])
        ) {
          firstIdx++;
        }

        // Find last valid point
        while (lastIdx >= 0 && (!timestampArray[lastIdx] || !coordinates[lastIdx])) {
          lastIdx--;
        }

        if (firstIdx >= timestampArray.length || lastIdx < 0 || firstIdx >= lastIdx) {
          DBG.warn('No valid start/end points found');
          return [];
        }

        DBG.log('Using points', {
          firstIdx: firstIdx,
          lastIdx: lastIdx,
          firstTime: new Date(timestampArray[firstIdx]),
          lastTime: new Date(timestampArray[lastIdx]),
        });

        // Calculate for full date range (all days spanned by the track)
        var startDate = new Date(timestampArray[firstIdx]);
        var endDate = new Date(timestampArray[lastIdx]);
        var startLat = coordinates[firstIdx][1];
        var startLon = coordinates[firstIdx][0];
        var endLat = coordinates[lastIdx][1];
        var endLon = coordinates[lastIdx][0];

        // Use average coordinates for sun calculations
        var avgLat = (startLat + endLat) / 2;
        var avgLon = (startLon + endLon) / 2;

        DBG.log('Average coordinates', { avgLat: avgLat, avgLon: avgLon });

        DBG.log('Date range calculation', {
          startDate: startDate,
          endDate: endDate,
          trackStartTime: timestampArray[firstIdx],
          trackEndTime: timestampArray[lastIdx],
        });

        // Check if track starts during night using sun position
        var sunPosition = window.SunCalc.getPosition(startDate, avgLat, avgLon);
        var startsAtNight = sunPosition.altitude < 0; // Sun below horizon = night

        DBG.log('Track start sun position', {
          altitude: sunPosition.altitude,
          startsAtNight: startsAtNight,
        });

        var trackStartTime = new Date(timestampArray[firstIdx]).getTime();
        var trackDuration =
          (new Date(timestampArray[lastIdx]).getTime() -
            new Date(timestampArray[firstIdx]).getTime()) /
          1000;
        var startDay = new Date(startDate);
        startDay.setHours(0, 0, 0, 0);
        var endDay = new Date(endDate);
        endDay.setHours(0, 0, 0, 0);

        var dayCursor = new Date(startDay);
        while (dayCursor.getTime() <= endDay.getTime()) {
          var dayForCalc = new Date(dayCursor);
          dayForCalc.setHours(12, 0, 0, 0);
          var times = window.SunCalc.getTimes(dayForCalc, avgLat, avgLon);

          DBG.log('SunCalc times for date', {
            date: new Date(dayCursor),
            sunrise: times.sunrise,
            sunset: times.sunset,
            sunriseValid: !isNaN(times.sunrise.getTime()),
            sunsetValid: !isNaN(times.sunset.getTime()),
          });

          if (!isNaN(times.sunrise.getTime()) && !isNaN(times.sunset.getTime())) {
            var sunriseOffset = (times.sunrise.getTime() - trackStartTime) / 1000;
            var sunsetOffset = (times.sunset.getTime() - trackStartTime) / 1000;

            if (sunriseOffset >= 0 && sunriseOffset <= trackDuration) {
              periods.push({ type: 'sunrise', timeOffset: sunriseOffset, time: times.sunrise });
              DBG.log('Added sunrise', { date: new Date(dayCursor), timeOffset: sunriseOffset });
            }
            if (sunsetOffset >= 0 && sunsetOffset <= trackDuration) {
              periods.push({ type: 'sunset', timeOffset: sunsetOffset, time: times.sunset });
              DBG.log('Added sunset', { date: new Date(dayCursor), timeOffset: sunsetOffset });
            }
          }

          dayCursor.setDate(dayCursor.getDate() + 1);
        }

        var sortedPeriods = periods.sort(function (a, b) {
          return a.timeOffset - b.timeOffset;
        });

        // If track starts at night but no events found, add a special marker
        // This handles tracks entirely during night with no sunrise/sunset within range
        if (startsAtNight && sortedPeriods.length === 0) {
          // Add a 'nightStart' marker at offset 0 to indicate track starts during night
          sortedPeriods.push({ type: 'nightStart', timeOffset: 0 });
          DBG.log('Added nightStart marker for track entirely during night');
        }

        DBG.log('Final periods', {
          count: sortedPeriods.length,
          periods: sortedPeriods,
          startsAtNight: startsAtNight,
        });
        return sortedPeriods;
      }

      // =====================================================================
      // Weather & Grade Cinema Animation Tab
      // =====================================================================

      /**
       * Parses a value into epoch seconds, handling various formats.
       * @param {string|number|null} value - The value to parse.
       * @returns {number} Epoch seconds or NaN if invalid.
       */
      function parseEpochSeconds(value) {
        if (value === null || value === undefined || value === '') return NaN;
        var num = Number(value);
        if (isFinite(num)) {
          var numericEpoch = num > 1000000000000 ? num / 1000 : num;
          if (numericEpoch > 0 && numericEpoch < 4102444800) return numericEpoch;
          return NaN;
        }
        if (typeof value === 'string') {
          var parsedMs = Date.parse(value);
          if (!isNaN(parsedMs)) {
            var parsedEpoch = parsedMs / 1000;
            if (parsedEpoch > 0 && parsedEpoch < 4102444800) return parsedEpoch;
          }
        }
        return NaN;
      }

      /**
       * Builds a lookup array of weather data points with time offsets for interpolation.
       * @param {Object} payloadData - The payload containing weather data.
       * @returns {Array} Array of weather lookup items.
       */
      function buildWeatherLookup(payloadData) {
        if (!payloadData || !payloadData.weather) return [];
        var weather = payloadData.weather;
        var features = [];
        if (Array.isArray(weather.features)) {
          features = weather.features;
        } else if (Array.isArray(weather)) {
          features = weather;
        } else if (weather && typeof weather === 'object' && Array.isArray(weather.points)) {
          features = weather.points;
        }
        if (!features.length) return [];
        var trackStartEpoch = NaN;
        if (timestamps && timestamps.length) {
          for (var tsi = 0; tsi < timestamps.length; tsi++) {
            trackStartEpoch = parseEpochSeconds(timestamps[tsi]);
            if (isFinite(trackStartEpoch)) break;
          }
        }
        var items = [];
        for (var i = 0; i < features.length; i++) {
          var feat = features[i];
          if (!feat) continue;
          var p = feat.properties || feat;
          var tsEpoch = parseEpochSeconds(p.time_unix);
          if (!isFinite(tsEpoch)) tsEpoch = parseEpochSeconds(p.timestamp);
          var offsetSec = NaN;
          if (isFinite(tsEpoch) && tsEpoch > 0 && isFinite(trackStartEpoch)) {
            offsetSec = tsEpoch - trackStartEpoch;
          }
          // Fallback for legacy weather points without timestamps: distribute by index over track duration.
          if (!isFinite(offsetSec)) {
            if (
              isFinite(Number(totalDuration)) &&
              Number(totalDuration) > 0 &&
              features.length > 1
            ) {
              offsetSec = (i / (features.length - 1)) * Number(totalDuration);
            } else {
              offsetSec = i;
            }
          }
          items.push({ timeOffset: offsetSec, props: p });
        }
        items.sort(function (a, b) {
          return a.timeOffset - b.timeOffset;
        });
        return items;
      }

      /**
       * Interpolates weather data at a given time offset.
       * @param {Array} weatherLookup - Array of weather lookup items.
       * @param {number} ts - Time offset in seconds.
       * @returns {Object|null} Interpolated weather properties or null.
       */
      function weatherInterpolateAt(weatherLookup, ts) {
        if (!weatherLookup || !weatherLookup.length) return null;
        var n = weatherLookup.length;
        if (ts <= weatherLookup[0].timeOffset) return weatherLookup[0].props;
        if (ts >= weatherLookup[n - 1].timeOffset) return weatherLookup[n - 1].props;
        var lo = 0,
          hi = n - 1;
        while (lo < hi - 1) {
          var mid = (lo + hi) >>> 1;
          if (weatherLookup[mid].timeOffset <= ts) lo = mid;
          else hi = mid;
        }
        var frac =
          (ts - weatherLookup[lo].timeOffset) /
          Math.max(1, weatherLookup[hi].timeOffset - weatherLookup[lo].timeOffset);
        var lp = weatherLookup[lo].props,
          hp = weatherLookup[hi].props;
        function lerp(a, b) {
          var av = Number(a);
          if (!isFinite(av)) av = 0;
          var bv = Number(b);
          if (!isFinite(bv)) bv = 0;
          return av + frac * (bv - av);
        }
        return {
          rain_mm: lerp(lp.rain_mm, hp.rain_mm),
          snowfall_cm: lerp(lp.snowfall_cm, hp.snowfall_cm),
          temperature_c: lerp(
            lp.temperature_c !== undefined ? lp.temperature_c : lp.temperature_2m_c,
            hp.temperature_c !== undefined ? hp.temperature_c : hp.temperature_2m_c
          ),
          wind_speed_kmh: lerp(lp.wind_speed_kmh, hp.wind_speed_kmh),
          wind_direction_deg: lerp(lp.wind_direction_deg, hp.wind_direction_deg),
          fog_intensity: lerp(lp.fog_intensity, hp.fog_intensity),
          cloud_cover_pct: lerp(lp.cloud_cover_pct, hp.cloud_cover_pct),
        };
      }

      /**
       * Builds summary slices for the weather overview panel.
       * @param {Array} weatherLookup - Array of weather lookup items.
       * @param {number} totalDurationSec - Total duration in seconds.
       * @returns {Array} Array of slice objects for the overview.
       */
      function buildWeatherOverviewSlices(weatherLookup, totalDurationSec) {
        if (
          (!isFinite(Number(totalDurationSec)) || Number(totalDurationSec) <= 0) &&
          Array.isArray(weatherLookup) &&
          weatherLookup.length > 1
        ) {
          totalDurationSec = Number(weatherLookup[weatherLookup.length - 1].timeOffset) || 0;
        }
        if (!isFinite(Number(totalDurationSec)) || Number(totalDurationSec) <= 0) {
          totalDurationSec = 1;
        }
        var durH = totalDurationSec / 3600;
        var N = durH < 1 ? 3 : durH < 3 ? 4 : durH < 6 ? 5 : durH < 10 ? 6 : durH < 18 ? 7 : 8;
        var fogThresh =
          window.FGPX && FGPX.weatherFogThreshold != null ? FGPX.weatherFogThreshold : 0.3;
        var rainThresh =
          window.FGPX && FGPX.weatherRainThreshold != null ? FGPX.weatherRainThreshold : 0.1;
        var snowThresh =
          window.FGPX && FGPX.weatherSnowThreshold != null ? FGPX.weatherSnowThreshold : 0.1;
        var windThresh =
          window.FGPX && FGPX.weatherWindThreshold != null ? FGPX.weatherWindThreshold : 3;
        var cloudThresh =
          window.FGPX && FGPX.weatherCloudThreshold != null ? FGPX.weatherCloudThreshold : 50;
        var sliceWidth = totalDurationSec / N;
        var SAMPLES = 20;

        var baseMs = NaN;
        if (hasTimestamps && Array.isArray(timestamps) && timestamps.length > 0) {
          for (var ti = 0; ti < timestamps.length; ti++) {
            if (timestamps[ti]) {
              var parsedBase = Date.parse(timestamps[ti]);
              if (!isNaN(parsedBase)) {
                baseMs = parsedBase;
                break;
              }
            }
          }
        }

        function padTwo(n) {
          return n < 10 ? '0' + n : String(n);
        }

        var slices = [];
        for (var i = 0; i < N; i++) {
          var startSec = i * sliceWidth;
          var endSec = (i + 1) * sliceWidth;
          var peakRain = 0,
            peakSnow = 0,
            peakWind = 0,
            peakFog = 0;
          var sumCloud = 0,
            sumTemp = 0,
            rainCount = 0,
            windCount = 0,
            validSamples = 0;
          var nightCount = 0;
          var maxRain = 0,
            maxWind = 0;

          for (var s = 0; s < SAMPLES; s++) {
            var t = startSec + (s / Math.max(1, SAMPLES - 1)) * (endSec - startSec);
            var cond = weatherInterpolateAt(weatherLookup, t);
            if (!cond) continue;
            validSamples++;
            var rain = Number(cond.rain_mm) || 0;
            var snow = Number(cond.snowfall_cm) || 0;
            var wind = Number(cond.wind_speed_kmh) || 0;
            var fog = Number(cond.fog_intensity) || 0;
            var cloud = Number(cond.cloud_cover_pct) || 0;
            var temp = Number(cond.temperature_c);
            if (rain > peakRain) peakRain = rain;
            if (snow > peakSnow) peakSnow = snow;
            if (wind > peakWind) peakWind = wind;
            if (fog > peakFog) peakFog = fog;
            sumCloud += cloud;
            sumTemp += isFinite(temp) ? temp : 15;
            if (rain >= rainThresh) rainCount++;
            if (wind >= windThresh) windCount++;
            if (rain > maxRain) maxRain = rain;
            if (wind > maxWind) maxWind = wind;

            if (!isNaN(baseMs) && typeof window.SunCalc !== 'undefined') {
              try {
                var sampleDate = new Date(baseMs + t * 1000);
                var coordIdx = 0;
                if (Array.isArray(timeOffsets) && timeOffsets.length > 1) {
                  var lo = 0,
                    hi = timeOffsets.length - 1;
                  while (lo < hi) {
                    var mid2 = (lo + hi) >>> 1;
                    if (timeOffsets[mid2] < t) lo = mid2 + 1;
                    else hi = mid2;
                  }
                  coordIdx = lo;
                }
                var slat =
                  coords[coordIdx] && typeof coords[coordIdx][1] === 'number'
                    ? coords[coordIdx][1]
                    : 0;
                var slon =
                  coords[coordIdx] && typeof coords[coordIdx][0] === 'number'
                    ? coords[coordIdx][0]
                    : 0;
                var sunPos = window.SunCalc.getPosition(sampleDate, slat, slon);
                if (sunPos && sunPos.altitude < 0) nightCount++;
              } catch (_) {}
            }
          }

          var total = validSamples || 1;
          var avgCloud = sumCloud / total;
          var avgTemp = sumTemp / total;
          var rainPrevalence = rainCount / total;
          var windPrevalence = windCount / total;
          var hasNight = nightCount > 0;

          var emoji, conditionKey;
          if (peakSnow >= 2 && peakWind >= 30) {
            emoji = '\u2744\uFE0F';
            conditionKey = 'blizzard';
          } else if (peakSnow >= snowThresh) {
            emoji = '\uD83C\uDF28\uFE0F';
            conditionKey = 'snow';
          } else if (peakRain >= 5) {
            emoji = '\u26C8\uFE0F';
            conditionKey = 'thunderstorm';
          } else if (peakRain >= rainThresh && rainPrevalence >= 0.1) {
            emoji = '\uD83C\uDF27\uFE0F';
            conditionKey = 'rain';
          } else if (peakRain >= rainThresh) {
            emoji = '\uD83C\uDF26\uFE0F';
            conditionKey = 'drizzle';
          } else if (peakFog >= fogThresh) {
            emoji = '\uD83C\uDF2B\uFE0F';
            conditionKey = 'fog';
          } else if (peakWind >= windThresh && windPrevalence >= 0.5) {
            emoji = '\uD83D\uDCA8';
            conditionKey = 'wind';
          } else if (avgCloud >= cloudThresh) {
            emoji = '\u2601\uFE0F';
            conditionKey = 'overcast';
          } else if (avgCloud >= 25) {
            emoji = '\uD83C\uDF24\uFE0F';
            conditionKey = 'partlycloudy';
          } else {
            emoji = '\u2600\uFE0F';
            conditionKey = 'sunny';
          }

          var label;
          if (!isNaN(baseMs) && hasTimestamps) {
            var sDate = new Date(baseMs + startSec * 1000);
            var eDate = new Date(baseMs + endSec * 1000);
            label =
              padTwo(sDate.getHours()) +
              ':' +
              padTwo(sDate.getMinutes()) +
              '\u2013' +
              padTwo(eDate.getHours()) +
              ':' +
              padTwo(eDate.getMinutes());
          } else {
            var sMin = Math.round(startSec / 60);
            var eMin = Math.round(endSec / 60);
            label = sMin + '\u2013' + eMin + ' min';
          }

          slices.push({
            startSec: startSec,
            endSec: endSec,
            label: label,
            emoji: emoji,
            conditionKey: conditionKey,
            avgTemp: Math.round(avgTemp),
            maxRain: maxRain,
            maxWind: Math.round(maxWind),
            hasNight: hasNight,
          });
        }
        return slices;
      }

      /**
       * Renders the weather overview panel with summary cards for each slice.
       * @param {HTMLElement} panelEl - The panel element to render into.
       * @param {Array} slices - Array of weather overview slices.
       * @param {Object} i18n - Internationalization labels.
       * @returns {number} Number of rendered cards.
       */
      function renderWeatherOverviewPanel(panelEl, slices, i18n) {
        var rainThresh =
          window.FGPX && FGPX.weatherRainThreshold != null ? FGPX.weatherRainThreshold : 0.1;
        var windThresh =
          window.FGPX && FGPX.weatherWindThreshold != null ? FGPX.weatherWindThreshold : 3;
        var tempLabel = (i18n && i18n.weatherOverviewTemp) || 'Temp';
        var rainLabel = (i18n && i18n.weatherOverviewRain) || 'Rain';
        var windLabel = (i18n && i18n.weatherOverviewWind) || 'Wind';
        var nightLabel = (i18n && i18n.weatherOverviewNightSegment) || 'Nighttime segment';
        var existing = panelEl.querySelectorAll('.fgpx-weather-overview-card');
        for (var ri = existing.length - 1; ri >= 0; ri--) {
          panelEl.removeChild(existing[ri]);
        }
        var condLabels = {
          sunny: (i18n && i18n.weatherOverviewClear) || 'Clear / Sunny',
          partlycloudy: (i18n && i18n.weatherOverviewPartCloudCond) || 'Partly Cloudy',
          overcast: (i18n && i18n.weatherOverviewCloudCond) || 'Overcast',
          drizzle: (i18n && i18n.weatherOverviewDrizzleCond) || 'Drizzle',
          rain: (i18n && i18n.weatherOverviewRainCond) || 'Rain',
          thunderstorm: (i18n && i18n.weatherOverviewStormCond) || 'Heavy Rain',
          snow: (i18n && i18n.weatherOverviewSnowCond) || 'Snow',
          blizzard: (i18n && i18n.weatherOverviewBlizCond) || 'Blizzard',
          fog: (i18n && i18n.weatherOverviewFogCond) || 'Fog',
          wind: (i18n && i18n.weatherOverviewWindCond) || 'Wind',
        };
        if (!Array.isArray(slices) || slices.length === 0) {
          return 0;
        }
        var rendered = 0;
        for (var ci = 0; ci < slices.length; ci++) {
          var sl = slices[ci];
          var card = createEl('div', 'fgpx-weather-overview-card');
          var emojiSpan = createEl('span', 'fgpx-weather-overview-emoji');
          var condLabel = condLabels[sl.conditionKey] || sl.conditionKey;
          var tooltipParts = [condLabel];
          emojiSpan.setAttribute('role', 'img');
          emojiSpan.setAttribute('aria-label', condLabel);
          emojiSpan.setAttribute('tabindex', '0');
          emojiSpan.textContent = sl.emoji + (sl.hasNight ? ' \uD83C\uDF19' : '');
          tooltipParts.push(tempLabel + ': ' + sl.avgTemp + ' \u00B0C');
          if (sl.maxRain >= rainThresh) {
            tooltipParts.push(rainLabel + ': ' + sl.maxRain.toFixed(1) + ' mm');
          }
          if (sl.maxWind >= windThresh) {
            tooltipParts.push(windLabel + ': ' + sl.maxWind + ' km/h');
          }
          if (sl.hasNight) {
            tooltipParts.push(nightLabel);
          }
          emojiSpan.setAttribute('title', '');
          emojiSpan.setAttribute('data-fgpx-tooltip', tooltipParts.join(' | '));
          bindWeatherFloatingTooltip(emojiSpan);
          card.appendChild(emojiSpan);
          var labelEl = createEl('div', 'fgpx-weather-overview-label');
          labelEl.textContent = sl.label;
          card.appendChild(labelEl);
          var tempEl = createEl('div', 'fgpx-weather-overview-temp');
          tempEl.textContent = tempLabel + ': ' + sl.avgTemp + ' \u00B0C';
          card.appendChild(tempEl);
          if (sl.maxRain >= rainThresh) {
            var rainEl = createEl('div', 'fgpx-weather-overview-detail');
            rainEl.textContent = '\uD83D\uDCA7 ' + rainLabel + ': ' + sl.maxRain.toFixed(1) + ' mm';
            card.appendChild(rainEl);
          }
          if (sl.maxWind >= windThresh) {
            var windEl = createEl('div', 'fgpx-weather-overview-detail');
            windEl.textContent = '\uD83D\uDCA8 ' + windLabel + ': ' + sl.maxWind + ' km/h';
            card.appendChild(windEl);
          }
          panelEl.appendChild(card);
          rendered++;
        }
        return rendered;
      }

      /**
       * Renders the legend for the weather overview panel.
       * @param {HTMLElement} legendEl - The legend element to render into.
       * @param {Object} i18n - Internationalization labels.
       */
      function renderWeatherOverviewLegend(legendEl, i18n) {
        if (!legendEl) return;
        legendEl.innerHTML = '';
        var nightLabel = (i18n && i18n.weatherOverviewNightSegment) || 'Nighttime segment';
        var legendItems = [
          { emoji: '\u26C8\uFE0F', label: (i18n && i18n.weatherOverviewStormCond) || 'Heavy Rain' },
          { emoji: '\uD83C\uDF27\uFE0F', label: (i18n && i18n.weatherOverviewRainCond) || 'Rain' },
          { emoji: '\uD83C\uDF28\uFE0F', label: (i18n && i18n.weatherOverviewSnowCond) || 'Snow' },
          { emoji: '\uD83C\uDF2B\uFE0F', label: (i18n && i18n.weatherOverviewFogCond) || 'Fog' },
          { emoji: '\uD83D\uDCA8', label: (i18n && i18n.weatherOverviewWindCond) || 'Wind' },
          { emoji: '\u2601\uFE0F', label: (i18n && i18n.weatherOverviewCloudCond) || 'Overcast' },
          { emoji: '\u2600\uFE0F', label: (i18n && i18n.weatherOverviewClear) || 'Clear / Sunny' },
          { emoji: '\uD83C\uDF19', label: nightLabel },
        ];
        for (var li = 0; li < legendItems.length; li++) {
          var item = legendItems[li];
          var node = createEl('span', 'fgpx-weather-legend-item');
          node.setAttribute('title', '');
          node.setAttribute('tabindex', '0');
          node.setAttribute('data-fgpx-tooltip', item.label);
          bindWeatherFloatingTooltip(node);
          node.textContent = item.emoji + ' ' + item.label;
          legendEl.appendChild(node);
        }
      }

      /**
       * Returns the distance along the track at a given playback time.
       * @param {number} sec - Playback time in seconds.
       * @returns {number} Distance in meters.
       */
      function distanceAtPlaybackTime(sec) {
        if (
          !Array.isArray(timeOffsets) ||
          timeOffsets.length < 2 ||
          !Array.isArray(cumDist) ||
          cumDist.length < 2
        )
          return NaN;
        if (!isFinite(Number(sec))) return NaN;
        if (sec <= Number(timeOffsets[0])) return Number(cumDist[0]) || 0;
        if (sec >= Number(timeOffsets[timeOffsets.length - 1]))
          return Number(cumDist[cumDist.length - 1]) || 0;
        var lo = 0;
        var hi = timeOffsets.length - 1;
        while (lo < hi - 1) {
          var mid = (lo + hi) >>> 1;
          if (Number(timeOffsets[mid]) <= sec) lo = mid;
          else hi = mid;
        }
        var t0 = Number(timeOffsets[lo]);
        var t1 = Number(timeOffsets[hi]);
        var d0 = Number(cumDist[lo]);
        var d1 = Number(cumDist[Math.min(cumDist.length - 1, hi)]);
        if (!isFinite(t0) || !isFinite(t1) || !isFinite(d0) || !isFinite(d1) || t1 <= t0) return d0;
        var frac = Math.max(0, Math.min(1, (sec - t0) / (t1 - t0)));
        return d0 + (d1 - d0) * frac;
      }

      /**
       * Finds the photo marker nearest to the current playback time or distance.
       * @param {number} currentTimeSec - Current playback time in seconds.
       * @param {number} currentDistanceMeters - Current distance in meters.
       * @returns {Object|null} Photo marker object or null.
       */
      function getCinemaPhotoMarker(currentTimeSec, currentDistanceMeters) {
        var markerPhoto = currentDisplayedPhoto;
        var markerTimeSec = NaN;
        if (!markerPhoto && Array.isArray(photosByTime) && photosByTime.length > 0) {
          var idx = lowerBoundPhotoIdx(currentTimeSec);
          var prev = idx > 0 ? photosByTime[idx - 1] : null;
          var next = idx < photosByTime.length ? photosByTime[idx] : null;
          if (prev && next) {
            var prevDiff = Math.abs(Number(prev.pSec) - currentTimeSec);
            var nextDiff = Math.abs(Number(next.pSec) - currentTimeSec);
            markerPhoto = prevDiff <= nextDiff ? prev.p : next.p;
            markerTimeSec = prevDiff <= nextDiff ? Number(prev.pSec) : Number(next.pSec);
          } else if (next) {
            markerPhoto = next.p;
            markerTimeSec = Number(next.pSec);
          } else if (prev) {
            markerPhoto = prev.p;
            markerTimeSec = Number(prev.pSec);
          }
        }
        if (
          !markerPhoto &&
          Array.isArray(photos) &&
          photos.length > 0 &&
          isFinite(Number(currentDistanceMeters))
        ) {
          var closest = null;
          var closestDiff = Infinity;
          for (var pmi = 0; pmi < photos.length; pmi++) {
            var candPhoto = photos[pmi];
            var candDist = Number(candPhoto && candPhoto._distAlong);
            if (!isFinite(candDist)) continue;
            var diff = Math.abs(candDist - Number(currentDistanceMeters));
            if (diff < closestDiff) {
              closestDiff = diff;
              closest = candPhoto;
            }
          }
          markerPhoto = closest;
        }
        if (!markerPhoto) return null;
        var markerDistance = Number(markerPhoto._distAlong);
        if (!isFinite(markerDistance) && isFinite(markerTimeSec)) {
          markerDistance = distanceAtPlaybackTime(markerTimeSec);
        }
        if (!isFinite(markerDistance) && Array.isArray(photosByTime) && photosByTime.length > 0) {
          for (var pti = 0; pti < photosByTime.length; pti++) {
            if (photosByTime[pti] && photosByTime[pti].p === markerPhoto) {
              markerDistance = distanceAtPlaybackTime(photosByTime[pti].pSec);
              break;
            }
          }
        }
        if (
          !isFinite(markerDistance) &&
          typeof markerPhoto.lat === 'number' &&
          typeof markerPhoto.lon === 'number' &&
          Array.isArray(coords) &&
          coords.length > 0 &&
          Array.isArray(cumDist) &&
          cumDist.length === coords.length
        ) {
          var markerIdx = nearestCoordIndex([markerPhoto.lon, markerPhoto.lat], coords);
          if (isFinite(markerIdx) && markerIdx >= 0 && markerIdx < cumDist.length) {
            markerDistance = Number(cumDist[markerIdx]);
          }
        }
        if (!isFinite(markerDistance)) return null;
        var markerLabel =
          nonEmptyText(markerPhoto.caption) ||
          nonEmptyText(markerPhoto.title) ||
          extractFilenameFromUrl(markerPhoto.fullUrl || markerPhoto.thumbUrl || '') ||
          'Photo';
        return {
          distanceMeters: markerDistance,
          label: markerLabel,
          isCurrent: Math.abs(markerDistance - distanceAtPlaybackTime(currentTimeSec)) < 80,
        };
      }

      /**
       * Returns waypoints near the current playback distance for display in the cinema.
       * @param {number} currentDistanceMeters - Current distance in meters.
       * @returns {Array} Array of waypoint objects.
       */
      function getCinemaWaypointsNear(currentDistanceMeters) {
        if (!simulationWaypointsEnabled || !Array.isArray(waypoints) || waypoints.length === 0)
          return [];

        var waypointsInWindow = [];
        var windowRadiusM = simulationWaypointWindowMeters;
        var currentDistNum = Number(currentDistanceMeters);
        if (!isFinite(currentDistNum)) currentDistNum = 0;
        var invalidObjectCount = 0;
        var fallbackDistanceCount = 0;
        var missingDistanceCount = 0;

        for (var wi = 0; wi < waypoints.length; wi++) {
          var wp = waypoints[wi];
          if (!wp || typeof wp !== 'object') {
            invalidObjectCount++;
            continue;
          }
          var wpDist = Number(wp.distanceMeters);
          if (
            !isFinite(wpDist) &&
            typeof wp.lat === 'number' &&
            typeof wp.lon === 'number' &&
            Array.isArray(coords) &&
            coords.length > 0 &&
            Array.isArray(cumDist) &&
            cumDist.length === coords.length
          ) {
            var wpIdx = nearestCoordIndex([wp.lon, wp.lat], coords);
            if (isFinite(wpIdx) && wpIdx >= 0 && wpIdx < cumDist.length) {
              wpDist = Number(cumDist[wpIdx]);
              fallbackDistanceCount++;
            }
          }
          if (!isFinite(wpDist)) {
            missingDistanceCount++;
            continue;
          }
          var diff = Math.abs(wpDist - currentDistNum);
          if (diff <= windowRadiusM) {
            waypointsInWindow.push({
              distanceMeters: wpDist,
              label: (wp.name || 'POI').toString(),
              type: wp.type || 'waypoint',
            });
          }
        }

        if (dbgAllow('poi-window-selection', 2000)) {
          DBG.log('POI window selection', {
            totalWaypoints: waypoints.length,
            visibleWaypoints: waypointsInWindow.length,
            currentDistanceMeters: currentDistNum,
            windowRadiusMeters: windowRadiusM,
            invalidObjects: invalidObjectCount,
            missingDistance: missingDistanceCount,
            fallbackDistanceResolved: fallbackDistanceCount,
          });
        }

        return waypointsInWindow;
      }

      // City precomputation: accumulates from rendered features as the map viewport moves
      // during playback. queryRenderedFeatures only sees tiles currently in the viewport,
      // so this must be called repeatedly as playback progresses.
      var _placeLayers = null; // cached place-label layer ids from the current style
      var _placeLayersResolved = false;
      /**
       * Returns an array of place/label layer IDs from the current map style.
       * @returns {Array} Array of layer IDs (can be empty when style has no place layers).
       */
      function _getPlaceLayers() {
        if (_placeLayersResolved) return _placeLayers;
        try {
          var style = map.getStyle();
          var layers = style && Array.isArray(style.layers) ? style.layers : [];
          var found = [];
          for (var i = 0; i < layers.length; i++) {
            var l = layers[i];
            if (!l || !l.id) continue;
            var sl = (l['source-layer'] || '').toLowerCase();
            var id = l.id.toLowerCase();
            // Match common place/label layer naming across MapTiler, OpenMapTiles, Protomaps styles
            if (
              /place|settlement|locality|city|town|village|hamlet|label/.test(sl) ||
              /place.*label|label.*place|place.*name|city.*name|town.*name/.test(id)
            ) {
              found.push(l.id);
            }
          }
          _placeLayers = found;
          _placeLayersResolved = true;
          DBG.log('City place layers detected', { layers: found });
        } catch (_) {
          _placeLayers = [];
          _placeLayersResolved = true;
        }
        return _placeLayers;
      }

      /**
       * Backward-compatible wrapper for chunk-based POI loading.
       * @param {number} distanceMeters
       */
      function precomputeMapCities(distanceMeters) {
        if (!simulationCitiesEnabled || !map || !coords || coords.length === 0) return;
        if (!isFinite(Number(distanceMeters))) return;
        ensureCityChunksForDistance(distanceMeters);
      }

      /**
       * Returns city features near the current playback distance for display in the cinema.
       * @param {number} currentDistanceMeters - Current distance in meters.
       * @returns {Array} Array of city objects.
       */
      function getCinemaCitiesNear(currentDistanceMeters) {
        if (!simulationCitiesEnabled || !isFinite(Number(currentDistanceMeters))) return [];

        ensureCityChunksForDistance(currentDistanceMeters);

        var currentChunk = getCityChunkId(currentDistanceMeters);
        var windowRadiusM = simulationCityWindowMeters;
        var chunksToUse = [currentChunk - 1, currentChunk, currentChunk + 1];
        var citiesInWindow = [];

        for (var ci = 0; ci < chunksToUse.length; ci++) {
          var chunkId = chunksToUse[ci];
          if (chunkId < 0) continue;
          var chunkCities = cityChunks[chunkId];
          if (!Array.isArray(chunkCities) || chunkCities.length === 0) continue;
          for (var cIdx = 0; cIdx < chunkCities.length; cIdx++) {
            var city = chunkCities[cIdx];
            if (!city) continue;
            if (Math.abs(city.distanceMeters - currentDistanceMeters) <= windowRadiusM) {
              citiesInWindow.push(city);
            }
          }
        }

        citiesInWindow.sort(function (a, b) {
          return a.distanceMeters - b.distanceMeters;
        });
        return citiesInWindow;
      }

      /**
       * Converts a temperature in Celsius to an HSL color string for background coloring.
       * @param {number} tempC - Temperature in Celsius.
       * @returns {string} HSL color string.
       */
      function tempToHsl(tempC) {
        var t = Math.max(-20, Math.min(40, Number(tempC) || 15));
        var norm = (t + 20) / 60;
        var hue = 220 - norm * 220;
        var sat = 40 + norm * 40;
        var light = 20 + (1 - Math.abs(norm - 0.5) * 2) * 10;
        return 'hsl(' + Math.round(hue) + ',' + Math.round(sat) + '%,' + Math.round(light) + '%)';
      }

      /**
       * Determines if a given timestamp and coordinate is during nighttime using SunCalc.
       * @param {number} ts - Time offset in seconds.
       * @param {Array} coordsArr - Array of coordinates.
       * @returns {boolean} True if nighttime, false otherwise.
       */
      function isNighttime(ts, coordsArr) {
        if (!window.SunCalc || !coordsArr || !coordsArr.length || !timestamps || !timestamps.length)
          return false;
        var idx = 0;
        if (timeOffsets && timeOffsets.length > 0) {
          for (var i = 0; i < timeOffsets.length; i++) {
            if (timeOffsets[i] <= ts) idx = i;
            else break;
          }
        }
        var coord = coordsArr[idx];
        if (!coord) return false;
        var pointEpoch = parseEpochSeconds(timestamps[idx]);
        if (!isFinite(pointEpoch)) {
          var baseEpoch = NaN;
          for (var tbi = 0; tbi < timestamps.length; tbi++) {
            baseEpoch = parseEpochSeconds(timestamps[tbi]);
            if (isFinite(baseEpoch)) break;
          }
          if (!isFinite(baseEpoch)) return false;
          pointEpoch = baseEpoch + (Number(ts) || 0);
        }
        var date = new Date(pointEpoch * 1000);
        try {
          var sunPos = window.SunCalc.getPosition(date, coord[1], coord[0]);
          return sunPos.altitude < 0;
        } catch (_) {
          return false;
        }
      }

      /**
       * Returns the floating tooltip element for weather overlays, creating it if needed.
       * @returns {HTMLElement} Tooltip element.
       */
      function getWeatherFloatingTooltipEl() {
        var tooltipEl = document.getElementById('fgpx-weather-floating-tooltip');
        if (!tooltipEl) {
          tooltipEl = document.createElement('div');
          tooltipEl.id = 'fgpx-weather-floating-tooltip';
          tooltipEl.className = 'fgpx-weather-floating-tooltip';
          tooltipEl.setAttribute('role', 'tooltip');
          tooltipEl.setAttribute('aria-hidden', 'true');
          tooltipEl.style.display = 'none';
          document.body.appendChild(tooltipEl);
        }
        return tooltipEl;
      }

      /**
       * Hides the weather floating tooltip if it exists.
       */
      function hideWeatherFloatingTooltip() {
        var tooltipEl = document.getElementById('fgpx-weather-floating-tooltip');
        if (!tooltipEl) return;
        tooltipEl.style.display = 'none';
        tooltipEl.style.visibility = 'hidden';
        tooltipEl.setAttribute('aria-hidden', 'true');
        tooltipEl._target = null;
      }

      /**
       * Shows the weather floating tooltip near the target element.
       * @param {HTMLElement} targetEl - The element to anchor the tooltip to.
       * @param {string} text - Tooltip text.
       * @param {number} clientX - X coordinate for positioning.
       * @param {number} clientY - Y coordinate for positioning.
       */
      function showWeatherFloatingTooltip(targetEl, text, clientX, clientY) {
        if (!targetEl || !text) return;
        var tooltipEl = getWeatherFloatingTooltipEl();
        tooltipEl.textContent = text;
        tooltipEl.style.display = 'block';
        tooltipEl.style.visibility = 'hidden';

        var x = Number(clientX);
        var y = Number(clientY);
        if (!isFinite(x) || !isFinite(y)) {
          var rect = targetEl.getBoundingClientRect();
          x = rect.left + rect.width / 2;
          y = rect.bottom + 8;
        }

        var tooltipRect = tooltipEl.getBoundingClientRect();
        var viewportWidth = Math.max(
          document.documentElement.clientWidth || 0,
          window.innerWidth || 0
        );
        var viewportHeight = Math.max(
          document.documentElement.clientHeight || 0,
          window.innerHeight || 0
        );
        var pad = 10;
        var left = x + 12;
        var top = y + 12;

        if (left + tooltipRect.width + pad > viewportWidth) {
          left = Math.max(pad, x - tooltipRect.width - 12);
        }
        if (top + tooltipRect.height + pad > viewportHeight) {
          top = Math.max(pad, y - tooltipRect.height - 12);
        }

        tooltipEl.style.left = Math.round(left) + 'px';
        tooltipEl.style.top = Math.round(top) + 'px';
        tooltipEl.style.visibility = 'visible';
        tooltipEl.setAttribute('aria-hidden', 'false');
        tooltipEl._target = targetEl;
      }

      /**
       * Binds floating tooltip events to a target element for weather overlays.
       * @param {HTMLElement} targetEl - The element to bind events to.
       */
      function bindWeatherFloatingTooltip(targetEl) {
        if (!targetEl) return;
        var getTooltipText = function () {
          return targetEl.getAttribute('data-fgpx-tooltip') || targetEl.getAttribute('title') || '';
        };

        targetEl.addEventListener('mouseenter', function (ev) {
          showWeatherFloatingTooltip(targetEl, getTooltipText(), ev.clientX, ev.clientY);
        });
        targetEl.addEventListener('mousemove', function (ev) {
          showWeatherFloatingTooltip(targetEl, getTooltipText(), ev.clientX, ev.clientY);
        });
        targetEl.addEventListener('mouseleave', hideWeatherFloatingTooltip);
        targetEl.addEventListener('focus', function () {
          showWeatherFloatingTooltip(targetEl, getTooltipText(), NaN, NaN);
        });
        targetEl.addEventListener('blur', hideWeatherFloatingTooltip);
      }

      /**
       * Creates the weather cinema overlay element and legend for the simulation tab.
       * @param {HTMLElement} containerEl - The container element.
       * @param {Object} payloadData - Weather payload data.
       * @param {number} currentTimeSec - Current playback time in seconds.
       * @param {boolean} isCurrentlyPlaying - Whether playback is active.
       * @returns {HTMLElement} The created cinema element.
       */
      function createWeatherCinema(containerEl, payloadData, currentTimeSec, isCurrentlyPlaying) {
        var i18n = window.FGPX && FGPX.i18n ? FGPX.i18n : {};
        var cinema = document.createElement('div');
        cinema.className = 'fgpx-weather-cinema' + (isCurrentlyPlaying ? '' : ' is-paused');
        cinema.style.display = 'flex';
        cinema.setAttribute('data-fgpx-cinema', '1');

        [
          'fgpx-weather-bg',
          'fgpx-weather-layer-daynight',
          'fgpx-weather-layer-clear',
          'fgpx-weather-layer-clouds',
          'fgpx-weather-layer-fog',
          'fgpx-weather-layer-wind',
          'fgpx-weather-layer-rain',
          'fgpx-weather-layer-snow',
          'fgpx-weather-future-fade',
          'fgpx-weather-now-line',
        ].forEach(function (cls) {
          var el = document.createElement('div');
          el.className = cls;
          cinema.appendChild(el);
        });

        var gradeWrap = document.createElement('div');
        gradeWrap.className = 'fgpx-weather-grade-indicator';
        var gradeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        gradeSvg.setAttribute('viewBox', '0 0 400 40');
        gradeSvg.setAttribute('preserveAspectRatio', 'none');
        gradeSvg.setAttribute('class', 'fgpx-weather-grade-svg');
        var gradePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        gradePath.setAttribute('fill', 'rgba(100,100,100,0.5)');
        gradeSvg.appendChild(gradePath);
        gradeWrap.appendChild(gradeSvg);
        cinema.appendChild(gradeWrap);

        var celestial = document.createElement('div');
        celestial.className = 'fgpx-weather-celestial';
        celestial.textContent = '\u2600\uFE0F';
        var dayTooltip = i18n.simCelestialDayAria || 'Daytime indicator (sun)';
        celestial.setAttribute('role', 'img');
        celestial.setAttribute('title', ''); // Prevent native tooltip
        celestial.setAttribute('aria-label', dayTooltip);
        celestial.setAttribute('data-fgpx-tooltip', dayTooltip);
        cinema.appendChild(celestial);
        bindWeatherFloatingTooltip(celestial);

        var conditionIcons = document.createElement('div');
        conditionIcons.className = 'fgpx-weather-conditions-icons';
        conditionIcons.textContent = '';
        var conditionIconsTooltip =
          i18n.simConditionIconsAria || 'Weather condition icons: fog, clouds, rain, snow, wind';
        conditionIcons.setAttribute('role', 'img');
        conditionIcons.setAttribute('title', ''); // Prevent native tooltip
        conditionIcons.setAttribute('aria-label', conditionIconsTooltip);
        conditionIcons.setAttribute('data-fgpx-tooltip', conditionIconsTooltip);
        cinema.appendChild(conditionIcons);
        bindWeatherFloatingTooltip(conditionIcons);

        var mileageRuler = document.createElement('div');
        mileageRuler.className = 'fgpx-weather-mileage-ruler';
        var mileageTrack = document.createElement('div');
        mileageTrack.className = 'fgpx-weather-mileage-track';
        var mileageMarks = document.createElement('div');
        mileageMarks.className = 'fgpx-weather-mileage-marks';
        mileageRuler.appendChild(mileageTrack);
        mileageRuler.appendChild(mileageMarks);
        cinema.appendChild(mileageRuler);

        var photoMarker = document.createElement('div');
        photoMarker.className = 'fgpx-weather-photo-marker';
        photoMarker.style.display = 'none';
        var photoMarkerLine = document.createElement('div');
        photoMarkerLine.className = 'fgpx-weather-photo-marker-line';
        var photoMarkerLabel = document.createElement('div');
        photoMarkerLabel.className = 'fgpx-weather-photo-marker-label';
        photoMarker.appendChild(photoMarkerLine);
        photoMarker.appendChild(photoMarkerLabel);
        cinema.appendChild(photoMarker);

        var poisContainer = document.createElement('div');
        poisContainer.className = 'fgpx-weather-pois-container';
        cinema.appendChild(poisContainer);

        var cityMarkersContainer = document.createElement('div');
        cityMarkersContainer.className = 'fgpx-weather-cities-container';
        cinema.appendChild(cityMarkersContainer);

        var bicycle = document.createElement('div');
        bicycle.className = 'fgpx-weather-bicycle';
        var bikeIcon = document.createElement('div');
        bikeIcon.className = 'fgpx-weather-bicycle-icon';
        bikeIcon.setAttribute('role', 'img');
        bikeIcon.setAttribute('aria-label', 'Cyclist position');
        bikeIcon.style.transform = 'scaleX(-1)';
        bikeIcon.textContent = '\uD83D\uDEB4';
        bicycle.appendChild(bikeIcon);
        cinema.appendChild(bicycle);

        var legend = document.createElement('div');
        legend.className = 'fgpx-weather-legend';
        legend.setAttribute('role', 'group');
        legend.setAttribute(
          'aria-label',
          i18n.simulationLegendAria || 'Weather and route grade metrics'
        );
        [
          {
            cls: 'fgpx-legend-mileage',
            label: (i18n.simMileage || 'Mileage') + ': -- km',
            aria: i18n.simMileageAria || 'Current mileage in kilometers',
          },
          {
            cls: 'fgpx-legend-duration',
            label: (i18n.simDuration || 'Duration') + ': --:--:--',
            aria: i18n.simDurationAria || 'Current elapsed duration',
          },
          {
            cls: 'fgpx-legend-grade',
            label: (i18n.simGrade || 'Grade') + ': --',
            aria: i18n.simGradeAria || 'Current route grade percentage',
          },
          {
            cls: 'fgpx-legend-elevation',
            label: (i18n.simElevation || 'Elevation') + ': -- m',
            aria: i18n.simElevationAria || 'Current elevation in meters',
          },
          {
            cls: 'fgpx-legend-temp',
            label: (i18n.simTemp || 'Temp') + ': -- \u00B0C',
            aria: i18n.simTempAria || 'Current temperature in degrees Celsius',
          },
          {
            cls: 'fgpx-legend-wind',
            label: (i18n.simWind || 'Wind') + ': -- km/h',
            aria: i18n.simWindAria || 'Current wind speed in kilometers per hour',
          },
          {
            cls: 'fgpx-legend-sun',
            label: (i18n.simSun || 'Sun') + ': --\u00B0',
            aria: i18n.simSunAria || 'Current sun altitude in degrees',
          },
          {
            cls: 'fgpx-legend-moon',
            label: (i18n.simMoon || 'Moon') + ': --\u00B0',
            aria: i18n.simMoonAria || 'Current moon altitude in degrees',
          },
          {
            cls: 'fgpx-legend-conditions',
            label: '',
            aria: i18n.simConditionsAria || 'Current weather conditions summary',
          },
        ].forEach(function (item) {
          var span = document.createElement('span');
          span.className = 'fgpx-weather-legend-item ' + item.cls;
          span.textContent = item.label;
          span.setAttribute('aria-label', item.aria);
          if (item.cls === 'fgpx-legend-conditions') {
            span.setAttribute('aria-live', 'polite');
          }
          legend.appendChild(span);
        });

        var chartWrapEl = containerEl.querySelector('.fgpx-chart-wrap');
        if (chartWrapEl && chartWrapEl.parentElement) {
          chartWrapEl.parentElement.insertBefore(cinema, chartWrapEl.nextSibling);
          chartWrapEl.parentElement.insertBefore(legend, cinema.nextSibling);
        } else {
          containerEl.appendChild(cinema);
          containerEl.appendChild(legend);
        }

        cinema._legend = legend;
        cinema._els = {
          bg: cinema.querySelector('.fgpx-weather-bg'),
          daynight: cinema.querySelector('.fgpx-weather-layer-daynight'),
          celestial: cinema.querySelector('.fgpx-weather-celestial'),
          conditionIcons: cinema.querySelector('.fgpx-weather-conditions-icons'),
          rain: cinema.querySelector('.fgpx-weather-layer-rain'),
          snow: cinema.querySelector('.fgpx-weather-layer-snow'),
          fog: cinema.querySelector('.fgpx-weather-layer-fog'),
          wind: cinema.querySelector('.fgpx-weather-layer-wind'),
          clouds: cinema.querySelector('.fgpx-weather-layer-clouds'),
          mileageRuler: cinema.querySelector('.fgpx-weather-mileage-ruler'),
          mileageTrack: cinema.querySelector('.fgpx-weather-mileage-track'),
          mileageMarks: cinema.querySelector('.fgpx-weather-mileage-marks'),
          photoMarker: cinema.querySelector('.fgpx-weather-photo-marker'),
          photoMarkerLabel: cinema.querySelector('.fgpx-weather-photo-marker-label'),
          poiContainer: cinema.querySelector('.fgpx-weather-pois-container'),
          citiesContainer: cinema.querySelector('.fgpx-weather-cities-container'),
          gradePath: cinema.querySelector('.fgpx-weather-grade-svg path'),
          bike: cinema.querySelector('.fgpx-weather-bicycle'),
        };
        cinema._legendEls = {
          mileage: legend.querySelector('.fgpx-legend-mileage'),
          duration: legend.querySelector('.fgpx-legend-duration'),
          grade: legend.querySelector('.fgpx-legend-grade'),
          elevation: legend.querySelector('.fgpx-legend-elevation'),
          temp: legend.querySelector('.fgpx-legend-temp'),
          wind: legend.querySelector('.fgpx-legend-wind'),
          sun: legend.querySelector('.fgpx-legend-sun'),
          moon: legend.querySelector('.fgpx-legend-moon'),
          conditions: legend.querySelector('.fgpx-legend-conditions'),
        };
        cinema._weatherLookup = buildWeatherLookup(payloadData);
        updateWeatherCinema(cinema, payloadData, currentTimeSec, isCurrentlyPlaying, true);
        return cinema;
      }

      /**
       * Updates the weather cinema overlay with current playback state and weather data.
       * @param {HTMLElement} cinemaEl - The cinema element.
       * @param {Object} payloadData - Weather payload data.
       * @param {number} currentTimeSec - Current playback time in seconds.
       * @param {boolean} isCurrentlyPlaying - Whether playback is active.
       * @param {boolean} forceUpdate - Force update even if throttled.
       */
      function updateWeatherCinema(
        cinemaEl,
        payloadData,
        currentTimeSec,
        isCurrentlyPlaying,
        forceUpdate
      ) {
        if (!cinemaEl || cinemaEl.style.display === 'none') return;
        var floatingTooltipEl = document.getElementById('fgpx-weather-floating-tooltip');
        if (
          floatingTooltipEl &&
          floatingTooltipEl._target &&
          !document.contains(floatingTooltipEl._target)
        ) {
          hideWeatherFloatingTooltip();
        }
        var now = Date.now();
        var lastUpdate = Number(cinemaEl._lastUpdate || 0);
        if (!forceUpdate && now - lastUpdate < 100) return;
        cinemaEl._lastUpdate = now;
        var perfStart =
          typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
        var perfPoiMs = 0;
        var perfCityMs = 0;
        var perfPoiRendered = -1;
        var perfCityRendered = -1;
        var perfPoiWindow = -1;
        var perfCityWindow = -1;

        var els = cinemaEl._els || {};

        if (isCurrentlyPlaying) cinemaEl.classList.remove('is-paused');
        else cinemaEl.classList.add('is-paused');

        function setStyleIfChanged(el, key, value) {
          if (!el) return;
          if (el.style[key] !== value) {
            el.style[key] = value;
          }
        }

        function setTextIfChanged(el, value) {
          if (!el) return;
          if (el.textContent !== value) {
            el.textContent = value;
          }
        }

        function setAttrIfChanged(el, attr, value) {
          if (!el) return;
          if (el.getAttribute(attr) !== value) {
            el.setAttribute(attr, value);
          }
        }

        var fogThresh =
          window.FGPX && FGPX.weatherFogThreshold != null ? FGPX.weatherFogThreshold : 0.3;
        var rainThresh =
          window.FGPX && FGPX.weatherRainThreshold != null ? FGPX.weatherRainThreshold : 0.1;
        var snowThresh =
          window.FGPX && FGPX.weatherSnowThreshold != null ? FGPX.weatherSnowThreshold : 0.1;
        var windThresh =
          window.FGPX && FGPX.weatherWindThreshold != null ? FGPX.weatherWindThreshold : 3;
        var cloudThresh =
          window.FGPX && FGPX.weatherCloudThreshold != null ? FGPX.weatherCloudThreshold : 50;
        var simI18N = window.FGPX && FGPX.i18n ? FGPX.i18n : {};

        var cond = weatherInterpolateAt(cinemaEl._weatherLookup, currentTimeSec) || {
          rain_mm: 0,
          snowfall_cm: 0,
          temperature_c: 15,
          wind_speed_kmh: 0,
          wind_direction_deg: 0,
          fog_intensity: 0,
          cloud_cover_pct: 0,
        };

        var gradeAtNow = 0;
        var elevationAtNow = 0;
        if (Array.isArray(coords) && coords.length > 1 && timeOffsets && timeOffsets.length > 0) {
          var ci = 0;
          if (currentTimeSec <= timeOffsets[0]) {
            ci = 0;
          } else if (currentTimeSec >= timeOffsets[timeOffsets.length - 1]) {
            ci = timeOffsets.length - 1;
          } else {
            var loCi = 0,
              hiCi = timeOffsets.length - 1;
            while (loCi < hiCi) {
              var midCi = (loCi + hiCi + 1) >>> 1;
              if (timeOffsets[midCi] <= currentTimeSec) loCi = midCi;
              else hiCi = midCi - 1;
            }
            ci = loCi;
          }
          var cCoord = coords[ci];
          elevationAtNow = cCoord && cCoord[2] != null ? Number(cCoord[2]) : 0;
          if (ci > 2) {
            var ciPrev = Math.max(0, ci - 5);
            var cPrev = coords[ciPrev];
            var elevDiff =
              elevationAtNow - (cPrev && cPrev[2] != null ? Number(cPrev[2]) : elevationAtNow);
            var distDiff =
              Array.isArray(cumDist) && cumDist[ci] != null && cumDist[ciPrev] != null
                ? cumDist[ci] - cumDist[ciPrev]
                : 0;
            gradeAtNow = distDiff > 0 ? (elevDiff / distDiff) * 100 : 0;
          }
        }

        var bg = els.bg;
        if (!bg) {
          bg = cinemaEl.querySelector('.fgpx-weather-bg');
          els.bg = bg;
        }
        setStyleIfChanged(bg, 'backgroundColor', tempToHsl(cond.temperature_c));

        var night = false;
        var nightCacheKey = Math.floor((Number(currentTimeSec) || 0) * 2);
        if (cinemaEl._nightCache && cinemaEl._nightCache.key === nightCacheKey) {
          night = !!cinemaEl._nightCache.value;
        } else {
          night = isNighttime(currentTimeSec, coords);
          cinemaEl._nightCache = { key: nightCacheKey, value: night };
        }
        var dnLayer = els.daynight;
        if (!dnLayer) {
          dnLayer = cinemaEl.querySelector('.fgpx-weather-layer-daynight');
          els.daynight = dnLayer;
        }
        if (dnLayer) {
          if (night) {
            setStyleIfChanged(
              dnLayer,
              'background',
              'linear-gradient(to bottom, #050d1a 0%, #0a1535 100%)'
            );
          } else {
            var skyHue = 200 + Math.round((Number(cond.temperature_c) || 15) * 0.5);
            setStyleIfChanged(
              dnLayer,
              'background',
              'linear-gradient(to bottom, hsl(' +
                skyHue +
                ',60%,45%) 0%, hsl(' +
                skyHue +
                ',50%,65%) 100%)'
            );
          }
        }

        var celestial = els.celestial;
        if (!celestial) {
          celestial = cinemaEl.querySelector('.fgpx-weather-celestial');
          els.celestial = celestial;
        }
        setTextIfChanged(celestial, night ? '\uD83C\uDF19' : '\u2600\uFE0F');
        var celestialTooltip = night
          ? simI18N.simCelestialNightAria || 'Night indicator (moon)'
          : simI18N.simCelestialDayAria || 'Daytime indicator (sun)';
        setAttrIfChanged(celestial, 'title', ''); // Keep title empty to prevent native tooltip
        setAttrIfChanged(celestial, 'aria-label', celestialTooltip);
        setAttrIfChanged(celestial, 'data-fgpx-tooltip', celestialTooltip);

        var snowForIcons = Number(cond.snowfall_cm);
        if (!isFinite(snowForIcons)) {
          snowForIcons =
            (Number(cond.rain_mm) || 0) >= rainThresh && (Number(cond.temperature_c) || 15) < 2
              ? Number(cond.rain_mm) || 0
              : 0;
        }
        var activeIcons = [];
        var activeConditionLabels = [];
        if ((Number(cond.fog_intensity) || 0) >= fogThresh) {
          activeIcons.push('\uD83C\uDF2B\uFE0F');
          activeConditionLabels.push(simI18N.simCondFog || 'Fog');
        }
        if ((Number(cond.cloud_cover_pct) || 0) >= cloudThresh) {
          activeIcons.push('\u2601\uFE0F');
          activeConditionLabels.push(simI18N.simCondClouds || 'Clouds');
        }
        if ((Number(cond.rain_mm) || 0) >= rainThresh) {
          activeIcons.push('\uD83C\uDF27\uFE0F');
          activeConditionLabels.push(simI18N.simCondRain || 'Rain');
        }
        if (snowForIcons >= snowThresh) {
          activeIcons.push('\u2744\uFE0F');
          activeConditionLabels.push(simI18N.simCondSnow || 'Snow');
        }
        if ((Number(cond.wind_speed_kmh) || 0) >= windThresh) {
          activeIcons.push('\uD83D\uDCA8');
          activeConditionLabels.push(simI18N.simCondWind || 'Wind');
        }

        var conditionIcons = els.conditionIcons;
        if (!conditionIcons) {
          conditionIcons = cinemaEl.querySelector('.fgpx-weather-conditions-icons');
          els.conditionIcons = conditionIcons;
        }
        setTextIfChanged(
          conditionIcons,
          activeIcons.length > 0 ? activeIcons.join(' ') : '\u2600\uFE0F'
        );
        var activeIconsPrefix = simI18N.simConditionIconsActivePrefix || 'Active weather icons';
        var conditionTooltip =
          activeConditionLabels.length > 0
            ? activeIconsPrefix + ': ' + activeConditionLabels.join(', ')
            : activeIconsPrefix + ': ' + (simI18N.simConditionIconsClear || 'Clear conditions');
        setAttrIfChanged(conditionIcons, 'title', ''); // Keep title empty to prevent native tooltip
        setAttrIfChanged(conditionIcons, 'aria-label', conditionTooltip);
        setAttrIfChanged(conditionIcons, 'data-fgpx-tooltip', conditionTooltip);

        var rainLayer = els.rain;
        if (!rainLayer) {
          rainLayer = cinemaEl.querySelector('.fgpx-weather-layer-rain');
          els.rain = rainLayer;
        }
        var rainIntensity = Math.max(
          0,
          Math.min(1, ((Number(cond.rain_mm) || 0) - rainThresh) / 5)
        );
        setStyleIfChanged(
          rainLayer,
          'opacity',
          (Number(cond.rain_mm) || 0) >= rainThresh ? String(0.3 + rainIntensity * 0.7) : '0'
        );

        var snowLayer = els.snow;
        if (!snowLayer) {
          snowLayer = cinemaEl.querySelector('.fgpx-weather-layer-snow');
          els.snow = snowLayer;
        }
        var snowVal = Number(cond.snowfall_cm);
        if (!isFinite(snowVal)) {
          snowVal =
            (Number(cond.rain_mm) || 0) >= rainThresh && (Number(cond.temperature_c) || 15) < 2
              ? Number(cond.rain_mm) || 0
              : 0;
        }
        setStyleIfChanged(
          snowLayer,
          'opacity',
          snowVal >= snowThresh ? String(Math.min(1, 0.3 + snowVal / 5)) : '0'
        );

        var fogLayer = els.fog;
        if (!fogLayer) {
          fogLayer = cinemaEl.querySelector('.fgpx-weather-layer-fog');
          els.fog = fogLayer;
        }
        setStyleIfChanged(
          fogLayer,
          'opacity',
          (Number(cond.fog_intensity) || 0) >= fogThresh
            ? String(Math.min(1, Number(cond.fog_intensity) || 0))
            : '0'
        );

        var windLayer = els.wind;
        if (!windLayer) {
          windLayer = cinemaEl.querySelector('.fgpx-weather-layer-wind');
          els.wind = windLayer;
        }
        if (windLayer) {
          var windSpeedNow = Math.max(0, Number(cond.wind_speed_kmh) || 0);
          var riderHeadingDeg = 270;
          if (Array.isArray(coords) && coords.length > 1) {
            var headingIdx = Math.max(0, Math.min(coords.length - 1, isFinite(ci) ? ci : 0));
            var prevIdx = Math.max(0, headingIdx - 1);
            var nextIdx = Math.min(coords.length - 1, headingIdx + 1);
            if (nextIdx !== headingIdx) {
              riderHeadingDeg = bearingBetween(coords[headingIdx], coords[nextIdx]);
            } else if (headingIdx !== prevIdx) {
              riderHeadingDeg = bearingBetween(coords[prevIdx], coords[headingIdx]);
            }
          }

          var windFromDeg = normalizeAngle(Number(cond.wind_direction_deg) || 0);
          var relWindDelta = Math.abs(shortestAngleDelta(riderHeadingDeg, windFromDeg));
          var windDirectionMode = 'side';
          if (relWindDelta <= 50) windDirectionMode = 'head';
          else if (relWindDelta >= 130) windDirectionMode = 'tail';

          windLayer.classList.toggle('is-headwind', windDirectionMode === 'head');
          windLayer.classList.toggle('is-tailwind', windDirectionMode === 'tail');
          windLayer.classList.toggle('is-sidewind', windDirectionMode === 'side');

          if (windSpeedNow >= windThresh && windDirectionMode !== 'side') {
            var windOpacity = Math.min(0.9, 0.55 + (windSpeedNow - windThresh) / 20);
            setStyleIfChanged(windLayer, 'opacity', String(windOpacity));
            var windSpeedFactor = Math.max(0, Math.min(1, (windSpeedNow - windThresh) / 40));
            var windAnimDuration = 2.3 - 1.7 * windSpeedFactor;
            setStyleIfChanged(windLayer, 'animationDuration', windAnimDuration.toFixed(2) + 's');
            setStyleIfChanged(
              windLayer,
              'filter',
              'saturate(0.95) drop-shadow(0 0 1px rgba(255,255,255,0.3))'
            );
          } else {
            setStyleIfChanged(windLayer, 'opacity', '0');
            setStyleIfChanged(windLayer, 'filter', 'none');
          }
        }

        var cloudsLayer = els.clouds;
        if (!cloudsLayer) {
          cloudsLayer = cinemaEl.querySelector('.fgpx-weather-layer-clouds');
          els.clouds = cloudsLayer;
        }
        setStyleIfChanged(
          cloudsLayer,
          'opacity',
          (Number(cond.cloud_cover_pct) || 0) >= cloudThresh
            ? String(Math.min(0.8, (Number(cond.cloud_cover_pct) || 0) / 100))
            : '0'
        );

        var gradePath = els.gradePath;
        if (!gradePath) {
          gradePath = cinemaEl.querySelector('.fgpx-weather-grade-svg path');
          els.gradePath = gradePath;
        }
        if (gradePath) {
          var baseY = 40;
          var bikeX = 200; // 50% of 400 viewBox width: centered "now" anchor
          var maxPeak = 18;
          // Visual zoom only: tighten weather-grade horizon from roughly +/-15 min to +/-10 min.
          var timelineZoomFactor = 1.5;
          var sampleSpan = Math.max(8, Math.round(24 / timelineZoomFactor));
          var relDivisor = 120;
          var points = [];
          for (var gx = 0; gx <= 400; gx += 25) {
            var rel = (gx - bikeX) / relDivisor;
            var envelope = Math.max(0.18, 1 - Math.pow(Math.min(1, Math.abs(rel)), 1.15));
            var elevAdj = 0;
            if (Array.isArray(coords) && coords.length > 1) {
              var idxFloat = ci + rel * sampleSpan;
              var idxLo = Math.max(0, Math.min(coords.length - 1, Math.floor(idxFloat)));
              var idxHi = Math.max(0, Math.min(coords.length - 1, Math.ceil(idxFloat)));
              var frac = idxFloat - idxLo;
              var loElev =
                coords[idxLo] && coords[idxLo][2] != null
                  ? Number(coords[idxLo][2])
                  : elevationAtNow;
              var hiElev =
                coords[idxHi] && coords[idxHi][2] != null ? Number(coords[idxHi][2]) : loElev;
              var sampleElev = loElev + (hiElev - loElev) * frac;
              elevAdj = (sampleElev - elevationAtNow) * 0.3;
            }
            var tilt = Math.max(-0.28, Math.min(0.28, gradeAtNow / 18));
            // Positive grade should rise toward future (right side).
            var shapeHeight = envelope * maxPeak + elevAdj + rel * 1.6 * tilt;
            shapeHeight = Math.max(0, Math.min(baseY, shapeHeight));
            var y = baseY - shapeHeight;
            points.push({ x: gx, y: Math.round(y), yRaw: y });
          }
          var d = 'M0,' + baseY + ' L0,' + points[0].y;
          for (var pi = 1; pi < points.length; pi++) {
            d += ' L' + points[pi].x + ',' + points[pi].y;
          }
          d += ' L400,' + baseY + ' Z';
          gradePath.setAttribute('d', d);

          // Anchor bicycle wheels to the terrain at the current (bikeX) location.
          var bikeSurfaceY = baseY;
          var bikeSlopeDeg = 0;
          if (points.length > 1) {
            for (var bi = 1; bi < points.length; bi++) {
              if (points[bi].x >= bikeX) {
                var p0 = points[bi - 1];
                var p1 = points[bi];
                var span = Math.max(1, p1.x - p0.x);
                var f = (bikeX - p0.x) / span;
                bikeSurfaceY = p0.yRaw + (p1.yRaw - p0.yRaw) * f;
                // Use a symmetric tangent around bikeX to avoid one-sided bias on tiny grades.
                var leftIdx = Math.max(0, bi - 1);
                var rightIdx = Math.min(points.length - 1, bi + 1);
                var pLeft = points[leftIdx];
                var pRight = points[rightIdx];
                var tangentDx = Math.max(1, pRight.x - pLeft.x);
                bikeSlopeDeg = (Math.atan2(pRight.yRaw - pLeft.yRaw, tangentDx) * 180) / Math.PI;
                if (Math.abs(bikeSlopeDeg) < 0.6) bikeSlopeDeg = 0;
                break;
              }
            }
          }
          var bikeLift = Math.max(0, baseY - bikeSurfaceY);
          var wheelContactCalibration = -4;
          var bikeEl = els.bike;
          if (!bikeEl) {
            bikeEl = cinemaEl.querySelector('.fgpx-weather-bicycle');
            els.bike = bikeEl;
          }
          if (bikeEl) {
            var cinemaFloorOffset = cinemaEl._floorOffsetPx;
            if (!isFinite(cinemaFloorOffset)) {
              cinemaFloorOffset = parseFloat(
                getComputedStyle(cinemaEl).getPropertyValue('--fgpx-cinema-floor-offset')
              );
              if (!isFinite(cinemaFloorOffset)) cinemaFloorOffset = 0;
              cinemaEl._floorOffsetPx = cinemaFloorOffset;
            }
            bikeEl.style.bottom =
              String(
                Math.max(0, Math.round(cinemaFloorOffset + bikeLift + wheelContactCalibration))
              ) + 'px';
            var targetBikeAngle = Math.max(-14, Math.min(14, bikeSlopeDeg));
            var prevBikeAngle = isFinite(Number(cinemaEl._bikeAngle))
              ? Number(cinemaEl._bikeAngle)
              : targetBikeAngle;
            var smoothedBikeAngle = prevBikeAngle * 0.82 + targetBikeAngle * 0.18;
            cinemaEl._bikeAngle = smoothedBikeAngle;
            bikeEl.style.transform =
              'translateX(-50%) rotate(' + smoothedBikeAngle.toFixed(2) + 'deg)';
          }

          var gradeAbs = Math.abs(gradeAtNow);
          var gradeFill = 'rgba(100,140,100,0.4)';
          if (gradeAbs > 10) gradeFill = 'rgba(220,80,80,0.45)';
          else if (gradeAbs > 5) gradeFill = 'rgba(200,130,50,0.4)';
          gradePath.setAttribute('fill', gradeFill);
          if (cinemaEl.style.getPropertyValue('--fgpx-grade-fill') !== gradeFill) {
            cinemaEl.style.setProperty('--fgpx-grade-fill', gradeFill);
          }
        }

        var distanceNowMeters = Math.max(0, Math.min(totalDistance, progress * totalDistance));
        if (
          Array.isArray(cumDist) &&
          cumDist.length > 1 &&
          Array.isArray(timeOffsets) &&
          timeOffsets.length > 1 &&
          isFinite(ci)
        ) {
          var ciNext = Math.min(timeOffsets.length - 1, ci + 1);
          var t0 = Number(timeOffsets[ci]);
          var t1 = Number(timeOffsets[ciNext]);
          var d0 = Number(cumDist[ci]);
          var d1 = Number(cumDist[Math.min(cumDist.length - 1, ciNext)]);
          if (isFinite(t0) && isFinite(t1) && isFinite(d0) && isFinite(d1) && t1 > t0) {
            var tt = Math.max(0, Math.min(1, (currentTimeSec - t0) / (t1 - t0)));
            distanceNowMeters = d0 + (d1 - d0) * tt;
          }
        }

        // Accumulate city data for the current route segment in a low-frequency background task.
        if (simulationCitiesEnabled && map) {
          var lastCityScan = Number(cinemaEl._lastCityScan || 0);
          if (now - lastCityScan > 3000) {
            cinemaEl._lastCityScan = now;
            try {
              precomputeMapCities(distanceNowMeters);
            } catch (_) {}
          }
        }

        var elapsedNowSec = isFinite(Number(currentTimeSec))
          ? Number(currentTimeSec)
          : progress * (isFinite(totalDuration) ? totalDuration : 0);
        if (isFinite(totalDuration) && totalDuration > 0)
          elapsedNowSec = Math.max(0, Math.min(totalDuration, elapsedNowSec));

        var mileageRulerEl = els.mileageRuler;
        if (!mileageRulerEl) {
          mileageRulerEl = cinemaEl.querySelector('.fgpx-weather-mileage-ruler');
          els.mileageRuler = mileageRulerEl;
        }
        var mileageTrackEl = els.mileageTrack;
        if (!mileageTrackEl) {
          mileageTrackEl = cinemaEl.querySelector('.fgpx-weather-mileage-track');
          els.mileageTrack = mileageTrackEl;
        }
        var mileageMarksEl = els.mileageMarks;
        if (!mileageMarksEl) {
          mileageMarksEl = cinemaEl.querySelector('.fgpx-weather-mileage-marks');
          els.mileageMarks = mileageMarksEl;
        }
        if (mileageTrackEl && mileageMarksEl) {
          var trackWidth = mileageTrackEl.clientWidth || mileageTrackEl.offsetWidth || 0;
          if (trackWidth > 0) {
            var currentKm = distanceNowMeters / 1000;
            var totalKm = totalDistance / 1000;
            var visibleKm = 20;
            var halfVisibleKm = visibleKm / 2;
            var pxPerKm = trackWidth / visibleKm;
            var startKm = Math.max(0, currentKm - halfVisibleKm);
            var endKm = Math.min(totalKm, currentKm + halfVisibleKm);
            var firstMarkKm = Math.ceil(startKm / 5) * 5;
            var marksHtml = '';
            for (var markKm = firstMarkKm; markKm <= endKm + 0.0001; markKm += 5) {
              var markLeft = trackWidth / 2 + (markKm - currentKm) * pxPerKm;
              if (markLeft < -24 || markLeft > trackWidth + 24) continue;
              marksHtml +=
                '<span class="fgpx-weather-mileage-mark" style="left:' +
                Math.round(markLeft) +
                'px">' +
                '<span class="fgpx-weather-mileage-mark-tick"></span>' +
                '<span class="fgpx-weather-mileage-mark-label">' +
                formatNumber(markKm, 0) +
                ' km</span>' +
                '</span>';
            }
            if (mileageMarksEl.innerHTML !== marksHtml) {
              mileageMarksEl.innerHTML = marksHtml;
            }
          }
        }

        var photoMarkerEl = els.photoMarker;
        if (!photoMarkerEl) {
          photoMarkerEl = cinemaEl.querySelector('.fgpx-weather-photo-marker');
          els.photoMarker = photoMarkerEl;
        }
        var photoMarkerLabelEl = els.photoMarkerLabel;
        if (!photoMarkerLabelEl) {
          photoMarkerLabelEl = cinemaEl.querySelector('.fgpx-weather-photo-marker-label');
          els.photoMarkerLabel = photoMarkerLabelEl;
        }
        if (photoMarkerEl && photoMarkerLabelEl && mileageTrackEl && mileageRulerEl) {
          var photoTrackWidth = mileageTrackEl.clientWidth || mileageTrackEl.offsetWidth || 0;
          var activePhotoMarker = getCinemaPhotoMarker(currentTimeSec, distanceNowMeters);
          if (photoTrackWidth > 0 && activePhotoMarker) {
            var photoVisibleKm = 20;
            var photoPxPerKm = photoTrackWidth / photoVisibleKm;
            var photoLeft =
              photoTrackWidth / 2 +
              ((activePhotoMarker.distanceMeters - distanceNowMeters) / 1000) * photoPxPerKm;
            if (photoLeft >= -18 && photoLeft <= photoTrackWidth + 18) {
              photoMarkerEl.style.display = 'block';
              photoMarkerEl.style.left =
                String(Math.round((mileageRulerEl.offsetLeft || 0) + photoLeft)) + 'px';
              photoMarkerEl.classList.toggle('is-current', !!activePhotoMarker.isCurrent);
              var photoName =
                activePhotoMarker.label.length > 10
                  ? activePhotoMarker.label.substring(0, 10) + '...'
                  : activePhotoMarker.label;
              setTextIfChanged(photoMarkerLabelEl, '\uD83D\uDCF7 ' + photoName);
            } else {
              photoMarkerEl.style.display = 'none';
              photoMarkerEl.classList.remove('is-current');
              setTextIfChanged(photoMarkerLabelEl, '');
            }
          } else {
            photoMarkerEl.style.display = 'none';
            photoMarkerEl.classList.remove('is-current');
            setTextIfChanged(photoMarkerLabelEl, '');
          }
        }

        // Render waypoint markers (show all in ±3km window, similar to cities)
        var poiContainerEl = els.poiContainer;
        if (!poiContainerEl) {
          poiContainerEl = cinemaEl.querySelector('.fgpx-weather-pois-container');
          if (!poiContainerEl) {
            poiContainerEl = document.createElement('div');
            poiContainerEl.className = 'fgpx-weather-pois-container';
            var gradeWrap = cinemaEl.querySelector('.fgpx-weather-grade-indicator');
            cinemaEl.insertBefore(poiContainerEl, gradeWrap);
          }
          els.poiContainer = poiContainerEl;
        }
        if (poiContainerEl && mileageRulerEl && mileageTrackEl) {
          if (!simulationWaypointsEnabled) {
            while (poiContainerEl.firstChild) {
              poiContainerEl.removeChild(poiContainerEl.firstChild);
            }
          } else {
            var lastPoiRenderTs = Number(cinemaEl._lastPoiRenderTs || 0);
            var lastPoiRenderDistance = Number(cinemaEl._lastPoiRenderDistance);
            var shouldRenderPois =
              forceUpdate ||
              !isFinite(lastPoiRenderDistance) ||
              Math.abs(distanceNowMeters - lastPoiRenderDistance) >= 45 ||
              now - lastPoiRenderTs >= 350;
            if (!shouldRenderPois) {
              // Keep existing marker DOM until next render slot.
            } else {
              var poiPerfStart =
                typeof performance !== 'undefined' && typeof performance.now === 'function'
                  ? performance.now()
                  : Date.now();
              cinemaEl._lastPoiRenderTs = now;
              cinemaEl._lastPoiRenderDistance = distanceNowMeters;
              var poisInWindow = getCinemaWaypointsNear(distanceNowMeters);
              var poiTrackWidth = mileageTrackEl.clientWidth || mileageTrackEl.offsetWidth || 0;
              var renderedPoiCount = 0;

              // Remove all existing POI markers
              while (poiContainerEl.firstChild) {
                poiContainerEl.removeChild(poiContainerEl.firstChild);
              }

              if (Array.isArray(waypoints) && waypoints.length === 0) {
                var poiEmptyEl2 = document.createElement('div');
                poiEmptyEl2.className = 'fgpx-weather-poi-empty';
                poiEmptyEl2.textContent = 'No GPX waypoints in this track';
                poiContainerEl.appendChild(poiEmptyEl2);
              }

              if (poiTrackWidth > 0 && Array.isArray(poisInWindow) && poisInWindow.length > 0) {
                var poiVisibleKm = Math.max(2, (simulationWaypointWindowMeters / 1000) * 2);
                var poiPxPerKm = poiTrackWidth / poiVisibleKm;
                var rulerOffset = mileageRulerEl.offsetLeft || 0;

                for (var poiIdx = 0; poiIdx < poisInWindow.length; poiIdx++) {
                  var poi = poisInWindow[poiIdx];
                  if (!poi || typeof poi !== 'object') continue;
                  var poiLeft =
                    poiTrackWidth / 2 +
                    ((poi.distanceMeters - distanceNowMeters) / 1000) * poiPxPerKm;

                  if (poiLeft >= -18 && poiLeft <= poiTrackWidth + 18) {
                    var poiMarkerEl = document.createElement('div');
                    poiMarkerEl.className = 'fgpx-weather-poi-marker';
                    poiMarkerEl.style.left = String(Math.round(rulerOffset + poiLeft)) + 'px';
                    poiMarkerEl.style.display = 'block';

                    var poiDistanceFromNow = Math.abs(
                      (Number(poi.distanceMeters) || 0) - (Number(distanceNowMeters) || 0)
                    );
                    var poiDistanceNorm =
                      simulationWaypointWindowMeters > 0
                        ? Math.min(1, poiDistanceFromNow / simulationWaypointWindowMeters)
                        : 1;
                    // Keep a strong minimum visibility while still emphasizing nearby POIs.
                    var poiOccupancy = Math.max(0.5, 1 - poiDistanceNorm * 0.5);

                    var poiMarkerLine = document.createElement('div');
                    poiMarkerLine.className = 'fgpx-weather-poi-marker-line';
                    poiMarkerLine.style.opacity = String(
                      Math.max(0.42, Math.min(0.82, poiOccupancy * 0.78))
                    );

                    var poiMarkerLabel = document.createElement('div');
                    poiMarkerLabel.className = 'fgpx-weather-poi-marker-label';
                    var poiName = (poi.label || 'POI').toString();
                    poiName = poiName.length > 15 ? poiName.substring(0, 15) + '...' : poiName;
                    poiMarkerLabel.textContent = '\ud83d\udccd ' + poiName;
                    poiMarkerLabel.style.opacity = String(
                      Math.max(0.45, Math.min(1, poiOccupancy))
                    );

                    poiMarkerEl.style.opacity = String(poiOccupancy);

                    poiMarkerEl.appendChild(poiMarkerLine);
                    poiMarkerEl.appendChild(poiMarkerLabel);
                    poiContainerEl.appendChild(poiMarkerEl);
                    renderedPoiCount++;
                  }
                }
              }
              if (dbgAllow('poi-render-loop', 2000)) {
                DBG.log('POI render state', {
                  totalWaypoints: Array.isArray(waypoints) ? waypoints.length : 0,
                  inWindow: Array.isArray(poisInWindow) ? poisInWindow.length : 0,
                  rendered: renderedPoiCount,
                  windowKm: simulationWaypointWindowMeters / 1000,
                  currentDistanceMeters: Number(distanceNowMeters) || 0,
                  trackWidthPx: poiTrackWidth,
                });
              }
              perfPoiRendered = renderedPoiCount;
              perfPoiWindow = Array.isArray(poisInWindow) ? poisInWindow.length : 0;
              perfPoiMs =
                (typeof performance !== 'undefined' && typeof performance.now === 'function'
                  ? performance.now()
                  : Date.now()) - poiPerfStart;
            }
          }
        }

        // Render city markers from MapTiler POI layer
        var citiesContainerEl = els.citiesContainer;
        if (!citiesContainerEl) {
          citiesContainerEl = cinemaEl.querySelector('.fgpx-weather-cities-container');
          els.citiesContainer = citiesContainerEl;
        }
        if (citiesContainerEl && mileageRulerEl && mileageTrackEl) {
          if (!simulationCitiesEnabled) {
            while (citiesContainerEl.firstChild) {
              citiesContainerEl.removeChild(citiesContainerEl.firstChild);
            }
          } else {
            var lastCityRenderTs = Number(cinemaEl._lastCityRenderTs || 0);
            var lastCityRenderDistance = Number(cinemaEl._lastCityRenderDistance);
            var shouldRenderCities =
              forceUpdate ||
              !isFinite(lastCityRenderDistance) ||
              Math.abs(distanceNowMeters - lastCityRenderDistance) >= 80 ||
              now - lastCityRenderTs >= 500;
            if (!shouldRenderCities) {
              // Keep existing marker DOM until next render slot.
            } else {
              var cityPerfStart =
                typeof performance !== 'undefined' && typeof performance.now === 'function'
                  ? performance.now()
                  : Date.now();
              cinemaEl._lastCityRenderTs = now;
              cinemaEl._lastCityRenderDistance = distanceNowMeters;
              var citiesInWindow = getCinemaCitiesNear(distanceNowMeters);
              var cityTrackWidth = mileageTrackEl.clientWidth || mileageTrackEl.offsetWidth || 0;
              var renderedCityCount = 0;

              // Remove all existing city markers
              while (citiesContainerEl.firstChild) {
                citiesContainerEl.removeChild(citiesContainerEl.firstChild);
              }

              if (
                cityTrackWidth > 0 &&
                Array.isArray(citiesInWindow) &&
                citiesInWindow.length > 0
              ) {
                var cityVisibleKm = Math.max(2, (simulationCityWindowMeters / 1000) * 2);
                var cityPxPerKm = cityTrackWidth / cityVisibleKm;
                var rulerOffset = mileageRulerEl.offsetLeft || 0;

                for (var cityIdx = 0; cityIdx < citiesInWindow.length; cityIdx++) {
                  var city = citiesInWindow[cityIdx];
                  var cityLeft =
                    cityTrackWidth / 2 +
                    ((city.distanceMeters - distanceNowMeters) / 1000) * cityPxPerKm;

                  if (cityLeft >= -18 && cityLeft <= cityTrackWidth + 18) {
                    var cityMarkerEl = document.createElement('div');
                    cityMarkerEl.className = 'fgpx-weather-city-marker';
                    cityMarkerEl.style.left = String(Math.round(rulerOffset + cityLeft)) + 'px';
                    cityMarkerEl.style.display = 'block';

                    var cityMarkerLine = document.createElement('div');
                    cityMarkerLine.className = 'fgpx-weather-city-marker-line';

                    var cityMarkerLabel = document.createElement('div');
                    cityMarkerLabel.className = 'fgpx-weather-city-marker-label';
                    var cityName =
                      city.name.length > 12 ? city.name.substring(0, 12) + '...' : city.name;
                    cityMarkerLabel.textContent = '🏙 ' + cityName;

                    cityMarkerEl.appendChild(cityMarkerLine);
                    cityMarkerEl.appendChild(cityMarkerLabel);
                    citiesContainerEl.appendChild(cityMarkerEl);
                    renderedCityCount++;
                  }
                }
              }
              if (dbgAllow('city-render-loop', 2000)) {
                DBG.log('City render state', {
                  totalCities: getLoadedCityCount(),
                  inWindow: Array.isArray(citiesInWindow) ? citiesInWindow.length : 0,
                  rendered: renderedCityCount,
                  windowKm: simulationCityWindowMeters / 1000,
                  currentDistanceMeters: Number(distanceNowMeters) || 0,
                  trackWidthPx: cityTrackWidth,
                });
              }
              perfCityRendered = renderedCityCount;
              perfCityWindow = Array.isArray(citiesInWindow) ? citiesInWindow.length : 0;
              perfCityMs =
                (typeof performance !== 'undefined' && typeof performance.now === 'function'
                  ? performance.now()
                  : Date.now()) - cityPerfStart;
            }
          }
        }

        var legend = cinemaEl._legend;
        if (legend) {
          var legendEls = cinemaEl._legendEls || {};
          if (!legendEls.mileage) legendEls.mileage = legend.querySelector('.fgpx-legend-mileage');
          if (!legendEls.duration)
            legendEls.duration = legend.querySelector('.fgpx-legend-duration');
          if (!legendEls.grade) legendEls.grade = legend.querySelector('.fgpx-legend-grade');
          if (!legendEls.elevation)
            legendEls.elevation = legend.querySelector('.fgpx-legend-elevation');
          if (!legendEls.temp) legendEls.temp = legend.querySelector('.fgpx-legend-temp');
          if (!legendEls.wind) legendEls.wind = legend.querySelector('.fgpx-legend-wind');
          if (!legendEls.sun) legendEls.sun = legend.querySelector('.fgpx-legend-sun');
          if (!legendEls.moon) legendEls.moon = legend.querySelector('.fgpx-legend-moon');
          if (!legendEls.conditions)
            legendEls.conditions = legend.querySelector('.fgpx-legend-conditions');
          cinemaEl._legendEls = legendEls;

          setTextIfChanged(
            legendEls.mileage,
            (simI18N.simMileage || 'Mileage') +
              ': ' +
              formatNumber(distanceNowMeters / 1000, 2) +
              ' km'
          );
          setTextIfChanged(
            legendEls.duration,
            (simI18N.simDuration || 'Duration') + ': ' + formatTime(elapsedNowSec)
          );
          setTextIfChanged(
            legendEls.grade,
            (simI18N.simGrade || 'Grade') +
              ': ' +
              (gradeAtNow >= 0 ? '+' : '') +
              gradeAtNow.toFixed(1) +
              '%'
          );
          setTextIfChanged(
            legendEls.elevation,
            (simI18N.simElevation || 'Elevation') + ': ' + Math.round(elevationAtNow) + ' m'
          );
          setTextIfChanged(
            legendEls.temp,
            (simI18N.simTemp || 'Temp') +
              ': ' +
              (Number(cond.temperature_c) || 0).toFixed(1) +
              ' \u00B0C'
          );
          setTextIfChanged(
            legendEls.wind,
            (simI18N.simWind || 'Wind') +
              ': ' +
              Math.round(Number(cond.wind_speed_kmh) || 0) +
              ' km/h'
          );

          // Sun and Moon altitudes
          if (legendEls.sun || legendEls.moon) {
            var curSunAlt = null,
              curMoonAlt = null;
            if (window.SunCalc && Array.isArray(coords) && isFinite(ci)) {
              var c = coords[ci];
              if (c && isFinite(c[0]) && isFinite(c[1])) {
                var pEpoch = parseEpochSeconds(timestamps[ci]);
                if (!isFinite(pEpoch)) {
                  var bEpoch = NaN;
                  for (var tbi = 0; tbi < timestamps.length; tbi++) {
                    bEpoch = parseEpochSeconds(timestamps[tbi]);
                    if (isFinite(bEpoch)) break;
                  }
                  if (isFinite(bEpoch)) pEpoch = bEpoch + (Number(currentTimeSec) || 0);
                }
                if (isFinite(pEpoch)) {
                  var d = new Date(pEpoch * 1000);
                  try {
                    var sPos = window.SunCalc.getPosition(d, c[1], c[0]);
                    if (sPos && typeof sPos.altitude === 'number') {
                      curSunAlt = (sPos.altitude * 180) / Math.PI;
                    }
                    if (typeof window.SunCalc.getMoonPosition === 'function') {
                      var mPos = window.SunCalc.getMoonPosition(d, c[1], c[0]);
                      if (mPos && typeof mPos.altitude === 'number') {
                        curMoonAlt = (mPos.altitude * 180) / Math.PI;
                      }
                    }
                  } catch (_) {}
                }
              }
            }
            if (legendEls.sun)
              setTextIfChanged(
                legendEls.sun,
                (simI18N.simSun || 'Sun') +
                  ': ' +
                  (curSunAlt !== null ? curSunAlt.toFixed(1) + '\u00B0' : '--')
              );
            if (legendEls.moon)
              setTextIfChanged(
                legendEls.moon,
                (simI18N.simMoon || 'Moon') +
                  ': ' +
                  (curMoonAlt !== null ? curMoonAlt.toFixed(1) + '\u00B0' : '--')
              );
          }

          var condParts = [];
          if (night) condParts.push('\uD83C\uDF19 Night');
          if ((Number(cond.fog_intensity) || 0) >= fogThresh) condParts.push('\uD83C\uDF2B Fog');
          if ((Number(cond.cloud_cover_pct) || 0) >= cloudThresh) condParts.push('\u2601 Cloudy');
          if ((Number(cond.rain_mm) || 0) >= rainThresh) condParts.push('\uD83C\uDF27 Rain');
          if ((Number(cond.wind_speed_kmh) || 0) >= windThresh) condParts.push('\uD83D\uDCA8 Wind');
          if ((Number(cond.snow_cm) || 0) >= snowThresh) condParts.push('\u2744 Snow');
          setTextIfChanged(
            legendEls.conditions,
            condParts.length ? condParts.join('  ') : '\u2600 Clear'
          );
        }

        var perfTotal =
          (typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now()) - perfStart;
        if (perfTotal >= 35) {
          DBG.warn('Weather cinema update slow', {
            ms: Math.round(perfTotal),
            poiMs: Math.round(perfPoiMs),
            cityMs: Math.round(perfCityMs),
            poiRendered: perfPoiRendered,
            cityRendered: perfCityRendered,
            poiWindow: perfPoiWindow,
            cityWindow: perfCityWindow,
            distanceNowMeters: Math.round(Number(distanceNowMeters) || 0),
            forceUpdate: !!forceUpdate,
            playing: !!isCurrentlyPlaying,
          });
        } else if (dbgAllow('weather-cinema-perf', 2000)) {
          DBG.log('Weather cinema perf', {
            ms: Math.round(perfTotal),
            poiMs: Math.round(perfPoiMs),
            cityMs: Math.round(perfCityMs),
            distanceNowMeters: Math.round(Number(distanceNowMeters) || 0),
          });
        }
      }

      // Assign the chart creation function to the variable declared in UI scope
      /**
       * Creates and renders the chart for the specified tab type.
       * @param {string} tabType - The chart tab type to render.
       */
      createChart = function (tabType) {
        if (runtimeDestroyed) return;
        // ========== LAZY LOADING: LOAD DATA ON DEMAND ==========
        var startTime = performance.now();
        var chartData = getDataPointsForChart(tabType);

        // Update cached variables for backward compatibility
        if (chartData.elevation) points = chartData.elevation;
        if (chartData.speed) speedPoints = chartData.speed;
        if (chartData.heartRate) heartRatePoints = chartData.heartRate;
        if (chartData.cadence) cadencePoints = chartData.cadence;
        if (chartData.temperature) temperaturePoints = chartData.temperature;
        if (chartData.sunAltitude) sunAltitudePoints = chartData.sunAltitude;
        if (chartData.moonAltitude) moonAltitudePoints = chartData.moonAltitude;
        if (chartData.power) powerPoints = chartData.power;
        if (chartData.windSpeed) windSpeedPoints = chartData.windSpeed;
        if (chartData.windImpact) windImpactPoints = chartData.windImpact;

        var loadTime = performance.now() - startTime;

        // Debug logging for biometric data availability
        DBG.log('Chart creation with lazy loading', {
          tabType: tabType,
          loadTime: Math.round(loadTime) + 'ms',
          heartRatePoints: heartRatePoints ? heartRatePoints.length : 0,
          cadencePoints: cadencePoints ? cadencePoints.length : 0,
          temperaturePoints: temperaturePoints ? temperaturePoints.length : 0,
          sunAltitudePoints: sunAltitudePoints ? sunAltitudePoints.length : 0,
          moonAltitudePoints: moonAltitudePoints ? moonAltitudePoints.length : 0,
          elevationPoints: points ? points.length : 0,
          speedPoints: speedPoints ? speedPoints.length : 0,
          windSpeedPoints: windSpeedPoints ? windSpeedPoints.length : 0,
          windImpactPoints: windImpactPoints ? windImpactPoints.length : 0,
          windDirectionsAvailable: Array.isArray(windDirections) ? windDirections.length : 0,
          windSpeedsAvailable: Array.isArray(windSpeeds) ? windSpeeds.length : 0,
          dayNightPeriods: dayNightPeriods ? dayNightPeriods.length : 0,
        });

        // Clear any existing no-data message first
        var chartWrap = root.querySelector('.fgpx-chart-wrap');
        if (chartWrap && chartWrap.innerHTML.indexOf('<canvas') === -1) {
          // Recreate canvas if it was replaced by no-data message
          chartWrap.innerHTML = '<canvas class="fgpx-chart" width="400" height="200"></canvas>';
          ui.canvas = chartWrap.querySelector('canvas');
        }

        if (chart) {
          chart.destroy();
          chart = null;
        }

        var datasets = [];
        var scales = {
          x: useTime
            ? {
                type: 'linear',
                bounds: 'data',
                min: xMin,
                max: xMax,
                title: { display: true, text: 'Time' },
                ticks: {
                  callback: function (val) {
                    var elapsed = formatTime(val);
                    if (!isNaN(trackStartTimestampMs)) {
                      var d = new Date(trackStartTimestampMs + val * 1000);
                      var hh = d.getHours().toString().padStart(2, '0');
                      var mm = d.getMinutes().toString().padStart(2, '0');
                      return [elapsed, hh + ':' + mm];
                    }
                    return elapsed;
                  },
                },
              }
            : {
                type: 'linear',
                bounds: 'data',
                min: xMin,
                max: xMax,
                title: { display: true, text: 'Distance (km)' },
              },
        };

        // Position marker (dynamically assigned based on available data) - Always on top
        var positionDataset;

        // Function to create position marker with correct initial data
        function createPositionMarker() {
          if (tabType === 'elevation') {
            positionDataset = {
              label: 'Position',
              data: [
                {
                  x: xVals[0],
                  y: coords[0] && typeof coords[0][2] === 'number' ? coords[0][2] : 0,
                },
              ],
              pointRadius: 5,
              pointHoverRadius: 5,
              pointBorderWidth: 2,
              pointBorderColor: '#fff',
              borderWidth: 0,
              showLine: false,
              backgroundColor: '#111',
              pointBackgroundColor: '#111',
              yAxisID: 'y',
            };
          } else if (tabType === 'biometrics') {
            if (heartRatePoints && heartRatePoints.length > 0) {
              positionDataset = {
                label: 'Position',
                data: [{ x: xVals[0], y: heartRatePoints[0] ? heartRatePoints[0].y : 0 }],
                pointRadius: 5,
                pointHoverRadius: 5,
                pointBorderWidth: 2,
                pointBorderColor: '#fff',
                borderWidth: 0,
                showLine: false,
                backgroundColor: '#111',
                pointBackgroundColor: '#111',
                yAxisID: 'y',
              };
            } else if (cadencePoints && cadencePoints.length > 0) {
              positionDataset = {
                label: 'Position',
                data: [{ x: xVals[0], y: cadencePoints[0] ? cadencePoints[0].y : 0 }],
                pointRadius: 5,
                pointHoverRadius: 5,
                pointBorderWidth: 2,
                pointBorderColor: '#fff',
                borderWidth: 0,
                showLine: false,
                backgroundColor: '#111',
                pointBackgroundColor: '#111',
                yAxisID: 'y2',
              };
            } else {
              // Fallback if no biometric data
              positionDataset = {
                label: 'Position',
                data: [{ x: xVals[0], y: 0 }],
                pointRadius: 5,
                pointHoverRadius: 5,
                pointBorderWidth: 2,
                pointBorderColor: '#fff',
                borderWidth: 0,
                showLine: false,
                backgroundColor: '#111',
                pointBackgroundColor: '#111',
                yAxisID: 'y',
              };
            }
          } else if (tabType === 'temperature') {
            if (temperaturePoints && temperaturePoints.length > 0) {
              positionDataset = {
                label: 'Position',
                data: [{ x: xVals[0], y: temperaturePoints[0] ? temperaturePoints[0].y : 0 }],
                pointRadius: 5,
                pointHoverRadius: 5,
                pointBorderWidth: 2,
                pointBorderColor: '#fff',
                borderWidth: 0,
                showLine: false,
                backgroundColor: '#111',
                pointBackgroundColor: '#111',
                yAxisID: 'y',
              };
            } else if (sunAltitudePoints && sunAltitudePoints.length > 0) {
              positionDataset = {
                label: 'Position',
                data: [{ x: xVals[0], y: sunAltitudePoints[0] ? sunAltitudePoints[0].y : 0 }],
                pointRadius: 5,
                pointHoverRadius: 5,
                pointBorderWidth: 2,
                pointBorderColor: '#fff',
                borderWidth: 0,
                showLine: false,
                backgroundColor: '#111',
                pointBackgroundColor: '#111',
                yAxisID: 'yAlt',
              };
            } else {
              positionDataset = {
                label: 'Position',
                data: [{ x: xVals[0], y: 0 }],
                pointRadius: 5,
                pointHoverRadius: 5,
                pointBorderWidth: 2,
                pointBorderColor: '#fff',
                borderWidth: 0,
                showLine: false,
                backgroundColor: '#111',
                pointBackgroundColor: '#111',
                yAxisID: 'yAlt',
              };
            }
          } else if (tabType === 'power') {
            if (powerPoints && powerPoints.length > 0) {
              positionDataset = {
                label: 'Position',
                data: [{ x: xVals[0], y: powerPoints[0] ? powerPoints[0].y : 0 }],
                pointRadius: 5,
                pointHoverRadius: 5,
                pointBorderWidth: 2,
                pointBorderColor: '#fff',
                borderWidth: 0,
                showLine: false,
                backgroundColor: '#111',
                pointBackgroundColor: '#111',
                yAxisID: 'y',
              };
            } else {
              positionDataset = {
                label: 'Position',
                data: [{ x: xVals[0], y: 0 }],
                pointRadius: 5,
                pointHoverRadius: 5,
                pointBorderWidth: 2,
                pointBorderColor: '#fff',
                borderWidth: 0,
                showLine: false,
                backgroundColor: '#111',
                pointBackgroundColor: '#111',
                yAxisID: 'y',
              };
            }
          } else if (tabType === 'powerzones') {
            positionDataset = {
              label: 'Position',
              data: [{ x: xVals[0], y: 0 }],
              pointRadius: 0,
              pointHoverRadius: 0,
              pointBorderWidth: 0,
              pointBorderColor: '#fff',
              borderWidth: 0,
              showLine: false,
              backgroundColor: 'transparent',
              pointBackgroundColor: 'transparent',
              yAxisID: 'y',
            };
          } else if (tabType === 'windimpact') {
            if (windImpactPoints && windImpactPoints.length > 0) {
              positionDataset = {
                label: 'Position',
                data: [{ x: xVals[0], y: windImpactPoints[0] ? windImpactPoints[0].y : 0 }],
                pointRadius: 5,
                pointHoverRadius: 5,
                pointBorderWidth: 2,
                pointBorderColor: '#fff',
                borderWidth: 0,
                showLine: false,
                backgroundColor: '#111',
                pointBackgroundColor: '#111',
                yAxisID: 'y',
              };
            } else if (windSpeedPoints && windSpeedPoints.length > 0) {
              positionDataset = {
                label: 'Position',
                data: [{ x: xVals[0], y: windSpeedPoints[0] ? windSpeedPoints[0].y : 0 }],
                pointRadius: 5,
                pointHoverRadius: 5,
                pointBorderWidth: 2,
                pointBorderColor: '#fff',
                borderWidth: 0,
                showLine: false,
                backgroundColor: '#111',
                pointBackgroundColor: '#111',
                yAxisID: 'y2',
              };
            } else {
              positionDataset = {
                label: 'Position',
                data: [{ x: xVals[0], y: 0 }],
                pointRadius: 5,
                pointHoverRadius: 5,
                pointBorderWidth: 2,
                pointBorderColor: '#fff',
                borderWidth: 0,
                showLine: false,
                backgroundColor: '#111',
                pointBackgroundColor: '#111',
                yAxisID: 'y',
              };
            }
          } else {
            // Default fallback for all other tab types
            positionDataset = {
              label: 'Position',
              data: [
                {
                  x: xVals[0],
                  y: coords[0] && typeof coords[0][2] === 'number' ? coords[0][2] : 0,
                },
              ],
              pointRadius: 5,
              pointHoverRadius: 5,
              pointBorderWidth: 2,
              pointBorderColor: '#fff',
              borderWidth: 0,
              showLine: false,
              backgroundColor: '#111',
              pointBackgroundColor: '#111',
              yAxisID: 'y',
            };
          }
        }

        // Create position marker with correct initial data
        createPositionMarker();

        // Store current tab type for position marker updates
        window.currentChartTabType = tabType;

        function getCurrentChartMarkerIndex() {
          try {
            if (!Array.isArray(cumDist) || cumDist.length === 0) return 0;
            var currentDistance = Math.max(
              0,
              Math.min(totalDistance || 0, (progress || 0) * (totalDistance || 0))
            );
            var loIdx = 0;
            var hiIdx = cumDist.length - 1;
            while (loIdx < hiIdx) {
              var midIdx = (loIdx + hiIdx) >>> 1;
              if (cumDist[midIdx] < currentDistance) loIdx = midIdx + 1;
              else hiIdx = midIdx;
            }
            return Math.max(0, loIdx);
          } catch (_) {
            return 0;
          }
        }

        function getCurrentChartMarkerX(index) {
          try {
            if (useTime && Array.isArray(timeOffsets) && timeOffsets.length > 0) {
              var seriesX = Array.isArray(movingTimeOffsets) ? movingTimeOffsets : timeOffsets;
              var safeIndex = Math.max(0, Math.min(index, seriesX.length - 1));
              return seriesX[safeIndex] || 0;
            }
            return (
              Math.max(0, Math.min(totalDistance || 0, (progress || 0) * (totalDistance || 0))) /
              1000
            );
          } catch (_) {
            return 0;
          }
        }

        // Function to get position marker Y value based on current tab and index
        window.getPositionMarkerY = function (index) {
          try {
            var tabType = window.currentChartTabType;
            if (tabType === 'elevation') {
              return typeof coords[index][2] === 'number' ? coords[index][2] : 0;
            } else if (tabType === 'biometrics') {
              if (heartRatePoints && heartRatePoints.length > 0 && index < heartRatePoints.length) {
                return heartRatePoints[index] ? heartRatePoints[index].y : 0;
              } else if (
                cadencePoints &&
                cadencePoints.length > 0 &&
                index < cadencePoints.length
              ) {
                return cadencePoints[index] ? cadencePoints[index].y : 0;
              }
              return 0;
            } else if (tabType === 'temperature') {
              if (
                temperaturePoints &&
                temperaturePoints.length > 0 &&
                index < temperaturePoints.length
              ) {
                return temperaturePoints[index] ? temperaturePoints[index].y : 0;
              } else if (
                sunAltitudePoints &&
                sunAltitudePoints.length > 0 &&
                index < sunAltitudePoints.length
              ) {
                return sunAltitudePoints[index] ? sunAltitudePoints[index].y : 0;
              }
              return 0;
            } else if (tabType === 'power') {
              if (powerPoints && powerPoints.length > 0 && index < powerPoints.length) {
                return powerPoints[index] ? powerPoints[index].y : 0;
              }
            } else if (tabType === 'powerzones') {
              return 0;
            } else if (tabType === 'windimpact') {
              if (
                windImpactPoints &&
                windImpactPoints.length > 0 &&
                index < windImpactPoints.length
              ) {
                return windImpactPoints[index] ? windImpactPoints[index].y : 0;
              } else if (
                windSpeedPoints &&
                windSpeedPoints.length > 0 &&
                index < windSpeedPoints.length
              ) {
                return windSpeedPoints[index] ? windSpeedPoints[index].y : 0;
              }
              return 0;
            } else if (tabType === 'windrose') {
              // Wind rose doesn't use position marker
              return 0;
            } else if (tabType === 'all') {
              // For All Data tab, use first visible dataset
              if (chartDataVisibility.elevation) {
                return typeof coords[index][2] === 'number' ? coords[index][2] : 0;
              } else if (
                chartDataVisibility.speed &&
                useTime &&
                speedPoints &&
                speedPoints.length > 0 &&
                index < speedPoints.length
              ) {
                return speedPoints[index] ? speedPoints[index].y : 0;
              } else if (
                chartDataVisibility.heartRate &&
                heartRatePoints &&
                heartRatePoints.length > 0 &&
                index < heartRatePoints.length
              ) {
                return heartRatePoints[index] ? heartRatePoints[index].y : 0;
              } else if (
                chartDataVisibility.cadence &&
                cadencePoints &&
                cadencePoints.length > 0 &&
                index < cadencePoints.length
              ) {
                return cadencePoints[index] ? cadencePoints[index].y : 0;
              } else if (
                chartDataVisibility.temperature &&
                temperaturePoints &&
                temperaturePoints.length > 0 &&
                index < temperaturePoints.length
              ) {
                return temperaturePoints[index] ? temperaturePoints[index].y : 0;
              } else if (
                chartDataVisibility.power &&
                powerPoints &&
                powerPoints.length > 0 &&
                index < powerPoints.length
              ) {
                return powerPoints[index] ? powerPoints[index].y : 0;
              }
            }
            // Fallback to elevation
            return typeof coords[index][2] === 'number' ? coords[index][2] : 0;
          } catch (e) {
            return 0;
          }
        };

        // Seed the marker and cursor from the current playback state so tab switches
        // don't briefly show the previous tab's marker position until the next RAF tick.
        try {
          var initialMarkerIndex = getCurrentChartMarkerIndex();
          var initialMarkerX = getCurrentChartMarkerX(initialMarkerIndex);
          var initialMarkerY = window.getPositionMarkerY(initialMarkerIndex);
          if (positionDataset && positionDataset.data && positionDataset.data.length > 0) {
            positionDataset.data[0] = { x: initialMarkerX, y: initialMarkerY };
          }
          cursorX = initialMarkerX;
        } catch (_) {}

        if (tabType === 'elevation') {
          // Elevation + Speed tab with area chart and gradient coloring

          // Calculate gradients for elevation coloring (reuse existing logic)
          var elevationGradients = [];
          if (coords && coords.length > 1) {
            elevationGradients = calculateGradients(coords, cumDist);
            elevationGradients = smoothGradients(elevationGradients, 5);
          }

          // Create gradient canvas for elevation area fill
          var canvas = document.createElement('canvas');
          canvas.width = 400;
          canvas.height = 200;
          var ctx = canvas.getContext('2d');
          var gradient = 'rgba(255,85,0,0.6)';

          // Create gradient based on steepness thresholds
          if (ctx && typeof ctx.createLinearGradient === 'function') {
            gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
          }

          // Use existing elevation coloring configuration
          var elevColorThreshold = parseFloat((window.FGPX && FGPX.elevColorThreshold) || '3'); // 3% grade threshold
          var elevColorMax = parseFloat((window.FGPX && FGPX.elevColorMax) || '8'); // 8% grade for full red
          var baseColor = (window.FGPX && FGPX.elevationColorFlat) || '#ff5500';
          var steepColor = (window.FGPX && FGPX.elevationColorSteep) || '#ff0000';

          // Create gradient stops based on elevation gradients
          if (elevationGradients.length > 0) {
            for (var i = 0; i < elevationGradients.length; i++) {
              var gradientValue = elevationGradients[i] || 0;
              var alpha = 0;
              if (gradientValue > elevColorThreshold) {
                alpha = (gradientValue - elevColorThreshold) / (elevColorMax - elevColorThreshold);
                alpha = Math.min(1, Math.max(0, alpha));
              }

              // Blend colors based on steepness
              var blendedColor = blendHex(baseColor, steepColor, alpha);
              var position = i / (elevationGradients.length - 1);

              // Convert hex to rgba with transparency for area fill
              var hex = blendedColor.replace('#', '');
              var r = parseInt(hex.substr(0, 2), 16);
              var g = parseInt(hex.substr(2, 2), 16);
              var b = parseInt(hex.substr(4, 2), 16);
              if (gradient && typeof gradient.addColorStop === 'function') {
                gradient.addColorStop(position, 'rgba(' + r + ',' + g + ',' + b + ', 0.6)');
              }
            }
          } else {
            // Fallback to solid color if no gradients available
            var hex = baseColor.replace('#', '');
            var r = parseInt(hex.substr(0, 2), 16);
            var g = parseInt(hex.substr(2, 2), 16);
            var b = parseInt(hex.substr(4, 2), 16);
            gradient = 'rgba(' + r + ',' + g + ',' + b + ', 0.6)';
          }

          // Elevation line chart (foreground line for position marker tracking)
          datasets.push({
            label: 'Elevation (m)',
            data: points,
            borderColor: chartLineColor,
            pointRadius: 0,
            pointHoverRadius: 0,
            pointBorderWidth: 0,
            pointBackgroundColor: 'transparent',
            fill: false,
            tension: 0.2,
            parsing: false,
            yAxisID: 'y',
          });

          // Position marker
          datasets.push(positionDataset);

          // Speed line chart (added first for background)
          if (useTime && speedPoints && speedPoints.length > 0) {
            datasets.push({
              label: 'Speed (km/h)',
              data: speedPoints,
              borderColor: chartLineColor2,
              pointRadius: 0,
              pointHoverRadius: 0,
              pointBorderWidth: 0,
              pointBackgroundColor: 'transparent',
              fill: false,
              tension: 0.2,
              parsing: false,
              yAxisID: 'y2',
            });
          }

          // Elevation area dataset (background with gradient)
          datasets.push({
            label: 'Elevation Area',
            data: points,
            borderColor: 'transparent', // No border for area
            backgroundColor: gradient,
            pointRadius: 0,
            pointHoverRadius: 0,
            pointBorderWidth: 0,
            pointBackgroundColor: 'transparent',
            fill: true,
            tension: 0.2,
            parsing: false,
            yAxisID: 'y',
          });

          scales.y = { title: { display: true, text: 'Elevation (m)' }, ticks: { precision: 0 } };
          scales.y2 = {
            position: 'right',
            grid: { drawOnChartArea: false },
            title: { display: true, text: 'Speed (km/h)' },
            ticks: { precision: 0 },
          };
        } else if (tabType === 'biometrics') {
          // Heart Rate + Cadence tab
          if (
            (heartRatePoints && heartRatePoints.length > 0) ||
            (cadencePoints && cadencePoints.length > 0)
          ) {
            if (heartRatePoints && heartRatePoints.length > 0) {
              datasets.push({
                label: 'Heart Rate (bpm)',
                data: heartRatePoints,
                borderColor: chartLineColor3,
                pointRadius: 0,
                fill: false,
                tension: 0.2,
                parsing: false,
                yAxisID: 'y',
              });
            }
            datasets.push(positionDataset);
            if (cadencePoints && cadencePoints.length > 0) {
              datasets.push({
                label: 'Cadence (rpm)',
                data: cadencePoints,
                borderColor: chartLineColor4,
                pointRadius: 0,
                fill: false,
                tension: 0.2,
                parsing: false,
                yAxisID: 'y2',
              });
            }
            scales.y = {
              title: { display: true, text: 'Heart Rate (bpm)' },
              ticks: { precision: 0 },
            };
            scales.y2 = {
              position: 'right',
              grid: { drawOnChartArea: false },
              title: { display: true, text: 'Cadence (rpm)' },
              ticks: { precision: 0 },
            };
          } else {
            // No biometric data available - show message
            return showNoDataMessageLocal(
              'No heart rate or cadence data available for this track.'
            );
          }
        } else if (tabType === 'temperature') {
          // Temperature tab
          var hasTemp = temperaturePoints && temperaturePoints.length > 0;
          var hasSunMoon =
            typeof window.SunCalc !== 'undefined' &&
            typeof window.SunCalc.getMoonPosition === 'function' &&
            sunAltitudePoints &&
            sunAltitudePoints.length > 0 &&
            moonAltitudePoints &&
            moonAltitudePoints.length > 0;

          if (!hasTemp && !hasSunMoon) {
            return showNoDataMessageLocal(
              'No temperature data available for this track. Sun/moon altitude requires timestamps.'
            );
          }

          if (hasTemp) {
            datasets.push({
              label: 'Temperature (°C)',
              data: temperaturePoints,
              borderColor: chartLineColor5,
              pointRadius: 0,
              fill: false,
              tension: 0.2,
              parsing: false,
              yAxisID: 'y',
            });
            scales.y = {
              title: { display: true, text: 'Temperature (°C)' },
              ticks: { precision: 1 },
            };
          } else {
            scales.y = { display: false };
          }

          if (hasSunMoon) {
            datasets.push({
              label: 'Sun Altitude (°)',
              data: sunAltitudePoints,
              borderColor: '#f59e0b',
              borderDash: [4, 2],
              pointRadius: 0,
              fill: false,
              tension: 0.3,
              parsing: false,
              yAxisID: 'yAlt',
            });
            datasets.push({
              label: 'Moon Altitude (°)',
              data: moonAltitudePoints,
              borderColor: '#818cf8',
              borderDash: [4, 2],
              pointRadius: 0,
              fill: false,
              tension: 0.3,
              parsing: false,
              yAxisID: 'yAlt',
            });
            scales.yAlt = {
              position: 'right',
              grid: { drawOnChartArea: false },
              title: { display: true, text: 'Altitude (°)' },
              ticks: { precision: 0 },
              min: -90,
              max: 90,
            };
          }

          datasets.push(positionDataset);
        } else if (tabType === 'power') {
          // Power tab
          if (powerPoints && powerPoints.length > 0) {
            datasets.push({
              label: 'Power (watts)',
              data: powerPoints,
              borderColor: chartLineColor6,
              pointRadius: 0,
              fill: false,
              tension: 0.2,
              parsing: false,
              yAxisID: 'y',
            });
            datasets.push(positionDataset);
            scales.y = { title: { display: true, text: 'Power (watts)' }, ticks: { precision: 0 } };
          } else {
            // No power data available - show message
            return showNoDataMessageLocal('No power data available for this track.');
          }
        } else if (tabType === 'powerzones') {
          var zonePowers = getChartData('powerZones');
          if (zonePowers && zonePowers.length > 0) {
            var ftp = window.FGPX && isFinite(Number(FGPX.ftp)) ? Number(FGPX.ftp) : 250;
            ftp = Math.max(100, Math.min(500, ftp));

            var zoneDefs = [
              { label: 'Z1 Recovery', min: 0, max: 0.55 },
              { label: 'Z2 Endurance', min: 0.55, max: 0.75 },
              { label: 'Z3 Tempo', min: 0.75, max: 0.9 },
              { label: 'Z4 Threshold', min: 0.9, max: 1.05 },
              { label: 'Z5 VO2 Max', min: 1.05, max: 1.2 },
              { label: 'Z6 Anaerobic', min: 1.2, max: Infinity },
            ];

            var zoneSeconds = [0, 0, 0, 0, 0, 0];
            var avgStepSec = 1;
            if (Array.isArray(timeOffsets) && timeOffsets.length > 1) {
              var totalStep = 0;
              var stepCount = 0;
              for (var ti = 1; ti < timeOffsets.length; ti++) {
                var step = Number(timeOffsets[ti]) - Number(timeOffsets[ti - 1]);
                if (isFinite(step) && step > 0) {
                  totalStep += step;
                  stepCount++;
                }
              }
              if (stepCount > 0) {
                avgStepSec = Math.max(1, totalStep / stepCount);
              }
            }

            for (var pi = 0; pi < zonePowers.length; pi++) {
              var ratio = zonePowers[pi] / ftp;
              for (var zi = 0; zi < zoneDefs.length; zi++) {
                if (ratio >= zoneDefs[zi].min && ratio < zoneDefs[zi].max) {
                  zoneSeconds[zi] += avgStepSec;
                  break;
                }
              }
            }

            var zoneLabels = zoneDefs.map(function (z, idx) {
              var minW = Math.round(z.min * ftp);
              var maxW = z.max === Infinity ? '∞' : String(Math.round(z.max * ftp));
              return z.label + ' (' + minW + '-' + maxW + 'W)';
            });

            var zoneMinutes = zoneSeconds.map(function (v) {
              return Math.round((v / 60) * 10) / 10;
            });

            chart = new Chart(ui.canvas, {
              type: 'bar',
              data: {
                labels: zoneLabels,
                datasets: [
                  {
                    label: 'Time in Zone (min)',
                    data: zoneMinutes,
                    backgroundColor: [
                      'rgba(16,185,129,0.55)',
                      'rgba(34,197,94,0.55)',
                      'rgba(250,204,21,0.55)',
                      'rgba(251,146,60,0.55)',
                      'rgba(239,68,68,0.55)',
                      'rgba(153,27,27,0.55)',
                    ],
                    borderColor: chartLineColor6,
                    borderWidth: 1,
                  },
                ],
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    callbacks: {
                      label: function (context) {
                        return context.parsed.y.toFixed(1) + ' min';
                      },
                    },
                  },
                },
                scales: {
                  x: { title: { display: true, text: 'Power Zones (% FTP)' } },
                  y: { beginAtZero: true, title: { display: true, text: 'Time (minutes)' } },
                },
              },
            });
            return;
          }
          return showNoDataMessageLocal('No power data available for power zones.');
        } else if (tabType === 'windimpact') {
          // Wind Impact tab
          if (
            (windImpactPoints && windImpactPoints.length > 0) ||
            (windSpeedPoints && windSpeedPoints.length > 0)
          ) {
            if (windImpactPoints && windImpactPoints.length > 0) {
              datasets.push({
                label: 'Wind Impact (km/h)',
                data: windImpactPoints,
                borderColor: chartLineColorWindImpact,
                pointRadius: 0,
                fill: false,
                tension: 0.2,
                parsing: false,
                yAxisID: 'y',
              });
            }
            datasets.push(positionDataset);
            if (windSpeedPoints && windSpeedPoints.length > 0) {
              datasets.push({
                label: 'Wind Speed (km/h)',
                data: windSpeedPoints,
                borderColor: chartLineColorWindRose,
                pointRadius: 0,
                fill: false,
                tension: 0.2,
                parsing: false,
                yAxisID: 'y2',
              });
            }
            scales.y = {
              title: { display: true, text: 'Speed Gain/Loss (km/h)' },
              ticks: { precision: 1 },
              grid: {
                color: function (context) {
                  // Highlight the zero line
                  return context.tick.value === 0 ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.1)';
                },
                lineWidth: function (context) {
                  return context.tick.value === 0 ? 2 : 1;
                },
              },
            };
            scales.y2 = {
              position: 'right',
              grid: { drawOnChartArea: false },
              title: { display: true, text: 'Wind Speed (km/h)' },
              ticks: { precision: 1 },
            };
          } else {
            // No wind impact data available - show message
            return showNoDataMessageLocal('No wind impact data available for this track.');
          }
        } else if (tabType === 'windrose') {
          // Wind Rose tab - polar area chart
          DBG.log('Wind Rose Chart Debug', {
            windDirectionsArray: Array.isArray(windDirections),
            windSpeedsArray: Array.isArray(windSpeeds),
            windDirectionsLength: windDirections ? windDirections.length : 0,
            windSpeedsLength: windSpeeds ? windSpeeds.length : 0,
            sampleWindDirection: windDirections ? windDirections[0] : null,
            sampleWindSpeed: windSpeeds ? windSpeeds[0] : null,
          });

          if (
            Array.isArray(windDirections) &&
            Array.isArray(windSpeeds) &&
            windDirections.length > 0 &&
            windSpeeds.length > 0
          ) {
            // Create wind rose data - 16 compass sectors
            var windRoseData = new Array(16).fill(0);
            var windRoseCounts = new Array(16).fill(0);
            var sectorLabels = [
              'N',
              'NNE',
              'NE',
              'ENE',
              'E',
              'ESE',
              'SE',
              'SSE',
              'S',
              'SSW',
              'SW',
              'WSW',
              'W',
              'WNW',
              'NW',
              'NNW',
            ];

            var validDataPoints = 0;
            var nullDirections = 0;
            var nullSpeeds = 0;
            var zeroSpeeds = 0;

            for (var i = 0; i < windDirections.length; i++) {
              if (windDirections[i] === null) nullDirections++;
              if (windSpeeds[i] === null) nullSpeeds++;
              if (windSpeeds[i] === 0) zeroSpeeds++;

              if (windDirections[i] !== null && windSpeeds[i] !== null && windSpeeds[i] > 0) {
                var sector = Math.floor(((windDirections[i] + 11.25) % 360) / 22.5);
                windRoseData[sector] += windSpeeds[i];
                windRoseCounts[sector]++;
                validDataPoints++;
              }
            }

            DBG.log('Wind Rose Data Processing', {
              totalPoints: windDirections.length,
              validDataPoints: validDataPoints,
              nullDirections: nullDirections,
              nullSpeeds: nullSpeeds,
              zeroSpeeds: zeroSpeeds,
              windRoseCounts: windRoseCounts,
              windRoseData: windRoseData,
            });

            // Calculate averages
            for (var i = 0; i < 16; i++) {
              if (windRoseCounts[i] > 0) {
                windRoseData[i] = windRoseData[i] / windRoseCounts[i];
              }
            }

            DBG.log('Wind Rose Data Processed', {
              windRoseData: windRoseData,
              windRoseCounts: windRoseCounts,
              totalDataPoints: windRoseCounts.reduce(function (a, b) {
                return a + b;
              }, 0),
            });

            // Check if we have any valid data for the wind rose
            if (validDataPoints === 0) {
              DBG.log('Wind Rose: No valid data points found');
              return showNoDataMessageLocal('No valid wind data available for wind rose chart.');
            }

            // Function to get color for each sector based on wind direction
            /**
             * Returns the color for a wind rose sector based on its index.
             * Maps 16 compass sectors to 4 main directions (N, E, S, W) and returns the corresponding color.
             * @param {number} sectorIndex - Index of the wind rose sector (0-15)
             * @returns {string} Hex color string for the sector direction
             */
            function getSectorColor(sectorIndex) {
              // Map 16 sectors to 4 main directions (±45°)
              // N: sectors 0,1,14,15 (315°-45°)
              // E: sectors 2,3,4,5 (45°-135°)
              // S: sectors 6,7,8,9 (135°-225°)
              // W: sectors 10,11,12,13 (225°-315°)

              if (
                sectorIndex === 0 ||
                sectorIndex === 1 ||
                sectorIndex === 14 ||
                sectorIndex === 15
              ) {
                return windRoseColorNorth; // North - Headwind
              } else if (sectorIndex >= 2 && sectorIndex <= 5) {
                return windRoseColorEast; // East - Right sidewind
              } else if (sectorIndex >= 6 && sectorIndex <= 9) {
                return windRoseColorSouth; // South - Tailwind
              } else {
                return windRoseColorWest; // West - Left sidewind
              }
            }

            datasets.push({
              label: 'Wind Speed (km/h)',
              data: windRoseData,
              backgroundColor: windRoseData.map(function (speed, index) {
                var alpha = Math.min(1, Math.max(0.1, speed / 20)); // Scale opacity based on wind speed, minimum 0.1
                var baseColor = getSectorColor(index);
                // Convert hex color to rgba
                var hex = baseColor.replace('#', '');
                var r = parseInt(hex.substr(0, 2), 16);
                var g = parseInt(hex.substr(2, 2), 16);
                var b = parseInt(hex.substr(4, 2), 16);
                return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
              }),
              borderColor: windRoseData.map(function (speed, index) {
                return getSectorColor(index);
              }),
              borderWidth: 1,
            });

            // Use polar area chart configuration
            var chartConfig = {
              type: 'polarArea',
              data: { labels: sectorLabels, datasets: datasets },
              plugins: [
                {
                  id: 'coordinateAxes',
                  afterDraw: function (chart) {
                    var ctx = chart.ctx;
                    var chartArea = chart.chartArea;
                    var centerX = (chartArea.left + chartArea.right) / 2;
                    var centerY = (chartArea.top + chartArea.bottom) / 2;
                    var radius =
                      Math.min(chartArea.right - centerX, chartArea.bottom - centerY) * 0.75;

                    // Save current context
                    ctx.save();

                    // Draw coordinate axes (cross)
                    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
                    ctx.lineWidth = 2;
                    ctx.setLineDash([8, 4]); // Dashed lines

                    // Vertical line (N-S)
                    ctx.beginPath();
                    ctx.moveTo(centerX, centerY - radius);
                    ctx.lineTo(centerX, centerY + radius);
                    ctx.stroke();

                    // Horizontal line (E-W)
                    ctx.beginPath();
                    ctx.moveTo(centerX - radius, centerY);
                    ctx.lineTo(centerX + radius, centerY);
                    ctx.stroke();

                    // Reset line dash
                    ctx.setLineDash([]);

                    // Add N, S, E, W labels at the ends of the axes
                    ctx.font = 'bold 12px Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
                    ctx.shadowBlur = 2;

                    var labelOffsetVertical = 20; // More space for N and S
                    var labelOffsetHorizontal = 15; // Keep E and W closer

                    // North (top)
                    ctx.fillStyle = windRoseColorNorth;
                    ctx.fillText('N', centerX, centerY - radius - labelOffsetVertical);

                    // South (bottom)
                    ctx.fillStyle = windRoseColorSouth;
                    ctx.fillText('S', centerX, centerY + radius + labelOffsetHorizontal);

                    // East (right)
                    ctx.fillStyle = windRoseColorEast;
                    ctx.textAlign = 'left';
                    ctx.fillText('E', centerX + radius + labelOffsetHorizontal / 2, centerY);

                    // West (left)
                    ctx.fillStyle = windRoseColorWest;
                    ctx.textAlign = 'right';
                    ctx.fillText('W', centerX - radius - labelOffsetHorizontal / 2, centerY);

                    // Restore context
                    ctx.restore();
                  },
                },
              ],
              options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                  padding: {
                    top: 15,
                    bottom: 5,
                  },
                },
                plugins: {
                  legend: {
                    display: true,
                    position: 'bottom',
                    align: 'center',
                    labels: {
                      generateLabels: function (chart) {
                        return [
                          {
                            text: 'North (Headwind)',
                            fillStyle: windRoseColorNorth,
                            strokeStyle: windRoseColorNorth,
                          },
                          {
                            text: 'South (Tailwind)',
                            fillStyle: windRoseColorSouth,
                            strokeStyle: windRoseColorSouth,
                          },
                          {
                            text: 'East (Right Sidewind)',
                            fillStyle: windRoseColorEast,
                            strokeStyle: windRoseColorEast,
                          },
                          {
                            text: 'West (Left Sidewind)',
                            fillStyle: windRoseColorWest,
                            strokeStyle: windRoseColorWest,
                          },
                        ];
                      },
                    },
                  },
                  tooltip: {
                    callbacks: {
                      label: function (context) {
                        var direction = context.label;
                        var speed = context.parsed.r.toFixed(1);
                        var windType = '';
                        var sectorIndex = context.dataIndex;

                        if (
                          sectorIndex === 0 ||
                          sectorIndex === 1 ||
                          sectorIndex === 14 ||
                          sectorIndex === 15
                        ) {
                          windType = ' (Headwind)';
                        } else if (sectorIndex >= 2 && sectorIndex <= 5) {
                          windType = ' (Right Sidewind)';
                        } else if (sectorIndex >= 6 && sectorIndex <= 9) {
                          windType = ' (Tailwind)';
                        } else {
                          windType = ' (Left Sidewind)';
                        }

                        return direction + windType + ': ' + speed + ' km/h';
                      },
                    },
                  },
                },
                scales: {
                  r: {
                    beginAtZero: true,
                    title: { display: true, text: 'Wind Speed (km/h)' },
                    grid: {
                      color: 'rgba(0,0,0,0.1)',
                    },
                    angleLines: {
                      color: 'rgba(0,0,0,0.2)',
                      lineWidth: 1,
                    },
                    pointLabels: {
                      font: {
                        size: 14,
                        weight: 'bold',
                      },
                      color: function (context) {
                        var index = context.index;
                        // Color the main compass directions
                        if (index === 0) return windRoseColorNorth; // N
                        if (index === 4) return windRoseColorEast; // E
                        if (index === 8) return windRoseColorSouth; // S
                        if (index === 12) return windRoseColorWest; // W
                        return 'rgba(0,0,0,0.7)'; // Other directions
                      },
                    },
                  },
                },
              },
            };

            chart = new Chart(ui.canvas, chartConfig);
            return; // Exit early for polar chart
          } else {
            // No wind direction data available - show message
            return showNoDataMessageLocal('No wind direction data available for this track.');
          }
        } else if (tabType === 'all') {
          // All data tab - show data based on visibility toggles with proper layer ordering

          // Elevation area chart (bottom layer - order: 1) with gradient coloring
          if (chartDataVisibility.elevation) {
            // Calculate gradients for elevation coloring (reuse existing logic)
            var elevationGradients = [];
            if (coords && coords.length > 1) {
              elevationGradients = calculateGradients(coords, cumDist);
              elevationGradients = smoothGradients(elevationGradients, 5);
            }

            // Create gradient canvas for elevation area fill
            var canvas = document.createElement('canvas');
            canvas.width = 400;
            canvas.height = 200;
            var ctx = canvas.getContext('2d');
            var gradient = 'rgba(255,85,0,0.4)';

            // Create gradient based on steepness thresholds
            if (ctx && typeof ctx.createLinearGradient === 'function') {
              gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
            }

            // Use existing elevation coloring configuration
            var elevColorThreshold = parseFloat((window.FGPX && FGPX.elevColorThreshold) || '3'); // 3% grade threshold
            var elevColorMax = parseFloat((window.FGPX && FGPX.elevColorMax) || '8'); // 8% grade for full red
            var baseColor = (window.FGPX && FGPX.elevationColorFlat) || '#ff5500';
            var steepColor = (window.FGPX && FGPX.elevationColorSteep) || '#ff0000';

            // Create gradient stops based on elevation gradients
            if (elevationGradients.length > 0) {
              for (var i = 0; i < elevationGradients.length; i++) {
                var gradientValue = elevationGradients[i] || 0;
                var alpha = 0;
                if (gradientValue > elevColorThreshold) {
                  alpha =
                    (gradientValue - elevColorThreshold) / (elevColorMax - elevColorThreshold);
                  alpha = Math.min(1, Math.max(0, alpha));
                }

                // Blend colors based on steepness
                var blendedColor = blendHex(baseColor, steepColor, alpha);
                var position = i / (elevationGradients.length - 1);

                // Convert hex to rgba with transparency for area fill
                var hex = blendedColor.replace('#', '');
                var r = parseInt(hex.substr(0, 2), 16);
                var g = parseInt(hex.substr(2, 2), 16);
                var b = parseInt(hex.substr(4, 2), 16);
                if (gradient && typeof gradient.addColorStop === 'function') {
                  gradient.addColorStop(position, 'rgba(' + r + ',' + g + ',' + b + ', 0.4)');
                }
              }
            } else {
              // Fallback to solid color if no gradients available
              var hex = baseColor.replace('#', '');
              var r = parseInt(hex.substr(0, 2), 16);
              var g = parseInt(hex.substr(2, 2), 16);
              var b = parseInt(hex.substr(4, 2), 16);
              gradient = 'rgba(' + r + ',' + g + ',' + b + ', 0.4)';
            }

            datasets.push({
              label: 'Elevation (m)',
              data: points,
              borderColor: chartLineColor,
              pointRadius: 0,
              fill: false,
              tension: 0.2,
              parsing: false,
              yAxisID: 'y',
            });
          }

          // Position marker (added after elevation for proper layering)
          datasets.push(positionDataset);

          // Other datasets (added last to be on top)
          if (chartDataVisibility.speed && speedPoints && speedPoints.length > 0) {
            datasets.push({
              label: 'Speed (km/h)',
              data: speedPoints,
              borderColor: chartLineColor2,
              pointRadius: 0,
              fill: false,
              tension: 0.2,
              parsing: false,
              yAxisID: 'y2',
            });
          }
          if (chartDataVisibility.heartRate && heartRatePoints && heartRatePoints.length > 0) {
            datasets.push({
              label: 'Heart Rate (bpm)',
              data: heartRatePoints,
              borderColor: chartLineColor3,
              pointRadius: 0,
              fill: false,
              tension: 0.2,
              parsing: false,
              yAxisID: 'y3',
            });
          }
          if (chartDataVisibility.cadence && cadencePoints && cadencePoints.length > 0) {
            datasets.push({
              label: 'Cadence (rpm)',
              data: cadencePoints,
              borderColor: chartLineColor4,
              pointRadius: 0,
              fill: false,
              tension: 0.2,
              parsing: false,
              yAxisID: 'y4',
            });
          }
          if (
            chartDataVisibility.temperature &&
            temperaturePoints &&
            temperaturePoints.length > 0
          ) {
            datasets.push({
              label: 'Temperature (°C)',
              data: temperaturePoints,
              borderColor: chartLineColor5,
              pointRadius: 0,
              fill: false,
              tension: 0.2,
              parsing: false,
              yAxisID: 'y5',
            });
          }
          if (chartDataVisibility.power && powerPoints && powerPoints.length > 0) {
            datasets.push({
              label: 'Power (watts)',
              data: powerPoints,
              borderColor: chartLineColor6,
              pointRadius: 0,
              fill: false,
              tension: 0.2,
              parsing: false,
              yAxisID: 'y6',
            });
          }

          // Configure scales - always include all scales but hide unused ones
          scales.y = {
            title: { display: chartDataVisibility.elevation, text: 'Elevation (m)' },
            ticks: { precision: 0 },
            display: chartDataVisibility.elevation,
          };
          scales.y2 = {
            position: 'right',
            grid: { drawOnChartArea: false },
            title: { display: chartDataVisibility.speed, text: 'Speed (km/h)' },
            ticks: { precision: 0 },
            display: chartDataVisibility.speed && useTime && speedPoints && speedPoints.length > 0,
          };
          scales.y3 = {
            position: 'left',
            grid: { drawOnChartArea: false },
            title: { display: chartDataVisibility.heartRate, text: 'HR (bpm)' },
            ticks: { precision: 0 },
            display: chartDataVisibility.heartRate && heartRatePoints && heartRatePoints.length > 0,
          };
          scales.y4 = {
            position: 'right',
            grid: { drawOnChartArea: false },
            title: { display: chartDataVisibility.cadence, text: 'Cadence (rpm)' },
            ticks: { precision: 0 },
            display: chartDataVisibility.cadence && cadencePoints && cadencePoints.length > 0,
          };
          scales.y5 = {
            position: 'left',
            grid: { drawOnChartArea: false },
            title: { display: chartDataVisibility.temperature, text: 'Temp (°C)' },
            ticks: { precision: 1 },
            display:
              chartDataVisibility.temperature && temperaturePoints && temperaturePoints.length > 0,
          };
          scales.y6 = {
            position: 'right',
            grid: { drawOnChartArea: false },
            title: { display: chartDataVisibility.power, text: 'Power (W)' },
            ticks: { precision: 0 },
            display: chartDataVisibility.power && powerPoints && powerPoints.length > 0,
          };
        } else {
          // Unknown tab type - fallback to elevation with area chart
          // Calculate gradients for elevation coloring (reuse existing logic)
          var elevationGradients = [];
          if (coords && coords.length > 1) {
            elevationGradients = calculateGradients(coords, cumDist);
            elevationGradients = smoothGradients(elevationGradients, 5);
          }

          // Create gradient canvas for elevation area fill
          var canvas = document.createElement('canvas');
          canvas.width = 400;
          canvas.height = 200;
          var ctx = canvas.getContext('2d');
          var gradient = 'rgba(255,85,0,0.6)';

          // Create gradient based on steepness thresholds
          if (ctx && typeof ctx.createLinearGradient === 'function') {
            gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
          }

          // Use existing elevation coloring configuration
          var elevColorThreshold = parseFloat((window.FGPX && FGPX.elevColorThreshold) || '3'); // 3% grade threshold
          var elevColorMax = parseFloat((window.FGPX && FGPX.elevColorMax) || '8'); // 8% grade for full red
          var baseColor = (window.FGPX && FGPX.elevationColorFlat) || '#ff5500';
          var steepColor = (window.FGPX && FGPX.elevationColorSteep) || '#ff0000';

          // Create gradient stops based on elevation gradients
          if (elevationGradients.length > 0) {
            for (var i = 0; i < elevationGradients.length; i++) {
              var gradientValue = elevationGradients[i] || 0;
              var alpha = 0;
              if (gradientValue > elevColorThreshold) {
                alpha = (gradientValue - elevColorThreshold) / (elevColorMax - elevColorThreshold);
                alpha = Math.min(1, Math.max(0, alpha));
              }

              // Blend colors based on steepness
              var blendedColor = blendHex(baseColor, steepColor, alpha);
              var position = i / (elevationGradients.length - 1);

              // Convert hex to rgba with transparency for area fill
              var hex = blendedColor.replace('#', '');
              var r = parseInt(hex.substr(0, 2), 16);
              var g = parseInt(hex.substr(2, 2), 16);
              var b = parseInt(hex.substr(4, 2), 16);
              if (gradient && typeof gradient.addColorStop === 'function') {
                gradient.addColorStop(position, 'rgba(' + r + ',' + g + ',' + b + ', 0.6)');
              }
            }
          } else {
            // Fallback to solid color if no gradients available
            var hex = baseColor.replace('#', '');
            var r = parseInt(hex.substr(0, 2), 16);
            var g = parseInt(hex.substr(2, 2), 16);
            var b = parseInt(hex.substr(4, 2), 16);
            gradient = 'rgba(' + r + ',' + g + ',' + b + ', 0.6)';
          }

          // Speed line chart (added first for background)
          if (useTime && speedPoints && speedPoints.length > 0) {
            datasets.push({
              label: 'Speed (km/h)',
              data: speedPoints,
              borderColor: chartLineColor2,
              pointRadius: 0,
              fill: false,
              tension: 0.2,
              parsing: false,
              yAxisID: 'y2',
            });
          }

          // Elevation area dataset (background with gradient)
          datasets.push({
            label: 'Elevation Area',
            data: points,
            borderColor: 'transparent', // No border for area
            backgroundColor: gradient,
            pointRadius: 0,
            fill: true,
            tension: 0.2,
            parsing: false,
            yAxisID: 'y',
          });

          // Elevation line chart (foreground line for position marker tracking)
          datasets.push({
            label: 'Elevation (m)',
            data: points,
            borderColor: chartLineColor,
            pointRadius: 0,
            fill: false,
            tension: 0.2,
            parsing: false,
            yAxisID: 'y',
          });

          // Position marker (added last to be on top of everything)
          datasets.push(positionDataset);

          scales.y = { title: { display: true, text: 'Elevation (m)' }, ticks: { precision: 0 } };
          scales.y2 = {
            position: 'right',
            grid: { drawOnChartArea: false },
            title: { display: true, text: 'Speed (km/h)' },
            ticks: { precision: 0 },
          };
        }

        // Add secondary x-axis for time-based charts
        if (useTime) {
          scales.x2 = {
            type: 'linear',
            position: 'top',
            bounds: 'data',
            min: xMin,
            max: xMax,
            display: true,
            grid: { drawOnChartArea: false },
            ticks: {
              callback: function (val) {
                try {
                  if (!useTime) return '';
                  var lo = 0,
                    hi = timeOffsets.length - 1;
                  while (lo < hi) {
                    var mid = (lo + hi) >>> 1;
                    if (timeOffsets[mid] < val) lo = mid + 1;
                    else hi = mid;
                  }
                  var i = Math.max(1, lo);
                  var t0 = timeOffsets[i - 1],
                    t1 = timeOffsets[i];
                  var u = t1 > t0 ? (val - t0) / (t1 - t0) : 0;
                  var d0 = cumDist[i - 1],
                    d1 = cumDist[i];
                  var d = Math.max(0, d0 + (d1 - d0) * u);
                  return (d / 1000).toFixed(1) + ' km';
                } catch (_) {
                  return '';
                }
              },
            },
          };
        }

        // Add day/night visualization plugin if periods are available
        var chartPlugins = [];
        // Check daynightEnabled - wp_localize_script may convert boolean to string "1" or ""
        var isDaynightEnabled =
          window.FGPX &&
          (FGPX.daynightEnabled === true ||
            FGPX.daynightEnabled === '1' ||
            FGPX.daynightEnabled === 1);

        DBG.log('Chart plugin setup - ALL CONDITIONS', {
          hasDayNightPeriods: !!(dayNightPeriods && dayNightPeriods.length > 0),
          dayNightPeriodsExists: !!dayNightPeriods,
          dayNightPeriodsLength: dayNightPeriods ? dayNightPeriods.length : 0,
          useTime: useTime,
          windowFGPX: !!window.FGPX,
          daynightEnabledRaw: window.FGPX ? FGPX.daynightEnabled : 'FGPX not defined',
          daynightEnabledType: window.FGPX ? typeof FGPX.daynightEnabled : 'N/A',
          isDaynightEnabled: isDaynightEnabled,
          allConditionsMet: !!(
            dayNightPeriods &&
            dayNightPeriods.length > 0 &&
            useTime &&
            isDaynightEnabled
          ),
        });

        if (dayNightPeriods && dayNightPeriods.length > 0 && useTime && isDaynightEnabled) {
          DBG.log('Adding day/night chart plugin', { periods: dayNightPeriods });
          chartPlugins.push({
            id: 'dayNightBackground',
            beforeDestroy: function () {
              var tt = document.getElementById('daynight-tooltip');
              if (tt) {
                tt.remove();
              }
            },
            afterDatasetsDraw: function (chart) {
              // Draw after datasets but before position marker
              var ctx = chart.ctx;
              var chartArea = chart.chartArea;
              var xScale = chart.scales.x;

              if (!chartArea || !xScale) {
                DBG.warn('Missing chart elements for day/night visualization');
                return;
              }

              ctx.save();

              // Draw night periods as dark background
              var nightPeriods = [];
              var lastSunset = null;

              // Get track start and duration for partial night periods
              var trackStart = xScale.min || 0;
              var trackDuration = xScale.max || 0;

              // Check if track starts during night (first event is sunrise or nightStart marker)
              if (
                dayNightPeriods.length > 0 &&
                (dayNightPeriods[0].type === 'sunrise' || dayNightPeriods[0].type === 'nightStart')
              ) {
                // For nightStart marker (entire track during night), cover the whole track
                if (dayNightPeriods[0].type === 'nightStart') {
                  nightPeriods.push({ start: trackStart, end: trackDuration });
                } else {
                  nightPeriods.push({ start: trackStart, end: dayNightPeriods[0].timeOffset });
                }
              }

              for (var i = 0; i < dayNightPeriods.length; i++) {
                var period = dayNightPeriods[i];
                if (period.type === 'sunset') {
                  lastSunset = period.timeOffset;
                } else if (period.type === 'sunrise' && lastSunset !== null) {
                  nightPeriods.push({ start: lastSunset, end: period.timeOffset });
                  lastSunset = null;
                }
              }

              // If we have a sunset but no following sunrise, create night period to end of track
              if (lastSunset !== null) {
                nightPeriods.push({ start: lastSunset, end: trackDuration });
              }

              // Draw night backgrounds with more visible color for testing
              ctx.fillStyle = 'rgba(0, 0, 100, 0.4)'; // More visible blue
              for (var j = 0; j < nightPeriods.length; j++) {
                var night = nightPeriods[j];
                var startX = xScale.getPixelForValue(night.start);
                var endX = xScale.getPixelForValue(night.end);

                if (startX < chartArea.right && endX > chartArea.left) {
                  var rectX = Math.max(startX, chartArea.left);
                  var rectWidth = Math.min(endX, chartArea.right) - rectX;
                  var rectY = chartArea.top;
                  var rectHeight = chartArea.bottom - chartArea.top;

                  ctx.fillRect(rectX, rectY, rectWidth, rectHeight);
                }
              }

              // Draw sunrise/sunset lines
              ctx.lineWidth = 1; // Thin lines
              for (var k = 0; k < dayNightPeriods.length; k++) {
                var p = dayNightPeriods[k];
                var x = xScale.getPixelForValue(p.timeOffset);

                if (x >= chartArea.left && x <= chartArea.right) {
                  ctx.strokeStyle =
                    p.type === 'sunrise' ? 'rgba(255, 215, 0, 0.8)' : 'rgba(255, 215, 0, 0.8)'; // Yellow color for both
                  ctx.beginPath();
                  ctx.moveTo(x, chartArea.top);
                  ctx.lineTo(x, chartArea.bottom);
                  ctx.stroke();
                }
              }

              ctx.restore();
            },
            afterEvent: function (chart, args) {
              // Handle hover events for sunrise/sunset lines
              var event = args.event;
              if (event.type === 'mousemove') {
                var canvasPosition = Chart.helpers.getRelativePosition(event, chart);
                var dataX = chart.scales.x.getValueForPixel(canvasPosition.x);
                var chartArea = chart.chartArea;

                // Check if mouse is over any sunrise/sunset line (within 5 pixels)
                var hoveredLine = null;
                for (var k = 0; k < dayNightPeriods.length; k++) {
                  var p = dayNightPeriods[k];
                  var lineX = chart.scales.x.getPixelForValue(p.timeOffset);

                  if (
                    Math.abs(canvasPosition.x - lineX) <= 5 &&
                    canvasPosition.y >= chartArea.top &&
                    canvasPosition.y <= chartArea.bottom
                  ) {
                    hoveredLine = p;
                    break;
                  }
                }

                // Show/hide custom tooltip
                var tooltipEl = document.getElementById('daynight-tooltip');
                if (hoveredLine) {
                  if (!tooltipEl) {
                    tooltipEl = document.createElement('div');
                    tooltipEl.id = 'daynight-tooltip';
                    tooltipEl.style.position = 'absolute';
                    tooltipEl.style.background = 'rgba(0, 0, 0, 0.8)';
                    tooltipEl.style.color = 'white';
                    tooltipEl.style.padding = '8px 12px';
                    tooltipEl.style.borderRadius = '4px';
                    tooltipEl.style.fontSize = '12px';
                    tooltipEl.style.pointerEvents = 'none';
                    tooltipEl.style.zIndex = '1000';
                    tooltipEl.style.whiteSpace = 'nowrap';
                    document.body.appendChild(tooltipEl);
                  }

                  // Format time for tooltip
                  var timeStr = '';
                  if (hoveredLine.actualTime) {
                    var date = new Date(hoveredLine.actualTime);
                    timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  }

                  tooltipEl.innerHTML =
                    hoveredLine.type === 'sunrise'
                      ? 'Sunrise' + (timeStr ? ' at ' + timeStr : '')
                      : 'Sunset' + (timeStr ? ' at ' + timeStr : '');

                  // Position tooltip
                  var rect = chart.canvas.getBoundingClientRect();
                  tooltipEl.style.left = rect.left + canvasPosition.x + 10 + 'px';
                  tooltipEl.style.top = rect.top + canvasPosition.y - 30 + 'px';
                  tooltipEl.style.display = 'block';

                  // Change cursor
                  chart.canvas.style.cursor = 'pointer';
                } else {
                  if (tooltipEl) {
                    tooltipEl.style.display = 'none';
                  }
                  chart.canvas.style.cursor = 'default';
                }
              }
            },
          });
        } else {
          DBG.log('Day/night plugin not added - requirements not met');
        }

        // Chart area selection and zoom plugin
        var chartZoomPlugin = {
          id: 'chartZoom',
          beforeInit: function (chart) {
            // Skip zoom functionality for polar charts (wind rose)
            if (chart.config.type === 'polarArea') {
              chart.chartZoomState = { disabled: true };
              return;
            }

            chart.chartZoomState = {
              isSelecting: false,
              selectionStart: null,
              selectionEnd: null,
              originalScales: null,
              zoomedRange: null,
            };
          },
          afterInit: function (chart) {
            var state = chart.chartZoomState;
            if (state && state.disabled) return; // Skip for polar charts

            var canvas = chart.canvas;
            var ctx = chart.ctx;

            // Add reset zoom button
            var resetBtn = document.createElement('button');
            resetBtn.textContent = '🔍 Reset Zoom';
            resetBtn.className = 'fgpx-chart-reset-zoom';
            resetBtn.style.cssText =
              'position: absolute; top: 5px; right: 5px; z-index: 1000; padding: 4px 8px; font-size: 11px; background: rgba(255,255,255,0.9); border: 1px solid #ccc; border-radius: 3px; cursor: pointer; display: none;';
            resetBtn.title = 'Reset chart zoom to show full track';

            // Insert reset button relative to chart container
            var chartContainer = canvas.parentElement;
            if (chartContainer) {
              chartContainer.style.position = 'relative';
              chartContainer.appendChild(resetBtn);
            }

            resetBtn.addEventListener('click', function () {
              resetChartZoom(chart);
            });

            chart.chartZoomState.resetButton = resetBtn;

            // Mouse event handlers for area selection
            var isMouseDown = false;
            var startX = null;

            canvas.addEventListener('mousedown', function (e) {
              if (e.button !== 0) return; // Only left mouse button

              var rect = canvas.getBoundingClientRect();
              var x = e.clientX - rect.left;
              var y = e.clientY - rect.top;

              // Check if click is in chart area (not on axes)
              var chartArea = chart.chartArea;
              if (
                x >= chartArea.left &&
                x <= chartArea.right &&
                y >= chartArea.top &&
                y <= chartArea.bottom
              ) {
                isMouseDown = true;
                startX = x;
                state.isSelecting = true;
                state.selectionStart = x;
                state.selectionEnd = x;
                canvas.style.cursor = 'crosshair';
              }
            });

            canvas.addEventListener('mousemove', function (e) {
              if (!isMouseDown || !state.isSelecting) return;

              var rect = canvas.getBoundingClientRect();
              var x = e.clientX - rect.left;

              // Constrain to chart area
              var chartArea = chart.chartArea;
              x = Math.max(chartArea.left, Math.min(chartArea.right, x));

              state.selectionEnd = x;
              chart.update('none'); // Redraw without animation
            });

            // Detect touch-primary devices; skip click-to-seek to avoid accidental scrubs
            var _coarsePointer =
              typeof window.matchMedia === 'function' &&
              window.matchMedia('(pointer: coarse)').matches;

            canvas.addEventListener('mouseup', function (e) {
              if (!isMouseDown || !state.isSelecting) return;

              isMouseDown = false;
              canvas.style.cursor = 'default';

              var rect = canvas.getBoundingClientRect();
              var endX = e.clientX - rect.left;

              // Constrain to chart area
              var chartArea = chart.chartArea;
              endX = Math.max(chartArea.left, Math.min(chartArea.right, endX));

              // Check if selection is meaningful (minimum 10 pixels)
              if (Math.abs(endX - startX) > 10) {
                applyChartZoom(chart, Math.min(startX, endX), Math.max(startX, endX));
              } else if (!_coarsePointer) {
                // Single click — seek playback to clicked position (disabled on touch-primary devices)
                var xScale = chart.scales.x;
                if (xScale) {
                  var xValue = xScale.getValueForPixel(endX);
                  var range = xScale.max - xScale.min;
                  if (range > 0) {
                    var frac = (xValue - xScale.min) / range;
                    seekToFraction(Math.max(0, Math.min(1, frac)));
                  }
                }
              }

              // Reset selection state
              state.isSelecting = false;
              state.selectionStart = null;
              state.selectionEnd = null;
              chart.update('none');
            });

            // Show pointer cursor when hovering the chart area (indicates click-to-seek)
            var _cursorLastX = -1,
              _cursorLastY = -1;
            canvas.addEventListener('mousemove', function (e) {
              if (state.isSelecting) return; // crosshair already set during drag
              var rect = canvas.getBoundingClientRect();
              var x = e.clientX - rect.left;
              var y = e.clientY - rect.top;
              // Skip if position hasn't changed meaningfully (throttle by proximity)
              if (Math.abs(x - _cursorLastX) < 4 && Math.abs(y - _cursorLastY) < 4) return;
              _cursorLastX = x;
              _cursorLastY = y;
              var chartArea = chart.chartArea;
              if (
                chartArea &&
                x >= chartArea.left &&
                x <= chartArea.right &&
                y >= chartArea.top &&
                y <= chartArea.bottom
              ) {
                canvas.style.cursor = 'pointer';
              } else {
                canvas.style.cursor = 'default';
              }
            });

            // Cancel selection on mouse leave
            canvas.addEventListener('mouseleave', function () {
              if (state.isSelecting) {
                isMouseDown = false;
                state.isSelecting = false;
                state.selectionStart = null;
                state.selectionEnd = null;
                chart.update('none');
              }
              canvas.style.cursor = 'default';
            });
          },
          afterDraw: function (chart) {
            var state = chart.chartZoomState;
            if (state && state.disabled) return; // Skip for polar charts
            if (!state.isSelecting || !state.selectionStart || !state.selectionEnd) return;

            var ctx = chart.ctx;
            var chartArea = chart.chartArea;

            // Draw selection rectangle
            var startX = Math.max(chartArea.left, Math.min(chartArea.right, state.selectionStart));
            var endX = Math.max(chartArea.left, Math.min(chartArea.right, state.selectionEnd));
            var width = Math.abs(endX - startX);

            if (width > 0) {
              ctx.save();
              ctx.fillStyle = 'rgba(54, 162, 235, 0.2)';
              ctx.strokeStyle = 'rgba(54, 162, 235, 0.8)';
              ctx.lineWidth = 1;

              ctx.fillRect(
                Math.min(startX, endX),
                chartArea.top,
                width,
                chartArea.bottom - chartArea.top
              );
              ctx.strokeRect(
                Math.min(startX, endX),
                chartArea.top,
                width,
                chartArea.bottom - chartArea.top
              );

              ctx.restore();
            }
          },
        };

        // Helper functions for chart zoom
        function applyChartZoom(chart, startX, endX) {
          try {
            var state = chart.chartZoomState;
            if (state && state.disabled) return; // Skip for polar charts

            var chartArea = chart.chartArea;

            // Convert pixel positions to data values
            var xScale = chart.scales.x;
            if (!xScale) return;

            var startValue = xScale.getValueForPixel(startX);
            var endValue = xScale.getValueForPixel(endX);

            // Ensure proper order
            if (startValue > endValue) {
              var temp = startValue;
              startValue = endValue;
              endValue = temp;
            }

            // Store original scales if not already stored
            if (!state.originalScales) {
              state.originalScales = {
                x: { min: xScale.min, max: xScale.max },
              };

              // Store original scales for all y-axes
              Object.keys(chart.scales).forEach(function (scaleId) {
                if (scaleId !== 'x') {
                  var scale = chart.scales[scaleId];
                  state.originalScales[scaleId] = { min: scale.min, max: scale.max };
                }
              });
            }

            // Apply zoom to x-axis
            xScale.options.min = startValue;
            xScale.options.max = endValue;

            // Store zoomed range for marker filtering
            state.zoomedRange = { min: startValue, max: endValue };

            // Show reset button
            if (state.resetButton) {
              state.resetButton.style.display = 'block';
            }

            // Update chart to apply zoom changes
            chart.update('none');

            DBG.log('Chart zoomed', {
              startValue: startValue,
              endValue: endValue,
              range: endValue - startValue,
              markerInRange: cursorX >= startValue && cursorX <= endValue,
            });
          } catch (e) {
            DBG.warn('Error applying chart zoom:', e);
          }
        }

        function resetChartZoom(chart) {
          try {
            var state = chart.chartZoomState;
            if (!state || !state.originalScales) return;

            // Restore original scales
            Object.keys(state.originalScales).forEach(function (scaleId) {
              var scale = chart.scales[scaleId];
              if (scale && scale.options) {
                scale.options.min = state.originalScales[scaleId].min;
                scale.options.max = state.originalScales[scaleId].max;
              }
            });

            // Clear zoom state
            state.originalScales = null;
            state.zoomedRange = null;

            // Hide reset button
            if (state.resetButton) {
              state.resetButton.style.display = 'none';
            }

            // Ensure marker is visible again after zoom reset
            if (map && map.getLayer('fgpx-point')) {
              map.setLayoutProperty('fgpx-point', 'visibility', 'visible');
            }

            // Update chart to apply reset changes
            chart.update('none');

            DBG.log('Chart zoom reset');
          } catch (e) {
            DBG.warn('Error resetting chart zoom:', e);
          }
        }

        // Combine all plugins including day/night and zoom plugins
        var allPlugins = [cursorPlugin, chartZoomPlugin];
        if (chartPlugins.length > 0) {
          allPlugins = allPlugins.concat(chartPlugins);
        }

        DBG.log('Final plugins array', { count: allPlugins.length, plugins: allPlugins });

        chart = new window.Chart(ui.canvas.getContext('2d'), {
          type: 'line',
          data: { datasets: datasets },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            scales: scales,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  afterBody: function (context) {
                    // Enhanced tooltip showing all available metrics at current position
                    var tooltipLines = [];
                    var xVal = context[0].parsed.x;

                    // Find closest data point index
                    var idx = 0;
                    if (useTime && Array.isArray(timeOffsets)) {
                      for (var i = 0; i < timeOffsets.length - 1; i++) {
                        if (Math.abs(timeOffsets[i] - xVal) < Math.abs(timeOffsets[i + 1] - xVal)) {
                          idx = i;
                          break;
                        }
                        idx = i + 1;
                      }
                    } else {
                      idx = Math.round((xVal / (totalDistance / 1000)) * (coords.length - 1));
                    }

                    idx = Math.max(0, Math.min(coords.length - 1, idx));

                    // Add elevation
                    if (coords[idx] && typeof coords[idx][2] === 'number') {
                      tooltipLines.push('Elevation: ' + Math.round(coords[idx][2]) + ' m');
                    }

                    // Add speed if available
                    if (speedSeries && speedSeries[idx] != null) {
                      tooltipLines.push('Speed: ' + Math.round(speedSeries[idx]) + ' km/h');
                    }

                    // Add heart rate if available
                    if (
                      Array.isArray(heartRates) &&
                      heartRates[idx] != null &&
                      heartRates[idx] > 0
                    ) {
                      tooltipLines.push('Heart Rate: ' + Math.round(heartRates[idx]) + ' bpm');
                    }

                    // Add cadence if available
                    if (Array.isArray(cadences) && cadences[idx] != null && cadences[idx] > 0) {
                      tooltipLines.push('Cadence: ' + Math.round(cadences[idx]) + ' rpm');
                    }

                    // Add temperature if available
                    if (
                      Array.isArray(temperatures) &&
                      temperatures[idx] != null &&
                      temperatures[idx] > 0
                    ) {
                      tooltipLines.push(
                        'Temperature: ' + Math.round(temperatures[idx] * 10) / 10 + ' °C'
                      );
                    }

                    // Add power if available
                    if (Array.isArray(powers) && powers[idx] != null && powers[idx] > 0) {
                      tooltipLines.push('Power: ' + Math.round(powers[idx]) + ' watts');
                    }

                    // Add wind data if available
                    if (
                      Array.isArray(windSpeeds) &&
                      windSpeeds[idx] != null &&
                      windSpeeds[idx] > 0
                    ) {
                      tooltipLines.push(
                        'Wind Speed: ' + Math.round(windSpeeds[idx] * 10) / 10 + ' km/h'
                      );
                    }
                    if (Array.isArray(windDirections) && windDirections[idx] != null) {
                      var compassDirs = [
                        'N',
                        'NNE',
                        'NE',
                        'ENE',
                        'E',
                        'ESE',
                        'SE',
                        'SSE',
                        'S',
                        'SSW',
                        'SW',
                        'WSW',
                        'W',
                        'WNW',
                        'NW',
                        'NNW',
                      ];
                      var dirIndex = Math.round(windDirections[idx] / 22.5) % 16;
                      tooltipLines.push(
                        'Wind Direction: ' +
                          compassDirs[dirIndex] +
                          ' (' +
                          Math.round(windDirections[idx]) +
                          '°)'
                      );
                    }
                    if (
                      Array.isArray(windImpacts) &&
                      windImpacts[idx] != null &&
                      Array.isArray(speedSeries) &&
                      speedSeries[idx] != null
                    ) {
                      var impact = windImpacts[idx];
                      var currentSpeed = speedSeries[idx];
                      if (currentSpeed > 0) {
                        var speedDiff = (impact - 1.0) * currentSpeed;
                        var impactStr =
                          speedDiff > 0
                            ? 'Tailwind (+' + Math.round(speedDiff * 10) / 10 + ' km/h)'
                            : speedDiff < 0
                              ? 'Headwind (' + Math.round(speedDiff * 10) / 10 + ' km/h)'
                              : 'No wind impact';
                        tooltipLines.push('Wind Impact: ' + impactStr);
                      }
                    }

                    // Add night indicator if day/night visualization is enabled and we're in a night period
                    var isDaynightEnabledTooltip =
                      window.FGPX &&
                      (FGPX.daynightEnabled === true ||
                        FGPX.daynightEnabled === '1' ||
                        FGPX.daynightEnabled === 1);
                    if (
                      useTime &&
                      dayNightPeriods &&
                      dayNightPeriods.length > 0 &&
                      isDaynightEnabledTooltip
                    ) {
                      // Calculate night periods from dayNightPeriods
                      var nightPeriods = [];
                      var lastSunset = null;
                      var trackStart = timeOffsets[0] || 0;
                      var trackDuration = timeOffsets[timeOffsets.length - 1] || 0;

                      // Check if track starts during night (first event is sunrise or nightStart marker)
                      if (
                        dayNightPeriods.length > 0 &&
                        (dayNightPeriods[0].type === 'sunrise' ||
                          dayNightPeriods[0].type === 'nightStart')
                      ) {
                        // For nightStart marker (entire track during night), cover the whole track
                        if (dayNightPeriods[0].type === 'nightStart') {
                          nightPeriods.push({ start: trackStart, end: trackDuration });
                        } else {
                          nightPeriods.push({
                            start: trackStart,
                            end: dayNightPeriods[0].timeOffset,
                          });
                        }
                      }

                      for (var i = 0; i < dayNightPeriods.length; i++) {
                        var period = dayNightPeriods[i];
                        if (period.type === 'sunset') {
                          lastSunset = period.timeOffset;
                        } else if (period.type === 'sunrise' && lastSunset !== null) {
                          nightPeriods.push({ start: lastSunset, end: period.timeOffset });
                          lastSunset = null;
                        }
                      }

                      // If we have a sunset but no following sunrise, create night period to end of track
                      if (lastSunset !== null) {
                        nightPeriods.push({ start: lastSunset, end: trackDuration });
                      }

                      // Check if current time offset is within any night period
                      var currentTimeOffset = useTime ? timeOffsets[idx] : null;
                      if (currentTimeOffset !== null) {
                        for (var j = 0; j < nightPeriods.length; j++) {
                          var night = nightPeriods[j];
                          if (currentTimeOffset >= night.start && currentTimeOffset <= night.end) {
                            tooltipLines.push('🌙 Night time');
                            break;
                          }
                        }
                      }
                    }

                    return tooltipLines;
                  },
                },
              },
            },
          },
          plugins: allPlugins,
        });
      };

      // Initialize with elevation tab now that all functions are defined
      createChart('elevation');

      // Enable controls now that data/map are ready
      ui.controls.btnPlay.disabled = false;
      ui.controls.btnPause.disabled = false;
      ui.controls.btnRestart.disabled = false;
      ui.controls.btnRecord.disabled = false;

      // Animation state
      var playing = false;
      var rafId = null; // guards against duplicate requestAnimationFrame scheduling
      var speed =
        window.FGPX && isFinite(Number(FGPX.defaultSpeed)) ? Number(FGPX.defaultSpeed) : 25; // default multiplier
      var tStart = null; // ms timestamp when started
      var tOffset = 0; // accumulated paused time in seconds
      var progress = 0; // 0..1 by distance
      var lastFrame = null;
      var playStartTrace = null; // stage timing diagnostics for startup pipeline
      var mapFadeDurationDefault = null; // original style fade duration restored on pause
      var bearing = null; // smoothed
      var defaultZoom = defaultZoomSetting; // default zoom level when starting/restarting
      var lastFrameDt = 0; // seconds
      var cameraCenter = coords[0].slice(0, 2);
      var targetBearingSmooth = null; // temporal smoothing for target bearing
      var chartCooldown = 0; // seconds throttle for chart updates
      var hudCooldown = 0; // seconds throttle for HUD text updates
      var photoScanCooldown = 0; // seconds throttle for photo queue scans
      var cameraCooldown = 0; // seconds throttle for camera updates
      var forceCameraUpdate = true; // ensure first frame centers on marker
      var appliedBearing = null; // last bearing actually applied
      var cameraJumpedThisFrame = false; // prevent progress setData in same frame as jumpTo
      var cameraJumpedLastFrame = false; // hysteresis helper to avoid jumpTo bursts
      var cameraJumpStreak = 0; // consecutive jump frames, used for adaptive jitter damping
      var progressLineVisible = null; // track visibility state to avoid redundant toggles
      var markerLayerVisible = null; // track marker visibility state to avoid redundant toggles
      var lastMarkerPx = null; // track marker screen position to skip redundant setData
      var lastMarkerDistance = null; // marker distance checkpoint for robust update forcing
      var markerDataCooldown = 0; // force marker setData at bounded interval to avoid visible lag
      var segmentLengthCache = []; // per-pool-slot last coord count, to skip unchanged setData
      var segmentTipCache = []; // per-pool-slot last tip coordinate, to detect moving-endpoint changes
      var segmentColorCache = []; // per-pool-slot last color, to avoid getPaintProperty churn
      var progressArrowsCooldown = 0; // throttle progressData source updates when arrows are enabled
      var dbgMarkerSetDataCount = 0;
      var dbgProgressSetDataCount = 0;
      var dbgSegmentSetDataCount = 0;
      var dbgCameraJumpCount = 0;
      var currentPosLngLat = null; // last computed marker lng/lat for snap-to-center on seek
      var firstPlayZoomPending = true; // animate zoom-in on first play after stop
      var startupZoomTargetState = null; // preserves the final zoom-in camera center for countdown handoff
      var suppressCameraUpdateFrames = 0; // startup handoff guard to prevent first-frame snap after countdown
      var STARTUP_COUNTDOWN_SECONDS = 3;
      var startupSpeedRampRemaining = 0; // seconds remaining in startup speed ramp (0 = full speed)
      var startupSpeedRampDuration = 0; // total ramp duration for easing calculation
      var playbackStartedAtMs = 0; // wall clock ms when playback starts

      // Idle sway: gentle organic bearing oscillation when paused or during countdown
      var swayRafId = null;
      var swayStartTime = null;
      var swayBaseBearing = null;
      var swayLastBearing = null; // last applied bearing for smooth stop
      var swayActive = false;

      /**
       * Starts the idle sway animation for the camera bearing when paused.
       */
      function startIdleSway(fromBearing) {
        if (swayActive) return;
        swayActive = true;
        swayStartTime = null;
        swayLastBearing = null;
        // Prefer an explicitly passed bearing (e.g. intendedFinalBearing from the
        // zoom-in animation) so we never snap on the first sway frame.
        try {
          if (isFinite(Number(fromBearing))) {
            swayBaseBearing = normalizeAngle(Number(fromBearing));
          } else if (isFinite(Number(bearing))) {
            swayBaseBearing = normalizeAngle(bearing);
          } else if (typeof map.getBearing === 'function') {
            var liveBearing = Number(map.getBearing());
            swayBaseBearing = isFinite(liveBearing) ? normalizeAngle(liveBearing) : 0;
          } else {
            swayBaseBearing = 0;
          }
        } catch (_) {
          swayBaseBearing = 0;
        }
        function swayFrame(ts) {
          if (!swayActive) return;
          if (swayStartTime == null) swayStartTime = ts;
          var elapsed = ts - swayStartTime;
          // Layered sine waves at different frequencies for organic, non-mechanical feel
          var t = elapsed / 1000; // seconds
          var primary = Math.sin(t * 0.55) * 12;
          var secondary = Math.sin(t * 1.1) * 5;
          var tertiary = Math.sin(t * 0.23) * 6;
          var swayAngle = primary + secondary + tertiary;
          // Smooth fade-in over 2 seconds to avoid any abrupt start
          var fadeIn = Math.min(1, elapsed / 2000);
          fadeIn = fadeIn * fadeIn * (3 - 2 * fadeIn); // smoothstep
          swayAngle *= fadeIn;
          var targetBearing = normalizeAngle(swayBaseBearing + swayAngle);
          // Low-pass filter bearing changes for butter-smooth motion
          if (swayLastBearing == null) {
            swayLastBearing = targetBearing;
          } else {
            var delta = shortestAngleDelta(swayLastBearing, targetBearing);
            swayLastBearing = normalizeAngle(swayLastBearing + delta * 0.08);
          }
          try {
            if (!userInteracting && map && typeof map.flyTo === 'function') {
              map.flyTo({ bearing: swayLastBearing, essential: true });
            }
          } catch (_) {}
          swayRafId = requestAnimationFrame(swayFrame);
        }
        swayRafId = requestAnimationFrame(swayFrame);
      }

      /**
       * Stops the idle sway animation for the camera bearing.
       */
      function stopIdleSway() {
        swayActive = false;
        if (swayRafId) {
          try {
            cancelAnimationFrame(swayRafId);
          } catch (_) {}
          swayRafId = null;
        }
        swayStartTime = null;
        swayLastBearing = null;
      }

      registerTeardown(function () {
        removeRecordingRenderHook();
        stopIdleSway();
      });

      // Consolidated camera state sync helpers — replace duplicate inline code
      /**
       * Synchronizes the camera state to the given center and bearing.
       * @param {Array} center - [lng, lat] camera center.
       * @param {number} brg - Bearing in degrees.
       */
      function syncCameraState(center, brg) {
        cameraCenter[0] = center[0];
        cameraCenter[1] = center[1];
        bearing = normalizeAngle(brg);
        appliedBearing = bearing;
        targetBearingSmooth = bearing;
        forceCameraUpdate = false;
        cameraCooldown = 0;
        cameraJumpedLastFrame = false;
        cameraJumpStreak = 0;
      }

      /**
       * Synchronizes the camera state from the current map view.
       */
      function syncCameraStateFromMap(ignoreCenter) {
        try {
          if (!ignoreCenter && typeof map.getCenter === 'function') {
            var c = map.getCenter();
            if (c && isFinite(c.lng) && isFinite(c.lat)) {
              cameraCenter[0] = c.lng;
              cameraCenter[1] = c.lat;
            }
          }
          var b = 0;
          if (typeof map.getBearing === 'function') {
            b = Number(map.getBearing());
            if (!isFinite(b)) b = isFinite(Number(bearing)) ? bearing : 0;
          }
          bearing = normalizeAngle(b);
          appliedBearing = bearing;
          targetBearingSmooth = bearing;
          forceCameraUpdate = false;
          cameraCooldown = 0;
          cameraJumpedLastFrame = false;
          cameraJumpStreak = 0;
        } catch (_) {}
      }

      // Apply rendering optimizations for playback: zero tile fades, allow label overlap.
      // Called once before the intro easeTo so that MapLibre settles layout during the
      // 3.5s zoom animation, preventing any visible label-shift at countdown start.
      /**
       * Applies rendering optimizations for playback (tile fade, label overlap, etc.).
       */
      function applyPlaybackLayerOptimizations() {
        try {
          if (map.style && typeof map.style.fadeDuration !== 'undefined') {
            if (mapFadeDurationDefault == null) mapFadeDurationDefault = map.style.fadeDuration;
            map.style.fadeDuration = 0;
          }
          var _pst = map.getStyle();
          var _players = _pst && _pst.layers ? _pst.layers : [];
          for (var _pli = 0; _pli < _players.length; _pli++) {
            var _plyr = _players[_pli];
            if (!_plyr || !_plyr.id || !map.getLayer(_plyr.id)) continue;
            if (_plyr.type === 'raster') {
              try {
                map.setPaintProperty(_plyr.id, 'raster-fade-duration', 0);
              } catch (_) {}
            }
            if (_plyr.type === 'symbol') {
              try {
                map.setLayoutProperty(_plyr.id, 'text-allow-overlap', true);
                map.setLayoutProperty(_plyr.id, 'text-ignore-placement', true);
              } catch (_) {}
            }
          }
        } catch (_) {}
      }

      /**
       * Calculates the target bearing at a given distance along the track.
       * @param {number} d - Distance in meters.
       * @returns {number} Bearing in degrees.
       */
      function targetBearingAtDistance(d) {
        try {
          var dMaxAhead = privacyEnabled ? privacyEndD : totalDistance;
          var pos = positionAtDistance(d);
          var remainingAhead = Math.max(0, dMaxAhead - d);
          if (remainingAhead <= 8) return isFinite(Number(bearing)) ? normalizeAngle(bearing) : 0;
          var ahead40 = positionAtDistance(Math.min(dMaxAhead, d + 40));
          var ahead80 = positionAtDistance(Math.min(dMaxAhead, d + 80));
          var ahead150 = positionAtDistance(Math.min(dMaxAhead, d + 150));
          var ahead250 = positionAtDistance(Math.min(dMaxAhead, d + 250));
          var b40 = bearingBetween(pos, ahead40);
          var b80 = bearingBetween(pos, ahead80);
          var b150 = bearingBetween(pos, ahead150);
          var b250 = bearingBetween(pos, ahead250);
          var w40 = 0.2,
            w80 = 0.3,
            w150 = 0.3,
            w250 = 0.2;
          var rad40 = (b40 * Math.PI) / 180,
            rad80 = (b80 * Math.PI) / 180;
          var rad150 = (b150 * Math.PI) / 180,
            rad250 = (b250 * Math.PI) / 180;
          var vx =
            Math.cos(rad40) * w40 +
            Math.cos(rad80) * w80 +
            Math.cos(rad150) * w150 +
            Math.cos(rad250) * w250;
          var vy =
            Math.sin(rad40) * w40 +
            Math.sin(rad80) * w80 +
            Math.sin(rad150) * w150 +
            Math.sin(rad250) * w250;
          var tb = (Math.atan2(vy, vx) * 180) / Math.PI;
          return normalizeAngle(tb);
        } catch (_) {
          return 0;
        }
      }

      /**
       * Calculates the camera target position at a given distance and lookahead factor.
       * @param {number} d - Distance in meters.
       * @param {number} lookaheadFactor - Lookahead factor (0..1).
       * @returns {Array} [lng, lat] camera target.
       */
      function cameraTargetAtDistance(d, lookaheadFactor) {
        try {
          var dMaxAhead = privacyEnabled ? privacyEndD : totalDistance;
          var pos = positionAtDistance(d);
          var remainingAhead = Math.max(0, dMaxAhead - d);
          var factor = isFinite(Number(lookaheadFactor))
            ? Math.max(0, Number(lookaheadFactor))
            : 0.4;
          var cameraLookaheadD = Math.min(remainingAhead * factor, hasTerrain ? 35 : 50);
          return cameraLookaheadD > 2
            ? positionAtDistance(Math.min(dMaxAhead, d + cameraLookaheadD)).slice(0, 2)
            : pos.slice(0, 2);
        } catch (_) {
          return positionAtDistance(d).slice(0, 2);
        }
      }

      /**
       * Returns the time offset at a given distance along the track.
       * @param {number} dMeters - Distance in meters.
       * @returns {number} Time offset in seconds.
       */
      function timeOffsetAtDistance(dMeters) {
        try {
          if (
            !hasTimestamps ||
            !Array.isArray(timeOffsets) ||
            !Array.isArray(cumDist) ||
            timeOffsets.length < 2 ||
            cumDist.length < 2
          ) {
            return isFinite(Number(tOffset)) ? Number(tOffset) : 0;
          }
          var dClamped = Math.max(0, Math.min(totalDistance, Number(dMeters) || 0));
          var lo = 0,
            hi = cumDist.length - 1;
          while (lo < hi) {
            var mid = (lo + hi) >>> 1;
            if (cumDist[mid] < dClamped) lo = mid + 1;
            else hi = mid;
          }
          var i = Math.max(1, lo);
          var d0 = Number(cumDist[i - 1]) || 0;
          var d1 = Number(cumDist[i]) || d0;
          var t0 = Number(timeOffsets[i - 1]) || 0;
          var t1 = Number(timeOffsets[i]) || t0;
          if (d1 <= d0) return t0;
          var u = (dClamped - d0) / (d1 - d0);
          return t0 + (t1 - t0) * u;
        } catch (_) {
          return isFinite(Number(tOffset)) ? Number(tOffset) : 0;
        }
      }

      /**
       * Returns the distance along the track at a given time offset.
       * @param {number} tSeconds - Time offset in seconds.
       * @returns {number} Distance in meters.
       */
      function distanceAtTimeOffset(tSeconds) {
        try {
          if (
            !hasTimestamps ||
            !Array.isArray(timeOffsets) ||
            !Array.isArray(cumDist) ||
            timeOffsets.length < 2 ||
            cumDist.length < 2
          ) {
            return Math.max(0, Math.min(totalDistance, (Number(progress) || 0) * totalDistance));
          }
          var tClamped = Math.max(0, Math.min(totalDuration, Number(tSeconds) || 0));
          var lo = 0,
            hi = timeOffsets.length - 1;
          while (lo < hi) {
            var mid = (lo + hi) >>> 1;
            if (timeOffsets[mid] < tClamped) lo = mid + 1;
            else hi = mid;
          }
          var i = Math.max(1, lo);
          var t0 = Number(timeOffsets[i - 1]) || 0;
          var t1 = Number(timeOffsets[i]) || t0;
          var d0 = Number(cumDist[i - 1]) || 0;
          var d1 = Number(cumDist[i]) || d0;
          if (t1 <= t0) return d0;
          var u = (tClamped - t0) / (t1 - t0);
          return d0 + (d1 - d0) * u;
        } catch (_) {
          return Math.max(0, Math.min(totalDistance, (Number(progress) || 0) * totalDistance));
        }
      }

      /**
       * Computes a perspective-corrected zoom target so the marker appears at screen center.
       * With pitch > 0, screen center is not at map center. This function offsets the target
       * center backwards (opposite bearing) to compensate for perspective distortion.
       * @param {Array} markerPos - [lng, lat] of the current marker position
       * @param {number} bearing - Bearing in degrees toward the direction of travel
       * @param {number} pitchDeg - Pitch angle in degrees (e.g., 30–65)
       * @param {number} zoomLevel - Map zoom level
       * @returns {Array} Perspective-corrected [lng, lat] center for zoom animation
       */
      function computePerspectiveCorrectedZoomTarget(markerPos, bearing, pitchDeg, zoomLevel) {
        try {
          var p = Math.max(0, Math.min(85, Number(pitchDeg) || 0));
          if (p < 5) return markerPos.slice(0, 2);
          var pitchRad = (p * Math.PI) / 180;
          var viewportHeightPx =
            ui && ui.mapEl && ui.mapEl.clientHeight ? ui.mapEl.clientHeight : 720;
          var offsetPx = viewportHeightPx * 0.055;
          var offsetMeters = offsetPx / Math.tan(pitchRad);
          var markerLat = markerPos[1] || 0;
          var latRad = (markerLat * Math.PI) / 180;
          var cosLat = Math.cos(latRad);
          var metersPerPixel = 40075000 / Math.pow(2, zoomLevel + 8) / Math.max(0.1, cosLat);
          var offsetDistanceMeters = offsetMeters * metersPerPixel;
          var forwardBearing = normalizeAngle(Number(bearing));
          var correctedPos = offsetPositionByBearing(
            markerPos,
            forwardBearing,
            offsetDistanceMeters
          );
          return correctedPos.slice(0, 2);
        } catch (_) {
          return markerPos.slice(0, 2);
        }
      }

      /**
       * Offsets a position along a bearing by a given distance (in meters).
       * @param {Array} pos - [lng, lat]
       * @param {number} bearingDeg - Bearing in degrees
       * @param {number} distMeters - Distance in meters
       * @returns {Array} New [lng, lat] position
       */
      function offsetPositionByBearing(pos, bearingDeg, distMeters) {
        try {
          var lng = Number(pos[0]) || 0;
          var lat = Number(pos[1]) || 0;
          var R = 6371000;
          var d = distMeters / R;
          var bearing = (Number(bearingDeg) * Math.PI) / 180;
          var lat1 = (lat * Math.PI) / 180;
          var lng1 = (lng * Math.PI) / 180;
          var lat2 = Math.asin(
            Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing)
          );
          var lng2 =
            lng1 +
            Math.atan2(
              Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
              Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
            );
          return [(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
        } catch (_) {
          return pos.slice(0, 2);
        }
      }

      /**
       * Animates zoom-in and starts playback, prefetching tiles and handling countdown.
       */
      function zoomInThenStartPlayback() {
        DBG.log('zoomInThenStartPlayback trigger');
        if (playStartTrace && playStartTrace.startedAt) {
          DBG.log('play-start stage', {
            stage: 'zoom-start',
            dtMs: Math.round(performance.now() - playStartTrace.startedAt),
          });
        }
        if (zoomOverlayTimer) {
          try {
            clearTimeout(zoomOverlayTimer);
          } catch (_) {}
          zoomOverlayTimer = null;
        }
        setPreloadOverlayText('Loading tiles…');
        try {
          // Restore terrain if it was disabled during end transition.
          if (hasTerrain && terrainTemporarilyDisabled && terrainSourceId) {
            try {
              map.setTerrain({ source: terrainSourceId, exaggeration: 1.0 });
              terrainActive = true;
              terrainTemporarilyDisabled = false;
            } catch (_) {}
          }
          var dNow = Math.max(0, Math.min(1, progress)) * totalDistance;
          var markerPos = positionAtDistance(dNow);
          var targetCenter = cameraTargetAtDistance(dNow, 0.4);
          var startBearing = targetBearingAtDistance(dNow);
          var targetPitch =
            window.FGPX && isFinite(Number(FGPX.defaultPitch)) ? Number(FGPX.defaultPitch) : 30;
          var perspectiveCorrectedCenter = computePerspectiveCorrectedZoomTarget(
            markerPos,
            startBearing,
            targetPitch,
            defaultZoom
          );
          var intendedFinalBearing = startBearing;
          syncCameraState(perspectiveCorrectedCenter, startBearing);
          startupZoomTargetState = { center: perspectiveCorrectedCenter.slice(0) };

          // STRATEGY: Prefetch tiles at target zoom for the viewport only (HTTP cache),
          // wait for fetches to complete, then start zoom animation.
          // No jumpTo — no visible flash. Only fetches the single target zoom level.
          var prefetchPromise;
          try {
            if (prefetchEnabled) {
              prefetchPromise = prefetchTilesAtTargetAsync(
                targetCenter,
                defaultZoom,
                startBearing,
                0.24
              );
            }
          } catch (_) {}
          if (!prefetchPromise) prefetchPromise = Promise.resolve();

          prefetchPromise
            .then(function () {
              setPreloadOverlayText('Finalizing startup…');
              return waitForStartupDecodeReady(2200);
            })
            .then(function (readyState) {
              DBG.log('startup decode gate', { state: readyState });
              setPreloadOverlayText('Zooming in…');
              zoomOverlayTimer = setTimeout(function () {
                hidePreloadOverlay();
                zoomOverlayTimer = null;
              }, 1200);

              // Suppress tile fade during the zoom animation so new tiles snap in instantly
              var origFadeDuration = null;
              try {
                if (map.style && typeof map.style.fadeDuration !== 'undefined') {
                  origFadeDuration = map.style.fadeDuration;
                  map.style.fadeDuration = 0;
                }
              } catch (_) {}

              // Animate to target — tiles are already in browser HTTP cache
              map.easeTo({
                center: perspectiveCorrectedCenter,
                zoom: defaultZoom,
                bearing: startBearing,
                pitch: targetPitch,
                duration: 3500,
                easing: easeInOutCubic,
              });
              map.once('moveend', function () {
                firstPlayZoomPending = false;
                if (zoomOverlayTimer) {
                  try {
                    clearTimeout(zoomOverlayTimer);
                  } catch (_) {}
                  zoomOverlayTimer = null;
                }
                try {
                  if (origFadeDuration !== null && map.style)
                    map.style.fadeDuration = origFadeDuration;
                } catch (_) {}
                DBG.log('play-start stage', {
                  stage: 'moveend-start',
                  dtMs: playStartTrace
                    ? Math.round(performance.now() - playStartTrace.startedAt)
                    : 0,
                });
                hidePreloadOverlay();
                try {
                  // Use the stored intended bearing rather than re-reading map.getBearing().
                  // map.getBearing() after easeTo can differ by a small floating-point amount
                  // from the target, causing a snap when startIdleSway() applies
                  // shortestAngleDelta on its very first RAF frame.
                  bearing = normalizeAngle(intendedFinalBearing);
                  appliedBearing = bearing;
                  targetBearingSmooth = bearing;
                  cameraCenter[0] = perspectiveCorrectedCenter[0];
                  cameraCenter[1] = perspectiveCorrectedCenter[1];
                  forceCameraUpdate = false;
                  cameraCooldown = 0;
                  cameraJumpedLastFrame = false;
                  cameraJumpStreak = 0;
                  // markerDataCooldown, progressNeedLineInit, progressLineCooldown
                  // are intentionally deferred to beginPlayback() so they do not
                  // trigger setData() repaints during the idle-wait / countdown
                  // phase, which causes MapLibre label reflow and a visible jump.
                } catch (_) {}

                // Apply playback rendering optimizations (label overlap, fade suppression)
                // BEFORE waiting for idle, so MapLibre processes them and settles.
                applyPlaybackLayerOptimizations();

                // Start sway now so bearing oscillates during idle-wait and the full countdown,
                // not just the instant before beginPlayback(). setPlaying(true) stops it cleanly.
                startIdleSway(intendedFinalBearing);

                function beginPlayback() {
                  try {
                    var _dStart = Math.max(0, Math.min(1, progress)) * totalDistance;
                    if (hasTimestamps && Array.isArray(timeOffsets)) {
                      tOffset = timeOffsetAtDistance(_dStart);
                    }
                    // Start bearing from wherever sway left the map (live value) so the
                    // playback rate-limiter can blend smoothly toward travel direction.
                    // Using intendedFinalBearing here would accumulate a delta against the
                    // map's actual bearing and trigger a jumpTo snap on frame 4 once
                    // suppressCameraUpdateFrames expires.
                    var _liveBearing = intendedFinalBearing;
                    try {
                      if (typeof map.getBearing === 'function') {
                        var _b = Number(map.getBearing());
                        if (isFinite(_b)) _liveBearing = _b;
                      }
                    } catch (_) {}
                    bearing = normalizeAngle(_liveBearing);
                    appliedBearing = bearing;
                    targetBearingSmooth = bearing;
                    forceCameraUpdate = false;
                  } catch (_) {}
                  // These resets are deferred from the moveend handler to here so
                  // setData() repaints happen only when playback is actually starting,
                  // not during idle-wait or countdown, where they cause label reflow
                  // and a visible jump.
                  markerDataCooldown = 999;
                  progressNeedLineInit = true;
                  progressLineCooldown = 999;
                  // Suppress camera jumpTo for the first few frames so playback
                  // starts from exactly where countdown/sway left the camera, with no snap.
                  suppressCameraUpdateFrames = 3;
                  setPlaying(true);
                  scheduleRaf();
                  recordPlaybackStart();
                }

                // Wait for the map to fully settle (tiles loaded, labels repositioned)
                // BEFORE showing the countdown overlay. This prevents the visible "jump"
                // that occurs when the map's render state changes at countdown start.
                function onMapSettled() {
                  if (shouldRunStartupCountdown()) {
                    var countdownSeconds = STARTUP_COUNTDOWN_SECONDS;

                    runStartupCountdown(countdownSeconds)
                      .then(function () {
                        if (
                          startupZoomTargetState &&
                          Array.isArray(startupZoomTargetState.center)
                        ) {
                          cameraCenter[0] = startupZoomTargetState.center[0];
                          cameraCenter[1] = startupZoomTargetState.center[1];
                          startupZoomTargetState = null;
                        }
                        startupSpeedRampDuration = 3.5;
                        startupSpeedRampRemaining = startupSpeedRampDuration;
                        // sway already running since moveend — if (swayActive) return guards re-entry
                        beginPlayback();
                      })
                      .catch(function () {
                        // sway already running since moveend
                        beginPlayback();
                      });
                  } else {
                    // sway already running since moveend
                    beginPlayback();
                  }
                }

                var settleTimedOut = false;
                var settleTimer = setTimeout(function () {
                  settleTimedOut = true;
                  DBG.log('map settle timeout, proceeding');
                  onMapSettled();
                }, 400);
                map.once('idle', function () {
                  if (settleTimedOut) return;
                  clearTimeout(settleTimer);
                  DBG.log('map settled via idle event');
                  onMapSettled();
                });
              });
            })
            .catch(function () {
              // Fallback: just animate and start
              firstPlayZoomPending = false;
              setPlaying(true);
              scheduleRaf();
            });
        } catch (_) {
          firstPlayZoomPending = false;
          setPlaying(true);
          scheduleRaf();
        }
      }

      /**
       * Sets the playing state (play/pause) and updates UI and animation accordingly.
       * @param {boolean} p - True to play, false to pause.
       */
      function setPlaying(p) {
        if (playing !== p) {
          DBG.log('playback state change', { playing: p });
        }
        playing = p;
        if (!playing && rafId) {
          try {
            window.cancelAnimationFrame(rafId);
          } catch (_) {}
          rafId = null;
        }
        // Idle sway: start when paused at a zoomed-in position, stop when playing
        if (playing) {
          stopIdleSway();
        } else if (!firstPlayZoomPending && progress > 0) {
          startIdleSway();
        }
        // Suppress tile fade during playback to prevent ghosting/flicker;
        // restore on pause so tile transitions look normal when idle.
        try {
          if (map.style && typeof map.style.fadeDuration !== 'undefined') {
            if (mapFadeDurationDefault == null) {
              mapFadeDurationDefault = map.style.fadeDuration;
            }
            map.style.fadeDuration = playing ? 0 : mapFadeDurationDefault;
          }
        } catch (_) {}
        // During playback: zero raster-fade-duration on all raster layers so new tiles snap in;
        // apply text-allow-overlap + text-ignore-placement on all symbol layers to prevent
        // label collision recalculation while camera is moving fast.
        // On stop/pause: restore saved values.
        // NOTE: On play-start these are already applied in the moveend handler
        // (applyPlaybackLayerOptimizations) before the countdown starts.
        // This block still runs to handle resume-after-pause and stop.
        try {
          if (!playing) {
            var _st = map.getStyle();
            var _layers = _st && _st.layers ? _st.layers : [];
            for (var _li = 0; _li < _layers.length; _li++) {
              var _lyr = _layers[_li];
              if (!_lyr || !_lyr.id) continue;
              if (!map.getLayer(_lyr.id)) continue;
              if (_lyr.type === 'raster') {
                try {
                  map.setPaintProperty(_lyr.id, 'raster-fade-duration', 300);
                } catch (_) {}
              }
              if (_lyr.type === 'symbol') {
                try {
                  map.setLayoutProperty(_lyr.id, 'text-allow-overlap', false);
                  map.setLayoutProperty(_lyr.id, 'text-ignore-placement', false);
                } catch (_) {}
              }
            }
          }
        } catch (_) {}
        try {
          var cinemaRoot = container || root;
          var cinemaEl = cinemaRoot.querySelector('.fgpx-weather-cinema');
          if (cinemaEl) {
            if (playing) cinemaEl.classList.remove('is-paused');
            else cinemaEl.classList.add('is-paused');
          }
        } catch (_) {}
        try {
          applyWeatherOverlayProfile(false);
        } catch (_) {}
        if (!playing) {
          pauseCityChunkLoadsFor(0, 'playback-stopped');
        }
        // Update button states (includes recording state)
        updateButtonStates();
        if (playing) {
          playbackStartedAtMs = Date.now();
          prefetchBackoffUntilMs = 0;
          // Reset frame timer so dt doesn't include paused duration
          lastFrame = null;
          if (zoomOverlayTimer) {
            try {
              clearTimeout(zoomOverlayTimer);
            } catch (_) {}
            zoomOverlayTimer = null;
          }
          hideSplash();
          hidePreloadOverlay();
          // CRITICAL: Reschedule RAF loop when resuming playback
          scheduleRaf();
          if (playStartTrace && playStartTrace.startedAt) {
            DBG.log('play-start stage', {
              stage: 'playing',
              dtMs: Math.round(performance.now() - playStartTrace.startedAt),
            });
            playStartTrace = null;
          }
        }
      }

      /**
       * Updates the enabled/disabled state of playback and recording buttons.
       */
      function updateButtonStates() {
        // Update button states based on current playback, preloading, and recording state
        ui.controls.btnPlay.disabled = playing || preloadingInProgress || isRecording;
        ui.controls.btnPause.disabled = !playing || isRecording;
        ui.controls.btnRestart.disabled = isRecording;
        ui.controls.btnRecord.disabled = false;
      }

      /**
       * Resets the player state to the initial position and updates all visuals.
       */
      function reset() {
        DBG.log('reset() invoked');
        stopIdleSway();
        tStart = null;
        lastFrame = null;
        bearing = null;
        playbackCountedForRun = false;
        // If end transition disabled terrain to avoid flicker, restore for next run.
        if (hasTerrain && terrainTemporarilyDisabled && terrainSourceId) {
          try {
            map.setTerrain({ source: terrainSourceId, exaggeration: 1.0 });
            terrainActive = true;
            terrainTemporarilyDisabled = false;
          } catch (_) {}
        }
        // Set initial progress/time at privacy start when enabled
        var minP = privacyEnabled ? privacyStartD / totalDistance : 0;
        progress = minP;
        if (hasTimestamps && Array.isArray(timeOffsets)) {
          try {
            var loT = 0,
              hiT = timeOffsets.length - 1;
            while (loT < hiT) {
              var midT = (loT + hiT) >>> 1;
              if (cumDist[midT] < privacyStartD) loT = midT + 1;
              else hiT = midT;
            }
            tOffset = timeOffsets[Math.max(0, loT)] || 0;
          } catch (_) {
            tOffset = 0;
          }
        } else {
          tOffset = 0;
        }
        cameraCenter = privacyEnabled
          ? positionAtDistance(privacyStartD).slice(0, 2)
          : coords[0].slice(0, 2);
        chartCooldown = 0;
        forceCameraUpdate = true;
        cameraCooldown = 0;
        appliedBearing = null;
        dayNightOverlayState = null;
        progressLineCooldown = 0;
        progressLastDistance = privacyEnabled ? privacyStartD : 0;
        progressNeedLineInit = true;
        progressLineVisible = null;
        startupSpeedRampRemaining = 0;
        startupSpeedRampDuration = 0;
        markerLayerVisible = null;
        lastMarkerPx = null;
        lastMarkerDistance = null;
        markerDataCooldown = 0;
        segmentLengthCache = [];
        segmentTipCache = [];
        segmentColorCache = [];
        progressArrowsCooldown = 0;
        cameraJumpedLastFrame = false;
        cameraJumpStreak = 0;
        dbgMarkerSetDataCount = 0;
        dbgProgressSetDataCount = 0;
        dbgSegmentSetDataCount = 0;
        dbgCameraJumpCount = 0;
        cleanupProgressiveSegments();
        updateVisuals(progress);
        setProgressBar(progress);
        if (chart) {
          chart.update('none');
        }
        fitMapToBounds(0);
        firstPlayZoomPending = true;
        // Reset photo triggers
        try {
          shownPhotoKeys.clear();
          photoQueue.length = 0;
          overlayActive = false;
          currentDisplayedPhoto = null;
          if (photosByTime && hasTimestamps && Array.isArray(timeOffsets)) {
            var distNow0 = progress * totalDistance;
            var lo2p = 0,
              hi2p = timeOffsets.length - 1;
            while (lo2p < hi2p) {
              var mid2p = (lo2p + hi2p) >>> 1;
              if (cumDist[mid2p] < distNow0) lo2p = mid2p + 1;
              else hi2p = mid2p;
            }
            var currentSec0 = timeOffsets[Math.max(0, lo2p)] || 0;
            // advance pointer to first photo >= currentSec0
            if (photosByTime) {
              var l = 0,
                h = photosByTime.length;
              while (l < h) {
                var m = (l + h) >>> 1;
                if (photosByTime[m].pSec < currentSec0) l = m + 1;
                else h = m;
              }
              photoPtr = l;
            }
            lastPlaybackSec = currentSec0;
          } else {
            lastPlaybackSec = null;
          }
          lastPlaybackDist = progress * totalDistance;
          // Reset distance pointer to current distance
          try {
            if (Array.isArray(photosByDist) && photosByDist.length > 0) {
              var dNow0 = progress * totalDistance;
              var loPd = 0,
                hiPd = photosByDist.length;
              while (loPd < hiPd) {
                var midPd = (loPd + hiPd) >>> 1;
                if (photosByDist[midPd].pDist < dNow0) loPd = midPd + 1;
                else hiPd = midPd;
              }
              photoDistPtr = loPd;
            }
          } catch (_) {}
          syncMediaDisplayOrder(true);
        } catch (_) {}
      }

      /**
       * Sets the progress bar width based on playback progress.
       * @param {number} p - Progress (0..1).
       */
      function setProgressBar(p) {
        if (privacyEnabled) {
          var d = Math.max(0, Math.min(1, p)) * totalDistance;
          var span = Math.max(1e-6, privacyEndD - privacyStartD);
          var frac = Math.max(0, Math.min(1, (d - privacyStartD) / span));
          ui.controls.progressBar.style.width = frac * 100 + '%';
        } else {
          ui.controls.progressBar.style.width = Math.max(0, Math.min(100, p * 100)) + '%';
        }
      }

      /**
       * Calculates the bounding box from an array of coordinates.
       * @param {Array} cs - Array of [lng, lat] coordinates.
       * @returns {Array} Bounding box [[minLon, minLat], [maxLon, maxLat]].
       */
      function boundsFromCoords(cs) {
        var minLon = 180,
          minLat = 90,
          maxLon = -180,
          maxLat = -90;
        for (var i = 0; i < cs.length; i++) {
          var c = cs[i];
          if (c[0] < minLon) minLon = c[0];
          if (c[0] > maxLon) maxLon = c[0];
          if (c[1] < minLat) minLat = c[1];
          if (c[1] > maxLat) maxLat = c[1];
        }
        return [
          [minLon, minLat],
          [maxLon, maxLat],
        ];
      }

      // removed duplicate positionAtDistance (defined earlier)

      // Smooth a polyline using Catmull–Rom splines to reduce abrupt angles
      /**
       * Smooths a polyline using Catmull–Rom splines.
       * @param {Array} points - Array of [lng, lat] points.
       * @param {number} samplesPerSegment - Number of samples per segment.
       * @returns {Array} Smoothed array of points.
       */
      function smoothPolyline(points, samplesPerSegment) {
        try {
          var n = Array.isArray(points) ? points.length : 0;
          if (n < 3) {
            return points.map(function (p) {
              return [p[0], p[1]];
            });
          }
          var sps = Math.max(0, Math.min(6, samplesPerSegment || 2));
          var out = [];
          for (var i = 0; i < n - 1; i++) {
            var p0 = i > 0 ? points[i - 1] : points[i];
            var p1 = points[i];
            var p2 = points[i + 1];
            var p3 = i + 2 < n ? points[i + 2] : points[i + 1];
            out.push([p1[0], p1[1]]);
            if (sps > 0) {
              for (var s = 1; s <= sps; s++) {
                var t = s / (sps + 1);
                var t2 = t * t;
                var t3 = t2 * t;
                var x =
                  0.5 *
                  (2 * p1[0] +
                    (-p0[0] + p2[0]) * t +
                    (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
                    (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
                var y =
                  0.5 *
                  (2 * p1[1] +
                    (-p0[1] + p2[1]) * t +
                    (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
                    (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
                out.push([x, y]);
              }
            }
          }
          out.push(points[n - 1].slice(0, 2));
          if (out.length > 2000) {
            var step = Math.ceil(out.length / 2000);
            var ds = [];
            for (var k = 0; k < out.length; k += step) {
              ds.push(out[k]);
            }
            var last = out[out.length - 1];
            var lastDS = ds[ds.length - 1];
            if (!lastDS || lastDS[0] !== last[0] || lastDS[1] !== last[1]) {
              ds.push(last);
            }
            return ds;
          }
          return out;
        } catch (_) {
          return points;
        }
      }

      /**
       * Converts a bearing in degrees to a cardinal direction string.
       * @param {number} deg - Bearing in degrees.
       * @returns {string} Cardinal direction.
       */
      function bearingToCardinal(deg) {
        try {
          var dirs = [
            'N',
            'NNE',
            'NE',
            'ENE',
            'E',
            'ESE',
            'SE',
            'SSE',
            'S',
            'SSW',
            'SW',
            'WSW',
            'W',
            'WNW',
            'NW',
            'NNW',
          ];
          var idx = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
          return dirs[idx];
        } catch (_) {
          return 'N';
        }
      }

      function gradeAtIndex(index) {
        if (!Array.isArray(coords) || coords.length < 2) return 0;
        if (!Array.isArray(cumDist) || cumDist.length !== coords.length) return 0;

        var idx = Math.max(0, Math.min(coords.length - 1, Number(index) || 0));
        var fromIdx = Math.max(0, idx - 3);
        var toIdx = Math.min(coords.length - 1, idx + 3);
        if (toIdx <= fromIdx) return 0;

        var elevFrom = Number(coords[fromIdx] && coords[fromIdx][2]);
        var elevTo = Number(coords[toIdx] && coords[toIdx][2]);
        if (!isFinite(elevFrom) || !isFinite(elevTo)) return 0;

        var distFrom = Number(cumDist[fromIdx]);
        var distTo = Number(cumDist[toIdx]);
        if (!isFinite(distFrom) || !isFinite(distTo)) return 0;

        var distDiff = distTo - distFrom;
        if (distDiff <= 0.5) return 0;

        return ((elevTo - elevFrom) / distDiff) * 100;
      }

      /**
       * Returns playback cadence parameters based on speed, terrain, and tab.
       * @param {number} speedMul - Speed multiplier.
       * @param {boolean} terrainOn - Whether terrain is enabled.
       * @param {string} tabName - Current tab name.
       * @returns {Object} Cadence parameters.
       */
      function getPlaybackCadence(speedMul, terrainOn, tabName) {
        var tier =
          speedMul >= VERY_HIGH_SPEED_CADENCE_MULTIPLIER
            ? 2
            : speedMul >= HIGH_SPEED_CADENCE_MULTIPLIER
              ? 1
              : 0;
        var progressIntervals = terrainOn ? [0.12, 0.14, 0.16] : [0.08, 0.09, 0.11];
        var progressDistances = terrainOn ? [9, 11, 14] : [6, 7, 9];
        var markerPxThresholds = terrainOn ? [0.3, 0.36, 0.42] : [0.24, 0.3, 0.36];
        var markerMaxIntervals = terrainOn ? [0.055, 0.05, 0.045] : [0.07, 0.06, 0.05];
        var markerDistanceThresholds = terrainOn ? [1.8, 2.4, 3.0] : [1.2, 1.6, 2.2];
        var arrowsIntervals = terrainOn ? [0.32, 0.36, 0.42] : [0.26, 0.3, 0.36];
        var chartIntervals = [0.12, 0.16, 0.2];
        var hudIntervals = [0.05, 0.07, 0.1];
        var photoIntervals = [0.12, 0.2, 0.28];
        var cameraMoveThresholds = terrainOn ? [1.35, 1.55, 1.8] : [0.6, 0.7, 0.8];
        var cameraRotateThresholds = terrainOn ? [1.1, 1.3, 1.5] : [0.35, 0.45, 0.55];
        var cameraIntervals = terrainOn ? [0.045, 0.055, 0.065] : [0.02, 0.025, 0.03];

        var chartInterval = chartIntervals[tier];
        var progressInterval = progressIntervals[tier];
        var cameraMoveThreshold = cameraMoveThresholds[tier];
        var cameraRotateThreshold = cameraRotateThresholds[tier];
        var cameraInterval = cameraIntervals[tier];

        if (tabName === 'media' || tabName === 'weatheroverview') {
          chartInterval = Math.max(chartInterval, 0.24);
        }

        // In Simulation at high speed, reduce map write pressure (jumpTo + setData frequency).
        if (tabName === 'weathergrade' && speedMul >= HIGH_SPEED_CADENCE_MULTIPLIER) {
          progressInterval = Math.max(progressInterval, terrainOn ? 0.2 : 0.16);
          cameraInterval = Math.max(cameraInterval, terrainOn ? 0.14 : 0.1);
          cameraMoveThreshold *= terrainOn ? 2.2 : 1.8;
          cameraRotateThreshold *= terrainOn ? 2.0 : 1.6;
          chartInterval = Math.max(chartInterval, 0.22);
        }

        return {
          progressInterval: progressInterval,
          progressDistance: progressDistances[tier],
          markerPxThreshold: markerPxThresholds[tier],
          markerMaxInterval: markerMaxIntervals[tier],
          markerDistanceThreshold: markerDistanceThresholds[tier],
          arrowsInterval: arrowsIntervals[tier],
          chartInterval: chartInterval,
          hudInterval: hudIntervals[tier],
          photoScanInterval: photoIntervals[tier],
          cameraMoveThreshold: cameraMoveThreshold,
          cameraRotateThreshold: cameraRotateThreshold,
          cameraInterval: cameraInterval,
        };
      }

      /**
       * Updates all visuals (marker, camera, overlays, chart, HUD) for the current playback progress.
       * @param {number} p - Playback progress (0..1).
       * @param {Object} cadence - Playback cadence parameters.
       */
      function updateVisuals(p, cadence) {
        // Clamp progress to privacy window if enabled
        if (privacyEnabled) {
          var dMin = privacyStartD;
          var dMax = privacyEndD;
          var dNow = p * totalDistance;
          if (dNow < dMin) {
            p = dMin / totalDistance;
          }
          if (dNow > dMax) {
            p = dMax / totalDistance;
          }
        }
        var d = p * totalDistance;
        var pos = positionAtDistance(d);
        cadence = cadence || getPlaybackCadence(speed, hasTerrain, currentChartTab);

        // Check if marker should be visible based on chart zoom
        var markerVisible = true;
        if (chart && chart.chartZoomState && chart.chartZoomState.zoomedRange) {
          var zoomRange = chart.chartZoomState.zoomedRange;
          var currentValue;

          // Determine current value based on chart type (distance or time)
          if (useTime && Array.isArray(timeOffsets)) {
            var timeIdx = Math.floor(p * (timeOffsets.length - 1));
            currentValue = timeOffsets[timeIdx] || 0;
          } else {
            currentValue = d / 1000; // Convert to km for distance chart
          }

          // Hide marker if outside zoomed range
          markerVisible = currentValue >= zoomRange.min && currentValue <= zoomRange.max;
        }

        // update marker and remember position for seek camera snap
        var src = map.getSource('fgpx-point');
        if (src) {
          if (markerVisible) {
            var markerNeedsDataUpdate = markerLayerVisible !== 'visible' || !lastMarkerPx;
            var markerDistScale = speed >= 80 ? 3.0 : speed >= 40 ? 2.2 : 1.0;
            var markerDistThreshold = cadence.markerDistanceThreshold * markerDistScale;
            var markerDistDelta =
              lastMarkerDistance == null ? Infinity : Math.abs(d - lastMarkerDistance);
            if (!markerNeedsDataUpdate) {
              markerNeedsDataUpdate =
                markerDistDelta >= markerDistThreshold ||
                markerDataCooldown >= cadence.markerMaxInterval;
            }
            if (!markerNeedsDataUpdate) {
              try {
                var markerPxNow = typeof map.project === 'function' ? map.project(pos) : null;
                if (markerPxNow && lastMarkerPx) {
                  var markerMovePx = Math.hypot(
                    markerPxNow.x - lastMarkerPx.x,
                    markerPxNow.y - lastMarkerPx.y
                  );
                  markerNeedsDataUpdate = markerMovePx >= cadence.markerPxThreshold;
                } else {
                  markerNeedsDataUpdate = true;
                }
                if (markerNeedsDataUpdate && markerPxNow) {
                  lastMarkerPx = markerPxNow;
                }
              } catch (_) {
                markerNeedsDataUpdate = true;
                lastMarkerPx = null;
              }
            }
            if (markerNeedsDataUpdate || markerLayerVisible !== 'visible') {
              pointData.features[0].geometry.coordinates = pos;
              src.setData(pointData);
              lastMarkerDistance = d;
              markerDataCooldown = 0;
              dbgMarkerSetDataCount++;
            }
            // Ensure marker layer is visible
            if (map.getLayer('fgpx-point') && markerLayerVisible !== 'visible') {
              map.setLayoutProperty('fgpx-point', 'visibility', 'visible');
              markerLayerVisible = 'visible';
            }
          } else {
            // Hide marker by making it invisible
            if (map.getLayer('fgpx-point') && markerLayerVisible !== 'none') {
              map.setLayoutProperty('fgpx-point', 'visibility', 'none');
              markerLayerVisible = 'none';
            }
          }
        }
        currentPosLngLat = pos;

        // Day/night overlay update — sets static fill-opacity via setPaintProperty.
        // MapLibre's fill-opacity-transition handles smooth fading.
        // Layer visibility is controlled solely by the toggle button.
        if (window.FGPX && FGPX.daynightMapEnabled) {
          try {
            if (
              Array.isArray(timeOffsets) &&
              dayNightPeriods &&
              dayNightPeriods.length > 0 &&
              map.getLayer('fgpx-daynight-overlay')
            ) {
              // Use distance-based binary search to find current time offset (matches chart cursor)
              var dnLo = 0,
                dnHi = cumDist.length - 1;
              while (dnLo < dnHi) {
                var dnMid = (dnLo + dnHi) >>> 1;
                if (cumDist[dnMid] < d) dnLo = dnMid + 1;
                else dnHi = dnMid;
              }
              var currentTimeOffset = timeOffsets[Math.max(0, dnLo)] || 0;

              // Determine if we are in a night period
              var sortedPeriods =
                dayNightPeriodsSorted && dayNightPeriodsSorted.length > 0
                  ? dayNightPeriodsSorted
                  : dayNightPeriods;
              var isInNightPeriod = false;
              var firstPeriod = sortedPeriods[0];

              if (currentTimeOffset < firstPeriod.timeOffset) {
                isInNightPeriod =
                  firstPeriod.type === 'sunrise' || firstPeriod.type === 'nightStart';
              } else {
                var lastTransition = null;
                var trLo = 0;
                var trHi = sortedPeriods.length - 1;
                while (trLo <= trHi) {
                  var trMid = (trLo + trHi) >>> 1;
                  if (sortedPeriods[trMid].timeOffset <= currentTimeOffset) {
                    lastTransition = sortedPeriods[trMid];
                    trLo = trMid + 1;
                  } else {
                    trHi = trMid - 1;
                  }
                }
                if (lastTransition) {
                  isInNightPeriod =
                    lastTransition.type === 'sunset' || lastTransition.type === 'nightStart';
                }
              }

              var nightOpacity = isInNightPeriod ? 1 : 0;

              // Update paint property when state changes — transition handles smooth fade
              if (dayNightOverlayState !== nightOpacity) {
                DBG.log(
                  'Day/night state changed:',
                  dayNightOverlayState,
                  '->',
                  nightOpacity,
                  'at offset:',
                  currentTimeOffset
                );
                var targetOpacity = parseFloat(window.FGPX.daynightMapOpacity) || 0.4;
                // On seek (null state), apply instantly without transition
                if (dayNightOverlayState === null) {
                  map.setPaintProperty('fgpx-daynight-overlay', 'fill-opacity-transition', {
                    duration: 0,
                    delay: 0,
                  });
                  map.setPaintProperty(
                    'fgpx-daynight-overlay',
                    'fill-opacity',
                    nightOpacity === 1 ? targetOpacity : 0
                  );
                  // Restore transition after map settles (avoids double-repaint with setTimeout)
                  map.once('idle', function () {
                    try {
                      map.setPaintProperty('fgpx-daynight-overlay', 'fill-opacity-transition', {
                        duration: 2000,
                        delay: 0,
                      });
                    } catch (_) {}
                  });
                } else {
                  map.setPaintProperty(
                    'fgpx-daynight-overlay',
                    'fill-opacity',
                    nightOpacity === 1 ? targetOpacity : 0
                  );
                }
                dayNightOverlayState = nightOpacity;
              }
            }
          } catch (e) {
            DBG.warn('Day/night overlay error:', e);
          }
        }

        // update progressive route up to current position
        var routeProgSrc = map.getSource('fgpx-route-progress');
        if (routeProgSrc) {
          // Keep progress cadence synchronized with camera/marker cadence.
          var progressDistThreshold = cadence.progressDistance;
          if (hasTerrain && speed >= 80) {
            progressDistThreshold = cadence.progressDistance * 2.0;
          } else if (hasTerrain && speed >= 40) {
            progressDistThreshold = cadence.progressDistance * 1.6;
          }
          // Removed progressDeferredByCamera: deferring route progress when camera jumps
          // causes irregular update patterns and visible stuttering at higher speeds.
          // MapLibre handles concurrent setData + jumpTo within the same frame correctly.
          var progressInterval = cadence.progressInterval;
          var needUpdate =
            progressNeedLineInit ||
            progressLineCooldown >= progressInterval ||
            Math.abs(d - progressLastDistance) >= progressDistThreshold;
          if (needUpdate) {
            var lo = 0,
              hi = cumDist.length - 1;
            while (lo < hi) {
              var mid = (lo + hi) >>> 1;
              if (cumDist[mid] < d) lo = mid + 1;
              else hi = mid;
            }
            var i = Math.max(1, lo);
            var startD = privacyEnabled ? privacyStartD : 0;
            // find start index for privacy window
            var loS = 0,
              hiS = cumDist.length - 1;
            while (loS < hiS) {
              var midS = (loS + hiS) >>> 1;
              if (cumDist[midS] < startD) loS = midS + 1;
              else hiS = midS;
            }
            var startIdx = privacyEnabled ? Math.max(1, loS) : 1;

            // Build coords slice from raw coords (1:1 indexing — no pre-smoothing).
            // Backend RDP simplification + 4px line + line-blur:0.3 give visually smooth result.
            var coordsUpTo = [];
            for (var ci = startIdx; ci < i; ci++) {
              coordsUpTo.push([coords[ci][0], coords[ci][1]]);
            }
            // ensure the first point is exactly at the privacy start when enabled
            if (privacyEnabled) {
              var pStart = positionAtDistance(privacyStartD);
              coordsUpTo.unshift([pStart[0], pStart[1]]);
            }
            // Append interpolated tip at exact current distance
            var d0 = cumDist[i - 1],
              d1 = cumDist[i] || d0;
            var t = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
            var p0 = coords[i - 1],
              p1 = coords[i] || coords[i - 1];
            var interp = [lerp(p0[0], p1[0], t), lerp(p0[1], p1[1], t)];
            coordsUpTo.push(interp);

            // Create elevation-colored segments or single route
            // When privacy prepends a synthetic point, offset the gradient index by 1
            var segStartIdx = privacyEnabled ? Math.max(0, startIdx - 1) : startIdx;
            var segments = createProgressiveSegments(coordsUpTo, segStartIdx);
            if (segments && segments.length > 0 && segmentPoolReady) {
              // Always update the base progress line as a "floor" underneath colored segments.
              // This ensures previously-traversed track remains visible even when later segments
              // with different gradient buckets render on top (e.g. figure-8 patterns).
              progressData.geometry.coordinates = coordsUpTo;
              routeProgSrc.setData(progressData);
              dbgProgressSetDataCount++;
              // When arrows are enabled, throttle arrow symbol layout updates separately.
              if (arrowsEnabled) {
                progressArrowsCooldown += lastFrameDt || 0.016;
                if (progressArrowsCooldown >= cadence.arrowsInterval || progressNeedLineInit) {
                  progressArrowsCooldown = 0;
                }
              }

              // Update pre-allocated segment pool (no add/remove — only setData + paint).
              // Skip setData on slots where the coord count hasn't changed (only the growing
              // tip segment changes most frames; static earlier segments stay stable).
              var usedCount = Math.min(segments.length, SEGMENT_POOL_SIZE);
              for (var segIdx = 0; segIdx < usedCount; segIdx++) {
                var segment = segments[segIdx];
                var segmentColor =
                  segment.gradeBucket > 0
                    ? blendHex(progressiveBaseColor, progressiveSteepColor, segment.gradeBucket)
                    : progressiveBaseColor;

                // Diff: update if coord count changed OR if tip moved.
                // This avoids stuck/stutter when only the segment endpoint advances.
                var prevLen = segmentLengthCache[segIdx] || 0;
                var tipCoord =
                  segment.coordinates.length > 0
                    ? segment.coordinates[segment.coordinates.length - 1]
                    : null;
                var prevTip = segmentTipCache[segIdx] || null;
                var tipMoved = false;
                if (tipCoord && prevTip) {
                  tipMoved =
                    Math.abs(tipCoord[0] - prevTip[0]) > 1e-7 ||
                    Math.abs(tipCoord[1] - prevTip[1]) > 1e-7;
                } else if (!!tipCoord !== !!prevTip) {
                  tipMoved = true;
                }
                if (segment.coordinates.length !== prevLen || tipMoved) {
                  var segmentData = {
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: segment.coordinates },
                  };
                  var segSrc = map.getSource('fgpx-progress-segment-' + segIdx);
                  if (segSrc) segSrc.setData(segmentData);
                  dbgSegmentSetDataCount++;
                  segmentLengthCache[segIdx] = segment.coordinates.length;
                  segmentTipCache[segIdx] = tipCoord ? [tipCoord[0], tipCoord[1]] : null;
                }
                // Update color only if local cache changed.
                if (segmentColorCache[segIdx] !== segmentColor) {
                  try {
                    map.setPaintProperty(
                      'fgpx-progress-segment-' + segIdx,
                      'line-color',
                      segmentColor
                    );
                  } catch (_) {}
                  segmentColorCache[segIdx] = segmentColor;
                }
              }

              // Clear unused pool slots with empty data (only if previously populated)
              for (var emptyIdx = usedCount; emptyIdx < SEGMENT_POOL_SIZE; emptyIdx++) {
                if ((segmentLengthCache[emptyIdx] || 0) > 0) {
                  var emptySrc = map.getSource('fgpx-progress-segment-' + emptyIdx);
                  if (emptySrc) emptySrc.setData(emptyFeatureCollection);
                  dbgSegmentSetDataCount++;
                  segmentLengthCache[emptyIdx] = 0;
                  segmentTipCache[emptyIdx] = null;
                  segmentColorCache[emptyIdx] = null;
                }
              }

              // Update segment tracking
              progressSegments = [];
              for (var trackIdx = 0; trackIdx < usedCount; trackIdx++) {
                progressSegments.push(trackIdx);
              }
            } else {
              // Use single-color progressive route — clear pool slots
              if (segmentPoolReady) {
                for (var cleanIdx = 0; cleanIdx < SEGMENT_POOL_SIZE; cleanIdx++) {
                  if ((segmentLengthCache[cleanIdx] || 0) > 0) {
                    var clSrc = map.getSource('fgpx-progress-segment-' + cleanIdx);
                    if (clSrc) clSrc.setData(emptyFeatureCollection);
                    dbgSegmentSetDataCount++;
                    segmentLengthCache[cleanIdx] = 0;
                    segmentTipCache[cleanIdx] = null;
                    segmentColorCache[cleanIdx] = null;
                  }
                }
              }
              progressSegments = [];

              if (!cameraJumpedLastFrame || progressNeedLineInit) {
                progressData.geometry.coordinates = coordsUpTo;
                routeProgSrc.setData(progressData);
                dbgProgressSetDataCount++;
              }
              // Show single-color line (only toggle once)
              if (progressLineVisible !== true) {
                try {
                  map.setLayoutProperty('fgpx-route-progress-line', 'visibility', 'visible');
                } catch (_) {}
                progressLineVisible = true;
              }
            }

            progressLineCooldown = 0;
            progressLastDistance = d;
            progressNeedLineInit = false;
          }
        }
        // update camera bearing aimed forward with smoothing and turn-rate clamp
        cameraJumpedThisFrame = false; // reset per-frame flag
        {
          var dMaxAhead = privacyEnabled ? privacyEndD : totalDistance;
          var remainingAhead = Math.max(0, dMaxAhead - d);
          var targetBearing = bearing != null ? bearing : 0;
          // In the last meters, keep heading stable to avoid a final-frame bearing snap.
          if (remainingAhead > 8) {
            // Use farther lookahead points weighted toward the distance for cinematic smoothness.
            // This makes the camera anticipate turns rather than react to them.
            var ahead40 = positionAtDistance(Math.min(dMaxAhead, d + 40));
            var ahead80 = positionAtDistance(Math.min(dMaxAhead, d + 80));
            var ahead150 = positionAtDistance(Math.min(dMaxAhead, d + 150));
            var ahead250 = positionAtDistance(Math.min(dMaxAhead, d + 250));
            var b40 = bearingBetween(pos, ahead40);
            var b80 = bearingBetween(pos, ahead80);
            var b150 = bearingBetween(pos, ahead150);
            var b250 = bearingBetween(pos, ahead250);
            // Weighted circular mean: favor farther points for smoother anticipation
            var w40 = 0.2,
              w80 = 0.3,
              w150 = 0.3,
              w250 = 0.2;
            var rad40 = (b40 * Math.PI) / 180,
              rad80 = (b80 * Math.PI) / 180;
            var rad150 = (b150 * Math.PI) / 180,
              rad250 = (b250 * Math.PI) / 180;
            var vx =
              Math.cos(rad40) * w40 +
              Math.cos(rad80) * w80 +
              Math.cos(rad150) * w150 +
              Math.cos(rad250) * w250;
            var vy =
              Math.sin(rad40) * w40 +
              Math.sin(rad80) * w80 +
              Math.sin(rad150) * w150 +
              Math.sin(rad250) * w250;
            targetBearing = (Math.atan2(vy, vx) * 180) / Math.PI;
            targetBearing = normalizeAngle(targetBearing);
          }
          // Temporal smoothing on target bearing — low alpha for cinematic gentle turns.
          // Camera heading changes feel fluid rather than reactive.
          if (targetBearingSmooth == null) {
            targetBearingSmooth = targetBearing;
          } else {
            var deltaTB = shortestAngleDelta(targetBearingSmooth, targetBearing);
            var bearingAlpha = hasTerrain ? 0.06 : 0.1;
            targetBearingSmooth = normalizeAngle(targetBearingSmooth + deltaTB * bearingAlpha);
          }
          targetBearing = targetBearingSmooth;
          if (bearing == null) bearing = targetBearing;
          var delta = shortestAngleDelta(bearing, targetBearing);
          // Adaptive max turn rate (deg/s) — lower values produce gentler, more cinematic pans
          var pitchNow = 0;
          try {
            if (typeof map.getPitch === 'function') pitchNow = map.getPitch();
          } catch (_) {}
          var zoomNow = defaultZoom;
          try {
            if (typeof map.getZoom === 'function') zoomNow = map.getZoom();
          } catch (_) {}
          var pitchFactor = 1 - Math.min(1, pitchNow / 60) * 0.35; // up to -35%
          var zoomFactor = 1 - Math.min(1, Math.max(0, (zoomNow - 10) / 8)) * 0.2; // up to -20%
          var maxTurnRate = (hasTerrain ? 7 : 9) * pitchFactor * zoomFactor;
          // During startup ramp, damp turn-rate so sharp initial GPS turns don't whip the camera.
          if (startupSpeedRampRemaining > 0 && startupSpeedRampDuration > 0) {
            var startupProgress = 1 - startupSpeedRampRemaining / startupSpeedRampDuration;
            var startupTurnFactor = 0.3 + 0.7 * Math.max(0, Math.min(1, startupProgress));
            maxTurnRate *= startupTurnFactor;
          }
          var stepLimit = maxTurnRate * Math.max(0.01, Math.min(0.06, lastFrameDt || 0.016));
          var step = Math.max(-stepLimit, Math.min(stepLimit, delta));
          // Always apply the rate-limited step — the step itself is already bounded by
          // maxTurnRate*dt so additional gating causes accumulate-then-snap stutter.
          bearing = normalizeAngle(bearing + step);
          // Cinematic camera: track a point AHEAD of current position so the camera
          // shows where the rider is going, not where they are. This creates an elastic
          // trailing effect — the camera smoothly anticipates rather than chases.
          var lookaheadFactor = 0.4;
          var cameraLookaheadD = Math.min(remainingAhead * lookaheadFactor, hasTerrain ? 35 : 50);
          var cameraTarget =
            cameraLookaheadD > 2
              ? positionAtDistance(Math.min(dMaxAhead, d + cameraLookaheadD))
              : pos;
          var followAlpha = Math.max(0.006, Math.min(0.028, (lastFrameDt || 0.016) * 0.45));
          var nextCenterLng = cameraCenter[0] + (cameraTarget[0] - cameraCenter[0]) * followAlpha;
          var nextCenterLat = cameraCenter[1] + (cameraTarget[1] - cameraCenter[1]) * followAlpha;
          // Ease terrain pitch down near the end to reduce final-frame mesh churn
          var nextPitch = null;
          if (hasTerrain && remainingAhead < 120) {
            var endPitchFactor = Math.max(0, Math.min(1, remainingAhead / 120));
            var defaultPitchNow =
              window.FGPX && isFinite(Number(FGPX.defaultPitch)) ? Number(FGPX.defaultPitch) : 30;
            nextPitch = Math.max(0, defaultPitchNow * endPitchFactor);
          }
          // Calculate on-screen movement to avoid unnecessary repaints
          var prevPx = map.project(cameraCenter);
          var nextPx = map.project([nextCenterLng, nextCenterLat]);
          var movePx = Math.hypot(nextPx.x - prevPx.x, nextPx.y - prevPx.y);
          var bearingDeltaAbs = Math.abs(
            shortestAngleDelta(appliedBearing == null ? bearing : appliedBearing, bearing)
          );
          // Balanced thresholds + hysteresis to reduce jumpTo bursts and terrain shimmer.
          var moveThresholdPx = cadence.cameraMoveThreshold;
          var rotateThresholdDeg = cadence.cameraRotateThreshold;
          var cameraInterval = cadence.cameraInterval;
          var streakBoost = Math.min(0.2, cameraJumpStreak * 0.06);
          var hysteresisFactor = cameraJumpedLastFrame ? Math.min(1.3, 1.1 + streakBoost) : 1.0;
          var moveGate = moveThresholdPx * hysteresisFactor;
          var rotateGate = rotateThresholdDeg * hysteresisFactor;
          var needCameraUpdate =
            forceCameraUpdate ||
            cameraCooldown >= cameraInterval ||
            movePx > moveGate * 2.0 ||
            bearingDeltaAbs > rotateGate * 2.0;
          // When position is nearly stationary, lower rotate gate so small heading
          // changes still produce smooth rotation rather than accumulate-then-snap.
          var effectiveRotateGate = movePx < 0.5 ? rotateGate * 0.3 : rotateGate;
          // Phase 3: Suppress camera writes for a few frames after countdown→playback handoff
          if (suppressCameraUpdateFrames > 0) {
            suppressCameraUpdateFrames--;
            forceCameraUpdate = false;
            cameraCooldown = 0;
          } else if (
            !userInteracting &&
            needCameraUpdate &&
            (movePx > moveGate || bearingDeltaAbs > effectiveRotateGate || forceCameraUpdate)
          ) {
            cameraCenter[0] = nextCenterLng;
            cameraCenter[1] = nextCenterLat;
            var camOpts = { center: cameraCenter, bearing: bearing };
            if (nextPitch != null) camOpts.pitch = nextPitch;
            // Playback follow loop uses immediate camera writes so the camera
            // stays phase-locked with marker updates at high speed.
            if (map && typeof map.jumpTo === 'function') {
              map.jumpTo(camOpts);
            } else if (map && typeof map.setCenter === 'function') {
              map.setCenter(cameraCenter);
              if (typeof map.setBearing === 'function' && isFinite(bearing))
                map.setBearing(bearing);
              if (nextPitch != null && typeof map.setPitch === 'function') map.setPitch(nextPitch);
            }
            appliedBearing = bearing;
            forceCameraUpdate = false;
            cameraCooldown = 0;
            cameraJumpedThisFrame = true; // signal to defer progress line setData
            dbgCameraJumpCount++;
            // Dynamic edge prefetch at ~5–10 Hz; widen margin/zoom during larger rotations
            if (prefetchEnabled) {
              var nowPrefetchMs = Date.now();
              var inPlaybackWarmup =
                playbackStartedAtMs > 0 && nowPrefetchMs - playbackStartedAtMs < 8000;
              if (prefetchBackoffUntilMs > nowPrefetchMs || inPlaybackWarmup) {
                // Skip expensive prefetch during initial playback warmup or temporary backoff.
              } else {
                vpLastPrefetch += lastFrameDt || 0.016;
                var extra = bearingDeltaAbs > 1.0;
                var terrainPrefetchInterval = extra ? 0.24 : 0.34;
                var flatPrefetchInterval = extra ? 0.1 : 0.18;
                if (!extra) {
                  var zoomDelta = 0;
                  try {
                    zoomDelta = Math.abs((map.getZoom ? map.getZoom() : defaultZoom) - zoomNow);
                  } catch (_) {
                    zoomDelta = 0;
                  }
                  if (zoomDelta < 0.05) {
                    terrainPrefetchInterval = 0.5;
                    flatPrefetchInterval = 0.5;
                  }
                }
                var prefetchInterval = hasTerrain ? terrainPrefetchInterval : flatPrefetchInterval;
                if (vpLastPrefetch >= prefetchInterval) {
                  // Widen bearing margin: prefetch with bearing + 15° lookahead to cover
                  // tiles that upcoming bearing changes will expose (reduces terrain flickering).
                  var prefetchBearing = bearing;
                  if (targetBearingSmooth != null) {
                    var bearingLookahead = shortestAngleDelta(bearing, targetBearingSmooth) * 0.5;
                    prefetchBearing = normalizeAngle(
                      bearing +
                        bearingLookahead +
                        (bearingDeltaAbs > 0.5 ? Math.sign(bearingLookahead) * 15 : 0)
                    );
                  }
                  prefetchViewportTiles(
                    extra ? (hasTerrain ? 0.25 : 0.35) : hasTerrain ? 0.2 : 0.25,
                    hasTerrain ? false : extra,
                    prefetchBearing
                  );
                  vpLastPrefetch = 0;
                }
                // Forward-direction prefetch along the route (~1 Hz): warms tiles 500-1000m ahead
                // at current zoom + 1 so high-speed playback sees sharp tiles instead of stretched parents.
                forwardPrefetchCooldown += lastFrameDt || 0.016;
                if (forwardPrefetchCooldown >= 1.0) {
                  forwardPrefetchCooldown = 0;
                  try {
                    prefetchForwardRoute(d, speed);
                  } catch (_) {}
                }
                if (typeof map.setPrefetchZoomDelta === 'function') {
                  map.setPrefetchZoomDelta(extra ? (hasTerrain ? 5 : 5) : hasTerrain ? 4 : 4);
                }
              }
            }
          }
        }
        if (cameraJumpedThisFrame) {
          cameraJumpStreak = Math.min(6, cameraJumpStreak + 1);
        } else {
          cameraJumpStreak = 0;
        }
        cameraJumpedLastFrame = cameraJumpedThisFrame;
        // update chart cursor
        if (useTime && Array.isArray(timeOffsets)) {
          var seriesX = Array.isArray(movingTimeOffsets) ? movingTimeOffsets : timeOffsets;
          var lo2 = 0,
            hi2 = timeOffsets.length - 1;
          while (lo2 < hi2) {
            var mid2 = (lo2 + hi2) >>> 1;
            if (cumDist[mid2] < d) lo2 = mid2 + 1;
            else hi2 = mid2;
          }
          cursorX = seriesX[Math.max(0, lo2)] || 0;
        } else {
          cursorX = d / 1000;
        }
        // Throttle chart updates to reduce UI contention
        try {
          var idxForY = 0;
          if (useTime && Array.isArray(timeOffsets)) {
            var lo3 = 0,
              hi3 = timeOffsets.length - 1;
            while (lo3 < hi3) {
              var mid3 = (lo3 + hi3) >>> 1;
              if (cumDist[mid3] < d) lo3 = mid3 + 1;
              else hi3 = mid3;
            }
            idxForY = Math.max(0, lo3);
          } else {
            var lo4 = 0,
              hi4 = cumDist.length - 1;
            while (lo4 < hi4) {
              var mid4 = (lo4 + hi4) >>> 1;
              if (cumDist[mid4] < d) lo4 = mid4 + 1;
              else hi4 = mid4;
            }
            idxForY = Math.max(0, lo4);
          }
          var yNow = window.getPositionMarkerY
            ? window.getPositionMarkerY(idxForY)
            : typeof coords[idxForY][2] === 'number'
              ? coords[idxForY][2]
              : 0;
          if (chart && chart.data && chart.data.datasets) {
            // Find position marker dataset dynamically
            for (var i = 0; i < chart.data.datasets.length; i++) {
              if (chart.data.datasets[i].label === 'Position') {
                chart.data.datasets[i].data[0] = { x: cursorX, y: yNow };
                break;
              }
            }
          }
        } catch (_) {}
        if (chart) {
          var chartVisible = !!(ui.chartWrap && ui.chartWrap.style.display !== 'none');
          var chartUpdateInterval = cadence.chartInterval;
          if (chartVisible && chartCooldown >= chartUpdateInterval) {
            chart.update('none');
            chartCooldown = 0;
          }
        }

        // Update live metrics overlays
        try {
          if (hudEnabled && metricsSpeedLabel && metricsDistLabel && metricsElevLabel) {
            var hudInterval = cadence.hudInterval;
            if (hudCooldown < hudInterval) {
              // Skip expensive text churn this frame.
            } else {
              hudCooldown = 0;
              // Elevation and local grade around the current track index.
              var elevNow = isFinite(Number(yNow)) ? Math.round(Number(yNow)) : 0;
              var gradeNow = Math.round(gradeAtIndex(idxForY));
              var gradePrefix = gradeNow > 0 ? '+' : '';
              setTextIfChanged(metricsElevLabel, gradePrefix + gradeNow + '° / ' + elevNow + 'm');
              // Distance (km) from start or privacy start
              var dStart = privacyEnabled ? privacyStartD : 0;
              var distKm = Math.max(0, (d - dStart) / 1000);
              setTextIfChanged(metricsDistLabel, distKm.toFixed(2) + ' km');
              // Speed (km/h): prefer time-based derivative; fallback to geometric estimate
              var speedMs = 0;
              if (hasTimestamps && Array.isArray(timeOffsets)) {
                var loS = 0,
                  hiS = timeOffsets.length - 1;
                while (loS < hiS) {
                  var midS = (loS + hiS) >>> 1;
                  if (cumDist[midS] < d) loS = midS + 1;
                  else hiS = midS;
                }
                var iS = Math.max(1, loS);
                var d0s = cumDist[iS - 1],
                  d1s = cumDist[iS];
                var t0s = timeOffsets[iS - 1],
                  t1s = timeOffsets[iS];
                var dd = Math.max(0, d1s - d0s);
                var dt = Math.max(1e-3, t1s - t0s);
                speedMs = dd / dt;
              } else {
                // Estimate from last frame distance and dt
                if (typeof lastFrameDt === 'number' && lastFrameDt > 0) {
                  // approximate: use ahead point distance to reduce noise
                  var ahead = positionAtDistance(
                    Math.min(privacyEnabled ? privacyEndD : totalDistance, d + 5)
                  );
                  var cur = pos;
                  var approx = haversineMeters(cur, [ahead[0], ahead[1]]);
                  speedMs = approx / 5; // over 5 meters lookahead
                }
              }
              var speedKmh = Math.max(0, speedMs * 3.6);
              setTextIfChanged(metricsSpeedLabel, Math.round(speedKmh) + ' km/h');
              // Update bottom direction overlay
              if (dirLabel) {
                var dispBearing =
                  typeof bearing === 'number' ? Math.round(((bearing % 360) + 360) % 360) : 0;
                setTextIfChanged(dirLabel, dispBearing + '° — ' + bearingToCardinal(dispBearing));
              }
            }
          }
        } catch (_) {}

        if (DBG.enabled) {
          if (!updateVisuals._tLast || performance.now() - updateVisuals._tLast > 2000) {
            DBG.log('progress', {
              p: +p.toFixed(4),
              distanceM: Math.round(p * totalDistance),
              markerSetData: dbgMarkerSetDataCount,
              progressSetData: dbgProgressSetDataCount,
              segmentSetData: dbgSegmentSetDataCount,
              cameraJumps: dbgCameraJumpCount,
              cameraJumpStreak: cameraJumpStreak,
            });
            dbgMarkerSetDataCount = 0;
            dbgProgressSetDataCount = 0;
            dbgSegmentSetDataCount = 0;
            dbgCameraJumpCount = 0;
            updateVisuals._tLast = performance.now();
          }
        }
      }

      /**
       * Schedules the next animation frame for playback.
       */
      function scheduleRaf() {
        if (!document.contains(root)) {
          destroyRuntime();
          return;
        }
        if (!rafId) {
          rafId = window.requestAnimationFrame(raf);
        }
      }

      /**
       * Main animation frame callback for playback loop.
       * @param {number} ts - Timestamp in ms.
       */
      function raf(ts) {
        rafId = null;
        if (!document.contains(root)) {
          destroyRuntime();
          return;
        }
        if (!playing) return;
        if (lastFrame == null) lastFrame = ts;
        var dt = (ts - lastFrame) / 1000; // seconds
        lastFrame = ts;
        lastFrameDt = dt;
        if (dt >= 0.45) {
          prefetchBackoffUntilMs = Date.now() + 6000;
          if (vpInflightKeys && typeof vpInflightKeys.clear === 'function') vpInflightKeys.clear();
          if (forwardPrefetchInflight && typeof forwardPrefetchInflight.clear === 'function') {
            forwardPrefetchInflight.clear();
          }
          if (dbgAllow('prefetch-backoff', 800)) {
            DBG.warn('Prefetch backoff activated', {
              dtMs: Math.round(dt * 1000),
              backoffMs: 6000,
              tab: currentChartTab,
            });
          }
        }
        if (dt >= 0.12 && dbgAllow('raf-gap', 400)) {
          DBG.warn('RAF frame gap detected', {
            dtMs: Math.round(dt * 1000),
            tab: currentChartTab,
            speed: Number(speed) || 0,
            playing: !!playing,
            cityChunksLoading: Object.keys(cityChunkLoading || {}).length,
            cityTotalCached: getLoadedCityCount(),
          });
        }
        chartCooldown += dt;
        hudCooldown += dt;
        photoScanCooldown += dt;
        markerDataCooldown += dt;
        cameraCooldown += dt;
        progressLineCooldown += dt;

        // Handle video recording frame capture
        // Push one frame to the MediaRecorder stream on every animation tick.
        // captureFrame() is a no-op when not recording or on Safari (auto-capture fallback).
        if (videoRecorder) {
          videoRecorder.captureFrame(ts);
        }

        // Overlay rendering is now handled by map 'render' event

        // Speed ramp: smooth easeInOutCubic from 1x to user-chosen speed over ramp duration.
        // Always accelerates — prevents the jarring motion that a 25x fixed start caused
        // when user speed was set below 25x (which previously produced a deceleration).
        var effectiveSpeed = speed;
        if (startupSpeedRampRemaining > 0) {
          startupSpeedRampRemaining = Math.max(0, startupSpeedRampRemaining - dt);
          var rampProgress =
            1 - startupSpeedRampRemaining / Math.max(0.001, startupSpeedRampDuration);
          var rampT = easeInOutCubic(rampProgress);
          // Blend from 1x to user speed — always ramps up
          effectiveSpeed = 1 + (speed - 1) * rampT;
          if (startupSpeedRampRemaining <= 0) {
            startupSpeedRampRemaining = 0;
            startupSpeedRampDuration = 0;
            effectiveSpeed = speed;
          }
        }

        if (hasTimestamps && totalDuration > 0) {
          // time-based
          tOffset += dt * effectiveSpeed;
          var frac = Math.min(1, tOffset / totalDuration);
          // map time to distance using timeOffsets ~ cumDist relation
          var targetTime = frac * totalDuration;
          var lo = 0,
            hi = timeOffsets.length - 1;
          while (lo < hi) {
            var mid = (lo + hi) >>> 1;
            if (timeOffsets[mid] < targetTime) lo = mid + 1;
            else hi = mid;
          }
          var i = Math.max(1, lo);
          var t0 = timeOffsets[i - 1],
            t1 = timeOffsets[i];
          var u = t1 > t0 ? (targetTime - t0) / (t1 - t0) : 0;
          var d0 = cumDist[i - 1],
            d1 = cumDist[i];
          var d = d0 + (d1 - d0) * u;
          progress = d / totalDistance;
        } else {
          // distance-based at constant speed: 15 km/h baseline scaled by multiplier
          var speedMs = (15 / 3.6) * effectiveSpeed; // meters per second
          var dProg = (speedMs * dt) / totalDistance;
          progress = Math.min(1, progress + dProg);
        }

        // Enforce privacy window on progress and detect end
        var reachedPrivacyEnd = false;
        if (privacyEnabled) {
          var minP = privacyStartD / totalDistance;
          var maxP = privacyEndD / totalDistance;
          if (progress < minP) progress = minP;
          if (progress >= maxP) {
            progress = maxP;
            reachedPrivacyEnd = true;
          }
        }

        setProgressBar(progress);
        var cadence = getPlaybackCadence(speed, hasTerrain, currentChartTab);
        updateVisuals(progress, cadence);
        // Update weather cinema if that tab is active
        if (currentChartTab === 'weathergrade') {
          var cinemaRoot = container || root;
          var _cinemaEl = cinemaRoot._cachedCinema;
          if (!_cinemaEl || _cinemaEl.style.display === 'none') {
            _cinemaEl = cinemaRoot.querySelector('.fgpx-weather-cinema');
            if (_cinemaEl) cinemaRoot._cachedCinema = _cinemaEl;
          }
          if (_cinemaEl && _cinemaEl.style.display !== 'none') {
            updateWeatherCinema(_cinemaEl, payload, lastPlaybackSec || 0, playing || false, false);
          }
        }
        // Update weather overview playhead if that tab is active
        if (currentChartTab === 'weatheroverview' && ui.weatherOverviewPlayhead) {
          var phPct =
            isFinite(totalDuration) && totalDuration > 0
              ? Math.max(0, Math.min(1, tOffset / totalDuration))
              : Math.max(0, Math.min(1, progress));
          ui.weatherOverviewPlayhead.style.left = phPct * 100 + '%';
        }
        // If photos are enabled with timestamps, show overlay when marker reaches the photo time
        try {
          if (
            FGPX.photosEnabled &&
            Array.isArray(photos) &&
            photos.length > 0 &&
            hasTimestamps &&
            totalDuration != null
          ) {
            if (overlayActive) {
              // Keep RAF running; only skip photo scan while overlay is active.
            } else {
              var photoScanInterval = cadence.photoScanInterval;
              if (photoScanCooldown < photoScanInterval) {
                // Keep previous window so next scan covers the full skipped interval.
              } else {
                photoScanCooldown = 0;
                var currentSec = tOffset;
                if (currentSec == null) {
                  currentSec = progress * totalDuration;
                }
                if (lastPlaybackSec == null) {
                  lastPlaybackSec = currentSec;
                }
                var fromSec = Math.min(lastPlaybackSec, currentSec);
                var toSec = Math.max(lastPlaybackSec, currentSec);
                var dNowFrame = progress * totalDistance;
                if (lastPlaybackDist == null || !isFinite(lastPlaybackDist)) {
                  lastPlaybackDist = dNowFrame;
                }
                if (photosByTime && photosByTime.length > 0) {
                  // Advance pointer and queue any photos whose pSec fall within [fromSec, toSec]
                  while (photoPtr < photosByTime.length && photosByTime[photoPtr].pSec <= toSec) {
                    var cand = photosByTime[photoPtr];
                    if (cand.pSec >= fromSec && cand.pSec <= toSec) {
                      var p = cand.p;
                      var key = String(p.id || p.fullUrl || p.thumbUrl || p.timestamp || photoPtr);
                      if (!shownPhotoKeys.has(key)) {
                        // Additional filename matching to prevent wrong photos
                        var isValidPhoto = true;
                        if (typeof p.thumbUrl === 'string' && typeof p.fullUrl === 'string') {
                          try {
                            var thumbName = p.thumbUrl.split('/').pop().split('?')[0];
                            var fullName = p.fullUrl.split('/').pop().split('?')[0];
                            // Check if thumbnail and full image filenames match (allowing for different extensions and resolutions)
                            if (!filenamesMatch(thumbName, fullName)) {
                              isValidPhoto = false;
                            }
                          } catch (_) {}
                        }
                        if (isValidPhoto) {
                          shownPhotoKeys.add(key);
                          photoQueue.push(p);
                          DBG.log('enqueue photo', { id: p.id, dist: p._distAlong });
                          // If this is the first photo and no overlay is active, process it immediately
                          if (photoQueue.length === 1 && !overlayActive) {
                            processNextPhoto();
                          }
                        }
                      }
                    }
                    photoPtr++;
                  }
                  // Limited spatial fallback around next upcoming photo
                  if (photoQueue.length === 0 && photoPtr < photosByTime.length) {
                    try {
                      var pNext = photosByTime[photoPtr].p;
                      if (typeof pNext.lon === 'number' && typeof pNext.lat === 'number') {
                        var markerLngLat2 =
                          currentPosLngLat || positionAtDistance(progress * totalDistance);
                        var dist2 = haversineMeters(markerLngLat2, [pNext.lon, pNext.lat]);
                        if (isFinite(dist2) && dist2 <= 50) {
                          var key2 = String(
                            pNext.id ||
                              pNext.fullUrl ||
                              pNext.thumbUrl ||
                              pNext.timestamp ||
                              photoPtr
                          );
                          if (!shownPhotoKeys.has(key2)) {
                            // Additional filename matching to prevent wrong photos
                            var isValidPhoto = true;
                            if (
                              typeof pNext.thumbUrl === 'string' &&
                              typeof pNext.fullUrl === 'string'
                            ) {
                              try {
                                var thumbName = pNext.thumbUrl.split('/').pop().split('?')[0];
                                var fullName = pNext.fullUrl.split('/').pop().split('?')[0];
                                // Check if thumbnail and full image filenames match (allowing for different extensions and resolutions)
                                if (!filenamesMatch(thumbName, fullName)) {
                                  isValidPhoto = false;
                                }
                              } catch (_) {}
                            }
                            if (isValidPhoto) {
                              shownPhotoKeys.add(key2);
                              photoQueue.push(pNext);
                              photoPtr++;
                              DBG.log('enqueue photo', { id: pNext.id, dist: pNext._distAlong });
                              // If this is the first photo and no overlay is active, process it immediately
                              if (photoQueue.length === 1 && !overlayActive) {
                                processNextPhoto();
                              }
                            }
                          }
                        }
                      }
                    } catch (_) {}
                  }
                }
                // Distance-based fallback: trigger photos whose route distance falls within this frame window
                try {
                  if (Array.isArray(photosByDist) && photosByDist.length > 0) {
                    // Use actual traveled distance this frame to avoid time/EXIF drift issues
                    var minD = Math.min(lastPlaybackDist, dNowFrame) - 40; // slack meters
                    var maxD = Math.max(lastPlaybackDist, dNowFrame) + 40;
                    if (isFinite(minD) && isFinite(maxD)) {
                      while (
                        photoDistPtr < photosByDist.length &&
                        photosByDist[photoDistPtr].pDist <= maxD
                      ) {
                        var candD = photosByDist[photoDistPtr];
                        if (candD.pDist >= minD && candD.pDist <= maxD) {
                          var pD = candD.p;
                          var keyD = String(
                            pD.id || pD.fullUrl || pD.thumbUrl || pD.timestamp || 'd' + photoPtr
                          );
                          if (!shownPhotoKeys.has(keyD)) {
                            // verify spatially near current marker (~60m) to avoid false positives
                            var mPos =
                              currentPosLngLat || positionAtDistance(progress * totalDistance);
                            var dNear = haversineMeters(mPos, candD.lngLat);
                            if (isFinite(dNear) && dNear <= 60) {
                              // Additional filename matching to prevent wrong photos
                              var isValidPhoto = true;
                              if (
                                typeof pD.thumbUrl === 'string' &&
                                typeof pD.fullUrl === 'string'
                              ) {
                                try {
                                  var thumbName = pD.thumbUrl.split('/').pop().split('?')[0];
                                  var fullName = pD.fullUrl.split('/').pop().split('?')[0];
                                  // Check if thumbnail and full image filenames match (allowing for different extensions and resolutions)
                                  if (!filenamesMatch(thumbName, fullName)) {
                                    isValidPhoto = false;
                                  }
                                } catch (_) {}
                              }
                              if (isValidPhoto) {
                                shownPhotoKeys.add(keyD);
                                photoQueue.push(pD);
                                DBG.log('enqueue photo', { id: pD.id, dist: pD._distAlong });
                                // If this is the first photo and no overlay is active, process it immediately
                                if (photoQueue.length === 1 && !overlayActive) {
                                  processNextPhoto();
                                }
                              }
                            }
                          }
                        }
                        photoDistPtr++;
                      }
                    }
                  }
                } catch (_) {}
                lastPlaybackSec = currentSec;
                lastPlaybackDist = dNowFrame;
                // Photos are now processed immediately when queued, so no need for frame-end processing
              }
            }
          }
        } catch (_) {}

        // Keep media queue rotation in sync for both timestamped and geo-only playback.
        try {
          if (
            canRotateMediaQueue() &&
            currentChartTab === 'media' &&
            ui.mediaPanel &&
            ui.mediaPanel.style.display !== 'none'
          ) {
            syncMediaDisplayOrder(false);
          }
        } catch (_) {}

        var endReached = reachedPrivacyEnd || progress >= 1;
        if (!endReached) {
          scheduleRaf();
        } else {
          console.log(
            '[FGPX end-zoom] track ended — reachedPrivacyEnd:',
            reachedPrivacyEnd,
            'progress:',
            progress
          );
          setPlaying(false);
          var shouldStopRecordingAfterEndZoom = !!(isRecording && videoRecorder);
          // At end handoff, prefetch once to warm tiles at overview zoom.
          try {
            if (prefetchEnabled && Date.now() >= prefetchBackoffUntilMs) {
              prefetchViewportTiles(hasTerrain ? 0.22 : 0.3, !hasTerrain, bearing);
            }
          } catch (_) {}

          // Cinematic end zoom-out: slowly ease back to the initial overview state
          // (same position/zoom the user saw before pressing Play).
          // Camera slowly rotates back to bearing 0 during the zoom-out.
          var endTransitionStarted = false;
          var END_ZOOMOUT_DURATION = 5000;
          function stopRecordingAfterEndZoom(durationMs) {
            if (!shouldStopRecordingAfterEndZoom) return;
            var finished = false;

            function stopWithFinalFrame() {
              if (!isRecording || !videoRecorder) return;
              try {
                // Ensure the final overview frame is emitted before stopping.
                if (typeof videoRecorder.captureFrame === 'function') {
                  videoRecorder.captureFrame(performance.now());
                }
              } catch (_) {}
              stopRecording();
            }

            var stopDelay = Math.max(0, Number(durationMs) || 0) + 150;
            var fallbackTimer = setTimeout(function () {
              if (finished) return;
              finished = true;
              console.log('[FGPX end-zoom] stopRecording fallback timer fired');
              stopWithFinalFrame();
            }, stopDelay);
            map.once('moveend', function () {
              if (finished) return;
              finished = true;
              try {
                clearTimeout(fallbackTimer);
              } catch (_) {}
              console.log('[FGPX end-zoom] stopRecording on moveend');
              // Prefer the next render tick to include the settled camera frame.
              try {
                map.once('render', function () {
                  stopWithFinalFrame();
                });
              } catch (_) {
                stopWithFinalFrame();
              }
            });
          }
          function doEndZoomOut() {
            if (endTransitionStarted) return;
            endTransitionStarted = true;
            // Stop idle sway FIRST — its RAF calls jumpTo() every frame which cancels any easeTo.
            stopIdleSway();
            console.log(
              '[FGPX end-zoom] doEndZoomOut called, overviewCameraState:',
              overviewCameraState
            );
            try {
              // Prefer the pre-computed overview state captured at map load.
              // Fall back to a fresh cameraForBounds call if not available.
              var ov = overviewCameraState;
              if (!ov) {
                var targetBounds = innerBoundsRef || fullBoundsRef;
                var camFallback =
                  typeof map.cameraForBounds === 'function'
                    ? map.cameraForBounds(targetBounds, { padding: 40 })
                    : null;
                if (camFallback && isFinite(Number(camFallback.zoom))) {
                  ov = {
                    center: camFallback.center,
                    zoom: Number(camFallback.zoom),
                    pitch: 0,
                    bearing: 0,
                  };
                }
              }
              if (ov) {
                // Read current camera state so the animation starts from exactly where playback ended.
                var bearingNow = 0;
                var pitchNow = 60;
                var zoomNow = 13;
                try {
                  if (typeof map.getBearing === 'function') bearingNow = map.getBearing();
                  if (typeof map.getPitch === 'function') pitchNow = map.getPitch();
                  if (typeof map.getZoom === 'function') zoomNow = map.getZoom();
                } catch (_) {}
                // Do NOT change center — zoom out from the current marker position.
                // At zoom ~9 the viewport covers ~700–900 km, so the whole route fits in frame
                // without any panning needed. Keeping center fixed means the end-of-track marker
                // stays anchored on screen while the map zooms out around it.
                console.log('[FGPX end-zoom] easeTo target:', {
                  zoom: ov.zoom,
                  fromZoom: zoomNow,
                  fromPitch: pitchNow,
                  bearingNow: bearingNow,
                  duration: END_ZOOMOUT_DURATION,
                });
                stopRecordingAfterEndZoom(END_ZOOMOUT_DURATION);
                map.easeTo({
                  zoom: ov.zoom,
                  pitch: 0,
                  bearing: 0,
                  duration: END_ZOOMOUT_DURATION,
                  easing: easeInOutCubic,
                });
              } else {
                // Fallback — no overviewCameraState and cameraForBounds failed
                console.log('[FGPX end-zoom] no ov — using fitMapToBounds fallback');
                stopRecordingAfterEndZoom(END_ZOOMOUT_DURATION);
                fitMapToBounds(END_ZOOMOUT_DURATION, { pitch: 0 });
              }
            } catch (_e2) {
              console.log('[FGPX end-zoom] doEndZoomOut threw', _e2);
              stopRecordingAfterEndZoom(1800);
              fitMapToBounds(1800, { pitch: 0 });
            }
          }
          console.log('[FGPX end-zoom] hasTerrain:', hasTerrain);
          if (hasTerrain) {
            // Disable terrain mesh before zoom-out to avoid shimmer/pop during pitch→0 animation.
            // Terrain is restored by zoomInThenStartPlayback / reset when user plays again.
            try {
              map.setTerrain(null);
              terrainActive = false;
              terrainTemporarilyDisabled = true;
            } catch (_) {}
            var terrainIdleForEnd = false;
            var terrainEndTimer = setTimeout(function () {
              if (terrainIdleForEnd) return;
              doEndZoomOut();
            }, 280);
            map.once('idle', function () {
              terrainIdleForEnd = true;
              try {
                clearTimeout(terrainEndTimer);
              } catch (_) {}
              doEndZoomOut();
            });
          } else {
            doEndZoomOut();
          }
        }
      }

      // Recording functions
      /**
       * Starts video recording, showing the quality selection modal and initializing the recorder.
       */
      function startRecording() {
        if (isRecording) return;

        var atEnd = privacyEnabled ? progress >= privacyEndP - 1e-6 : progress >= 1;
        if (atEnd) {
          // Keep record behavior aligned with Play: restart from the beginning
          // so recording does not immediately hit end-of-track auto-stop.
          reset();
        }

        // Show quality selection modal first
        showRecordingSettingsModal()
          .then(function (selection) {
            if (!selection || !selection.preset) {
              DBG.log('Recording cancelled by user');
              return;
            }

            selectedQualityPreset = selection.preset;
            var expectedChunkCount = Math.max(1, Number(selection.expectedChunkCount) || 1);
            var outputConfig = selection.outputConfig || {
              mode: 'download',
              directoryHandle: null,
            };

            try {
              // Initialize a fresh recorder per recording session so chunk/session state never leaks.
              videoRecorder = new VideoRecorder(map, {
                preset: selectedQualityPreset,
                root: root,
                overlayElement: overlay,
                mapContainer: map.getContainer(),
                progressHost: ui.mapEl,
                expectedChunkCount: expectedChunkCount,
                outputMode: outputConfig.mode,
                outputDirectoryHandle: outputConfig.directoryHandle || null,
              });

              // Update UI to show recording is starting
              ui.controls.btnRecord.textContent = '⏹';
              ui.controls.btnRecord.setAttribute('title', 'Stop Recording');
              ui.controls.btnRecord.disabled = false;

              // Disable other controls during recording
              ui.controls.btnPlay.disabled = true;
              ui.controls.btnPause.disabled = true;
              ui.controls.btnRestart.disabled = true;

              // Hide splash overlay immediately when recording starts
              hideSplash();

              // Start background playback if not already playing
              if (!playing) {
                // Start preloading if needed
                if (prefetchEnabled && !preloadCompleted) {
                  tilePrefetchPromise = prefetchTilesForRoute();
                }

                // Start playback in background and only start recording after preloading
                (tilePrefetchPromise || Promise.resolve()).then(function () {
                  // Now start recording after preloading is complete
                  videoRecorder
                    .start()
                    .then(function () {
                      isRecording = true;
                      ensureRecordingRenderHook();

                      if (firstPlayZoomPending) {
                        // Start recording before zoom animation
                        zoomInThenStartPlayback();
                      } else {
                        setPlaying(true);
                        scheduleRaf();
                      }
                    })
                    .catch(function (error) {
                      DBG.warn('Failed to start recording', error);
                      isRecording = false;
                      updateButtonStates();
                    });
                });
              } else {
                // If already playing, start recording immediately
                videoRecorder
                  .start()
                  .then(function () {
                    isRecording = true;
                    ensureRecordingRenderHook();
                  })
                  .catch(function (error) {
                    DBG.warn('Failed to start recording', error);
                    isRecording = false;
                    removeRecordingRenderHook();
                    updateButtonStates();
                  });
              }

              DBG.log(
                'Recording started with preset:',
                selectedQualityPreset,
                'outputMode:',
                outputConfig.mode,
                'expectedChunks:',
                expectedChunkCount
              );
            } catch (error) {
              DBG.warn('Failed to start recording', error);
              isRecording = false;
              removeRecordingRenderHook();
              updateButtonStates();
            }
          })
          .catch(function (error) {
            DBG.warn('Failed to show recording settings', error);
          });
      }

      /**
       * Stops video recording and updates UI state.
       */
      function stopRecording() {
        if (!isRecording || !videoRecorder) return;

        try {
          removeRecordingRenderHook();
          // Stop recording
          videoRecorder.stop();
          isRecording = false;

          // Reset prefetch state so user can immediately start another recording
          // The prefetch promise from the previous attempt may still be pending,
          // but finishPreload() will handle resetting preloadingInProgress when it completes.
          // For now, allow immediate re-recording by not blocking on stale prefetch state.
          preloadingInProgress = false;

          // Update UI
          ui.controls.btnRecord.textContent = '⏺';
          ui.controls.btnRecord.setAttribute('title', 'Record Video');
          ui.controls.btnRecord.disabled = false;

          // Re-enable other controls
          updateButtonStates();

          DBG.log('Recording stopped');
        } catch (error) {
          DBG.warn('Failed to stop recording', error);
          isRecording = false;
          removeRecordingRenderHook();
          preloadingInProgress = false;
          updateButtonStates();
        }
      }

      // Calculate track duration for recording estimates (respects playback speed)
      /**
       * Calculates the track duration in minutes for recording estimates.
       * @returns {number} Track duration in minutes.
       */
      function calculateTrackDuration() {
        // Get current speed from UI (in case user changed it)
        var currentSpeed = speed;
        try {
          var speedSelectorValue = parseFloat(ui.controls.speedSel.value || '1');
          if (isFinite(speedSelectorValue) && speedSelectorValue > 0) {
            currentSpeed = speedSelectorValue;
          }
        } catch (e) {
          // Use existing speed variable as fallback
        }

        var realDurationMinutes; // actual track duration
        var playbackDurationMinutes; // duration at current playback speed

        // Method 1: Use actual timestamps from track (most accurate)
        if (timestamps && timestamps.length > 1) {
          try {
            var startTime = null,
              endTime = null;

            // Find first valid timestamp
            for (var i = 0; i < timestamps.length; i++) {
              if (timestamps[i]) {
                startTime = Date.parse(timestamps[i]);
                break;
              }
            }

            // Find last valid timestamp
            for (var j = timestamps.length - 1; j >= 0; j--) {
              if (timestamps[j]) {
                endTime = Date.parse(timestamps[j]);
                break;
              }
            }

            if (
              startTime &&
              endTime &&
              !isNaN(startTime) &&
              !isNaN(endTime) &&
              endTime > startTime
            ) {
              realDurationMinutes = (endTime - startTime) / (1000 * 60); // ms to minutes
              playbackDurationMinutes = realDurationMinutes / currentSpeed; // adjust for playback speed
              DBG.log(
                'Track duration from timestamps:',
                Math.round(realDurationMinutes) +
                  ' minutes real, ' +
                  Math.round(playbackDurationMinutes) +
                  ' minutes at ' +
                  currentSpeed +
                  'x speed'
              );
              return playbackDurationMinutes;
            }
          } catch (error) {
            DBG.warn('Error calculating duration from timestamps:', error);
          }
        }

        // Method 2: Use total duration if available
        if (totalDuration && totalDuration > 0) {
          realDurationMinutes = totalDuration / 60; // seconds to minutes
          playbackDurationMinutes = realDurationMinutes / currentSpeed; // adjust for playback speed
          DBG.log(
            'Track duration from totalDuration:',
            Math.round(realDurationMinutes) +
              ' minutes real, ' +
              Math.round(playbackDurationMinutes) +
              ' minutes at ' +
              currentSpeed +
              'x speed'
          );
          return playbackDurationMinutes;
        }

        // Method 3: Use distance and baseline speed (15 km/h scaled by multiplier)
        if (totalDistance && currentSpeed && currentSpeed > 0) {
          // Use same logic as animation: 15 km/h baseline scaled by speed multiplier
          var baselineSpeedKmh = 15; // km/h baseline
          var effectiveSpeedKmh = baselineSpeedKmh * currentSpeed;
          playbackDurationMinutes = (totalDistance / 1000 / effectiveSpeedKmh) * 60; // km / (km/h) * 60 = minutes
          DBG.log(
            'Track duration from distance/speed:',
            Math.round(playbackDurationMinutes) +
              ' minutes at ' +
              currentSpeed +
              'x speed (' +
              effectiveSpeedKmh +
              ' km/h)'
          );
          return playbackDurationMinutes;
        }

        // Method 4: Estimate from coordinate count (rough estimate)
        if (coords && coords.length > 0) {
          // Assume 1 point per second on average for GPS tracks, adjusted for playback speed
          realDurationMinutes = coords.length / 60;
          playbackDurationMinutes = realDurationMinutes / currentSpeed;
          DBG.log(
            'Track duration estimated from points:',
            Math.round(playbackDurationMinutes) + ' minutes at ' + currentSpeed + 'x speed'
          );
          return playbackDurationMinutes;
        }

        DBG.warn('Could not calculate track duration, using fallback');
        return 3 / currentSpeed; // fallback adjusted for speed
      }

      /**
       * Estimates the expected file size in MB for a given preset and track duration.
       * @param {string} presetKey - Quality preset key.
       * @param {number} trackDurationMinutes - Track duration in minutes.
       * @returns {number} Estimated size in MB.
       */
      function estimateExpectedSizeMbForPreset(presetKey, trackDurationMinutes) {
        var preset = VIDEO_QUALITY_PRESETS[presetKey] || VIDEO_QUALITY_PRESETS.medium;
        return ((preset.bitrate / 8) * 60 * 1.3 * trackDurationMinutes) / (1024 * 1024);
      }

      /**
       * Estimates the expected number of output chunks for a given preset and track duration.
       * @param {string} presetKey - Quality preset key.
       * @param {number} trackDurationMinutes - Track duration in minutes.
       * @returns {number} Estimated chunk count.
       */
      function estimateExpectedChunkCount(presetKey, trackDurationMinutes) {
        var estimatedSizeMb = estimateExpectedSizeMbForPreset(presetKey, trackDurationMinutes);
        if (estimatedSizeMb <= 250) {
          return 1;
        }
        return Math.ceil(estimatedSizeMb / 200);
      }

      // Quality selection modal
      /**
       * Shows the recording settings modal and resolves with the selected options.
       * @returns {Promise<Object>} Promise resolving to modal selection.
       */
      function showRecordingSettingsModal() {
        return new Promise(function (resolve, reject) {
          try {
            // Remove existing modal if present
            var existingModal = document.querySelector('.fgpx-recording-settings-modal');
            if (existingModal) {
              existingModal.remove();
            }

            // Calculate track duration for modal
            var trackDurationMinutes = calculateTrackDuration();
            DBG.log('Modal track duration:', trackDurationMinutes + ' minutes');

            // Create modal
            var modal = createRecordingSettingsModal(resolve, trackDurationMinutes);
            document.body.appendChild(modal);

            // Show modal with animation
            setTimeout(function () {
              modal.classList.add('fgpx-modal-show');
            }, 10);
          } catch (error) {
            reject(error);
          }
        });
      }

      /**
       * Creates the DOM for the recording settings modal.
       * @param {Function} resolve - Callback to resolve the modal.
       * @param {number} trackDurationMinutes - Track duration in minutes.
       * @returns {HTMLElement} The modal element.
       */
      function createRecordingSettingsModal(resolve, trackDurationMinutes) {
        var modal = document.createElement('div');
        modal.className = 'fgpx-recording-settings-modal';
        modal.style.cssText =
          'position: fixed; top: 0; left: 0; width: 100%; height: 100%; ' +
          'background: rgba(0,0,0,0.7); z-index: 10000; display: flex; ' +
          'align-items: center; justify-content: center; opacity: 0; ' +
          'transition: opacity 0.3s ease;';

        var modalContent = document.createElement('div');
        modalContent.style.cssText =
          'background: white; border-radius: 8px; padding: 24px; ' +
          'max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto; ' +
          'transform: scale(0.9); transition: transform 0.3s ease;';

        // Use passed duration or fallback
        if (!trackDurationMinutes || isNaN(trackDurationMinutes) || trackDurationMinutes <= 0) {
          trackDurationMinutes = 3; // fallback
        }

        modalContent.innerHTML =
          '<div class="fgpx-modal-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">' +
          '<h3 style="margin: 0; color: #333;">Video Recording Settings</h3>' +
          '<button class="fgpx-modal-close" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #666;">&times;</button>' +
          '</div>' +
          '<div class="fgpx-quality-presets" style="margin-bottom: 24px;">' +
          '<h4 style="margin: 0 0 12px 0; color: #333;">Quality Presets</h4>' +
          '<div class="fgpx-preset-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px;">' +
          Object.keys(VIDEO_QUALITY_PRESETS)
            .map(function (key) {
              var preset = VIDEO_QUALITY_PRESETS[key];
              var estimatedSize = estimateExpectedSizeMbForPreset(key, trackDurationMinutes);
              var isRecommended = key === 'medium';
              var expectedChunks = estimateExpectedChunkCount(key, trackDurationMinutes);

              var chunkInfo = '';
              if (expectedChunks > 1) {
                chunkInfo =
                  '<div class="fgpx-preset-chunks" style="font-size: 11px; color: #e67e22; font-weight: bold; margin-bottom: 2px;">Chunked output: ' +
                  expectedChunks +
                  ' files</div>';
              }

              return (
                '<div class="fgpx-preset-card" data-preset="' +
                key +
                '" style="' +
                'border: 2px solid ' +
                (isRecommended ? '#007cba' : '#ddd') +
                '; ' +
                'border-radius: 6px; padding: 12px; cursor: pointer; ' +
                'transition: all 0.2s ease; position: relative;' +
                (isRecommended ? 'background: #f0f8ff;' : '') +
                '">' +
                (isRecommended
                  ? '<div style="position: absolute; top: -8px; right: 8px; background: #007cba; color: white; padding: 2px 8px; border-radius: 4px; font-size: 10px;">RECOMMENDED</div>'
                  : '') +
                '<div class="fgpx-preset-name" style="font-weight: bold; color: #333; margin-bottom: 4px;">' +
                preset.name +
                '</div>' +
                '<div class="fgpx-preset-specs" style="font-size: 12px; color: #666; margin-bottom: 4px;">' +
                preset.fps +
                'fps • ' +
                Math.round(preset.bitrate / 1000000) +
                ' Mbps • bitrate profile' +
                '</div>' +
                '<div class="fgpx-preset-size" style="font-size: 12px; color: #007cba; font-weight: bold; margin-bottom: 4px;">~' +
                Math.round(estimatedSize) +
                'MB total</div>' +
                chunkInfo +
                '<div class="fgpx-preset-use" style="font-size: 11px; color: #888;">' +
                preset.useCase +
                '</div>' +
                '</div>'
              );
            })
            .join('') +
          '</div>' +
          '</div>' +
          '<div class="fgpx-recording-preview" style="background: #f5f5f5; padding: 16px; border-radius: 6px; margin-bottom: 20px;">' +
          '<div class="fgpx-preview-stats" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px;">' +
          '<div class="fgpx-stat">' +
          '<span class="fgpx-stat-label" style="display: block; font-size: 12px; color: #666;">Track Duration:</span>' +
          '<span class="fgpx-stat-value" style="font-weight: bold; color: #333;">' +
          Math.floor(trackDurationMinutes) +
          'm ' +
          Math.round((trackDurationMinutes % 1) * 60) +
          's</span>' +
          '</div>' +
          '<div class="fgpx-stat">' +
          '<span class="fgpx-stat-label" style="display: block; font-size: 12px; color: #666;">Selected Quality:</span>' +
          '<span class="fgpx-stat-value" id="fgpx-selected-quality" style="font-weight: bold; color: #333;">Standard Definition</span>' +
          '</div>' +
          '<div class="fgpx-stat">' +
          '<span class="fgpx-stat-label" style="display: block; font-size: 12px; color: #666;">Expected File Size:</span>' +
          '<span class="fgpx-stat-value" id="fgpx-total-size" style="font-weight: bold; color: #007cba;">~' +
          Math.round(estimateExpectedSizeMbForPreset('medium', trackDurationMinutes)) +
          'MB</span>' +
          '</div>' +
          '</div>' +
          '<div id="fgpx-recording-note" style="margin-top: 12px; font-size: 12px; color: #555; line-height: 1.45;">Export size matches the current player size. Presets adjust bitrate and frame rate. Long recordings may be split into multiple files.</div>' +
          '</div>' +
          '<div class="fgpx-modal-actions" style="display: flex; gap: 12px; justify-content: flex-end;">' +
          '<button class="fgpx-btn fgpx-btn-secondary" id="fgpx-cancel-recording" style="' +
          'padding: 8px 16px; border: 1px solid #ddd; background: white; color: #333; ' +
          'border-radius: 4px; cursor: pointer; transition: all 0.2s ease;' +
          '">Cancel</button>' +
          '<button class="fgpx-btn fgpx-btn-primary" id="fgpx-start-recording" style="' +
          'padding: 8px 16px; border: none; background: #007cba; color: white; ' +
          'border-radius: 4px; cursor: pointer; transition: all 0.2s ease;' +
          '">Start Recording</button>' +
          '</div>';

        modal.appendChild(modalContent);

        // Add event listeners
        var selectedPreset = 'medium';

        // Preset selection
        var presetCards = modalContent.querySelectorAll('.fgpx-preset-card');
        presetCards.forEach(function (card) {
          card.addEventListener('click', function () {
            // Remove selection from all cards
            presetCards.forEach(function (c) {
              c.style.borderColor = '#ddd';
              c.style.background = '';
            });

            // Select this card
            card.style.borderColor = '#007cba';
            card.style.background = '#f0f8ff';

            selectedPreset = card.getAttribute('data-preset');
            var preset = VIDEO_QUALITY_PRESETS[selectedPreset];

            // Update preview
            document.getElementById('fgpx-selected-quality').textContent = preset.name;
            var estimatedSize = estimateExpectedSizeMbForPreset(
              selectedPreset,
              trackDurationMinutes
            );
            document.getElementById('fgpx-total-size').textContent =
              '~' + Math.round(estimatedSize) + 'MB';
          });

          // Select medium by default
          if (card.getAttribute('data-preset') === 'medium') {
            card.click();
          }
        });

        // Close button
        modalContent.querySelector('.fgpx-modal-close').addEventListener('click', function () {
          closeModal(null);
        });

        // Cancel button
        modalContent.querySelector('#fgpx-cancel-recording').addEventListener('click', function () {
          closeModal(null);
        });

        // Start recording button
        modalContent.querySelector('#fgpx-start-recording').addEventListener('click', function () {
          var expectedChunkCount = estimateExpectedChunkCount(selectedPreset, trackDurationMinutes);
          closeModal({
            preset: selectedPreset,
            expectedChunkCount: expectedChunkCount,
            outputConfig: { mode: 'download', directoryHandle: null },
          });
        });

        // Close on backdrop click
        modal.addEventListener('click', function (e) {
          if (e.target === modal) {
            closeModal(null);
          }
        });

        function closeModal(result) {
          modal.classList.remove('fgpx-modal-show');
          setTimeout(function () {
            if (modal.parentNode) {
              modal.parentNode.removeChild(modal);
            }
            resolve(result);
          }, 300);
        }

        // Add CSS for modal show state (only once)
        if (!document.getElementById('fgpx-modal-style')) {
          var style = document.createElement('style');
          style.id = 'fgpx-modal-style';
          style.textContent =
            '.fgpx-modal-show { opacity: 1 !important; }' +
            '.fgpx-modal-show > div { transform: scale(1) !important; }' +
            '.fgpx-preset-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }' +
            '.fgpx-btn:hover { opacity: 0.9; transform: translateY(-1px); }';
          document.head.appendChild(style);
        }

        return modal;
      }

      // Control events
      ui.controls.btnPlay.addEventListener('click', function () {
        var atEnd = privacyEnabled ? progress >= privacyEndP - 1e-6 : progress >= 1;
        if (atEnd) {
          reset();
        }
        if (!playing && !preloadingInProgress) {
          startPlaybackWithPreload();
        }
      });
      ui.controls.btnPause.addEventListener('click', function () {
        setPlaying(false);
        // Stop recording when manually paused
        if (isRecording && videoRecorder) {
          stopRecording();
        }
      });
      ui.controls.btnRestart.addEventListener('click', function () {
        setPlaying(false);
        // Stop recording when restarting
        if (isRecording && videoRecorder) {
          stopRecording();
        }
        reset();
      });
      ui.controls.speedSel.addEventListener('change', function (e) {
        var v = parseFloat(e.target.value || '1');
        if (!isFinite(v) || v <= 0) v = 1;
        speed = v;
      });

      // Record button handler
      ui.controls.btnRecord.addEventListener('click', function () {
        if (isRecording) {
          // Stop recording
          stopRecording();
        } else {
          // Start recording
          startRecording();
        }
      });

      /**
       * Checks if the map style supports glyphs for weather text layers.
       * @param {boolean} logResult - Whether to log the result.
       * @returns {boolean} True if supported, false otherwise.
       */
      function refreshWeatherTextLayerSupport(logResult) {
        if (weatherTextLayersSupported === true) return true;
        var hasGlyphs = false;
        try {
          var style = map.getStyle();
          hasGlyphs = !!(style && style.glyphs);
          if (logResult) {
            DBG.log(
              'Map style has glyphs:',
              hasGlyphs,
              'Style glyphs URL:',
              style ? style.glyphs : 'none'
            );
          }
        } catch (e) {
          if (logResult) {
            DBG.warn('Could not check glyph availability:', e);
          }
          return weatherTextLayersSupported === true;
        }
        weatherTextLayersSupported = hasGlyphs;
        return hasGlyphs;
      }

      /**
       * Ensures the temperature text layer is present on the map.
       */
      function ensureTemperatureTextLayer() {
        if (!refreshWeatherTextLayerSupport(false)) return;
        try {
          if (map.getLayer('fgpx-temperature-text')) return;
          map.addLayer({
            id: 'fgpx-temperature-text',
            type: 'symbol',
            source: 'fgpx-weather',
            minzoom: 12,
            layout: {
              visibility: 'none',
              'text-field': [
                'case',
                ['!=', ['get', 'temperature_c'], null],
                ['concat', ['round', ['get', 'temperature_c']], '°C'],
                '',
              ],
              'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
              'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 16, 14],
              'text-allow-overlap': true,
              'text-ignore-placement': true,
            },
            paint: {
              'text-color': '#000000',
              'text-halo-color': '#ffffff',
              'text-halo-width': 2,
              'text-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13, 1],
            },
          });
        } catch (e) {
          DBG.warn('Failed to add temperature text layer:', e);
        }
      }

      /**
       * Ensures the wind text layer is present on the map.
       */
      function ensureWindTextLayer() {
        if (!refreshWeatherTextLayerSupport(false)) return;
        try {
          if (map.getLayer('fgpx-wind-text')) return;
          map.addLayer({
            id: 'fgpx-wind-text',
            type: 'symbol',
            source: 'fgpx-weather',
            minzoom: 12,
            filter: ['!=', ['get', 'wind_speed_kmh'], null],
            layout: {
              visibility: 'none',
              'text-field': [
                'case',
                ['!=', ['get', 'wind_speed_kmh'], null],
                ['concat', ['round', ['get', 'wind_speed_kmh']], 'km/h'],
                '',
              ],
              'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
              'text-size': ['interpolate', ['linear'], ['zoom'], 12, 8, 16, 11],
              'text-allow-overlap': true,
              'text-ignore-placement': true,
              'text-anchor': 'center',
              'text-justify': 'center',
              'text-offset': [0, 1.5],
            },
            paint: {
              'text-color': [
                'case',
                ['!=', ['get', 'wind_speed_kmh'], null],
                [
                  'interpolate',
                  ['linear'],
                  ['get', 'wind_speed_kmh'],
                  0,
                  '#666666',
                  10,
                  '#228b22',
                  20,
                  '#ff8c00',
                  30,
                  '#ff4500',
                  50,
                  '#dc143c',
                ],
                '#666666',
              ],
              'text-halo-color': '#ffffff',
              'text-halo-width': 2,
              'text-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13, 1],
            },
          });
        } catch (e) {
          DBG.warn('Failed to add wind text layer:', e);
        }
      }

      /**
       * Ensures the wind satellite arrow layers are present on the map.
       */
      function ensureWindSatelliteLayers() {
        if (!windSatelliteLayersEnabled) return;
        try {
          if (windCircleLayerIds.length > 0) return;
          if (!map.getSource('fgpx-weather')) return;
          if (!map.hasImage('arrow-calm-size1')) return;

          var circlePositions = [];
          var numArrows = 12;
          var minRadius = 45;
          var maxRadius = 80;
          var minDistance = 25;

          for (var i = 0; i < numArrows; i++) {
            var attempts = 0;
            var validPosition = false;
            var newPos;

            while (!validPosition && attempts < 50) {
              var angle = (i / numArrows) * 2 * Math.PI + (Math.random() - 0.5) * 0.6;
              var radius = minRadius + Math.random() * (maxRadius - minRadius);

              newPos = {
                x: Math.cos(angle) * radius,
                y: Math.sin(angle) * radius,
                radius: radius,
              };

              validPosition = true;
              for (var j = 0; j < circlePositions.length; j++) {
                var distance = Math.sqrt(
                  Math.pow(newPos.x - circlePositions[j].x, 2) +
                    Math.pow(newPos.y - circlePositions[j].y, 2)
                );
                if (distance < minDistance) {
                  validPosition = false;
                  break;
                }
              }
              attempts++;
            }

            if (validPosition) {
              var normalizedRadius = (newPos.radius - minRadius) / (maxRadius - minRadius);
              var sizeIndex = Math.ceil((1 - normalizedRadius) * 4);
              sizeIndex = Math.max(1, Math.min(4, sizeIndex));

              circlePositions.push({
                x: newPos.x,
                y: newPos.y,
                size: sizeIndex,
              });
            }
          }

          circlePositions.forEach(function (pos, index) {
            var circleLayerId = 'fgpx-wind-arrows-circle-' + index;
            windCircleLayerIds.push(circleLayerId);
            map.addLayer({
              id: circleLayerId,
              type: 'symbol',
              source: 'fgpx-weather',
              minzoom: 12,
              filter: ['!=', ['get', 'wind_speed_kmh'], null],
              layout: {
                visibility: 'none',
                'icon-image': [
                  'case',
                  ['!=', ['get', 'wind_speed_kmh'], null],
                  [
                    'case',
                    ['<', ['get', 'wind_speed_kmh'], 5],
                    'arrow-calm-size' + pos.size,
                    ['<', ['get', 'wind_speed_kmh'], 15],
                    'arrow-light-size' + pos.size,
                    ['<', ['get', 'wind_speed_kmh'], 25],
                    'arrow-moderate-size' + pos.size,
                    ['<', ['get', 'wind_speed_kmh'], 40],
                    'arrow-strong-size' + pos.size,
                    'arrow-very-strong-size' + pos.size,
                  ],
                  'arrow-calm-size' + pos.size,
                ],
                'icon-rotate': ['get', 'wind_direction_deg'],
                'icon-rotation-alignment': 'map',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'icon-offset': [pos.x, pos.y],
              },
              paint: {
                'icon-opacity': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  12,
                  0,
                  13,
                  weatherOpacity * 0.6,
                ],
              },
            });
          });
          DBG.log('Wind satellite layers created lazily', { count: windCircleLayerIds.length });
        } catch (e) {
          DBG.warn('Failed to lazily create wind satellite layers:', e);
        }
      }

      /**
       * Applies the weather overlay profile (visibility, performance mode, etc.) to all weather layers.
       * @param {boolean} force - Force update even if state unchanged.
       */
      function applyWeatherOverlayProfile(force) {
        if (
          !effectiveWeatherEnabled ||
          !weatherData ||
          !weatherData.features ||
          !Array.isArray(weatherData.features) ||
          weatherData.features.length === 0
        ) {
          return;
        }

        var isReduced =
          weatherOverlayPerfMode === 'performance' ||
          (weatherOverlayPerfMode === 'auto' && playing && currentChartTab === 'weathergrade');
        var baseWeatherVisibility = weatherVisible ? 'visible' : 'none';
        var fullWeatherVisibility = weatherVisible && !isReduced ? 'visible' : 'none';
        var tempBase = !isMobileOverlayDisabled && temperatureVisible ? 'visible' : 'none';
        var tempTextVisibility = tempBase === 'visible' && !isReduced ? 'visible' : 'none';
        var windBase = !isMobileOverlayDisabled && windVisible ? 'visible' : 'none';
        var windTextVisibility = windBase === 'visible' && !isReduced ? 'visible' : 'none';
        var circleWindVisibility = windBase === 'visible' && !isReduced ? 'visible' : 'none';
        var profileKey = [
          baseWeatherVisibility,
          fullWeatherVisibility,
          tempBase,
          tempTextVisibility,
          windBase,
          windTextVisibility,
          circleWindVisibility,
        ].join('|');
        if (
          !force &&
          weatherOverlayReduced === isReduced &&
          weatherOverlayProfileKey === profileKey
        ) {
          return;
        }
        weatherOverlayReduced = isReduced;
        weatherOverlayProfileKey = profileKey;

        // Weather layers: in reduced mode keep primary layer + circle and suppress secondary layers.
        if (weatherHeatmapConsolidated) {
          setLayerVisibilityIfPresent('fgpx-weather-heatmap', baseWeatherVisibility);
        } else {
          setLayerVisibilityIfPresent('fgpx-weather-heatmap-rain', baseWeatherVisibility);
        }
        setLayerVisibilityIfPresent('fgpx-weather-circle', baseWeatherVisibility);

        // Cloud / 3D cloud visibility — always handled regardless of consolidated/split.
        // When admin chose 3D, classic cloud layer stays hidden unconditionally.
        if (clouds3dAdminEnabled) {
          setLayerVisibilityIfPresent('fgpx-weather-heatmap-clouds', 'none');
        } else {
          setLayerVisibilityIfPresent('fgpx-weather-heatmap-clouds', fullWeatherVisibility);
        }
        setLayerVisibilityIfPresent('fgpx-clouds-3d', fullWeatherVisibility);

        if (!weatherHeatmapConsolidated) {
          setLayerVisibilityIfPresent('fgpx-weather-heatmap-snow', fullWeatherVisibility);
          setLayerVisibilityIfPresent('fgpx-weather-heatmap-fog', fullWeatherVisibility);
        }

        setLayerVisibilityIfPresent('fgpx-temperature-circle', tempBase);
        if (tempTextVisibility === 'visible') {
          ensureTemperatureTextLayer();
        }
        setLayerVisibilityIfPresent('fgpx-temperature-text', tempTextVisibility);

        setLayerVisibilityIfPresent('fgpx-wind-arrows', windBase);
        if (windTextVisibility === 'visible') {
          ensureWindTextLayer();
        }
        setLayerVisibilityIfPresent('fgpx-wind-text', windTextVisibility);

        if (windSatelliteLayersEnabled) {
          if (circleWindVisibility === 'visible') {
            ensureWindSatelliteLayers();
          }
          if (windCircleLayerIds.length > 0) {
            for (var wi = 0; wi < windCircleLayerIds.length; wi++) {
              setLayerVisibilityIfPresent(windCircleLayerIds[wi], circleWindVisibility);
            }
          } else {
            for (var wf = 0; wf < 12; wf++) {
              setLayerVisibilityIfPresent('fgpx-wind-arrows-circle-' + wf, circleWindVisibility);
            }
          }
        }
      }

      // Weather toggle handler (only if weather is enabled)
      if (
        effectiveWeatherEnabled &&
        weatherData &&
        weatherData.features &&
        Array.isArray(weatherData.features) &&
        weatherData.features.length > 0
      ) {
        // Set initial button state
        ui.controls.btnWeather.style.opacity = weatherVisible ? '1' : '0.5';
        ui.controls.btnWeather.setAttribute(
          'title',
          weatherVisible ? 'Hide Weather Overlay' : 'Show Weather Overlay'
        );

        ui.controls.btnWeather.addEventListener('click', function () {
          weatherVisible = !weatherVisible;

          try {
            applyWeatherOverlayProfile(true);

            // Update button appearance
            ui.controls.btnWeather.style.opacity = weatherVisible ? '1' : '0.5';
            ui.controls.btnWeather.setAttribute(
              'title',
              weatherVisible ? 'Hide Weather Overlay' : 'Show Weather Overlay'
            );

            DBG.log('Weather overlay toggled:', weatherVisible ? 'visible' : 'hidden');
          } catch (e) {
            DBG.warn('Failed to toggle weather layers:', e);
          }
        });

        // Temperature toggle handler
        ui.controls.btnTemperature.style.opacity = '0.5';
        ui.controls.btnTemperature.setAttribute(
          'title',
          isMobileOverlayDisabled
            ? 'Temperature overlay is disabled on mobile'
            : 'Show Temperature Overlay'
        );

        ui.controls.btnTemperature.addEventListener('click', function () {
          if (isMobileOverlayDisabled) {
            DBG.log('Temperature overlay toggle ignored: disabled on mobile');
            return;
          }
          temperatureVisible = !temperatureVisible;

          try {
            applyWeatherOverlayProfile(true);
            if (
              temperatureVisible &&
              !map.getLayer('fgpx-temperature-text') &&
              !weatherTextLayersSupported
            ) {
              DBG.log('Temperature text layer not available (no glyphs in map style)');
              try {
                var existingNote = root.querySelector('.fgpx-glyph-note');
                if (!existingNote) {
                  var note = document.createElement('div');
                  note.className = 'fgpx-glyph-note';
                  note.style.cssText =
                    'position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:5;background:rgba(0,0,0,0.75);color:#fff;padding:6px 14px;border-radius:6px;font-size:12px;pointer-events:none;white-space:nowrap;transition:opacity 0.4s;';
                  note.textContent = 'Text labels unavailable (map style has no glyph support)';
                  root.appendChild(note);
                  setTimeout(function () {
                    note.style.opacity = '0';
                  }, 4000);
                  setTimeout(function () {
                    if (note.parentNode) note.parentNode.removeChild(note);
                  }, 4500);
                }
              } catch (_) {}
            }

            // Update button appearance
            ui.controls.btnTemperature.style.opacity = temperatureVisible ? '1' : '0.5';
            ui.controls.btnTemperature.setAttribute(
              'title',
              temperatureVisible ? 'Hide Temperature Overlay' : 'Show Temperature Overlay'
            );

            DBG.log('Temperature overlay toggled:', temperatureVisible ? 'visible' : 'hidden');
          } catch (e) {
            DBG.warn('Failed to toggle temperature layer:', e);
          }
        });

        // Wind toggle handler
        ui.controls.btnWind.style.opacity = '0.5';
        ui.controls.btnWind.setAttribute(
          'title',
          isMobileOverlayDisabled ? 'Wind overlay is disabled on mobile' : 'Show Wind Overlay'
        );

        ui.controls.btnWind.addEventListener('click', function () {
          if (isMobileOverlayDisabled) {
            DBG.log('Wind overlay toggle ignored: disabled on mobile');
            return;
          }
          windVisible = !windVisible;

          try {
            applyWeatherOverlayProfile(true);
            if (windVisible && !map.getLayer('fgpx-wind-text') && !weatherTextLayersSupported) {
              DBG.log('Wind text layer not available (no glyphs in map style)');
              try {
                var existingNote = root.querySelector('.fgpx-glyph-note');
                if (!existingNote) {
                  var note = document.createElement('div');
                  note.className = 'fgpx-glyph-note';
                  note.style.cssText =
                    'position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:5;background:rgba(0,0,0,0.75);color:#fff;padding:6px 14px;border-radius:6px;font-size:12px;pointer-events:none;white-space:nowrap;transition:opacity 0.4s;';
                  note.textContent = 'Text labels unavailable (map style has no glyph support)';
                  root.appendChild(note);
                  setTimeout(function () {
                    note.style.opacity = '0';
                  }, 4000);
                  setTimeout(function () {
                    if (note.parentNode) note.parentNode.removeChild(note);
                  }, 4500);
                }
              } catch (_) {}
            }

            // Update button appearance
            ui.controls.btnWind.style.opacity = windVisible ? '1' : '0.5';
            ui.controls.btnWind.setAttribute(
              'title',
              windVisible ? 'Hide Wind Overlay' : 'Show Wind Overlay'
            );

            DBG.log('Wind overlay toggled:', windVisible ? 'visible' : 'hidden');

            // Debug: Check if arrow icon exists and layer state
            DBG.log('DEBUG: Arrow icon exists:', map.hasImage('arrow'));

            // Check if layers exist before trying to access them
            var layers = map.getStyle().layers;
            var arrowLayerExists = layers.some((layer) => layer.id === 'fgpx-wind-arrows');
            var textLayerExists = layers.some((layer) => layer.id === 'fgpx-wind-text');

            DBG.log('DEBUG: Wind arrows layer exists:', arrowLayerExists);
            DBG.log('DEBUG: Wind text layer exists:', textLayerExists);

            if (arrowLayerExists) {
              DBG.log(
                'DEBUG: Wind arrows visibility:',
                map.getLayoutProperty('fgpx-wind-arrows', 'visibility')
              );
            }
            if (textLayerExists) {
              DBG.log(
                'DEBUG: Wind text visibility:',
                map.getLayoutProperty('fgpx-wind-text', 'visibility')
              );
            }

            DBG.log(
              'DEBUG: Wind source data features:',
              map.getSource('fgpx-weather')._data.features.length
            );

            // If arrow layer doesn't exist but should, try to add it
            if (!arrowLayerExists && map.hasImage('arrow-calm')) {
              DBG.log('DEBUG: Arrow layer missing, attempting to add it...');
              try {
                map.addLayer({
                  id: 'fgpx-wind-arrows',
                  type: 'symbol',
                  source: 'fgpx-weather',
                  minzoom: 12,
                  filter: ['!=', ['get', 'wind_speed_kmh'], null],
                  layout: {
                    visibility: windVisible && !isMobileOverlayDisabled ? 'visible' : 'none',
                    'icon-image': [
                      'case',
                      ['!=', ['get', 'wind_speed_kmh'], null],
                      [
                        'case',
                        ['<', ['get', 'wind_speed_kmh'], 5],
                        'arrow-calm',
                        ['<', ['get', 'wind_speed_kmh'], 15],
                        'arrow-light',
                        ['<', ['get', 'wind_speed_kmh'], 25],
                        'arrow-moderate',
                        ['<', ['get', 'wind_speed_kmh'], 40],
                        'arrow-strong',
                        'arrow-very-strong',
                      ],
                      'arrow-calm',
                    ],
                    'icon-size': [
                      'interpolate',
                      ['linear'],
                      ['get', 'wind_speed_kmh'],
                      0,
                      0.5,
                      20,
                      0.8,
                      50,
                      1.2,
                    ],
                    'icon-rotate': ['get', 'wind_direction_deg'],
                    'icon-rotation-alignment': 'map',
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                  },
                  paint: {
                    'icon-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13, 0.7],
                  },
                });
                DBG.log('DEBUG: Arrow layer added successfully in toggle handler');
              } catch (e) {
                DBG.warn('DEBUG: Failed to add arrow layer in toggle handler:', e);
              }
            }
            applyWeatherOverlayProfile(true);
          } catch (e) {
            DBG.warn('Failed to toggle wind layer:', e);
          }
        });

        // Initialize overlay profile once handlers and layers are set up.
        applyWeatherOverlayProfile(true);
      }

      // Day/night overlay toggle button handler
      if (ui.controls.btnDayNight && window.FGPX && FGPX.daynightMapEnabled) {
        var daynightVisible = !!(window.FGPX && FGPX.daynightVisibleByDefault); // Use dedicated day/night setting
        ui.controls.btnDayNight.style.opacity = daynightVisible ? '1' : '0.5';
        ui.controls.btnDayNight.setAttribute(
          'title',
          daynightVisible ? 'Hide Day/Night Overlay' : 'Show Day/Night Overlay'
        );

        DBG.log('=== DAY/NIGHT TOGGLE BUTTON SETUP ===');
        DBG.log('Button exists:', !!ui.controls.btnDayNight);
        DBG.log('Initial state: visible =', daynightVisible);

        ui.controls.btnDayNight.addEventListener('click', function () {
          daynightVisible = !daynightVisible;

          DBG.log('=== DAY/NIGHT TOGGLE CLICKED ===');
          DBG.log('New visibility state:', daynightVisible);

          try {
            var overlayLayer = map.getLayer('fgpx-daynight-overlay');
            DBG.log('Overlay layer found:', !!overlayLayer);

            if (overlayLayer) {
              if (daynightVisible) {
                // Show layer — current night/day opacity is already set by updateVisuals
                if (map.getLayoutProperty('fgpx-daynight-overlay', 'visibility') !== 'visible') {
                  map.setLayoutProperty('fgpx-daynight-overlay', 'visibility', 'visible');
                }
                DBG.log('Day/night overlay shown');
              } else {
                // Hide layer
                if (map.getLayoutProperty('fgpx-daynight-overlay', 'visibility') !== 'none') {
                  map.setLayoutProperty('fgpx-daynight-overlay', 'visibility', 'none');
                }
                DBG.log('Day/night overlay hidden');
              }

              // Verify the change
              var actualVisibility = map.getLayoutProperty('fgpx-daynight-overlay', 'visibility');
              DBG.log('Actual layer visibility after change:', actualVisibility);
            } else {
              DBG.warn('Overlay layer not found for toggle!');
            }
          } catch (e) {
            DBG.warn('Failed to toggle day/night overlay:', e);
          }

          ui.controls.btnDayNight.style.opacity = daynightVisible ? '1' : '0.5';
          ui.controls.btnDayNight.setAttribute(
            'title',
            daynightVisible ? 'Hide Day/Night Overlay' : 'Show Day/Night Overlay'
          );

          DBG.log(
            'Button updated - opacity:',
            ui.controls.btnDayNight.style.opacity,
            'title:',
            ui.controls.btnDayNight.getAttribute('title')
          );
        });
      } else {
        DBG.log('Day/night toggle button setup skipped:', {
          btnExists: !!ui.controls.btnDayNight,
          fgpxExists: !!window.FGPX,
          enabled: !!(window.FGPX && FGPX.daynightMapEnabled),
        });
      }

      /**
       * Handles keydown events for the player (e.g., spacebar play/pause).
       * @param {KeyboardEvent} e - The keydown event.
       */
      var onPlayerKeydown = function (e) {
        if (!document.contains(root)) return;
        if (e.code === 'Space') {
          e.preventDefault();
          if (playing) {
            setPlaying(false);
            // Stop recording when paused via spacebar
            if (isRecording && videoRecorder) {
              stopRecording();
            }
          } else if (!preloadingInProgress) {
            var atEndKey = privacyEnabled ? progress >= privacyEndP - 1e-6 : progress >= 1;
            if (atEndKey) reset();
            startPlaybackWithPreload();
          }
        }
      };
      window.addEventListener('keydown', onPlayerKeydown);
      registerTeardown(function () {
        window.removeEventListener('keydown', onPlayerKeydown);
      });

      // Click-to-seek on progress bar: move to point in playback and reveal route up to there
      /**
       * Seeks playback to the specified fraction of the track.
       * @param {number} frac - Fraction (0..1) of the track.
       */
      function seekToFraction(frac) {
        if (playing) {
          pauseCityChunkLoadsFor(500, 'seek');
        }
        var f = Math.max(0, Math.min(1, frac));
        // Map to privacy window
        if (privacyEnabled) {
          var dSpan = Math.max(0, privacyEndD - privacyStartD);
          var dTarget = privacyStartD + f * (dSpan > 0 ? dSpan : 0);
          progress = dSpan > 0 ? dTarget / totalDistance : privacyStartD / totalDistance;
        } else {
          progress = f;
        }

        // Force progress line to update on next frame (marks driven portion orange)
        progressNeedLineInit = true;
        progressLineCooldown = 0;

        // Force a deterministic day/night recompute on seek
        dayNightOverlayState = null;

        // Clear photo state when seeking to allow photos to be shown again
        // This fixes the issue where photos weren't shown when seeking backward
        try {
          shownPhotoKeys.clear();
          photoQueue.length = 0;
          overlayActive = false;
          currentDisplayedPhoto = null;
          // Reset lastPlaybackDist/Sec to new position so next frame doesn't scan the entire gap
          lastPlaybackDist = progress * totalDistance;
        } catch (_) {}

        // Map to time offset if timestamps available
        if (hasTimestamps && totalDuration != null) {
          // Estimate tOffset via distance mapping for privacy window
          var distNow = progress * totalDistance;
          var lo2s = 0,
            hi2s = timeOffsets.length - 1;
          while (lo2s < hi2s) {
            var mid2s = (lo2s + hi2s) >>> 1;
            if (cumDist[mid2s] < distNow) lo2s = mid2s + 1;
            else hi2s = mid2s;
          }
          tOffset = timeOffsets[Math.max(0, lo2s)] || 0;
          lastPlaybackSec = tOffset;
          // Reposition photo pointer to current time to avoid scanning from start
          try {
            if (photosByTime && photosByTime.length > 0) {
              var lpt = 0,
                hpt = photosByTime.length;
              while (lpt < hpt) {
                var mpt = (lpt + hpt) >>> 1;
                if (photosByTime[mpt].pSec < lastPlaybackSec) lpt = mpt + 1;
                else hpt = mpt;
              }
              photoPtr = lpt;
              // Scan for time-based photos near the seeked timestamp (within 2 seconds)
              try {
                for (var ptIdx = photoPtr; ptIdx < photosByTime.length; ptIdx++) {
                  var tCand = photosByTime[ptIdx];
                  if (tCand.pSec >= lastPlaybackSec - 2 && tCand.pSec <= lastPlaybackSec + 2) {
                    var tKey = String(
                      tCand.p.id ||
                        tCand.p.fullUrl ||
                        tCand.p.thumbUrl ||
                        tCand.p.timestamp ||
                        't' + ptIdx
                    );
                    if (!shownPhotoKeys.has(tKey)) {
                      shownPhotoKeys.add(tKey);
                      photoQueue.push(tCand.p);
                    }
                  } else if (tCand.pSec > lastPlaybackSec + 2) {
                    break;
                  }
                }
              } catch (_) {}
            }
            if (Array.isArray(photosByDist) && photosByDist.length > 0) {
              var dNowSeek = progress * totalDistance;
              var loPd2 = 0,
                hiPd2 = photosByDist.length;
              while (loPd2 < hiPd2) {
                var midPd2 = (loPd2 + hiPd2) >>> 1;
                if (photosByDist[midPd2].pDist < dNowSeek) loPd2 = midPd2 + 1;
                else hiPd2 = midPd2;
              }
              photoDistPtr = loPd2;
              // CRITICAL: After repositioning distance pointer, scan forward for photos near seeked position
              // Use same 50m threshold as normal playback distance-based fallback
              try {
                for (
                  var photoCheckIdx = photoDistPtr;
                  photoCheckIdx < photosByDist.length;
                  photoCheckIdx++
                ) {
                  var photo = photosByDist[photoCheckIdx];
                  if (photo && photo.pDist >= dNowSeek - 50 && photo.pDist <= dNowSeek + 50) {
                    var seekPhotoKey = String(
                      photo.p.id ||
                        photo.p.fullUrl ||
                        photo.p.thumbUrl ||
                        photo.p.timestamp ||
                        'seek' + photoCheckIdx
                    );
                    if (!shownPhotoKeys.has(seekPhotoKey)) {
                      shownPhotoKeys.add(seekPhotoKey);
                      photoQueue.push(photo.p);
                    }
                  } else if (photo && photo.pDist > dNowSeek + 50) {
                    break;
                  }
                }
                // Process immediately if photos were found
                if (photoQueue.length > 0 && !overlayActive) {
                  processNextPhoto();
                }
              } catch (_) {}
            }
          } catch (_) {}
        }
        try {
          syncMediaDisplayOrder(true);
        } catch (_) {}
        // Prepare for immediate camera update and auto-play from the new position
        forceCameraUpdate = true;
        appliedBearing = null;
        bearing = null;
        setProgressBar(progress);
        DBG.log('=== SEEKING: About to call updateVisuals with progress:', progress);
        updateVisuals(progress);

        try {
          // Move camera immediately to marker
          if (currentPosLngLat && Array.isArray(currentPosLngLat)) {
            cameraCenter = currentPosLngLat.slice(0, 2);
            if (map && typeof map.jumpTo === 'function') {
              map.jumpTo({ center: cameraCenter });
            } else if (map && typeof map.setCenter === 'function') {
              map.setCenter(cameraCenter);
            }
            // Re-apply visuals once after jump so day/night polygon uses the new viewport bounds.
            updateVisuals(progress);
          }
          // Update chart cursor explicitly
          if (useTime && Array.isArray(timeOffsets)) {
            var seriesX2 = Array.isArray(movingTimeOffsets) ? movingTimeOffsets : timeOffsets;
            var lo2s = 0,
              hi2s = timeOffsets.length - 1;
            var distNow = progress * totalDistance;
            while (lo2s < hi2s) {
              var mid2s = (lo2s + hi2s) >>> 1;
              if (cumDist[mid2s] < distNow) lo2s = mid2s + 1;
              else hi2s = mid2s;
            }
            cursorX = seriesX2[Math.max(0, lo2s)] || 0;
          } else {
            cursorX = (progress * totalDistance) / 1000;
          }
          if (chart && chart.data && chart.data.datasets) {
            var idxY = Math.max(0, Math.round(progress * (coords.length - 1)));
            var yNow2 = window.getPositionMarkerY
              ? window.getPositionMarkerY(idxY)
              : typeof coords[idxY][2] === 'number'
                ? coords[idxY][2]
                : 0;
            // Find position marker dataset dynamically
            for (var i = 0; i < chart.data.datasets.length; i++) {
              if (chart.data.datasets[i].label === 'Position') {
                chart.data.datasets[i].data[0] = { x: cursorX, y: yNow2 };
                break;
              }
            }
            chart.update('none');
          }
          if (currentChartTab === 'weathergrade') {
            var cinemaRoot = container || root;
            var seekCinemaEl = cinemaRoot.querySelector('.fgpx-weather-cinema');
            if (seekCinemaEl && seekCinemaEl.style.display !== 'none') {
              seekCinemaEl._lastUpdate = 0;
              scheduleWeatherCinemaRefresh(
                seekCinemaEl,
                payload,
                lastPlaybackSec || 0,
                playing || false,
                true,
                0
              );
            }
          }
          if (currentChartTab === 'weatheroverview' && ui.weatherOverviewPlayhead) {
            var seekPhPct =
              isFinite(totalDuration) && totalDuration > 0
                ? Math.max(0, Math.min(1, tOffset / totalDuration))
                : Math.max(0, Math.min(1, progress));
            ui.weatherOverviewPlayhead.style.left = seekPhPct * 100 + '%';
          }
        } catch (_) {}
        // Never interrupt active recording when seeking on the progress bar.
        if (isRecording) {
          try {
            if (videoRecorder) {
              // Keep overlay/photo layer aligned before forcing a capture.
              if (typeof videoRecorder.syncPhotoOverlayToCamera === 'function') {
                videoRecorder.syncPhotoOverlayToCamera();
              }
              // Guarantee at least one post-seek frame even before next render tick.
              if (typeof videoRecorder.captureFrameNow === 'function') {
                videoRecorder.captureFrameNow();
              } else if (typeof videoRecorder.captureFrame === 'function') {
                videoRecorder.captureFrame(performance.now());
              }
            }
          } catch (_) {}
          if (!playing) setPlaying(true);
          scheduleRaf();
          return;
        }

        // Preserve playback state when seeking - don't auto-start if was paused
        // Only auto-play if we were already playing or if this is the first play
        if (!playing && firstPlayZoomPending) {
          zoomInThenStartPlayback();
        } else if (playing) {
          // If we were playing, continue playing after seek
          scheduleRaf();
        }
        // If we were paused (!playing && !firstPlayZoomPending), stay paused
      }

      try {
        var barWrap =
          ui.controls.progressBar && ui.controls.progressBar.parentElement
            ? ui.controls.progressBar.parentElement
            : null;
        if (barWrap) {
          barWrap.style.cursor = 'pointer';
          barWrap.addEventListener('click', function (ev) {
            var rect = barWrap.getBoundingClientRect();
            var x = ev.clientX - rect.left;
            var frac = rect.width > 0 ? x / rect.width : 0;
            seekToFraction(frac);
          });
        }
      } catch (_) {}

      // Helper function to fit map bounds consistently
      /**
       * Fits the map view to the track bounds with optional camera options.
       * @param {number} duration - Animation duration in ms.
       * @param {Object} cameraOpts - Camera options (pitch, bearing, etc.).
       */
      function fitMapToBounds(duration, cameraOpts) {
        duration = duration || 0;
        cameraOpts = cameraOpts || null;
        try {
          var fitOpts = { padding: 40, duration: duration };
          if (cameraOpts && typeof cameraOpts === 'object') {
            if (isFinite(Number(cameraOpts.pitch))) fitOpts.pitch = Number(cameraOpts.pitch);
            if (isFinite(Number(cameraOpts.bearing))) fitOpts.bearing = Number(cameraOpts.bearing);
          }
          map.fitBounds(innerBoundsRef || fullBoundsRef, fitOpts);
        } catch (e) {
          DBG.warn('Failed to fit map bounds', e);
        }
      }

      // Initial visuals
      reset();
    });
  }

  function __fgpxRunInit() {
    try {
      // Debug logs now that FGPX is available
      DBG.log('=== FGPX INITIALIZATION ===');
      DBG.log('SunCalc availability at init', {
        windowSunCalc: typeof window.SunCalc,
        SunCalcExists: !!window.SunCalc,
      });

      var containers = document.querySelectorAll('.fgpx');
      for (var i = 0; i < containers.length; i++) {
        initContainer(containers[i]);
      }
    } catch (e) {
      DBG.warn('Initialization error:', e);
    }
  }

  window.FGPX = window.FGPX || {};
  window.FGPX.initContainer = initContainer;

  if (window.FGPX && window.FGPX.deferViewport) {
    // Lazy: expose boot for loader
    window.FGPX.boot = function () {
      if (window.FGPX._bootDone) return;
      window.FGPX._bootDone = true;
      __fgpxRunInit();
    };
  } else {
    // Eager
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', __fgpxRunInit);
    } else {
      __fgpxRunInit();
    }
  }

  // Expose VideoRecorder for tests and browser
})();
