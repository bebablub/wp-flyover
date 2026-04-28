<?php

declare(strict_types=1);

namespace FGpx;

if (!\defined('ABSPATH')) {
    exit;
}

/**
 * Gallery shortcode for browsing tracks and launching the player inline.
 */
final class GalleryShortcode
{
    /**
     * Register WordPress hooks.
     */
    public function register(): void
    {
        \add_shortcode('flyover_gpx_gallery', [$this, 'render_shortcode']);
        \add_action('rest_api_init', [$this, 'register_routes']);
        \add_action('wp_ajax_fgpx_gallery_tracks', [$this, 'ajax_get_tracks']);
        \add_action('wp_ajax_nopriv_fgpx_gallery_tracks', [$this, 'ajax_get_tracks']);
    }

    /**
     * Register gallery routes.
     */
    public function register_routes(): void
    {
        \register_rest_route(
            'fgpx/v1',
            '/gallery/tracks',
            [
                'methods' => 'GET',
                'callback' => [$this, 'get_gallery_tracks'],
                'permission_callback' => '__return_true',
            ]
        );
    }

    /**
     * REST endpoint for gallery track data.
     */
    public function get_gallery_tracks(\WP_REST_Request $request): \WP_REST_Response
    {
        return new \WP_REST_Response($this->buildTrackPayload((array) $request->get_params()), 200);
    }

    /**
     * AJAX fallback for gallery track data.
     */
    public function ajax_get_tracks(): void
    {
        \wp_send_json($this->buildTrackPayload((array) $_GET), 200);
    }

    /**
     * Render the [flyover_gpx_gallery] shortcode.
     *
     * @param array<string,mixed> $atts
     */
    public function render_shortcode(array $atts = []): string
    {
        $options = Options::getAll();
        $galleryDefaultPerPage = (int) ($options['fgpx_gallery_per_page'] ?? 12);
        if ($galleryDefaultPerPage < 4) {
            $galleryDefaultPerPage = 4;
        }
        if ($galleryDefaultPerPage > 48) {
            $galleryDefaultPerPage = 48;
        }

        $galleryDefaultSort = \sanitize_key((string) ($options['fgpx_gallery_default_sort'] ?? 'newest'));
        if (!\in_array($galleryDefaultSort, ['newest', 'distance', 'duration', 'gain', 'title'], true)) {
            $galleryDefaultSort = 'newest';
        }

        $galleryShowViewToggleDefault = (($options['fgpx_gallery_show_view_toggle'] ?? '1') === '1') ? '1' : '0';
        $galleryShowSearchDefault = (($options['fgpx_gallery_show_search'] ?? '1') === '1') ? '1' : '0';
        $galleryPhotoOrderModeDefault = \sanitize_key((string) ($options['fgpx_photo_order_mode'] ?? 'geo_first'));
        if (!\in_array($galleryPhotoOrderModeDefault, ['geo_first', 'time_first'], true)) {
            $galleryPhotoOrderModeDefault = 'geo_first';
        }

        $defaults = [
            'per_page' => (string) $galleryDefaultPerPage,
            'height' => (string) ($options['fgpx_gallery_player_height'] ?? '636px'),
            'style' => $options['fgpx_default_style'],
            'style_url' => $options['fgpx_default_style_url'],
            'show_view_toggle' => $galleryShowViewToggleDefault,
            'show_search' => $galleryShowSearchDefault,
            'default_sort' => $galleryDefaultSort,
            'photo_order_mode' => $galleryPhotoOrderModeDefault,
        ];

        $atts = \shortcode_atts($defaults, $atts, 'flyover_gpx_gallery');

        $perPage = (int) $atts['per_page'];
        if ($perPage < 4) {
            $perPage = 4;
        }
        if ($perPage > 48) {
            $perPage = 48;
        }

        $height = \sanitize_text_field((string) $atts['height']);
        // Allow only safe CSS length values (e.g. 636px, 80vh, 100%, 50em, 20rem).
        if ($height === '' || !preg_match('/^\d+(\.\d+)?(px|vh|vw|em|rem|%)$/', $height)) {
            $height = '636px';
        }

        $style = \sanitize_key((string) $atts['style']);
        // Keep gallery style modes aligned with the single-track shortcode.
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
        $resolvedStyle = $this->resolveGalleryStyle($options, $styleUrlRaw);
        $styleUrl = $resolvedStyle['styleUrl'];
        $styleJson = $resolvedStyle['styleJson'];
        $resolvedApiKey = $resolvedStyle['resolvedKey'];

        $showViewToggle = \in_array(\strtolower((string) $atts['show_view_toggle']), ['1', 'true', 'yes', 'on'], true);
        $showSearch = \in_array(\strtolower((string) $atts['show_search']), ['1', 'true', 'yes', 'on'], true);
        $defaultSort = \sanitize_key((string) ($atts['default_sort'] ?? 'newest'));
        if (!\in_array($defaultSort, ['newest', 'distance', 'duration', 'gain', 'title'], true)) {
            $defaultSort = 'newest';
        }
        $photoOrderMode = \sanitize_key((string) ($atts['photo_order_mode'] ?? $galleryPhotoOrderModeDefault));
        if (!\in_array($photoOrderMode, ['geo_first', 'time_first'], true)) {
            $photoOrderMode = 'geo_first';
        }
        $themeMode = \sanitize_key((string) ($options['fgpx_theme_mode'] ?? 'system'));
        if ($themeMode === 'dark') {
            $themeAttr = ' data-fgpx-theme="dark"';
        } elseif ($themeMode === 'bright') {
            $themeAttr = ' data-fgpx-theme="light"';
        } else {
            $themeAttr = '';
        }

        $rootId = 'fgpx-gallery-' . \wp_generate_uuid4();

        $this->enqueueAssets($options, [
            'perPage' => $perPage,
            'height' => $height,
            'style' => $style,
            'styleUrl' => $styleUrl,
            'styleJson' => $styleJson,
            'resolvedApiKey' => $resolvedApiKey,
            'defaultSort' => $defaultSort,
            'showSearch' => $showSearch,
            'photoOrderMode' => $photoOrderMode,
        ], $rootId);

        return '<div id="' . \esc_attr($rootId) . '" class="fgpx-gallery" data-root-id="' . \esc_attr($rootId) . '"' . $themeAttr . '>'
            . '<div class="fgpx-gallery-toolbar">'
                        . ($showSearch
                                ? '<div class="fgpx-gallery-search-wrap">'
                                        . '<input type="search" class="fgpx-gallery-search" placeholder="' . \esc_attr__('Search tracks (title, distance, duration, elevation, keywords)...', 'flyover-gpx') . '" aria-label="' . \esc_attr__('Search tracks', 'flyover-gpx') . '" />'
                                    . '</div>'
                                : '')
            . '<div class="fgpx-gallery-controls">'
            . '<label class="fgpx-gallery-sort-label">'
            . '<span>' . \esc_html__('Sort', 'flyover-gpx') . '</span>'
            . '<select class="fgpx-gallery-sort">'
            . '<option value="newest">' . \esc_html__('Newest', 'flyover-gpx') . '</option>'
            . '<option value="distance">' . \esc_html__('Distance', 'flyover-gpx') . '</option>'
            . '<option value="duration">' . \esc_html__('Duration', 'flyover-gpx') . '</option>'
            . '<option value="gain">' . \esc_html__('Elevation gain', 'flyover-gpx') . '</option>'
            . '<option value="title">' . \esc_html__('Title', 'flyover-gpx') . '</option>'
            . '</select>'
            . '</label>'
            . ($showViewToggle
                ? '<div class="fgpx-gallery-view-toggle" role="group" aria-label="' . \esc_attr__('Gallery view', 'flyover-gpx') . '">'
                    . '<button type="button" class="fgpx-gallery-view-btn is-active" data-view="grid" aria-pressed="true">' . \esc_html__('Grid', 'flyover-gpx') . '</button>'
                    . '<button type="button" class="fgpx-gallery-view-btn" data-view="list" aria-pressed="false">' . \esc_html__('List', 'flyover-gpx') . '</button>'
                  . '</div>'
                : '')
            . '</div>'
            . '</div>'
            . '<div class="fgpx-gallery-results fgpx-gallery-results-grid" aria-live="polite" aria-busy="false"></div>'
            . '<div class="fgpx-gallery-footer">'
            . '<button type="button" class="fgpx-gallery-load-more button" hidden>' . \esc_html__('Load more', 'flyover-gpx') . '</button>'
            . '</div>'
            . '<section class="fgpx-gallery-player-panel" hidden role="region" aria-live="polite" aria-label="' . \esc_attr__('Track player', 'flyover-gpx') . '">'
            . '<header class="fgpx-gallery-player-header">'
            . '<div class="fgpx-gallery-player-title" tabindex="-1"></div>'
            . '<div class="fgpx-gallery-player-actions">'
            . '<a class="fgpx-share-btn fgpx-share-fb" href="#" target="_blank" rel="noopener noreferrer">' . \esc_html__('Facebook', 'flyover-gpx') . '</a>'
            . '<a class="fgpx-share-btn fgpx-share-x" href="#" target="_blank" rel="noopener noreferrer">' . \esc_html__('Twitter', 'flyover-gpx') . '</a>'
            . '<a class="fgpx-share-btn fgpx-share-wa" href="#" target="_blank" rel="noopener noreferrer">' . \esc_html__('WhatsApp', 'flyover-gpx') . '</a>'
            . '<button type="button" class="fgpx-share-btn fgpx-share-copy">' . \esc_html__('Copy Link', 'flyover-gpx') . '</button>'
            . '</div>'
            . '</header>'
            . '<div class="fgpx-gallery-player-mount"></div>'
            . '</section>'
            . '</div>';
    }

    /**
     * @param array<string,mixed> $params
     * @return array<string,mixed>
     */
    private function buildTrackPayload(array $params): array
    {
        $options = Options::getAll();
        $tracks = $this->getTracks($options);

        $downloadEnabled = ($options['fgpx_gpx_download_enabled'] ?? '0') === '1';

        $trackId = isset($params['track_id']) ? (int) $params['track_id'] : 0;
        if ($trackId > 0) {
            foreach ($tracks as $track) {
                if ((int) $track['id'] === $trackId) {
                    return ['item' => $this->sanitizeTrackForClient($track, $downloadEnabled)];
                }
            }

            return ['item' => null];
        }

        $defaultPerPage = (int) ($options['fgpx_gallery_per_page'] ?? 12);
        if ($defaultPerPage < 4) {
            $defaultPerPage = 4;
        }
        if ($defaultPerPage > 48) {
            $defaultPerPage = 48;
        }

        $perPage = isset($params['per_page']) ? (int) $params['per_page'] : $defaultPerPage;
        $perPage = max(4, min(48, $perPage));

        $page = isset($params['page']) ? (int) $params['page'] : 1;
        $page = max(1, $page);

        $sort = isset($params['sort']) ? \sanitize_key((string) $params['sort']) : 'newest';
        if (!\in_array($sort, ['newest', 'distance', 'duration', 'gain', 'title'], true)) {
            $sort = 'newest';
        }

        $search = $this->normalizeSearchValue(isset($params['search']) ? (string) $params['search'] : '');

        if ($search !== '') {
            $tracks = array_values(array_filter($tracks, static function (array $track) use ($search): bool {
                return strpos((string) ($track['searchText'] ?? ''), $search) !== false;
            }));
        }

        $tracks = $this->sortTracks($tracks, $sort);
        $total = count($tracks);
        $offset = ($page - 1) * $perPage;
        $pageItems = array_slice($tracks, $offset, $perPage);

        return [
            'items' => array_map(function (array $track) use ($downloadEnabled): array {
                return $this->sanitizeTrackForClient($track, $downloadEnabled);
            }, $pageItems),
            'pagination' => [
                'page' => $page,
                'perPage' => $perPage,
                'total' => $total,
                'hasMore' => ($offset + $perPage) < $total,
            ],
        ];
    }

    /**
     * @param array<string,string> $options
     * @return array<int,array<string,mixed>>
     */
    private function getTracks(array $options): array
    {
        // Always use the shared cache for bulk metadata — nonces are generated fresh
        // in sanitizeTrackForClient() so the cached payload never contains stale nonces.
        $cacheKey = 'fgpx_gallery_tracks_v1';
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
            $dateTs = (int) \get_post_time('U', true, $id);
            $dateLabel = (string) \get_the_date('', $id);
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
                'dateTs' => $dateTs,
                'dateLabel' => $dateLabel,
                // filePath stored in cache so nonces can be generated fresh at response time.
                'filePath' => $filePath,
                'previewAttachmentId' => $previewAttachmentId,
                'previewSource' => $previewSource,
                'previewGeneratedAt' => $previewGeneratedAt,
                'keywords' => $keywords,
            ];

            $track['searchText'] = $this->buildTrackSearchText($track);
            $tracks[] = $track;
        }

        \set_transient($cacheKey, $tracks, 5 * MINUTE_IN_SECONDS);

        return $tracks;
    }

    /**
     * @param array<int,array<string,mixed>> $tracks
     * @return array<int,array<string,mixed>>
     */
    private function sortTracks(array $tracks, string $sortKey): array
    {
        usort($tracks, static function (array $left, array $right) use ($sortKey): int {
            switch ($sortKey) {
                case 'distance':
                    return (float) ($right['distanceKm'] ?? 0) <=> (float) ($left['distanceKm'] ?? 0);
                case 'duration':
                    return (int) ($right['durationS'] ?? 0) <=> (int) ($left['durationS'] ?? 0);
                case 'gain':
                    return (int) ($right['elevationGainM'] ?? 0) <=> (int) ($left['elevationGainM'] ?? 0);
                case 'title':
                    return strcasecmp((string) ($left['title'] ?? ''), (string) ($right['title'] ?? ''));
                default:
                    return (int) ($right['dateTs'] ?? 0) <=> (int) ($left['dateTs'] ?? 0);
            }
        });

        return $tracks;
    }

    /**
     * @param array<string,mixed> $track
     * @return array<string,mixed>
     */
    private function sanitizeTrackForClient(array $track, bool $downloadEnabled = false): array
    {
        $gpxDownloadUrl = '';
        $previewImageUrl = '';

        $previewAttachmentId = (int) ($track['previewAttachmentId'] ?? 0);
        if ($previewAttachmentId > 0) {
            $previewImageUrl = (string) \esc_url_raw((string) \wp_get_attachment_image_url($previewAttachmentId, 'medium_large'));
            if ($previewImageUrl === '') {
                $previewImageUrl = (string) \esc_url_raw((string) \wp_get_attachment_url($previewAttachmentId));
            }
        }

        if ($downloadEnabled) {
            $id = (int) ($track['id'] ?? 0);
            $filePath = (string) ($track['filePath'] ?? '');
            if ($id > 0 && $filePath !== '' && \is_readable($filePath)) {
                $nonce = \wp_create_nonce('fgpx_download_gpx_' . $id);
                $gpxDownloadUrl = \esc_url_raw(\admin_url('admin-ajax.php') . '?action=fgpx_download_gpx&id=' . $id . '&nonce=' . $nonce);
            }
        }

        return [
            'id' => (int) ($track['id'] ?? 0),
            'title' => (string) ($track['title'] ?? ''),
            'distanceKm' => (float) ($track['distanceKm'] ?? 0),
            'durationS' => (int) ($track['durationS'] ?? 0),
            'durationLabel' => (string) ($track['durationLabel'] ?? ''),
            'elevationGainM' => (int) ($track['elevationGainM'] ?? 0),
            'elevationGainLabel' => (string) ($track['elevationGainLabel'] ?? ''),
            'dateTs' => (int) ($track['dateTs'] ?? 0),
            'dateLabel' => (string) ($track['dateLabel'] ?? ''),
            'gpxDownloadUrl' => $gpxDownloadUrl,
            'previewImageUrl' => $previewImageUrl,
            'previewSource' => (string) ($track['previewSource'] ?? ''),
            'previewGeneratedAt' => (string) ($track['previewGeneratedAt'] ?? ''),
            'keywords' => (string) ($track['keywords'] ?? ''),
        ];
    }

    /**
     * @param array<string,mixed> $track
     */
    private function buildTrackSearchText(array $track): string
    {
        return $this->normalizeSearchValue(
            (string) ($track['title'] ?? '')
            . ' '
            . (string) ($track['keywords'] ?? '')
            . ' distance '
            . (string) ($track['distanceKm'] ?? '')
            . 'km '
            . (string) ($track['distanceKm'] ?? '')
            . ' km duration '
            . (string) ($track['durationLabel'] ?? '')
            . ' elevation gain '
            . (string) ($track['elevationGainLabel'] ?? '')
            . 'm '
            . (string) ($track['elevationGainLabel'] ?? '')
            . ' m'
        );
    }

    private function normalizeSearchValue(string $value): string
    {
        $value = strtolower(trim($value));
        $value = preg_replace('/\s+/', ' ', $value);

        return is_string($value) ? $value : '';
    }

    /**
     * @param array<string,mixed> $meta
     */
    private function extractTrackKeywords(int $trackId, array $meta, string $filePath): string
    {
        $keywords = [];

        foreach (['fgpx_keywords', 'fgpx_search_keywords', 'fgpx_track_keywords', 'fgpx_location', 'fgpx_activity_type'] as $metaKey) {
            if (!empty($meta[$metaKey]) && is_string($meta[$metaKey])) {
                $keywords[] = (string) $meta[$metaKey];
            }
        }

        if (function_exists('get_post_field')) {
            foreach (['post_name', 'post_excerpt', 'post_content'] as $field) {
                $value = (string) \get_post_field($field, $trackId);
                if ($value !== '') {
                    $keywords[] = trim(strip_tags($value));
                }
            }
        }

        if (function_exists('get_object_taxonomies') && function_exists('wp_get_post_terms')) {
            $taxonomies = \get_object_taxonomies('fgpx_track', 'names');
            if (is_array($taxonomies) && !empty($taxonomies)) {
                $terms = \wp_get_post_terms($trackId, $taxonomies, ['fields' => 'names']);
                if (is_array($terms) && !empty($terms)) {
                    $keywords = array_merge($keywords, array_map('strval', $terms));
                }
            }
        }

        // GPX file parsing is the most expensive source; use it as a fallback only.
        if (empty($keywords) && $filePath !== '' && \is_readable($filePath) && \class_exists('\\phpGPX\\phpGPX')) {
            try {
                $gpx = new \phpGPX\phpGPX();
                $file = $gpx->load($filePath);
                if ($file && isset($file->metadata) && !empty($file->metadata->keywords)) {
                    $keywords[] = (string) $file->metadata->keywords;
                }
            } catch (\Throwable $e) {
                ErrorHandler::debug('[GalleryShortcode] GPX keyword extraction failed for track ' . $trackId . ': ' . $e->getMessage());
            }
        }

        $keywords = array_values(array_unique(array_filter(array_map(static function ($value): string {
            return trim((string) $value);
        }, $keywords), static function (string $value): bool {
            return $value !== '';
        })));

        return implode(' ', $keywords);
    }

    /**
     * @param array<string,string> $options
     * @param array<string,mixed> $galleryCfg
     * @param string $rootId
     */
    private function enqueueAssets(array $options, array $galleryCfg, string $rootId): void
    {
        AssetManager::registerAssets();

        if (!\wp_style_is('fgpx-front', 'registered')) {
            \wp_register_style(
                'fgpx-front',
                \esc_url_raw(\trailingslashit(FGPX_DIR_URL) . 'assets/css/front.css'),
                [],
                FGPX_VERSION
            );
        }

        if (!\wp_script_is('suncalc', 'registered')) {
            \wp_register_script(
                'suncalc',
                \esc_url_raw(\trailingslashit(FGPX_DIR_URL) . 'assets/js/suncalc.js'),
                [],
                FGPX_VERSION,
                true
            );
        }

        if (!\wp_script_is('fgpx-front', 'registered')) {
            \wp_register_script(
                'fgpx-front',
                \esc_url_raw(\trailingslashit(FGPX_DIR_URL) . 'assets/js/front.js'),
                ['maplibre-gl-js', 'chartjs', 'suncalc'],
                FGPX_VERSION,
                true
            );
        }

        \wp_enqueue_style(
            'fgpx-gallery',
            \esc_url_raw(\trailingslashit(FGPX_DIR_URL) . 'assets/css/gallery.css'),
            [],
            FGPX_VERSION
        );

        \wp_enqueue_script(
            'fgpx-gallery',
            \esc_url_raw(\trailingslashit(FGPX_DIR_URL) . 'assets/js/gallery.js'),
            [],
            FGPX_VERSION,
            true
        );

        global $post;
        $hostPostId = ($post && isset($post->ID)) ? (int) $post->ID : 0;
        $restBase = \esc_url_raw(\site_url('/wp-json/fgpx/v1'));

        $playerCfg = [
            'restUrl' => $restBase,
            'restBase' => $restBase,
            'nonce' => \wp_create_nonce('wp_rest'),
            'ajaxUrl' => \esc_url_raw(\admin_url('admin-ajax.php')),
            'pluginUrl' => \esc_url_raw(\trailingslashit(FGPX_DIR_URL)),
            'chartColor' => $options['fgpx_chart_color'],
            'chartColor2' => $options['fgpx_chart_color2'],
            'chartColorHr' => $options['fgpx_chart_color_hr'],
            'chartColorCad' => $options['fgpx_chart_color_cad'],
            'chartColorTemp' => $options['fgpx_chart_color_temp'],
            'chartColorPower' => $options['fgpx_chart_color_power'],
            'ftp' => (int) $options['fgpx_ftp'],
            'chartColorWindImpact' => $options['fgpx_chart_color_wind_impact'],
            'chartColorWindRose' => $options['fgpx_chart_color_wind_rose'],
            'windRoseColorNorth' => $options['fgpx_wind_rose_color_north'],
            'windRoseColorSouth' => $options['fgpx_wind_rose_color_south'],
            'windRoseColorEast' => $options['fgpx_wind_rose_color_east'],
            'windRoseColorWest' => $options['fgpx_wind_rose_color_west'],
            'daynightEnabled' => $options['fgpx_daynight_enabled'] === '1',
            'daynightMapEnabled' => $options['fgpx_daynight_map_enabled'] === '1',
            'daynightMapColor' => $options['fgpx_daynight_map_color'],
            'daynightMapOpacity' => (float) $options['fgpx_daynight_map_opacity'],
            'styleJson' => (string) ($galleryCfg['styleJson'] ?? $options['fgpx_default_style_json']),
            'simulationEnabled' => $options['fgpx_simulation_enabled'] === '1',
            'simulationWaypointsEnabled' => $options['fgpx_simulation_waypoints_enabled'] === '1',
            'simulationCitiesEnabled' => $options['fgpx_simulation_cities_enabled'] === '1',
                    'failedLoad' => \esc_html__('Failed to load track:', 'flyover-gpx'),
                    'noData' => \esc_html__('No route data available.', 'flyover-gpx'),
                    'elevationLabel' => \esc_html__('Elevation (m)', 'flyover-gpx'),
                    'simCelestialDayAria' => \esc_html__('Daytime indicator (sun)', 'flyover-gpx'),
                    'simCelestialNightAria' => \esc_html__('Night indicator (moon)', 'flyover-gpx'),
                    'simConditionIconsAria' => \esc_html__('Weather condition icons: fog, clouds, rain, snow, wind', 'flyover-gpx'),
                    'simConditionIconsActivePrefix' => \esc_html__('Active weather icons', 'flyover-gpx'),
                    'simConditionIconsClear' => \esc_html__('Clear conditions', 'flyover-gpx'),
                    'simCondFog' => \esc_html__('Fog', 'flyover-gpx'),
                    'simCondClouds' => \esc_html__('Clouds', 'flyover-gpx'),
                    'simCondRain' => \esc_html__('Rain', 'flyover-gpx'),
                    'simCondSnow' => \esc_html__('Snow', 'flyover-gpx'),
                    'simCondWind' => \esc_html__('Wind', 'flyover-gpx'),
            'defaultZoom' => (int) $options['fgpx_default_zoom'],
            'defaultSpeed' => (int) $options['fgpx_default_speed'],
            'defaultPitch' => (int) $options['fgpx_default_pitch'],
            'showLabels' => $options['fgpx_show_labels'] !== '0',
            'photosEnabled' => $options['fgpx_photos_enabled'] === '1',
            'photoOrderMode' => (isset($galleryCfg['photoOrderMode']) && \in_array((string) $galleryCfg['photoOrderMode'], ['geo_first', 'time_first'], true)) ? (string) $galleryCfg['photoOrderMode'] : 'geo_first',
            'privacyEnabled' => $options['fgpx_privacy_enabled'] === '1',
            'privacyKm' => (float) $options['fgpx_privacy_km'],
            'hudEnabled' => $options['fgpx_hud_enabled'] === '1',
            'elevationColoring' => $options['fgpx_elevation_coloring'] === '1',
            'elevationColorFlat' => $options['fgpx_elevation_color_flat'],
            'elevationColorSteep' => $options['fgpx_elevation_color_steep'],
            'elevationThresholdMin' => $options['fgpx_elevation_threshold_min'],
            'elevationThresholdMax' => $options['fgpx_elevation_threshold_max'],
            'weatherEnabled' => $options['fgpx_weather_enabled'] === '1',
            'weatherOpacity' => (float) $options['fgpx_weather_opacity'],
            'weatherVisibleByDefault' => $options['fgpx_weather_visible_by_default'] === '1',
            'daynightVisibleByDefault' => $options['fgpx_daynight_visible_by_default'] === '1',
            'weatherHeatmapRadius' => [
                'zoom0' => (int) $options['fgpx_weather_heatmap_zoom0'],
                'zoom9' => (int) $options['fgpx_weather_heatmap_zoom9'],
                'zoom12' => (int) $options['fgpx_weather_heatmap_zoom12'],
                'zoom14' => (int) $options['fgpx_weather_heatmap_zoom14'],
                'zoom15' => (int) $options['fgpx_weather_heatmap_zoom15'],
            ],
            'weatherPriorityOrder' => $options['fgpx_weather_priority_order'],
            'weatherFogThreshold' => (float) $options['fgpx_weather_fog_threshold'],
            'weatherColorSnow' => $options['fgpx_weather_color_snow'],
            'weatherColorRain' => $options['fgpx_weather_color_rain'],
            'weatherColorFog' => $options['fgpx_weather_color_fog'],
            'weatherColorClouds' => $options['fgpx_weather_color_clouds'],
            'backendSimplify' => $options['fgpx_backend_simplify_enabled'] === '1',
            'backendSimplifyTarget' => (int) $options['fgpx_backend_simplify_target'],
            'themeMode' => $options['fgpx_theme_mode'],
            'themeAutoDarkStart' => $options['fgpx_theme_auto_dark_start'],
            'themeAutoDarkEnd' => $options['fgpx_theme_auto_dark_end'],
            'debugLogging' => $options['fgpx_debug_logging'] === '1',
            'debugWeatherData' => $options['fgpx_debug_weather_data'] === '1',
            'prefetchEnabled' => $options['fgpx_prefetch_enabled'] === '1',
            'deferViewport' => false,
            'hostPostId' => $hostPostId,
            'gpxDownloadUrl' => '',
            'resolvedApiKey' => (string) ($galleryCfg['resolvedApiKey'] ?? ''),
            'i18n' => [
                'play' => \esc_html__('Play', 'flyover-gpx'),
                'pause' => \esc_html__('Pause', 'flyover-gpx'),
                'restart' => \esc_html__('Restart', 'flyover-gpx'),
                'speed' => \esc_html__('Speed', 'flyover-gpx'),
                'failedLoad' => \esc_html__('Failed to load track:', 'flyover-gpx'),
                'noData' => \esc_html__('No route data available.', 'flyover-gpx'),
                'elevationLabel' => \esc_html__('Elevation (m)', 'flyover-gpx'),
                'distanceKm' => \esc_html__('Distance (km)', 'flyover-gpx'),
                'time' => \esc_html__('Time', 'flyover-gpx'),
                'avgSpeedKmh' => \esc_html__('Avg speed (km/h)', 'flyover-gpx'),
                'elevGainM' => \esc_html__('Elevation gain (m)', 'flyover-gpx'),
            ],
        ];

        $instanceData = [
            'endpointUrl' => \esc_url_raw($restBase . '/gallery/tracks'),
            'ajaxUrl' => \esc_url_raw(\admin_url('admin-ajax.php')),
            'ajaxAction' => 'fgpx_gallery_tracks',
            'perPage' => (int) $galleryCfg['perPage'],
            'playerHeight' => (string) $galleryCfg['height'],
            'playerStyle' => (string) $galleryCfg['style'],
            'playerStyleUrl' => (string) $galleryCfg['styleUrl'],
            'defaultSort' => (string) $galleryCfg['defaultSort'],
            'showSearch' => !empty($galleryCfg['showSearch']),
            'autoSpeedEnabled' => $options['fgpx_gallery_auto_speed_enabled'] === '1',
            'autoSpeedThresholdKm' => (float) $options['fgpx_gallery_auto_speed_threshold_km'],
            'autoSpeedValue' => (int) $options['fgpx_gallery_auto_speed_value'],
            'playerConfig' => $playerCfg,
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
            'strings' => [
                'loading' => \esc_html__('Loading tracks...', 'flyover-gpx'),
                'loadMore' => \esc_html__('Load more', 'flyover-gpx'),
                'noResults' => \esc_html__('No tracks found for this search.', 'flyover-gpx'),
                'listLoadFailed' => \esc_html__('Could not load the track list. Please try again.', 'flyover-gpx'),
                'distance' => \esc_html__('Distance', 'flyover-gpx'),
                'duration' => \esc_html__('Duration', 'flyover-gpx'),
                'gain' => \esc_html__('Elevation gain', 'flyover-gpx'),
                'uploaded' => \esc_html__('Uploaded', 'flyover-gpx'),
                'launch' => \esc_html__('Open Track', 'flyover-gpx'),
                'copied' => \esc_html__('Link copied', 'flyover-gpx'),
                'copyFailed' => \esc_html__('Could not copy link', 'flyover-gpx'),
                'copyShortcode' => \esc_html__('Copy Link', 'flyover-gpx'),
                'playerLoadFailed' => \esc_html__('Could not load the track player. Please try again.', 'flyover-gpx'),
            ],
        ];

        \wp_add_inline_script(
            'fgpx-gallery',
            'window.FGPXGalleryInstances=window.FGPXGalleryInstances||{};window.FGPXGalleryInstances[' . \wp_json_encode($rootId) . ']=' . \wp_json_encode($instanceData) . ';',
            'before'
        );
    }

    /**
     * @param array<string,mixed> $options
     * @return array{styleUrl:string,styleJson:string,resolvedKey:string}
     */
    private function resolveGalleryStyle(array $options, string $styleUrlRaw): array
    {
        $styleUrl = '';
        if ($styleUrlRaw !== '') {
            if (\strpos($styleUrlRaw, SmartApiKeys::PLACEHOLDER) !== false) {
                // Allow placeholder templates and sanitize after substitution.
                $styleUrl = \preg_match('#^https?://#i', $styleUrlRaw) ? $styleUrlRaw : '';
            } else {
                $maybe = \esc_url_raw($styleUrlRaw);
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
                // Placeholder survived (mode=off or empty pool) — discard rather than
                // passing a broken esc_url_raw-encoded URL to MapLibre.
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

    /**
     * Delete the gallery tracks transient so the next page load rebuilds it.
     * Called by Admin when a track is saved or deleted.
     */
    public static function invalidate_tracks_cache(): void
    {
        \delete_transient('fgpx_gallery_tracks_v1');
    }

    private function formatDuration(int $seconds): string
    {
        $seconds = max(0, $seconds);
        $h = (int) floor($seconds / 3600);
        $m = (int) floor(($seconds % 3600) / 60);
        $s = (int) ($seconds % 60);

        if ($h > 0) {
            return sprintf('%d:%02d:%02d', $h, $m, $s);
        }

        return sprintf('%02d:%02d', $m, $s);
    }
}
