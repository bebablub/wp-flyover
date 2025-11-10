<?php
/**
 * Flyover GPX - WordPress Plugin
 * 
 * A comprehensive WordPress plugin for uploading, processing, and displaying GPX tracks
 * with interactive maps, elevation charts, weather data, and photo integration.
 * 
 * Plugin Name: Flyover GPX
 * Description: Upload GPX files and render animated flyover maps with MapLibre and an elevation chart.
 * Version: 1.0.0
 * Author: Benjamin Barinka and ChatGPT5
 * Requires PHP: 7.4
 * Requires at least: 6.0
 * Text Domain: flyover-gpx
 * 
 * @package FlyoverGPX
 * @version 1.0.0
 * @author Benjamin Barinka and ChatGPT5
 * @license GPL-2.0+
 * @since 1.0.0
 */

declare(strict_types=1);

namespace FGpx;

// Prevent direct access to this file
if (!\defined('ABSPATH')) {
    exit;
}

/**
 * Plugin Constants
 * 
 * Define essential plugin constants for version, paths, and URLs.
 * These constants are used throughout the plugin for consistency.
 */
\define('FGPX_VERSION', '1.0.0');           // Plugin version for cache busting and compatibility
\define('FGPX_FILE', __FILE__);             // Main plugin file path
\define('FGPX_DIR_PATH', plugin_dir_path(__FILE__)); // Plugin directory path
\define('FGPX_DIR_URL', plugin_dir_url(__FILE__));   // Plugin directory URL

/**
 * Composer Autoloader
 * 
 * Attempts to load Composer dependencies. If not found, displays an admin notice
 * instructing administrators to run 'composer install' in the plugin directory.
 * This is required for the phpGPX library and other dependencies.
 */
$autoload = FGPX_DIR_PATH . 'vendor/autoload.php';
if (\file_exists($autoload)) {
    require_once $autoload;
} else {
    /**
     * Display admin notice for missing Composer dependencies
     * 
     * Shows a warning notice in the WordPress admin area when Composer
     * dependencies are not installed, guiding administrators to resolve the issue.
     */
    \add_action('admin_notices', static function (): void {
        // Only show to users who can manage plugins
        if (!\current_user_can('manage_options')) {
            return;
        }
        
        $pluginDir = \esc_html(\basename(\dirname(FGPX_FILE)));
        echo '<div class="notice notice-warning"><p>'
            . \esc_html__('Flyover GPX: dependencies not installed. Please run', 'flyover-gpx')
            . ' <code>composer install</code> '
            . \esc_html__('in the plugin directory', 'flyover-gpx')
            . ' (' . $pluginDir . ').</p></div>';
    });
}

/**
 * Manual Class Includes
 * 
 * Load all plugin classes in dependency order. This manual approach is used
 * until a proper PSR-4 autoloader is implemented via Composer.
 * 
 * Load order is important:
 * 1. Options - Configuration management
 * 2. ErrorHandler - Error logging and handling
 * 3. AssetManager - Asset loading and fallbacks
 * 4. DatabaseOptimizer - Database performance optimizations
 * 5. Plugin - Core plugin functionality and post type registration
 * 6. Rest - REST API endpoints for frontend data
 * 7. Admin - WordPress admin interface and upload handling
 * 8. CLI - Command-line interface for batch operations
 */
require_once FGPX_DIR_PATH . 'includes/Options.php';          // Configuration management
require_once FGPX_DIR_PATH . 'includes/ErrorHandler.php';    // Error logging system
require_once FGPX_DIR_PATH . 'includes/AssetManager.php';    // Asset loading and CDN fallbacks
require_once FGPX_DIR_PATH . 'includes/DatabaseOptimizer.php'; // Database performance optimizations
require_once FGPX_DIR_PATH . 'includes/Plugin.php';          // Core plugin functionality
require_once FGPX_DIR_PATH . 'includes/Rest.php';            // REST API endpoints
require_once FGPX_DIR_PATH . 'includes/Admin.php';           // Admin interface and upload handling
require_once FGPX_DIR_PATH . 'includes/CLI.php';             // Command-line interface

/**
 * Bootstrap the plugin after all plugins are loaded.
 */
\add_action('plugins_loaded', static function (): void {
    // Initialize error handling and logging first
    ErrorHandler::init();
    
    // Initialize database optimizations early
    DatabaseOptimizer::init();

    $plugin = new Plugin();
    $plugin->register();

    $rest = new Rest();
    $rest->register();

    $admin = new Admin();
    $admin->register();

    if (\defined('WP_CLI') && WP_CLI) {
        $cli = new CLI();
        $cli->register();
    }
});
