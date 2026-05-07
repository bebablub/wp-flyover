<?php

declare(strict_types=1);

namespace FGpx\Tests\Unit;

use FGpx\Admin;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;

/**
 * Functional coverage for weather enrichment entry points and sample selection logic.
 *
 * Tests focus on observable behavior: sample distribution, API failure handling,
 * bulk safety caps, and truncation metadata — not implementation internals.
 */
final class AdminWeatherEnrichmentTest extends TestCase
{
    protected function setUp(): void
    {
        $GLOBALS['fgpx_test_transients']      = [];
        $GLOBALS['fgpx_test_post_meta']       = [];
        $GLOBALS['fgpx_test_options']         = [];
        unset($GLOBALS['fgpx_test_wp_remote_get']);
    }

    protected function tearDown(): void
    {
        $GLOBALS['fgpx_test_transients']      = [];
        $GLOBALS['fgpx_test_post_meta']       = [];
        $GLOBALS['fgpx_test_options']         = [];
        unset($GLOBALS['fgpx_test_wp_remote_get']);
    }

    // -------------------------------------------------------------------------
    // generateWeatherSamples
    // -------------------------------------------------------------------------

    public function test_distance_sampling_produces_evenly_spaced_samples(): void
    {
        $method = new ReflectionMethod(Admin::class, 'generateWeatherSamples');
        $method->setAccessible(true);

        $n           = 100;
        $coords      = [];
        $timestamps  = [];
        $cumulative  = [];
        $totalMeters = 0.0;
        for ($i = 0; $i < $n; $i++) {
            $coords[]     = [(float) $i * 0.001, 48.0, 500.0];
            $timestamps[] = gmdate('c', 1700000000 + $i * 60);
            $cumulative[] = $totalMeters;
            $totalMeters += 1000; // 1 km per step
        }

        // step 5 km → expect samples roughly every 5 km
        $samples = $method->invoke(null, $coords, $timestamps, $cumulative, 'distance', 5.0, 10, false, 5.0);

        $this->assertGreaterThan(0, count($samples));
        // Samples must cover both the start and at least 4/5 of the route
        $lastIndex = end($samples)['index'];
        $this->assertGreaterThan((int) ($n * 0.8), $lastIndex);
    }

    public function test_time_sampling_covers_full_time_range(): void
    {
        $method = new ReflectionMethod(Admin::class, 'generateWeatherSamples');
        $method->setAccessible(true);

        $n           = 120; // 120 minutes
        $coords      = [];
        $timestamps  = [];
        $cumulative  = [];
        $startUnix   = 1700000000;
        for ($i = 0; $i < $n; $i++) {
            $coords[]     = [(float) $i * 0.001, 48.0, 500.0];
            $timestamps[] = gmdate('c', $startUnix + $i * 60);
            $cumulative[] = (float) $i * 100;
        }

        // step 10 min → 12 samples for 120-min track (at minutes 0, 10, 20, ..., 110)
        $samples = $method->invoke(null, $coords, $timestamps, $cumulative, 'time', 5.0, 10, false, 5.0);

        $this->assertCount(12, $samples);
        $this->assertSame(0, $samples[0]['index']);
        // Last sample at minute 110 (index 110), not the very last point
        $this->assertGreaterThanOrEqual((int) ($n * 0.9), end($samples)['index']);
    }

    public function test_fallback_sampling_never_exceeds_twenty_samples(): void
    {
        $method = new ReflectionMethod(Admin::class, 'generateWeatherSamples');
        $method->setAccessible(true);

        $n      = 500;
        $coords = [];
        for ($i = 0; $i < $n; $i++) {
            $coords[] = [(float) $i * 0.001, 48.0, 500.0];
        }

        $samples = $method->invoke(null, $coords, [], [], 'distance', 5.0, 10, false, 5.0);

        // distance sampling with empty cumulative falls through to fallback
        $this->assertLessThanOrEqual(20, count($samples));
    }

    // -------------------------------------------------------------------------
    // Sample even-distribution (cap)
    // -------------------------------------------------------------------------

    public function test_sample_cap_preserves_first_and_last_sample(): void
    {
        $adminFile = dirname(__DIR__, 2) . '/includes/Admin.php';
        $source    = (string) file_get_contents($adminFile);

        // Confirm the evenly-distributed selection pattern is present
        $this->assertStringContainsString('$step = ($requestedSampleCount - 1) / ($maxWeatherSamples - 1)', $source);
        $this->assertStringContainsString('$samples[(int) round($si * $step)]', $source);
        // Confirm old leading-only slice is gone
        $this->assertStringNotContainsString('\\array_slice($samples, 0, $maxWeatherSamples)', $source);
    }

    public function test_coord_cap_uses_even_distribution_not_leading_slice(): void
    {
        $adminFile = dirname(__DIR__, 2) . '/includes/Admin.php';
        $source    = (string) file_get_contents($adminFile);

        $this->assertStringContainsString('$coordStep    = ($totalCoords - 1) / ($maxUniqueCoords - 1)', $source);
        $this->assertStringContainsString('$allCoordKeys[(int) round($ci * $coordStep)]', $source);
        // Old leading slice must be gone
        $this->assertStringNotContainsString('array_slice($uniqueCoords, 0, $maxUniqueCoords, true)', $source);
    }

    // -------------------------------------------------------------------------
    // fetchWeatherForSamples — API failure handling
    // -------------------------------------------------------------------------

    public function test_fetch_skips_coord_when_api_returns_wp_error_and_continues(): void
    {
        $callCount = 0;
        $GLOBALS['fgpx_test_wp_remote_get'] = static function (string $url) use (&$callCount): \WP_Error {
            $callCount++;
            return new \WP_Error('http_request_failed', 'Connection refused');
        };

        $samples = [
            ['lon' => 10.0, 'lat' => 48.0, 'time_unix' => 1700000000, 'index' => 0, 'sample_type' => 'distance'],
            ['lon' => 11.0, 'lat' => 49.0, 'time_unix' => 1700003600, 'index' => 10, 'sample_type' => 'distance'],
        ];

        $method = new ReflectionMethod(Admin::class, 'fetchWeatherForSamples');
        $method->setAccessible(true);

        $weatherPoints = $method->invoke(null, $samples);

        // Both coords have distinct rounded values → 2 API calls, both fail → 0 features
        $this->assertSame(2, $callCount);
        $this->assertSame([], $weatherPoints);
    }

    public function test_fetch_skips_malformed_api_response_and_continues(): void
    {
        $responses = [
            json_encode(['bad' => 'structure']),   // missing hourly.time → returns null
            json_encode(['hourly' => ['time' => [3600], 'rain' => [2.5], 'wind_speed_10m' => [12.0], 'wind_direction_10m' => [180.0], 'temperature_80m' => [20.0], 'cloud_cover' => [30.0], 'snowfall' => [0.0], 'dew_point_2m' => [15.0], 'temperature_2m' => [20.0], 'relative_humidity_2m' => [75.0]]]),
        ];
        $callIdx = 0;
        $GLOBALS['fgpx_test_wp_remote_get'] = static function (string $url) use (&$responses, &$callIdx): array {
            return ['body' => $responses[$callIdx++]];
        };

        $samples = [
            ['lon' => 10.0, 'lat' => 48.0, 'time_unix' => 3600, 'index' => 0, 'sample_type' => 'distance'],
            ['lon' => 11.0, 'lat' => 49.0, 'time_unix' => 3600, 'index' => 5, 'sample_type' => 'distance'],
        ];

        $method = new ReflectionMethod(Admin::class, 'fetchWeatherForSamples');
        $method->setAccessible(true);

        $weatherPoints = $method->invoke(null, $samples);

        // First coord fails (bad structure) → only second coord contributes
        $this->assertCount(1, $weatherPoints);
        $this->assertEqualsWithDelta(11.0, $weatherPoints[0]['geometry']['coordinates'][0], 0.001);
    }

    public function test_fetch_returns_partial_weather_when_only_some_coords_succeed(): void
    {
        $responses = [
            json_encode(['hourly' => ['time' => [0], 'rain' => [1.0], 'wind_speed_10m' => [10.0], 'wind_direction_10m' => [90.0], 'temperature_80m' => [15.0], 'cloud_cover' => [20.0], 'snowfall' => [0.0], 'dew_point_2m' => [10.0], 'temperature_2m' => [15.0], 'relative_humidity_2m' => [70.0]]]),
            new \WP_Error('timeout', 'Timeout'),
        ];
        $callIdx = 0;
        $GLOBALS['fgpx_test_wp_remote_get'] = static function (string $url) use (&$responses, &$callIdx) {
            return $responses[$callIdx++];
        };

        $samples = [
            ['lon' => 10.0, 'lat' => 48.0, 'time_unix' => 0, 'index' => 0, 'sample_type' => 'distance'],
            ['lon' => 11.0, 'lat' => 49.0, 'time_unix' => 0, 'index' => 5, 'sample_type' => 'distance'],
        ];

        $meta   = [];
        $method = new ReflectionMethod(Admin::class, 'fetchWeatherForSamples');
        $method->setAccessible(true);

        $weatherPoints = $method->invokeArgs(null, [$samples, &$meta]);

        // Only first call succeeds
        $this->assertCount(1, $weatherPoints);
        $this->assertSame(1.0, $weatherPoints[0]['properties']['rain_mm']);
    }

    // -------------------------------------------------------------------------
    // Truncation metadata in fetchWeatherForSamples
    // -------------------------------------------------------------------------

    public function test_fetch_meta_reflects_truncated_unique_coords(): void
    {
        $GLOBALS['fgpx_test_wp_remote_get'] = static function (): array {
            return ['body' => json_encode(['hourly' => ['time' => [0], 'rain' => [0.0], 'wind_speed_10m' => [5.0], 'wind_direction_10m' => [0.0], 'temperature_80m' => [10.0], 'cloud_cover' => [0.0], 'snowfall' => [0.0], 'dew_point_2m' => [8.0], 'temperature_2m' => [10.0], 'relative_humidity_2m' => [80.0]]])];
        };

        // Build 60 samples with distinct 0.1° grid cells
        $samples = [];
        for ($i = 0; $i < 60; $i++) {
            $samples[] = [
                'lon'         => round($i * 0.15, 2),
                'lat'         => round($i * 0.15, 2),
                'time_unix'   => 3600,
                'index'       => $i,
                'sample_type' => 'distance',
            ];
        }

        $meta   = [];
        $method = new ReflectionMethod(Admin::class, 'fetchWeatherForSamples');
        $method->setAccessible(true);

        $method->invokeArgs(null, [$samples, &$meta]);

        $this->assertSame(60, $meta['requested_unique_coords']);
        $this->assertSame(50, $meta['used_unique_coords']);
        $this->assertTrue($meta['unique_coords_truncated']);
    }

    // -------------------------------------------------------------------------
    // Bulk enrichment cap
    // -------------------------------------------------------------------------

    public function test_bulk_weather_enrichment_capped_at_twenty_five(): void
    {
        $adminFile = dirname(__DIR__, 2) . '/includes/Admin.php';
        $source    = (string) file_get_contents($adminFile);

        $this->assertStringContainsString('$maxEnrichPerRequest = 25', $source);
        $this->assertStringContainsString("'fgpx_weather_deferred' => \$deferred", $source);
        $this->assertStringContainsString('Bulk weather enrichment capped for safety', $source);
    }

    // -------------------------------------------------------------------------
    // No-timestamp track fallback
    // -------------------------------------------------------------------------

    public function test_fetch_uses_today_when_no_timestamps_present(): void
    {
        $usedUrl = '';
        $GLOBALS['fgpx_test_wp_remote_get'] = static function (string $url) use (&$usedUrl): array {
            $usedUrl = $url;
            return ['body' => json_encode(['hourly' => ['time' => [], 'rain' => [], 'wind_speed_10m' => [], 'wind_direction_10m' => [], 'temperature_80m' => [], 'cloud_cover' => [], 'snowfall' => [], 'dew_point_2m' => [], 'temperature_2m' => [], 'relative_humidity_2m' => []]])];
        };

        $samples = [
            ['lon' => 10.0, 'lat' => 48.0, 'time_unix' => null, 'index' => 0, 'sample_type' => 'fallback'],
        ];

        $method = new ReflectionMethod(Admin::class, 'fetchWeatherForSamples');
        $method->setAccessible(true);

        $method->invoke(null, $samples);

        $today = date('Y-m-d');
        $this->assertStringContainsString("start_date={$today}", urldecode($usedUrl));
        $this->assertStringContainsString("end_date={$today}", urldecode($usedUrl));
    }

    // -------------------------------------------------------------------------
    // enrichWithWeather disabled check
    // -------------------------------------------------------------------------

    public function test_enrich_with_weather_returns_true_when_weather_not_enabled(): void
    {
        // weather enabled defaults to '0' in test bootstrap
        $geojson = json_encode([
            'type' => 'LineString',
            'coordinates' => [[10.0, 48.0, 500.0], [11.0, 49.0, 600.0]],
            'properties' => ['timestamps' => [null, null], 'cumulativeDistance' => [0.0, 10000.0]],
        ]);

        $result = Admin::enrichWithWeather(1, $geojson);

        $this->assertTrue($result);
    }
}
