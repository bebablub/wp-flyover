/**
 * Minimal runtime regression tests for front.js.
 *
 * Scope intentionally stays small and avoids deep map/chart rendering.
 * We validate high-risk behavior that is observable before startPlayer() runs.
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

function flushAsync() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function baseFGPX(overrides = {}) {
  return Object.assign(
    {
      deferViewport: true,
      debugLogging: false,
      restUrl: 'https://example.test/wp-json/fgpx/v1',
      nonce: 'nonce-123',
      ajaxUrl: 'https://example.test/wp-admin/admin-ajax.php',
      instances: {},
      defaultSpeed: 25,
      weatherEnabled: false,
      daynightMapEnabled: false,
    },
    overrides
  );
}

function mockRejectedFetch(message) {
  const fetchMock = jest.fn().mockRejectedValue(new Error(message));
  global.fetch = fetchMock;
  window.fetch = fetchMock;
  return fetchMock;
}

describe('front.js runtime minimal regressions', () => {
  let originalGlobalFetch;
  let originalWindowFetch;

  beforeAll(() => {
    originalGlobalFetch = global.fetch;
    originalWindowFetch = window.fetch;
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    delete window.FGPX;
    delete window.maplibregl;
    delete window.Chart;
    if (window.switchChartTab) delete window.switchChartTab;
    jest.restoreAllMocks();
  });

  afterAll(() => {
    global.fetch = originalGlobalFetch;
    window.fetch = originalWindowFetch;
  });

  test('boot is idempotent (_bootDone prevents duplicate init work)', async () => {
    document.body.innerHTML = '<div id="fgpx-app" class="fgpx" data-track-id="42"></div>';

    window.maplibregl = {};
    window.Chart = function ChartStub() {};

    const fetchMock = mockRejectedFetch('network down');

    window.FGPX = baseFGPX();
    loadFront();

    expect(typeof window.FGPX.boot).toBe('function');

    window.FGPX.boot();
    window.FGPX.boot();

    await flushAsync();

    // Only one init run should happen. With rejected fetch, that run triggers
    // REST first and then the AJAX fallback.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(window.FGPX._bootDone).toBe(true);
  });

  test('per-instance defaultSpeed is applied per container UI', async () => {
    document.body.innerHTML =
      '<div id="fgpx-app" class="fgpx" data-track-id="1"></div>' +
      '<div id="fgpx-app-2" class="fgpx" data-track-id="2"></div>';

    window.maplibregl = {};
    window.Chart = function ChartStub() {};

    mockRejectedFetch('network down');

    window.FGPX = baseFGPX({
      instances: {
        'fgpx-app': { defaultSpeed: 10 },
        'fgpx-app-2': { defaultSpeed: 100 },
      },
    });

    loadFront();
    window.FGPX.boot();

    await flushAsync();

    const firstSel = document.querySelector('#fgpx-app .fgpx-select');
    const secondSel = document.querySelector('#fgpx-app-2 .fgpx-select');

    expect(firstSel).not.toBeNull();
    expect(secondSel).not.toBeNull();
    expect(firstSel.value).toBe('10');
    expect(secondSel.value).toBe('100');
  });

  test('REST URL uses instance hostPostId override when present', async () => {
    document.body.innerHTML =
      '<div id="fgpx-app" class="fgpx" data-track-id="7"></div>' +
      '<div id="fgpx-app-2" class="fgpx" data-track-id="8"></div>';

    window.maplibregl = {};
    window.Chart = function ChartStub() {};

    const fetchMock = mockRejectedFetch('network down');

    window.FGPX = baseFGPX({
      ajaxUrl: null,
      instances: {
        'fgpx-app': { hostPostId: 111 },
        'fgpx-app-2': { hostPostId: 222 },
      },
    });

    loadFront();
    window.FGPX.boot();

    await flushAsync();

    const calledUrls = fetchMock.mock.calls.map((args) => String(args[0]));
    expect(calledUrls.length).toBe(2);
    expect(calledUrls[0]).toContain('/track/7?host_post=111');
    expect(calledUrls[1]).toContain('/track/8?host_post=222');
  });

  test('failed REST request attempts AJAX fallback', async () => {
    document.body.innerHTML = '<div id="fgpx-app" class="fgpx" data-track-id="9"></div>';

    window.maplibregl = {};
    window.Chart = function ChartStub() {};

    const fetchMock = mockRejectedFetch('network down');

    window.FGPX = baseFGPX();
    loadFront();
    window.FGPX.boot();

    await flushAsync();

    const calledUrls = fetchMock.mock.calls.map((args) => String(args[0]));
    expect(calledUrls.length).toBe(2);
    expect(calledUrls[0]).toContain('/wp-json/fgpx/v1/track/9');
    expect(calledUrls[1]).toContain('admin-ajax.php');
    expect(calledUrls[1]).toContain('action=fgpx_track');
    expect(calledUrls[1]).toContain('id=9');
  });

  test('shows user-facing error after REST and AJAX both fail', async () => {
    document.body.innerHTML = '<div id="fgpx-app" class="fgpx" data-track-id="12"></div>';

    window.maplibregl = {};
    window.Chart = function ChartStub() {};

    mockRejectedFetch('network down');

    window.FGPX = baseFGPX({
      i18n: { failedLoad: 'Failed to load track:' },
    });

    loadFront();
    window.FGPX.boot();

    await flushAsync();

    const err = document.querySelector('#fgpx-app .fgpx-error');
    expect(err).not.toBeNull();
    expect(err.style.display).toBe('block');
    expect(err.textContent).toContain('Failed to load track:');
    expect(err.textContent).toContain('network down');
  });

  test('dynamic progress segments are inserted before marker layer', () => {
    expect(FRONT_SRC).toContain("map.addLayer(segmentLayerConfig, 'fgpx-point-circle')");
  });

  test('gallery player strategy param is passed to REST and AJAX URLs', async () => {
    document.body.innerHTML =
      '<div id="fgpx-app" class="fgpx" data-track-id="7"></div>';

    window.maplibregl = {};
    window.Chart = function ChartStub() {};

    const fetchMock = mockRejectedFetch('network down');

    window.FGPX = baseFGPX({
      ajaxUrl: 'http://example.com/wp-admin/admin-ajax.php',
      instances: {
        'fgpx-app': { galleryPhotoStrategy: 'latest_embed' },
      },
    });

    loadFront();
    window.FGPX.boot();

    await flushAsync();

    const calledUrls = fetchMock.mock.calls.map((args) => String(args[0]));
    expect(calledUrls.length).toBe(2);
    expect(calledUrls[0]).toContain('strategy=latest_embed');
    expect(calledUrls[1]).toContain('strategy=latest_embed');
  });

  test('cache key builder includes strategy token for differentiation', () => {
    expect(FRONT_SRC).toContain("var strategy = hasGalleryStrategy ? 'latest_embed' : 'default';");
    expect(FRONT_SRC).toContain("return 'fgpx_cache_v3_' + trackId + '_hp_' + hostPost + '_s_' + simplify + '_t_' + target + '_st_' + strategy;");
  });

  test('fetch pipeline uses timeout/abort helper with configurable timeout', () => {
    expect(FRONT_SRC).toContain('var fetchTimeoutMs = Math.max(3000');
    expect(FRONT_SRC).toContain('function fetchJsonWithTimeout(url, options, label) {');
    expect(FRONT_SRC).toContain("if (err && err.name === 'AbortError') {");
    expect(FRONT_SRC).toContain("' timeout after '");
    expect(FRONT_SRC).toContain('return r.text().then(function(raw) {');
    expect(FRONT_SRC).toContain("payload && typeof payload.message === 'string'");
  });

  test('initContainer guards UI updates when container is disconnected', () => {
    expect(FRONT_SRC).toContain('function isContainerActive() {');
    expect(FRONT_SRC).toContain('if (!isContainerActive()) return;');
  });

  test('animation scheduling guards detached roots and cancels RAF when paused', () => {
    expect(FRONT_SRC).toContain('if (!playing && rafId) {');
    expect(FRONT_SRC).toContain('window.cancelAnimationFrame(rafId);');
    expect(FRONT_SRC).toContain('if (!document.contains(root)) return;');
    expect(FRONT_SRC).toContain('registerTeardown(function() { window.removeEventListener(\'keydown\', onPlayerKeydown); });');
    expect(FRONT_SRC).toContain('registerTeardown(function() { window.removeEventListener(\'keydown\', onOverlayKeydown); });');
    expect(FRONT_SRC).toContain('destroyRuntime();');
    expect(FRONT_SRC).toContain('if (!document.contains(root)) {');
  });

  test('latest_embed strategy bypasses local cache and fetches fresh payload', async () => {
    document.body.innerHTML = '<div id="fgpx-app" class="fgpx" data-track-id="7"></div>';

    window.maplibregl = {};
    window.Chart = function ChartStub() {};

    // Seed a would-be valid cache entry; latest_embed should ignore it.
    localStorage.setItem(
      'fgpx_cache_v3_7_hp_0_s_0_t_1200_st_latest_embed',
      JSON.stringify({
        timestamp: Date.now(),
        payload: {
          geojson: { coordinates: [], properties: {} },
          bounds: [],
          stats: {},
          photos: [],
        },
      })
    );

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        geojson: { coordinates: [], properties: {} },
        bounds: [],
        stats: {},
        photos: [],
      }),
    });
    global.fetch = fetchMock;
    window.fetch = fetchMock;

    window.FGPX = baseFGPX({
      ajaxUrl: null,
      instances: {
        'fgpx-app': { galleryPhotoStrategy: 'latest_embed' },
      },
    });

    loadFront();
    window.FGPX.boot();
    await flushAsync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('strategy=latest_embed');
  });

  test('video recorder session ID generation uses crypto-backed helper', () => {
    expect(FRONT_SRC).toContain('function createSessionIdSuffix(length)');
    expect(FRONT_SRC).toContain("this.sessionId = 'rec_' + Date.now() + '_' + createSessionIdSuffix(9);");
    expect(FRONT_SRC).toContain('cryptoObj.getRandomValues(bytes);');
    expect(FRONT_SRC).not.toContain("this.sessionId = 'rec_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);");
  });

  test('weathergrade lookup supports backend time_unix with timestamp fallback', () => {
    expect(FRONT_SRC).toContain('var tsEpoch = parseEpochSeconds(p.time_unix);');
    expect(FRONT_SRC).toContain('if (!isFinite(tsEpoch)) tsEpoch = parseEpochSeconds(p.timestamp);');
  });

  test('weathergrade tab is guarded when weather data is unavailable', () => {
    expect(FRONT_SRC).toContain("if (tabType === 'weathergrade' && !weatherGradeAvailable)");
    expect(FRONT_SRC).toContain("ui.tabs.tabWeatherGrade.style.display = 'none';");
  });

  test('weathergrade uses snowfall signal for snow visuals', () => {
    expect(FRONT_SRC).toContain('snowfall_cm: lerp(lp.snowfall_cm, hp.snowfall_cm),');
    expect(FRONT_SRC).toContain('var snowVal = Number(cond.snowfall_cm);');
  });

  test('weather cinema throttling is scoped per instance', () => {
    expect(FRONT_SRC).toContain('var lastUpdate = Number(cinemaEl._lastUpdate || 0);');
    expect(FRONT_SRC).toContain('cinemaEl._lastUpdate = now;');
    expect(FRONT_SRC).not.toContain('var _weatherCinemaLastUpdate = 0;');
  });

  test('weather timestamp parser rejects implausible epoch ranges', () => {
    expect(FRONT_SRC).toContain('if (numericEpoch > 0 && numericEpoch < 4102444800) return numericEpoch;');
    expect(FRONT_SRC).toContain('if (parsedEpoch > 0 && parsedEpoch < 4102444800) return parsedEpoch;');
  });

  test('weather legend includes accessibility labels', () => {
    expect(FRONT_SRC).toContain("legend.setAttribute('role', 'group');");
    expect(FRONT_SRC).toContain("span.setAttribute('aria-label', item.aria);");
    expect(FRONT_SRC).toContain("span.setAttribute('aria-live', 'polite');");
  });

  test('weather cinema icon groups expose tooltips describing icon meaning', () => {
    expect(FRONT_SRC).toContain("var i18n = (window.FGPX && FGPX.i18n) ? FGPX.i18n : {};");
    expect(FRONT_SRC).toContain("var dayTooltip = i18n.simCelestialDayAria || 'Daytime indicator (sun)';");
    expect(FRONT_SRC).toContain("var conditionIconsTooltip = i18n.simConditionIconsAria || 'Weather condition icons: fog, clouds, rain, snow, wind';");
    expect(FRONT_SRC).toContain("celestial.setAttribute('data-fgpx-tooltip', dayTooltip);");
    expect(FRONT_SRC).toContain("conditionIcons.setAttribute('data-fgpx-tooltip', conditionIconsTooltip);");
    expect(FRONT_SRC).toContain('bindWeatherFloatingTooltip(celestial);');
    expect(FRONT_SRC).toContain('bindWeatherFloatingTooltip(conditionIcons);');
    expect(FRONT_SRC).toContain("function showWeatherFloatingTooltip(targetEl, text, clientX, clientY)");
    expect(FRONT_SRC).toContain("activeConditionLabels.push(simI18N.simCondFog || 'Fog');");
    expect(FRONT_SRC).toContain("var activeIconsPrefix = simI18N.simConditionIconsActivePrefix || 'Active weather icons';");
    expect(FRONT_SRC).toContain("setAttrIfChanged(conditionIcons, 'title', conditionTooltip);");
    expect(FRONT_SRC).toContain("setAttrIfChanged(conditionIcons, 'data-fgpx-tooltip', conditionTooltip);");
    expect(FRONT_SRC).toContain("setAttrIfChanged(celestial, 'title', celestialTooltip);");
    expect(FRONT_SRC).toContain("setAttrIfChanged(celestial, 'data-fgpx-tooltip', celestialTooltip);");
  });

  test('chart tabs use instance-scoped switch handler (no global dependency)', () => {
    expect(FRONT_SRC).toContain('var switchChartTab = function(tabType) {');
    expect(FRONT_SRC).toContain("ui.tabs.tabElevation.addEventListener('click', function() { switchChartTab('elevation'); });");
    expect(FRONT_SRC).not.toContain("ui.tabs.tabElevation.addEventListener('click', function() { window.switchChartTab('elevation'); });");
  });

  test('weathergrade container is initialized at startPlayer scope and reused safely', () => {
    expect(FRONT_SRC).toContain("var container = root.querySelector('.fgpx-container');");
    expect(FRONT_SRC).toContain('var cinemaRoot = container || root;');
    expect(FRONT_SRC).toContain("var cinemaEl = cinemaRoot.querySelector('.fgpx-weather-cinema');");
    expect(FRONT_SRC).toContain('var _cinemaEl = cinemaRoot._cachedCinema;');
    expect(FRONT_SRC).toContain("_cinemaEl = cinemaRoot.querySelector('.fgpx-weather-cinema');");
  });

  test('weathergrade ground profile is current-anchored and not a static triangle', () => {
    expect(FRONT_SRC).toContain('var bikeX = 200;');
    expect(FRONT_SRC).toContain('for (var gx = 0; gx <= 400; gx += 25) {');
    expect(FRONT_SRC).toContain("var shapeHeight = (envelope * maxPeak) + elevAdj + (rel * 1.6 * tilt);");
    expect(FRONT_SRC).toContain('shapeHeight = Math.max(0, Math.min(baseY, shapeHeight));');
    expect(FRONT_SRC).not.toContain("gradePath.setAttribute('d', 'M0,40 L0,' + Math.round(left) + ' L200,20 L400,' + Math.round(right) + ' L400,40 Z');");
  });

  test('weathergrade bicycle icon is mirrored toward timeline direction', () => {
    expect(FRONT_SRC).toContain("bikeIcon.style.transform = 'scaleX(-1)';");
  });

  test('weathergrade bicycle bottom offset is dynamically aligned to terrain', () => {
    expect(FRONT_SRC).toContain('var bikeSurfaceY = baseY;');
    expect(FRONT_SRC).toContain('var bikeLift = Math.max(0, baseY - bikeSurfaceY);');
    expect(FRONT_SRC).toContain('var wheelContactCalibration = -2;');
    expect(FRONT_SRC).toContain('var cinemaFloorOffset = cinemaEl._floorOffsetPx;');
    expect(FRONT_SRC).toContain("bikeEl.style.bottom = String(Math.max(0, Math.round(cinemaFloorOffset + bikeLift + wheelContactCalibration))) + 'px';");
  });

  test('weathergrade bicycle rotation follows terrain tangent with clamp and smoothing', () => {
    expect(FRONT_SRC).toContain('var bikeSlopeDeg = 0;');
    expect(FRONT_SRC).toContain('bikeSlopeDeg = gradeAtNow * 0.85;');
    expect(FRONT_SRC).toContain('var targetBikeAngle = Math.max(-14, Math.min(14, bikeSlopeDeg));');
    expect(FRONT_SRC).toContain('var smoothedBikeAngle = (prevBikeAngle * 0.55) + (targetBikeAngle * 0.45);');
    expect(FRONT_SRC).toContain("bikeEl.style.transform = 'translateX(-50%) rotate(' + smoothedBikeAngle.toFixed(2) + 'deg)';");
  });

  test('setPlaying directly toggles weather cinema paused class', () => {
    expect(FRONT_SRC).toContain("var cinemaEl = cinemaRoot.querySelector('.fgpx-weather-cinema');");
    expect(FRONT_SRC).toContain("if (playing) cinemaEl.classList.remove('is-paused');");
    expect(FRONT_SRC).toContain("else cinemaEl.classList.add('is-paused');");
  });

  test('weathergrade seek and tab switch force immediate cinema refresh', () => {
    expect(FRONT_SRC).toContain('function updateWeatherCinema(cinemaEl, payloadData, currentTimeSec, isCurrentlyPlaying, forceUpdate)');
    expect(FRONT_SRC).toContain('if (!forceUpdate && now - lastUpdate < 100) return;');
    expect(FRONT_SRC).toContain("updateWeatherCinema(cinemaEl, payload, lastPlaybackSec || 0, playing || false, true);");
    expect(FRONT_SRC).toContain("updateWeatherCinema(seekCinemaEl, payload, lastPlaybackSec || 0, playing || false, true);");
  });

  test('weather cinema caches day/night ordering and memoizes expensive updates', () => {
    expect(FRONT_SRC).toContain('var dayNightPeriodsSorted = null;');
    expect(FRONT_SRC).toContain('dayNightPeriodsSorted = dayNightPeriods.slice().sort(function(a, b) { return a.timeOffset - b.timeOffset; });');
    expect(FRONT_SRC).toContain('var sortedPeriods = (dayNightPeriodsSorted && dayNightPeriodsSorted.length > 0) ? dayNightPeriodsSorted : dayNightPeriods;');
    expect(FRONT_SRC).toContain('var trLo = 0;');
    expect(FRONT_SRC).toContain('cinema._legendEls = {');
    expect(FRONT_SRC).toContain('function setStyleIfChanged(el, key, value) {');
    expect(FRONT_SRC).toContain('function setTextIfChanged(el, value) {');
    expect(FRONT_SRC).toContain('if (cinemaEl._nightCache && cinemaEl._nightCache.key === nightCacheKey) {');
    expect(FRONT_SRC).toContain('cinemaEl._nightCache = { key: nightCacheKey, value: night };');
  });

  test('RAF loop uses single-scheduling guard to prevent duplicate animation loops', () => {
    expect(FRONT_SRC).toContain('var rafId = null;');
    expect(FRONT_SRC).toContain('function scheduleRaf() {');
    expect(FRONT_SRC).toContain('if (!rafId) {');
    expect(FRONT_SRC).toContain('rafId = window.requestAnimationFrame(raf);');
    expect(FRONT_SRC).toContain('rafId = null;');
    // No naked requestAnimationFrame(raf) outside scheduleRaf
    const rafCalls = (FRONT_SRC.match(/window\.requestAnimationFrame\(raf\)/g) || []).length;
    expect(rafCalls).toBe(1); // only inside scheduleRaf itself
  });

  test('progressive route geometry updates are throttled to ~12fps', () => {
    expect(FRONT_SRC).toContain('var progressLineCooldown = 0;');
    expect(FRONT_SRC).toContain('progressLineCooldown >= 0.083');
    expect(FRONT_SRC).not.toContain('window.__fgpxLineCooldown >= 0.025');
  });

  test('day-night and progressive route state are scoped per player instance', () => {
    expect(FRONT_SRC).toContain('var dayNightOverlayState = null;');
    expect(FRONT_SRC).toContain('var progressSegments = [];');
    expect(FRONT_SRC).not.toContain('window.__fgpxLastDayNightState');
    expect(FRONT_SRC).not.toContain('window.__fgpxProgressSegments');
  });

  test('chart no-data rendering and reset cleanup stay within the current player root', () => {
    expect(FRONT_SRC).toContain("var chartWrap = root.querySelector('.fgpx-chart-wrap');");
    expect(FRONT_SRC).toContain('function cleanupProgressiveSegments() {');
    expect(FRONT_SRC).toContain('cleanupProgressiveSegments();');
  });

  test('weather cinema element is cached on container to avoid per-RAF querySelector', () => {
    expect(FRONT_SRC).toContain('cinemaRoot._cachedCinema');
  });

  test('phase3 overlay profile supports reduced detail while weather tab is playing', () => {
    expect(FRONT_SRC).toContain("var weatherOverlayPerfMode = String((window.FGPX && FGPX.weatherOverlayPerfMode) || 'full').toLowerCase();");
    expect(FRONT_SRC).toContain('var weatherHeatmapConsolidated = toBoolOption(window.FGPX && FGPX.weatherHeatmapConsolidated, false);');
    expect(FRONT_SRC).toContain("var windSatelliteLayersEnabled = weatherOverlayPerfMode !== 'performance';");
    expect(FRONT_SRC).toContain('var weatherTextLayersSupported = null;');
    expect(FRONT_SRC).toContain("var weatherOverlayProfileKey = '';");
    expect(FRONT_SRC).toContain('function applyWeatherOverlayProfile(force) {');
    expect(FRONT_SRC).toContain("var isReduced = (weatherOverlayPerfMode === 'performance') || (weatherOverlayPerfMode === 'auto' && playing && currentChartTab === 'weathergrade');");
    expect(FRONT_SRC).toContain("var profileKey = [baseWeatherVisibility, fullWeatherVisibility, tempBase, tempTextVisibility, windBase, windTextVisibility, circleWindVisibility].join('|');");
    expect(FRONT_SRC).toContain("if (!force && weatherOverlayReduced === isReduced && weatherOverlayProfileKey === profileKey) {");
    expect(FRONT_SRC).toContain('weatherOverlayProfileKey = profileKey;');
    expect(FRONT_SRC).toContain("if (weatherHeatmapConsolidated) {");
    expect(FRONT_SRC).toContain("setLayerVisibilityIfPresent('fgpx-weather-heatmap', baseWeatherVisibility);");
    expect(FRONT_SRC).toContain("setLayerVisibilityIfPresent('fgpx-weather-heatmap-rain', baseWeatherVisibility);");
    expect(FRONT_SRC).toContain("if (!weatherHeatmapConsolidated) {");
    expect(FRONT_SRC).toContain("setLayerVisibilityIfPresent('fgpx-weather-heatmap-snow', fullWeatherVisibility);");
    expect(FRONT_SRC).toContain('if (tempTextVisibility === \'visible\') {');
    expect(FRONT_SRC).toContain('ensureTemperatureTextLayer();');
    expect(FRONT_SRC).toContain('if (windTextVisibility === \'visible\') {');
    expect(FRONT_SRC).toContain('ensureWindTextLayer();');
  });

  test('phase3 skips wind satellite layer creation in performance mode', () => {
    expect(FRONT_SRC).toContain('if (windSatelliteLayersEnabled) {');
    expect(FRONT_SRC).toContain("DBG.log('Wind satellite layers skipped in performance mode');");
    expect(FRONT_SRC).toContain("DBG.log('Wind satellite layers deferred until needed');");
  });

  test('phase3 can build a consolidated weather heatmap layer behind feature flag', () => {
    expect(FRONT_SRC).toContain('if (weatherHeatmapConsolidated) {');
    expect(FRONT_SRC).toContain("id: 'fgpx-weather-heatmap'");
    expect(FRONT_SRC).toContain("DBG.log('Using consolidated weather heatmap layer (phase3)');");
  });

  test('phase3 overlay profile is re-applied on playback and tab transitions', () => {
    expect(FRONT_SRC).toContain('try { applyWeatherOverlayProfile(false); } catch (_) {}');
    expect(FRONT_SRC).toContain('currentChartTab = tabType;');
    expect(FRONT_SRC).toContain('try { applyWeatherOverlayProfile(true); } catch (_) {}');
  });

  test('phase3 defers temperature and wind text layer creation until needed', () => {
    expect(FRONT_SRC).toContain('function refreshWeatherTextLayerSupport(logResult) {');
    expect(FRONT_SRC).toContain('if (weatherTextLayersSupported === true) return true;');
    expect(FRONT_SRC).toContain('return weatherTextLayersSupported === true;');
    expect(FRONT_SRC).toContain('weatherTextLayersSupported = hasGlyphs;');
    expect(FRONT_SRC).toContain('function ensureTemperatureTextLayer() {');
    expect(FRONT_SRC).toContain('if (!refreshWeatherTextLayerSupport(false)) return;');
    expect(FRONT_SRC).toContain('if (map.getLayer(\'fgpx-temperature-text\')) return;');
    expect(FRONT_SRC).toContain('function ensureWindTextLayer() {');
    expect(FRONT_SRC).toContain('if (!refreshWeatherTextLayerSupport(false)) return;');
    expect(FRONT_SRC).toContain('if (map.getLayer(\'fgpx-wind-text\')) return;');
    expect(FRONT_SRC).toContain("DBG.log('Temperature text layer deferred until needed');");
    expect(FRONT_SRC).toContain("DBG.log('Wind text layer deferred until needed');");
  });

  test('phase3 normalizes WP boolean-like option values safely', () => {
    expect(FRONT_SRC).toContain('function toBoolOption(value, fallback) {');
    expect(FRONT_SRC).toContain('var weatherEnabled = toBoolOption(window.FGPX && FGPX.weatherEnabled, false);');
    expect(FRONT_SRC).toContain('var debugWeatherDataEnabled = toBoolOption(window.FGPX && FGPX.debugWeatherData, false);');
    expect(FRONT_SRC).toContain('var effectiveWeatherEnabled = weatherEnabled || debugWeatherDataEnabled;');
    expect(FRONT_SRC).toContain('var weatherVisible = toBoolOption(window.FGPX && FGPX.weatherVisibleByDefault, false);');
  });

  test('simulation tab and photo marker live in the weather cinema instead of the map overlay', () => {
    expect(FRONT_SRC).toContain("tabWeatherGrade.textContent = (I18N.simulationTab || 'Simulation');");
    expect(FRONT_SRC).toContain("photoMarker.className = 'fgpx-weather-photo-marker';");
    expect(FRONT_SRC).toContain("photoMarkerLabel.className = 'fgpx-weather-photo-marker-label';");
    expect(FRONT_SRC).not.toContain('overlay.appendChild(overlayRuler);');
  });

  test('phase3 lazily creates wind satellite layers only when full-detail visibility is needed', () => {
    expect(FRONT_SRC).toContain('function ensureWindSatelliteLayers() {');
    expect(FRONT_SRC).toContain('if (windCircleLayerIds.length > 0) return;');
    expect(FRONT_SRC).toContain('if (circleWindVisibility === \'visible\') {');
    expect(FRONT_SRC).toContain('ensureWindSatelliteLayers();');
    expect(FRONT_SRC).toContain("DBG.log('Wind satellite layers created lazily', { count: windCircleLayerIds.length });");
  });

  test('simulation city precompute uses fast nearest-index helper and geodesic distance cutoff', () => {
    expect(FRONT_SRC).toContain('function nearestCoordIndexFast(pointLonLat, coords) {');
    expect(FRONT_SRC).toContain('var nearestIdx = nearestCoordIndexFast([featLon, featLat], coords);');
    expect(FRONT_SRC).toContain('var trackDistanceMeters = haversineMeters([nearestCoord[0], nearestCoord[1]], [featLon, featLat]);');
    expect(FRONT_SRC).toContain('if (!isFinite(trackDistanceMeters) || trackDistanceMeters > 2000) { skippedType++; continue; }');
  });

  test('simulation city layer cache is invalidated on style data events', () => {
    expect(FRONT_SRC).toContain("map.on('styledata', function() {");
    expect(FRONT_SRC).toContain('_placeLayers = null;');
    expect(FRONT_SRC).toContain('weatherTextLayersSupported = null;');
    expect(FRONT_SRC).toContain("weatherOverlayProfileKey = '';");
  });

  test('simulation shows no-waypoints note when track has none', () => {
    expect(FRONT_SRC).toContain("poiEmptyEl2.className = 'fgpx-weather-poi-empty';");
    expect(FRONT_SRC).toContain("poiEmptyEl2.textContent = 'No GPX waypoints in this track';");
  });

  test('simulation runtime no longer ships the temporary debug weather path', () => {
    expect(FRONT_SRC).not.toContain('debugWeatherSimEnabled');
    expect(FRONT_SRC).not.toContain('DEBUG SIMULATION');
    expect(FRONT_SRC).not.toContain('cinemaEl._debugWeatherSim');
  });
});
