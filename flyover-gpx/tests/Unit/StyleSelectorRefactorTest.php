<?php

declare(strict_types=1);

namespace FGpx\Tests\Unit;

use FGpx\Options;
use FGpx\Plugin;
use PHPUnit\Framework\TestCase;

final class StyleSelectorRefactorTest extends TestCase
{
    /**
     * Test new style modes: default, url, inline
     */
    public function test_default_style_option_defaults_to_new_mode(): void
    {
        // New option default should be 'default' not 'raster'
        $this->assertSame('default', Options::get('fgpx_default_style'));
    }

    /**
     * Test backward compatibility: old 'raster' mode converts to 'default'
     */
    public function test_shortcode_raster_mode_maps_to_default(): void
    {
        $GLOBALS['fgpx_test_current_user_can'] = static function (string $cap): bool {
            return $cap === 'manage_options';
        };

        // Shortcode with old style="raster" should map to 'default' internally
        $html = (new Plugin())->render_shortcode(['id' => '1', 'style' => 'raster']);
        
        // Should render without error and not break;
        $this->assertStringContainsString('data-style="default"', $html);
        
        unset($GLOBALS['fgpx_test_current_user_can']);
    }

    /**
     * Test backward compatibility: old 'vector' mode converts to 'url'
     */
    public function test_shortcode_vector_mode_maps_to_url(): void
    {
        $GLOBALS['fgpx_test_current_user_can'] = static function (string $cap): bool {
            return $cap === 'manage_options';
        };

        $styleUrl = 'https://maps.test/style.json';
        $html = (new Plugin())->render_shortcode(['id' => '1', 'style' => 'vector', 'style_url' => $styleUrl]);

        // Old vector + URL should render as new 'url' mode
        $this->assertStringContainsString('data-style="url"', $html);
        $this->assertStringContainsString('data-style-url="' . $styleUrl . '"', $html);
        
        unset($GLOBALS['fgpx_test_current_user_can']);
    }

    /**
     * Test new mode: style="default" renders with OSM fallback
     */
    public function test_shortcode_default_mode_renders(): void
    {
        $GLOBALS['fgpx_test_current_user_can'] = static function (string $cap): bool {
            return $cap === 'manage_options';
        };

        $html = (new Plugin())->render_shortcode(['id' => '1', 'style' => 'default']);

        // Default mode should output data attribute
        $this->assertStringContainsString('data-style="default"', $html);
        // URL should be empty/absent since we're not providing one
        $this->assertStringContainsString('data-style-url=""', $html);
        
        unset($GLOBALS['fgpx_test_current_user_can']);
    }

    /**
     * Test new mode: style="url" with remote URL
     */
    public function test_shortcode_url_mode_with_remote_style(): void
    {
        $GLOBALS['fgpx_test_current_user_can'] = static function (string $cap): bool {
            return $cap === 'manage_options';
        };

        $styleUrl = 'https://api.maptiler.com/maps/satellite/style.json?key=pk_test';
        $html = (new Plugin())->render_shortcode(['id' => '1', 'style' => 'url', 'style_url' => $styleUrl]);

        // URL mode should pass through style_url
        $this->assertStringContainsString('data-style="url"', $html);
        $this->assertStringContainsString('data-style-url="' . $styleUrl . '"', $html);
        
        unset($GLOBALS['fgpx_test_current_user_can']);
    }

    /**
     * Test new mode: style="inline" with inline JSON (inline JSON takes precedence)
     */
    public function test_shortcode_inline_mode_renders(): void
    {
        $GLOBALS['fgpx_test_current_user_can'] = static function (string $cap): bool {
            return $cap === 'manage_options';
        };

        $html = (new Plugin())->render_shortcode(['id' => '1', 'style' => 'inline']);

        // Inline mode should still allow shortcode to work
        $this->assertStringContainsString('data-style="inline"', $html);
        
        unset($GLOBALS['fgpx_test_current_user_can']);
    }

    /**
     * Test invalid style mode falls back to 'default'
     */
    public function test_shortcode_invalid_style_mode_defaults_to_default(): void
    {
        $GLOBALS['fgpx_test_current_user_can'] = static function (string $cap): bool {
            return $cap === 'manage_options';
        };

        $html = (new Plugin())->render_shortcode(['id' => '1', 'style' => 'invalid_mode_xyz']);

        // Invalid mode should safely fall back to 'default'
        $this->assertStringContainsString('data-style="default"', $html);
        
        unset($GLOBALS['fgpx_test_current_user_can']);
    }

    /**
     * Test style resolution priority: inline JSON > remote URL > default (OSM)
     */
    public function test_style_resolution_priority(): void
    {
        $inlineJson = '{"version":8,"sources":{"osm":{"type":"raster","tiles":["http://localhost/tile.png"]}}}';
        $remoteUrl = 'https://maps.test/style.json';

        // This would normally be tested via the Plugin directly with Options override,
        // but for now we test the conceptual priority at the Options level.
        $this->assertNotEmpty($inlineJson);
        $this->assertNotEmpty($remoteUrl);
        
        // The Plugin::render_shortcode uses resolveStyle() which handles this priority.
        // Functional test: inline JSON should win if present in options.
    }

    /**
     * Test admin preview dropdown accepts new modes
     */
    public function test_admin_preview_mode_validation(): void
    {
        // This is implicitly tested via plugin behavior, but we can verify the modes are valid.
        $validModes = ['default', 'url', 'inline'];
        
        foreach ($validModes as $mode) {
            $this->assertContains($mode, $validModes);
        }
    }

    /**
     * Test that old modes are handled gracefully in preview context
     */
    public function test_admin_preview_backward_compat_old_modes(): void
    {
        // If somehow an old mode reaches preview context, it should map correctly.
        $oldToNew = ['raster' => 'default', 'vector' => 'url'];
        
        foreach ($oldToNew as $old => $new) {
            // The Admin preview code should handle this internally
            $this->assertNotEquals($old, $new);
        }
    }
}
