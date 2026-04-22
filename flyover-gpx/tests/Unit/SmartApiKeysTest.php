<?php

declare(strict_types=1);

namespace FGpx\Tests\Unit;

use FGpx\SmartApiKeys;
use PHPUnit\Framework\TestCase;

final class SmartApiKeysTest extends TestCase
{
    public function test_normalize_mode_falls_back_to_off(): void
    {
        $this->assertSame(SmartApiKeys::MODE_OFF, SmartApiKeys::normalizeMode('invalid'));
        $this->assertSame(SmartApiKeys::MODE_SINGLE, SmartApiKeys::normalizeMode('single'));
        $this->assertSame(SmartApiKeys::MODE_PER_OCCURRENCE, SmartApiKeys::normalizeMode('per_occurrence'));
    }

    public function test_parse_key_pool_trims_and_deduplicates(): void
    {
        $raw = " alpha\n\n beta \nalpha\n gamma\n";
        $this->assertSame(['alpha', 'beta', 'gamma'], SmartApiKeys::parseKeyPool($raw));
    }

    public function test_replace_placeholders_single_mode_uses_same_key(): void
    {
        $subject = 'https://api.test/x?key={{API_KEY}}&key2={{API_KEY}}';
        $resolved = SmartApiKeys::replacePlaceholders($subject, ['only-key'], SmartApiKeys::MODE_SINGLE);

        $this->assertSame('https://api.test/x?key=only-key&key2=only-key', $resolved);
    }

    public function test_resolve_style_replaces_json_and_url(): void
    {
        $styleJson = '{"version":8,"glyphs":"https://maps.test/fonts/{fontstack}/{range}.pbf?key={{API_KEY}}","sources":{"sat":{"type":"raster","tiles":["https://maps.test/z/{z}/{x}/{y}.jpg?key={{API_KEY}}"]}}}';
        $styleUrl = 'https://maps.test/style.json?key={{API_KEY}}';

        $resolved = SmartApiKeys::resolveStyle($styleJson, $styleUrl, SmartApiKeys::MODE_SINGLE, "my-key");

        $this->assertStringNotContainsString(SmartApiKeys::PLACEHOLDER, $resolved['styleJson']);
        $this->assertStringNotContainsString(SmartApiKeys::PLACEHOLDER, $resolved['styleUrl']);
        $this->assertStringContainsString('my-key', $resolved['styleJson']);
        $this->assertSame('https://maps.test/style.json?key=my-key', $resolved['styleUrl']);
    }

    public function test_mode_single_uses_one_key_across_json_and_url(): void
    {
        $calls = 0;
        $GLOBALS['fgpx_test_wp_rand'] = static function (int $min, int $max) use (&$calls): int {
            $calls++;
            return ($calls % 2 === 0) ? $max : $min;
        };

        $styleJson = '{"version":8,"sources":{"a":{"type":"raster","tiles":["https://maps.test/a?key={{API_KEY}}","https://maps.test/b?key={{API_KEY}}"]}}}';
        $styleUrl = 'https://maps.test/style.json?key={{API_KEY}}';
        $resolved = SmartApiKeys::resolveStyle($styleJson, $styleUrl, SmartApiKeys::MODE_SINGLE, "key-alpha\nkey-beta");

        preg_match_all('/key=([a-z\-]+)/', $resolved['styleJson'] . ' ' . $resolved['styleUrl'], $matches);
        $usedKeys = array_values(array_unique($matches[1] ?? []));

        $this->assertCount(1, $usedKeys, 'Mode A must use exactly one key for all placeholders in one resolved style');
        $this->assertSame(1, $calls, 'Mode A should choose a key once per resolve operation');

        unset($GLOBALS['fgpx_test_wp_rand']);
    }

    public function test_extract_template_url_prefers_json_content(): void
    {
        $styleJson = '{"version":8,"sources":{"sat":{"type":"raster","tiles":["https://maps.test/s/{z}/{x}/{y}.jpg?key={{API_KEY}}"]}}}';
        $styleUrl = 'https://fallback.test/style.json?key={{API_KEY}}';

        $found = SmartApiKeys::extractTemplateUrl($styleJson, $styleUrl);

        $this->assertSame('https://maps.test/s/{z}/{x}/{y}.jpg?key={{API_KEY}}', $found);
    }

    public function test_normalize_probe_url_replaces_common_placeholders(): void
    {
        $url = 'https://maps.test/fonts/{fontstack}/{range}.pbf?bbox={bbox-epsg-3857}&z={z}&x={x}&y={y}';
        $normalized = SmartApiKeys::normalizeProbeUrl($url);

        $this->assertStringNotContainsString('{fontstack}', $normalized);
        $this->assertStringNotContainsString('{range}', $normalized);
        $this->assertStringNotContainsString('{bbox-epsg-3857}', $normalized);
        $this->assertStringNotContainsString('{z}', $normalized);
        $this->assertStringNotContainsString('{x}', $normalized);
        $this->assertStringNotContainsString('{y}', $normalized);
        $this->assertStringContainsString('Open%20Sans%20Regular', $normalized);
    }

    public function test_test_keys_against_template_reports_ok_from_http_code(): void
    {
        $capturedUrl = '';
        $GLOBALS['fgpx_test_wp_remote_get'] = static function (string $url, array $args = []) use (&$capturedUrl) {
            $capturedUrl = $url;
            if (strpos($url, 'good-key') !== false) {
                return ['response' => ['code' => 200], 'body' => 'ok'];
            }
            return ['response' => ['code' => 403], 'body' => 'forbidden'];
        };

        $results = SmartApiKeys::testKeysAgainstTemplate(
            'https://maps.test/{z}/{x}/{y}.png?key={{API_KEY}}',
            ['good-key', 'bad-key'],
            3
        );

        $this->assertCount(2, $results);
        $this->assertTrue($results[0]['ok']);
        $this->assertFalse($results[1]['ok']);
        $this->assertSame(200, $results[0]['status']);
        $this->assertSame(403, $results[1]['status']);
        $this->assertStringContainsString('/12/2150/1450.png?key=bad-key', $capturedUrl);

        unset($GLOBALS['fgpx_test_wp_remote_get']);
    }
}
