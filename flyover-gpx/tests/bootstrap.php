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

// Plugin constants normally defined in flyover-gpx.php runtime bootstrap.
// Unit tests load classes directly, so define test-safe values here.
if (!defined('FGPX_VERSION')) {
    define('FGPX_VERSION', '1.0.0-test');
}
if (!defined('FGPX_DIR_PATH')) {
    define('FGPX_DIR_PATH', dirname(__DIR__) . '/');
}
if (!defined('FGPX_DIR_URL')) {
    define('FGPX_DIR_URL', 'https://example.test/wp-content/plugins/flyover-gpx/');
}
if (!defined('FGPX_FILE')) {
    define('FGPX_FILE', dirname(__DIR__) . '/flyover-gpx.php');
}

// Some class files are namespaced (FGpx) and reference unqualified constants,
// so provide namespaced aliases as well for test runtime parity.
if (!defined('FGpx\\FGPX_VERSION')) {
    define('FGpx\\FGPX_VERSION', FGPX_VERSION);
}
if (!defined('FGpx\\FGPX_DIR_PATH')) {
    define('FGpx\\FGPX_DIR_PATH', FGPX_DIR_PATH);
}
if (!defined('FGpx\\FGPX_DIR_URL')) {
    define('FGpx\\FGPX_DIR_URL', FGPX_DIR_URL);
}
if (!defined('FGpx\\FGPX_FILE')) {
    define('FGpx\\FGPX_FILE', FGPX_FILE);
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

if (!function_exists('add_action')) {
    function add_action(string $hook, $callback, int $priority = 10, int $accepted_args = 1): bool
    {
        return true;
    }
}

if (!function_exists('add_filter')) {
    function add_filter(string $hook, $callback, int $priority = 10, int $accepted_args = 1): bool
    {
        return true;
    }
}

if (!function_exists('apply_filters')) {
    function apply_filters(string $hook, $value, ...$args)
    {
        return $value;
    }
}

if (!function_exists('add_shortcode')) {
    function add_shortcode(string $tag, $callback): bool
    {
        return true;
    }
}

if (!function_exists('register_post_type')) {
    function register_post_type(string $postType, array $args = []): array
    {
        return ['name' => $postType, 'args' => $args];
    }
}

if (!function_exists('register_rest_route')) {
    function register_rest_route(string $namespace, string $route, array $args = [], bool $override = false): bool
    {
        return true;
    }
}

if (!function_exists('is_admin')) {
    function is_admin(): bool
    {
        return false;
    }
}

if (!function_exists('wp_remote_head')) {
    function wp_remote_head(string $url, array $args = [])
    {
        // Mock successful HTTP HEAD response
        return [
            'headers' => ['content-type' => 'text/html'],
            'response' => ['code' => 200, 'message' => 'OK'],
        ];
    }
}

if (!function_exists('add_submenu_page')) {
    function add_submenu_page(
        string $parent_slug,
        string $page_title,
        string $menu_title,
        string $capability,
        string $menu_slug,
        $callback = null,
        ?int $position = null
    ): string {
        return $menu_slug;
    }
}

if (!function_exists('sanitize_key')) {
    function sanitize_key(string $key): string
    {
        return strtolower((string) preg_replace('/[^a-z0-9_\-]/', '', $key));
    }
}

if (!function_exists('shortcode_atts')) {
    /**
     * Minimal WordPress-compatible shortcode attributes merge for tests.
     *
     * @param array<string,mixed> $pairs
     * @param array<string,mixed> $atts
     * @param string $shortcode
     * @return array<string,mixed>
     */
    function shortcode_atts(array $pairs, array $atts, string $shortcode = ''): array
    {
        $atts = array_change_key_case($atts, CASE_LOWER);
        $out = [];
        foreach ($pairs as $name => $default) {
            $key = strtolower((string) $name);
            $out[$name] = array_key_exists($key, $atts) ? $atts[$key] : $default;
        }

        return $out;
    }
}

if (!function_exists('sanitize_text_field')) {
    /**
     * Minimal sanitize_text_field() behavior for unit tests.
     */
    function sanitize_text_field(string $str): string
    {
        // Strip tags and normalize control chars similarly to WordPress intent.
        $str = strip_tags($str);
        $str = preg_replace('/[\r\n\t\0\x0B]+/', ' ', $str);
        return trim((string) $str);
    }
}

if (!function_exists('esc_url_raw')) {
    function esc_url_raw(string $url): string
    {
        return $url;
    }
}

if (!function_exists('sanitize_hex_color')) {
    function sanitize_hex_color(string $color): ?string
    {
        $color = trim($color);
        if ($color === '') {
            return null;
        }
        if (preg_match('/^#([A-Fa-f0-9]{3}|[A-Fa-f0-9]{6})$/', $color) === 1) {
            return strtolower($color);
        }
        return null;
    }
}

if (!function_exists('plugin_dir_url')) {
    function plugin_dir_url(string $file): string
    {
        return 'https://example.test/wp-content/plugins/flyover-gpx/';
    }
}

if (!function_exists('wp_enqueue_style')) {
    function wp_enqueue_style(string $handle, string $src = '', array $deps = [], $ver = false, string $media = 'all'): bool
    {
        $GLOBALS['fgpx_test_enqueued_styles'][$handle] = [
            'src' => $src,
            'deps' => $deps,
            'ver' => $ver,
            'media' => $media,
        ];
        return true;
    }
}

if (!function_exists('wp_enqueue_script')) {
    function wp_enqueue_script(string $handle, string $src = '', array $deps = [], $ver = false, bool $in_footer = false): bool
    {
        $GLOBALS['fgpx_test_enqueued_scripts'][$handle] = [
            'src' => $src,
            'deps' => $deps,
            'ver' => $ver,
            'in_footer' => $in_footer,
        ];
        return true;
    }
}

if (!function_exists('wp_register_style')) {
    function wp_register_style(string $handle, string $src = '', array $deps = [], $ver = false, string $media = 'all'): bool
    {
        $GLOBALS['fgpx_test_registered_styles'][$handle] = [
            'src' => $src,
            'deps' => $deps,
            'ver' => $ver,
            'media' => $media,
        ];
        return true;
    }
}

if (!function_exists('wp_register_script')) {
    function wp_register_script(string $handle, string $src = '', array $deps = [], $ver = false, bool $in_footer = false): bool
    {
        $GLOBALS['fgpx_test_registered_scripts'][$handle] = [
            'src' => $src,
            'deps' => $deps,
            'ver' => $ver,
            'in_footer' => $in_footer,
        ];
        return true;
    }
}

if (!function_exists('wp_style_is')) {
    function wp_style_is(string $handle, string $status = 'enqueued'): bool
    {
        if ($status === 'registered') {
            return isset($GLOBALS['fgpx_test_registered_styles'][$handle]);
        }
        return isset($GLOBALS['fgpx_test_enqueued_styles'][$handle]);
    }
}

if (!function_exists('wp_script_is')) {
    function wp_script_is(string $handle, string $status = 'enqueued'): bool
    {
        if ($status === 'registered') {
            return isset($GLOBALS['fgpx_test_registered_scripts'][$handle]);
        }
        return isset($GLOBALS['fgpx_test_enqueued_scripts'][$handle]);
    }
}

if (!function_exists('wp_localize_script')) {
    function wp_localize_script(string $handle, string $object_name, array $l10n): bool
    {
        $GLOBALS['fgpx_test_localized_scripts'][$handle][$object_name] = $l10n;
        return true;
    }
}

if (!function_exists('wp_add_inline_script')) {
    function wp_add_inline_script(string $handle, string $data, string $position = 'after'): bool
    {
        $GLOBALS['fgpx_test_inline_scripts'][$handle][] = [
            'data' => $data,
            'position' => $position,
        ];
        return true;
    }
}

if (!function_exists('wp_create_nonce')) {
    function wp_create_nonce(string $action = '-1'): string
    {
        return 'fgpx-test-nonce-' . md5($action);
    }
}

if (!function_exists('admin_url')) {
    function admin_url(string $path = ''): string
    {
        return 'https://example.test/wp-admin/' . ltrim($path, '/');
    }
}

if (!function_exists('site_url')) {
    function site_url(string $path = ''): string
    {
        return 'https://example.test/' . ltrim($path, '/');
    }
}

if (!function_exists('trailingslashit')) {
    function trailingslashit(string $string): string
    {
        return rtrim($string, '/\\') . '/';
    }
}

if (!function_exists('esc_js')) {
    function esc_js(string $text): string
    {
        return $text;
    }
}

if (!function_exists('__')) {
    function __(string $text, string $domain = 'default'): string
    {
        return $text;
    }
}

if (!function_exists('_e')) {
    function _e(string $text, string $domain = 'default'): void
    {
        echo $text;
    }
}

if (!function_exists('esc_html__')) {
    function esc_html__(string $text, string $domain = 'default'): string
    {
        return htmlspecialchars($text, ENT_QUOTES, 'UTF-8');
    }
}

if (!function_exists('esc_attr__')) {
    function esc_attr__(string $text, string $domain = 'default'): string
    {
        return htmlspecialchars($text, ENT_QUOTES, 'UTF-8');
    }
}

if (!function_exists('esc_html')) {
    function esc_html(string $text): string
    {
        return htmlspecialchars($text, ENT_QUOTES, 'UTF-8');
    }
}

if (!function_exists('esc_attr')) {
    function esc_attr(string $text): string
    {
        return htmlspecialchars($text, ENT_QUOTES, 'UTF-8');
    }
}

if (!function_exists('esc_url')) {
    function esc_url(string $url): string
    {
        return $url;
    }
}

if (!function_exists('wp_kses_post')) {
    function wp_kses_post(string $content): string
    {
        return $content;
    }
}

if (!function_exists('wp_unslash')) {
    function wp_unslash($value)
    {
        if (is_array($value)) {
            return array_map('wp_unslash', $value);
        }

        return is_string($value) ? stripslashes($value) : $value;
    }
}

if (!function_exists('absint')) {
    function absint($maybeint): int
    {
        return abs((int) $maybeint);
    }
}

if (!function_exists('sanitize_title')) {
    function sanitize_title(string $title): string
    {
        $title = strtolower(trim($title));
        $title = preg_replace('/[^a-z0-9\s-]/', '', $title);
        $title = preg_replace('/[\s-]+/', '-', (string) $title);
        return trim((string) $title, '-');
    }
}

if (!function_exists('selected')) {
    function selected($selected, $current = true, bool $echo = true): string
    {
        $result = ((string) $selected === (string) $current) ? ' selected="selected"' : '';
        if ($echo) {
            echo $result;
        }
        return $result;
    }
}

if (!function_exists('checked')) {
    function checked($checked, $current = true, bool $echo = true): string
    {
        $result = ((string) $checked === (string) $current) ? ' checked="checked"' : '';
        if ($echo) {
            echo $result;
        }
        return $result;
    }
}

if (!function_exists('wp_json_encode')) {
    /**
     * Minimal WordPress-compatible JSON encoder for tests.
     *
     * @param mixed $value
     */
    function wp_json_encode($value, int $flags = 0, int $depth = 512)
    {
        return json_encode($value, $flags, $depth);
    }
}

if (!function_exists('wp_rand')) {
    function wp_rand(int $min = 0, int $max = 0): int
    {
        if (isset($GLOBALS['fgpx_test_wp_rand']) && is_callable($GLOBALS['fgpx_test_wp_rand'])) {
            return (int) $GLOBALS['fgpx_test_wp_rand']($min, $max);
        }

        try {
            return random_int($min, $max);
        } catch (\Throwable $e) {
            return $min;
        }
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

if (!function_exists('wp_send_json')) {
    function wp_send_json($data = null, int $status_code = 200, int $flags = 0): void
    {
        throw new FGPX_Test_Ajax_Response(true, $data, $status_code);
    }
}

if (!function_exists('wp_die')) {
    function wp_die(string $message = '', string $title = '', $args = []): void
    {
        throw new \RuntimeException('wp_die: ' . $message);
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

if (!function_exists('wp_remote_retrieve_response_code')) {
    /**
     * Retrieve the HTTP response code from a remote response.
     *
     * @param array $response The remote response array
     * @return int HTTP response code (default 200 if not found)
     */
    function wp_remote_retrieve_response_code($response): int
    {
        if (is_array($response) && isset($response['response']) && is_array($response['response']) && isset($response['response']['code'])) {
            return (int) $response['response']['code'];
        }
        return 200; // Default to success if not specified
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

if (!function_exists('get_post_field')) {
    function get_post_field(string $field, int $postId)
    {
        $post = get_post($postId);
        if ($post instanceof WP_Post) {
            return property_exists($post, $field) ? $post->{$field} : '';
        }

        return '';
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

if (!function_exists('wp_get_attachment_image_src')) {
    function wp_get_attachment_image_src(int $attachmentId, string $size = 'full')
    {
        $url = $GLOBALS['fgpx_test_attachment_urls'][$attachmentId] ?? '';
        if ($url === '') {
            return false;
        }

        return [$url, 0, 0, false];
    }
}

if (!function_exists('wp_get_attachment_url')) {
    function wp_get_attachment_url(int $attachmentId)
    {
        return $GLOBALS['fgpx_test_attachment_urls'][$attachmentId] ?? '';
    }
}

if (!function_exists('wp_get_attachment_caption')) {
    function wp_get_attachment_caption(int $attachmentId)
    {
        $post = get_post($attachmentId);
        if ($post instanceof WP_Post) {
            return (string) ($post->post_excerpt ?? '');
        }

        return '';
    }
}

if (!function_exists('wp_update_post')) {
    function wp_update_post(array $postarr, bool $wp_error = false)
    {
        if (isset($GLOBALS['fgpx_test_wp_update_post']) && is_callable($GLOBALS['fgpx_test_wp_update_post'])) {
            return $GLOBALS['fgpx_test_wp_update_post']($postarr, $wp_error);
        }

        $postId = isset($postarr['ID']) ? (int) $postarr['ID'] : 0;
        if ($postId <= 0) {
            return $wp_error ? new WP_Error('invalid_post', 'Invalid post ID.') : 0;
        }

        $post = get_post($postId);
        if (!$post instanceof WP_Post) {
            return $wp_error ? new WP_Error('post_not_found', 'Post not found.') : 0;
        }

        $existing = isset($GLOBALS['fgpx_test_posts'][$postId]) ? $GLOBALS['fgpx_test_posts'][$postId] : [];
        if ($existing instanceof WP_Post) {
            $existing = get_object_vars($existing);
        }
        if (!is_array($existing)) {
            $existing = [];
        }

        foreach ($postarr as $key => $value) {
            if ($key === 'ID') {
                continue;
            }
            $existing[(string) $key] = $value;
        }

        $existing['ID'] = $postId;
        $GLOBALS['fgpx_test_posts'][$postId] = new WP_Post($existing);

        return $postId;
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

if (!function_exists('get_current_screen')) {
    function get_current_screen()
    {
        if (isset($GLOBALS['fgpx_test_current_screen'])) {
            return $GLOBALS['fgpx_test_current_screen'];
        }

        return (object) ['id' => '', 'base' => ''];
    }
}

if (!function_exists('wp_generate_uuid4')) {
    function wp_generate_uuid4(): string
    {
        $data = random_bytes(16);
        $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
        $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);

        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
    }
}

if (!function_exists('get_object_taxonomies')) {
    /**
     * Stub for get_object_taxonomies.
     * Returns empty array by default; tests can override via $GLOBALS.
     *
     * @param string $object_type
     * @param string $output
     * @return array<string>
     */
    function get_object_taxonomies(string $object_type, string $output = 'names'): array
    {
        if (isset($GLOBALS['fgpx_test_object_taxonomies'][$object_type])) {
            return (array) $GLOBALS['fgpx_test_object_taxonomies'][$object_type];
        }
        return [];
    }
}

if (!function_exists('wp_get_post_terms')) {
    /**
     * Stub for wp_get_post_terms.
     * Returns empty array by default; tests can override via $GLOBALS.
     *
     * @param int $postId
     * @param array<string>|string $taxonomies
     * @param array<string,mixed> $args
     * @return array<mixed>
     */
    function wp_get_post_terms(int $postId, $taxonomies, array $args = []): array
    {
        if (isset($GLOBALS['fgpx_test_post_terms'][$postId])) {
            return (array) $GLOBALS['fgpx_test_post_terms'][$postId];
        }
        return [];
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

            // Detect post-content lookup query used by find_latest_embedding_post_id.
            // In tests, prepare() keeps placeholders, so query text may not contain the shortcode literal.
            if (stripos($query, 'SELECT ID, post_content') !== false && stripos($query, 'post_content LIKE') !== false) {
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
