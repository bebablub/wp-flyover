<?php

declare(strict_types=1);

namespace FGpx;

if (!\defined('ABSPATH')) {
	exit;
}

/**
 * Centralized error handling and logging system.
 * Provides consistent error reporting, logging, and user feedback.
 */
final class ErrorHandler
{
	/**
	 * Error log file path.
	 * @var string
	 */
	private static $logFile = '';

	/**
	 * Maximum log file size in bytes (5MB).
	 * @var int
	 */
	private static $maxLogSize = 5242880;

	/**
	 * Whether debug logging is enabled.
	 * @var bool|null
	 */
	private static $debugEnabled = null;

	/**
	 * Error severity levels.
	 */
	public const LEVEL_DEBUG = 'DEBUG';
	public const LEVEL_INFO = 'INFO';
	public const LEVEL_WARNING = 'WARNING';
	public const LEVEL_ERROR = 'ERROR';
	public const LEVEL_CRITICAL = 'CRITICAL';

	/**
	 * Initialize error handling system.
	 */
	public static function init(): void
	{
		// Set up log file path
		$uploadDir = \wp_upload_dir();
		$logDir = $uploadDir['basedir'] . '/flyover-gpx-logs';
		
		// Create log directory if it doesn't exist
		if (!\is_dir($logDir)) {
			\wp_mkdir_p($logDir);
			
			// Add .htaccess to protect log files
			$htaccessFile = $logDir . '/.htaccess';
			if (!\file_exists($htaccessFile)) {
				\file_put_contents($htaccessFile, "Deny from all\n");
			}
		}

		self::$logFile = $logDir . '/flyover-gpx.log';

		// Register error handlers
		\add_action('wp_ajax_fgpx_clear_logs', [self::class, 'ajaxClearLogs']);
		\add_action('wp_ajax_fgpx_download_logs', [self::class, 'ajaxDownloadLogs']);
		
		// Hook into WordPress error handling
		\add_action('wp_die_handler', [self::class, 'handleWpDie'], 10, 1);
	}

	/**
	 * Check if debug logging is enabled.
	 * 
	 * @return bool True if debug logging is enabled
	 */
	private static function isDebugEnabled(): bool
	{
		if (self::$debugEnabled === null) {
			$options = Options::getAll();
			self::$debugEnabled = $options['fgpx_debug_logging'] === '1';
		}
		return self::$debugEnabled;
	}

	/**
	 * Log a message with specified severity level.
	 * 
	 * @param string $level Severity level
	 * @param string $message Log message
	 * @param array<string, mixed> $context Additional context data
	 */
	public static function log(string $level, string $message, array $context = []): void
	{
		// Skip debug messages if debug logging is disabled
		if ($level === self::LEVEL_DEBUG && !self::isDebugEnabled()) {
			return;
		}

		// Format log entry
		$timestamp = \current_time('Y-m-d H:i:s');
		$contextStr = !empty($context) ? ' | Context: ' . \wp_json_encode($context) : '';
		$logEntry = "[{$timestamp}] [{$level}] {$message}{$contextStr}\n";

		// Rotate log if it's too large
		self::rotateLogIfNeeded();

		// Write to log file
		\error_log($logEntry, 3, self::$logFile);

		// Also log critical errors to WordPress debug log
		if (\in_array($level, [self::LEVEL_ERROR, self::LEVEL_CRITICAL], true) && \defined('WP_DEBUG_LOG') && WP_DEBUG_LOG) {
			\error_log("Flyover GPX [{$level}]: {$message}");
		}
	}

	/**
	 * Log debug message.
	 * 
	 * @param string $message Debug message
	 * @param array<string, mixed> $context Additional context
	 */
	public static function debug(string $message, array $context = []): void
	{
		self::log(self::LEVEL_DEBUG, $message, $context);
	}

	/**
	 * Log info message.
	 * 
	 * @param string $message Info message
	 * @param array<string, mixed> $context Additional context
	 */
	public static function info(string $message, array $context = []): void
	{
		self::log(self::LEVEL_INFO, $message, $context);
	}

	/**
	 * Log warning message.
	 * 
	 * @param string $message Warning message
	 * @param array<string, mixed> $context Additional context
	 */
	public static function warning(string $message, array $context = []): void
	{
		self::log(self::LEVEL_WARNING, $message, $context);
	}

	/**
	 * Log error message.
	 * 
	 * @param string $message Error message
	 * @param array<string, mixed> $context Additional context
	 */
	public static function error(string $message, array $context = []): void
	{
		self::log(self::LEVEL_ERROR, $message, $context);
	}

	/**
	 * Log critical error message.
	 * 
	 * @param string $message Critical error message
	 * @param array<string, mixed> $context Additional context
	 */
	public static function critical(string $message, array $context = []): void
	{
		self::log(self::LEVEL_CRITICAL, $message, $context);
	}

	/**
	 * Handle exceptions with proper logging and user feedback.
	 * 
	 * @param \Throwable $exception Exception to handle
	 * @param string $context Context where exception occurred
	 * @param bool $userFriendly Whether to show user-friendly message
	 * @return \WP_Error WP_Error object for consistent error handling
	 */
	public static function handleException(\Throwable $exception, string $context = '', bool $userFriendly = true): \WP_Error
	{
		$message = $exception->getMessage();
		$file = $exception->getFile();
		$line = $exception->getLine();
		$trace = $exception->getTraceAsString();

		// Log detailed error information
		self::error("Exception in {$context}: {$message}", [
			'file' => $file,
			'line' => $line,
			'trace' => $trace,
			'context' => $context,
		]);

		// Create user-friendly error message
		$userMessage = $userFriendly 
			? \esc_html__('An error occurred while processing your request. Please try again or contact support if the problem persists.', 'flyover-gpx')
			: $message;

		return new \WP_Error('fgpx_exception', $userMessage, [
			'exception' => $exception,
			'context' => $context,
		]);
	}

	/**
	 * Handle API errors with proper logging and response formatting.
	 * 
	 * @param string $message Error message
	 * @param int $httpCode HTTP status code
	 * @param array<string, mixed> $context Additional context
	 * @return never
	 */
	public static function handleApiError(string $message, int $httpCode = 500, array $context = []): void
	{
		self::error("API Error: {$message}", \array_merge($context, ['http_code' => $httpCode]));

		\wp_send_json_error([
			'message' => $message,
			'code' => 'fgpx_api_error',
		], $httpCode);
	}

	/**
	 * Handle file operation errors.
	 * 
	 * @param string $operation File operation type
	 * @param string $filepath File path
	 * @param string $error Error message
	 * @return \WP_Error
	 */
	public static function handleFileError(string $operation, string $filepath, string $error): \WP_Error
	{
		self::error("File {$operation} failed: {$error}", [
			'operation' => $operation,
			'filepath' => $filepath,
			'error' => $error,
		]);

		return new \WP_Error('fgpx_file_error', 
			\sprintf(
				\esc_html__('File %s failed: %s', 'flyover-gpx'),
				$operation,
				$error
			)
		);
	}

	/**
	 * Handle database errors.
	 * 
	 * @param string $operation Database operation
	 * @param string $error Error message
	 * @param array<string, mixed> $context Additional context
	 * @return \WP_Error
	 */
	public static function handleDatabaseError(string $operation, string $error, array $context = []): \WP_Error
	{
		self::error("Database {$operation} failed: {$error}", \array_merge($context, [
			'operation' => $operation,
			'error' => $error,
		]));

		return new \WP_Error('fgpx_db_error',
			\esc_html__('Database operation failed. Please try again.', 'flyover-gpx')
		);
	}

	/**
	 * Rotate log file if it exceeds maximum size.
	 */
	private static function rotateLogIfNeeded(): void
	{
		if (!\file_exists(self::$logFile)) {
			return;
		}

		$fileSize = \filesize(self::$logFile);
		if ($fileSize === false || $fileSize < self::$maxLogSize) {
			return;
		}

		// Create backup of current log
		$backupFile = self::$logFile . '.old';
		if (\file_exists($backupFile)) {
			\unlink($backupFile);
		}

		\rename(self::$logFile, $backupFile);

		// Log rotation event
		self::info('Log file rotated', ['old_size' => $fileSize]);
	}

	/**
	 * Get log file contents for admin viewing.
	 * 
	 * @param int $lines Number of lines to retrieve (default: 100)
	 * @return array<string> Log lines
	 */
	public static function getLogContents(int $lines = 100): array
	{
		if (!\file_exists(self::$logFile)) {
			return [];
		}

		$content = \file_get_contents(self::$logFile);
		if ($content === false) {
			return [];
		}

		$logLines = \explode("\n", $content);
		$logLines = \array_filter($logLines); // Remove empty lines

		// Return last N lines
		return \array_slice($logLines, -$lines);
	}

	/**
	 * Clear log files.
	 */
	public static function clearLogs(): void
	{
		if (\file_exists(self::$logFile)) {
			\unlink(self::$logFile);
		}

		$backupFile = self::$logFile . '.old';
		if (\file_exists($backupFile)) {
			\unlink($backupFile);
		}

		self::info('Log files cleared by admin');
	}

	/**
	 * Get log file statistics.
	 * 
	 * @return array<string, mixed> Log statistics
	 */
	public static function getLogStats(): array
	{
		$stats = [
			'log_file_exists' => \file_exists(self::$logFile),
			'log_file_size' => 0,
			'log_file_lines' => 0,
			'backup_file_exists' => \file_exists(self::$logFile . '.old'),
			'debug_enabled' => self::isDebugEnabled(),
		];

		if ($stats['log_file_exists']) {
			$stats['log_file_size'] = \filesize(self::$logFile);
			$content = \file_get_contents(self::$logFile);
			if ($content !== false) {
				$stats['log_file_lines'] = \substr_count($content, "\n");
			}
		}

		return $stats;
	}

	/**
	 * AJAX handler to clear logs.
	 */
	public static function ajaxClearLogs(): void
	{
		// Verify nonce and permissions
		if (!\wp_verify_nonce($_POST['nonce'] ?? '', 'fgpx_clear_logs') || !\current_user_can('manage_options')) {
			\wp_send_json_error(['message' => 'Permission denied'], 403);
		}

		self::clearLogs();
		\wp_send_json_success(['message' => 'Logs cleared successfully']);
	}

	/**
	 * AJAX handler to download logs.
	 */
	public static function ajaxDownloadLogs(): void
	{
		// Verify nonce and permissions
		if (!\wp_verify_nonce($_GET['nonce'] ?? '', 'fgpx_download_logs') || !\current_user_can('manage_options')) {
			\wp_die('Permission denied');
		}

		if (!\file_exists(self::$logFile)) {
			\wp_die('Log file not found');
		}

		// Set headers for file download
		\header('Content-Type: text/plain');
		\header('Content-Disposition: attachment; filename="flyover-gpx-' . \date('Y-m-d-H-i-s') . '.log"');
		\header('Content-Length: ' . \filesize(self::$logFile));

		// Output file contents
		\readfile(self::$logFile);
		exit;
	}

	/**
	 * Custom wp_die handler for better error reporting.
	 * 
	 * @param callable $handler Original handler
	 * @return callable Modified handler
	 */
	public static function handleWpDie(callable $handler): callable
	{
		return function($message, $title = '', $args = []) use ($handler) {
			// Log wp_die calls for debugging
			if (\is_string($message)) {
				self::warning("wp_die called: {$message}", [
					'title' => $title,
					'args' => $args,
				]);
			}

			// Call original handler
			return $handler($message, $title, $args);
		};
	}

	/**
	 * Format exception for logging.
	 * 
	 * @param \Throwable $exception Exception to format
	 * @return array<string, mixed> Formatted exception data
	 */
	public static function formatException(\Throwable $exception): array
	{
		return [
			'message' => $exception->getMessage(),
			'file' => $exception->getFile(),
			'line' => $exception->getLine(),
			'code' => $exception->getCode(),
			'trace' => $exception->getTraceAsString(),
		];
	}

	/**
	 * Reset debug enabled cache (for testing).
	 */
	public static function resetDebugCache(): void
	{
		self::$debugEnabled = null;
	}
}
