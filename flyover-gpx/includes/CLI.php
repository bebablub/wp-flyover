<?php

declare(strict_types=1);

namespace FGpx;

if (!\defined('ABSPATH')) { exit; }

/**
 * WP-CLI commands for Flyover GPX
 */
final class CLI
{
	/** Register the CLI command */
	public static function register(): void
	{
		if (\defined('WP_CLI') && WP_CLI) {
			\WP_CLI::add_command('fgpx', __CLASS__);
		}
	}

	/**
	 * Import a GPX file as a Track and optionally embed shortcode into a post.
	 *
	 * ## OPTIONS
	 *
	 * --file=<path>
	 * : Absolute path to a .gpx file to import.
	 *
	 * [--post=<id>]
	 * : Optional WordPress post ID to embed the shortcode into.
	 *
	 * [--title=<string>]
	 * : Optional Track post title (defaults to file name).
	 *
	 * [--privacy=<on|off>]
	 * : Optional privacy override for the shortcode (on/off).
	 *
	 * [--privacy-km=<float>]
	 * : Optional privacy km for the shortcode (e.g. 3).
	 *
	 * [--hud=<on|off>]
	 * : Optional HUD overlay override for the shortcode (on/off).
	 *
	 * [--elevation-coloring=<on|off>]
	 * : Optional elevation coloring override for the shortcode (on/off).
	 *
	 * [--show-labels=<on|off>]
	 * : Optional show max elev/speed labels override (on/off).
	 *
	 * [--elevation-color-flat=<color>]
	 * : Optional flat terrain color override (hex color).
	 *
	 * [--elevation-color-steep=<color>]
	 * : Optional steep terrain color override (hex color).
	 *
	 * [--speed-chart-color=<color>]
	 * : Optional speed chart color override (hex color).
	 *
	 * [--cadence-chart-color=<color>]
	 * : Optional cadence chart color override (hex color).
	 *
	 * [--temperature-chart-color=<color>]
	 * : Optional temperature chart color override (hex color).
	 *
	 * [--power-chart-color=<color>]
	 * : Optional power chart color override (hex color).
	 *
	 * [--wind-impact-chart-color=<color>]
	 * : Optional wind impact chart color override (hex color).
	 *
	 * [--wind-rose-chart-color=<color>]
	 * : Optional wind rose chart color override (hex color).
	 *
	 * [--wind-rose-color-north=<color>]
	 * : Optional wind rose north color override (hex color).
	 *
	 * [--wind-rose-color-south=<color>]
	 * : Optional wind rose south color override (hex color).
	 *
	 * [--wind-rose-color-east=<color>]
	 * : Optional wind rose east color override (hex color).
	 *
	 * [--wind-rose-color-west=<color>]
	 * : Optional wind rose west color override (hex color).
	 *
	 * [--photos-enabled=<on|off>]
	 * : Optional enable photo thumbnails override (on/off).
	 *
	 * [--weather-visible-by-default=<on|off>]
	 * : Optional weather overlay default visibility override (on/off).
	 *
	 * [--wind-analysis-enabled=<on|off>]
	 * : Optional enable wind impact analysis override (on/off).
	 *
	 * [--daynight-enabled=<on|off>]
	 * : Optional enable day/night chart visualization override (on/off).
	 *
	 * [--daynight-map-enabled=<on|off>]
	 * : Optional enable day/night map overlay override (on/off).
	 *
	 * [--daynight-visible-by-default=<on|off>]
	 * : Optional day/night overlay default visibility override (on/off).
	 *
	 * [--daynight-map-color=<color>]
	 * : Optional night overlay color override (hex color).
	 *
	 * [--publish]
	 * : If --post is provided, publish that post after inserting the shortcode.
	 *
	 * ## EXAMPLES
	 *
	 *   wp fgpx import --file=/path/ride.gpx
	 *   wp fgpx import --file=/path/ride.gpx --post=123 --publish --title="Sunday Ride" --privacy=on --privacy-km=3 --hud=on --elevation-coloring=on
	 *   wp fgpx import --file=/path/ride.gpx --post=123 --show-labels=on --elevation-color-flat="#00ff00" --speed-chart-color="#ff0000"
	 */
	public function import(array $args, array $assoc_args): void
	{
		if (!class_exists('phpGPX\\phpGPX')) {
			\WP_CLI::error('phpGPX library is missing. Run composer install in the plugin directory.');
		}

		$file = (string) (\WP_CLI\Utils\get_flag_value($assoc_args, 'file', '') ?? '');
		if ($file === '' || !is_readable($file)) {
			\WP_CLI::error('Invalid or unreadable --file path.');
		}

		$destPath = self::copyToUploadsDir($file);
		if ($destPath === '') {
			\WP_CLI::error('Failed to copy file into uploads/flyover-gpx.');
		}

		$parse = self::parseGpxAndStats($destPath);
		if (!is_array($parse)) {
			@unlink($destPath);
			\WP_CLI::error('Failed to parse GPX.');
		}

		$title = (string) (\WP_CLI\Utils\get_flag_value($assoc_args, 'title', '') ?? '');
		if ($title === '') {
			$fileName = sanitize_file_name((string) wp_basename($destPath));
			$cleanTitle = $fileName;
			if (preg_match('/^fgpx_[a-f0-9]+\.[a-f0-9]+-(.+)$/', $cleanTitle, $matches)) {
				$cleanTitle = $matches[1];
			}
			if (str_ends_with($cleanTitle, '.gpx')) {
				$cleanTitle = substr($cleanTitle, 0, -4);
			}
			$cleanTitle = str_replace('_', ' ', $cleanTitle);
			$title = trim($cleanTitle);
		}

		$postId = wp_insert_post([
			'post_title' => $title,
			'post_type' => 'fgpx_track',
			'post_status' => 'publish',
		], true);
		if (is_wp_error($postId)) {
			@unlink($destPath);
			\WP_CLI::error($postId->get_error_message());
		}

		update_post_meta($postId, 'fgpx_file_path', $destPath);
		update_post_meta($postId, 'fgpx_stats', $parse['stats']);
		update_post_meta($postId, 'fgpx_geojson', $parse['geojson']);
		update_post_meta($postId, 'fgpx_bounds', $parse['bounds']);
		update_post_meta($postId, 'fgpx_points_count', (int) $parse['points_count']);
		update_post_meta($postId, 'fgpx_total_distance_m', (float) ($parse['stats']['total_distance_m'] ?? 0));
		update_post_meta($postId, 'fgpx_moving_time_s', (float) ($parse['stats']['moving_time_s'] ?? 0));
		update_post_meta($postId, 'fgpx_elevation_gain_m', (float) ($parse['stats']['elevation_gain_m'] ?? 0));
		update_post_meta($postId, 'fgpx_max_speed_m_s', (float) ($parse['stats']['max_speed_m_s'] ?? 0));

		// Enrich with weather data if enabled
		\FGpx\Admin::enrichWithWeather($postId, $parse['geojson']);

		// Interpolate wind data if enabled (after weather enrichment, matching web upload behavior)
		$geojsonArray = \json_decode((string) \get_post_meta($postId, 'fgpx_geojson', true), true);
		if (\is_array($geojsonArray)) {
			\FGpx\Admin::interpolateWindDataForTrack($postId, $geojsonArray);
			\update_post_meta($postId, 'fgpx_geojson', \wp_json_encode($geojsonArray));
		}

		\FGpx\Admin::clear_all_track_caches($postId);
		\FGpx\Statistics::invalidate_cache();
		\FGpx\GalleryShortcode::invalidate_tracks_cache();
		\WP_CLI::success('Track imported. ID: ' . (int) $postId);

		$host = (int) (\WP_CLI\Utils\get_flag_value($assoc_args, 'post', 0) ?? 0);
		if ($host > 0) {
			$hostPost = get_post($host);
			if (!$hostPost) {
				\WP_CLI::warning('Host post not found. Skipping shortcode insertion.');
				return;
			}
			$short = '[flyover_gpx id="' . (int) $postId . '"';
			$privacy = (string) (\WP_CLI\Utils\get_flag_value($assoc_args, 'privacy', '') ?? '');
			if ($privacy !== '') {
				$pv = strtolower($privacy);
				if (in_array($pv, ['on','true','1','yes'], true)) { $short .= ' privacy="true"'; }
				elseif (in_array($pv, ['off','false','0','no'], true)) { $short .= ' privacy="false"'; }
			}
			$pvkm = (string) (\WP_CLI\Utils\get_flag_value($assoc_args, 'privacy-km', '') ?? '');
			if ($pvkm !== '' && is_numeric($pvkm)) { $short .= ' privacy_km="' . esc_attr($pvkm) . '"'; }
			$hud = (string) (\WP_CLI\Utils\get_flag_value($assoc_args, 'hud', '') ?? '');
			if ($hud !== '') {
				$hv = strtolower($hud);
				if (in_array($hv, ['on','true','1','yes'], true)) { $short .= ' hud="true"'; }
				elseif (in_array($hv, ['off','false','0','no'], true)) { $short .= ' hud="false"'; }
			}
			$elevationColoring = (string) (\WP_CLI\Utils\get_flag_value($assoc_args, 'elevation-coloring', '') ?? '');
			if ($elevationColoring !== '') {
				$ecv = strtolower($elevationColoring);
				if (in_array($ecv, ['on','true','1','yes'], true)) { $short .= ' elevation_coloring="true"'; }
				elseif (in_array($ecv, ['off','false','0','no'], true)) { $short .= ' elevation_coloring="false"'; }
			}
			$speedCli = (string) (\WP_CLI\Utils\get_flag_value($assoc_args, 'speed', '') ?? '');
			if ($speedCli !== '' && is_numeric($speedCli) && (int) $speedCli > 0) { $short .= ' speed="' . (int) $speedCli . '"'; }
			
			// Helper function for boolean CLI parameters
			$addBooleanParam = function($paramName, $shortcodeName) use ($assoc_args, &$short) {
				$value = (string) (\WP_CLI\Utils\get_flag_value($assoc_args, $paramName, '') ?? '');
				if ($value !== '') {
					$v = strtolower($value);
					if (in_array($v, ['on','true','1','yes'], true)) { $short .= ' ' . $shortcodeName . '="true"'; }
					elseif (in_array($v, ['off','false','0','no'], true)) { $short .= ' ' . $shortcodeName . '="false"'; }
				}
			};
			
			// Helper function for color CLI parameters
			$addColorParam = function($paramName, $shortcodeName) use ($assoc_args, &$short) {
				$value = (string) (\WP_CLI\Utils\get_flag_value($assoc_args, $paramName, '') ?? '');
				if ($value !== '') {
					$sanitized = sanitize_hex_color($value);
					if ($sanitized !== null) { $short .= ' ' . $shortcodeName . '="' . esc_attr($sanitized) . '"'; }
				}
			};
			
			// Add boolean parameters
			$addBooleanParam('show-labels', 'show_labels');
			$addBooleanParam('photos-enabled', 'photos_enabled');
			$addBooleanParam('weather-visible-by-default', 'weather_visible_by_default');
			$addBooleanParam('wind-analysis-enabled', 'wind_analysis_enabled');
			$addBooleanParam('daynight-enabled', 'daynight_enabled');
			$addBooleanParam('daynight-map-enabled', 'daynight_map_enabled');
			$addBooleanParam('daynight-visible-by-default', 'daynight_visible_by_default');
			
			// Add color parameters
			$addColorParam('elevation-color-flat', 'elevation_color_flat');
			$addColorParam('elevation-color-steep', 'elevation_color_steep');
			$addColorParam('speed-chart-color', 'speed_chart_color');
			$addColorParam('cadence-chart-color', 'cadence_chart_color');
			$addColorParam('temperature-chart-color', 'temperature_chart_color');
			$addColorParam('power-chart-color', 'power_chart_color');
			$addColorParam('wind-impact-chart-color', 'wind_impact_chart_color');
			$addColorParam('wind-rose-chart-color', 'wind_rose_chart_color');
			$addColorParam('wind-rose-color-north', 'wind_rose_color_north');
			$addColorParam('wind-rose-color-south', 'wind_rose_color_south');
			$addColorParam('wind-rose-color-east', 'wind_rose_color_east');
			$addColorParam('wind-rose-color-west', 'wind_rose_color_west');
			$addColorParam('daynight-map-color', 'daynight_map_color');
			
			$short .= ']';
			$newContent = (string) ($hostPost->post_content ?? '');
			$newContent .= (substr($newContent, -1) === "\n" ? '' : "\n\n") . $short . "\n";
			wp_update_post(['ID' => $hostPost->ID, 'post_content' => $newContent]);
			$doPublish = (bool) (\WP_CLI\Utils\get_flag_value($assoc_args, 'publish', false));
			if ($doPublish && $hostPost->post_status !== 'publish') {
				wp_update_post(['ID' => $hostPost->ID, 'post_status' => 'publish']);
			}
			\WP_CLI::success('Shortcode inserted into post ID ' . (int) $hostPost->ID);
		}
	}

	/**
	 * Backfill activity dates for existing tracks from GPX files.
	 *
	 * Processes all published fgpx_track posts that don't have fgpx_activity_date_unix
	 * set, extracts the earliest timestamp from their GPX files, and stores it.
	 *
	 * ## OPTIONS
	 *
	 * [--limit=<number>]
	 * : Maximum number of tracks to process (default: unlimited).
	 *
	 * [--dry-run]
	 * : Preview changes without saving them.
	 *
	 * ## EXAMPLES
	 *
	 *     wp fgpx backfill-activity-dates
	 *     wp fgpx backfill-activity-dates --dry-run
	 *     wp fgpx backfill-activity-dates --limit=50
	 *
	 * @param array<int,string> $args
	 * @param array<string,mixed> $assoc_args
	 */
	public function backfill_activity_dates(array $args, array $assoc_args): void
	{
		$dryRun = \WP_CLI\Utils\get_flag_value($assoc_args, 'dry-run', false);
		$limit = (int) (\WP_CLI\Utils\get_flag_value($assoc_args, 'limit', 0) ?? 0);

		\WP_CLI::line('Backfilling activity dates for tracks without fgpx_activity_date_unix...');
		if ($dryRun) {
			\WP_CLI::line('(DRY RUN - no changes will be saved)');
		}

		// Query tracks without activity date
		$query = new \WP_Query([
			'post_type' => 'fgpx_track',
			'post_status' => 'publish',
			'posts_per_page' => $limit > 0 ? $limit : -1,
			'fields' => 'ids',
			'no_found_rows' => false,
		]);

		$query_args = [
			'post_type' => 'fgpx_track',
			'post_status' => 'publish',
			'posts_per_page' => $limit > 0 ? $limit : -1,
			'fields' => 'ids',
			'meta_query' => [
				[
					'key' => 'fgpx_activity_date_unix',
					'compare' => 'NOT EXISTS',
				],
			],
		];

		if ($limit > 0) {
			$query_args['posts_per_page'] = $limit;
		}

		$posts = \get_posts($query_args);
		$total = count($posts);

		if ($total === 0) {
			\WP_CLI::success('No tracks to process. All tracks have activity dates set.');
			return;
		}

		\WP_CLI::line("Found $total track(s) to process.");

		$progress = \WP_CLI\Utils\make_progress_bar('Processing tracks', $total);
		$processed = 0;
		$updated = 0;
		$errors = [];

		foreach ($posts as $post_id) {
			$progress->tick();
			$processed++;

			$filePath = (string) \get_post_meta((int) $post_id, 'fgpx_file_path', true);
			if ($filePath === '' || !\is_readable($filePath)) {
				$errors[] = "Track $post_id: GPX file not found or not readable";
				continue;
			}

			try {
				$gpx = new \phpGPX\phpGPX();
				$file = $gpx->load($filePath);
			} catch (\Throwable $e) {
				$errors[] = "Track $post_id: GPX parse error - " . $e->getMessage();
				continue;
			}

			// Extract earliest timestamp
			$minTimestamp = null;
			foreach ($file->tracks as $track) {
				foreach ($track->segments as $segment) {
					foreach ($segment->points as $point) {
						$time = $point->time ? (int) $point->time->getTimestamp() : null;
						if ($time !== null) {
							if ($minTimestamp === null || $time < $minTimestamp) {
								$minTimestamp = $time;
							}
						}
					}
				}
			}

			if ($minTimestamp === null) {
				// No timestamps found, use post date
				$minTimestamp = (int) \get_post_time('U', true, (int) $post_id);
			}

			if (!$dryRun) {
				\update_post_meta((int) $post_id, 'fgpx_activity_date_unix', $minTimestamp);
				// Invalidate timeline cache
				\delete_transient('fgpx_timeline_tracks_v1');
			}

			$updated++;
		}

		$progress->finish();

		\WP_CLI::line('');
		\WP_CLI::success("Backfill complete: $updated/$total tracks updated.");

		if (!empty($errors)) {
			\WP_CLI::warning('Errors encountered:');
			foreach ($errors as $error) {
				\WP_CLI::warning('  - ' . $error);
			}
		}

		if ($dryRun) {
			\WP_CLI::line('(No changes were saved due to --dry-run flag)');
		}
	}

	/** Copy uploaded file into uploads/flyover-gpx */
	private static function copyToUploadsDir(string $absPath): string
	{
		$uploads = wp_upload_dir();
		$base = rtrim((string) ($uploads['basedir'] ?? ''), '/\\');
		if ($base === '') { return ''; }
		$dir = $base . DIRECTORY_SEPARATOR . 'flyover-gpx';
		if (!is_dir($dir)) { @mkdir($dir, 0755, true); }
		if (!is_dir($dir) || !is_writable($dir)) { return ''; }
		$nameOnly = sanitize_file_name((string) wp_basename($absPath));
		$dest = $dir . DIRECTORY_SEPARATOR . uniqid('fgpx_', true) . '-' . $nameOnly;
		return @copy($absPath, $dest) ? $dest : '';
	}

	/** Parse GPX and compute stats/geojson/bounds — delegates to Admin::parse_gpx_and_stats */
	private static function parseGpxAndStats(string $filePath): ?array
	{
		$parse = \FGpx\Admin::parse_gpx_and_stats($filePath);
		if (\is_wp_error($parse)) {
			return null;
		}
		// Encode geojson to JSON string to match existing import() contract
		$parse['geojson'] = \wp_json_encode($parse['geojson']);
		return $parse;
	}
}


