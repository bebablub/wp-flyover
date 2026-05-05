const fs = require('fs');
const path = require('path');

const STATS_SRC = fs.readFileSync(
  path.resolve(__dirname, '../../assets/js/stats.js'),
  'utf8'
);

function loadStatsScript() {
  // eslint-disable-next-line no-eval
  eval(STATS_SRC);
}

function flushAsync() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function installMapLibreMock(sourceIdsRef) {
  class MockBounds {
    constructor() {
      this.points = [];
    }

    extend(point) {
      this.points.push(point);
      return this;
    }
  }

  class MockMap {
    addControl() { return this; }

    on(event, cb) {
      if (event === 'load') {
        setTimeout(() => cb(), 0);
      }
      return this;
    }

    addSource(id) {
      sourceIdsRef.push(String(id));
      return this;
    }

    addLayer() { return this; }
    fitBounds() { return this; }
  }

  window.maplibregl = {
    Map: MockMap,
    NavigationControl: function NavigationControl() {},
    LngLatBounds: MockBounds,
  };
}

describe('stats.js runtime', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete window.FGPXStatsInstances;
    delete window.FGPXStatsAdmin;
    delete window.maplibregl;
    delete window.Chart;
    global.fetch = undefined;
    window.fetch = undefined;
  });

  test('tracks_by_month chart renders tracks-per-month dataset', async () => {
    document.body.innerHTML = '<div id="fgpx-stats-admin-root"></div>';

    const sourceIds = [];
    installMapLibreMock(sourceIds);

    const chartCalls = [];
    window.Chart = function ChartStub(_ctx, cfg) {
      chartCalls.push(cfg);
    };

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        summary: {
          totalTracks: 2,
          totalDistanceM: 8000,
          avgDistanceM: 4000,
          maxDistanceM: 5000,
          totalElevationGainM: 300,
          avgElevationGainM: 150,
          maxElevationGainM: 220,
          avgSpeedKmh: 24,
          maxSpeedKmh: 41,
        },
        trends: {
          monthly: [
            { period: '2025-01', trackCount: 1, distanceM: 3000 },
            { period: '2025-02', trackCount: 2, distanceM: 5000 },
          ],
          yearly: [
            { period: '2025', trackCount: 2 },
          ],
        },
        heatmap: { points: [] },
      }),
    });
    global.fetch = fetchMock;
    window.fetch = fetchMock;

    window.FGPXStatsAdmin = {
      rootId: 'fgpx-stats-admin-root',
      endpointUrl: 'https://example.test/wp-json/fgpx/v1/stats/aggregate',
      ajaxUrl: 'https://example.test/wp-admin/admin-ajax.php',
      ajaxAction: 'fgpx_stats',
      charts: ['tracks_by_month'],
      strings: {
        chartTracksByMonth: 'Tracks by Month',
      },
    };

    loadStatsScript();
    await flushAsync();
    await flushAsync();

    expect(chartCalls.length).toBe(1);
    const tracksByMonthChart = chartCalls[0];
    expect(tracksByMonthChart.data.datasets.length).toBe(1);
    expect(tracksByMonthChart.data.datasets[0].label).toBe('Track count');
    expect(tracksByMonthChart.data.datasets[0].data).toEqual([1, 2]);
  });

  test('legacy chart aliases monthly/yearly still render canonical charts', async () => {
    document.body.innerHTML = '<div id="fgpx-stats-admin-root"></div>';

    const sourceIds = [];
    installMapLibreMock(sourceIds);

    const chartCalls = [];
    window.Chart = function ChartStub(_ctx, cfg) {
      chartCalls.push(cfg);
    };

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        summary: {
          totalTracks: 2,
          totalDistanceM: 8000,
          avgDistanceM: 4000,
          maxDistanceM: 5000,
          totalElevationGainM: 300,
          avgElevationGainM: 150,
          maxElevationGainM: 220,
          avgSpeedKmh: 24,
          maxSpeedKmh: 41,
        },
        trends: {
          monthly: [
            { period: '2025-01', trackCount: 1, distanceM: 3000, durationS: 500 },
            { period: '2025-02', trackCount: 2, distanceM: 5000, durationS: 700 },
          ],
          yearly: [
            { period: '2025', trackCount: 2, distanceM: 8000, durationS: 1200 },
          ],
        },
        heatmap: { points: [] },
      }),
    });
    global.fetch = fetchMock;
    window.fetch = fetchMock;

    window.FGPXStatsAdmin = {
      rootId: 'fgpx-stats-admin-root',
      endpointUrl: 'https://example.test/wp-json/fgpx/v1/stats/aggregate',
      ajaxUrl: 'https://example.test/wp-admin/admin-ajax.php',
      ajaxAction: 'fgpx_stats',
      charts: ['monthly', 'yearly'],
    };

    loadStatsScript();
    await flushAsync();
    await flushAsync();

    expect(chartCalls.length).toBe(2);
    expect(chartCalls[0].type).toBe('bar');
    expect(chartCalls[1].type).toBe('bar');
  });

  test('renders extended KPI set and localized labels', async () => {
    document.body.innerHTML = '<div id="fgpx-stats-admin-root"></div>';

    const sourceIds = [];
    installMapLibreMock(sourceIds);

    window.Chart = function ChartStub() {};

    const payload = {
      summary: {
        totalTracks: 3,
        totalDistanceM: 10000,
        avgDistanceM: 3333.33,
        maxDistanceM: 6000,
        totalElevationGainM: 900,
        avgElevationGainM: 300,
        maxElevationGainM: 450,
        avgSpeedKmh: 18.5,
        maxSpeedKmh: 44.2,
      },
      trends: { monthly: [], yearly: [] },
      heatmap: { points: [] },
    };

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(payload),
    });
    global.fetch = fetchMock;
    window.fetch = fetchMock;

    window.FGPXStatsAdmin = {
      rootId: 'fgpx-stats-admin-root',
      endpointUrl: 'https://example.test/wp-json/fgpx/v1/stats/aggregate',
      ajaxUrl: 'https://example.test/wp-admin/admin-ajax.php',
      ajaxAction: 'fgpx_stats',
      maxPoints: 15000,
      showCharts: true,
      showHeatmap: true,
      strings: {
        tracks: 'Tracks',
        distance: 'Distance',
        avgDistance: 'Avg distance',
        maxDistance: 'Max distance',
        elevation: 'Elevation gain',
        avgElevation: 'Avg elevation',
        maxElevation: 'Max elevation',
        avgSpeed: 'Avg speed',
        maxSpeed: 'Max speed',
        noTrendData: 'No trend data available yet.',
        noHeatmapData: 'No track points available for heatmap yet.',
      },
    };

    loadStatsScript();
    await flushAsync();
    await flushAsync();

    const kpis = document.querySelectorAll('.fgpx-stats-kpi');
    expect(kpis.length).toBe(9);
    expect(document.body.textContent).toContain('Avg distance');
    expect(document.body.textContent).toContain('Max elevation');
  });

  test('renders heatmap empty-state message when no points exist', async () => {
    document.body.innerHTML = '<div id="fgpx-stats-admin-root"></div>';

    const sourceIds = [];
    installMapLibreMock(sourceIds);
    window.Chart = function ChartStub() {};

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        summary: { totalTracks: 1 },
        trends: { monthly: [], yearly: [] },
        heatmap: { points: [] },
      }),
    });
    global.fetch = fetchMock;
    window.fetch = fetchMock;

    window.FGPXStatsAdmin = {
      rootId: 'fgpx-stats-admin-root',
      endpointUrl: 'https://example.test/wp-json/fgpx/v1/stats/aggregate',
      ajaxUrl: 'https://example.test/wp-admin/admin-ajax.php',
      ajaxAction: 'fgpx_stats',
      strings: { noHeatmapData: 'No track points available for heatmap yet.' },
    };

    loadStatsScript();
    await flushAsync();
    await flushAsync();

    expect(document.body.textContent).toContain('No track points available for heatmap yet.');
    expect(sourceIds.length).toBe(0);
  });

  test('uses unique map source IDs per instance to avoid collisions', async () => {
    document.body.innerHTML = '<div id="stats-a"></div><div id="stats-b"></div>';

    const sourceIds = [];
    installMapLibreMock(sourceIds);
    window.Chart = function ChartStub() {};

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        summary: { totalTracks: 1 },
        trends: { monthly: [], yearly: [] },
        heatmap: {
          points: [
            [48.2, 16.3, 1],
            [48.21, 16.31, 1],
          ],
        },
      }),
    });
    global.fetch = fetchMock;
    window.fetch = fetchMock;

    window.FGPXStatsInstances = {
      'stats-a': {
        rootId: 'stats-a',
        endpointUrl: 'https://example.test/wp-json/fgpx/v1/stats/aggregate',
        ajaxUrl: 'https://example.test/wp-admin/admin-ajax.php',
      },
      'stats-b': {
        rootId: 'stats-b',
        endpointUrl: 'https://example.test/wp-json/fgpx/v1/stats/aggregate',
        ajaxUrl: 'https://example.test/wp-admin/admin-ajax.php',
      },
    };

    loadStatsScript();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    expect(sourceIds).toContain('fgpx-stats-heatmap-stats-a');
    expect(sourceIds).toContain('fgpx-stats-heatmap-stats-b');
    expect(new Set(sourceIds).size).toBe(sourceIds.length);
  });
});
