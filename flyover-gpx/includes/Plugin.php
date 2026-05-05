<?php

declare(strict_types=1);

namespace FGpx;

if (!\defined('ABSPATH')) {
    exit;
}

/**
 * Core plugin class: registers CPT, shortcode, and frontend assets.
 */
final class Plugin
{
    /**
     * Per-page instance counter for unique container IDs.
     */
    private static int $instanceCounter = 0;

    /**
     * Register WordPress hooks.
     */
    public function register(): void
    {
        \add_action('init', [$this, 'register_post_type']);
        \add_action('init', [$this, 'register_shortcode']);
        \add_action('wp_enqueue_scripts', [$this, 'register_assets']);
    }

    /**
     * Register the custom post type for GPX tracks.
     */
    public function register_post_type(): void
    {
        $labels = [
            'name' => \esc_html__('Tracks', 'flyover-gpx'),
            'singular_name' => \esc_html__('Track', 'flyover-gpx'),
            'add_new' => \esc_html__('Add New', 'flyover-gpx'),
            'add_new_item' => \esc_html__('Add New Track', 'flyover-gpx'),
            'edit_item' => \esc_html__('Edit Track', 'flyover-gpx'),
            'new_item' => \esc_html__('New Track', 'flyover-gpx'),
            'view_item' => \esc_html__('View Track', 'flyover-gpx'),
            'search_items' => \esc_html__('Search Tracks', 'flyover-gpx'),
            'not_found' => \esc_html__('No tracks found', 'flyover-gpx'),
            'not_found_in_trash' => \esc_html__('No tracks found in Trash', 'flyover-gpx'),
            'all_items' => \esc_html__('All Tracks', 'flyover-gpx'),
            'menu_name' => \esc_html__('Flyover GPX', 'flyover-gpx'),
        ];

        $args = [
            'labels' => $labels,
            'public' => false,
            'show_ui' => true,
            'show_in_menu' => true,
            'menu_icon' => 'dashicons-location',
            'supports' => ['title'],
            'show_in_rest' => true,
            'capability_type' => 'post',
            'map_meta_cap' => true,
        ];

        \register_post_type('fgpx_track', $args);
    }

    /**
     * Register shortcode.
     */
    public function register_shortcode(): void
    {
        \add_shortcode('flyover_gpx', [$this, 'render_shortcode']);
    }

    /**
     * Register, but do not enqueue, frontend assets. Enqueue only in shortcode.
     */
    public function register_assets(): void
    {
        // Register external assets with fallback support
        AssetManager::registerAssets();

        // Plugin assets
        \wp_register_style(
            'fgpx-front',
            \esc_url_raw(\trailingslashit(FGPX_DIR_URL) . 'assets/css/front.css'),
            [],
            FGPX_VERSION
        );

        // SunCalc.js for day/night calculations
        \wp_register_script(
            'suncalc',
            \esc_url_raw(\trailingslashit(FGPX_DIR_URL) . 'assets/js/suncalc.js'),
            [],
            FGPX_VERSION,
            true
        );

        \wp_register_script(
            'fgpx-front',
            \esc_url_raw(\trailingslashit(FGPX_DIR_URL) . 'assets/js/front.js'),
            ['maplibre-gl-js', 'chartjs', 'suncalc'],
            FGPX_VERSION,
            true
        );

        \wp_register_script(
            'fgpx-lazy',
            \esc_url_raw(\trailingslashit(FGPX_DIR_URL) . 'assets/js/fgpx-lazy.js'),
            [],
            FGPX_VERSION,
            true
        );
    }

    /**
     * Render the [flyover_gpx] shortcode.
     *
     * @param array<string, mixed> $atts
     */
    public function render_shortcode(array $atts = []): string
    {
        // Get all options in a single cached call
        $options = Options::getAll();

        self::$instanceCounter++;
        $isFirstInstance = self::$instanceCounter === 1;
        $containerId = $isFirstInstance ? 'fgpx-app' : 'fgpx-app-' . self::$instanceCounter;

        $defaults = [
            'id' => '',
            'style' => $options['fgpx_default_style'],
            'height' => $options['fgpx_default_height'],
            'style_url' => $options['fgpx_default_style_url'],
            'zoom' => $options['fgpx_default_zoom'],
            'speed' => $options['fgpx_default_speed'],
            // Shortcode overrides for privacy mode (optional)
            'privacy' => '',
            'privacy_km' => '',
            // Shortcode override for HUD overlay (optional)
            'hud' => '',
            // Shortcode override for elevation coloring (optional)
            'elevation_coloring' => '',
            // Shortcode overrides for display settings
            'show_labels' => '',
            // Shortcode overrides for elevation colors
            'elevation_color_flat' => '',
            'elevation_color_steep' => '',
            // Shortcode overrides for chart colors
            'speed_chart_color' => '',
            'cadence_chart_color' => '',
            'temperature_chart_color' => '',
            'power_chart_color' => '',
            'wind_impact_chart_color' => '',
            'wind_rose_chart_color' => '',
            // Shortcode overrides for wind rose directional colors
            'wind_rose_color_north' => '',
            'wind_rose_color_south' => '',
            'wind_rose_color_east' => '',
            'wind_rose_color_west' => '',
            // Shortcode overrides for feature toggles
            'photos_enabled' => '',
            'photo_order_mode' => '',
            'arrows_enabled' => '',
            'arrows_km' => '',
            'weather_visible_by_default' => '',
            'wind_analysis_enabled' => '',
            'daynight_enabled' => '',
            'daynight_map_enabled' => '',
            'daynight_visible_by_default' => '',
            'daynight_map_color' => '',
        ];

        $atts = \shortcode_atts($defaults, $atts, 'flyover_gpx');

        $trackId = (string) isset($atts['id']) ? $atts['id'] : '';
        $trackId = \preg_replace('/[^0-9]/', '', (string) $trackId) ?? '';
        $mapStyle = \sanitize_key((string) $atts['style']);
        // Validate style mode (backward compat: map old 'raster'/'vector' to new modes)
        if ($mapStyle === 'raster') { $mapStyle = 'default'; }
        if ($mapStyle === 'vector') { $mapStyle = 'url'; }
        if (!\in_array($mapStyle, ['default', 'url', 'inline'], true)) { $mapStyle = 'default'; }
        
        $height = \sanitize_text_field((string) $atts['height']);
        $styleUrlRaw = \trim((string) ($atts['style_url'] ?? ''));
        $styleUrl = '';
        if ($styleUrlRaw !== '') {
            if (\strpos($styleUrlRaw, SmartApiKeys::PLACEHOLDER) !== false) {
                // Allow placeholder templates and sanitize after substitution.
                $styleUrl = \preg_match('#^https?://#i', $styleUrlRaw) ? $styleUrlRaw : '';
            } else {
                $maybe = \esc_url_raw($styleUrlRaw);
                if (\is_string($maybe) && $maybe !== '') {
                    $styleUrl = $maybe;
                }
            }
        }

        if ($trackId === '') {
            return '';
        }

        $resolvedStyle = SmartApiKeys::resolveStyle(
            (string) $options['fgpx_default_style_json'],
            $styleUrl,
            (string) ($options['fgpx_smart_api_keys_mode'] ?? SmartApiKeys::MODE_OFF),
            (string) ($options['fgpx_smart_api_keys_pool'] ?? '')
        );
        $resolvedStyleJson = (string) ($resolvedStyle['styleJson'] ?? '');
        $resolvedStyleUrl = (string) ($resolvedStyle['styleUrl'] ?? '');
        $resolvedApiKey = isset($resolvedStyle['resolvedKey']) ? (string) $resolvedStyle['resolvedKey'] : '';
        if ($resolvedStyleUrl !== '') {
            if (\strpos($resolvedStyleUrl, SmartApiKeys::PLACEHOLDER) !== false) {
                // Placeholder survived (mode=off or empty pool) — discard rather than
                // passing a broken esc_url_raw-encoded URL to MapLibre.
                $styleUrl = '';
            } else {
                $maybeResolvedUrl = \esc_url_raw($resolvedStyleUrl);
                if (\is_string($maybeResolvedUrl) && $maybeResolvedUrl !== '') {
                    $styleUrl = $maybeResolvedUrl;
                }
            }
        }

        $lazyViewportEnabled = $options['fgpx_lazy_viewport'] === '1';

        if (!$lazyViewportEnabled) {
            \wp_enqueue_style('maplibre-gl-css');
            \wp_enqueue_style('fgpx-front');
            \wp_enqueue_script('maplibre-gl-js');
            \wp_enqueue_script('chartjs');
            \wp_enqueue_script('fgpx-front');
            
            // Add client-side fallback detection for immediate loading (if enabled)
            if ($options['fgpx_asset_fallbacks_enabled'] === '1') {
                AssetManager::addFallbackScript('fgpx-front');
            }
        } else {
            \wp_enqueue_style('fgpx-front');
            \wp_enqueue_script('fgpx-lazy');
            
            // Add client-side fallback detection for lazy loading (if enabled)
            if ($options['fgpx_asset_fallbacks_enabled'] === '1') {
                AssetManager::addFallbackScript('fgpx-lazy');
            }
        }

        // Resolve privacy settings with shortcode overrides
        $privacyOptionEnabled = $options['fgpx_privacy_enabled'] === '1';
        $privacyOptionKm = (float) $options['fgpx_privacy_km'];

        $privacyAttrRaw = (string) ($atts['privacy'] ?? '');
        $privacyAttr = \strtolower(\trim($privacyAttrRaw));
        $privacyOverride = null;
        if ($privacyAttr !== '') {
            if (\in_array($privacyAttr, ['1','true','yes','on'], true)) { $privacyOverride = true; }
            elseif (\in_array($privacyAttr, ['0','false','no','off'], true)) { $privacyOverride = false; }
        }

        $privacyKmAttrRaw = (string) ($atts['privacy_km'] ?? '');
        $privacyKmOverride = null;
        if ($privacyKmAttrRaw !== '' && \is_numeric($privacyKmAttrRaw)) {
            $privacyKmOverride = (float) $privacyKmAttrRaw;
        }

        $privacyEnabledFinal = \is_bool($privacyOverride) ? $privacyOverride : $privacyOptionEnabled;
        $privacyKmFinal = \is_null($privacyKmOverride) ? $privacyOptionKm : (float) $privacyKmOverride;

        // HUD overlay resolve (admin default with shortcode override)
        $hudOptionEnabled = $options['fgpx_hud_enabled'] === '1';
        $hudAttrRaw = (string) ($atts['hud'] ?? '');
        $hudAttr = \strtolower(\trim($hudAttrRaw));
        $hudOverride = null;
        if ($hudAttr !== '') {
            if (\in_array($hudAttr, ['1','true','yes','on'], true)) { $hudOverride = true; }
            elseif (\in_array($hudAttr, ['0','false','no','off'], true)) { $hudOverride = false; }
        }
        $hudEnabledFinal = \is_bool($hudOverride) ? $hudOverride : $hudOptionEnabled;

        // Elevation coloring resolve (admin default with shortcode override)
        $elevationColoringOptionEnabled = $options['fgpx_elevation_coloring'] === '1';
        $elevationColoringAttrRaw = (string) ($atts['elevation_coloring'] ?? '');
        $elevationColoringAttr = \strtolower(\trim($elevationColoringAttrRaw));
        $elevationColoringOverride = null;
        if ($elevationColoringAttr !== '') {
            if (\in_array($elevationColoringAttr, ['1','true','yes','on'], true)) { $elevationColoringOverride = true; }
            elseif (\in_array($elevationColoringAttr, ['0','false','no','off'], true)) { $elevationColoringOverride = false; }
        }
        $elevationColoringEnabledFinal = \is_bool($elevationColoringOverride) ? $elevationColoringOverride : $elevationColoringOptionEnabled;

        // Resolve default speed: shortcode override or option
        $speedAttrRaw = (string) ($atts['speed'] ?? '');
        $speedOverride = null;
        if ($speedAttrRaw !== '' && is_numeric($speedAttrRaw)) {
            $val = (int) $speedAttrRaw; if ($val > 0) { $speedOverride = $val; }
        }
        $defaultSpeedFinal = is_null($speedOverride) ? (int) $options['fgpx_default_speed'] : (int) $speedOverride;

        // Helper function for boolean resolution
        $resolveBooleanAttr = function($attrRaw, $optionValue) {
            $attr = \strtolower(\trim($attrRaw));
            if ($attr !== '') {
                if (\in_array($attr, ['1','true','yes','on'], true)) { return true; }
                elseif (\in_array($attr, ['0','false','no','off'], true)) { return false; }
            }
            return $optionValue === '1';
        };

        $resolvePhotoOrderMode = function($attrRaw, $optionValue) {
            $attr = \sanitize_key((string) $attrRaw);
            if (\in_array($attr, ['geo_first', 'time_first'], true)) {
                return $attr;
            }
            $fallback = \sanitize_key((string) $optionValue);
            if (\in_array($fallback, ['geo_first', 'time_first'], true)) {
                return $fallback;
            }
            return 'geo_first';
        };

        $resolveFloatRangeAttr = function($attrRaw, $optionValue, $min, $max) {
            if ($attrRaw !== '' && \is_numeric($attrRaw)) {
                return max($min, min($max, (float) $attrRaw));
            }
            $fallback = (float) $optionValue;
            return max($min, min($max, $fallback));
        };

        // Helper function for color resolution
        $resolveColorAttr = function($attrRaw, $optionValue) {
            $attr = \trim($attrRaw);
            if ($attr !== '') {
                $sanitized = \sanitize_hex_color($attr);
                if ($sanitized !== null) { return $sanitized; }
            }
            return $optionValue;
        };

        // Resolve show labels setting
        $showLabelsFinal = $resolveBooleanAttr((string) ($atts['show_labels'] ?? ''), $options['fgpx_show_labels']);

        // Resolve elevation colors
        $elevationColorFlatFinal = $resolveColorAttr((string) ($atts['elevation_color_flat'] ?? ''), $options['fgpx_elevation_color_flat']);
        $elevationColorSteepFinal = $resolveColorAttr((string) ($atts['elevation_color_steep'] ?? ''), $options['fgpx_elevation_color_steep']);

        // Resolve chart colors
        $speedChartColorFinal = $resolveColorAttr((string) ($atts['speed_chart_color'] ?? ''), $options['fgpx_chart_color2']);
        $cadenceChartColorFinal = $resolveColorAttr((string) ($atts['cadence_chart_color'] ?? ''), $options['fgpx_chart_color_cad']);
        $temperatureChartColorFinal = $resolveColorAttr((string) ($atts['temperature_chart_color'] ?? ''), $options['fgpx_chart_color_temp']);
        $powerChartColorFinal = $resolveColorAttr((string) ($atts['power_chart_color'] ?? ''), $options['fgpx_chart_color_power']);
        $windImpactChartColorFinal = $resolveColorAttr((string) ($atts['wind_impact_chart_color'] ?? ''), $options['fgpx_chart_color_wind_impact']);
        $windRoseChartColorFinal = $resolveColorAttr((string) ($atts['wind_rose_chart_color'] ?? ''), $options['fgpx_chart_color_wind_rose']);

        // Resolve wind rose directional colors
        $windRoseColorNorthFinal = $resolveColorAttr((string) ($atts['wind_rose_color_north'] ?? ''), $options['fgpx_wind_rose_color_north']);
        $windRoseColorSouthFinal = $resolveColorAttr((string) ($atts['wind_rose_color_south'] ?? ''), $options['fgpx_wind_rose_color_south']);
        $windRoseColorEastFinal = $resolveColorAttr((string) ($atts['wind_rose_color_east'] ?? ''), $options['fgpx_wind_rose_color_east']);
        $windRoseColorWestFinal = $resolveColorAttr((string) ($atts['wind_rose_color_west'] ?? ''), $options['fgpx_wind_rose_color_west']);

        // Resolve feature toggles
        $photosEnabledFinal = $resolveBooleanAttr((string) ($atts['photos_enabled'] ?? ''), $options['fgpx_photos_enabled']);
        $photoOrderModeFinal = $resolvePhotoOrderMode((string) ($atts['photo_order_mode'] ?? ''), $options['fgpx_photo_order_mode'] ?? 'geo_first');
        $arrowsEnabledFinal = $resolveBooleanAttr((string) ($atts['arrows_enabled'] ?? ''), $options['fgpx_arrows_enabled'] ?? '0');
        $arrowsKmFinal = $resolveFloatRangeAttr((string) ($atts['arrows_km'] ?? ''), $options['fgpx_arrows_km'] ?? '5', 0.5, 100.0);
        $gpxDownloadFinal   = $resolveBooleanAttr((string) ($atts['gpx_download'] ?? ''), $options['fgpx_gpx_download_enabled']);
        $weatherVisibleByDefaultFinal = $resolveBooleanAttr((string) ($atts['weather_visible_by_default'] ?? ''), $options['fgpx_weather_visible_by_default']);
        $windAnalysisEnabledFinal = $resolveBooleanAttr((string) ($atts['wind_analysis_enabled'] ?? ''), $options['fgpx_wind_analysis_enabled']);
        $daynightEnabledFinal = $resolveBooleanAttr((string) ($atts['daynight_enabled'] ?? ''), $options['fgpx_daynight_enabled']);
        $daynightMapEnabledFinal = $resolveBooleanAttr((string) ($atts['daynight_map_enabled'] ?? ''), $options['fgpx_daynight_map_enabled']);
        $daynightVisibleByDefaultFinal = $resolveBooleanAttr((string) ($atts['daynight_visible_by_default'] ?? ''), $options['fgpx_daynight_visible_by_default']);

        // Resolve day/night map color
        $daynightMapColorFinal = $resolveColorAttr((string) ($atts['daynight_map_color'] ?? ''), $options['fgpx_daynight_map_color']);

        // Expose prefetch flag to frontend (default on for backward compatibility)
        $prefetchEnabled = $options['fgpx_prefetch_enabled'] === '1';
        $debugLogging = $options['fgpx_debug_logging'] === '1';
        $debugWeatherData = $options['fgpx_debug_weather_data'] === '1';

        // Generate GPX download config if enabled and file exists.
        // Keep nonce out of URL to avoid leaking in logs/referrers/history.
        $gpxDownloadUrl = '';
        $gpxDownloadNonce = '';
        if ($gpxDownloadFinal && $trackId !== '') {
            $filePath = (string) \get_post_meta((int) $trackId, 'fgpx_file_path', true);
            if ($filePath !== '' && \is_readable($filePath)) {
                $gpxDownloadNonce = \wp_create_nonce('fgpx_download_gpx_' . $trackId);
                $gpxDownloadUrl = \esc_url_raw(\admin_url('admin-ajax.php'));
            }
        }

        $restBase = \esc_url_raw(\site_url('/wp-json/fgpx/v1'));
        global $post;
        $hostPostId = ($post && isset($post->ID)) ? (int) $post->ID : 0;
        $localized = [
            'restUrl' => $restBase,
            'restBase' => $restBase,
            'nonce' => \wp_create_nonce('wp_rest'),
            'ajaxUrl' => \esc_url_raw(\admin_url('admin-ajax.php')),
            'pluginUrl' => \esc_url_raw(\trailingslashit(FGPX_DIR_URL)),
            'chartColor' => $options['fgpx_chart_color'],
            'chartColor2' => $speedChartColorFinal,
            'chartColorHr' => $options['fgpx_chart_color_hr'],
            'chartColorCad' => $cadenceChartColorFinal,
            'chartColorTemp' => $temperatureChartColorFinal,
            'chartColorPower' => $powerChartColorFinal,
            'ftp' => (int) $options['fgpx_ftp'],
            'chartColorWindImpact' => $windImpactChartColorFinal,
            'chartColorWindRose' => $windRoseChartColorFinal,
            'windRoseColorNorth' => $windRoseColorNorthFinal,
            'windRoseColorSouth' => $windRoseColorSouthFinal,
            'windRoseColorEast' => $windRoseColorEastFinal,
            'windRoseColorWest' => $windRoseColorWestFinal,
            'daynightEnabled' => $daynightEnabledFinal,
            'daynightMapEnabled' => $daynightMapEnabledFinal,
            'daynightMapColor' => $daynightMapColorFinal,
            'daynightMapOpacity' => (float) $options['fgpx_daynight_map_opacity'],
            'simulationEnabled' => $options['fgpx_simulation_enabled'] === '1',
            'simulationWaypointsEnabled' => $options['fgpx_simulation_waypoints_enabled'] === '1',
            'simulationCitiesEnabled' => $options['fgpx_simulation_cities_enabled'] === '1',
            'simulationWaypointWindowKm' => (float) $options['fgpx_simulation_waypoint_window_km'],
            'simulationCityWindowKm' => (float) $options['fgpx_simulation_city_window_km'],
            'styleJson' => $resolvedStyleJson,
            'mapSelectorDefault' => (function() use ($options) {
                $v = \sanitize_key((string) ($options['fgpx_map_selector_default'] ?? 'satellite'));
                if ($v === 'basic' || $v === '') { return 'satellite'; }
                if ($v === 'basic_contours') { return 'satellite_contours'; }
                return \in_array($v, ['satellite', 'satellite_contours'], true) ? $v : 'satellite';
            })(),
            'contoursEnabled' => (string) ($options['fgpx_contours_enabled'] ?? '1') === '1',
            'contoursTilesUrl' => (string) ($options['fgpx_contours_tiles_url'] ?? ''),
            'contoursSourceLayer' => (string) ($options['fgpx_contours_source_layer'] ?? 'contour'),
            'satelliteLayerId' => (string) ($options['fgpx_satellite_layer_id'] ?? 'satellite'),
            'satelliteTilesUrl' => (string) ($options['fgpx_satellite_tiles_url'] ?? ''),
            'contoursColor' => (string) ($options['fgpx_contours_color'] ?? '#ffffff'),
            'contoursWidth' => (float) ($options['fgpx_contours_width'] ?? '1.2'),
            'contoursOpacity' => (float) ($options['fgpx_contours_opacity'] ?? '0.75'),
            'contoursMinZoom' => (int) ($options['fgpx_contours_minzoom'] ?? '9'),
            'contoursMaxZoom' => (int) ($options['fgpx_contours_maxzoom'] ?? '16'),
            'defaultZoom' => (int) $options['fgpx_default_zoom'],
            'defaultSpeed' => $defaultSpeedFinal,
            'defaultPitch' => (int) $options['fgpx_default_pitch'],
            'showLabels' => $showLabelsFinal,
            'photosEnabled' => $photosEnabledFinal,
            'photoOrderMode' => $photoOrderModeFinal,
            'photoQueueRotationEnabled' => ($options['fgpx_photo_queue_rotation_enabled'] ?? '0') === '1',
            'galleryPerPage' => max(4, min(48, (int) ($options['fgpx_gallery_per_page'] ?? 16))),
            'arrowsEnabled' => $arrowsEnabledFinal,
            'arrowsKm' => $arrowsKmFinal,
            'privacyEnabled' => $privacyEnabledFinal,
            'privacyKm' => $privacyKmFinal,
            'hudEnabled' => $hudEnabledFinal,
            'elevationColoring' => $elevationColoringEnabledFinal,
            'backendSimplify' => $options['fgpx_backend_simplify_enabled'] === '1',
            'backendSimplifyTarget' => (int) $options['fgpx_backend_simplify_target'],
            'preferAjaxFirst' => ($options['fgpx_ajax_first'] ?? '0') === '1',
            'themeMode' => $options['fgpx_theme_mode'],
            'themeAutoDarkStart' => $options['fgpx_theme_auto_dark_start'],
            'themeAutoDarkEnd' => $options['fgpx_theme_auto_dark_end'],
            'debugWeatherData' => $debugWeatherData,
            'hostPostId' => $hostPostId,
            'i18n' => [
                'play' => \esc_html__('Play', 'flyover-gpx'),
                'pause' => \esc_html__('Pause', 'flyover-gpx'),
                'restart' => \esc_html__('Restart', 'flyover-gpx'),
                'speed' => \esc_html__('Speed', 'flyover-gpx'),
                'failedLoad' => \esc_html__('Failed to load track:', 'flyover-gpx'),
                'noData' => \esc_html__('No route data available.', 'flyover-gpx'),
                'elevationLabel' => \esc_html__('Elevation (m)', 'flyover-gpx'),
                'distanceKm' => \esc_html__('Distance (km)', 'flyover-gpx'),
                'time' => \esc_html__('Time', 'flyover-gpx'),
                'avgSpeedKmh' => \esc_html__('Avg speed (km/h)', 'flyover-gpx'),
                'elevGainM' => \esc_html__('Elevation gain (m)', 'flyover-gpx'),
                'simulationTab' => \esc_html__('Simulation', 'flyover-gpx'),
                'simulationLegendAria' => \esc_html__('Weather and route grade metrics', 'flyover-gpx'),
                'simMileage' => \esc_html__('Mileage', 'flyover-gpx'),
                'simMileageAria' => \esc_html__('Current mileage in kilometers', 'flyover-gpx'),
                'simDuration' => \esc_html__('Duration', 'flyover-gpx'),
                'simDurationAria' => \esc_html__('Current elapsed duration', 'flyover-gpx'),
                'simGrade' => \esc_html__('Grade', 'flyover-gpx'),
                'simGradeAria' => \esc_html__('Current route grade percentage', 'flyover-gpx'),
                'simElevation' => \esc_html__('Elevation', 'flyover-gpx'),
                'simElevationAria' => \esc_html__('Current elevation in meters', 'flyover-gpx'),
                'simTemp' => \esc_html__('Temp', 'flyover-gpx'),
                'simTempAria' => \esc_html__('Current temperature in degrees Celsius', 'flyover-gpx'),
                'simWind' => \esc_html__('Wind', 'flyover-gpx'),
                'simWindAria' => \esc_html__('Current wind speed in kilometers per hour', 'flyover-gpx'),
                'simConditionsAria' => \esc_html__('Current weather conditions summary', 'flyover-gpx'),
                'simCelestialDayAria' => \esc_html__('Daytime indicator (sun)', 'flyover-gpx'),
                'simCelestialNightAria' => \esc_html__('Night indicator (moon)', 'flyover-gpx'),
                'simConditionIconsAria' => \esc_html__('Weather condition icons: fog, clouds, rain, snow, wind', 'flyover-gpx'),
                'simConditionIconsActivePrefix' => \esc_html__('Active weather icons', 'flyover-gpx'),
                'simConditionIconsClear' => \esc_html__('Clear conditions', 'flyover-gpx'),
                'simCondFog' => \esc_html__('Fog', 'flyover-gpx'),
                'simCondClouds' => \esc_html__('Clouds', 'flyover-gpx'),
                'simCondRain' => \esc_html__('Rain', 'flyover-gpx'),
                'simCondSnow' => \esc_html__('Snow', 'flyover-gpx'),
                'simCondWind' => \esc_html__('Wind', 'flyover-gpx'),
                'mapModeLabel' => \esc_html__('Map mode', 'flyover-gpx'),
                'mapModeSatellite' => \esc_html__('Satellite', 'flyover-gpx'),
                'mapModeSatelliteContours' => \esc_html__('Satellite + Contours', 'flyover-gpx'),
                'weatherOverviewTab'           => \esc_html__('Weather', 'flyover-gpx'),
                'weatherOverviewSlice'         => \esc_html__('%s to %s', 'flyover-gpx'),
                'weatherOverviewTemp'          => \esc_html__('Temp', 'flyover-gpx'),
                'weatherOverviewRain'          => \esc_html__('Rain', 'flyover-gpx'),
                'weatherOverviewWind'          => \esc_html__('Wind', 'flyover-gpx'),
                'weatherOverviewClear'         => \esc_html__('Clear / Sunny', 'flyover-gpx'),
                'weatherOverviewRainCond'      => \esc_html__('Rain', 'flyover-gpx'),
                'weatherOverviewDrizzleCond'   => \esc_html__('Drizzle', 'flyover-gpx'),
                'weatherOverviewSnowCond'      => \esc_html__('Snow', 'flyover-gpx'),
                'weatherOverviewFogCond'       => \esc_html__('Fog', 'flyover-gpx'),
                'weatherOverviewWindCond'      => \esc_html__('Wind', 'flyover-gpx'),
                'weatherOverviewCloudCond'     => \esc_html__('Overcast', 'flyover-gpx'),
                'weatherOverviewPartCloudCond' => \esc_html__('Partly Cloudy', 'flyover-gpx'),
                'weatherOverviewStormCond'     => \esc_html__('Heavy Rain', 'flyover-gpx'),
                'weatherOverviewBlizCond'      => \esc_html__('Blizzard', 'flyover-gpx'),
            ],
            'deferViewport' => $lazyViewportEnabled,
            'gpxDownloadUrl' => $gpxDownloadUrl,
            'gpxDownloadNonce' => $gpxDownloadNonce,
            'resolvedApiKey' => $resolvedApiKey,
            'photoCacheVersion' => (string) (\get_post_meta((int) $trackId, 'fgpx_photo_cache_version', true) ?: '0'),
        ];

        $localizeHandle = $lazyViewportEnabled ? 'fgpx-lazy' : 'fgpx-front';

        if ($isFirstInstance) {
            \wp_localize_script($localizeHandle, 'FGPX', $localized);

            if ($lazyViewportEnabled) {
                // Get asset URLs from AssetManager for lazy loading
                $maplibreJs = AssetManager::getAssetUrl('maplibre-gl-js', 'script');
                $chartJs = AssetManager::getAssetUrl('chartjs', 'script');
                $suncalcJs = \esc_url_raw(\trailingslashit(FGPX_DIR_URL) . 'assets/js/suncalc.js');
                $frontJs = \esc_url_raw(\trailingslashit(FGPX_DIR_URL) . 'assets/js/front.js');
                $maplibreCss = AssetManager::getAssetUrl('maplibre-gl-css', 'style');
                $frontCss = \esc_url_raw(\trailingslashit(FGPX_DIR_URL) . 'assets/css/front.css');
                \wp_add_inline_script(
                    'fgpx-lazy',
                    'window.FGPX=window.FGPX||{};window.FGPX.lazyStyles=[' .
                      '"' . esc_js($maplibreCss) . '",' .
                      '"' . esc_js($frontCss) . '"' .
                    '];window.FGPX.lazyScripts=[' .
                      '"' . esc_js($maplibreJs) . '",' .
                      '"' . esc_js($chartJs) . '",' .
                      '"' . esc_js($suncalcJs) . '",' .
                      '"' . esc_js($frontJs) . '"' .
                    '];',
                    'after'
                );
            }

            \wp_add_inline_script(
                $localizeHandle,
                'window.FGPX=window.FGPX||{};window.FGPX.prefetchEnabled=' . ($prefetchEnabled ? 'true' : 'false') . ';',
                'before'
            );

            // Get elevation coloring settings (using resolved values)
            $elevationColoring = $elevationColoringEnabledFinal ? '1' : '0';
            $elevationColorFlat = $elevationColorFlatFinal;
            $elevationColorSteep = $elevationColorSteepFinal;
            $elevationThresholdMin = $options['fgpx_elevation_threshold_min'];
            $elevationThresholdMax = $options['fgpx_elevation_threshold_max'];
            $weatherEnabled = $options['fgpx_weather_enabled'];
            $weatherOpacity = $options['fgpx_weather_opacity'];
            $weatherVisibleByDefault = $weatherVisibleByDefaultFinal ? '1' : '0';
            $daynightVisibleByDefault = $daynightVisibleByDefaultFinal ? '1' : '0';
            $weatherHeatmapZoom0 = $options['fgpx_weather_heatmap_zoom0'];
            $weatherHeatmapZoom9 = $options['fgpx_weather_heatmap_zoom9'];
            $weatherHeatmapZoom12 = $options['fgpx_weather_heatmap_zoom12'];
            $weatherHeatmapZoom14 = $options['fgpx_weather_heatmap_zoom14'];
            $weatherHeatmapZoom15 = $options['fgpx_weather_heatmap_zoom15'];

            // Multi-weather visualization settings
            $weatherPriorityOrder = $options['fgpx_weather_priority_order'];
            $weatherFogThreshold = $options['fgpx_weather_fog_threshold'];
            $weatherRainThreshold = $options['fgpx_weather_rain_threshold'];
            $weatherSnowThreshold = $options['fgpx_weather_snow_threshold'];
            $weatherWindThreshold = $options['fgpx_weather_wind_threshold'];
            $weatherCloudThreshold = $options['fgpx_weather_cloud_threshold'];
            $weatherColorSnow = $options['fgpx_weather_color_snow'];
            $weatherColorRain = $options['fgpx_weather_color_rain'];
            $weatherColorFog = $options['fgpx_weather_color_fog'];
            $weatherColorClouds = $options['fgpx_weather_color_clouds'];

            \wp_add_inline_script(
                $localizeHandle,
                '(function(v){window.FGPX=window.FGPX||{};for(var k in v){if(Object.prototype.hasOwnProperty.call(v,k)){window.FGPX[k]=v[k];}}})( {' .
                  'debugLogging:' . ($debugLogging ? 'true' : 'false') . ',' .
                  'prefetchEnabled:' . ($prefetchEnabled ? 'true' : 'false') . ',' .
                  'elevationColoring:' . ($elevationColoring === '1' ? 'true' : 'false') . ',' .
                  'elevationColorFlat:"' . \esc_js($elevationColorFlat) . '",' .
                  'elevationColorSteep:"' . \esc_js($elevationColorSteep) . '",' .
                  'elevationThresholdMin:"' . \esc_js($elevationThresholdMin) . '",' .
                  'elevationThresholdMax:"' . \esc_js($elevationThresholdMax) . '",' .
                  'weatherEnabled:' . ($weatherEnabled === '1' ? 'true' : 'false') . ',' .
                  'weatherOpacity:' . \floatval($weatherOpacity) . ',' .
                  'weatherVisibleByDefault:' . ($weatherVisibleByDefault === '1' ? 'true' : 'false') . ',' .
                  'daynightVisibleByDefault:' . ($daynightVisibleByDefault === '1' ? 'true' : 'false') . ',' .
                  'weatherHeatmapRadius:{' .
                    'zoom0:' . \intval($weatherHeatmapZoom0) . ',' .
                    'zoom9:' . \intval($weatherHeatmapZoom9) . ',' .
                    'zoom12:' . \intval($weatherHeatmapZoom12) . ',' .
                    'zoom14:' . \intval($weatherHeatmapZoom14) . ',' .
                    'zoom15:' . \intval($weatherHeatmapZoom15) .
                  '},' .
                  'weatherPriorityOrder:"' . \esc_js($weatherPriorityOrder) . '",' .
                  'weatherFogThreshold:' . \floatval($weatherFogThreshold) . ',' .
                  'weatherRainThreshold:' . \floatval($weatherRainThreshold) . ',' .
                  'weatherSnowThreshold:' . \floatval($weatherSnowThreshold) . ',' .
                  'weatherWindThreshold:' . \floatval($weatherWindThreshold) . ',' .
                  'weatherCloudThreshold:' . \floatval($weatherCloudThreshold) . ',' .
                  'simulationEnabled:' . ($options['fgpx_simulation_enabled'] === '1' ? 'true' : 'false') . ',' .
                  'simulationWaypointsEnabled:' . ($options['fgpx_simulation_waypoints_enabled'] === '1' ? 'true' : 'false') . ',' .
                  'simulationCitiesEnabled:' . ($options['fgpx_simulation_cities_enabled'] === '1' ? 'true' : 'false') . ',' .
                  'simulationWaypointWindowKm:' . \floatval($options['fgpx_simulation_waypoint_window_km']) . ',' .
                  'simulationCityWindowKm:' . \floatval($options['fgpx_simulation_city_window_km']) . ',' .
                  'weatherColorSnow:"' . \esc_js($weatherColorSnow) . '",' .
                  'weatherColorRain:"' . \esc_js($weatherColorRain) . '",' .
                  'weatherColorFog:"' . \esc_js($weatherColorFog) . '",' .
                  'weatherColorClouds:"' . \esc_js($weatherColorClouds) . '",' .
                                    'arrowsEnabled:' . ($arrowsEnabledFinal ? 'true' : 'false') . ',' .
                                    'arrowsKm:' . \floatval($arrowsKmFinal) .
                '} );',
                'after'
            );
        } else {
            // Subsequent instances: store per-instance config in window.FGPX.instances[id]
            $instanceKey = \esc_js($containerId);
            \wp_add_inline_script(
                $localizeHandle,
                'window.FGPX=window.FGPX||{};' .
                'window.FGPX.instances=window.FGPX.instances||{};' .
                'window.FGPX.instances["' . $instanceKey . '"]={' .
                  'chartColor:"' . \esc_js($options['fgpx_chart_color']) . '",' .
                  'chartColor2:"' . \esc_js($speedChartColorFinal) . '",' .
                  'chartColorHr:"' . \esc_js($options['fgpx_chart_color_hr']) . '",' .
                  'chartColorCad:"' . \esc_js($cadenceChartColorFinal) . '",' .
                  'chartColorTemp:"' . \esc_js($temperatureChartColorFinal) . '",' .
                  'chartColorPower:"' . \esc_js($powerChartColorFinal) . '",' .
                  'ftp:' . \intval($options['fgpx_ftp']) . ',' .
                  'chartColorWindImpact:"' . \esc_js($windImpactChartColorFinal) . '",' .
                  'chartColorWindRose:"' . \esc_js($windRoseChartColorFinal) . '",' .
                  'windRoseColorNorth:"' . \esc_js($windRoseColorNorthFinal) . '",' .
                  'windRoseColorSouth:"' . \esc_js($windRoseColorSouthFinal) . '",' .
                  'windRoseColorEast:"' . \esc_js($windRoseColorEastFinal) . '",' .
                  'windRoseColorWest:"' . \esc_js($windRoseColorWestFinal) . '",' .
                  'daynightEnabled:' . ($daynightEnabledFinal ? 'true' : 'false') . ',' .
                  'daynightMapEnabled:' . ($daynightMapEnabledFinal ? 'true' : 'false') . ',' .
                  'daynightMapColor:"' . \esc_js($daynightMapColorFinal) . '",' .
                  'daynightMapOpacity:' . \floatval($options['fgpx_daynight_map_opacity']) . ',' .
                  'defaultSpeed:' . $defaultSpeedFinal . ',' .
                  'showLabels:' . ($showLabelsFinal ? 'true' : 'false') . ',' .
                  'photosEnabled:' . ($photosEnabledFinal ? 'true' : 'false') . ',' .
                  'photoOrderMode:"' . \esc_js($photoOrderModeFinal) . '",' .
                  'privacyEnabled:' . ($privacyEnabledFinal ? 'true' : 'false') . ',' .
                  'privacyKm:' . \floatval($privacyKmFinal) . ',' .
                  'hudEnabled:' . ($hudEnabledFinal ? 'true' : 'false') . ',' .
                  'elevationColoring:' . ($elevationColoringEnabledFinal ? 'true' : 'false') . ',' .
                  'elevationColorFlat:"' . \esc_js($elevationColorFlatFinal) . '",' .
                  'elevationColorSteep:"' . \esc_js($elevationColorSteepFinal) . '",' .
                  'elevationThresholdMin:"' . \esc_js($options['fgpx_elevation_threshold_min']) . '",' .
                  'elevationThresholdMax:"' . \esc_js($options['fgpx_elevation_threshold_max']) . '",' .
                  'weatherEnabled:' . ($options['fgpx_weather_enabled'] === '1' ? 'true' : 'false') . ',' .
                  'weatherOpacity:' . \floatval($options['fgpx_weather_opacity']) . ',' .
                  'weatherVisibleByDefault:' . ($weatherVisibleByDefaultFinal ? 'true' : 'false') . ',' .
                  'simulationEnabled:' . ($options['fgpx_simulation_enabled'] === '1' ? 'true' : 'false') . ',' .
                  'simulationWaypointsEnabled:' . ($options['fgpx_simulation_waypoints_enabled'] === '1' ? 'true' : 'false') . ',' .
                  'simulationCitiesEnabled:' . ($options['fgpx_simulation_cities_enabled'] === '1' ? 'true' : 'false') . ',' .
                  'simulationWaypointWindowKm:' . \floatval($options['fgpx_simulation_waypoint_window_km']) . ',' .
                  'simulationCityWindowKm:' . \floatval($options['fgpx_simulation_city_window_km']) . ',' .
                  'mapSelectorDefault:"' . \esc_js((function() use ($options) {
                      $v = \sanitize_key((string) ($options['fgpx_map_selector_default'] ?? 'satellite'));
                      if ($v === 'basic' || $v === '') { return 'satellite'; }
                      if ($v === 'basic_contours') { return 'satellite_contours'; }
                      return \in_array($v, ['satellite', 'satellite_contours'], true) ? $v : 'satellite';
                  })()) . '",' .
                  'contoursEnabled:' . (($options['fgpx_contours_enabled'] ?? '1') === '1' ? 'true' : 'false') . ',' .
                  'contoursTilesUrl:"' . \esc_js((string) ($options['fgpx_contours_tiles_url'] ?? '')) . '",' .
                  'contoursSourceLayer:"' . \esc_js((string) ($options['fgpx_contours_source_layer'] ?? 'contour')) . '",' .
                  'satelliteLayerId:"' . \esc_js((string) ($options['fgpx_satellite_layer_id'] ?? 'satellite')) . '",' .
                  'satelliteTilesUrl:"' . \esc_js((string) ($options['fgpx_satellite_tiles_url'] ?? '')) . '",' .
                  'contoursColor:"' . \esc_js((string) ($options['fgpx_contours_color'] ?? '#ffffff')) . '",' .
                  'contoursWidth:' . \floatval($options['fgpx_contours_width'] ?? '1.2') . ',' .
                  'contoursOpacity:' . \floatval($options['fgpx_contours_opacity'] ?? '0.75') . ',' .
                  'contoursMinZoom:' . \intval($options['fgpx_contours_minzoom'] ?? '9') . ',' .
                  'contoursMaxZoom:' . \intval($options['fgpx_contours_maxzoom'] ?? '16') . ',' .
                                    'weatherFogThreshold:' . \floatval($options['fgpx_weather_fog_threshold']) . ',' .
                                    'weatherRainThreshold:' . \floatval($options['fgpx_weather_rain_threshold']) . ',' .
                                    'weatherSnowThreshold:' . \floatval($options['fgpx_weather_snow_threshold']) . ',' .
                                    'weatherWindThreshold:' . \floatval($options['fgpx_weather_wind_threshold']) . ',' .
                                    'weatherCloudThreshold:' . \floatval($options['fgpx_weather_cloud_threshold']) . ',' .
                                    'weatherColorSnow:"' . \esc_js($options['fgpx_weather_color_snow']) . '",' .
                                    'weatherColorRain:"' . \esc_js($options['fgpx_weather_color_rain']) . '",' .
                                    'weatherColorFog:"' . \esc_js($options['fgpx_weather_color_fog']) . '",' .
                                    'weatherColorClouds:"' . \esc_js($options['fgpx_weather_color_clouds']) . '",' .
                                    'daynightVisibleByDefault:' . ($daynightVisibleByDefaultFinal ? 'true' : 'false') . ',' .
                                    'gpxDownloadUrl:"' . \esc_js($gpxDownloadUrl) . '",' .
                                    'gpxDownloadNonce:"' . \esc_js($gpxDownloadNonce) . '",' .
                                    'arrowsEnabled:' . ($arrowsEnabledFinal ? 'true' : 'false') . ',' .
                                    'arrowsKm:' . \floatval($arrowsKmFinal) . ',' .
                                    'photoCacheVersion:"' . \esc_js((string) (\get_post_meta((int) $trackId, 'fgpx_photo_cache_version', true) ?: '0')) . '"' .
                '};',
                'after'
            );
        }

        // Enqueue custom CSS from settings, if any
        $customCss = $options['fgpx_custom_css'];
        if ($customCss !== '') {
            $handle = 'fgpx-front-inline';
            \wp_register_style($handle, false);
            \wp_enqueue_style($handle);
            \wp_add_inline_style($handle, $customCss);
        }

        $idAttr = $containerId;
        $styleAttr = 'height:' . $height;
        $dataStyleUrlAttr = $styleUrl !== '' ? $styleUrl : '';

        $html = '<div id="' . \esc_attr($idAttr) . '" class="fgpx" style="' . \esc_attr($styleAttr) . '" data-track-id="' . \esc_attr($trackId) . '" data-style="' . \esc_attr($mapStyle) . '" data-style-url="' . \esc_attr($dataStyleUrlAttr) . '"></div>';

        return $html;
    }
}


