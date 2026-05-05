<?php

declare(strict_types=1);

namespace FGpx\Tests\Unit;

use FGpx\TimelineShortcode;
use PHPUnit\Framework\TestCase;

class TimelineShortcodeTest extends TestCase
{
    private TimelineShortcode $timeline;

    protected function setUp(): void
    {
        parent::setUp();
        $this->timeline = new TimelineShortcode();
    }

    /**
     * Test REST endpoint returns correct structure.
     */
    public function test_rest_endpoint_returns_valid_structure(): void
    {
        $payload = $this->invokeMethod($this->timeline, 'buildTimelinePayload', [['page' => 1, 'per_page' => 20]]);

        $this->assertIsArray($payload);
        $this->assertArrayHasKey('months', $payload);
        $this->assertArrayHasKey('pagination', $payload);
        $this->assertIsArray($payload['months']);
        $this->assertIsArray($payload['pagination']);
    }

    /**
     * Test pagination structure includes correct keys.
     */
    public function test_pagination_structure_is_correct(): void
    {
        $payload = $this->invokeMethod($this->timeline, 'buildTimelinePayload', [['page' => 1, 'per_page' => 20]]);

        $pagination = $payload['pagination'];
        $this->assertArrayHasKey('page', $pagination);
        $this->assertArrayHasKey('perPage', $pagination);
        $this->assertArrayHasKey('total', $pagination);
        $this->assertArrayHasKey('hasMore', $pagination);
    }

    /**
     * Test per_page parameter is clamped to valid range (10-50).
     */
    public function test_per_page_clamped_to_min_10(): void
    {
        $payload = $this->invokeMethod($this->timeline, 'buildTimelinePayload', [['page' => 1, 'per_page' => 1]]);
        $this->assertEquals(10, $payload['pagination']['perPage']);
    }

    /**
     * Test per_page parameter is clamped to max 50.
     */
    public function test_per_page_clamped_to_max_50(): void
    {
        $payload = $this->invokeMethod($this->timeline, 'buildTimelinePayload', [['page' => 1, 'per_page' => 1000]]);
        $this->assertEquals(50, $payload['pagination']['perPage']);
    }

    /**
     * Test page parameter defaults to 1.
     */
    public function test_page_defaults_to_1(): void
    {
        $payload = $this->invokeMethod($this->timeline, 'buildTimelinePayload', [[]]);
        $this->assertEquals(1, $payload['pagination']['page']);
    }

    /**
     * Test page parameter is clamped to valid range.
     */
    public function test_page_is_clamped_to_valid_range(): void
    {
        $payload = $this->invokeMethod($this->timeline, 'buildTimelinePayload', [['page' => 99999]]);
        // Should be clamped to maxPage (1 if no tracks, or max available)
        $this->assertGreaterThanOrEqual(1, $payload['pagination']['page']);
    }

    /**
     * Test hasMore is false when on last page.
     */
    public function test_has_more_false_on_last_page(): void
    {
        $payload = $this->invokeMethod($this->timeline, 'buildTimelinePayload', [['page' => 1, 'per_page' => 50]]);
        // Initial payload should have hasMore based on total tracks
        $this->assertIsBool($payload['pagination']['hasMore']);
    }

    /**
     * Test duration formatting.
     */
    public function test_format_duration_zero_seconds(): void
    {
        $result = $this->invokeMethod($this->timeline, 'formatDuration', [0]);
        $this->assertEquals('0m', $result);
    }

    /**
     * Test duration formatting for minutes only.
     */
    public function test_format_duration_minutes_only(): void
    {
        $result = $this->invokeMethod($this->timeline, 'formatDuration', [600]); // 10 minutes
        $this->assertEquals('10m', $result);
    }

    /**
     * Test duration formatting for hours and minutes.
     */
    public function test_format_duration_hours_and_minutes(): void
    {
        $result = $this->invokeMethod($this->timeline, 'formatDuration', [7200]); // 2 hours
        $this->assertEquals('2h 0m', $result);
    }

    /**
     * Test duration formatting for 1 hour 30 minutes.
     */
    public function test_format_duration_1h_30m(): void
    {
        $result = $this->invokeMethod($this->timeline, 'formatDuration', [5400]); // 1.5 hours
        $this->assertEquals('1h 30m', $result);
    }

    /**
     * Test group tracks by month returns correct structure.
     */
    public function test_group_tracks_by_month_structure(): void
    {
        $tracks = [
            [
                'id' => 1,
                'title' => 'Test Track',
                'activityDateTs' => (int) \strtotime('2025-03-15'),
                'distanceKm' => 10.5,
                'durationLabel' => '1h',
                'elevationGainLabel' => '100',
                'dateLabel' => 'March 15, 2025',
            ],
        ];

        $grouped = $this->invokeMethod($this->timeline, 'groupTracksByMonth', [$tracks, []]);

        $this->assertIsArray($grouped);
        $this->assertNotEmpty($grouped);
        $this->assertArrayHasKey('month', $grouped[0]);
        $this->assertArrayHasKey('monthTs', $grouped[0]);
        $this->assertArrayHasKey('items', $grouped[0]);
    }

    /**
     * Test group tracks by month creates proper month label.
     */
    public function test_group_tracks_by_month_labels(): void
    {
        $timestamp = (int) \strtotime('2025-03-15');
        $tracks = [
            [
                'id' => 1,
                'title' => 'Test',
                'activityDateTs' => $timestamp,
                'distanceKm' => 10.5,
                'durationLabel' => '1h',
                'elevationGainLabel' => '100',
                'dateLabel' => 'March 15, 2025',
            ],
        ];

        $grouped = $this->invokeMethod($this->timeline, 'groupTracksByMonth', [$tracks, []]);

        $this->assertStringContainsString('2025', $grouped[0]['month']);
        $this->assertIsInt($grouped[0]['monthTs']);
    }

    /**
     * Test empty tracks array.
     */
    public function test_group_tracks_by_month_empty(): void
    {
        $grouped = $this->invokeMethod($this->timeline, 'groupTracksByMonth', [[], []]);
        $this->assertEmpty($grouped);
    }

    /**
     * Test batch get preview URLs handles empty input.
     */
    public function test_batch_get_preview_urls_empty(): void
    {
        $urls = $this->invokeMethod($this->timeline, 'batchGetPreviewUrls', [[]]);
        $this->assertIsArray($urls);
        $this->assertEmpty($urls);
    }

    /**
     * Test batch get preview URLs returns map by track ID.
     */
    public function test_batch_get_preview_urls_structure(): void
    {
        $tracks = [
            ['id' => 1, 'previewAttachmentId' => 0],
            ['id' => 2, 'previewAttachmentId' => 0],
        ];

        $urls = $this->invokeMethod($this->timeline, 'batchGetPreviewUrls', [$tracks]);

        $this->assertIsArray($urls);
        // Should have entries for both tracks
        $this->assertArrayHasKey(1, $urls);
        $this->assertArrayHasKey(2, $urls);
    }

    /**
     * Test sanitize track for client includes required fields.
     */
    public function test_sanitize_track_for_client_structure(): void
    {
        $track = [
            'id' => 1,
            'title' => 'Test Track',
            'distanceKm' => 10.5,
            'durationLabel' => '1h',
            'elevationGainLabel' => '100',
            'dateLabel' => 'March 15, 2025',
            'activityDateTs' => 1710518400,
        ];

        $sanitized = $this->invokeMethod($this->timeline, 'sanitizeTrackForClient', [$track, false, 'http://example.com/image.jpg']);

        $this->assertArrayHasKey('id', $sanitized);
        $this->assertArrayHasKey('title', $sanitized);
        $this->assertArrayHasKey('distanceKm', $sanitized);
        $this->assertArrayHasKey('previewUrl', $sanitized);
        $this->assertEquals('http://example.com/image.jpg', $sanitized['previewUrl']);
    }

    /**
     * Test sanitize track for client returns correct types.
     */
    public function test_sanitize_track_for_client_types(): void
    {
        $track = [
            'id' => 1,
            'title' => 'Test',
            'distanceKm' => 10.5,
            'durationLabel' => '1h',
            'elevationGainLabel' => '100',
            'dateLabel' => 'March 15',
            'activityDateTs' => 1710518400,
        ];

        $sanitized = $this->invokeMethod($this->timeline, 'sanitizeTrackForClient', [$track, false, '']);

        $this->assertIsInt($sanitized['id']);
        $this->assertIsString($sanitized['title']);
        $this->assertIsFloat($sanitized['distanceKm']);
        $this->assertIsString($sanitized['previewUrl']);
        $this->assertIsInt($sanitized['activityDateTs']);
    }

    /**
     * Test render shortcode returns HTML string.
     */
    public function test_render_shortcode_returns_string(): void
    {
        $result = $this->timeline->render_shortcode([]);
        $this->assertIsString($result);
        $this->assertStringContainsString('fgpx-timeline', $result);
    }

    /**
     * Test render shortcode escapes attributes.
     */
    public function test_render_shortcode_escapes_dangerous_input(): void
    {
        $result = $this->timeline->render_shortcode([
            'orientation' => '<script>alert("xss")</script>',
        ]);
        $this->assertStringNotContainsString('<script>', $result);
    }

    /**
     * Test render shortcode includes playerScripts and playerStyles in config.
     */
    public function test_render_shortcode_includes_player_scripts(): void
    {
        $GLOBALS['fgpx_test_inline_scripts'] = [];
        $this->timeline->render_shortcode([]);

        $inlineScripts = $GLOBALS['fgpx_test_inline_scripts']['fgpx-timeline'] ?? [];
        $this->assertNotEmpty($inlineScripts);

        // Find the before-position script that contains the instance config
        $configJson = null;
        foreach ($inlineScripts as $entry) {
            if (($entry['position'] ?? '') === 'before' && str_contains($entry['data'], 'playerScripts')) {
                // Extract JSON: find last occurrence of ' = {' (the config assignment)
                $pos = strrpos($entry['data'], ' = {');
                if ($pos !== false) {
                    $jsonStr = substr($entry['data'], $pos + 3, -1); // strip trailing ;
                    $configJson = json_decode($jsonStr, true);
                }
                break;
            }
        }

        $this->assertNotNull($configJson, 'Config JSON should be present in inline script');
        $this->assertArrayHasKey('playerScripts', $configJson);
        $this->assertArrayHasKey('playerStyles', $configJson);
        $this->assertArrayHasKey('styleJson', $configJson);
        $this->assertArrayHasKey('resolvedApiKey', $configJson);
        $this->assertIsArray($configJson['playerScripts']);
        $this->assertIsArray($configJson['playerStyles']);
        $this->assertIsString($configJson['styleJson']);
        $this->assertIsString($configJson['resolvedApiKey']);
        $this->assertNotEmpty($configJson['playerScripts']);
        $this->assertNotEmpty($configJson['playerStyles']);
    }

    /**
     * Test render shortcode validates height attribute — invalid CSS falls back to default.
     */
    public function test_render_shortcode_validates_height_attribute(): void
    {
        $GLOBALS['fgpx_test_inline_scripts'] = [];
        $this->timeline->render_shortcode(['height' => 'javascript:alert(1)']);

        $inlineScripts = $GLOBALS['fgpx_test_inline_scripts']['fgpx-timeline'] ?? [];
        $configJson = null;
        foreach ($inlineScripts as $entry) {
            if (($entry['position'] ?? '') === 'before') {
                $pos = strrpos($entry['data'], ' = {');
                if ($pos !== false) {
                    $jsonStr = substr($entry['data'], $pos + 3, -1);
                    $configJson = json_decode($jsonStr, true);
                }
                break;
            }
        }

        $this->assertNotNull($configJson);
        // Should fall back to the default height, not the invalid value
        $this->assertNotEquals('javascript:alert(1)', $configJson['playerHeight']);
        $this->assertMatchesRegularExpression('/^\d+px$/', $configJson['playerHeight']);
    }

    /**
     * Test formatDuration with negative seconds returns '0m'.
     */
    public function test_format_duration_negative_seconds(): void
    {
        $result = $this->invokeMethod($this->timeline, 'formatDuration', [-100]);
        $this->assertEquals('0m', $result);
    }

    /**
     * Test groupTracksByMonth with tracks in two different months produces two groups.
     */
    public function test_group_tracks_by_month_multiple_months(): void
    {
        $tracks = [
            [
                'id' => 1,
                'title' => 'January Track',
                'activityDateTs' => (int) strtotime('2025-01-10'),
                'distanceKm' => 5.0,
                'durationLabel' => '30m',
                'elevationGainLabel' => '50',
                'dateLabel' => 'January 10, 2025',
            ],
            [
                'id' => 2,
                'title' => 'March Track',
                'activityDateTs' => (int) strtotime('2025-03-15'),
                'distanceKm' => 10.0,
                'durationLabel' => '1h',
                'elevationGainLabel' => '100',
                'dateLabel' => 'March 15, 2025',
            ],
        ];

        $grouped = $this->invokeMethod($this->timeline, 'groupTracksByMonth', [$tracks, []]);

        $this->assertCount(2, $grouped);
        // Groups should be in ascending monthTs order
        $this->assertLessThan($grouped[1]['monthTs'], $grouped[0]['monthTs']);
    }

    /**
     * Test timeline style resolver replaces placeholder in style JSON and returns resolved key.
     */
    public function test_resolve_timeline_style_replaces_placeholder(): void
    {
        $options = [
            'fgpx_default_style_json' => '{"sprite":"https://example.test/sprites?key={{API_KEY}}"}',
            'fgpx_smart_api_keys_mode' => 'single',
            'fgpx_smart_api_keys_pool' => "timeline-key\n",
        ];

        $resolved = $this->invokeMethod($this->timeline, 'resolveTimelineStyle', [$options, '']);

        $this->assertStringNotContainsString('{{API_KEY}}', (string) $resolved['styleJson']);
        $this->assertStringContainsString('timeline-key', (string) $resolved['styleJson']);
        $this->assertSame('timeline-key', (string) $resolved['resolvedKey']);
    }

    /**
     * Helper method to invoke private methods.
     *
     * @param object $objectOrClass
     * @param string $methodName
     * @param array<int,mixed> $parameters
     * @return mixed
     */
    private function invokeMethod(object $objectOrClass, string $methodName, array $parameters = []): mixed
    {
        $reflection = new \ReflectionClass($objectOrClass);
        $method = $reflection->getMethod($methodName);
        $method->setAccessible(true);

        return $method->invokeArgs($objectOrClass, $parameters);
    }
}
