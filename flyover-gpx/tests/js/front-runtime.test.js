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

const FRONT_CSS_SRC = fs.readFileSync(
  path.resolve(__dirname, '../../assets/css/front.css'),
  'utf8'
);

function loadFront() {
  // eslint-disable-next-line no-eval
  eval(FRONT_SRC);
}

function flushAsync() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function openMediaTab(rootSelector = '#fgpx-app') {
  const root = document.querySelector(rootSelector);
  expect(root).toBeTruthy();

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const container = root.querySelector('.fgpx-container');
    const switchTab = (container && container.__fgpxSwitchChartTab) || root.__fgpxSwitchChartTab;
    if (typeof switchTab === 'function') {
      switchTab('media');
      await flushAsync();
      return;
    }
    await flushAsync();
  }

  const tabs = Array.from(document.querySelectorAll(rootSelector + ' .fgpx-chart-tab'));
  const mediaTab = tabs.find((btn) => String(btn.textContent || '').toLowerCase().indexOf('media') >= 0);
  expect(mediaTab).toBeTruthy();
  mediaTab.click();
  await flushAsync();
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

function installMapLibreMock() {
  class MockMap {
    constructor() {
      this._sources = {};
      this._layers = {};
      this._layout = {};
      this._paint = {};
    }

    addControl() { return this; }
    fitBounds() { return this; }
    resize() { return this; }
    remove() { return this; }
    easeTo() { return this; }
    flyTo() { return this; }
    setCenter() { return this; }
    setZoom() { return this; }
    setPitch() { return this; }
    setTerrain() { return this; }
    hasImage() { return false; }
    addImage() { return this; }
    getCanvas() { return document.createElement('canvas'); }
    getZoom() { return 12; }
    getStyle() { return { layers: [], sources: {} }; }
    getBounds() {
      return {
        getSouthWest: () => ({ lng: 0, lat: 0 }),
        getNorthEast: () => ({ lng: 1, lat: 1 }),
      };
    }

    addSource(id, source) {
      this._sources[id] = Object.assign({}, source, {
        setData: jest.fn(),
      });
      return this;
    }

    getSource(id) {
      return this._sources[id] || null;
    }

    removeSource(id) {
      delete this._sources[id];
      return this;
    }

    addLayer(layer) {
      if (layer && layer.id) this._layers[layer.id] = layer;
      return this;
    }

    getLayer(id) {
      return this._layers[id] || null;
    }

    removeLayer(id) {
      delete this._layers[id];
      return this;
    }

    setLayoutProperty(id, key, value) {
      this._layout[id] = this._layout[id] || {};
      this._layout[id][key] = value;
      return this;
    }

    getLayoutProperty(id, key) {
      return this._layout[id] ? this._layout[id][key] : undefined;
    }

    setPaintProperty(id, key, value) {
      this._paint[id] = this._paint[id] || {};
      this._paint[id][key] = value;
      return this;
    }

    queryRenderedFeatures() { return []; }
    project(lngLat) { return { x: lngLat[0] || 0, y: lngLat[1] || 0 }; }
    unproject(point) { return { lng: point.x || 0, lat: point.y || 0 }; }

    on(event, cb) {
      if (event === 'load' || event === 'styledata' || event === 'idle' || event === 'moveend') {
        setTimeout(() => cb(), 0);
      }
      return this;
    }

    once(event, cb) {
      if (event === 'load' || event === 'styledata' || event === 'idle' || event === 'moveend') {
        setTimeout(() => cb(), 0);
      }
      return this;
    }
  }

  class MockMarker {
    constructor() { this._lngLat = null; }
    setLngLat(lngLat) { this._lngLat = lngLat; return this; }
    addTo() { return this; }
    remove() { return this; }
  }

  window.maplibregl = {
    Map: MockMap,
    Marker: MockMarker,
    NavigationControl: function NavigationControl() {},
    FullscreenControl: function FullscreenControl() {},
  };
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

  test('gallery can use AJAX-first mode when configured', async () => {
    document.body.innerHTML =
      '<div id="fgpx-app" class="fgpx" data-track-id="7"></div>';

    window.maplibregl = {};
    window.Chart = function ChartStub() {};

    const fetchMock = mockRejectedFetch('network down');

    window.FGPX = baseFGPX({
      ajaxUrl: 'http://example.com/wp-admin/admin-ajax.php',
      instances: {
        'fgpx-app': { galleryPhotoStrategy: 'latest_embed', galleryPreferAjaxFirst: true },
      },
    });

    loadFront();
    window.FGPX.boot();

    await flushAsync();

    const calledUrls = fetchMock.mock.calls.map((args) => String(args[0]));
    expect(calledUrls.length).toBe(2);
    expect(calledUrls[0]).toContain('admin-ajax.php');
    expect(calledUrls[0]).toContain('strategy=latest_embed');
    expect(calledUrls[1]).toContain('/wp-json/fgpx/v1/track/7?strategy=latest_embed');
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
    expect(FRONT_SRC).toContain("setAttrIfChanged(conditionIcons, 'title', ''); // Keep title empty to prevent native tooltip");
    expect(FRONT_SRC).toContain("setAttrIfChanged(conditionIcons, 'data-fgpx-tooltip', conditionTooltip);");
    expect(FRONT_SRC).toContain("setAttrIfChanged(celestial, 'title', ''); // Keep title empty to prevent native tooltip");
    expect(FRONT_SRC).toContain("setAttrIfChanged(celestial, 'data-fgpx-tooltip', celestialTooltip);");
  });

  test('chart tabs use instance-scoped switch handler (no global dependency)', () => {
    expect(FRONT_SRC).toContain('var switchChartTab = function(tabType) {');
    expect(FRONT_SRC).toContain("ui.tabs.tabElevation.addEventListener('click', function() { switchChartTab('elevation'); });");
    expect(FRONT_SRC).not.toContain("ui.tabs.tabElevation.addEventListener('click', function() { window.switchChartTab('elevation'); });");
  });

  test('media tab listener in startPlayer is guarded by FGPX.photosEnabled (not inverted)', () => {
    expect(FRONT_SRC).toContain("if (FGPX.photosEnabled) {");
    expect(FRONT_SRC).toContain("ui.tabs.tabMedia.addEventListener('click', function() { switchChartTab('media'); });");
    const guardedIdx = FRONT_SRC.indexOf("if (FGPX.photosEnabled) {");
    const listenerIdx = FRONT_SRC.indexOf("ui.tabs.tabMedia.addEventListener('click', function() { switchChartTab('media'); });");
    expect(listenerIdx).toBeGreaterThan(guardedIdx);
    expect(FRONT_SRC).not.toContain("if (!FGPX.photosEnabled) {\n        ui.tabs.tabMedia.addEventListener");
  });

  test('media tab and gallery rendering hooks are present', () => {
    expect(FRONT_SRC).toContain("tabMedia = createEl('button', 'fgpx-chart-tab');");
    expect(FRONT_SRC).toContain("tabMedia.textContent = 'Media';");
    expect(FRONT_SRC).toContain('var mediaPanel = createEl(\'div\', \'fgpx-media-panel\');');
    expect(FRONT_SRC).toContain('function buildMediaItems() {');
    expect(FRONT_SRC).toContain('function renderMediaGrid() {');
    expect(FRONT_SRC).toContain('mediaItems = trackLinked.concat(offTrack);');
  });

  test('overlay has close button and no prev/next nav', () => {
    expect(FRONT_SRC).toContain("overlayClose.className = 'fgpx-photo-overlay-close';");
    expect(FRONT_SRC).toContain('function updateOverlayViewerControls() {');
    expect(FRONT_SRC).not.toContain("overlayPrev.className = 'fgpx-photo-overlay-nav fgpx-photo-overlay-prev';");
    expect(FRONT_SRC).not.toContain("overlayNext.className = 'fgpx-photo-overlay-nav fgpx-photo-overlay-next';");
    expect(FRONT_SRC).toContain('openMediaViewerAt(mediaViewerIndex + 1);');
    expect(FRONT_SRC).toContain('openMediaViewerAt(mediaViewerIndex - 1);');
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
    expect(FRONT_SRC).toContain('var wheelContactCalibration = -4;');
    expect(FRONT_SRC).toContain('var cinemaFloorOffset = cinemaEl._floorOffsetPx;');
    expect(FRONT_SRC).toContain("bikeEl.style.bottom = String(Math.max(0, Math.round(cinemaFloorOffset + bikeLift + wheelContactCalibration))) + 'px';");
  });

  test('weathergrade bicycle rotation follows terrain tangent with clamp and smoothing', () => {
    expect(FRONT_SRC).toContain('var bikeSlopeDeg = 0;');
    expect(FRONT_SRC).toContain('bikeSlopeDeg = Math.atan2(pRight.yRaw - pLeft.yRaw, tangentDx) * 180 / Math.PI;');
    expect(FRONT_SRC).toContain('var targetBikeAngle = Math.max(-14, Math.min(14, bikeSlopeDeg));');
    expect(FRONT_SRC).toContain('var smoothedBikeAngle = (prevBikeAngle * 0.82) + (targetBikeAngle * 0.18);');
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

  test('map mode control degrades safely when API placeholders are unresolved', () => {
    expect(FRONT_SRC).toContain('function resolveTemplateUrl(url) {');
    expect(FRONT_SRC).toContain("if (raw.indexOf('{{API_KEY}}') !== -1) {");
    expect(FRONT_SRC).toContain("if (!resolvedApiKey) return '';" );
    expect(FRONT_SRC).toContain('var resolvedContoursTilesUrl = resolveTemplateUrl(contoursTilesUrl);');
    expect(FRONT_SRC).toContain('var resolvedSatelliteTilesUrl = resolveTemplateUrl(satelliteTilesUrl);');
    expect(FRONT_SRC).toContain("var contoursModeAvailable = contoursEnabled && resolvedContoursTilesUrl !== '';" );
  });

  test('map mode control is hidden when only basic mode is available', () => {
    expect(FRONT_SRC).toContain('function shouldShowMapModeControl() {');
    expect(FRONT_SRC).toContain('return contoursModeAvailable || !!resolvedSatelliteTilesUrl || hasSatelliteLayer();');
    expect(FRONT_SRC).toContain('function syncMapModeControl() {');
    expect(FRONT_SRC).toContain('if (!shouldShowMapModeControl()) {');
    expect(FRONT_SRC).toContain("if (selectorMode !== 'basic') {");
  });

  test('map mode control uses configurable contour source-layer and localized labels', () => {
    expect(FRONT_SRC).toContain("var contoursSourceLayer = String((window.FGPX && FGPX.contoursSourceLayer) || 'contour').trim();");
    expect(FRONT_SRC).toContain("'source-layer': contoursSourceLayer,");
    expect(FRONT_SRC).toContain("var i18nMapMode = (window.FGPX && FGPX.i18n) ? FGPX.i18n : {};");
    expect(FRONT_SRC).toContain("select.setAttribute('aria-label', i18nMapMode.mapModeLabel || 'Map mode');");
    expect(FRONT_SRC).toContain("addOption('basic', i18nMapMode.mapModeBasic || 'Basic');");
    expect(FRONT_SRC).toContain("addOption('basic_contours', i18nMapMode.mapModeContours || 'Basic + Contours');");
    expect(FRONT_SRC).toContain("addOption('satellite', i18nMapMode.mapModeSatellite || 'Satellite');");
  });

  test('satellite mode uses configurable style layer id before fallback layer', () => {
    expect(FRONT_SRC).toContain("var satelliteLayerId = String((window.FGPX && FGPX.satelliteLayerId) || 'satellite').trim();");
    expect(FRONT_SRC).toContain('return !!map.getLayer(satelliteLayerId);');
    expect(FRONT_SRC).toContain("setLayerVisibilityIfPresent(satelliteLayerId, nextMode === 'satellite' ? 'visible' : 'none');");
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

  // Media tab memoization & functional tests
  test('media grid memoization: cache invalidation on photo data change', () => {
    expect(FRONT_SRC).toContain('var mediaGridRendered = false;');
    expect(FRONT_SRC).toContain('var cachedMediaGridDOM = null;');
    expect(FRONT_SRC).toContain('function invalidateMediaGridCache(preservePage) {');
    expect(FRONT_SRC).toContain('mediaGridRendered = false;');
    expect(FRONT_SRC).toContain('cachedMediaGridDOM = null;');
    expect(FRONT_SRC).toContain('invalidateMediaGridCache(true);');
  });

  test('media grid rendering: memoizes DOM after first render', () => {
    expect(FRONT_SRC).toContain('var allowMediaGridCache = !photoQueueRotationEnabled;');
    expect(FRONT_SRC).toContain('if (allowMediaGridCache && mediaGridRendered && cachedMediaGridDOM !== null && cachedMediaGridPage === mediaGridPage) {');
    expect(FRONT_SRC).toContain('ui.mediaPanel.appendChild(cachedMediaGridDOM.cloneNode(true));');
    expect(FRONT_SRC).toContain('var clonedCards = ui.mediaPanel.querySelectorAll(\'.fgpx-media-card\');');
    expect(FRONT_SRC).toContain('cachedMediaGridPage = mediaGridPage;');
    expect(FRONT_SRC).toContain('mediaGridRendered = true;');
    expect(FRONT_SRC).not.toContain('cachedMediaGridDOM = ui.mediaPanel.cloneNode(true);');
    expect(FRONT_SRC).toContain('document.createDocumentFragment();');
    expect(FRONT_SRC).toContain('Array.prototype.forEach.call(ui.mediaPanel.childNodes, function(cn) { frag.appendChild(cn.cloneNode(true)); });');
    expect(FRONT_SRC).toContain('cachedMediaGridDOM = frag;');
  });

  test('media grid cache stores DocumentFragment of children to prevent nested panel on cache restore', () => {
    expect(FRONT_SRC).not.toContain('cachedMediaGridDOM = ui.mediaPanel.cloneNode(true);');
    const fragCount = (FRONT_SRC.match(/document\.createDocumentFragment\(\)/g) || []).length;
    expect(fragCount).toBeGreaterThanOrEqual(2);
    expect(FRONT_SRC).toContain('Array.prototype.forEach.call(ui.mediaPanel.childNodes, function(cn) { frag.appendChild(cn.cloneNode(true)); });');
    expect(FRONT_SRC).toContain('Array.prototype.forEach.call(ui.mediaPanel.childNodes, function(cn) { fragEmpty.appendChild(cn.cloneNode(true)); });');
  });

  test('media queue rotation recomputes displayed order from playback state', () => {
    expect(FRONT_SRC).toContain("var photoQueueRotationEnabled = !!(FGPX && (FGPX.photoQueueRotationEnabled === true || FGPX.photoQueueRotationEnabled === '1'));");
    expect(FRONT_SRC).toContain('function buildRotatedMediaItems() {');
    expect(FRONT_SRC).toContain('function syncMediaDisplayOrder(force) {');
    expect(FRONT_SRC).toContain('var mediaDisplayItems = [];');
    expect(FRONT_SRC).toContain('syncMediaDisplayOrder(false);');
    expect(FRONT_SRC).toContain('syncMediaDisplayOrder(true);');
    expect(FRONT_SRC).toContain('tOffset = timeOffsets[Math.max(0, lo2s)] || 0;');
  });

  test('media queue rotation preserves current page during runtime reorder', () => {
    expect(FRONT_SRC).toContain('invalidateMediaGridCache(true);');
    expect(FRONT_SRC).toContain('if (!preservePage) {');
    expect(FRONT_SRC).toContain('if (mediaGridPage >= totalPages) mediaGridPage = totalPages - 1;');
  });

  test('media queue rotation styles define exit and handoff states', () => {
    expect(FRONT_CSS_SRC).toContain('.fgpx .fgpx-media-card.fgpx-media-card-exiting {');
    expect(FRONT_CSS_SRC).toContain('@keyframes fgpx-media-card-exit {');
    expect(FRONT_CSS_SRC).toContain('.fgpx .fgpx-media-card.fgpx-media-card-entering {');
    expect(FRONT_CSS_SRC).toContain('.fgpx .fgpx-media-card.fgpx-media-card-tail-entering {');
  });

  test('media grid empty state: renders with semantic role and ARIA label', () => {
    expect(FRONT_SRC).toContain('.setAttribute(\'role\', \'status\');');
    expect(FRONT_SRC).toContain('.setAttribute(\'aria-label\', \'Media gallery empty\');');
    expect(FRONT_SRC).toContain('empty.className = \'fgpx-media-empty\';');
    expect(FRONT_SRC).toContain('No photos available for this track.');
  });

  test('media grid card ordering: GPS-linked photos before off-track', () => {
    expect(FRONT_SRC).toContain('var trackLinked = [];');
    expect(FRONT_SRC).toContain('var offTrack = [];');
    expect(FRONT_SRC).toContain('if (item.isGpsLinked) trackLinked.push(item);');
    expect(FRONT_SRC).toContain('else offTrack.push(item);');
    expect(FRONT_SRC).toContain('mediaItems = trackLinked.concat(offTrack);');
  });

  test('photo ordering mode: supports geo_first and time_first', () => {
    expect(FRONT_SRC).toContain("var photoOrderMode = (window.FGPX && typeof FGPX.photoOrderMode === 'string') ? String(FGPX.photoOrderMode) : 'geo_first';");
    expect(FRONT_SRC).toContain("if (photoOrderMode !== 'time_first' && photoOrderMode !== 'geo_first') { photoOrderMode = 'geo_first'; }");
    expect(FRONT_SRC).toContain("if (photoOrderMode === 'time_first') {");
  });

  test('photo ordering mode: time_first sorts by timestamp and falls back by id', () => {
    expect(FRONT_SRC).toContain('var ta = (typeof a._timestampMs === \'number\' && isFinite(a._timestampMs)) ? a._timestampMs : Infinity;');
    expect(FRONT_SRC).toContain('if (ta !== tb) return ta - tb;');
    expect(FRONT_SRC).toContain('var ida = (typeof a.id === \'number\') ? a.id : Infinity;');
    expect(FRONT_SRC).toContain('return ida - idb;');
  });

  test('media grid ordering mode: time_first preserves prepared photo sequence', () => {
    expect(FRONT_SRC).toContain("mediaItems = (photoOrderMode === 'time_first')");
    expect(FRONT_SRC).toContain(': trackLinked.concat(offTrack);');
  });

  test('media card accessibility: aria-labels are 1-based indices', () => {
    // Cards should say "Open photo 1", "Open photo 2", not "0" or "1"
    expect(FRONT_SRC).toContain('\'Open photo \' + String(index + 1)');
    expect(FRONT_SRC).not.toContain('\'Open photo \' + String(index)');
  });

  test('media card image: includes alt text fallback to title', () => {
    expect(FRONT_SRC).toContain('img.alt = item.title || \'Photo\';');
  });

  test('media card click handler: invokes openMediaViewerAt with correct index', () => {
    expect(FRONT_SRC).toContain('card.addEventListener(\'click\', function() {');
    expect(FRONT_SRC).toContain('openMediaViewerAt(index);');
  });

  test('media grid metadata display: shows route distance and timestamp when available', () => {
    expect(FRONT_SRC).toContain('if (item.routeKm) {');
    expect(FRONT_SRC).toContain('km.textContent = item.routeKm;');
    expect(FRONT_SRC).toContain('if (item.timeLabel) {');
    expect(FRONT_SRC).toContain('time.textContent = item.timeLabel;');
  });

  test('media grid rebuilds on cloned nodes: re-attaches click listeners', () => {
    expect(FRONT_SRC).toContain('for (var ci = 0; ci < clonedCards.length; ci++) {');
    expect(FRONT_SRC).toContain('clonedCards[idx].addEventListener(\'click\', function() {');
    expect(FRONT_SRC).toContain('openMediaViewerAt(startIdx + idx);');
  });

  test('media grid applies strict privacy window filter for derivable photos only', () => {
    expect(FRONT_SRC).toContain('if (privacyEnabled) {');
    expect(FRONT_SRC).toContain('if (routeDistMeters == null) { continue; }');
    expect(FRONT_SRC).toContain('if (routeDistMeters < privacyStartD || routeDistMeters > privacyEndD) { continue; }');
  });

  test('media grid pagination: divides items into configured page size', () => {
    expect(FRONT_SRC).toContain('var mediaGridPageSize = Math.max(4, Math.min(48, Number(window.FGPX && window.FGPX.galleryPerPage) || 16));');
    expect(FRONT_SRC).toContain('var mediaGridPage = 0;');
    expect(FRONT_SRC).toContain('var totalPages = Math.ceil(totalItems / mediaGridPageSize);');
    expect(FRONT_SRC).toContain('var startIdx = mediaGridPage * mediaGridPageSize;');
  });

  test('media grid pagination: shows prev/next buttons and page info', () => {
    expect(FRONT_SRC).toContain('pagination.className = \'fgpx-media-pagination\';');
    expect(FRONT_SRC).toContain('prevBtn.className = \'fgpx-media-page-prev\';');
    expect(FRONT_SRC).toContain('nextBtn.className = \'fgpx-media-page-next\';');
    expect(FRONT_SRC).toContain('pageInfo.textContent = \'Page \' + (mediaGridPage + 1) + \' of \' + totalPages;');
  });

  test('media grid pagination: disables prev button on first page', () => {
    expect(FRONT_SRC).toContain('prevBtn.disabled = (mediaGridPage === 0);');
  });

  test('media grid pagination: disables next button on last page', () => {
    expect(FRONT_SRC).toContain('nextBtn.disabled = (mediaGridPage >= totalPages - 1);');
  });

  test('media tab hidden when photosEnabled is false', () => {
    expect(FRONT_SRC).toContain('if (FGPX.photosEnabled) {');
    expect(FRONT_SRC).toContain('chartTabs.appendChild(tabMedia);');
  });

  test('route arrows: spacing uses named heuristic with bounded percent denominator', () => {
    expect(FRONT_SRC).toContain('var arrowSpacingReferencePx = 550;');
    expect(FRONT_SRC).toContain('var arrowSpacingPx = Math.round(arrowSpacingReferencePx / Math.max(arrowRepeatPct, 0.01));');
    expect(FRONT_SRC).toContain('if (arrowSpacingPx < 30) { arrowSpacingPx = 30; }');
    expect(FRONT_SRC).toContain('if (arrowSpacingPx > 300) { arrowSpacingPx = 300; }');
  });

  test('route arrows: derives stroke color from theme mode and validates canvas context', () => {
    expect(FRONT_SRC).toContain("var themeMode = (window.FGPX && typeof FGPX.themeMode === 'string') ? String(FGPX.themeMode) : 'system';");
    expect(FRONT_SRC).toContain("var arrowStrokeColor = (themeMode === 'bright') ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.85)';");
    expect(FRONT_SRC).toContain("if (!actx) { throw new Error('Route arrow canvas context unavailable'); }");
    expect(FRONT_SRC).toContain('actx.strokeStyle = arrowStrokeColor;');
  });

  test('route arrows: logs warning instead of failing silently', () => {
    expect(FRONT_SRC).toContain("} catch(e) { DBG.warn('Route arrow rendering skipped', e); }");
  });

  test('instance config is preserved into startPlayer media rendering', async () => {
    document.body.innerHTML = '<div id="fgpx-app" class="fgpx" data-track-id="1"></div>';
    installMapLibreMock();
    window.Chart = function ChartStub() { return { destroy: jest.fn(), update: jest.fn(), resize: jest.fn() }; };

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        geojson: {
          coordinates: [[16, 48, 100], [16.04, 48.04, 110]],
          properties: {
            timestamps: ['2026-01-01T00:00:00Z', '2026-01-01T00:10:00Z'],
            cumulativeDistance: [0, 4000],
            heartRates: [],
            cadences: [],
            temperatures: [],
            powers: [],
            windSpeeds: [],
            windDirections: [],
            windImpacts: [],
          },
        },
        bounds: [16, 48, 16.04, 48.04],
        stats: {},
        photos: [
          {
            id: 1,
            title: 'Gallery-only photo',
            lat: 48,
            lon: 16,
            timestamp: '2026-01-01T00:00:10Z',
            thumbUrl: 'https://example.test/start-thumb.jpg',
            fullUrl: 'https://example.test/start.jpg',
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    window.fetch = fetchMock;

    window.FGPX = baseFGPX({
      ajaxUrl: null,
      photosEnabled: false,
      weatherEnabled: false,
      instances: {
        'fgpx-app': {
          photosEnabled: true,
        },
      },
    });

    loadFront();
    window.FGPX.boot();

    await flushAsync();
    await flushAsync();
    await flushAsync();

    await openMediaTab('#fgpx-app');

    const panelText = String(document.querySelector('#fgpx-app .fgpx-media-panel')?.textContent || '');
    expect(panelText).toContain('Gallery-only photo');
  });

  test('runtime privacy mode hides media items without derivable route distance', async () => {
    document.body.innerHTML = '<div id="fgpx-app" class="fgpx" data-track-id="1"></div>';
    installMapLibreMock();
    window.Chart = function ChartStub() { return { destroy: jest.fn(), update: jest.fn(), resize: jest.fn() }; };

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        geojson: {
          coordinates: [[16, 48, 100], [16.04, 48.04, 110]],
          properties: {
            timestamps: ['2026-01-01T00:00:00Z', '2026-01-01T00:10:00Z'],
            cumulativeDistance: [0, 4000],
            heartRates: [],
            cadences: [],
            temperatures: [],
            powers: [],
            windSpeeds: [],
            windDirections: [],
            windImpacts: [],
          },
        },
        bounds: [16, 48, 16.04, 48.04],
        stats: {},
        photos: [
          {
            id: 1,
            title: 'Start photo',
            lat: 48,
            lon: 16,
            timestamp: '2026-01-01T00:00:10Z',
            thumbUrl: 'https://example.test/start-thumb.jpg',
            fullUrl: 'https://example.test/start.jpg',
          },
          {
            id: 2,
            title: 'Unknown offtrack',
            lat: null,
            lon: null,
            timestamp: null,
            thumbUrl: 'https://example.test/offtrack-thumb.jpg',
            fullUrl: 'https://example.test/offtrack.jpg',
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    window.fetch = fetchMock;

    window.FGPX = baseFGPX({
      ajaxUrl: null,
      photosEnabled: true,
      photoOrderMode: 'geo_first',
      weatherEnabled: false,
      privacyEnabled: true,
      privacyKm: 1,
    });

    loadFront();
    window.FGPX.boot();

    await flushAsync();
    await flushAsync();
    await flushAsync();

    await openMediaTab('#fgpx-app');

    const panelText = String(document.querySelector('#fgpx-app .fgpx-media-panel')?.textContent || '');
    expect(panelText).not.toContain('Unknown offtrack');
  });
});
