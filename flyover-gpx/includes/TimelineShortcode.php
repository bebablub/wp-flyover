<?php

declare(strict_types=1);

namespace FGpx;

if (!\defined('ABSPATH')) {
    exit;
}

/**
 * Timeline shortcode for chronological track visualization.
 */
final class TimelineShortcode
{
    /**
     * Register WordPress hooks.
     */
    public function register(): void
    {
        \add_shortcode('flyover_gpx_timeline', [$this, 'render_shortcode']);
        \add_action('rest_api_init', [$this, 'register_routes']);
        \add_action('wp_ajax_fgpx_timeline_tracks', [$this, 'ajax_get_tracks']);
        \add_action('wp_ajax_nopriv_fgpx_timeline_tracks', [$this, 'ajax_get_tracks']);
    }

    /**
     * Register timeline routes.
     */
    public function register_routes(): void
    {
        \register_rest_route(
            'fgpx/v1',
            '/timeline/tracks',
            [
                'methods' => 'GET',
                'callback' => [$this, 'get_timeline_tracks'],
                // Timeline is public-facing like gallery (matches gallery pattern)
                'permission_callback' => '__return_true',
            ]
        );
    }

    /**
     * REST endpoint for timeline track data.
     */
    public function get_timeline_tracks(\WP_REST_Request $request): \WP_REST_Response
    {
        return new \WP_REST_Response($this->buildTimelinePayload((array) $request->get_params()), 200);
    }

    /**
     * AJAX fallback for timeline track data.
     */
    public function ajax_get_tracks(): void
    {
        \wp_send_json($this->buildTimelinePayload((array) $_GET), 200);
    }

    /**
     * Render the [flyover_gpx_timeline] shortcode.
     *
     * @param array<string,mixed> $atts
     */
    public function render_shortcode(array $atts = []): string
    {
        $options = Options::getAll();
        $frontendOptions = Options::getForFrontend();

        $timelineDefaultOrientation = \sanitize_key((string) ($options['fgpx_timeline_orientation'] ?? 'vertical'));
        if (!\in_array($timelineDefaultOrientation, ['vertical', 'horizontal'], true)) {
            $timelineDefaultOrientation = 'vertical';
        }

        $timelineDefaultPerPage = (int) ($options['fgpx_timeline_per_page'] ?? 20);
        $timelineDefaultPerPage = max(10, min(50, $timelineDefaultPerPage));

        $defaults = [
            'orientation' => $timelineDefaultOrientation,
            'per_page' => (string) $timelineDefaultPerPage,
            'card_width' => (string) ($options['fgpx_timeline_card_width'] ?? '280px'),
            'card_height' => (string) ($options['fgpx_timeline_card_height'] ?? '280px'),
            'month_grouping' => (string) ($options['fgpx_timeline_month_grouping'] ?? '1'),
            'style' => $options['fgpx_default_style'],
            'style_url' => $options['fgpx_default_style_url'],
            'photo_order_mode' => \sanitize_key((string) ($options['fgpx_photo_order_mode'] ?? 'geo_first')),
        ];

        $atts = \shortcode_atts($defaults, $atts, 'flyover_gpx_timeline');

        $orientation = \sanitize_key((string) $atts['orientation']);
        if (!\in_array($orientation, ['vertical', 'horizontal'], true)) {
            $orientation = 'vertical';
        }

        $perPage = (int) $atts['per_page'];
        if ($perPage < 10) {
            $perPage = 10;
        }
        if ($perPage > 50) {
            $perPage = 50;
        }

        $cardWidth = $this->sanitizeCssLength((string) ($atts['card_width'] ?? ''), '280px');
        $cardHeight = $this->sanitizeCssLength((string) ($atts['card_height'] ?? ''), '280px');

        $monthGroupingRaw = \strtolower(\trim((string) ($atts['month_grouping'] ?? '1')));
        $monthGrouping = \in_array($monthGroupingRaw, ['1', 'true', 'yes', 'on'], true);

        $style = \sanitize_key((string) $atts['style']);
        if ($style === 'raster') {
            $style = 'default';
        }
        if ($style === 'vector') {
            $style = 'url';
        }
        if (!\in_array($style, ['default', 'url', 'inline'], true)) {
            $style = 'default';
        }

        $styleUrlRaw = \trim((string) ($atts['style_url'] ?? ''));
        $resolvedStyle = $this->resolveTimelineStyle($options, $styleUrlRaw);
        $styleUrl = $resolvedStyle['styleUrl'];
        $styleJson = $resolvedStyle['styleJson'];
        $resolvedApiKey = $resolvedStyle['resolvedKey'];

        $photoOrderMode = \sanitize_key((string) ($atts['photo_order_mode'] ?? $options['fgpx_photo_order_mode'] ?? 'geo_first'));
        if (!\in_array($photoOrderMode, ['geo_first', 'time_first'], true)) {
            $photoOrderMode = 'geo_first';
        }
        $debugLogging = (($options['fgpx_debug_logging'] ?? '0') === '1');

        $themeMode = \sanitize_key((string) ($options['fgpx_theme_mode'] ?? 'system'));
        if ($themeMode === 'dark') {
            $themeAttr = ' data-fgpx-theme="dark"';
        } elseif ($themeMode === 'bright') {
            $themeAttr = ' data-fgpx-theme="light"';
        } else {
            $themeAttr = '';
        }

        global $post;
        $hostPostId = ($post && isset($post->ID)) ? (int) $post->ID : 0;
        $restBase = \esc_url_raw(\site_url('/wp-json/fgpx/v1'));
        $playerConfig = array_merge(
            $frontendOptions,
            [
                'restUrl' => $restBase,
                'restBase' => $restBase,
                'nonce' => \wp_create_nonce('wp_rest'),
                'ajaxUrl' => \esc_url_raw(\admin_url('admin-ajax.php')),
                'pluginUrl' => \esc_url_raw(\trailingslashit(FGPX_DIR_URL)),
                'preferAjaxFirst' => (($options['fgpx_ajax_first'] ?? '0') === '1'),
                'hostPostId' => $hostPostId,
                'styleJson' => (string) $styleJson,
                'mapSelectorDefault' => (function() use ($options): string {
                    $value = \sanitize_key((string) ($options['fgpx_map_selector_default'] ?? 'satellite'));
                    if ($value === 'basic' || $value === '') {
                        return 'satellite';
                    }
                    if ($value === 'basic_contours') {
                        return 'satellite_contours';
                    }

                    return \in_array($value, ['satellite', 'satellite_contours'], true) ? $value : 'satellite';
                })(),
                'contoursEnabled' => (($options['fgpx_contours_enabled'] ?? '1') === '1'),
                'contoursTilesUrl' => (string) ($options['fgpx_contours_tiles_url'] ?? ''),
                'contoursSourceLayer' => (string) ($options['fgpx_contours_source_layer'] ?? 'contour'),
                'satelliteLayerId' => (string) ($options['fgpx_satellite_layer_id'] ?? 'satellite'),
                'satelliteTilesUrl' => (string) ($options['fgpx_satellite_tiles_url'] ?? ''),
                'contoursColor' => (string) ($options['fgpx_contours_color'] ?? '#ffffff'),
                'contoursWidth' => (float) ($options['fgpx_contours_width'] ?? '1.2'),
                'contoursOpacity' => (float) ($options['fgpx_contours_opacity'] ?? '0.75'),
                'contoursMinZoom' => (int) ($options['fgpx_contours_minzoom'] ?? '9'),
                'contoursMaxZoom' => (int) ($options['fgpx_contours_maxzoom'] ?? '16'),
                'weatherEnabled' => (($options['fgpx_weather_enabled'] ?? '0') === '1'),
                'weatherOpacity' => (float) ($options['fgpx_weather_opacity'] ?? '0.7'),
                'weatherVisibleByDefault' => (($options['fgpx_weather_visible_by_default'] ?? '0') === '1'),
                'weatherHeatmapRadius' => [
                    'zoom0' => (int) ($options['fgpx_weather_heatmap_zoom0'] ?? '20'),
                    'zoom9' => (int) ($options['fgpx_weather_heatmap_zoom9'] ?? '200'),
                    'zoom12' => (int) ($options['fgpx_weather_heatmap_zoom12'] ?? '1000'),
                    'zoom14' => (int) ($options['fgpx_weather_heatmap_zoom14'] ?? '3000'),
                    'zoom15' => (int) ($options['fgpx_weather_heatmap_zoom15'] ?? '5000'),
                ],
                'daynightVisibleByDefault' => (($options['fgpx_daynight_visible_by_default'] ?? '0') === '1'),
                'debugLogging' => $debugLogging,
                'photosEnabled' => true,
                'photoOrderMode' => $photoOrderMode,
                'galleryPhotoStrategy' => 'latest_embed',
                'resolvedApiKey' => (string) $resolvedApiKey,
            ]
        );

        $rootId = \wp_generate_uuid4();
        $containerClass = 'fgpx-timeline';

        $config = [
            'rootId' => $rootId,
            'orientation' => $orientation,
            'perPage' => $perPage,
            'cardWidth' => $cardWidth,
            'cardHeight' => $cardHeight,
            'monthGrouping' => $monthGrouping,
            'style' => $style,
            'styleUrl' => $styleUrl,
            'styleJson' => (string) $styleJson,
            // Keep both keys for backward compatibility with earlier timeline config.
            'resolvedApiKey' => (string) $resolvedApiKey,
            'apiKey' => (string) $resolvedApiKey,
            'debugLogging' => $debugLogging,
            'photoOrderMode' => $photoOrderMode,
            'preferAjaxFirst' => (($options['fgpx_ajax_first'] ?? '0') === '1'),
            'playerConfig' => $playerConfig,
            'ajaxUrl' => \admin_url('admin-ajax.php'),
            'restUrl' => \rest_url('fgpx/v1/timeline/tracks'),
            'restNonce' => \wp_create_nonce('wp_rest'),
            // Player assets for dynamic loading when modal opens (same pattern as gallery)
            'playerStyles' => array_values(array_filter([
                AssetManager::getAssetUrl('maplibre-gl-css', 'style'),
                \esc_url_raw(\trailingslashit(FGPX_DIR_URL) . 'assets/css/front.css'),
            ])),
            'playerScripts' => array_values(array_filter([
                AssetManager::getAssetUrl('maplibre-gl-js'),
                AssetManager::getAssetUrl('chartjs'),
                \esc_url_raw(\trailingslashit(FGPX_DIR_URL) . 'assets/js/suncalc.js'),
                \esc_url_raw(\trailingslashit(FGPX_DIR_URL) . 'assets/js/front.js'),
            ])),
        ];

        // Inline script for per-instance configuration
        $configJson = \wp_json_encode($config, JSON_UNESCAPED_SLASHES);
        $inlineScript = "if (!window.FGPXTimelineInstances) { window.FGPXTimelineInstances = {}; } window.FGPXTimelineInstances[" . \wp_json_encode($rootId) . "] = " . $configJson . ";";

        \wp_add_inline_script('fgpx-timeline', $inlineScript, 'before');

        // Localize error and UI strings
        \wp_localize_script(
            'fgpx-timeline',
            'FGPXTimelineI18n',
            [
                'errorLoadingTracks' => \esc_attr__('Failed to load timeline tracks', 'flyover-gpx'),
                'unknownError' => \esc_attr__('Unknown error', 'flyover-gpx'),
                'networkError' => \esc_attr__('Network error', 'flyover-gpx'),
                'serverError' => \esc_attr__('Server error', 'flyover-gpx'),
                'httpError' => \esc_attr__('HTTP error', 'flyover-gpx'),
                'invalidResponse' => \esc_attr__('Invalid response from server', 'flyover-gpx'),
                'distanceLabel' => \esc_attr__('Distance', 'flyover-gpx'),
                'durationLabel' => \esc_attr__('Duration', 'flyover-gpx'),
                'elevationGainLabel' => \esc_attr__('Elevation Gain', 'flyover-gpx'),
                'distanceUnitKm' => \esc_attr__('km', 'flyover-gpx'),
                'elevationUnitM' => \esc_attr__('m', 'flyover-gpx'),
                'viewTrackLabelPrefix' => \esc_attr__('View track: ', 'flyover-gpx'),
                'closeLabel' => \esc_attr__('Close', 'flyover-gpx'),
                'noTracksTitle' => \esc_attr__('No tracks found', 'flyover-gpx'),
                'noTracksMessage' => \esc_attr__('Start by uploading your first GPX file to see tracks here.', 'flyover-gpx'),
                'playerLoadFailed' => \esc_attr__('Unable to load player. Please try again.', 'flyover-gpx'),
            ]
        );

        // Enqueue timeline assets
        \wp_enqueue_style(
            'fgpx-timeline',
            \esc_url_raw(\trailingslashit(FGPX_DIR_URL) . 'assets/css/timeline.css'),
            [],
            FGPX_VERSION
        );

        \wp_enqueue_script(
            'fgpx-timeline',
            \esc_url_raw(\trailingslashit(FGPX_DIR_URL) . 'assets/js/timeline.js'),
            [],
            FGPX_VERSION,
            true
        );

        return '<div class="' . \esc_attr($containerClass) . '" data-root-id="' . \esc_attr($rootId) . '"' . $themeAttr . '></div>';
    }

    /**
     * Resolve timeline map style (following gallery pattern).
     *
     * @param array<string,mixed> $options
     * @return array{styleUrl:string,styleJson:string,resolvedKey:string}
     */
    private function resolveTimelineStyle(array $options, string $styleUrlOverride): array
    {
        $styleUrl = '';
        if ($styleUrlOverride !== '') {
            if (\strpos($styleUrlOverride, SmartApiKeys::PLACEHOLDER) !== false) {
                // Allow placeholder templates and sanitize after substitution.
                $styleUrl = \preg_match('#^https?://#i', $styleUrlOverride) ? $styleUrlOverride : '';
            } else {
                $maybe = \esc_url_raw($styleUrlOverride);
                if (\is_string($maybe) && $maybe !== '') {
                    $styleUrl = $maybe;
                }
            }
        }

        $resolvedStyle = SmartApiKeys::resolveStyle(
            (string) ($options['fgpx_default_style_json'] ?? ''),
            $styleUrl,
            (string) ($options['fgpx_smart_api_keys_mode'] ?? SmartApiKeys::MODE_OFF),
            (string) ($options['fgpx_smart_api_keys_pool'] ?? '')
        );

        $resolvedStyleUrl = (string) ($resolvedStyle['styleUrl'] ?? '');
        if ($resolvedStyleUrl !== '') {
            if (\strpos($resolvedStyleUrl, SmartApiKeys::PLACEHOLDER) !== false) {
                // Placeholder survived (mode=off or empty pool) — discard broken URL.
                $styleUrl = '';
            } else {
                $maybeResolved = \esc_url_raw($resolvedStyleUrl);
                if (\is_string($maybeResolved) && $maybeResolved !== '') {
                    $styleUrl = $maybeResolved;
                }
            }
        }

        return [
            'styleUrl' => $styleUrl,
            'styleJson' => (string) ($resolvedStyle['styleJson'] ?? ''),
            'resolvedKey' => isset($resolvedStyle['resolvedKey']) ? (string) $resolvedStyle['resolvedKey'] : '',
        ];
    }

    private function sanitizeCssLength(string $value, string $fallback): string
    {
        $clean = \sanitize_text_field($value);
        if ($clean === '' || !\preg_match('/^\d+(\.\d+)?(px|vh|vw|em|rem|%)$/', $clean)) {
            return $fallback;
        }

        return $clean;
    }

    /**
     * Build timeline payload for REST/AJAX response.
     *
     * @param array<string,mixed> $params
     * @return array<string,mixed>
     */
    private function buildTimelinePayload(array $params): array
    {
        $options = Options::getAll();
        $tracks = $this->getTracks($options);

        $downloadEnabled = ($options['fgpx_gpx_download_enabled'] ?? '0') === '1';

        $perPage = isset($params['per_page']) ? (int) $params['per_page'] : 20;
        $perPage = max(10, min(50, $perPage));

        $page = isset($params['page']) ? (int) $params['page'] : 1;

        $total = count($tracks);
        $maxPage = $total > 0 ? max(1, (int) ceil($total / $perPage)) : 1;
        $page = max(1, min($page, $maxPage)); // Clamp page to valid range to prevent DOS

        $offset = ($page - 1) * $perPage;
        $pageItems = array_slice($tracks, $offset, $perPage);

        // Batch-fetch all attachment URLs to prevent N+1 queries
        $previewUrls = $this->batchGetPreviewUrls($pageItems);

        $groupedByMonth = $this->groupTracksByMonth($pageItems, $previewUrls);

        return [
            'months' => $groupedByMonth,
            'pagination' => [
                'page' => $page,
                'perPage' => $perPage,
                'total' => $total,
                'hasMore' => ($offset + $perPage) < $total,
            ],
        ];
    }

    /**
     * Get all tracks sorted by activity date (oldest first).
     *
     * @param array<string,mixed> $options
     * @return array<int,array<string,mixed>>
     */
    private function getTracks(array $options): array
    {
        $cacheKey = 'fgpx_timeline_tracks_v1';
        $cached = \get_transient($cacheKey);
        if (\is_array($cached)) {
            return $cached;
        }

        $query = new \WP_Query([
            'post_type' => 'fgpx_track',
            'post_status' => 'publish',
            'posts_per_page' => -1,
            'orderby' => 'date',
            'order' => 'DESC',
            'fields' => 'ids',
            'no_found_rows' => true,
        ]);

        $ids = array_map('intval', $query->posts);
        if (empty($ids)) {
            \set_transient($cacheKey, [], 5 * MINUTE_IN_SECONDS);
            return [];
        }

        $meta = DatabaseOptimizer::getPostsWithMeta($ids, [
            'fgpx_stats',
            'fgpx_total_distance_m',
            'fgpx_moving_time_s',
            'fgpx_elevation_gain_m',
            'fgpx_activity_date_unix',
            'fgpx_file_path',
            'fgpx_preview_attachment_id',
            'fgpx_preview_source',
            'fgpx_preview_generated_at',
            'fgpx_keywords',
            'fgpx_search_keywords',
            'fgpx_track_keywords',
            'fgpx_location',
            'fgpx_activity_type',
        ]);

        $tracks = [];

        foreach ($ids as $id) {
            $stats = isset($meta[$id]['fgpx_stats']) && \is_array($meta[$id]['fgpx_stats'])
                ? $meta[$id]['fgpx_stats']
                : [];

            $distanceM = isset($stats['total_distance_m'])
                ? (float) $stats['total_distance_m']
                : (float) ($meta[$id]['fgpx_total_distance_m'] ?? 0);

            $durationS = isset($stats['moving_time_s'])
                ? (int) round((float) $stats['moving_time_s'])
                : (int) round((float) ($meta[$id]['fgpx_moving_time_s'] ?? 0));

            $elevationGainM = isset($stats['elevation_gain_m'])
                ? (float) $stats['elevation_gain_m']
                : (float) ($meta[$id]['fgpx_elevation_gain_m'] ?? 0);

            $distanceKm = $distanceM / 1000.0;
            $durationLabel = $this->formatDuration($durationS);
            $gainLabel = \number_format($elevationGainM, 0);
            $title = (string) \get_the_title($id);
            $postDateTs = (int) \get_post_time('U', true, $id);
            
            // Activity date from post meta (earliest GPX timestamp), fallback to post date
            $activityDateTs = (int) ($meta[$id]['fgpx_activity_date_unix'] ?? $postDateTs);
            $dateLabel = (string) \date_i18n(\get_option('date_format'), $activityDateTs);
            
            $filePath = isset($meta[$id]['fgpx_file_path']) ? (string) $meta[$id]['fgpx_file_path'] : '';
            $keywords = $this->extractTrackKeywords($id, $meta[$id] ?? [], $filePath);
            $previewAttachmentId = (int) ($meta[$id]['fgpx_preview_attachment_id'] ?? 0);
            $previewSource = isset($meta[$id]['fgpx_preview_source']) ? (string) $meta[$id]['fgpx_preview_source'] : '';
            $previewGeneratedAt = isset($meta[$id]['fgpx_preview_generated_at']) ? (string) $meta[$id]['fgpx_preview_generated_at'] : '';

            $track = [
                'id' => $id,
                'title' => $title,
                'distanceKm' => (float) \number_format($distanceKm, 2, '.', ''),
                'durationS' => $durationS,
                'durationLabel' => $durationLabel,
                'elevationGainM' => (int) round($elevationGainM),
                'elevationGainLabel' => $gainLabel,
                'activityDateTs' => $activityDateTs,
                'postDateTs' => $postDateTs,
                'dateLabel' => $dateLabel,
                'filePath' => $filePath,
                'previewAttachmentId' => $previewAttachmentId,
                'previewSource' => $previewSource,
                'previewGeneratedAt' => $previewGeneratedAt,
                'keywords' => $keywords,
            ];

            $tracks[] = $track;
        }

        // Sort by activity date (oldest first)
        usort($tracks, static function (array $left, array $right): int {
            return (int) ($left['activityDateTs'] ?? 0) <=> (int) ($right['activityDateTs'] ?? 0);
        });

        \set_transient($cacheKey, $tracks, 5 * MINUTE_IN_SECONDS);

        return $tracks;
    }

    /**
     * Group tracks by month (e.g., "March 2025").
     *
     * @param array<int,array<string,mixed>> $tracks
     * @param array<int,string> $previewUrls Map of track ID => preview URL
     * @return array<int,array{month: string, monthTs: int, items: array<int,array<string,mixed>>}>
     */
    private function groupTracksByMonth(array $tracks, array $previewUrls = []): array
    {
        $grouped = [];
        $groupedMap = [];

        foreach ($tracks as $track) {
            $ts = (int) ($track['activityDateTs'] ?? 0);
            $monthKey = \date('Y-m', $ts); // e.g., "2025-03"
            $monthLabel = \date_i18n('F Y', $ts);
            $monthTs = (int) \strtotime($monthKey . '-01');

            if (!isset($groupedMap[$monthKey])) {
                $groupedMap[$monthKey] = [
                    'month' => $monthLabel,
                    'monthTs' => $monthTs,
                    'items' => [],
                ];
            }

            // Build sanitized track for client with precomputed preview URL
            $trackId = (int) ($track['id'] ?? 0);
            $previewUrl = $previewUrls[$trackId] ?? '';
            $groupedMap[$monthKey]['items'][] = $this->sanitizeTrackForClient($track, false, $previewUrl);
        }

        // Sort groups by month timestamp (ascending = oldest first)
        uasort($groupedMap, static function (array $a, array $b): int {
            return (int) ($a['monthTs'] ?? 0) <=> (int) ($b['monthTs'] ?? 0);
        });

        return array_values($groupedMap);
    }

    /**
     * Sanitize track data for client response.
     *
     * @param array<string,mixed> $track
     * @param bool $downloadEnabled
     * @param string $previewUrl Pre-computed preview image URL
     * @return array<string,mixed>
     */
    private function sanitizeTrackForClient(array $track, bool $downloadEnabled = false, string $previewUrl = ''): array
    {
        $trackId = (int) ($track['id'] ?? 0);
        $filePath = (string) ($track['filePath'] ?? '');

        // Generate fresh nonce for GPX download
        $gpxDownloadNonce = $downloadEnabled && $filePath !== ''
            ? \wp_create_nonce('fgpx_download_' . $trackId)
            : null;

        return [
            'id' => $trackId,
            'title' => (string) ($track['title'] ?? ''),
            'distanceKm' => (float) ($track['distanceKm'] ?? 0),
            'durationLabel' => (string) ($track['durationLabel'] ?? ''),
            'elevationGainLabel' => (string) ($track['elevationGainLabel'] ?? ''),
            'dateLabel' => (string) ($track['dateLabel'] ?? ''),
            'activityDateTs' => (int) ($track['activityDateTs'] ?? 0),
            'previewUrl' => $previewUrl,
            'gpxDownloadNonce' => $gpxDownloadNonce,
        ];
    }

    /**
     * Batch-fetch preview image URLs to prevent N+1 queries.
     *
     * @param array<int,array<string,mixed>> $tracks
     * @return array<int,string> Map of track ID => preview URL
     */
    private function batchGetPreviewUrls(array $tracks): array
    {
        $urls = [];
        $attachmentIds = [];

        // Collect all attachment IDs
        foreach ($tracks as $track) {
            $trackId = (int) ($track['id'] ?? 0);
            $attachmentId = (int) ($track['previewAttachmentId'] ?? 0);

            if ($attachmentId > 0) {
                $attachmentIds[$trackId] = $attachmentId;
            } else {
                $urls[$trackId] = '';
            }
        }

        // Return early if no attachments to fetch
        if (empty($attachmentIds)) {
            return $urls;
        }

        // Batch-fetch attachment URLs
        foreach ($attachmentIds as $trackId => $attachmentId) {
            $url = \wp_get_attachment_image_url((int) $attachmentId, 'medium_large');
            $urls[$trackId] = (string) ($url ?? '');
        }

        return $urls;
    }

    /**
     * Format duration in seconds to readable label (e.g., "2h 30m").
     */
    private function formatDuration(int $seconds): string
    {
        if ($seconds <= 0) {
            return '0m';
        }

        $hours = (int) floor($seconds / 3600);
        $minutes = (int) floor(($seconds % 3600) / 60);

        if ($hours > 0) {
            return sprintf('%dh %dm', $hours, $minutes);
        }

        return sprintf('%dm', $minutes);
    }

    /**
     * Extract track keywords from post meta.
     *
     * @param int $postId
     * @param array<string,mixed> $meta
     * @param string $filePath
     * @return array<int,string>
     */
    private function extractTrackKeywords(int $postId, array $meta, string $filePath): array
    {
        $keywords = [];

        // Try structured keywords first
        if (isset($meta['fgpx_keywords']) && \is_array($meta['fgpx_keywords'])) {
            $keywords = array_merge($keywords, $meta['fgpx_keywords']);
        }

        // Fallback to search keywords
        if (empty($keywords) && isset($meta['fgpx_search_keywords'])) {
            $kw = (string) $meta['fgpx_search_keywords'];
            if ($kw !== '') {
                $keywords = array_map('trim', explode(',', $kw));
            }
        }

        // Or track keywords
        if (empty($keywords) && isset($meta['fgpx_track_keywords'])) {
            $kw = (string) $meta['fgpx_track_keywords'];
            if ($kw !== '') {
                $keywords = array_map('trim', explode(',', $kw));
            }
        }

        // Add activity type if available
        if (isset($meta['fgpx_activity_type'])) {
            $activityType = (string) $meta['fgpx_activity_type'];
            if ($activityType !== '' && !in_array($activityType, $keywords, true)) {
                $keywords[] = $activityType;
            }
        }

        return array_filter(array_unique($keywords));
    }
}
