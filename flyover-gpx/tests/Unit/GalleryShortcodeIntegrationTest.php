<?php

declare(strict_types=1);

namespace FGpx\Tests\Unit;

use FGpx\DatabaseOptimizer;
use FGpx\GalleryShortcode;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;

final class GalleryShortcodeIntegrationTest extends TestCase
{
    protected function setUp(): void
    {
        $GLOBALS['fgpx_test_wp_query_posts'] = [22, 11];

        $GLOBALS['fgpx_test_titles'] = [
            11 => 'Morning Alpine Ride',
            22 => 'City Tempo Session',
        ];

        $GLOBALS['fgpx_test_post_times'] = [
            11 => 1700000000,
            22 => 1710000000,
        ];

        $GLOBALS['fgpx_test_dates'] = [
            11 => '2024-01-10',
            22 => '2024-03-12',
        ];

        $GLOBALS['fgpx_test_post_meta'] = [
            11 => [
                'fgpx_stats' => serialize([
                    'total_distance_m' => 15321.4,
                    'moving_time_s' => 3725,
                    'elevation_gain_m' => 843,
                ]),
                'fgpx_total_distance_m' => '0',
                'fgpx_moving_time_s' => '0',
                'fgpx_elevation_gain_m' => '0',
                'fgpx_file_path' => '/not/readable.gpx',
                'fgpx_preview_attachment_id' => '0',
                'fgpx_preview_source' => '',
                'fgpx_preview_generated_at' => '',
            ],
            22 => [
                'fgpx_stats' => serialize([
                    'total_distance_m' => 9480,
                    'moving_time_s' => 2400,
                    'elevation_gain_m' => 110,
                ]),
                'fgpx_total_distance_m' => '0',
                'fgpx_moving_time_s' => '0',
                'fgpx_elevation_gain_m' => '0',
                'fgpx_file_path' => '/not/readable.gpx',
                'fgpx_preview_attachment_id' => '321',
                'fgpx_preview_source' => 'fallback_card',
                'fgpx_preview_generated_at' => '2026-04-17T10:00:00Z',
            ],
        ];

        $GLOBALS['fgpx_test_transients'] = [];
        DatabaseOptimizer::clearAllCache();
    }

    protected function tearDown(): void
    {
        DatabaseOptimizer::clearAllCache();

        unset($GLOBALS['fgpx_test_wp_query_posts']);
        unset($GLOBALS['fgpx_test_titles']);
        unset($GLOBALS['fgpx_test_post_times']);
        unset($GLOBALS['fgpx_test_dates']);
        unset($GLOBALS['fgpx_test_post_meta']);
        unset($GLOBALS['fgpx_test_transients']);
    }

    public function test_get_tracks_extracts_expected_metadata(): void
    {
        $method = new ReflectionMethod(GalleryShortcode::class, 'getTracks');
        $method->setAccessible(true);

        $tracks = $method->invoke(new GalleryShortcode(), [
            'fgpx_gpx_download_enabled' => '0',
        ]);

        $this->assertCount(2, $tracks);

        $this->assertSame(22, $tracks[0]['id']);
        $this->assertSame('City Tempo Session', $tracks[0]['title']);
        $this->assertSame(9.48, $tracks[0]['distanceKm']);
        $this->assertSame('40:00', $tracks[0]['durationLabel']);
        $this->assertSame(110, $tracks[0]['elevationGainM']);
        $this->assertSame('/not/readable.gpx', $tracks[0]['filePath']);
        $this->assertSame(321, $tracks[0]['previewAttachmentId']);
        $this->assertSame('fallback_card', $tracks[0]['previewSource']);
        $this->assertSame('2026-04-17T10:00:00Z', $tracks[0]['previewGeneratedAt']);

        $this->assertSame(11, $tracks[1]['id']);
        $this->assertSame('Morning Alpine Ride', $tracks[1]['title']);
        $this->assertSame(15.32, $tracks[1]['distanceKm']);
        $this->assertSame('1:02:05', $tracks[1]['durationLabel']);
        $this->assertSame(843, $tracks[1]['elevationGainM']);
        $this->assertSame('843', $tracks[1]['elevationGainLabel']);
        $this->assertSame(1700000000, $tracks[1]['dateTs']);
        $this->assertSame('2024-01-10', $tracks[1]['dateLabel']);
        $this->assertSame('/not/readable.gpx', $tracks[1]['filePath']);
        $this->assertSame(0, $tracks[1]['previewAttachmentId']);
        $this->assertSame('', $tracks[1]['previewSource']);
        $this->assertSame('', $tracks[1]['previewGeneratedAt']);
    }
}
