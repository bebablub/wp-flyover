<?php

declare(strict_types=1);

namespace FGpx;

if (!\defined('ABSPATH')) {
    exit;
}

/**
 * Multi-track statistics provider for frontend shortcode and admin dashboard.
 */
final class Statistics
{
    private const CACHE_KEY_PREFIX = 'fgpx_stats_aggregate_v1_';
    /** @var array<int,string> */
    private const TRACKED_META_KEYS = [
        'fgpx_stats',
        'fgpx_total_distance_m',
        'fgpx_moving_time_s',
        'fgpx_elevation_gain_m',
        'fgpx_max_speed_m_s',
        'fgpx_geojson',
    ];

    /**
     * Register shortcode and endpoints.
     */
    public function register(): void
    {
        \add_shortcode('flyover_gpx_stats', [$this, 'render_shortcode']);
        \add_action('rest_api_init', [$this, 'register_routes']);
        \add_action('wp_ajax_fgpx_stats', [$this, 'ajax_get_stats']);
        \add_action('wp_ajax_nopriv_fgpx_stats', [$this, 'ajax_get_stats']);
        // Keep aggregate stats fresh even when tracks are mutated outside Admin UI flows.
        \add_action('save_post_fgpx_track', [$this, 'on_track_saved'], 10, 3);
        \add_action('before_delete_post', [$this, 'on_track_deleted']);
        \add_action('updated_post_meta', [$this, 'on_track_meta_changed'], 10, 4);
        \add_action('added_post_meta', [$this, 'on_track_meta_changed'], 10, 4);
        \add_action('deleted_post_meta', [$this, 'on_track_meta_changed'], 10, 4);
    }

    /**
     * @param mixed $metaId
     * @param mixed $metaValue
     */
    public function on_track_meta_changed($metaId, int $objectId, string $metaKey, $metaValue): void
    {
        if (!\in_array($metaKey, self::TRACKED_META_KEYS, true)) {
            return;
        }

        if (!$this->is_track_post($objectId)) {
            return;
        }

        self::invalidate_cache();
    }

    /**
     * @param mixed $post
     */
    public function on_track_saved(int $postId, $post, bool $update): void
    {
        if (\wp_is_post_revision($postId)) {
            return;
        }

        self::invalidate_cache();
    }

    public function on_track_deleted(int $postId): void
    {
        if (!$this->is_track_post($postId)) {
            return;
        }

        self::invalidate_cache();
    }

    /**
     * Register REST routes.
     */
    public function register_routes(): void
    {
        \register_rest_route(
            'fgpx/v1',
            '/stats/aggregate',
            [
                'methods' => 'GET',
                'callback' => [$this, 'get_aggregate_stats'],
                'permission_callback' => [$this, 'can_read_stats'],
            ]
        );
    }

    /**
     * Permission callback for statistics endpoint.
     *
     * Public access is enabled by default for shortcode rendering.
     */
    public function can_read_stats(): bool
    {
        $public = (bool) \apply_filters('fgpx_stats_public', true);
        if ($public) {
            return true;
        }

        return \current_user_can('manage_options');
    }

    /**
     * REST endpoint handler.
     */
    public function get_aggregate_stats(\WP_REST_Request $request): \WP_REST_Response
    {
        return new \WP_REST_Response($this->build_payload((array) $request->get_params()), 200);
    }

    /**
     * AJAX fallback endpoint handler.
     */
    public function ajax_get_stats(): void
    {
        if (!$this->can_read_stats()) {
            \wp_send_json([
                'code' => 'forbidden',
                'message' => 'Forbidden',
            ], 403);
        }

        \wp_send_json($this->build_payload((array) $_GET), 200);
    }

    /**
     * Render [flyover_gpx_stats] shortcode.
     *
     * @param array<string,mixed> $atts
     */
    public function render_shortcode(array $atts = []): string
    {
        $defaults = [
            'height' => '540px',
            'max_points' => '15000',
            'show_charts' => '1',
            'charts' => '',
            'show_heatmap' => '1',
        ];
        $atts = \shortcode_atts($defaults, $atts, 'flyover_gpx_stats');

        $height = \sanitize_text_field((string) $atts['height']);
        if ($height === '' || !\preg_match('/^\d+(\.\d+)?(px|vh|vw|em|rem|%)$/', $height)) {
            $height = '540px';
        }

        $maxPoints = isset($atts['max_points']) ? (int) $atts['max_points'] : 15000;
        $maxPoints = max(1000, min(50000, $maxPoints));

        // Resolve which charts to show: `charts` (comma-separated list) takes priority.
        // Legacy aliases are preserved for backward compatibility.
        $allChartKeys = [
            'distance_by_month',
            'tracks_by_year',
            'tracks_by_month',
            'distance_by_year',
            'elevation_by_month',
            'elevation_by_year',
            'avg_speed_by_month',
            'avg_speed_by_year',
            'track_length_histogram',
            'weekday_distribution',
            'hour_distribution',
        ];
        $chartAliases = [
            'monthly' => 'distance_by_month',
            'yearly' => 'tracks_by_year',
        ];
        $chartsAttr   = \sanitize_text_field((string) $atts['charts']);
        if ($chartsAttr !== '') {
            $charts = [];
            foreach (array_map('trim', explode(',', $chartsAttr)) as $chartKey) {
                $chartKey = \strtolower((string) $chartKey);
                if (isset($chartAliases[$chartKey])) {
                    $chartKey = $chartAliases[$chartKey];
                }
                if (in_array($chartKey, $allChartKeys, true) && !in_array($chartKey, $charts, true)) {
                    $charts[] = $chartKey;
                }
            }
        } elseif ($this->is_truthy((string) $atts['show_charts'])) {
            $charts = $allChartKeys;
        } else {
            $charts = [];
        }
        $showHeatmap = $this->is_truthy((string) $atts['show_heatmap']);

        $rootId = 'fgpx-stats-' . \wp_generate_uuid4();
        $this->enqueue_assets();

        $instanceConfig = [
            'rootId' => $rootId,
            'endpointUrl' => \esc_url_raw(\rest_url('fgpx/v1/stats/aggregate')),
            'ajaxUrl' => \esc_url_raw(\admin_url('admin-ajax.php')),
            'ajaxAction' => 'fgpx_stats',
            'maxPoints' => $maxPoints,
            'charts' => $charts,
            'showHeatmap' => $showHeatmap,
            'mapStyle' => '',
            'strings' => [
                'loading' => \esc_html__('Loading statistics...', 'flyover-gpx'),
                'failed' => \esc_html__('Could not load statistics.', 'flyover-gpx'),
                'tracks' => \esc_html__('Tracks', 'flyover-gpx'),
                'distance' => \esc_html__('Distance', 'flyover-gpx'),
                'elevation' => \esc_html__('Elevation gain', 'flyover-gpx'),
                'avgSpeed' => \esc_html__('Avg speed', 'flyover-gpx'),
                'maxSpeed' => \esc_html__('Max speed', 'flyover-gpx'),
                'avgDistance' => \esc_html__('Avg distance', 'flyover-gpx'),
                'maxDistance' => \esc_html__('Max distance', 'flyover-gpx'),
                'avgElevation' => \esc_html__('Avg elevation', 'flyover-gpx'),
                'maxElevation' => \esc_html__('Max elevation', 'flyover-gpx'),
                'chartDistanceByMonth' => \esc_html__('Distance by Month', 'flyover-gpx'),
                'chartTracksByMonth' => \esc_html__('Tracks by Month', 'flyover-gpx'),
                'chartTracksByYear' => \esc_html__('Tracks by Year', 'flyover-gpx'),
                'chartDistanceByYear' => \esc_html__('Distance by Year', 'flyover-gpx'),
                'chartElevationByMonth' => \esc_html__('Elevation by Month', 'flyover-gpx'),
                'chartElevationByYear' => \esc_html__('Elevation by Year', 'flyover-gpx'),
                'chartAvgSpeedByMonth' => \esc_html__('Average Speed by Month', 'flyover-gpx'),
                'chartAvgSpeedByYear' => \esc_html__('Average Speed by Year', 'flyover-gpx'),
                'chartTrackLengthHistogram' => \esc_html__('Track Length Distribution', 'flyover-gpx'),
                'chartWeekdayDistribution' => \esc_html__('Weekday Distribution', 'flyover-gpx'),
                'chartHourDistribution' => \esc_html__('Hour Distribution', 'flyover-gpx'),
                'chartDistanceKm' => \esc_html__('Distance (km)', 'flyover-gpx'),
                'chartElevationM' => \esc_html__('Elevation gain (m)', 'flyover-gpx'),
                'chartAvgSpeedKmh' => \esc_html__('Average speed (km/h)', 'flyover-gpx'),
                'chartTracksCount' => \esc_html__('Track count', 'flyover-gpx'),
                'chartLengthBuckets' => \esc_html__('Distance buckets', 'flyover-gpx'),
                'weekdaySun' => \esc_html__('Sun', 'flyover-gpx'),
                'weekdayMon' => \esc_html__('Mon', 'flyover-gpx'),
                'weekdayTue' => \esc_html__('Tue', 'flyover-gpx'),
                'weekdayWed' => \esc_html__('Wed', 'flyover-gpx'),
                'weekdayThu' => \esc_html__('Thu', 'flyover-gpx'),
                'weekdayFri' => \esc_html__('Fri', 'flyover-gpx'),
                'weekdaySat' => \esc_html__('Sat', 'flyover-gpx'),
                'chartTracks' => \esc_html__('Tracks', 'flyover-gpx'),
                'heatmapTitle' => \esc_html__('All Tracks Heatmap', 'flyover-gpx'),
                'noTracks' => \esc_html__('No published tracks yet.', 'flyover-gpx'),
                'noTrendData' => \esc_html__('No trend data available yet.', 'flyover-gpx'),
                'noHeatmapData' => \esc_html__('No track points available for heatmap yet.', 'flyover-gpx'),
            ],
        ];

        \wp_add_inline_script(
            'fgpx-stats',
            'window.FGPXStatsInstances=window.FGPXStatsInstances||{};window.FGPXStatsInstances[' . \wp_json_encode($rootId) . ']=' . \wp_json_encode($instanceConfig) . ';',
            'before'
        );

        return '<div id="' . \esc_attr($rootId) . '" class="fgpx-stats-root" style="--fgpx-stats-height:' . \esc_attr($height) . ';"></div>';
    }

    /**
     * Register and enqueue frontend assets for stats views.
     */
    public function enqueue_assets(): void
    {
        AssetManager::registerAssets();

        if (!\wp_style_is('fgpx-stats', 'registered')) {
            \wp_register_style(
                'fgpx-stats',
                \esc_url_raw(\trailingslashit(FGPX_DIR_URL) . 'assets/css/stats.css'),
                ['maplibre-gl-css'],
                FGPX_VERSION
            );
        }

        if (!\wp_script_is('fgpx-stats', 'registered')) {
            \wp_register_script(
                'fgpx-stats',
                \esc_url_raw(\trailingslashit(FGPX_DIR_URL) . 'assets/js/stats.js'),
                ['maplibre-gl-js', 'chartjs'],
                FGPX_VERSION,
                true
            );
        }

        \wp_enqueue_style('maplibre-gl-css');
        \wp_enqueue_style('fgpx-stats');
        \wp_enqueue_script('maplibre-gl-js');
        \wp_enqueue_script('chartjs');
        \wp_enqueue_script('fgpx-stats');
    }

    /**
     * Clear aggregate stats transients.
     */
    public static function invalidate_cache(): void
    {
        global $wpdb;
        if (!isset($wpdb->options) || !method_exists($wpdb, 'esc_like') || !method_exists($wpdb, 'prepare') || !method_exists($wpdb, 'query')) {
            return;
        }

        $transientLike = '_transient_' . $wpdb->esc_like(self::CACHE_KEY_PREFIX) . '%';
        $timeoutLike = '_transient_timeout_' . $wpdb->esc_like(self::CACHE_KEY_PREFIX) . '%';

        $deleteTransients = $wpdb->prepare(
            "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s",
            $transientLike
        );
        if (!\is_string($deleteTransients) || $deleteTransients === '') {
            return;
        }
        $wpdb->query($deleteTransients);

        $deleteTimeouts = $wpdb->prepare(
            "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s",
            $timeoutLike
        );
        if (!\is_string($deleteTimeouts) || $deleteTimeouts === '') {
            return;
        }
        $wpdb->query($deleteTimeouts);
    }

    /**
     * @param array<string,mixed> $params
     * @return array<string,mixed>
     */
    private function build_payload(array $params): array
    {
        $maxPoints = isset($params['max_points']) ? (int) $params['max_points'] : 15000;
        $maxPoints = max(1000, min(50000, $maxPoints));
        $includeHeatmap = !isset($params['include_heatmap']) || $this->is_truthy((string) $params['include_heatmap']);

        $cacheKey = self::CACHE_KEY_PREFIX . 'mp_' . $maxPoints . '_hm_' . ($includeHeatmap ? '1' : '0');
        $cached = \get_transient($cacheKey);
        if (\is_array($cached)) {
            return $cached;
        }

        $query = new \WP_Query([
            'post_type' => 'fgpx_track',
            'post_status' => 'publish',
            'posts_per_page' => -1,
            'orderby' => 'date',
            'order' => 'ASC',
            'fields' => 'ids',
            'no_found_rows' => true,
            'cache_results' => false,
            'update_post_meta_cache' => false,
            'update_post_term_cache' => false,
        ]);

        $ids = array_map('intval', $query->posts);
        if (empty($ids)) {
            $empty = $this->empty_payload($maxPoints);
            \set_transient($cacheKey, $empty, 15 * MINUTE_IN_SECONDS);
            return $empty;
        }

        $meta = DatabaseOptimizer::getPostsWithMeta($ids, [
            'fgpx_stats',
            'fgpx_total_distance_m',
            'fgpx_moving_time_s',
            'fgpx_elevation_gain_m',
            'fgpx_max_speed_m_s',
            'fgpx_geojson',
        ]);

        $totalDistanceM = 0.0;
        $totalDurationS = 0.0;
        $totalGainM = 0.0;
        $maxDistanceM = 0.0;
        $maxGainM = 0.0;
        $maxSpeedMs = 0.0;

        $monthly = [];
        $yearly = [];
        $weekdayDistribution = [];
        $hourDistribution = [];
        $trackLengthHistogram = $this->get_track_length_histogram_template();
        $heatmapPoints = [];

        foreach ($ids as $id) {
            $stats = isset($meta[$id]['fgpx_stats']) && \is_array($meta[$id]['fgpx_stats'])
                ? $meta[$id]['fgpx_stats']
                : [];

            $geojsonRaw = isset($meta[$id]['fgpx_geojson']) ? (string) $meta[$id]['fgpx_geojson'] : '';
            $geojson = [];
            if ($geojsonRaw !== '') {
                $decodedGeojson = \json_decode($geojsonRaw, true);
                if (\is_array($decodedGeojson)) {
                    $geojson = $decodedGeojson;
                }
            }

            $distanceM = isset($stats['total_distance_m'])
                ? (float) $stats['total_distance_m']
                : (float) ($meta[$id]['fgpx_total_distance_m'] ?? 0);

            $durationS = isset($stats['moving_time_s'])
                ? (float) $stats['moving_time_s']
                : (float) ($meta[$id]['fgpx_moving_time_s'] ?? 0);

            $gainM = isset($stats['elevation_gain_m'])
                ? (float) $stats['elevation_gain_m']
                : (float) ($meta[$id]['fgpx_elevation_gain_m'] ?? 0);

            $totalDistanceM += $distanceM;
            $totalDurationS += $durationS;
            $totalGainM += $gainM;
            $maxDistanceM = max($maxDistanceM, $distanceM);
            $maxGainM = max($maxGainM, $gainM);

            $dateTs = $this->resolve_track_period_timestamp($id, $geojson);
            $monthKey = \gmdate('Y-m', $dateTs);
            $yearKey = \gmdate('Y', $dateTs);

            if (!isset($monthly[$monthKey])) {
                $monthly[$monthKey] = [
                    'period' => $monthKey,
                    'trackCount' => 0,
                    'distanceM' => 0.0,
                    'durationS' => 0.0,
                    'elevationGainM' => 0.0,
                ];
            }
            if (!isset($yearly[$yearKey])) {
                $yearly[$yearKey] = [
                    'period' => $yearKey,
                    'trackCount' => 0,
                    'distanceM' => 0.0,
                    'durationS' => 0.0,
                    'elevationGainM' => 0.0,
                ];
            }

            $monthly[$monthKey]['trackCount']++;
            $monthly[$monthKey]['distanceM'] += $distanceM;
            $monthly[$monthKey]['durationS'] += $durationS;
            $monthly[$monthKey]['elevationGainM'] += $gainM;

            $yearly[$yearKey]['trackCount']++;
            $yearly[$yearKey]['distanceM'] += $distanceM;
            $yearly[$yearKey]['durationS'] += $durationS;
            $yearly[$yearKey]['elevationGainM'] += $gainM;

            $weekdayKey = (int) \wp_date('w', $dateTs);
            if (!isset($weekdayDistribution[$weekdayKey])) {
                $weekdayDistribution[$weekdayKey] = [
                    'weekday' => $weekdayKey,
                    'trackCount' => 0,
                    'distanceM' => 0.0,
                ];
            }
            $weekdayDistribution[$weekdayKey]['trackCount']++;
            $weekdayDistribution[$weekdayKey]['distanceM'] += $distanceM;

            $hourKey = (int) \wp_date('G', $dateTs);
            if (!isset($hourDistribution[$hourKey])) {
                $hourDistribution[$hourKey] = [
                    'hour' => $hourKey,
                    'trackCount' => 0,
                    'distanceM' => 0.0,
                ];
            }
            $hourDistribution[$hourKey]['trackCount']++;
            $hourDistribution[$hourKey]['distanceM'] += $distanceM;

            $this->add_distance_to_histogram($trackLengthHistogram, max(0.0, $distanceM / 1000.0));

            $trackMaxSpeedMs = isset($stats['max_speed_m_s'])
                ? (float) $stats['max_speed_m_s']
                : (float) ($meta[$id]['fgpx_max_speed_m_s'] ?? 0.0);

            $needsHeatmap = $includeHeatmap && count($heatmapPoints) < $maxPoints;
            $needsSpeedFromGeojson = $trackMaxSpeedMs <= 0.0;
            if (!$needsHeatmap && !$needsSpeedFromGeojson) {
                $maxSpeedMs = max($maxSpeedMs, $trackMaxSpeedMs);
                continue;
            }

            if ($geojsonRaw === '' || empty($geojson)) {
                $maxSpeedMs = max($maxSpeedMs, $trackMaxSpeedMs);
                continue;
            }

            if ($trackMaxSpeedMs <= 0.0 && isset($geojson['properties']['speeds']) && \is_array($geojson['properties']['speeds'])) {
                foreach ($geojson['properties']['speeds'] as $speed) {
                    $trackMaxSpeedMs = max($trackMaxSpeedMs, (float) $speed);
                }
            }

            // Backward compatible max-speed fallback for existing tracks where
            // explicit speeds are not persisted in geojson properties.
            if ($trackMaxSpeedMs <= 0.0 && isset($geojson['properties']) && \is_array($geojson['properties'])) {
                $derived = $this->derive_max_speed_ms_from_geojson_properties($geojson['properties']);
                if ($derived > 0.0) {
                    $trackMaxSpeedMs = max($trackMaxSpeedMs, $derived);
                }
            }

            $maxSpeedMs = max($maxSpeedMs, $trackMaxSpeedMs);

            if (!$includeHeatmap || !isset($geojson['coordinates']) || !\is_array($geojson['coordinates']) || count($heatmapPoints) >= $maxPoints) {
                continue;
            }

            $coords = $geojson['coordinates'];
            $stride = max(1, (int) floor((float) count($coords) / 2000));
            for ($i = 0; $i < count($coords); $i += $stride) {
                if (count($heatmapPoints) >= $maxPoints) {
                    break;
                }

                $coord = $coords[$i];
                if (!\is_array($coord) || !isset($coord[0], $coord[1])) {
                    continue;
                }
                $lon = (float) $coord[0];
                $lat = (float) $coord[1];
                $heatmapPoints[] = [$lat, $lon, 1.0];
            }
        }

        ksort($monthly);
        ksort($yearly);
        ksort($weekdayDistribution);
        ksort($hourDistribution);

        $trackCount = count($ids);
        $avgDistanceM = $trackCount > 0 ? ($totalDistanceM / $trackCount) : 0.0;
        $avgGainM = $trackCount > 0 ? ($totalGainM / $trackCount) : 0.0;
        $avgSpeedKmh = $totalDurationS > 0 ? (($totalDistanceM / $totalDurationS) * 3.6) : 0.0;
        $maxSpeedKmh = $maxSpeedMs * 3.6;

        $monthlyValues = array_values($monthly);
        $yearlyValues = array_values($yearly);

        $tracksByMonth = [];
        $distanceByYear = [];
        $elevationByMonth = [];
        $elevationByYear = [];
        $avgSpeedByMonth = [];
        $avgSpeedByYear = [];

        foreach ($monthlyValues as $row) {
            $periodAvgSpeed = ((float) $row['durationS']) > 0.0
                ? (((float) $row['distanceM'] / (float) $row['durationS']) * 3.6)
                : 0.0;

            $tracksByMonth[] = [
                'period' => $row['period'],
                'trackCount' => (int) $row['trackCount'],
            ];
            $elevationByMonth[] = [
                'period' => $row['period'],
                'elevationGainM' => round((float) $row['elevationGainM'], 2),
            ];
            $avgSpeedByMonth[] = [
                'period' => $row['period'],
                'avgSpeedKmh' => round($periodAvgSpeed, 2),
            ];
        }

        foreach ($yearlyValues as $row) {
            $periodAvgSpeed = ((float) $row['durationS']) > 0.0
                ? (((float) $row['distanceM'] / (float) $row['durationS']) * 3.6)
                : 0.0;

            $distanceByYear[] = [
                'period' => $row['period'],
                'distanceM' => round((float) $row['distanceM'], 2),
            ];
            $elevationByYear[] = [
                'period' => $row['period'],
                'elevationGainM' => round((float) $row['elevationGainM'], 2),
            ];
            $avgSpeedByYear[] = [
                'period' => $row['period'],
                'avgSpeedKmh' => round($periodAvgSpeed, 2),
            ];
        }

        $payload = [
            'summary' => [
                'totalTracks' => $trackCount,
                'totalDistanceM' => round($totalDistanceM, 2),
                'avgDistanceM' => round($avgDistanceM, 2),
                'maxDistanceM' => round($maxDistanceM, 2),
                'totalElevationGainM' => round($totalGainM, 2),
                'avgElevationGainM' => round($avgGainM, 2),
                'maxElevationGainM' => round($maxGainM, 2),
                'avgSpeedKmh' => round($avgSpeedKmh, 2),
                'maxSpeedKmh' => round($maxSpeedKmh, 2),
            ],
            'trends' => [
                'monthly' => $monthlyValues,
                'yearly' => $yearlyValues,
            ],
            'charts' => [
                'distance_by_month' => $monthlyValues,
                'tracks_by_year' => $yearlyValues,
                'tracks_by_month' => $tracksByMonth,
                'distance_by_year' => $distanceByYear,
                'elevation_by_month' => $elevationByMonth,
                'elevation_by_year' => $elevationByYear,
                'avg_speed_by_month' => $avgSpeedByMonth,
                'avg_speed_by_year' => $avgSpeedByYear,
                'track_length_histogram' => array_values($trackLengthHistogram),
                'weekday_distribution' => array_values($weekdayDistribution),
                'hour_distribution' => array_values($hourDistribution),
            ],
            'heatmap' => [
                'maxPoints' => $maxPoints,
                'pointCount' => $includeHeatmap ? count($heatmapPoints) : 0,
                'points' => $includeHeatmap ? $heatmapPoints : [],
            ],
            'generatedAt' => \gmdate('c'),
        ];

        \set_transient($cacheKey, $payload, 15 * MINUTE_IN_SECONDS);
        return $payload;
    }

    /**
     * @return array<string,mixed>
     */
    private function empty_payload(int $maxPoints): array
    {
        return [
            'summary' => [
                'totalTracks' => 0,
                'totalDistanceM' => 0.0,
                'avgDistanceM' => 0.0,
                'maxDistanceM' => 0.0,
                'totalElevationGainM' => 0.0,
                'avgElevationGainM' => 0.0,
                'maxElevationGainM' => 0.0,
                'avgSpeedKmh' => 0.0,
                'maxSpeedKmh' => 0.0,
            ],
            'trends' => [
                'monthly' => [],
                'yearly' => [],
            ],
            'charts' => [
                'distance_by_month' => [],
                'tracks_by_year' => [],
                'tracks_by_month' => [],
                'distance_by_year' => [],
                'elevation_by_month' => [],
                'elevation_by_year' => [],
                'avg_speed_by_month' => [],
                'avg_speed_by_year' => [],
                'track_length_histogram' => $this->get_track_length_histogram_template(),
                'weekday_distribution' => [],
                'hour_distribution' => [],
            ],
            'heatmap' => [
                'maxPoints' => $maxPoints,
                'pointCount' => 0,
                'points' => [],
            ],
            'generatedAt' => \gmdate('c'),
        ];
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    private function get_track_length_histogram_template(): array
    {
        return [
            ['bucket' => '0-5 km', 'minKm' => 0.0, 'maxKm' => 5.0, 'count' => 0],
            ['bucket' => '5-10 km', 'minKm' => 5.0, 'maxKm' => 10.0, 'count' => 0],
            ['bucket' => '10-20 km', 'minKm' => 10.0, 'maxKm' => 20.0, 'count' => 0],
            ['bucket' => '20-50 km', 'minKm' => 20.0, 'maxKm' => 50.0, 'count' => 0],
            ['bucket' => '50-100 km', 'minKm' => 50.0, 'maxKm' => 100.0, 'count' => 0],
            ['bucket' => '100-200 km', 'minKm' => 100.0, 'maxKm' => 200.0, 'count' => 0],
            ['bucket' => '200-300 km', 'minKm' => 200.0, 'maxKm' => 300.0, 'count' => 0],
            ['bucket' => '300-400 km', 'minKm' => 300.0, 'maxKm' => 400.0, 'count' => 0],
            ['bucket' => '400-500 km', 'minKm' => 400.0, 'maxKm' => 500.0, 'count' => 0],
            ['bucket' => '500+ km', 'minKm' => 500.0, 'maxKm' => null, 'count' => 0],
        ];
    }

    /**
     * @param array<int,array<string,mixed>> $histogram
     */
    private function add_distance_to_histogram(array &$histogram, float $distanceKm): void
    {
        for ($i = 0; $i < count($histogram); $i++) {
            $bucket = $histogram[$i];
            $minKm = isset($bucket['minKm']) ? (float) $bucket['minKm'] : 0.0;
            $maxKm = isset($bucket['maxKm']) && $bucket['maxKm'] !== null
                ? (float) $bucket['maxKm']
                : null;

            if ($distanceKm < $minKm) {
                continue;
            }
            if ($maxKm !== null && $distanceKm >= $maxKm) {
                continue;
            }

            $histogram[$i]['count'] = (int) ($histogram[$i]['count'] ?? 0) + 1;
            return;
        }
    }

    private function is_truthy(string $value): bool
    {
        return \in_array(\strtolower(\trim($value)), ['1', 'true', 'yes', 'on'], true);
    }

    /**
     * @param array<string,mixed> $geojson
     */
    private function resolve_track_period_timestamp(int $postId, array $geojson): int
    {
        $fallback = (int) \get_post_time('U', true, $postId);

        if (!isset($geojson['properties']) || !\is_array($geojson['properties'])) {
            return $fallback;
        }

        $properties = $geojson['properties'];
        if (!isset($properties['timestamps']) || !\is_array($properties['timestamps'])) {
            return $fallback;
        }

        foreach ($properties['timestamps'] as $candidate) {
            $timestamp = $this->to_unix_seconds($candidate);
            if ($timestamp <= 0) {
                continue;
            }

            // Accept only absolute-looking timestamps (not relative offsets like 0, 10, 20).
            if (!$this->is_absolute_track_timestamp($candidate, $timestamp)) {
                continue;
            }

            return $timestamp;
        }

        return $fallback;
    }

    /**
     * @param mixed $rawValue
     */
    private function is_absolute_track_timestamp($rawValue, int $timestamp): bool
    {
        if ($timestamp <= 0) {
            return false;
        }

        // Parseable datetime strings (ISO/RFC-like) should be treated as absolute time.
        if (\is_string($rawValue) && \preg_match('/[-:T ]/', $rawValue) === 1) {
            return true;
        }

        // Numeric values are accepted only in plausible Unix-seconds range.
        return $timestamp >= 946684800 && $timestamp <= 4102444800;
    }

    /**
     * @param array<string,mixed> $properties
     */
    private function derive_max_speed_ms_from_geojson_properties(array $properties): float
    {
        $timestamps = isset($properties['timestamps']) && \is_array($properties['timestamps'])
            ? $properties['timestamps']
            : [];
        $cumulative = isset($properties['cumulativeDistance']) && \is_array($properties['cumulativeDistance'])
            ? $properties['cumulativeDistance']
            : [];

        if (\count($timestamps) < 2 || \count($cumulative) < 2) {
            return 0.0;
        }

        $n = min(\count($timestamps), \count($cumulative));
        $maxSpeedMs = 0.0;
        for ($i = 1; $i < $n; $i++) {
            $dt = $this->to_unix_seconds($timestamps[$i]) - $this->to_unix_seconds($timestamps[$i - 1]);
            if ($dt <= 0) {
                continue;
            }

            $dd = (float) $cumulative[$i] - (float) $cumulative[$i - 1];
            if ($dd <= 0) {
                continue;
            }

            $speed = $dd / $dt;
            if ($speed > $maxSpeedMs && \is_finite($speed)) {
                $maxSpeedMs = $speed;
            }
        }

        return $maxSpeedMs;
    }

    /**
     * @param mixed $value
     */
    private function to_unix_seconds($value): int
    {
        if (\is_int($value) || \is_float($value)) {
            return (int) $value;
        }

        if (!\is_string($value)) {
            return 0;
        }

        $trimmed = \trim($value);
        if ($trimmed === '') {
            return 0;
        }

        if (\preg_match('/^\d+$/', $trimmed) === 1) {
            return (int) $trimmed;
        }

        $ts = \strtotime($trimmed);
        return $ts !== false ? (int) $ts : 0;
    }

    private function is_track_post(int $postId): bool
    {
        $post = \get_post($postId);
        if (!($post instanceof \WP_Post)) {
            return false;
        }

        return (string) ($post->post_type ?? '') === 'fgpx_track';
    }
}