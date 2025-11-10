# Flyover GPX

Upload GPX files and render animated flyover maps with MapLibre and an elevation chart in WordPress.

This plugin adds a Track post type, a simple admin uploader, a REST endpoint serving parsed GPX data, and a front‑end player with play/pause controls, progress bar, and a synced elevation chart.

## Disclaimer
This plugin was developed as some kind of MVP (Minimum Viable Product) in a rapid prototyping process using AI coding tools. As this approach may lead to fast results it may also have a impact on code quality, security, and maintainability. Further more it was only tested on my own wordpress instance. Use at your own risk but feel free to contribute. See Known Bugs section for more details on problems that are known to exist.

## Features

- Animated flyover map (MapLibre GL) with smooth camera
- Elevation-based route coloring – progressive route changes color based on gradient (flat vs steep sections)
- Photos on the map (thumbnails + fullscreen on cue) with image overlay support during video recording
- Labels for maximum speed and elevation
- HUD overlays (speed, distance, elevation, heading) – toggleable
- Multi-weather heatmap overlays with 4 separate colored layers (snow, rain, fog, clouds) using admin-configurable colors
- Day/Night overlay with configurable colors
- Weather visualizations: colored heatmaps, temperature circles, and wind arrows with configurable radius
- Wind analysis: per-point wind speed/direction, wind impact factor chart, wind rose distribution (16 sectors)
- Multi-tab Chart.js visualizations: Elevation, Biometrics (HR/Cadence), Temperature, Power, Wind Impact, Wind Rose, and All Data
- Chart area selection & zoom with reset and synchronized map marker filtering (excludes polar charts)
- Video recording – record MP4/WebM videos of the flyover animation with customizable settings
- Privacy mode (hide first/last N km for playback window only)
- Dark mode‑friendly UI
- Admin tools: Add New Track page, sortable stats, live preview
- Configurable defaults (height, zoom, pitch, chart colors, elevation coloring)
- Custom styling: inline style.json or vector style URL; OSM raster fallback
- Backend GPX simplification enabled by default with dynamic targets for large tracks
- Admin toggle for tile prefetching (reduce third‑party tile requests/quota usage)
- Lazy-loaded chart data with caching for 60% faster initial render on large tracks
- Shortcode to embed anywhere with per-shortcode feature overrides
- WP-CLI support for batch imports and automation
- REST API + AJAX fallback with caching (2h weather cache)

### Player UX

- Dark splash overlay with Play; hidden immediately on any Play (map or controls)
- User zoom/rotate allowed during playback
- Click progress bar to seek; camera moves to the marker
- Chart: vertical cursor + position dot; secondary speed line (km/h) on right axis
- Optional top x‑axis shows distance (km) while primary x‑axis is time
- Auto zoom‑out to full bounds at the end; default zoom restored on restart
- Initial stopped view fits the full track; on Play, the map smoothly zooms in

## Demo

### Screenshots

<div align="center" style="display: flex; flex-wrap: wrap; justify-content: center; gap: 20px; margin: 20px 0;">
  <div style="flex: 0 0 30%; min-width: 250px; margin-bottom: 20px;">
    <img src="demo/screenshot1.jpg" alt="Main interface with map and charts" style="width: 100%; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);" />
    <p style="text-align: center; margin: 8px 0 0; color: #666; font-size: 0.9em;">Main interface with map and charts</p>
  </div>
  <div style="flex: 0 0 30%; min-width: 250px; margin-bottom: 20px;">
    <img src="demo/screenshot2.jpg" alt="Photos on map" style="width: 100%; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);" />
    <p style="text-align: center; margin: 8px 0 0; color: #666; font-size: 0.9em;">Photos on map</p>
  </div>
  <div style="flex: 0 0 30%; min-width: 250px; margin-bottom: 20px;">
    <img src="demo/screenshot3.jpg" alt="Weather & Wind analysis" style="width: 100%; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);" />
    <p style="text-align: center; margin: 8px 0 0; color: #666; font-size: 0.9em;">Weather & Wind analysis</p>
  </div>
  <div style="flex: 0 0 30%; min-width: 250px; margin-bottom: 20px;">
    <img src="demo/screenshot4.jpg" alt="Elevation highlighted on map" style="width: 100%; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);" />
    <p style="text-align: center; margin: 8px 0 0; color: #666; font-size: 0.9em;">Elevation highlighted on map</p>
  </div>
  <div style="flex: 0 0 30%; min-width: 250px; margin-bottom: 20px;">
    <img src="demo/screenshot5.jpg" alt="Weather overlay" style="width: 100%; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);" />
    <p style="text-align: center; margin: 8px 0 0; color: #666; font-size: 0.9em;">Weather overlay</p>
  </div>
</div>

### Demo Video
[![Watch the demo video](demo/video1.jpg)](demo/video1.mp4)
*Click the image above to watch the demo video (recorded with plugin internal functionality)*

## Requirements

- WordPress 6.0+
- PHP 7.4+

## Installation

1. Copy the `flyover-gpx` directory into your WordPress `wp-content/plugins` folder.
2. If developing from source, install dependencies:

```bash
cd wp-content/plugins/flyover-gpx
composer install --no-interaction --no-dev
```

3. Activate the plugin in WordPress → Plugins.

## Getting Started

1. Go to Settings → Flyover GPX.
2. Upload a `.gpx` file (≤ 20MB). The plugin parses it, computes stats, and creates a Track post.
3. On the Tracks list, use “Copy Shortcode” to embed it in a page or post.
4. Optionally open “Preview Map” to quickly verify the flyover.

## Shortcode

Embed a track:

```text
[flyover_gpx id="123"]
```

Parameters:

- `id` (required): The Track post ID.
- `style` (optional): `raster` (default) or `vector`.
- `height` (optional): Container height (e.g. `620px`, `60vh`). Default `620px`.
- `zoom` (optional): Initial zoom level. Default is set in Settings → Flyover GPX.
- `style_url` (optional): A MapLibre style URL when `style="vector"`. Ignored if an inline style JSON is configured in settings.
- `privacy` (optional): Override privacy mode for this embed. Accepts `true|false|1|0|yes|no|on|off`. Defaults to the admin setting.
- `privacy_km` (optional): Override privacy distance in kilometers for this embed. Example: `privacy_km="3"`. Defaults to the admin setting.
- `hud` (optional): Toggle the live HUD overlay (speed/distance/elevation/heading). Accepts `true|false|1|0|yes|no|on|off`. Defaults to admin setting.
- `elevation_coloring` (optional): Enable/disable elevation-based route coloring for this embed. Accepts `true|false|1|0|yes|no|on|off`. Defaults to admin setting.
- `speed` (optional): Override default playback speed for this embed. Example: `speed="50"`. Defaults to admin setting.

Additional per-shortcode overrides (all optional, defaulting to admin settings):

- Display & Elevation Coloring
  - `show_labels`: `true|false` – show max elevation/speed labels on chart
  - `elevation_color_flat`: hex color (e.g. `#00ff00`)
  - `elevation_color_steep`: hex color (e.g. `#ff0000`)
- Chart Colors
  - `speed_chart_color`, `cadence_chart_color`, `temperature_chart_color`, `power_chart_color`
  - `wind_impact_chart_color`, `wind_rose_chart_color`
  - `wind_rose_color_north`, `wind_rose_color_south`, `wind_rose_color_east`, `wind_rose_color_west`
- Features
  - `photos_enabled`: `true|false`
  - `weather_visible_by_default`: `true|false`
  - `wind_analysis_enabled`: `true|false`
  - `daynight_enabled`: `true|false` (chart visualization)
  - `daynight_map_enabled`: `true|false` (map overlay)
  - `daynight_visible_by_default`: `true|false`
  - `daynight_map_color`: hex color (night overlay)

Examples:

```text
[flyover_gpx id="123" height="60vh"]
[flyover_gpx id="123" style="vector" style_url="https://demostyle.server/styles/outdoors/style.json"]
[flyover_gpx id="123" privacy="true" privacy_km="2.5"]
[flyover_gpx id="123" hud="false"]
[flyover_gpx id="123" elevation_coloring="true" speed="75"]
[flyover_gpx id="123" show_labels="true" speed_chart_color="#1976d2" power_chart_color="#059669"]
[flyover_gpx id="123" wind_analysis_enabled="true" wind_impact_chart_color="#ff6b35" wind_rose_chart_color="#4ecdc4"]
```

Notes:

- If a vector `style_url` fails to load, the player falls back to OSM raster tiles.
- The container element id is fixed to `fgpx-app` (one instance per page is supported).
- Disabling tile prefetching sets MapLibre’s `prefetchZoomDelta` to 0 and skips prewarm to minimize extra requests.

### Inline Style JSON (Admin)

You can paste a complete MapLibre `style.json` into Settings → Flyover GPX → Shortcode Defaults → “Inline style JSON (optional)”.

- If present, this inline style is used for all players and takes precedence over the `style_url` and raster default.
- If blank, the player uses `style="vector"` + `style_url="..."` when provided; otherwise it falls back to OSM raster.

Example minimal style JSON with OSM raster source (only for dev, does not provide all features):

```json
{
  "version": 8,
  "name": "FGPX Raster Minimal",
  "sources": {
    "osm": {
      "type": "raster",
      "tiles": ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      "tileSize": 512,
      "minzoom": 0,
      "maxzoom": 18,
      "attribution": "© OpenStreetMap contributors"
    }
  },
  "layers": [
    { "id": "background", "type": "background", "paint": { "background-color": "#000" } },
    {
      "id": "osm",
      "type": "raster",
      "source": "osm",
      "paint": { "raster-fade-duration": 0 }
    }
  ]
}
```

Example style for 3D terrain rendering and points of interrest (for all features):

```json
{
  "version": 8,
  "glyphs": "https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=YOUR_KEY",
  "sources": {
    "terrain": {
      "type": "raster-dem",
      "url": "https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=YOUR_KEY",
      "tileSize": 512
    },
    "satellite": {
      "type": "raster",
      "tiles": [
        "https://api.maptiler.com/maps/satellite/{z}/{x}/{y}.jpg?key=YOUR_KEY"
      ],
      "tileSize": 512,
      "minzoom": 0,
      "maxzoom": 20
    },
    "openmaptiles": {
      "type": "vector",
      "url": "https://api.maptiler.com/tiles/v3/tiles.json?key=YOUR_KEY"
    }
  },
  "layers": [
    {
      "id": "bg",
      "type": "background",
      "paint": { "background-color": "#000000" }
    },
    {
      "id": "satellite",
      "type": "raster",
      "source": "satellite",
      "minzoom": 0,
      "maxzoom": 20,
      "paint": {
        "raster-fade-duration": 350
      }
    },
    {
      "id": "cycleways",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "any",
        ["==", ["get", "class"], "cycleway"],
        [
          "all",
          ["==", ["get", "class"], "path"],
          ["in", ["get", "bicycle"], ["literal", ["yes", "designated", "official"]]]
        ]
      ],
      "layout": {
        "line-cap": "round",
        "line-join": "round"
      },
      "paint": {
        "line-color": "#00c853",
        "line-width": 2,
        "line-blur": 0.2
      }
    },
    {
      "id": "place-labels",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "place",
      "layout": {
        "text-field": ["get", "name"],
        "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
        "text-size": 14,
        "text-anchor": "center",
        "text-allow-overlap": false
      },
      "paint": {
        "text-color": "#ffffff",
        "text-halo-color": "#000000",
        "text-halo-width": 1
      }
    },
    {
      "id": "water-name-labels",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "water_name",
      "layout": {
        "text-field": ["get", "name"],
        "text-font": ["Open Sans Italic", "Arial Unicode MS Regular"],
        "text-size": 12,
        "symbol-placement": "line",
        "text-allow-overlap": false
      },
      "paint": {
        "text-color": "#4FC3F7",
        "text-halo-color": "#000000",
        "text-halo-width": 0.5
      }
    }
  ]
}
```

## Low‑request styles (copy/paste into “Inline style JSON”)

Downstripped raster style (fewest requests, no API key, no labels)
- Single raster source (OSM), no glyphs/sprites/vector/DEM
- 512px tiles and maxzoom 18 to reduce the number of tile requests
- Best choice when you’re hitting MapTiler limits
- Adds global DEM (Terrarium encoding) to enable 3D terrain without an API key
- Limits DEM to maxzoom 12 and keeps 256px raster base to control request volume
- Note: enabling terrain increases requests versus the minimal style

```json
{
  "version": 8,
  "name": "FGPX Raster + Terrain (Terrarium)",
  "sources": {
    "osm": {
      "type": "raster",
      "tiles": ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      "tileSize": 512,
      "minzoom": 0,
      "maxzoom": 18,
      "attribution": "© OpenStreetMap contributors"
    },
    "terrain": {
      "type": "raster-dem",
      "tiles": ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      "encoding": "terrarium",
      "tileSize": 256,
      "minzoom": 0,
      "maxzoom": 12,
      "attribution": "© Mapzen, AWS Terrain Tiles"
    }
  },
  "layers": [
    { "id": "background", "type": "background", "paint": { "background-color": "#000" } },
    {
      "id": "osm",
      "type": "raster",
      "source": "osm",
      "paint": { "raster-fade-duration": 0 }
    }
  ],
  "terrain": { "source": "terrain", "exaggeration": 1.0 }
}
```

Notes
- These styles intentionally remove labels/icons to eliminate glyph and sprite requests.
- Using 512px raster tiles and capping maxzoom saves requests, especially at higher zooms.
- If you need satellite, swap the `tiles` URL under `osm` with a satellite raster provider, but check usage terms/quotas.
- For the fewest requests overall, use the “Raster Minimal” style and disable tile prefetching in the plugin settings.

## Admin UI

- Tracks → Add New Track: dedicated upload page for creating track posts (simpler than replace workflows)
- Settings → Flyover GPX: configure defaults (map style/height/zoom/pitch), privacy, HUD, elevation coloring, chart colors, wind & weather, day/night, performance, and debug
- Tracks list: sortable columns for distance, duration, elevation gain, points; quick actions for Copy Shortcode and Preview Map
- Track edit screen: “Track Preview” metabox with live rendering of the current settings
- Backend GPX simplification: enabled by default with intelligent targets; API returns simplified geometry; frontend renders as delivered
- Tile prefetching: toggle to reduce external map requests; when disabled, MapLibre prefetch is turned off to minimize third-party tile usage

## Front‑end Player

- Controls: Play, Pause, Restart, speed selector (1×, 10×, 25×, 50×, 100×, 250×)
- Progress bar shows current position along the route.
- Click the progress bar to seek; camera and chart position update immediately.
- Elevation chart syncs a vertical cursor (and dot) with route progress.
- Uses MapLibre GL with an accessible OSM raster default and optional vector style.
- Optional photo thumbnails on the map; hover enlarges, click opens fullscreen; on playback the photo shows fullscreen for ~3s when its timestamp is reached.
- Optional privacy window: playback starts after the first N km and ends N km before the finish; photos/overlays follow the playback window; statistics always use full GPX.
- When backend simplification is enabled, the API returns simplified geometry and includes `"simplified": true`.
- Chart tabs: Elevation, Biometrics (HR/Cadence), Temperature, Power, Wind Impact, Wind Rose, All Data
- Chart zoom: click-drag to select an area, release to zoom; reset button appears when zoomed; zoom resets when switching tabs; polar charts (wind rose) skip zoom
- Performance: lazy data processing per tab with caching; significantly faster initial load on large tracks
- Wind visualizations: wind impact factor (line), wind speed overlay (dual axis), wind rose (polar area)
- Multi-weather overlays: 4 separate heatmap layers (snow/rain/fog/clouds) with priority-based filtering and admin-configurable colors; toggle buttons with default visibility configurable per shortcode

## REST API

- Base: `/wp-json/fgpx/v1`
- Endpoint: `GET /track/{id}`
```json
{
  "id": 123,
  "name": "my-ride.gpx",
  "stats": {
    "total_distance_m": 42195.3,
    "moving_time_s": 10800,
    "average_speed_m_s": 3.9,
    "elevation_gain_m": 520,
    "min_elevation_m": 120,
    "max_elevation_m": 980
  },
  "geojson": {
    "type": "LineString",
    "coordinates": [ [lon, lat, ele], ... ],
    "properties": {
      "timestamps": ["2024-02-01T10:00:00Z", null, ...],
      "cumulativeDistance": [0, 12.3, ...],
      "heartRates": [152, 154, null, ...],
      "cadences": [88, 86, null, ...],
      "temperatures": [21.4, 21.6, 21.5, ...],
      "powers": [210, 215, 205, ...],
      "windSpeeds": [5.2, 4.8, 5.0, ...],
      "windDirections": [220, 225, 230, ...],
      "windImpacts": [0.92, 1.05, 1.02, ...]
    }
  },
  "bounds": [minLon, minLat, maxLon, maxLat],
  "points_count": 12345,
  "simplified": true,
  "photos": [
    {
      "id": 49785,
      "title": "IMG_20250824_112847a",
      "caption": "Carolinen Hütte",
      "description": "Die Carolinen Hütte bei Rohrbach",
      "lat": 49.000894,
      "lon": 11.381095,
      "timestamp": "2025-08-24T11:28:47+00:00",
      "thumbUrl": "https://.../IMG_2025...-225x300.jpg",
      "fullUrl": "https://.../IMG_2025...-768x1024.jpg"
    }
  ]
}
```

## Privacy Mode

- Enable in Settings → Flyover GPX → “Enable privacy mode”.
- Configure “Privacy distance (km)” (default 3). Playback will start after the first N km and finish N km before the end.
- The map camera, progress line, chart cursor, photo cues, and weather overlays all respect the trimmed window. Stats (distance, time, avg speed, gain) remain computed from the full GPX.
- Shortcode/CLI can override privacy enablement and distance on a per-embed basis.

## WP‑CLI

Import GPX Files (creates a Track; optionally inserts a shortcode into an existing post and publishes it):

```bash
wp fgpx import --file=/abs/path/ride.gpx [options]
```

**Options:**

```bash
--file=<path>                         # required, absolute path to GPX file
--post=<id>                           # post ID to embed shortcode into
--title=<string>                      # optional track title (defaults to filename)
--privacy=<on|off>                    # privacy mode toggle
--privacy-km=<float>                  # privacy distance in km
--hud=<on|off>                        # HUD overlay toggle
--elevation-coloring=<on|off>         # elevation-based coloring toggle
--speed=<int>                         # default playback speed
--show-labels=<on|off>                # show max elev/speed labels
--elevation-color-flat=<hex>          # flat terrain color
--elevation-color-steep=<hex>         # steep terrain color
--speed-chart-color=<hex>             # speed chart color
--cadence-chart-color=<hex>           # cadence chart color
--temperature-chart-color=<hex>       # temperature chart color
--power-chart-color=<hex>             # power chart color
--wind-impact-chart-color=<hex>       # wind impact chart color
--wind-rose-chart-color=<hex>         # wind rose chart color (default)
--wind-rose-color-north=<hex>         # wind rose north color
--wind-rose-color-south=<hex>         # wind rose south color
--wind-rose-color-east=<hex>          # wind rose east color
--wind-rose-color-west=<hex>          # wind rose west color
--photos-enabled=<on|off>             # enable photo thumbnails/overlay
--weather-visible-by-default=<on|off> # weather buttons visibility at load
--wind-analysis-enabled=<on|off>      # enable wind impact analysis
--daynight-enabled=<on|off>           # enable day/night chart visualization
--daynight-map-enabled=<on|off>       # enable day/night map overlay
--daynight-visible-by-default=<on|off># default visibility for day/night overlay
--daynight-map-color=<hex>            # night overlay color
--publish                              # publish the target post after shortcode insertion
```

**Examples:**

```bash
# Simple import
wp fgpx import --file=/uploads/ride.gpx

# Import with shortcode insertion and common toggles
wp fgpx import --file=/uploads/ride.gpx --post=123 --publish \
  --title="Mountain Ride" --privacy=on --privacy-km=3 --hud=on --elevation-coloring=on --speed=75

# Customize visuals and features per-embed
wp fgpx import --file=/uploads/ride.gpx --post=123 \
  --show-labels=on --speed-chart-color="#1976d2" --power-chart-color="#059669" \
  --photos-enabled=on --weather-visible-by-default=on --daynight-enabled=on --daynight-map-color="#000080"

# Wind analysis focused
wp fgpx import --file=/uploads/ride.gpx --post=123 \
  --wind-analysis-enabled=on --wind-impact-chart-color="#ff6b35" --wind-rose-chart-color="#4ecdc4"
```

## Theming

- Minimal CSS in `flyover-gpx/assets/css/front.css` with variables like `--fgpx-border`, `--fgpx-card-bg` for light/dark.
- The player respects `prefers-color-scheme` and adapts colors accordingly.

## Development

- Source code uses a small PHP core and a single front‑end JS (`assets/js/front.js`).
- PHP GPX parsing via `sibyxs/phpgpx` (declared in `composer.json`).
- Autoloading is PSR‑4 (`FGpx\\` → `includes/`). If `vendor/autoload.php` is missing, the plugin shows an admin notice to run Composer.
- Debug logging systems: JavaScript (`DBG`) respects `FGPX.debugLogging`; PHP uses `ErrorHandler::debug()`/`warning()` with admin toggle
- Performance settings: backend simplification enabled by default with dynamic target; lazy viewport loading; prefetch toggle; asset fallback detection
- Frontend caching: localStorage cache for processed track data with automatic expiry and safe fallback

Build/Install locally:

```bash
composer install
```

Folder layout:

```text
flyover-gpx/
  flyover-gpx.php
  includes/
    Options.php
    ErrorHandler.php
    AssetManager.php
    DatabaseOptimizer.php
    Plugin.php
    Rest.php
    Admin.php
    CLI.php
  assets/
    css/front.css
    js/front.js
  composer.json
```

## Video Recording

The plugin includes built-in video recording capabilities to create MP4/WebM videos of your flyover animations:

- **Record Button**: Available in the player controls during playback
- **Format Support**: Automatically detects and uses the best supported format (MP4 H.264, WebM VP9, or WebM VP8)
- **Image Overlay**: Photos and markers are included in the recorded video
- **Customizable Settings**: Recording quality and frame rate can be configured
- **Download**: Completed videos are automatically downloaded to your device

To record a video:
1. Start playback of your GPX track
2. Click the record button in the player controls
3. The video will capture the entire flyover animation
4. Download begins automatically when recording completes

Notes:

- Recording includes map, route, HUD, chart cursor, and active overlays (photos/weather/day-night)
- Requires a modern browser with MediaRecorder API; codec availability varies by browser/OS

## WP-CLI Support

See the unified WP‑CLI section above (Import GPX Files) for the full list of options and examples.

## Limitations & Notes

- One player instance per page (container id is fixed to `fgpx-app`).
- Upload limit: 20MB per GPX file.
- Large tracks are simplified on the backend by default; dynamic targets avoid over/under‑simplification.
- Local caching is best‑effort and expires automatically; the player gracefully falls back to live fetch.
- Weather data is cached server‑side (≈2h) to limit API calls.
- Chart zoom is unavailable for polar charts (wind rose) by design.
- Video recording requires a modern browser with MediaRecorder API support.

## Known Bugs
- All Data Chart is not showing any data anymore
- Day/Night view (in chart) is not working as expected

## License

MIT. See `LICENSE` if provided; otherwise, embed licensing details as appropriate for your project.


