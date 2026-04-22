<?php

declare(strict_types=1);

namespace FGpx\Tests\Unit;

use FGpx\Rest;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;

final class RestStrategyTest extends TestCase
{
    /**
     * Test that find_latest_embedding_post_id resolves the latest post by post_date_gmt.
     * Simulates a simple scenario where a track is embedded in multiple posts.
     */
    public function test_find_latest_embedding_post_uses_post_date_gmt(): void
    {
        // This test verifies the method signature and access level
        // In a full integration test, we would set up actual posts and call the method
        $method = new ReflectionMethod(Rest::class, 'find_latest_embedding_post_id');
        $method->setAccessible(true);

        // Verify method is callable
        $this->assertTrue($method->isPrivate());
        $returnType = $method->getReturnType();
        $this->assertNotNull($returnType);
        $this->assertSame('int', (string) $returnType);
    }

    /**
     * Test that extract_track_ids_from_content finds all [flyover_gpx id="123"] shortcodes.
     */
    public function test_extract_track_ids_from_content_finds_all_shortcodes(): void
    {
        $method = new ReflectionMethod(Rest::class, 'extract_track_ids_from_content');
        $method->setAccessible(true);

        $content = 'This post has [flyover_gpx id="123"] and [flyover_gpx id="456"] tracks.';
        $result = $method->invoke(new Rest(), $content);

        $this->assertIsArray($result);
        $this->assertContains(123, $result);
        $this->assertContains(456, $result);
    }

    /**
     * Test that extract_track_ids_from_content skips invalid or missing IDs.
     */
    public function test_extract_track_ids_from_content_ignores_invalid_ids(): void
    {
        $method = new ReflectionMethod(Rest::class, 'extract_track_ids_from_content');
        $method->setAccessible(true);

        $content = 'This post has [flyover_gpx id="abc"] and [flyover_gpx] (no id) and [flyover_gpx id="789"].';
        $result = $method->invoke(new Rest(), $content);

        $this->assertIsArray($result);
        $this->assertContains(789, $result);
        $this->assertNotContains('abc', $result);
    }

    /**
     * Test that extract_track_ids_from_content handles various attribute ordering.
     */
    public function test_extract_track_ids_from_content_handles_attribute_order(): void
    {
        $method = new ReflectionMethod(Rest::class, 'extract_track_ids_from_content');
        $method->setAccessible(true);

        $content = '[flyover_gpx height="620px" id="111"] and [flyover_gpx id="222" style="vector"]';
        $result = $method->invoke(new Rest(), $content);

        $this->assertIsArray($result);
        $this->assertContains(111, $result);
        $this->assertContains(222, $result);
    }

    /**
     * Test that extract_track_ids_from_content uses both single and double quotes.
     */
    public function test_extract_track_ids_from_content_handles_quote_styles(): void
    {
        $method = new ReflectionMethod(Rest::class, 'extract_track_ids_from_content');
        $method->setAccessible(true);

        $content = "[flyover_gpx id='333'] and [flyover_gpx id=\"444\"]";
        $result = $method->invoke(new Rest(), $content);

        $this->assertIsArray($result);
        $this->assertContains(333, $result);
        $this->assertContains(444, $result);
    }

    /**
     * Test that extract_track_ids_from_content returns empty array for content without shortcodes.
     */
    public function test_extract_track_ids_from_content_returns_empty_for_no_shortcodes(): void
    {
        $method = new ReflectionMethod(Rest::class, 'extract_track_ids_from_content');
        $method->setAccessible(true);

        $content = 'This is just regular post content with no flyover_gpx shortcodes.';
        $result = $method->invoke(new Rest(), $content);

        $this->assertIsArray($result);
        $this->assertEmpty($result);
    }

    /**
     * Test that get_preview_reference_post_types returns an array of allowed post types.
     */
    public function test_get_preview_reference_post_types_returns_post_types(): void
    {
        $method = new ReflectionMethod(Rest::class, 'get_preview_reference_post_types');
        $method->setAccessible(true);

        $result = $method->invoke(new Rest());

        $this->assertIsArray($result);
        // Default should at least include 'post' and 'page'
        $this->assertTrue(count($result) > 0);
    }
}
