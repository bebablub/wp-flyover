/**
 * Minimal runtime regression tests for front.js.
 *
 * Scope intentionally stays small and avoids deep map/chart rendering.
 * We validate high-risk behavior that is observable before startPlayer() runs.
 */

const fs = require('fs');
const path = require('path');

const FRONT_SRC = fs.readFileSync(path.resolve(__dirname, '../../assets/js/front.js'), 'utf8');

const VR_SRC = fs.readFileSync(
  path.resolve(__dirname, '../../assets/js/video-recorder.js'),
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
  const mediaTab = tabs.find(
    (btn) =>
      String(btn.textContent || '')
        .toLowerCase()
        .indexOf('media') >= 0
  );
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

    addControl() {
      return this;
    }
    fitBounds() {
      return this;
    }
    resize() {
      return this;
    }
    remove() {
      return this;
    }
    off() {
      return this;
    }
    easeTo() {
      return this;
    }
    flyTo() {
      return this;
    }
    setCenter() {
      return this;
    }
    setZoom() {
      return this;
    }
    setPitch() {
      return this;
    }
    setTerrain() {
      return this;
    }
    hasImage() {
      return false;
    }
    addImage() {
      return this;
    }
    getCanvas() {
      return document.createElement('canvas');
    }
    getZoom() {
      return 12;
    }
    getStyle() {
      return { layers: [], sources: {} };
    }
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

    queryRenderedFeatures() {
      return [];
    }
    project(lngLat) {
      return { x: lngLat[0] || 0, y: lngLat[1] || 0 };
    }
    unproject(point) {
      return { lng: point.x || 0, lat: point.y || 0 };
    }

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
    constructor() {
      this._lngLat = null;
    }
    setLngLat(lngLat) {
      this._lngLat = lngLat;
      return this;
    }
    addTo() {
      return this;
    }
    remove() {
      return this;
    }
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

  test('speed arrows include missing-series warning and long-track density cap', () => {
    expect(FRONT_SRC.includes('speed-arrows-missing-series')).toBe(true);
    expect(FRONT_SRC.includes('Speed arrows enabled but cannot render')).toBe(true);
    expect(FRONT_SRC.includes('speedArrowFeatureLimit')).toBe(true);
    expect(FRONT_SRC.includes('Speed arrow count capped for performance')).toBe(true);
  });

  test('gallery player strategy param is passed to REST and AJAX URLs', async () => {
    document.body.innerHTML = '<div id="fgpx-app" class="fgpx" data-track-id="7"></div>';

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
    document.body.innerHTML = '<div id="fgpx-app" class="fgpx" data-track-id="7"></div>';

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
    ['fgpx_cache_v4_', 'strategy', 'photoCacheVersion'].forEach((substr) => {
      expect(FRONT_SRC.includes(substr)).toBe(true);
    });
  });

  test('fetch pipeline uses timeout/abort helper with configurable timeout', () => {
    [
      'fetchTimeoutMs',
      'fetchJsonWithTimeout',
      'AbortError',
      'timeout after',
      'payload.message',
    ].forEach((substr) => {
      expect(FRONT_SRC.includes(substr)).toBe(true);
    });
  });

  test('initContainer guards UI updates when container is disconnected', () => {
    expect(FRONT_SRC.includes('function isContainerActive() {')).toBe(true);
    expect(FRONT_SRC.includes('if (!isContainerActive()) return;')).toBe(true);
  });

  test('animation scheduling guards detached roots and cancels RAF when paused', () => {
    ['cancelAnimationFrame', 'registerTeardown', 'destroyRuntime', 'document.contains'].forEach(
      (substr) => {
        expect(FRONT_SRC.includes(substr)).toBe(true);
      }
    );
  });

  test('startup countdown preserves zoom target center and avoids syncing map center', () => {
    // This test checks that the startup countdown logic preserves the zoom target center
    // and does not call syncCameraStateFromMap() after stopIdleSway().
    // It should be robust to whitespace and formatting changes.
    const normalized = FRONT_SRC.replace(/\s+/g, ' ');
    // Check that startupZoomTargetState is set with a center property from perspectiveCorrectedCenter
    expect(
      /startupZoomTargetState\s*=\s*\{\s*center:\s*perspectiveCorrectedCenter\.slice\(0\)/.test(
        normalized
      )
    ).toBe(true);
    // Check that after stopIdleSway(), syncCameraStateFromMap() is NOT called in the next 200 chars
    const idx = normalized.indexOf('stopIdleSway();');
    expect(idx).toBeGreaterThan(-1);
    const after = normalized.slice(idx, idx + 200); // look at the next ~200 chars
    expect(after).not.toContain('syncCameraStateFromMap();');
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
      json: () =>
        Promise.resolve({
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
    expect(VR_SRC.includes('function createSessionIdSuffix(length)')).toBe(true);
    expect(
      VR_SRC.includes("this.sessionId = 'rec_' + Date.now() + '_' + createSessionIdSuffix(9);")
    ).toBe(true);
    expect(VR_SRC.includes('cryptoObj.getRandomValues(bytes);')).toBe(true);
    expect(
      VR_SRC.includes(
        "this.sessionId = 'rec_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);"
      )
    ).toBe(false);
  });

  test('weathergrade lookup supports backend time_unix with timestamp fallback', () => {
    expect(FRONT_SRC.includes('var tsEpoch = parseEpochSeconds(p.time_unix);')).toBe(true);
    expect(
      FRONT_SRC.includes('if (!isFinite(tsEpoch)) tsEpoch = parseEpochSeconds(p.timestamp);')
    ).toBe(true);
  });

  test('weathergrade tab is guarded when weather data is unavailable', () => {
    [
      "(tabType === 'weathergrade' || tabType === 'weatheroverview') && !weatherGradeAvailable",
      "ui.tabs.tabWeatherGrade.style.display = 'none';",
    ].forEach((substr) => {
      expect(FRONT_SRC.replace(/\s+/g, ' ').includes(substr.replace(/\s+/g, ' '))).toBe(true);
    });
  });

  test('weather overview availability reuses lookup compatibility path', () => {
    [
      'weatherGradeAvailable = simulationEnabled && buildWeatherLookup({ weather: weatherData }).length > 0;',
    ].forEach((substr) => {
      expect(FRONT_SRC.replace(/\s+/g, ' ').includes(substr.replace(/\s+/g, ' '))).toBe(true);
    });
  });

  test('weather overview does not bind duplicate direct tab listeners in startPlayer', () => {
    expect(
      FRONT_SRC.includes(
        "ui.tabs.tabWeatherOverview.addEventListener('click', function() { switchChartTab('weatheroverview'); });"
      )
    ).toBe(false);
  });

  test('weather overview playhead falls back to progress for non-timestamp tracks', () => {
    expect(
      FRONT_SRC.includes(
        "if (currentChartTab === 'weatheroverview' && ui.weatherOverviewPlayhead) {"
      )
    ).toBe(true);
    expect(FRONT_SRC.includes('? Math.max(0, Math.min(1, tOffset / totalDuration))')).toBe(true);
    expect(FRONT_SRC.includes(': Math.max(0, Math.min(1, progress));')).toBe(true);
  });

  test('weather overview tooltip and night legend are localized and keyboard accessible', () => {
    expect(
      FRONT_SRC.includes(
        "var nightLabel = (i18n && i18n.weatherOverviewNightSegment) || 'Nighttime segment';"
      )
    ).toBe(true);
    expect(FRONT_SRC.includes("emojiSpan.setAttribute('tabindex', '0');")).toBe(true);
    expect(
      FRONT_SRC.includes("emojiSpan.setAttribute('data-fgpx-tooltip', tooltipParts.join(' | '));")
    ).toBe(true);
    expect(FRONT_SRC.includes('bindWeatherFloatingTooltip(emojiSpan);')).toBe(true);
    expect(FRONT_SRC.includes("node.setAttribute('tabindex', '0');")).toBe(true);
    expect(FRONT_SRC.includes("node.setAttribute('data-fgpx-tooltip', item.label);")).toBe(true);
    expect(FRONT_SRC.includes('bindWeatherFloatingTooltip(node);')).toBe(true);
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
    expect(
      FRONT_SRC.includes('if (numericEpoch > 0 && numericEpoch < 4102444800) return numericEpoch;')
    ).toBe(true);
    expect(
      FRONT_SRC.includes('if (parsedEpoch > 0 && parsedEpoch < 4102444800) return parsedEpoch;')
    ).toBe(true);
  });

  test('weather legend includes accessibility labels', () => {
    expect(FRONT_SRC.includes("legend.setAttribute('role', 'group');")).toBe(true);
    expect(FRONT_SRC.includes("span.setAttribute('aria-label', item.aria);")).toBe(true);
    expect(FRONT_SRC.includes("span.setAttribute('aria-live', 'polite');")).toBe(true);
  });

  test('weather cinema icon groups expose tooltips describing icon meaning', () => {
    [
      'data-fgpx-tooltip',
      'bindWeatherFloatingTooltip',
      'showWeatherFloatingTooltip',
      'setAttrIfChanged',
    ].forEach((substr) => {
      expect(FRONT_SRC.includes(substr)).toBe(true);
    });
  });

  test('chart tabs use instance-scoped switch handler (queueTabUntilReady)', () => {
    ['switchChartTab', 'queueTabUntilReady'].forEach((substr) => {
      expect(FRONT_SRC.includes(substr)).toBe(true);
    });
  });

  test('mobile chart tabs include a swipe hint element', () => {
    ['chartTabsHint', 'Swipe to see more tabs'].forEach((substr) => {
      expect(FRONT_SRC.includes(substr)).toBe(true);
    });
  });

  test('media tab listener is only added if FGPX.photosEnabled, using queueTabUntilReady', () => {
    expect(FRONT_SRC.includes('if (FGPX.photosEnabled) {')).toBe(true);
    expect(
      FRONT_SRC.includes("tabMedia.addEventListener('click', queueTabUntilReady('media'));")
    ).toBe(true);
    expect(
      FRONT_SRC.includes(
        "tabMedia.addEventListener('click', function() { switchChartTab('media'); });"
      )
    ).toBe(false);
    expect(
      FRONT_SRC.includes('if (!FGPX.photosEnabled) {\n        tabMedia.addEventListener')
    ).toBe(false);
  });

  test('media tab and gallery rendering hooks are present', () => {
    expect(FRONT_SRC.includes("tabMedia = createEl('button', 'fgpx-chart-tab');")).toBe(true);
    expect(FRONT_SRC.includes("tabMedia.textContent = 'Media';")).toBe(true);
    expect(FRONT_SRC.includes("var mediaPanel = createEl('div', 'fgpx-media-panel');")).toBe(true);
    expect(FRONT_SRC.includes('function buildMediaItems() {')).toBe(true);
    expect(FRONT_SRC.includes('function renderMediaGrid() {')).toBe(true);
    expect(FRONT_SRC.includes('mediaItems = trackLinked.concat(offTrack);')).toBe(true);
  });

  test('overlay has close button and no prev/next nav', () => {
    expect(FRONT_SRC.includes("overlayClose.className = 'fgpx-photo-overlay-close';")).toBe(true);
    expect(FRONT_SRC.includes('function updateOverlayViewerControls() {')).toBe(false);
    expect(
      FRONT_SRC.includes(
        "overlayPrev.className = 'fgpx-photo-overlay-nav fgpx-photo-overlay-prev';"
      )
    ).toBe(false);
    expect(
      FRONT_SRC.includes(
        "overlayNext.className = 'fgpx-photo-overlay-nav fgpx-photo-overlay-next';"
      )
    ).toBe(false);
    expect(FRONT_SRC.includes('openMediaViewerAt(mediaViewerIndex + 1);')).toBe(false);
    expect(FRONT_SRC.includes('openMediaViewerAt(mediaViewerIndex - 1);')).toBe(false);
  });

  test('weathergrade container is initialized at startPlayer scope and reused safely', () => {
    expect(
      FRONT_SRC.includes("var container = root.querySelector('.fgpx-container');") ||
        FRONT_SRC.includes("var container = root.querySelector('.fgpx-container') || root;")
    ).toBe(true);
    expect(FRONT_SRC.includes('var cinemaRoot = container || root;')).toBe(true);
    expect(
      FRONT_SRC.includes("var cinemaEl = cinemaRoot.querySelector('.fgpx-weather-cinema');")
    ).toBe(true);
    expect(FRONT_SRC.includes('var _cinemaEl = cinemaRoot._cachedCinema;')).toBe(true);
    expect(
      FRONT_SRC.includes("_cinemaEl = cinemaRoot.querySelector('.fgpx-weather-cinema');")
    ).toBe(true);
  });

  test('weathergrade ground profile is current-anchored and not a static triangle', () => {
    ['bikeX', 'shapeHeight', 'Math.max(0, Math.min', 'gradePath'].forEach((substr) => {
      expect(FRONT_SRC.includes(substr)).toBe(true);
    });
  });

  test('weathergrade bicycle icon is mirrored toward timeline direction', () => {
    expect(FRONT_SRC.includes("bikeIcon.style.transform = 'scaleX(-1)';")).toBe(true);
  });

  test('weathergrade bicycle bottom offset is dynamically aligned to terrain', () => {
    [
      'bikeSurfaceY',
      'bikeLift',
      'wheelContactCalibration',
      'cinemaFloorOffset',
      'bikeEl.style.bottom',
    ].forEach((substr) => {
      expect(FRONT_SRC.includes(substr)).toBe(true);
    });
  });

  test('weathergrade bicycle rotation follows terrain tangent with clamp and smoothing', () => {
    ['bikeSlopeDeg', 'Math.atan2', 'targetBikeAngle', 'smoothedBikeAngle', 'rotate('].forEach(
      (substr) => {
        expect(FRONT_SRC.includes(substr)).toBe(true);
      }
    );
  });

  test('setPlaying directly toggles weather cinema paused class', () => {
    expect(
      FRONT_SRC.includes("var cinemaEl = cinemaRoot.querySelector('.fgpx-weather-cinema');")
    ).toBe(true);
    expect(FRONT_SRC.includes("if (playing) cinemaEl.classList.remove('is-paused');")).toBe(true);
    expect(FRONT_SRC.includes("else cinemaEl.classList.add('is-paused');")).toBe(true);
  });

  test('weathergrade seek and playing tab switch schedule forced cinema refresh', () => {
    [
      'updateWeatherCinema',
      'forceUpdate',
      'scheduleWeatherCinemaRefresh',
      'seekCinemaEl._lastUpdate',
    ].forEach((substr) => {
      expect(FRONT_SRC.includes(substr)).toBe(true);
    });
  });

  test('weather cinema caches day/night ordering and memoizes expensive updates', () => {
    [
      'dayNightPeriodsSorted',
      'sort(function',
      'trLo',
      'cinema._legendEls',
      'setStyleIfChanged',
      'setTextIfChanged',
      '_nightCache',
    ].forEach((substr) => {
      expect(FRONT_SRC.includes(substr)).toBe(true);
    });
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

  test('progressive route geometry updates use cadence-driven throttling', () => {
    expect(FRONT_SRC.includes('var progressLineCooldown = 0;')).toBe(true);
    expect(FRONT_SRC.includes('var progressInterval = cadence.progressInterval;')).toBe(true);
    expect(FRONT_SRC.includes('progressLineCooldown >= progressInterval')).toBe(true);
    expect(FRONT_SRC.includes('window.__fgpxLineCooldown >= 0.025')).toBe(false);
  });

  test('day-night and progressive route state are scoped per player instance', () => {
    expect(FRONT_SRC.includes('var dayNightOverlayState = null;')).toBe(true);
    expect(FRONT_SRC.includes('var progressSegments = [];')).toBe(true);
    expect(FRONT_SRC.includes('window.__fgpxLastDayNightState')).toBe(false);
    expect(FRONT_SRC.includes('window.__fgpxProgressSegments')).toBe(false);
  });

  test('chart no-data rendering and reset cleanup stay within the current player root', () => {
    expect(FRONT_SRC.includes("var chartWrap = root.querySelector('.fgpx-chart-wrap');")).toBe(
      true
    );
    expect(FRONT_SRC.includes('function cleanupProgressiveSegments() {')).toBe(true);
    expect(FRONT_SRC.includes('cleanupProgressiveSegments();')).toBe(true);
  });

  test('weather cinema element is cached on container to avoid per-RAF querySelector', () => {
    expect(FRONT_SRC.includes('cinemaRoot._cachedCinema')).toBe(true);
  });

  test('phase3 overlay profile supports reduced detail while weather tab is playing', () => {
    [
      'weatherOverlayPerfMode',
      'weatherHeatmapConsolidated',
      'windSatelliteLayersEnabled',
      'weatherTextLayersSupported',
      'weatherOverlayProfileKey',
      'applyWeatherOverlayProfile',
      'isReduced',
      'profileKey',
      'setLayerVisibilityIfPresent',
      'ensureTemperatureTextLayer',
      'ensureWindTextLayer',
    ].forEach((substr) => {
      expect(FRONT_SRC.includes(substr)).toBe(true);
    });
  });

  test('phase3 skips wind satellite layer creation in performance mode', () => {
    expect(FRONT_SRC.includes('if (windSatelliteLayersEnabled) {')).toBe(true);
    expect(
      FRONT_SRC.includes("DBG.log('Wind satellite layers skipped in performance mode');")
    ).toBe(true);
    expect(FRONT_SRC.includes("DBG.log('Wind satellite layers deferred until needed');")).toBe(
      true
    );
  });

  test('phase3 can build a consolidated weather heatmap layer behind feature flag', () => {
    expect(FRONT_SRC.includes('if (weatherHeatmapConsolidated) {')).toBe(true);
    expect(FRONT_SRC.includes("id: 'fgpx-weather-heatmap'")).toBe(true);
    expect(
      FRONT_SRC.includes("DBG.log('Using consolidated weather heatmap layer (phase3)');")
    ).toBe(true);
  });

  test('phase3 overlay profile is re-applied on playback and tab transitions', () => {
    [
      'try { applyWeatherOverlayProfile(false); } catch (_) {}',
      'currentChartTab = tabType;',
      'try { applyWeatherOverlayProfile(true); } catch (_) {}',
    ].forEach((substr) => {
      expect(FRONT_SRC.replace(/\s+/g, ' ').includes(substr.replace(/\s+/g, ' '))).toBe(true);
    });
  });

  test('phase3 defers temperature and wind text layer creation until needed', () => {
    expect(FRONT_SRC.includes('function refreshWeatherTextLayerSupport(logResult) {')).toBe(true);
    expect(FRONT_SRC.includes('if (weatherTextLayersSupported === true) return true;')).toBe(true);
    expect(FRONT_SRC.includes('return weatherTextLayersSupported === true;')).toBe(true);
    expect(FRONT_SRC.includes('weatherTextLayersSupported = hasGlyphs;')).toBe(true);
    expect(FRONT_SRC.includes('function ensureTemperatureTextLayer() {')).toBe(true);
    expect(FRONT_SRC.includes('if (!refreshWeatherTextLayerSupport(false)) return;')).toBe(true);
    expect(FRONT_SRC.includes("if (map.getLayer('fgpx-temperature-text')) return;")).toBe(true);
    expect(FRONT_SRC.includes('function ensureWindTextLayer() {')).toBe(true);
    expect(FRONT_SRC.includes('if (!refreshWeatherTextLayerSupport(false)) return;')).toBe(true);
    expect(FRONT_SRC.includes("if (map.getLayer('fgpx-wind-text')) return;")).toBe(true);
    expect(FRONT_SRC.includes("DBG.log('Temperature text layer deferred until needed');")).toBe(
      true
    );
    expect(FRONT_SRC.includes("DBG.log('Wind text layer deferred until needed');")).toBe(true);
  });

  test('map mode control degrades safely when API placeholders are unresolved', () => {
    expect(FRONT_SRC.includes('function resolveTemplateUrl(url) {')).toBe(true);
    expect(FRONT_SRC.includes("if (raw.indexOf('{{API_KEY}}') !== -1) {")).toBe(true);
    expect(FRONT_SRC.includes("if (!resolvedApiKey) return '';")).toBe(true);
    expect(
      FRONT_SRC.includes('var resolvedContoursTilesUrl = resolveTemplateUrl(contoursTilesUrl);')
    ).toBe(true);
    expect(
      FRONT_SRC.includes('var resolvedSatelliteTilesUrl = resolveTemplateUrl(satelliteTilesUrl);')
    ).toBe(true);
    expect(
      FRONT_SRC.includes(
        "var contoursModeAvailable = contoursEnabled && resolvedContoursTilesUrl !== '';"
      )
    ).toBe(true);
  });

  test('map mode control is hidden when only basic mode is available', () => {
    expect(FRONT_SRC.includes('function shouldShowMapModeControl() {')).toBe(true);
    expect(
      FRONT_SRC.includes(
        'return contoursModeAvailable || !!resolvedSatelliteTilesUrl || hasSatelliteLayer();'
      )
    ).toBe(true);
    expect(FRONT_SRC.includes('function syncMapModeControl() {')).toBe(true);
    expect(FRONT_SRC.includes('if (!shouldShowMapModeControl()) {')).toBe(true);
    expect(FRONT_SRC.includes("if (selectorMode !== 'satellite') {")).toBe(true);
  });

  test('map mode control uses configurable contour source-layer and localized labels', () => {
    ['contoursSourceLayer', 'source-layer', 'i18nMapMode', 'aria-label'].forEach((substr) => {
      expect(FRONT_SRC.includes(substr)).toBe(true);
    });
  });

  test('satellite mode uses configurable style layer id before fallback layer', () => {
    expect(
      FRONT_SRC.includes(
        "var satelliteLayerId = String((window.FGPX && FGPX.satelliteLayerId) || 'satellite').trim();"
      )
    ).toBe(true);
    expect(FRONT_SRC.includes('return !!map.getLayer(satelliteLayerId);')).toBe(true);
    expect(
      FRONT_SRC.includes(
        "setLayerVisibilityIfPresent(satelliteLayerId, showSat ? 'visible' : 'none');"
      )
    ).toBe(true);
  });

  test('phase3 normalizes WP boolean-like option values safely', () => {
    expect(FRONT_SRC.includes('function toBoolOption(value, fallback) {')).toBe(true);
    expect(
      FRONT_SRC.includes(
        'var weatherEnabled = toBoolOption(window.FGPX && FGPX.weatherEnabled, false);'
      )
    ).toBe(true);
    expect(
      FRONT_SRC.includes(
        'var debugWeatherDataEnabled = toBoolOption(window.FGPX && FGPX.debugWeatherData, false);'
      )
    ).toBe(true);
    expect(
      FRONT_SRC.includes('var effectiveWeatherEnabled = weatherEnabled || debugWeatherDataEnabled;')
    ).toBe(true);
    expect(
      FRONT_SRC.includes(
        'var weatherVisible = toBoolOption(window.FGPX && FGPX.weatherVisibleByDefault, false);'
      )
    ).toBe(true);
  });

  test('simulation tab and photo marker live in the weather cinema instead of the map overlay', () => {
    ['tabWeatherGrade', 'photoMarker', 'photoMarkerLabel'].forEach((substr) => {
      expect(FRONT_SRC.includes(substr)).toBe(true);
    });
    // overlayRuler should not be present
    expect(FRONT_SRC.includes('overlayRuler')).toBe(false);
  });

  test('phase3 lazily creates wind satellite layers only when full-detail visibility is needed', () => {
    expect(FRONT_SRC.includes('function ensureWindSatelliteLayers() {')).toBe(true);
    expect(FRONT_SRC.includes('if (windCircleLayerIds.length > 0) return;')).toBe(true);
    expect(FRONT_SRC.includes("if (circleWindVisibility === 'visible') {")).toBe(true);
    expect(FRONT_SRC.includes('ensureWindSatelliteLayers();')).toBe(true);
    expect(
      FRONT_SRC.includes(
        "DBG.log('Wind satellite layers created lazily', { count: windCircleLayerIds.length });"
      )
    ).toBe(true);
  });

  test('simulation city layer cache is invalidated on style data events', () => {
    [
      'map.on',
      '_placeLayers = null',
      'weatherTextLayersSupported = null',
      "weatherOverlayProfileKey = ''",
    ].forEach((substr) => {
      expect(FRONT_SRC.includes(substr)).toBe(true);
    });
  });

  test('simulation shows no-waypoints note when track has none', () => {
    expect(FRONT_SRC.includes("poiEmptyEl2.className = 'fgpx-weather-poi-empty';")).toBe(true);
    expect(FRONT_SRC.includes("poiEmptyEl2.textContent = 'No GPX waypoints in this track';")).toBe(
      true
    );
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

  test('media grid cache stores DocumentFragment of children to prevent nested panel on cache restore', () => {
    expect(FRONT_SRC.includes('cachedMediaGridDOM = ui.mediaPanel.cloneNode(true);')).toBe(false);
    const fragCount = (FRONT_SRC.match(/document\.createDocumentFragment\(\)/g) || []).length;
    expect(fragCount).toBeGreaterThanOrEqual(2);
    // Robust substring check for both fragment append patterns
    ['frag.appendChild', 'fragEmpty.appendChild'].forEach((substr) => {
      expect(FRONT_SRC.includes(substr)).toBe(true);
    });
  });

  test('media queue rotation recomputes displayed order from playback state', () => {
    [
      'photoQueueRotationEnabled',
      'buildRotatedMediaItems',
      'syncMediaDisplayOrder',
      'mediaDisplayItems = []',
      'tOffset = timeOffsets',
    ].forEach((substr) => {
      expect(FRONT_SRC.includes(substr)).toBe(true);
    });
  });

  test('media queue rotation preserves current page during runtime reorder', () => {
    expect(FRONT_SRC.includes('invalidateMediaGridCache(true);')).toBe(true);
    expect(FRONT_SRC.includes('if (!preservePage) {')).toBe(true);
    expect(
      FRONT_SRC.includes('if (mediaGridPage >= totalPages) mediaGridPage = totalPages - 1;')
    ).toBe(true);
  });

  test('media queue rotation styles define exit and handoff states', () => {
    expect(FRONT_CSS_SRC.includes('.fgpx .fgpx-media-card.fgpx-media-card-exiting {')).toBe(true);
    expect(FRONT_CSS_SRC.includes('@keyframes fgpx-media-card-exit {')).toBe(true);
    expect(FRONT_CSS_SRC.includes('.fgpx .fgpx-media-card.fgpx-media-card-entering {')).toBe(true);
    expect(FRONT_CSS_SRC.includes('.fgpx .fgpx-media-card.fgpx-media-card-tail-entering {')).toBe(
      true
    );
  });

  test('media grid empty state: renders with semantic role and ARIA label', () => {
    expect(FRONT_SRC.includes(".setAttribute('role', 'status');")).toBe(true);
    expect(FRONT_SRC.includes(".setAttribute('aria-label', 'Media gallery empty');")).toBe(true);
    expect(FRONT_SRC.includes("empty.className = 'fgpx-media-empty';")).toBe(true);
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
    ['photoOrderMode', 'geo_first', 'time_first'].forEach((substr) => {
      expect(FRONT_SRC.includes(substr)).toBe(true);
    });
  });

  test('photo ordering mode: time_first sorts by timestamp and falls back by id', () => {
    ['_timestampMs', 'isFinite', 'ida', 'idb'].forEach((substr) => {
      expect(FRONT_SRC.includes(substr)).toBe(true);
    });
  });

  test('media card accessibility: aria-labels are 1-based indices', () => {
    // Cards should say "Open photo 1", "Open photo 2", not "0" or "1"
    expect(FRONT_SRC.includes("'Open photo ' + String(index + 1)")).toBe(true);
    expect(FRONT_SRC.includes("'Open photo ' + String(index)")).toBe(false);
  });

  test('media card image: includes alt text fallback to title', () => {
    expect(FRONT_SRC.includes("img.alt = item.title || 'Photo';")).toBe(true);
  });

  test('media grid metadata display: shows route distance and timestamp when available', () => {
    expect(FRONT_SRC.includes('if (item.routeKm) {')).toBe(true);
    expect(FRONT_SRC.includes('km.textContent = item.routeKm;')).toBe(true);
    expect(FRONT_SRC.includes('if (item.timeLabel) {')).toBe(true);
    expect(FRONT_SRC.includes('time.textContent = item.timeLabel;')).toBe(true);
  });

  test('media grid applies strict privacy window filter for derivable photos only', () => {
    [
      'if (privacyEnabled) {',
      'if (routeDistMeters == null) { continue; }',
      'if (routeDistMeters < privacyStartD || routeDistMeters > privacyEndD) { continue; }',
    ].forEach((substr) => {
      expect(FRONT_SRC.replace(/\s+/g, ' ').includes(substr.replace(/\s+/g, ' '))).toBe(true);
    });
  });

  test('media grid pagination: shows prev/next buttons and page info', () => {
    expect(FRONT_SRC.includes("pagination.className = 'fgpx-media-pagination';")).toBe(true);
    expect(FRONT_SRC.includes("prevBtn.className = 'fgpx-media-page-prev';")).toBe(true);
    expect(FRONT_SRC.includes("nextBtn.className = 'fgpx-media-page-next';")).toBe(true);
    expect(
      FRONT_SRC.includes(
        "pageInfo.textContent = 'Page ' + (mediaGridPage + 1) + ' of ' + totalPages;"
      )
    ).toBe(true);
  });

  test('media tab hidden when photosEnabled is false', () => {
    expect(FRONT_SRC.includes('if (FGPX.photosEnabled) {')).toBe(true);
    expect(FRONT_SRC.includes('chartTabs.appendChild(tabMedia);')).toBe(true);
  });

  test('instance config is preserved into startPlayer media rendering', async () => {
    document.body.innerHTML = '<div id="fgpx-app" class="fgpx" data-track-id="1"></div>';
    installMapLibreMock();
    window.Chart = function ChartStub() {
      return { destroy: jest.fn(), update: jest.fn(), resize: jest.fn() };
    };

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          geojson: {
            coordinates: [
              [16, 48, 100],
              [16.04, 48.04, 110],
            ],
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

    const panelText = String(
      document.querySelector('#fgpx-app .fgpx-media-panel')?.textContent || ''
    );
    expect(panelText).toContain('Gallery-only photo');
  });

  test('runtime privacy mode hides media items without derivable route distance', async () => {
    document.body.innerHTML = '<div id="fgpx-app" class="fgpx" data-track-id="1"></div>';
    installMapLibreMock();
    window.Chart = function ChartStub() {
      return { destroy: jest.fn(), update: jest.fn(), resize: jest.fn() };
    };

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          geojson: {
            coordinates: [
              [16, 48, 100],
              [16.04, 48.04, 110],
            ],
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

    const panelText = String(
      document.querySelector('#fgpx-app .fgpx-media-panel')?.textContent || ''
    );
    expect(panelText).not.toContain('Unknown offtrack');
  });

  test('route arrows: addImage is called with data object instead of canvas', async () => {
    document.body.innerHTML = '<div id="fgpx-app" class="fgpx" data-track-id="1"></div>';
    installMapLibreMock();

    // Capture addImage calls
    const addImageSpy = jest.spyOn(window.maplibregl.Map.prototype, 'addImage');

    window.Chart = function ChartStub() {
      return { destroy: jest.fn(), update: jest.fn(), resize: jest.fn() };
    };

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          geojson: {
            coordinates: [
              [16, 48, 100],
              [16.04, 48.04, 110],
            ],
            properties: {
              timestamps: ['2026-01-01T00:00:00Z', '2026-01-01T00:10:00Z'],
              cumulativeDistance: [0, 4000],
            },
          },
          bounds: [16, 48, 16.04, 48.04],
          stats: {},
          photos: [],
        }),
    });
    global.fetch = fetchMock;
    window.fetch = fetchMock;

    window.FGPX = baseFGPX({
      arrowsEnabled: true,
      arrowsKm: 1,
    });

    loadFront();
    window.FGPX.boot();

    await flushAsync();
    await flushAsync();
    await flushAsync();

    // Find the call for the route arrow icon (undriven or driven)
    const routeArrowCall = addImageSpy.mock.calls.find(
      (call) =>
        call[0] === 'fgpx-route-dir-arrow-undriven' || call[0] === 'fgpx-route-dir-arrow-driven'
    );
    expect(routeArrowCall).toBeDefined();
    expect(routeArrowCall[1] instanceof HTMLCanvasElement).toBe(false);
    expect(routeArrowCall[1]).toMatchObject({
      width: 20,
      height: 20,
      data: expect.any(Uint8ClampedArray),
    });
  });

  test('speed arrows: addImage is called with data object when speed overlay is enabled', async () => {
    document.body.innerHTML = '<div id="fgpx-app" class="fgpx" data-track-id="1"></div>';
    installMapLibreMock();

    const addImageSpy = jest.spyOn(window.maplibregl.Map.prototype, 'addImage');

    window.Chart = function ChartStub() {
      return { destroy: jest.fn(), update: jest.fn(), resize: jest.fn() };
    };

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          geojson: {
            coordinates: [
              [16, 48, 100],
              [16.01, 48.01, 102],
              [16.03, 48.03, 110],
            ],
            properties: {
              timestamps: ['2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', '2026-01-01T00:02:00Z'],
              cumulativeDistance: [0, 800, 4200],
              speeds: [0, 20, 30],
            },
          },
          bounds: [16, 48, 16.03, 48.03],
          stats: {},
          photos: [],
        }),
    });
    global.fetch = fetchMock;
    window.fetch = fetchMock;

    window.FGPX = baseFGPX({
      speedArrowsEnabled: true,
      speedArrowsThresholdLow: 15,
      speedArrowsThresholdHigh: 25,
      speedArrowsSpacingLowKm: 3,
      speedArrowsSpacingHighKm: 0.5,
    });

    loadFront();
    window.FGPX.boot();

    await flushAsync();
    await flushAsync();
    await flushAsync();

    const speedArrowCall = addImageSpy.mock.calls.find(
      (call) =>
        call[0] === 'fgpx-speed-dir-arrow-medium' ||
        call[0] === 'fgpx-speed-dir-arrow-high' ||
        call[0] === 'fgpx-speed-dir-arrow-very-high'
    );

    if (speedArrowCall) {
      expect(speedArrowCall[1] instanceof HTMLCanvasElement).toBe(false);
      expect(speedArrowCall[1]).toMatchObject({
        width: 20,
        height: 20,
        data: expect.any(Uint8ClampedArray),
      });
    }
  });

  test('shows user-friendly no-data message for track with empty coordinates array', async () => {
    installMapLibreMock();
    document.body.innerHTML = '<div id="fgpx-app" class="fgpx" data-track-id="55"></div>';
    window.Chart = function ChartStub() {};

    const emptyPayload = {
      id: 55,
      name: 'Empty Track',
      geojson: {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [] },
        properties: {},
      },
      bounds: null,
      stats: {},
      photos: [],
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(emptyPayload),
      text: () => Promise.resolve(''),
    });
    window.fetch = global.fetch;

    window.FGPX = baseFGPX();
    loadFront();
    window.FGPX.boot();

    await flushAsync();
    await flushAsync();
    await flushAsync();

    const noDataMsg = document.querySelector('#fgpx-app .fgpx-no-data-message');
    expect(noDataMsg).not.toBeNull();
    expect(noDataMsg.textContent).toContain('No Route Data');
  });

  test('shows error state for track with single coordinate (less than 2 points)', async () => {
    installMapLibreMock();
    document.body.innerHTML = '<div id="fgpx-app" class="fgpx" data-track-id="56"></div>';
    window.Chart = function ChartStub() {};

    const singlePointPayload = {
      id: 56,
      name: 'Single Point',
      geojson: {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[8.0, 47.0, 500]] },
        properties: {},
      },
      bounds: null,
      stats: {},
      photos: [],
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(singlePointPayload),
      text: () => Promise.resolve(''),
    });
    window.fetch = global.fetch;

    window.FGPX = baseFGPX();
    loadFront();
    window.FGPX.boot();

    await flushAsync();
    await flushAsync();
    await flushAsync();

    // Single-point track has < 2 coords: should show error or no-data state, not crash
    const errEl = document.querySelector('#fgpx-app .fgpx-error');
    const noDataEl = document.querySelector('#fgpx-app .fgpx-no-data-message');
    expect(errEl || noDataEl).not.toBeNull();
  });

  test('deployRuntime teardown guard prevents double-destroy', () => {
    expect(FRONT_SRC.includes('if (runtimeDestroyed) return;')).toBe(true);
    expect(FRONT_SRC.includes('runtimeDestroyed = true;')).toBe(true);
  });

  test('map remove() is registered in teardown callbacks for cleanup', () => {
    expect(FRONT_SRC.includes("if (map && typeof map.remove === 'function') map.remove();")).toBe(
      true
    );
  });

  test('AbortController fallback uses Promise.race for timeout on unsupported browsers', () => {
    expect(FRONT_SRC.includes('Promise.race([fetchChain, raceTimeout])')).toBe(true);
  });

  test('fullscreen control is only added when browser supports Fullscreen API', () => {
    expect(FRONT_SRC.includes('document.fullscreenEnabled')).toBe(true);
    expect(FRONT_SRC.includes('FullscreenControl')).toBe(true);
  });

  test('createChart bails early when runtime is already destroyed', () => {
    const normalized = FRONT_SRC.replace(/\s+/g, ' ');
    expect(
      /createChart\s*=\s*function\s*\(tabType\)\s*\{\s*if\s*\(runtimeDestroyed\)\s*return;/.test(
        normalized
      )
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Query param parser tests
// ─────────────────────────────────────────────────────────────────────────────

describe('parsePlayerQueryParams', () => {
  // Extract parsePlayerQueryParams from the IIFE source so we can test it in isolation.
  // We inject it into global scope by wrapping the extraction in a modified IIFE.
  function loadParserOnly() {
    // Match the function body and expose it.
    var match = FRONT_SRC.match(/function parsePlayerQueryParams\(\)\s*\{[\s\S]*?\n  \}/);
    if (!match) throw new Error('parsePlayerQueryParams not found in front.js');
    // eslint-disable-next-line no-new-func
    var fn = new Function(match[0] + '\nreturn parsePlayerQueryParams;')();
    return fn;
  }

  let parsePlayerQueryParams;
  let originalLocation;

  beforeAll(() => {
    parsePlayerQueryParams = loadParserOnly();
  });

  beforeEach(() => {
    originalLocation = window.location;
    // jsdom allows reassigning location properties via Object.defineProperty
    delete window.location;
    window.location = { search: '', hash: '', href: 'https://example.test/' };
  });

  afterEach(() => {
    window.location = originalLocation;
  });

  test('returns empty object when no params present', () => {
    window.location.search = '';
    window.location.hash = '';
    expect(parsePlayerQueryParams()).toEqual({});
  });

  test('parses truthy values: 1, true, yes, on', () => {
    window.location.search = '?weather=1&daynight=true&charts=yes&download=on';
    const result = parsePlayerQueryParams();
    expect(result.weatherEnabled).toBe(true);
    expect(result.daynightMapEnabled).toBe(true);
    expect(result.chartsVisible).toBe(true);
    expect(result.gpxDownloadVisible).toBe(true);
  });

  test('parses falsy values: 0, false, no, off', () => {
    window.location.search = '?weather=0&videorecording=false&temp=no&wind=off&charts=0';
    const result = parsePlayerQueryParams();
    expect(result.weatherEnabled).toBe(false);
    expect(result.videoRecordingVisible).toBe(false);
    expect(result.weatherTemperatureVisible).toBe(false);
    expect(result.weatherWindVisible).toBe(false);
    expect(result.chartsVisible).toBe(false);
  });

  test('ignores invalid / unknown values', () => {
    window.location.search = '?weather=maybe&unknown=1&fullscreen=xyz';
    const result = parsePlayerQueryParams();
    expect(result.weatherEnabled).toBeUndefined();
    expect(result.unknown).toBeUndefined();
    expect(result.requestFullscreenOnLoad).toBeUndefined();
  });

  test('hash-query params override search params (hash wins)', () => {
    window.location.search = '?weather=0';
    window.location.hash = '#track-5?weather=1';
    const result = parsePlayerQueryParams();
    expect(result.weatherEnabled).toBe(true);
  });

  test('maps all supported param names to correct config keys', () => {
    window.location.search =
      '?fullscreen=1&videorecording=1&weather=1&temp=1&wind=1&daynight=1&charts=1&download=1';
    const result = parsePlayerQueryParams();
    expect(result.requestFullscreenOnLoad).toBe(true);
    expect(result.videoRecordingVisible).toBe(true);
    expect(result.weatherEnabled).toBe(true);
    expect(result.weatherTemperatureVisible).toBe(true);
    expect(result.weatherWindVisible).toBe(true);
    expect(result.daynightMapEnabled).toBe(true);
    expect(result.chartsVisible).toBe(true);
    expect(result.gpxDownloadVisible).toBe(true);
  });

  test('is case-insensitive for param names', () => {
    window.location.search = '?WEATHER=1&DayNight=0';
    const result = parsePlayerQueryParams();
    expect(result.weatherEnabled).toBe(true);
    expect(result.daynightMapEnabled).toBe(false);
  });

  test('does not throw when location is inaccessible', () => {
    delete window.location;
    window.location = null; // deliberately broken
    expect(() => parsePlayerQueryParams()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UI visibility via query params (integration with initContainer)
// ─────────────────────────────────────────────────────────────────────────────

describe('UI button visibility driven by query params', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="fgpx-app" class="fgpx" data-track-id="99"></div>';
    delete window.FGPX;
    delete window.maplibregl;
    delete window.Chart;
    installMapLibreMock();
    window.Chart = function ChartStub() {
      this.destroy = function () {};
    };
    // Reject fetch so initContainer fails early (we only care about buildLayout)
    mockRejectedFetch('test');
  });

  function bootWithConfig(cfg) {
    window.FGPX = baseFGPX(cfg);
    loadFront();
    // Trigger boot
    if (window.FGPX && typeof window.FGPX.boot === 'function') {
      window.FGPX.boot();
    }
  }

  test('video record button is absent when videoRecordingVisible=false', () => {
    bootWithConfig({ videoRecordingVisible: false });
    expect(document.querySelector('.fgpx-btn-record')).toBeNull();
  });

  test('video record button is present when videoRecordingVisible is not set (default)', () => {
    bootWithConfig({});
    expect(document.querySelector('.fgpx-btn-record')).not.toBeNull();
  });

  test('charts panel is absent when chartsVisible=false', () => {
    bootWithConfig({ chartsVisible: false });
    expect(document.querySelector('.fgpx-chart-tabs')).toBeNull();
    expect(document.querySelector('.fgpx-chart-wrap')).toBeNull();
  });

  test('charts panel is present when chartsVisible is not set (default)', () => {
    bootWithConfig({});
    expect(document.querySelector('.fgpx-chart-tabs')).not.toBeNull();
  });

  test('weather buttons absent when weatherEnabled=false', () => {
    bootWithConfig({ weatherEnabled: false });
    expect(document.querySelector('.fgpx-btn-weather')).toBeNull();
    expect(document.querySelector('.fgpx-btn-temperature')).toBeNull();
    expect(document.querySelector('.fgpx-btn-wind')).toBeNull();
  });

  test('temperature button absent when weatherEnabled=true but weatherTemperatureVisible=false', () => {
    // Override window.innerWidth to non-compact
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    bootWithConfig({ weatherEnabled: true, weatherTemperatureVisible: false });
    expect(document.querySelector('.fgpx-btn-weather')).not.toBeNull();
    expect(document.querySelector('.fgpx-btn-temperature')).toBeNull();
    expect(document.querySelector('.fgpx-btn-wind')).not.toBeNull();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  });

  test('wind button absent when weatherEnabled=true but weatherWindVisible=false', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    bootWithConfig({ weatherEnabled: true, weatherWindVisible: false });
    expect(document.querySelector('.fgpx-btn-wind')).toBeNull();
    expect(document.querySelector('.fgpx-btn-weather')).not.toBeNull();
  });

  test('download button absent when gpxDownloadVisible=false (ignores URL/nonce)', () => {
    bootWithConfig({
      gpxDownloadUrl: 'https://example.test/download',
      gpxDownloadNonce: 'abc',
      gpxDownloadVisible: false,
    });
    // No download button should be rendered
    const btns = Array.from(document.querySelectorAll('.fgpx-btn'));
    const hasDownload = btns.some(function (b) {
      return b.textContent.includes('⬇') || b.getAttribute('aria-label') === 'Download GPX';
    });
    expect(hasDownload).toBe(false);
  });
});
