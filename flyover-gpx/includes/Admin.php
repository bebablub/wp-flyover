<?php

declare(strict_types=1);

namespace FGpx;

if (!\defined('ABSPATH')) {
	exit;
}

/**
 * Admin-related hooks: settings page, upload handler, deletion cleanup.
 */
final class Admin
{
	/**
	 * Register admin hooks: settings page, uploader action, notices, deletion cleanup.
	 */
	public function register(): void
	{
		\add_action('admin_menu', [$this, 'register_settings_page']);
		\add_action('admin_menu', [$this, 'register_add_new_track_page']);
		\add_action('admin_enqueue_scripts', [$this, 'admin_enqueue']);
		\add_action('admin_post_fgpx_upload', [$this, 'handle_upload_form']);
		\add_action('admin_post_fgpx_save_settings', [$this, 'handle_save_settings']);
		\add_action('admin_notices', [$this, 'maybe_show_admin_notice']);
		\add_action('before_delete_post', [$this, 'maybe_delete_track_file']);
		// Invalidate caches on save and meta update
		\add_action('save_post_fgpx_track', [$this, 'invalidate_cache_on_save'], 20, 3);
		\add_action('updated_postmeta', [$this, 'invalidate_cache_on_meta'], 10, 4);
		// Ensure edit form supports file uploads for replacement
		\add_action('post_edit_form_tag', [$this, 'add_form_enctype']);
		// Allow GPX uploads and relax ext/type check for .gpx
		\add_filter('upload_mimes', [$this, 'allow_gpx_mime']);
		\add_filter('wp_check_filetype_and_ext', [$this, 'relax_gpx_filetype'], 10, 5);
		// List table columns and actions
		\add_filter('manage_fgpx_track_posts_columns', [$this, 'columns']);
		\add_action('manage_fgpx_track_posts_custom_column', [$this, 'render_column'], 10, 2);
		\add_filter('manage_edit-fgpx_track_sortable_columns', [$this, 'sortable_columns']);
		\add_action('pre_get_posts', [$this, 'handle_sorting']);
		\add_filter('post_row_actions', [$this, 'row_actions'], 10, 2);
		// Bulk actions for weather enrichment
		\add_filter('bulk_actions-edit-fgpx_track', [$this, 'add_bulk_actions']);
		\add_filter('handle_bulk_actions-edit-fgpx_track', [$this, 'handle_bulk_actions'], 10, 3);
		// AJAX handler for individual weather enrichment
		\add_action('wp_ajax_fgpx_enrich_weather', [$this, 'ajax_enrich_weather']);
		// Metaboxes and file replacement
		\add_action('add_meta_boxes', [$this, 'add_metaboxes']);
		// Replace GPX functionality removed - use "Add New Track" instead
		// (Preview removed)
		
		// Hide default "Add New" buttons except our menu item
		\add_action('admin_head', [$this, 'hide_default_add_new_buttons']);
	}

	/**
	 * Validate nonce for form submissions with standardized error handling.
	 * 
	 * @param string $action The nonce action to validate
	 * @param string $nonceField The POST field name containing the nonce (default: 'fgpx_nonce')
	 * @param bool $die Whether to wp_die() on failure (default: true)
	 * @return bool True if valid, false if invalid (when $die is false)
	 */
	private function validateNonce(string $action, string $nonceField = 'fgpx_nonce', bool $die = true): bool
	{
		$nonce = isset($_POST[$nonceField]) ? (string) $_POST[$nonceField] : '';
		
		if (!\wp_verify_nonce($nonce, $action)) {
			if ($die) {
				\wp_die(\esc_html__('Security check failed. Please try again.', 'flyover-gpx'));
			}
			return false;
		}
		
		return true;
	}

	/**
	 * Validate user capabilities with standardized error handling.
	 * 
	 * @param string $capability The capability to check
	 * @param bool $die Whether to wp_die() on failure (default: true)
	 * @return bool True if user has capability, false otherwise (when $die is false)
	 */
	private function validateCapability(string $capability, bool $die = true): bool
	{
		if (!\current_user_can($capability)) {
			if ($die) {
				\wp_die(\esc_html__('You do not have permission to perform this action.', 'flyover-gpx'));
			}
			return false;
		}
		
		return true;
	}

	/**
	 * Validate both nonce and capability in one call.
	 * 
	 * @param string $action The nonce action to validate
	 * @param string $capability The capability to check
	 * @param string $nonceField The POST field name containing the nonce (default: 'fgpx_nonce')
	 * @param bool $die Whether to wp_die() on failure (default: true)
	 * @return bool True if both are valid, false otherwise (when $die is false)
	 */
	private function validateSecurity(string $action, string $capability, string $nonceField = 'fgpx_nonce', bool $die = true): bool
	{
		return $this->validateCapability($capability, $die) && $this->validateNonce($action, $nonceField, $die);
	}

	/**
	 * Safely get and validate a track ID from POST data.
	 * 
	 * @param string $field The POST field name (default: 'track_id')
	 * @return int Valid track ID (> 0) or 0 if invalid
	 */
	private function getValidTrackId(string $field = 'track_id'): int
	{
		$id = isset($_POST[$field]) ? $_POST[$field] : '';
		
		// Remove any non-numeric characters and convert to int
		$cleanId = (int) \preg_replace('/[^0-9]/', '', (string) $id);
		
		return $cleanId > 0 ? $cleanId : 0;
	}

	/**
	 * Safely get and validate a positive integer from POST data.
	 * 
	 * @param string $field The POST field name
	 * @param int $default Default value if invalid
	 * @param int $min Minimum allowed value (default: 1)
	 * @param int $max Maximum allowed value (default: PHP_INT_MAX)
	 * @return int Valid integer within bounds
	 */
	private function getValidInt(string $field, int $default, int $min = 1, int $max = PHP_INT_MAX): int
	{
		if (!isset($_POST[$field])) {
			return $default;
		}
		
		$value = \filter_var($_POST[$field], FILTER_VALIDATE_INT);
		
		if ($value === false || $value < $min || $value > $max) {
			return $default;
		}
		
		return $value;
	}

	/**
	 * Safely get and validate a float from POST data.
	 * 
	 * @param string $field The POST field name
	 * @param float $default Default value if invalid
	 * @param float $min Minimum allowed value (default: 0.0)
	 * @param float $max Maximum allowed value (default: PHP_FLOAT_MAX)
	 * @return float Valid float within bounds
	 */
	private function getValidFloat(string $field, float $default, float $min = 0.0, float $max = PHP_FLOAT_MAX): float
	{
		if (!isset($_POST[$field])) {
			return $default;
		}
		
		$value = \filter_var($_POST[$field], FILTER_VALIDATE_FLOAT);
		
		if ($value === false || $value < $min || $value > $max) {
			return $default;
		}
		
		return $value;
	}

	/**
	 * Safely get and validate a boolean from POST data.
	 * 
	 * @param string $field The POST field name
	 * @param bool $default Default value if field not present
	 * @return bool True if field value is truthy, false otherwise
	 */
	private function getValidBool(string $field, bool $default = false): bool
	{
		if (!isset($_POST[$field])) {
			return $default;
		}
		
		$value = \strtolower(\trim((string) $_POST[$field]));
		
		return \in_array($value, ['1', 'true', 'yes', 'on'], true);
	}

	/**
	 * Safely get and sanitize a text field from POST data.
	 * 
	 * @param string $field The POST field name
	 * @param string $default Default value if invalid
	 * @param int $maxLength Maximum allowed length (default: 255)
	 * @return string Sanitized text
	 */
	private function getValidText(string $field, string $default = '', int $maxLength = 255): string
	{
		if (!isset($_POST[$field])) {
			return $default;
		}
		
		$value = \sanitize_text_field((string) $_POST[$field]);
		
		if (\strlen($value) > $maxLength) {
			$value = \substr($value, 0, $maxLength);
		}
		
		return $value;
	}

	/**
	 * Safely get and validate a URL from POST data.
	 * 
	 * @param string $field The POST field name
	 * @param string $default Default value if invalid
	 * @return string Valid URL or default
	 */
	private function getValidUrl(string $field, string $default = ''): string
	{
		if (!isset($_POST[$field])) {
			return $default;
		}
		
		$url = \esc_url_raw((string) $_POST[$field]);
		
		return \is_string($url) && $url !== '' ? $url : $default;
	}

	/**
	 * Safely get and validate a hex color from POST data.
	 * 
	 * @param string $field The POST field name
	 * @param string $default Default color if invalid
	 * @return string Valid hex color
	 */
	private function getValidColor(string $field, string $default = '#000000'): string
	{
		if (!isset($_POST[$field])) {
			return $default;
		}
		
		$color = \sanitize_hex_color((string) $_POST[$field]);
		
		return $color !== null ? $color : $default;
	}

	/**
	 * Hide default "Add New" buttons and keep only our menu item.
	 */
	public function hide_default_add_new_buttons(): void
	{
		$screen = \get_current_screen();
		if (!$screen || $screen->post_type !== 'fgpx_track') {
			return;
		}

		?>
		<style type="text/css">
		/* Hide "Add New" button on track list page */
		.page-title-action[href*="post-new.php?post_type=fgpx_track"],
		.page-title-action[href*="post-new.php"][href*="fgpx_track"] {
			display: none !important;
		}
		
		/* Hide "Add New" from admin bar */
		#wp-admin-bar-new-fgpx_track {
			display: none !important;
		}
		
		/* Hide any other "Add New" buttons that might appear */
		a[href*="post-new.php?post_type=fgpx_track"],
		a[href*="post-new.php"][href*="fgpx_track"] {
			display: none !important;
		}
		
		/* But keep our menu item visible */
		.wp-submenu a[href*="page=fgpx-add-new-track"] {
			display: block !important;
		}
		</style>
		<?php
	}

	/**
	 * Add Settings → Flyover GPX page with upload form.
	 */
	public function register_settings_page(): void
	{
		\add_options_page(
			\esc_html__('Flyover GPX', 'flyover-gpx'),
			\esc_html__('Flyover GPX', 'flyover-gpx'),
			'upload_files',
			'flyover-gpx',
			[$this, 'render_settings_page']
		);
	}

	/**
	 * Add custom "Add New Track" page under Tracks menu and remove default WordPress "Add New".
	 */
	public function register_add_new_track_page(): void
	{
		// Remove the default WordPress "Add New" submenu
		\remove_submenu_page('edit.php?post_type=fgpx_track', 'post-new.php?post_type=fgpx_track');
		
		// Add our custom "Add New Track" page
		\add_submenu_page(
			'edit.php?post_type=fgpx_track',
			\esc_html__('Add New Track', 'flyover-gpx'),
			\esc_html__('Add New Track', 'flyover-gpx'),
			'upload_files',
			'fgpx-add-new-track',
			[$this, 'render_add_new_track_page']
		);
	}

	/**
	 * Render the settings page HTML.
	 */
	public function render_settings_page(): void
	{
		if (!\current_user_can('upload_files')) {
			\wp_die(\esc_html__('You do not have permission to access this page.', 'flyover-gpx'));
		}

		$actionUrl = \esc_url(\admin_url('admin-post.php'));
		$hasPhpGpx = \class_exists('\\phpGPX\\phpGPX');
		
		// Get all options in a single cached call
		$options = Options::getAll();
		
		$customCss = $options['fgpx_custom_css'];
		$defStyle = $options['fgpx_default_style'];
		$defStyleUrl = $options['fgpx_default_style_url'];
		$defStyleJson = $options['fgpx_default_style_json'];
		$defHeight = $options['fgpx_default_height'];
		$defZoom = $options['fgpx_default_zoom'];
		$defSpeed = $options['fgpx_default_speed'];
		$defPitch = $options['fgpx_default_pitch'];
		$showLabels = $options['fgpx_show_labels'];
		$photosEnabled = $options['fgpx_photos_enabled'];
		$privacyEnabled = $options['fgpx_privacy_enabled'];
		$privacyKm = $options['fgpx_privacy_km'];
		$hudEnabled = $options['fgpx_hud_enabled'];
		$backendSimplify = $options['fgpx_backend_simplify_enabled'];
		$backendSimplifyTarget = $options['fgpx_backend_simplify_target'];
		$chartColor = $options['fgpx_chart_color'];
		$chartColor2 = $options['fgpx_chart_color2'];
		$chartColorHr = $options['fgpx_chart_color_hr'];
		$chartColorCad = $options['fgpx_chart_color_cad'];
		$chartColorTemp = $options['fgpx_chart_color_temp'];
		$chartColorPower = $options['fgpx_chart_color_power'];
		$chartColorWindImpact = $options['fgpx_chart_color_wind_impact'];
		$chartColorWindRose = $options['fgpx_chart_color_wind_rose'];
		$prefetchEnabled = $options['fgpx_prefetch_enabled'];
		$debugLogging = $options['fgpx_debug_logging'];
		$debugWeatherData = $options['fgpx_debug_weather_data'];
		$lazyViewport = $options['fgpx_lazy_viewport'];
		$elevationColoring = $options['fgpx_elevation_coloring'];
		$elevationColorFlat = $options['fgpx_elevation_color_flat'];
		$elevationColorSteep = $options['fgpx_elevation_color_steep'];
		$elevationThresholdMin = $options['fgpx_elevation_threshold_min'];
		$elevationThresholdMax = $options['fgpx_elevation_threshold_max'];

		echo '<div class="wrap">';
		echo '<h1>' . \esc_html__('Flyover GPX Upload', 'flyover-gpx') . '</h1>';
		if (!$hasPhpGpx) {
			echo '<div class="notice notice-error"><p>' . \esc_html__('phpGPX library is missing. Please run composer install in the plugin directory before uploading GPX files.', 'flyover-gpx') . '</p></div>';
		}
		echo '<div class="fgpx-upload-form">';
		echo '<h3>' . \esc_html__('Upload New GPX File', 'flyover-gpx') . '</h3>';
		echo '<form method="post" action="' . $actionUrl . '" enctype="multipart/form-data">';
		echo '<input type="hidden" name="action" value="fgpx_upload" />';
		echo '<input type="hidden" name="fgpx_nonce" value="' . \esc_attr(\wp_create_nonce('fgpx_upload')) . '" />';
		echo '<div class="file-input-wrapper">';
		echo '<label for="fgpx_file"><strong>' . \esc_html__('Select a GPX file (max 20MB):', 'flyover-gpx') . '</strong></label>';
		echo '<input type="file" id="fgpx_file" name="fgpx_file" accept=".gpx,application/gpx+xml,application/xml,text/xml" ' . (!$hasPhpGpx ? 'disabled' : 'required') . ' />';
		echo '<p class="description">' . \esc_html__('Supported formats: .gpx files. The file will be processed and a new track post will be created.', 'flyover-gpx') . '</p>';
		echo '</div>';
		echo '<p class="submit"><button type="submit" class="button button-primary" ' . (!$hasPhpGpx ? 'disabled' : '') . '>' . \esc_html__('Upload and Parse', 'flyover-gpx') . '</button></p>';
		echo '</form>';
		echo '</div>';

		echo '<hr />';
		echo '<h2>' . \esc_html__('Shortcode Defaults', 'flyover-gpx') . '</h2>';
		echo '<form method="post" action="' . $actionUrl . '">';
		echo '<input type="hidden" name="action" value="fgpx_save_settings" />';
		echo '<input type="hidden" name="fgpx_nonce" value="' . \esc_attr(\wp_create_nonce('fgpx_save_settings')) . '" />';
		
		// Map Display & Styling Section
		echo '<h3 style="margin-top: 30px; padding: 10px 0; border-bottom: 2px solid #ddd; color: #23282d;">' . \esc_html__('🗺️ Map Display & Styling', 'flyover-gpx') . '</h3>';
		echo '<table class="form-table" role="presentation">';
		echo '<tr><th scope="row"><label for="fgpx_default_style">' . \esc_html__('Map style', 'flyover-gpx') . '</label></th><td>';
		echo '<select id="fgpx_default_style" name="fgpx_default_style">';
		echo '<option value="raster"' . selected($defStyle, 'raster', false) . '>Raster (OSM)</option>';
		echo '<option value="vector"' . selected($defStyle, 'vector', false) . '>Vector (style URL)</option>';
		echo '</select>';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_default_style_url">' . \esc_html__('Vector style URL', 'flyover-gpx') . '</label></th><td>';
		echo '<input type="text" id="fgpx_default_style_url" name="fgpx_default_style_url" class="regular-text" value="' . \esc_attr($defStyleUrl) . '" placeholder="https://.../style.json" />';
		echo '<p class="description">' . \esc_html__('Used when style = vector (e.g., MapLibre style.json).', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		$exampleStyleJson = "{\n  \"version\": 8,\n  \"sources\": {\n    \"osm\": {\n      \"type\": \"raster\",\n      \"tiles\": [\"https:\\/\\/tile.openstreetmap.org\\/{z}\\/{x}\\/{y}.png\"],\n      \"tileSize\": 256,\n      \"maxzoom\": 19,\n      \"attribution\": \"© OpenStreetMap contributors\"\n    }\n  },\n  \"layers\": [\n    { \"id\": \"osm\", \"type\": \"raster\", \"source\": \"osm\" }\n  ]\n}";
		$styleJsonValue = $defStyleJson !== '' ? $defStyleJson : $exampleStyleJson;
		echo '<tr><th scope="row"><label for="fgpx_default_style_json">' . \esc_html__('Inline style JSON (optional)', 'flyover-gpx') . '</label></th><td>';
		echo '<textarea id="fgpx_default_style_json" name="fgpx_default_style_json" rows="10" style="width:100%;font-family:monospace;">' . \esc_textarea($styleJsonValue) . '</textarea>';
		echo '<p class="description">' . \esc_html__('If provided, this full MapLibre style JSON takes precedence over URL and default raster.', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_default_height">' . \esc_html__('Default height', 'flyover-gpx') . '</label></th><td>';
		echo '<input type="text" id="fgpx_default_height" name="fgpx_default_height" class="regular-text" value="' . \esc_attr($defHeight) . '" placeholder="500px or 70vh" />';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_default_zoom">' . \esc_html__('Default zoom', 'flyover-gpx') . '</label></th><td>';
		echo '<input type="number" id="fgpx_default_zoom" name="fgpx_default_zoom" class="small-text" min="1" max="20" step="1" value="' . \esc_attr($defZoom) . '" />';
		echo '<p class="description">' . \esc_html__('Initial and reset zoom (lower = wider view).', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_default_pitch">' . \esc_html__('Default pitch', 'flyover-gpx') . '</label></th><td>';
		echo '<input type="number" id="fgpx_default_pitch" name="fgpx_default_pitch" class="small-text" min="0" max="60" step="1" value="' . \esc_attr($defPitch) . '" />';
		echo '<p class="description">' . \esc_html__('Map viewing angle tilt in degrees. Lower = flatter (top-down).', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		echo '</table>';

		// Playback Controls Section
		echo '<h3 style="margin-top: 30px; padding: 10px 0; border-bottom: 2px solid #ddd; color: #23282d;">' . \esc_html__('▶️ Playback Controls & Interface', 'flyover-gpx') . '</h3>';
		echo '<table class="form-table" role="presentation">';
		echo '<tr><th scope="row"><label for="fgpx_default_speed">' . \esc_html__('Default speed (×)', 'flyover-gpx') . '</label></th><td>';
		echo '<select id="fgpx_default_speed" name="fgpx_default_speed">';
		foreach (['1','10','25','50','100','250'] as $opt) { echo '<option value="' . esc_attr($opt) . '"' . selected($defSpeed, $opt, false) . '>' . esc_html($opt . '×') . '</option>'; }
		echo '</select>';
		echo '<p class="description">' . \esc_html__('Initial playback speed multiplier.', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_show_labels">' . \esc_html__('Show max elev/speed labels', 'flyover-gpx') . '</label></th><td>';
		echo '<label><input type="checkbox" id="fgpx_show_labels" name="fgpx_show_labels" value="1"' . ($showLabels !== '0' ? ' checked' : '') . ' /> ' . \esc_html__('Display text labels (🏔 / 🚀) on the map', 'flyover-gpx') . '</label>';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_hud_enabled">' . \esc_html__('Enable HUD (speed/distance/elevation)', 'flyover-gpx') . '</label></th><td>';
		echo '<label><input type="checkbox" id="fgpx_hud_enabled" name="fgpx_hud_enabled" value="1"' . ($hudEnabled === '1' ? ' checked' : '') . ' /> ' . \esc_html__('Show live HUD overlay on the map', 'flyover-gpx') . '</label>';
		echo '</td></tr>';
		echo '</table>';

		// Route Visualization Section
		echo '<h3 style="margin-top: 30px; padding: 10px 0; border-bottom: 2px solid #ddd; color: #23282d;">' . \esc_html__('🎨 Route Visualization & Charts', 'flyover-gpx') . '</h3>';
		echo '<table class="form-table" role="presentation">';
		echo '<tr><th scope="row"><label for="fgpx_elevation_coloring">' . \esc_html__('Enable elevation-based route coloring', 'flyover-gpx') . '</label></th><td>';
		echo '<label><input type="checkbox" id="fgpx_elevation_coloring" name="fgpx_elevation_coloring" value="1"' . ($elevationColoring === '1' ? ' checked' : '') . ' /> ' . \esc_html__('Color the progressive route based on elevation gradient (steepness)', 'flyover-gpx') . '</label>';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_elevation_color_flat">' . \esc_html__('Flat terrain color', 'flyover-gpx') . '</label></th><td>';
		echo '<input type="color" id="fgpx_elevation_color_flat" name="fgpx_elevation_color_flat" value="' . \esc_attr($elevationColorFlat) . '" />';
		echo '<p class="description">' . \esc_html__('Color for flat or gentle gradients (below threshold).', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_elevation_color_steep">' . \esc_html__('Steep terrain color', 'flyover-gpx') . '</label></th><td>';
		echo '<input type="color" id="fgpx_elevation_color_steep" name="fgpx_elevation_color_steep" value="' . \esc_attr($elevationColorSteep) . '" />';
		echo '<p class="description">' . \esc_html__('Color for steep gradients (at maximum threshold).', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_elevation_threshold_min">' . \esc_html__('Gradient threshold (min %)', 'flyover-gpx') . '</label></th><td>';
		echo '<input type="number" id="fgpx_elevation_threshold_min" name="fgpx_elevation_threshold_min" class="small-text" min="0" max="20" step="0.1" value="' . \esc_attr($elevationThresholdMin) . '" />';
		echo '<p class="description">' . \esc_html__('Minimum gradient percentage to start color blending. Default 3%.', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_elevation_threshold_max">' . \esc_html__('Gradient threshold (max %)', 'flyover-gpx') . '</label></th><td>';
		echo '<input type="number" id="fgpx_elevation_threshold_max" name="fgpx_elevation_threshold_max" class="small-text" min="1" max="50" step="0.1" value="' . \esc_attr($elevationThresholdMax) . '" />';
		echo '<p class="description">' . \esc_html__('Maximum gradient percentage for full steep color. Default 8%.', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_chart_color">' . \esc_html__('Elevation chart color', 'flyover-gpx') . '</label></th><td>';
		echo '<input type="color" id="fgpx_chart_color" name="fgpx_chart_color" value="' . \esc_attr($chartColor) . '" />';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_chart_color2">' . \esc_html__('Speed chart color', 'flyover-gpx') . '</label></th><td>';
		echo '<input type="color" id="fgpx_chart_color2" name="fgpx_chart_color2" value="' . \esc_attr($chartColor2) . '" />';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_chart_color_hr">' . \esc_html__('Heart rate chart color', 'flyover-gpx') . '</label></th><td>';
		echo '<input type="color" id="fgpx_chart_color_hr" name="fgpx_chart_color_hr" value="' . \esc_attr($chartColorHr) . '" />';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_chart_color_cad">' . \esc_html__('Cadence chart color', 'flyover-gpx') . '</label></th><td>';
		echo '<input type="color" id="fgpx_chart_color_cad" name="fgpx_chart_color_cad" value="' . \esc_attr($chartColorCad) . '" />';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_chart_color_temp">' . \esc_html__('Temperature chart color', 'flyover-gpx') . '</label></th><td>';
		echo '<input type="color" id="fgpx_chart_color_temp" name="fgpx_chart_color_temp" value="' . \esc_attr($chartColorTemp) . '" />';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_chart_color_power">' . \esc_html__('Power chart color', 'flyover-gpx') . '</label></th><td>';
		echo '<input type="color" id="fgpx_chart_color_power" name="fgpx_chart_color_power" value="' . \esc_attr($chartColorPower) . '" />';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_chart_color_wind_impact">' . \esc_html__('Wind impact chart color', 'flyover-gpx') . '</label></th><td>';
		echo '<input type="color" id="fgpx_chart_color_wind_impact" name="fgpx_chart_color_wind_impact" value="' . \esc_attr($chartColorWindImpact) . '" />';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_chart_color_wind_rose">' . \esc_html__('Wind rose chart color (default)', 'flyover-gpx') . '</label></th><td>';
		echo '<input type="color" id="fgpx_chart_color_wind_rose" name="fgpx_chart_color_wind_rose" value="' . \esc_attr($chartColorWindRose) . '" />';
		echo '</td></tr>';
		
		// Wind rose directional colors
		$windRoseColorNorth = $options['fgpx_wind_rose_color_north']; // Blue - Headwind
		$windRoseColorSouth = $options['fgpx_wind_rose_color_south']; // Green - Tailwind  
		$windRoseColorEast = $options['fgpx_wind_rose_color_east'];   // Orange - Right sidewind
		$windRoseColorWest = $options['fgpx_wind_rose_color_west'];   // Red - Left sidewind
		
		echo '<tr><th scope="row">' . \esc_html__('Wind Rose Directional Colors', 'flyover-gpx') . '</th><td>';
		echo '<p style="margin: 0 0 10px 0; color: #666;">' . \esc_html__('Colors for the 4 main wind directions (±45°)', 'flyover-gpx') . '</p>';
		echo '<div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; max-width: 400px;">';
		
		echo '<div><label for="fgpx_wind_rose_color_north" style="display: block; margin-bottom: 5px;">' . \esc_html__('North (Headwind)', 'flyover-gpx') . '</label>';
		echo '<input type="color" id="fgpx_wind_rose_color_north" name="fgpx_wind_rose_color_north" value="' . \esc_attr($windRoseColorNorth) . '" /></div>';
		
		echo '<div><label for="fgpx_wind_rose_color_south" style="display: block; margin-bottom: 5px;">' . \esc_html__('South (Tailwind)', 'flyover-gpx') . '</label>';
		echo '<input type="color" id="fgpx_wind_rose_color_south" name="fgpx_wind_rose_color_south" value="' . \esc_attr($windRoseColorSouth) . '" /></div>';
		
		echo '<div><label for="fgpx_wind_rose_color_east" style="display: block; margin-bottom: 5px;">' . \esc_html__('East (Right Sidewind)', 'flyover-gpx') . '</label>';
		echo '<input type="color" id="fgpx_wind_rose_color_east" name="fgpx_wind_rose_color_east" value="' . \esc_attr($windRoseColorEast) . '" /></div>';
		
		echo '<div><label for="fgpx_wind_rose_color_west" style="display: block; margin-bottom: 5px;">' . \esc_html__('West (Left Sidewind)', 'flyover-gpx') . '</label>';
		echo '<input type="color" id="fgpx_wind_rose_color_west" name="fgpx_wind_rose_color_west" value="' . \esc_attr($windRoseColorWest) . '" /></div>';
		
		echo '</div></td></tr>';
		echo '</table>';

		// Media & Privacy Section
		echo '<h3 style="margin-top: 30px; padding: 10px 0; border-bottom: 2px solid #ddd; color: #23282d;">' . \esc_html__('📷 Media & Privacy', 'flyover-gpx') . '</h3>';
		echo '<table class="form-table" role="presentation">';
		echo '<tr><th scope="row"><label for="fgpx_photos_enabled">' . \esc_html__('Enable photo thumbnails/overlay', 'flyover-gpx') . '</label></th><td>';
		echo '<label><input type="checkbox" id="fgpx_photos_enabled" name="fgpx_photos_enabled" value="1"' . ($photosEnabled === '1' ? ' checked' : '') . ' /> ' . \esc_html__('Show gallery photos on the map and fullscreen on cue', 'flyover-gpx') . '</label>';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_privacy_enabled">' . \esc_html__('Enable privacy mode', 'flyover-gpx') . '</label></th><td>';
		echo '<label><input type="checkbox" id="fgpx_privacy_enabled" name="fgpx_privacy_enabled" value="1"' . ($privacyEnabled === '1' ? ' checked' : '') . ' /> ' . \esc_html__('Hide first/last N km from playback (stats unaffected)', 'flyover-gpx') . '</label>';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_privacy_km">' . \esc_html__('Privacy distance (km)', 'flyover-gpx') . '</label></th><td>';
		echo '<input type="number" id="fgpx_privacy_km" name="fgpx_privacy_km" class="small-text" min="0" step="0.1" value="' . \esc_attr($privacyKm) . '" />';
		echo '<p class="description">' . \esc_html__('Each end hidden by this distance when privacy mode is enabled. Default 3 km.', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		echo '</table>';

		// Weather Integration Section
		echo '<h3 style="margin-top: 30px; padding: 10px 0; border-bottom: 2px solid #ddd; color: #23282d;">' . \esc_html__('🌦️ Weather Integration', 'flyover-gpx') . '</h3>';
		echo '<table class="form-table" role="presentation">';
		
		// Weather enrichment settings
		$weatherEnabled = $options['fgpx_weather_enabled'];
		$weatherSampling = $options['fgpx_weather_sampling'];
		$weatherStepKm = (float) $options['fgpx_weather_step_km'];
		$weatherStepMin = (int) $options['fgpx_weather_step_min'];
		$weatherOpacity = (float) $options['fgpx_weather_opacity'];
		$weatherVisibleByDefault = $options['fgpx_weather_visible_by_default'];
		$weatherHeatmapZoom0 = (int) $options['fgpx_weather_heatmap_zoom0'];
		$weatherHeatmapZoom9 = (int) $options['fgpx_weather_heatmap_zoom9'];
		$weatherHeatmapZoom12 = (int) $options['fgpx_weather_heatmap_zoom12'];
		$weatherHeatmapZoom14 = (int) $options['fgpx_weather_heatmap_zoom14'];
		$weatherHeatmapZoom15 = (int) $options['fgpx_weather_heatmap_zoom15'];
		$weatherMultiPoint = $options['fgpx_weather_multi_point'];
		$weatherMultiPointDistance = (float) $options['fgpx_weather_multi_point_distance'];
		$windAnalysisEnabled = $options['fgpx_wind_analysis_enabled'];
		$windInterpolationDensity = (int) $options['fgpx_wind_interpolation_density'];

		echo '<tr><th scope="row"><label for="fgpx_weather_enabled">' . \esc_html__('Enable weather enrichment', 'flyover-gpx') . '</label></th><td>';
		echo '<label><input type="checkbox" id="fgpx_weather_enabled" name="fgpx_weather_enabled" value="1"' . ($weatherEnabled === '1' ? ' checked' : '') . ' /> ' . \esc_html__('Fetch weather data during GPX import and show on map', 'flyover-gpx') . '</label>';
		echo '<p class="description">' . \esc_html__('Uses Open-Meteo API (no key required) to add weather data (rain, snow, fog, clouds) to tracks.', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_weather_visible_by_default">' . \esc_html__('Weather overlay buttons enabled by default', 'flyover-gpx') . '</label></th><td>';
		echo '<label><input type="checkbox" id="fgpx_weather_visible_by_default" name="fgpx_weather_visible_by_default" value="1"' . ($weatherVisibleByDefault === '1' ? ' checked' : '') . ' /> ' . \esc_html__('Show rain, temperature, and wind overlays when map loads (users can still toggle)', 'flyover-gpx') . '</label>';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_weather_sampling">' . \esc_html__('Weather sampling mode', 'flyover-gpx') . '</label></th><td>';
		echo '<select id="fgpx_weather_sampling" name="fgpx_weather_sampling">';
		echo '<option value="distance"' . selected($weatherSampling, 'distance', false) . '>' . \esc_html__('By distance', 'flyover-gpx') . '</option>';
		echo '<option value="time"' . selected($weatherSampling, 'time', false) . '>' . \esc_html__('By time', 'flyover-gpx') . '</option>';
		echo '</select>';
		echo '<p class="description">' . \esc_html__('Sample weather data at regular distance intervals or time intervals.', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_weather_step_km">' . \esc_html__('Distance sampling (km)', 'flyover-gpx') . '</label></th><td>';
		echo '<input type="number" id="fgpx_weather_step_km" name="fgpx_weather_step_km" class="small-text" min="5" max="20" step="1" value="' . \esc_attr($weatherStepKm) . '" />';
		echo '<p class="description">' . \esc_html__('Sample weather every N kilometers along the route.', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_weather_step_min">' . \esc_html__('Time sampling (minutes)', 'flyover-gpx') . '</label></th><td>';
		echo '<input type="number" id="fgpx_weather_step_min" name="fgpx_weather_step_min" class="small-text" min="5" max="60" step="5" value="' . \esc_attr($weatherStepMin) . '" />';
		echo '<p class="description">' . \esc_html__('Sample weather every N minutes during the track time.', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_weather_opacity">' . \esc_html__('Rain overlay opacity', 'flyover-gpx') . '</label></th><td>';
		echo '<input type="number" id="fgpx_weather_opacity" name="fgpx_weather_opacity" class="small-text" min="0.1" max="1.0" step="0.1" value="' . \esc_attr($weatherOpacity) . '" />';
		echo '<p class="description">' . \esc_html__('Opacity of the weather heatmap overlay (0.1 = very transparent, 1.0 = opaque).', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		echo '<tr><th scope="row">' . \esc_html__('Weather heatmap radius at zoom levels', 'flyover-gpx') . '</th><td>';
		echo '<label for="fgpx_weather_heatmap_zoom0">Zoom 0: <input type="number" id="fgpx_weather_heatmap_zoom0" name="fgpx_weather_heatmap_zoom0" class="small-text" min="10" max="100" value="' . \esc_attr($weatherHeatmapZoom0) . '" />px</label><br>';
		echo '<label for="fgpx_weather_heatmap_zoom9">Zoom 9: <input type="number" id="fgpx_weather_heatmap_zoom9" name="fgpx_weather_heatmap_zoom9" class="small-text" min="50" max="500" value="' . \esc_attr($weatherHeatmapZoom9) . '" />px</label><br>';
		echo '<label for="fgpx_weather_heatmap_zoom12">Zoom 12: <input type="number" id="fgpx_weather_heatmap_zoom12" name="fgpx_weather_heatmap_zoom12" class="small-text" min="200" max="10000" value="' . \esc_attr($weatherHeatmapZoom12) . '" />px</label><br>';
		echo '<label for="fgpx_weather_heatmap_zoom14">Zoom 14: <input type="number" id="fgpx_weather_heatmap_zoom14" name="fgpx_weather_heatmap_zoom14" class="small-text" min="500" max="10000" value="' . \esc_attr($weatherHeatmapZoom14) . '" />px</label><br>';
		echo '<label for="fgpx_weather_heatmap_zoom15">Zoom 15: <input type="number" id="fgpx_weather_heatmap_zoom15" name="fgpx_weather_heatmap_zoom15" class="small-text" min="1000" max="10000" value="' . \esc_attr($weatherHeatmapZoom15) . '" />px</label>';
		echo '<p class="description">' . \esc_html__('Heatmap radius for ALL weather types (rain, snow, fog, clouds). Larger values (1000-6000+) create extensive coverage. Rain circles at high zoom use hardcoded sizes.', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		
		echo '<tr><th scope="row"><label for="fgpx_weather_multi_point">' . \esc_html__('Multi-point weather sampling', 'flyover-gpx') . '</label></th><td>';
		echo '<label><input type="checkbox" id="fgpx_weather_multi_point" name="fgpx_weather_multi_point" value="1"' . ($weatherMultiPoint === '1' ? ' checked' : '') . ' /> ' . \esc_html__('Query additional weather points around each track position (N, S, E, W)', 'flyover-gpx') . '</label>';
		echo '<p class="description">' . \esc_html__('Provides better weather coverage by sampling points in all directions around the track.', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_weather_multi_point_distance">' . \esc_html__('Multi-point distance (km)', 'flyover-gpx') . '</label></th><td>';
		echo '<input type="number" id="fgpx_weather_multi_point_distance" name="fgpx_weather_multi_point_distance" class="small-text" min="1" max="20" step="0.5" value="' . \esc_attr($weatherMultiPointDistance) . '" />';
		echo '<p class="description">' . \esc_html__('Distance in kilometers for additional sample points (North, South, East, West of track position).', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		
		// Multi-Weather Visualization Settings
		$weatherPriorityOrder = $options['fgpx_weather_priority_order'];
		$weatherFogThreshold = (float) $options['fgpx_weather_fog_threshold'];
		$weatherColorSnow = $options['fgpx_weather_color_snow'];
		$weatherColorRain = $options['fgpx_weather_color_rain'];
		$weatherColorFog = $options['fgpx_weather_color_fog'];
		$weatherColorClouds = $options['fgpx_weather_color_clouds'];
		
		echo '<tr><th scope="row" style="padding-top: 20px; border-top: 1px solid #ddd;"><label for="fgpx_weather_priority_order">' . \esc_html__('Weather type priority order', 'flyover-gpx') . '</label></th><td style="padding-top: 20px; border-top: 1px solid #ddd;">';
		echo '<input type="text" id="fgpx_weather_priority_order" name="fgpx_weather_priority_order" class="regular-text" value="' . \esc_attr($weatherPriorityOrder) . '" />';
		echo '<p class="description">' . \esc_html__('Comma-separated priority order for weather visualization. When multiple conditions exist, the first one in this list will be displayed. Options: snow, rain, fog, clouds', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_weather_fog_threshold">' . \esc_html__('Fog detection threshold', 'flyover-gpx') . '</label></th><td>';
		echo '<input type="number" id="fgpx_weather_fog_threshold" name="fgpx_weather_fog_threshold" class="small-text" min="0.1" max="1.0" step="0.05" value="' . \esc_attr($weatherFogThreshold) . '" />';
		echo '<p class="description">' . \esc_html__('Fog intensity threshold (0.1-1.0). Only fog above this intensity will be displayed. Lower values = more sensitive detection. Recommended: 0.3', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		echo '<tr><th scope="row">' . \esc_html__('Weather visualization colors', 'flyover-gpx') . '</th><td>';
		echo '<label for="fgpx_weather_color_snow" style="display: inline-block; margin-right: 20px; margin-bottom: 8px;">' . \esc_html__('Snow:', 'flyover-gpx') . ' <input type="color" id="fgpx_weather_color_snow" name="fgpx_weather_color_snow" value="' . \esc_attr($weatherColorSnow) . '" /></label>';
		echo '<label for="fgpx_weather_color_rain" style="display: inline-block; margin-right: 20px; margin-bottom: 8px;">' . \esc_html__('Rain:', 'flyover-gpx') . ' <input type="color" id="fgpx_weather_color_rain" name="fgpx_weather_color_rain" value="' . \esc_attr($weatherColorRain) . '" /></label><br>';
		echo '<label for="fgpx_weather_color_fog" style="display: inline-block; margin-right: 20px; margin-bottom: 8px;">' . \esc_html__('Fog:', 'flyover-gpx') . ' <input type="color" id="fgpx_weather_color_fog" name="fgpx_weather_color_fog" value="' . \esc_attr($weatherColorFog) . '" /></label>';
		echo '<label for="fgpx_weather_color_clouds" style="display: inline-block; margin-right: 20px; margin-bottom: 8px;">' . \esc_html__('Clouds:', 'flyover-gpx') . ' <input type="color" id="fgpx_weather_color_clouds" name="fgpx_weather_color_clouds" value="' . \esc_attr($weatherColorClouds) . '" /></label>';
		echo '<p class="description">' . \esc_html__('Customize colors for each weather type visualization on the map.', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		
		// Wind Analysis Settings
		echo '<tr><th scope="row" style="padding-top: 20px; border-top: 1px solid #ddd;"><label for="fgpx_wind_analysis_enabled">' . \esc_html__('Enable wind impact analysis', 'flyover-gpx') . '</label></th><td style="padding-top: 20px; border-top: 1px solid #ddd;">';
		echo '<label><input type="checkbox" id="fgpx_wind_analysis_enabled" name="fgpx_wind_analysis_enabled" value="1"' . ($windAnalysisEnabled === '1' ? ' checked' : '') . ' /> ' . \esc_html__('Calculate wind impact on track performance and show in charts', 'flyover-gpx') . '</label>';
		echo '<p class="description">' . \esc_html__('Requires weather data to be enabled. Calculates headwind/tailwind effects on speed and shows wind rose charts.', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_wind_interpolation_density">' . \esc_html__('Wind data interpolation density', 'flyover-gpx') . '</label></th><td>';
		echo '<select id="fgpx_wind_interpolation_density" name="fgpx_wind_interpolation_density">';
		echo '<option value="1"' . selected($windInterpolationDensity, 1, false) . '>' . \esc_html__('High (every point)', 'flyover-gpx') . '</option>';
		echo '<option value="3"' . selected($windInterpolationDensity, 3, false) . '>' . \esc_html__('Medium (every 3rd point)', 'flyover-gpx') . '</option>';
		echo '<option value="5"' . selected($windInterpolationDensity, 5, false) . '>' . \esc_html__('Low (every 5th point)', 'flyover-gpx') . '</option>';
		echo '</select>';
		echo '<p class="description">' . \esc_html__('Balance between accuracy and performance for wind data interpolation.', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		
		// Day/Night Settings (moved from Route Visualization section)
		echo '<tr><th scope="row" style="padding-top: 20px; border-top: 1px solid #ddd;"><label for="fgpx_daynight_enabled">' . \esc_html__('Enable day/night chart visualization', 'flyover-gpx') . '</label></th><td style="padding-top: 20px; border-top: 1px solid #ddd;">';
		echo '<label><input type="checkbox" id="fgpx_daynight_enabled" name="fgpx_daynight_enabled" value="1"' . ($options['fgpx_daynight_enabled'] === '1' ? ' checked' : '') . ' /> ' . \esc_html__('Show sunrise/sunset lines and night periods in charts', 'flyover-gpx') . '</label>';
		echo '<p class="description">' . \esc_html__('Displays yellow lines at sunrise/sunset times and blue background for night periods in time-based charts.', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_daynight_map_enabled">' . \esc_html__('Enable day/night map overlay', 'flyover-gpx') . '</label></th><td>';
		echo '<label><input type="checkbox" id="fgpx_daynight_map_enabled" name="fgpx_daynight_map_enabled" value="1"' . ($options['fgpx_daynight_map_enabled'] === '1' ? ' checked' : '') . ' /> ' . \esc_html__('Show animated night overlay on the map during track playback', 'flyover-gpx') . '</label>';
		echo '<p class="description">' . \esc_html__('Displays a smooth blue overlay on the map during night periods with animated transitions at sunrise/sunset.', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_daynight_map_color">' . \esc_html__('Night overlay color', 'flyover-gpx') . '</label></th><td>';
		echo '<input type="color" id="fgpx_daynight_map_color" name="fgpx_daynight_map_color" value="' . \esc_attr($options['fgpx_daynight_map_color']) . '" />';
		echo '<p class="description">' . \esc_html__('Color of the night overlay on the map. Default is deep blue (#000080).', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_daynight_map_opacity">' . \esc_html__('Night overlay opacity', 'flyover-gpx') . '</label></th><td>';
		echo '<input type="number" id="fgpx_daynight_map_opacity" name="fgpx_daynight_map_opacity" class="small-text" min="0.1" max="1.0" step="0.1" value="' . \esc_attr($options['fgpx_daynight_map_opacity']) . '" />';
		echo '<p class="description">' . \esc_html__('Opacity of the night overlay (0.1 = very transparent, 1.0 = opaque). Default 0.4.', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		echo '</table>';

		// Performance & Optimization Section
		echo '<h3 style="margin-top: 30px; padding: 10px 0; border-bottom: 2px solid #ddd; color: #23282d;">' . \esc_html__('⚡ Performance & Optimization', 'flyover-gpx') . '</h3>';
		echo '<table class="form-table" role="presentation">';
		echo '<tr><th scope="row"><label for="fgpx_backend_simplify_enabled">' . \esc_html__('Backend GPX simplification', 'flyover-gpx') . '</label></th><td>';
		echo '<label><input type="checkbox" id="fgpx_backend_simplify_enabled" name="fgpx_backend_simplify_enabled" value="1"' . ($backendSimplify === '1' ? ' checked' : '') . ' /> ' . \esc_html__('Simplify track on the server (recommended for large tracks 40k+ points). The original GPX remains unchanged.', 'flyover-gpx') . '</label>';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_backend_simplify_target">' . \esc_html__('Simplification target points', 'flyover-gpx') . '</label></th><td>';
		echo '<input type="number" id="fgpx_backend_simplify_target" name="fgpx_backend_simplify_target" class="small-text" min="300" max="2500" step="100" value="' . \esc_attr($backendSimplifyTarget) . '" />';
		echo '<p class="description">' . \esc_html__('Base target for Ramer–Douglas–Peucker simplification (default 1200). System automatically adjusts based on track size for optimal performance.', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_prefetch_enabled">' . \esc_html__('Enable tile prefetching', 'flyover-gpx') . '</label></th><td>';
		echo '<label><input type="checkbox" id="fgpx_prefetch_enabled" name="fgpx_prefetch_enabled" value="1"' . ($prefetchEnabled === '1' ? ' checked' : '') . ' /> ' . \esc_html__('Proactively prefetch map tiles (faster feel, more external requests). Uncheck to reduce requests/quotas.', 'flyover-gpx') . '</label>';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_lazy_viewport">' . \esc_html__('Lazy load on viewport', 'flyover-gpx') . '</label></th><td>';
        echo '<label><input type="checkbox" id="fgpx_lazy_viewport" name="fgpx_lazy_viewport" value="1"' . ($lazyViewport === '1' ? ' checked' : '') . ' /> ' .
             \esc_html__('Only load map libraries & tiles when the player scrolls into view.', 'flyover-gpx') . '</label>';
        echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_asset_fallbacks_enabled">' . \esc_html__('Asset fallbacks', 'flyover-gpx') . '</label></th><td>';
		echo '<label><input type="checkbox" id="fgpx_asset_fallbacks_enabled" name="fgpx_asset_fallbacks_enabled" value="1"' . ($options['fgpx_asset_fallbacks_enabled'] === '1' ? ' checked' : '') . ' /> ' . \esc_html__('Enable automatic fallback to alternative CDNs if primary assets fail to load', 'flyover-gpx') . '</label>';
		echo '<p class="description">' . \esc_html__('Improves reliability by automatically switching to backup CDNs when primary assets are unavailable.', 'flyover-gpx') . '</p>';
		echo '</td></tr>';
		echo '</table>';

		// Development & Debugging Section
		echo '<h3 style="margin-top: 30px; padding: 10px 0; border-bottom: 2px solid #ddd; color: #23282d;">' . \esc_html__('🔧 Development & Debugging', 'flyover-gpx') . '</h3>';
		echo '<table class="form-table" role="presentation">';
		echo '<tr><th scope="row"><label for="fgpx_debug_logging">' . \esc_html__('Enable debug logging', 'flyover-gpx') . '</label></th><td>';
		echo '<label><input type="checkbox" id="fgpx_debug_logging" name="fgpx_debug_logging" value="1"' . ($debugLogging === '1' ? ' checked' : '') . ' /> ' . \esc_html__('Output detailed console debug messages (performance impact in production).', 'flyover-gpx') . '</label>';
		echo '</td></tr>';
		echo '<tr><th scope="row"><label for="fgpx_debug_weather_data">' . \esc_html__('Enable debug weather data', 'flyover-gpx') . '</label></th><td>';
		echo '<label><input type="checkbox" id="fgpx_debug_weather_data" name="fgpx_debug_weather_data" value="1"' . ($debugWeatherData === '1' ? ' checked' : '') . ' /> ' . \esc_html__('Add realistic debug weather data (rain, heart rate, cadence) for testing purposes.', 'flyover-gpx') . '</label>';
		echo '</td></tr>';
		echo '</table>';

		// Error Logging Section
		echo '<h3 style="margin-top: 30px; padding: 10px 0; border-bottom: 2px solid #ddd; color: #23282d;">' . \esc_html__('📋 Error Logging & Diagnostics', 'flyover-gpx') . '</h3>';
		echo '<table class="form-table" role="presentation">';
		
		$logStats = ErrorHandler::getLogStats();
		echo '<tr><th scope="row">' . \esc_html__('Log Status', 'flyover-gpx') . '</th><td>';
		if ($logStats['log_file_exists']) {
			echo '<span style="color: #00a32a;">✓ ' . \esc_html__('Active', 'flyover-gpx') . '</span><br>';
			echo '<small>' . \sprintf(\esc_html__('File size: %s | Lines: %d', 'flyover-gpx'), \size_format($logStats['log_file_size']), $logStats['log_file_lines']) . '</small>';
		} else {
			echo '<span style="color: #666;">—</span> ' . \esc_html__('No log file', 'flyover-gpx');
		}
		echo '</td></tr>';
		
		echo '<tr><th scope="row">' . \esc_html__('Log Actions', 'flyover-gpx') . '</th><td>';
		if ($logStats['log_file_exists']) {
			$downloadNonce = \wp_create_nonce('fgpx_download_logs');
			$clearNonce = \wp_create_nonce('fgpx_clear_logs');
			echo '<button type="button" class="button" onclick="window.open(\'' . \admin_url('admin-ajax.php?action=fgpx_download_logs&nonce=' . $downloadNonce) . '\')">' . \esc_html__('Download Logs', 'flyover-gpx') . '</button> ';
			echo '<button type="button" class="button" id="fgpx-clear-logs" data-nonce="' . \esc_attr($clearNonce) . '">' . \esc_html__('Clear Logs', 'flyover-gpx') . '</button>';
		} else {
			echo '<em>' . \esc_html__('No logs available', 'flyover-gpx') . '</em>';
		}
		echo '</td></tr>';
		echo '</table>';
		echo '<p class="submit"><button type="submit" class="button button-primary">' . \esc_html__('Save defaults', 'flyover-gpx') . '</button></p>';
		echo '</form>';

		echo '<hr />';
		echo '<h2>' . \esc_html__('Player Theme (Custom CSS)', 'flyover-gpx') . '</h2>';
		echo '<form method="post" action="' . $actionUrl . '">';
		echo '<input type="hidden" name="action" value="fgpx_save_settings" />';
		echo '<input type="hidden" name="fgpx_nonce" value="' . \esc_attr(\wp_create_nonce('fgpx_save_settings')) . '" />';
		echo '<p>' . \esc_html__('Add custom CSS to override the player styles. These rules load after the default stylesheet.', 'flyover-gpx') . '</p>';
		echo '<textarea name="fgpx_custom_css" rows="10" style="width:100%;font-family:monospace;">' . \esc_textarea($customCss) . '</textarea>';
		echo '<p class="submit"><button type="submit" class="button button-primary">' . \esc_html__('Save CSS', 'flyover-gpx') . '</button></p>';
		echo '</form>';
		echo '</div>';
	}

	/**
	 * Render the Add New Track page HTML.
	 */
	public function render_add_new_track_page(): void
	{
		if (!\current_user_can('upload_files')) {
			\wp_die(\esc_html__('You do not have permission to access this page.', 'flyover-gpx'));
		}

		$actionUrl = \esc_url(\admin_url('admin-post.php'));
		$hasPhpGpx = \class_exists('\\phpGPX\\phpGPX');

		echo '<div class="wrap">';
		echo '<h1>' . \esc_html__('Add New Track', 'flyover-gpx') . '</h1>';
		
		if (!$hasPhpGpx) {
			echo '<div class="notice notice-error"><p>' . \esc_html__('phpGPX library is missing. Please run composer install in the plugin directory before uploading GPX files.', 'flyover-gpx') . '</p></div>';
		}
		
		echo '<div class="fgpx-upload-form">';
		echo '<h3>' . \esc_html__('Upload GPX File', 'flyover-gpx') . '</h3>';
		echo '<p>' . \esc_html__('Upload a GPX file to create a new track. The file will be processed and you will be redirected to edit the track details.', 'flyover-gpx') . '</p>';
		
		echo '<form method="post" action="' . $actionUrl . '" enctype="multipart/form-data">';
		echo '<input type="hidden" name="action" value="fgpx_upload" />';
		echo '<input type="hidden" name="fgpx_nonce" value="' . \esc_attr(\wp_create_nonce('fgpx_upload')) . '" />';
		echo '<input type="hidden" name="redirect_to_edit" value="1" />';
		
		echo '<div class="file-input-wrapper">';
		echo '<label for="fgpx_file"><strong>' . \esc_html__('Select a GPX file (max 20MB):', 'flyover-gpx') . '</strong></label>';
		echo '<input type="file" id="fgpx_file" name="fgpx_file" accept=".gpx,application/gpx+xml,application/xml,text/xml" ' . (!$hasPhpGpx ? 'disabled' : 'required') . ' />';
		echo '<p class="description">' . \esc_html__('Supported formats: .gpx files. After upload, you will be redirected to edit the track details.', 'flyover-gpx') . '</p>';
		echo '</div>';
		
		echo '<p class="submit"><button type="submit" class="button button-primary" ' . (!$hasPhpGpx ? 'disabled' : '') . '>' . \esc_html__('Upload and Create Track', 'flyover-gpx') . '</button></p>';
		echo '</form>';
		echo '</div>';
		
		echo '</div>';
	}

	/**
	 * Handle upload form submission: validate, store, parse, and create track post.
	 */
	public function handle_upload_form(): void
	{
		try {
			// Log upload attempt
			ErrorHandler::info('GPX upload attempt started', [
				'user_id' => \get_current_user_id(),
				'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? 'unknown',
			]);

			// Validate security: both capability and nonce
			$this->validateSecurity('fgpx_upload', 'upload_files');
			
			// Also check edit_posts capability
			$this->validateCapability('edit_posts');

			if (!isset($_FILES['fgpx_file'])) {
			$this->redirect_with_error(\esc_html__('No file provided.', 'flyover-gpx'));
		}

		$file = $_FILES['fgpx_file'];
		if (!\is_array($file) || (int) ($file['error'] ?? 0) !== 0) {
			$this->redirect_with_error(\esc_html__('Upload error.', 'flyover-gpx'));
		}

		$size = (int) ($file['size'] ?? 0);
		$maxBytes = 20 * 1024 * 1024;
		if ($size <= 0 || $size > $maxBytes) {
			$this->redirect_with_error(\esc_html__('File is empty or exceeds 20MB.', 'flyover-gpx'));
		}

		$originalName = (string) ($file['name'] ?? '');
		$ext = \strtolower((string) \pathinfo($originalName, PATHINFO_EXTENSION));
		if ($ext !== 'gpx') {
			$this->redirect_with_error(\esc_html__('Only .gpx files are allowed.', 'flyover-gpx'));
		}

		$allowedMimes = [
			'gpx' => 'application/gpx+xml',
			'xml' => 'application/xml',
			'txtxml' => 'text/xml',
		];

		// Temporary change upload dir to uploads/flyover-gpx
		$upload_dir_filter = static function (array $dirs): array {
			$subdir = '/flyover-gpx';
			$dirs['subdir'] = $subdir;
			$dirs['path'] = rtrim($dirs['basedir'], '/') . $subdir;
			$dirs['url'] = rtrim($dirs['baseurl'], '/') . $subdir;
			return $dirs;
		};

		\add_filter('upload_dir', $upload_dir_filter);
		$uploaded = \wp_handle_upload(
			$file,
			[
				'test_form' => false,
				'mimes' => $allowedMimes,
				'unique_filename_callback' => static function (string $dir, string $name, string $ext): string {
					// Remove extension from name if it's already included
					$nameOnly = \sanitize_file_name($name);
					if (\str_ends_with($nameOnly, $ext)) {
						$nameOnly = \substr($nameOnly, 0, -\strlen($ext));
					}
					$prefix = \uniqid('fgpx_', true);
					return $prefix . '-' . $nameOnly . $ext;
				},
			]
		);
		\remove_filter('upload_dir', $upload_dir_filter);

		if (!\is_array($uploaded) || isset($uploaded['error'])) {
			$message = isset($uploaded['error']) ? (string) $uploaded['error'] : \esc_html__('Upload failed.', 'flyover-gpx');
			$this->redirect_with_error($message);
		}

		$filePath = (string) $uploaded['file']; // Absolute path
		$fileName = \sanitize_file_name((string) \wp_basename($filePath));
		
		// Create a cleaner title by removing the unique prefix and extension
		$cleanTitle = $fileName;
		// Remove the unique prefix (fgpx_xxxxx-)
		if (\preg_match('/^fgpx_[a-f0-9]+\.[a-f0-9]+-(.+)$/', $cleanTitle, $matches)) {
			$cleanTitle = $matches[1];
		}
		// Remove .gpx extension if present
		if (\str_ends_with($cleanTitle, '.gpx')) {
			$cleanTitle = \substr($cleanTitle, 0, -4);
		}
		// Replace underscores with spaces and clean up
		$cleanTitle = \str_replace('_', ' ', $cleanTitle);
		$cleanTitle = \trim($cleanTitle);

		// Create the track post
		$postId = \wp_insert_post([
			'post_title' => $cleanTitle,
			'post_type' => 'fgpx_track',
			'post_status' => 'publish',
		], true);

		if (\is_wp_error($postId)) {
			// Clean up file if post creation fails
			if (\is_readable($filePath)) {
				@\unlink($filePath);
			}
			$this->redirect_with_error($postId->get_error_message());
		}

		// Parse GPX and compute stats
		$parse = $this->parse_gpx_and_stats($filePath);
		if (\is_wp_error($parse)) {
			if (\is_readable($filePath)) {
				@\unlink($filePath);
			}
			$this->redirect_with_error($parse->get_error_message());
		}

		// Get geojson array for processing
		$geojsonArray = $parse['geojson'];
		
		// Store initial meta (without wind data yet) using bulk update for better performance
		$initialMeta = [
			'fgpx_file_path' => $filePath,
			'fgpx_stats' => $parse['stats'],
			'fgpx_bounds' => $parse['bounds'],
			'fgpx_points_count' => (int) $parse['points_count'],
			// Numeric stats for sorting
			'fgpx_total_distance_m' => (float) ($parse['stats']['total_distance_m'] ?? 0),
			'fgpx_moving_time_s' => (float) ($parse['stats']['moving_time_s'] ?? 0),
			'fgpx_elevation_gain_m' => (float) ($parse['stats']['elevation_gain_m'] ?? 0),
		];
		DatabaseOptimizer::bulkUpdatePostMeta($postId, $initialMeta);

		// Enrich with weather data if enabled
		self::enrichWithWeather($postId, \wp_json_encode($geojsonArray));
		
		// Interpolate wind data if enabled (after weather enrichment)
		self::interpolateWindDataForTrack($postId, $geojsonArray);
		
		// Store final geojson with wind data
		\update_post_meta($postId, 'fgpx_geojson', \wp_json_encode($geojsonArray));
		// Invalidate any previous cached JSON for this post
		// Purge new v2 cache key variants
		$modified = (string) \get_post_field('post_modified_gmt', (int) $postId);
		$cache_key_v2_prefix = 'fgpx_json_v2_' . (int) $postId . '_' . $modified;
		// Best-effort: delete exact keys used (host_post and simplify component can vary)
		\delete_transient($cache_key_v2_prefix . '_hp_0_simp_0');

		// Check if we should redirect to edit page (from Add New Track page)
		$redirectToEdit = isset($_POST['redirect_to_edit']) && $_POST['redirect_to_edit'] === '1';
		
		if ($redirectToEdit) {
			// Redirect to edit screen with success notice
			$url = \add_query_arg([
				'post' => (int) $postId,
				'action' => 'edit',
				'fgpx_msg' => 'uploaded',
			], \admin_url('post.php'));
			\wp_safe_redirect($url);
		} else {
			// Redirect to settings page with success notice (original behavior)
			$url = \add_query_arg([
				'page' => 'flyover-gpx',
				'fgpx_msg' => 'uploaded',
			], \admin_url('options-general.php'));
			\wp_safe_redirect($url);
		}
		exit;

		} catch (\Throwable $e) {
			// Handle any unexpected errors during upload
			$error = ErrorHandler::handleException($e, 'GPX upload', true);
			ErrorHandler::error('GPX upload failed', [
				'error_message' => $e->getMessage(),
				'file_name' => $originalName ?? 'unknown',
				'user_id' => \get_current_user_id(),
			]);
			$this->redirect_with_error($error->get_error_message());
		}
	}

	/**
	 * Columns setup for fgpx_track list table.
	 * @param array<string,string> $columns
	 */
	public function columns(array $columns): array
	{
		$insert = [
			'fgpx_distance' => \esc_html__('Distance (km)', 'flyover-gpx'),
			'fgpx_duration' => \esc_html__('Duration', 'flyover-gpx'),
			'fgpx_gain' => \esc_html__('Elev Gain (m)', 'flyover-gpx'),
			'fgpx_points' => \esc_html__('Points', 'flyover-gpx'),
			'fgpx_weather' => \esc_html__('Weather', 'flyover-gpx'),
			'fgpx_wind' => \esc_html__('Wind Data', 'flyover-gpx'),
			'fgpx_uploaded' => \esc_html__('Uploaded', 'flyover-gpx'),
		];
		// Place after title
		$ordered = [];
		foreach ($columns as $key => $label) {
			$ordered[$key] = $label;
			if ($key === 'title') {
				foreach ($insert as $k => $v) { $ordered[$k] = $v; }
			}
		}
		return $ordered;
	}

	/**
	 * Render custom column values.
	 */
	public function render_column(string $column, int $postId): void
	{
		// Use optimized meta queries for better performance
		$stats = (array) DatabaseOptimizer::getPostMeta($postId, 'fgpx_stats', true);
		switch ($column) {
			case 'fgpx_distance':
				$meters = isset($stats['total_distance_m']) ? (float) $stats['total_distance_m'] : (float) DatabaseOptimizer::getPostMeta($postId, 'fgpx_total_distance_m', true);
				$km = $meters / 1000.0;
				echo \esc_html(number_format((float) $km, 2));
				break;
			case 'fgpx_duration':
				$secs = isset($stats['moving_time_s']) ? (float) $stats['moving_time_s'] : (float) DatabaseOptimizer::getPostMeta($postId, 'fgpx_moving_time_s', true);
				echo \esc_html($this->format_hms((int) round($secs)));
				break;
			case 'fgpx_gain':
				$gain = isset($stats['elevation_gain_m']) ? (float) $stats['elevation_gain_m'] : (float) DatabaseOptimizer::getPostMeta($postId, 'fgpx_elevation_gain_m', true);
				echo \esc_html(number_format((float) $gain, 0));
				break;
			case 'fgpx_points':
				$pts = (int) DatabaseOptimizer::getPostMeta($postId, 'fgpx_points_count', true);
				echo \esc_html(number_format($pts));
				break;
			case 'fgpx_weather':
				$this->render_weather_status($postId);
				break;
			case 'fgpx_wind':
				$this->render_wind_status($postId);
				break;
			case 'fgpx_uploaded':
				echo \esc_html(\get_the_date('', $postId));
				break;
		}
	}

	/**
	 * Render weather status column with detailed information.
	 */
	private function render_weather_status(int $postId): void
	{
		$options = Options::getAll();
		$weatherEnabled = $options['fgpx_weather_enabled'] === '1';
		
		if (!$weatherEnabled) {
			echo '<span style="color: #666;" title="Weather enrichment is disabled in settings">—</span>';
			return;
		}

		$weatherPoints = DatabaseOptimizer::getPostMeta($postId, 'fgpx_weather_points', true);
		$weatherSummary = DatabaseOptimizer::getPostMeta($postId, 'fgpx_weather_summary', true);
		
		if (!$weatherPoints || !\is_string($weatherPoints) || $weatherPoints === '') {
			echo '<span style="color: #d63638;" title="No weather data available">✗ None</span>';
			return;
		}

		$decodedWeather = \json_decode($weatherPoints, true);
		if (!\is_array($decodedWeather) || !isset($decodedWeather['features']) || !\is_array($decodedWeather['features'])) {
			echo '<span style="color: #d63638;" title="Invalid weather data format">✗ Error</span>';
			return;
		}

		$pointCount = count($decodedWeather['features']);
		if ($pointCount === 0) {
			echo '<span style="color: #d63638;" title="No weather points found">✗ Empty</span>';
			return;
		}

		// Parse weather summary for additional info
		$summary = null;
		if (\is_string($weatherSummary) && $weatherSummary !== '') {
			$summary = \json_decode($weatherSummary, true);
		}

		$wetPoints = 0;
		$maxRain = 0.0;
		if (\is_array($summary)) {
			$wetPoints = (int) ($summary['wet_points'] ?? 0);
			$maxRain = (float) ($summary['max_mm'] ?? 0);
		}

		// Create status display
		$status = '✓ ' . $pointCount . ' pts';
		$title = sprintf(
			'Weather data: %d points, %d with rain (max: %.1fmm)',
			$pointCount,
			$wetPoints,
			$maxRain
		);

		if ($wetPoints > 0) {
			$rainPercentage = round(($wetPoints / $pointCount) * 100);
			echo '<span style="color: #2271b1;" title="' . \esc_attr($title) . '">' . \esc_html($status) . '</span>';
			echo '<br><small style="color: #666;">' . $rainPercentage . '% rain</small>';
		} else {
			echo '<span style="color: #00a32a;" title="' . \esc_attr($title) . '">' . \esc_html($status) . '</span>';
			echo '<br><small style="color: #666;">dry</small>';
		}
	}

	/**
	 * Render wind data status column with detailed information.
	 */
	private function render_wind_status(int $postId): void
	{
		$options = Options::getAll();
		$windAnalysisEnabled = $options['fgpx_wind_analysis_enabled'] === '1';
		$weatherEnabled = $options['fgpx_weather_enabled'] === '1';
		
		if (!$windAnalysisEnabled) {
			echo '<span style="color: #666;" title="Wind analysis is disabled in settings">—</span>';
			return;
		}

		if (!$weatherEnabled) {
			echo '<span style="color: #d63638;" title="Weather data required for wind analysis">✗ No Weather</span>';
			return;
		}

		// Get geojson to check for wind data
		$geojson = \get_post_meta($postId, 'fgpx_geojson', true);
		if (!$geojson || !\is_string($geojson) || $geojson === '') {
			echo '<span style="color: #d63638;" title="No track data available">✗ No Data</span>';
			return;
		}

		$decodedGeo = json_decode($geojson, true);
		if (!$decodedGeo || !isset($decodedGeo['properties'])) {
			echo '<span style="color: #d63638;" title="Invalid track data">✗ Invalid</span>';
			return;
		}

		$props = $decodedGeo['properties'];
		$windSpeeds = isset($props['windSpeeds']) && is_array($props['windSpeeds']) ? $props['windSpeeds'] : null;
		$windDirections = isset($props['windDirections']) && is_array($props['windDirections']) ? $props['windDirections'] : null;
		$windImpacts = isset($props['windImpacts']) && is_array($props['windImpacts']) ? $props['windImpacts'] : null;

		if (!$windSpeeds || !$windDirections || !$windImpacts) {
			echo '<span style="color: #d63638;" title="Wind data arrays missing - try re-enriching">✗ Missing</span>';
			return;
		}

		// Count non-null values
		$speedCount = count(array_filter($windSpeeds, function($v) { return $v !== null; }));
		$dirCount = count(array_filter($windDirections, function($v) { return $v !== null; }));
		$impactCount = count(array_filter($windImpacts, function($v) { return $v !== null; }));

		if ($speedCount === 0 || $dirCount === 0 || $impactCount === 0) {
			echo '<span style="color: #d63638;" title="Wind data arrays contain only null values">✗ Empty</span>';
			return;
		}

		// Calculate average wind speed for display
		$validSpeeds = array_filter($windSpeeds, function($v) { return $v !== null && $v > 0; });
		$avgSpeed = count($validSpeeds) > 0 ? array_sum($validSpeeds) / count($validSpeeds) : 0;

		// Calculate wind direction distribution for wind rose
		$validDirections = array_filter($windDirections, function($v) { return $v !== null; });
		$directionCount = count($validDirections);
		$uniqueDirections = count(array_unique($validDirections));

		// Calculate wind rose sectors (16 compass sectors)
		$windRoseSectors = array_fill(0, 16, 0);
		foreach ($validDirections as $i => $direction) {
			if (isset($windSpeeds[$i]) && $windSpeeds[$i] !== null && $windSpeeds[$i] > 0) {
				$sector = (int) floor(((floatval($direction) + 11.25) % 360) / 22.5);
				$windRoseSectors[$sector]++;
			}
		}
		$activeSectors = count(array_filter($windRoseSectors, function($v) { return $v > 0; }));

		$status = '✓ ' . $speedCount . ' pts';
		$title = sprintf(
			'Wind data: %d speed points, %d direction points, %d impact points (avg: %.1f km/h)' . "\n" .
			'Wind Rose: %d directions, %d unique, %d/16 sectors active',
			$speedCount,
			$dirCount,
			$impactCount,
			$avgSpeed,
			$directionCount,
			$uniqueDirections,
			$activeSectors
		);

		echo '<span style="color: #00a32a;" title="' . \esc_attr($title) . '">' . \esc_html($status) . '</span>';
		echo '<br><small style="color: #666;">' . number_format($avgSpeed, 1) . ' km/h, ' . $activeSectors . '/16 sectors</small>';
	}

	/**
	 * Sortable columns mapping.
	 */
	public function sortable_columns(array $columns): array
	{
		$columns['fgpx_distance'] = 'fgpx_total_distance_m';
		$columns['fgpx_duration'] = 'fgpx_moving_time_s';
		$columns['fgpx_gain'] = 'fgpx_elevation_gain_m';
		$columns['fgpx_points'] = 'fgpx_points_count';
		return $columns;
	}

	/**
	 * Apply meta-based sorting.
	 */
	public function handle_sorting(\WP_Query $q): void
	{
		if (!\is_admin() || $q->get('post_type') !== 'fgpx_track') { return; }
		$orderby = $q->get('orderby');
		$allowed = ['fgpx_total_distance_m','fgpx_moving_time_s','fgpx_elevation_gain_m','fgpx_points_count'];
		if (\in_array($orderby, $allowed, true)) {
			$q->set('meta_key', $orderby);
			$q->set('orderby', 'meta_value_num');
		}
	}

	/**
	 * Add row actions: Copy Shortcode and Enrich Weather.
	 */
	public function row_actions(array $actions, \WP_Post $post): array
	{
		if ($post->post_type !== 'fgpx_track') { return $actions; }
		$short = '[flyover_gpx id="' . (int) $post->ID . '"]';
		$actions['fgpx_copy'] = '<a href="#" onclick="navigator.clipboard.writeText(\'' . \esc_attr($short) . '\');return false;">' . \esc_html__('Copy Shortcode', 'flyover-gpx') . '</a>';
		
		// Add weather enrichment action
		$nonce = \wp_create_nonce('fgpx_enrich_weather');
		$actions['fgpx_enrich_weather'] = '<a href="#" class="fgpx-enrich-weather" data-post-id="' . (int) $post->ID . '" data-nonce="' . \esc_attr($nonce) . '">' . \esc_html__('Enrich Weather', 'flyover-gpx') . '</a>';
		
		return $actions;
	}

	/**
	 * Register metaboxes on edit screen.
	 */
	public function add_metaboxes(): void
	{
		// Replace GPX functionality removed - use "Add New Track" instead
		\add_meta_box('fgpx_weather_debug', \esc_html__('Weather Data Debug', 'flyover-gpx'), [$this, 'render_metabox_weather_debug'], 'fgpx_track', 'side', 'default');
		\add_meta_box('fgpx_wind_debug', \esc_html__('Wind Data Debug', 'flyover-gpx'), [$this, 'render_metabox_wind_debug'], 'fgpx_track', 'side', 'default');
		\add_meta_box('fgpx_preview', \esc_html__('Track Preview', 'flyover-gpx'), [$this, 'render_metabox_preview'], 'fgpx_track', 'normal', 'high');
	}

	public function render_metabox_preview(\WP_Post $post): void
{
    // Avoid rendering during REST/AJAX requests (e.g., block editor save) to prevent output/noise
    if ((\defined('REST_REQUEST') && REST_REQUEST) || (\defined('DOING_AJAX') && DOING_AJAX)) {
        echo '<p>' . \esc_html__('Preview is unavailable during save operations.', 'flyover-gpx') . '</p>';
        return;
    }

	// Lazily register and enqueue frontend assets for the preview only when actually rendering this box
	try {
		$plugin = new Plugin();
		$plugin->register_assets();
	} catch (\Throwable $e) { /* no-op */ }
	\wp_enqueue_style('maplibre-gl-css');
	\wp_enqueue_style('fgpx-front');
	\wp_enqueue_script('maplibre-gl-js');
	\wp_enqueue_script('chartjs');
	\wp_enqueue_script('fgpx-front');
    // Avoid rendering during REST/AJAX requests (e.g., block editor save) to prevent output/noise
    if ((\defined('REST_REQUEST') && REST_REQUEST) || (\defined('DOING_AJAX') && DOING_AJAX)) {
        echo '<p>' . \esc_html__('Preview is unavailable during save operations.', 'flyover-gpx') . '</p>';
        return;
    }
	$options = Options::getAll();
	$defStyle = $options['fgpx_default_style'];
	$defStyleUrl = $options['fgpx_default_style_url'];
	$defHeight = $options['fgpx_default_height'];
	$defZoom = $options['fgpx_default_zoom'];
	$defPrivacyEnabled = $options['fgpx_privacy_enabled'] === '1';
	$defPrivacyKm = $options['fgpx_privacy_km'];

	$style = isset($_GET['fgpx_prev_style']) ? \sanitize_text_field((string) $_GET['fgpx_prev_style']) : $defStyle;
	$styleUrl = isset($_GET['fgpx_prev_style_url']) ? \esc_url_raw((string) $_GET['fgpx_prev_style_url']) : $defStyleUrl;
	$height = isset($_GET['fgpx_prev_height']) ? \sanitize_text_field((string) $_GET['fgpx_prev_height']) : $defHeight;
	$zoom = isset($_GET['fgpx_prev_zoom']) ? \sanitize_text_field((string) $_GET['fgpx_prev_zoom']) : $defZoom;
	$privacy = isset($_GET['fgpx_prev_privacy']) ? (in_array(strtolower((string) $_GET['fgpx_prev_privacy']), ['1','true','yes','on'], true) ? 'true' : 'false') : ($defPrivacyEnabled ? 'true' : 'false');
	$privacyKm = isset($_GET['fgpx_prev_privacy_km']) ? \sanitize_text_field((string) $_GET['fgpx_prev_privacy_km']) : $defPrivacyKm;

	// Controls (no nested form to avoid breaking the main post edit form)
	echo '<div class="fgpx-preview-controls" style="margin-bottom:8px">';
	echo '<label style="display:inline-block;margin-right:8px">' . \esc_html__('Style', 'flyover-gpx') . ' <select id="fgpx_prev_style"><option value="raster"' . selected($style, 'raster', false) . '>raster</option><option value="vector"' . selected($style, 'vector', false) . '>vector</option></select></label>';
	echo '<label style="display:inline-block;margin-right:8px">' . \esc_html__('Style URL', 'flyover-gpx') . ' <input type="text" id="fgpx_prev_style_url" value="' . \esc_attr($styleUrl) . '" style="width:260px" /></label>';
	echo '<label style="display:inline-block;margin-right:8px">' . \esc_html__('Height', 'flyover-gpx') . ' <input type="text" id="fgpx_prev_height" value="' . \esc_attr($height) . '" class="small-text" /></label>';
	echo '<label style="display:inline-block;margin-right:8px">' . \esc_html__('Zoom', 'flyover-gpx') . ' <input type="number" step="1" min="1" max="20" id="fgpx_prev_zoom" value="' . \esc_attr($zoom) . '" class="small-text" /></label>';
	echo '<label style="display:inline-block;margin-right:8px">' . \esc_html__('Privacy', 'flyover-gpx') . ' <select id="fgpx_prev_privacy"><option value="true"' . selected($privacy, 'true', false) . '>' . \esc_html__('on', 'flyover-gpx') . '</option><option value="false"' . selected($privacy, 'false', false) . '>' . \esc_html__('off', 'flyover-gpx') . '</option></select></label>';
	echo '<label style="display:inline-block;margin-right:8px">' . \esc_html__('Privacy km', 'flyover-gpx') . ' <input type="number" step="0.1" min="0" id="fgpx_prev_privacy_km" value="' . \esc_attr($privacyKm) . '" class="small-text" /></label>';
	echo '<button type="button" class="button" id="fgpx_prev_refresh">' . \esc_html__('Update preview', 'flyover-gpx') . '</button>';
	echo '</div>';

	// Small script to rebuild URL with query args and reload, without nesting a <form>
	echo '<script>(function(){
  var btn=document.getElementById("fgpx_prev_refresh"); if(!btn) return;
  btn.addEventListener("click", function(){
    try{
      var base = new URL(window.location.href);
      base.searchParams.set("post", ' . (int) $post->ID . ');
      base.searchParams.set("action", "edit");
      base.searchParams.set("fgpx_prev_style", document.getElementById("fgpx_prev_style").value || "");
      base.searchParams.set("fgpx_prev_style_url", document.getElementById("fgpx_prev_style_url").value || "");
      base.searchParams.set("fgpx_prev_height", document.getElementById("fgpx_prev_height").value || "");
      base.searchParams.set("fgpx_prev_zoom", document.getElementById("fgpx_prev_zoom").value || "");
      base.searchParams.set("fgpx_prev_privacy", document.getElementById("fgpx_prev_privacy").value || "");
      base.searchParams.set("fgpx_prev_privacy_km", document.getElementById("fgpx_prev_privacy_km").value || "");
      window.location.href = base.toString();
    }catch(e){ window.location.reload(); }
  });
})();</script>';

	$short = '[flyover_gpx id="' . (int) $post->ID . '"'
		. ' style="' . \esc_attr($style) . '"'
		. ($styleUrl !== '' ? ' style_url="' . \esc_attr($styleUrl) . '"' : '')
		. ' height="' . \esc_attr($height) . '"'
		. ' zoom="' . \esc_attr($zoom) . '"'
		. ' privacy="' . \esc_attr($privacy) . '"'
		. ' privacy_km="' . \esc_attr($privacyKm) . '"'
		. ']';

	// Render the actual front-end player in admin, buffer and suppress notices to avoid breaking saves
	try {
		ob_start();
		$rendered = do_shortcode($short);
		$buf = ob_get_clean();
		if (is_string($buf) && $buf !== '') { echo $buf; }
		echo $rendered;
	} catch (\Throwable $e) {
		// Show a lightweight message instead of failing hard
		echo '<p style="color:#d63638;">' . \esc_html__('Failed to render preview in admin.', 'flyover-gpx') . '</p>';
	}
	// Show shortcode string for copy reference
	echo '<p style="margin-top:6px"><code>' . \esc_html($short) . '</code></p>';
}

	// Replace GPX metabox removed - use "Add New Track" instead

	/**
	 * Render weather data debug metabox.
	 */
	public function render_metabox_weather_debug(\WP_Post $post): void
{
    // Avoid rendering during REST/AJAX requests to prevent interfering with editor saves
    if ((\defined('REST_REQUEST') && REST_REQUEST) || (\defined('DOING_AJAX') && DOING_AJAX)) {
        echo '<p>' . \esc_html__('Weather debug is unavailable during save operations.', 'flyover-gpx') . '</p>';
        return;
    }
		$options = Options::getAll();
		$weatherEnabled = $options['fgpx_weather_enabled'] === '1';
		$weatherPoints = \get_post_meta($post->ID, 'fgpx_weather_points', true);
		$weatherSummary = \get_post_meta($post->ID, 'fgpx_weather_summary', true);

		echo '<div style="font-family: monospace; font-size: 12px;">';
		
		// Weather settings status
		echo '<h4>Settings Status</h4>';
		echo '<p><strong>Weather Enabled:</strong> ' . ($weatherEnabled ? '✅ Yes' : '❌ No') . '</p>';
		
		if (!$weatherEnabled) {
			echo '<p style="color: #d63638;">Weather enrichment is disabled in plugin settings.</p>';
			echo '</div>';
			return;
		}

		// Weather data status
		echo '<h4>Weather Data Status</h4>';
		if (!$weatherPoints || !\is_string($weatherPoints) || $weatherPoints === '') {
			echo '<p style="color: #d63638;"><strong>Status:</strong> ❌ No weather data</p>';
			echo '<p><em>Use "Enrich Weather" action to fetch weather data for this track.</em></p>';
		} else {
			$decodedWeather = \json_decode($weatherPoints, true);
			$decodedSummary = \json_decode($weatherSummary, true);
			
			if (\is_array($decodedWeather) && isset($decodedWeather['features'])) {
				$pointCount = count($decodedWeather['features']);
				echo '<p style="color: #00a32a;"><strong>Status:</strong> ✅ Weather data available</p>';
				echo '<p><strong>Points:</strong> ' . $pointCount . '</p>';
				
				if (\is_array($decodedSummary)) {
					echo '<p><strong>Wet Points:</strong> ' . (int)($decodedSummary['wet_points'] ?? 0) . '</p>';
					echo '<p><strong>Max Rain:</strong> ' . number_format((float)($decodedSummary['max_mm'] ?? 0), 1) . 'mm</p>';
					echo '<p><strong>Avg Rain:</strong> ' . number_format((float)($decodedSummary['avg_mm'] ?? 0), 2) . 'mm</p>';
				}
				
				// Show sample weather points
				if ($pointCount > 0) {
					echo '<h4>Sample Weather Points</h4>';
					echo '<div style="max-height: 200px; overflow-y: auto; background: #f9f9f9; padding: 8px; border: 1px solid #ddd;">';
					$sampleCount = min(3, $pointCount);
					for ($i = 0; $i < $sampleCount; $i++) {
						$feature = $decodedWeather['features'][$i];
						$coords = $feature['geometry']['coordinates'] ?? [0, 0];
						$rain = $feature['properties']['rain_mm'] ?? 0;
						$time = $feature['properties']['time_unix'] ?? 0;
						$timeStr = $time > 0 ? date('Y-m-d H:i', $time) : 'N/A';
						
						echo '<div style="margin-bottom: 8px; padding: 4px; background: white; border: 1px solid #eee;">';
						echo '<strong>Point ' . ($i + 1) . ':</strong><br>';
						echo 'Coords: [' . number_format($coords[0], 4) . ', ' . number_format($coords[1], 4) . ']<br>';
						echo 'Rain: ' . number_format($rain, 1) . 'mm<br>';
						echo 'Time: ' . $timeStr;
						echo '</div>';
					}
					if ($pointCount > 3) {
						echo '<p><em>... and ' . ($pointCount - 3) . ' more points</em></p>';
					}
					echo '</div>';
				}
			} else {
				echo '<p style="color: #d63638;"><strong>Status:</strong> ❌ Invalid weather data format</p>';
			}
		}

		// REST API endpoint info
		echo '<h4>REST API Endpoint</h4>';
		$restUrl = \rest_url('flyover-gpx/v1/track/' . $post->ID);
		echo '<p><strong>URL:</strong> <a href="' . \esc_url($restUrl) . '" target="_blank">' . \esc_html($restUrl) . '</a></p>';
		echo '<p><em>Weather data is included in the "weather" and "weatherSummary" fields of the JSON response.</em></p>';

		echo '</div>';
	}

	/**
	 * Render wind data debug metabox.
	 */
	public function render_metabox_wind_debug(\WP_Post $post): void
	{
		// Avoid rendering during REST/AJAX requests to prevent interfering with editor saves
		if ((\defined('REST_REQUEST') && REST_REQUEST) || (\defined('DOING_AJAX') && DOING_AJAX)) {
			echo '<p>' . \esc_html__('Wind debug is unavailable during save operations.', 'flyover-gpx') . '</p>';
			return;
		}

		$geojsonData = \get_post_meta($post->ID, 'fgpx_geojson', true);
		
		echo '<div style="font-family: monospace; font-size: 12px;">';
		
		// Wind data status
		echo '<h4>Wind Data Status</h4>';
		if (!$geojsonData || !\is_string($geojsonData) || $geojsonData === '') {
			echo '<p style="color: #d63638;"><strong>Status:</strong> ❌ No track data</p>';
			echo '<p><em>Upload a GPX file to see wind data.</em></p>';
		} else {
			$decodedGeojson = \json_decode($geojsonData, true);
			
			if (\is_array($decodedGeojson) && isset($decodedGeojson['properties'])) {
				$props = $decodedGeojson['properties'];
				$windSpeeds = $props['windSpeeds'] ?? [];
				$windDirections = $props['windDirections'] ?? [];
				$windImpacts = $props['windImpacts'] ?? [];
				$trackBearings = $props['trackBearings'] ?? [];
				
				$windSpeedCount = \is_array($windSpeeds) ? count($windSpeeds) : 0;
				$windDirectionCount = \is_array($windDirections) ? count($windDirections) : 0;
				$windImpactCount = \is_array($windImpacts) ? count($windImpacts) : 0;
				$trackBearingCount = \is_array($trackBearings) ? count($trackBearings) : 0;
				
				echo '<p style="color: #00a32a;"><strong>Status:</strong> ✅ Wind data available</p>';
				echo '<p><strong>Wind Speeds:</strong> ' . $windSpeedCount . ' points</p>';
				echo '<p><strong>Wind Directions:</strong> ' . $windDirectionCount . ' points</p>';
				echo '<p><strong>Wind Impacts:</strong> ' . $windImpactCount . ' points</p>';
				echo '<p><strong>Track Bearings:</strong> ' . $trackBearingCount . ' points</p>';
				
				// Show sample wind data
				if ($windSpeedCount > 0 || $windDirectionCount > 0) {
					echo '<h4>Sample Wind Data</h4>';
					echo '<div style="max-height: 200px; overflow-y: auto; background: #f9f9f9; padding: 8px; border: 1px solid #ddd;">';
					$sampleCount = min(3, max($windSpeedCount, $windDirectionCount));
					for ($i = 0; $i < $sampleCount; $i++) {
						$windSpeed = isset($windSpeeds[$i]) ? $windSpeeds[$i] : 'N/A';
						$windDirection = isset($windDirections[$i]) ? $windDirections[$i] : 'N/A';
						$windImpact = isset($windImpacts[$i]) ? $windImpacts[$i] : 'N/A';
						$trackBearing = isset($trackBearings[$i]) ? $trackBearings[$i] : 'N/A';
						
						echo '<div style="margin-bottom: 8px; padding: 4px; background: white; border: 1px solid #eee;">';
						echo '<strong>Point ' . ($i + 1) . ':</strong><br>';
						echo 'Wind Speed: ' . (\is_numeric($windSpeed) ? number_format($windSpeed, 1) . ' km/h' : $windSpeed) . '<br>';
						echo 'Wind Direction: ' . (\is_numeric($windDirection) ? number_format($windDirection, 0) . '°' : $windDirection) . '<br>';
						echo 'Wind Impact: ' . (\is_numeric($windImpact) ? number_format($windImpact, 3) : $windImpact) . '<br>';
						echo 'Track Bearing: ' . (\is_numeric($trackBearing) ? number_format($trackBearing, 0) . '°' : $trackBearing);
						echo '</div>';
					}
					if ($sampleCount < max($windSpeedCount, $windDirectionCount)) {
						echo '<p><em>... and ' . (max($windSpeedCount, $windDirectionCount) - $sampleCount) . ' more points</em></p>';
					}
					echo '</div>';
				}
				
				// Wind statistics
				if ($windSpeedCount > 0) {
					$avgWindSpeed = array_sum($windSpeeds) / $windSpeedCount;
					$maxWindSpeed = max($windSpeeds);
					$minWindSpeed = min($windSpeeds);
					
					echo '<h4>Wind Statistics</h4>';
					echo '<p><strong>Avg Wind Speed:</strong> ' . number_format($avgWindSpeed, 1) . ' km/h</p>';
					echo '<p><strong>Max Wind Speed:</strong> ' . number_format($maxWindSpeed, 1) . ' km/h</p>';
					echo '<p><strong>Min Wind Speed:</strong> ' . number_format($minWindSpeed, 1) . ' km/h</p>';
				}
				
				if ($windImpactCount > 0) {
					$avgWindImpact = array_sum($windImpacts) / $windImpactCount;
					$maxWindImpact = max($windImpacts);
					$minWindImpact = min($windImpacts);
					
					echo '<p><strong>Avg Wind Impact:</strong> ' . number_format($avgWindImpact, 3) . '</p>';
					echo '<p><strong>Max Wind Impact:</strong> ' . number_format($maxWindImpact, 3) . ' (tailwind)</p>';
					echo '<p><strong>Min Wind Impact:</strong> ' . number_format($minWindImpact, 3) . ' (headwind)</p>';
				}
			} else {
				echo '<p style="color: #d63638;"><strong>Status:</strong> ❌ Invalid track data format</p>';
			}
		}

		// REST API endpoint info
		echo '<h4>REST API Endpoint</h4>';
		$restUrl = \rest_url('flyover-gpx/v1/track/' . $post->ID);
		echo '<p><strong>URL:</strong> <a href="' . \esc_url($restUrl) . '" target="_blank">' . \esc_html($restUrl) . '</a></p>';
		echo '<p><em>Wind data is included in the "windSpeeds", "windDirections", "windImpacts", and "trackBearings" fields of the geojson properties.</em></p>';

		echo '</div>';
	}

	/** Ensure multipart/form-data for edit form to handle replacement upload */
	public function add_form_enctype(): void
	{
		echo ' enctype="multipart/form-data"';
	}

	/** Save settings (custom CSS) */
	public function handle_save_settings(): void
	{
		// Validate security: both capability and nonce
		$this->validateSecurity('fgpx_save_settings', 'manage_options');
		$css = isset($_POST['fgpx_custom_css']) ? (string) $_POST['fgpx_custom_css'] : '';
		$css = str_replace(["\r\n", "\r"], "\n", $css);
		\update_option('fgpx_custom_css', $css, true);
		if (isset($_POST['fgpx_default_style'])) { \update_option('fgpx_default_style', sanitize_text_field((string) $_POST['fgpx_default_style']), true); }
		if (isset($_POST['fgpx_default_style_url'])) { \update_option('fgpx_default_style_url', esc_url_raw((string) $_POST['fgpx_default_style_url']), true); }
		if (isset($_POST['fgpx_default_style_json'])) { \update_option('fgpx_default_style_json', (string) wp_unslash($_POST['fgpx_default_style_json']), true); }
		if (isset($_POST['fgpx_default_height'])) { \update_option('fgpx_default_height', sanitize_text_field((string) $_POST['fgpx_default_height']), true); }
		// Use type-safe validation helpers for numeric values
		$zoom = $this->getValidInt('fgpx_default_zoom', 11, 1, 20);
		$speed = $this->getValidInt('fgpx_default_speed', 25, 1, 250);
		$pitch = $this->getValidInt('fgpx_default_pitch', 60, 0, 60);
		
		\update_option('fgpx_default_zoom', (string) $zoom, true);
		\update_option('fgpx_default_speed', (string) $speed, true);
		\update_option('fgpx_default_pitch', (string) $pitch, true);
		// Use type-safe validation helpers for boolean values
		\update_option('fgpx_show_labels', $this->getValidBool('fgpx_show_labels') ? '1' : '0', true);
		\update_option('fgpx_photos_enabled', $this->getValidBool('fgpx_photos_enabled') ? '1' : '0', true);
		\update_option('fgpx_hud_enabled', $this->getValidBool('fgpx_hud_enabled') ? '1' : '0', true);
		\update_option('fgpx_privacy_enabled', $this->getValidBool('fgpx_privacy_enabled') ? '1' : '0', true);
		\update_option('fgpx_backend_simplify_enabled', $this->getValidBool('fgpx_backend_simplify_enabled') ? '1' : '0', true);
		
		// Use type-safe validation helpers for float and int values
		$privacyKm = $this->getValidFloat('fgpx_privacy_km', 3.0, 0.0, 100.0);
		$simplifyTarget = $this->getValidInt('fgpx_backend_simplify_target', 1200, 300, 2500);
		
		\update_option('fgpx_privacy_km', (string) $privacyKm, true);
		\update_option('fgpx_backend_simplify_target', (string) $simplifyTarget, true);
		// Use type-safe validation helpers for color values
		\update_option('fgpx_chart_color', $this->getValidColor('fgpx_chart_color', '#ff5500'), true);
		\update_option('fgpx_chart_color2', $this->getValidColor('fgpx_chart_color2', '#1976d2'), true);
		\update_option('fgpx_chart_color_hr', $this->getValidColor('fgpx_chart_color_hr', '#dc2626'), true);
		\update_option('fgpx_chart_color_cad', $this->getValidColor('fgpx_chart_color_cad', '#7c3aed'), true);
		\update_option('fgpx_chart_color_temp', $this->getValidColor('fgpx_chart_color_temp', '#f59e0b'), true);
		\update_option('fgpx_chart_color_power', $this->getValidColor('fgpx_chart_color_power', '#059669'), true);
		\update_option('fgpx_chart_color_wind_impact', $this->getValidColor('fgpx_chart_color_wind_impact', '#ff6b35'), true);
		\update_option('fgpx_chart_color_wind_rose', $this->getValidColor('fgpx_chart_color_wind_rose', '#4ecdc4'), true);
		if (isset($_POST['fgpx_wind_rose_color_north'])) { \update_option('fgpx_wind_rose_color_north', \sanitize_hex_color($_POST['fgpx_wind_rose_color_north']), true); }
		if (isset($_POST['fgpx_wind_rose_color_south'])) { \update_option('fgpx_wind_rose_color_south', \sanitize_hex_color($_POST['fgpx_wind_rose_color_south']), true); }
		if (isset($_POST['fgpx_wind_rose_color_east'])) { \update_option('fgpx_wind_rose_color_east', \sanitize_hex_color($_POST['fgpx_wind_rose_color_east']), true); }
		if (isset($_POST['fgpx_wind_rose_color_west'])) { \update_option('fgpx_wind_rose_color_west', \sanitize_hex_color($_POST['fgpx_wind_rose_color_west']), true); }
		\update_option('fgpx_daynight_enabled', isset($_POST['fgpx_daynight_enabled']) ? '1' : '0', true);
		\update_option('fgpx_daynight_map_enabled', isset($_POST['fgpx_daynight_map_enabled']) ? '1' : '0', true);
		if (isset($_POST['fgpx_daynight_map_color'])) { \update_option('fgpx_daynight_map_color', \sanitize_hex_color($_POST['fgpx_daynight_map_color']), true); }
		if (isset($_POST['fgpx_daynight_map_opacity'])) { \update_option('fgpx_daynight_map_opacity', (string) max(0.1, min(1.0, (float) $_POST['fgpx_daynight_map_opacity'])), true); }
		\update_option('fgpx_elevation_coloring', isset($_POST['fgpx_elevation_coloring']) ? '1' : '0', true);
		if (isset($_POST['fgpx_elevation_color_flat'])) { \update_option('fgpx_elevation_color_flat', sanitize_hex_color((string) $_POST['fgpx_elevation_color_flat']), true); }
		if (isset($_POST['fgpx_elevation_color_steep'])) { \update_option('fgpx_elevation_color_steep', sanitize_hex_color((string) $_POST['fgpx_elevation_color_steep']), true); }
		if (isset($_POST['fgpx_elevation_threshold_min'])) { \update_option('fgpx_elevation_threshold_min', (string) max(0, min(20, (float) $_POST['fgpx_elevation_threshold_min'])), true); }
		if (isset($_POST['fgpx_elevation_threshold_max'])) { \update_option('fgpx_elevation_threshold_max', (string) max(1, min(50, (float) $_POST['fgpx_elevation_threshold_max'])), true); }
		
		// Weather settings
		\update_option('fgpx_weather_enabled', isset($_POST['fgpx_weather_enabled']) ? '1' : '0', true);
		if (isset($_POST['fgpx_weather_sampling'])) { \update_option('fgpx_weather_sampling', sanitize_text_field((string) $_POST['fgpx_weather_sampling']), true); }
		if (isset($_POST['fgpx_weather_step_km'])) { \update_option('fgpx_weather_step_km', (string) max(5, min(20, (float) $_POST['fgpx_weather_step_km'])), true); }
		if (isset($_POST['fgpx_weather_step_min'])) { \update_option('fgpx_weather_step_min', (string) max(5, min(60, (int) $_POST['fgpx_weather_step_min'])), true); }
		if (isset($_POST['fgpx_weather_opacity'])) { \update_option('fgpx_weather_opacity', (string) max(0.1, min(1.0, (float) $_POST['fgpx_weather_opacity'])), true); }
		\update_option('fgpx_weather_visible_by_default', isset($_POST['fgpx_weather_visible_by_default']) ? '1' : '0', true);
		\update_option('fgpx_daynight_visible_by_default', isset($_POST['fgpx_daynight_visible_by_default']) ? '1' : '0', true);
		if (isset($_POST['fgpx_weather_heatmap_zoom0'])) { \update_option('fgpx_weather_heatmap_zoom0', (string) max(10, min(100, (int) $_POST['fgpx_weather_heatmap_zoom0'])), true); }
		if (isset($_POST['fgpx_weather_heatmap_zoom9'])) { \update_option('fgpx_weather_heatmap_zoom9', (string) max(50, min(500, (int) $_POST['fgpx_weather_heatmap_zoom9'])), true); }
		if (isset($_POST['fgpx_weather_heatmap_zoom12'])) { \update_option('fgpx_weather_heatmap_zoom12', (string) max(200, min(10000, (int) $_POST['fgpx_weather_heatmap_zoom12'])), true); }
		if (isset($_POST['fgpx_weather_heatmap_zoom14'])) { \update_option('fgpx_weather_heatmap_zoom14', (string) max(500, min(10000, (int) $_POST['fgpx_weather_heatmap_zoom14'])), true); }
		if (isset($_POST['fgpx_weather_heatmap_zoom15'])) { \update_option('fgpx_weather_heatmap_zoom15', (string) max(1000, min(10000, (int) $_POST['fgpx_weather_heatmap_zoom15'])), true); }
		\update_option('fgpx_weather_multi_point', isset($_POST['fgpx_weather_multi_point']) ? '1' : '0', true);
		if (isset($_POST['fgpx_weather_multi_point_distance'])) { \update_option('fgpx_weather_multi_point_distance', (string) max(1.0, min(20.0, (float) $_POST['fgpx_weather_multi_point_distance'])), true); }
		
		// Multi-weather visualization settings
		if (isset($_POST['fgpx_weather_priority_order'])) {
			$priorityOrder = sanitize_text_field((string) $_POST['fgpx_weather_priority_order']);
			// Validate format: comma-separated list
			\update_option('fgpx_weather_priority_order', $priorityOrder, true);
		}
		if (isset($_POST['fgpx_weather_fog_threshold'])) { \update_option('fgpx_weather_fog_threshold', (string) max(0.1, min(1.0, (float) $_POST['fgpx_weather_fog_threshold'])), true); }
		\update_option('fgpx_weather_color_snow', $this->getValidColor('fgpx_weather_color_snow', '#ff1493'), true);
		\update_option('fgpx_weather_color_rain', $this->getValidColor('fgpx_weather_color_rain', '#4169e1'), true);
		\update_option('fgpx_weather_color_fog', $this->getValidColor('fgpx_weather_color_fog', '#808080'), true);
		\update_option('fgpx_weather_color_clouds', $this->getValidColor('fgpx_weather_color_clouds', '#d3d3d3'), true);
		
		// Wind analysis settings
		\update_option('fgpx_wind_analysis_enabled', isset($_POST['fgpx_wind_analysis_enabled']) ? '1' : '0', true);
		if (isset($_POST['fgpx_wind_interpolation_density'])) { \update_option('fgpx_wind_interpolation_density', (string) max(1, min(5, (int) $_POST['fgpx_wind_interpolation_density'])), true); }
		
		\update_option('fgpx_prefetch_enabled', isset($_POST['fgpx_prefetch_enabled']) ? '1' : '0', true);
		\update_option('fgpx_lazy_viewport', isset($_POST['fgpx_lazy_viewport']) ? '1' : '0', true);
		\update_option('fgpx_asset_fallbacks_enabled', isset($_POST['fgpx_asset_fallbacks_enabled']) ? '1' : '0', true);
		\update_option('fgpx_debug_logging', isset($_POST['fgpx_debug_logging']) ? '1' : '0', true);
		\update_option('fgpx_debug_weather_data', isset($_POST['fgpx_debug_weather_data']) ? '1' : '0', true);
		\wp_safe_redirect(\add_query_arg(['page' => 'flyover-gpx', 'updated' => 1], \admin_url('options-general.php')));
		exit;
	}

	/**
	 * Enrich track with weather data from Open-Meteo API
	 * @param int $postId Track post ID
	 * @param string $geojsonStr Parsed GeoJSON string
	 * @return bool Success/failure
	 */
	public static function enrichWithWeather(int $postId, string $geojsonStr): bool
	{
		// Check if weather enrichment is enabled
		$options = Options::getAll();
		if ($options['fgpx_weather_enabled'] !== '1') {
			return true; // Not enabled, but not an error
		}

		try {
			$geojson = json_decode($geojsonStr, true);
			if (!$geojson || !isset($geojson['coordinates']) || !is_array($geojson['coordinates'])) {
				return false;
			}

			$coordinates = $geojson['coordinates'];
			$timestamps = $geojson['properties']['timestamps'] ?? [];
			$cumulativeDistance = $geojson['properties']['cumulativeDistance'] ?? [];

			if (empty($coordinates)) {
				return false;
			}

			// Get settings
			$sampling = $options['fgpx_weather_sampling'];
			$stepKm = (float) $options['fgpx_weather_step_km'];
			$stepMin = (int) $options['fgpx_weather_step_min'];
			$multiPoint = $options['fgpx_weather_multi_point'] === '1';
			$multiPointDistance = (float) $options['fgpx_weather_multi_point_distance'];

			// Generate sample points
			$samples = self::generateWeatherSamples($coordinates, $timestamps, $cumulativeDistance, $sampling, $stepKm, $stepMin, $multiPoint, $multiPointDistance);
			
			if (empty($samples)) {
				return true; // No samples, but not an error
			}

			// Fetch weather data for samples
			$weatherPoints = self::fetchWeatherForSamples($samples);

			// Save weather data
			$weatherFeatureCollection = [
				'type' => 'FeatureCollection',
				'features' => $weatherPoints,
				'meta' => [
					'source' => 'open-meteo',
					'sampling' => $sampling,
					'step_km' => $stepKm,
					'step_min' => $stepMin,
					'generated_at' => time()
				]
			];

			\update_post_meta($postId, 'fgpx_weather_points', wp_json_encode($weatherFeatureCollection));

			// Generate summary stats
			$rainValues = array_map(function($f) { return $f['properties']['rain_mm'] ?? 0; }, $weatherPoints);
			$summary = [
				'max_mm' => !empty($rainValues) ? max($rainValues) : 0,
				'avg_mm' => !empty($rainValues) ? array_sum($rainValues) / count($rainValues) : 0,
				'wet_points' => count(array_filter($rainValues, function($r) { return $r > 0; })),
				'total_points' => count($rainValues)
			];
			\update_post_meta($postId, 'fgpx_weather_summary', wp_json_encode($summary));

			return true;

		} catch (\Throwable $e) {
			// Log error with full details
			ErrorHandler::warning('Weather enrichment failed', [
				'error' => $e->getMessage(),
				'file' => $e->getFile(),
				'line' => $e->getLine(),
				'trace' => $e->getTraceAsString(),
				'post_id' => $postId ?? 'unknown'
			]);
			// Store error in transient for AJAX handler to retrieve
			\set_transient('fgpx_weather_error_' . $postId, $e->getMessage(), 60);
			return false;
		}
	}

	/**
	 * Generate sample points along the route for weather data collection
	 * 
	 * Creates strategically placed sample points along a GPX track for efficient
	 * weather data collection. Supports both distance-based and time-based sampling
	 * with optional multi-point sampling for better spatial coverage.
	 * 
	 * @param array<int,array{0:float,1:float,2?:float}> $coordinates Track coordinates [lon, lat, ele?]
	 * @param array<int,string> $timestamps ISO timestamp strings for each coordinate
	 * @param array<int,float> $cumulativeDistance Cumulative distance in meters for each point
	 * @param string $sampling Sampling method: 'distance' or 'time'
	 * @param float $stepKm Distance step size in kilometers (for distance sampling)
	 * @param int $stepMin Time step size in minutes (for time sampling)
	 * @param bool $multiPoint Whether to add additional points around each sample for better coverage
	 * @param float $multiPointDistance Distance in km for multi-point offset sampling
	 * 
	 * @return array<int,array{lon:float,lat:float,time_unix:int|null,index:int,sample_type:string}> Sample points with metadata
	 * 
	 * @since 1.0.0
	 */
	private static function generateWeatherSamples(array $coordinates, array $timestamps, array $cumulativeDistance, string $sampling, float $stepKm, int $stepMin, bool $multiPoint = false, float $multiPointDistance = 5.0): array
	{
		$samples = [];
		$coordCount = count($coordinates);

		if ($sampling === 'distance' && !empty($cumulativeDistance)) {
			// Sample by distance
			$stepMeters = $stepKm * 1000;
			$nextDistance = 0;

			for ($i = 0; $i < $coordCount; $i++) {
				$currentDistance = $cumulativeDistance[$i] ?? 0;
				if ($currentDistance >= $nextDistance) {
					$coord = $coordinates[$i];
					$timestamp = !empty($timestamps[$i]) ? strtotime($timestamps[$i]) : null;
					
					$samples[] = [
						'lon' => $coord[0],
						'lat' => $coord[1],
						'time_unix' => $timestamp,
						'index' => $i,
						'sample_type' => 'distance'
					];
					
					$nextDistance += $stepMeters;
				}
			}
		} elseif ($sampling === 'time' && !empty($timestamps)) {
			// Sample by time
			$stepSeconds = $stepMin * 60;
			$lastSampleTime = null;

			for ($i = 0; $i < $coordCount; $i++) {
				if (empty($timestamps[$i])) continue;
				
				$timestamp = strtotime($timestamps[$i]);
				if ($timestamp === false) continue;

				if ($lastSampleTime === null || ($timestamp - $lastSampleTime) >= $stepSeconds) {
					$coord = $coordinates[$i];
					
					$samples[] = [
						'lon' => $coord[0],
						'lat' => $coord[1],
						'time_unix' => $timestamp,
						'index' => $i,
						'sample_type' => 'time'
					];
					
					$lastSampleTime = $timestamp;
				}
			}
		} else {
			// Fallback: sample every N points (distance-based approximation)
			$step = max(1, intval($coordCount / 20)); // Max 20 samples
			for ($i = 0; $i < $coordCount; $i += $step) {
				$coord = $coordinates[$i];
				$timestamp = !empty($timestamps[$i]) ? strtotime($timestamps[$i]) : null;
				
				$samples[] = [
					'lon' => $coord[0],
					'lat' => $coord[1],
					'time_unix' => $timestamp,
					'index' => $i,
					'sample_type' => 'fallback'
				];
			}
		}

		// Add multi-point sampling if enabled
		if ($multiPoint && !empty($samples)) {
			$samples = self::addMultiPointSamples($samples, $multiPointDistance);
		}

		return $samples;
	}

	/**
	 * Add additional sample points around each track position (N, S, E, W)
	 */
	private static function addMultiPointSamples(array $samples, float $distanceKm): array
	{
		$allSamples = [];
		
		// Earth's radius in kilometers
		$earthRadiusKm = 6371.0;
		
		foreach ($samples as $sample) {
			// Add original sample
			$allSamples[] = $sample;
			
			$lat = $sample['lat'];
			$lon = $sample['lon'];
			
			// Convert distance to degrees (approximate)
			$latOffset = $distanceKm / 111.0; // 1 degree latitude ≈ 111 km
			$lonOffset = $distanceKm / (111.0 * cos(deg2rad($lat))); // Adjust for latitude
			
			// Generate 4 additional points: North, South, East, West
			$additionalPoints = [
				['lat' => $lat + $latOffset, 'lon' => $lon, 'direction' => 'N'], // North
				['lat' => $lat - $latOffset, 'lon' => $lon, 'direction' => 'S'], // South
				['lat' => $lat, 'lon' => $lon + $lonOffset, 'direction' => 'E'], // East
				['lat' => $lat, 'lon' => $lon - $lonOffset, 'direction' => 'W'], // West
			];
			
			foreach ($additionalPoints as $point) {
				$allSamples[] = [
					'lon' => $point['lon'],
					'lat' => $point['lat'],
					'time_unix' => $sample['time_unix'],
					'index' => $sample['index'],
					'sample_type' => $sample['sample_type'] . '_multi_' . $point['direction'],
					'base_sample' => true // Mark as additional sample
				];
			}
		}
		
		return $allSamples;
	}

	/**
	 * Fetch weather data from Open-Meteo for sample points
	 */
	private static function fetchWeatherForSamples(array $samples): array
	{
		$weatherPoints = [];
		$uniqueCoords = [];
		$coordToSamples = [];

		// Deduplicate coordinates by rounding to 0.1 degree grid
		foreach ($samples as $sample) {
			$roundedLat = round($sample['lat'], 1);
			$roundedLon = round($sample['lon'], 1);
			$coordKey = $roundedLat . ',' . $roundedLon;

			if (!isset($uniqueCoords[$coordKey])) {
				$uniqueCoords[$coordKey] = ['lat' => $roundedLat, 'lon' => $roundedLon];
				$coordToSamples[$coordKey] = [];
			}
			$coordToSamples[$coordKey][] = $sample;
		}

		// Limit to max 20 unique coordinates to avoid API abuse
		if (count($uniqueCoords) > 20) {
			$uniqueCoords = array_slice($uniqueCoords, 0, 20, true);
		}

		// Determine date range
		$timestamps = array_filter(array_column($samples, 'time_unix'));
		if (!empty($timestamps)) {
			$startDate = date('Y-m-d', min($timestamps) - 43200); // -12h padding
			$endDate = date('Y-m-d', max($timestamps) + 43200);   // +12h padding
		} else {
			// No timestamps, use today
			$startDate = date('Y-m-d');
			$endDate = date('Y-m-d');
		}

		// Fetch weather for each unique coordinate
		foreach ($uniqueCoords as $coordKey => $coord) {
			$weatherData = self::fetchOpenMeteoData($coord['lat'], $coord['lon'], $startDate, $endDate);
			
			// Map weather data back to original samples
			if ($weatherData && isset($coordToSamples[$coordKey])) {
				foreach ($coordToSamples[$coordKey] as $sample) {
					// Existing weather parameters
					$rainMm = self::getRainForTimestamp($weatherData, $sample['time_unix']);
					$temperature = self::getTemperatureForTimestamp($weatherData, $sample['time_unix']);
					$windSpeed = self::getWindSpeedForTimestamp($weatherData, $sample['time_unix']);
					$windDirection = self::getWindDirectionForTimestamp($weatherData, $sample['time_unix']);
					
					// NEW: Multi-weather parameters
					$cloudCover = self::getCloudCoverForTimestamp($weatherData, $sample['time_unix']);
					$snowfall = self::getSnowfallForTimestamp($weatherData, $sample['time_unix']);
					$dewPoint = self::getDewPointForTimestamp($weatherData, $sample['time_unix']);
					$temperature2m = self::getTemperature2mForTimestamp($weatherData, $sample['time_unix']);
					$relativeHumidity = self::getRelativeHumidityForTimestamp($weatherData, $sample['time_unix']);
					
					// Calculate fog intensity using new parameters
					$fogIntensity = self::calculateFogIntensity($temperature2m, $dewPoint, $relativeHumidity);
					
					$weatherPoints[] = [
						'type' => 'Feature',
						'geometry' => [
							'type' => 'Point',
							'coordinates' => [$sample['lon'], $sample['lat']]
						],
						'properties' => [
							// Existing properties
							'rain_mm' => $rainMm,
							'temperature_c' => $temperature, // Keep 80m for wind calculations
							'wind_speed_kmh' => $windSpeed,
							'wind_direction_deg' => $windDirection,
							// NEW: Multi-weather properties
							'cloud_cover_pct' => $cloudCover,
							'snowfall_cm' => $snowfall,
							'fog_intensity' => $fogIntensity, // Pre-calculated 0-1 scale
							'dew_point_2m_c' => $dewPoint,
							'temperature_2m_c' => $temperature2m,
							'relative_humidity_pct' => $relativeHumidity,
							// Metadata
							'time_unix' => $sample['time_unix'],
							'source' => 'open-meteo',
							'sample_type' => $sample['sample_type']
						]
					];
				}
			}
		}

		return $weatherPoints;
	}

	/**
	 * Fetch weather data from Open-Meteo API with caching
	 * Cache key includes version to handle API parameter changes
	 */
	private static function fetchOpenMeteoData(float $lat, float $lon, string $startDate, string $endDate): ?array
	{
		// Cache key with version for parameter changes (v2 adds cloud_cover, snowfall, fog detection)
		$cacheKey = 'fgpx_wx_v2_' . round($lat, 1) . '_' . round($lon, 1) . '_' . $startDate . '_' . $endDate;
		
		// Check cache first
		$cached = \get_transient($cacheKey);
		if ($cached !== false) {
			return $cached;
		}

		// Build API URL with extended parameters for multi-weather support
		$url = 'https://api.open-meteo.com/v1/forecast?' . http_build_query([
			'latitude' => $lat,
			'longitude' => $lon,
			'hourly' => 'rain,wind_speed_10m,wind_direction_10m,temperature_80m,cloud_cover,snowfall,dew_point_2m,temperature_2m,relative_humidity_2m',
			'timezone' => 'auto',
			'timeformat' => 'unixtime',
			'format' => 'json',
			'start_date' => $startDate,
			'end_date' => $endDate
		]);

		// Fetch data
		$response = wp_remote_get($url, [
			'timeout' => 10,
			'user-agent' => 'Flyover-GPX-WordPress-Plugin'
		]);

		if (is_wp_error($response)) {
			return null;
		}

		$body = wp_remote_retrieve_body($response);
		$data = json_decode($body, true);

		// Validate response structure (only require time array, individual parameters checked when accessed)
		if (!$data || !isset($data['hourly']['time'])) {
			return null;
		}

		// Cache for 2 hours
		\set_transient($cacheKey, $data, 2 * HOUR_IN_SECONDS);

		return $data;
	}

	/**
	 * Get rain value for specific timestamp from weather data
	 */
	private static function getRainForTimestamp(?array $weatherData, ?int $timestamp): float
	{
		if (!$weatherData || !$timestamp || !isset($weatherData['hourly']['time']) || !isset($weatherData['hourly']['rain'])) {
			return 0.0;
		}

		$times = $weatherData['hourly']['time'];
		$rains = $weatherData['hourly']['rain'];

		// Find nearest hour (round down to hour boundary)
		$hourTimestamp = intval($timestamp / 3600) * 3600;

		// Find closest time index
		$closestIndex = null;
		$minDiff = PHP_INT_MAX;

		foreach ($times as $index => $time) {
			$diff = abs($time - $hourTimestamp);
			if ($diff < $minDiff) {
				$minDiff = $diff;
				$closestIndex = $index;
			}
		}

		if ($closestIndex !== null && isset($rains[$closestIndex])) {
			return (float) $rains[$closestIndex];
		}

		return 0.0;
	}

	/**
	 * Get temperature value for specific timestamp from weather data
	 */
	private static function getTemperatureForTimestamp(?array $weatherData, ?int $timestamp): ?float
	{
		if (!$weatherData || !$timestamp || !isset($weatherData['hourly']['time']) || !isset($weatherData['hourly']['temperature_80m'])) {
			return null;
		}

		$times = $weatherData['hourly']['time'];
		$temperatures = $weatherData['hourly']['temperature_80m'];

		// Find nearest hour (round down to hour boundary)
		$hourTimestamp = intval($timestamp / 3600) * 3600;

		// Find closest time index
		$closestIndex = null;
		$minDiff = PHP_INT_MAX;

		foreach ($times as $index => $time) {
			$diff = abs($time - $hourTimestamp);
			if ($diff < $minDiff) {
				$minDiff = $diff;
				$closestIndex = $index;
			}
		}

		if ($closestIndex !== null && isset($temperatures[$closestIndex])) {
			return (float) $temperatures[$closestIndex];
		}

		return null;
	}

	/**
	 * Get wind speed value for specific timestamp from weather data
	 */
	private static function getWindSpeedForTimestamp(?array $weatherData, ?int $timestamp): ?float
	{
		if (!$weatherData || !$timestamp || !isset($weatherData['hourly']['time']) || !isset($weatherData['hourly']['wind_speed_10m'])) {
			return null;
		}

		$times = $weatherData['hourly']['time'];
		$windSpeeds = $weatherData['hourly']['wind_speed_10m'];

		// Find nearest hour (round down to hour boundary)
		$hourTimestamp = intval($timestamp / 3600) * 3600;

		// Find closest time index
		$closestIndex = null;
		$minDiff = PHP_INT_MAX;

		foreach ($times as $index => $time) {
			$diff = abs($time - $hourTimestamp);
			if ($diff < $minDiff) {
				$minDiff = $diff;
				$closestIndex = $index;
			}
		}

		if ($closestIndex !== null && isset($windSpeeds[$closestIndex])) {
			return (float) $windSpeeds[$closestIndex];
		}

		return null;
	}

	/**
	 * Get wind direction value for specific timestamp from weather data
	 */
	private static function getWindDirectionForTimestamp(?array $weatherData, ?int $timestamp): ?float
	{
		if (!$weatherData || !$timestamp || !isset($weatherData['hourly']['time']) || !isset($weatherData['hourly']['wind_direction_10m'])) {
			return null;
		}

		$times = $weatherData['hourly']['time'];
		$windDirections = $weatherData['hourly']['wind_direction_10m'];

		// Find nearest hour (round down to hour boundary)
		$hourTimestamp = intval($timestamp / 3600) * 3600;

		// Find closest time index
		$closestIndex = null;
		$minDiff = PHP_INT_MAX;

		foreach ($times as $index => $time) {
			$diff = abs($time - $hourTimestamp);
			if ($diff < $minDiff) {
				$minDiff = $diff;
				$closestIndex = $index;
			}
		}

		if ($closestIndex !== null && isset($windDirections[$closestIndex])) {
			return (float) $windDirections[$closestIndex];
		}

		return null;
	}

	/**
	 * Get cloud cover value for specific timestamp from weather data
	 */
	private static function getCloudCoverForTimestamp(?array $weatherData, ?int $timestamp): ?float
	{
		if (!$weatherData || !$timestamp || !isset($weatherData['hourly']['time']) || !isset($weatherData['hourly']['cloud_cover'])) {
			return null;
		}

		$times = $weatherData['hourly']['time'];
		$cloudCover = $weatherData['hourly']['cloud_cover'];
		$hourTimestamp = intval($timestamp / 3600) * 3600;
		$closestIndex = null;
		$minDiff = PHP_INT_MAX;

		foreach ($times as $index => $time) {
			$diff = abs($time - $hourTimestamp);
			if ($diff < $minDiff) {
				$minDiff = $diff;
				$closestIndex = $index;
			}
		}

		if ($closestIndex !== null && isset($cloudCover[$closestIndex])) {
			return (float) $cloudCover[$closestIndex];
		}

		return null;
	}

	/**
	 * Get snowfall value for specific timestamp from weather data
	 */
	private static function getSnowfallForTimestamp(?array $weatherData, ?int $timestamp): ?float
	{
		if (!$weatherData || !$timestamp || !isset($weatherData['hourly']['time']) || !isset($weatherData['hourly']['snowfall'])) {
			return null;
		}

		$times = $weatherData['hourly']['time'];
		$snowfall = $weatherData['hourly']['snowfall'];
		$hourTimestamp = intval($timestamp / 3600) * 3600;
		$closestIndex = null;
		$minDiff = PHP_INT_MAX;

		foreach ($times as $index => $time) {
			$diff = abs($time - $hourTimestamp);
			if ($diff < $minDiff) {
				$minDiff = $diff;
				$closestIndex = $index;
			}
		}

		if ($closestIndex !== null && isset($snowfall[$closestIndex])) {
			return (float) $snowfall[$closestIndex];
		}

		return null;
	}

	/**
	 * Get dew point value for specific timestamp from weather data
	 */
	private static function getDewPointForTimestamp(?array $weatherData, ?int $timestamp): ?float
	{
		if (!$weatherData || !$timestamp || !isset($weatherData['hourly']['time']) || !isset($weatherData['hourly']['dew_point_2m'])) {
			return null;
		}

		$times = $weatherData['hourly']['time'];
		$dewPoint = $weatherData['hourly']['dew_point_2m'];
		$hourTimestamp = intval($timestamp / 3600) * 3600;
		$closestIndex = null;
		$minDiff = PHP_INT_MAX;

		foreach ($times as $index => $time) {
			$diff = abs($time - $hourTimestamp);
			if ($diff < $minDiff) {
				$minDiff = $diff;
				$closestIndex = $index;
			}
		}

		if ($closestIndex !== null && isset($dewPoint[$closestIndex])) {
			return (float) $dewPoint[$closestIndex];
		}

		return null;
	}

	/**
	 * Get 2m temperature value for specific timestamp from weather data
	 */
	private static function getTemperature2mForTimestamp(?array $weatherData, ?int $timestamp): ?float
	{
		if (!$weatherData || !$timestamp || !isset($weatherData['hourly']['time']) || !isset($weatherData['hourly']['temperature_2m'])) {
			return null;
		}

		$times = $weatherData['hourly']['time'];
		$temperature = $weatherData['hourly']['temperature_2m'];
		$hourTimestamp = intval($timestamp / 3600) * 3600;
		$closestIndex = null;
		$minDiff = PHP_INT_MAX;

		foreach ($times as $index => $time) {
			$diff = abs($time - $hourTimestamp);
			if ($diff < $minDiff) {
				$minDiff = $diff;
				$closestIndex = $index;
			}
		}

		if ($closestIndex !== null && isset($temperature[$closestIndex])) {
			return (float) $temperature[$closestIndex];
		}

		return null;
	}

	/**
	 * Get relative humidity value for specific timestamp from weather data
	 */
	private static function getRelativeHumidityForTimestamp(?array $weatherData, ?int $timestamp): ?float
	{
		if (!$weatherData || !$timestamp || !isset($weatherData['hourly']['time']) || !isset($weatherData['hourly']['relative_humidity_2m'])) {
			return null;
		}

		$times = $weatherData['hourly']['time'];
		$humidity = $weatherData['hourly']['relative_humidity_2m'];
		$hourTimestamp = intval($timestamp / 3600) * 3600;
		$closestIndex = null;
		$minDiff = PHP_INT_MAX;

		foreach ($times as $index => $time) {
			$diff = abs($time - $hourTimestamp);
			if ($diff < $minDiff) {
				$minDiff = $diff;
				$closestIndex = $index;
			}
		}

		if ($closestIndex !== null && isset($humidity[$closestIndex])) {
			return (float) $humidity[$closestIndex];
		}

		return null;
	}

	/**
	 * Calculate fog intensity based on temperature and dew point differential
	 * 
	 * Fog occurs when air temperature is close to dew point, causing water vapor
	 * to condense. High humidity reinforces fog formation.
	 * 
	 * @param float|null $temperature_2m Temperature at 2m height (°C)
	 * @param float|null $dewPoint_2m Dew point at 2m height (°C)
	 * @param float|null $relativeHumidity Relative humidity percentage (0-100)
	 * @return float Fog intensity from 0 (no fog) to 1 (dense fog)
	 */
	private static function calculateFogIntensity(?float $temperature_2m, ?float $dewPoint_2m, ?float $relativeHumidity): float
	{
		if ($temperature_2m === null || $dewPoint_2m === null) {
			return 0.0;
		}

		$tempDiff = $temperature_2m - $dewPoint_2m;
		
		// Fog occurs when temperature is close to dew point (< 2°C difference)
		if ($tempDiff < 2.0) {
			$baseFogIntensity = (2.0 - $tempDiff) / 2.0; // Linear scale: 0 to 1
			
			// Boost intensity if humidity is very high (> 90%)
			if ($relativeHumidity !== null && $relativeHumidity > 90) {
				$baseFogIntensity = min(1.0, $baseFogIntensity * 1.2);
			}
			
			return max(0.0, min(1.0, $baseFogIntensity)); // Clamp to [0, 1]
		}
		
		return 0.0;
	}

	/**
	 * Allow .gpx uploads by adding the mime and extensions mapping.
	 * @param array<string,string> $mimes
	 */
	public function allow_gpx_mime(array $mimes): array
	{
		$mimes['gpx'] = 'application/gpx+xml';
		// Some servers label GPX as XML; keep core XML too
		if (!isset($mimes['xml'])) {
			$mimes['xml'] = 'application/xml';
		}
		return $mimes;
	}

	/**
	 * Relax filetype/ext check for .gpx so WordPress does not reject it.
	 *
	 * @param array{ext:?string,type:?string,proper_filename:?string} $data
	 */
	public function relax_gpx_filetype($data, string $file, string $filename, ?array $mimes, string $real_mime)
	{
		$ext = strtolower((string) pathinfo($filename, PATHINFO_EXTENSION));
		if ($ext === 'gpx') {
			$data['ext'] = 'gpx';
			$data['type'] = 'application/gpx+xml';
		}
		return $data;
	}

	// Replace GPX functionality removed - use "Add New Track" instead

	// (Preview functionality removed)

	/**
	 * Enqueue MapLibre in admin for fgpx screens.
	 */
	public function admin_enqueue(string $hook): void
{
	$screen = \get_current_screen();
	if (!$screen) { return; }
	
	// Enqueue admin.js and CSS on relevant pages
	$relevant_pages = ['edit-fgpx_track', 'fgpx_track', 'settings_page_flyover-gpx', 'fgpx_track_page_fgpx-add-new-track'];
	if (in_array($screen->id, $relevant_pages, true)) {
		\wp_enqueue_script('jquery');
		\wp_enqueue_script('fgpx-admin', \plugin_dir_url(__DIR__) . 'assets/js/admin.js', ['jquery'], '1.0.0', true);
		\wp_enqueue_style('fgpx-admin', \plugin_dir_url(__DIR__) . 'assets/css/admin.css', [], '1.0.0');
	}
	
	// Only enqueue assets globally on the list screen to avoid interfering with the editor save flow
	if ($screen->id === 'edit-fgpx_track') {
		try {
			$plugin = new Plugin();
			$plugin->register_assets();
		} catch (\Throwable $e) { /* no-op */ }
		\wp_enqueue_style('maplibre-gl-css');
		\wp_enqueue_style('fgpx-front');
		\wp_enqueue_script('maplibre-gl-js');
		\wp_enqueue_script('chartjs');
		\wp_enqueue_script('fgpx-front');
	}
}

	/**
	 * Format seconds to HH:MM:SS.
	 */
	private function format_hms(int $seconds): string
	{
		$seconds = max(0, $seconds);
		$h = (int) floor($seconds / 3600);
		$m = (int) floor(($seconds % 3600) / 60);
		$s = (int) ($seconds % 60);
		return sprintf('%02d:%02d:%02d', $h, $m, $s);
	}

	/**
	 * Parse GPX file and compute stats and geojson.
	 *
	 * @return array{stats: array<string,mixed>, geojson: string, bounds: array<int,float>, points_count: int}|\WP_Error
	 */
	private function parse_gpx_and_stats(string $filePath)
	{
		if (!\is_readable($filePath)) {
			return new \WP_Error('fgpx_unreadable', \esc_html__('Uploaded file is not readable.', 'flyover-gpx'));
		}

		try {
			$gpx = new \phpGPX\phpGPX();
			$file = $gpx->load($filePath);
		} catch (\Throwable $e) {
			return new \WP_Error('fgpx_parse_error', \esc_html__('Failed to parse GPX file.', 'flyover-gpx'));
		}

		$coordinates = [];
		$timestamps = [];
		$cumulative = [];
		$heartRates = [];
		$cadences = [];
		$temperatures = [];
		$powers = [];
		$pointsCount = 0;
		$totalDistance = 0.0; // meters
		$totalElevationGain = 0.0;
		$minElev = null;
		$maxElev = null;
		$movingTime = 0.0; // seconds
		$prev = null;
		$rawElevations = [];

		$minLat = 90.0; $minLon = 180.0; $maxLat = -90.0; $maxLon = -180.0;

		foreach ($file->tracks as $track) {
			foreach ($track->segments as $segment) {
				foreach ($segment->points as $point) {
					$lat = (float) $point->latitude;
					$lon = (float) $point->longitude;
					$eleNullable = $point->elevation !== null ? (float) $point->elevation : null;
					$time = $point->time ? (int) $point->time->getTimestamp() : null;
					
					// Extract heart rate, cadence, temperature, and power from extensions
					$heartRate = null;
					$cadence = null;
					$temperature = null;
					$power = null;
					if ($point->extensions && $point->extensions->trackPointExtension) {
						$ext = $point->extensions->trackPointExtension;
						$heartRate = $ext->hr ?? $ext->heartRate ?? null;
						$cadence = $ext->cad ?? $ext->cadence ?? null;
						$temperature = $ext->aTemp ?? $ext->avgTemperature ?? null;
						$power = $ext->power ?? $ext->watts ?? null;
					}

					// Bounds
					if ($lat < $minLat) { $minLat = $lat; }
					if ($lat > $maxLat) { $maxLat = $lat; }
					if ($lon < $minLon) { $minLon = $lon; }
					if ($lon > $maxLon) { $maxLon = $lon; }

					// Elevation stats
					if ($eleNullable !== null) {
						if ($minElev === null || $eleNullable < $minElev) { $minElev = $eleNullable; }
						if ($maxElev === null || $eleNullable > $maxElev) { $maxElev = $eleNullable; }
					}

					// Distance, moving time, elevation gain
					if ($prev !== null) {
						$d = $this->haversine($prev['lon'], $prev['lat'], $lon, $lat);
						$totalDistance += $d;

						$dt = ($time !== null && $prev['time'] !== null) ? max(0, $time - $prev['time']) : 0;
						if ($dt > 0) {
							$speed = $d / $dt; // m/s
							if ($speed > 0.5) { // simple moving threshold
								$movingTime += $dt;
							}
						}

						$gainThreshold = 0.5; // meters
						if ($eleNullable !== null && $prev['ele'] !== null) {
							$deltaElev = $eleNullable - (float) $prev['ele'];
							if ($deltaElev > $gainThreshold) {
								$totalElevationGain += $deltaElev;
							}
						}
					}

					$totalDistance = (float) $totalDistance;
					$coordinates[] = [$lon, $lat, $eleNullable !== null ? $eleNullable : 0.0];
					$timestamps[] = $time !== null ? gmdate('c', $time) : null;
					$cumulative[] = $totalDistance;
					$heartRates[] = $heartRate;
					$cadences[] = $cadence;
					$temperatures[] = $temperature;
					$powers[] = $power;
					$pointsCount++;
					$prev = ['lat' => $lat, 'lon' => $lon, 'ele' => $eleNullable, 'time' => $time];
					$rawElevations[] = $eleNullable;
				}
			}
		}

		if ($pointsCount === 0) {
			return new \WP_Error('fgpx_no_points', \esc_html__('No track points found in GPX.', 'flyover-gpx'));
		}

		$avgSpeed = $movingTime > 0 ? $totalDistance / $movingTime : 0.0;

		// Compute total elevation gain with smoothing over raw elevations
		if (!empty($rawElevations)) {
			// forward-fill nulls
			$filled = [];
			$last = null;
			foreach ($rawElevations as $e) {
				if ($e === null) {
					$filled[] = $last !== null ? $last : 0.0;
				} else {
					$filled[] = $e;
					$last = $e;
				}
			}
			// median smoothing (window 7)
			$win = 7;
			$half = intdiv($win, 2);
			$smoothed = [];
			$N = count($filled);
			for ($i = 0; $i < $N; $i++) {
				$start = max(0, $i - $half);
				$end = min($N - 1, $i + $half);
				$seg = array_slice($filled, $start, $end - $start + 1);
				sort($seg);
				$mid = intdiv(count($seg), 2);
				$smoothed[$i] = $seg[$mid];
			}
			// Accumulate climbs using a small-climb aggregation threshold
			// Only count a climb segment if cumulative rise since last dip >= 3m
			$totalElevationGain = 0.0;
			$segmentGain = 0.0;
			$climbThreshold = 3.0; // meters per climb segment (Strava-like)
			for ($i = 1; $i < $N; $i++) {
				$delta = $smoothed[$i] - $smoothed[$i - 1];
				if ($delta > 0) {
					$segmentGain += $delta;
				} else if ($delta < 0) {
					if ($segmentGain >= $climbThreshold) { $totalElevationGain += $segmentGain; }
					$segmentGain = 0.0;
				}
			}
			if ($segmentGain >= $climbThreshold) { $totalElevationGain += $segmentGain; }
		}

		$geojson = [
			'type' => 'LineString',
			'coordinates' => $coordinates,
			'properties' => [
				'timestamps' => $timestamps,
				'cumulativeDistance' => $cumulative,
				'heartRates' => $heartRates,
				'cadences' => $cadences,
				'temperatures' => $temperatures,
				'powers' => $powers,
			],
		];

		$stats = [
			'total_distance_m' => $totalDistance,
			'moving_time_s' => $movingTime,
			'average_speed_m_s' => $avgSpeed,
			'elevation_gain_m' => $totalElevationGain,
			'min_elevation_m' => $minElev,
			'max_elevation_m' => $maxElev,
		];

		$bounds = [$minLon, $minLat, $maxLon, $maxLat];

		return [
			'stats' => $stats,
			'geojson' => $geojson, // Return array instead of JSON string for wind processing
			'bounds' => $bounds,
			'points_count' => $pointsCount,
		];
	}

	/**
	 * Great-circle distance in meters using Haversine formula.
	 */
	private function haversine(float $lon1, float $lat1, float $lon2, float $lat2): float
	{
		$earth = 6371000.0;
		$dLat = deg2rad($lat2 - $lat1);
		$dLon = deg2rad($lon2 - $lon1);
		$a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLon / 2) ** 2;
		$c = 2 * atan2(sqrt($a), sqrt(1 - $a));
		return $earth * $c;
	}

	/**
	 * Interpolate wind data for all track points using existing weather data
	 * @param int $postId Track post ID
	 * @param array $geojson GeoJSON array (passed by reference to add wind data)
	 * @return bool Success/failure
	 */
	private static function interpolateWindDataForTrack(int $postId, array &$geojson): bool
	{
		// Check if wind analysis is enabled
		$options = Options::getAll();
		if ($options['fgpx_wind_analysis_enabled'] !== '1') {
			return true; // Not enabled, but not an error
		}

		// Check if weather data is available (required for wind analysis)
		if ($options['fgpx_weather_enabled'] !== '1') {
			return true; // Weather not enabled, can't interpolate wind data
		}

		ErrorHandler::debug('Starting wind interpolation', ['post_id' => $postId]);

		try {
			$coordinates = $geojson['coordinates'] ?? [];
			$timestamps = $geojson['properties']['timestamps'] ?? [];
			
			if (empty($coordinates) || empty($timestamps)) {
				return true; // No data to process
			}

			// Get existing weather data
			$weatherPointsJson = \get_post_meta($postId, 'fgpx_weather_points', true);
			if (!$weatherPointsJson) {
				ErrorHandler::debug('No weather data available', ['post_id' => $postId]);
				return true; // No weather data available yet
			}

			$weatherData = json_decode($weatherPointsJson, true);
			if (!$weatherData || !isset($weatherData['features'])) {
				ErrorHandler::debug('Invalid weather data structure', [
					'post_id' => $postId,
					'has_data' => !empty($weatherData),
					'data_keys' => $weatherData ? array_keys($weatherData) : []
				]);
				return true; // Invalid weather data
			}

			ErrorHandler::debug('Weather features found', [
				'post_id' => $postId,
				'feature_count' => count($weatherData['features'])
			]);

			// Get interpolation density setting
			$density = (int) $options['fgpx_wind_interpolation_density'];
			
			$windSpeeds = [];
			$windDirections = [];
			$windImpacts = [];

			// Process each track point (with density filtering)
			foreach ($coordinates as $i => $coord) {
				// Apply density filtering - only process every Nth point
				if ($i % $density !== 0 && $i !== count($coordinates) - 1) {
					$windSpeeds[] = null;
					$windDirections[] = null;
					$windImpacts[] = null;
					continue;
				}

				$timestamp = isset($timestamps[$i]) ? strtotime($timestamps[$i]) : null;
				if (!$timestamp) {
					$windSpeeds[] = null;
					$windDirections[] = null;
					$windImpacts[] = null;
					continue;
				}

				// Find closest weather data point by time and location
				$windSpeed = self::interpolateWindValueForPoint($weatherData['features'], $coord[0], $coord[1], $timestamp, 'wind_speed_kmh');
				$windDirection = self::interpolateWindValueForPoint($weatherData['features'], $coord[0], $coord[1], $timestamp, 'wind_direction_deg');

				// Debug first few points only
				if ($i < 3) {
					ErrorHandler::debug("Wind interpolation sample point $i", [
						'coord' => [$coord[0], $coord[1]],
						'timestamp' => $timestamp,
						'wind_speed' => $windSpeed,
						'wind_direction' => $windDirection
					]);
				}

				$windSpeeds[] = $windSpeed;
				$windDirections[] = $windDirection;

				// Calculate wind impact if we have wind data
				$windImpact = null;
				if ($windSpeed !== null && $windDirection !== null && $i > 0) {
					$windImpact = self::calculateWindImpactForPoint($coordinates, $i, $windSpeed, $windDirection);
				}
				$windImpacts[] = $windImpact;
			}

			// Fill in null values with interpolation for smoother data
			$windSpeeds = self::fillNullValues($windSpeeds);
			$windDirections = self::fillNullValues($windDirections);
			$windImpacts = self::fillNullValues($windImpacts);

			// Add wind data to geojson properties
			$geojson['properties']['windSpeeds'] = $windSpeeds;
			$geojson['properties']['windDirections'] = $windDirections;
			$geojson['properties']['windImpacts'] = $windImpacts;

			return true;

		} catch (\Throwable $e) {
			// Log error but don't fail the entire import
			ErrorHandler::warning('Wind interpolation failed', [
				'error' => $e->getMessage(),
				'post_id' => $postId
			]);
			return false;
		}
	}

	/**
	 * Interpolate wind value for a specific point using existing weather data
	 */
	private static function interpolateWindValueForPoint(array $weatherFeatures, float $lon, float $lat, int $timestamp, string $property): ?float
	{
		$bestMatch = null;
		$bestScore = PHP_FLOAT_MAX;
		$checkedFeatures = 0;

		foreach ($weatherFeatures as $feature) {
			$checkedFeatures++;
			if (!isset($feature['geometry']['coordinates']) || !isset($feature['properties'][$property])) {
				// Skip features without required data
				continue;
			}

			$fLon = $feature['geometry']['coordinates'][0];
			$fLat = $feature['geometry']['coordinates'][1];
			$fTime = $feature['properties']['time_unix'] ?? 0;
			$fValue = $feature['properties'][$property];

			if ($fValue === null) {
				continue;
			}

			// Calculate distance and time difference
			$distance = sqrt(pow($lon - $fLon, 2) + pow($lat - $fLat, 2)); // Simple distance
			$timeDiff = abs($timestamp - $fTime);

			// Weighted score (distance in degrees * 1000 + time in hours)
			$score = ($distance * 1000) + ($timeDiff / 3600);

			if ($score < $bestScore) {
				$bestScore = $score;
				$bestMatch = $fValue;
			}
		}

		// Return best match found (if any)

		return $bestMatch;
	}

	/**
	 * Calculate wind impact for a specific track point
	 */
	private static function calculateWindImpactForPoint(array $coordinates, int $index, float $windSpeed, float $windDirection): ?float
	{
		if ($index === 0 || !isset($coordinates[$index - 1])) {
			return null;
		}

		// Calculate track bearing
		$prevCoord = $coordinates[$index - 1];
		$currCoord = $coordinates[$index];
		
		$trackBearing = self::calculateBearing($prevCoord[1], $prevCoord[0], $currCoord[1], $currCoord[0]);
		
		// Convert wind speed from km/h to m/s for calculations
		$windSpeedMs = $windSpeed / 3.6;
		
		// Calculate relative wind angle
		$relativeWindAngle = deg2rad($windDirection - $trackBearing);
		
		// Calculate wind component along track direction (positive = tailwind, negative = headwind)
		$windComponent = $windSpeedMs * cos($relativeWindAngle);
		
		// Simple aerodynamic model: impact factor
		// Assume base speed of 15 m/s (54 km/h) for cycling
		$baseSpeed = 15.0;
		$impactFactor = 1.0 + ($windComponent / $baseSpeed);
		
		return $impactFactor;
	}

	/**
	 * Calculate bearing between two GPS points
	 */
	private static function calculateBearing(float $lat1, float $lon1, float $lat2, float $lon2): float
	{
		$lat1Rad = deg2rad($lat1);
		$lat2Rad = deg2rad($lat2);
		$deltaLonRad = deg2rad($lon2 - $lon1);

		$y = sin($deltaLonRad) * cos($lat2Rad);
		$x = cos($lat1Rad) * sin($lat2Rad) - sin($lat1Rad) * cos($lat2Rad) * cos($deltaLonRad);

		$bearingRad = atan2($y, $x);
		$bearingDeg = rad2deg($bearingRad);

		return fmod($bearingDeg + 360, 360);
	}

	/**
	 * Fill null values in array with interpolation
	 */
	private static function fillNullValues(array $values): array
	{
		$filled = $values;
		$count = count($filled);

		// Forward fill
		$lastValue = null;
		for ($i = 0; $i < $count; $i++) {
			if ($filled[$i] !== null) {
				$lastValue = $filled[$i];
			} elseif ($lastValue !== null) {
				$filled[$i] = $lastValue;
			}
		}

		// Backward fill for any remaining nulls at the beginning
		$lastValue = null;
		for ($i = $count - 1; $i >= 0; $i--) {
			if ($filled[$i] !== null) {
				$lastValue = $filled[$i];
			} elseif ($lastValue !== null) {
				$filled[$i] = $lastValue;
			}
		}

		return $filled;
	}

	/**
	 * Show admin notice on success/failure via query arg.
	 */
	public function maybe_show_admin_notice(): void
	{
		if (!isset($_GET['fgpx_msg'])) {
			// Check for bulk weather enrichment results
			if (isset($_GET['fgpx_weather_enriched']) || isset($_GET['fgpx_weather_errors'])) {
				$enriched = isset($_GET['fgpx_weather_enriched']) ? (int) $_GET['fgpx_weather_enriched'] : 0;
				$errors = isset($_GET['fgpx_weather_errors']) ? (int) $_GET['fgpx_weather_errors'] : 0;
				
				if ($enriched > 0 && $errors === 0) {
					echo '<div class="notice notice-success is-dismissible"><p>' . 
						sprintf(
							_n('%d track enriched with weather data.', '%d tracks enriched with weather data.', $enriched, 'flyover-gpx'),
							$enriched
						) . '</p></div>';
				} elseif ($enriched > 0 && $errors > 0) {
					echo '<div class="notice notice-warning is-dismissible"><p>' . 
						sprintf(
							__('%1$d tracks enriched successfully, %2$d failed.', 'flyover-gpx'),
							$enriched,
							$errors
						) . '</p></div>';
				} elseif ($errors > 0) {
					echo '<div class="notice notice-error is-dismissible"><p>' . 
						sprintf(
							_n('%d track failed to enrich with weather data.', '%d tracks failed to enrich with weather data.', $errors, 'flyover-gpx'),
							$errors
						) . '</p></div>';
				}
			}
			return;
		}
		
		$msg = (string) $_GET['fgpx_msg'];
		if ($msg === 'uploaded') {
			echo '<div class="notice notice-success is-dismissible"><p>' . \esc_html__('GPX uploaded and parsed successfully.', 'flyover-gpx') . '</p></div>';
		} elseif ($msg === 'error' && isset($_GET['fgpx_error'])) {
			$err = \sanitize_text_field((string) $_GET['fgpx_error']);
			echo '<div class="notice notice-error"><p>' . \esc_html($err) . '</p></div>';
		}
	}

	/**
	 * Redirect back to settings page with error.
	 */
	private function redirect_with_error(string $message): void
	{
		$url = \add_query_arg([
			'page' => 'flyover-gpx',
			'fgpx_msg' => 'error',
			'fgpx_error' => rawurlencode($message),
		], \admin_url('options-general.php'));
		\wp_safe_redirect($url);
		exit;
	}

	/**
	 * Delete uploaded file when a track post is permanently deleted.
	 */
	public function maybe_delete_track_file(int $postId): void
	{
		$post = \get_post($postId);
		if (!$post || $post->post_type !== 'fgpx_track') {
			return;
		}
		$file = (string) \get_post_meta($postId, 'fgpx_file_path', true);
		if ($file && \is_readable($file)) {
			// Ensure file resides inside uploads/flyover-gpx for safety
			$uploads = \wp_upload_dir();
			$base = rtrim((string) $uploads['basedir'], '/') . '/flyover-gpx/';
			if (strpos($file, $base) === 0) {
				@\unlink($file);
			}
		}
		// Invalidate any cached JSON variants for this post (best-effort)
		$modified = (string) \get_post_field('post_modified_gmt', $postId);
		\delete_transient('fgpx_json_' . (int) $postId . '_' . $modified);
	}

	/**
	 * Invalidate transient cache on post save.
	 */
	public function invalidate_cache_on_save(int $postId, \WP_Post $post, bool $update): void
	{
		if ($post->post_type !== 'fgpx_track') { return; }
		$modified = (string) $post->post_modified_gmt;
		// Delete common v2 cache variants for this post
		\delete_transient('fgpx_json_v2_' . (int) $postId . '_' . $modified . '_hp_0_simp_0');
	}

	/**
	 * Invalidate caches when post meta is updated.
	 */
	public function invalidate_cache_on_meta(int $metaId, int $objectId, string $metaKey, $metaValue): void
	{
		// Invalidate cache for file path changes and weather data changes
		$weatherKeys = ['fgpx_file_path', 'fgpx_weather_points', 'fgpx_weather_summary'];
		if ((int) $objectId <= 0 || !\in_array($metaKey, $weatherKeys, true)) { return; }
		
		$post = \get_post((int) $objectId);
		if (!$post || $post->post_type !== 'fgpx_track') { return; }
		
		$this->clear_all_track_caches((int) $objectId);
	}

	/**
	 * Clear all possible cache variants for a track.
	 */
	public function clear_all_track_caches(int $trackId): void
	{
		$post = \get_post($trackId);
		if (!$post || $post->post_type !== 'fgpx_track') { return; }
		
		$modified = (string) $post->post_modified_gmt;
		
		// Clear all possible cache variants with all parameter combinations
		$patterns = [
			// Legacy format (backward compatibility)
			'fgpx_json_v2_' . $trackId . '_' . $modified . '_hp_0_simp_0',
			'fgpx_json_v2_' . $trackId . '_' . $modified . '_hp_0_simp_1500',
			
			// With weather status only (older format)
			'fgpx_json_v2_' . $trackId . '_' . $modified . '_hp_0_simp_0_w_0',
			'fgpx_json_v2_' . $trackId . '_' . $modified . '_hp_0_simp_0_w_1',
			'fgpx_json_v2_' . $trackId . '_' . $modified . '_hp_0_simp_1500_w_0',
			'fgpx_json_v2_' . $trackId . '_' . $modified . '_hp_0_simp_1500_w_1',
			
			// With weather + wind (current format)
			'fgpx_json_v2_' . $trackId . '_' . $modified . '_hp_0_simp_0_w_0_wind_0',
			'fgpx_json_v2_' . $trackId . '_' . $modified . '_hp_0_simp_0_w_0_wind_1',
			'fgpx_json_v2_' . $trackId . '_' . $modified . '_hp_0_simp_0_w_1_wind_0',
			'fgpx_json_v2_' . $trackId . '_' . $modified . '_hp_0_simp_0_w_1_wind_1',
			'fgpx_json_v2_' . $trackId . '_' . $modified . '_hp_0_simp_1500_w_0_wind_0',
			'fgpx_json_v2_' . $trackId . '_' . $modified . '_hp_0_simp_1500_w_0_wind_1',
			'fgpx_json_v2_' . $trackId . '_' . $modified . '_hp_0_simp_1500_w_1_wind_0',
			'fgpx_json_v2_' . $trackId . '_' . $modified . '_hp_0_simp_1500_w_1_wind_1',
		];
		
		foreach ($patterns as $pattern) {
			\delete_transient($pattern);
		}
		
		// Also clear any cached key stored in post meta
		\delete_post_meta($trackId, 'fgpx_cached_key');
		
		// Clear old cache formats too
		\delete_transient('fgpx_track_' . $trackId);
		\delete_transient('fgpx_json_' . $trackId . '_' . $modified);
	}

	/**
	 * Add bulk actions for weather enrichment.
	 */
	public function add_bulk_actions(array $actions): array
	{
		$actions['fgpx_enrich_weather'] = \esc_html__('Enrich with Weather Data', 'flyover-gpx');
		return $actions;
	}

	/**
	 * Handle bulk weather enrichment action.
	 */
	public function handle_bulk_actions(string $redirect_to, string $doaction, array $post_ids): string
	{
		if ($doaction !== 'fgpx_enrich_weather') {
			return $redirect_to;
		}

		if (empty($post_ids)) {
			return $redirect_to;
		}

		$processed = 0;
		$errors = 0;

		foreach ($post_ids as $post_id) {
			$post = \get_post((int) $post_id);
			if (!$post || $post->post_type !== 'fgpx_track') {
				continue;
			}

			// Get existing GeoJSON
			$geojson = \get_post_meta((int) $post_id, 'fgpx_geojson', true);
			if (!\is_string($geojson) || $geojson === '') {
				$errors++;
				continue;
			}

			// Enrich with weather data
			$success = self::enrichWithWeather((int) $post_id, $geojson);
			if ($success) {
				// Get updated geojson after weather enrichment
				$geojsonArray = json_decode($geojson, true);
				if ($geojsonArray) {
					// Interpolate wind data if enabled (after weather enrichment)
					self::interpolateWindDataForTrack((int) $post_id, $geojsonArray);
					// Store final geojson with wind data
					\update_post_meta((int) $post_id, 'fgpx_geojson', \wp_json_encode($geojsonArray));
					// Invalidate cache for this post
					$modified = (string) \get_post_field('post_modified_gmt', (int) $post_id);
					$cache_key_v2_prefix = 'fgpx_json_v2_' . (int) $post_id . '_' . $modified;
					\delete_transient($cache_key_v2_prefix . '_hp_0_simp_0');
				}
				$processed++;
			} else {
				$errors++;
			}
		}

		// Add query args to show results
		$redirect_to = \add_query_arg([
			'fgpx_weather_enriched' => $processed,
			'fgpx_weather_errors' => $errors,
		], $redirect_to);

		return $redirect_to;
	}

	/**
	 * AJAX handler for individual weather enrichment.
	 */
	public function ajax_enrich_weather(): void
	{
		// Validate nonce for AJAX request
		if (!$this->validateNonce('fgpx_enrich_weather', 'nonce', false)) {
			\wp_send_json_error(['message' => 'Security check failed'], 403);
		}

		$post_id = isset($_POST['post_id']) ? (int) $_POST['post_id'] : 0;
		if ($post_id <= 0) {
			\wp_send_json_error(['message' => 'Invalid post ID'], 400);
		}

		$post = \get_post($post_id);
		if (!$post || $post->post_type !== 'fgpx_track') {
			\wp_send_json_error(['message' => 'Invalid track'], 404);
		}

		// Validate user capability for this specific post
		// Check if user can edit this specific post (WordPress will map to correct capability)
		if (!\current_user_can('edit_post', $post_id)) {
			\wp_send_json_error(['message' => 'Insufficient permissions to edit this track'], 403);
		}

		// Get existing GeoJSON
		$geojson = \get_post_meta($post_id, 'fgpx_geojson', true);
		if (!\is_string($geojson) || $geojson === '') {
			\wp_send_json_error(['message' => 'No GeoJSON data found'], 400);
		}

		// Enrich with weather data
		$success = self::enrichWithWeather($post_id, $geojson);
		if ($success) {
			// Get updated geojson after weather enrichment
			$geojsonArray = json_decode($geojson, true);
			if ($geojsonArray) {
				// Interpolate wind data if enabled (after weather enrichment)
				self::interpolateWindDataForTrack($post_id, $geojsonArray);
				// Store final geojson with wind data
				\update_post_meta($post_id, 'fgpx_geojson', \wp_json_encode($geojsonArray));
				// Invalidate cache for this post
				$modified = (string) \get_post_field('post_modified_gmt', $post_id);
				$cache_key_v2_prefix = 'fgpx_json_v2_' . $post_id . '_' . $modified;
				\delete_transient($cache_key_v2_prefix . '_hp_0_simp_0');
			}
			\wp_send_json_success(['message' => 'Weather data enriched successfully']);
		} else {
			// Try to get detailed error from transient
			$errorMsg = \get_transient('fgpx_weather_error_' . $post_id);
			\delete_transient('fgpx_weather_error_' . $post_id);
			
			if ($errorMsg) {
				\wp_send_json_error(['message' => 'Weather enrichment failed: ' . $errorMsg], 500);
			} else {
				\wp_send_json_error(['message' => 'Failed to enrich with weather data (unknown error)'], 500);
			}
		}
	}
}
