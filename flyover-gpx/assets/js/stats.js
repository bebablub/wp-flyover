(function () {
  'use strict';

  function q(selector, root) {
    return (root || document).querySelector(selector);
  }

  function createEl(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (typeof text === 'string') el.textContent = text;
    return el;
  }

  function formatKm(meters) {
    return (Number(meters || 0) / 1000).toFixed(2) + ' km';
  }

  function formatMeters(meters) {
    return Math.round(Number(meters || 0)).toString() + ' m';
  }

  function formatSpeed(kmh) {
    return Number(kmh || 0).toFixed(2) + ' km/h';
  }

  function fetchStats(config) {
    var maxPoints = Math.max(1000, Math.min(50000, Number(config.maxPoints || 15000)));
    var includeHeatmap = config.showHeatmap !== false ? '1' : '0';
    var restUrl = String(config.endpointUrl || '') + '?max_points=' + encodeURIComponent(String(maxPoints)) + '&include_heatmap=' + includeHeatmap;

    return fetch(restUrl, { credentials: 'same-origin' })
      .then(function (resp) {
        if (!resp.ok) throw new Error('REST request failed');
        return resp.json();
      })
      .catch(function () {
        var ajaxUrl = String(config.ajaxUrl || '');
        var action = String(config.ajaxAction || 'fgpx_stats');
        var fallbackUrl = ajaxUrl + '?action=' + encodeURIComponent(action) + '&max_points=' + encodeURIComponent(String(maxPoints)) + '&include_heatmap=' + includeHeatmap;
        return fetch(fallbackUrl, { credentials: 'same-origin' }).then(function (resp) {
          if (!resp.ok) throw new Error('AJAX request failed');
          return resp.json();
        });
      });
  }

  function buildKpis(root, summary, strings) {
    var kpiWrap = createEl('div', 'fgpx-stats-kpis');
    var items = [
      { label: strings.tracks || 'Tracks', value: String(summary.totalTracks || 0) },
      { label: strings.distance || 'Distance', value: formatKm(summary.totalDistanceM) },
      { label: strings.avgDistance || 'Avg distance', value: formatKm(summary.avgDistanceM) },
      { label: strings.maxDistance || 'Max distance', value: formatKm(summary.maxDistanceM) },
      { label: strings.elevation || 'Elevation gain', value: formatMeters(summary.totalElevationGainM) },
      { label: strings.avgElevation || 'Avg elevation', value: formatMeters(summary.avgElevationGainM) },
      { label: strings.maxElevation || 'Max elevation', value: formatMeters(summary.maxElevationGainM) },
      { label: strings.avgSpeed || 'Avg speed', value: formatSpeed(summary.avgSpeedKmh) },
      { label: strings.maxSpeed || 'Max speed', value: formatSpeed(summary.maxSpeedKmh) }
    ];

    items.forEach(function (item) {
      var card = createEl('div', 'fgpx-stats-kpi');
      card.appendChild(createEl('div', 'fgpx-stats-kpi-value', item.value));
      card.appendChild(createEl('div', 'fgpx-stats-kpi-label', item.label));
      kpiWrap.appendChild(card);
    });

    root.appendChild(kpiWrap);
  }

  function buildCharts(root, payload) {
    if (typeof window.Chart !== 'function') return;

    var strings = payload.__strings || {};
    var wrap = createEl('div', 'fgpx-stats-charts');

    var monthly = payload.trends && payload.trends.monthly ? payload.trends.monthly : [];
    var yearly = payload.trends && payload.trends.yearly ? payload.trends.yearly : [];

    if (!monthly.length && !yearly.length) {
      wrap.appendChild(createEl('div', 'fgpx-stats-empty', strings.noTrendData || 'No trend data available yet.'));
      root.appendChild(wrap);
      return;
    }

    var monthlyCanvas = createEl('canvas', 'fgpx-stats-chart-canvas');
    var yearlyCanvas = createEl('canvas', 'fgpx-stats-chart-canvas');

    var monthlyCard = createEl('div', 'fgpx-stats-chart-card');
    monthlyCard.appendChild(createEl('h3', 'fgpx-stats-chart-title', strings.chartDistanceByMonth || 'Distance by Month'));
    monthlyCard.appendChild(monthlyCanvas);

    var yearlyCard = createEl('div', 'fgpx-stats-chart-card');
    yearlyCard.appendChild(createEl('h3', 'fgpx-stats-chart-title', strings.chartTracksByYear || 'Tracks by Year'));
    yearlyCard.appendChild(yearlyCanvas);

    wrap.appendChild(monthlyCard);
    wrap.appendChild(yearlyCard);
    root.appendChild(wrap);

    var monthlyLabels = monthly.map(function (m) { return m.period; });
    var monthlyDistanceKm = monthly.map(function (m) { return Number(m.distanceM || 0) / 1000; });
    var monthlyTrackCounts = monthly.map(function (m) { return Number(m.trackCount || 0); });

    new window.Chart(monthlyCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: monthlyLabels,
        datasets: [
          {
            type: 'line',
            label: strings.chartDistanceKm || 'Distance (km)',
            data: monthlyDistanceKm,
            borderColor: '#0f766e',
            backgroundColor: 'rgba(15,118,110,0.18)',
            fill: true,
            tension: 0.25,
            yAxisID: 'yDistance'
          },
          {
            type: 'bar',
            label: strings.chartTracksByMonth || 'Tracks by Month',
            data: monthlyTrackCounts,
            backgroundColor: 'rgba(180,83,9,0.3)',
            borderColor: '#b45309',
            borderWidth: 1,
            yAxisID: 'yTracks'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: true } },
        scales: {
          yDistance: {
            type: 'linear',
            position: 'left',
            beginAtZero: true,
          },
          yTracks: {
            type: 'linear',
            position: 'right',
            beginAtZero: true,
            grid: {
              drawOnChartArea: false
            }
          }
        }
      }
    });

    var yearlyLabels = yearly.map(function (y) { return y.period; });
    var yearlyCounts = yearly.map(function (y) { return Number(y.trackCount || 0); });

    new window.Chart(yearlyCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: yearlyLabels,
        datasets: [{
          label: strings.chartTracks || 'Tracks',
          data: yearlyCounts,
          backgroundColor: '#b45309'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } }
      }
    });
  }

  function buildHeatmap(root, config, payload) {
    if (!window.maplibregl || typeof window.maplibregl.Map !== 'function') return;

    var strings = payload.__strings || {};
    var points = (payload.heatmap && payload.heatmap.points) ? payload.heatmap.points : [];
    var mapCard = createEl('div', 'fgpx-stats-map-card');
    mapCard.appendChild(createEl('h3', 'fgpx-stats-chart-title', strings.heatmapTitle || 'All Tracks Heatmap'));

    if (!points.length) {
      mapCard.appendChild(createEl('div', 'fgpx-stats-empty', strings.noHeatmapData || 'No track points available for heatmap yet.'));
      root.appendChild(mapCard);
      return;
    }

    var mapEl = createEl('div', 'fgpx-stats-map');
    mapCard.appendChild(mapEl);
    root.appendChild(mapCard);

    var center = [0, 0];
    if (points.length > 0) {
      center = [Number(points[0][1] || 0), Number(points[0][0] || 0)];
    }

    var uniqueSuffix = String(config.rootId || ('root-' + Math.random())).replace(/[^a-zA-Z0-9_-]/g, '_');
    var sourceId = 'fgpx-stats-heatmap-' + uniqueSuffix;
    var layerId = 'fgpx-stats-heatmap-layer-' + uniqueSuffix;

    var map = new window.maplibregl.Map({
      container: mapEl,
      style: config.mapStyle || 'https://demotiles.maplibre.org/style.json',
      center: center,
      zoom: points.length > 0 ? 4 : 1
    });

    map.addControl(new window.maplibregl.NavigationControl(), 'top-right');

    map.on('load', function () {
      var features = points.map(function (p) {
        return {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [Number(p[1] || 0), Number(p[0] || 0)]
          },
          properties: {
            weight: Number(p[2] || 1)
          }
        };
      });

      map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: features
        }
      });

      map.addLayer({
        id: layerId,
        type: 'heatmap',
        source: sourceId,
        paint: {
          'heatmap-weight': ['get', 'weight'],
          'heatmap-intensity': 0.8,
          'heatmap-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, 3,
            8, 16,
            12, 30
          ],
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0, 'rgba(3,105,161,0)',
            0.2, '#60a5fa',
            0.5, '#34d399',
            0.8, '#f59e0b',
            1, '#ef4444'
          ],
          'heatmap-opacity': 0.9
        }
      });

      if (typeof window.maplibregl.LngLatBounds === 'function' && points.length > 1) {
        var bounds = new window.maplibregl.LngLatBounds();
        points.forEach(function (p) {
          bounds.extend([Number(p[1] || 0), Number(p[0] || 0)]);
        });
        map.fitBounds(bounds, { padding: 30, maxZoom: 10, duration: 0 });
      }
    });
  }

  function renderRoot(root, config, payload) {
    var strings = config.strings || {};
    root.innerHTML = '';

    var summary = payload.summary || {};
    payload.__strings = strings;

    if (!Number(summary.totalTracks || 0)) {
      root.appendChild(createEl('div', 'fgpx-stats-empty', strings.noTracks || 'No published tracks yet.'));
      buildKpis(root, summary, strings);
      return;
    }

    buildKpis(root, summary, strings);

    if (config.showCharts !== false) {
      buildCharts(root, payload);
    }

    if (config.showHeatmap !== false) {
      buildHeatmap(root, config, payload);
    }
  }

  function initOne(root, config) {
    if (!root || root.dataset.fgpxStatsInit === '1') return;
    root.dataset.fgpxStatsInit = '1';

    var strings = config.strings || {};
    root.innerHTML = '<div class="fgpx-stats-loading">' + (strings.loading || 'Loading statistics...') + '</div>';

    fetchStats(config)
      .then(function (payload) {
        renderRoot(root, config, payload || {});
      })
      .catch(function () {
        root.innerHTML = '<div class="fgpx-stats-error">' + (strings.failed || 'Could not load statistics.') + '</div>';
      });
  }

  function initAll() {
    var instances = window.FGPXStatsInstances || {};
    Object.keys(instances).forEach(function (id) {
      var cfg = instances[id] || {};
      var root = document.getElementById(id);
      initOne(root, cfg);
    });

    if (window.FGPXStatsAdmin && window.FGPXStatsAdmin.rootId) {
      var adminCfg = window.FGPXStatsAdmin;
      var adminRoot = document.getElementById(adminCfg.rootId);
      initOne(adminRoot, adminCfg);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})();
