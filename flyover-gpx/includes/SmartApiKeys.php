<?php

declare(strict_types=1);

namespace FGpx;

if (!\defined('ABSPATH')) {
    exit;
}

/**
 * Smart API key placeholder replacement and validation helpers.
 */
final class SmartApiKeys
{
    public const PLACEHOLDER = '{{API_KEY}}';
    public const DEFAULT_TEST_TEMPLATE_URL = 'https://api.maptiler.com/maps/streets-v4/?key={{API_KEY}}';
    public const MODE_OFF = 'off';
    public const MODE_SINGLE = 'single';
    public const MODE_PER_OCCURRENCE = 'per_occurrence';
    private const TEST_REQUEST_SPACING_MS = 150;
    private const TEST_RETRY_AFTER_MAX_MS = 1500;

    /**
     * Normalize mode values to supported constants.
     */
    public static function normalizeMode(string $mode): string
    {
        $clean = \sanitize_key($mode);
        if ($clean === self::MODE_SINGLE || $clean === self::MODE_PER_OCCURRENCE || $clean === self::MODE_OFF) {
            return $clean;
        }
        return self::MODE_OFF;
    }

    /**
     * Parse key pool text (one key per line).
     *
     * @return array<int, string>
     */
    public static function parseKeyPool(string $raw): array
    {
        if ($raw === '') {
            return [];
        }

        $lines = \preg_split('/\R/', $raw) ?: [];
        $keys = [];
        $seen = [];
        foreach ($lines as $line) {
            $key = \trim((string) $line);
            if ($key === '') {
                continue;
            }
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $keys[] = $key;
        }
        return $keys;
    }

    /**
     * Resolve style JSON and style URL templates by replacing API placeholders.
     *
     * Returns the resolved style data plus a single resolved key (for JS-side
     * transformRequest to handle tile URLs inside remotely-fetched style JSON).
     * resolvedKey is null when mode is off or no keys are configured.
     *
     * @return array{styleJson: string, styleUrl: string, resolvedKey: string|null}
     */
    public static function resolveStyle(string $styleJson, string $styleUrl, string $mode, string $keyPoolText): array
    {
        $normalizedMode = self::normalizeMode($mode);
        $keys = self::parseKeyPool($keyPoolText);

        if ($normalizedMode === self::MODE_OFF || $keys === []) {
            return [
                'styleJson' => $styleJson,
                'styleUrl' => $styleUrl,
                'resolvedKey' => null,
            ];
        }

        $forcedKey = null;
        if ($normalizedMode === self::MODE_SINGLE) {
            $forcedKey = self::pickRandomKey($keys);
        }

        $resolvedJson = self::replaceInStyleJson($styleJson, $keys, $normalizedMode, $forcedKey);
        $resolvedUrl = self::replacePlaceholders($styleUrl, $keys, $normalizedMode, $forcedKey);

        // For per_occurrence mode a single key is exposed for JS transformRequest;
        // each server-side occurrence already used a random key, so this one-key
        // fallback only applies to URLs MapLibre fetches after page load.
        $resolvedKey = $forcedKey ?? self::pickRandomKey($keys);

        return [
            'styleJson' => $resolvedJson,
            'styleUrl' => $resolvedUrl,
            'resolvedKey' => $resolvedKey,
        ];
    }

    /**
     * Find first URL with placeholder from style JSON, fallback to style URL.
     */
    public static function extractTemplateUrl(string $styleJson, string $styleUrl): string
    {
        if ($styleJson !== '') {
            $decoded = \json_decode($styleJson, true);
            if (\is_array($decoded)) {
                $found = self::findPlaceholderUrl($decoded);
                if ($found !== null) {
                    return $found;
                }
            }
        }

        if (self::isPlaceholderUrl($styleUrl)) {
            return $styleUrl;
        }

        return '';
    }

    /**
     * Test keys by substituting them into a placeholder URL and performing a request.
     *
     * @param array<int, string> $keys
     * @return array<int, array{keyMasked: string, ok: bool, status: int, message: string}>
     */
    public static function testKeysAgainstTemplate(string $templateUrl, array $keys, int $timeout = 6): array
    {
        $results = [];
        $keyCount = \count($keys);
        foreach ($keys as $index => $key) {
            $url = \str_replace(self::PLACEHOLDER, $key, $templateUrl);
            $url = self::normalizeProbeUrl($url);

            $ok = false;
            $status = 0;
            $message = 'Request failed';
            $response = null;
            if (\function_exists('wp_remote_get')) {
                $response = \wp_remote_get($url, [
                    'timeout' => max(1, $timeout),
                    'redirection' => 1,
                    'user-agent' => 'Flyover-GPX-API-Key-Test',
                ]);

                if (\is_wp_error($response)) {
                    $message = $response->get_error_message();
                } else {
                    if (\function_exists('wp_remote_retrieve_response_code')) {
                        $status = (int) \wp_remote_retrieve_response_code($response);
                    } elseif (\is_array($response) && isset($response['response']['code'])) {
                        $status = (int) $response['response']['code'];
                    }
                    $ok = $status >= 200 && $status < 400;
                    if ($status === 429) {
                        $retryAfterMs = self::extractRetryAfterMs($response);
                        $message = $retryAfterMs > 0
                            ? 'HTTP 429 (rate limited, backing off for ' . (string) round($retryAfterMs / 1000, 2) . 's)'
                            : 'HTTP 429 (rate limited)';
                    } else {
                        $message = $ok ? 'OK' : 'HTTP ' . (string) $status;
                    }
                }
            } else {
                $message = 'HTTP client unavailable';
            }

            $results[] = [
                'keyMasked' => self::maskKey($key),
                'ok' => $ok,
                'status' => $status,
                'message' => $message,
            ];

            if ($index < ($keyCount - 1)) {
                self::pauseBetweenKeyTests($status === 429 ? self::extractRetryAfterMs($response) : 0);
            }
        }

        return $results;
    }

    private static function pauseBetweenKeyTests(int $retryAfterMs = 0): void
    {
        $pauseMs = max(self::TEST_REQUEST_SPACING_MS, min(self::TEST_RETRY_AFTER_MAX_MS, $retryAfterMs));
        if ($pauseMs <= 0) {
            return;
        }

        if (isset($GLOBALS['fgpx_test_pause_ms']) && \is_callable($GLOBALS['fgpx_test_pause_ms'])) {
            $GLOBALS['fgpx_test_pause_ms']($pauseMs);
            return;
        }

        if (\function_exists('usleep')) {
            \usleep($pauseMs * 1000);
        }
    }

    private static function extractRetryAfterMs($response): int
    {
        $retryAfter = '';

        if (\is_array($response) && isset($response['headers']) && \is_array($response['headers'])) {
            $headers = array_change_key_case($response['headers'], CASE_LOWER);
            $retryAfter = (string) ($headers['retry-after'] ?? '');
        }

        if ($retryAfter === '') {
            return 0;
        }

        if (\ctype_digit($retryAfter)) {
            return max(0, min(self::TEST_RETRY_AFTER_MAX_MS, ((int) $retryAfter) * 1000));
        }

        $retryAt = \strtotime($retryAfter);
        if ($retryAt === false) {
            return 0;
        }

        $seconds = max(0, $retryAt - \time());
        return min(self::TEST_RETRY_AFTER_MAX_MS, $seconds * 1000);
    }

    /**
     * Normalize common style template placeholders for one-shot connectivity tests.
     */
    public static function normalizeProbeUrl(string $url): string
    {
        if ($url === '') {
            return $url;
        }

        $replacements = [
            '{z}' => '12',
            '{x}' => '2150',
            '{y}' => '1450',
            '{range}' => '0-255',
            '{fontstack}' => 'Open%20Sans%20Regular',
            '{bbox-epsg-3857}' => '-1000000,-1000000,1000000,1000000',
        ];

        return (string) \strtr($url, $replacements);
    }

    /**
     * Normalize admin test template URL.
     *
     * Supports direct {{API_KEY}} templates and base URL overrides such as
     * https://api.maptiler.com/maps/streets-v4/?key= by injecting the placeholder.
     */
    public static function normalizeTestTemplateUrl(string $url): string
    {
        $trimmed = \trim($url);
        if ($trimmed === '' || !\preg_match('#^https?://#i', $trimmed)) {
            return '';
        }

        if (\strpos($trimmed, self::PLACEHOLDER) !== false) {
            return $trimmed;
        }

        if (\preg_match('/([?&]key=)([^&#]*)/i', $trimmed) === 1) {
            return (string) \preg_replace('/([?&]key=)([^&#]*)/i', '$1' . self::PLACEHOLDER, $trimmed, 1);
        }

        $parts = \explode('#', $trimmed, 2);
        $base = $parts[0];
        $fragment = isset($parts[1]) ? '#' . $parts[1] : '';

        $separator = \strpos($base, '?') === false ? '?' : '&';
        if ($base !== '' && (\substr($base, -1) === '?' || \substr($base, -1) === '&')) {
            $separator = '';
        }

        return $base . $separator . 'key=' . self::PLACEHOLDER . $fragment;
    }

    /**
     * Resolve final key test template URL with fallback chain.
     */
    public static function resolveTestTemplateUrl(string $overrideUrl, string $autoExtractedUrl): string
    {
        $normalizedOverride = self::normalizeTestTemplateUrl($overrideUrl);
        if ($normalizedOverride !== '') {
            return $normalizedOverride;
        }

        $normalizedExtracted = self::normalizeTestTemplateUrl($autoExtractedUrl);
        if ($normalizedExtracted !== '') {
            return $normalizedExtracted;
        }

        return self::DEFAULT_TEST_TEMPLATE_URL;
    }

    /**
     * Replace placeholders in a plain string.
     *
     * @param array<int, string> $keys
     */
    public static function replacePlaceholders(string $subject, array $keys, string $mode, ?string $forcedKey = null): string
    {
        if ($subject === '' || \strpos($subject, self::PLACEHOLDER) === false || $keys === []) {
            return $subject;
        }

        $normalizedMode = self::normalizeMode($mode);
        if ($normalizedMode === self::MODE_OFF) {
            return $subject;
        }

        if ($normalizedMode === self::MODE_SINGLE) {
            $singleKey = \is_string($forcedKey) && $forcedKey !== '' ? $forcedKey : self::pickRandomKey($keys);
            return \str_replace(self::PLACEHOLDER, $singleKey, $subject);
        }

        return (string) \preg_replace_callback('/\{\{API_KEY\}\}/', static function () use ($keys): string {
            return self::pickRandomKey($keys);
        }, $subject);
    }

    /**
     * Mask API key for safer output in admin diagnostics.
     */
    public static function maskKey(string $key): string
    {
        $len = \strlen($key);
        if ($len <= 6) {
            return str_repeat('*', $len);
        }
        return \substr($key, 0, 3) . str_repeat('*', max(2, $len - 6)) . \substr($key, -3);
    }

    /**
     * @param array<int, string> $keys
     */
    private static function replaceInStyleJson(string $styleJson, array $keys, string $mode, ?string $forcedKey = null): string
    {
        if ($styleJson === '' || \strpos($styleJson, self::PLACEHOLDER) === false) {
            return $styleJson;
        }

        $decoded = \json_decode($styleJson, true);
        if (!\is_array($decoded)) {
            // Fallback for legacy malformed JSON values.
            return self::replacePlaceholders($styleJson, $keys, $mode, $forcedKey);
        }

        $replaced = self::replaceNode($decoded, $keys, $mode, $forcedKey);
        $json = \json_encode($replaced, JSON_UNESCAPED_SLASHES);
        if (!\is_string($json) || $json === '') {
            return $styleJson;
        }

        return $json;
    }

    /**
     * @param mixed $node
     * @param array<int, string> $keys
     * @return mixed
     */
    private static function replaceNode($node, array $keys, string $mode, ?string $forcedKey = null)
    {
        if (\is_string($node)) {
            return self::replacePlaceholders($node, $keys, $mode, $forcedKey);
        }

        if (!\is_array($node)) {
            return $node;
        }

        foreach ($node as $idx => $value) {
            $node[$idx] = self::replaceNode($value, $keys, $mode, $forcedKey);
        }

        return $node;
    }

    /**
     * @param mixed $node
     */
    private static function findPlaceholderUrl($node): ?string
    {
        if (\is_string($node) && self::isPlaceholderUrl($node)) {
            return $node;
        }

        if (!\is_array($node)) {
            return null;
        }

        foreach ($node as $value) {
            $found = self::findPlaceholderUrl($value);
            if ($found !== null) {
                return $found;
            }
        }

        return null;
    }

    private static function isPlaceholderUrl(string $value): bool
    {
        return \strpos($value, self::PLACEHOLDER) !== false && (bool) \preg_match('#^https?://#i', $value);
    }

    /**
     * @param array<int, string> $keys
     */
    private static function pickRandomKey(array $keys): string
    {
        $count = \count($keys);
        if ($count === 1) {
            return $keys[0];
        }
        $max = $count - 1;
        if (\function_exists('wp_rand')) {
            return $keys[(int) \wp_rand(0, $max)];
        }
        try {
            return $keys[\random_int(0, $max)];
        } catch (\Throwable $e) {
            return $keys[0];
        }
    }
}
