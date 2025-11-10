<?php

declare(strict_types=1);

namespace FGpx;

if (!\defined('ABSPATH')) {
	exit;
}

/**
 * Centralized options management with caching to reduce database queries.
 * Provides a single source of truth for all plugin options with performance optimization.
 */
final class Options
{
	/**
	 * Static cache for options to prevent multiple database queries.
	 * @var array<string, mixed>|null
	 */
	private static $cache = null;

	/**
	 * Option definitions with their default values.
	 * This serves as the single source of truth for all plugin options.
	 * @var array<string, mixed>
	 */
	private static $definitions = [
		// Map Display & Styling
		'fgpx_default_style' => 'raster',
		'fgpx_default_style_url' => '',
		'fgpx_default_style_json' => '',
		'fgpx_default_height' => '620px',
		'fgpx_default_zoom' => '11',
		'fgpx_default_speed' => '25',
		'fgpx_default_pitch' => '60',
		'fgpx_show_labels' => '1',
		'fgpx_custom_css' => '',

		// Privacy & Features
		'fgpx_photos_enabled' => '0',
		'fgpx_privacy_enabled' => '0',
		'fgpx_privacy_km' => '3',
		'fgpx_hud_enabled' => '1',
		'fgpx_prefetch_enabled' => '1',
		'fgpx_lazy_viewport' => '1',

		// Performance & Backend
		'fgpx_backend_simplify_enabled' => '1',
		'fgpx_backend_simplify_target' => '1200',
		'fgpx_asset_fallbacks_enabled' => '1',

		// Chart Colors - Primary
		'fgpx_chart_color' => '#ff5500',
		'fgpx_chart_color2' => '#1976d2',

		// Chart Colors - Biometric Data
		'fgpx_chart_color_hr' => '#dc2626',
		'fgpx_chart_color_cad' => '#7c3aed',
		'fgpx_chart_color_temp' => '#f59e0b',
		'fgpx_chart_color_power' => '#059669',

		// Chart Colors - Wind Analysis
		'fgpx_chart_color_wind_impact' => '#ff6b35',
		'fgpx_chart_color_wind_rose' => '#4ecdc4',

		// Wind Rose Directional Colors
		'fgpx_wind_rose_color_north' => '#3b82f6',
		'fgpx_wind_rose_color_south' => '#10b981',
		'fgpx_wind_rose_color_east' => '#f59e0b',
		'fgpx_wind_rose_color_west' => '#ef4444',

		// Weather & Environmental
		'fgpx_weather_enabled' => '0',
		'fgpx_weather_sampling' => 'distance',
		'fgpx_weather_step_km' => '5',
		'fgpx_weather_step_min' => '10',
		'fgpx_weather_opacity' => '0.6',
		'fgpx_weather_visible_by_default' => '0',
		'fgpx_weather_multi_point' => '0',
		'fgpx_weather_multi_point_distance' => '5.0',

		// Multi-Weather Visualization
		'fgpx_weather_priority_order' => 'snow,rain,fog,clouds', // Comma-separated priority order
		'fgpx_weather_fog_threshold' => '0.3', // Fog intensity threshold (0-1)
		'fgpx_weather_color_snow' => '#ff1493', // Deep pink for snow
		'fgpx_weather_color_rain' => '#4169e1', // Royal blue for rain (existing)
		'fgpx_weather_color_fog' => '#808080', // Gray for fog
		'fgpx_weather_color_clouds' => '#d3d3d3', // Light gray for clouds

		// Weather Heatmap Settings
		'fgpx_weather_heatmap_zoom0' => '20',
		'fgpx_weather_heatmap_zoom9' => '200',
		'fgpx_weather_heatmap_zoom12' => '1000',
		'fgpx_weather_heatmap_zoom14' => '3000',
		'fgpx_weather_heatmap_zoom15' => '5000',

		// Weather Circle Settings (for high zoom levels)
		'fgpx_weather_circle_zoom12' => '40',   // Circle radius at zoom 12
		'fgpx_weather_circle_zoom14' => '80',   // Circle radius at zoom 14
		'fgpx_weather_circle_zoom16' => '120',  // Circle radius at zoom 16
		'fgpx_weather_circle_zoom18' => '200',  // Circle radius at zoom 18
		'fgpx_weather_circle_blur' => '1.5',    // Circle blur amount (0-2)

		// Wind Analysis
		'fgpx_wind_analysis_enabled' => '0',
		'fgpx_wind_interpolation_density' => '3',

		// Day/Night Visualization
		'fgpx_daynight_enabled' => '1',
		'fgpx_daynight_map_enabled' => '0',
		'fgpx_daynight_map_color' => '#000080',
		'fgpx_daynight_map_opacity' => '0.4',
		'fgpx_daynight_visible_by_default' => '0',

		// Elevation Coloring
		'fgpx_elevation_coloring' => '0',
		'fgpx_elevation_color_flat' => '#ff5500',
		'fgpx_elevation_color_steep' => '#ff0000',
		'fgpx_elevation_threshold_min' => '3',
		'fgpx_elevation_threshold_max' => '8',

		// Debug & Development
		'fgpx_debug_logging' => '0',
		'fgpx_debug_weather_data' => '0',
	];

	/**
	 * Get all plugin options with caching.
	 * Loads all options in a single database query and caches the result.
	 * 
	 * @return array<string, mixed> All plugin options with their values
	 */
	public static function getAll(): array
	{
		if (self::$cache === null) {
			self::$cache = [];
			
			// Load all options in a single query using WordPress's option autoloading
			foreach (self::$definitions as $key => $default) {
				self::$cache[$key] = \get_option($key, $default);
			}
		}
		
		return self::$cache;
	}

	/**
	 * Get a specific option value with caching.
	 * 
	 * @param string $key The option key
	 * @param mixed $default Default value if option doesn't exist (optional, uses definition default)
	 * @return mixed The option value
	 */
	public static function get(string $key, $default = null)
	{
		$options = self::getAll();
		
		if (isset($options[$key])) {
			return $options[$key];
		}
		
		// Use provided default or fall back to definition default
		if ($default !== null) {
			return $default;
		}
		
		return self::$definitions[$key] ?? '';
	}

	/**
	 * Get multiple options at once.
	 * 
	 * @param array<string> $keys Array of option keys to retrieve
	 * @return array<string, mixed> Array of key => value pairs
	 */
	public static function getMultiple(array $keys): array
	{
		$options = self::getAll();
		$result = [];
		
		foreach ($keys as $key) {
			$result[$key] = $options[$key] ?? (self::$definitions[$key] ?? '');
		}
		
		return $result;
	}

	/**
	 * Clear the options cache.
	 * Should be called when options are updated to ensure fresh data.
	 */
	public static function clearCache(): void
	{
		self::$cache = null;
	}

	/**
	 * Get option definitions (for admin forms, etc.).
	 * 
	 * @return array<string, mixed> Option definitions with default values
	 */
	public static function getDefinitions(): array
	{
		return self::$definitions;
	}

	/**
	 * Check if an option exists in the definitions.
	 * 
	 * @param string $key The option key to check
	 * @return bool True if the option is defined
	 */
	public static function isDefined(string $key): bool
	{
		return isset(self::$definitions[$key]);
	}

	/**
	 * Get options formatted for frontend JavaScript.
	 * Returns commonly used frontend options in a structured format.
	 * 
	 * @return array<string, mixed> Frontend-ready options
	 */
	public static function getForFrontend(): array
	{
		$options = self::getAll();
		
		return [
			// Chart colors
			'chartColor' => $options['fgpx_chart_color'],
			'chartColor2' => $options['fgpx_chart_color2'],
			'chartColorHr' => $options['fgpx_chart_color_hr'],
			'chartColorCad' => $options['fgpx_chart_color_cad'],
			'chartColorTemp' => $options['fgpx_chart_color_temp'],
			'chartColorPower' => $options['fgpx_chart_color_power'],
			'chartColorWindImpact' => $options['fgpx_chart_color_wind_impact'],
			'chartColorWindRose' => $options['fgpx_chart_color_wind_rose'],
			
			// Wind rose colors
			'windRoseColorNorth' => $options['fgpx_wind_rose_color_north'],
			'windRoseColorSouth' => $options['fgpx_wind_rose_color_south'],
			'windRoseColorEast' => $options['fgpx_wind_rose_color_east'],
			'windRoseColorWest' => $options['fgpx_wind_rose_color_west'],
			
			// Feature flags
			'daynightEnabled' => $options['fgpx_daynight_enabled'] === '1',
			'daynightMapEnabled' => $options['fgpx_daynight_map_enabled'] === '1',
			'daynightMapColor' => $options['fgpx_daynight_map_color'],
			'daynightMapOpacity' => (float) $options['fgpx_daynight_map_opacity'],
			'photosEnabled' => $options['fgpx_photos_enabled'] === '1',
			'showLabels' => $options['fgpx_show_labels'] !== '0',
			'debugWeatherData' => $options['fgpx_debug_weather_data'] === '1',
			
			// Map settings
			'defaultZoom' => (int) $options['fgpx_default_zoom'],
			'defaultPitch' => (int) $options['fgpx_default_pitch'],
			'styleJson' => $options['fgpx_default_style_json'],
			
			// Performance
			'backendSimplify' => $options['fgpx_backend_simplify_enabled'] === '1',
			'backendSimplifyTarget' => (int) $options['fgpx_backend_simplify_target'],
		];
	}
}
