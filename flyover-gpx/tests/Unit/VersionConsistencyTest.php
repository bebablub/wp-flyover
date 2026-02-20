<?php

declare(strict_types=1);

namespace FGpx\Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * Regression tests for version-string consistency inside flyover-gpx.php.
 *
 * The main plugin file carries the version in three places that must always
 * agree:
 *   1.  WordPress plugin header   "Version: x.y.z"
 *   2.  PHPDoc block              "@version x.y.z"
 *   3.  PHP constant              define('FGPX_VERSION', 'x.y.z')
 *
 * Running the version-bump command with replace_all=true is the only supported
 * way to update the version.  These tests catch a partial update (e.g. only
 * two of the three locations changed) before it reaches production.
 */
final class VersionConsistencyTest extends TestCase
{
    private string $contents;

    protected function setUp(): void
    {
        // Two levels up from tests/Unit/ is the flyover-gpx/ plugin root.
        $pluginFile     = dirname(__DIR__, 2) . '/flyover-gpx.php';
        $this->contents = (string) file_get_contents($pluginFile);
    }

    // ------------------------------------------------------------------
    // Presence checks
    // ------------------------------------------------------------------

    public function test_plugin_header_version_tag_is_present(): void
    {
        $this->assertMatchesRegularExpression(
            '/^\s*\*\s*Version:\s*\S+/m',
            $this->contents,
            'Plugin header must contain a "Version:" tag'
        );
    }

    public function test_fgpx_version_constant_is_defined(): void
    {
        $this->assertMatchesRegularExpression(
            "/define\('FGPX_VERSION',\s*'[^']+'\)/",
            $this->contents,
            "define('FGPX_VERSION', ...) must be present in flyover-gpx.php"
        );
    }

    // ------------------------------------------------------------------
    // Consistency across all three locations
    // ------------------------------------------------------------------

    public function test_all_version_strings_are_identical(): void
    {
        preg_match('/^\s*\*\s*Version:\s*(\S+)/m', $this->contents, $headerMatch);
        preg_match('/^\s*\*\s*@version\s+(\S+)/m', $this->contents, $docMatch);
        preg_match("/define\('FGPX_VERSION',\s*'([^']+)'\)/", $this->contents, $constMatch);

        $headerVersion = $headerMatch[1] ?? null;
        $docVersion    = $docMatch[1]    ?? null;
        $constVersion  = $constMatch[1]  ?? null;

        $this->assertNotNull($headerVersion, 'Could not parse plugin header Version:');
        $this->assertNotNull($docVersion,    'Could not parse @version in PHPDoc');
        $this->assertNotNull($constVersion,  "Could not parse define('FGPX_VERSION', ...)");

        $this->assertSame(
            $headerVersion,
            $docVersion,
            "Plugin header Version: ({$headerVersion}) and @version ({$docVersion}) must match"
        );
        $this->assertSame(
            $headerVersion,
            $constVersion,
            "Plugin header Version: ({$headerVersion}) and FGPX_VERSION constant ({$constVersion}) must match"
        );
    }

    // ------------------------------------------------------------------
    // Format check
    // ------------------------------------------------------------------

    public function test_version_follows_semver_major_minor_patch(): void
    {
        preg_match('/^\s*\*\s*Version:\s*(\S+)/m', $this->contents, $match);
        $version = $match[1] ?? '';

        $this->assertMatchesRegularExpression(
            '/^\d+\.\d+\.\d+$/',
            $version,
            "Version '{$version}' does not follow the required major.minor.patch (SemVer) format"
        );
    }

    // ------------------------------------------------------------------
    // Minimum-requirement declarations
    // ------------------------------------------------------------------

    public function test_minimum_php_requirement_is_declared(): void
    {
        $this->assertMatchesRegularExpression(
            '/Requires PHP:\s*7\.4/',
            $this->contents,
            '"Requires PHP: 7.4" must be present in the plugin header'
        );
    }

    public function test_minimum_wordpress_requirement_is_declared(): void
    {
        $this->assertMatchesRegularExpression(
            '/Requires at least:\s*6\.0/',
            $this->contents,
            '"Requires at least: 6.0" must be present in the plugin header'
        );
    }
}
