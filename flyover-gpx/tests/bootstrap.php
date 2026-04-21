<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/vendor/autoload.php';

/**
 * PHPUnit bootstrap — provides a minimal WordPress-like environment so that
 * plugin classes can be loaded and exercised without a running WordPress instance.
 *
 * Only stubs the subset of WordPress functions actually called by the classes
 * under test.  If you add tests that exercise additional WP functions, stub them
 * here so the suite stays self-contained.
 */

// --------------------------------------------------------------------------
// WordPress core constants required by every plugin file
// --------------------------------------------------------------------------
if (!defined('ABSPATH')) {
    define('ABSPATH', sys_get_temp_dir() . '/');
}

// --------------------------------------------------------------------------
// WordPress function stubs
// --------------------------------------------------------------------------

if (!function_exists('get_option')) {
    /**
     * Returns the supplied $default, simulating an empty WordPress options table.
     * Tests that need specific stored values should call Options::clearCache() in
     * their setUp() and override this stub (or use a partial mock).
     *
     * @param string $option
     * @param mixed  $default
     * @return mixed
     */
    function get_option(string $option, $default = false)
    {
        return $default;
    }
}

if (!class_exists('WP_Error')) {
    class WP_Error
    {
        private string $code;
        private string $message;

        public function __construct(string $code = '', string $message = '')
        {
            $this->code = $code;
            $this->message = $message;
        }

        public function get_error_code(): string
        {
            return $this->code;
        }

        public function get_error_message(): string
        {
            return $this->message;
        }
    }
}

if (!class_exists('FGPX_Test_Ajax_Response')) {
    class FGPX_Test_Ajax_Response extends \RuntimeException
    {
        public bool $success;
        /** @var mixed */
        public $data;
        public int $status;

        /** @param mixed $data */
        public function __construct(bool $success, $data, int $status = 200)
        {
            parent::__construct('FGPX AJAX response');
            $this->success = $success;
            $this->data = $data;
            $this->status = $status;
        }
    }
}

if (!class_exists('WP_Post')) {
    class WP_Post
    {
        public int $ID = 0;
        public string $post_type = '';
        public string $post_status = 'publish';
        public string $post_content = '';
        public string $post_date_gmt = '';
        public string $post_modified_gmt = '';
        public string $post_mime_type = '';

        public function __construct(array $data = [])
        {
            foreach ($data as $key => $value) {
                if (property_exists($this, (string) $key)) {
                    $this->{$key} = $value;
                }
            }
        }
    }
}

if (!function_exists('is_wp_error')) {
    function is_wp_error($thing): bool
    {
        return $thing instanceof WP_Error;
    }
}

if (!function_exists('sanitize_key')) {
    function sanitize_key(string $key): string
    {
        return strtolower((string) preg_replace('/[^a-z0-9_\-]/', '', $key));
    }
}

if (!function_exists('esc_url_raw')) {
    function esc_url_raw(string $url): string
    {
        return $url;
    }
}

if (!function_exists('wp_verify_nonce')) {
    function wp_verify_nonce(string $nonce, string $action): bool
    {
        if (isset($GLOBALS['fgpx_test_wp_verify_nonce']) && is_callable($GLOBALS['fgpx_test_wp_verify_nonce'])) {
            return (bool) $GLOBALS['fgpx_test_wp_verify_nonce']($nonce, $action);
        }

        return true;
    }
}

if (!function_exists('current_user_can')) {
    function current_user_can(string $capability, ...$args): bool
    {
        if (isset($GLOBALS['fgpx_test_current_user_can']) && is_callable($GLOBALS['fgpx_test_current_user_can'])) {
            return (bool) $GLOBALS['fgpx_test_current_user_can']($capability, ...$args);
        }

        return true;
    }
}

if (!function_exists('wp_send_json_error')) {
    function wp_send_json_error($data = null, int $status_code = 200): void
    {
        throw new FGPX_Test_Ajax_Response(false, $data, $status_code);
    }
}

if (!function_exists('wp_send_json_success')) {
    function wp_send_json_success($data = null, int $status_code = 200): void
    {
        throw new FGPX_Test_Ajax_Response(true, $data, $status_code);
    }
}

if (!function_exists('get_transient')) {
    function get_transient(string $key)
    {
        return $GLOBALS['fgpx_test_transients'][$key] ?? false;
    }
}

if (!function_exists('set_transient')) {
    function set_transient(string $key, $value, int $expiration = 0): bool
    {
        $GLOBALS['fgpx_test_transients'][$key] = $value;
        return true;
    }
}

if (!function_exists('delete_transient')) {
    function delete_transient(string $key): bool
    {
        unset($GLOBALS['fgpx_test_transients'][$key]);
        return true;
    }
}

if (!function_exists('wp_remote_get')) {
    function wp_remote_get(string $url, array $args = [])
    {
        if (isset($GLOBALS['fgpx_test_wp_remote_get']) && is_callable($GLOBALS['fgpx_test_wp_remote_get'])) {
            return $GLOBALS['fgpx_test_wp_remote_get']($url, $args);
        }

        return [
            'body' => json_encode([
                'hourly' => [
                    'time' => [3600],
                    'rain' => [0.0],
                    'wind_speed_10m' => [10.0],
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
    }
}

if (!function_exists('wp_remote_retrieve_body')) {
    function wp_remote_retrieve_body($response): string
    {
        return is_array($response) && isset($response['body']) ? (string) $response['body'] : '';
    }
}

if (!defined('HOUR_IN_SECONDS')) {
    define('HOUR_IN_SECONDS', 3600);
}

if (!defined('MINUTE_IN_SECONDS')) {
    define('MINUTE_IN_SECONDS', 60);
}

if (!function_exists('maybe_unserialize')) {
    function maybe_unserialize($value)
    {
        if (!is_string($value)) {
            return $value;
        }

        $trimmed = trim($value);
        if ($trimmed === '') {
            return $value;
        }

        if (preg_match('/^(a|O|s|i|d|b):/', $trimmed) === 1) {
            $out = @unserialize($trimmed);
            if ($out !== false || $trimmed === 'b:0;') {
                return $out;
            }
        }

        return $value;
    }
}

if (!function_exists('maybe_serialize')) {
    function maybe_serialize($value): string
    {
        if (is_array($value) || is_object($value)) {
            return serialize($value);
        }

        return (string) $value;
    }
}

if (!function_exists('wp_cache_delete')) {
    function wp_cache_delete($key, string $group = ''): bool
    {
        return true;
    }
}

if (!function_exists('get_post_meta')) {
    function get_post_meta(int $postId, string $metaKey, bool $single = false)
    {
        $value = $GLOBALS['fgpx_test_post_meta'][$postId][$metaKey] ?? '';
        if ($single) {
            return $value;
        }

        return [$value];
    }
}

if (!function_exists('update_post_meta')) {
    function update_post_meta(int $postId, string $metaKey, $metaValue): bool
    {
        if (!isset($GLOBALS['fgpx_test_post_meta'][$postId]) || !is_array($GLOBALS['fgpx_test_post_meta'][$postId])) {
            $GLOBALS['fgpx_test_post_meta'][$postId] = [];
        }

        $GLOBALS['fgpx_test_post_meta'][$postId][$metaKey] = $metaValue;
        return true;
    }
}

if (!function_exists('delete_post_meta')) {
    function delete_post_meta(int $postId, string $metaKey): bool
    {
        if (isset($GLOBALS['fgpx_test_post_meta'][$postId]) && is_array($GLOBALS['fgpx_test_post_meta'][$postId])) {
            unset($GLOBALS['fgpx_test_post_meta'][$postId][$metaKey]);
        }

        return true;
    }
}

if (!function_exists('get_post')) {
    function get_post(int $postId)
    {
        if (!isset($GLOBALS['fgpx_test_posts'][$postId])) {
            return null;
        }

        $post = $GLOBALS['fgpx_test_posts'][$postId];
        if ($post instanceof WP_Post) {
            return $post;
        }

        if (is_array($post)) {
            $post['ID'] = (int) ($post['ID'] ?? $postId);
            return new WP_Post($post);
        }

        return null;
    }
}

if (!function_exists('get_post_thumbnail_id')) {
    function get_post_thumbnail_id(int $postId): int
    {
        return (int) ($GLOBALS['fgpx_test_post_thumbnails'][$postId] ?? 0);
    }
}

if (!function_exists('wp_get_attachment_image_url')) {
    function wp_get_attachment_image_url(int $attachmentId, string $size = 'full')
    {
        return $GLOBALS['fgpx_test_attachment_urls'][$attachmentId] ?? '';
    }
}

if (!function_exists('wp_get_attachment_url')) {
    function wp_get_attachment_url(int $attachmentId)
    {
        return $GLOBALS['fgpx_test_attachment_urls'][$attachmentId] ?? '';
    }
}

if (!function_exists('wp_upload_bits')) {
    function wp_upload_bits(string $name, $deprecated, string $bits): array
    {
        $baseDir = $GLOBALS['fgpx_test_upload_dir'] ?? (sys_get_temp_dir() . '/fgpx-test-uploads');
        if (!is_dir($baseDir)) {
            @mkdir($baseDir, 0777, true);
        }

        $target = rtrim($baseDir, '/\\') . '/' . $name;
        $written = @file_put_contents($target, $bits);
        if ($written === false) {
            return [
                'file' => '',
                'url' => '',
                'error' => 'Failed to write upload bits',
            ];
        }

        return [
            'file' => $target,
            'url' => 'https://example.test/uploads/' . rawurlencode($name),
            'error' => '',
        ];
    }
}

if (!function_exists('wp_check_filetype')) {
    function wp_check_filetype(string $filename, $mimes = null): array
    {
        $ext = strtolower((string) pathinfo($filename, PATHINFO_EXTENSION));
        if ($ext === 'jpg' || $ext === 'jpeg') {
            return ['ext' => $ext, 'type' => 'image/jpeg'];
        }

        if ($ext === 'png') {
            return ['ext' => $ext, 'type' => 'image/png'];
        }

        return ['ext' => $ext, 'type' => 'application/octet-stream'];
    }
}

if (!function_exists('wp_insert_attachment')) {
    function wp_insert_attachment(array $attachment, string $filePath, int $postId = 0)
    {
        $nextId = (int) ($GLOBALS['fgpx_test_next_attachment_id'] ?? 3000);
        $nextId += 1;
        $GLOBALS['fgpx_test_next_attachment_id'] = $nextId;

        $postMimeType = isset($attachment['post_mime_type']) ? (string) $attachment['post_mime_type'] : '';
        $GLOBALS['fgpx_test_posts'][$nextId] = new WP_Post([
            'ID' => $nextId,
            'post_type' => 'attachment',
            'post_status' => 'inherit',
            'post_mime_type' => $postMimeType,
        ]);

        if (!isset($GLOBALS['fgpx_test_attachment_urls'][$nextId])) {
            $GLOBALS['fgpx_test_attachment_urls'][$nextId] = 'https://example.test/uploads/' . rawurlencode((string) basename($filePath));
        }

        return $nextId;
    }
}

if (!function_exists('wp_generate_attachment_metadata')) {
    function wp_generate_attachment_metadata(int $attachmentId, string $filePath): array
    {
        return [];
    }
}

if (!function_exists('wp_update_attachment_metadata')) {
    function wp_update_attachment_metadata(int $attachmentId, array $metadata): bool
    {
        return true;
    }
}

if (!function_exists('wp_delete_attachment')) {
    function wp_delete_attachment(int $attachmentId, bool $forceDelete = false): bool
    {
        unset($GLOBALS['fgpx_test_posts'][$attachmentId]);
        unset($GLOBALS['fgpx_test_attachment_urls'][$attachmentId]);
        return true;
    }
}

if (!function_exists('wp_is_post_revision')) {
    function wp_is_post_revision(int $postId): int
    {
        return (int) ($GLOBALS['fgpx_test_post_revisions'][$postId] ?? 0);
    }
}

if (!function_exists('get_post_types')) {
    function get_post_types(array $args = [], string $output = 'names')
    {
        return $GLOBALS['fgpx_test_post_types'] ?? ['post', 'page', 'fgpx_track', 'attachment'];
    }
}

if (!function_exists('get_the_title')) {
    function get_the_title(int $postId): string
    {
        return (string) ($GLOBALS['fgpx_test_titles'][$postId] ?? '');
    }
}

if (!function_exists('get_post_time')) {
    function get_post_time(string $format = 'U', bool $gmt = true, int $postId = 0)
    {
        return (int) ($GLOBALS['fgpx_test_post_times'][$postId] ?? 0);
    }
}

if (!function_exists('get_the_date')) {
    function get_the_date(string $format = '', int $postId = 0): string
    {
        return (string) ($GLOBALS['fgpx_test_dates'][$postId] ?? '');
    }
}

if (!class_exists('WP_Query')) {
    class WP_Query
    {
        /** @var array<int> */
        public array $posts = [];

        public function __construct(array $args = [])
        {
            $this->posts = array_map('intval', $GLOBALS['fgpx_test_wp_query_posts'] ?? []);
        }
    }
}

if (!isset($GLOBALS['wpdb'])) {
    $GLOBALS['wpdb'] = new class {
        public string $postmeta = 'wp_postmeta';
        public string $posts = 'wp_posts';

        public function prepare(string $query, ...$args): string
        {
            if (count($args) === 1 && is_string($args[0])) {
                return $query . '|meta_key=' . $args[0];
            }

            return $query;
        }

        /** @return array<int, object> */
        public function get_results(string $query): array
        {
            if (isset($GLOBALS['fgpx_test_wpdb_get_results']) && is_callable($GLOBALS['fgpx_test_wpdb_get_results'])) {
                return (array) $GLOBALS['fgpx_test_wpdb_get_results']($query);
            }

            // Detect post-content shortcode lookup used by find_latest_embedding_post_id.
            if (strpos($query, 'post_content') !== false && strpos($query, 'flyover_gpx') !== false) {
                $rows = [];
                foreach ($GLOBALS['fgpx_test_posts'] ?? [] as $id => $data) {
                    $postStatus = is_array($data) ? (string) ($data['post_status'] ?? '') : (string) ($data->post_status ?? '');
                    $postType   = is_array($data) ? (string) ($data['post_type']   ?? '') : (string) ($data->post_type   ?? '');
                    $content    = is_array($data) ? (string) ($data['post_content'] ?? '') : (string) ($data->post_content ?? '');
                    if ($postStatus === 'publish' && $postType !== 'fgpx_track' && $postType !== 'attachment' && strpos($content, '[flyover_gpx') !== false) {
                        $rows[] = (object) ['ID' => (int) $id, 'post_content' => $content];
                    }
                }
                return $rows;
            }

            $metaKey = '';
            if (preg_match('/\|meta_key=([^\s]+)/', $query, $matches) === 1) {
                $metaKey = (string) $matches[1];
            }

            $ids = [];
            if (preg_match('/IN\s*\(([^\)]+)\)/', $query, $matches) === 1) {
                $ids = array_map('intval', array_map('trim', explode(',', (string) $matches[1])));
            }

            $rows = [];
            foreach ($ids as $id) {
                if (!isset($GLOBALS['fgpx_test_post_meta'][$id][$metaKey])) {
                    continue;
                }

                $rows[] = (object) [
                    'post_id' => $id,
                    'meta_value' => $GLOBALS['fgpx_test_post_meta'][$id][$metaKey],
                ];
            }

            return $rows;
        }

        public function query(string $query)
        {
            return true;
        }
    };
}
