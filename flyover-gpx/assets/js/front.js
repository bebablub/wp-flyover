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

  /**
   * Central Debug Logger (DBG)
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
   * @namespace DBG
   */
  var DBG = (function(){
    /**
     * Check if debug logging is enabled via admin settings
     * @returns {boolean} True if debug logging should be active
     */
    function isEnabled(){ return !!(window.FGPX && window.FGPX.debugLogging); }
    
    /**
     * Log informational debug message
     * @param {...*} args - Arguments to log (same as console.info)
     */
    function log(){ if(!isEnabled()) return; try { console.info.apply(console, ['[FGPX]'].concat([].slice.call(arguments))); } catch(e) { /* console unavailable */ } }
    
    /**
     * Log warning debug message
     * @param {...*} args - Arguments to log (same as console.warn)
     */
    function warn(){ if(!isEnabled()) return; try { console.warn.apply(console, ['[FGPX]'].concat([].slice.call(arguments))); } catch(e) { /* console unavailable */ } }
    
    /**
     * Start performance timer
     * @param {string} label - Timer label for identification
     */
    function time(label){ if(!isEnabled()) return; try { console.time('[FGPX] '+label); } catch(e) { /* console unavailable */ } }
    
    /**
     * End performance timer and log duration
     * @param {string} label - Timer label to end
     */
    function timeEnd(label){ if(!isEnabled()) return; try { console.timeEnd('[FGPX] '+label); } catch(e) { /* console unavailable */ } }
    
    return { isEnabled:isEnabled, log:log, warn:warn, time:time, timeEnd:timeEnd };
  })();

  DBG.log('Front.js initialization started');

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
      // Extract base filenames before extension
      var thumbBase = thumbName.split('.')[0];
      var fullBase = fullName.split('.')[0];
      
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

  // Helper function to create a location key for grouping photos by location
  // Uses rounded coordinates to group nearby photos (within ~10 meters)
  function getLocationKey(lat, lon) {
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return null;
    }
    var roundedLat = Math.round(lat * 10000) / 10000;
    var roundedLon = Math.round(lon * 10000) / 10000;
    return roundedLat + ',' + roundedLon;
  }

  function createEl(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = String(text);
    return el;
  }

  function formatNumber(num, decimals) {
    return Number(num).toFixed(decimals);
  }

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

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function bearingBetween(p1, p2) {
    var lon1 = p1[0] * Math.PI / 180;
    var lat1 = p1[1] * Math.PI / 180;
    var lon2 = p2[0] * Math.PI / 180;
    var lat2 = p2[1] * Math.PI / 180;
    var y = Math.sin(lon2 - lon1) * Math.cos(lat2);
    var x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
    var brng = Math.atan2(y, x) * 180 / Math.PI;
    return (brng + 360) % 360;
  }

  function shortestAngleDelta(fromDeg, toDeg) {
    var delta = ((toDeg - fromDeg + 540) % 360) - 180;
    return delta;
  }

  function normalizeAngle(deg) {
    return (deg % 360 + 360) % 360;
  }

  function haversineMeters(a, b) {
    var R = 6371000;
    var dLat = (b[1] - a[1]) * Math.PI / 180;
    var dLon = (b[0] - a[0]) * Math.PI / 180;
    var lat1 = a[1] * Math.PI / 180;
    var lat2 = b[1] * Math.PI / 180;
    var sinDLat = Math.sin(dLat / 2);
    var sinDLon = Math.sin(dLon / 2);
    var c = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
    var d = 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
    return R * d;
  }

  // New: find nearest route vertex index to a lon/lat point (fast and robust enough for our use)
  function nearestCoordIndex(pointLonLat, coords) {
    var bestI = 0, bestD = Infinity;
    for (var i = 0; i < coords.length; i++) {
      var c = coords[i];
      var d = haversineMeters([c[0], c[1]], pointLonLat);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    return bestI;
  }

  // Douglas–Peucker simplification (iterative) that returns kept indices
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
      var x = p1[0]; var y = p1[1];
      var dx = p2[0] - x; var dy = p2[1] - y;
      if (dx !== 0 || dy !== 0) {
        var t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
        if (t > 1) { x = p2[0]; y = p2[1]; }
        else if (t > 0) { x += dx * t; y += dy * t; }
      }
      dx = p[0] - x; dy = p[1] - y;
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
          index = i; maxSqDist = sqDist;
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

  function chooseTolerance(points, targetCount) {
    // heuristic range based on bbox diagonal
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    var diag = Math.hypot(maxX - minX, maxY - minY);
    var low = 0, high = diag * 0.01; // start small; increase if still too many
    var bestTol = high;
    for (var iter = 0; iter < 10; iter++) {
      var mid = (low + high) / 2;
      var res = simplifyDouglasPeucker(points, mid * mid);
      if (res.indices.length > targetCount) {
        low = mid; // need more tolerance
      } else {
        bestTol = mid; high = mid;
      }
    }
    return bestTol * bestTol; // return squared tolerance
  }

  function buildOSMRasterStyle() {
    return {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          maxzoom: 19,
          attribution: '© OpenStreetMap contributors'
        }
      },
      layers: [
        { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-fade-duration': 350 } }
      ]
    };
  }

  function buildLayout(container) {
    container.innerHTML = '';
    var spinner = createEl('div', 'fgpx-spinner');
    spinner.innerHTML = '<div class="fgpx-spinner-inner"></div>';
    var error = createEl('div', 'fgpx-error');
    var mapEl = createEl('div', 'fgpx-map');
    var controls = createEl('div', 'fgpx-controls');
    var left = createEl('div', 'fgpx-controls-left');
    var right = createEl('div', 'fgpx-controls-right');
    var I18N = (window.FGPX && FGPX.i18n) ? FGPX.i18n : {};
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
      btnPlay.textContent = '▶\uFE0E';
      btnPlay.setAttribute('aria-label', I18N.play || 'Play');
      btnPlay.setAttribute('title', I18N.play || 'Play');
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
    } catch(_) {}
    var speedSel = createEl('select', 'fgpx-select');
    ['1x','10x','25x','50x','100x','250x'].forEach(function(lab){ var opt = createEl('option'); opt.value = lab.replace('x',''); opt.textContent = lab; speedSel.appendChild(opt); });
    try { speedSel.value = (window.FGPX && isFinite(Number(FGPX.defaultSpeed)) ? String(Number(FGPX.defaultSpeed)) : '25'); } catch(e) { speedSel.value = '25'; }
    var progressWrap = createEl('div', 'fgpx-progress');
    var progressBar = createEl('div', 'fgpx-progress-bar');
    progressWrap.appendChild(progressBar);
    left.appendChild(btnPlay); left.appendChild(btnPause); left.appendChild(btnRestart); left.appendChild(btnRecord);
    // Only show weather buttons if weather is enabled and not on small mobile devices
    if (window.FGPX && FGPX.weatherEnabled) {
      // Check if device is very small mobile (screen width <= 480px only)
      var isVerySmallMobile = window.innerWidth <= 480;
      DBG.log('Weather button visibility check:', {
        weatherEnabled: FGPX.weatherEnabled,
        windowWidth: window.innerWidth,
        isVerySmallMobile: isVerySmallMobile,
        hasTouch: 'ontouchstart' in window,
        maxTouchPoints: navigator.maxTouchPoints
      });
      if (!isVerySmallMobile) {
        left.appendChild(btnWeather);
        left.appendChild(btnTemperature);
        left.appendChild(btnWind);
        DBG.log('Weather buttons added to UI');
      } else {
        DBG.log('Weather buttons hidden due to very small screen');
      }
    } else {
      DBG.log('Weather buttons not added:', {
        fgpxExists: !!window.FGPX,
        weatherEnabled: !!(window.FGPX && FGPX.weatherEnabled)
      });
    }
    // Add day/night button if enabled (separate from weather condition)
    if (window.FGPX && FGPX.daynightMapEnabled) {
      var isVerySmallMobile = window.innerWidth <= 480;
      if (!isVerySmallMobile) {
        left.appendChild(btnDayNight);
      }
    }
    right.appendChild(createEl('span', 'fgpx-speed-label', I18N.speed || 'Speed')); right.appendChild(speedSel);
    controls.appendChild(left); controls.appendChild(progressWrap); controls.appendChild(right);

    var statsChart = createEl('div', 'fgpx-stats-chart');
    var stats = createEl('div', 'fgpx-stats');
    var statDist = createEl('div', 'fgpx-stat');
    var statTime = createEl('div', 'fgpx-stat');
    var statAvg = createEl('div', 'fgpx-stat');
    var statGain = createEl('div', 'fgpx-stat');
    stats.appendChild(statDist); stats.appendChild(statTime); stats.appendChild(statAvg); stats.appendChild(statGain);
    
    // Tab variables
    var tabElevation, tabBiometrics, tabTemperature, tabPower, tabWindImpact, tabWindRose, tabAll;
    
    // Show no data message in chart area (will be defined in startPlayer with proper chart reference)
    // var showNoDataMessage = null; // Removed - will be defined globally in startPlayer
    
    // Tab switching functionality (will be defined globally in startPlayer with proper variable references)
    // var switchChartTab = null; // Removed - will be defined globally in startPlayer
    
    // Chart tabs container
    var chartTabs = createEl('div', 'fgpx-chart-tabs');
    chartTabs.style.cssText = 'display:flex;border-bottom:1px solid #ddd;background:#f8f9fa;margin-bottom:0';
    
    // Chart legend controls (for All Data tab)
    var chartLegend = createEl('div', 'fgpx-chart-legend');
    chartLegend.style.cssText = 'display:none;padding:8px 12px;background:#f8f9fa;border-bottom:1px solid #ddd;font-size:12px;';
    var legendTitle = createEl('span');
    legendTitle.textContent = 'Toggle data series: ';
    legendTitle.style.cssText = 'margin-right:12px;font-weight:600;color:#333;';
    chartLegend.appendChild(legendTitle);
    tabElevation = createEl('button', 'fgpx-chart-tab fgpx-chart-tab-active');
    tabElevation.textContent = 'Elevation + Speed';
    tabElevation.style.cssText = 'flex:1;padding:8px 12px;border:none;background:transparent;cursor:pointer;font-size:12px;border-bottom:2px solid #007cba;color:#007cba;font-weight:600';
    tabBiometrics = createEl('button', 'fgpx-chart-tab');
    tabBiometrics.textContent = 'Heart Rate + Cadence';
    tabBiometrics.style.cssText = 'flex:1;padding:8px 12px;border:none;background:transparent;cursor:pointer;font-size:12px;border-bottom:2px solid transparent;color:#666;font-weight:400';
    tabTemperature = createEl('button', 'fgpx-chart-tab');
    tabTemperature.textContent = 'Temperature';
    tabTemperature.style.cssText = 'flex:1;padding:8px 12px;border:none;background:transparent;cursor:pointer;font-size:12px;border-bottom:2px solid transparent;color:#666;font-weight:400';
    tabPower = createEl('button', 'fgpx-chart-tab');
    tabPower.textContent = 'Power';
    tabPower.style.cssText = 'flex:1;padding:8px 12px;border:none;background:transparent;cursor:pointer;font-size:12px;border-bottom:2px solid transparent;color:#666;font-weight:400';
    tabWindImpact = createEl('button', 'fgpx-chart-tab');
    tabWindImpact.textContent = 'Wind Impact';
    tabWindImpact.style.cssText = 'flex:1;padding:8px 12px;border:none;background:transparent;cursor:pointer;font-size:12px;border-bottom:2px solid transparent;color:#666;font-weight:400';
    tabWindRose = createEl('button', 'fgpx-chart-tab');
    tabWindRose.textContent = 'Wind Directions';
    tabWindRose.style.cssText = 'flex:1;padding:8px 12px;border:none;background:transparent;cursor:pointer;font-size:12px;border-bottom:2px solid transparent;color:#666;font-weight:400';
    tabAll = createEl('button', 'fgpx-chart-tab');
    tabAll.textContent = 'All Data';
    tabAll.style.cssText = 'flex:1;padding:8px 12px;border:none;background:transparent;cursor:pointer;font-size:12px;border-bottom:2px solid transparent;color:#666;font-weight:400';
    chartTabs.appendChild(tabElevation);
    chartTabs.appendChild(tabBiometrics);
    chartTabs.appendChild(tabTemperature);
    chartTabs.appendChild(tabPower);
    chartTabs.appendChild(tabWindImpact);
    chartTabs.appendChild(tabWindRose);
    chartTabs.appendChild(tabAll);
    
    // Event listeners will be added in startPlayer after functions are defined
    
    var chartWrap = createEl('div', 'fgpx-chart-wrap');
    var canvas = createEl('canvas');
    chartWrap.appendChild(canvas);
    statsChart.appendChild(stats);
    statsChart.appendChild(chartTabs);
    statsChart.appendChild(chartLegend);
    statsChart.appendChild(chartWrap);

    container.appendChild(spinner);
    container.appendChild(error);
    container.appendChild(mapEl);
    container.appendChild(controls);
    container.appendChild(statsChart);

    return { 
      spinner: spinner, 
      error: error, 
      mapEl: mapEl, 
      controls: { btnPlay: btnPlay, btnPause: btnPause, btnRestart: btnRestart, btnRecord: btnRecord, btnWeather: btnWeather, btnTemperature: btnTemperature, btnWind: btnWind, btnDayNight: btnDayNight, speedSel: speedSel, progressBar: progressBar }, 
      stats: { dist: statDist, time: statTime, avg: statAvg, gain: statGain }, 
      canvas: canvas,
      tabs: { tabElevation: tabElevation, tabBiometrics: tabBiometrics, tabTemperature: tabTemperature, tabPower: tabPower, tabWindImpact: tabWindImpact, tabWindRose: tabWindRose, tabAll: tabAll },
      chartLegend: chartLegend
    };
  }

  function init() {
    var el = document.getElementById('fgpx-app');
    if (!el || typeof window.maplibregl === 'undefined' || typeof window.Chart === 'undefined' || typeof window.FGPX === 'undefined') {
      return;
    }

    var trackId = el.getAttribute('data-track-id');
    var style = el.getAttribute('data-style') || 'raster';
    var styleUrl = el.getAttribute('data-style-url');

    var ui = buildLayout(el);
    ui.spinner.style.display = 'flex';
    ui.error.style.display = 'none';

    var restUrl = String(window.FGPX.restUrl).replace(/\/$/, '') + '/track/' + encodeURIComponent(trackId) + (window.FGPX && FGPX.hostPostId ? ('?host_post=' + encodeURIComponent(String(FGPX.hostPostId))) : '');
    var ajaxUrl = (window.FGPX && FGPX.ajaxUrl) ? String(window.FGPX.ajaxUrl) : null;

    // Frontend caching for better performance on large tracks
    function getCacheKey() {
      var hostPost = (window.FGPX && FGPX.hostPostId) ? String(FGPX.hostPostId) : '0';
      var simplify = (window.FGPX && FGPX.backendSimplify) ? '1' : '0';
      var target = (window.FGPX && FGPX.backendSimplifyTarget) ? String(FGPX.backendSimplifyTarget) : '1200';
      return 'fgpx_cache_' + trackId + '_hp_' + hostPost + '_s_' + simplify + '_t_' + target;
    }

    function getCachedData() {
      try {
        if (!window.localStorage) return null;
        var cacheKey = getCacheKey();
        var cached = localStorage.getItem(cacheKey);
        if (!cached) return null;
        
        var data = JSON.parse(cached);
        // Check if cache is still valid (24 hours)
        if (data.timestamp && (Date.now() - data.timestamp) < 86400000) {
          DBG.log('Using cached track data', { cacheKey: cacheKey, age: Date.now() - data.timestamp });
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
                original: payload.geojson && payload.geojson.coordinates ? payload.geojson.coordinates.length : 0,
                reduction: Math.round((1 - compressedStr.length / JSON.stringify(payload).length) * 100) + '%'
              });
            }
          } catch (compressionError) {
            DBG.warn('Payload compression failed, using original:', compressionError);
          }
        }
        
        var cacheData = {
          timestamp: Date.now(),
          payload: compressed ? JSON.parse(payloadStr) : payload,
          compressed: compressed
        };
        localStorage.setItem(cacheKey, JSON.stringify(cacheData));
        DBG.log('Cached track data', { 
          cacheKey: cacheKey, 
          size: JSON.stringify(cacheData).length,
          compressed: compressed
        });
      } catch (e) {
        DBG.warn('Cache write error:', e);
        // Clear some old cache entries if storage is full
        if (e.name === 'QuotaExceededError') {
          try {
            for (var i = 0; i < localStorage.length; i++) {
              var key = localStorage.key(i);
              if (key && key.startsWith('fgpx_cache_')) {
                localStorage.removeItem(key);
                break;
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
      
      var compressed = JSON.parse(JSON.stringify(payload)); // Deep clone
      
      // Reduce coordinate precision for storage (visual quality preserved)
      if (compressed.geojson.coordinates) {
        compressed.geojson.coordinates = compressed.geojson.coordinates.map(function(coord) {
          return [
            Math.round(coord[0] * 100000) / 100000, // ~1.1m precision at equator
            Math.round(coord[1] * 100000) / 100000, // ~1.1m precision at equator
            coord[2] ? Math.round(coord[2] * 10) / 10 : coord[2] // 0.1m elevation precision
          ].filter(function(val) { return val !== undefined; });
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
      return fetch(restUrl, { headers: { 'X-WP-Nonce': window.FGPX.nonce } })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
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
      var u = ajaxUrl + (ajaxUrl.indexOf('?') === -1 ? '?' : '&') + 'action=fgpx_track&id=' + encodeURIComponent(trackId);
      if (window.FGPX && FGPX.hostPostId) { u += '&host_post=' + encodeURIComponent(String(FGPX.hostPostId)); }
      return fetch(u, { credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    }

    // Try cache first, then fetch from server
    var cachedData = getCachedData();
    if (cachedData) {
      ui.spinner.style.display = 'none';
      startPlayer(el, ui, cachedData, style, styleUrl);
    } else {
      fetchRest()
        .catch(function () { return fetchAjax(); })
        .then(function (json) {
          ui.spinner.style.display = 'none';
          // Cache the data for future use
          setCachedData(json);
          startPlayer(el, ui, json, style, styleUrl);
        })
        .catch(function (err) {
          ui.spinner.style.display = 'none';
          ui.error.textContent = (window.FGPX && FGPX.i18n && FGPX.i18n.failedLoad ? FGPX.i18n.failedLoad : 'Failed to load track:') + ' ' + (err && err.message ? err.message : 'Unknown error');
          ui.error.style.display = 'block';
        });
    }
  }

  function startPlayer(root, ui, payload, style, styleUrl) {
    var trackId = root.getAttribute('data-track-id');
    DBG.log('Starting player for track', { 
      trackId: trackId,
      hasPayload: !!payload,
      coordCount: payload && payload.geojson && payload.geojson.coordinates ? payload.geojson.coordinates.length : 0
    });
    
    // Chart variables declared at function scope
    var currentChartTab = 'elevation';
    var chart = null;
    var createChart = null;
    
    
    var coords = (payload && payload.geojson && payload.geojson.coordinates) ? payload.geojson.coordinates : [];
    var props = (payload && payload.geojson && payload.geojson.properties) ? payload.geojson.properties : {};
    
    // Check if we have valid route data
    if (!coords || coords.length === 0) {
      DBG.warn('No route data available for track ID:', payload ? payload.id : 'unknown');
      
      // Show user-friendly message
      var container = root.querySelector('.fgpx-container');
      if (container) {
        container.innerHTML = '<div class="fgpx-no-data-message" style="padding: 20px; text-align: center; background: #f9f9f9; border: 1px solid #ddd; border-radius: 4px; margin: 20px 0;">' +
          '<h3 style="color: #666; margin: 0 0 10px 0;">No Route Data Available</h3>' +
          '<p style="color: #888; margin: 0;">This track does not have GPS coordinate data yet. ' +
          (payload && payload.name ? 'Upload a GPX file to "' + payload.name + '" to display the route.' : 'Please upload a GPX file to display the route.') +
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

    DBG.log('Track data loaded', {
      coords: coords.length,
      photos: photos.length,
      hasTimestamps: !!timestamps,
      serverSimplified: !!(payload && payload.simplified)
    });

    if (!coords || coords.length < 2) {
      ui.error.textContent = 'No route data available.';
      ui.error.style.display = 'block';
      return;
    }

    // Optional resampling if very large (skip if backend already simplified)
    var serverSimplified = !!(payload && payload.simplified);
    var keptIndices = null;
    if (!serverSimplified && coords.length > 10000) {
      var pts = coords.map(function (c) { return [c[0], c[1]]; });
      var sqTol = chooseTolerance(pts, 1500);
      var res = simplifyDouglasPeucker(pts, sqTol);
      keptIndices = res.indices;
      coords = keptIndices.map(function (idx) { return payload.geojson.coordinates[idx]; });
      if (cumDist) cumDist = keptIndices.map(function (idx) { return props.cumulativeDistance[idx]; });
      if (timestamps) timestamps = keptIndices.map(function (idx) { return props.timestamps[idx]; });
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
    var timeOffsets = null;            // seconds from first valid timestamp (array parallel to coords)
    var movingTimeOffsets = null;      // optional filtered version (fallback = timeOffsets)
    var totalDuration = null;          // total moving time (seconds)
    var hasTimestamps = false;

    if (timestamps && Array.isArray(timestamps) && timestamps.length === coords.length) {
      try {
        // Find first valid timestamp as base
        var baseStr = null;
        for (var iTs0 = 0; iTs0 < timestamps.length; iTs0++) {
          if (timestamps[iTs0]) { baseStr = timestamps[iTs0]; break; }
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
            if (typeof timeOffsets[f1] === 'number') { lastSeen = timeOffsets[f1]; }
            else if (lastSeen != null) { timeOffsets[f1] = lastSeen; }
            else { timeOffsets[f1] = 0; }
          }
          totalDuration = lastValidSec;
          hasTimestamps = isFinite(totalDuration) && totalDuration > 0.5;
          movingTimeOffsets = timeOffsets.slice(); // (future: could compress pauses)
        }
      } catch(e) {
        timeOffsets = null;
        movingTimeOffsets = null;
        totalDuration = null;
        hasTimestamps = false;
      }
    }

    // --- Elevation & speed extrema (added) ---
    var maxElevVal = -Infinity;
    var maxElevIdx = -1;
    var maxSpeedVal = 0;   // m/s
    var maxSpeedIdx = -1;
    try {
      for (var ei = 0; ei < coords.length; ei++) {
        var elevVal = (typeof coords[ei][2] === 'number') ? coords[ei][2] : null;
        if (elevVal != null && isFinite(elevVal) && elevVal > maxElevVal) {
          maxElevVal = elevVal;
          maxElevIdx = ei;
        }
      }
      if (hasTimestamps && timeOffsets && timeOffsets.length === coords.length) {
        for (var si = 1; si < coords.length; si++) {
          var dt = Math.max(1e-3, (timeOffsets[si] - timeOffsets[si - 1]));
          if (!isFinite(dt) || dt <= 0) continue;
          var dd = Math.max(0, (cumDist[si] - cumDist[si - 1]));
          var sp = dd / dt; // m/s
          if (sp > maxSpeedVal) { maxSpeedVal = sp; maxSpeedIdx = si; }
        }
      }
    } catch(e) { /* speed calculation error */ }

    // New: dedupe photos by rounded location and precompute per-photo route distance (geo-first policy).
    (function preparePhotos() {
      if (!Array.isArray(photos) || photos.length === 0) return;
      var seen = Object.create(null);
      var unique = [];
      if (Array.isArray(cumDist) && cumDist.length === coords.length) {
        for (var i = 0; i < photos.length; i++) {
          var ph = photos[i];
          if (typeof ph.lat === 'number' && typeof ph.lon === 'number') {
            var key = getLocationKey(ph.lat, ph.lon);
            if (key && !seen[key]) {
              var idx = nearestCoordIndex([ph.lon, ph.lat], coords);
              ph._idx = idx;
              ph._distAlong = cumDist[idx]; // meters along the route
              unique.push(ph);
              seen[key] = true; // drop subsequent photos at same location (prevents flicker)
            } else {
              // duplicate location → skip
              // console.debug('[FGPX] drop duplicate photo at', ph.lat, ph.lon, key);
            }
          } else {
            // no GPS → keep; will fallback to timestamp if needed
            unique.push(ph);
          }
        }
        // Ensure geo-cued photos trigger in correct order
        unique.sort(function (a, b) {
          var da = (typeof a._distAlong === 'number') ? a._distAlong : Infinity;
          var db = (typeof b._distAlong === 'number') ? b._distAlong : Infinity;
          return da - db;
        });
      } else {
        // No route distance available → keep original list (will fall back to timestamp cues)
        unique = photos.slice();
      }
      photos = unique;
    })();

    DBG.log('photos after dedupe', photos.length);

    // Helper: map a distance along the route to an interpolated lng/lat
    function positionAtDistance(d) {
      var lo = 0, hi = cumDist.length - 1;
      while (lo < hi) {
        var mid = (lo + hi) >>> 1;
        if (cumDist[mid] < d) lo = mid + 1; else hi = mid;
      }
      var idx = Math.max(1, lo);
      var d0 = cumDist[idx - 1], d1 = cumDist[idx];
      var t = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
      var p0 = coords[idx - 1], p1 = coords[idx];
      return [lerp(p0[0], p1[0], t), lerp(p0[1], p1[1], t)];
    }

    var totalDistance = cumDist[cumDist.length - 1]; // meters

    // --- Privacy window (trim playback start/end by distance) ---
    var privacyEnabled = !!(window.FGPX && FGPX.privacyEnabled);
    var privacyMeters = Math.max(0, (window.FGPX && isFinite(Number(FGPX.privacyKm)) ? Number(FGPX.privacyKm) : 3) * 1000);
    var privacyStartD = 0;
    var privacyEndD = totalDistance;
    if (privacyEnabled && privacyMeters > 0) {
      privacyStartD = Math.min(totalDistance, privacyMeters);
      privacyEndD = Math.max(privacyStartD, totalDistance - privacyMeters);
      if ((privacyEndD - privacyStartD) < 10) { privacyEnabled = false; privacyStartD = 0; privacyEndD = totalDistance; }
    }
    var privacyStartP = privacyStartD / totalDistance;
    var privacyEndP = privacyEndD / totalDistance;

    // Compute initial bounds (privacy-trimmed if enabled) BEFORE map creation so we avoid a visible re-fit flash
    var fullBounds = (Array.isArray(bounds) && bounds.length === 4)
      ? [[bounds[0], bounds[1]], [bounds[2], bounds[3]]]
      : boundsFromCoords(coords);

    // Derive innerBounds (privacy window) early (duplicated logic from later; kept minimal)
    var innerBounds = null;
    if (privacyEnabled && (privacyStartD > 0 || privacyEndD < totalDistance)) {
      try {
        var p0_priv = positionAtDistance(privacyStartD);
        var p1_priv = positionAtDistance(privacyEndD);
        var loIB = 0, hiIB = cumDist.length - 1;
        while (loIB < hiIB) { var midIB = (loIB + hiIB) >>> 1; if (cumDist[midIB] < privacyStartD) loIB = midIB + 1; else hiIB = midIB; }
        var startIdxIB = Math.max(0, loIB - 1);
        loIB = 0; hiIB = cumDist.length - 1;
        while (loIB < hiIB) { var midIB2 = (loIB + hiIB) >>> 1; if (cumDist[midIB2] < privacyEndD) loIB = midIB2 + 1; else hiIB = midIB2; }
        var endIdxIB = Math.max(startIdxIB + 1, loIB);
        var segIB = coords.slice(startIdxIB, endIdxIB + 1).map(function(c){ return c.slice(0,2); });
        if (segIB.length > 0) { segIB[0] = p0_priv.slice(0,2); segIB[segIB.length - 1] = p1_priv.slice(0,2); }
        innerBounds = boundsFromCoords(segIB);
      } catch(e) { innerBounds = null; }
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
    var defaultZoomSetting = (window.FGPX && isFinite(Number(FGPX.defaultZoom))) ? Number(FGPX.defaultZoom) : 11;

    var initialStyle = inlineStyle || ((style === 'vector' && styleUrl) ? styleUrl : buildOSMRasterStyle());

    // Prefetch master switch (default true if undefined)
    var prefetchEnabled = !(window.FGPX && FGPX.prefetchEnabled === false);

    try { 
      if (prefetchEnabled && window.maplibregl && typeof window.maplibregl.prewarm === 'function') {
        window.maplibregl.prewarm();
      }
    } catch (_) {}

    var map = new window.maplibregl.Map({
      container: ui.mapEl,
      style: initialStyle,
      bounds: initialBounds,                // sets initial camera to full (or privacy) route extent
      fitBoundsOptions: { padding: 40 },    // mimic later fitBounds padding
      pitch: (window.FGPX && isFinite(Number(FGPX.defaultPitch)) ? Number(FGPX.defaultPitch) : 30),
      prefetchZoomDelta: prefetchEnabled ? 4 : 0,
      fadeDuration: 350,
      antialias: false,
      refreshExpiredTiles: false,
      renderWorldCopies: false,
      maxTileCacheSize: prefetchEnabled ? 2048 : 512, // tighter cache when disabled
      crossSourceCollisions: false,
      localIdeographFontFamily: 'sans-serif'
    });
    map.addControl(new window.maplibregl.NavigationControl({ showCompass: true }));

    DBG.log('map created', { prefetchEnabled: prefetchEnabled, defaultZoom: defaultZoomSetting });

    // Allow user-initiated zoom/rotate while playing by pausing our camera writes briefly
    var userInteracting = false;
    var userInteractTimer = null;
    function markUserInteracting() {
      userInteracting = true;
      if (userInteractTimer) { clearTimeout(userInteractTimer); userInteractTimer = null; }
    }
    function clearUserInteractingSoon() {
      if (userInteractTimer) { clearTimeout(userInteractTimer); }
      userInteractTimer = setTimeout(function(){ userInteracting = false; }, 500);
    }
    try {
      map.on('movestart', function(e){ if (e && e.originalEvent) markUserInteracting(); });
      map.on('moveend', function(){ clearUserInteractingSoon(); });
      map.on('zoomstart', function(e){ if (e && e.originalEvent) markUserInteracting(); });
      map.on('zoomend', function(){ clearUserInteractingSoon(); });
      map.on('rotatestart', function(e){ if (e && e.originalEvent) markUserInteracting(); });
      map.on('rotateend', function(){ clearUserInteractingSoon(); });
    } catch(_) {}

    // Vector URL style: try once; no global error-based fallback to avoid mid-run style resets
    if (!inlineStyle && style === 'vector' && styleUrl) {
      // URL vector style path
      try {
        map.setStyle(styleUrl);
      } catch (err) {
        DBG.warn('Failed to set vector style; falling back to OSM raster', err);
        map.setStyle(buildOSMRasterStyle());
      }
      // Enhance vector: optionally bump pitch if buildings layer exists
      map.on('styledata', function () {
        try {
          var hasBuildings = false;
          var st = map.getStyle();
          var layers = (st && st.layers) ? st.layers : [];
          for (var i = 0; i < layers.length; i++) {
            var lid = layers[i] && layers[i].id ? String(layers[i].id) : '';
            if (lid.indexOf('building') !== -1) { hasBuildings = true; break; }
          }
          if (hasBuildings) { map.setPitch(65); }
        } catch (e2) { /* no-op */ }
      });
    }

    // Prepare GeoJSON source for the route and a separate source for the moving point
    var routeData = { type: 'Feature', id: 'route', geometry: { type: 'LineString', coordinates: coords }, properties: {} };
    var initialPoint = privacyEnabled ? positionAtDistance(privacyStartD) : coords[0].slice(0, 2);
    var pointData = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: initialPoint } }] };

    // Add error handling for tile loading failures
    map.on('error', function(e) {
      if (e && e.error && e.error.status >= 500) {
        DBG.warn('Map tile server error (will retry automatically):', e.error.status, e.error.url);
      } else {
        DBG.warn('Map error:', e);
      }
    });

    map.once('load', function () {
      DBG.log('map load event');

      // If inline style contains a raster-dem source, enable terrain automatically
      var pendingTerrainSourceId = null;
      try {
        if (inlineStyle) {
          var st = map.getStyle();
          var srcs = (st && st.sources) ? st.sources : {};
          for (var sid in srcs) {
            if (Object.prototype.hasOwnProperty.call(srcs, sid)) {
              var sdef = srcs[sid];
              if (sdef && sdef.type === 'raster-dem') { pendingTerrainSourceId = sid; break; }
            }
          }
        }
      } catch (_) {}
      // Elevation-based coloring helpers
      function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
      function hexToRgb(hex) {
        hex = (hex || '').replace('#', '');
        if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        return {
          r: parseInt(hex.substr(0, 2), 16),
          g: parseInt(hex.substr(2, 2), 16),
          b: parseInt(hex.substr(4, 2), 16)
        };
      }
      function rgbToHex(r, g, b) {
        return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
      }
      function blendHex(hex1, hex2, alpha) {
        var rgb1 = hexToRgb(hex1);
        var rgb2 = hexToRgb(hex2);
        var r = Math.round(rgb1.r + (rgb2.r - rgb1.r) * alpha);
        var g = Math.round(rgb1.g + (rgb2.g - rgb1.g) * alpha);
        var b = Math.round(rgb1.b + (rgb2.b - rgb1.b) * alpha);
        return rgbToHex(r, g, b);
      }

      // Calculate elevation gradients
      function calculateGradients(coords, cumDist) {
        var gradients = [];
        for (var i = 0; i < coords.length; i++) {
          if (i === 0) {
            gradients.push(0);
            continue;
          }
          var elevDiff = (coords[i][2] || 0) - (coords[i-1][2] || 0);
          var distDiff = (cumDist[i] || 0) - (cumDist[i-1] || 0);
          var gradient = distDiff > 0 ? (elevDiff / distDiff) * 100 : 0; // percentage grade
          gradients.push(Math.abs(gradient)); // use absolute value for coloring
        }
        return gradients;
      }

      // Smooth gradients to reduce noise
      function smoothGradients(gradients, windowSize) {
        var smoothed = [];
        var halfWindow = Math.floor(windowSize / 2);
        for (var i = 0; i < gradients.length; i++) {
          var sum = 0;
          var count = 0;
          for (var j = Math.max(0, i - halfWindow); j <= Math.min(gradients.length - 1, i + halfWindow); j++) {
            sum += gradients[j];
            count++;
          }
          smoothed.push(count > 0 ? sum / count : 0);
        }
        return smoothed;
      }

      // Route source: if privacy enabled, show only trimmed segment to avoid revealing real start/end
      var baseCoords = coords.map(function(c){ return c.slice(0,2); });
      var elevationColoring = !!(window.FGPX && FGPX.elevationColoring);
      var elevColorThreshold = parseFloat((window.FGPX && FGPX.elevColorThreshold) || '3'); // 3% grade threshold
      var elevColorMax = parseFloat((window.FGPX && FGPX.elevColorMax) || '8'); // 8% grade for full red
      
      if (privacyEnabled) {
        try {
          var startIdx = windowStartIdx;
          var endIdx = windowEndIdx;
          var pStart = positionAtDistance(privacyStartD);
          var pEnd = positionAtDistance(privacyEndD);
          var segBase = baseCoords.slice(startIdx, endIdx + 1);
          if (segBase.length > 0) { segBase[0] = pStart.slice(0,2); segBase[segBase.length - 1] = pEnd.slice(0,2); }
          baseCoords = segBase;
        } catch(_) {}
      }

      // Standard single-color background route (faint)
      // Apply light spline smoothing to the background route for nicer curves
      try {
        var baseSmoothed = smoothPolyline(baseCoords, 1);
        routeData.geometry.coordinates = baseSmoothed;
      } catch(_) {
        routeData.geometry.coordinates = baseCoords;
      }
      map.addSource('fgpx-route', { type: 'geojson', data: routeData, lineMetrics: true });
      // Background route (faint)
      map.addLayer({ id: 'fgpx-route-line', type: 'line', source: 'fgpx-route', paint: { 'line-color': '#cccccc', 'line-width': 2 } });

      // Prepare elevation coloring data for progressive route
      var elevationColoringEnabled = !!(window.FGPX && FGPX.elevationColoring);
      var progressiveGradients = null;
      var progressiveSmoothedGradients = null;
      var progressiveBaseColor = (window.FGPX && FGPX.elevationColorFlat) || '#ff5500';
      var progressiveSteepColor = (window.FGPX && FGPX.elevationColorSteep) || '#ff0000';
      var progressiveSegmentCounter = 0;
      
      if (elevationColoringEnabled && coords.length > 1) {
        progressiveGradients = calculateGradients(coords, cumDist);
        progressiveSmoothedGradients = smoothGradients(progressiveGradients, 5);
      }

      // Helper function to clean up progressive segments
      function cleanupProgressiveSegments() {
        if (typeof window.__fgpxProgressSegments !== 'undefined') {
          for (var segIdx = 0; segIdx < window.__fgpxProgressSegments.length; segIdx++) {
            try {
              map.removeLayer('fgpx-progress-segment-' + segIdx);
              map.removeSource('fgpx-progress-segment-' + segIdx);
            } catch(_) {}
          }
          window.__fgpxProgressSegments = [];
        }
      }

      // Helper function to create elevation-colored progressive segments
      function createProgressiveSegments(coordsUpTo, startIdx) {
        if (!elevationColoringEnabled || !progressiveSmoothedGradients) {
          return null; // Use single-color progressive route
        }
        
        var segments = [];
        var currentSegment = [];
        var currentGradeBucket = null;
        
        for (var i = 0; i < coordsUpTo.length; i++) {
          var gradientIdx = startIdx + i;
          var gradient = progressiveSmoothedGradients[Math.min(gradientIdx, progressiveSmoothedGradients.length - 1)] || 0;
          
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
              gradeBucket: currentGradeBucket
            });
            currentSegment = [coordsUpTo[i-1]]; // Start new segment with overlap
            currentGradeBucket = gradeBucket;
          }
          
          currentSegment.push(coordsUpTo[i]);
        }
        
        // Add final segment
        if (currentSegment.length > 1) {
          segments.push({
            coordinates: currentSegment,
            gradeBucket: currentGradeBucket
          });
        }
        
        return segments;
      }

      // Foreground progressive route (stable per-frame GeoJSON)
      var progressData = { type: 'Feature', geometry: { type: 'LineString', coordinates: [(privacyEnabled ? positionAtDistance(privacyStartD) : coords[0].slice(0,2))] } };
      map.addSource('fgpx-route-progress', { type: 'geojson', data: progressData });
      map.addLayer({ id: 'fgpx-route-progress-line', type: 'line', source: 'fgpx-route-progress', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ff5500', 'line-width': 4, 'line-blur': 0.3 } });

      // Create colored arrow icons for different wind speeds and sizes
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
        ctx.moveTo(center, 12 * scale);  // Arrow tip (top center)
        ctx.lineTo(center + 18 * scale, 30 * scale);  // Right side of arrow head
        ctx.lineTo(center + 9 * scale, 30 * scale);   // Right inner corner
        ctx.lineTo(center + 9 * scale, 60 * scale);   // Right side of shaft
        ctx.lineTo(center - 9 * scale, 60 * scale);   // Bottom right of shaft
        ctx.lineTo(center - 9 * scale, 30 * scale);   // Left side of shaft
        ctx.lineTo(center - 18 * scale, 30 * scale);  // Left inner corner
        ctx.lineTo(center, 12 * scale);  // Back to arrow tip
        ctx.closePath();
        
        ctx.fill();
        ctx.stroke();
        
        return canvas;
      }
      
      // Create multiple colored arrow icons in different sizes
      try {
        var windColors = [
          { name: 'calm', color: '#666666' },      // Dark gray for calm
          { name: 'light', color: '#228b22' },     // Forest green for light breeze
          { name: 'moderate', color: '#ff8c00' },  // Dark orange for moderate wind
          { name: 'strong', color: '#ff4500' },    // Red orange for strong wind
          { name: 'very-strong', color: '#dc143c' } // Crimson for very strong wind
        ];
        
        var sizes = [72, 54, 36, 24, 18]; // Main arrow and 4 smaller sizes for circle
        
        windColors.forEach(function(windColor) {
          sizes.forEach(function(size, sizeIndex) {
            var canvas = createArrowIcon(windColor.color, size);
            var ctx = canvas.getContext('2d');
            var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            
            var iconData = {
              width: canvas.width,
              height: canvas.height,
              data: imageData.data
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
      var weatherEnabled = !!(window.FGPX && FGPX.weatherEnabled);
      var weatherOpacity = (window.FGPX && isFinite(Number(FGPX.weatherOpacity))) ? Number(FGPX.weatherOpacity) : 0.7;
      var weatherData = (payload && payload.weather) ? payload.weather : null;
      
      // ========== DEBUG WEATHER DATA ==========
      // Add debug weather data when enabled in admin settings
      if (window.FGPX && FGPX.debugWeatherData) {
        // If no weather data exists or it's empty, create weather points from track coordinates
        if (!weatherData || !weatherData.features || !Array.isArray(weatherData.features) || weatherData.features.length === 0) {
          if (payload && payload.geojson && payload.geojson.geometry && payload.geojson.geometry.coordinates) {
            var coordinates = payload.geojson.geometry.coordinates;
            weatherData = {
              type: "FeatureCollection",
              features: []
            };
            
            // Create weather points from track coordinates (sample every 10th point to avoid too many)
            var step = Math.max(1, Math.floor(coordinates.length / 100)); // Max 100 weather points
            for (var i = 0; i < coordinates.length; i += step) {
              weatherData.features.push({
                type: "Feature",
                geometry: {
                  type: "Point",
                  coordinates: [coordinates[i][0], coordinates[i][1]]
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
                  source: "debug-simulation"
                }
              });
            }
          }
        }
        
        // Run simulation on weather data (existing or newly created)
        if (weatherData && weatherData.features && Array.isArray(weatherData.features) && weatherData.features.length > 0) {
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
                  var falloff = 1 - (distance / cluster.radius);
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
              
              switch(scenario) {
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
              var relativeHumidity = 100 * Math.exp((17.625 * dewPoint) / (243.04 + dewPoint)) / 
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
                cloudCover += (Math.random() * 20 - 10); // Add variation ±10%
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
              var baseWindDir = 180 + (i * 2) % 360; // Slowly rotating
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
            payload.weatherSummary.avg_mm = Math.round((totalRain / weatherData.features.length) * 10) / 10;
            payload.weatherSummary.wet_points = wetPoints;
            payload.weatherSummary.total_points = weatherData.features.length;
          }
          
          // Calculate statistics for all weather types
          var rainCoverage = Math.round((wetPoints / weatherData.features.length) * 100);
          var snowPoints = weatherData.features.filter(f => f.properties.snowfall_cm > 0).length;
          var fogPoints = weatherData.features.filter(f => f.properties.fog_intensity > 0.3).length;
          var cloudyPoints = weatherData.features.filter(f => f.properties.cloud_cover_pct > 50).length;
          
          DBG.log('DEBUG: ===== MULTI-WEATHER SIMULATION =====');
          DBG.log('DEBUG: Total weather points:', weatherData.features.length);
          DBG.log('DEBUG: Rain coverage:', rainCoverage + '% (' + wetPoints + '/' + weatherData.features.length + ' points)');
          DBG.log('DEBUG: Snow points:', snowPoints + ' (' + Math.round(snowPoints / weatherData.features.length * 100) + '%)');
          DBG.log('DEBUG: Fog points:', fogPoints + ' (' + Math.round(fogPoints / weatherData.features.length * 100) + '%)');
          DBG.log('DEBUG: Cloudy points (>50%):', cloudyPoints + ' (' + Math.round(cloudyPoints / weatherData.features.length * 100) + '%)');
          DBG.log('DEBUG: Rain clusters:', rainClusters.length, 'with avg intensity:', Math.round(rainClusters.reduce((sum, c) => sum + c.intensity, 0) / rainClusters.length * 100) / 100);
          
        } catch (e) {
          DBG.warn('DEBUG: Failed to add debug weather data:', e);
        }
        }
      }
      
      // Add debug biometric data (heart rate, cadence, temperature) if enabled and not already present
      if (window.FGPX && FGPX.debugWeatherData) {
        DBG.log('DEBUG: Biometric simulation enabled, checking payload structure...');
        DBG.log('DEBUG: payload exists:', !!payload);
        DBG.log('DEBUG: payload.geojson exists:', !!(payload && payload.geojson));
        DBG.log('DEBUG: payload.geojson.properties exists:', !!(payload && payload.geojson && payload.geojson.properties));
      }
      
      if (window.FGPX && FGPX.debugWeatherData && payload && payload.geojson && payload.geojson.properties) {
        try {
          // Use existing props and timestamps variables (already defined at lines 711 and 728)
          // No redeclaration to avoid hoisting issues that cause undefined errors
          // Check if data exists AND has meaningful values (not just zeros/nulls)
          var hasHeartRates = props.heartRates && props.heartRates.length > 0 && props.heartRates.some(function(hr) { return hr && hr > 0; });
          var hasCadences = props.cadences && props.cadences.length > 0 && props.cadences.some(function(cad) { return cad && cad > 0; });
          var hasTemperatures = props.temperatures && props.temperatures.length > 0 && props.temperatures.some(function(temp) { return temp && temp !== 0; });
          var hasPowers = props.powers && props.powers.length > 0 && props.powers.some(function(pow) { return pow && pow > 0; });
          
          DBG.log('DEBUG: Biometric data check - HR:', hasHeartRates, 'Cadence:', hasCadences, 'Temp:', hasTemperatures, 'Power:', hasPowers);
          DBG.log('DEBUG: Timestamps available:', !!(timestamps && timestamps.length > 0), 'Count:', timestamps ? timestamps.length : 0);
          
          // Debug actual data content
          DBG.log('DEBUG: HR data:', props.heartRates ? 'Length: ' + props.heartRates.length + ', Sample: [' + (props.heartRates.slice(0,3).join(',')) + '...]' : 'null/undefined');
          DBG.log('DEBUG: Cadence data:', props.cadences ? 'Length: ' + props.cadences.length + ', Sample: [' + (props.cadences.slice(0,3).join(',')) + '...]' : 'null/undefined');
          DBG.log('DEBUG: Temp data:', props.temperatures ? 'Length: ' + props.temperatures.length + ', Sample: [' + (props.temperatures.slice(0,3).join(',')) + '...]' : 'null/undefined');
          DBG.log('DEBUG: Power data:', props.powers ? 'Length: ' + props.powers.length + ', Sample: [' + (props.powers.slice(0,3).join(',')) + '...]' : 'null/undefined');
          
          if (timestamps && timestamps.length > 0) {
            // Add realistic heart rate data if not present
            if (!hasHeartRates) {
              var heartRates = [];
              var baseHR = 140 + Math.random() * 40; // Base HR 140-180 bpm
              var currentHR = baseHR;
              
              for (var i = 0; i < timestamps.length; i++) {
                // Simulate realistic heart rate variations
                var variation = (Math.random() - 0.5) * 10; // ±5 bpm variation
                var trend = Math.sin(i / timestamps.length * Math.PI * 2) * 15; // Gradual trend
                
                currentHR = Math.max(120, Math.min(200, baseHR + trend + variation));
                heartRates.push(Math.round(currentHR));
              }
              
              props.heartRates = heartRates;
              DBG.log('DEBUG: Added realistic heart rate data (' + heartRates.length + ' points, range: ' + 
                     Math.min(...heartRates) + '-' + Math.max(...heartRates) + ' bpm)');
            }
            
            // Add realistic cadence data if not present
            if (!hasCadences) {
              var cadences = [];
              var baseCadence = 80 + Math.random() * 20; // Base cadence 80-100 rpm
              var currentCadence = baseCadence;
              
              for (var i = 0; i < timestamps.length; i++) {
                // Simulate realistic cadence variations
                var variation = (Math.random() - 0.5) * 8; // ±4 rpm variation
                var trend = Math.sin(i / timestamps.length * Math.PI * 3) * 10; // More frequent changes
                
                currentCadence = Math.max(60, Math.min(120, baseCadence + trend + variation));
                cadences.push(Math.round(currentCadence));
              }
              
              props.cadences = cadences;
              DBG.log('DEBUG: Added realistic cadence data (' + cadences.length + ' points, range: ' + 
                     Math.min(...cadences) + '-' + Math.max(...cadences) + ' rpm)');
            }
            
            // Add realistic temperature data if not present
            if (!hasTemperatures) {
              var temperatures = [];
              var baseTemp = 18 + Math.random() * 8; // Base temperature 18-26°C
              var currentTemp = baseTemp;
              
              for (var i = 0; i < timestamps.length; i++) {
                // Simulate realistic temperature variations
                var variation = (Math.random() - 0.5) * 2; // ±1°C variation
                var trend = Math.sin(i / timestamps.length * Math.PI * 1.5) * 3; // Gradual temperature changes
                var timeOfDay = Math.sin(i / timestamps.length * Math.PI * 4) * 2; // Simulate daily temperature cycle
                
                currentTemp = Math.max(10, Math.min(35, baseTemp + trend + timeOfDay + variation));
                temperatures.push(Math.round(currentTemp * 10) / 10); // Round to 1 decimal place
              }
              
              props.temperatures = temperatures;
              DBG.log('DEBUG: Added realistic temperature data (' + temperatures.length + ' points, range: ' + 
                     Math.min(...temperatures) + '-' + Math.max(...temperatures) + ' °C)');
            }
            
            // Add realistic power data if not present
            if (!hasPowers) {
              var powers = [];
              var basePower = 180 + Math.random() * 120; // Base power 180-300 watts
              var currentPower = basePower;
              
              for (var i = 0; i < timestamps.length; i++) {
                // Simulate realistic power variations
                var variation = (Math.random() - 0.5) * 40; // ±20W variation
                var effort = Math.sin(i / timestamps.length * Math.PI * 6) * 50; // Simulate intervals/hills
                var fatigue = (i / timestamps.length) * -30; // Gradual fatigue over time
                
                currentPower = Math.max(80, Math.min(500, basePower + effort + fatigue + variation));
                powers.push(Math.round(currentPower));
              }
              
              props.powers = powers;
              DBG.log('DEBUG: Added realistic power data (' + powers.length + ' points, range: ' + 
                     Math.min(...powers) + '-' + Math.max(...powers) + ' watts)');
            }
          }
        } catch (e) {
          DBG.warn('DEBUG: Failed to add debug biometric data:', e);
        }
      }
      // ========== END DEBUG WEATHER DATA ==========
      
      // Extract biometric data after simulation (so we get simulated data if it was generated)
      var heartRates = Array.isArray(props.heartRates) ? props.heartRates : null; // bpm
      var cadences = Array.isArray(props.cadences) ? props.cadences : null; // rpm
      var temperatures = Array.isArray(props.temperatures) ? props.temperatures : null; // °C
      var powers = Array.isArray(props.powers) ? props.powers : null; // watts
      
      DBG.log('DEBUG: Final biometric data after simulation - HR:', !!heartRates, 'Cadence:', !!cadences, 'Temp:', !!temperatures, 'Power:', !!powers);
      
      // ========== LAZY LOADING OPTIMIZATION ==========
      // Cache for processed chart data to avoid reprocessing
      var chartDataCache = {
        elevation: null,
        speed: null,
        heartRate: null,
        cadence: null,
        temperature: null,
        power: null,
        windSpeed: null,
        windImpact: null,
        windDirection: null,
        processed: {}
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
            chartDataCache.elevation = xVals.map(function(x, idx) {
              return { x: x, y: (coords[idx] && typeof coords[idx][2] === 'number') ? coords[idx][2] : 0 };
            });
            break;
            
          case 'speed':
            chartDataCache.speed = speedSeries ? xVals.map(function(x, idx) {
              return { x: x, y: speedSeries[idx] || 0 };
            }).filter(function(p) { return p.y > 0; }) : [];
            break;
            
          case 'heartRate':
            chartDataCache.heartRate = (Array.isArray(heartRates)) ? xVals.map(function(x, idx) {
              return { x: x, y: heartRates[idx] || 0 };
            }).filter(function(p) { return p.y > 0; }) : [];
            break;
            
          case 'cadence':
            chartDataCache.cadence = (Array.isArray(cadences)) ? xVals.map(function(x, idx) {
              return { x: x, y: cadences[idx] || 0 };
            }).filter(function(p) { return p.y > 0; }) : [];
            break;
            
          case 'temperature':
            chartDataCache.temperature = (Array.isArray(temperatures)) ? xVals.map(function(x, idx) {
              return { x: x, y: temperatures[idx] };
            }).filter(function(p) { return p.y !== null && p.y !== undefined && !isNaN(p.y); }) : [];
            break;
            
          case 'power':
            chartDataCache.power = (Array.isArray(powers)) ? xVals.map(function(x, idx) {
              return { x: x, y: powers[idx] || 0 };
            }).filter(function(p) { return p.y > 0; }) : [];
            break;
            
          case 'windSpeed':
            chartDataCache.windSpeed = (Array.isArray(windSpeeds)) ? xVals.map(function(x, idx) {
              return { x: x, y: windSpeeds[idx] || 0 };
            }).filter(function(p) { return p.y > 0; }) : [];
            break;
            
          case 'windImpact':
            chartDataCache.windImpact = (Array.isArray(windImpacts) && Array.isArray(speedSeries)) ? xVals.map(function(x, idx) {
              var impact = windImpacts[idx];
              var currentSpeed = speedSeries[idx];
              if (impact && currentSpeed && currentSpeed > 0) {
                return { x: x, y: (impact - 1.0) * currentSpeed };
              }
              return null;
            }).filter(function(p) { return p !== null; }) : [];
            break;
            
          case 'windDirection':
            // Wind direction data is processed differently (for polar chart)
            chartDataCache.windDirection = Array.isArray(windDirections) ? windDirections : [];
            break;
        }
        
        var processingTime = performance.now() - startTime;
        DBG.log('Chart data processed for ' + dataType + ' in ' + Math.round(processingTime) + 'ms', {
          dataPoints: chartDataCache[dataType] ? chartDataCache[dataType].length : 0
        });
        
        return chartDataCache[dataType];
      }
      
      if (weatherEnabled && weatherData && weatherData.features && Array.isArray(weatherData.features) && weatherData.features.length > 0) {
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
            colors: { snow: colorSnow, rain: colorRain, fog: colorFog, clouds: colorClouds }
          });
          
          // Helper to create color ramp from base color
          function createHeatmapColorRamp(baseColor) {
            var rgb = {
              r: parseInt(baseColor.slice(1, 3), 16),
              g: parseInt(baseColor.slice(3, 5), 16),
              b: parseInt(baseColor.slice(5, 7), 16)
            };
            return [
              'interpolate', ['linear'], ['heatmap-density'],
              0, 'rgba(255,255,255,0)',
              0.2, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.4)',
              0.4, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.6)',
              0.6, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.75)',
              0.8, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.85)',
              1, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',1)'
            ];
          }
          
          // Base heatmap config (shared by all weather types)
          var baseHeatmapConfig = {
            'heatmap-intensity': [
              'interpolate', ['linear'], ['zoom'],
              0, 1,
              9, 3
            ],
            'heatmap-radius': [
              'interpolate', ['linear'], ['zoom'],
              0, (window.FGPX && FGPX.weatherHeatmapRadius && FGPX.weatherHeatmapRadius.zoom0) || 20,
              9, (window.FGPX && FGPX.weatherHeatmapRadius && FGPX.weatherHeatmapRadius.zoom9) || 200,
              12, (window.FGPX && FGPX.weatherHeatmapRadius && FGPX.weatherHeatmapRadius.zoom12) || 1000,
              14, (window.FGPX && FGPX.weatherHeatmapRadius && FGPX.weatherHeatmapRadius.zoom14) || 3000,
              15, (window.FGPX && FGPX.weatherHeatmapRadius && FGPX.weatherHeatmapRadius.zoom15) || 5000
            ],
            'heatmap-opacity': [
              'interpolate', ['linear'], ['zoom'],
              0, weatherOpacity,
              15, weatherOpacity,
              17, 0
            ]
          };
          
          // Add snow heatmap layer (highest priority - rendered last/on top)
          map.addLayer({
            id: 'fgpx-weather-heatmap-snow',
            type: 'heatmap',
            source: 'fgpx-weather',
            filter: ['>', ['coalesce', ['get', 'snowfall_cm'], 0], 0.1],
            layout: {
              'visibility': initialWeatherVisible ? 'visible' : 'none'
            },
            paint: Object.assign({
              'heatmap-weight': ['/', ['coalesce', ['get', 'snowfall_cm'], 0], 5],
              'heatmap-color': createHeatmapColorRamp(colorSnow)
            }, baseHeatmapConfig)
          });
          
          // Add rain heatmap layer
          map.addLayer({
            id: 'fgpx-weather-heatmap-rain',
            type: 'heatmap',
            source: 'fgpx-weather',
            filter: ['all',
              ['<=', ['coalesce', ['get', 'snowfall_cm'], 0], 0.1], // No snow
              ['>', ['coalesce', ['get', 'rain_mm'], 0], 0.1]
            ],
            layout: {
              'visibility': initialWeatherVisible ? 'visible' : 'none'
            },
            paint: Object.assign({
              'heatmap-weight': ['/', ['coalesce', ['get', 'rain_mm'], 0], 8],
              'heatmap-color': createHeatmapColorRamp(colorRain)
            }, baseHeatmapConfig)
          });
          
          // Add fog heatmap layer
          map.addLayer({
            id: 'fgpx-weather-heatmap-fog',
            type: 'heatmap',
            source: 'fgpx-weather',
            filter: ['all',
              ['<=', ['coalesce', ['get', 'snowfall_cm'], 0], 0.1], // No snow
              ['<=', ['coalesce', ['get', 'rain_mm'], 0], 0.1],      // No rain
              ['>', ['coalesce', ['get', 'fog_intensity'], 0], fogThreshold]
            ],
            layout: {
              'visibility': initialWeatherVisible ? 'visible' : 'none'
            },
            paint: Object.assign({
              'heatmap-weight': ['coalesce', ['get', 'fog_intensity'], 0],
              'heatmap-color': createHeatmapColorRamp(colorFog)
            }, baseHeatmapConfig)
          });
          
          // Add clouds heatmap layer (lowest priority)
          map.addLayer({
            id: 'fgpx-weather-heatmap-clouds',
            type: 'heatmap',
            source: 'fgpx-weather',
            filter: ['all',
              ['<=', ['coalesce', ['get', 'snowfall_cm'], 0], 0.1],
              ['<=', ['coalesce', ['get', 'rain_mm'], 0], 0.1],
              ['<=', ['coalesce', ['get', 'fog_intensity'], 0], fogThreshold],
              ['>', ['coalesce', ['get', 'cloud_cover_pct'], 0], 50]
            ],
            layout: {
              'visibility': initialWeatherVisible ? 'visible' : 'none'
            },
            paint: Object.assign({
              'heatmap-weight': ['/', ['coalesce', ['get', 'cloud_cover_pct'], 0], 100],
              'heatmap-color': createHeatmapColorRamp(colorClouds)
            }, baseHeatmapConfig)
          });

          // Add rain circle layer for higher zoom levels (rain only, like old implementation)
          // Uses hardcoded radius sizes based on rain intensity (sharp edges, no blur)
          map.addLayer({
            id: 'fgpx-weather-circle',
            type: 'circle',
            source: 'fgpx-weather',
            minzoom: 12,
            layout: {
              'visibility': initialWeatherVisible ? 'visible' : 'none'
            },
            paint: {
              // Size circle radius by RAIN intensity only (hardcoded like old implementation)
              'circle-radius': [
                'interpolate', ['linear'], ['zoom'],
                12, ['interpolate', ['linear'], ['get', 'rain_mm'], 0, 3, 8, 8],
                18, ['interpolate', ['linear'], ['get', 'rain_mm'], 0, 8, 8, 25]
              ],
              // Color by rain intensity - blue tones for rain (same as old)
              'circle-color': [
                'case',
                ['>', ['get', 'rain_mm'], 0],
                [
                  'interpolate', ['linear'], ['get', 'rain_mm'],
                  0.1, 'rgba(173,216,230,0.7)',
                  2, 'rgba(135,206,250,0.8)',
                  4, 'rgba(65,105,225,0.8)',
                  8, 'rgba(0,0,139,0.9)'
                ],
                'rgba(255,255,255,0)'
              ],
              // Stroke for circles (same as old)
              'circle-stroke-color': [
                'case',
                ['>', ['get', 'rain_mm'], 0],
                'rgba(255,255,255,0.8)',
                'rgba(100,100,100,0.6)'
              ],
              'circle-stroke-width': [
                'interpolate', ['linear'], ['zoom'],
                12, 1,
                18, 2
              ],
              // Transition from transparent to visible (same as old)
              'circle-opacity': [
                'interpolate', ['linear'], ['zoom'],
                12, 0,
                13, weatherOpacity
              ]
            }
          });

          // Add temperature visualization layer
          map.addLayer({
            id: 'fgpx-temperature-circle',
            type: 'circle',
            source: 'fgpx-weather',
            minzoom: 12,
            layout: {
              'visibility': 'none' // Start hidden
            },
            paint: {
              'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                12, 8,
                16, 20
              ],
              'circle-color': [
                'case',
                ['!=', ['get', 'temperature_c'], null],
                [
                  'interpolate',
                  ['linear'],
                  ['get', 'temperature_c'],
                  -20, '#0000ff', // Deep blue for very cold
                  -10, '#4169e1', // Royal blue
                  0, '#87ceeb',   // Sky blue
                  10, '#90ee90',  // Light green
                  20, '#ffff00',  // Yellow
                  25, '#ffa500',  // Orange
                  30, '#ff4500',  // Red orange
                  35, '#ff0000',  // Red
                  40, '#8b0000'   // Dark red for very hot
                ],
                '#cccccc' // Gray for missing data
              ],
              'circle-stroke-width': 1,
              'circle-stroke-color': '#ffffff',
              'circle-opacity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                12, 0,
                13, weatherOpacity
              ]
            }
          });

          // Add temperature text labels layer (with glyph availability check)
          var hasGlyphs = false;
          try {
            // Check if the map style has glyphs available
            var style = map.getStyle();
            hasGlyphs = style && style.glyphs;
            DBG.log('Map style has glyphs:', hasGlyphs, 'Style glyphs URL:', style ? style.glyphs : 'none');
          } catch (e) {
            DBG.warn('Could not check glyph availability:', e);
          }
          
          if (hasGlyphs) {
            try {
              map.addLayer({
                id: 'fgpx-temperature-text',
                type: 'symbol',
                source: 'fgpx-weather',
                minzoom: 12,
                layout: {
                  'visibility': 'none', // Start hidden
                  'text-field': [
                    'case',
                    ['!=', ['get', 'temperature_c'], null],
                    ['concat', ['round', ['get', 'temperature_c']], '°C'],
                    ''
                  ],
                  'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
              'text-size': [
                'interpolate',
                ['linear'],
                ['zoom'],
                12, 10,
                16, 14
              ],
              'text-allow-overlap': true,
              'text-ignore-placement': true
            },
            paint: {
              'text-color': '#000000',
              'text-halo-color': '#ffffff',
              'text-halo-width': 2,
              'text-opacity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                12, 0,
                13, 1
              ]
            }
          });
            } catch (e) {
              DBG.warn('Failed to add temperature text layer:', e);
            }
          } else {
            DBG.log('Temperature text layer skipped - no glyphs available in map style');
          }

          // Add wind arrows layer - wait for colored icons to be loaded
          setTimeout(function() {
            if (map.hasImage('arrow-calm')) {
              // Main center arrow
              map.addLayer({
                id: 'fgpx-wind-arrows',
                type: 'symbol',
                source: 'fgpx-weather',
                minzoom: 12,
                filter: ['!=', ['get', 'wind_speed_kmh'], null], // Only show points with wind data
                layout: {
                  'visibility': 'none', // Start hidden
                  'icon-image': [
                    'case',
                    ['!=', ['get', 'wind_speed_kmh'], null],
                    [
                      'case',
                      ['<', ['get', 'wind_speed_kmh'], 5], 'arrow-calm',
                      ['<', ['get', 'wind_speed_kmh'], 15], 'arrow-light',
                      ['<', ['get', 'wind_speed_kmh'], 25], 'arrow-moderate',
                      ['<', ['get', 'wind_speed_kmh'], 40], 'arrow-strong',
                      'arrow-very-strong'
                    ],
                    'arrow-calm'
                  ],
                  'icon-size': [
                    'interpolate',
                    ['linear'],
                    ['get', 'wind_speed_kmh'],
                    0, 0.5,
                    20, 0.8,
                    50, 1.2
                  ],
                  'icon-rotate': ['get', 'wind_direction_deg'],
                  'icon-rotation-alignment': 'map',
                  'icon-allow-overlap': true,
                  'icon-ignore-placement': true
                },
                paint: {
                  'icon-opacity': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    12, 0,
                    13, weatherOpacity
                  ]
                }
              });
              
              // Add 12 surrounding arrows with non-overlapping positions and size based on distance
              var circlePositions = [];
              var numArrows = 12;
              var minRadius = 45;
              var maxRadius = 80;
              var minDistance = 25; // Minimum distance between arrows to prevent overlap
              
              // Generate non-overlapping positions for arrows
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
                    radius: radius
                  };
                  
                  // Check distance from all existing positions
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
                  // Size based on distance from center (closer = bigger, farther = smaller)
                  var normalizedRadius = (newPos.radius - minRadius) / (maxRadius - minRadius);
                  var sizeIndex = Math.ceil((1 - normalizedRadius) * 4); // 1-4, where 1 is biggest
                  sizeIndex = Math.max(1, Math.min(4, sizeIndex));
                  
                  circlePositions.push({
                    x: newPos.x,
                    y: newPos.y,
                    size: sizeIndex
                  });
                }
              }
              
              circlePositions.forEach(function(pos, index) {
                map.addLayer({
                  id: 'fgpx-wind-arrows-circle-' + index,
                  type: 'symbol',
                  source: 'fgpx-weather',
                  minzoom: 12,
                  filter: ['!=', ['get', 'wind_speed_kmh'], null],
                  layout: {
                    'visibility': 'none',
                    'icon-image': [
                      'case',
                      ['!=', ['get', 'wind_speed_kmh'], null],
                      [
                        'case',
                        ['<', ['get', 'wind_speed_kmh'], 5], 'arrow-calm-size' + pos.size,
                        ['<', ['get', 'wind_speed_kmh'], 15], 'arrow-light-size' + pos.size,
                        ['<', ['get', 'wind_speed_kmh'], 25], 'arrow-moderate-size' + pos.size,
                        ['<', ['get', 'wind_speed_kmh'], 40], 'arrow-strong-size' + pos.size,
                        'arrow-very-strong-size' + pos.size
                      ],
                      'arrow-calm-size' + pos.size
                    ],
                    'icon-rotate': ['get', 'wind_direction_deg'],
                    'icon-rotation-alignment': 'map',
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                    'icon-offset': [pos.x, pos.y]
                  },
                  paint: {
                    'icon-opacity': [
                      'interpolate',
                      ['linear'],
                      ['zoom'],
                      12, 0,
                      13, weatherOpacity * 0.6
                    ]
                  }
                });
              });
              
              DBG.log('Wind arrows layer with circle pattern added successfully');
            } else {
              DBG.warn('Arrow icon not found, cannot add wind arrows layer');
            }
          }, 200);

          // Add wind text labels layer (in addition to arrows) with glyph availability check
          if (hasGlyphs) {
            try {
              map.addLayer({
                id: 'fgpx-wind-text',
                type: 'symbol',
                source: 'fgpx-weather',
                minzoom: 12,
                filter: ['!=', ['get', 'wind_speed_kmh'], null], // Only show points with wind data
                layout: {
                  'visibility': 'none', // Start hidden
                  'text-field': [
                    'case',
                    ['!=', ['get', 'wind_speed_kmh'], null],
                    [
                      'concat',
                      ['round', ['get', 'wind_speed_kmh']], 'km/h'
                    ],
                    ''
                  ],
                  'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
              'text-size': [
                'interpolate',
                ['linear'],
                ['zoom'],
                12, 8,
                16, 11
              ],
              'text-allow-overlap': true,
              'text-ignore-placement': true,
              'text-anchor': 'center',
              'text-justify': 'center',
              'text-offset': [0, 1.5] // Offset text below the arrow
            },
            paint: {
              'text-color': [
                'case',
                ['!=', ['get', 'wind_speed_kmh'], null],
                [
                  'interpolate',
                  ['linear'],
                  ['get', 'wind_speed_kmh'],
                  0, '#666666',   // Dark gray for calm
                  10, '#228b22',  // Forest green for light breeze
                  20, '#ff8c00',  // Dark orange for moderate wind
                  30, '#ff4500',  // Red orange for strong wind
                  50, '#dc143c'   // Crimson for very strong wind
                ],
                '#666666'
              ],
              'text-halo-color': '#ffffff',
              'text-halo-width': 2,
              'text-opacity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                12, 0,
                13, 1
              ]
            }
          });
            } catch (e) {
              DBG.warn('Failed to add wind text layer:', e);
            }
          } else {
            DBG.log('Wind text layer skipped - no glyphs available in map style');
          }

          DBG.log('Weather layers created:', {
            points: weatherData.features.length,
            layers: '4 heatmaps (snow/rain/fog/clouds), circles, temperature, wind'
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
          
          // Create a full viewport polygon for the night overlay
          var bounds = map.getBounds();
          DBG.log('Map bounds:', bounds);
          
          var overlayPolygon = {
            type: 'Feature',
            properties: { nightOpacity: 0 }, // Start with 0 opacity (day)
            geometry: {
              type: 'Polygon',
              coordinates: [[
                [bounds.getWest(), bounds.getNorth()],
                [bounds.getEast(), bounds.getNorth()],
                [bounds.getEast(), bounds.getSouth()],
                [bounds.getWest(), bounds.getSouth()],
                [bounds.getWest(), bounds.getNorth()]
              ]]
            }
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
              'visibility': (!!(window.FGPX && FGPX.daynightVisibleByDefault)) ? 'visible' : 'none' // Use dedicated day/night setting
            },
            paint: {
              'fill-color': window.FGPX.daynightMapColor || '#000080',
              'fill-opacity': [
                'interpolate',
                ['linear'],
                ['to-number', ['get', 'nightOpacity']],
                0, 0,
                1, parseFloat(window.FGPX.daynightMapOpacity) || 0.4
              ],
              'fill-opacity-transition': {
                duration: 300,
                delay: 0
              }
            }
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
          DBG.log('Layer verification - Layer exists:', !!addedLayer, 'Source exists:', !!addedSource);
          
          if (addedLayer) {
            var visibility = map.getLayoutProperty('fgpx-daynight-overlay', 'visibility');
            DBG.log('Initial layer visibility:', visibility);
          }
          
        } catch (e) {
          DBG.warn('Failed to add day/night overlay layer:', e);
        }
      } else {
        DBG.log('Day/night overlay layer creation skipped - enabled:', !!(window.FGPX && FGPX.daynightMapEnabled));
      }

      map.addSource('fgpx-point', { type: 'geojson', data: pointData });
      map.addLayer({ id: 'fgpx-point-circle', type: 'circle', source: 'fgpx-point', paint: { 'circle-radius': 6, 'circle-color': '#25ceff', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } });

      // Text-only labels (emoji + text) using DOM markers so they work with any style
      if (!window.FGPX || FGPX.showLabels !== false) {
        try {
          var mkStyle = 'pointer-events:none;white-space:nowrap;font:600 12px system-ui,Segoe UI,Roboto,Arial,sans-serif;color:#000;background:#fff;border-radius:6px;padding:4px 6px;box-shadow:0 1px 4px rgba(0,0,0,0.25);border:1px solid rgba(0,0,0,0.08)';
          if (isFinite(maxElevVal) && maxElevIdx >= 0 && maxElevIdx < coords.length) {
            var mkElev = document.createElement('div'); mkElev.setAttribute('style', mkStyle);
            mkElev.textContent = '🏔 Max Elev ' + Math.round(maxElevVal) + ' m';
            new window.maplibregl.Marker({ element: mkElev, anchor: 'bottom' }).setLngLat(coords[maxElevIdx].slice(0,2)).addTo(map);
          }
          if (maxSpeedIdx >= 0 && maxSpeedIdx < coords.length) {
            var mkSpeed = document.createElement('div'); mkSpeed.setAttribute('style', mkStyle);
            mkSpeed.textContent = (maxSpeedVal>0?('🚀 Max Speed ' + Math.round(maxSpeedVal*3.6) + ' km/h'):'🚀 Max Speed');
            new window.maplibregl.Marker({ element: mkSpeed, anchor: 'bottom' }).setLngLat(coords[maxSpeedIdx].slice(0,2)).addTo(map);
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
      var lastPlaybackSec = null; // for robust crossing detection at high speeds
      var lastPlaybackDist = null; // meters; for distance-based triggering
      var photosByTime = null; // [{p: photoObject, pSec: number}...] sorted by pSec
      var photoPtr = 0; // moving pointer into photosByTime

      // Local shadow to access the in-scope queue/overlay state
      function isLocationAlreadyQueued(lat, lon) {
        if (typeof lat !== 'number' || typeof lon !== 'number') return false;
        var key = getLocationKey(lat, lon);
        if (!key) return false;
        // Check queue
        for (var i = 0; i < photoQueue.length; i++) {
          var qp = photoQueue[i];
            if (typeof qp.lat === 'number' && typeof qp.lon === 'number' && getLocationKey(qp.lat, qp.lon) === key) {
              return true;
            }
        }
        // Check currently displayed
        if (overlayActive && currentDisplayedPhoto &&
            typeof currentDisplayedPhoto.lat === 'number' &&
            typeof currentDisplayedPhoto.lon === 'number' &&
            getLocationKey(currentDisplayedPhoto.lat, currentDisplayedPhoto.lon) === key) {
          return true;
        }
        return false;
      }

      function addPhotoMarkers() {
        if (!(window.FGPX && FGPX.photosEnabled) || !Array.isArray(photos) || photos.length === 0) { return; }
        var tmpByDist = [];
        photos.forEach(function(ph){
          var lngLat = null;
          var pDistApprox = null;

          if (typeof ph.lon === 'number' && typeof ph.lat === 'number') {
            lngLat = [ph.lon, ph.lat];
            // approximate along-route distance (nearest vertex)
            try {
              var idx = nearestCoordIndex(lngLat, coords);
              ph._idx = idx;
              pDistApprox = cumDist[idx] || 0;
            } catch(_){}
          }

          // Fallback: timestamp → interpolate position
          if (!lngLat && ph.timestamp && Array.isArray(timeOffsets)) {
            try {
              var ts = Date.parse(ph.timestamp);
              if (!isNaN(ts)) {
                var baseTsStr = null;
                for (var bt = 0; bt < timestamps.length; bt++) { if (timestamps[bt] != null) { baseTsStr = timestamps[bt]; break; } }
                var t0 = baseTsStr ? Date.parse(baseTsStr) : null;
                if (t0 != null && !isNaN(t0)) {
                  var sec = (ts - t0)/1000;
                  var lo=0, hi=timeOffsets.length-1;
                  while (lo<hi) { var mid=(lo+hi)>>>1; if (timeOffsets[mid] < sec) lo = mid+1; else hi = mid; }
                  var i = Math.max(1, lo);
                  var u0 = timeOffsets[i-1], u1 = timeOffsets[i];
                  var u = u1>u0 ? (sec-u0)/(u1-u0) : 0;
                  var p0 = coords[i-1], p1 = coords[i];
                  lngLat = [lerp(p0[0], p1[0], u), lerp(p0[1], p1[1], u)];
                  pDistApprox = (cumDist[i-1] || 0) + ((cumDist[i] - cumDist[i-1]) * u);
                }
              }
            } catch(_){}
          }

            if (!lngLat) return;

          // Privacy window filter
          if (privacyEnabled) {
            try {
              var idxP = nearestCoordIndex(lngLat, coords);
              var dAlong = cumDist[idxP] || 0;
              if (dAlong < privacyStartD || dAlong > privacyEndD) { return; }
            } catch(_){}
          }

          // Create marker
          try {
            var el = document.createElement('div');
            el.className = 'fgpx-photo-thumb';
            el.style.cssText = 'pointer-events:auto;width:32px;height:32px;';
            var inner = document.createElement('div');
            inner.style.cssText = 'width:32px;height:32px;border:2px solid #fff;border-radius:4px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.3);transition:transform .15s;transform-origin:center;transform:scale(1)';
            var img = document.createElement('img');
            img.src = (ph.thumbUrl || ph.fullUrl || '').toString();
            img.alt = ph.title || '';
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
            inner.appendChild(img);
            el.appendChild(inner);
            el.addEventListener('mouseenter', function(){ inner.style.transform = 'scale(1.8)'; });
            el.addEventListener('mouseleave', function(){ inner.style.transform = 'scale(1)'; });
            el.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); showOverlay(ph.fullUrl || ph.thumbUrl || '', ph.caption || ph.description || ph.title || ''); });
            var marker = new window.maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(lngLat).addTo(map);
            photoMarkers.push({ marker: marker, photo: ph, lngLat: lngLat, pDist: pDistApprox });
            if (pDistApprox != null) { tmpByDist.push({ p: ph, pDist: pDistApprox, lngLat: lngLat }); }
          } catch(_){}
        });

        try {
          tmpByDist.sort(function(a,b){ return a.pDist - b.pDist; });
          photosByDist = tmpByDist;
          photoDistPtr = 0;
        } catch(_){
          photosByDist = null;
          photoDistPtr = 0;
        }

        DBG.log('addPhotoMarkers complete', { markers: photoMarkers.length });
      }

      // >>> RESTORED CALL (was missing) <<<
      addPhotoMarkers();

      // --- Tile prefetch functions (deferred until play button press) ---
      var tilePrefetchPromise = null;
      var preloadOverlay = null;
      var preloadCompleted = false;
      var preloadingInProgress = false;
      
      try {
        preloadOverlay = document.createElement('div');
        preloadOverlay.className = 'fgpx-preload';
        preloadOverlay.style.cssText = 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.15);z-index:4;pointer-events:none;color:#fff;font:600 13px system-ui,Segoe UI,Roboto,Arial,sans-serif;text-shadow:0 1px 2px rgba(0,0,0,.6);flex-direction:column;padding-top:60px';
        preloadOverlay.textContent = 'Preloading map tiles for smooth playback…';
        ui.mapEl.appendChild(preloadOverlay);
      } catch(_) {}

      function lon2tileX(lon, z){ return Math.floor((lon + 180) / 360 * Math.pow(2, z)); }
      function lat2tileY(lat, z){ var rad = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(rad) + 1/Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, z)); }
      function tileUrlFromTemplate(tpl, z, x, y){ return tpl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)); }
      function getRasterTileTemplates() {
        var tpls = [];
        try {
          var st = map.getStyle(); var srcs = (st && st.sources) ? st.sources : {};
          for (var sid in srcs) {
            if (!Object.prototype.hasOwnProperty.call(srcs, sid)) continue;
            var sdef = srcs[sid];
            if (sdef && (sdef.type === 'raster' || sdef.type === 'raster-dem') && Array.isArray(sdef.tiles)) {
              sdef.tiles.forEach(function(t){ if (typeof t === 'string' && t.indexOf('{z}') !== -1) tpls.push(t); });
            }
          }
        } catch(_) {}
        return tpls;
      }
      function buildPrefetchList(z) {
        var set = new Set();
        try {
          var PAD_TILES = 1;
          var maxTiles = 300;
          var zUse = Math.max(1, Math.min(19, Math.round(z)));
          // Sample along the privacy window every ~500m
          var dStart = privacyEnabled ? privacyStartD : 0;
          var dEnd = privacyEnabled ? privacyEndD : totalDistance;
          var stepM = 500;
          for (var dCur = dStart; dCur <= dEnd; dCur += stepM) {
            var p = positionAtDistance(dCur);
            var x = lon2tileX(p[0], zUse); var y = lat2tileY(p[1], zUse);
            for (var dx = -PAD_TILES; dx <= PAD_TILES; dx++) {
              for (var dy = -PAD_TILES; dy <= PAD_TILES; dy++) {
                set.add(zUse + '/' + (x+dx) + '/' + (y+dy));
                if (set.size >= maxTiles) break;
              }
              if (set.size >= maxTiles) break;
            }
            if (set.size >= maxTiles) break;
          }
          // Ensure start/end tiles
          var pS = positionAtDistance(dStart), pE = positionAtDistance(dEnd);
          set.add(zUse + '/' + lon2tileX(pS[0], zUse) + '/' + lat2tileY(pS[1], zUse));
          set.add(zUse + '/' + lon2tileX(pE[0], zUse) + '/' + lat2tileY(pE[1], zUse));
        } catch(_) {}
        return Array.from(set);
      }
      function prefetchTilesForRoute() {
        if (preloadCompleted || preloadingInProgress) { return Promise.resolve(); }
        preloadingInProgress = true;
        try {
          var tpls = getRasterTileTemplates();
          if (!tpls || tpls.length === 0) { 
            preloadCompleted = true;
            preloadingInProgress = false;
            return Promise.resolve(); 
          }
          var z = isFinite(defaultZoomSetting) ? defaultZoomSetting : 12;
          var list = buildPrefetchList(z);
          if (!list || list.length === 0) { 
            preloadCompleted = true;
            preloadingInProgress = false;
            return Promise.resolve(); 
          }
          DBG.time('route-prefetch');
          DBG.log('route-prefetch start');
          // Show preloading overlay with updated message
          try { 
            if (preloadOverlay) {
              preloadOverlay.textContent = 'Preloading map tiles for smooth playback…';
              preloadOverlay.style.display = 'flex'; 
            } 
          } catch(_) {}
          // Disable play buttons during preloading
          updateButtonStates();
          var reqs = [];
          var timeoutMs = 4000;
          var controller = null;
          list.forEach(function(key){
            try {
              var parts = key.split('/'); var zt = parseInt(parts[0],10), xt = parseInt(parts[1],10), yt = parseInt(parts[2],10);
              for (var i = 0; i < tpls.length; i++) {
                var url = tileUrlFromTemplate(tpls[i], zt, xt, yt);
                var p = fetch(url, { mode: 'no-cors', cache: 'force-cache' }).catch(function(){ /* ignore */ });
                reqs.push(p);
              }
            } catch(_) {}
          });
          var prefetch = Promise.allSettled(reqs)
            .then(function(){ 
              try { if (preloadOverlay) preloadOverlay.style.display = 'none'; } catch(_) {} 
              preloadCompleted = true;
              preloadingInProgress = false;
              // Re-enable play buttons after preloading completes
              updateButtonStates();
            })
            .catch(function(){ 
              try { if (preloadOverlay) preloadOverlay.style.display = 'none'; } catch(_) {} 
              preloadCompleted = true;
              preloadingInProgress = false;
              // Re-enable play buttons after preloading fails
              updateButtonStates();
            })
            .finally(function(){
              DBG.log('route-prefetch finished');
              DBG.timeEnd('route-prefetch');
            });
          var timed = new Promise(function(resolve){ 
            setTimeout(function() { 
              preloadCompleted = true; 
              preloadingInProgress = false;
              // Re-enable play buttons after timeout
              updateButtonStates();
              resolve(); 
            }, timeoutMs); 
          });
          return Promise.race([prefetch, timed]);
        } catch(_) { 
          preloadCompleted = true;
          preloadingInProgress = false;
          // Re-enable play buttons after error
          updateButtonStates();
          return Promise.resolve(); 
        }
      }
      
      // Initialize with resolved promise - preloading will start on first play
      tilePrefetchPromise = Promise.resolve();

      // --- Video Recording Implementation ---
      var videoRecorder = null;
      var isRecording = false;
      var recordingProgress = 0;
      var recordingDuration = 0;
      var recordingSettingsModal = null;
      var selectedQualityPreset = 'medium';
      
      // Video Quality Presets
      var VIDEO_QUALITY_PRESETS = {
        'ultra': {
          name: 'Ultra HD',
          description: '4K quality for professional use',
          fps: 60,
          bitrate: 15000000, // 15 Mbps
          quality: 0.95,
          resolution: { width: 3840, height: 2160 },
          fileSize: 'Very Large (~180MB/min)',
          useCase: 'Professional presentations, high-end displays'
        },
        'high': {
          name: 'High Definition',
          description: '1080p quality for general use',
          fps: 30,
          bitrate: 5000000, // 5 Mbps
          quality: 0.9,
          resolution: { width: 1920, height: 1080 },
          fileSize: 'Large (~60MB/min)',
          useCase: 'YouTube uploads, presentations'
        },
        'medium': {
          name: 'Standard Definition',
          description: 'Balanced quality and file size',
          fps: 30,
          bitrate: 4000000, // 4 Mbps - increased from 2.5 to reduce compression blocks
          resolution: { width: 1280, height: 720 },
          useCase: 'Web sharing, social media'
        },
        'low': {
          name: 'Compressed',
          description: 'Small file size for quick sharing',
          fps: 24,
          bitrate: 1000000, // 1 Mbps
          quality: 0.6,
          resolution: { width: 854, height: 480 },
          fileSize: 'Small (~12MB/min)',
          useCase: 'Mobile viewing, slow connections'
        },
        'minimal': {
          name: 'Ultra Compressed',
          description: 'Minimal file size for previews',
          fps: 15,
          bitrate: 500000, // 0.5 Mbps
          quality: 0.5,
          resolution: { width: 640, height: 360 },
          fileSize: 'Very Small (~6MB/min)',
          useCase: 'Quick previews, thumbnails'
        }
      };
      
      function VideoRecorder(map, options) {
        this.map = map;
        this.options = options || {};
        this.preset = this.options.preset || 'medium';
        this.customSettings = this.options.customSettings || null;
        
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
        this.CHUNK_SIZE_THRESHOLD = 250 * 1024 * 1024; // 250MB in bytes
        this.CHUNK_SIZE_TARGET = 200 * 1024 * 1024; // 200MB target chunk size
        this.currentChunkSize = 0;
        this.chunkNumber = 0;
        this.sessionId = 'rec_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        this.downloadedChunks = [];
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
          sessionId: this.sessionId
        });
        
        this.initPromise = this.init();
      }
      
      VideoRecorder.prototype.init = function() {
        var self = this;
        return new Promise(function(resolve, reject) {
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
            DBG.warn('VideoRecorder init failed', error);
            reject(error);
          }
        });
      };
      
      VideoRecorder.prototype.initWithCanvas = function() {
        try {
          // Use direct canvas recording - this captures all map layers including photos!
          this.stream = this.canvas.captureStream(this.targetFPS);
          
          // Configure MediaRecorder with compression
          var mimeType = this.getSupportedMimeType();
          var options = {
            mimeType: mimeType,
            videoBitsPerSecond: this.bitrate
          };
          // Preserve options for recorder re-creation during rotation
          this.recorderOptions = options;
          
          this.mediaRecorder = new MediaRecorder(this.stream, options);
          this.setupEventHandlers();
          
          DBG.log('VideoRecorder initialized with canvas', { 
            preset: this.preset,
            mimeType: mimeType, 
            fps: this.targetFPS, 
            bitrate: this.bitrate,
            canvasSize: { width: this.canvas.width, height: this.canvas.height }
          });
        } catch (error) {
          DBG.warn('Canvas recording init failed', error);
          throw error;
        }
      };
      
      VideoRecorder.prototype.setupCompositeCanvas = function() {
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
      
      VideoRecorder.prototype.getSupportedMimeType = function() {
        var codecs = [
          { 
            mimeType: 'video/webm;codecs=vp9,opus', 
            name: 'WebM VP9 (Best Compression)',
            efficiency: 'high',
            compatibility: 'modern'
          },
          { 
            mimeType: 'video/webm;codecs=vp8,vorbis', 
            name: 'WebM VP8 (Good Compression)',
            efficiency: 'medium',
            compatibility: 'good'
          },
          { 
            mimeType: 'video/mp4;codecs=avc1.42E01E', 
            name: 'MP4 H.264 (Best Compatibility)',
            efficiency: 'medium',
            compatibility: 'excellent'
          },
          { 
            mimeType: 'video/webm;codecs=vp9',
            name: 'WebM VP9',
            efficiency: 'high',
            compatibility: 'modern'
          },
          { 
            mimeType: 'video/webm;codecs=vp8',
            name: 'WebM VP8',
            efficiency: 'medium',
            compatibility: 'good'
          },
          { 
            mimeType: 'video/webm',
            name: 'WebM',
            efficiency: 'medium',
            compatibility: 'good'
          },
          { 
            mimeType: 'video/mp4;codecs=h264',
            name: 'MP4 H.264',
            efficiency: 'medium',
            compatibility: 'excellent'
          },
          { 
            mimeType: 'video/mp4',
            name: 'MP4',
            efficiency: 'medium',
            compatibility: 'excellent'
          }
        ];
        
        // Select optimal codec based on preset
        var supportedCodecs = codecs.filter(function(codec) {
          return MediaRecorder.isTypeSupported(codec.mimeType);
        });
        
        if (supportedCodecs.length === 0) {
          return 'video/webm'; // fallback
        }
        
        // For high quality presets, prefer VP9 for better compression
        if (['ultra', 'high'].includes(this.preset)) {
          var vp9Codec = supportedCodecs.find(function(c) { return c.mimeType.includes('vp9'); });
          if (vp9Codec) return vp9Codec.mimeType;
        }
        
        // For compatibility, prefer H.264
        if (this.preset === 'medium') {
          var h264Codec = supportedCodecs.find(function(c) { return c.mimeType.includes('avc1') || c.mimeType.includes('h264'); });
          if (h264Codec) return h264Codec.mimeType;
        }
        
        // Return first supported codec
        return supportedCodecs[0].mimeType;
      };
      
      VideoRecorder.prototype.setupEventHandlers = function() {
        var self = this;
        
        this.mediaRecorder.ondataavailable = function(event) {
          if (event.data && event.data.size > 0) {
            self.chunks.push(event.data);
            self.currentChunkSize += event.data.size;
            self.frameCount++;
            
            // Rotate recorder at threshold to finalize a playable segment with fresh headers
            if (self.currentChunkSize >= self.CHUNK_SIZE_TARGET && self.chunks.length > 10 && !self.isRotatingChunk) {
              DBG.log('Chunk threshold reached - rotating recorder', {
                chunkSize: self.formatFileSize(self.currentChunkSize),
                chunkNumber: self.chunkNumber
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
        
        this.mediaRecorder.onstop = function() {
          DBG.log('MediaRecorder stopped', { rotating: !!self.isRotatingChunk });
          if (self.isRotatingChunk) {
            // We stopped to rotate at a chunk boundary: finalize and download this chunk
            try {
              self.downloadCurrentChunk();
              self.chunks = [];
              self.currentChunkSize = 0;
              // Don't increment chunk number yet - do it after successful restart
            } catch (error) {
              DBG.warn('Failed to process rotated chunk', error);
            } finally {
              self.isRotatingChunk = false;
            }
            // Recreate and restart MediaRecorder to continue recording next chunk
            try {
              var opts = self.recorderOptions || { mimeType: self.getSupportedMimeType(), videoBitsPerSecond: self.bitrate };
              self.mediaRecorder = new MediaRecorder(self.stream, opts);
              self.setupEventHandlers();
              // Start with small timeslice to keep memory usage low
              self.mediaRecorder.start(100);
              // Note: chunk number already incremented by downloadCurrentChunk()
              DBG.log('MediaRecorder rotated and restarted', { nextChunkNumber: self.chunkNumber });
            } catch (err) {
              DBG.warn('Failed to restart MediaRecorder after rotation', err);
              // Fallback: finalize recording if we cannot continue
              self.onRecordingComplete();
            }
            return; // Do not finalize recording here
          }
          // Normal stop: finalize recording
          self.onRecordingComplete();
        };
        
        this.mediaRecorder.onerror = function(event) {
          DBG.warn('MediaRecorder error', event.error);
          self.stop();
        };
      };
      
      VideoRecorder.prototype.drawPhotoOverlay = function(photoData) {
        if (!this.isRecording) return;
        
        var self = this;
        
        // Store the original photo data for use in map layer
        this.currentPhotoData = photoData;
        
        // Wait longer for DOM overlay animation to complete and avoid distorted frames
        setTimeout(function() {
          var overlay = document.querySelector('.fgpx-photo-overlay');
          var img = overlay ? overlay.querySelector('img') : null;
          
          // Only add to map if overlay is fully visible and stable
          if (overlay && img && 
              overlay.style.opacity === '1' && 
              img.complete && 
              img.naturalWidth > 0) {
            self.addPhotoToMap();
          }
        }, 500); // Increased delay to ensure animation is complete
        
        DBG.log('Photo overlay will be added to map for recording', photoData);
      };
      
      VideoRecorder.prototype.clearPhotoOverlay = function() {
        DBG.log('clearPhotoOverlay called - removing map layer');
        this.removePhotoFromMap();
        DBG.log('Photo overlay removed from map');
      };
      
      VideoRecorder.prototype.addPhotoToMap = function() {
        try {
          var overlay = document.querySelector('.fgpx-photo-overlay');
          if (!overlay) return;
          
          var isVisible = overlay.style.display !== 'none' && 
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
      
      VideoRecorder.prototype.addPhotoAsTopLayer = function(img, overlay) {
        try {
          var self = this;
          var originalImageUrl = (self.currentPhotoData && (self.currentPhotoData.fullUrl || self.currentPhotoData.thumbUrl)) || img.src;
          
          var center = this.map.getCenter();
          
          // Try symbol layer approach - this should not interact with terrain
          self.map.loadImage(originalImageUrl, function(error, image) {
            if (error) {
              DBG.warn('Failed to load image for symbol layer', error);
              return;
            }
            
            // Calculate proper aspect ratio to match browser overlay
            var canvas = self.map.getCanvas();
            var canvasWidth = canvas.width;
            var canvasHeight = canvas.height;
            var imageAspect = image.width / image.height;
            var canvasAspect = canvasWidth / canvasHeight;
            
            // Browser overlay uses max height with black borders on sides
            // So we need to calculate the size that maintains aspect ratio within canvas height
            var iconSize;
            if (imageAspect > canvasAspect) {
              // Image is wider than canvas - limit by canvas width (like browser does with height)
              iconSize = canvasWidth / image.width;
            } else {
              // Image is taller than canvas - limit by canvas height
              iconSize = canvasHeight / image.height;
            }
            
            // Scale down a bit to match browser overlay padding/margins
            iconSize *= 0.9;
            
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
                  coordinates: [center.lng, center.lat]
                }
              }
            });
            
            // First add a background layer for the dark grey background
            self.map.addLayer({
              id: 'photo-overlay-background-layer',
              type: 'background',
              paint: {
                'background-color': '#2a2a2a' // Dark grey to match plugin theme
              }
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
                'icon-anchor': 'center'
              },
              paint: {
                'icon-opacity': 1.0
              }
            });
            
            DBG.log('Added photo as symbol layer with proper aspect ratio', {
              imageUrl: originalImageUrl,
              center: center,
              imageSize: { width: image.width, height: image.height },
              canvasSize: { width: canvasWidth, height: canvasHeight },
              calculatedIconSize: iconSize,
              imageAspect: imageAspect,
              canvasAspect: canvasAspect
            });
          });
          
        } catch (error) {
          DBG.warn('Failed to add photo as symbol layer', error);
          
          // Fallback to raster approach
          self.addPhotoAsRasterFallback(originalImageUrl);
        }
      };
      
      VideoRecorder.prototype.addPhotoAsRasterFallback = function(originalImageUrl) {
        try {
          var bounds = this.map.getBounds();
          
          this.map.addSource('photo-overlay-recording', {
            type: 'image',
            url: originalImageUrl,
            coordinates: [
              [bounds.getWest(), bounds.getNorth()],
              [bounds.getEast(), bounds.getNorth()],
              [bounds.getEast(), bounds.getSouth()],
              [bounds.getWest(), bounds.getSouth()]
            ]
          });
          
          this.map.addLayer({
            id: 'photo-overlay-recording-layer',
            type: 'raster',
            source: 'photo-overlay-recording',
            paint: {
              'raster-opacity': 1.0
            }
          });
          
          DBG.log('Added photo as raster fallback');
          
        } catch (error) {
          DBG.warn('Raster fallback also failed', error);
        }
      };
      
      VideoRecorder.prototype.renderPhotoToCanvas = function(img, overlay) {
        try {
          var self = this;
          var canvas = this.canvas;
          var ctx = canvas.getContext('2d');
          
          // Get original photo URL to avoid distorted frames
          var originalImageUrl = (self.currentPhotoData && (self.currentPhotoData.fullUrl || self.currentPhotoData.thumbUrl)) || img.src;
          
          // Create new image for canvas rendering
          var canvasImg = new Image();
          canvasImg.crossOrigin = 'anonymous';
          
          canvasImg.onload = function() {
            try {
              // Store current canvas state
              self.canvasImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              
              // Start continuous rendering loop
              self.startPhotoCanvasRendering(canvasImg, overlay);
              
              DBG.log('Started canvas-based photo overlay rendering', {
                imageUrl: originalImageUrl,
                canvasSize: { width: canvas.width, height: canvas.height }
              });
              
            } catch (error) {
              DBG.warn('Failed to start canvas photo rendering', error);
            }
          };
          
          canvasImg.onerror = function() {
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
      
      VideoRecorder.prototype.startPhotoCanvasRendering = function(img, overlay) {
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
      
      VideoRecorder.prototype.drawPhotoOnCanvas = function(ctx, img, overlay, canvas) {
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
      
      VideoRecorder.prototype.addPhotoToMapWithCanvas = function(img, overlay, bounds) {
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
            img.onload = function() {
              self.drawImageToCanvas(ctx, img, canvas, overlay, bounds);
            };
          }
          
        } catch (error) {
          DBG.warn('Failed to create canvas-based photo overlay', error);
        }
      };
      
      VideoRecorder.prototype.drawImageToCanvas = function(ctx, img, canvas, overlay, bounds) {
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
              [bounds.getWest(), bounds.getSouth()]
            ]
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
          
          this.map.addLayer({
            id: 'photo-overlay-recording-layer',
            type: 'raster',
            source: 'photo-overlay-recording',
            paint: {
              'raster-opacity': 1.0 // Full opacity for testing - make it clearly visible
            }
          }, firstSymbolId); // Add before first symbol layer
          
          DBG.log('Added canvas-based photo overlay to map');
          
        } catch (error) {
          DBG.warn('Failed to draw image to canvas', error);
        }
      };
      
      VideoRecorder.prototype.removePhotoFromMap = function() {
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
      
      VideoRecorder.prototype.stopPhotoCanvasRendering = function() {
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
      
      VideoRecorder.prototype.start = function() {
        var self = this;
        if (this.isRecording) return Promise.resolve();
        
        return this.initPromise.then(function() {
          if (!self.mediaRecorder) {
            throw new Error('MediaRecorder not initialized');
          }
          
          try {
            self.chunks = [];
            self.isRecording = true;
            self.startTime = performance.now();
            self.frameCount = 0;
            self.lastFrameTime = 0;
            
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
              canvasSize: { width: self.canvas.width, height: self.canvas.height }
            });
          } catch (error) {
            DBG.warn('Failed to start recording', error);
            self.isRecording = false;
            throw error;
          }
        });
      };
      
      VideoRecorder.prototype.ensureMarkersVisible = function() {
        // Convert text markers to map layers for recording (photos stay as DOM)
        this.convertTextMarkersToLayers();
      };
      
      VideoRecorder.prototype.convertTextMarkersToLayers = function() {
        var self = this;
        this.recordingTextLayers = [];
        this.hiddenTextMarkers = [];
        
        try {
          // Find all markers (text markers AND photo thumbnails)
          var allMarkers = document.querySelectorAll('.maplibregl-marker');
          var convertedCount = 0;
          
          allMarkers.forEach(function(markerEl, index) {
            try {
              // Skip if already hidden
              if (markerEl.style.display === 'none' || markerEl.style.visibility === 'hidden') return;
              
              // Check if this is a photo thumbnail (has img element)
              var hasImage = markerEl.querySelector('img');
              var textContent = markerEl.textContent || '';
              
              // Skip if neither text nor image
              if (!hasImage && !textContent.trim()) return;
              
              // Skip text markers that contain emoji SVGs (max speed/elevation)
              if (hasImage && textContent.trim() && 
                  (textContent.includes('Max Speed') || textContent.includes('Max Elev'))) {
                DBG.log('Skipping text marker with emoji, will handle as text-only', { textContent: textContent });
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
                var pixelX = markerRect.left - mapRect.left + (markerRect.width / 2);
                var pixelY = hasImage ? 
                  (markerRect.top - mapRect.top + (markerRect.height / 2)) : // Center for thumbnails
                  (markerRect.top - mapRect.top + markerRect.height);        // Bottom for text
                
                // Convert pixel position to geographic coordinates
                lngLat = self.map.unproject([pixelX, pixelY]);
                
                DBG.log('Extracted coordinates from DOM position', {
                  hasImage: !!hasImage,
                  textContent: textContent,
                  pixelPos: [pixelX, pixelY],
                  coordinates: [lngLat.lng, lngLat.lat]
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
                  coordinates: [lngLat.lng, lngLat.lat]
                });
                
                if (img.src && img.complete && img.naturalWidth > 0) {
                  // Create source immediately to reserve the layer ID
                  self.map.addSource(layerId, {
                    type: 'geojson',
                    data: {
                      type: 'Feature',
                      geometry: {
                        type: 'Point',
                        coordinates: [lngLat.lng, lngLat.lat]
                      }
                    }
                  });
                  
                  self.map.loadImage(img.src, function(error, image) {
                    if (error) {
                      DBG.warn('Failed to load thumbnail image, skipping', { 
                        src: img.src, 
                        error: error.message || error 
                      });
                      // Remove the source we created since we can't add the layer
                      try {
                        if (self.map.getSource(layerId)) {
                          self.map.removeSource(layerId);
                        }
                      } catch (_) {}
                      return;
                    }
                    
                    var iconId = 'thumbnail-' + index;
                    if (!self.map.hasImage(iconId)) {
                      self.map.addImage(iconId, image);
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
                      data: imageData.data
                    };
                    
                    // Add the square image to map
                    var squareIconId = iconId + '-square';
                    if (!self.map.hasImage(squareIconId)) {
                      self.map.addImage(squareIconId, squareImage);
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
                        'icon-anchor': 'center'
                      }
                    });
                    
                    DBG.log('Added photo thumbnail layer', { layerId: layerId, iconId: iconId });
                  });
                  
                  self.recordingTextLayers.push(layerId);
                } else {
                  DBG.warn('Photo thumbnail image not ready', { 
                    src: img.src, 
                    complete: img.complete, 
                    naturalWidth: img.naturalWidth 
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
                  drawRoundedRect(ctx, shadowOffset, shadowOffset, canvas.width - shadowOffset, canvas.height - shadowOffset, 8);
                  ctx.fill();
                  
                  // Draw main card background with gradient
                  var gradient = ctx.createLinearGradient(0, 0, 0, canvas.height - shadowOffset);
                  gradient.addColorStop(0, '#ffffff');
                  gradient.addColorStop(1, '#f8f9fa');
                  ctx.fillStyle = gradient;
                  ctx.beginPath();
                  drawRoundedRect(ctx, 0, 0, canvas.width - shadowOffset, canvas.height - shadowOffset, 8);
                  ctx.fill();
                  
                  // Draw subtle border
                  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
                  ctx.lineWidth = 1;
                  ctx.beginPath();
                  drawRoundedRect(ctx, 0.5, 0.5, canvas.width - shadowOffset - 1, canvas.height - shadowOffset - 1, 8);
                  ctx.stroke();
                  
                  // Draw text with better positioning
                  ctx.font = '600 12px system-ui, Segoe UI, Roboto, Arial, sans-serif';
                  ctx.fillStyle = '#2c3e50';
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.fillText(textContent, (canvas.width - shadowOffset) / 2, (canvas.height - shadowOffset) / 2);
                  
                  // Convert canvas to ImageData
                  var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                  var textImage = {
                    width: canvas.width,
                    height: canvas.height,
                    data: imageData.data
                  };
                  
                  // Add text image to map
                  var textIconId = 'text-marker-' + index;
                  if (!self.map.hasImage(textIconId)) {
                    self.map.addImage(textIconId, textImage);
                  }
                  
                  // Create source and layer
                  self.map.addSource(layerId, {
                    type: 'geojson',
                    data: {
                      type: 'Feature',
                      geometry: {
                        type: 'Point',
                        coordinates: [lngLat.lng, lngLat.lat]
                      }
                    }
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
                      'icon-anchor': 'bottom'
                    }
                  });
                  
                  self.recordingTextLayers.push(layerId);
                  
                  DBG.log('Added text marker as image', { textContent: textContent, layerId: layerId });
                  
                } catch (error) {
                  DBG.warn('Failed to create text marker image', error);
                }
              }
              
              // Hide DOM marker during recording
              self.hiddenTextMarkers.push({
                element: markerEl,
                originalVisibility: markerEl.style.visibility
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
            layers: self.recordingTextLayers.length 
          });
          
        } catch (error) {
          DBG.warn('Error in convertTextMarkersToLayers', error);
          // Fallback: restore any hidden markers
          self.restoreTextMarkers();
        }
      };
      
      VideoRecorder.prototype.restoreTextMarkers = function() {
        var self = this;
        
        try {
          // Remove recording layers
          if (this.recordingTextLayers) {
            this.recordingTextLayers.forEach(function(layerId) {
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
          
          // Restore DOM marker visibility
          if (this.hiddenTextMarkers) {
            this.hiddenTextMarkers.forEach(function(markerInfo) {
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
      
      VideoRecorder.prototype.startMarkerCompositing = function() {
        if (!this.compositeCanvas || !this.isRecording) return;
        
        var self = this;
        
        function composite() {
          if (!self.isRecording || !self.compositeCtx) return;
          
          try {
            // Clear composite canvas
            self.compositeCtx.clearRect(0, 0, self.compositeCanvas.width, self.compositeCanvas.height);
            
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
      
      VideoRecorder.prototype.drawMarkersToCanvas = function() {
        var markers = document.querySelectorAll('.maplibregl-marker');
        var mapRect = this.canvas.getBoundingClientRect();
        
        markers.forEach(function(marker) {
          if (marker.style.display === 'none') return;
          
          try {
            var markerRect = marker.getBoundingClientRect();
            
            // Calculate position relative to map canvas
            var x = markerRect.left - mapRect.left + (markerRect.width / 2);
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
            this.compositeCtx.drawImage(tempCanvas, x - (markerRect.width / 2), y - markerRect.height);
            
          } catch (error) {
            // Skip problematic markers
          }
        }.bind(this));
      };
      
      VideoRecorder.prototype.renderMarkerToCanvas = function(marker, ctx, width, height) {
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
      
      VideoRecorder.prototype.drawRoundedRect = function(ctx, x, y, width, height, radius) {
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
      
      VideoRecorder.prototype.stop = function() {
        if (!this.isRecording) return;
        
        try {
          this.isRecording = false;
          this.mediaRecorder.stop();
          
          // Restore text markers first
          this.restoreTextMarkers();
          
          // Clean up map layers
          this.removePhotoFromMap();
          
          // Clean up
          this.cleanupOverlayCanvas();
          
          // Hide recording progress
          this.hideRecordingProgress();
          
          DBG.log('Video recording stopped', {
            preset: this.preset,
            duration: ((performance.now() - this.startTime) / 1000).toFixed(2) + 's'
          });
        } catch (error) {
          DBG.warn('Failed to stop recording', error);
        }
      };
      
      VideoRecorder.prototype.cleanupOverlayCanvas = function() {
        // Simple cleanup
        DBG.log('Recording cleanup completed');
      };
      
      VideoRecorder.prototype.onRecordingComplete = function() {
        try {
          // Download any remaining chunks first
          if (this.chunks.length > 0) {
            this.downloadCurrentChunk(true); // Mark as final chunk
          }
          
          var totalSize = this.downloadedChunks.reduce(function(total, chunk) { 
            return total + chunk.size; 
          }, 0);
          var duration = (performance.now() - this.startTime) / 1000;
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
            sessionId: this.sessionId
          });
          
          // Show completion message with reassembly instructions
          this.showCompletionMessage();
          
        } catch (error) {
          DBG.warn('Failed to process recording', error);
        }
      };
      
      VideoRecorder.prototype.downloadCurrentChunk = function(isFinalChunk) {
        if (this.chunks.length === 0) return;
        
        try {
          var blob = new Blob(this.chunks, { type: this.getSupportedMimeType() });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          
          // Create filename with chunk number for easy reassembly
          var mimeType = this.getSupportedMimeType();
          var extension = mimeType.indexOf('mp4') !== -1 ? '.mp4' : '.webm';
          var preset = this.preset.charAt(0).toUpperCase() + this.preset.slice(1);
          var chunkPadded = String(this.chunkNumber).padStart(3, '0');
          
          a.download = 'flyover-' + preset + '-' + this.sessionId + '-chunk-' + chunkPadded + extension;
          
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          
          // Store chunk info for completion message
          this.downloadedChunks.push({
            number: this.chunkNumber,
            filename: a.download,
            size: blob.size,
            isFinal: !!isFinalChunk
          });
          
          DBG.log('Chunk downloaded', { 
            chunkNumber: this.chunkNumber,
            filename: a.download,
            size: this.formatFileSize(blob.size),
            isFinal: !!isFinalChunk,
            sessionId: this.sessionId
          });
          
          // Reset for next chunk (but keep recording)
          if (!isFinalChunk) {
            this.chunks = [];
            this.currentChunkSize = 0;
            this.chunkNumber++;
          }
          
        } catch (error) {
          DBG.warn('Failed to download chunk', error);
        }
      };
      
      VideoRecorder.prototype.downloadVideo = function(blob) {
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
            size: this.formatFileSize(blob.size)
          });
        } catch (error) {
          DBG.warn('Failed to download video', error);
        }
      };
      
      // File size estimation and utility methods
      VideoRecorder.prototype.calculateEstimatedSize = function() {
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
      
      VideoRecorder.prototype.formatFileSize = function(bytes) {
        if (bytes < 1024 * 1024) {
          return Math.round(bytes / 1024) + ' KB';
        } else if (bytes < 1024 * 1024 * 1024) {
          return Math.round(bytes / (1024 * 1024)) + ' MB';
        } else {
          return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
        }
      };
      
      VideoRecorder.prototype.calculateExpectedChunks = function(durationMinutes) {
        var estimatedTotalSize = this.estimatedSizePerMinute * durationMinutes;
        if (estimatedTotalSize <= this.CHUNK_SIZE_THRESHOLD) {
          return 1; // Single file download
        }
        return Math.ceil(estimatedTotalSize / this.CHUNK_SIZE_TARGET);
      };
      
      VideoRecorder.prototype.showCompletionMessage = function() {
        if (this.downloadedChunks.length <= 1) return; // Single file, no message needed
        
        var message = 'Recording completed! Downloaded ' + this.downloadedChunks.length + ' chunks.\n\n';
        message += 'To reassemble the video:\n';
        message += '1. Ensure all chunks are in the same folder\n';
        message += '2. Use a tool like FFmpeg or video editing software\n';
        message += '3. Concatenate files in order: chunk-000, chunk-001, etc.\n\n';
        message += 'Session ID: ' + this.sessionId + '\n';
        message += 'Files downloaded:\n';
        
        this.downloadedChunks.forEach(function(chunk) {
          message += '- ' + chunk.filename + ' (' + this.formatFileSize(chunk.size) + ')\n';
        }.bind(this));
        
        alert(message);
        
        DBG.log('Chunked recording completion message shown', {
          totalChunks: this.downloadedChunks.length,
          sessionId: this.sessionId,
          files: this.downloadedChunks.map(function(c) { return c.filename; })
        });
      };
      
      // Removed complex canvas scaling - keep it simple and working!
      
      VideoRecorder.prototype.updateRecordingProgress = function() {
        if (!this.isRecording) return;
        
        var currentTime = performance.now();
        var elapsed = (currentTime - this.startTime) / 1000; // seconds
        var currentSize = this.chunks.reduce(function(total, chunk) { return total + chunk.size; }, 0);
        var actualBitrate = elapsed > 0 ? (currentSize * 8) / elapsed : 0; // bits per second
        
        // Update progress UI if it exists
        var progressElement = document.querySelector('.fgpx-recording-progress');
        if (progressElement) {
          progressElement.innerHTML = 
            '<div class="fgpx-progress-stats">' +
              '<div class="fgpx-progress-time">Recording: ' + Math.floor(elapsed) + 's</div>' +
              '<div class="fgpx-progress-size">Size: ' + this.formatFileSize(currentSize) + '</div>' +
              '<div class="fgpx-progress-bitrate">Bitrate: ' + Math.round(actualBitrate / 1000) + 'k</div>' +
            '</div>';
        }
      };
      
      VideoRecorder.prototype.showRecordingProgress = function() {
        // Create progress display if it doesn't exist
        var existing = document.querySelector('.fgpx-recording-progress');
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
        var mapContainer = document.querySelector('.fgpx-map');
        if (mapContainer) {
          mapContainer.appendChild(progressDiv);
        }
      };
      
      VideoRecorder.prototype.hideRecordingProgress = function() {
        var progressElement = document.querySelector('.fgpx-recording-progress');
        if (progressElement) {
          progressElement.style.display = 'none';
        }
      };
      
      VideoRecorder.prototype.shouldCaptureFrame = function(currentTime) {
        if (!this.isRecording) return false;
        
        var timeSinceLastFrame = currentTime - this.lastFrameTime;
        if (timeSinceLastFrame >= this.frameInterval) {
          this.lastFrameTime = currentTime;
          this.frameCount++;
          return true;
        }
        return false;
      };

      // Dynamic viewport edge prefetcher (5–10 Hz), rotation-aware
      var vpLastPrefetch = 0; // seconds
      var vpInflightKeys = new Set();
      function expandBounds(b, margin) {
        try {
          var sw = b.getSouthWest(); var ne = b.getNorthEast();
          var lonSpan = ne.lng - sw.lng; var latSpan = ne.lat - sw.lat;
          var lonPad = lonSpan * margin; var latPad = latSpan * margin;
          return { sw: { lon: sw.lng - lonPad, lat: sw.lat - latPad }, ne: { lon: ne.lng + lonPad, lat: ne.lat + latPad } };
        } catch(_) { return null; }
      }
      function prefetchViewportTiles(margin, extraZoom) {
        try {
          var tpls = getRasterTileTemplates(); if (!tpls || tpls.length === 0) return;
          var b = map.getBounds(); if (!b) return;
          var ex = expandBounds(b, margin || 0.2); if (!ex) return;
          var zNow = Math.round(map.getZoom ? map.getZoom() : defaultZoomSetting);
          var levels = [zNow];
          if (extraZoom === true) { levels.push(zNow + 1); }
          var maxTiles = extraZoom ? 500 : 300;
          var set = new Set();
          levels.forEach(function(zz){
            var z = Math.max(1, Math.min(19, zz));
            var x0 = lon2tileX(ex.sw.lon, z), x1 = lon2tileX(ex.ne.lon, z);
            var y0 = lat2tileY(ex.ne.lat, z), y1 = lat2tileY(ex.sw.lat, z); // note: TMS origin top-left
            var minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
            var minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
            for (var x = minX; x <= maxX; x++) {
              for (var y = minY; y <= maxY; y++) {
                set.add(z + '/' + x + '/' + y);
                if (set.size >= maxTiles) break;
              }
              if (set.size >= maxTiles) break;
            }
          });
          var reqs = [];
          set.forEach(function(key){
            try {
              if (vpInflightKeys.has(key)) return;
              vpInflightKeys.add(key);
              var parts = key.split('/'); var zt = parseInt(parts[0],10), xt = parseInt(parts[1],10), yt = parseInt(parts[2],10);
              for (var i = 0; i < tpls.length; i++) {
                var url = tileUrlFromTemplate(tpls[i], zt, xt, yt);
                var p = fetch(url, { mode: 'no-cors', cache: 'force-cache' }).catch(function(){});
                reqs.push(p);
              }
            } catch(_) {}
          });
          Promise.allSettled(reqs).finally(function(){
            // Trim inflight set occasionally
            if (vpInflightKeys.size > 2000) { vpInflightKeys.clear(); }
          });
        } catch(_) {}
      }
      // Build time-indexed photo list for efficient triggering
      try {
        if (Array.isArray(photos) && photos.length > 0 && hasTimestamps && Array.isArray(timeOffsets) && timestamps && timestamps.length > 0) {
          // Use the first non-null track timestamp as base (robust to leading nulls)
          var baseTsStr0 = null;
          for (var bt0 = 0; bt0 < timestamps.length; bt0++) { if (timestamps[bt0] != null) { baseTsStr0 = timestamps[bt0]; break; } }
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
            tmp.sort(function(a, b){ return a.pSec - b.pSec; });
            photosByTime = tmp;
            photoPtr = 0;
          }
        }
      } catch(_) {}
      function lowerBoundPhotoIdx(sec) {
        try {
          if (!photosByTime || photosByTime.length === 0) return 0;
          var lo = 0, hi = photosByTime.length;
          while (lo < hi) { var mid = (lo + hi) >>> 1; if (photosByTime[mid].pSec < sec) lo = mid + 1; else hi = mid; }
          return lo;
        } catch(_) { return 0; }
      }

      // Fullscreen overlay element
      // Ensure map element can contain absolutely positioned overlay
      try { if (window.getComputedStyle && window.getComputedStyle(ui.mapEl).position === 'static') { ui.mapEl.style.position = 'relative'; } } catch(_) {}
      // Live metrics overlays (speed, distance, elevation) - optional via settings
      var hudEnabled = !(window.FGPX && FGPX.hudEnabled === false);
      var metricsSpeedLabel = null, metricsDistLabel = null, metricsElevLabel = null;
      var dirLabel = null; // bottom direction overlay
      if (hudEnabled) {
        var metricsBoxStyle = 'position:absolute;top:6px;background:rgba(0,0,0,0.50);color:#fff;border-radius:6px;padding:4px 8px;font:600 12px system-ui,Segoe UI,Roboto,Arial,sans-serif;pointer-events:none;z-index:1;white-space:nowrap;';
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
        metricsElevLabel.textContent = '0 m';
        metricsElevBox.appendChild(metricsElevLabel);
        ui.mapEl.appendChild(metricsElevBox);
        // Bottom direction overlay (bearing and cardinal)
        var dirBox = document.createElement('div');
        dirBox.className = 'fgpx-direction';
        dirBox.style.cssText = 'position:absolute;bottom:6px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.50);color:#fff;border-radius:6px;padding:4px 10px;font:600 12px system-ui,Segoe UI,Roboto,Arial,sans-serif;pointer-events:none;z-index:1;white-space:nowrap;';
        dirLabel = document.createElement('span');
        dirLabel.textContent = '0° — N';
        dirBox.appendChild(dirLabel);
        ui.mapEl.appendChild(dirBox);
      }

      var overlay = document.createElement('div');
      overlay.className = 'fgpx-photo-overlay';
      overlay.style.cssText = 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:#2a2a2a;z-index:9999;pointer-events:auto;opacity:0;transition:opacity .25s ease';
      var overlayImg = document.createElement('img');
      overlayImg.style.cssText = 'max-width:90%;max-height:100%;object-fit:contain;box-shadow:0 2px 10px rgba(0,0,0,.5)';
      overlay.appendChild(overlayImg);
      var overlayCaption = document.createElement('div');
      overlayCaption.style.cssText = 'position:absolute;right:12px;bottom:10px;color:#fff;background:rgba(0,0,0,0.5);padding:6px 8px;border-radius:4px;font:500 12px system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:50%;pointer-events:none;display:none';
      overlay.appendChild(overlayCaption);
      ui.mapEl.appendChild(overlay);
      function showOverlay(url, caption) { 
        DBG.log('overlay show', { url:url, caption: !!caption });
        
        // Clear any existing map layer first to prevent distorted frames
        if (videoRecorder && videoRecorder.isRecording) {
          videoRecorder.clearPhotoOverlay();
        }
        
        overlayImg.src = url; 
        overlayCaption.textContent = caption || ''; 
        overlayCaption.style.display = caption ? 'block' : 'none'; 
        overlay.style.display = 'flex'; 
        
        // During recording, use dark grey background to match map layer
        if (videoRecorder && videoRecorder.isRecording) {
          overlay.style.background = '#2a2a2a'; // Dark grey to match map layer
        } else {
          overlay.style.background = 'rgba(0,0,0,0.6)'; // Semi-transparent as normal
        }
        
        try { overlay.offsetHeight; } catch(_) {} 
        overlay.style.opacity = '1'; 
      }
      function hideOverlay() {
        DBG.log('overlay hide start');
        
        // Force clear map layer immediately when hiding starts
        if (videoRecorder) {
          DBG.log('hideOverlay: Immediately clearing map layer at start');
          videoRecorder.clearPhotoOverlay();
        }
        
        return new Promise(function(resolve) {
          try {
            overlay.style.opacity = '0';
            var done = function(ev){ 
              if (ev && ev.propertyName && ev.propertyName !== 'opacity') return; 
              overlay.style.display = 'none'; 
              overlayImg.src = ''; 
              overlayCaption.textContent = ''; 
              overlayCaption.style.display = 'none';
              // Reset background to default
              overlay.style.background = 'rgba(0,0,0,0.6)';
              overlay.removeEventListener('transitionend', done); 
              // Clear overlay from map canvas if recording
              DBG.log('hideOverlay: videoRecorder exists?', !!videoRecorder);
              DBG.log('hideOverlay: isRecording?', videoRecorder ? videoRecorder.isRecording : 'N/A');
              if (videoRecorder && videoRecorder.isRecording) {
                DBG.log('hideOverlay: About to clear photo overlay from map');
                videoRecorder.clearPhotoOverlay();
              } else if (videoRecorder) {
                // Force clear even if not recording to ensure cleanup
                DBG.log('hideOverlay: Force clearing photo overlay (not recording but videoRecorder exists)');
                videoRecorder.clearPhotoOverlay();
              }
              DBG.log('overlay hide done');
              resolve();
            };
            overlay.addEventListener('transitionend', done);
            setTimeout(function(){ 
              try { done(); } catch(_) {} 
            }, 500); // Increased timeout to ensure map layer is cleared
          } catch(_) {
            overlay.style.display = 'none'; 
            overlayImg.src = ''; 
            overlayCaption.textContent = ''; 
            overlayCaption.style.display = 'none';
            // Reset background to default
            overlay.style.background = 'rgba(0,0,0,0.6)';
            // Clear overlay from map canvas if recording
            DBG.log('hideOverlay (catch): videoRecorder exists?', !!videoRecorder);
            DBG.log('hideOverlay (catch): isRecording?', videoRecorder ? videoRecorder.isRecording : 'N/A');
            if (videoRecorder && videoRecorder.isRecording) {
              DBG.log('hideOverlay (catch): About to clear photo overlay from map');
              videoRecorder.clearPhotoOverlay();
            } else if (videoRecorder) {
              // Force clear even if not recording to ensure cleanup
              DBG.log('hideOverlay (catch): Force clearing photo overlay (not recording but videoRecorder exists)');
              videoRecorder.clearPhotoOverlay();
            }
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
            computedOpacity: overlay ? getComputedStyle(overlay).opacity : '0'
          });
          
          if (!overlay) {
            return;
          }
          
          // Check both inline styles and computed styles
          var isVisible = overlay.style.display !== 'none' && 
                         overlay.style.opacity !== '0' &&
                         getComputedStyle(overlay).display !== 'none' &&
                         getComputedStyle(overlay).opacity !== '0';
          
          if (!isVisible) {
            DBG.log('Overlay not visible', { 
              inlineDisplay: overlay.style.display,
              inlineOpacity: overlay.style.opacity,
              computedDisplay: getComputedStyle(overlay).display,
              computedOpacity: getComputedStyle(overlay).opacity
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
            naturalHeight: img ? img.naturalHeight : 0
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
            
            DBG.log('Drawing image', { drawX: drawX, drawY: drawY, drawWidth: drawWidth, drawHeight: drawHeight });
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
            hasText: caption && caption.textContent ? true : false
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
      
      // Click anywhere on overlay to close
      overlay.addEventListener('click', function(){ 
        hideOverlay().then(function() { 
          overlayActive = false; 
          currentDisplayedPhoto = null; 
          // Resume playback if still recording
          if (isRecording && !playing) {
            setPlaying(true);
            window.requestAnimationFrame(raf);
          }
        }); 
      });
      // ESC to close
      window.addEventListener('keydown', function(e){ 
        if (overlay.style.display !== 'none' && (e.key === 'Escape' || e.code === 'Escape')) { 
          hideOverlay().then(function() { 
            overlayActive = false; 
            currentDisplayedPhoto = null; 
            // Resume playback if still recording
            if (isRecording && !playing) {
              setPlaying(true);
              window.requestAnimationFrame(raf);
            }
          }); 
        } 
      });

      function processNextPhoto() {
        DBG.log('processNextPhoto()', { overlayActive: overlayActive, queue: photoQueue.length });
        
        // Don't start a new photo if one is already active
        if (overlayActive) {
          return;
        }
        
        var next = photoQueue.shift();
        if (!next) { 
          setPlaying(true); 
          window.requestAnimationFrame(raf); 
          return; 
        }
        
        // Verify the photo is still spatially close to current marker position
        // This prevents showing fullscreen for photos that are far from current location
        try {
          var currentPos = currentPosLngLat || positionAtDistance(progress * totalDistance);
          if (typeof next.lon === 'number' && typeof next.lat === 'number') {
            var distToPhoto = haversineMeters(currentPos, [next.lon, next.lat]);
            // If photo is more than 100m away from current marker, skip it
            if (distToPhoto > 100) {
              DBG.log('skip photo (distance>100m)', distToPhoto);
              // Process next photo immediately
              if (photoQueue.length > 0) {
                processNextPhoto();
              } else {
                setPlaying(true);
                window.requestAnimationFrame(raf);
              }
              return;
            }
          }
        } catch(_) {}
        
        setPlaying(false);
        // Keep recording during photo overlay - don't stop recording
        overlayActive = true;
        currentDisplayedPhoto = next; // Track the currently displayed photo
        DBG.log('show photo overlay', { url: next.fullUrl || next.thumbUrl });
        showOverlay(next.fullUrl || next.thumbUrl || '', next.caption || next.description || next.title || '');
        
        // If recording, also draw the photo overlay on the canvas
        if (videoRecorder && videoRecorder.isRecording) {
          videoRecorder.drawPhotoOverlay(next);
        }
        
        // Extended duration during recording to keep overlay visible over map layer
        var overlayDuration = (videoRecorder && videoRecorder.isRecording) ? 5000 : 3000;
        setTimeout(function(){ 
          hideOverlay().then(function() {
            overlayActive = false; 
            currentDisplayedPhoto = null; // Clear the currently displayed photo
            // Resume playback if still recording, regardless of photo queue
            if (isRecording && !playing) {
              setPlaying(true);
              window.requestAnimationFrame(raf);
            }
            // Process next photo immediately after overlay is fully hidden
            if (photoQueue.length > 0) { 
              processNextPhoto(); 
            } else if (!isRecording) { 
              // Only resume normal playback if not recording
              setPlaying(true); 
              window.requestAnimationFrame(raf); 
            }
          });
        }, overlayDuration);
      }

      // Initial splash play overlay (shown only at initial state)
      var splashDismissed = false;
      var splash = document.createElement('div');
      splash.className = 'fgpx-splash';
      splash.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;background:rgba(0,0,0,0.45);z-index:2;pointer-events:auto';
      var splashBtn = document.createElement('button');
      splashBtn.textContent = '▶ Play';
      splashBtn.className = 'fgpx-btn fgpx-btn-primary';
      splashBtn.style.cssText = 'font-size:20px;padding:10px 18px;margin-bottom:8px';
      var splashTitle = document.createElement('div');
      var titleText = (window.FGPX && FGPX.hostPostTitle) ? String(FGPX.hostPostTitle) : (document && document.title ? String(document.title) : '');
      splashTitle.textContent = titleText;
      splashTitle.style.cssText = 'color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.6);font:600 14px system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:80%;text-align:center';
      
      // Add stats display below title
      var splashStats = document.createElement('div');
      splashStats.style.cssText = 'color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.6);font:400 12px system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:80%;text-align:center;margin-top:4px;opacity:0.9';
      
      splash.appendChild(splashBtn);
      splash.appendChild(splashTitle);
      splash.appendChild(splashStats);
      try { if (window.getComputedStyle && window.getComputedStyle(ui.mapEl).position === 'static') { ui.mapEl.style.position = 'relative'; } } catch(_) {}
      ui.mapEl.appendChild(splash);
      function hideSplash(){ try { splash.style.display = 'none'; splashDismissed = true; } catch(_) {} }
      function startPlaybackWithPreload() {
        if (playing || preloadingInProgress) return;
        hideSplash();
        if (prefetchEnabled && !preloadCompleted) {
          // Start preloading and wait for it to complete before any animation/playback
          tilePrefetchPromise = prefetchTilesForRoute();
        }
        try { 
          (tilePrefetchPromise||Promise.resolve()).then(function(){ 
            // Only start zoom/playback after preloading is completely finished
            if (firstPlayZoomPending) { zoomInThenStartPlayback(); } 
            else { setPlaying(true); window.requestAnimationFrame(raf); } 
          }); 
        } catch(_) { 
          // Fallback: start immediately if promise fails
          if (firstPlayZoomPending) { zoomInThenStartPlayback(); } 
          else { setPlaying(true); window.requestAnimationFrame(raf); } 
        }
      }
      
      splash.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); startPlaybackWithPreload(); });
      splashBtn.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); startPlaybackWithPreload(); });

      // Initial stopped view already set via constructor bounds; keep references for later reset/end fits
      var fullBoundsRef = fullBounds;
      var innerBoundsRef = innerBounds;

      // Stats panel
      try {
        var km = totalDistance / 1000;
        var moveS = stats.moving_time_s != null ? stats.moving_time_s : (totalDuration != null ? totalDuration : 0);
        var avgKmh = stats.average_speed_m_s != null ? (stats.average_speed_m_s * 3.6) : (moveS > 0 ? (km / (moveS / 3600)) : 0);
        var gain = stats.elevation_gain_m != null ? stats.elevation_gain_m : 0;
        ui.stats.dist.innerHTML = '<strong>' + formatNumber(km, 2) + '</strong> km';
        ui.stats.time.innerHTML = '<strong>' + formatTime(moveS) + '</strong> time';
        ui.stats.avg.innerHTML = '<strong>' + formatNumber(avgKmh, 1) + '</strong> km/h';
        ui.stats.gain.innerHTML = '<strong>' + Math.round(gain) + '</strong> m gain';
        
        // Update splash stats display
        try {
          if (splashStats && !splashDismissed) {
            splashStats.textContent = formatNumber(km, 2) + ' km | ' + formatTime(moveS) + ' | ' + formatNumber(avgKmh, 1) + ' km/h | ' + Math.round(gain) + ' m gain';
          }
        } catch(_) {}
      } catch (_) {}

      // Chart.js elevation vs time (if available) else distance
      var useTime = Array.isArray(timeOffsets);
      var xVals = useTime ? (Array.isArray(movingTimeOffsets) ? movingTimeOffsets : timeOffsets) : cumDist.map(function (m) { return m / 1000; });
      var elev = coords.map(function (c) { return (typeof c[2] === 'number' ? c[2] : 0); });
      // Build speed series (km/h) aligned to xVals when time is available
      var speedSeries = null;
      if (useTime && Array.isArray(cumDist)) {
        try {
          var tSeries = Array.isArray(movingTimeOffsets) ? movingTimeOffsets : timeOffsets;
          speedSeries = new Array(coords.length);
          speedSeries[0] = 0;
          for (var si = 1; si < coords.length; si++) {
            var ddS = Math.max(0, (cumDist[si] - cumDist[si - 1]));
            var dtS = Math.max(1e-3, (tSeries[si] - tSeries[si - 1]));
            speedSeries[si] = (ddS / dtS) * 3.6;
          }
        } catch(_) { speedSeries = null; }
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
            cursorVisible = (cursorX >= zoomRange.min && cursorX <= zoomRange.max);
          }
          
          if (!cursorVisible) return; // Don't draw cursor if outside zoom range
          
          var xVal = Math.min(Math.max(cursorX, xScale.min), xScale.max);
          var x = xScale.getPixelForValue(xVal);
          ctx.save();
          ctx.strokeStyle = 'rgba(0,0,0,0.5)';
          if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
          }
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x, chart.chartArea.top); ctx.lineTo(x, chart.chartArea.bottom); ctx.stroke();
          ctx.restore();
        },
        // overlay draw for the position dot to guarantee it is above all datasets
        afterDatasetsDraw: function (chart, args, pluginOptions) {
          try {
            var ds1 = chart.data && chart.data.datasets && chart.data.datasets[1];
            var pt = ds1 && ds1.data && ds1.data[0];
            var xScale = chart.scales.x;
            var yScale = chart.scales.y;
            if (!pt || !xScale || !yScale) return;
            
            // Check if position dot should be visible based on zoom state
            var dotVisible = true;
            if (chart.chartZoomState && chart.chartZoomState.zoomedRange) {
              var zoomRange = chart.chartZoomState.zoomedRange;
              dotVisible = (pt.x >= zoomRange.min && pt.x <= zoomRange.max);
            }
            
            if (!dotVisible) return; // Don't draw dot if outside zoom range
            
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
          } catch(_) {}
        }
      };
      var chartLineColor = (window.FGPX && FGPX.chartColor) ? String(FGPX.chartColor) : '#ff5500';
      var chartLineColor2 = (window.FGPX && FGPX.chartColor2) ? String(FGPX.chartColor2) : '#1976d2';
      var chartLineColor3 = (window.FGPX && FGPX.chartColorHr) ? String(FGPX.chartColorHr) : '#dc2626'; // Heart rate color
      var chartLineColor4 = (window.FGPX && FGPX.chartColorCad) ? String(FGPX.chartColorCad) : '#7c3aed'; // Cadence color
      var chartLineColor5 = (window.FGPX && FGPX.chartColorTemp) ? String(FGPX.chartColorTemp) : '#f59e0b'; // Temperature color
      var chartLineColor6 = (window.FGPX && FGPX.chartColorPower) ? String(FGPX.chartColorPower) : '#059669'; // Power color
      var chartLineColorWindImpact = (window.FGPX && FGPX.chartColorWindImpact) ? String(FGPX.chartColorWindImpact) : '#ff6b35'; // Wind impact color
      var chartLineColorWindRose = (window.FGPX && FGPX.chartColorWindRose) ? String(FGPX.chartColorWindRose) : '#4ecdc4'; // Wind rose color
      // Wind rose directional colors
      var windRoseColorNorth = (window.FGPX && FGPX.windRoseColorNorth) ? String(FGPX.windRoseColorNorth) : '#3b82f6'; // Blue - Headwind
      var windRoseColorSouth = (window.FGPX && FGPX.windRoseColorSouth) ? String(FGPX.windRoseColorSouth) : '#10b981'; // Green - Tailwind
      var windRoseColorEast = (window.FGPX && FGPX.windRoseColorEast) ? String(FGPX.windRoseColorEast) : '#f59e0b';   // Orange - Right sidewind
      var windRoseColorWest = (window.FGPX && FGPX.windRoseColorWest) ? String(FGPX.windRoseColorWest) : '#ef4444';   // Red - Left sidewind

      // ========== LAZY LOADING: PROCESS ONLY ESSENTIAL DATA INITIALLY ==========
      // Pre-process only elevation data (essential for initial render)
      var points = getChartData('elevation');
      
      // Lazy-loaded data points (processed on-demand)
      var speedPoints = null;
      var heartRatePoints = null;
      var cadencePoints = null;
      var temperaturePoints = null;
      var powerPoints = null;
      var windSpeedPoints = null;
      var windImpactPoints = null;
      
      // Helper function to get data points for specific chart type
      function getDataPointsForChart(chartType) {
        switch (chartType) {
          case 'elevation':
            return {
              elevation: points,
              speed: speedPoints || getChartData('speed')
            };
          case 'biometrics':
            return {
              heartRate: heartRatePoints || getChartData('heartRate'),
              cadence: cadencePoints || getChartData('cadence')
            };
          case 'temperature':
            return {
              temperature: temperaturePoints || getChartData('temperature')
            };
          case 'power':
            return {
              power: powerPoints || getChartData('power')
            };
          case 'windimpact':
            return {
              windSpeed: windSpeedPoints || getChartData('windSpeed'),
              windImpact: windImpactPoints || getChartData('windImpact')
            };
          case 'windrose':
            return {
              windDirection: getChartData('windDirection')
            };
          case 'all':
            // Load all data for combined chart
            return {
              elevation: points,
              speed: speedPoints || getChartData('speed'),
              heartRate: heartRatePoints || getChartData('heartRate'),
              cadence: cadencePoints || getChartData('cadence'),
              temperature: temperaturePoints || getChartData('temperature'),
              power: powerPoints || getChartData('power')
            };
          default:
            return {};
        }
      }
      
      var xMin = xVals.length > 0 ? xVals[0] : 0;
      var xMax = xVals.length > 0 ? xVals[xVals.length - 1] : 1;
      
      // Define showNoDataMessage function here where createChart can access it
      var showNoDataMessageLocal = function(message) {
        if (chart) {
          chart.destroy();
          chart = null;
        }
        
        // Find chart canvas and replace with message
        var chartWrap = document.querySelector('.fgpx-chart-wrap');
        if (chartWrap) {
          chartWrap.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:200px;color:#666;font-size:14px;text-align:center;padding:20px;">' + message + '</div>';
        }
      };
      
      // Assign to global scope for backward compatibility
      window.showNoDataMessage = showNoDataMessageLocal;
      
      // Define switchChartTab function here where event listeners can access it
      window.switchChartTab = function(tabType) {
        DBG.log('Switching to tab', { tabType: tabType });
        currentChartTab = tabType;
        
        var tabElements = [ui.tabs.tabElevation, ui.tabs.tabBiometrics, ui.tabs.tabTemperature, ui.tabs.tabPower, ui.tabs.tabWindImpact, ui.tabs.tabWindRose, ui.tabs.tabAll];
        var tabTypes = ['elevation', 'biometrics', 'temperature', 'power', 'windimpact', 'windrose', 'all'];
        
        tabElements.forEach(function(tab, index) {
          if (tabTypes[index] === tabType) {
            tab.className = 'fgpx-chart-tab fgpx-chart-tab-active';
            tab.style.cssText = 'flex:1;padding:8px 12px;border:none;background:transparent;cursor:pointer;font-size:12px;border-bottom:2px solid #007cba;color:#007cba;font-weight:600';
          } else {
            tab.className = 'fgpx-chart-tab';
            tab.style.cssText = 'flex:1;padding:8px 12px;border:none;background:transparent;cursor:pointer;font-size:12px;border-bottom:2px solid transparent;color:#666;font-weight:400';
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
        
        // Reset chart zoom when switching tabs
        if (chart && chart.chartZoomState && chart.chartZoomState.originalScales) {
          resetChartZoom(chart);
          DBG.log('Chart zoom reset on tab switch');
        }
        
        // Recreate chart with new configuration if chart creation function exists
        if (typeof createChart === 'function') {
          createChart(tabType);
        }
      };
      
      // Chart data series visibility state for All Data tab
      var chartDataVisibility = {
        elevation: true,
        speed: true,
        heartRate: true,
        cadence: true,
        temperature: true,
        power: true
      };
      
      // Initialize legend controls for All Data tab
      function initializeLegendControls() {
        // Clear existing controls except title
        var title = ui.chartLegend.querySelector('span');
        ui.chartLegend.innerHTML = '';
        ui.chartLegend.appendChild(title);
        
        // Define available data series with their colors and labels
        var dataSeries = [
          { key: 'elevation', label: 'Elevation', color: chartLineColor, available: true },
          { key: 'speed', label: 'Speed', color: chartLineColor2, available: useTime && speedPoints.length > 0 },
          { key: 'heartRate', label: 'Heart Rate', color: chartLineColor3, available: heartRatePoints.length > 0 },
          { key: 'cadence', label: 'Cadence', color: chartLineColor4, available: cadencePoints.length > 0 },
          { key: 'temperature', label: 'Temperature', color: chartLineColor5, available: temperaturePoints.length > 0 },
          { key: 'power', label: 'Power', color: chartLineColor6, available: powerPoints.length > 0 }
        ];
        
        // Create checkbox controls for available data series
        dataSeries.forEach(function(series) {
          if (series.available) {
            var controlWrap = document.createElement('label');
            controlWrap.style.cssText = 'display:inline-flex;align-items:center;margin-right:16px;cursor:pointer;';
            
            var checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = chartDataVisibility[series.key];
            checkbox.style.cssText = 'margin-right:4px;';
            
            var colorBox = document.createElement('span');
            colorBox.style.cssText = 'display:inline-block;width:12px;height:12px;margin-right:4px;border:1px solid #ccc;background:' + series.color + ';';
            
            var label = document.createElement('span');
            label.textContent = series.label;
            label.style.cssText = 'font-size:11px;color:#333;';
            
            controlWrap.appendChild(checkbox);
            controlWrap.appendChild(colorBox);
            controlWrap.appendChild(label);
            
            // Add event listener for toggle
            checkbox.addEventListener('change', function() {
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
      ui.tabs.tabElevation.addEventListener('click', function() { window.switchChartTab('elevation'); });
      ui.tabs.tabBiometrics.addEventListener('click', function() { window.switchChartTab('biometrics'); });
      ui.tabs.tabTemperature.addEventListener('click', function() { window.switchChartTab('temperature'); });
      ui.tabs.tabPower.addEventListener('click', function() { window.switchChartTab('power'); });
      ui.tabs.tabWindImpact.addEventListener('click', function() { window.switchChartTab('windimpact'); });
      ui.tabs.tabWindRose.addEventListener('click', function() { window.switchChartTab('windrose'); });
      ui.tabs.tabAll.addEventListener('click', function() { window.switchChartTab('all'); });
      
      // Immediate debug test to verify logging works
      DBG.log('=== DEBUG TEST: Chart creation started ===');
      DBG.log('SunCalc availability check', {
        windowSunCalc: typeof window.SunCalc,
        SunCalcObject: window.SunCalc ? 'loaded' : 'missing'
      });

      // Calculate day/night periods if SunCalc is available and we have timestamps
      var dayNightPeriods = null;
      DBG.log('Day/night calculation check', {
        hasSunCalc: typeof window.SunCalc !== 'undefined',
        hasTimestamps: hasTimestamps,
        timestampsArray: Array.isArray(timestamps),
        coordsArray: Array.isArray(coords),
        timestampsLength: timestamps ? timestamps.length : 0,
        coordsLength: coords ? coords.length : 0,
        timeOffsetsLength: timeOffsets ? timeOffsets.length : 0
      });
      
      if (typeof window.SunCalc !== 'undefined' && hasTimestamps && Array.isArray(timestamps) && Array.isArray(coords)) {
        try {
          dayNightPeriods = calculateDayNightPeriods(coords, timestamps, timeOffsets);
          DBG.log('Day/night periods calculated', { 
            periods: dayNightPeriods ? dayNightPeriods.length : 0,
            periodsData: dayNightPeriods
          });
        } catch (e) {
          DBG.warn('Failed to calculate day/night periods:', e);
        }
      } else {
        DBG.log('Day/night calculation skipped - requirements not met');
      }

      // Helper function to calculate day/night periods
      function calculateDayNightPeriods(coordinates, timestampArray, timeOffsetsArray) {
        DBG.log('calculateDayNightPeriods called', {
          coordinatesLength: coordinates.length,
          timestampArrayLength: timestampArray.length,
          timeOffsetsArrayLength: timeOffsetsArray ? timeOffsetsArray.length : 0,
          firstTimestamp: timestampArray[0],
          firstCoord: coordinates[0]
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
        while (firstIdx < timestampArray.length && (!timestampArray[firstIdx] || !coordinates[firstIdx])) {
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
          lastTime: new Date(timestampArray[lastIdx])
        });
        
        // Calculate for date range
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
        
        // Calculate for each day in the range, using actual track dates
        var currentDate = new Date(startDate);
        // Keep the original time instead of setting to midnight
        
        DBG.log('Date range calculation', {
          startDate: startDate,
          endDate: endDate,
          currentDate: new Date(currentDate),
          trackStartTime: timestampArray[firstIdx],
          trackEndTime: timestampArray[lastIdx]
        });
        
        // Calculate for start date and end date (if different days)
        var processedDates = [];
        
        // Always process the start date
        var times = window.SunCalc.getTimes(currentDate, avgLat, avgLon);
        processedDates.push(new Date(currentDate));
        
        DBG.log('SunCalc times for start date', {
          date: new Date(currentDate),
          sunrise: times.sunrise,
          sunset: times.sunset,
          sunriseValid: !isNaN(times.sunrise.getTime()),
          sunsetValid: !isNaN(times.sunset.getTime())
        });
        
        if (!isNaN(times.sunrise.getTime()) && !isNaN(times.sunset.getTime())) {
          // Convert to elapsed time offsets (seconds from track start)
          var trackStartTime = new Date(timestampArray[firstIdx]).getTime();
          var sunriseOffset = (times.sunrise.getTime() - trackStartTime) / 1000;
          var sunsetOffset = (times.sunset.getTime() - trackStartTime) / 1000;
          
          // Only include periods that fall within the track time range
          var trackDuration = (new Date(timestampArray[lastIdx]).getTime() - new Date(timestampArray[firstIdx]).getTime()) / 1000;
          
          DBG.log('Time offset calculations for start date', {
            date: new Date(currentDate),
            sunriseTime: times.sunrise,
            sunsetTime: times.sunset,
            trackStartTime: trackStartTime,
            sunriseOffset: sunriseOffset,
            sunsetOffset: sunsetOffset,
            trackDuration: trackDuration,
            sunriseInRange: sunriseOffset >= 0 && sunriseOffset <= trackDuration,
            sunsetInRange: sunsetOffset >= 0 && sunsetOffset <= trackDuration
          });
          
          if (sunriseOffset >= 0 && sunriseOffset <= trackDuration) {
            periods.push({
              type: 'sunrise',
              timeOffset: sunriseOffset,
              time: times.sunrise
            });
            DBG.log('Added sunrise', { date: currentDate, timeOffset: sunriseOffset });
          }
          
          if (sunsetOffset >= 0 && sunsetOffset <= trackDuration) {
            periods.push({
              type: 'sunset',
              timeOffset: sunsetOffset, 
              time: times.sunset
            });
            DBG.log('Added sunset', { date: currentDate, timeOffset: sunsetOffset });
          }
        }
        
        // If track spans multiple days, also process the end date
        var endDateOnly = new Date(endDate);
        endDateOnly.setHours(0, 0, 0, 0);
        var startDateOnly = new Date(startDate);
        startDateOnly.setHours(0, 0, 0, 0);
        
        if (endDateOnly.getTime() !== startDateOnly.getTime()) {
          times = window.SunCalc.getTimes(endDate, avgLat, avgLon);
          
          DBG.log('SunCalc times for end date', {
            date: new Date(endDate),
            sunrise: times.sunrise,
            sunset: times.sunset,
            sunriseValid: !isNaN(times.sunrise.getTime()),
            sunsetValid: !isNaN(times.sunset.getTime())
          });
          
          if (!isNaN(times.sunrise.getTime()) && !isNaN(times.sunset.getTime())) {
            // Convert to elapsed time offsets (seconds from track start)
            var trackStartTime = new Date(timestampArray[firstIdx]).getTime();
            var sunriseOffset = (times.sunrise.getTime() - trackStartTime) / 1000;
            var sunsetOffset = (times.sunset.getTime() - trackStartTime) / 1000;
            
            // Only include periods that fall within the track time range
            var trackDuration = (new Date(timestampArray[lastIdx]).getTime() - new Date(timestampArray[firstIdx]).getTime()) / 1000;
            
            DBG.log('Time offset calculations for end date', {
              date: new Date(endDate),
              sunriseTime: times.sunrise,
              sunsetTime: times.sunset,
              trackStartTime: trackStartTime,
              sunriseOffset: sunriseOffset,
              sunsetOffset: sunsetOffset,
              trackDuration: trackDuration,
              sunriseInRange: sunriseOffset >= 0 && sunriseOffset <= trackDuration,
              sunsetInRange: sunsetOffset >= 0 && sunsetOffset <= trackDuration
            });
            
            if (sunriseOffset >= 0 && sunriseOffset <= trackDuration) {
              periods.push({
                type: 'sunrise',
                timeOffset: sunriseOffset,
                time: times.sunrise
              });
              DBG.log('Added sunrise', { date: endDate, timeOffset: sunriseOffset });
            }
            
            if (sunsetOffset >= 0 && sunsetOffset <= trackDuration) {
              periods.push({
                type: 'sunset',
                timeOffset: sunsetOffset, 
                time: times.sunset
              });
              DBG.log('Added sunset', { date: endDate, timeOffset: sunsetOffset });
            }
          }
        }
        
        var sortedPeriods = periods.sort(function(a, b) { return a.timeOffset - b.timeOffset; });
        DBG.log('Final periods', { count: sortedPeriods.length, periods: sortedPeriods });
        return sortedPeriods;
      }

      // Assign the chart creation function to the variable declared in UI scope
      createChart = function(tabType) {
        // ========== LAZY LOADING: LOAD DATA ON DEMAND ==========
        var startTime = performance.now();
        var chartData = getDataPointsForChart(tabType);
        
        // Update cached variables for backward compatibility
        if (chartData.elevation) points = chartData.elevation;
        if (chartData.speed) speedPoints = chartData.speed;
        if (chartData.heartRate) heartRatePoints = chartData.heartRate;
        if (chartData.cadence) cadencePoints = chartData.cadence;
        if (chartData.temperature) temperaturePoints = chartData.temperature;
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
          elevationPoints: points ? points.length : 0,
          speedPoints: speedPoints ? speedPoints.length : 0,
          windSpeedPoints: windSpeedPoints ? windSpeedPoints.length : 0,
          windImpactPoints: windImpactPoints ? windImpactPoints.length : 0,
          windDirectionsAvailable: Array.isArray(windDirections) ? windDirections.length : 0,
          windSpeedsAvailable: Array.isArray(windSpeeds) ? windSpeeds.length : 0,
          dayNightPeriods: dayNightPeriods ? dayNightPeriods.length : 0
        });
        
        // Clear any existing no-data message first
        var chartWrap = document.querySelector('.fgpx-chart-wrap');
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
          x: useTime ? { type: 'linear', bounds: 'data', min: xMin, max: xMax, title: { display: true, text: 'Time' }, ticks: { callback: function(val){ return formatTime(val); } } } : { type: 'linear', bounds: 'data', min: xMin, max: xMax, title: { display: true, text: 'Distance (km)' } }
        };
        
        // Position marker (dynamically assigned based on available data) - Always on top
        var positionDataset;
        
        // Function to create position marker with correct initial data
        function createPositionMarker() {
          if (tabType === 'elevation') {
            positionDataset = { 
              label: 'Position', 
              data: [{ x: xVals[0], y: (coords[0] && typeof coords[0][2] === 'number') ? coords[0][2] : 0 }], 
              pointRadius: 5, 
              pointHoverRadius: 5, 
              pointBorderWidth: 2, 
              pointBorderColor: '#fff', 
              borderWidth: 0, 
              showLine: false, 
              backgroundColor: '#111', 
              pointBackgroundColor: '#111', 
              yAxisID: 'y' 
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
                yAxisID: 'y' 
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
                yAxisID: 'y2' 
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
                yAxisID: 'y' 
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
                yAxisID: 'y' 
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
                yAxisID: 'y' 
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
                yAxisID: 'y' 
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
                yAxisID: 'y' 
              };
            }
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
                yAxisID: 'y' 
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
                yAxisID: 'y2' 
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
                yAxisID: 'y' 
              };
            }
          } else {
            // Default fallback for all other tab types
            positionDataset = { 
              label: 'Position', 
              data: [{ x: xVals[0], y: (coords[0] && typeof coords[0][2] === 'number') ? coords[0][2] : 0 }], 
              pointRadius: 5, 
              pointHoverRadius: 5, 
              pointBorderWidth: 2, 
              pointBorderColor: '#fff', 
              borderWidth: 0, 
              showLine: false, 
              backgroundColor: '#111', 
              pointBackgroundColor: '#111', 
              yAxisID: 'y' 
            };
          }
        }
        
        // Create position marker with correct initial data
        createPositionMarker();
        
        // Store current tab type for position marker updates
        window.currentChartTabType = tabType;
        
        // Function to get position marker Y value based on current tab and index
        window.getPositionMarkerY = function(index) {
          try {
            var tabType = window.currentChartTabType;
            if (tabType === 'elevation') {
              return (typeof coords[index][2] === 'number') ? coords[index][2] : 0;
            } else if (tabType === 'biometrics') {
              if (heartRatePoints && heartRatePoints.length > 0 && index < heartRatePoints.length) {
                return heartRatePoints[index] ? heartRatePoints[index].y : 0;
              } else if (cadencePoints && cadencePoints.length > 0 && index < cadencePoints.length) {
                return cadencePoints[index] ? cadencePoints[index].y : 0;
              }
              return 0;
            } else if (tabType === 'temperature') {
              if (temperaturePoints.length > 0 && index < temperaturePoints.length) {
                return temperaturePoints[index] ? temperaturePoints[index].y : 0;
              }
            } else if (tabType === 'power') {
              if (powerPoints.length > 0 && index < powerPoints.length) {
                return powerPoints[index] ? powerPoints[index].y : 0;
              }
            } else if (tabType === 'windimpact') {
              if (windImpactPoints && windImpactPoints.length > 0 && index < windImpactPoints.length) {
                return windImpactPoints[index] ? windImpactPoints[index].y : 0;
              } else if (windSpeedPoints && windSpeedPoints.length > 0 && index < windSpeedPoints.length) {
                return windSpeedPoints[index] ? windSpeedPoints[index].y : 0;
              }
              return 0;
            } else if (tabType === 'windrose') {
              // Wind rose doesn't use position marker
              return 0;
            } else if (tabType === 'all') {
              // For All Data tab, use first visible dataset
              if (chartDataVisibility.elevation) {
                return (typeof coords[index][2] === 'number') ? coords[index][2] : 0;
              } else if (chartDataVisibility.speed && useTime && speedPoints.length > 0 && index < speedPoints.length) {
                return speedPoints[index] ? speedPoints[index].y : 0;
              } else if (chartDataVisibility.heartRate && heartRatePoints.length > 0 && index < heartRatePoints.length) {
                return heartRatePoints[index] ? heartRatePoints[index].y : 0;
              } else if (chartDataVisibility.cadence && cadencePoints.length > 0 && index < cadencePoints.length) {
                return cadencePoints[index] ? cadencePoints[index].y : 0;
              } else if (chartDataVisibility.temperature && temperaturePoints.length > 0 && index < temperaturePoints.length) {
                return temperaturePoints[index] ? temperaturePoints[index].y : 0;
              } else if (chartDataVisibility.power && powerPoints.length > 0 && index < powerPoints.length) {
                return powerPoints[index] ? powerPoints[index].y : 0;
              }
            }
            // Fallback to elevation
            return (typeof coords[index][2] === 'number') ? coords[index][2] : 0;
          } catch(e) {
            return 0;
          }
        };
        
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
          
          // Create gradient based on steepness thresholds
          var gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
          
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
              gradient.addColorStop(position, 'rgba(' + r + ',' + g + ',' + b + ', 0.6)');
            }
          } else {
            // Fallback to solid color if no gradients available
            var hex = baseColor.replace('#', '');
            var r = parseInt(hex.substr(0, 2), 16);
            var g = parseInt(hex.substr(2, 2), 16);
            var b = parseInt(hex.substr(4, 2), 16);
            gradient.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ', 0.6)');
            gradient.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ', 0.6)');
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
            yAxisID: 'y'
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
              yAxisID: 'y2'
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
            yAxisID: 'y'
          });
          
          scales.y = { title: { display: true, text: 'Elevation (m)' }, ticks: { precision: 0 } };
          scales.y2 = { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Speed (km/h)' }, ticks: { precision: 0 } };
        } else if (tabType === 'biometrics') {
          // Heart Rate + Cadence tab
          if ((heartRatePoints && heartRatePoints.length > 0) || (cadencePoints && cadencePoints.length > 0)) {
            if (heartRatePoints && heartRatePoints.length > 0) {
              datasets.push({ label: 'Heart Rate (bpm)', data: heartRatePoints, borderColor: chartLineColor3, pointRadius: 0, fill: false, tension: 0.2, parsing: false, yAxisID: 'y' });
            }
            datasets.push(positionDataset);
            if (cadencePoints && cadencePoints.length > 0) {
              datasets.push({ label: 'Cadence (rpm)', data: cadencePoints, borderColor: chartLineColor4, pointRadius: 0, fill: false, tension: 0.2, parsing: false, yAxisID: 'y2' });
            }
            scales.y = { title: { display: true, text: 'Heart Rate (bpm)' }, ticks: { precision: 0 } };
            scales.y2 = { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Cadence (rpm)' }, ticks: { precision: 0 } };
          } else {
            // No biometric data available - show message
            return showNoDataMessageLocal('No heart rate or cadence data available for this track.');
          }
        } else if (tabType === 'temperature') {
          // Temperature tab
          if (temperaturePoints && temperaturePoints.length > 0) {
            datasets.push({ label: 'Temperature (°C)', data: temperaturePoints, borderColor: chartLineColor5, pointRadius: 0, fill: false, tension: 0.2, parsing: false, yAxisID: 'y' });
            datasets.push(positionDataset);
            scales.y = { title: { display: true, text: 'Temperature (°C)' }, ticks: { precision: 1 } };
          } else {
            // No temperature data available - show message
            return showNoDataMessageLocal('No temperature data available for this track.');
          }
        } else if (tabType === 'power') {
          // Power tab
          if (powerPoints && powerPoints.length > 0) {
            datasets.push({ label: 'Power (watts)', data: powerPoints, borderColor: chartLineColor6, pointRadius: 0, fill: false, tension: 0.2, parsing: false, yAxisID: 'y' });
            datasets.push(positionDataset);
            scales.y = { title: { display: true, text: 'Power (watts)' }, ticks: { precision: 0 } };
          } else {
            // No power data available - show message
            return showNoDataMessageLocal('No power data available for this track.');
          }
        } else if (tabType === 'windimpact') {
          // Wind Impact tab
          if ((windImpactPoints && windImpactPoints.length > 0) || (windSpeedPoints && windSpeedPoints.length > 0)) {
            if (windImpactPoints && windImpactPoints.length > 0) {
              datasets.push({ label: 'Wind Impact (km/h)', data: windImpactPoints, borderColor: chartLineColorWindImpact, pointRadius: 0, fill: false, tension: 0.2, parsing: false, yAxisID: 'y' });
            }
            datasets.push(positionDataset);
            if (windSpeedPoints && windSpeedPoints.length > 0) {
              datasets.push({ label: 'Wind Speed (km/h)', data: windSpeedPoints, borderColor: chartLineColorWindRose, pointRadius: 0, fill: false, tension: 0.2, parsing: false, yAxisID: 'y2' });
            }
            scales.y = { 
              title: { display: true, text: 'Speed Gain/Loss (km/h)' }, 
              ticks: { precision: 1 },
              grid: { 
                color: function(context) {
                  // Highlight the zero line
                  return context.tick.value === 0 ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.1)';
                },
                lineWidth: function(context) {
                  return context.tick.value === 0 ? 2 : 1;
                }
              }
            };
            scales.y2 = { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Wind Speed (km/h)' }, ticks: { precision: 1 } };
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
            sampleWindSpeed: windSpeeds ? windSpeeds[0] : null
          });
          
          if (Array.isArray(windDirections) && Array.isArray(windSpeeds) && windDirections.length > 0 && windSpeeds.length > 0) {
            // Create wind rose data - 16 compass sectors
            var windRoseData = new Array(16).fill(0);
            var windRoseCounts = new Array(16).fill(0);
            var sectorLabels = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
            
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
              windRoseData: windRoseData
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
              totalDataPoints: windRoseCounts.reduce(function(a, b) { return a + b; }, 0)
            });
            
            // Check if we have any valid data for the wind rose
            if (validDataPoints === 0) {
              DBG.log('Wind Rose: No valid data points found');
              return showNoDataMessageLocal('No valid wind data available for wind rose chart.');
            }
            
            // Function to get color for each sector based on wind direction
            function getSectorColor(sectorIndex) {
              // Map 16 sectors to 4 main directions (±45°)
              // N: sectors 0,1,14,15 (315°-45°)
              // E: sectors 2,3,4,5 (45°-135°)  
              // S: sectors 6,7,8,9 (135°-225°)
              // W: sectors 10,11,12,13 (225°-315°)
              
              if (sectorIndex === 0 || sectorIndex === 1 || sectorIndex === 14 || sectorIndex === 15) {
                return windRoseColorNorth; // North - Headwind
              } else if (sectorIndex >= 2 && sectorIndex <= 5) {
                return windRoseColorEast;  // East - Right sidewind
              } else if (sectorIndex >= 6 && sectorIndex <= 9) {
                return windRoseColorSouth; // South - Tailwind
              } else {
                return windRoseColorWest;  // West - Left sidewind
              }
            }
            
            datasets.push({
              label: 'Wind Speed (km/h)',
              data: windRoseData,
              backgroundColor: windRoseData.map(function(speed, index) {
                var alpha = Math.min(1, Math.max(0.1, speed / 20)); // Scale opacity based on wind speed, minimum 0.1
                var baseColor = getSectorColor(index);
                // Convert hex color to rgba
                var hex = baseColor.replace('#', '');
                var r = parseInt(hex.substr(0, 2), 16);
                var g = parseInt(hex.substr(2, 2), 16);
                var b = parseInt(hex.substr(4, 2), 16);
                return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
              }),
              borderColor: windRoseData.map(function(speed, index) {
                return getSectorColor(index);
              }),
              borderWidth: 1
            });
            
            // Use polar area chart configuration
            var chartConfig = {
              type: 'polarArea',
              data: { labels: sectorLabels, datasets: datasets },
              plugins: [{
                id: 'coordinateAxes',
                afterDraw: function(chart) {
                  var ctx = chart.ctx;
                  var chartArea = chart.chartArea;
                  var centerX = (chartArea.left + chartArea.right) / 2;
                  var centerY = (chartArea.top + chartArea.bottom) / 2;
                  var radius = Math.min(chartArea.right - centerX, chartArea.bottom - centerY) * 0.75;
                  
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
                  ctx.fillText('E', centerX + radius + labelOffsetHorizontal/2, centerY);
                  
                  // West (left)
                  ctx.fillStyle = windRoseColorWest;
                  ctx.textAlign = 'right';
                  ctx.fillText('W', centerX - radius - labelOffsetHorizontal/2, centerY);
                  
                  // Restore context
                  ctx.restore();
                }
              }],
              options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                  padding: {
                    top: 15,
                    bottom: 5
                  }
                },
                plugins: {
                  legend: { 
                    display: true, 
                    position: 'bottom',
                    align: 'center',
                    labels: {
                      generateLabels: function(chart) {
                        return [
                          { text: 'North (Headwind)', fillStyle: windRoseColorNorth, strokeStyle: windRoseColorNorth },
                          { text: 'South (Tailwind)', fillStyle: windRoseColorSouth, strokeStyle: windRoseColorSouth },
                          { text: 'East (Right Sidewind)', fillStyle: windRoseColorEast, strokeStyle: windRoseColorEast },
                          { text: 'West (Left Sidewind)', fillStyle: windRoseColorWest, strokeStyle: windRoseColorWest }
                        ];
                      }
                    }
                  },
                  tooltip: {
                    callbacks: {
                      label: function(context) {
                        var direction = context.label;
                        var speed = context.parsed.r.toFixed(1);
                        var windType = '';
                        var sectorIndex = context.dataIndex;
                        
                        if (sectorIndex === 0 || sectorIndex === 1 || sectorIndex === 14 || sectorIndex === 15) {
                          windType = ' (Headwind)';
                        } else if (sectorIndex >= 2 && sectorIndex <= 5) {
                          windType = ' (Right Sidewind)';
                        } else if (sectorIndex >= 6 && sectorIndex <= 9) {
                          windType = ' (Tailwind)';
                        } else {
                          windType = ' (Left Sidewind)';
                        }
                        
                        return direction + windType + ': ' + speed + ' km/h';
                      }
                    }
                  }
                },
                scales: {
                  r: {
                    beginAtZero: true,
                    title: { display: true, text: 'Wind Speed (km/h)' },
                    grid: {
                      color: 'rgba(0,0,0,0.1)'
                    },
                    angleLines: {
                      color: 'rgba(0,0,0,0.2)',
                      lineWidth: 1
                    },
                    pointLabels: {
                      font: {
                        size: 14,
                        weight: 'bold'
                      },
                      color: function(context) {
                        var index = context.index;
                        // Color the main compass directions
                        if (index === 0) return windRoseColorNorth;  // N
                        if (index === 4) return windRoseColorEast;   // E  
                        if (index === 8) return windRoseColorSouth;  // S
                        if (index === 12) return windRoseColorWest;  // W
                        return 'rgba(0,0,0,0.7)'; // Other directions
                      }
                    }
                  }
                }
              }
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
            
            // Create gradient based on steepness thresholds
            var gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
            
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
                gradient.addColorStop(position, 'rgba(' + r + ',' + g + ',' + b + ', 0.4)');
              }
            } else {
              // Fallback to solid color if no gradients available
              var hex = baseColor.replace('#', '');
              var r = parseInt(hex.substr(0, 2), 16);
              var g = parseInt(hex.substr(2, 2), 16);
              var b = parseInt(hex.substr(4, 2), 16);
              gradient.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ', 0.4)');
              gradient.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ', 0.4)');
            }
            
            datasets.push({ 
              label: 'Elevation (m)', 
              data: points, 
              borderColor: chartLineColor, 
              pointRadius: 0, 
              fill: false, 
              tension: 0.2, 
              parsing: false, 
              yAxisID: 'y'
            });
          }
          
          // Position marker (added after elevation for proper layering)
          datasets.push(positionDataset);
          
          // Other datasets (added last to be on top)
          if (chartDataVisibility.speed && speedPoints && speedPoints.length > 0) {
            datasets.push({ label: 'Speed (km/h)', data: speedPoints, borderColor: chartLineColor2, pointRadius: 0, fill: false, tension: 0.2, parsing: false, yAxisID: 'y2' });
          }
          if (chartDataVisibility.heartRate && heartRatePoints && heartRatePoints.length > 0) {
            datasets.push({ label: 'Heart Rate (bpm)', data: heartRatePoints, borderColor: chartLineColor3, pointRadius: 0, fill: false, tension: 0.2, parsing: false, yAxisID: 'y3' });
          }
          if (chartDataVisibility.cadence && cadencePoints && cadencePoints.length > 0) {
            datasets.push({ label: 'Cadence (rpm)', data: cadencePoints, borderColor: chartLineColor4, pointRadius: 0, fill: false, tension: 0.2, parsing: false, yAxisID: 'y4' });
          }
          if (chartDataVisibility.temperature && temperaturePoints && temperaturePoints.length > 0) {
            datasets.push({ label: 'Temperature (°C)', data: temperaturePoints, borderColor: chartLineColor5, pointRadius: 0, fill: false, tension: 0.2, parsing: false, yAxisID: 'y5' });
          }
          if (chartDataVisibility.power && powerPoints && powerPoints.length > 0) {
            datasets.push({ label: 'Power (watts)', data: powerPoints, borderColor: chartLineColor6, pointRadius: 0, fill: false, tension: 0.2, parsing: false, yAxisID: 'y6' });
          }
          
          // Configure scales - always include all scales but hide unused ones
          scales.y = { title: { display: chartDataVisibility.elevation, text: 'Elevation (m)' }, ticks: { precision: 0 }, display: chartDataVisibility.elevation };
          scales.y2 = { position: 'right', grid: { drawOnChartArea: false }, title: { display: chartDataVisibility.speed, text: 'Speed (km/h)' }, ticks: { precision: 0 }, display: chartDataVisibility.speed && speedPoints && speedPoints.length > 0 };
          scales.y3 = { position: 'left', grid: { drawOnChartArea: false }, title: { display: chartDataVisibility.heartRate, text: 'HR (bpm)' }, ticks: { precision: 0 }, display: chartDataVisibility.heartRate && heartRatePoints && heartRatePoints.length > 0 };
          scales.y4 = { position: 'right', grid: { drawOnChartArea: false }, title: { display: chartDataVisibility.cadence, text: 'Cadence (rpm)' }, ticks: { precision: 0 }, display: chartDataVisibility.cadence && cadencePoints && cadencePoints.length > 0 };
          scales.y5 = { position: 'left', grid: { drawOnChartArea: false }, title: { display: chartDataVisibility.temperature, text: 'Temp (°C)' }, ticks: { precision: 1 }, display: chartDataVisibility.temperature && temperaturePoints && temperaturePoints.length > 0 };
          scales.y6 = { position: 'right', grid: { drawOnChartArea: false }, title: { display: chartDataVisibility.power, text: 'Power (W)' }, ticks: { precision: 0 }, display: chartDataVisibility.power && powerPoints && powerPoints.length > 0 };
          scales.y2 = { position: 'right', grid: { drawOnChartArea: false }, title: { display: chartDataVisibility.speed, text: 'Speed (km/h)' }, ticks: { precision: 0 }, display: chartDataVisibility.speed && useTime && speedPoints.length > 0 };
          scales.y3 = { position: 'left', grid: { drawOnChartArea: false }, title: { display: chartDataVisibility.heartRate, text: 'HR (bpm)' }, ticks: { precision: 0 }, display: chartDataVisibility.heartRate && heartRatePoints.length > 0 };
          scales.y4 = { position: 'right', grid: { drawOnChartArea: false }, title: { display: chartDataVisibility.cadence, text: 'Cadence (rpm)' }, ticks: { precision: 0 }, display: chartDataVisibility.cadence && cadencePoints.length > 0 };
          scales.y5 = { position: 'left', grid: { drawOnChartArea: false }, title: { display: chartDataVisibility.temperature, text: 'Temp (°C)' }, ticks: { precision: 1 }, display: chartDataVisibility.temperature && temperaturePoints.length > 0 };
          scales.y6 = { position: 'right', grid: { drawOnChartArea: false }, title: { display: chartDataVisibility.power, text: 'Power (W)' }, ticks: { precision: 0 }, display: chartDataVisibility.power && powerPoints.length > 0 };
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
          
          // Create gradient based on steepness thresholds
          var gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
          
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
              gradient.addColorStop(position, 'rgba(' + r + ',' + g + ',' + b + ', 0.6)');
            }
          } else {
            // Fallback to solid color if no gradients available
            var hex = baseColor.replace('#', '');
            var r = parseInt(hex.substr(0, 2), 16);
            var g = parseInt(hex.substr(2, 2), 16);
            var b = parseInt(hex.substr(4, 2), 16);
            gradient.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ', 0.6)');
            gradient.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ', 0.6)');
          }
          
          // Speed line chart (added first for background)
          if (useTime && speedPoints.length > 0) {
            datasets.push({ 
              label: 'Speed (km/h)', 
              data: speedPoints, 
              borderColor: chartLineColor2, 
              pointRadius: 0, 
              fill: false, 
              tension: 0.2, 
              parsing: false, 
              yAxisID: 'y2'
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
            yAxisID: 'y'
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
            yAxisID: 'y'
          });
          
          // Position marker (added last to be on top of everything)
          datasets.push(positionDataset);
          
          scales.y = { title: { display: true, text: 'Elevation (m)' }, ticks: { precision: 0 } };
          scales.y2 = { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Speed (km/h)' }, ticks: { precision: 0 } };
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
              callback: function(val){
                try {
                  if (!useTime) return '';
                  var lo = 0, hi = timeOffsets.length - 1;
                  while (lo < hi) { var mid = (lo + hi) >>> 1; if (timeOffsets[mid] < val) lo = mid + 1; else hi = mid; }
                  var i = Math.max(1, lo);
                  var t0 = timeOffsets[i - 1], t1 = timeOffsets[i];
                  var u = t1 > t0 ? (val - t0) / (t1 - t0) : 0;
                  var d0 = cumDist[i - 1], d1 = cumDist[i];
                  var d = Math.max(0, d0 + (d1 - d0) * u);
                  return (d / 1000).toFixed(1) + ' km';
                } catch(_) { return ''; }
              }
            }
          };
        }
        
        // Add day/night visualization plugin if periods are available
        var chartPlugins = [];
        DBG.log('Chart plugin setup', {
          hasDayNightPeriods: !!(dayNightPeriods && dayNightPeriods.length > 0),
          useTime: useTime,
          periodsCount: dayNightPeriods ? dayNightPeriods.length : 0
        });
        
        if (dayNightPeriods && dayNightPeriods.length > 0 && useTime && window.FGPX && FGPX.daynightEnabled) {
          DBG.log('Adding day/night chart plugin', { periods: dayNightPeriods });
          chartPlugins.push({
            id: 'dayNightBackground',
            afterDatasetsDraw: function(chart) { // Draw after datasets but before position marker
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
              
              // Get track duration for partial night periods
              var trackDuration = xScale.max || 0;
              
              
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
                  ctx.strokeStyle = p.type === 'sunrise' ? 'rgba(255, 215, 0, 0.8)' : 'rgba(255, 215, 0, 0.8)'; // Yellow color for both
                  ctx.beginPath();
                  ctx.moveTo(x, chartArea.top);
                  ctx.lineTo(x, chartArea.bottom);
                  ctx.stroke();
                }
              }
              
              ctx.restore();
            },
            afterEvent: function(chart, args) {
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
                  
                  if (Math.abs(canvasPosition.x - lineX) <= 5 && 
                      canvasPosition.y >= chartArea.top && 
                      canvasPosition.y <= chartArea.bottom) {
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
                    timeStr = date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                  }
                  
                  tooltipEl.innerHTML = hoveredLine.type === 'sunrise' ? 
                    'Sunrise' + (timeStr ? ' at ' + timeStr : '') : 
                    'Sunset' + (timeStr ? ' at ' + timeStr : '');
                  
                  // Position tooltip
                  var rect = chart.canvas.getBoundingClientRect();
                  tooltipEl.style.left = (rect.left + canvasPosition.x + 10) + 'px';
                  tooltipEl.style.top = (rect.top + canvasPosition.y - 30) + 'px';
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
            }
          });
        } else {
          DBG.log('Day/night plugin not added - requirements not met');
        }

        // Chart area selection and zoom plugin
        var chartZoomPlugin = {
          id: 'chartZoom',
          beforeInit: function(chart) {
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
              zoomedRange: null
            };
          },
          afterInit: function(chart) {
            var state = chart.chartZoomState;
            if (state && state.disabled) return; // Skip for polar charts
            
            var canvas = chart.canvas;
            var ctx = chart.ctx;
            
            // Add reset zoom button
            var resetBtn = document.createElement('button');
            resetBtn.textContent = '🔍 Reset Zoom';
            resetBtn.className = 'fgpx-chart-reset-zoom';
            resetBtn.style.cssText = 'position: absolute; top: 5px; right: 5px; z-index: 1000; padding: 4px 8px; font-size: 11px; background: rgba(255,255,255,0.9); border: 1px solid #ccc; border-radius: 3px; cursor: pointer; display: none;';
            resetBtn.title = 'Reset chart zoom to show full track';
            
            // Insert reset button relative to chart container
            var chartContainer = canvas.parentElement;
            if (chartContainer) {
              chartContainer.style.position = 'relative';
              chartContainer.appendChild(resetBtn);
            }
            
            resetBtn.addEventListener('click', function() {
              resetChartZoom(chart);
            });
            
            chart.chartZoomState.resetButton = resetBtn;
            
            // Mouse event handlers for area selection
            var isMouseDown = false;
            var startX = null;
            
            canvas.addEventListener('mousedown', function(e) {
              if (e.button !== 0) return; // Only left mouse button
              
              var rect = canvas.getBoundingClientRect();
              var x = e.clientX - rect.left;
              var y = e.clientY - rect.top;
              
              // Check if click is in chart area (not on axes)
              var chartArea = chart.chartArea;
              if (x >= chartArea.left && x <= chartArea.right && y >= chartArea.top && y <= chartArea.bottom) {
                isMouseDown = true;
                startX = x;
                state.isSelecting = true;
                state.selectionStart = x;
                state.selectionEnd = x;
                canvas.style.cursor = 'crosshair';
              }
            });
            
            canvas.addEventListener('mousemove', function(e) {
              if (!isMouseDown || !state.isSelecting) return;
              
              var rect = canvas.getBoundingClientRect();
              var x = e.clientX - rect.left;
              
              // Constrain to chart area
              var chartArea = chart.chartArea;
              x = Math.max(chartArea.left, Math.min(chartArea.right, x));
              
              state.selectionEnd = x;
              chart.update('none'); // Redraw without animation
            });
            
            canvas.addEventListener('mouseup', function(e) {
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
              }
              
              // Reset selection state
              state.isSelecting = false;
              state.selectionStart = null;
              state.selectionEnd = null;
              chart.update('none');
            });
            
            // Cancel selection on mouse leave
            canvas.addEventListener('mouseleave', function() {
              if (state.isSelecting) {
                isMouseDown = false;
                state.isSelecting = false;
                state.selectionStart = null;
                state.selectionEnd = null;
                canvas.style.cursor = 'default';
                chart.update('none');
              }
            });
          },
          afterDraw: function(chart) {
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
              
              ctx.fillRect(Math.min(startX, endX), chartArea.top, width, chartArea.bottom - chartArea.top);
              ctx.strokeRect(Math.min(startX, endX), chartArea.top, width, chartArea.bottom - chartArea.top);
              
              ctx.restore();
            }
          }
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
                x: { min: xScale.min, max: xScale.max }
              };
              
              // Store original scales for all y-axes
              Object.keys(chart.scales).forEach(function(scaleId) {
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
              markerInRange: (cursorX >= startValue && cursorX <= endValue)
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
            Object.keys(state.originalScales).forEach(function(scaleId) {
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
                  afterBody: function(context) {
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
                    if (Array.isArray(heartRates) && heartRates[idx] != null && heartRates[idx] > 0) {
                      tooltipLines.push('Heart Rate: ' + Math.round(heartRates[idx]) + ' bpm');
                    }
                    
                    // Add cadence if available
                    if (Array.isArray(cadences) && cadences[idx] != null && cadences[idx] > 0) {
                      tooltipLines.push('Cadence: ' + Math.round(cadences[idx]) + ' rpm');
                    }
                    
                    // Add temperature if available
                    if (Array.isArray(temperatures) && temperatures[idx] != null && temperatures[idx] > 0) {
                      tooltipLines.push('Temperature: ' + Math.round(temperatures[idx] * 10) / 10 + ' °C');
                    }
                    
                    // Add power if available
                    if (Array.isArray(powers) && powers[idx] != null && powers[idx] > 0) {
                      tooltipLines.push('Power: ' + Math.round(powers[idx]) + ' watts');
                    }
                    
                    // Add wind data if available
                    if (Array.isArray(windSpeeds) && windSpeeds[idx] != null && windSpeeds[idx] > 0) {
                      tooltipLines.push('Wind Speed: ' + Math.round(windSpeeds[idx] * 10) / 10 + ' km/h');
                    }
                    if (Array.isArray(windDirections) && windDirections[idx] != null) {
                      var compassDirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
                      var dirIndex = Math.round(windDirections[idx] / 22.5) % 16;
                      tooltipLines.push('Wind Direction: ' + compassDirs[dirIndex] + ' (' + Math.round(windDirections[idx]) + '°)');
                    }
                    if (Array.isArray(windImpacts) && windImpacts[idx] != null && Array.isArray(speedSeries) && speedSeries[idx] != null) {
                      var impact = windImpacts[idx];
                      var currentSpeed = speedSeries[idx];
                      if (currentSpeed > 0) {
                        var speedDiff = (impact - 1.0) * currentSpeed;
                        var impactStr = speedDiff > 0 ? 'Tailwind (+' + Math.round(speedDiff * 10) / 10 + ' km/h)' : 
                                       speedDiff < 0 ? 'Headwind (' + Math.round(speedDiff * 10) / 10 + ' km/h)' : 'No wind impact';
                        tooltipLines.push('Wind Impact: ' + impactStr);
                      }
                    }
                    
                    // Add night indicator if day/night visualization is enabled and we're in a night period
                    if (useTime && dayNightPeriods && dayNightPeriods.length > 0 && window.FGPX && FGPX.daynightEnabled) {
                      // Calculate night periods from dayNightPeriods
                      var nightPeriods = [];
                      var lastSunset = null;
                      var trackDuration = timeOffsets[timeOffsets.length - 1] || 0;
                      
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
                  }
                }
              }
            }
          },
          plugins: allPlugins
        });
      }
      
      // Initialize with elevation tab now that all functions are defined
      createChart('elevation');
      
      // Enable controls now that data/map are ready
      ui.controls.btnPlay.disabled = false;
      ui.controls.btnPause.disabled = false;
      ui.controls.btnRestart.disabled = false;
      ui.controls.btnRecord.disabled = false;

      // Animation state
      var playing = false;
      var speed = (window.FGPX && isFinite(Number(FGPX.defaultSpeed)) ? Number(FGPX.defaultSpeed) : 25); // default multiplier
      var tStart = null; // ms timestamp when started
      var tOffset = 0; // accumulated paused time in seconds
      var progress = 0; // 0..1 by distance
      var lastFrame = null;
      var bearing = null; // smoothed
      var defaultZoom = defaultZoomSetting; // default zoom level when starting/restarting
      var lastFrameDt = 0; // seconds
      var cameraCenter = coords[0].slice(0, 2);
      var targetBearingSmooth = null; // temporal smoothing for target bearing
      var chartCooldown = 0; // seconds throttle for chart updates
      var bearingCooldown = 0; // seconds throttle for bearing updates
      var forceCameraUpdate = true; // ensure first frame centers on marker
      var appliedBearing = null; // last bearing actually applied
      var currentPosLngLat = null; // last computed marker lng/lat for snap-to-center on seek
      var firstPlayZoomPending = true; // animate zoom-in on first play after stop

      function targetBearingAtDistance(d) {
        try {
          var dMaxAhead = privacyEnabled ? privacyEndD : totalDistance;
          var pos = positionAtDistance(d);
          var ahead15 = positionAtDistance(Math.min(dMaxAhead, d + 25));
          var ahead30 = positionAtDistance(Math.min(dMaxAhead, d + 50));
          var ahead60 = positionAtDistance(Math.min(dMaxAhead, d + 100));
          var b15 = bearingBetween(pos, ahead15);
          var b30 = bearingBetween(pos, ahead30);
          var b60 = bearingBetween(pos, ahead60);
          var w15 = 0.5, w30 = 0.35, w60 = 0.15;
          var rad15 = b15 * Math.PI / 180, rad30 = b30 * Math.PI / 180, rad60 = b60 * Math.PI / 180;
          var vx = Math.cos(rad15) * w15 + Math.cos(rad30) * w30 + Math.cos(rad60) * w60;
          var vy = Math.sin(rad15) * w15 + Math.sin(rad30) * w30 + Math.sin(rad60) * w60;
          var tb = Math.atan2(vy, vx) * 180 / Math.PI;
          return normalizeAngle(tb);
        } catch(_) { return 0; }
      }

      function zoomInThenStartPlayback() {
        DBG.log('zoomInThenStartPlayback trigger');
        try {
          var targetCenter = (currentPosLngLat && Array.isArray(currentPosLngLat)) ? currentPosLngLat.slice(0,2) : cameraCenter.slice(0,2);
          var dNow = Math.max(0, Math.min(1, progress)) * totalDistance;
          var startBearing = targetBearingAtDistance(dNow);
          // Pre-set bearing state so the first animation frame does not jump
          bearing = startBearing;
          appliedBearing = startBearing;
          forceCameraUpdate = false;
          var doEase = function(){
            map.easeTo({ center: targetCenter, zoom: defaultZoom, bearing: startBearing, duration: 3200, easing: easeInOutCubic });
            map.once('moveend', function(){
              try {
                if (pendingTerrainSourceId) { map.setTerrain({ source: pendingTerrainSourceId, exaggeration: 1.0 }); pendingTerrainSourceId = null; }
              } catch(_) {}
              firstPlayZoomPending = false; 
              // Only start playback after zoom animation completes
              setPlaying(true); 
              window.requestAnimationFrame(raf);
            });
          };
          // Gate the first zoom until map is idle to avoid tile churn
          if (typeof map.isMoving === 'function') {
            if (map.isMoving()) { map.once('idle', doEase); }
            else { doEase(); }
          } else { doEase(); }
        } catch(_) { 
          firstPlayZoomPending = false; 
          setPlaying(true); 
          window.requestAnimationFrame(raf); 
        }
      }

      function setPlaying(p) {
        if (playing !== p) { DBG.log('playback state change', { playing: p }); }
        playing = p;
        // Update button states (includes recording state)
        updateButtonStates();
        if (playing) {
          // Reset frame timer so dt doesn't include paused duration
          lastFrame = null;
          hideSplash();
        }
      }
      
      function updateButtonStates() {
        // Update button states based on current playback, preloading, and recording state
        ui.controls.btnPlay.disabled = playing || preloadingInProgress || isRecording;
        ui.controls.btnPause.disabled = !playing || isRecording;
        ui.controls.btnRestart.disabled = isRecording;
        ui.controls.btnRecord.disabled = preloadingInProgress;
      }

      function reset() {
        DBG.log('reset() invoked');
        tStart = null; lastFrame = null; bearing = null;
        // Set initial progress/time at privacy start when enabled
        var minP = privacyEnabled ? (privacyStartD / totalDistance) : 0;
        progress = minP;
        if (hasTimestamps && Array.isArray(timeOffsets)) {
          try {
            var loT = 0, hiT = timeOffsets.length - 1;
            while (loT < hiT) { var midT = (loT + hiT) >>> 1; if (cumDist[midT] < privacyStartD) loT = midT + 1; else hiT = midT; }
            tOffset = timeOffsets[Math.max(0, loT)] || 0;
          } catch(_) { tOffset = 0; }
        } else {
          tOffset = 0;
        }
        cameraCenter = privacyEnabled ? positionAtDistance(privacyStartD).slice(0,2) : coords[0].slice(0, 2);
        chartCooldown = 0;
        forceCameraUpdate = true;
        appliedBearing = null;
        updateVisuals(progress);
        setProgressBar(progress);
        chart.update('none');
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
            var lo2p = 0, hi2p = timeOffsets.length - 1;
            while (lo2p < hi2p) { var mid2p = (lo2p + hi2p) >>> 1; if (cumDist[mid2p] < distNow0) lo2p = mid2p + 1; else hi2p = mid2p; }
            var currentSec0 = timeOffsets[Math.max(0, lo2p)] || 0;
            // advance pointer to first photo >= currentSec0
            if (photosByTime) {
              var l = 0, h = photosByTime.length;
              while (l < h) { var m = (l + h) >>> 1; if (photosByTime[m].pSec < currentSec0) l = m + 1; else h = m; }
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
              var loPd = 0, hiPd = photosByDist.length;
              while (loPd < hiPd) { var midPd = (loPd + hiPd) >>> 1; if (photosByDist[midPd].pDist < dNow0) loPd = midPd + 1; else hiPd = midPd; }
              photoDistPtr = loPd;
            }
          } catch(_) {}
        } catch(_) {}
      }

      function setProgressBar(p) {
        if (privacyEnabled) {
          var d = Math.max(0, Math.min(1, p)) * totalDistance;
          var span = Math.max(1e-6, (privacyEndD - privacyStartD));
          var frac = Math.max(0, Math.min(1, (d - privacyStartD) / span));
          ui.controls.progressBar.style.width = (frac * 100) + '%';
        } else {
        ui.controls.progressBar.style.width = Math.max(0, Math.min(100, p * 100)) + '%';
        }
      }

      function boundsFromCoords(cs) {
        var minLon = 180, minLat = 90, maxLon = -180, maxLat = -90;
        for (var i = 0; i < cs.length; i++) {
          var c = cs[i];
          if (c[0] < minLon) minLon = c[0]; if (c[0] > maxLon) maxLon = c[0];
          if (c[1] < minLat) minLat = c[1]; if (c[1] > maxLat) maxLat = c[1];
        }
        return [[minLon, minLat], [maxLon, maxLat]];
      }

      // removed duplicate positionAtDistance (defined earlier)

      // Smooth a polyline using Catmull–Rom splines to reduce abrupt angles
      function smoothPolyline(points, samplesPerSegment) {
        try {
          var n = Array.isArray(points) ? points.length : 0;
          if (n < 3) { return points.map(function(p){ return [p[0], p[1]]; }); }
          var sps = Math.max(0, Math.min(6, samplesPerSegment || 2));
          var out = [];
          for (var i = 0; i < n - 1; i++) {
            var p0 = i > 0 ? points[i - 1] : points[i];
            var p1 = points[i];
            var p2 = points[i + 1];
            var p3 = (i + 2 < n) ? points[i + 2] : points[i + 1];
            out.push([p1[0], p1[1]]);
            if (sps > 0) {
              for (var s = 1; s <= sps; s++) {
                var t = s / (sps + 1);
                var t2 = t * t; var t3 = t2 * t;
                var x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
                var y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
                out.push([x, y]);
              }
            }
          }
          out.push(points[n - 1].slice(0, 2));
          if (out.length > 2000) {
            var step = Math.ceil(out.length / 2000);
            var ds = [];
            for (var k = 0; k < out.length; k += step) { ds.push(out[k]); }
            var last = out[out.length - 1];
            var lastDS = ds[ds.length - 1];
            if (!lastDS || lastDS[0] !== last[0] || lastDS[1] !== last[1]) { ds.push(last); }
            return ds;
          }
          return out;
        } catch(_) {
          return points;
        }
      }

      function bearingToCardinal(deg) {
        try {
          var dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
          var idx = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
          return dirs[idx];
        } catch(_) { return 'N'; }
      }

      function updateVisuals(p) {
        // Clamp progress to privacy window if enabled
        if (privacyEnabled) {
          var dMin = privacyStartD;
          var dMax = privacyEndD;
          var dNow = p * totalDistance;
          if (dNow < dMin) { p = dMin / totalDistance; }
          if (dNow > dMax) { p = dMax / totalDistance; }
        }
        var d = p * totalDistance;
        var pos = positionAtDistance(d);
        
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
          markerVisible = (currentValue >= zoomRange.min && currentValue <= zoomRange.max);
        }
        
        // update marker and remember position for seek camera snap
        pointData.features[0].geometry.coordinates = pos;
        var src = map.getSource('fgpx-point');
        if (src) {
          if (markerVisible) {
            src.setData(pointData);
            // Ensure marker layer is visible
            if (map.getLayer('fgpx-point')) {
              map.setLayoutProperty('fgpx-point', 'visibility', 'visible');
            }
          } else {
            // Hide marker by making it invisible
            if (map.getLayer('fgpx-point')) {
              map.setLayoutProperty('fgpx-point', 'visibility', 'none');
            }
          }
        }
        currentPosLngLat = pos;

        // Day/night overlay update - only when crossing transition points
        if (window.FGPX && FGPX.daynightMapEnabled) {
          try {
            var overlaySrc = map.getSource('fgpx-daynight-overlay');
            if (overlaySrc && Array.isArray(timeOffsets) && dayNightPeriods) {
              // Get current time offset based on progress
              var timeIdx = Math.floor(p * (timeOffsets.length - 1));
              var currentTimeOffset = timeOffsets[timeIdx] || 0;
              
              // Initialize tracking variables if not exists
              if (typeof window.__fgpxLastDayNightState === 'undefined') {
                window.__fgpxLastDayNightState = null;
                window.__fgpxLastTransitionCheck = -1;
              }
              
              // Only recalculate if we've moved significantly or state is unknown
              var shouldUpdate = (window.__fgpxLastDayNightState === null || 
                                Math.abs(currentTimeOffset - window.__fgpxLastTransitionCheck) > 60); // Check every minute
              
              // Also check if we crossed any transition points
              if (!shouldUpdate && dayNightPeriods && dayNightPeriods.length > 0) {
                var lastCheck = window.__fgpxLastTransitionCheck;
                for (var t = 0; t < dayNightPeriods.length; t++) {
                  var transition = dayNightPeriods[t];
                  // Check if we crossed this transition point since last check
                  if ((lastCheck < transition.timeOffset && currentTimeOffset >= transition.timeOffset) ||
                      (lastCheck > transition.timeOffset && currentTimeOffset <= transition.timeOffset)) {
                    shouldUpdate = true;
                    DBG.log('Crossed day/night transition:', transition.type, 'at offset:', transition.timeOffset);
                    break;
                  }
                }
              }
              
              if (shouldUpdate) {
                // Determine night opacity using pre-calculated periods - robust edge case handling
                var nightOpacity = 0; // Default to day
                
                if (dayNightPeriods && dayNightPeriods.length > 0) {
                  // Sort periods by timeOffset to ensure correct order
                  var sortedPeriods = dayNightPeriods.slice().sort(function(a, b) { 
                    return a.timeOffset - b.timeOffset; 
                  });
                  
                  var isInNightPeriod = false;
                  
                  // Handle edge case: track starts before any transitions (assume day unless proven night)
                  var firstPeriod = sortedPeriods[0];
                  if (currentTimeOffset < firstPeriod.timeOffset) {
                    // If first transition is sunrise, we start in night
                    // If first transition is sunset, we start in day
                    isInNightPeriod = (firstPeriod.type === 'sunrise');
                  } else {
                    // Find the most recent transition before current time
                    var lastTransition = null;
                    for (var i = 0; i < sortedPeriods.length; i++) {
                      if (sortedPeriods[i].timeOffset <= currentTimeOffset) {
                        lastTransition = sortedPeriods[i];
                      } else {
                        break; // Periods are sorted, so we can break early
                      }
                    }
                    
                    if (lastTransition) {
                      // If last transition was sunset, we're in night
                      // If last transition was sunrise, we're in day
                      isInNightPeriod = (lastTransition.type === 'sunset');
                    } else {
                      // No transitions before current time, assume day
                      isInNightPeriod = false;
                    }
                  }
                  
                  // Handle edge case: track extends beyond all transitions
                  var lastPeriod = sortedPeriods[sortedPeriods.length - 1];
                  if (currentTimeOffset > lastPeriod.timeOffset) {
                    // State depends on the last transition type
                    isInNightPeriod = (lastPeriod.type === 'sunset');
                  }
                  
                  nightOpacity = isInNightPeriod ? 1 : 0;
                  
                  // Debug logging for edge cases
                  if (currentTimeOffset < firstPeriod.timeOffset || currentTimeOffset > lastPeriod.timeOffset) {
                    DBG.log('Edge case detected:', {
                      currentTimeOffset: currentTimeOffset,
                      firstPeriod: firstPeriod,
                      lastPeriod: lastPeriod,
                      isInNightPeriod: isInNightPeriod,
                      reason: currentTimeOffset < firstPeriod.timeOffset ? 'before_first_transition' : 'after_last_transition'
                    });
                  }
                }
                
                // Only update if state actually changed
                if (window.__fgpxLastDayNightState !== nightOpacity) {
                  DBG.log('Day/night state changed:', window.__fgpxLastDayNightState, '->', nightOpacity, 'at offset:', currentTimeOffset);
                  
                  // Apply easing function for smoother transitions
                  var easedOpacity = nightOpacity * nightOpacity * (3 - 2 * nightOpacity); // smoothstep
                  
                  // Ensure layer exists before updating
                  var overlayLayer = map.getLayer('fgpx-daynight-overlay');
                  if (!overlayLayer) {
                    DBG.warn('Day/night overlay layer missing! Attempting to recreate...');
                    try {
                      // Create a full viewport polygon for the night overlay
                      var bounds = map.getBounds();
                      var overlayPolygon = {
                        type: 'Feature',
                        properties: { nightOpacity: easedOpacity },
                        geometry: {
                          type: 'Polygon',
                          coordinates: [[
                            [bounds.getWest(), bounds.getNorth()],
                            [bounds.getEast(), bounds.getNorth()],
                            [bounds.getEast(), bounds.getSouth()],
                            [bounds.getWest(), bounds.getSouth()],
                            [bounds.getWest(), bounds.getNorth()]
                          ]]
                        }
                      };
                      
                      var overlayData = { type: 'FeatureCollection', features: [overlayPolygon] };
                      
                      // Check if source exists first
                      var existingSource = map.getSource('fgpx-daynight-overlay');
                      if (!existingSource) {
                        map.addSource('fgpx-daynight-overlay', { type: 'geojson', data: overlayData });
                        DBG.log('Recreated overlay source');
                      } else {
                        existingSource.setData(overlayData);
                        DBG.log('Updated existing overlay source');
                      }
                      
                      // Add the layer if it doesn't exist
                      if (!map.getLayer('fgpx-daynight-overlay')) {
                        map.addLayer({
                          id: 'fgpx-daynight-overlay',
                          type: 'fill',
                          source: 'fgpx-daynight-overlay',
                          layout: { 'visibility': (!!(window.FGPX && FGPX.daynightVisibleByDefault)) ? 'visible' : 'none' },
                          paint: {
                            'fill-color': window.FGPX.daynightMapColor || '#000080',
                            'fill-opacity': [
                              'interpolate',
                              ['linear'],
                              ['to-number', ['get', 'nightOpacity']],
                              0, 0,
                              1, parseFloat(window.FGPX.daynightMapOpacity) || 0.4
                            ],
                            'fill-opacity-transition': {
                              duration: 300,
                              delay: 0
                            }
                          }
                        }, map.getLayer('fgpx-point-circle') ? 'fgpx-point-circle' : undefined);
                        DBG.log('Recreated overlay layer');
                      }
                      
                      // Verify recreation
                      overlayLayer = map.getLayer('fgpx-daynight-overlay');
                      DBG.log('Layer recreation result:', !!overlayLayer);
                    } catch (recreateError) {
                      DBG.warn('Failed to recreate overlay layer:', recreateError);
                    }
                  }
                  
                  // Update the overlay data
                  var bounds = map.getBounds();
                  var overlayPolygon = {
                    type: 'Feature',
                    properties: { nightOpacity: easedOpacity },
                    geometry: {
                      type: 'Polygon',
                      coordinates: [[
                        [bounds.getWest(), bounds.getNorth()],
                        [bounds.getEast(), bounds.getNorth()],
                        [bounds.getEast(), bounds.getSouth()],
                        [bounds.getWest(), bounds.getSouth()],
                        [bounds.getWest(), bounds.getNorth()]
                      ]]
                    }
                  };
                  
                  var overlayData = { type: 'FeatureCollection', features: [overlayPolygon] };
                  overlaySrc.setData(overlayData);
                  
                  // Apply smooth paint property transitions only if layer exists
                  try {
                    if (map.getLayer('fgpx-daynight-overlay')) {
                      var targetOpacity = parseFloat(window.FGPX.daynightMapOpacity) || 0.4;
                      map.setPaintProperty('fgpx-daynight-overlay', 'fill-opacity', [
                        'interpolate',
                        ['linear'],
                        ['to-number', ['get', 'nightOpacity']],
                        0, 0,
                        1, targetOpacity * easedOpacity
                      ]);
                    }
                  } catch (paintError) {
                    DBG.warn('Failed to update paint property smoothly:', paintError);
                  }
                  
                  // Update tracking variables
                  window.__fgpxLastDayNightState = nightOpacity;
                }
                
                window.__fgpxLastTransitionCheck = currentTimeOffset;
              }
            }
          } catch (e) {
            DBG.warn('Day/night overlay error:', e);
          }
        }

        // update progressive route up to current position
        var routeProgSrc = map.getSource('fgpx-route-progress');
        if (routeProgSrc) {
          // Throttle progress line updates to ~40 FPS or 10 m movement
          if (typeof window.__fgpxLineCooldown === 'undefined') { window.__fgpxLineCooldown = 0; }
          if (typeof window.__fgpxLastLineD === 'undefined') { window.__fgpxLastLineD = privacyEnabled ? privacyStartD : 0; }
          if (window.__fgpxNeedLineInit === undefined) { window.__fgpxNeedLineInit = true; }
          if (typeof window.__fgpxProgressSegments === 'undefined') { window.__fgpxProgressSegments = []; }
          var needUpdate = window.__fgpxNeedLineInit || (window.__fgpxLineCooldown >= 0.025) || (Math.abs(d - window.__fgpxLastLineD) >= 10);
          if (needUpdate) {
            var lo = 0, hi = cumDist.length - 1;
            while (lo < hi) { var mid = (lo + hi) >>> 1; if (cumDist[mid] < d) lo = mid + 1; else hi = mid; }
            var i = Math.max(1, lo);
            var startD = privacyEnabled ? privacyStartD : 0;
            // find start index for privacy window
            var loS = 0, hiS = cumDist.length - 1;
            while (loS < hiS) { var midS = (loS + hiS) >>> 1; if (cumDist[midS] < startD) loS = midS + 1; else hiS = midS; }
            var startIdx = privacyEnabled ? Math.max(1, loS) : 1;
            var coordsUpTo = coords.slice(startIdx, i);
            // ensure the first point is exactly at the privacy start when enabled
            if (privacyEnabled) {
              var pStart = positionAtDistance(privacyStartD);
              coordsUpTo.unshift([pStart[0], pStart[1], 0]);
            }
            var d0 = cumDist[i - 1], d1 = cumDist[i] || d0;
            var t = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
            var p0 = coords[i - 1], p1 = coords[i] || coords[i - 1];
            var interp = [lerp(p0[0], p1[0], t), lerp(p0[1], p1[1], t)];
            coordsUpTo.push(interp);
            var rawUpTo = coordsUpTo.map(function(c){ return c.slice(0,2); });
            var smoothedUpTo = smoothPolyline(rawUpTo, 2);

            // Create elevation-colored segments or single route
            var segments = createProgressiveSegments(smoothedUpTo, startIdx);
            if (segments && segments.length > 0) {
              // Use elevation-colored segments - update existing or create new
              for (var segIdx = 0; segIdx < segments.length; segIdx++) {
                var segment = segments[segIdx];
                var segmentColor = segment.gradeBucket > 0 ? 
                  blendHex(progressiveBaseColor, progressiveSteepColor, segment.gradeBucket) : 
                  progressiveBaseColor;
                
                var segmentData = {
                  type: 'Feature',
                  geometry: { type: 'LineString', coordinates: segment.coordinates }
                };
                var segmentSourceId = 'fgpx-progress-segment-' + segIdx;
                var segmentLayerId = 'fgpx-progress-segment-' + segIdx;
                
                // Update existing source or create new one
                var existingSource = map.getSource(segmentSourceId);
                if (existingSource) {
                  existingSource.setData(segmentData);
                } else {
                  map.addSource(segmentSourceId, { type: 'geojson', data: segmentData });
                  map.addLayer({
                    id: segmentLayerId,
                    type: 'line',
                    source: segmentSourceId,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: { 'line-color': segmentColor, 'line-width': 4, 'line-blur': 0.3 }
                  });
                }
              }
              
              // Remove excess segments if we have fewer segments now
              var currentSegmentCount = window.__fgpxProgressSegments.length || 0;
              for (var removeIdx = segments.length; removeIdx < currentSegmentCount; removeIdx++) {
                try {
                  map.removeLayer('fgpx-progress-segment-' + removeIdx);
                  map.removeSource('fgpx-progress-segment-' + removeIdx);
                } catch(_) {}
              }
              
              // Update segment tracking
              window.__fgpxProgressSegments = [];
              for (var trackIdx = 0; trackIdx < segments.length; trackIdx++) {
                window.__fgpxProgressSegments.push(trackIdx);
              }
              
              // Hide the single-color progressive route
              try {
                map.setLayoutProperty('fgpx-route-progress-line', 'visibility', 'none');
              } catch(_) {}
            } else {
              // Use single-color progressive route - clean up segments first
              var currentSegmentCount = window.__fgpxProgressSegments.length || 0;
              for (var cleanIdx = 0; cleanIdx < currentSegmentCount; cleanIdx++) {
                try {
                  map.removeLayer('fgpx-progress-segment-' + cleanIdx);
                  map.removeSource('fgpx-progress-segment-' + cleanIdx);
                } catch(_) {}
              }
              window.__fgpxProgressSegments = [];
              
              progressData.geometry.coordinates = smoothedUpTo;
              routeProgSrc.setData(progressData);
              try {
                map.setLayoutProperty('fgpx-route-progress-line', 'visibility', 'visible');
              } catch(_) {}
            }
            
            window.__fgpxLineCooldown = 0;
            window.__fgpxLastLineD = d;
            window.__fgpxNeedLineInit = false;
          }
        }
        // update camera bearing aimed forward with smoothing and turn-rate clamp
        var dMaxAhead = privacyEnabled ? privacyEndD : totalDistance;
        var ahead15 = positionAtDistance(Math.min(dMaxAhead, d + 25));
        var ahead30 = positionAtDistance(Math.min(dMaxAhead, d + 50));
        var ahead60 = positionAtDistance(Math.min(dMaxAhead, d + 100));
        var b15 = bearingBetween(pos, ahead15);
        var b30 = bearingBetween(pos, ahead30);
        var b60 = bearingBetween(pos, ahead60);
        // circular mean with weights to suppress tiny zig-zags
        var w15 = 0.5, w30 = 0.35, w60 = 0.15;
        var rad15 = b15 * Math.PI / 180, rad30 = b30 * Math.PI / 180, rad60 = b60 * Math.PI / 180;
        var vx = Math.cos(rad15) * w15 + Math.cos(rad30) * w30 + Math.cos(rad60) * w60;
        var vy = Math.sin(rad15) * w15 + Math.sin(rad30) * w30 + Math.sin(rad60) * w60;
        var targetBearing = Math.atan2(vy, vx) * 180 / Math.PI;
        targetBearing = normalizeAngle(targetBearing);
        // temporal smoothing on target bearing to prevent flicker
        if (targetBearingSmooth == null) {
          targetBearingSmooth = targetBearing;
        } else {
          var deltaTB = shortestAngleDelta(targetBearingSmooth, targetBearing);
          targetBearingSmooth = normalizeAngle(targetBearingSmooth + deltaTB * 0.2); // ease target
        }
        targetBearing = targetBearingSmooth;
        if (bearing == null) bearing = targetBearing;
        var delta = shortestAngleDelta(bearing, targetBearing);
        // Adaptive max turn rate (deg/s) slower at higher pitch/zoom to reduce edge churn
        var pitchNow = 0; try { if (typeof map.getPitch === 'function') pitchNow = map.getPitch(); } catch(_) {}
        var zoomNow = defaultZoom; try { if (typeof map.getZoom === 'function') zoomNow = map.getZoom(); } catch(_) {}
        var pitchFactor = 1 - Math.min(1, (pitchNow / 60)) * 0.3; // up to -30%
        var zoomFactor = 1 - Math.min(1, Math.max(0, (zoomNow - 10) / 8)) * 0.15; // up to -15%
        var maxTurnRate = 14 * pitchFactor * zoomFactor; // base 14 deg/s
        var stepLimit = maxTurnRate * Math.max(0.01, Math.min(0.06, lastFrameDt || 0.016));
        var step = Math.max(-stepLimit, Math.min(stepLimit, delta));
        // Throttle bearing updates to ~50 FPS unless a larger change is needed
        if (bearingCooldown >= 0.02 || Math.abs(delta) >= 1.2) {
          bearing = normalizeAngle(bearing + step);
          bearingCooldown = 0;
        }
        // Smoothly follow the marker position (low-pass filter on center)
        var followAlpha = Math.max(0.008, Math.min(0.04, (lastFrameDt || 0.016) * 0.6));
        var nextCenterLng = cameraCenter[0] + (pos[0] - cameraCenter[0]) * followAlpha;
        var nextCenterLat = cameraCenter[1] + (pos[1] - cameraCenter[1]) * followAlpha;
        // Calculate on-screen movement to avoid unnecessary repaints
        var prevPx = map.project(cameraCenter);
        var nextPx = map.project([nextCenterLng, nextCenterLat]);
        var movePx = Math.hypot((nextPx.x - prevPx.x), (nextPx.y - prevPx.y));
        var bearingDeltaAbs = Math.abs(shortestAngleDelta(appliedBearing == null ? bearing : appliedBearing, bearing));
        // Only update camera if movement or rotation exceeds tiny thresholds, or forced
        if (!userInteracting && (forceCameraUpdate || movePx > 0.5 || bearingDeltaAbs > 0.3)) {
          cameraCenter[0] = nextCenterLng;
          cameraCenter[1] = nextCenterLat;
          map.jumpTo({ center: cameraCenter, bearing: bearing });
          appliedBearing = bearing;
          forceCameraUpdate = false;
          // Dynamic edge prefetch at ~5–10 Hz; widen margin/zoom during larger rotations
          if (prefetchEnabled) {
            vpLastPrefetch += (lastFrameDt || 0.016);
            var extra = (bearingDeltaAbs > 1.0);
            if (vpLastPrefetch >= (extra ? 0.1 : 0.18)) {
              prefetchViewportTiles(extra ? 0.3 : 0.2, extra);
              vpLastPrefetch = 0;
            }
            if (typeof map.setPrefetchZoomDelta === 'function') {
              map.setPrefetchZoomDelta(extra ? 5 : 4);
            }
          }
        }
        // update chart cursor
        if (useTime && Array.isArray(timeOffsets)) {
          var seriesX = Array.isArray(movingTimeOffsets) ? movingTimeOffsets : timeOffsets;
          var lo2 = 0, hi2 = timeOffsets.length - 1;
          while (lo2 < hi2) { var mid2 = (lo2 + hi2) >>> 1; if (cumDist[mid2] < d) lo2 = mid2 + 1; else hi2 = mid2; }
          cursorX = seriesX[Math.max(0, lo2)] || 0;
        } else {
          cursorX = d / 1000;
        }
        // Throttle chart updates to reduce UI contention
        try {
          var idxForY = 0;
          if (useTime && Array.isArray(timeOffsets)) {
            var lo3 = 0, hi3 = timeOffsets.length - 1;
            while (lo3 < hi3) { var mid3 = (lo3 + hi3) >>> 1; if (cumDist[mid3] < d) lo3 = mid3 + 1; else hi3 = mid3; }
            idxForY = Math.max(0, lo3);
          } else {
            var lo4 = 0, hi4 = cumDist.length - 1;
            while (lo4 < hi4) { var mid4 = (lo4 + hi4) >>> 1; if (cumDist[mid4] < d) lo4 = mid4 + 1; else hi4 = mid4; }
            idxForY = Math.max(0, lo4);
          }
          var yNow = window.getPositionMarkerY ? window.getPositionMarkerY(idxForY) : ((typeof coords[idxForY][2] === 'number') ? coords[idxForY][2] : 0);
          if (chart && chart.data && chart.data.datasets) {
            // Find position marker dataset dynamically
            for (var i = 0; i < chart.data.datasets.length; i++) {
              if (chart.data.datasets[i].label === 'Position') {
                chart.data.datasets[i].data[0] = { x: cursorX, y: yNow };
                break;
              }
            }
          }
        } catch(_) {}
        if (chartCooldown >= 0.08) { 
          chart.update('none'); 
          chart.draw(); // Force redraw to update cursor visibility during playback
          chartCooldown = 0; 
        }

        // Update live metrics overlays
        try {
          if (hudEnabled && metricsSpeedLabel && metricsDistLabel && metricsElevLabel) {
          // Elevation (m) from nearest point
          var elevNow = Math.round(yNow);
          metricsElevLabel.textContent = elevNow + ' m';
          // Distance (km) from start or privacy start
          var dStart = privacyEnabled ? privacyStartD : 0;
          var distKm = Math.max(0, (d - dStart) / 1000);
          metricsDistLabel.textContent = distKm.toFixed(2) + ' km';
          // Speed (km/h): prefer time-based derivative; fallback to geometric estimate
          var speedMs = 0;
          if (hasTimestamps && Array.isArray(timeOffsets)) {
            var loS = 0, hiS = timeOffsets.length - 1;
            while (loS < hiS) { var midS = (loS + hiS) >>> 1; if (cumDist[midS] < d) loS = midS + 1; else hiS = midS; }
            var iS = Math.max(1, loS);
            var d0s = cumDist[iS - 1], d1s = cumDist[iS];
            var t0s = timeOffsets[iS - 1], t1s = timeOffsets[iS];
            var dd = Math.max(0, d1s - d0s);
            var dt = Math.max(1e-3, t1s - t0s);
            speedMs = dd / dt;
          } else {
            // Estimate from last frame distance and dt
            if (typeof lastFrameDt === 'number' && lastFrameDt > 0) {
              // approximate: use ahead point distance to reduce noise
              var ahead = positionAtDistance(Math.min((privacyEnabled ? privacyEndD : totalDistance), d + 5));
              var cur = pos;
              var approx = haversineMeters(cur, [ahead[0], ahead[1]]);
              speedMs = approx / 5; // over 5 meters lookahead
            }
          }
          var speedKmh = Math.max(0, speedMs * 3.6);
          metricsSpeedLabel.textContent = Math.round(speedKmh) + ' km/h';
          // Update bottom direction overlay
          if (dirLabel) {
            var dispBearing = (typeof bearing === 'number') ? Math.round(((bearing % 360)+360)%360) : 0;
            dirLabel.textContent = dispBearing + '° — ' + bearingToCardinal(dispBearing);
          }
          }
        } catch(_) {}

        if (DBG.enabled) {
          if (!updateVisuals._tLast || (performance.now() - updateVisuals._tLast) > 2000) {
            DBG.log('progress', { p: +(p.toFixed(4)), distanceM: Math.round(p * totalDistance) });
            updateVisuals._tLast = performance.now();
          }
        }
      }

      function raf(ts) {
        if (!playing) return;
        if (lastFrame == null) lastFrame = ts;
        var dt = (ts - lastFrame) / 1000; // seconds
        lastFrame = ts;
        lastFrameDt = dt;
        chartCooldown += dt;
        bearingCooldown += dt;
        try { if (typeof window.__fgpxLineCooldown === 'number') { window.__fgpxLineCooldown += dt; } } catch(_) {}
        
        // Handle video recording frame capture
        if (videoRecorder && videoRecorder.shouldCaptureFrame(ts)) {
          // Frame is automatically captured by MediaRecorder from canvas stream
          // No additional action needed here
        }
        
        // Overlay rendering is now handled by map 'render' event

        if (hasTimestamps && totalDuration > 0) {
          // time-based
          tOffset += dt * speed;
          var frac = Math.min(1, tOffset / totalDuration);
          // map time to distance using timeOffsets ~ cumDist relation
          var targetTime = frac * totalDuration;
          var lo = 0, hi = timeOffsets.length - 1;
          while (lo < hi) {
            var mid = (lo + hi) >>> 1;
            if (timeOffsets[mid] < targetTime) lo = mid + 1; else hi = mid;
          }
          var i = Math.max(1, lo);
          var t0 = timeOffsets[i - 1], t1 = timeOffsets[i];
          var u = t1 > t0 ? (targetTime - t0) / (t1 - t0) : 0;
          var d0 = cumDist[i - 1], d1 = cumDist[i];
          var d = d0 + (d1 - d0) * u;
          progress = d / totalDistance;
        } else {
          // distance-based at constant speed: 15 km/h baseline scaled by multiplier
          var speedMs = (15 / 3.6) * speed; // meters per second
          var dProg = (speedMs * dt) / totalDistance;
          progress = Math.min(1, progress + dProg);
        }

        // Enforce privacy window on progress and detect end
        var reachedPrivacyEnd = false;
        if (privacyEnabled) {
          var minP = privacyStartD / totalDistance;
          var maxP = privacyEndD / totalDistance;
          if (progress < minP) progress = minP;
          if (progress >= maxP) { progress = maxP; reachedPrivacyEnd = true; }
        }

        setProgressBar(progress);
        updateVisuals(progress);
        // If photos are enabled with timestamps, show overlay when marker reaches the photo time
        try {
          if (window.FGPX && FGPX.photosEnabled && Array.isArray(photos) && photos.length>0 && hasTimestamps && totalDuration != null) {
            if (overlayActive) { 
              return; 
            }
            var currentSec = tOffset; if (currentSec == null) { currentSec = progress * totalDuration; }
            if (lastPlaybackSec == null) { lastPlaybackSec = currentSec; }
            var fromSec = Math.min(lastPlaybackSec, currentSec);
            var toSec = Math.max(lastPlaybackSec, currentSec);
            var dNowFrame = progress * totalDistance;
            if (lastPlaybackDist == null || !isFinite(lastPlaybackDist)) { lastPlaybackDist = dNowFrame; }
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
                      } catch(_) {}
                    }
                    if (isValidPhoto) {
                      // Check if a photo at this location is already queued or displayed
                      if (isLocationAlreadyQueued(p.lat, p.lon)) {
                        isValidPhoto = false; // Mark as invalid to skip
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
                }
                photoPtr++;
              }
              // Limited spatial fallback around next upcoming photo
              if (photoQueue.length === 0 && photoPtr < photosByTime.length) {
                try {
                  var pNext = photosByTime[photoPtr].p;
                  if (typeof pNext.lon === 'number' && typeof pNext.lat === 'number') {
                    var markerLngLat2 = currentPosLngLat || positionAtDistance(progress * totalDistance);
                    var dist2 = haversineMeters(markerLngLat2, [pNext.lon, pNext.lat]);
                    if (isFinite(dist2) && dist2 <= 50) {
                      var key2 = String(pNext.id || pNext.fullUrl || pNext.thumbUrl || pNext.timestamp || photoPtr);
                      if (!shownPhotoKeys.has(key2)) { 
                        // Additional filename matching to prevent wrong photos
                        var isValidPhoto = true;
                        if (typeof pNext.thumbUrl === 'string' && typeof pNext.fullUrl === 'string') {
                          try {
                            var thumbName = pNext.thumbUrl.split('/').pop().split('?')[0];
                            var fullName = pNext.fullUrl.split('/').pop().split('?')[0];
                            // Check if thumbnail and full image filenames match (allowing for different extensions and resolutions)
                            if (!filenamesMatch(thumbName, fullName)) {
                              isValidPhoto = false;
                            }
                          } catch(_) {}
                        }
                        if (isValidPhoto) {
                          // Check if a photo at this location is already queued or displayed
                          if (isLocationAlreadyQueued(pNext.lat, pNext.lon)) {
                            isValidPhoto = false; // Mark as invalid to skip
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
                  }
                } catch(_) {}
              }
            }
            // Distance-based fallback: trigger photos whose route distance falls within this frame window
            try {
              if (Array.isArray(photosByDist) && photosByDist.length > 0) {
                // Use actual traveled distance this frame to avoid time/EXIF drift issues
                var minD = Math.min(lastPlaybackDist, dNowFrame) - 40; // slack meters
                var maxD = Math.max(lastPlaybackDist, dNowFrame) + 40;
                if (isFinite(minD) && isFinite(maxD)) {
                  while (photoDistPtr < photosByDist.length && photosByDist[photoDistPtr].pDist <= maxD) {
                    var candD = photosByDist[photoDistPtr];
                    if (candD.pDist >= minD && candD.pDist <= maxD) {
                      var pD = candD.p;
                      var keyD = String(pD.id || pD.fullUrl || pD.thumbUrl || pD.timestamp || ('d'+photoPtr));
                      if (!shownPhotoKeys.has(keyD)) {
                        // verify spatially near current marker (~60m) to avoid false positives
                        var mPos = currentPosLngLat || positionAtDistance(progress * totalDistance);
                        var dNear = haversineMeters(mPos, candD.lngLat);
                        if (isFinite(dNear) && dNear <= 60) { 
                          // Additional filename matching to prevent wrong photos
                          var isValidPhoto = true;
                          if (typeof pD.thumbUrl === 'string' && typeof pD.fullUrl === 'string') {
                            try {
                              var thumbName = pD.thumbUrl.split('/').pop().split('?')[0];
                              var fullName = pD.fullUrl.split('/').pop().split('?')[0];
                              // Check if thumbnail and full image filenames match (allowing for different extensions and resolutions)
                              if (!filenamesMatch(thumbName, fullName)) {
                                isValidPhoto = false;
                              }
                            } catch(_) {}
                          }
                          if (isValidPhoto) {
                            // Check if a photo at this location is already queued or displayed
                            if (isLocationAlreadyQueued(pD.lat, pD.lon)) {
                              isValidPhoto = false; // Mark as invalid to skip
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
                    }
                    photoDistPtr++;
                  }
                }
              }
            } catch(_) {}
            lastPlaybackSec = currentSec;
            lastPlaybackDist = dNowFrame;
            // Photos are now processed immediately when queued, so no need for frame-end processing
          }
        } catch(_) {}

        var endReached = reachedPrivacyEnd || (progress >= 1);
        if (!endReached) {
          window.requestAnimationFrame(raf);
        } else {
          setPlaying(false);
          // Stop recording if active when track completes
          if (isRecording && videoRecorder) {
            stopRecording();
          }
          // When animation finishes, zoom out to trimmed bounds (privacy) or full bounds
          fitMapToBounds(800);
        }
      }

      // Recording functions
      function startRecording() {
        if (isRecording || preloadingInProgress) return;
        
        // Show quality selection modal first
        showRecordingSettingsModal().then(function(selectedPreset) {
          if (!selectedPreset) {
            DBG.log('Recording cancelled by user');
            return;
          }
          
          selectedQualityPreset = selectedPreset;
          
          try {
            // Initialize video recorder with selected preset
            if (!videoRecorder || videoRecorder.preset !== selectedQualityPreset) {
              videoRecorder = new VideoRecorder(map, {
                preset: selectedQualityPreset
              });
            }
          
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
            (tilePrefetchPromise || Promise.resolve()).then(function() {
              // Now start recording after preloading is complete
              videoRecorder.start().then(function() {
                isRecording = true;
                
                if (firstPlayZoomPending) {
                  // Start recording before zoom animation
                  zoomInThenStartPlayback();
                } else {
                  setPlaying(true);
                  window.requestAnimationFrame(raf);
                }
              }).catch(function(error) {
                DBG.warn('Failed to start recording', error);
                isRecording = false;
                updateButtonStates();
              });
            });
          } else {
            // If already playing, start recording immediately
            videoRecorder.start().then(function() {
              isRecording = true;
            }).catch(function(error) {
              DBG.warn('Failed to start recording', error);
              isRecording = false;
              updateButtonStates();
            });
          }
          
            DBG.log('Recording started with preset:', selectedQualityPreset);
          } catch (error) {
            DBG.warn('Failed to start recording', error);
            isRecording = false;
            updateButtonStates();
          }
        }).catch(function(error) {
          DBG.warn('Failed to show recording settings', error);
        });
      }
      
      function stopRecording() {
        if (!isRecording || !videoRecorder) return;
        
        try {
          // Stop recording
          videoRecorder.stop();
          isRecording = false;
          
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
          updateButtonStates();
        }
      }
      
      // Calculate track duration for recording estimates (respects playback speed)
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
            var startTime = null, endTime = null;
            
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
            
            if (startTime && endTime && !isNaN(startTime) && !isNaN(endTime) && endTime > startTime) {
              realDurationMinutes = (endTime - startTime) / (1000 * 60); // ms to minutes
              playbackDurationMinutes = realDurationMinutes / currentSpeed; // adjust for playback speed
              DBG.log('Track duration from timestamps:', Math.round(realDurationMinutes) + ' minutes real, ' + Math.round(playbackDurationMinutes) + ' minutes at ' + currentSpeed + 'x speed');
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
          DBG.log('Track duration from totalDuration:', Math.round(realDurationMinutes) + ' minutes real, ' + Math.round(playbackDurationMinutes) + ' minutes at ' + currentSpeed + 'x speed');
          return playbackDurationMinutes;
        }
        
        // Method 3: Use distance and baseline speed (15 km/h scaled by multiplier)
        if (totalDistance && currentSpeed && currentSpeed > 0) {
          // Use same logic as animation: 15 km/h baseline scaled by speed multiplier
          var baselineSpeedKmh = 15; // km/h baseline
          var effectiveSpeedKmh = baselineSpeedKmh * currentSpeed;
          playbackDurationMinutes = (totalDistance / 1000) / effectiveSpeedKmh * 60; // km / (km/h) * 60 = minutes
          DBG.log('Track duration from distance/speed:', Math.round(playbackDurationMinutes) + ' minutes at ' + currentSpeed + 'x speed (' + effectiveSpeedKmh + ' km/h)');
          return playbackDurationMinutes;
        }
        
        // Method 4: Estimate from coordinate count (rough estimate)
        if (coords && coords.length > 0) {
          // Assume 1 point per second on average for GPS tracks, adjusted for playback speed
          realDurationMinutes = coords.length / 60;
          playbackDurationMinutes = realDurationMinutes / currentSpeed;
          DBG.log('Track duration estimated from points:', Math.round(playbackDurationMinutes) + ' minutes at ' + currentSpeed + 'x speed');
          return playbackDurationMinutes;
        }
        
        DBG.warn('Could not calculate track duration, using fallback');
        return 3 / currentSpeed; // fallback adjusted for speed
      }
      
      // Quality selection modal
      function showRecordingSettingsModal() {
        return new Promise(function(resolve, reject) {
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
            setTimeout(function() {
              modal.classList.add('fgpx-modal-show');
            }, 10);
            
          } catch (error) {
            reject(error);
          }
        });
      }
      
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
              Object.keys(VIDEO_QUALITY_PRESETS).map(function(key) {
                var preset = VIDEO_QUALITY_PRESETS[key];
                var estimatedSize = (preset.bitrate / 8 * 60 * 1.3 * trackDurationMinutes) / (1024 * 1024); // MB
                var isRecommended = key === 'medium';
                
                // Calculate expected chunks for this preset
                var tempRecorder = { 
                  estimatedSizePerMinute: (preset.bitrate / 8 * 60 * 1.3) / (1024 * 1024), // MB per minute
                  CHUNK_SIZE_THRESHOLD: 250, // MB
                  CHUNK_SIZE_TARGET: 200 // MB
                };
                var expectedChunks = 1;
                if (estimatedSize > tempRecorder.CHUNK_SIZE_THRESHOLD) {
                  expectedChunks = Math.ceil(estimatedSize / tempRecorder.CHUNK_SIZE_TARGET);
                }
                
                var chunkInfo = '';
                if (expectedChunks > 1) {
                  chunkInfo = '<div class="fgpx-preset-chunks" style="font-size: 11px; color: #e67e22; font-weight: bold; margin-bottom: 2px;">📁 ' + expectedChunks + ' chunks (>250MB)</div>';
                }
                
                return '<div class="fgpx-preset-card" data-preset="' + key + '" style="' +
                  'border: 2px solid ' + (isRecommended ? '#007cba' : '#ddd') + '; ' +
                  'border-radius: 6px; padding: 12px; cursor: pointer; ' +
                  'transition: all 0.2s ease; position: relative;' +
                  (isRecommended ? 'background: #f0f8ff;' : '') + '">' +
                  (isRecommended ? '<div style="position: absolute; top: -8px; right: 8px; background: #007cba; color: white; padding: 2px 8px; border-radius: 4px; font-size: 10px;">RECOMMENDED</div>' : '') +
                  '<div class="fgpx-preset-name" style="font-weight: bold; color: #333; margin-bottom: 4px;">' + preset.name + '</div>' +
                  '<div class="fgpx-preset-specs" style="font-size: 12px; color: #666; margin-bottom: 4px;">' + 
                    preset.resolution.width + 'x' + preset.resolution.height + ' • ' + preset.fps + 'fps • ' + Math.round(preset.bitrate / 1000000) + ' Mbps' +
                  '</div>' +
                  '<div class="fgpx-preset-size" style="font-size: 12px; color: #007cba; font-weight: bold; margin-bottom: 4px;">~' + Math.round(estimatedSize) + 'MB total</div>' +
                  chunkInfo +
                  '<div class="fgpx-preset-use" style="font-size: 11px; color: #888;">' + preset.useCase + '</div>' +
                '</div>';
              }).join('') +
            '</div>' +
          '</div>' +
          
          '<div class="fgpx-recording-preview" style="background: #f5f5f5; padding: 16px; border-radius: 6px; margin-bottom: 20px;">' +
            '<div class="fgpx-preview-stats" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px;">' +
              '<div class="fgpx-stat">' +
                '<span class="fgpx-stat-label" style="display: block; font-size: 12px; color: #666;">Track Duration:</span>' +
                '<span class="fgpx-stat-value" style="font-weight: bold; color: #333;">' + Math.floor(trackDurationMinutes) + 'm ' + Math.round((trackDurationMinutes % 1) * 60) + 's</span>' +
              '</div>' +
              '<div class="fgpx-stat">' +
                '<span class="fgpx-stat-label" style="display: block; font-size: 12px; color: #666;">Selected Quality:</span>' +
                '<span class="fgpx-stat-value" id="fgpx-selected-quality" style="font-weight: bold; color: #333;">Standard Definition</span>' +
              '</div>' +
              '<div class="fgpx-stat">' +
                '<span class="fgpx-stat-label" style="display: block; font-size: 12px; color: #666;">Expected File Size:</span>' +
                '<span class="fgpx-stat-value" id="fgpx-total-size" style="font-weight: bold; color: #007cba;">~' + Math.round((VIDEO_QUALITY_PRESETS.medium.bitrate / 8 * 60 * 1.3 * trackDurationMinutes) / (1024 * 1024)) + 'MB</span>' +
              '</div>' +
            '</div>' +
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
        presetCards.forEach(function(card) {
          card.addEventListener('click', function() {
            // Remove selection from all cards
            presetCards.forEach(function(c) {
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
            var estimatedSize = (preset.bitrate / 8 * 60 * 1.3 * trackDurationMinutes) / (1024 * 1024);
            document.getElementById('fgpx-total-size').textContent = '~' + Math.round(estimatedSize) + 'MB';
          });
          
          // Select medium by default
          if (card.getAttribute('data-preset') === 'medium') {
            card.click();
          }
        });
        
        // Close button
        modalContent.querySelector('.fgpx-modal-close').addEventListener('click', function() {
          closeModal(null);
        });
        
        // Cancel button
        modalContent.querySelector('#fgpx-cancel-recording').addEventListener('click', function() {
          closeModal(null);
        });
        
        // Start recording button
        modalContent.querySelector('#fgpx-start-recording').addEventListener('click', function() {
          closeModal(selectedPreset);
        });
        
        // Close on backdrop click
        modal.addEventListener('click', function(e) {
          if (e.target === modal) {
            closeModal(null);
          }
        });
        
        function closeModal(result) {
          modal.classList.remove('fgpx-modal-show');
          setTimeout(function() {
            if (modal.parentNode) {
              modal.parentNode.removeChild(modal);
            }
            resolve(result);
          }, 300);
        }
        
        // Add CSS for modal show state
        var style = document.createElement('style');
        style.textContent = 
          '.fgpx-modal-show { opacity: 1 !important; }' +
          '.fgpx-modal-show > div { transform: scale(1) !important; }' +
          '.fgpx-preset-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }' +
          '.fgpx-btn:hover { opacity: 0.9; transform: translateY(-1px); }';
        document.head.appendChild(style);
        
        return modal;
      }

      // Control events
      ui.controls.btnPlay.addEventListener('click', function () {
        var atEnd = privacyEnabled ? (progress >= (privacyEndP - 1e-6)) : (progress >= 1);
        if (atEnd) { reset(); }
        if (!playing && !preloadingInProgress) {
          // Start preloading if not already completed
          if (prefetchEnabled && !preloadCompleted) {
            tilePrefetchPromise = prefetchTilesForRoute();
          }
          try {
            (tilePrefetchPromise||Promise.resolve()).then(function(){
              // Only start zoom/playback after preloading is completely finished
              try { hideSplash(); } catch(_) {}
              if (firstPlayZoomPending) { zoomInThenStartPlayback(); }
              else { setPlaying(true); window.requestAnimationFrame(raf); }
            });
          } catch(_) {
            // Fallback: start immediately if promise fails
            try { hideSplash(); } catch(_) {}
            if (firstPlayZoomPending) { zoomInThenStartPlayback(); }
            else { setPlaying(true); window.requestAnimationFrame(raf); }
          }
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
      ui.controls.speedSel.addEventListener('change', function (e) { var v = parseFloat(e.target.value || '1'); if (!isFinite(v) || v <= 0) v = 1; speed = v; });
      
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

      // Weather toggle handler (only if weather is enabled)
      if (weatherEnabled && weatherData && weatherData.features && Array.isArray(weatherData.features) && weatherData.features.length > 0) {
        var weatherVisible = !!(window.FGPX && FGPX.weatherVisibleByDefault); // Start hidden by default unless admin enables it
        
        // Set initial button state
        ui.controls.btnWeather.style.opacity = weatherVisible ? '1' : '0.5';
        ui.controls.btnWeather.setAttribute('title', weatherVisible ? 'Hide Weather Overlay' : 'Show Weather Overlay');
        
        ui.controls.btnWeather.addEventListener('click', function () {
          weatherVisible = !weatherVisible;
          
          try {
            // Toggle visibility of all weather layers
            var visibility = weatherVisible ? 'visible' : 'none';
            
            // Toggle all 4 heatmap layers (one per weather type)
            map.setLayoutProperty('fgpx-weather-heatmap-snow', 'visibility', visibility);
            map.setLayoutProperty('fgpx-weather-heatmap-rain', 'visibility', visibility);
            map.setLayoutProperty('fgpx-weather-heatmap-fog', 'visibility', visibility);
            map.setLayoutProperty('fgpx-weather-heatmap-clouds', 'visibility', visibility);
            
            // Toggle circle layer
            map.setLayoutProperty('fgpx-weather-circle', 'visibility', visibility);
            
            // Update button appearance
            ui.controls.btnWeather.style.opacity = weatherVisible ? '1' : '0.5';
            ui.controls.btnWeather.setAttribute('title', weatherVisible ? 'Hide Weather Overlay' : 'Show Weather Overlay');
            
            DBG.log('Weather overlay toggled:', weatherVisible ? 'visible' : 'hidden');
          } catch (e) {
            DBG.warn('Failed to toggle weather layers:', e);
          }
        });

        // Temperature toggle handler
        var temperatureVisible = false;
        ui.controls.btnTemperature.style.opacity = '0.5';
        ui.controls.btnTemperature.setAttribute('title', 'Show Temperature Overlay');
        
        ui.controls.btnTemperature.addEventListener('click', function () {
          temperatureVisible = !temperatureVisible;
          
          try {
            var tempVisibility = temperatureVisible ? 'visible' : 'none';
            if (map.getLayer('fgpx-temperature-circle')) {
              map.setLayoutProperty('fgpx-temperature-circle', 'visibility', tempVisibility);
            }
            if (map.getLayer('fgpx-temperature-text')) {
              map.setLayoutProperty('fgpx-temperature-text', 'visibility', tempVisibility);
            } else {
              DBG.log('Temperature text layer not available (no glyphs in map style)');
            }
            
            // Update button appearance
            ui.controls.btnTemperature.style.opacity = temperatureVisible ? '1' : '0.5';
            ui.controls.btnTemperature.setAttribute('title', temperatureVisible ? 'Hide Temperature Overlay' : 'Show Temperature Overlay');
            
            DBG.log('Temperature overlay toggled:', temperatureVisible ? 'visible' : 'hidden');
          } catch (e) {
            DBG.warn('Failed to toggle temperature layer:', e);
          }
        });

        // Wind toggle handler
        var windVisible = false;
        ui.controls.btnWind.style.opacity = '0.5';
        ui.controls.btnWind.setAttribute('title', 'Show Wind Overlay');
        
        ui.controls.btnWind.addEventListener('click', function () {
          windVisible = !windVisible;
          
          try {
            var windVisibility = windVisible ? 'visible' : 'none';
            if (map.getLayer('fgpx-wind-arrows')) {
              map.setLayoutProperty('fgpx-wind-arrows', 'visibility', windVisibility);
            }
            if (map.getLayer('fgpx-wind-text')) {
              map.setLayoutProperty('fgpx-wind-text', 'visibility', windVisibility);
            } else {
              DBG.log('Wind text layer not available (no glyphs in map style)');
            }
            
            // Toggle all wind arrow layers
            for (var i = 0; i < 12; i++) {
              try {
                map.setLayoutProperty('fgpx-wind-arrows-circle-' + i, 'visibility', windVisibility);
              } catch (e) {
                // Layer might not exist yet
              }
            }
            
            // Update button appearance
            ui.controls.btnWind.style.opacity = windVisible ? '1' : '0.5';
            ui.controls.btnWind.setAttribute('title', windVisible ? 'Hide Wind Overlay' : 'Show Wind Overlay');
            
            DBG.log('Wind overlay toggled:', windVisible ? 'visible' : 'hidden');
            
            // Debug: Check if arrow icon exists and layer state
            DBG.log('DEBUG: Arrow icon exists:', map.hasImage('arrow'));
            
            // Check if layers exist before trying to access them
            var layers = map.getStyle().layers;
            var arrowLayerExists = layers.some(layer => layer.id === 'fgpx-wind-arrows');
            var textLayerExists = layers.some(layer => layer.id === 'fgpx-wind-text');
            
            DBG.log('DEBUG: Wind arrows layer exists:', arrowLayerExists);
            DBG.log('DEBUG: Wind text layer exists:', textLayerExists);
            
            if (arrowLayerExists) {
              DBG.log('DEBUG: Wind arrows visibility:', map.getLayoutProperty('fgpx-wind-arrows', 'visibility'));
            }
            if (textLayerExists) {
              DBG.log('DEBUG: Wind text visibility:', map.getLayoutProperty('fgpx-wind-text', 'visibility'));
            }
            
            DBG.log('DEBUG: Wind source data features:', map.getSource('fgpx-weather')._data.features.length);
            
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
                    'visibility': windVisible ? 'visible' : 'none',
                    'icon-image': [
                      'case',
                      ['!=', ['get', 'wind_speed_kmh'], null],
                      [
                        'case',
                        ['<', ['get', 'wind_speed_kmh'], 5], 'arrow-calm',
                        ['<', ['get', 'wind_speed_kmh'], 15], 'arrow-light',
                        ['<', ['get', 'wind_speed_kmh'], 25], 'arrow-moderate',
                        ['<', ['get', 'wind_speed_kmh'], 40], 'arrow-strong',
                        'arrow-very-strong'
                      ],
                      'arrow-calm'
                    ],
                    'icon-size': [
                      'interpolate',
                      ['linear'],
                      ['get', 'wind_speed_kmh'],
                      0, 0.5,
                      20, 0.8,
                      50, 1.2
                    ],
                    'icon-rotate': ['get', 'wind_direction_deg'],
                    'icon-rotation-alignment': 'map',
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true
                  },
                  paint: {
                    'icon-opacity': [
                      'interpolate',
                      ['linear'],
                      ['zoom'],
                      12, 0,
                      13, 0.7
                    ]
                  }
                });
                DBG.log('DEBUG: Arrow layer added successfully in toggle handler');
              } catch (e) {
                DBG.warn('DEBUG: Failed to add arrow layer in toggle handler:', e);
              }
            }
          } catch (e) {
            DBG.warn('Failed to toggle wind layer:', e);
          }
        });
      }

      // Day/night overlay toggle button handler
      if (ui.controls.btnDayNight && window.FGPX && FGPX.daynightMapEnabled) {
        var daynightVisible = !!(window.FGPX && FGPX.daynightVisibleByDefault); // Use dedicated day/night setting
        ui.controls.btnDayNight.style.opacity = daynightVisible ? '1' : '0.5';
        ui.controls.btnDayNight.setAttribute('title', daynightVisible ? 'Hide Day/Night Overlay' : 'Show Day/Night Overlay');
        
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
                // Show layer with smooth fade-in
                map.setLayoutProperty('fgpx-daynight-overlay', 'visibility', 'visible');
                
                // Animate opacity from 0 to target opacity
                var targetOpacity = parseFloat(window.FGPX.daynightMapOpacity) || 0.4;
                var steps = 20;
                var duration = 300; // 300ms transition
                var stepDuration = duration / steps;
                
                for (var i = 0; i <= steps; i++) {
                  (function(step) {
                    setTimeout(function() {
                      var progress = step / steps;
                      var currentOpacity = progress * targetOpacity;
                      
                      // Update the fill-opacity paint property with smooth interpolation
                      map.setPaintProperty('fgpx-daynight-overlay', 'fill-opacity', [
                        'interpolate',
                        ['linear'],
                        ['to-number', ['get', 'nightOpacity']],
                        0, 0,
                        1, currentOpacity
                      ]);
                    }, step * stepDuration);
                  })(i);
                }
                
                DBG.log('Started fade-in animation to opacity:', targetOpacity);
              } else {
                // Fade out smoothly then hide
                var currentOpacity = parseFloat(window.FGPX.daynightMapOpacity) || 0.4;
                var steps = 20;
                var duration = 300; // 300ms transition
                var stepDuration = duration / steps;
                
                for (var i = 0; i <= steps; i++) {
                  (function(step) {
                    setTimeout(function() {
                      var progress = step / steps;
                      var opacity = currentOpacity * (1 - progress);
                      
                      // Update the fill-opacity paint property
                      map.setPaintProperty('fgpx-daynight-overlay', 'fill-opacity', [
                        'interpolate',
                        ['linear'],
                        ['to-number', ['get', 'nightOpacity']],
                        0, 0,
                        1, opacity
                      ]);
                      
                      // Hide layer after fade-out completes
                      if (step === steps) {
                        map.setLayoutProperty('fgpx-daynight-overlay', 'visibility', 'none');
                      }
                    }, step * stepDuration);
                  })(i);
                }
                
                DBG.log('Started fade-out animation from opacity:', currentOpacity);
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
          ui.controls.btnDayNight.setAttribute('title', daynightVisible ? 'Hide Day/Night Overlay' : 'Show Day/Night Overlay');
          
          DBG.log('Button updated - opacity:', ui.controls.btnDayNight.style.opacity, 'title:', ui.controls.btnDayNight.getAttribute('title'));
        });
      } else {
        DBG.log('Day/night toggle button setup skipped:', {
          btnExists: !!ui.controls.btnDayNight,
          fgpxExists: !!window.FGPX,
          enabled: !!(window.FGPX && FGPX.daynightMapEnabled)
        });
      }

      window.addEventListener('keydown', function (e) {
        if (e.code === 'Space') {
          e.preventDefault();
          if (playing) { 
            setPlaying(false); 
            // Stop recording when paused via spacebar
            if (isRecording && videoRecorder) {
              stopRecording();
            }
          }
          else if (!preloadingInProgress) {
            var atEndKey = privacyEnabled ? (progress >= (privacyEndP - 1e-6)) : (progress >= 1);
            if (atEndKey) reset();
            // Start preloading if not already completed
            if (prefetchEnabled && !preloadCompleted) {
              tilePrefetchPromise = prefetchTilesForRoute();
            }
            try { 
              hideSplash(); 
              (tilePrefetchPromise||Promise.resolve()).then(function(){
                // Only start zoom/playback after preloading is completely finished
                if (firstPlayZoomPending) { zoomInThenStartPlayback(); }
                else { setPlaying(true); window.requestAnimationFrame(raf); }
              });
            } catch(_) {
              // Fallback: start immediately if promise fails
              if (firstPlayZoomPending) { zoomInThenStartPlayback(); }
              else { setPlaying(true); window.requestAnimationFrame(raf); }
            }
          }
        }
      });

      // Click-to-seek on progress bar: move to point in playback and reveal route up to there
      function seekToFraction(frac) {
        var f = Math.max(0, Math.min(1, frac));
        // Map to privacy window
        if (privacyEnabled) {
          var dSpan = Math.max(0, privacyEndD - privacyStartD);
          var dTarget = privacyStartD + f * (dSpan > 0 ? dSpan : 0);
          progress = (dSpan > 0) ? (dTarget / totalDistance) : (privacyStartD / totalDistance);
        } else {
          progress = f;
        }
        
        // Force day/night overlay update when seeking
        if (typeof window.__fgpxDayNightForceUpdate !== 'undefined') {
          window.__fgpxDayNightForceUpdate = true;
          DBG.log('=== SEEKING: Force update flag set for day/night overlay ===');
        }
        
        // Clear photo state when seeking to allow photos to be shown again
        // This fixes the issue where photos weren't shown when seeking backward
        try {
          shownPhotoKeys.clear();
          photoQueue.length = 0;
          overlayActive = false;
          currentDisplayedPhoto = null;
        } catch(_) {}
        
        // Map to time offset if timestamps available
        if (hasTimestamps && totalDuration != null) {
          // Estimate tOffset via distance mapping for privacy window
          var distNow = progress * totalDistance;
          var lo2s = 0, hi2s = timeOffsets.length - 1;
          while (lo2s < hi2s) { var mid2s = (lo2s + hi2s) >>> 1; if (cumDist[mid2s] < distNow) lo2s = mid2s + 1; else hi2s = mid2s; }
          tOffset = timeOffsets[Math.max(0, lo2s)] || 0;
          lastPlaybackSec = tOffset;
          // Reposition photo pointer to current time to avoid scanning from start
          try {
            if (photosByTime && photosByTime.length > 0) {
              var lpt = 0, hpt = photosByTime.length;
              while (lpt < hpt) { var mpt = (lpt + hpt) >>> 1; if (photosByTime[mpt].pSec < lastPlaybackSec) lpt = mpt + 1; else hpt = mpt; }
              photoPtr = lpt;
            }
            if (Array.isArray(photosByDist) && photosByDist.length > 0) {
              var dNowSeek = progress * totalDistance;
              var loPd2 = 0, hiPd2 = photosByDist.length;
              while (loPd2 < hiPd2) { var midPd2 = (loPd2 + hiPd2) >>> 1; if (photosByDist[midPd2].pDist < dNowSeek) loPd2 = midPd2 + 1; else hiPd2 = midPd2; }
              photoDistPtr = loPd2;
            }
          } catch(_) {}
        }
        // Prepare for immediate camera update and auto-play from the new position
        forceCameraUpdate = true;
        appliedBearing = null;
        bearing = null;
        setProgressBar(progress);
        DBG.log('=== SEEKING: About to call updateVisuals with progress:', progress, 'Force flag:', window.__fgpxDayNightForceUpdate);
        updateVisuals(progress);
        try {
          // Move camera immediately to marker
          if (currentPosLngLat && Array.isArray(currentPosLngLat)) {
            cameraCenter = currentPosLngLat.slice(0,2);
            map.jumpTo({ center: cameraCenter });
          }
          // Update chart cursor explicitly
          if (useTime && Array.isArray(timeOffsets)) {
            var seriesX2 = Array.isArray(movingTimeOffsets) ? movingTimeOffsets : timeOffsets;
            var lo2s = 0, hi2s = timeOffsets.length - 1;
            var distNow = progress * totalDistance;
            while (lo2s < hi2s) { var mid2s = (lo2s + hi2s) >>> 1; if (cumDist[mid2s] < distNow) lo2s = mid2s + 1; else hi2s = mid2s; }
            cursorX = seriesX2[Math.max(0, lo2s)] || 0;
          } else { cursorX = (progress * totalDistance) / 1000; }
          if (chart && chart.data && chart.data.datasets) {
            var idxY = Math.max(0, Math.round(progress * (coords.length - 1)));
            var yNow2 = window.getPositionMarkerY ? window.getPositionMarkerY(idxY) : ((typeof coords[idxY][2] === 'number') ? coords[idxY][2] : 0);
            // Find position marker dataset dynamically
            for (var i = 0; i < chart.data.datasets.length; i++) {
              if (chart.data.datasets[i].label === 'Position') {
                chart.data.datasets[i].data[0] = { x: cursorX, y: yNow2 };
                break;
              }
            }
          }
          chart.update('none');
          chart.draw(); // Force redraw to update cursor visibility based on zoom state
        } catch (_) {}
        // Preserve playback state when seeking - don't auto-start if was paused
        // Only auto-play if we were already playing or if this is the first play
        if (!playing && firstPlayZoomPending) {
          zoomInThenStartPlayback();
        } else if (playing) {
          // If we were playing, continue playing after seek
          window.requestAnimationFrame(raf);
        }
        // If we were paused (!playing && !firstPlayZoomPending), stay paused
      }

      try {
        var barWrap = ui.controls.progressBar && ui.controls.progressBar.parentElement ? ui.controls.progressBar.parentElement : null;
        if (barWrap) {
          barWrap.style.cursor = 'pointer';
          barWrap.addEventListener('click', function (ev) {
            var rect = barWrap.getBoundingClientRect();
            var x = (ev.clientX - rect.left);
            var frac = rect.width > 0 ? (x / rect.width) : 0;
            seekToFraction(frac);
          });
        }
      } catch (_) {}

      // Helper function to fit map bounds consistently
      function fitMapToBounds(duration) {
        duration = duration || 0;
        try { 
          map.fitBounds((innerBoundsRef || fullBoundsRef), { padding: 40, duration: duration }); 
        } catch (e) {
          DBG.warn('Failed to fit map bounds', e);
        }
      }

      // Initial visuals
      reset();
    });
  }

  function boundsFromCoords(cs) {
    var minLon = 180, minLat = 90, maxLon = -180, maxLat = -90;
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i];
      if (c[0] < minLon) minLon = c[0]; if (c[0] > maxLon) maxLon = c[0];
      if (c[1] < minLat) minLat = c[1]; if (c[1] > maxLat) maxLat = c[1];
    }
    return [[minLon, minLat], [maxLon, maxLat]];
  }

  function __fgpxRunInit(){
    try {
      // Debug logs now that FGPX is available
      DBG.log('=== FGPX INITIALIZATION ===');
      DBG.log('SunCalc availability at init', {
        windowSunCalc: typeof window.SunCalc,
        SunCalcExists: !!window.SunCalc
      });
      
      if (typeof init === 'function') {
        init();
      }
    } catch(e) {
      DBG.warn('Initialization error:', e);
    }
  }

  if (window.FGPX && window.FGPX.deferViewport) {
    // Lazy: expose boot for loader
    window.FGPX.boot = function(){
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
})();


