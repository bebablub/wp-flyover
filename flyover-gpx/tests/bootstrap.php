<?php

declare(strict_types=1);

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
