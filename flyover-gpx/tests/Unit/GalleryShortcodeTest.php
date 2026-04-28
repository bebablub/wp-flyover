<?php

declare(strict_types=1);

namespace FGpx\Tests\Unit;

use FGpx\GalleryShortcode;
use FGpx\Options;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;

final class GalleryShortcodeTest extends TestCase
{
    protected function setUp(): void
    {
        Options::clearCache();
        $GLOBALS['fgpx_test_inline_scripts'] = [];
        $GLOBALS['fgpx_test_enqueued_styles'] = [];
        $GLOBALS['fgpx_test_enqueued_scripts'] = [];
        $GLOBALS['fgpx_test_registered_styles'] = [];
        $GLOBALS['fgpx_test_registered_scripts'] = [];
    }

    public function test_format_duration_with_hours_returns_hh_mm_ss(): void
    {
        $method = new ReflectionMethod(GalleryShortcode::class, 'formatDuration');
        $method->setAccessible(true);

        $value = $method->invoke(new GalleryShortcode(), 3661);

        $this->assertSame('1:01:01', $value);
    }

    public function test_format_duration_without_hours_returns_mm_ss(): void
    {
        $method = new ReflectionMethod(GalleryShortcode::class, 'formatDuration');
        $method->setAccessible(true);

        $value = $method->invoke(new GalleryShortcode(), 125);

        $this->assertSame('02:05', $value);
    }

    public function test_format_duration_clamps_negative_to_zero(): void
    {
        $method = new ReflectionMethod(GalleryShortcode::class, 'formatDuration');
        $method->setAccessible(true);

        $value = $method->invoke(new GalleryShortcode(), -10);

        $this->assertSame('00:00', $value);
    }

    public function test_resolve_gallery_style_replaces_placeholder_in_url_and_json(): void
    {
        $method = new ReflectionMethod(GalleryShortcode::class, 'resolveGalleryStyle');
        $method->setAccessible(true);

        $options = [
            'fgpx_default_style_json' => '{"version":8,"sources":{"sat":{"tiles":["https://maps.test/{z}/{x}/{y}.png?key={{API_KEY}}"]}}}',
            'fgpx_smart_api_keys_mode' => 'single',
            'fgpx_smart_api_keys_pool' => "gallery-key",
        ];

        $resolved = $method->invoke(new GalleryShortcode(), $options, 'https://maps.6bes.de/maps/satellite/?key={{API_KEY}}');

        $this->assertIsArray($resolved);
        $this->assertStringNotContainsString('{{API_KEY}}', (string) $resolved['styleUrl']);
        $this->assertStringNotContainsString('{{API_KEY}}', (string) $resolved['styleJson']);
        $this->assertStringContainsString('gallery-key', (string) $resolved['styleUrl']);
        $this->assertStringContainsString('gallery-key', (string) $resolved['styleJson']);
    }

    public function test_resolve_gallery_style_keeps_plain_url_when_mode_off(): void
    {
        $method = new ReflectionMethod(GalleryShortcode::class, 'resolveGalleryStyle');
        $method->setAccessible(true);

        $plainUrl = 'https://maps.test/style.json?key=hardcoded';
        $plainJson = '{"version":8,"name":"plain"}';

        $options = [
            'fgpx_default_style_json' => $plainJson,
            'fgpx_smart_api_keys_mode' => 'off',
            'fgpx_smart_api_keys_pool' => '',
        ];

        $resolved = $method->invoke(new GalleryShortcode(), $options, $plainUrl);

        $this->assertIsArray($resolved);
        $this->assertSame($plainUrl, (string) $resolved['styleUrl']);
        $this->assertSame($plainJson, (string) $resolved['styleJson']);
    }

    public function test_resolve_gallery_style_forwards_resolved_key(): void
    {
        $method = new ReflectionMethod(GalleryShortcode::class, 'resolveGalleryStyle');
        $method->setAccessible(true);

        $options = [
            'fgpx_default_style_json' => '',
            'fgpx_smart_api_keys_mode' => 'single',
            'fgpx_smart_api_keys_pool' => "tile-key-abc",
        ];

        $resolved = $method->invoke(new GalleryShortcode(), $options, 'https://maps.6bes.de/maps/satellite/?key={{API_KEY}}');

        $this->assertIsArray($resolved);
        $this->assertArrayHasKey('resolvedKey', $resolved);
        $this->assertSame('tile-key-abc', (string) $resolved['resolvedKey']);
    }

    public function test_resolve_gallery_style_resolved_key_empty_when_mode_off(): void
    {
        $method = new ReflectionMethod(GalleryShortcode::class, 'resolveGalleryStyle');
        $method->setAccessible(true);

        $options = [
            'fgpx_default_style_json' => '',
            'fgpx_smart_api_keys_mode' => 'off',
            'fgpx_smart_api_keys_pool' => 'some-key',
        ];

        $resolved = $method->invoke(new GalleryShortcode(), $options, 'https://maps.test/style.json?key={{API_KEY}}');

        $this->assertIsArray($resolved);
        $this->assertArrayHasKey('resolvedKey', $resolved);
        // resolvedKey is cast to string from null — must be empty
        $this->assertSame('', (string) $resolved['resolvedKey']);
    }

    public function test_resolve_gallery_style_clears_url_when_placeholder_unresolved(): void
    {
        $method = new ReflectionMethod(GalleryShortcode::class, 'resolveGalleryStyle');
        $method->setAccessible(true);

        $options = [
            'fgpx_default_style_json' => '',
            'fgpx_smart_api_keys_mode' => 'off',
            'fgpx_smart_api_keys_pool' => '',
        ];

        $resolved = $method->invoke(new GalleryShortcode(), $options, 'https://maps.test/style.json?key={{API_KEY}}');

        // URL must be cleared so MapLibre never receives a broken esc_url_raw-encoded placeholder.
        $this->assertSame('', (string) $resolved['styleUrl']);
    }

    public function test_resolve_gallery_style_clears_url_when_pool_empty_but_placeholder_present(): void
    {
        $method = new ReflectionMethod(GalleryShortcode::class, 'resolveGalleryStyle');
        $method->setAccessible(true);

        $options = [
            'fgpx_default_style_json' => '',
            'fgpx_smart_api_keys_mode' => 'single',
            'fgpx_smart_api_keys_pool' => '', // no keys → placeholder survives
        ];

        $resolved = $method->invoke(new GalleryShortcode(), $options, 'https://maps.test/style.json?key={{API_KEY}}');

        $this->assertSame('', (string) $resolved['styleUrl']);
    }

    public function test_gallery_shortcode_localizes_style_json_for_player_config(): void
    {
        $galleryFile = dirname(__DIR__, 2) . '/includes/GalleryShortcode.php';
        $source = (string) file_get_contents($galleryFile);

        $this->assertStringContainsString("'styleJson' => (string) (\$galleryCfg['styleJson'] ?? \$options['fgpx_default_style_json'])", $source);
    }

    public function test_gallery_shortcode_accepts_photo_order_mode_shortcode_override(): void
    {
        $galleryFile = dirname(__DIR__, 2) . '/includes/GalleryShortcode.php';
        $source = (string) file_get_contents($galleryFile);

        $this->assertStringContainsString("'photo_order_mode' => \$galleryPhotoOrderModeDefault", $source);
        $this->assertStringContainsString("\$photoOrderMode = \\sanitize_key((string) (\$atts['photo_order_mode'] ?? \$galleryPhotoOrderModeDefault));", $source);
        $this->assertStringContainsString("'photoOrderMode' => \$photoOrderMode", $source);
    }
}
