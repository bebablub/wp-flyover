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

if (!function_exists('is_wp_error')) {
    function is_wp_error($thing): bool
    {
        return $thing instanceof WP_Error;
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
