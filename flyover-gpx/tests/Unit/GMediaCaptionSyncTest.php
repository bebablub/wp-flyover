<?php

declare(strict_types=1);

namespace {
    if (!class_exists('GmediaDB')) {
        class GmediaDB
        {
        }
    }
}

namespace FGpx\Tests\Unit {

use FGpx\GMediaCaptionSync;
use PHPUnit\Framework\TestCase;

final class GMediaCaptionSyncTest extends TestCase
{
    /** @var mixed */
    private $previousWpdb;

    protected function setUp(): void
    {
        $this->previousWpdb = $GLOBALS['wpdb'] ?? null;

        $GLOBALS['fgpx_test_posts'] = [];
        $GLOBALS['fgpx_test_post_meta'] = [];
        $GLOBALS['fgpx_test_attachment_urls'] = [];
        $GLOBALS['gmDB'] = new \GmediaDB();
    }

    protected function tearDown(): void
    {
        $GLOBALS['wpdb'] = $this->previousWpdb;
        unset($GLOBALS['gmDB']);
        unset($GLOBALS['fgpx_test_posts'], $GLOBALS['fgpx_test_post_meta'], $GLOBALS['fgpx_test_attachment_urls']);
    }

    public function test_detect_reports_unavailable_when_gmedia_runtime_missing(): void
    {
        unset($GLOBALS['gmDB']);

        $GLOBALS['wpdb'] = new class {
            public string $prefix = 'wp_';

            public function prepare(string $query, ...$args): string
            {
                return $query;
            }

            public function get_var(string $query): string
            {
                return 'wp_gmedia';
            }
        };

        $result = GMediaCaptionSync::detect();

        $this->assertFalse((bool) $result['active']);
        $this->assertSame('Grand Media global runtime is not initialized.', (string) $result['reason']);
    }

    public function test_sync_captions_uses_latest_duplicate_title_when_overwrite_enabled(): void
    {
        $wpdb = $this->buildSyncWpdb();

        $wpdb->gmediaRows = [
            (object) ['ID' => 21, 'gmuid' => 'photo.jpg', 'title' => 'Newest title', 'modified' => '2026-01-02 10:00:00'],
            (object) ['ID' => 11, 'gmuid' => 'photo.jpg', 'title' => 'Old title', 'modified' => '2025-12-01 10:00:00'],
        ];

        $wpdb->attachmentIds = [501];

        $GLOBALS['fgpx_test_posts'][501] = [
            'ID' => 501,
            'post_type' => 'attachment',
            'post_status' => 'inherit',
            'post_mime_type' => 'image/jpeg',
            'post_excerpt' => '',
        ];
        $GLOBALS['fgpx_test_post_meta'][501]['_wp_attached_file'] = '2026/04/photo.jpg';

        $result = GMediaCaptionSync::syncCaptions(true);

        $this->assertTrue((bool) $result['available']);
        $this->assertSame(1, (int) $result['matched']);
        $this->assertSame(1, (int) $result['updated']);
        $this->assertSame(1, (int) $result['duplicates']);
        $this->assertSame('Newest title', (string) \wp_get_attachment_caption(501));
    }

    public function test_sync_captions_skips_existing_caption_when_overwrite_disabled(): void
    {
        $wpdb = $this->buildSyncWpdb();

        $wpdb->gmediaRows = [
            (object) ['ID' => 44, 'gmuid' => 'sunset.jpg', 'title' => 'Replacement title', 'modified' => '2026-01-02 10:00:00'],
        ];

        $wpdb->attachmentIds = [777];

        $GLOBALS['fgpx_test_posts'][777] = [
            'ID' => 777,
            'post_type' => 'attachment',
            'post_status' => 'inherit',
            'post_mime_type' => 'image/jpeg',
            'post_excerpt' => 'Keep original caption',
        ];
        $GLOBALS['fgpx_test_post_meta'][777]['_wp_attached_file'] = '2026/04/sunset.jpg';

        $result = GMediaCaptionSync::syncCaptions(false);

        $this->assertTrue((bool) $result['available']);
        $this->assertSame(1, (int) $result['matched']);
        $this->assertSame(0, (int) $result['updated']);
        $this->assertSame(1, (int) $result['skipped_existing']);
        $this->assertSame('Keep original caption', (string) \wp_get_attachment_caption(777));
    }

    /**
     * @return object
     */
    private function buildSyncWpdb()
    {
        $GLOBALS['wpdb'] = new class {
            public string $prefix = 'wp_';
            public string $posts = 'wp_posts';
            /** @var array<int,object> */
            public array $gmediaRows = [];
            /** @var array<int,int> */
            public array $attachmentIds = [];

            public function prepare(string $query, ...$args): string
            {
                if (strpos($query, 'SHOW TABLES LIKE') !== false) {
                    return 'SHOW_TABLES';
                }

                return $query;
            }

            public function get_var(string $query): string
            {
                if ($query === 'SHOW_TABLES') {
                    return 'wp_gmedia';
                }

                return '';
            }

            /** @return array<int,object> */
            public function get_results(string $query): array
            {
                if (strpos($query, 'FROM wp_gmedia') !== false) {
                    return $this->gmediaRows;
                }

                return [];
            }

            /** @return array<int,int> */
            public function get_col(string $query): array
            {
                if (strpos($query, "post_type = 'attachment'") !== false) {
                    return $this->attachmentIds;
                }

                return [];
            }
        };

        return $GLOBALS['wpdb'];
    }
}
}
