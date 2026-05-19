(function () {
  'use strict';

  /**
   * Dynamically load an array of CSS stylesheets
   * @param {string[]} urls
   * @returns {Promise<void[]>}
   */
  function loadStyles(urls) {
    return Promise.all(
      (urls || []).map(function (u) {
        return new Promise(function (resolve) {
          if (!u) return resolve();
          if (
            [].slice.call(document.styleSheets).some(function (ss) {
              return (ss.href || '') === u;
            })
          )
            return resolve();
          var link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = u;
          link.onload = resolve;
          link.onerror = resolve;
          document.head.appendChild(link);
        });
      })
    );
  }

  /**
   * Load an array of JS scripts sequentially (in order)
   * @param {string[]} urls
   * @returns {Promise<void>}
   */
  function loadScriptsSequential(urls) {
    return (urls || []).reduce(function (promise, url) {
      return promise.then(function () {
        return new Promise(function (resolve, reject) {
          if (!url) return resolve();
          if (
            [].slice.call(document.scripts).some(function (script) {
              return (script.src || '') === url;
            })
          )
            return resolve();
          var script = document.createElement('script');
          script.src = url;
          script.async = false;
          script.defer = false;
          script.onload = resolve;
          script.onerror = function () {
            if (script.parentNode) {
              script.parentNode.removeChild(script);
            }
            reject(new Error('Failed to load script: ' + url));
          };
          document.head.appendChild(script);
        });
      });
    }, Promise.resolve());
  }

  /**
   * Apply player config overrides to window.FGPX
   * @param {object} cfg
   */
  function applyPlayerConfig(cfg) {
    var playerConfig = cfg.playerConfig || {};
    if (window.FGPX && window.FGPX.debugEnabled) {
      console.log('[FGPX Gallery] applyPlayerConfig - BEFORE', {
        globalPhotosEnabled: window.FGPX.photosEnabled,
        playerConfig: playerConfig,
      });
    }
    var forceOverrideKeys = {
      restUrl: true,
      restBase: true,
      ajaxUrl: true,
      nonce: true,
      hostPostId: true,
      simulationEnabled: true,
      simulationWaypointsEnabled: true,
      simulationCitiesEnabled: true,
      simulationWaypointWindowKm: true,
      simulationCityWindowKm: true,
    };
    window.FGPX = window.FGPX || {};
    for (var key in playerConfig) {
      if (!Object.prototype.hasOwnProperty.call(playerConfig, key)) continue;
      if (typeof window.FGPX[key] === 'undefined' || forceOverrideKeys[key]) {
        window.FGPX[key] = playerConfig[key];
      }
    }
    if (playerConfig.photosEnabled !== undefined) {
      window.FGPX.photosEnabled = playerConfig.photosEnabled;
    }
    if (playerConfig.photoOrderMode !== undefined) {
      window.FGPX.photoOrderMode = playerConfig.photoOrderMode;
    }
    if (window.FGPX && window.FGPX.debugEnabled) {
      console.log('[FGPX Gallery] applyPlayerConfig - AFTER', {
        globalPhotosEnabled: window.FGPX.photosEnabled,
        globalPhotoOrderMode: window.FGPX.photoOrderMode,
      });
    }
  }

  /**
   * Ensure player assets (styles/scripts) are loaded and config applied
   * @param {object} cfg
   * @returns {Promise<void>}
   */
  function ensurePlayerAssets(cfg) {
    applyPlayerConfig(cfg);
    if (window.FGPX && typeof window.FGPX.initContainer === 'function') {
      return Promise.resolve();
    }
    if (!window.__FGPXGalleryPlayerAssetsPromise) {
      window.__FGPXGalleryPlayerAssetsPromise = loadStyles(cfg.playerStyles || [])
        .then(function () {
          return loadScriptsSequential(cfg.playerScripts || []);
        })
        .then(function () {
          applyPlayerConfig(cfg);
          if (!window.FGPX || typeof window.FGPX.initContainer !== 'function') {
            throw new Error('Player boot function is unavailable.');
          }
        })
        .catch(function (error) {
          window.__FGPXGalleryPlayerAssetsPromise = null;
          throw error;
        });
    }

    return window.__FGPXGalleryPlayerAssetsPromise.then(function () {
      applyPlayerConfig(cfg);
    });
  }

  /**
   * Fallback copy-to-clipboard using textarea
   * @param {string} text
   * @returns {boolean}
   */
  function fallbackCopyText(text) {
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    var copied = false;
    try {
      copied = !!(document.execCommand && document.execCommand('copy'));
    } catch (_) {
      copied = false;
    }

    document.body.removeChild(textarea);
    return copied;
  }

  /**
   * Set copy button label and reset after delay
   * @param {HTMLElement} copyBtn
   * @param {string} label
   * @param {string} resetLabel
   */
  function setCopyButtonState(copyBtn, label, resetLabel) {
    copyBtn.textContent = label;
    setTimeout(function () {
      copyBtn.textContent = resetLabel;
    }, 1400);
  }

  /**
   * Copy shortcode/link to clipboard and update button state
   * @param {HTMLElement} copyBtn
   * @param {string} shortcode
   * @param {object} strings
   */
  function copyShortcode(copyBtn, shortcode, strings) {
    var resetLabel = strings.copyShortcode || 'Copy Link';
    var successLabel = strings.copied || 'Copied';
    var failedLabel = strings.copyFailed || 'Copy failed';

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(shortcode)
        .then(function () {
          setCopyButtonState(copyBtn, successLabel, resetLabel);
        })
        .catch(function () {
          if (fallbackCopyText(shortcode)) {
            setCopyButtonState(copyBtn, successLabel, resetLabel);
            return;
          }
          setCopyButtonState(copyBtn, failedLabel, resetLabel);
        });
      return;
    }

    if (fallbackCopyText(shortcode)) {
      setCopyButtonState(copyBtn, successLabel, resetLabel);
      return;
    }

    setCopyButtonState(copyBtn, failedLabel, resetLabel);
  }

  /**
   * Render player error message in gallery UI
   * @param {HTMLElement} panel
   * @param {HTMLElement} mount
   * @param {HTMLElement} title
   * @param {object} strings
   */
  function renderPlayerError(panel, mount, title, strings) {
    if (mount) {
      mount.innerHTML =
        '<div class="fgpx-gallery-empty">' +
        escHtml(strings.playerLoadFailed || 'Could not load the track player.') +
        '</div>';
    }
    if (panel) {
      panel.hidden = false;
    }
    if (title && typeof title.focus === 'function') {
      try {
        title.focus({ preventScroll: true });
      } catch (_) {
        title.focus();
      }
    }
  }

  /**
   * Apply gallery theme (light/dark/auto) to root element
   * @param {HTMLElement} root
   * @param {object} cfg
   */
  function applyGalleryTheme(root, cfg) {
    if (!root) {
      return;
    }

    var playerConfig = cfg && cfg.playerConfig ? cfg.playerConfig : {};
    var mode = String(playerConfig.themeMode || 'system');

    if (root.__fgpxGalleryThemeTimer) {
      clearTimeout(root.__fgpxGalleryThemeTimer);
      root.__fgpxGalleryThemeTimer = null;
    }

    if (mode === 'dark') {
      root.setAttribute('data-fgpx-theme', 'dark');
      return;
    }

    if (mode === 'bright') {
      root.setAttribute('data-fgpx-theme', 'light');
      return;
    }

    if (mode === 'auto') {
      var parseMinutes = function (hhmm, fallback) {
        var value = String(hhmm || '');
        var parts = value.split(':');
        if (parts.length !== 2) {
          return fallback;
        }
        var h = parseInt(parts[0], 10);
        var m = parseInt(parts[1], 10);
        if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
          return fallback;
        }
        return h * 60 + m;
      };

      var now = new Date();
      var nowMins = now.getHours() * 60 + now.getMinutes();
      var startMins = parseMinutes(playerConfig.themeAutoDarkStart, 22 * 60);
      var endMins = parseMinutes(playerConfig.themeAutoDarkEnd, 6 * 60);

      // Degenerate range means no defined dark window; fall back to system.
      if (startMins === endMins) {
        root.removeAttribute('data-fgpx-theme');
        return;
      }

      var inDark;

      if (startMins < endMins) {
        inDark = nowMins >= startMins && nowMins < endMins;
      } else {
        inDark = nowMins >= startMins || nowMins < endMins;
      }

      root.setAttribute('data-fgpx-theme', inDark ? 'dark' : 'light');

      var nextBoundaryMins = inDark
        ? (endMins - nowMins + 1440) % 1440
        : (startMins - nowMins + 1440) % 1440;
      var msUntilNext =
        nextBoundaryMins * 60 * 1000 - now.getSeconds() * 1000 - now.getMilliseconds();
      if (msUntilNext <= 0) {
        msUntilNext += 24 * 60 * 60 * 1000;
      }
      root.__fgpxGalleryThemeTimer = setTimeout(function () {
        if (!document.documentElement.contains(root)) {
          root.__fgpxGalleryThemeTimer = null;
          return;
        }
        applyGalleryTheme(root, cfg);
      }, msUntilNext + 200);
      return;
    }

    root.removeAttribute('data-fgpx-theme');
  }

  /**
   * Query selector helper
   * @param {string} selector
   * @param {HTMLElement} [root]
   * @returns {HTMLElement|null}
   */
  function qs(selector, root) {
    return (root || document).querySelector(selector);
  }

  /**
   * Query selectorAll helper (returns array)
   * @param {string} selector
   * @param {HTMLElement} [root]
   * @returns {HTMLElement[]}
   */
  function qsa(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  /**
   * Escape HTML for safe output
   * @param {string} str
   * @returns {string}
   */
  function escHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  /**
   * Normalize string for search (lowercase, trim)
   * @param {string} str
   * @returns {string}
   */
  function normalize(str) {
    return String(str || '')
      .toLowerCase()
      .trim();
  }

  /**
   * Get or build search text for a track
   * @param {object} track
   * @returns {string}
   */
  function getSearchText(track) {
    if (track._searchText) {
      return track._searchText;
    }

    track._searchText = normalize(
      String(track.title || '') +
        ' ' +
        String(track.keywords || '') +
        ' distance ' +
        String(track.distanceKm || '') +
        'km ' +
        String(track.distanceKm || '') +
        ' km' +
        ' duration ' +
        String(track.durationLabel || '') +
        ' elevation gain ' +
        String(track.elevationGainLabel || '') +
        'm ' +
        String(track.elevationGainLabel || '') +
        ' m'
    );

    return track._searchText;
  }

  /**
   * Collect shareable UI state params from gallery + player config.
   * Only includes booleans that differ from the player's configured defaults,
   * so the URL stays short. Returns an object of param name → '1' or '0'.
   * @param {object} cfg  Gallery instance config
   * @param {object} [playerFGPX]  Resolved player FGPX config (optional)
   * @returns {object}
   */
  function collectShareUiParams(cfg, playerFGPX) {
    var pc = cfg && cfg.playerConfig ? cfg.playerConfig : {};
    var merged = Object.assign({}, pc, playerFGPX || {});
    var params = {};

    // Only include a param when the feature is explicitly disabled (=0) — omit when default/true
    // so unrelated pages aren't affected by spurious params in the URL.
    function addIfFalse(paramName, configKey) {
      if (merged[configKey] === false) {
        params[paramName] = '0';
      }
    }
    function addIfTrue(paramName, configKey) {
      if (merged[configKey] === true) {
        params[paramName] = '1';
      }
    }

    // Fullscreen: only include when explicitly requested (unusual to share via URL)
    addIfTrue('fullscreen', 'requestFullscreenOnLoad');

    // UI toggles: include only when explicitly turned off
    addIfFalse('videorecording', 'videoRecordingVisible');
    addIfFalse('temp', 'weatherTemperatureVisible');
    addIfFalse('wind', 'weatherWindVisible');
    addIfFalse('charts', 'chartsVisible');
    addIfFalse('download', 'gpxDownloadVisible');

    // Weather / daynight: include enabled state when it deviates from admin default
    if (merged.weatherEnabled === false) params.weather = '0';
    if (merged.weatherEnabled === true && !pc.weatherEnabled) params.weather = '1';
    if (merged.daynightMapEnabled === false) params.daynight = '0';
    if (merged.daynightMapEnabled === true && !pc.daynightMapEnabled) params.daynight = '1';

    return params;
  }

  /**
   * Build shareable URL with hash for track, optionally including UI params.
   * @param {number|string} trackId
   * @param {object} [uiParams]  Optional query params object (key → string value)
   * @returns {string}
   */
  function shareUrlBaseWithHash(trackId, uiParams) {
    var includeUiParams = !!(uiParams && typeof uiParams === 'object');
    try {
      var u = new URL(window.location.href);
      if (includeUiParams) {
        // Strip existing fgpx-related query params only when share UI settings are enabled.
        var paramsToClear = [
          'fullscreen',
          'videorecording',
          'weather',
          'temp',
          'wind',
          'daynight',
          'charts',
          'download',
        ];
        for (var pi = 0; pi < paramsToClear.length; pi++) {
          u.searchParams.delete(paramsToClear[pi]);
        }

        // Apply new UI params (if any)
        var keys = Object.keys(uiParams);
        for (var ki = 0; ki < keys.length; ki++) {
          var k = keys[ki];
          if (uiParams[k] !== null && typeof uiParams[k] !== 'undefined' && uiParams[k] !== '') {
            u.searchParams.set(k, String(uiParams[k]));
          }
        }
      }
      u.hash = 'track-' + String(trackId);
      return u.toString();
    } catch (_) {
      var hrefWithoutHash = String(window.location.href).split('#')[0];
      if (!includeUiParams) {
        return hrefWithoutHash + '#track-' + String(trackId);
      }
      var base = hrefWithoutHash.split('?')[0];
      var qs = '';
      if (includeUiParams) {
        var parts = [];
        var pkeys = Object.keys(uiParams);
        for (var pki = 0; pki < pkeys.length; pki++) {
          var pk = pkeys[pki];
          if (uiParams[pk] !== null && typeof uiParams[pk] !== 'undefined' && uiParams[pk] !== '') {
            parts.push(encodeURIComponent(pk) + '=' + encodeURIComponent(String(uiParams[pk])));
          }
        }
        if (parts.length) qs = '?' + parts.join('&');
      }
      return base + qs + '#track-' + String(trackId);
    }
  }

  /**
   * Find track by ID in array
   * @param {object[]} tracks
   * @param {number|string} id
   * @returns {object|null}
   */
  function findTrackById(tracks, id) {
    for (var i = 0; i < tracks.length; i++) {
      if (Number(tracks[i].id) === Number(id)) {
        return tracks[i];
      }
    }
    return null;
  }

  /**
   * Find closest ancestor with class
   * @param {Node} node
   * @param {string} className
   * @returns {Node|null}
   */
  function closestByClass(node, className) {
    while (node && node !== document) {
      if (node.classList && node.classList.contains(className)) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }

  /**
   * Sort tracks by key
   * @param {object[]} items
   * @param {string} sortKey
   * @returns {object[]}
   */
  function sortTracks(items, sortKey) {
    var out = items.slice();
    if (sortKey === 'distance') {
      out.sort(function (a, b) {
        return Number(b.distanceKm) - Number(a.distanceKm);
      });
      return out;
    }
    if (sortKey === 'duration') {
      out.sort(function (a, b) {
        return Number(b.durationS) - Number(a.durationS);
      });
      return out;
    }
    if (sortKey === 'gain') {
      out.sort(function (a, b) {
        return Number(b.elevationGainM) - Number(a.elevationGainM);
      });
      return out;
    }
    if (sortKey === 'title') {
      out.sort(function (a, b) {
        return String(a.title).localeCompare(String(b.title));
      });
      return out;
    }
    out.sort(function (a, b) {
      return Number(b.dateTs) - Number(a.dateTs);
    });
    return out;
  }

  /**
   * Build HTML for a gallery card
   * @param {object} track
   * @param {object} strings
   * @param {boolean} listMode
   * @param {number|string|null} activeId
   * @returns {string}
   */
  function buildCard(track, strings, listMode, activeId) {
    var isActive = activeId != null && Number(track.id) === Number(activeId);
    var imageUrl = String(track.previewImageUrl || '');
    var visual;
    if (imageUrl) {
      visual =
        '<div class="fgpx-gallery-card-visual">' +
        '<img class="fgpx-gallery-card-image" src="' +
        escHtml(imageUrl) +
        '" alt="' +
        escHtml(track.title || 'Track preview') +
        '" loading="lazy" decoding="async" />' +
        '<div class="fgpx-gallery-card-icon" aria-hidden="true">⛰</div>' +
        '</div>';
    } else {
      visual =
        '<div class="fgpx-gallery-card-visual is-fallback"><div class="fgpx-gallery-card-icon" aria-hidden="true">⛰</div></div>';
    }
    var meta =
      '<div class="fgpx-gallery-card-meta">' +
      '<span><strong>' +
      escHtml(strings.distance) +
      ':</strong> ' +
      escHtml(track.distanceKm) +
      ' km</span>' +
      '<span><strong>' +
      escHtml(strings.duration) +
      ':</strong> ' +
      escHtml(track.durationLabel) +
      '</span>' +
      '<span><strong>' +
      escHtml(strings.gain) +
      ':</strong> ' +
      escHtml(track.elevationGainLabel) +
      ' m</span>' +
      '<span><strong>' +
      escHtml(strings.uploaded) +
      ':</strong> ' +
      escHtml(track.dateLabel) +
      '</span>' +
      '</div>';

    return (
      '<article class="fgpx-gallery-card' +
      (listMode ? ' fgpx-gallery-card-list' : '') +
      (isActive ? ' is-active' : '') +
      '" aria-current="' +
      (isActive ? 'true' : 'false') +
      '" data-track-id="' +
      escHtml(track.id) +
      '" role="button" tabindex="0">' +
      visual +
      '<div class="fgpx-gallery-card-main">' +
      '<h3 class="fgpx-gallery-card-title">' +
      escHtml(track.title) +
      '</h3>' +
      meta +
      '</div>' +
      '</article>'
    );
  }

  /**
   * Build URL with query params
   * @param {string} base
   * @param {object} params
   * @returns {string}
   */
  function buildUrl(base, params) {
    if (!base) {
      return '';
    }

    try {
      var url = new URL(base, window.location.href);
      Object.keys(params || {}).forEach(function (key) {
        var value = params[key];
        if (value === null || typeof value === 'undefined' || value === '') {
          return;
        }
        url.searchParams.set(key, String(value));
      });
      return url.toString();
    } catch (_) {
      var query = Object.keys(params || {})
        .filter(function (key) {
          var value = params[key];
          return value !== null && typeof value !== 'undefined' && value !== '';
        })
        .map(function (key) {
          return encodeURIComponent(key) + '=' + encodeURIComponent(String(params[key]));
        })
        .join('&');
      if (!query) {
        return String(base);
      }
      return String(base) + (String(base).indexOf('?') === -1 ? '?' : '&') + query;
    }
  }

  /**
   * Fetch JSON from URL
   * @param {string} url
   * @returns {Promise<any>}
   */
  function fetchJson(url) {
    if (!url || typeof window.fetch !== 'function') {
      return Promise.reject(new Error('Fetch is unavailable.'));
    }

    return window.fetch(url, { credentials: 'same-origin' }).then(function (response) {
      if (!response || !response.ok) {
        throw new Error('Failed request: ' + url);
      }
      return response.json();
    });
  }

  /**
   * Request gallery payload from REST or AJAX endpoint
   * @param {object} cfg
   * @param {object} params
   * @returns {Promise<any>}
   */
  function requestGalleryPayload(cfg, params) {
    if (window.FGPX && window.FGPX.debugEnabled) {
      console.log('[FGPX Gallery] requestGalleryPayload starting', { params: params });
    }
    var preferAjax = !!(
      (cfg.playerConfig && cfg.playerConfig.preferAjaxFirst) ||
      (window.FGPX && window.FGPX.preferAjaxFirst)
    );
    var restUrls = [];
    var ajaxUrls = [];
    if (cfg.endpointUrl) {
      restUrls.push(buildUrl(cfg.endpointUrl, params));
    }
    if (cfg.ajaxUrl && cfg.ajaxAction) {
      var ajaxParams = Object.assign({}, params, { action: cfg.ajaxAction });
      ajaxUrls.push(buildUrl(cfg.ajaxUrl, ajaxParams));
    }
    var urls = preferAjax ? ajaxUrls.concat(restUrls) : restUrls.concat(ajaxUrls);

    function tryUrl(index) {
      if (index >= urls.length) {
        return Promise.reject(new Error('No gallery endpoint available.'));
      }
      if (window.FGPX && window.FGPX.debugEnabled) {
        console.log('[FGPX Gallery] Trying endpoint', {
          index: index,
          url: urls[index],
          isAjax: urls[index].indexOf('admin-ajax.php') !== -1,
        });
      }
      return fetchJson(urls[index])
        .then(function (json) {
          if (window.FGPX && window.FGPX.debugEnabled) {
            console.log('[FGPX Gallery] Endpoint success', {
              index: index,
              url: urls[index],
              isAjax: urls[index].indexOf('admin-ajax.php') !== -1,
              payload: json,
            });
          }
          return json;
        })
        .catch(function (err) {
          if (window.FGPX && window.FGPX.debugEnabled) {
            console.warn('[FGPX Gallery] Endpoint failed', {
              index: index,
              url: urls[index],
              error: err,
            });
          }
          return tryUrl(index + 1);
        });
    }

    return tryUrl(0);
  }

  /**
   * Update gallery view mode button states
   * @param {HTMLElement[]} viewButtons
   * @param {string} viewMode
   */
  function updateViewButtons(viewButtons, viewMode) {
    viewButtons.forEach(function (button) {
      var isActive = button.getAttribute('data-view') === viewMode;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  /**
   * Check if user prefers reduced motion
   * @returns {boolean}
   */
  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (_) {
      return false;
    }
  }

  /**
   * Apply reveal animation to gallery cards
   * @param {HTMLElement} results
   * @param {number} fromIndex
   */
  function applyRevealAnimation(results, fromIndex) {
    if (!results || fromIndex < 0 || prefersReducedMotion()) {
      return;
    }

    var cards = qsa('.fgpx-gallery-card', results);
    if (!cards.length || fromIndex >= cards.length) {
      return;
    }

    cards.forEach(function (card, index) {
      if (index < fromIndex) {
        card.classList.remove('fgpx-gallery-card-reveal');
        card.style.removeProperty('--fgpx-gallery-reveal-delay');
        return;
      }

      var staggerIndex = index - fromIndex;
      card.style.setProperty(
        '--fgpx-gallery-reveal-delay',
        String(Math.min(staggerIndex, 7) * 45) + 'ms'
      );
      card.classList.add('fgpx-gallery-card-reveal');
    });
  }

  /**
   * Set loading state for gallery results and load more button
   * @param {HTMLElement} results
   * @param {HTMLElement} loadMoreBtn
   * @param {boolean} isLoading
   * @param {object} strings
   * @param {boolean} resetResults
   */
  function setLoadingState(results, loadMoreBtn, isLoading, strings, resetResults) {
    if (results) {
      results.setAttribute('aria-busy', isLoading ? 'true' : 'false');
      if (isLoading && resetResults) {
        results.innerHTML =
          '<div class="fgpx-gallery-loading"><span class="fgpx-gallery-spinner" aria-hidden="true"></span><span class="fgpx-gallery-loading-label">' +
          escHtml(strings.loading || 'Loading tracks...') +
          '</span></div>';
      }
    }

    if (loadMoreBtn) {
      loadMoreBtn.disabled = !!isLoading;
      if (isLoading) {
        loadMoreBtn.hidden = true;
      }
    }
  }

  /**
   * Mount and initialize the player for a track in the gallery
   * @param {HTMLElement} root
   * @param {object} track
   * @param {object} cfg
   */
  function mountPlayer(root, track, cfg) {
    if (window.FGPX && window.FGPX.debugEnabled) {
      console.log('[FGPX Gallery] mountPlayer', { track: track, cfg: cfg });
    }
    var panel = qs('.fgpx-gallery-player-panel', root);
    var title = qs('.fgpx-gallery-player-title', root);
    var mount = qs('.fgpx-gallery-player-mount', root);
    var strings = cfg.strings || {};
    if (!panel || !title || !mount) {
      return;
    }

    title.textContent = track.title;

    function focusPlayerTitle() {
      if (typeof title.focus === 'function') {
        try {
          title.focus({ preventScroll: true });
        } catch (_) {
          title.focus();
        }
      }
    }

    function renderPlayer() {
      var playerId = 'fgpx-gallery-player-' + String(track.id) + '-' + String(Date.now());
      mount.innerHTML =
        '<div id="' +
        playerId +
        '" class="fgpx" style="height:' +
        escHtml(cfg.playerHeight || '636px') +
        '" data-track-id="' +
        escHtml(track.id) +
        '" data-style="' +
        escHtml(cfg.playerStyle || 'raster') +
        '" data-style-url="' +
        escHtml(cfg.playerStyleUrl || '') +
        '"></div>';

      // Set per-player instance override for gallery photo enrichment strategy
      if (!window.FGPX.instances) {
        window.FGPX.instances = {};
      }
      var autoSpeedOverride = {};
      if (
        cfg.autoSpeedEnabled &&
        track.distanceKm &&
        Number(track.distanceKm) > Number(cfg.autoSpeedThresholdKm || 200)
      ) {
        autoSpeedOverride = { defaultSpeed: Number(cfg.autoSpeedValue) || 100 };
      }
      window.FGPX.instances[playerId] = Object.assign(
        {},
        cfg.playerConfig || {},
        autoSpeedOverride,
        {
          galleryPhotoStrategy: 'latest_embed',
          gpxDownloadUrl: track.gpxDownloadUrl || '',
        }
      );

      if (window.FGPX && window.FGPX.debugEnabled) {
        console.log('[FGPX Gallery] renderPlayer - instance config', {
          playerId: playerId,
          config: window.FGPX.instances[playerId],
        });
      }

      var playerEl = qs('#' + playerId, root);
      if (playerEl && window.FGPX && typeof window.FGPX.initContainer === 'function') {
        try {
          window.FGPX.initContainer(playerEl);
        } catch (_) {
          renderPlayerError(panel, mount, title, strings);
          delete window.FGPX.instances[playerId];
          return;
        }
      } else {
        renderPlayerError(panel, mount, title, strings);
        delete window.FGPX.instances[playerId];
        return;
      }

      if (typeof panel.scrollIntoView === 'function') {
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      focusPlayerTitle();
    }

    panel.hidden = false;
    mount.innerHTML = '';

    applyPlayerConfig(cfg);
    if (window.FGPX && typeof window.FGPX.initContainer === 'function') {
      renderPlayer();
    } else {
      mount.innerHTML =
        '<div class="fgpx-gallery-loading"><span class="fgpx-gallery-spinner" aria-hidden="true"></span></div>';
      ensurePlayerAssets(cfg)
        .then(renderPlayer)
        .catch(function () {
          renderPlayerError(panel, mount, title, strings);
        });
    }

    var uiParams = cfg.galleryShareIncludeUiSettings ? collectShareUiParams(cfg) : null;
    var pageUrl = shareUrlBaseWithHash(track.id, uiParams);
    var shareText = track.title + ' - Flyover GPX';
    var encodedUrl = encodeURIComponent(pageUrl);
    var encodedText = encodeURIComponent(shareText);

    var fb = qs('.fgpx-share-fb', root);
    var x = qs('.fgpx-share-x', root);
    var wa = qs('.fgpx-share-wa', root);
    if (fb) fb.href = 'https://www.facebook.com/sharer/sharer.php?u=' + encodedUrl;
    if (x) x.href = 'https://twitter.com/intent/tweet?url=' + encodedUrl + '&text=' + encodedText;
    if (wa) wa.href = 'https://wa.me/?text=' + encodeURIComponent(shareText + ' ' + pageUrl);

    var copyBtn = qs('.fgpx-share-copy', root);
    if (copyBtn) {
      copyBtn.setAttribute('data-share-url', pageUrl);
    }
  }

  /**
   * Initialize gallery UI and logic for a root element
   * @param {HTMLElement} root
   * @param {object} cfg
   */
  function initGallery(root, cfg) {
    applyGalleryTheme(root, cfg);

    function resolvePerPageValue() {
      var raw = cfg && cfg.perPage;
      if (!isFinite(Number(raw)) || Number(raw) <= 0) {
        raw = cfg && cfg.per_page;
      }
      var n = Number(raw);
      if (!isFinite(n) || n <= 0) {
        return null;
      }
      return Math.max(1, Math.min(48, n | 0));
    }

    var resolvedPerPage = resolvePerPageValue();

    var tracks = Array.isArray(cfg.tracks) ? cfg.tracks.slice() : [];
    var galleryRootId = String((root && root.getAttribute('data-root-id')) || '');
    var strings = cfg.strings || {};
    var searchInput = qs('.fgpx-gallery-search', root);
    var sortSelect = qs('.fgpx-gallery-sort', root);
    var results = qs('.fgpx-gallery-results', root);
    var loadMoreBtn = qs('.fgpx-gallery-load-more', root);
    var viewButtons = qsa('.fgpx-gallery-view-btn', root);

    var serverMode =
      !Array.isArray(cfg.tracks) && !!(cfg.endpointUrl || (cfg.ajaxUrl && cfg.ajaxAction));
    if (window.FGPX && window.FGPX.debugEnabled) {
      console.log('[FGPX Gallery] initGallery source check', {
        serverMode: serverMode,
        hasLocalizedTracks: Array.isArray(cfg.tracks),
        localizedTrackCount: Array.isArray(cfg.tracks) ? cfg.tracks.length : 0,
        endpointUrl: cfg.endpointUrl,
        ajaxUrl: cfg.ajaxUrl,
      });
    }
    var viewMode = 'grid';
    var visibleCount = resolvedPerPage || 16;
    var searchTerm = '';
    var sortKey = cfg.defaultSort || 'newest';
    var currentPage = 0;
    var hasMore = false;
    var isLoading = false;
    var loadError = '';
    var searchDebounceId = null;
    var requestToken = 0;
    var activeTrackId = null;
    var revealedModes = { grid: false, list: false };
    var pendingRevealFromIndex = -1;

    function getFiltered() {
      var filtered = tracks;
      if (searchTerm) {
        filtered = filtered.filter(function (track) {
          return getSearchText(track).indexOf(searchTerm) !== -1;
        });
      }
      return sortTracks(filtered, sortKey);
    }

    function render() {
      if (!results) {
        return;
      }

      var filtered = serverMode ? tracks.slice() : getFiltered();
      var listMode = viewMode === 'list';
      var visible = serverMode ? filtered : filtered.slice(0, visibleCount);

      if (loadError) {
        results.innerHTML = '<div class="fgpx-gallery-empty">' + escHtml(loadError) + '</div>';
      } else if (visible.length === 0) {
        results.innerHTML =
          '<div class="fgpx-gallery-empty">' +
          escHtml(strings.noResults || 'No tracks found.') +
          '</div>';
      } else {
        results.innerHTML = visible
          .map(function (track) {
            return buildCard(track, strings, listMode, activeTrackId);
          })
          .join('');
      }

      if (listMode) {
        results.classList.add('fgpx-gallery-results-list');
        results.classList.remove('fgpx-gallery-results-grid');
      } else {
        results.classList.add('fgpx-gallery-results-grid');
        results.classList.remove('fgpx-gallery-results-list');
      }

      if (!loadError && visible.length > 0) {
        var revealFromIndex = pendingRevealFromIndex;
        if (revealFromIndex < 0 && !revealedModes[viewMode]) {
          revealFromIndex = 0;
        }
        applyRevealAnimation(results, revealFromIndex);
        revealedModes[viewMode] = true;
      }
      pendingRevealFromIndex = -1;

      if (loadMoreBtn) {
        if (isLoading) {
          return;
        }

        if (serverMode) {
          loadMoreBtn.hidden = !hasMore || !!loadError;
          loadMoreBtn.textContent = strings.loadMore || 'Load more';
          loadMoreBtn.disabled = false;
        } else if (visible.length < filtered.length) {
          loadMoreBtn.hidden = false;
          loadMoreBtn.textContent = strings.loadMore || 'Load more';
          loadMoreBtn.disabled = false;
        } else {
          loadMoreBtn.hidden = true;
        }
      }
    }

    function loadTracks(reset) {
      if (!serverMode) {
        render();
        return Promise.resolve();
      }

      var nextPage = reset ? 1 : currentPage + 1;
      var currentToken = ++requestToken;
      isLoading = true;
      if (reset) {
        loadError = '';
      }
      setLoadingState(results, loadMoreBtn, true, strings, reset);

      return requestGalleryPayload(cfg, {
        page: nextPage,
        per_page: resolvedPerPage,
        sort: sortKey,
        search: searchTerm,
      })
        .then(function (payload) {
          if (currentToken !== requestToken) {
            return;
          }

          var items = Array.isArray(payload && payload.items) ? payload.items : [];
          if (!resolvedPerPage) {
            var pp = Number(payload && payload.pagination && payload.pagination.perPage);
            if (isFinite(pp) && pp > 0) {
              resolvedPerPage = Math.max(4, Math.min(48, pp | 0));
            }
          }
          tracks = reset ? items : tracks.concat(items);
          pendingRevealFromIndex = reset ? -1 : Math.max(0, tracks.length - items.length);
          currentPage = nextPage;
          hasMore = !!(payload && payload.pagination && payload.pagination.hasMore);
          loadError = '';
        })
        .catch(function () {
          if (currentToken !== requestToken) {
            return;
          }

          if (reset) {
            tracks = [];
          }
          hasMore = false;
          loadError = strings.listLoadFailed || 'Could not load the track list. Please try again.';
        })
        .then(function () {
          if (currentToken !== requestToken) {
            return;
          }
          isLoading = false;
          setLoadingState(results, loadMoreBtn, false, strings, false);
          render();
        });
    }

    function maybeAutoOpenTrack() {
      var initialHash = window.location.hash;

      var consumedMap = window.__FGPXGalleryConsumedHash;
      if (!consumedMap || typeof consumedMap !== 'object') {
        consumedMap = {};
      }

      if (
        !galleryRootId ||
        consumedMap[galleryRootId] ||
        !initialHash ||
        initialHash.indexOf('#track-') !== 0
      ) {
        return Promise.resolve();
      }

      var autoId = Number(initialHash.replace('#track-', ''));
      if (!autoId) {
        return Promise.resolve();
      }

      var autoTrack = findTrackById(tracks, autoId);
      if (autoTrack) {
        window.__FGPXGalleryConsumedHash = consumedMap;
        window.__FGPXGalleryConsumedHash[galleryRootId] = true;
        activeTrackId = autoId;
        render();
        mountPlayer(root, autoTrack, cfg);
        return Promise.resolve();
      }

      if (!serverMode) {
        return Promise.resolve();
      }

      return requestGalleryPayload(cfg, { track_id: autoId })
        .then(function (payload) {
          if (payload && payload.item) {
            window.__FGPXGalleryConsumedHash = consumedMap;
            window.__FGPXGalleryConsumedHash[galleryRootId] = true;
            activeTrackId = autoId;
            render();
            mountPlayer(root, payload.item, cfg);
          }
        })
        .catch(function () {
          return null;
        });
    }

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        searchTerm = normalize(searchInput.value);
        visibleCount = resolvedPerPage || 16;
        if (serverMode) {
          clearTimeout(searchDebounceId);
          // Show loading state during debounce to give immediate feedback
          setLoadingState(results, loadMoreBtn, true, cfg.strings || {}, true);
          searchDebounceId = setTimeout(function () {
            loadTracks(true);
          }, 180);
          return;
        }
        render();
      });
    }

    if (sortSelect) {
      sortSelect.value = sortKey;
      sortSelect.addEventListener('change', function () {
        sortKey = sortSelect.value;
        visibleCount = resolvedPerPage || 16;
        if (serverMode) {
          clearTimeout(searchDebounceId);
          loadTracks(true);
          return;
        }
        render();
      });
    }

    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', function () {
        if (serverMode) {
          if (!isLoading && hasMore) {
            loadTracks(false);
          }
          return;
        }
        pendingRevealFromIndex = visibleCount;
        visibleCount += resolvedPerPage || 16;
        render();
      });
    }

    if (viewButtons.length) {
      updateViewButtons(viewButtons, viewMode);
      viewButtons.forEach(function (btn) {
        btn.addEventListener('click', function () {
          viewMode = btn.getAttribute('data-view') === 'list' ? 'list' : 'grid';
          updateViewButtons(viewButtons, viewMode);
          render();
        });
      });
    }

    root.addEventListener('click', function (ev) {
      var card = closestByClass(ev.target, 'fgpx-gallery-card');
      if (card) {
        var id = Number(card.getAttribute('data-track-id'));
        if (window.FGPX && window.FGPX.debugEnabled) {
          console.log('[FGPX Gallery] Card clicked', { id: id });
        }
        var track = findTrackById(tracks, id);
        if (track) {
          activeTrackId = id;
          render();
          mountPlayer(root, track, cfg);
        }
        return;
      }

      var copyBtn = closestByClass(ev.target, 'fgpx-share-copy');
      if (copyBtn) {
        var shareUrl = copyBtn.getAttribute('data-share-url') || '';
        if (!shareUrl) return;
        copyShortcode(copyBtn, shareUrl, strings);
      }
    });

    root.addEventListener(
      'error',
      function (ev) {
        var target = ev.target;
        if (!target || !target.classList || !target.classList.contains('fgpx-gallery-card-image')) {
          return;
        }

        target.style.display = 'none';
        if (target.parentNode && target.parentNode.classList) {
          target.parentNode.classList.add('is-fallback');
        }
      },
      true
    );

    root.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') {
        return;
      }
      var card = closestByClass(ev.target, 'fgpx-gallery-card');
      if (!card) {
        return;
      }

      ev.preventDefault();
      card.click();
    });

    if (serverMode) {
      loadTracks(true).then(function () {
        return maybeAutoOpenTrack();
      });
      return;
    }

    render();
    maybeAutoOpenTrack();
  }

  /**
   * Boot all gallery roots on DOM ready
   */
  function boot() {
    var roots = qsa('.fgpx-gallery');
    if (!roots.length) {
      return;
    }

    roots.forEach(function (root) {
      var rootId = root.getAttribute('data-root-id');
      var cfg =
        (window.FGPXGalleryInstances && rootId && window.FGPXGalleryInstances[rootId]) ||
        window.FGPXGallery ||
        null;
      if (!cfg) {
        return;
      }
      initGallery(root, cfg);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
