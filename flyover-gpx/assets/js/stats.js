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

  function getCssVar(styles, name, fallback) {
    if (!styles || typeof styles.getPropertyValue !== 'function') return fallback;
    var value = String(styles.getPropertyValue(name) || '').trim();
    return value || fallback;
  }

  function getChartTheme(root) {
    var styles = null;
    if (root && typeof window.getComputedStyle === 'function') {
      styles = window.getComputedStyle(root);
    }

    return {
      distance: getCssVar(styles, '--fgpx-stats-chart-distance', '#25ceff'),
      tracks: getCssVar(styles, '--fgpx-stats-chart-tracks', '#ff7a3d'),
      elevation: getCssVar(styles, '--fgpx-stats-chart-elevation', '#8b5cf6'),
      speed: getCssVar(styles, '--fgpx-stats-chart-speed', '#14b8a6'),
      histogram: getCssVar(styles, '--fgpx-stats-chart-histogram', '#6366f1'),
      weekday: getCssVar(styles, '--fgpx-stats-chart-weekday', '#0ea5e9'),
      hour: getCssVar(styles, '--fgpx-stats-chart-hour', '#f59e0b'),
      lineFill: getCssVar(styles, '--fgpx-stats-chart-line-fill', 'rgba(37,206,255,0.18)')
    };
  }

  function getDefaultHeatmapStyle() {
    return {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '&copy; OpenStreetMap contributors'
        }
      },
      layers: [
        {
          id: 'osm',
          type: 'raster',
          source: 'osm'
        }
      ]
    };
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

  var CHART_ALIASES = {
    monthly: 'distance_by_month',
    yearly: 'tracks_by_year'
  };

  function makeChartCanvas(wrap, title) {
    var canvas = createEl('canvas', 'fgpx-stats-chart-canvas');
    canvas.width = 400;
    canvas.height = 220;

    var card = createEl('div', 'fgpx-stats-chart-card');
    card.appendChild(createEl('h3', 'fgpx-stats-chart-title', title));
    card.appendChild(canvas);
    wrap.appendChild(card);

    return canvas;
  }

  function getChartRows(payload, key) {
    if (payload && payload.charts && Array.isArray(payload.charts[key])) {
      return payload.charts[key];
    }

    // Backward-compatible fallback for payloads generated before `charts` was added.
    var monthly = payload && payload.trends && Array.isArray(payload.trends.monthly) ? payload.trends.monthly : [];
    var yearly = payload && payload.trends && Array.isArray(payload.trends.yearly) ? payload.trends.yearly : [];

    if (key === 'distance_by_month') return monthly;
    if (key === 'tracks_by_year') return yearly;
    if (key === 'tracks_by_month') {
      return monthly.map(function (m) {
        return { period: m.period, trackCount: Number(m.trackCount || 0) };
      });
    }
    if (key === 'distance_by_year') {
      return yearly.map(function (y) {
        return { period: y.period, distanceM: Number(y.distanceM || 0) };
      });
    }
    if (key === 'elevation_by_month') {
      return monthly.map(function (m) {
        return { period: m.period, elevationGainM: Number(m.elevationGainM || 0) };
      });
    }
    if (key === 'elevation_by_year') {
      return yearly.map(function (y) {
        return { period: y.period, elevationGainM: Number(y.elevationGainM || 0) };
      });
    }
    if (key === 'avg_speed_by_month') {
      return monthly.map(function (m) {
        var duration = Number(m.durationS || 0);
        var speed = duration > 0 ? ((Number(m.distanceM || 0) / duration) * 3.6) : 0;
        return { period: m.period, avgSpeedKmh: speed };
      });
    }
    if (key === 'avg_speed_by_year') {
      return yearly.map(function (y) {
        var duration = Number(y.durationS || 0);
        var speed = duration > 0 ? ((Number(y.distanceM || 0) / duration) * 3.6) : 0;
        return { period: y.period, avgSpeedKmh: speed };
      });
    }

    return [];
  }

  function renderBarChart(canvas, labels, label, data, color) {
    new window.Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: label,
          data: data,
          backgroundColor: color || '#b45309'
        }]
      },
      options: {
        responsive: false,
        plugins: { legend: { display: true } }
      }
    });
  }

  function renderLineChart(canvas, labels, label, data, color, fillColor) {
    new window.Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: label,
          data: data,
          borderColor: color || '#0f766e',
          backgroundColor: fillColor || 'rgba(15,118,110,0.15)',
          fill: true,
          tension: 0.25
        }]
      },
      options: {
        responsive: false,
        plugins: { legend: { display: true } }
      }
    });
  }

  // Registry of available chart builders. Add new entries to extend stats charts.
  var CHART_BUILDERS = {
    distance_by_month: function (wrap, payload, strings, theme) {
      var rows = getChartRows(payload, 'distance_by_month');
      if (!rows.length) return false;
      var canvas = makeChartCanvas(wrap, strings.chartDistanceByMonth || 'Distance by Month');
      renderBarChart(
        canvas,
        rows.map(function (r) { return r.period; }),
        strings.chartDistanceKm || 'Distance (km)',
        rows.map(function (r) { return Number(r.distanceM || 0) / 1000; }),
        theme.distance
      );
      return true;
    },
    tracks_by_year: function (wrap, payload, strings, theme) {
      var rows = getChartRows(payload, 'tracks_by_year');
      if (!rows.length) return false;
      var canvas = makeChartCanvas(wrap, strings.chartTracksByYear || 'Tracks by Year');
      renderBarChart(
        canvas,
        rows.map(function (r) { return r.period; }),
        strings.chartTracksCount || 'Track count',
        rows.map(function (r) { return Number(r.trackCount || 0); }),
        theme.tracks
      );
      return true;
    },
    tracks_by_month: function (wrap, payload, strings, theme) {
      var rows = getChartRows(payload, 'tracks_by_month');
      if (!rows.length) return false;
      var canvas = makeChartCanvas(wrap, strings.chartTracksByMonth || 'Tracks by Month');
      renderBarChart(
        canvas,
        rows.map(function (r) { return r.period; }),
        strings.chartTracksCount || 'Track count',
        rows.map(function (r) { return Number(r.trackCount || 0); }),
        theme.tracks
      );
      return true;
    },
    distance_by_year: function (wrap, payload, strings, theme) {
      var rows = getChartRows(payload, 'distance_by_year');
      if (!rows.length) return false;
      var canvas = makeChartCanvas(wrap, strings.chartDistanceByYear || 'Distance by Year');
      renderBarChart(
        canvas,
        rows.map(function (r) { return r.period; }),
        strings.chartDistanceKm || 'Distance (km)',
        rows.map(function (r) { return Number(r.distanceM || 0) / 1000; }),
        theme.distance
      );
      return true;
    },
    elevation_by_month: function (wrap, payload, strings, theme) {
      var rows = getChartRows(payload, 'elevation_by_month');
      if (!rows.length) return false;
      var canvas = makeChartCanvas(wrap, strings.chartElevationByMonth || 'Elevation by Month');
      renderBarChart(
        canvas,
        rows.map(function (r) { return r.period; }),
        strings.chartElevationM || 'Elevation gain (m)',
        rows.map(function (r) { return Number(r.elevationGainM || 0); }),
        theme.elevation
      );
      return true;
    },
    elevation_by_year: function (wrap, payload, strings, theme) {
      var rows = getChartRows(payload, 'elevation_by_year');
      if (!rows.length) return false;
      var canvas = makeChartCanvas(wrap, strings.chartElevationByYear || 'Elevation by Year');
      renderBarChart(
        canvas,
        rows.map(function (r) { return r.period; }),
        strings.chartElevationM || 'Elevation gain (m)',
        rows.map(function (r) { return Number(r.elevationGainM || 0); }),
        theme.elevation
      );
      return true;
    },
    avg_speed_by_month: function (wrap, payload, strings, theme) {
      var rows = getChartRows(payload, 'avg_speed_by_month');
      if (!rows.length) return false;
      var canvas = makeChartCanvas(wrap, strings.chartAvgSpeedByMonth || 'Average Speed by Month');
      renderLineChart(
        canvas,
        rows.map(function (r) { return r.period; }),
        strings.chartAvgSpeedKmh || 'Average speed (km/h)',
        rows.map(function (r) { return Number(r.avgSpeedKmh || 0); }),
        theme.speed,
        theme.lineFill
      );
      return true;
    },
    avg_speed_by_year: function (wrap, payload, strings, theme) {
      var rows = getChartRows(payload, 'avg_speed_by_year');
      if (!rows.length) return false;
      var canvas = makeChartCanvas(wrap, strings.chartAvgSpeedByYear || 'Average Speed by Year');
      renderLineChart(
        canvas,
        rows.map(function (r) { return r.period; }),
        strings.chartAvgSpeedKmh || 'Average speed (km/h)',
        rows.map(function (r) { return Number(r.avgSpeedKmh || 0); }),
        theme.speed,
        theme.lineFill
      );
      return true;
    },
    track_length_histogram: function (wrap, payload, strings, theme) {
      var rows = getChartRows(payload, 'track_length_histogram');
      if (!rows.length) return false;
      var canvas = makeChartCanvas(wrap, strings.chartTrackLengthHistogram || 'Track Length Distribution');
      renderBarChart(
        canvas,
        rows.map(function (r) { return String(r.bucket || ''); }),
        strings.chartTracksCount || 'Track count',
        rows.map(function (r) { return Number(r.count || 0); }),
        theme.histogram
      );
      return true;
    },
    weekday_distribution: function (wrap, payload, strings, theme) {
      var rows = getChartRows(payload, 'weekday_distribution');
      if (!rows.length) return false;

      var labelByDay = {
        0: strings.weekdaySun || 'Sun',
        1: strings.weekdayMon || 'Mon',
        2: strings.weekdayTue || 'Tue',
        3: strings.weekdayWed || 'Wed',
        4: strings.weekdayThu || 'Thu',
        5: strings.weekdayFri || 'Fri',
        6: strings.weekdaySat || 'Sat'
      };
      var orderedWeekdays = [1, 2, 3, 4, 5, 6, 0];
      var countsByDay = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

      rows.forEach(function (r) {
        var day = Number(r.weekday);
        if (day >= 0 && day <= 6) {
          countsByDay[day] = Number(r.trackCount || 0);
        }
      });

      var canvas = makeChartCanvas(wrap, strings.chartWeekdayDistribution || 'Weekday Distribution');
      renderBarChart(
        canvas,
        orderedWeekdays.map(function (d) { return labelByDay[d]; }),
        strings.chartTracksCount || 'Track count',
        orderedWeekdays.map(function (d) { return countsByDay[d]; }),
        theme.weekday
      );
      return true;
    },
    hour_distribution: function (wrap, payload, strings, theme) {
      var rows = getChartRows(payload, 'hour_distribution');
      if (!rows.length) return false;

      var countsByHour = {};
      for (var h = 0; h < 24; h++) {
        countsByHour[h] = 0;
      }
      rows.forEach(function (r) {
        var hour = Number(r.hour);
        if (hour >= 0 && hour <= 23) {
          countsByHour[hour] = Number(r.trackCount || 0);
        }
      });

      var canvas = makeChartCanvas(wrap, strings.chartHourDistribution || 'Hour Distribution');
      renderBarChart(
        canvas,
        Array.from({ length: 24 }, function (_, i) { return String(i); }),
        strings.chartTracksCount || 'Track count',
        Array.from({ length: 24 }, function (_, i) { return countsByHour[i]; }),
        theme.hour
      );
      return true;
    }
  };

  function buildCharts(root, config, payload) {
    if (typeof window.Chart !== 'function') return;

    var enabled;
    if (Array.isArray(config.charts)) {
      enabled = config.charts
        .map(function (key) {
          var cleanKey = String(key || '').trim().toLowerCase();
          return CHART_ALIASES[cleanKey] || cleanKey;
        })
        .filter(function (key, idx, arr) {
          return key !== '' && arr.indexOf(key) === idx;
        });
    } else if (config.showCharts !== false) {
      enabled = ['distance_by_month', 'tracks_by_year'];
    } else {
      enabled = [];
    }
    if (!enabled.length) return;

    var strings = payload.__strings || {};
    var theme = getChartTheme(root);
    var wrap = createEl('div', 'fgpx-stats-charts');
    var built = 0;
    enabled.forEach(function (key) {
      if (typeof CHART_BUILDERS[key] === 'function') {
        if (CHART_BUILDERS[key](wrap, payload, strings, theme)) built++;
      }
    });
    if (!built) {
      wrap.appendChild(createEl('div', 'fgpx-stats-empty', strings.noTrendData || 'No trend data available yet.'));
    }
    root.appendChild(wrap);
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

    var mapStyle = config.mapStyle;
    if (typeof mapStyle !== 'string' || mapStyle.trim() === '') {
      mapStyle = getDefaultHeatmapStyle();
    }

    var map = new window.maplibregl.Map({
      container: mapEl,
      style: mapStyle,
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
            0, 1,
            8, 3,
            12, 6
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

    var renderPayload = Object.assign({}, payload || {});
    var summary = renderPayload.summary || {};
    renderPayload.__strings = strings;

    if (!Number(summary.totalTracks || 0)) {
      root.appendChild(createEl('div', 'fgpx-stats-empty', strings.noTracks || 'No published tracks yet.'));
      buildKpis(root, summary, strings);
      return;
    }

    buildKpis(root, summary, strings);

    buildCharts(root, config, renderPayload);

    if (config.showHeatmap !== false) {
      buildHeatmap(root, config, renderPayload);
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
