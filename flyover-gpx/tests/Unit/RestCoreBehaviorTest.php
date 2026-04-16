<?php

declare(strict_types=1);

namespace FGpx\Tests\Unit;

use FGpx\Rest;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;

final class RestCoreBehaviorTest extends TestCase
{
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
