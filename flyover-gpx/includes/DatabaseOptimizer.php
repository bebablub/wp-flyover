<?php

declare(strict_types=1);

namespace FGpx;

if (!\defined('ABSPATH')) {
	exit;
}

/**
 * Database Query Optimizer for improved performance.
 * Handles meta query optimization, bulk operations, and caching strategies.
 */
final class DatabaseOptimizer
{
	/**
	 * Cache for bulk meta queries to avoid repeated database hits.
	 * @var array<string, array<int, mixed>>
	 */
	private static $metaCache = [];

	/**
	 * Track which post IDs have been bulk-loaded to avoid duplicate queries.
	 * @var array<string, array<int, bool>>
	 */
	private static $loadedPosts = [];

	/**
	 * Initialize database optimizations.
	 */
	public static function init(): void
	{
		// Hook into WordPress to optimize queries
		\add_action('pre_get_posts', [self::class, 'optimizeTrackQueries']);
		\add_filter('posts_clauses', [self::class, 'optimizePostsClauses'], 10, 2);
		
		// Optimize meta queries for admin list table
		\add_action('load-edit.php', [self::class, 'preloadListTableMeta']);
		
		// Clear cache when posts are updated
		\add_action('updated_post_meta', [self::class, 'clearMetaCache'], 10, 4);
		\add_action('added_post_meta', [self::class, 'clearMetaCache'], 10, 4);
		\add_action('deleted_post_meta', [self::class, 'clearMetaCache'], 10, 4);
	}

	/**
	 * Optimize queries for fgpx_track post type.
	 * 
	 * @param \WP_Query $query WordPress query object
	 */
	public static function optimizeTrackQueries(\WP_Query $query): void
	{
		if (!$query->is_main_query() || $query->get('post_type') !== 'fgpx_track') {
			return;
		}

		// Optimize sorting queries by ensuring proper indexes
		$orderby = $query->get('orderby');
		if (\in_array($orderby, ['fgpx_total_distance_m', 'fgpx_moving_time_s', 'fgpx_elevation_gain_m', 'fgpx_points_count'], true)) {
			// Ensure we're using numeric sorting for performance
			$query->set('meta_type', 'NUMERIC');
			
			// Limit posts per page for better performance on large datasets
			if (!$query->get('posts_per_page') || $query->get('posts_per_page') === -1) {
				$query->set('posts_per_page', 20);
			}
		}

		// Add performance hints for large datasets
		if (\is_admin() && $query->is_main_query()) {
			// Use SQL_CALC_FOUND_ROWS only when needed for pagination
			$query->set('no_found_rows', false);
		}
	}

	/**
	 * Optimize SQL clauses for better performance.
	 * 
	 * @param array<string, string> $clauses SQL clauses
	 * @param \WP_Query $query WordPress query object
	 * @return array<string, string> Optimized clauses
	 */
	public static function optimizePostsClauses(array $clauses, \WP_Query $query): array
	{
		if ($query->get('post_type') !== 'fgpx_track') {
			return $clauses;
		}

		global $wpdb;

		// Optimize meta queries by using proper indexes
		$orderby = $query->get('orderby');
		if (\in_array($orderby, ['fgpx_total_distance_m', 'fgpx_moving_time_s', 'fgpx_elevation_gain_m', 'fgpx_points_count'], true)) {
			// Ensure we use the meta_value index efficiently
			$metaKey = $query->get('meta_key');
			if ($metaKey) {
				// Add index hint for better performance on large datasets
				$clauses['join'] = \str_replace(
					"INNER JOIN {$wpdb->postmeta} ON",
					"INNER JOIN {$wpdb->postmeta} USE INDEX (meta_key) ON",
					$clauses['join']
				);
			}
		}

		return $clauses;
	}

	/**
	 * Preload meta data for admin list table to reduce query count.
	 */
	public static function preloadListTableMeta(): void
	{
		global $typenow;
		
		if ($typenow !== 'fgpx_track') {
			return;
		}

		// Hook into the posts query to bulk load meta data
		\add_action('the_posts', [self::class, 'bulkLoadTrackMeta'], 10, 2);
	}

	/**
	 * Bulk load track meta data to reduce database queries.
	 * 
	 * @param array<\WP_Post> $posts Array of post objects
	 * @param \WP_Query $query Query object
	 * @return array<\WP_Post> Unmodified posts array
	 */
	public static function bulkLoadTrackMeta(array $posts, \WP_Query $query): array
	{
		if (empty($posts) || $query->get('post_type') !== 'fgpx_track') {
			return $posts;
		}

		$postIds = \array_map(function($post) { return (int) $post->ID; }, $posts);
		
		// Define meta keys we need for the admin list table
		$metaKeys = [
			'fgpx_stats',
			'fgpx_total_distance_m',
			'fgpx_moving_time_s',
			'fgpx_elevation_gain_m',
			'fgpx_points_count',
			'fgpx_weather_points',
			'fgpx_weather_summary',
		];

		// Bulk load all meta data in a single query per meta key
		foreach ($metaKeys as $metaKey) {
			self::bulkLoadPostMeta($postIds, $metaKey);
		}

		return $posts;
	}

	/**
	 * Bulk load specific meta data for multiple posts.
	 * 
	 * @param array<int> $postIds Array of post IDs
	 * @param string $metaKey Meta key to load
	 */
	public static function bulkLoadPostMeta(array $postIds, string $metaKey): void
	{
		if (empty($postIds)) {
			return;
		}

		// Check if we've already loaded this meta key for these posts
		$cacheKey = $metaKey;
		if (isset(self::$loadedPosts[$cacheKey])) {
			$alreadyLoaded = \array_intersect($postIds, \array_keys(self::$loadedPosts[$cacheKey]));
			$postIds = \array_diff($postIds, $alreadyLoaded);
		}

		if (empty($postIds)) {
			return;
		}

		global $wpdb;

		// Single query to get all meta values for all posts
		$postIdList = \implode(',', \array_map('intval', $postIds));
		$results = $wpdb->get_results($wpdb->prepare(
			"SELECT post_id, meta_value FROM {$wpdb->postmeta} 
			 WHERE post_id IN ({$postIdList}) AND meta_key = %s",
			$metaKey
		));

		// Cache the results
		if (!isset(self::$metaCache[$cacheKey])) {
			self::$metaCache[$cacheKey] = [];
		}

		if (!isset(self::$loadedPosts[$cacheKey])) {
			self::$loadedPosts[$cacheKey] = [];
		}

		foreach ($results as $row) {
			$postId = (int) $row->post_id;
			$value = $row->meta_value;
			
			// Unserialize if needed (WordPress meta values are often serialized)
			$unserializedValue = \maybe_unserialize($value);
			
			self::$metaCache[$cacheKey][$postId] = $unserializedValue;
			self::$loadedPosts[$cacheKey][$postId] = true;
		}

		// Mark posts without meta values as loaded (to avoid repeated queries)
		foreach ($postIds as $postId) {
			if (!isset(self::$metaCache[$cacheKey][$postId])) {
				self::$metaCache[$cacheKey][$postId] = '';
				self::$loadedPosts[$cacheKey][$postId] = true;
			}
		}
	}

	/**
	 * Get cached meta value or fall back to WordPress get_post_meta.
	 * 
	 * @param int $postId Post ID
	 * @param string $metaKey Meta key
	 * @param bool $single Whether to return single value
	 * @return mixed Meta value
	 */
	public static function getPostMeta(int $postId, string $metaKey, bool $single = false)
	{
		// Check our cache first
		if (isset(self::$metaCache[$metaKey][$postId])) {
			$value = self::$metaCache[$metaKey][$postId];
			return $single ? $value : [$value];
		}

		// Fall back to WordPress function
		return \get_post_meta($postId, $metaKey, $single);
	}

	/**
	 * Bulk update multiple meta values efficiently.
	 * 
	 * @param int $postId Post ID
	 * @param array<string, mixed> $metaData Array of meta_key => meta_value pairs
	 */
	public static function bulkUpdatePostMeta(int $postId, array $metaData): void
	{
		if (empty($metaData)) {
			return;
		}

		global $wpdb;

		// Prepare values for bulk insert/update
		$values = [];
		$placeholders = [];

		foreach ($metaData as $metaKey => $metaValue) {
			$serializedValue = \maybe_serialize($metaValue);
			$values[] = $postId;
			$values[] = $metaKey;
			$values[] = $serializedValue;
			$placeholders[] = '(%d, %s, %s)';
			
			// Update our cache
			if (!isset(self::$metaCache[$metaKey])) {
				self::$metaCache[$metaKey] = [];
			}
			self::$metaCache[$metaKey][$postId] = $metaValue;
		}

		if (empty($values)) {
			return;
		}

		// Use ON DUPLICATE KEY UPDATE for efficient upsert
		$sql = "INSERT INTO {$wpdb->postmeta} (post_id, meta_key, meta_value) VALUES " 
			 . \implode(', ', $placeholders) 
			 . " ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)";

		$wpdb->query($wpdb->prepare($sql, $values));

		// Clear WordPress meta cache for this post
		\wp_cache_delete($postId, 'post_meta');
	}

	/**
	 * Get multiple posts with their meta data in an optimized way.
	 * 
	 * @param array<int> $postIds Array of post IDs
	 * @param array<string> $metaKeys Array of meta keys to load
	 * @return array<int, array<string, mixed>> Post ID => meta data array
	 */
	public static function getPostsWithMeta(array $postIds, array $metaKeys): array
	{
		if (empty($postIds) || empty($metaKeys)) {
			return [];
		}

		// Bulk load all requested meta keys
		foreach ($metaKeys as $metaKey) {
			self::bulkLoadPostMeta($postIds, $metaKey);
		}

		// Compile results
		$results = [];
		foreach ($postIds as $postId) {
			$results[$postId] = [];
			foreach ($metaKeys as $metaKey) {
				$results[$postId][$metaKey] = self::getPostMeta($postId, $metaKey, true);
			}
		}

		return $results;
	}

	/**
	 * Clear meta cache when post meta is updated.
	 * 
	 * WordPress passes different parameter types depending on the deletion method:
	 * - delete_post_meta(): $metaId is int
	 * - delete_post_meta_by_key(): $metaId is array of ints
	 * 
	 * @param int|array<int> $metaId Meta ID(s) - can be int or array of ints
	 * @param int $objectId Post ID
	 * @param string $metaKey Meta key
	 * @param mixed $metaValue Meta value
	 */
	public static function clearMetaCache($metaId, int $objectId, string $metaKey, $metaValue): void
	{
		// Handle both single int and array of ints (for delete_post_meta_by_key)
		// No validation needed - we just clear cache regardless of meta ID(s)
		
		// Clear our cache for this specific post and meta key
		if (isset(self::$metaCache[$metaKey][$objectId])) {
			unset(self::$metaCache[$metaKey][$objectId]);
		}

		if (isset(self::$loadedPosts[$metaKey][$objectId])) {
			unset(self::$loadedPosts[$metaKey][$objectId]);
		}
	}

	/**
	 * Clear all cached meta data.
	 */
	public static function clearAllCache(): void
	{
		self::$metaCache = [];
		self::$loadedPosts = [];
	}

	/**
	 * Get cache statistics for debugging.
	 * 
	 * @return array<string, mixed> Cache statistics
	 */
	public static function getCacheStats(): array
	{
		$totalCachedPosts = 0;
		$metaKeysCount = \count(self::$metaCache);
		
		foreach (self::$metaCache as $metaKey => $posts) {
			$totalCachedPosts += \count($posts);
		}

		return [
			'meta_keys_cached' => $metaKeysCount,
			'total_cached_entries' => $totalCachedPosts,
			'memory_usage_bytes' => \strlen(\serialize(self::$metaCache)),
			'loaded_posts_count' => \array_sum(\array_map('count', self::$loadedPosts)),
		];
	}

	/**
	 * Create database indexes for better performance (run during plugin activation).
	 */
	public static function createOptimalIndexes(): void
	{
		global $wpdb;

		// Create composite indexes for common meta queries
		$indexes = [
			// Index for sorting by numeric meta values
			"CREATE INDEX IF NOT EXISTS idx_fgpx_meta_numeric ON {$wpdb->postmeta} (meta_key, CAST(meta_value AS DECIMAL(10,2)))",
			
			// Index for meta key + post ID lookups
			"CREATE INDEX IF NOT EXISTS idx_fgpx_meta_key_post ON {$wpdb->postmeta} (meta_key, post_id)",
		];

		foreach ($indexes as $sql) {
			$wpdb->query($sql);
		}
	}

	/**
	 * Remove custom indexes (run during plugin deactivation).
	 */
	public static function removeOptimalIndexes(): void
	{
		global $wpdb;

		$indexes = [
			"DROP INDEX IF EXISTS idx_fgpx_meta_numeric ON {$wpdb->postmeta}",
			"DROP INDEX IF EXISTS idx_fgpx_meta_key_post ON {$wpdb->postmeta}",
		];

		foreach ($indexes as $sql) {
			$wpdb->query($sql);
		}
	}
}
