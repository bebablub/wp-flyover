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

        $this->assertStringContainsString("\\sanitize_key((string) \\$_POST['fgpx_photo_order_mode'])", $source);
        $this->assertStringContainsString("if (!\\in_array(\$photoOrderMode, ['geo_first', 'time_first'], true))", $source);
        $this->assertStringContainsString("\$photoOrderMode = 'geo_first';", $source);
        $this->assertStringContainsString("\\update_option('fgpx_photo_order_mode', \$photoOrderMode, true);", $source);
    }

    public function test_arrow_settings_are_bounded_and_persisted(): void
    {
        $adminFile = dirname(__DIR__, 2) . '/includes/Admin.php';
        $source = (string) file_get_contents($adminFile);

        $this->assertStringContainsString("\\update_option('fgpx_arrows_enabled', isset(\\$_POST['fgpx_arrows_enabled']) ? '1' : '0', true);", $source);
        $this->assertStringContainsString("\\update_option('fgpx_arrows_km', (string) max(0.5, min(100, (float) \\$_POST['fgpx_arrows_km'])), true);", $source);
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
}
