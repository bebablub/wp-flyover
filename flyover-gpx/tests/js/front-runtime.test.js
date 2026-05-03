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
    expect(FRONT_SRC.includes("map.addLayer(segmentLayerConfig, 'fgpx-point-circle')")).toBe(true);
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

  test('can use AJAX-first mode when configured globally', async () => {
    document.body.innerHTML =
      '<div id="fgpx-app" class="fgpx" data-track-id="7"></div>';

    window.maplibregl = {};
    window.Chart = function ChartStub() {};

    const fetchMock = mockRejectedFetch('network down');

    window.FGPX = baseFGPX({
      ajaxUrl: 'http://example.com/wp-admin/admin-ajax.php',
      instances: {
        'fgpx-app': { galleryPhotoStrategy: 'latest_embed', preferAjaxFirst: true },
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
    expect(FRONT_SRC.includes("var strategy = hasGalleryStrategy ? 'latest_embed' : 'default';")).toBe(true);
    expect(FRONT_SRC.includes("return 'fgpx_cache_v3_' + trackId + '_hp_' + hostPost + '_s_' + simplify + '_t_' + target + '_st_' + strategy;")).toBe(true);
  });

  test('fetch pipeline uses timeout/abort helper with configurable timeout', () => {
    expect(FRONT_SRC.includes('var fetchTimeoutMs = Math.max(3000')).toBe(true);
    expect(FRONT_SRC.includes('function fetchJsonWithTimeout(url, options, label) {')).toBe(true);
    expect(FRONT_SRC.includes("if (err && err.name === 'AbortError') {")).toBe(true);
    expect(FRONT_SRC.includes("' timeout after '")).toBe(true);
    expect(FRONT_SRC.includes('return r.text().then(function(raw) {')).toBe(true);
    expect(FRONT_SRC.includes("payload && typeof payload.message === 'string'")).toBe(true);
  });

  test('initContainer guards UI updates when container is disconnected', () => {
    expect(FRONT_SRC.includes('function isContainerActive() {')).toBe(true);
    expect(FRONT_SRC.includes('if (!isContainerActive()) return;')).toBe(true);
  });

  test('animation scheduling guards detached roots and cancels RAF when paused', () => {
    expect(FRONT_SRC.includes('if (!playing && rafId) {')).toBe(true);
    expect(FRONT_SRC.includes('window.cancelAnimationFrame(rafId);')).toBe(true);
    expect(FRONT_SRC.includes('if (!document.contains(root)) return;')).toBe(true);
    expect(FRONT_SRC.includes('registerTeardown(function() { window.removeEventListener(\'keydown\', onPlayerKeydown); });')).toBe(true);
    expect(FRONT_SRC.includes('registerTeardown(function() { window.removeEventListener(\'keydown\', onOverlayKeydown); });')).toBe(true);
    expect(FRONT_SRC.includes('destroyRuntime();')).toBe(true);
    expect(FRONT_SRC.includes('if (!document.contains(root)) {')).toBe(true);
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
    expect(FRONT_SRC.includes('function createSessionIdSuffix(length)')).toBe(true);
    expect(FRONT_SRC.includes("this.sessionId = 'rec_' + Date.now() + '_' + createSessionIdSuffix(9);")).toBe(true);
    expect(FRONT_SRC.includes('cryptoObj.getRandomValues(bytes);')).toBe(true);
    expect(FRONT_SRC.includes("this.sessionId = 'rec_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);")).toBe(false);
  });

  test('weathergrade lookup supports backend time_unix with timestamp fallback', () => {
    expect(FRONT_SRC.includes('var tsEpoch = parseEpochSeconds(p.time_unix);')).toBe(true);
    expect(FRONT_SRC.includes('if (!isFinite(tsEpoch)) tsEpoch = parseEpochSeconds(p.timestamp);')).toBe(true);
  });

  test('weathergrade tab is guarded when weather data is unavailable', () => {
    expect(FRONT_SRC.includes("if (tabType === 'weathergrade' && !weatherGradeAvailable)")).toBe(true);
    expect(FRONT_SRC.includes("ui.tabs.tabWeatherGrade.style.display = 'none';")).toBe(true);
  });

  test('weathergrade uses snowfall signal for snow visuals', () => {
    expect(FRONT_SRC.includes('snowfall_cm: lerp(lp.snowfall_cm, hp.snowfall_cm),')).toBe(true);
    expect(FRONT_SRC.includes('var snowVal = Number(cond.snowfall_cm);')).toBe(true);
  });

  test('weather cinema throttling is scoped per instance', () => {
    expect(FRONT_SRC.includes('var lastUpdate = Number(cinemaEl._lastUpdate || 0);')).toBe(true);
    expect(FRONT_SRC.includes('cinemaEl._lastUpdate = now;')).toBe(true);
    expect(FRONT_SRC.includes('var _weatherCinemaLastUpdate = 0;')).toBe(false);
  });

  test('weather timestamp parser rejects implausible epoch ranges', () => {
    expect(FRONT_SRC.includes('if (numericEpoch > 0 && numericEpoch < 4102444800) return numericEpoch;')).toBe(true);
    expect(FRONT_SRC.includes('if (parsedEpoch > 0 && parsedEpoch < 4102444800) return parsedEpoch;')).toBe(true);
  });

  test('weather legend includes accessibility labels', () => {
    expect(FRONT_SRC.includes("legend.setAttribute('role', 'group');")).toBe(true);
    expect(FRONT_SRC.includes("span.setAttribute('aria-label', item.aria);")).toBe(true);
    expect(FRONT_SRC.includes("span.setAttribute('aria-live', 'polite');")).toBe(true);
  });

  test('weather cinema icon groups expose tooltips describing icon meaning', () => {
    expect(FRONT_SRC.includes("var i18n = (window.FGPX && FGPX.i18n) ? FGPX.i18n : {};")).toBe(true);
    expect(FRONT_SRC.includes("var dayTooltip = i18n.simCelestialDayAria || 'Daytime indicator (sun)';")).toBe(true);
    expect(FRONT_SRC.includes("var conditionIconsTooltip = i18n.simConditionIconsAria || 'Weather condition icons: fog, clouds, rain, snow, wind';")).toBe(true);
    expect(FRONT_SRC.includes("celestial.setAttribute('data-fgpx-tooltip', dayTooltip);")).toBe(true);
    expect(FRONT_SRC.includes("conditionIcons.setAttribute('data-fgpx-tooltip', conditionIconsTooltip);")).toBe(true);
    expect(FRONT_SRC.includes('bindWeatherFloatingTooltip(celestial);')).toBe(true);
    expect(FRONT_SRC.includes('bindWeatherFloatingTooltip(conditionIcons);')).toBe(true);
    expect(FRONT_SRC.includes("function showWeatherFloatingTooltip(targetEl, text, clientX, clientY)")).toBe(true);
    expect(FRONT_SRC.includes("activeConditionLabels.push(simI18N.simCondFog || 'Fog');")).toBe(true);
    expect(FRONT_SRC.includes("var activeIconsPrefix = simI18N.simConditionIconsActivePrefix || 'Active weather icons';")).toBe(true);
    expect(FRONT_SRC.includes("setAttrIfChanged(conditionIcons, 'title', ''); // Keep title empty to prevent native tooltip")).toBe(true);
    expect(FRONT_SRC.includes("setAttrIfChanged(conditionIcons, 'data-fgpx-tooltip', conditionTooltip);")).toBe(true);
    expect(FRONT_SRC.includes("setAttrIfChanged(celestial, 'title', ''); // Keep title empty to prevent native tooltip")).toBe(true);
    expect(FRONT_SRC.includes("setAttrIfChanged(celestial, 'data-fgpx-tooltip', celestialTooltip);")).toBe(true);
  });

  test('chart tabs use instance-scoped switch handler (no global dependency)', () => {
    expect(FRONT_SRC.includes('var switchChartTab = function(tabType) {')).toBe(true);
    expect(FRONT_SRC.includes("ui.tabs.tabElevation.addEventListener('click', function() { switchChartTab('elevation'); });")).toBe(true);
    expect(FRONT_SRC.includes("ui.tabs.tabElevation.addEventListener('click', function() { window.switchChartTab('elevation'); });")).toBe(false);
  });

  test('media tab listener in startPlayer is guarded by FGPX.photosEnabled (not inverted)', () => {
    expect(FRONT_SRC.includes("if (FGPX.photosEnabled) {")).toBe(true);
    expect(FRONT_SRC.includes("ui.tabs.tabMedia.addEventListener('click', function() { switchChartTab('media'); });")).toBe(true);
    const guardedIdx = FRONT_SRC.indexOf("if (FGPX.photosEnabled) {");
    const listenerIdx = FRONT_SRC.indexOf("ui.tabs.tabMedia.addEventListener('click', function() { switchChartTab('media'); });");
    expect(listenerIdx).toBeGreaterThan(guardedIdx);
    expect(FRONT_SRC.includes("if (!FGPX.photosEnabled) {\n        ui.tabs.tabMedia.addEventListener")).toBe(false);
  });

  test('media tab and gallery rendering hooks are present', () => {
    expect(FRONT_SRC.includes("tabMedia = createEl('button', 'fgpx-chart-tab');")).toBe(true);
    expect(FRONT_SRC.includes("tabMedia.textContent = 'Media';")).toBe(true);
    expect(FRONT_SRC.includes('var mediaPanel = createEl(\'div\', \'fgpx-media-panel\');')).toBe(true);
    expect(FRONT_SRC.includes('function buildMediaItems() {')).toBe(true);
    expect(FRONT_SRC.includes('function renderMediaGrid() {')).toBe(true);
    expect(FRONT_SRC.includes('mediaItems = trackLinked.concat(offTrack);')).toBe(true);
  });

  test('overlay has close button and no prev/next nav', () => {
    expect(FRONT_SRC.includes("overlayClose.className = 'fgpx-photo-overlay-close';")).toBe(true);
    expect(FRONT_SRC.includes('function updateOverlayViewerControls() {')).toBe(true);
    expect(FRONT_SRC.includes("overlayPrev.className = 'fgpx-photo-overlay-nav fgpx-photo-overlay-prev';")).toBe(false);
    expect(FRONT_SRC.includes("overlayNext.className = 'fgpx-photo-overlay-nav fgpx-photo-overlay-next';")).toBe(false);
    expect(FRONT_SRC.includes('openMediaViewerAt(mediaViewerIndex + 1);')).toBe(false);
    expect(FRONT_SRC.includes('openMediaViewerAt(mediaViewerIndex - 1);')).toBe(false);
  });

  test('weathergrade container is initialized at startPlayer scope and reused safely', () => {
    expect(FRONT_SRC.includes("var container = root.querySelector('.fgpx-container');")).toBe(true);
    expect(FRONT_SRC.includes('var cinemaRoot = container || root;')).toBe(true);
    expect(FRONT_SRC.includes("var cinemaEl = cinemaRoot.querySelector('.fgpx-weather-cinema');")).toBe(true);
    expect(FRONT_SRC.includes('var _cinemaEl = cinemaRoot._cachedCinema;')).toBe(true);
    expect(FRONT_SRC.includes("_cinemaEl = cinemaRoot.querySelector('.fgpx-weather-cinema');")).toBe(true);
  });

  test('weathergrade ground profile is current-anchored and not a static triangle', () => {
    expect(FRONT_SRC.includes('var bikeX = 200;')).toBe(true);
    expect(FRONT_SRC.includes('for (var gx = 0; gx <= 400; gx += 25) {')).toBe(true);
    expect(FRONT_SRC.includes("var shapeHeight = (envelope * maxPeak) + elevAdj + (rel * 1.6 * tilt);")).toBe(true);
    expect(FRONT_SRC.includes('shapeHeight = Math.max(0, Math.min(baseY, shapeHeight));')).toBe(true);
    expect(FRONT_SRC.includes("gradePath.setAttribute('d', 'M0,40 L0,' + Math.round(left) + ' L200,20 L400,' + Math.round(right) + ' L400,40 Z');")).toBe(false);
  });

  test('weathergrade bicycle icon is mirrored toward timeline direction', () => {
    expect(FRONT_SRC.includes("bikeIcon.style.transform = 'scaleX(-1)';")).toBe(true);
  });

  test('weathergrade bicycle bottom offset is dynamically aligned to terrain', () => {
    expect(FRONT_SRC.includes('var bikeSurfaceY = baseY;')).toBe(true);
    expect(FRONT_SRC.includes('var bikeLift = Math.max(0, baseY - bikeSurfaceY);')).toBe(true);
    expect(FRONT_SRC.includes('var wheelContactCalibration = -4;')).toBe(true);
    expect(FRONT_SRC.includes('var cinemaFloorOffset = cinemaEl._floorOffsetPx;')).toBe(true);
    expect(FRONT_SRC.includes("bikeEl.style.bottom = String(Math.max(0, Math.round(cinemaFloorOffset + bikeLift + wheelContactCalibration))) + 'px';")).toBe(true);
  });

  test('weathergrade bicycle rotation follows terrain tangent with clamp and smoothing', () => {
    expect(FRONT_SRC.includes('var bikeSlopeDeg = 0;')).toBe(true);
    expect(FRONT_SRC.includes('bikeSlopeDeg = Math.atan2(pRight.yRaw - pLeft.yRaw, tangentDx) * 180 / Math.PI;')).toBe(true);
    expect(FRONT_SRC.includes('var targetBikeAngle = Math.max(-14, Math.min(14, bikeSlopeDeg));')).toBe(true);
    expect(FRONT_SRC.includes('var smoothedBikeAngle = (prevBikeAngle * 0.82) + (targetBikeAngle * 0.18);')).toBe(true);
    expect(FRONT_SRC.includes("bikeEl.style.transform = 'translateX(-50%) rotate(' + smoothedBikeAngle.toFixed(2) + 'deg)';")).toBe(true);
  });

  test('setPlaying directly toggles weather cinema paused class', () => {
    expect(FRONT_SRC.includes("var cinemaEl = cinemaRoot.querySelector('.fgpx-weather-cinema');")).toBe(true);
    expect(FRONT_SRC.includes("if (playing) cinemaEl.classList.remove('is-paused');")).toBe(true);
    expect(FRONT_SRC.includes("else cinemaEl.classList.add('is-paused');")).toBe(true);
  });

  test('weathergrade seek and tab switch force immediate cinema refresh', () => {
    expect(FRONT_SRC.includes('function updateWeatherCinema(cinemaEl, payloadData, currentTimeSec, isCurrentlyPlaying, forceUpdate)')).toBe(true);
    expect(FRONT_SRC.includes('if (!forceUpdate && now - lastUpdate < 100) return;')).toBe(true);
    expect(FRONT_SRC.includes("updateWeatherCinema(cinemaEl, payload, lastPlaybackSec || 0, playing || false, true);")).toBe(true);
    expect(FRONT_SRC.includes("updateWeatherCinema(seekCinemaEl, payload, lastPlaybackSec || 0, playing || false, true);")).toBe(true);
  });

  test('weather cinema caches day/night ordering and memoizes expensive updates', () => {
    expect(FRONT_SRC.includes('var dayNightPeriodsSorted = null;')).toBe(true);
    expect(FRONT_SRC.includes('dayNightPeriodsSorted = dayNightPeriods.slice().sort(function(a, b) { return a.timeOffset - b.timeOffset; });')).toBe(true);
    expect(FRONT_SRC.includes('var sortedPeriods = (dayNightPeriodsSorted && dayNightPeriodsSorted.length > 0) ? dayNightPeriodsSorted : dayNightPeriods;')).toBe(true);
    expect(FRONT_SRC.includes('var trLo = 0;')).toBe(true);
    expect(FRONT_SRC.includes('cinema._legendEls = {')).toBe(true);
    expect(FRONT_SRC.includes('function setStyleIfChanged(el, key, value) {')).toBe(true);
    expect(FRONT_SRC.includes('function setTextIfChanged(el, value) {')).toBe(true);
    expect(FRONT_SRC.includes('if (cinemaEl._nightCache && cinemaEl._nightCache.key === nightCacheKey) {')).toBe(true);
    expect(FRONT_SRC.includes('cinemaEl._nightCache = { key: nightCacheKey, value: night };')).toBe(true);
  });

  test('RAF loop uses single-scheduling guard to prevent duplicate animation loops', () => {
    expect(FRONT_SRC.includes('var rafId = null;')).toBe(true);
    expect(FRONT_SRC.includes('function scheduleRaf() {')).toBe(true);
    expect(FRONT_SRC.includes('if (!rafId) {')).toBe(true);
    expect(FRONT_SRC.includes('rafId = window.requestAnimationFrame(raf);')).toBe(true);
    expect(FRONT_SRC.includes('rafId = null;')).toBe(true);
    // No naked requestAnimationFrame(raf) outside scheduleRaf
    const rafCalls = (FRONT_SRC.match(/window\.requestAnimationFrame\(raf\)/g) || []).length;
    expect(rafCalls).toBe(1); // only inside scheduleRaf itself
  });

  test('progressive route geometry updates are throttled to ~12fps', () => {
    expect(FRONT_SRC.includes('var progressLineCooldown = 0;')).toBe(true);
    expect(FRONT_SRC.includes('progressLineCooldown >= 0.083')).toBe(true);
    expect(FRONT_SRC.includes('window.__fgpxLineCooldown >= 0.025')).toBe(false);
  });

  test('day-night and progressive route state are scoped per player instance', () => {
    expect(FRONT_SRC.includes('var dayNightOverlayState = null;')).toBe(true);
    expect(FRONT_SRC.includes('var progressSegments = [];')).toBe(true);
    expect(FRONT_SRC.includes('window.__fgpxLastDayNightState')).toBe(false);
    expect(FRONT_SRC.includes('window.__fgpxProgressSegments')).toBe(false);
  });

  test('chart no-data rendering and reset cleanup stay within the current player root', () => {
    expect(FRONT_SRC.includes("var chartWrap = root.querySelector('.fgpx-chart-wrap');")).toBe(true);
    expect(FRONT_SRC.includes('function cleanupProgressiveSegments() {')).toBe(true);
    expect(FRONT_SRC.includes('cleanupProgressiveSegments();')).toBe(true);
  });

  test('weather cinema element is cached on container to avoid per-RAF querySelector', () => {
    expect(FRONT_SRC.includes('cinemaRoot._cachedCinema')).toBe(true);
  });

  test('phase3 overlay profile supports reduced detail while weather tab is playing', () => {
    expect(FRONT_SRC.includes("var weatherOverlayPerfMode = String((window.FGPX && FGPX.weatherOverlayPerfMode) || 'full').toLowerCase();")).toBe(true);
    expect(FRONT_SRC.includes('var weatherHeatmapConsolidated = toBoolOption(window.FGPX && FGPX.weatherHeatmapConsolidated, false);')).toBe(true);
    expect(FRONT_SRC.includes("var windSatelliteLayersEnabled = weatherOverlayPerfMode !== 'performance';")).toBe(true);
    expect(FRONT_SRC.includes('var weatherTextLayersSupported = null;')).toBe(true);
    expect(FRONT_SRC.includes("var weatherOverlayProfileKey = '';")).toBe(true);
    expect(FRONT_SRC.includes('function applyWeatherOverlayProfile(force) {')).toBe(true);
    expect(FRONT_SRC.includes("var isReduced = (weatherOverlayPerfMode === 'performance') || (weatherOverlayPerfMode === 'auto' && playing && currentChartTab === 'weathergrade');")).toBe(true);
    expect(FRONT_SRC.includes("var profileKey = [baseWeatherVisibility, fullWeatherVisibility, tempBase, tempTextVisibility, windBase, windTextVisibility, circleWindVisibility].join('|');")).toBe(true);
    expect(FRONT_SRC.includes("if (!force && weatherOverlayReduced === isReduced && weatherOverlayProfileKey === profileKey) {")).toBe(true);
    expect(FRONT_SRC.includes('weatherOverlayProfileKey = profileKey;')).toBe(true);
    expect(FRONT_SRC.includes("if (weatherHeatmapConsolidated) {")).toBe(true);
    expect(FRONT_SRC.includes("setLayerVisibilityIfPresent('fgpx-weather-heatmap', baseWeatherVisibility);")).toBe(true);
    expect(FRONT_SRC.includes("setLayerVisibilityIfPresent('fgpx-weather-heatmap-rain', baseWeatherVisibility);")).toBe(true);
    expect(FRONT_SRC.includes("if (!weatherHeatmapConsolidated) {")).toBe(true);
    expect(FRONT_SRC.includes("setLayerVisibilityIfPresent('fgpx-weather-heatmap-snow', fullWeatherVisibility);")).toBe(true);
    expect(FRONT_SRC.includes('if (tempTextVisibility === \'visible\') {')).toBe(true);
    expect(FRONT_SRC.includes('ensureTemperatureTextLayer();')).toBe(true);
    expect(FRONT_SRC.includes('if (windTextVisibility === \'visible\') {')).toBe(true);
    expect(FRONT_SRC.includes('ensureWindTextLayer();')).toBe(true);
  });

  test('phase3 skips wind satellite layer creation in performance mode', () => {
    expect(FRONT_SRC.includes('if (windSatelliteLayersEnabled) {')).toBe(true);
    expect(FRONT_SRC.includes("DBG.log('Wind satellite layers skipped in performance mode');")).toBe(true);
    expect(FRONT_SRC.includes("DBG.log('Wind satellite layers deferred until needed');")).toBe(true);
  });

  test('phase3 can build a consolidated weather heatmap layer behind feature flag', () => {
    expect(FRONT_SRC.includes('if (weatherHeatmapConsolidated) {')).toBe(true);
    expect(FRONT_SRC.includes("id: 'fgpx-weather-heatmap'")).toBe(true);
    expect(FRONT_SRC.includes("DBG.log('Using consolidated weather heatmap layer (phase3)');")).toBe(true);
  });

  test('phase3 overlay profile is re-applied on playback and tab transitions', () => {
    expect(FRONT_SRC.includes('try { applyWeatherOverlayProfile(false); } catch (_) {}')).toBe(true);
    expect(FRONT_SRC.includes('currentChartTab = tabType;')).toBe(true);
    expect(FRONT_SRC.includes('try { applyWeatherOverlayProfile(true); } catch (_) {}')).toBe(true);
  });

  test('phase3 defers temperature and wind text layer creation until needed', () => {
    expect(FRONT_SRC.includes('function refreshWeatherTextLayerSupport(logResult) {')).toBe(true);
    expect(FRONT_SRC.includes('if (weatherTextLayersSupported === true) return true;')).toBe(true);
    expect(FRONT_SRC.includes('return weatherTextLayersSupported === true;')).toBe(true);
    expect(FRONT_SRC.includes('weatherTextLayersSupported = hasGlyphs;')).toBe(true);
    expect(FRONT_SRC.includes('function ensureTemperatureTextLayer() {')).toBe(true);
    expect(FRONT_SRC.includes('if (!refreshWeatherTextLayerSupport(false)) return;')).toBe(true);
    expect(FRONT_SRC.includes('if (map.getLayer(\'fgpx-temperature-text\')) return;')).toBe(true);
    expect(FRONT_SRC.includes('function ensureWindTextLayer() {')).toBe(true);
    expect(FRONT_SRC.includes('if (!refreshWeatherTextLayerSupport(false)) return;')).toBe(true);
    expect(FRONT_SRC.includes('if (map.getLayer(\'fgpx-wind-text\')) return;')).toBe(true);
    expect(FRONT_SRC.includes("DBG.log('Temperature text layer deferred until needed');")).toBe(true);
    expect(FRONT_SRC.includes("DBG.log('Wind text layer deferred until needed');")).toBe(true);
  });

  test('map mode control degrades safely when API placeholders are unresolved', () => {
    expect(FRONT_SRC.includes('function resolveTemplateUrl(url) {')).toBe(true);
    expect(FRONT_SRC.includes("if (raw.indexOf('{{API_KEY}}') !== -1) {")).toBe(true);
    expect(FRONT_SRC.includes("if (!resolvedApiKey) return '';" )).toBe(true);
    expect(FRONT_SRC.includes('var resolvedContoursTilesUrl = resolveTemplateUrl(contoursTilesUrl);')).toBe(true);
    expect(FRONT_SRC.includes('var resolvedSatelliteTilesUrl = resolveTemplateUrl(satelliteTilesUrl);')).toBe(true);
    expect(FRONT_SRC.includes("var contoursModeAvailable = contoursEnabled && resolvedContoursTilesUrl !== '';" )).toBe(true);
  });

  test('map mode control is hidden when only basic mode is available', () => {
    expect(FRONT_SRC.includes('function shouldShowMapModeControl() {')).toBe(true);
    expect(FRONT_SRC.includes('return contoursModeAvailable || !!resolvedSatelliteTilesUrl || hasSatelliteLayer();')).toBe(true);
    expect(FRONT_SRC.includes('function syncMapModeControl() {')).toBe(true);
    expect(FRONT_SRC.includes('if (!shouldShowMapModeControl()) {')).toBe(true);
    expect(FRONT_SRC.includes("if (selectorMode !== 'satellite') {")).toBe(true);
  });

  test('map mode control uses configurable contour source-layer and localized labels', () => {
    expect(FRONT_SRC.includes("var contoursSourceLayer = String((window.FGPX && FGPX.contoursSourceLayer) || 'contour').trim();")).toBe(true);
    expect(FRONT_SRC.includes("'source-layer': contoursSourceLayer,")).toBe(true);
    expect(FRONT_SRC.includes("var i18nMapMode = (window.FGPX && FGPX.i18n) ? FGPX.i18n : {};")).toBe(true);
    expect(FRONT_SRC.includes("toggleBtn.setAttribute('aria-label', i18nMapMode.mapModeLabel || 'Toggle contours');")).toBe(true);
  });

  test('satellite mode uses configurable style layer id before fallback layer', () => {
    expect(FRONT_SRC.includes("var satelliteLayerId = String((window.FGPX && FGPX.satelliteLayerId) || 'satellite').trim();")).toBe(true);
    expect(FRONT_SRC.includes('return !!map.getLayer(satelliteLayerId);')).toBe(true);
    expect(FRONT_SRC.includes("setLayerVisibilityIfPresent(satelliteLayerId, showSat ? 'visible' : 'none');")).toBe(true);
  });

  test('phase3 normalizes WP boolean-like option values safely', () => {
    expect(FRONT_SRC.includes('function toBoolOption(value, fallback) {')).toBe(true);
    expect(FRONT_SRC.includes('var weatherEnabled = toBoolOption(window.FGPX && FGPX.weatherEnabled, false);')).toBe(true);
    expect(FRONT_SRC.includes('var debugWeatherDataEnabled = toBoolOption(window.FGPX && FGPX.debugWeatherData, false);')).toBe(true);
    expect(FRONT_SRC.includes('var effectiveWeatherEnabled = weatherEnabled || debugWeatherDataEnabled;')).toBe(true);
    expect(FRONT_SRC.includes('var weatherVisible = toBoolOption(window.FGPX && FGPX.weatherVisibleByDefault, false);')).toBe(true);
  });

  test('simulation tab and photo marker live in the weather cinema instead of the map overlay', () => {
    expect(FRONT_SRC.includes("tabWeatherGrade.textContent = (I18N.simulationTab || 'Simulation');")).toBe(true);
    expect(FRONT_SRC.includes("photoMarker.className = 'fgpx-weather-photo-marker';")).toBe(true);
    expect(FRONT_SRC.includes("photoMarkerLabel.className = 'fgpx-weather-photo-marker-label';")).toBe(true);
    expect(FRONT_SRC.includes('overlay.appendChild(overlayRuler);')).toBe(false);
  });

  test('phase3 lazily creates wind satellite layers only when full-detail visibility is needed', () => {
    expect(FRONT_SRC.includes('function ensureWindSatelliteLayers() {')).toBe(true);
    expect(FRONT_SRC.includes('if (windCircleLayerIds.length > 0) return;')).toBe(true);
    expect(FRONT_SRC.includes('if (circleWindVisibility === \'visible\') {')).toBe(true);
    expect(FRONT_SRC.includes('ensureWindSatelliteLayers();')).toBe(true);
    expect(FRONT_SRC.includes("DBG.log('Wind satellite layers created lazily', { count: windCircleLayerIds.length });")).toBe(true);
  });

  test('simulation city precompute uses fast nearest-index helper and geodesic distance cutoff', () => {
    expect(FRONT_SRC.includes('function nearestCoordIndexFast(pointLonLat, coords) {')).toBe(true);
    expect(FRONT_SRC.includes('var nearestIdx = nearestCoordIndexFast([featLon, featLat], coords);')).toBe(true);
    expect(FRONT_SRC.includes('var trackDistanceMeters = haversineMeters([nearestCoord[0], nearestCoord[1]], [featLon, featLat]);')).toBe(true);
    expect(FRONT_SRC.includes('if (!isFinite(trackDistanceMeters) || trackDistanceMeters > 2000) { skippedType++; continue; }')).toBe(true);
  });

  test('simulation city layer cache is invalidated on style data events', () => {
    expect(FRONT_SRC.includes("map.on('styledata', function() {")).toBe(true);
    expect(FRONT_SRC.includes('_placeLayers = null;')).toBe(true);
    expect(FRONT_SRC.includes('weatherTextLayersSupported = null;')).toBe(true);
    expect(FRONT_SRC.includes("weatherOverlayProfileKey = '';")).toBe(true);
  });

  test('simulation shows no-waypoints note when track has none', () => {
    expect(FRONT_SRC.includes("poiEmptyEl2.className = 'fgpx-weather-poi-empty';")).toBe(true);
    expect(FRONT_SRC.includes("poiEmptyEl2.textContent = 'No GPX waypoints in this track';")).toBe(true);
  });

  test('simulation runtime no longer ships the temporary debug weather path', () => {
    expect(FRONT_SRC.includes('debugWeatherSimEnabled')).toBe(false);
    expect(FRONT_SRC.includes('DEBUG SIMULATION')).toBe(false);
    expect(FRONT_SRC.includes('cinemaEl._debugWeatherSim')).toBe(false);
  });

  // Media tab memoization & functional tests
  test('media grid memoization: cache invalidation on photo data change', () => {
    expect(FRONT_SRC.includes('var mediaGridRendered = false;')).toBe(true);
    expect(FRONT_SRC.includes('var cachedMediaGridDOM = null;')).toBe(true);
    expect(FRONT_SRC.includes('function invalidateMediaGridCache(preservePage) {')).toBe(true);
    expect(FRONT_SRC.includes('mediaGridRendered = false;')).toBe(true);
    expect(FRONT_SRC.includes('cachedMediaGridDOM = null;')).toBe(true);
    expect(FRONT_SRC.includes('invalidateMediaGridCache(true);')).toBe(true);
  });

  test('media grid rendering: memoizes DOM after first render', () => {
    expect(FRONT_SRC.includes('var allowMediaGridCache = !photoQueueRotationEnabled;')).toBe(true);
    expect(FRONT_SRC.includes('if (allowMediaGridCache && mediaGridRendered && cachedMediaGridDOM !== null && cachedMediaGridPage === mediaGridPage) {')).toBe(true);
    expect(FRONT_SRC.includes('ui.mediaPanel.appendChild(cachedMediaGridDOM.cloneNode(true));')).toBe(true);
    expect(FRONT_SRC.includes('var clonedCards = ui.mediaPanel.querySelectorAll(\'.fgpx-media-card\');')).toBe(true);
    expect(FRONT_SRC.includes('cachedMediaGridPage = mediaGridPage;')).toBe(true);
    expect(FRONT_SRC.includes('mediaGridRendered = true;')).toBe(true);
    expect(FRONT_SRC.includes('cachedMediaGridDOM = ui.mediaPanel.cloneNode(true);')).toBe(false);
    expect(FRONT_SRC.includes('document.createDocumentFragment();')).toBe(true);
    expect(FRONT_SRC.includes('Array.prototype.forEach.call(ui.mediaPanel.childNodes, function(cn) { frag.appendChild(cn.cloneNode(true)); });')).toBe(true);
    expect(FRONT_SRC.includes('cachedMediaGridDOM = frag;')).toBe(true);
  });

  test('media grid cache stores DocumentFragment of children to prevent nested panel on cache restore', () => {
    expect(FRONT_SRC.includes('cachedMediaGridDOM = ui.mediaPanel.cloneNode(true);')).toBe(false);
    const fragCount = (FRONT_SRC.match(/document\.createDocumentFragment\(\)/g) || []).length;
    expect(fragCount).toBeGreaterThanOrEqual(2);
    expect(FRONT_SRC.includes('Array.prototype.forEach.call(ui.mediaPanel.childNodes, function(cn) { frag.appendChild(cn.cloneNode(true)); });')).toBe(true);
    expect(FRONT_SRC.includes('Array.prototype.forEach.call(ui.mediaPanel.childNodes, function(cn) { fragEmpty.appendChild(cn.cloneNode(true)); });')).toBe(true);
  });

  test('media queue rotation recomputes displayed order from playback state', () => {
    expect(FRONT_SRC.includes("var photoQueueRotationEnabled = !!(FGPX && (FGPX.photoQueueRotationEnabled === true || FGPX.photoQueueRotationEnabled === '1'));")).toBe(true);
    expect(FRONT_SRC.includes('function buildRotatedMediaItems() {')).toBe(true);
    expect(FRONT_SRC.includes('function syncMediaDisplayOrder(force) {')).toBe(true);
    expect(FRONT_SRC.includes('var mediaDisplayItems = [];')).toBe(true);
    expect(FRONT_SRC.includes('syncMediaDisplayOrder(false);')).toBe(true);
    expect(FRONT_SRC.includes('syncMediaDisplayOrder(true);')).toBe(true);
    expect(FRONT_SRC.includes('tOffset = timeOffsets[Math.max(0, lo2s)] || 0;')).toBe(true);
  });

  test('media queue rotation preserves current page during runtime reorder', () => {
    expect(FRONT_SRC.includes('invalidateMediaGridCache(true);')).toBe(true);
    expect(FRONT_SRC.includes('if (!preservePage) {')).toBe(true);
    expect(FRONT_SRC.includes('if (mediaGridPage >= totalPages) mediaGridPage = totalPages - 1;')).toBe(true);
  });

  test('media queue rotation styles define exit and handoff states', () => {
    expect(FRONT_CSS_SRC.includes('.fgpx .fgpx-media-card.fgpx-media-card-exiting {')).toBe(true);
    expect(FRONT_CSS_SRC.includes('@keyframes fgpx-media-card-exit {')).toBe(true);
    expect(FRONT_CSS_SRC.includes('.fgpx .fgpx-media-card.fgpx-media-card-entering {')).toBe(true);
    expect(FRONT_CSS_SRC.includes('.fgpx .fgpx-media-card.fgpx-media-card-tail-entering {')).toBe(true);
  });

  test('media grid empty state: renders with semantic role and ARIA label', () => {
    expect(FRONT_SRC.includes('.setAttribute(\'role\', \'status\');')).toBe(true);
    expect(FRONT_SRC.includes('.setAttribute(\'aria-label\', \'Media gallery empty\');')).toBe(true);
    expect(FRONT_SRC.includes('empty.className = \'fgpx-media-empty\';')).toBe(true);
    expect(FRONT_SRC.includes('No photos available for this track.')).toBe(true);
  });

  test('media grid card ordering: GPS-linked photos before off-track', () => {
    expect(FRONT_SRC.includes('var trackLinked = [];')).toBe(true);
    expect(FRONT_SRC.includes('var offTrack = [];')).toBe(true);
    expect(FRONT_SRC.includes('if (item.isGpsLinked) trackLinked.push(item);')).toBe(true);
    expect(FRONT_SRC.includes('else offTrack.push(item);')).toBe(true);
    expect(FRONT_SRC.includes('mediaItems = trackLinked.concat(offTrack);')).toBe(true);
  });

  test('photo ordering mode: supports geo_first and time_first', () => {
    expect(FRONT_SRC.includes("var photoOrderMode = (window.FGPX && typeof FGPX.photoOrderMode === 'string') ? String(FGPX.photoOrderMode) : 'geo_first';")).toBe(true);
    expect(FRONT_SRC.includes("if (photoOrderMode !== 'time_first' && photoOrderMode !== 'geo_first') { photoOrderMode = 'geo_first'; }")).toBe(true);
    expect(FRONT_SRC.includes("if (photoOrderMode === 'time_first') {")).toBe(true);
  });

  test('photo ordering mode: time_first sorts by timestamp and falls back by id', () => {
    expect(FRONT_SRC.includes('var ta = (typeof a._timestampMs === \'number\' && isFinite(a._timestampMs)) ? a._timestampMs : Infinity;')).toBe(true);
    expect(FRONT_SRC.includes('if (ta !== tb) return ta - tb;')).toBe(true);
    expect(FRONT_SRC.includes('var ida = (typeof a.id === \'number\') ? a.id : Infinity;')).toBe(true);
    expect(FRONT_SRC.includes('return ida - idb;')).toBe(true);
  });

  test('media grid ordering mode: time_first preserves prepared photo sequence', () => {
    expect(FRONT_SRC.includes("mediaItems = (photoOrderMode === 'time_first')")).toBe(true);
    expect(FRONT_SRC.includes(': trackLinked.concat(offTrack);')).toBe(true);
  });

  test('media card accessibility: aria-labels are 1-based indices', () => {
    // Cards should say "Open photo 1", "Open photo 2", not "0" or "1"
    expect(FRONT_SRC.includes('\'Open photo \' + String(index + 1)')).toBe(true);
    expect(FRONT_SRC.includes('\'Open photo \' + String(index)')).toBe(false);
  });

  test('media card image: includes alt text fallback to title', () => {
    expect(FRONT_SRC.includes('img.alt = item.title || \'Photo\';')).toBe(true);
  });

  test('media card click handler: invokes openMediaViewerAt with correct index', () => {
    expect(FRONT_SRC.includes('card.addEventListener(\'click\', function() {')).toBe(true);
    expect(FRONT_SRC.includes('openMediaViewerAt(index);')).toBe(true);
  });

  test('media grid metadata display: shows route distance and timestamp when available', () => {
    expect(FRONT_SRC.includes('if (item.routeKm) {')).toBe(true);
    expect(FRONT_SRC.includes('km.textContent = item.routeKm;')).toBe(true);
    expect(FRONT_SRC.includes('if (item.timeLabel) {')).toBe(true);
    expect(FRONT_SRC.includes('time.textContent = item.timeLabel;')).toBe(true);
  });

  test('media grid rebuilds on cloned nodes: re-attaches click listeners', () => {
    expect(FRONT_SRC.includes('for (var ci = 0; ci < clonedCards.length; ci++) {')).toBe(true);
    expect(FRONT_SRC.includes('clonedCards[idx].addEventListener(\'click\', function() {')).toBe(true);
    expect(FRONT_SRC.includes('openMediaViewerAt(startIdx + idx);')).toBe(true);
  });

  test('media grid applies strict privacy window filter for derivable photos only', () => {
    expect(FRONT_SRC.includes('if (privacyEnabled) {')).toBe(true);
    expect(FRONT_SRC.includes('if (routeDistMeters == null) { continue; }')).toBe(true);
    expect(FRONT_SRC.includes('if (routeDistMeters < privacyStartD || routeDistMeters > privacyEndD) { continue; }')).toBe(true);
  });

  test('media grid pagination: divides items into configured page size', () => {
    expect(FRONT_SRC.includes('var mediaGridPageSize = Math.max(4, Math.min(48, Number(window.FGPX && window.FGPX.galleryPerPage) || 16));')).toBe(true);
    expect(FRONT_SRC.includes('var mediaGridPage = 0;')).toBe(true);
    expect(FRONT_SRC.includes('var totalPages = Math.ceil(totalItems / mediaGridPageSize);')).toBe(true);
    expect(FRONT_SRC.includes('var startIdx = mediaGridPage * mediaGridPageSize;')).toBe(true);
  });

  test('media grid pagination: shows prev/next buttons and page info', () => {
    expect(FRONT_SRC.includes('pagination.className = \'fgpx-media-pagination\';')).toBe(true);
    expect(FRONT_SRC.includes('prevBtn.className = \'fgpx-media-page-prev\';')).toBe(true);
    expect(FRONT_SRC.includes('nextBtn.className = \'fgpx-media-page-next\';')).toBe(true);
    expect(FRONT_SRC.includes('pageInfo.textContent = \'Page \' + (mediaGridPage + 1) + \' of \' + totalPages;')).toBe(true);
  });

  test('media grid pagination: disables prev button on first page', () => {
    expect(FRONT_SRC.includes('prevBtn.disabled = (mediaGridPage === 0);')).toBe(true);
  });

  test('media grid pagination: disables next button on last page', () => {
    expect(FRONT_SRC.includes('nextBtn.disabled = (mediaGridPage >= totalPages - 1);')).toBe(true);
  });

  test('media tab hidden when photosEnabled is false', () => {
    expect(FRONT_SRC.includes('if (FGPX.photosEnabled) {')).toBe(true);
    expect(FRONT_SRC.includes('chartTabs.appendChild(tabMedia);')).toBe(true);
  });

  test('route arrows: spacing uses named heuristic with bounded percent denominator', () => {
    expect(FRONT_SRC.includes('var arrowSpacingReferencePx = 550;')).toBe(true);
    expect(FRONT_SRC.includes('var arrowSpacingPx = Math.round(arrowSpacingReferencePx / Math.max(arrowRepeatPct, 0.01));')).toBe(true);
    expect(FRONT_SRC.includes('if (arrowSpacingPx < 30) { arrowSpacingPx = 30; }')).toBe(true);
    expect(FRONT_SRC.includes('if (arrowSpacingPx > 300) { arrowSpacingPx = 300; }')).toBe(true);
  });

  test('route arrows: derives stroke color from theme mode and validates canvas context', () => {
    expect(FRONT_SRC.includes("var themeMode = (window.FGPX && typeof FGPX.themeMode === 'string') ? String(FGPX.themeMode) : 'system';")).toBe(true);
    expect(FRONT_SRC.includes("var arrowStrokeColor = (themeMode === 'bright') ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.85)';")).toBe(true);
    expect(FRONT_SRC.includes("if (!actx) { throw new Error('Route arrow canvas context unavailable'); }")).toBe(true);
    expect(FRONT_SRC.includes('actx.strokeStyle = arrowStrokeColor;')).toBe(true);
  });

  test('route arrows: logs warning instead of failing silently', () => {
    expect(FRONT_SRC.includes("} catch(e) { DBG.warn('Route arrow rendering skipped', e); }")).toBe(true);
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
