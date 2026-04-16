<?php

declare(strict_types=1);

namespace FGpx\Tests\Unit;

use FGpx\Admin;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;

final class AdminWeatherWindTest extends TestCase
{
    protected function setUp(): void
    {
        $GLOBALS['fgpx_test_transients'] = [];
        unset($GLOBALS['fgpx_test_wp_remote_get']);
    }

    protected function tearDown(): void
    {
        $GLOBALS['fgpx_test_transients'] = [];
        unset($GLOBALS['fgpx_test_wp_remote_get']);
    }

    public function test_wind_interpolation_prefers_reasonable_time_over_stale_exact_location(): void
    {
        $method = new ReflectionMethod(Admin::class, 'interpolateWindValueForPoint');
        $method->setAccessible(true);

        $weatherFeatures = [
            [
                'geometry' => ['coordinates' => [0.0, 0.0]],
                'properties' => [
                    'time_unix' => 3600,
                    'wind_speed_kmh' => 11.0,
                ],
            ],
            [
                'geometry' => ['coordinates' => [0.09, 0.0]],
                'properties' => [
                    'time_unix' => 86400,
                    'wind_speed_kmh' => 22.0,
                ],
            ],
        ];

        $result = $method->invoke(null, $weatherFeatures, 0.0, 0.0, 86400, 'wind_speed_kmh');

        $this->assertSame(22.0, $result);
    }

    public function test_wind_interpolation_prefers_nearest_location_when_time_matches(): void
    {
        $method = new ReflectionMethod(Admin::class, 'interpolateWindValueForPoint');
        $method->setAccessible(true);

        $weatherFeatures = [
            [
                'geometry' => ['coordinates' => [0.01, 0.0]],
                'properties' => [
                    'time_unix' => 3600,
                    'wind_direction_deg' => 90.0,
                ],
            ],
            [
                'geometry' => ['coordinates' => [0.45, 0.0]],
                'properties' => [
                    'time_unix' => 3600,
                    'wind_direction_deg' => 270.0,
                ],
            ],
        ];

        $result = $method->invoke(null, $weatherFeatures, 0.0, 0.0, 3600, 'wind_direction_deg');

        $this->assertSame(90.0, $result);
    }

    public function test_wind_interpolation_returns_null_when_no_valid_feature_exists(): void
    {
        $method = new ReflectionMethod(Admin::class, 'interpolateWindValueForPoint');
        $method->setAccessible(true);

        $weatherFeatures = [
            [
                'geometry' => ['coordinates' => [0.01, 0.0]],
                'properties' => [
                    'time_unix' => 3600,
                    'wind_speed_kmh' => null,
                ],
            ],
            [
                'geometry' => [],
                'properties' => [
                    'time_unix' => 3600,
                ],
            ],
        ];

        $result = $method->invoke(null, $weatherFeatures, 0.0, 0.0, 3600, 'wind_speed_kmh');

        $this->assertNull($result);
    }

    public function test_weather_fetch_limits_unique_coordinate_buckets_to_fifty(): void
    {
        $remoteCalls = [];
        $GLOBALS['fgpx_test_wp_remote_get'] = static function (string $url) use (&$remoteCalls): array {
            $remoteCalls[] = $url;

            return [
                'body' => json_encode([
                    'hourly' => [
                        'time' => [3600],
                        'rain' => [0.0],
                        'wind_speed_10m' => [12.0],
                        'wind_direction_10m' => [180.0],
                        'temperature_80m' => [20.0],
                        'cloud_cover' => [0.0],
                        'snowfall' => [0.0],
                        'dew_point_2m' => [18.0],
                        'temperature_2m' => [19.0],
                        'relative_humidity_2m' => [95.0],
                    ],
                ]),
            ];
        };

        $samples = [];
        for ($index = 0; $index < 60; $index++) {
            $samples[] = [
                'lon' => round($index * 0.11, 2),
                'lat' => round($index * 0.11, 2),
                'time_unix' => 3600,
                'index' => $index,
                'sample_type' => 'distance',
            ];
        }

        $method = new ReflectionMethod(Admin::class, 'fetchWeatherForSamples');
        $method->setAccessible(true);

        $weatherPoints = $method->invoke(null, $samples);

        $this->assertCount(50, $remoteCalls);
        $this->assertCount(50, $weatherPoints);
    }
}