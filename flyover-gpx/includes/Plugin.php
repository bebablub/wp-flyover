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
        $height = \sanitize_text_field((string) $atts['height']);
        $styleUrlRaw = (string) ($atts['style_url'] ?? '');
        $styleUrl = '';
        if ($styleUrlRaw !== '') {
            $maybe = \esc_url_raw($styleUrlRaw);
            if (\is_string($maybe) && $maybe !== '') {
                $styleUrl = $maybe;
            }
        }

        if ($trackId === '') {
            return '';
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
            'styleJson' => $options['fgpx_default_style_json'],
            'defaultZoom' => (int) $options['fgpx_default_zoom'],
            'defaultSpeed' => $defaultSpeedFinal,
            'defaultPitch' => (int) $options['fgpx_default_pitch'],
            'showLabels' => $showLabelsFinal,
            'photosEnabled' => $photosEnabledFinal,
            'privacyEnabled' => $privacyEnabledFinal,
            'privacyKm' => $privacyKmFinal,
            'hudEnabled' => $hudEnabledFinal,
            'elevationColoring' => $elevationColoringEnabledFinal,
            'backendSimplify' => $options['fgpx_backend_simplify_enabled'] === '1',
            'backendSimplifyTarget' => (int) $options['fgpx_backend_simplify_target'],
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
            ],
            'deferViewport' => $lazyViewportEnabled,
        ];

        $localizeHandle = $lazyViewportEnabled ? 'fgpx-lazy' : 'fgpx-front';
        \wp_localize_script($localizeHandle, 'FGPX', $localized);

        if ($lazyViewportEnabled) {
            // Get asset URLs from AssetManager for lazy loading
            $maplibreJs = AssetManager::getAssetUrl('maplibre-gl-js', 'script');
            $chartJs = AssetManager::getAssetUrl('chartjs', 'script');
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
              'weatherColorSnow:"' . \esc_js($weatherColorSnow) . '",' .
              'weatherColorRain:"' . \esc_js($weatherColorRain) . '",' .
              'weatherColorFog:"' . \esc_js($weatherColorFog) . '",' .
              'weatherColorClouds:"' . \esc_js($weatherColorClouds) . '"' .
            '} );',
            'after'
        );

        // Enqueue custom CSS from settings, if any
        $customCss = $options['fgpx_custom_css'];
        if ($customCss !== '') {
            $handle = 'fgpx-front-inline';
            \wp_register_style($handle, false);
            \wp_enqueue_style($handle);
            \wp_add_inline_style($handle, $customCss);
        }

        $idAttr = 'fgpx-app';
        $styleAttr = 'height:' . $height;
        $dataStyleUrlAttr = $styleUrl !== '' ? $styleUrl : '';

        $html = '<div id="' . \esc_attr($idAttr) . '" class="fgpx" style="' . \esc_attr($styleAttr) . '" data-track-id="' . \esc_attr($trackId) . '" data-style="' . \esc_attr($mapStyle) . '" data-style-url="' . \esc_attr($dataStyleUrlAttr) . '"></div>';

        return $html;
    }
}


