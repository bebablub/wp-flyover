<?php

declare(strict_types=1);

namespace FGpx;

if (!\defined('ABSPATH')) {
	exit;
}

/**
 * Asset Manager with fallback support for external dependencies.
 * Provides reliable asset loading with local fallbacks when CDN assets fail.
 */
final class AssetManager
{
	/**
	 * Asset definitions with primary CDN and fallback options.
	 * @var array<string, array<string, mixed>>
	 */
	private static $assetDefinitions = [
		'maplibre-gl-js' => [
			'type' => 'script',
			'primary' => 'https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.js',
			'fallbacks' => [
				'https://cdn.jsdelivr.net/npm/maplibre-gl@3.6.2/dist/maplibre-gl.js',
				'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/3.6.2/maplibre-gl.min.js',
			],
			'version' => '3.6.2',
			'deps' => [],
			'in_footer' => true,
			'integrity' => '', // SRI hash if available
		],
		'maplibre-gl-css' => [
			'type' => 'style',
			'primary' => 'https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css',
			'fallbacks' => [
				'https://cdn.jsdelivr.net/npm/maplibre-gl@3.6.2/dist/maplibre-gl.css',
				'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/3.6.2/maplibre-gl.min.css',
			],
			'version' => '3.6.2',
			'deps' => [],
		],
		'chartjs' => [
			'type' => 'script',
			'primary' => 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
			'fallbacks' => [
				'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js',
				'https://unpkg.com/chart.js@4.4.1/dist/chart.umd.min.js',
			],
			'version' => '4.4.1',
			'deps' => [],
			'in_footer' => true,
			'integrity' => '', // SRI hash if available
		],
	];

	/**
	 * Cache for asset availability checks.
	 * @var array<string, bool>
	 */
	private static $availabilityCache = [];

	/**
	 * Register all assets with fallback support.
	 */
	public static function registerAssets(): void
	{
		// Check if asset fallbacks are enabled in admin settings
		$options = Options::getAll();
		$fallbacksEnabled = $options['fgpx_asset_fallbacks_enabled'] === '1';

		foreach (self::$assetDefinitions as $handle => $asset) {
			if ($fallbacksEnabled) {
				self::registerAssetWithFallback($handle, $asset);
			} else {
				self::registerAssetSimple($handle, $asset);
			}
		}

		// Allow integrators to override asset URLs via filters (backward compatibility)
		self::applyLegacyFilters();
	}

	/**
	 * Register a single asset without fallback support (simple registration).
	 * 
	 * @param string $handle Asset handle
	 * @param array<string, mixed> $asset Asset definition
	 */
	private static function registerAssetSimple(string $handle, array $asset): void
	{
		$primaryUrl = $asset['primary'];
		$version = $asset['version'] ?? FGPX_VERSION;
		$deps = $asset['deps'] ?? [];

		if ($asset['type'] === 'script') {
			$inFooter = $asset['in_footer'] ?? true;
			\wp_register_script($handle, $primaryUrl, $deps, $version, $inFooter);
			
			// Add integrity attribute if available and using HTTPS
			if (!empty($asset['integrity']) && \strpos($primaryUrl, 'https://') === 0) {
				\wp_script_add_data($handle, 'integrity', $asset['integrity']);
				\wp_script_add_data($handle, 'crossorigin', 'anonymous');
			}
		} elseif ($asset['type'] === 'style') {
			\wp_register_style($handle, $primaryUrl, $deps, $version);
			
			// Add integrity attribute if available and using HTTPS
			if (!empty($asset['integrity']) && \strpos($primaryUrl, 'https://') === 0) {
				\wp_style_add_data($handle, 'integrity', $asset['integrity']);
				\wp_style_add_data($handle, 'crossorigin', 'anonymous');
			}
		}
	}

	/**
	 * Register a single asset with fallback support.
	 * 
	 * @param string $handle Asset handle
	 * @param array<string, mixed> $asset Asset definition
	 */
	private static function registerAssetWithFallback(string $handle, array $asset): void
	{
		$primaryUrl = $asset['primary'];
		$fallbacks = $asset['fallbacks'] ?? [];
		$version = $asset['version'] ?? FGPX_VERSION;
		$deps = $asset['deps'] ?? [];

		// Try to find a working URL (primary first, then fallbacks)
		$workingUrl = self::findWorkingAssetUrl($primaryUrl, $fallbacks);

		if ($asset['type'] === 'script') {
			$inFooter = $asset['in_footer'] ?? true;
			\wp_register_script($handle, $workingUrl, $deps, $version, $inFooter);
			
			// Add integrity attribute if available and using HTTPS
			if (!empty($asset['integrity']) && \strpos($workingUrl, 'https://') === 0) {
				\wp_script_add_data($handle, 'integrity', $asset['integrity']);
				\wp_script_add_data($handle, 'crossorigin', 'anonymous');
			}
		} elseif ($asset['type'] === 'style') {
			\wp_register_style($handle, $workingUrl, $deps, $version);
			
			// Add integrity attribute if available and using HTTPS
			if (!empty($asset['integrity']) && \strpos($workingUrl, 'https://') === 0) {
				\wp_style_add_data($handle, 'integrity', $asset['integrity']);
				\wp_style_add_data($handle, 'crossorigin', 'anonymous');
			}
		}
	}

	/**
	 * Find the first working asset URL from primary and fallbacks.
	 * 
	 * @param string $primary Primary CDN URL
	 * @param array<string> $fallbacks Fallback CDN URLs
	 * @return string Working URL or primary URL if none can be verified
	 */
	private static function findWorkingAssetUrl(string $primary, array $fallbacks): string
	{
		// Always try primary first
		$urlsToTry = \array_merge([$primary], $fallbacks);

		foreach ($urlsToTry as $url) {
			if (self::isAssetAvailable($url)) {
				return $url;
			}
		}

		// If no URL can be verified as working, return primary (best effort)
		return $primary;
	}

	/**
	 * Check if an asset URL is available.
	 * Uses caching to avoid repeated HTTP requests.
	 * 
	 * @param string $url Asset URL to check
	 * @return bool True if asset appears to be available
	 */
	private static function isAssetAvailable(string $url): bool
	{
		// Check cache first
		if (isset(self::$availabilityCache[$url])) {
			return self::$availabilityCache[$url];
		}

		// Skip availability check in admin or during AJAX to avoid performance issues
		if (\is_admin() || (\defined('DOING_AJAX') && DOING_AJAX)) {
			self::$availabilityCache[$url] = true;
			return true;
		}

		// Use WordPress HTTP API with short timeout
		$response = \wp_remote_head($url, [
			'timeout' => 3,
			'user-agent' => 'Flyover GPX Asset Checker',
			'sslverify' => true,
		]);

		$isAvailable = !\is_wp_error($response) && \wp_remote_retrieve_response_code($response) === 200;
		
		// Cache the result for this request
		self::$availabilityCache[$url] = $isAvailable;
		
		return $isAvailable;
	}

	/**
	 * Apply legacy filters for backward compatibility.
	 * Allows integrators to override CDN URLs as before.
	 */
	private static function applyLegacyFilters(): void
	{
		// MapLibre GL JS filter
		$maplibreSrc = \apply_filters('fgpx_maplibre_src', '');
		if (\is_string($maplibreSrc) && $maplibreSrc !== '') {
			\wp_deregister_script('maplibre-gl-js');
			\wp_register_script('maplibre-gl-js', $maplibreSrc, [], '3.6.2', true);
		}

		// Chart.js filter
		$chartSrc = \apply_filters('fgpx_chartjs_src', '');
		if (\is_string($chartSrc) && $chartSrc !== '') {
			\wp_deregister_script('chartjs');
			\wp_register_script('chartjs', $chartSrc, [], '4.4.1', true);
		}
	}

	/**
	 * Get the registered URL for an asset handle.
	 * Useful for lazy loading scenarios.
	 * 
	 * @param string $handle Asset handle
	 * @param string $type Asset type ('script' or 'style')
	 * @return string Asset URL or empty string if not found
	 */
	public static function getAssetUrl(string $handle, string $type = 'script'): string
	{
		if ($type === 'script') {
			global $wp_scripts;
			return isset($wp_scripts->registered[$handle]) ? $wp_scripts->registered[$handle]->src : '';
		} elseif ($type === 'style') {
			global $wp_styles;
			return isset($wp_styles->registered[$handle]) ? $wp_styles->registered[$handle]->src : '';
		}

		return '';
	}

	/**
	 * Add a fallback detection script to the frontend.
	 * This provides client-side fallback loading if the primary asset fails.
	 * 
	 * @param string $handle Script handle to attach the fallback to
	 */
	public static function addFallbackScript(string $handle): void
	{
		$fallbackScript = self::generateFallbackScript();
		\wp_add_inline_script($handle, $fallbackScript, 'after');
	}

	/**
	 * Generate JavaScript code for client-side asset fallback detection.
	 * 
	 * @return string JavaScript code for fallback detection
	 */
	private static function generateFallbackScript(): string
	{
		$maplibreFallbacks = \wp_json_encode(self::$assetDefinitions['maplibre-gl-js']['fallbacks']);
		$chartjsFallbacks = \wp_json_encode(self::$assetDefinitions['chartjs']['fallbacks']);
		$maplibreCssFallbacks = \wp_json_encode(self::$assetDefinitions['maplibre-gl-css']['fallbacks']);

		return "
(function() {
	'use strict';
	
	// Asset fallback configuration
	var fallbacks = {
		'maplibre-gl-js': {
			check: function() { return typeof maplibregl !== 'undefined'; },
			urls: {$maplibreFallbacks}
		},
		'chartjs': {
			check: function() { return typeof Chart !== 'undefined'; },
			urls: {$chartjsFallbacks}
		},
		'maplibre-gl-css': {
			check: function() { 
				// Check if MapLibre CSS is loaded by looking for specific styles
				var testEl = document.createElement('div');
				testEl.className = 'maplibregl-map';
				testEl.style.position = 'absolute';
				testEl.style.visibility = 'hidden';
				document.body.appendChild(testEl);
				var hasStyles = window.getComputedStyle(testEl).position === 'relative';
				document.body.removeChild(testEl);
				return hasStyles;
			},
			urls: {$maplibreCssFallbacks}
		}
	};

	// Function to load fallback asset
	function loadFallback(assetId, urls, isCSS) {
		if (!urls || urls.length === 0) return;
		
		var url = urls.shift();
		var element;
		
		if (isCSS) {
			element = document.createElement('link');
			element.rel = 'stylesheet';
			element.href = url;
		} else {
			element = document.createElement('script');
			element.src = url;
		}
		
		element.onload = function() {
			if (window.FGPX && window.FGPX.debugLogging) {
				console.log('[FGPX] Loaded fallback asset:', url);
			}
		};
		
		element.onerror = function() {
			if (window.FGPX && window.FGPX.debugLogging) {
				console.warn('[FGPX] Fallback asset failed:', url);
			}
			if (urls.length > 0) {
				loadFallback(assetId, urls, isCSS);
			}
		};
		
		document.head.appendChild(element);
	}

	// Check assets after DOM is ready
	function checkAssets() {
		// Check MapLibre GL JS
		if (!fallbacks['maplibre-gl-js'].check()) {
			console.warn('Flyover GPX: MapLibre GL JS not loaded, trying fallbacks');
			loadFallback('maplibre-gl-js', fallbacks['maplibre-gl-js'].urls.slice(), false);
		}
		
		// Check Chart.js
		if (!fallbacks['chartjs'].check()) {
			console.warn('Flyover GPX: Chart.js not loaded, trying fallbacks');
			loadFallback('chartjs', fallbacks['chartjs'].urls.slice(), false);
		}
		
		// Check MapLibre CSS (delayed to allow styles to apply)
		setTimeout(function() {
			if (!fallbacks['maplibre-gl-css'].check()) {
				console.warn('Flyover GPX: MapLibre GL CSS not loaded, trying fallbacks');
				loadFallback('maplibre-gl-css', fallbacks['maplibre-gl-css'].urls.slice(), true);
			}
		}, 100);
	}

	// Run checks when DOM is ready
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', checkAssets);
	} else {
		checkAssets();
	}
})();
";
	}

	/**
	 * Get asset definitions for external use.
	 * 
	 * @return array<string, array<string, mixed>> Asset definitions
	 */
	public static function getAssetDefinitions(): array
	{
		return self::$assetDefinitions;
	}

	/**
	 * Clear the availability cache.
	 * Useful for testing or when asset availability changes.
	 */
	public static function clearAvailabilityCache(): void
	{
		self::$availabilityCache = [];
	}
}
