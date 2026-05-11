<?php

declare(strict_types=1);

namespace FGpx\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class AssetManagerConfigTest extends TestCase
{
    public function test_chartjs_asset_config_uses_451_urls_and_version(): void
    {
        $assetManagerFile = dirname(__DIR__, 2) . '/includes/AssetManager.php';
        $source = (string) file_get_contents($assetManagerFile);

        $this->assertStringContainsString("'primary' => 'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js'", $source);
        $this->assertStringContainsString("'https://unpkg.com/chart.js@4.5.1/dist/chart.umd.min.js'", $source);
        $this->assertStringContainsString("'version' => '4.5.1'", $source);

        $this->assertStringNotContainsString('chart.js@4.4.1/dist/chart.umd.min.js', $source);
        $this->assertStringNotContainsString('cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js', $source);
    }

    public function test_legacy_chart_filter_registration_uses_451(): void
    {
        $assetManagerFile = dirname(__DIR__, 2) . '/includes/AssetManager.php';
        $source = (string) file_get_contents($assetManagerFile);

        $this->assertStringContainsString("\\wp_register_script('chartjs', \$chartSrc, [], '4.5.1', true);", $source);
        $this->assertStringNotContainsString("\\wp_register_script('chartjs', \$chartSrc, [], '4.4.1', true);", $source);
    }

    public function test_three_js_asset_config_registered(): void
    {
        $assetManagerFile = dirname(__DIR__, 2) . '/includes/AssetManager.php';
        $source = (string) file_get_contents($assetManagerFile);

        $this->assertStringContainsString("'three-js'", $source, 'three-js asset entry must exist');
        $this->assertStringContainsString("'primary' => 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js'", $source);
        $this->assertStringContainsString("'https://unpkg.com/three@0.160.0/build/three.min.js'", $source);
        $this->assertStringContainsString("'version' => '0.160.0'", $source);
    }
}
