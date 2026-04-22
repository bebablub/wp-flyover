<?php

declare(strict_types=1);

namespace FGpx\Tests\Unit;

use FGpx\GalleryShortcode;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;

final class GalleryShortcodeTest extends TestCase
{
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
}
