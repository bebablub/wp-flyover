<?php

declare(strict_types=1);

namespace FGpx\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class AdminSettingsValidationTest extends TestCase
{
    public function test_weather_sampling_is_whitelisted_to_known_modes(): void
    {
        $adminFile = dirname(__DIR__, 2) . '/includes/Admin.php';
        $source = (string) file_get_contents($adminFile);

        $this->assertStringContainsString("if (!\\in_array(\$weatherSampling, ['distance', 'time'], true))", $source);
        $this->assertStringContainsString("\$weatherSampling = 'distance';", $source);
    }

    public function test_weather_priority_order_filters_unknown_tokens_and_restores_defaults(): void
    {
        $adminFile = dirname(__DIR__, 2) . '/includes/Admin.php';
        $source = (string) file_get_contents($adminFile);

        $this->assertStringContainsString("\$allowedPriority = ['snow', 'rain', 'fog', 'clouds'];", $source);
        $this->assertStringContainsString("\\in_array(\$token, \$allowedPriority, true)", $source);
        $this->assertStringContainsString("\\implode(',', \$priorityOrderList)", $source);
    }

    public function test_generate_weather_samples_skips_invalid_timestamps_in_distance_and_fallback_modes(): void
    {
        $adminFile = dirname(__DIR__, 2) . '/includes/Admin.php';
        $source = (string) file_get_contents($adminFile);

        $this->assertStringContainsString("if (\$parsed === false) {", $source);
        $this->assertStringContainsString("continue;", $source);
    }
}
