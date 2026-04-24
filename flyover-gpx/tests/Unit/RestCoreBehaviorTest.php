<?php

declare(strict_types=1);

namespace FGpx\Tests\Unit;

use FGpx\Rest;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;

final class RestCoreBehaviorTest extends TestCase
{
    public function test_rest_route_uses_explicit_track_permission_callback(): void
    {
        $restFile = dirname(__DIR__, 2) . '/includes/Rest.php';
        $source = (string) file_get_contents($restFile);

        $this->assertStringContainsString("'permission_callback' => [\$this, 'can_read_track']", $source);
        $this->assertStringNotContainsString("'permission_callback' => '__return_true'", $source);
        $this->assertStringContainsString('public function can_read_track(WP_REST_Request $request): bool', $source);
    }

    public function test_download_handler_reads_nonce_from_request_payload(): void
    {
        $restFile = dirname(__DIR__, 2) . '/includes/Rest.php';
        $source = (string) file_get_contents($restFile);

        $this->assertStringContainsString("\$id    = (int) (\$_REQUEST['id'] ?? 0);", $source);
        $this->assertStringContainsString("\$nonce = (string) (\$_REQUEST['nonce'] ?? '');", $source);
    }

    public function test_plugin_localizes_download_nonce_without_nonce_query_parameter(): void
    {
        $pluginFile = dirname(__DIR__, 2) . '/includes/Plugin.php';
        $source = (string) file_get_contents($pluginFile);

        $this->assertStringContainsString("'gpxDownloadNonce' => \$gpxDownloadNonce", $source);
        $this->assertStringNotContainsString('&nonce=', $source);
    }

    public function test_waypoints_are_exposed_in_both_rest_and_ajax_response_payloads(): void
    {
        $restFile = dirname(__DIR__, 2) . '/includes/Rest.php';
        $source = (string) file_get_contents($restFile);

        $this->assertSame(2, substr_count($source, "'waypoints' => $waypoints"));
        $this->assertStringContainsString("$waypointsRaw = \\get_post_meta($id, 'fgpx_waypoints', true);", $source);
    }

    public function test_admin_upload_path_clears_stale_waypoints_when_no_waypoints_exist(): void
    {
        $adminFile = dirname(__DIR__, 2) . '/includes/Admin.php';
        $source = (string) file_get_contents($adminFile);

        $this->assertStringContainsString("\\delete_post_meta($postId, 'fgpx_waypoints');", $source);
    }

    public function test_weather_json_decode_errors_are_guarded_in_rest_and_ajax_paths(): void
    {
        $restFile = dirname(__DIR__, 2) . '/includes/Rest.php';
        $source = (string) file_get_contents($restFile);

        $this->assertStringContainsString('JSON decode error for weather points in REST endpoint', $source);
        $this->assertStringContainsString('JSON decode error for weather summary in REST endpoint', $source);
        $this->assertStringContainsString('JSON decode error for weather points in AJAX endpoint', $source);
        $this->assertStringContainsString('JSON decode error for weather summary in AJAX endpoint', $source);
    }

    public function test_corrupted_geojson_returns_explicit_server_errors_in_rest_and_ajax(): void
    {
        $restFile = dirname(__DIR__, 2) . '/includes/Rest.php';
        $source = (string) file_get_contents($restFile);

        $this->assertStringContainsString('Corrupted track geometry in REST endpoint', $source);
        $this->assertStringContainsString('Corrupted track geometry in AJAX endpoint', $source);
        $this->assertStringContainsString("'code' => 'fgpx_corrupt_geojson'", $source);
        $this->assertStringContainsString('Please re-import this GPX track in the plugin admin.', $source);
    }

    public function test_calculate_optimal_target_respects_safety_bounds_for_small_tracks(): void
    {
        $method = new ReflectionMethod(Rest::class, 'calculateOptimalTarget');
        $method->setAccessible(true);

        $result = $method->invoke(null, 120, 50);

        $this->assertSame(300, $result);
    }

    public function test_calculate_optimal_target_scales_for_large_tracks(): void
    {
        $method = new ReflectionMethod(Rest::class, 'calculateOptimalTarget');
        $method->setAccessible(true);

        $result = $method->invoke(null, 60000, 1500);

        $this->assertGreaterThanOrEqual(1200, $result);
        $this->assertLessThanOrEqual(2500, $result);
    }

    public function test_ensure_power_data_estimates_when_real_power_is_missing(): void
    {
        $method = new ReflectionMethod(Rest::class, 'ensurePowerDataWithEstimate');
        $method->setAccessible(true);

        $geo = [
            'type' => 'LineString',
            'coordinates' => [
                [48.0, 16.0, 200.0],
                [48.0002, 16.0002, 210.0],
                [48.0004, 16.0004, 220.0],
            ],
            'properties' => [
                'timestamps' => [
                    '2024-01-01T10:00:00Z',
                    '2024-01-01T10:00:10Z',
                    '2024-01-01T10:00:20Z',
                ],
                'cumulativeDistance' => [0.0, 60.0, 120.0],
                'powers' => [0, 0, 0],
            ],
        ];

        $result = $method->invoke(null, $geo, 78.0);

        $this->assertTrue($result['estimatedPower']);
        $this->assertIsArray($result['geojson']);
        $this->assertArrayHasKey('properties', $result['geojson']);
        $this->assertArrayHasKey('powers', $result['geojson']['properties']);
        $this->assertCount(3, $result['geojson']['properties']['powers']);
        $this->assertGreaterThan(0.0, (float) $result['geojson']['properties']['powers'][1]);
    }

    public function test_ensure_power_data_preserves_real_power_values(): void
    {
        $method = new ReflectionMethod(Rest::class, 'ensurePowerDataWithEstimate');
        $method->setAccessible(true);

        $geo = [
            'type' => 'LineString',
            'coordinates' => [
                [48.0, 16.0, 200.0],
                [48.0002, 16.0002, 210.0],
            ],
            'properties' => [
                'timestamps' => ['2024-01-01T10:00:00Z', '2024-01-01T10:00:10Z'],
                'cumulativeDistance' => [0.0, 60.0],
                'powers' => [150.0, 170.0],
            ],
        ];

        $result = $method->invoke(null, $geo, 78.0);

        $this->assertFalse($result['estimatedPower']);
        $this->assertSame([150.0, 170.0], $result['geojson']['properties']['powers']);
    }

    public function test_dedupe_photos_by_location_keeps_only_first_photo_per_location_bucket(): void
    {
        $method = new ReflectionMethod(Rest::class, 'dedupe_photos_by_location');
        $method->setAccessible(true);

        $photos = [
            ['id' => 10, 'lat' => 48.123451, 'lon' => 16.987651, 'fullUrl' => 'a.jpg'],
            ['id' => 11, 'lat' => 48.123452, 'lon' => 16.987652, 'fullUrl' => 'b.jpg'],
            ['id' => 12, 'lat' => 48.2234, 'lon' => 16.8876, 'fullUrl' => 'c.jpg'],
            ['id' => 13, 'lat' => null, 'lon' => null, 'fullUrl' => 'd.jpg'],
        ];

        $result = $method->invoke(null, $photos);

        $this->assertCount(3, $result);
        $this->assertSame(10, $result[0]['id']);
        $this->assertSame(12, $result[1]['id']);
        $this->assertSame(13, $result[2]['id']);
    }

    public function test_compress_coordinates_preserves_shape_with_stable_precision(): void
    {
        $method = new ReflectionMethod(Rest::class, 'compressCoordinates');
        $method->setAccessible(true);

        $coords = [
            [48.123456, 16.987654, 100.1],
            [48.123468, 16.987631, 100.34],
            [48.123489, 16.987612, 100.55],
        ];

        $result = $method->invoke(null, $coords);

        $this->assertTrue($result['compressed']);
        $this->assertCount(3, $result['coordinates']);
        $this->assertSame($coords[0], $result['coordinates'][0]);
        $this->assertEqualsWithDelta(48.123466, $result['coordinates'][1][0], 0.000001);
        $this->assertEqualsWithDelta(16.987634, $result['coordinates'][1][1], 0.000001);
        $this->assertSame(100.3, $result['coordinates'][1][2]);
        $this->assertIsFloat($result['reduction']);
    }

    public function test_dp_simplification_with_target_two_keeps_only_track_endpoints(): void
    {
        $method = new ReflectionMethod(Rest::class, 'dp_choose_and_simplify');
        $method->setAccessible(true);

        $coords = [];
        for ($i = 0; $i < 25; $i++) {
            $coords[] = [(float) $i, sin((float) $i / 3.0)];
        }

        $result = $method->invoke(null, $coords, 2);

        $this->assertSame([0, 24], $result);
    }

    public function test_ensure_power_data_handles_missing_geojson_safely(): void
    {
        $method = new ReflectionMethod(Rest::class, 'ensurePowerDataWithEstimate');
        $method->setAccessible(true);

        $result = $method->invoke(null, null, 75.0);

        $this->assertFalse($result['estimatedPower']);
        $this->assertNull($result['geojson']);
    }
}
