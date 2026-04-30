<?php

declare(strict_types=1);

namespace FGpx\Tests\Unit;

use FGpx\Rest;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;

final class GallerySourcePostMetadataTest extends TestCase
{
    protected function setUp(): void
    {
        $GLOBALS['fgpx_test_posts'] = [];
        unset($GLOBALS['fgpx_test_wpdb_get_results']);
        unset($GLOBALS['fgpx_test_post_types']);
    }

    protected function tearDown(): void
    {
        unset($GLOBALS['fgpx_test_posts'], $GLOBALS['fgpx_test_wpdb_get_results'], $GLOBALS['fgpx_test_post_types']);
    }

    public function test_find_latest_embedding_post_id_selects_first_matching_row_from_db_result_order(): void
    {
        $GLOBALS['fgpx_test_wpdb_get_results'] = static function (): array {
            return [
                (object) ['ID' => 30, 'post_content' => '[flyover_gpx id="999"]'],
                (object) ['ID' => 40, 'post_content' => '[flyover_gpx id="321"]'],
                (object) ['ID' => 50, 'post_content' => '[flyover_gpx id="321"]'],
            ];
        };

        $method = new ReflectionMethod(Rest::class, 'find_latest_embedding_post_id');
        $method->setAccessible(true);

        $result = $method->invoke(new Rest(), 321);

        $this->assertSame(40, $result);
    }

    public function test_find_latest_embedding_post_id_returns_zero_when_no_embedding_matches_track(): void
    {
        $GLOBALS['fgpx_test_wpdb_get_results'] = static function (): array {
            return [
                (object) ['ID' => 71, 'post_content' => '[flyover_gpx id="1"]'],
                (object) ['ID' => 72, 'post_content' => '[flyover_gpx id="2"]'],
            ];
        };

        $method = new ReflectionMethod(Rest::class, 'find_latest_embedding_post_id');
        $method->setAccessible(true);

        $result = $method->invoke(new Rest(), 321);

        $this->assertSame(0, $result);
    }

    public function test_find_latest_embedding_post_id_prefers_post_with_photo_candidates_when_available(): void
    {
        $GLOBALS['fgpx_test_wpdb_get_results'] = static function (): array {
            return [
                (object) ['ID' => 80, 'post_content' => '[flyover_gpx id="321"]'],
                (object) ['ID' => 81, 'post_content' => '[flyover_gpx id="321"] <img src="https://example.test/uploads/pic.jpg" />'],
                (object) ['ID' => 82, 'post_content' => '[flyover_gpx id="999"] <img src="https://example.test/uploads/other.jpg" />'],
            ];
        };

        $method = new ReflectionMethod(Rest::class, 'find_latest_embedding_post_id');
        $method->setAccessible(true);

        $result = $method->invoke(new Rest(), 321);

        $this->assertSame(81, $result);
    }

    public function test_get_preview_reference_post_types_filters_out_track_and_attachment_types(): void
    {
        $GLOBALS['fgpx_test_post_types'] = ['post', 'page', 'custom', 'fgpx_track', 'attachment', 'custom'];

        $method = new ReflectionMethod(Rest::class, 'get_preview_reference_post_types');
        $method->setAccessible(true);

        $result = $method->invoke(new Rest());

        $this->assertContains('post', $result);
        $this->assertContains('page', $result);
        $this->assertContains('custom', $result);
        $this->assertNotContains('fgpx_track', $result);
        $this->assertNotContains('attachment', $result);
    }
}
