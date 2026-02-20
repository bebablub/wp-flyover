# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Flyover GPX is a WordPress plugin that lets users upload GPX files and render them as interactive animated flyover maps with elevation charts, weather data, photo integration, and video recording. The actual plugin lives in the `flyover-gpx/` subdirectory.

## Setup & Commands

```bash
# Install dependencies (from plugin directory)
cd flyover-gpx && composer install --no-interaction --no-dev

# Production install (same, no dev deps exist yet)
composer install --no-dev
```

There is no build step, test suite, or linter configured. JavaScript and CSS are served directly without transpilation or minification.

## Architecture

### Directory Layout

The repo root contains `README.md`, `LICENSE`, `demo/`, and the plugin in `flyover-gpx/`.

### PHP (Backend)

All PHP classes are in `flyover-gpx/includes/` under the `FGpx` namespace (PSR-4: `FGpx\` → `includes/`). Classes are manually required in dependency order in `flyover-gpx.php` rather than relying solely on Composer autoload.

**Bootstrap order** (`plugins_loaded` hook):
1. `ErrorHandler::init()` — file-based logging to `wp-content/uploads/flyover-gpx-logs/`
2. `DatabaseOptimizer::init()` — post meta preloading, N+1 query prevention
3. `Plugin::register()` — registers `fgpx_track` CPT, `[flyover_gpx]` shortcode, asset enqueuing
4. `Rest::register()` — REST endpoint `GET /wp-json/fgpx/v1/track/{id}` with AJAX fallback
5. `Admin::register()` — settings page, upload handler, bulk actions
6. `CLI::register()` — WP-CLI `wp fgpx import` command (only when `WP_CLI` is defined)

**Key classes:**
- `Options` — centralized cached option management (50+ settings, single `getAll()` DB call)
- `AssetManager` — multi-tier CDN fallback system for MapLibre GL JS, Chart.js
- `Rest` — GPX data endpoint with RDP simplification, relative coordinate encoding, 2h transient cache, EXIF photo extraction

### JavaScript (Frontend)

- `front.js` (~8750 LOC) — monolithic IIFE containing the entire player: MapLibre map, Chart.js visualizations (7 tabs), playback controls, photo overlay, weather heatmaps, day/night overlay, video recording via MediaRecorder API; fullscreen button, click-on-chart-to-seek, GPX download button
- `fgpx-lazy.js` (128 LOC) — IntersectionObserver-based lazy loader; loads all heavy assets when any `.fgpx` container enters the viewport; supports multiple shortcodes
- `suncalc.js` — day/night solar calculations
- `admin.js` — admin UI handlers

Configuration is passed from PHP via `wp_localize_script` into `window.FGPX`, which includes `boot()` as the initialization entry point. Per-instance overrides for the 2nd+ shortcode are stored in `window.FGPX.instances[containerId]` and merged via `Object.assign` inside `initContainer(el)`.

### Asset Loading

Two modes controlled by admin setting `fgpx_lazy_viewport` (default: enabled):
- **Lazy**: only `fgpx-lazy.js` loads initially; full assets load on viewport intersection
- **Immediate**: all assets enqueued upfront

CDN assets (MapLibre, Chart.js) use a fallback chain: primary CDN → fallback CDN 1 → fallback CDN 2, with optional client-side detection.

### Data Flow

1. GPX file uploaded → parsed by `sibyx/phpgpx` → stats stored as post meta on `fgpx_track` CPT
2. Shortcode `[flyover_gpx id="123"]` renders a `<div id="fgpx-app">` container (first instance); additional shortcodes on the same page get `id="fgpx-app-2"`, `id="fgpx-app-3"`, etc.
3. Frontend fetches `GET /wp-json/fgpx/v1/track/{id}` → receives GeoJSON with properties (timestamps, biometrics, weather, etc.)
4. Response uses relative coordinate encoding (~40-60% payload reduction) and backend RDP simplification

### Caching Strategy

- Server: WordPress transients (2h) for REST responses; `Options::getAll()` caches all settings per request
- Client: localStorage with auto-expiry for processed track data
- Cache invalidation on post save/meta update

## Conventions

- All PHP files use `declare(strict_types=1)` and type hints
- WordPress escaping functions used throughout (`esc_html__`, `esc_attr`, `sanitize_*`)
- Nonce verification and `current_user_can('manage_options')` checks on all admin actions
- Multiple `[flyover_gpx]` shortcodes per page are supported; first instance uses `id="fgpx-app"`, subsequent ones use `id="fgpx-app-N"` with per-instance config in `window.FGPX.instances`
- Debug logging: PHP via `ErrorHandler::debug()`, JS via `DBG()` (both controlled by admin toggle)
- Plugin constants: `FGPX_VERSION`, `FGPX_DIR_PATH`, `FGPX_DIR_URL`, `FGPX_FILE`

## Shortcode Attributes

The `[flyover_gpx]` shortcode accepts 30+ attributes for per-embed overrides (id, style, height, zoom, speed, privacy, hud, elevation_coloring, chart colors, feature toggles, gpx_download). All optional attributes fall back to admin settings in `Options`.

## Features (v1.0.3)

- **Fullscreen button** — MapLibre `FullscreenControl` added to map
- **Click-on-chart-to-seek** — clicking the elevation/speed chart seeks playback to that position
- **GPX download button** — optional `⬇` button; enabled via `fgpx_gpx_download_enabled` setting or `gpx_download="1"` shortcode attribute; served via AJAX with nonce authentication
- **Multiple shortcodes per page** — `Plugin::$instanceCounter` issues unique IDs; `initContainer(el)` merges per-instance overrides; `fgpx-lazy.js` observes all `.fgpx` containers
