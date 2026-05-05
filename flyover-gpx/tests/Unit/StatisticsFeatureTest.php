<?php

declare(strict_types=1);

namespace FGpx\Tests\Unit;

use FGpx\DatabaseOptimizer;
use FGpx\Statistics;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;

final class StatisticsFeatureTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $GLOBALS['fgpx_test_wp_query_posts'] = [];
        $GLOBALS['fgpx_test_post_meta'] = [];
        $GLOBALS['fgpx_test_post_times'] = [];
        $GLOBALS['fgpx_test_transients'] = [];
        $GLOBALS['fgpx_test_registered_styles'] = [];
        $GLOBALS['fgpx_test_registered_scripts'] = [];
        $GLOBALS['fgpx_test_enqueued_styles'] = [];
        $GLOBALS['fgpx_test_enqueued_scripts'] = [];
        $GLOBALS['fgpx_test_inline_scripts'] = [];

        DatabaseOptimizer::clearAllCache();
    }

    public function test_build_payload_derives_max_speed_from_legacy_geojson_without_speeds_array(): void
    {
        $trackId = 101;
        $GLOBALS['fgpx_test_wp_query_posts'] = [$trackId];
        $GLOBALS['fgpx_test_post_times'][$trackId] = strtotime('2025-01-15 12:00:00 UTC');

        $GLOBALS['fgpx_test_post_meta'][$trackId] = [
            'fgpx_stats' => [
                'total_distance_m' => 300.0,
                'moving_time_s' => 20.0,
                'elevation_gain_m' => 40.0,
            ],
            'fgpx_total_distance_m' => 300.0,
            'fgpx_moving_time_s' => 20.0,
            'fgpx_elevation_gain_m' => 40.0,
            'fgpx_geojson' => wp_json_encode([
                'type' => 'LineString',
                'coordinates' => [
                    [16.0, 48.0],
                    [16.001, 48.001],
                    [16.002, 48.002],
                ],
                'properties' => [
                    // Legacy/current persisted shape usually has timestamps + cumulativeDistance,
                    // but not explicit point speed arrays.
                    'timestamps' => [0, 10, 20],
                    'cumulativeDistance' => [0.0, 100.0, 300.0],
                ],
            ]),
        ];

        $statistics = new Statistics();
        $buildPayload = new ReflectionMethod(Statistics::class, 'build_payload');
        $buildPayload->setAccessible(true);

        $payload = $buildPayload->invoke($statistics, ['max_points' => 15000]);

        $this->assertSame(1, $payload['summary']['totalTracks']);
        // 200m over 10s = 20m/s = 72 km/h max speed.
        $this->assertSame(72.0, $payload['summary']['maxSpeedKmh']);
        $this->assertSame(54.0, $payload['summary']['avgSpeedKmh']);
        $this->assertGreaterThan(0, $payload['heatmap']['pointCount']);
    }

    public function test_build_payload_uses_highest_speed_across_mixed_speed_sources(): void
    {
        $trackA = 201;
        $trackB = 202;
        $GLOBALS['fgpx_test_wp_query_posts'] = [$trackA, $trackB];
        $GLOBALS['fgpx_test_post_times'][$trackA] = strtotime('2025-01-15 12:00:00 UTC');
        $GLOBALS['fgpx_test_post_times'][$trackB] = strtotime('2025-02-15 12:00:00 UTC');

        $GLOBALS['fgpx_test_post_meta'][$trackA] = [
            'fgpx_stats' => [
                'total_distance_m' => 1000.0,
                'moving_time_s' => 100.0,
                'elevation_gain_m' => 10.0,
            ],
            'fgpx_total_distance_m' => 1000.0,
            'fgpx_moving_time_s' => 100.0,
            'fgpx_elevation_gain_m' => 10.0,
            'fgpx_geojson' => wp_json_encode([
                'type' => 'LineString',
                'coordinates' => [[16.0, 48.0], [16.01, 48.01]],
                'properties' => [
                    'speeds' => [5.0, 10.0], // 36 km/h max on this track
                ],
            ]),
        ];

        $GLOBALS['fgpx_test_post_meta'][$trackB] = [
            'fgpx_stats' => [
                'total_distance_m' => 300.0,
                'moving_time_s' => 20.0,
                'elevation_gain_m' => 40.0,
            ],
            'fgpx_total_distance_m' => 300.0,
            'fgpx_moving_time_s' => 20.0,
            'fgpx_elevation_gain_m' => 40.0,
            'fgpx_geojson' => wp_json_encode([
                'type' => 'LineString',
                'coordinates' => [[16.1, 48.1], [16.11, 48.11], [16.12, 48.12]],
                'properties' => [
                    'timestamps' => [0, 10, 20],
                    'cumulativeDistance' => [0.0, 100.0, 300.0], // 72 km/h derived max
                ],
            ]),
        ];

        $statistics = new Statistics();
        $buildPayload = new ReflectionMethod(Statistics::class, 'build_payload');
        $buildPayload->setAccessible(true);

        $payload = $buildPayload->invoke($statistics, ['max_points' => 15000]);

        $this->assertSame(2, $payload['summary']['totalTracks']);
        $this->assertSame(72.0, $payload['summary']['maxSpeedKmh']);
    }

    public function test_shortcode_uses_rest_url_and_localizes_extended_strings(): void
    {
        $statistics = new Statistics();

        $html = $statistics->render_shortcode([
            'height' => '600px',
            'show_charts' => '1',
            'show_heatmap' => '1',
        ]);

        $this->assertStringContainsString('class="fgpx-stats-root"', $html);
        $this->assertStringContainsString('--fgpx-stats-height:600px', $html);

        $inline = $GLOBALS['fgpx_test_inline_scripts']['fgpx-stats'][0]['data'] ?? '';
        $this->assertIsString($inline);
        $this->assertStringContainsString('window.FGPXStatsInstances', $inline);
        $this->assertStringContainsString('wp-json\/fgpx\/v1\/stats\/aggregate', $inline);
        $this->assertStringContainsString('chartDistanceByMonth', $inline);
        $this->assertStringContainsString('chartTracksByMonth', $inline);
        $this->assertStringContainsString('noHeatmapData', $inline);
    }
}
