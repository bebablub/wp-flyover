<?php

declare(strict_types=1);

namespace FGpx\Tests\Unit;

use FGpx\Admin;
use FGPX_Test_Ajax_Response;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;

final class AdminPreviewResolutionTest extends TestCase
{
    protected function setUp(): void
    {
        $GLOBALS['fgpx_test_post_meta'] = [];
        $GLOBALS['fgpx_test_posts'] = [];
        $GLOBALS['fgpx_test_post_thumbnails'] = [];
        $GLOBALS['fgpx_test_attachment_urls'] = [];
        $GLOBALS['fgpx_test_post_revisions'] = [];
        $GLOBALS['fgpx_test_post_types'] = ['post', 'page', 'fgpx_track', 'attachment'];
        $GLOBALS['fgpx_test_wp_verify_nonce'] = null;
        $GLOBALS['fgpx_test_current_user_can'] = null;
        $GLOBALS['fgpx_test_next_attachment_id'] = 3000;
        unset($GLOBALS['fgpx_test_wpdb_get_results']);
        $_POST = [];
    }

    protected function tearDown(): void
    {
        $GLOBALS['fgpx_test_post_meta'] = [];
        $GLOBALS['fgpx_test_posts'] = [];
        $GLOBALS['fgpx_test_post_thumbnails'] = [];
        $GLOBALS['fgpx_test_attachment_urls'] = [];
        $GLOBALS['fgpx_test_post_revisions'] = [];
        $GLOBALS['fgpx_test_post_types'] = ['post', 'page', 'fgpx_track', 'attachment'];
        $GLOBALS['fgpx_test_wp_verify_nonce'] = null;
        $GLOBALS['fgpx_test_current_user_can'] = null;
        $GLOBALS['fgpx_test_next_attachment_id'] = 3000;
        unset($GLOBALS['fgpx_test_wpdb_get_results']);
        $_POST = [];
    }

    public function test_extract_track_ids_from_content_handles_variants(): void
    {
        $admin = new Admin();

        $method = new ReflectionMethod(Admin::class, 'extract_track_ids_from_content');
        $method->setAccessible(true);

        $content = implode("\n", [
            '[flyover_gpx id="42"]',
            '[flyover_gpx id=43 height="60vh"]',
            "[flyover_gpx id='44' style='vector']",
            '[flyover_gpx style="raster"]',
            '[flyover_gpx id="42" zoom="12"]',
        ]);

        $result = $method->invoke($admin, $content);

        $this->assertSame([42, 43, 44], $result);
    }

    public function test_find_latest_embedding_post_id_returns_first_matching_row(): void
    {
        $admin = new Admin();

        $GLOBALS['fgpx_test_wpdb_get_results'] = static function (): array {
            return [
                (object) ['ID' => 91, 'post_content' => '[flyover_gpx id="77"]'],
                (object) ['ID' => 90, 'post_content' => '[flyover_gpx id="77"]'],
            ];
        };

        $method = new ReflectionMethod(Admin::class, 'find_latest_embedding_post_id');
        $method->setAccessible(true);

        $result = $method->invoke($admin, 77);

        $this->assertSame(91, $result);
    }

    public function test_resolve_track_preview_auto_prefers_latest_embedding_featured_image(): void
    {
        $admin = new Admin();

        $trackId = 501;
        $GLOBALS['fgpx_test_posts'][$trackId] = [
            'ID' => $trackId,
            'post_type' => 'fgpx_track',
            'post_status' => 'publish',
        ];

        $GLOBALS['fgpx_test_post_meta'][$trackId] = [
            'fgpx_preview_mode' => 'auto',
            'fgpx_preview_map_attachment_id' => 333,
        ];

        $GLOBALS['fgpx_test_wpdb_get_results'] = static function (): array {
            return [
                (object) ['ID' => 901, 'post_content' => '[flyover_gpx id="501"]'],
            ];
        };

        $GLOBALS['fgpx_test_post_thumbnails'][901] = 888;

        $method = new ReflectionMethod(Admin::class, 'resolve_track_preview');
        $method->setAccessible(true);
        $method->invoke($admin, $trackId);

        $this->assertSame(888, (int) ($GLOBALS['fgpx_test_post_meta'][$trackId]['fgpx_preview_attachment_id'] ?? 0));
        $this->assertSame('post_featured', (string) ($GLOBALS['fgpx_test_post_meta'][$trackId]['fgpx_preview_source'] ?? ''));
    }

    public function test_resolve_track_preview_auto_falls_back_to_map_snapshot(): void
    {
        $admin = new Admin();

        $trackId = 502;
        $GLOBALS['fgpx_test_posts'][$trackId] = [
            'ID' => $trackId,
            'post_type' => 'fgpx_track',
            'post_status' => 'publish',
        ];

        $GLOBALS['fgpx_test_post_meta'][$trackId] = [
            'fgpx_preview_mode' => 'auto',
            'fgpx_preview_map_attachment_id' => 444,
        ];

        $GLOBALS['fgpx_test_wpdb_get_results'] = static function (): array {
            return [];
        };

        $method = new ReflectionMethod(Admin::class, 'resolve_track_preview');
        $method->setAccessible(true);
        $method->invoke($admin, $trackId);

        $this->assertSame(444, (int) ($GLOBALS['fgpx_test_post_meta'][$trackId]['fgpx_preview_attachment_id'] ?? 0));
        $this->assertSame('map_snapshot', (string) ($GLOBALS['fgpx_test_post_meta'][$trackId]['fgpx_preview_source'] ?? ''));
    }

    public function test_resolve_track_preview_custom_mode_uses_custom_attachment(): void
    {
        $admin = new Admin();

        $trackId = 503;
        $GLOBALS['fgpx_test_posts'][$trackId] = [
            'ID' => $trackId,
            'post_type' => 'fgpx_track',
            'post_status' => 'publish',
        ];

        $GLOBALS['fgpx_test_post_meta'][$trackId] = [
            'fgpx_preview_mode' => 'custom',
            'fgpx_preview_custom_attachment_id' => 990,
        ];

        $method = new ReflectionMethod(Admin::class, 'resolve_track_preview');
        $method->setAccessible(true);
        $method->invoke($admin, $trackId);

        $this->assertSame(990, (int) ($GLOBALS['fgpx_test_post_meta'][$trackId]['fgpx_preview_attachment_id'] ?? 0));
        $this->assertSame('custom', (string) ($GLOBALS['fgpx_test_post_meta'][$trackId]['fgpx_preview_source'] ?? ''));
    }

    public function test_resolve_track_preview_none_mode_clears_attachment_and_sets_none_source(): void
    {
        $admin = new Admin();

        $trackId = 504;
        $GLOBALS['fgpx_test_posts'][$trackId] = [
            'ID' => $trackId,
            'post_type' => 'fgpx_track',
            'post_status' => 'publish',
        ];

        $GLOBALS['fgpx_test_post_meta'][$trackId] = [
            'fgpx_preview_mode' => 'none',
            'fgpx_preview_attachment_id' => 200,
            'fgpx_preview_source' => 'post_featured',
        ];

        $method = new ReflectionMethod(Admin::class, 'resolve_track_preview');
        $method->setAccessible(true);
        $method->invoke($admin, $trackId);

        $this->assertArrayNotHasKey('fgpx_preview_attachment_id', $GLOBALS['fgpx_test_post_meta'][$trackId]);
        $this->assertSame('none', (string) ($GLOBALS['fgpx_test_post_meta'][$trackId]['fgpx_preview_source'] ?? ''));
    }

    public function test_resolve_track_preview_post_featured_mode_clears_stale_active_preview_when_no_reference_exists(): void
    {
        $admin = new Admin();

        $trackId = 505;
        $GLOBALS['fgpx_test_posts'][$trackId] = [
            'ID' => $trackId,
            'post_type' => 'fgpx_track',
            'post_status' => 'publish',
        ];

        $GLOBALS['fgpx_test_post_meta'][$trackId] = [
            'fgpx_preview_mode' => 'post_featured',
            'fgpx_preview_attachment_id' => 321,
            'fgpx_preview_source' => 'post_featured',
        ];

        $GLOBALS['fgpx_test_wpdb_get_results'] = static function (): array {
            return [];
        };

        $method = new ReflectionMethod(Admin::class, 'resolve_track_preview');
        $method->setAccessible(true);
        $method->invoke($admin, $trackId);

        $this->assertArrayNotHasKey('fgpx_preview_attachment_id', $GLOBALS['fgpx_test_post_meta'][$trackId]);
        $this->assertArrayNotHasKey('fgpx_preview_source', $GLOBALS['fgpx_test_post_meta'][$trackId]);
    }

    public function test_thumbnail_meta_change_resolves_tracks_referenced_by_that_post(): void
    {
        $admin = new Admin();

        $trackId = 506;
        $postId = 902;

        $GLOBALS['fgpx_test_posts'][$trackId] = [
            'ID' => $trackId,
            'post_type' => 'fgpx_track',
            'post_status' => 'publish',
        ];
        $GLOBALS['fgpx_test_posts'][$postId] = [
            'ID' => $postId,
            'post_type' => 'post',
            'post_status' => 'publish',
            'post_content' => '[flyover_gpx id="506"]',
        ];

        $GLOBALS['fgpx_test_post_meta'][$trackId] = [
            'fgpx_preview_mode' => 'auto',
        ];
        $GLOBALS['fgpx_test_post_thumbnails'][$postId] = 777;

        $handler = new ReflectionMethod(Admin::class, 'sync_track_preview_references_on_thumbnail_meta_change');
        $handler->setAccessible(true);
        $handler->invoke($admin, 1, $postId, '_thumbnail_id', 777);

        $this->assertSame(777, (int) ($GLOBALS['fgpx_test_post_meta'][$trackId]['fgpx_preview_attachment_id'] ?? 0));
        $this->assertSame('post_featured', (string) ($GLOBALS['fgpx_test_post_meta'][$trackId]['fgpx_preview_source'] ?? ''));
    }

    public function test_resolve_track_preview_map_snapshot_mode_clears_stale_active_preview_when_map_snapshot_missing(): void
    {
        $admin = new Admin();

        $trackId = 509;
        $GLOBALS['fgpx_test_posts'][$trackId] = [
            'ID' => $trackId,
            'post_type' => 'fgpx_track',
            'post_status' => 'publish',
        ];

        $GLOBALS['fgpx_test_post_meta'][$trackId] = [
            'fgpx_preview_mode' => 'map_snapshot',
            'fgpx_preview_attachment_id' => 612,
            'fgpx_preview_source' => 'post_featured',
        ];

        $method = new ReflectionMethod(Admin::class, 'resolve_track_preview');
        $method->setAccessible(true);
        $method->invoke($admin, $trackId);

        $this->assertArrayNotHasKey('fgpx_preview_attachment_id', $GLOBALS['fgpx_test_post_meta'][$trackId]);
        $this->assertArrayNotHasKey('fgpx_preview_source', $GLOBALS['fgpx_test_post_meta'][$trackId]);
    }

    public function test_thumbnail_meta_change_accepts_deleted_post_meta_argument_shape(): void
    {
        $admin = new Admin();

        $trackId = 510;
        $postId = 903;

        $GLOBALS['fgpx_test_posts'][$trackId] = [
            'ID' => $trackId,
            'post_type' => 'fgpx_track',
            'post_status' => 'publish',
        ];
        $GLOBALS['fgpx_test_posts'][$postId] = [
            'ID' => $postId,
            'post_type' => 'post',
            'post_status' => 'publish',
            'post_content' => '[flyover_gpx id="510"]',
        ];
        $GLOBALS['fgpx_test_post_meta'][$trackId] = [
            'fgpx_preview_mode' => 'auto',
        ];
        $GLOBALS['fgpx_test_post_thumbnails'][$postId] = 889;

        $handler = new ReflectionMethod(Admin::class, 'sync_track_preview_references_on_thumbnail_meta_change');
        $handler->setAccessible(true);
        $handler->invoke($admin, [11], $postId, '_thumbnail_id', '');

        $this->assertSame(889, (int) ($GLOBALS['fgpx_test_post_meta'][$trackId]['fgpx_preview_attachment_id'] ?? 0));
        $this->assertSame('post_featured', (string) ($GLOBALS['fgpx_test_post_meta'][$trackId]['fgpx_preview_source'] ?? ''));
    }

    public function test_ajax_save_preview_mode_custom_accepts_valid_image_attachment(): void
    {
        $admin = new Admin();

        $trackId = 507;
        $attachmentId = 2001;

        $GLOBALS['fgpx_test_posts'][$trackId] = [
            'ID' => $trackId,
            'post_type' => 'fgpx_track',
            'post_status' => 'publish',
        ];
        $GLOBALS['fgpx_test_posts'][$attachmentId] = [
            'ID' => $attachmentId,
            'post_type' => 'attachment',
            'post_status' => 'inherit',
            'post_mime_type' => 'image/jpeg',
        ];
        $GLOBALS['fgpx_test_attachment_urls'][$attachmentId] = 'https://example.test/custom.jpg';

        $_POST = [
            'post_id' => (string) $trackId,
            'nonce' => 'ok',
            'mode' => 'custom',
            'custom_attachment_id' => (string) $attachmentId,
        ];

        try {
            $admin->ajax_save_preview_mode();
            $this->fail('Expected AJAX response exception');
        } catch (FGPX_Test_Ajax_Response $response) {
            $this->assertTrue($response->success);
            $this->assertSame('custom', (string) ($response->data['mode'] ?? ''));
            $this->assertSame('custom', (string) ($response->data['source'] ?? ''));
            $this->assertSame('https://example.test/custom.jpg', (string) ($response->data['previewUrl'] ?? ''));
        }
    }

    public function test_ajax_save_preview_mode_custom_rejects_non_image_attachment(): void
    {
        $admin = new Admin();

        $trackId = 508;
        $attachmentId = 2002;

        $GLOBALS['fgpx_test_posts'][$trackId] = [
            'ID' => $trackId,
            'post_type' => 'fgpx_track',
            'post_status' => 'publish',
        ];
        $GLOBALS['fgpx_test_posts'][$attachmentId] = [
            'ID' => $attachmentId,
            'post_type' => 'attachment',
            'post_status' => 'inherit',
            'post_mime_type' => 'application/pdf',
        ];

        $_POST = [
            'post_id' => (string) $trackId,
            'nonce' => 'ok',
            'mode' => 'custom',
            'custom_attachment_id' => (string) $attachmentId,
        ];

        try {
            $admin->ajax_save_preview_mode();
            $this->fail('Expected AJAX response exception');
        } catch (FGPX_Test_Ajax_Response $response) {
            $this->assertFalse($response->success);
            $this->assertSame(400, $response->status);
            $this->assertStringContainsString('valid image', (string) ($response->data['message'] ?? ''));
        }
    }

    public function test_ajax_generate_preview_returns_none_source_and_empty_preview_url_when_mode_is_none(): void
    {
        $admin = new Admin();

        $trackId = 511;
        $GLOBALS['fgpx_test_posts'][$trackId] = [
            'ID' => $trackId,
            'post_type' => 'fgpx_track',
            'post_status' => 'publish',
        ];
        $GLOBALS['fgpx_test_post_meta'][$trackId] = [
            'fgpx_preview_mode' => 'none',
        ];

        $_POST = [
            'post_id' => (string) $trackId,
            'nonce' => 'ok',
            'source' => 'map_snapshot',
            'image_data' => 'data:image/png;base64,' . base64_encode('unit-test-image'),
        ];

        try {
            $admin->ajax_generate_preview();
            $this->fail('Expected AJAX response exception');
        } catch (FGPX_Test_Ajax_Response $response) {
            $this->assertTrue($response->success);
            $this->assertSame('none', (string) ($response->data['source'] ?? ''));
            $this->assertSame('', (string) ($response->data['previewUrl'] ?? ''));
        }
    }

    public function test_ajax_generate_preview_returns_post_featured_source_and_url_when_mode_is_post_featured(): void
    {
        $admin = new Admin();

        $trackId = 512;
        $embeddingPostId = 904;
        $featuredAttachmentId = 2201;

        $GLOBALS['fgpx_test_posts'][$trackId] = [
            'ID' => $trackId,
            'post_type' => 'fgpx_track',
            'post_status' => 'publish',
        ];
        $GLOBALS['fgpx_test_posts'][$embeddingPostId] = [
            'ID' => $embeddingPostId,
            'post_type' => 'post',
            'post_status' => 'publish',
            'post_content' => '[flyover_gpx id="512"]',
        ];
        $GLOBALS['fgpx_test_post_meta'][$trackId] = [
            'fgpx_preview_mode' => 'post_featured',
        ];
        $GLOBALS['fgpx_test_post_thumbnails'][$embeddingPostId] = $featuredAttachmentId;
        $GLOBALS['fgpx_test_attachment_urls'][$featuredAttachmentId] = 'https://example.test/featured.jpg';
        $GLOBALS['fgpx_test_wpdb_get_results'] = static function (): array {
            return [
                (object) ['ID' => 904, 'post_content' => '[flyover_gpx id="512"]'],
            ];
        };

        $_POST = [
            'post_id' => (string) $trackId,
            'nonce' => 'ok',
            'source' => 'map_snapshot',
            'image_data' => 'data:image/png;base64,' . base64_encode('unit-test-image'),
        ];

        try {
            $admin->ajax_generate_preview();
            $this->fail('Expected AJAX response exception');
        } catch (FGPX_Test_Ajax_Response $response) {
            $this->assertTrue($response->success);
            $this->assertSame('post_featured', (string) ($response->data['source'] ?? ''));
            $this->assertSame('https://example.test/featured.jpg', (string) ($response->data['previewUrl'] ?? ''));
        }
    }

    public function test_ajax_generate_preview_returns_custom_source_and_url_when_mode_is_custom(): void
    {
        $admin = new Admin();

        $trackId = 513;
        $customAttachmentId = 2301;

        $GLOBALS['fgpx_test_posts'][$trackId] = [
            'ID' => $trackId,
            'post_type' => 'fgpx_track',
            'post_status' => 'publish',
        ];
        $GLOBALS['fgpx_test_post_meta'][$trackId] = [
            'fgpx_preview_mode' => 'custom',
            'fgpx_preview_custom_attachment_id' => $customAttachmentId,
        ];
        $GLOBALS['fgpx_test_posts'][$customAttachmentId] = [
            'ID' => $customAttachmentId,
            'post_type' => 'attachment',
            'post_status' => 'inherit',
            'post_mime_type' => 'image/jpeg',
        ];
        $GLOBALS['fgpx_test_attachment_urls'][$customAttachmentId] = 'https://example.test/custom-active.jpg';

        $_POST = [
            'post_id' => (string) $trackId,
            'nonce' => 'ok',
            'source' => 'map_snapshot',
            'image_data' => 'data:image/png;base64,' . base64_encode('unit-test-image'),
        ];

        try {
            $admin->ajax_generate_preview();
            $this->fail('Expected AJAX response exception');
        } catch (FGPX_Test_Ajax_Response $response) {
            $this->assertTrue($response->success);
            $this->assertSame('custom', (string) ($response->data['source'] ?? ''));
            $this->assertSame('https://example.test/custom-active.jpg', (string) ($response->data['previewUrl'] ?? ''));
        }
    }
}
