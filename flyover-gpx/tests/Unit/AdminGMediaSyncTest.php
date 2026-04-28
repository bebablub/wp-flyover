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

use FGpx\Admin;
use FGPX_Test_Ajax_Response;
use PHPUnit\Framework\TestCase;

final class AdminGMediaSyncTest extends TestCase
{
    /** @var mixed */
    private $previousWpdb;

    protected function setUp(): void
    {
        $this->previousWpdb = $GLOBALS['wpdb'] ?? null;

        $GLOBALS['fgpx_test_posts'] = [];
        $GLOBALS['fgpx_test_post_meta'] = [];
        $GLOBALS['fgpx_test_attachment_urls'] = [];
        $GLOBALS['fgpx_test_transients'] = [];
        $GLOBALS['fgpx_test_wp_verify_nonce'] = null;
        $GLOBALS['fgpx_test_current_user_can'] = null;
        $GLOBALS['gmDB'] = new \GmediaDB();
        $_POST = [];
    }

    protected function tearDown(): void
    {
        $GLOBALS['wpdb'] = $this->previousWpdb;

        unset($GLOBALS['gmDB']);
        unset($GLOBALS['fgpx_test_posts']);
        unset($GLOBALS['fgpx_test_post_meta']);
        unset($GLOBALS['fgpx_test_attachment_urls']);
        unset($GLOBALS['fgpx_test_transients']);
        unset($GLOBALS['fgpx_test_wp_verify_nonce']);
        unset($GLOBALS['fgpx_test_current_user_can']);

        $_POST = [];
    }

    public function test_ajax_sync_gmedia_caption_rejects_invalid_nonce(): void
    {
        $admin = new Admin();

        $GLOBALS['fgpx_test_wp_verify_nonce'] = static function (): bool {
            return false;
        };

        $_POST = [
            'nonce' => 'invalid',
            'overwrite' => '1',
        ];

        try {
            $admin->ajax_sync_gmedia_caption();
            $this->fail('Expected AJAX response exception');
        } catch (FGPX_Test_Ajax_Response $response) {
            $this->assertFalse($response->success);
            $this->assertSame(403, $response->status);
            $this->assertSame('Security check failed', (string) ($response->data['message'] ?? ''));
        }
    }

    public function test_ajax_sync_gmedia_caption_rejects_missing_capability(): void
    {
        $admin = new Admin();

        $GLOBALS['fgpx_test_wp_verify_nonce'] = static function (): bool {
            return true;
        };
        $GLOBALS['fgpx_test_current_user_can'] = static function (): bool {
            return false;
        };

        $_POST = [
            'nonce' => 'ok',
            'overwrite' => '1',
        ];

        try {
            $admin->ajax_sync_gmedia_caption();
            $this->fail('Expected AJAX response exception');
        } catch (FGPX_Test_Ajax_Response $response) {
            $this->assertFalse($response->success);
            $this->assertSame(403, $response->status);
            $this->assertSame('Insufficient permissions', (string) ($response->data['message'] ?? ''));
        }
    }

    public function test_ajax_sync_gmedia_caption_returns_unavailable_when_gmedia_is_not_ready(): void
    {
        $admin = new Admin();

        $GLOBALS['fgpx_test_wp_verify_nonce'] = static function (): bool {
            return true;
        };
        $GLOBALS['fgpx_test_current_user_can'] = static function (): bool {
            return true;
        };

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

        $_POST = [
            'nonce' => 'ok',
            'overwrite' => '1',
        ];

        try {
            $admin->ajax_sync_gmedia_caption();
            $this->fail('Expected AJAX response exception');
        } catch (FGPX_Test_Ajax_Response $response) {
            $this->assertFalse($response->success);
            $this->assertSame(400, $response->status);
            $this->assertSame('Grand Media global runtime is not initialized.', (string) ($response->data['message'] ?? ''));
            $this->assertIsArray($response->data['result'] ?? null);
            $this->assertFalse((bool) (($response->data['result']['available'] ?? true)));
        }
    }

    public function test_ajax_sync_gmedia_caption_returns_success_payload_when_sync_updates_rows(): void
    {
        $admin = new Admin();

        $GLOBALS['fgpx_test_wp_verify_nonce'] = static function (): bool {
            return true;
        };
        $GLOBALS['fgpx_test_current_user_can'] = static function (): bool {
            return true;
        };

        $wpdb = $this->buildSuccessfulSyncWpdb();
        $wpdb->gmediaRows = [
            (object) ['ID' => 7, 'gmuid' => 'photo.jpg', 'title' => 'Synced title', 'modified' => '2026-01-01 10:00:00'],
        ];
        $wpdb->attachmentIds = [321];
        $wpdb->trackIds = [99];

        $GLOBALS['fgpx_test_posts'][321] = [
            'ID' => 321,
            'post_type' => 'attachment',
            'post_status' => 'inherit',
            'post_mime_type' => 'image/jpeg',
            'post_excerpt' => '',
        ];
        $GLOBALS['fgpx_test_post_meta'][321]['_wp_attached_file'] = '2026/04/photo.jpg';

        $GLOBALS['fgpx_test_posts'][99] = [
            'ID' => 99,
            'post_type' => 'fgpx_track',
            'post_status' => 'publish',
            'post_modified_gmt' => '2026-04-20 10:00:00',
        ];

        $_POST = [
            'nonce' => 'ok',
            'overwrite' => '1',
        ];

        try {
            $admin->ajax_sync_gmedia_caption();
            $this->fail('Expected AJAX response exception');
        } catch (FGPX_Test_Ajax_Response $response) {
            $this->assertTrue($response->success);
            $this->assertSame(200, $response->status);
            $this->assertSame('Synced title', (string) \wp_get_attachment_caption(321));
            $this->assertIsArray($response->data['result'] ?? null);
            $this->assertSame(1, (int) ($response->data['result']['updated'] ?? 0));
            $this->assertSame(1, (int) ($response->data['result']['matched'] ?? 0));
        }
    }

    /**
     * @return object
     */
    private function buildSuccessfulSyncWpdb()
    {
        $GLOBALS['wpdb'] = new class {
            public string $prefix = 'wp_';
            public string $posts = 'wp_posts';
            /** @var array<int,object> */
            public array $gmediaRows = [];
            /** @var array<int,int> */
            public array $attachmentIds = [];
            /** @var array<int,int> */
            public array $trackIds = [];

            public function prepare(string $query, ...$args): string
            {
                if (strpos($query, 'SHOW TABLES LIKE') !== false) {
                    return 'SHOW_TABLES';
                }

                if (strpos($query, 'SELECT ID FROM') !== false && isset($args[0])) {
                    return $query . '|post_type=' . (string) $args[0];
                }

                if (!empty($args)) {
                    $flat = array_map('strval', $args);
                    return $query . '|args=' . implode(',', $flat);
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

                if (strpos($query, '|post_type=fgpx_track') !== false) {
                    return $this->trackIds;
                }

                return [];
            }

            public function esc_like(string $value): string
            {
                return $value;
            }

            public function query(string $query)
            {
                return true;
            }
        };

        return $GLOBALS['wpdb'];
    }
}
