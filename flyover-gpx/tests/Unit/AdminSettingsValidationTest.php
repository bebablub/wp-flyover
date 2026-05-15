<?php

declare(strict_types=1);

namespace FGpx\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class AdminSettingsValidationTest extends TestCase
{
    public function test_weather_sampling_is_whitelisted_to_known_modes(): void
    {
        $adminFile = dirname(__DIR__, 2) . '/includes/Admin.php';
        $source = (string) file_get_contents($adminFile);

        $this->assertStringContainsString("if (!\\in_array(\$weatherSampling, ['distance', 'time'], true))", $source);
        $this->assertStringContainsString("\$weatherSampling = 'distance';", $source);
    }

    public function test_photo_order_mode_is_whitelisted_to_known_modes(): void
    {
        $adminFile = dirname(__DIR__, 2) . '/includes/Admin.php';
        $source = (string) file_get_contents($adminFile);

        $this->assertStringContainsString('\\sanitize_key((string) $_POST[\'fgpx_photo_order_mode\'])', $source);
        $this->assertStringContainsString('if (!\\in_array($photoOrderMode, [\'geo_first\', \'time_first\'], true))', $source);
        $this->assertStringContainsString('$photoOrderMode = \'geo_first\';', $source);
        $this->assertStringContainsString('\\update_option(\'fgpx_photo_order_mode\', $photoOrderMode, true);', $source);
    }

    public function test_photo_queue_rotation_setting_is_rendered_and_persisted_as_boolean(): void
    {
        $adminFile = dirname(__DIR__, 2) . '/includes/Admin.php';
        $source = (string) file_get_contents($adminFile);

        $this->assertStringContainsString('$photoQueueRotationEnabled = ($options[\'fgpx_photo_queue_rotation_enabled\'] ?? \'0\') === \'1\';', $source);
        $this->assertStringContainsString('id="fgpx_photo_queue_rotation_enabled" name="fgpx_photo_queue_rotation_enabled" value="1"', $source);
        $this->assertStringContainsString('\\update_option(\'fgpx_photo_queue_rotation_enabled\', $this->getValidBool(\'fgpx_photo_queue_rotation_enabled\') ? \'1\' : \'0\', true);', $source);
    }

    public function test_arrow_settings_are_bounded_and_persisted(): void
    {
        $adminFile = dirname(__DIR__, 2) . '/includes/Admin.php';
        $source = (string) file_get_contents($adminFile);

        $this->assertStringContainsString('\\update_option(\'fgpx_arrows_enabled\', isset($_POST[\'fgpx_arrows_enabled\']) ? \'1\' : \'0\', true);', $source);
        $this->assertStringContainsString('\\update_option(\'fgpx_arrows_km\', (string) max(0.5, min(100, (float) $_POST[\'fgpx_arrows_km\'])), true);', $source);
    }

    public function test_map_selector_default_is_whitelisted_to_known_modes(): void
    {
        $adminFile = dirname(__DIR__, 2) . '/includes/Admin.php';
        $source = (string) file_get_contents($adminFile);

        $this->assertStringContainsString('if ($mapSelectorDefault === \'basic\' || $mapSelectorDefault === \'\') { $mapSelectorDefault = \'satellite\'; }', $source);
        $this->assertStringContainsString('if ($mapSelectorDefault === \'basic_contours\') { $mapSelectorDefault = \'satellite_contours\'; }', $source);
        $this->assertStringContainsString('if (!\\in_array($mapSelectorDefault, [\'satellite\', \'satellite_contours\'], true)) { $mapSelectorDefault = \'satellite\'; }', $source);
        $this->assertStringContainsString('\\update_option(\'fgpx_map_selector_default\', $mapSelectorDefault, true);', $source);
    }

    public function test_settings_tabs_include_performance_panel_and_content_container(): void
    {
        $adminFile = dirname(__DIR__, 2) . '/includes/Admin.php';
        $source = (string) file_get_contents($adminFile);

        $this->assertStringContainsString('data-tab="performance"', $source);
        $this->assertStringContainsString('id="performance-content" class="fgpx-tab-content"', $source);
    }

    public function test_playback_tab_content_is_not_split_by_visualization_panel(): void
    {
        $adminFile = dirname(__DIR__, 2) . '/includes/Admin.php';
        $source = (string) file_get_contents($adminFile);

        $playbackClosePos = strpos($source, "echo '</div>'; // Close playback-content-content tab");
        $visualizationPos = strpos($source, "// Tab 3: Visualization");

        $this->assertNotFalse($playbackClosePos, 'Playback tab closing marker should exist.');
        $this->assertNotFalse($visualizationPos, 'Visualization tab marker should exist.');
        $this->assertLessThan($visualizationPos, $playbackClosePos, 'Playback panel should close before visualization panel starts.');
        $this->assertStringNotContainsString('rest of Media & Privacy continues below', $source);
    }

    public function test_custom_css_section_is_in_visualization_tab_only(): void
    {
        $adminFile = dirname(__DIR__, 2) . '/includes/Admin.php';
        $source = (string) file_get_contents($adminFile);

        $visualizationStart = strpos($source, "// Tab 3: Visualization");
        $visualizationEnd = strpos($source, "echo '</div>'; // Close visualization-content tab");
        $customCssPos = strpos($source, "Player Theme (Custom CSS)");

        $this->assertNotFalse($visualizationStart);
        $this->assertNotFalse($visualizationEnd);
        $this->assertNotFalse($customCssPos);
        $this->assertGreaterThan($visualizationStart, $customCssPos);
        $this->assertLessThan($visualizationEnd, $customCssPos);
        $this->assertStringNotContainsString("Save CSS", $source);
    }

    public function test_diagnostics_and_playback_statistics_are_in_advanced_tab_only(): void
    {
        $adminFile = dirname(__DIR__, 2) . '/includes/Admin.php';
        $source = (string) file_get_contents($adminFile);

        $advancedStart = strpos($source, "// Tab 6: Advanced");
        $advancedEnd = strpos($source, "echo '</div>'; // Close advanced-content tab");
        $diagnosticsPos = strpos($source, "Error Logging & Diagnostics");
        $playbackStatsPos = strpos($source, "Playback Statistics");

        $this->assertNotFalse($advancedStart);
        $this->assertNotFalse($advancedEnd);
        $this->assertNotFalse($diagnosticsPos);
        $this->assertNotFalse($playbackStatsPos);
        $this->assertGreaterThan($advancedStart, $diagnosticsPos);
        $this->assertLessThan($advancedEnd, $diagnosticsPos);
        $this->assertGreaterThan($advancedStart, $playbackStatsPos);
        $this->assertLessThan($advancedEnd, $playbackStatsPos);
        $this->assertStringNotContainsString('Error Logging Section (separate, outside tabs)', $source);
    }

    public function test_contour_settings_are_rendered_and_persisted_with_bounds(): void
    {
        $adminFile = dirname(__DIR__, 2) . '/includes/Admin.php';
        $source = (string) file_get_contents($adminFile);

        $this->assertStringContainsString('id="fgpx_contours_enabled" name="fgpx_contours_enabled" value="1"', $source);
        $this->assertStringContainsString("\\update_option('fgpx_contours_enabled', isset(\$_POST['fgpx_contours_enabled']) ? '1' : '0', true);", $source);
        $this->assertStringContainsString("\\update_option('fgpx_contours_color', \$this->getValidColor('fgpx_contours_color', '#ffffff'), true);", $source);
        $this->assertStringContainsString("\\update_option('fgpx_contours_width', (string) max(0.1, min(6.0, \$this->getValidFloat('fgpx_contours_width', 1.2, 0.1, 6.0))), true);", $source);
        $this->assertStringContainsString("\\update_option('fgpx_contours_opacity', (string) max(0.1, min(1.0, \$this->getValidFloat('fgpx_contours_opacity', 0.75, 0.1, 1.0))), true);", $source);
        $this->assertStringContainsString('\\update_option(\'fgpx_contours_minzoom\', (string) $contoursMinzoom, true);', $source);
        $this->assertStringContainsString('\\update_option(\'fgpx_contours_maxzoom\', (string) $contoursMaxzoom, true);', $source);
        $this->assertStringContainsString('id="fgpx_contours_source_layer" name="fgpx_contours_source_layer"', $source);
        $this->assertStringContainsString('$contoursSourceLayerRaw = isset($_POST[\'fgpx_contours_source_layer\']) ? (string) \wp_unslash($_POST[\'fgpx_contours_source_layer\']) : \'contour\';', $source);
        $this->assertStringContainsString('$contoursSourceLayer = \\trim((string) \\sanitize_text_field($contoursSourceLayerRaw));', $source);
        $this->assertStringContainsString('\\update_option(\'fgpx_contours_source_layer\', $contoursSourceLayer, true);', $source);
        $this->assertStringContainsString('id="fgpx_satellite_layer_id" name="fgpx_satellite_layer_id"', $source);
        $this->assertStringContainsString('$satelliteLayerIdRaw = isset($_POST[\'fgpx_satellite_layer_id\']) ? (string) \\wp_unslash($_POST[\'fgpx_satellite_layer_id\']) : \'satellite\';', $source);
        $this->assertStringContainsString('\\update_option(\'fgpx_satellite_layer_id\', $satelliteLayerId, true);', $source);
        $this->assertStringContainsString('id="fgpx_satellite_tiles_url" name="fgpx_satellite_tiles_url"', $source);
        $this->assertStringContainsString('$satelliteTilesUrlRaw = isset($_POST[\'fgpx_satellite_tiles_url\']) ? \trim((string) \wp_unslash($_POST[\'fgpx_satellite_tiles_url\'])) : \'\';', $source);
        $this->assertStringContainsString('\\update_option(\'fgpx_satellite_tiles_url\', $satelliteTilesUrl, true);', $source);
    }

    public function test_weather_priority_order_filters_unknown_tokens_and_restores_defaults(): void
    {
        $adminFile = dirname(__DIR__, 2) . '/includes/Admin.php';
        $source = (string) file_get_contents($adminFile);

        $this->assertStringContainsString("\$allowedPriority = ['snow', 'rain', 'fog', 'clouds'];", $source);
        $this->assertStringContainsString("\\in_array(\$token, \$allowedPriority, true)", $source);
        $this->assertStringContainsString("\\implode(',', \$priorityOrderList)", $source);
    }

    public function test_generate_weather_samples_skips_invalid_timestamps_in_distance_and_fallback_modes(): void
    {
        $adminFile = dirname(__DIR__, 2) . '/includes/Admin.php';
        $source = (string) file_get_contents($adminFile);

        $this->assertStringContainsString("if (\$parsed === false) {", $source);
        $this->assertStringContainsString("continue;", $source);
    }

    public function test_upload_flow_validates_xml_before_creating_track_post(): void
    {
        $adminFile = dirname(__DIR__, 2) . '/includes/Admin.php';
        $source = (string) file_get_contents($adminFile);

        $this->assertStringContainsString("\$gpxValidation = self::validate_gpx_upload_file(\$filePath);", $source);
        $this->assertStringContainsString("if (\\is_wp_error(\$gpxValidation)) {", $source);
        $this->assertStringContainsString("The uploaded GPX file is malformed XML. Please export the track again and retry.", $source);
        $this->assertStringContainsString("The uploaded file is XML, but it is not a GPX document.", $source);
    }

    public function test_parse_routine_reuses_gpx_validation_before_phpgpx_load(): void
    {
        $adminFile = dirname(__DIR__, 2) . '/includes/Admin.php';
        $source = (string) file_get_contents($adminFile);

        $this->assertStringContainsString("public static function parse_gpx_and_stats(string \$filePath)", $source);
        $this->assertStringContainsString("return new \\WP_Error('fgpx_parse_error', \\esc_html__('Failed to parse GPX file. The XML is readable, but the GPX structure is malformed or unsupported.'", $source);
        $this->assertStringContainsString("private static function validate_gpx_upload_file(string \$filePath)", $source);
    }

    public function test_weather_enrichment_records_sampling_limits_and_truncation_summary(): void
    {
        $adminFile = dirname(__DIR__, 2) . '/includes/Admin.php';
        $source = (string) file_get_contents($adminFile);

        $this->assertStringContainsString("\$maxWeatherSamples = 250;", $source);
        $this->assertStringContainsString("'requested_samples' => \$requestedSampleCount", $source);
        $this->assertStringContainsString("'samples_truncated' => \$samplesTruncated", $source);
        $this->assertStringContainsString("'requested_unique_coords' => (int) (\$weatherMeta['requested_unique_coords'] ?? 0)", $source);
        $this->assertStringContainsString("'unique_coords_truncated' => !empty(\$weatherMeta['unique_coords_truncated'])", $source);
        $this->assertStringContainsString('Coverage Limited:', $source);
    }

    public function test_theme_auto_dark_times_require_valid_24h_clock_values(): void
    {
        $adminFile = dirname(__DIR__, 2) . '/includes/Admin.php';
        $source = (string) file_get_contents($adminFile);

        $this->assertStringContainsString('private function isValidClockTime(string $value): bool', $source);
        $this->assertStringContainsString("\$this->isValidClockTime(\$start) ? \$start : '22:00'", $source);
        $this->assertStringContainsString("\$this->isValidClockTime(\$end) ? \$end : '06:00'", $source);
    }
}
