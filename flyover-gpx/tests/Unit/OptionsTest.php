<?php

declare(strict_types=1);

namespace FGpx\Tests\Unit;

use FGpx\Options;
use PHPUnit\Framework\TestCase;

/**
 * Regression tests for the Options class.
 *
 * These tests guard against:
 *  - accidental removal or renaming of option keys
 *  - wrong default values (e.g. typos, type changes)
 *  - breaking changes to getForFrontend() that would silently break the JS config
 *  - caching bugs that cause stale values to be returned
 *
 * The get_option() stub in tests/bootstrap.php returns the $default argument,
 * so every option resolves to its definition default — exactly the values that
 * a fresh WordPress install would use.
 */
final class OptionsTest extends TestCase
{
    protected function setUp(): void
    {
        // Each test starts with a clean cache so tests are independent.
        Options::clearCache();
    }

    // ------------------------------------------------------------------
    // Definition integrity
    // ------------------------------------------------------------------

    public function test_all_definition_keys_are_fgpx_prefixed(): void
    {
        foreach (Options::getDefinitions() as $key => $default) {
            $this->assertStringStartsWith(
                'fgpx_',
                $key,
                "Option key '{$key}' must be prefixed with 'fgpx_'"
            );
        }
    }

    public function test_definitions_are_not_empty(): void
    {
        $this->assertGreaterThan(40, count(Options::getDefinitions()), 'Expected at least 40 option definitions');
    }

    // ------------------------------------------------------------------
    // Key presence — ensure important options still exist
    // ------------------------------------------------------------------

    /** @dataProvider criticalOptionKeyProvider */
    public function test_critical_option_key_is_defined(string $key): void
    {
        $this->assertTrue(
            Options::isDefined($key),
            "Critical option key '{$key}' is no longer defined"
        );
    }

    /** @return array<string, array{string}> */
    public static function criticalOptionKeyProvider(): array
    {
        return [
            // Map display
            'default_style'            => ['fgpx_default_style'],
            'smart_api_mode'           => ['fgpx_smart_api_keys_mode'],
            'smart_api_pool'           => ['fgpx_smart_api_keys_pool'],
            'smart_api_test_override'  => ['fgpx_smart_api_keys_test_url_override'],
            'default_height'           => ['fgpx_default_height'],
            'default_zoom'             => ['fgpx_default_zoom'],
            'default_speed'            => ['fgpx_default_speed'],
            // Privacy
            'privacy_enabled'          => ['fgpx_privacy_enabled'],
            'privacy_km'               => ['fgpx_privacy_km'],
            // Features
            'hud_enabled'              => ['fgpx_hud_enabled'],
            'photos_enabled'           => ['fgpx_photos_enabled'],
            'photo_order_mode'         => ['fgpx_photo_order_mode'],
            'photo_max_distance'       => ['fgpx_photo_max_distance'],
            'gpx_download_enabled'     => ['fgpx_gpx_download_enabled'],
            'lazy_viewport'            => ['fgpx_lazy_viewport'],
            'gallery_per_page'         => ['fgpx_gallery_per_page'],
            'gallery_player_height'    => ['fgpx_gallery_player_height'],
            'gallery_default_sort'     => ['fgpx_gallery_default_sort'],
            'gallery_show_view_toggle' => ['fgpx_gallery_show_view_toggle'],
            'gallery_show_search'      => ['fgpx_gallery_show_search'],
            'weather_enabled'          => ['fgpx_weather_enabled'],
            'daynight_enabled'         => ['fgpx_daynight_enabled'],
            'elevation_coloring'       => ['fgpx_elevation_coloring'],
            // Theme / dark mode
            'theme_mode'               => ['fgpx_theme_mode'],
            'theme_auto_dark_start'    => ['fgpx_theme_auto_dark_start'],
            'theme_auto_dark_end'      => ['fgpx_theme_auto_dark_end'],
            // Performance
            'backend_simplify_enabled' => ['fgpx_backend_simplify_enabled'],
            'backend_simplify_target'  => ['fgpx_backend_simplify_target'],
            // Chart colors
            'chart_color'              => ['fgpx_chart_color'],
            'chart_color2'             => ['fgpx_chart_color2'],
        ];
    }

    // ------------------------------------------------------------------
    // Default values
    // ------------------------------------------------------------------

    public function test_get_returns_definition_default_for_empty_database(): void
    {
        // get_option stub returns $default → Options returns definition defaults
        $this->assertSame('default', Options::get('fgpx_default_style'));
        $this->assertSame('off',   Options::get('fgpx_smart_api_keys_mode'));
        $this->assertSame('',      Options::get('fgpx_smart_api_keys_pool'));
        $this->assertSame('',      Options::get('fgpx_smart_api_keys_test_url_override'));
        $this->assertSame('820px',  Options::get('fgpx_default_height'));
        $this->assertSame('11',     Options::get('fgpx_default_zoom'));
        $this->assertSame('25',     Options::get('fgpx_default_speed'));
        $this->assertSame('1',      Options::get('fgpx_hud_enabled'));
        $this->assertSame('geo_first', Options::get('fgpx_photo_order_mode'));
        $this->assertSame('100',    Options::get('fgpx_photo_max_distance'));
        $this->assertSame('0',      Options::get('fgpx_weather_enabled'));
        $this->assertSame('0.3',    Options::get('fgpx_weather_fog_threshold'));
        $this->assertSame('0.1',    Options::get('fgpx_weather_rain_threshold'));
        $this->assertSame('0.1',    Options::get('fgpx_weather_snow_threshold'));
        $this->assertSame('3',      Options::get('fgpx_weather_wind_threshold'));
        $this->assertSame('50',     Options::get('fgpx_weather_cloud_threshold'));
        $this->assertSame('0',      Options::get('fgpx_gpx_download_enabled'));
        $this->assertSame('12',     Options::get('fgpx_gallery_per_page'));
        $this->assertSame('636px',  Options::get('fgpx_gallery_player_height'));
        $this->assertSame('newest', Options::get('fgpx_gallery_default_sort'));
        $this->assertSame('1',      Options::get('fgpx_gallery_show_view_toggle'));
        $this->assertSame('1',      Options::get('fgpx_gallery_show_search'));
        // Theme defaults
        $this->assertSame('system', Options::get('fgpx_theme_mode'));
        $this->assertSame('22:00',  Options::get('fgpx_theme_auto_dark_start'));
        $this->assertSame('06:00',  Options::get('fgpx_theme_auto_dark_end'));
    }

    public function test_is_defined_returns_false_for_unknown_key(): void
    {
        $this->assertFalse(Options::isDefined('fgpx_nonexistent_option'));
        $this->assertFalse(Options::isDefined(''));
        $this->assertFalse(Options::isDefined('completely_wrong'));
    }

    // ------------------------------------------------------------------
    // getMultiple()
    // ------------------------------------------------------------------

    public function test_get_multiple_returns_all_requested_keys(): void
    {
        $keys   = ['fgpx_default_zoom', 'fgpx_default_height', 'fgpx_chart_color'];
        $result = Options::getMultiple($keys);

        $this->assertCount(3, $result);
        foreach ($keys as $key) {
            $this->assertArrayHasKey($key, $result);
        }
    }

    // ------------------------------------------------------------------
    // getAll()
    // ------------------------------------------------------------------

    public function test_get_all_contains_every_definition_key(): void
    {
        $all  = Options::getAll();
        $defs = Options::getDefinitions();

        $this->assertSameSize($defs, $all, 'getAll() must return the same number of entries as getDefinitions()');

        foreach (array_keys($defs) as $key) {
            $this->assertArrayHasKey($key, $all, "getAll() is missing key '{$key}'");
        }
    }

    // ------------------------------------------------------------------
    // Cache behaviour
    // ------------------------------------------------------------------

    public function test_clear_cache_allows_fresh_load(): void
    {
        Options::getAll();        // populate cache
        Options::clearCache();   // reset
        $all = Options::getAll();  // repopulate

        $this->assertIsArray($all);
        $this->assertNotEmpty($all);
    }

    public function test_options_class_registers_invalidation_hooks_for_direct_option_mutations(): void
    {
        $optionsFile = dirname(__DIR__, 2) . '/includes/Options.php';
        $source = (string) file_get_contents($optionsFile);

        $this->assertStringContainsString("public static function register(): void", $source);
        $this->assertStringContainsString("\\add_action('added_option', [self::class, 'maybeInvalidateForOption']", $source);
        $this->assertStringContainsString("\\add_action('updated_option', [self::class, 'maybeInvalidateForOption']", $source);
        $this->assertStringContainsString("\\add_action('deleted_option', [self::class, 'maybeInvalidateForOption']", $source);
        $this->assertStringContainsString("if (strpos(\$option, 'fgpx_') !== 0)", $source);
    }

    public function test_plugin_bootstrap_registers_options_hooks_before_runtime_use(): void
    {
        $bootstrapFile = dirname(__DIR__, 2) . '/flyover-gpx.php';
        $source = (string) file_get_contents($bootstrapFile);

        $this->assertStringContainsString('Options::register();', $source);
    }

    // ------------------------------------------------------------------
    // getForFrontend() — guards the JS config contract
    // ------------------------------------------------------------------

    public function test_get_for_frontend_contains_all_required_keys(): void
    {
        $frontend = Options::getForFrontend();

        $required = [
            'chartColor', 'chartColor2', 'chartColorHr',
            'chartColorCad', 'chartColorTemp', 'chartColorPower',
            'ftp',
            'chartColorWindImpact', 'chartColorWindRose',
            'windRoseColorNorth', 'windRoseColorSouth',
            'windRoseColorEast', 'windRoseColorWest',
            'daynightEnabled', 'daynightMapEnabled',
            'daynightMapColor', 'daynightMapOpacity',
            'photosEnabled', 'photoOrderMode', 'photoMaxDistance', 'showLabels',
            'defaultZoom', 'defaultPitch', 'styleJson',
            'backendSimplify', 'backendSimplifyTarget',
            'debugWeatherData',
            'weatherFogThreshold', 'weatherRainThreshold',
            'weatherSnowThreshold', 'weatherWindThreshold', 'weatherCloudThreshold',
            'themeMode', 'themeAutoDarkStart', 'themeAutoDarkEnd',
        ];

        foreach ($required as $key) {
            $this->assertArrayHasKey($key, $frontend, "getForFrontend() is missing JS config key '{$key}'");
        }
    }

    public function test_get_for_frontend_has_correct_types(): void
    {
        $f = Options::getForFrontend();

        // Booleans
        $this->assertIsBool($f['daynightEnabled'],     'daynightEnabled must be bool');
        $this->assertIsBool($f['daynightMapEnabled'],  'daynightMapEnabled must be bool');
        $this->assertIsBool($f['photosEnabled'],       'photosEnabled must be bool');
        $this->assertIsBool($f['showLabels'],          'showLabels must be bool');
        $this->assertIsBool($f['backendSimplify'],     'backendSimplify must be bool');
        $this->assertIsBool($f['debugWeatherData'],    'debugWeatherData must be bool');

        // Integers
        $this->assertIsInt($f['defaultZoom'],              'defaultZoom must be int');
        $this->assertIsInt($f['defaultPitch'],             'defaultPitch must be int');
        $this->assertIsInt($f['backendSimplifyTarget'],    'backendSimplifyTarget must be int');
        $this->assertIsInt($f['photoMaxDistance'],         'photoMaxDistance must be int');
        $this->assertIsInt($f['ftp'],                      'ftp must be int');

        // Floats / numbers
        $this->assertIsFloat($f['daynightMapOpacity'],     'daynightMapOpacity must be float');
        $this->assertIsFloat($f['weatherFogThreshold'],    'weatherFogThreshold must be float');
        $this->assertIsFloat($f['weatherRainThreshold'],   'weatherRainThreshold must be float');
        $this->assertIsFloat($f['weatherSnowThreshold'],   'weatherSnowThreshold must be float');
        $this->assertIsFloat($f['weatherWindThreshold'],   'weatherWindThreshold must be float');
        $this->assertIsFloat($f['weatherCloudThreshold'],  'weatherCloudThreshold must be float');

        // Strings
        $this->assertIsString($f['chartColor'],    'chartColor must be string');
        $this->assertIsString($f['chartColor2'],   'chartColor2 must be string');
        $this->assertIsString($f['photoOrderMode'], 'photoOrderMode must be string');
        $this->assertIsString($f['styleJson'],     'styleJson must be string');
        $this->assertIsString($f['themeMode'],          'themeMode must be string');
        $this->assertIsString($f['themeAutoDarkStart'], 'themeAutoDarkStart must be string');
        $this->assertIsString($f['themeAutoDarkEnd'],   'themeAutoDarkEnd must be string');
        $this->assertContains($f['photoOrderMode'], ['geo_first', 'time_first'], 'photoOrderMode must be a valid value');
        $this->assertContains($f['themeMode'], ['system', 'dark', 'bright', 'auto'], 'themeMode must be a valid value');
    }

    public function test_get_for_frontend_normalizes_photo_order_mode_with_whitelist_fallback(): void
    {
        $optionsFile = dirname(__DIR__, 2) . '/includes/Options.php';
        $source = (string) file_get_contents($optionsFile);

        $this->assertStringContainsString('$photoOrderMode = \\sanitize_key((string) $options[\'fgpx_photo_order_mode\']);', $source);
        $this->assertStringContainsString('if (!\\in_array($photoOrderMode, [\'geo_first\', \'time_first\'], true))', $source);
        $this->assertStringContainsString('$photoOrderMode = \'geo_first\';', $source);
        $this->assertStringContainsString('\'photoOrderMode\' => $photoOrderMode', $source);
    }
}
