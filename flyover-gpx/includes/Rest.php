<?php

declare(strict_types=1);

namespace FGpx;

if (!\defined('ABSPATH')) {
    exit;
}
use WP_REST_Request;
use WP_REST_Response;

/**
 * REST API endpoints for Flyover GPX.
 */
final class Rest
{
    /**
     * Compress coordinates using relative encoding for smaller payloads.
     * Reduces coordinate precision while maintaining visual accuracy.
     *
     * @param array<int,array{0:float,1:float,2?:float}> $coords Original coordinates
     * @return array{coordinates: array<int,array{0:float,1:float,2?:float}>, compressed: bool, reduction: float}
     */
    private static function compressCoordinates(array $coords): array
    {
        if (empty($coords)) {
            return ['coordinates' => $coords, 'compressed' => false, 'reduction' => 0.0];
        }

        $compressed = [];
        $precision = 100000; // ~1.1m precision at equator
        
        // Use first coordinate as reference point
        $refLat = $coords[0][0];
        $refLon = $coords[0][1];
        $refEle = isset($coords[0][2]) ? $coords[0][2] : null;
        
        foreach ($coords as $i => $coord) {
            if ($i === 0) {
                // Keep first coordinate as-is for reference
                $compressed[] = $coord;
                continue;
            }
            
            // Calculate relative offsets and round to precision
            $latOffset = round(($coord[0] - $refLat) * $precision) / $precision;
            $lonOffset = round(($coord[1] - $refLon) * $precision) / $precision;
            
            $compressedCoord = [$refLat + $latOffset, $refLon + $lonOffset];
            
            // Handle elevation if present
            if (isset($coord[2]) && $refEle !== null) {
                $eleOffset = round(($coord[2] - $refEle) * 10) / 10; // 0.1m elevation precision
                $compressedCoord[] = $refEle + $eleOffset;
            } elseif (isset($coord[2])) {
                $compressedCoord[] = round($coord[2] * 10) / 10;
            }
            
            $compressed[] = $compressedCoord;
        }
        
        // Calculate compression ratio
        $originalSize = strlen(json_encode($coords));
        $compressedSize = strlen(json_encode($compressed));
        $reduction = $originalSize > 0 ? (1 - $compressedSize / $originalSize) : 0.0;
        
        return [
            'coordinates' => $compressed,
            'compressed' => true,
            'reduction' => $reduction
        ];
    }

    /**
     * Calculate optimal target point count based on original track size.
     * Provides better performance for large tracks while maintaining quality for smaller ones.
     *
     * @param int $originalPoints Original number of points in the track
     * @param int $adminTarget Admin-configured target (fallback)
     * @return int Optimal target point count
     */
    private static function calculateOptimalTarget(int $originalPoints, int $adminTarget): int
    {
        // Safety bounds: never go below 300 or above 2500 points
        $minTarget = 300;
        $maxTarget = 2500;
        
        // For small tracks (< 2000 points), use admin setting or minimal reduction
        if ($originalPoints <= 2000) {
            return max($minTarget, min($adminTarget, $originalPoints));
        }
        
        // For medium tracks (2000-10000 points), use moderate reduction
        if ($originalPoints <= 10000) {
            $dynamicTarget = max(800, min(1500, (int)($originalPoints * 0.15)));
            return max($minTarget, min($maxTarget, $dynamicTarget));
        }
        
        // For large tracks (10000-50000 points), use more aggressive reduction
        if ($originalPoints <= 50000) {
            $dynamicTarget = max(1000, min(2000, (int)($originalPoints * 0.05)));
            return max($minTarget, min($maxTarget, $dynamicTarget));
        }
        
        // For very large tracks (50000+ points), use maximum reduction
        $dynamicTarget = max(1200, min(2500, (int)($originalPoints * 0.03)));
        return max($minTarget, min($maxTarget, $dynamicTarget));
    }

    /**
     * Estimate power values from route geometry and timing if no real GPX power is present.
     *
     * @param array<int,array{0:float,1:float,2?:float}> $coords
     * @param array<int,mixed> $timestamps
     * @param array<int,mixed> $cumDist
     * @return array<int,float>
     */
    private static function estimate_powers(array $coords, array $timestamps, array $cumDist, float $systemWeightKg): array
    {
        $count = count($coords);
        if ($count === 0) {
            return [];
        }

        $mass = max(40.0, min(200.0, $systemWeightKg));
        $g = 9.81;
        $cRR = 0.004;
        $cDA = 0.32;
        $rho = 1.2;
        $defaultSpeed = 6.5; // ~23.4 km/h fallback
        $lastSpeed = $defaultSpeed;

        $powers = array_fill(0, $count, 0.0);

        for ($i = 1; $i < $count; $i++) {
            $dist = 0.0;
            if (isset($cumDist[$i], $cumDist[$i - 1]) && is_numeric($cumDist[$i]) && is_numeric($cumDist[$i - 1])) {
                $dist = max(0.0, (float) $cumDist[$i] - (float) $cumDist[$i - 1]);
            }

            $dt = 0.0;
            if (isset($timestamps[$i], $timestamps[$i - 1]) && is_string($timestamps[$i]) && is_string($timestamps[$i - 1])) {
                $t1 = strtotime($timestamps[$i]);
                $t0 = strtotime($timestamps[$i - 1]);
                if ($t1 !== false && $t0 !== false) {
                    $dt = max(0.0, (float) ($t1 - $t0));
                }
            }

            $speed = $lastSpeed;
            if ($dist > 0.0 && $dt > 0.0) {
                $speed = $dist / $dt;
            } elseif ($dist > 0.0) {
                $speed = $defaultSpeed;
            }
            $speed = max(0.0, min(30.0, $speed));
            $lastSpeed = $speed > 0.0 ? $speed : $lastSpeed;

            $ele0 = isset($coords[$i - 1][2]) && is_numeric($coords[$i - 1][2]) ? (float) $coords[$i - 1][2] : 0.0;
            $ele1 = isset($coords[$i][2]) && is_numeric($coords[$i][2]) ? (float) $coords[$i][2] : $ele0;
            $grade = $dist > 0.0 ? (($ele1 - $ele0) / $dist) : 0.0;
            $grade = max(-0.25, min(0.25, $grade));

            $rolling = $cRR * $mass * $g;
            $gravity = $mass * $g * $grade;
            $aero = 0.5 * $cDA * $rho * $speed * $speed;
            $power = ($rolling + $gravity + $aero) * $speed;
            $powers[$i] = max(0.0, min(2000.0, round($power, 1)));
        }

        if ($count > 1) {
            $powers[0] = $powers[1];
        }

        return $powers;
    }

    /**
     * Ensure geojson has usable power data, estimating if necessary.
     *
     * @param array<string,mixed>|null $decodedGeo
     * @return array{geojson: array<string,mixed>|null, estimatedPower: bool}
     */
    private static function ensurePowerDataWithEstimate(?array $decodedGeo, float $systemWeightKg): array
    {
        if (!is_array($decodedGeo) || !isset($decodedGeo['coordinates']) || !is_array($decodedGeo['coordinates'])) {
            return ['geojson' => $decodedGeo, 'estimatedPower' => false];
        }

        $props = isset($decodedGeo['properties']) && is_array($decodedGeo['properties']) ? $decodedGeo['properties'] : [];
        $powers = isset($props['powers']) && is_array($props['powers']) ? $props['powers'] : [];

        $hasRealPower = false;
        foreach ($powers as $p) {
            if (is_numeric($p) && (float) $p > 0.0) {
                $hasRealPower = true;
                break;
            }
        }

        if ($hasRealPower) {
            return ['geojson' => $decodedGeo, 'estimatedPower' => false];
        }

        $timestamps = isset($props['timestamps']) && is_array($props['timestamps']) ? $props['timestamps'] : [];
        $cumDist = isset($props['cumulativeDistance']) && is_array($props['cumulativeDistance']) ? $props['cumulativeDistance'] : [];
        $coords = $decodedGeo['coordinates'];

        $estimated = self::estimate_powers($coords, $timestamps, $cumDist, $systemWeightKg);
        if (!empty($estimated)) {
            $props['powers'] = $estimated;
            $decodedGeo['properties'] = $props;
            return ['geojson' => $decodedGeo, 'estimatedPower' => true];
        }

        return ['geojson' => $decodedGeo, 'estimatedPower' => false];
    }

    /**
     * Simplify with Ramer–Douglas–Peucker to approximately target points,
     * mirroring the frontend approach (binary-search tolerance).
     * Returns array of kept indices.
     *
     * @param array<int,array{0:float,1:float,2?:float}> $coords
     * @return array<int,int>
     */
    private static function dp_choose_and_simplify(array $coords, int $targetPoints): array
    {
        $n = count($coords);
        if ($n <= 2 || $targetPoints <= 2) {
            return [0, max(0, $n - 1)];
        }
        // Compute bbox diag as heuristic scale
        $minX = INF; $minY = INF; $maxX = -INF; $maxY = -INF;
        foreach ($coords as $c) {
            $x = (float) $c[0]; $y = (float) $c[1];
            if ($x < $minX) $minX = $x; if ($x > $maxX) $maxX = $x;
            if ($y < $minY) $minY = $y; if ($y > $maxY) $maxY = $y;
        }
        $diag = hypot($maxX - $minX, $maxY - $minY);
        $low = 0.0; $high = max(1e-9, $diag * 0.01);
        $bestTol = $high;
        for ($iter = 0; $iter < 10; $iter++) {
            $mid = ($low + $high) / 2.0;
            $indices = self::dp_simplify_indices($coords, $mid * $mid);
            if (count($indices) > $targetPoints) {
                $low = $mid; // need more tolerance
            } else {
                $bestTol = $mid; $high = $mid;
            }
        }
        return self::dp_simplify_indices($coords, $bestTol * $bestTol);
    }

    /**
     * Iterative DP returning kept indices using squared tolerance.
     *
     * @param array<int,array{0:float,1:float,2?:float}> $coords
     * @return array<int,int>
     */
    private static function dp_simplify_indices(array $coords, float $sqTol): array
    {
        $n = count($coords);
        if ($n <= 2) { return [0, max(0, $n - 1)]; }
        $markers = array_fill(0, $n, 0);
        $stack = [[0, $n - 1]];
        $markers[0] = 1; $markers[$n - 1] = 1;

        $getSqSegDist = static function(array $p, array $p1, array $p2): float {
            $x = (float) $p1[0]; $y = (float) $p1[1];
            $dx = (float) $p2[0] - $x; $dy = (float) $p2[1] - $y;
            if ($dx != 0.0 || $dy != 0.0) {
                $t = ((($p[0] - $x) * $dx) + (($p[1] - $y) * $dy)) / (($dx * $dx) + ($dy * $dy));
                if ($t > 1.0) { $x = (float) $p2[0]; $y = (float) $p2[1]; }
                elseif ($t > 0.0) { $x += $dx * $t; $y += $dy * $t; }
            }
            $dx = (float) $p[0] - $x; $dy = (float) $p[1] - $y;
            return $dx * $dx + $dy * $dy;
        };

        while (!empty($stack)) {
            [$first, $last] = array_pop($stack);
            $maxSq = 0.0; $index = -1;
            for ($i = $first + 1; $i < $last; $i++) {
                $sq = $getSqSegDist($coords[$i], $coords[$first], $coords[$last]);
                if ($sq > $maxSq) { $maxSq = $sq; $index = $i; }
            }
            if ($maxSq > $sqTol && $index !== -1) {
                $markers[$index] = 1;
                $stack[] = [$first, $index];
                $stack[] = [$index, $last];
            }
        }

        $out = [];
        for ($i = 0; $i < $n; $i++) { if ($markers[$i] === 1) { $out[] = $i; } }
        if (empty($out)) { $out = [0, $n - 1]; }
        return $out;
    }
    /**
     * Convert EXIF GPS array to float degrees
     */
    private static function exif_gps_to_float($coord, $hemisphere)
    {
        if (!is_array($coord) || count($coord) < 3) { return null; }
        $toFloat = static function ($v) {
            if (is_string($v) && strpos($v, '/') !== false) {
                list($n, $d) = array_map('floatval', explode('/', $v, 2));
                return $d != 0.0 ? ($n / $d) : 0.0;
            }
            return (float) $v;
        };
        $deg = $toFloat($coord[0]);
        $min = $toFloat($coord[1]);
        $sec = $toFloat($coord[2]);
        $sign = (in_array($hemisphere, ['S', 'W'], true)) ? -1.0 : 1.0;
        return $sign * ($deg + ($min / 60.0) + ($sec / 3600.0));
    }

    /**
     * Keep the first photo per rounded location (~10 m precision).
     *
     * @param array<int,array<string,mixed>> $photos
     * @return array<int,array<string,mixed>>
     */
    private static function dedupe_photos_by_location(array $photos): array
    {
        $seen = [];
        $out = [];
        foreach ($photos as $p) {
            $lat = $p['lat'] ?? null;
            $lon = $p['lon'] ?? null;
            if (\is_numeric($lat) && \is_numeric($lon)) {
                $key = \sprintf('%.4f,%.4f', \round((float)$lat, 4), \round((float)$lon, 4));
                if (isset($seen[$key])) { continue; }
                $seen[$key] = true;
            }
            $out[] = $p;
        }
        return $out;
    }

    /**
     * Register REST hooks.
     */
    public function register(): void
    {
        \add_action('rest_api_init', [$this, 'register_routes']);
        // AJAX fallback for environments blocking /wp-json
        \add_action('wp_ajax_fgpx_track', [$this, 'ajax_get_track']);
        \add_action('wp_ajax_nopriv_fgpx_track', [$this, 'ajax_get_track']);
        // GPX file download
        \add_action('wp_ajax_fgpx_download_gpx', [$this, 'ajax_download_gpx']);
        \add_action('wp_ajax_nopriv_fgpx_download_gpx', [$this, 'ajax_download_gpx']);
    }

    /**
     * Register plugin routes.
     */
    public function register_routes(): void
    {
        \register_rest_route(
            'fgpx/v1',
            '/track/(?P<id>\\d+)',
            [
                'methods' => 'GET',
                'callback' => [$this, 'get_track'],
                'permission_callback' => [$this, 'can_read_track'],
                'args' => [
                    'id' => [
                        'validate_callback' => static function ($param): bool {
                            return is_numeric($param) && (int) $param > 0;
                        },
                    ],
                ],
            ]
        );
    }

    /**
     * Permission callback for track visibility.
     *
     * Published tracks are public; non-published tracks require read capability.
     */
    public function can_read_track(WP_REST_Request $request): bool
    {
        $id = (int) $request->get_param('id');
        if ($id <= 0) {
            return false;
        }

        $post = \get_post($id);
        if (!$post || $post->post_type !== 'fgpx_track') {
            return false;
        }

        if ($post->post_status === 'publish') {
            return true;
        }

        return \current_user_can('read_post', $id);
    }

    /**
     * Return stored stats, bounds and geojson for a given track with transient caching.
     */
    public function get_track(WP_REST_Request $request)
    {
        $id = (int) $request->get_param('id');

        $post = \get_post($id);
        if (!$post || $post->post_type !== 'fgpx_track') {
            return new WP_REST_Response(['message' => 'Not found'], 404);
        }

        // Defense-in-depth: keep visibility gate even though permission callback already enforces it.
        if ($post->post_status !== 'publish' && !\current_user_can('read_post', $id)) {
            return new WP_REST_Response(['message' => 'Forbidden'], 403);
        }

        $modified = (string) $post->post_modified_gmt;
        $simplifyEnabled = (string) \get_option('fgpx_backend_simplify_enabled', '0') === '1';
        $simplifyTarget = (int) \get_option('fgpx_backend_simplify_target', '1500');
        $windAnalysisEnabled = (string) \get_option('fgpx_wind_analysis_enabled', '0');
        $hostPostForCache = (int) $request->get_param('host_post');
        $strategy = \sanitize_key((string) $request->get_param('strategy'));
        $resolvedHostPostForCache = $hostPostForCache;
        if ($resolvedHostPostForCache === 0 && $strategy === 'latest_embed') {
            $resolvedHostPostForCache = $this->find_latest_embedding_post_id($id);
        }
        $sourcePostModifiedToken = 'na';
        if ($resolvedHostPostForCache > 0) {
            $sourcePostForCache = \get_post($resolvedHostPostForCache);
            if ($sourcePostForCache && isset($sourcePostForCache->post_modified_gmt)) {
                $modifiedGmt = (string) $sourcePostForCache->post_modified_gmt;
                if ($modifiedGmt !== '') {
                    $sourcePostModifiedToken = preg_replace('/[^0-9]/', '', $modifiedGmt) ?: 'na';
                }
            }
        }
        $weatherPoints = \get_post_meta($id, 'fgpx_weather_points', true);
        $hasWeather = (\is_string($weatherPoints) && $weatherPoints !== '') ? '1' : '0';
        $cache_key = 'fgpx_json_v3_' . $id . '_' . $modified . '_hp_' . $hostPostForCache . '_rh_' . $resolvedHostPostForCache . '_sm_' . $sourcePostModifiedToken . '_simp_' . ($simplifyEnabled ? $simplifyTarget : 0) . '_w_' . $hasWeather . '_wind_' . $windAnalysisEnabled . '_st_' . ($strategy ?: 'default');

        $cached = \get_transient($cache_key);
        if (\is_array($cached)) {
            header('Cache-Control: public, max-age=300');
            \wp_send_json($cached, 200);
        }

        // Use optimized bulk meta loading for better performance in REST endpoint
        $metaData = DatabaseOptimizer::getPostsWithMeta([$id], [
            'fgpx_stats', 'fgpx_geojson', 'fgpx_bounds', 'fgpx_points_count'
        ])[$id];
        
        $stats = $metaData['fgpx_stats'];
        $geojson = $metaData['fgpx_geojson'];
        $bounds = $metaData['fgpx_bounds'];
        $pointsCount = (int) $metaData['fgpx_points_count'];

        // Optimize JSON parsing - single decode with error handling
        $decodedGeo = null;
        $geojsonDecodeError = false;
        $geojsonDecodeErrorMessage = '';
        if (\is_string($geojson) && $geojson !== '') {
            $decodedGeo = \json_decode($geojson, true);
            if (\json_last_error() !== JSON_ERROR_NONE) {
                ErrorHandler::warning('JSON decode error in REST endpoint', [
                    'error' => \json_last_error_msg(),
                    'track_id' => $id,
                    'geojson_length' => \strlen($geojson)
                ]);
                $geojsonDecodeError = true;
                $geojsonDecodeErrorMessage = 'Invalid JSON payload';
                $decodedGeo = null;
            } elseif (!\is_array($decodedGeo)) {
                ErrorHandler::warning('Invalid geojson structure in REST endpoint', [
                    'track_id' => $id,
                    'decoded_type' => \gettype($decodedGeo),
                ]);
                $geojsonDecodeError = true;
                $geojsonDecodeErrorMessage = 'Decoded payload is not an object';
                $decodedGeo = null;
            }
        }

        if ($geojsonDecodeError) {
            ErrorHandler::error('Corrupted track geometry in REST endpoint', [
                'track_id' => $id,
                'reason' => $geojsonDecodeErrorMessage,
                'geojson_length' => \is_string($geojson) ? \strlen($geojson) : 0,
            ]);

            return new WP_REST_Response([
                'code' => 'fgpx_corrupt_geojson',
                'message' => 'Track data is corrupted. Please re-import this GPX track in the plugin admin.',
                'track_id' => $id,
            ], 500);
        }

        // Optional backend simplification (Ramer–Douglas–Peucker) with dynamic target point count
        if ($simplifyEnabled && \is_array($decodedGeo) && isset($decodedGeo['type']) && $decodedGeo['type'] === 'LineString' && isset($decodedGeo['coordinates']) && \is_array($decodedGeo['coordinates'])) {
            $coords = $decodedGeo['coordinates'];
            $props = isset($decodedGeo['properties']) && \is_array($decodedGeo['properties']) ? $decodedGeo['properties'] : [];
            $timestamps = isset($props['timestamps']) && \is_array($props['timestamps']) ? $props['timestamps'] : null;
            $cum = isset($props['cumulativeDistance']) && \is_array($props['cumulativeDistance']) ? $props['cumulativeDistance'] : null;
            $heartRates = isset($props['heartRates']) && \is_array($props['heartRates']) ? $props['heartRates'] : null;
            $cadences = isset($props['cadences']) && \is_array($props['cadences']) ? $props['cadences'] : null;
            $temperatures = isset($props['temperatures']) && \is_array($props['temperatures']) ? $props['temperatures'] : null;
            $powers = isset($props['powers']) && \is_array($props['powers']) ? $props['powers'] : null;
            $windSpeeds = isset($props['windSpeeds']) && \is_array($props['windSpeeds']) ? $props['windSpeeds'] : null;
            $windDirections = isset($props['windDirections']) && \is_array($props['windDirections']) ? $props['windDirections'] : null;
            $windImpacts = isset($props['windImpacts']) && \is_array($props['windImpacts']) ? $props['windImpacts'] : null;
            
            // Calculate dynamic target based on original point count for better performance
            $originalPoints = \count($coords);
            $dynamicTarget = self::calculateOptimalTarget($originalPoints, $simplifyTarget);
            
            // Log performance optimization for large tracks
            if ($originalPoints > 10000) {
                ErrorHandler::info('Large track simplification', [
                    'original_points' => $originalPoints,
                    'admin_target' => $simplifyTarget,
                    'dynamic_target' => $dynamicTarget,
                    'reduction_ratio' => round((1 - $dynamicTarget / $originalPoints) * 100, 1) . '%'
                ]);
            }
            
            if ($originalPoints > max(200, $dynamicTarget)) {
                $indices = self::dp_choose_and_simplify($coords, max(100, $dynamicTarget));
                if (!empty($indices)) {
                    $simplifiedCoords = array_values(array_map(static function($idx) use ($coords) { return $coords[$idx]; }, $indices));
                    
                    // Apply coordinate compression for additional payload reduction (REST endpoint)
                    $compressionResult = self::compressCoordinates($simplifiedCoords);
                    $decodedGeo['coordinates'] = $compressionResult['coordinates'];
                    
                    // Log compression effectiveness for large tracks
                    if ($originalPoints > 10000 && $compressionResult['compressed']) {
                        ErrorHandler::debug('Coordinate compression applied (REST)', [
                            'original_points' => $originalPoints,
                            'simplified_points' => \count($simplifiedCoords),
                            'compression_reduction' => round($compressionResult['reduction'] * 100, 1) . '%'
                        ]);
                    }
                    if ($timestamps !== null) { $props['timestamps'] = array_values(array_map(static function($idx) use ($timestamps) { return $timestamps[$idx]; }, $indices)); }
                    if ($cum !== null) { $props['cumulativeDistance'] = array_values(array_map(static function($idx) use ($cum) { return $cum[$idx]; }, $indices)); }
                    if ($heartRates !== null) { $props['heartRates'] = array_values(array_map(static function($idx) use ($heartRates) { return $heartRates[$idx]; }, $indices)); }
                    if ($cadences !== null) { $props['cadences'] = array_values(array_map(static function($idx) use ($cadences) { return $cadences[$idx]; }, $indices)); }
                    if ($temperatures !== null) { $props['temperatures'] = array_values(array_map(static function($idx) use ($temperatures) { return $temperatures[$idx]; }, $indices)); }
                    if ($powers !== null) { $props['powers'] = array_values(array_map(static function($idx) use ($powers) { return $powers[$idx]; }, $indices)); }
                    if ($windSpeeds !== null) { $props['windSpeeds'] = array_values(array_map(static function($idx) use ($windSpeeds) { return $windSpeeds[$idx]; }, $indices)); }
                    if ($windDirections !== null) { $props['windDirections'] = array_values(array_map(static function($idx) use ($windDirections) { return $windDirections[$idx]; }, $indices)); }
                    if ($windImpacts !== null) { $props['windImpacts'] = array_values(array_map(static function($idx) use ($windImpacts) { return $windImpacts[$idx]; }, $indices)); }
                    $decodedGeo['properties'] = $props;
                }
            }
        }

        // Performance monitoring: track response size for optimization effectiveness
        $responseSize = \strlen(\json_encode($decodedGeo));
        if (isset($originalPoints) && $originalPoints > 1000) {
            ErrorHandler::debug('REST response size monitoring', [
                'track_id' => $id,
                'original_points' => isset($originalPoints) ? $originalPoints : 'unknown',
                'final_points' => $decodedGeo && isset($decodedGeo['coordinates']) ? \count($decodedGeo['coordinates']) : 0,
                'response_size_kb' => round($responseSize / 1024, 1),
                'simplification_enabled' => $simplifyEnabled
            ]);
        }

        $systemWeightKg = (float) \get_option('fgpx_system_weight_kg', '75');
        $powerEstimation = self::ensurePowerDataWithEstimate($decodedGeo, $systemWeightKg);
        $decodedGeo = $powerEstimation['geojson'];
        $estimatedPower = $powerEstimation['estimatedPower'];

        // Attempt to collect attached photos (images) with EXIF GPS/time
        $photos = [];
        // Optional: fetch attachments from the host post that contains the shortcode
        $collectFromPost = $resolvedHostPostForCache > 0 ? $resolvedHostPostForCache : 0;
        $sourcePostId = 0;
        $sourcePostTitle = '';

        if ($hostPostForCache === 0 && $strategy === 'latest_embed') {
            ErrorHandler::debug('Gallery photo strategy resolved', [
                'track_id' => $id,
                'strategy' => $strategy,
                'resolved_post_id' => $collectFromPost,
            ]);
        }

        // Track the source post for photo metadata
        if ($collectFromPost > 0) {
            $sourcePostId = $collectFromPost;
            $sourcePostTitle = (string) \get_the_title($collectFromPost) ?: '';
        }

        $attachmentIds = [];
        $fallbackAttachmentIds = [];
        $imageUrls = [];
        $hasHostSourcedPhotos = false;
        if ($collectFromPost > 0) {
            // 1) Attached media to the host post
            $attached = \get_attached_media('image', $collectFromPost);
            if (\is_array($attached)) {
                foreach ($attached as $att) { $attachmentIds[(int) $att->ID] = true; }
            }
            // 2) Gallery block / shortcode ids
            $galleries = function_exists('get_post_galleries') ? get_post_galleries($collectFromPost, false) : [];
            if (\is_array($galleries)) {
                foreach ($galleries as $gal) {
                    if (!empty($gal['ids'])) {
                        $ids = array_filter(array_map('intval', explode(',', (string) $gal['ids'])));
                        foreach ($ids as $gid) { $attachmentIds[$gid] = true; }
                    }
                }
            }
            // 3) Parse inline img tags with wp-image-ID and collect raw URLs (CDN/static allowed)
            $content = (string) get_post_field('post_content', $collectFromPost);
            if ($content !== '') {
                if (preg_match_all('/wp-image-(\d+)/', $content, $m)) {
                    foreach ($m[1] as $mid) { $attachmentIds[(int) $mid] = true; }
                }
                // Collect URLs from <img src> and <a href> that look like images; allow query strings
                if (preg_match_all('/<img[^>]+src="([^\"]+\.(?:jpe?g|png|webp))(?:\?[^\"]*)?"/i', $content, $mImg)) {
                    foreach ($mImg[1] as $u) { $imageUrls[] = (string) $u; $aid = function_exists('attachment_url_to_postid') ? attachment_url_to_postid($u) : 0; if ($aid) { $attachmentIds[(int) $aid] = true; } }
                }
                if (preg_match_all('/<a[^>]+href="([^\"]+\.(?:jpe?g|png|webp))(?:\?[^\"]*)?"/i', $content, $mHref)) {
                    foreach ($mHref[1] as $u) { $imageUrls[] = (string) $u; $aid = function_exists('attachment_url_to_postid') ? attachment_url_to_postid($u) : 0; if ($aid) { $attachmentIds[(int) $aid] = true; } }
                }
            }
        }
        
        // Log fallback to track attachments if strategy found no embedding post
        if ($collectFromPost === 0 && $strategy === 'latest_embed') {
            ErrorHandler::debug('Gallery photo strategy fell back to track attachments', [
                'track_id' => $id,
                'strategy' => $strategy,
                'reason' => 'No embedding post found, using track photos',
            ]);
        }

        // Fallback to track's attachments if none found
        if (empty($attachmentIds)) {
            $fallback = \get_children([
                'post_parent' => $id,
                'post_type' => 'attachment',
                'post_status' => 'inherit',
                'numberposts' => -1,
                'post_mime_type' => 'image'
            ]);
            if (\is_array($fallback)) {
                foreach ($fallback as $att) {
                    $attId = (int) $att->ID;
                    $attachmentIds[$attId] = true;
                    $fallbackAttachmentIds[$attId] = true;
                }
            }
        }

        foreach (array_keys($attachmentIds) as $att_id) {
            $file = \get_attached_file($att_id);
            if (!$file || !is_readable($file)) { continue; }
            $thumb = \wp_get_attachment_image_src($att_id, 'medium');
            $full = \wp_get_attachment_image_src($att_id, 'large');
            $meta = \wp_read_image_metadata($file);
            $lat = isset($meta['latitude']) ? (float) $meta['latitude'] : null;
            $lon = isset($meta['longitude']) ? (float) $meta['longitude'] : null;
            $createdTs = isset($meta['created_timestamp']) ? (int) $meta['created_timestamp'] : null;
            // Try exif if wp_read_image_metadata lacks GPS
            if (($lat === null || $lon === null) && function_exists('exif_read_data')) {
                $ex = @exif_read_data($file, 'EXIF', true, false);
                if (is_array($ex) && isset($ex['GPS'])) {
                    $gps = $ex['GPS'];
                    $lat = isset($gps['GPSLatitude'], $gps['GPSLatitudeRef']) ? self::exif_gps_to_float($gps['GPSLatitude'], $gps['GPSLatitudeRef']) : $lat;
                    $lon = isset($gps['GPSLongitude'], $gps['GPSLongitudeRef']) ? self::exif_gps_to_float($gps['GPSLongitude'], $gps['GPSLongitudeRef']) : $lon;
                }
                if ($createdTs === null && isset($ex['EXIF']['DateTimeOriginal'])) {
                    $dto = $ex['EXIF']['DateTimeOriginal'];
                    $createdTs = $dto ? strtotime(str_replace(':', '-', substr($dto,0,10)) . substr($dto,10)) : null;
                }
            }
            $cap = function_exists('wp_get_attachment_caption') ? (\wp_get_attachment_caption($att_id) ?: '') : '';
            if ($cap === '') { $cap = (string) get_post_field('post_excerpt', $att_id) ?: ''; }
            $desc = (string) get_post_field('post_content', $att_id);
            $photoSourcePostId = isset($fallbackAttachmentIds[$att_id]) ? 0 : $sourcePostId;
            $photoSourcePostTitle = isset($fallbackAttachmentIds[$att_id]) ? '' : $sourcePostTitle;
            if ($photoSourcePostId > 0) {
                $hasHostSourcedPhotos = true;
            }
            $photos[] = [
                'id' => (int) $att_id,
                'title' => (string) \get_the_title($att_id),
                'caption' => $cap,
                'description' => $desc,
                'lat' => $lat,
                'lon' => $lon,
                'timestamp' => $createdTs ? gmdate('c', $createdTs) : null,
                'thumbUrl' => \is_array($thumb) ? (string) $thumb[0] : (string) \wp_get_attachment_url($att_id),
                'fullUrl' => \is_array($full) ? (string) $full[0] : (string) \wp_get_attachment_url($att_id),
                'source_post_id' => $photoSourcePostId,
                'source_post_title' => $photoSourcePostTitle,
            ];
        }

        // Include CDN/static images not resolvable to IDs by mapping uploads path
        if (!empty($imageUrls)) {
            $uploads = \wp_upload_dir();
            $baseurl = isset($uploads['baseurl']) ? (string) $uploads['baseurl'] : '';
            $basedir = isset($uploads['basedir']) ? (string) $uploads['basedir'] : '';
            $uploadsPath = is_string($baseurl) ? (string) parse_url($baseurl, PHP_URL_PATH) : '';
            foreach ($imageUrls as $u) {
                $exists = false; foreach ($photos as $p) { if (!empty($p['fullUrl']) && $p['fullUrl'] === $u) { $exists = true; break; } }
                if ($exists) { continue; }
                $parsed = @parse_url((string) $u);
                $path = isset($parsed['path']) ? (string) $parsed['path'] : '';
                if ($path === '' || $basedir === '') { continue; }
                $rel = '';
                if ($uploadsPath && strpos($path, $uploadsPath) !== false) {
                    $rel = ltrim(str_replace($uploadsPath, '', $path), '/');
                } elseif (preg_match('#/uploads/(.+)$#', $path, $mRel)) {
                    $rel = $mRel[1];
                } else { continue; }
                $rel = preg_replace('/-\d+x\d+(?=\.[a-zA-Z]{3,4}$)/', '', $rel);
                $candidate = rtrim($basedir, '/\\') . DIRECTORY_SEPARATOR . str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $rel);
                // Security hardening: normalize path and ensure it's inside uploads basedir; reject traversal
                $realBase = realpath($basedir);
                $realCand = $candidate !== '' ? realpath($candidate) : false;
                if ($realBase === false || $realCand === false) { continue; }
                if (strpos($realCand, $realBase) !== 0) { continue; }
                if (strpos($rel, '..') !== false) { continue; }
                if (!is_readable($realCand)) { continue; }
                $meta = \wp_read_image_metadata($realCand);
                $lat = isset($meta['latitude']) ? (float) $meta['latitude'] : null;
                $lon = isset($meta['longitude']) ? (float) $meta['longitude'] : null;
                $createdTs = isset($meta['created_timestamp']) ? (int) $meta['created_timestamp'] : null;
                if (($lat === null || $lon === null) && function_exists('exif_read_data')) {
                    $ex = @exif_read_data($realCand, 'EXIF', true, false);
                    if (is_array($ex) && isset($ex['GPS'])) {
                        $gps = $ex['GPS'];
                        $lat = isset($gps['GPSLatitude'], $gps['GPSLatitudeRef']) ? self::exif_gps_to_float($gps['GPSLatitude'], $gps['GPSLatitudeRef']) : $lat;
                        $lon = isset($gps['GPSLongitude'], $gps['GPSLongitudeRef']) ? self::exif_gps_to_float($gps['GPSLongitude'], $gps['GPSLongitudeRef']) : $lon;
                    }
                    if ($createdTs === null && isset($ex['EXIF']['DateTimeOriginal'])) {
                        $dto = $ex['EXIF']['DateTimeOriginal'];
                        $createdTs = $dto ? strtotime(str_replace(':', '-', substr($dto,0,10)) . substr($dto,10)) : null;
                    }
                }
                if ($sourcePostId > 0) {
                    $hasHostSourcedPhotos = true;
                }
                $photos[] = [
                    'id' => 0,
                    'title' => '',
                    'caption' => '',
                    'description' => '',
                    'lat' => $lat,
                    'lon' => $lon,
                    'timestamp' => $createdTs ? gmdate('c', $createdTs) : null,
                    'thumbUrl' => (string) $u,
                    'fullUrl' => (string) $u,
                    'source_post_id' => $sourcePostId,
                    'source_post_title' => $sourcePostTitle,
                ];
            }
        }

        $responseSourcePostId = ($sourcePostId > 0 && $hasHostSourcedPhotos) ? $sourcePostId : 0;
        $responseSourcePostTitle = ($sourcePostId > 0 && $hasHostSourcedPhotos) ? $sourcePostTitle : '';

        // Get weather data
        $weatherPoints = \get_post_meta($id, 'fgpx_weather_points', true);
        $weatherSummary = \get_post_meta($id, 'fgpx_weather_summary', true);
        $decodedWeather = null;
        $decodedWeatherSummaryRest = null;
        
        if (\is_string($weatherPoints) && $weatherPoints !== '') {
            $decodedWeather = \json_decode($weatherPoints, true);
            if (\json_last_error() !== JSON_ERROR_NONE) {
                ErrorHandler::warning('JSON decode error for weather points in REST endpoint', [
                    'error' => \json_last_error_msg(),
                    'track_id' => $id,
                    'weather_points_length' => \strlen($weatherPoints),
                ]);
                $decodedWeather = null;
            }
        }
        
        if (\is_string($weatherSummary) && $weatherSummary !== '') {
            $decodedWeatherSummaryRest = \json_decode($weatherSummary, true);
            if (\json_last_error() !== JSON_ERROR_NONE) {
                ErrorHandler::warning('JSON decode error for weather summary in REST endpoint', [
                    'error' => \json_last_error_msg(),
                    'track_id' => $id,
                    'weather_summary_length' => \strlen($weatherSummary),
                ]);
                $decodedWeatherSummaryRest = null;
            }
        }

        // Get waypoints (POIs) from post meta
        $waypointsRaw = \get_post_meta($id, 'fgpx_waypoints', true);
        $waypoints = [];
        if (\is_array($waypointsRaw)) {
            $waypoints = $waypointsRaw;
        }

        // Provide proper fallback structure when no GPX data is available (matches existing structure)
        $fallbackGeojson = [
            'type' => 'LineString',
            'coordinates' => [],
            'properties' => [
                'timestamps' => [],
                'cumulativeDistance' => [],
                'heartRates' => [],
                'cadences' => [],
                'temperatures' => [],
                'powers' => [],
                'windSpeeds' => [],
                'windDirections' => [],
                'windImpacts' => []
            ]
        ];

        $data = [
            'id' => $id,
            'name' => $post->post_title,
            'stats' => \is_array($stats) ? $stats : (object) [],
            'geojson' => \is_array($decodedGeo) ? $decodedGeo : $fallbackGeojson,
            'bounds' => \is_array($bounds) ? $bounds : [],
            'points_count' => $pointsCount,
            'photos' => self::dedupe_photos_by_location($photos),
            'waypoints' => $waypoints,
            'simplified' => $simplifyEnabled ? true : false,
            'estimatedPower' => $estimatedPower,
            'source_post_id' => $responseSourcePostId,
            'source_post_title' => $responseSourcePostTitle,
            'weather' => \is_array($decodedWeather) ? $decodedWeather : ['type' => 'FeatureCollection', 'features' => []],
            'weatherSummary' => \is_array($decodedWeatherSummaryRest) ? $decodedWeatherSummaryRest : null,
        ];

        // Log completion of photo collection for observability
        ErrorHandler::debug('Gallery photo collection completed', [
            'track_id' => $id,
            'photos_found' => count($photos),
            'source_post_id' => $responseSourcePostId,
            'strategy' => $strategy,
        ]);

        \set_transient($cache_key, $data, 6 * HOUR_IN_SECONDS);
        \update_post_meta($id, 'fgpx_cached_key', $cache_key);

        header('Cache-Control: public, max-age=300');
        \wp_send_json($data, 200);
    }

    /**
     * AJAX fallback handler: mirrors REST response for public tracks.
     */
    public function ajax_get_track(): void
    {
        $id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
        if ($id <= 0) {
            \wp_send_json(['message' => 'Bad request'], 400);
        }

        $post = \get_post($id);
        if (!$post || $post->post_type !== 'fgpx_track') {
            \wp_send_json(['message' => 'Not found'], 404);
        }

        if ($post->post_status !== 'publish' && !\current_user_can('read_post', $id)) {
            \wp_send_json(['message' => 'Forbidden'], 403);
        }

        $hostPostForCache = isset($_GET['host_post']) ? (int) $_GET['host_post'] : 0;
        $strategy = \sanitize_key((string) ($_GET['strategy'] ?? ''));
        $hostPost = $hostPostForCache;
        
        // Gallery playback strategy: resolve latest embedding post if strategy=latest_embed
        if ($hostPost === 0 && $strategy === 'latest_embed') {
            $hostPost = $this->find_latest_embedding_post_id($id);
        }

        $sourcePostModifiedToken = 'na';
        if ($hostPost > 0) {
            $sourcePostForCache = \get_post($hostPost);
            if ($sourcePostForCache && isset($sourcePostForCache->post_modified_gmt)) {
                $modifiedGmt = (string) $sourcePostForCache->post_modified_gmt;
                if ($modifiedGmt !== '') {
                    $sourcePostModifiedToken = preg_replace('/[^0-9]/', '', $modifiedGmt) ?: 'na';
                }
            }
        }
        
        $modified = (string) $post->post_modified_gmt;
        $simplifyEnabled = (string) \get_option('fgpx_backend_simplify_enabled', '0') === '1';
        $simplifyTarget = (int) \get_option('fgpx_backend_simplify_target', '1500');
        $windAnalysisEnabled = (string) \get_option('fgpx_wind_analysis_enabled', '0');
        
        // Include weather data status in cache key to invalidate cache when weather data changes
        $weatherPoints = \get_post_meta($id, 'fgpx_weather_points', true);
        $hasWeather = (\is_string($weatherPoints) && $weatherPoints !== '') ? '1' : '0';
        
        $cache_key = 'fgpx_json_v3_' . $id . '_' . $modified . '_hp_' . $hostPostForCache . '_rh_' . $hostPost . '_sm_' . $sourcePostModifiedToken . '_simp_' . ($simplifyEnabled ? $simplifyTarget : 0) . '_w_' . $hasWeather . '_wind_' . $windAnalysisEnabled . '_st_' . ($strategy ?: 'default');
        $cached = \get_transient($cache_key);
        if (\is_array($cached)) {
            header('Cache-Control: public, max-age=300');
            \wp_send_json($cached, 200);
        }

        // Use optimized bulk meta loading for better performance in AJAX endpoint
        $metaData = DatabaseOptimizer::getPostsWithMeta([$id], [
            'fgpx_stats', 'fgpx_geojson', 'fgpx_bounds', 'fgpx_points_count'
        ])[$id];
        
        $stats = $metaData['fgpx_stats'];
        $geojson = $metaData['fgpx_geojson'];
        $bounds = $metaData['fgpx_bounds'];
        $pointsCount = (int) $metaData['fgpx_points_count'];
        
        // Optimize JSON parsing - single decode with error handling
        $decodedGeo = null;
        $geojsonDecodeError = false;
        $geojsonDecodeErrorMessage = '';
        if (is_string($geojson) && $geojson !== '') {
            $decodedGeo = json_decode($geojson, true);
            if (json_last_error() !== JSON_ERROR_NONE) {
                ErrorHandler::warning('JSON decode error in AJAX endpoint', [
                    'error' => json_last_error_msg(),
                    'track_id' => $id,
                    'geojson_length' => strlen($geojson)
                ]);
                $geojsonDecodeError = true;
                $geojsonDecodeErrorMessage = 'Invalid JSON payload';
                $decodedGeo = null;
            } elseif (!is_array($decodedGeo)) {
                ErrorHandler::warning('Invalid geojson structure in AJAX endpoint', [
                    'track_id' => $id,
                    'decoded_type' => gettype($decodedGeo),
                ]);
                $geojsonDecodeError = true;
                $geojsonDecodeErrorMessage = 'Decoded payload is not an object';
                $decodedGeo = null;
            }
        }

        if ($geojsonDecodeError) {
            ErrorHandler::error('Corrupted track geometry in AJAX endpoint', [
                'track_id' => $id,
                'reason' => $geojsonDecodeErrorMessage,
                'geojson_length' => is_string($geojson) ? strlen($geojson) : 0,
            ]);

            \wp_send_json([
                'code' => 'fgpx_corrupt_geojson',
                'message' => 'Track data is corrupted. Please re-import this GPX track in the plugin admin.',
                'track_id' => $id,
            ], 500);
        }
        if ($simplifyEnabled && is_array($decodedGeo) && isset($decodedGeo['type']) && $decodedGeo['type'] === 'LineString' && isset($decodedGeo['coordinates']) && is_array($decodedGeo['coordinates'])) {
            $coords = $decodedGeo['coordinates'];
            $props = isset($decodedGeo['properties']) && is_array($decodedGeo['properties']) ? $decodedGeo['properties'] : [];
            $timestamps = isset($props['timestamps']) && is_array($props['timestamps']) ? $props['timestamps'] : null;
            $cum = isset($props['cumulativeDistance']) && is_array($props['cumulativeDistance']) ? $props['cumulativeDistance'] : null;
            $heartRates = isset($props['heartRates']) && is_array($props['heartRates']) ? $props['heartRates'] : null;
            $cadences = isset($props['cadences']) && is_array($props['cadences']) ? $props['cadences'] : null;
            $temperatures = isset($props['temperatures']) && is_array($props['temperatures']) ? $props['temperatures'] : null;
            $powers = isset($props['powers']) && is_array($props['powers']) ? $props['powers'] : null;
            $windSpeeds = isset($props['windSpeeds']) && is_array($props['windSpeeds']) ? $props['windSpeeds'] : null;
            $windDirections = isset($props['windDirections']) && is_array($props['windDirections']) ? $props['windDirections'] : null;
            $windImpacts = isset($props['windImpacts']) && is_array($props['windImpacts']) ? $props['windImpacts'] : null;
            
            // Calculate dynamic target based on original point count for better performance
            $originalPoints = count($coords);
            $dynamicTarget = self::calculateOptimalTarget($originalPoints, $simplifyTarget);
            
            if ($originalPoints > max(200, $dynamicTarget)) {
                $indices = self::dp_choose_and_simplify($coords, max(100, $dynamicTarget));
                if (!empty($indices)) {
                    $simplifiedCoords = array_values(array_map(static function($idx) use ($coords) { return $coords[$idx]; }, $indices));
                    
                    // Apply coordinate compression for additional payload reduction (AJAX endpoint)
                    $compressionResult = self::compressCoordinates($simplifiedCoords);
                    $decodedGeo['coordinates'] = $compressionResult['coordinates'];
                    
                    // Log compression effectiveness for large tracks
                    if ($originalPoints > 10000 && $compressionResult['compressed']) {
                        ErrorHandler::debug('Coordinate compression applied (AJAX)', [
                            'original_points' => $originalPoints,
                            'simplified_points' => count($simplifiedCoords),
                            'compression_reduction' => round($compressionResult['reduction'] * 100, 1) . '%'
                        ]);
                    }
                    if ($timestamps !== null) { $props['timestamps'] = array_values(array_map(static function($idx) use ($timestamps) { return $timestamps[$idx]; }, $indices)); }
                    if ($cum !== null) { $props['cumulativeDistance'] = array_values(array_map(static function($idx) use ($cum) { return $cum[$idx]; }, $indices)); }
                    if ($heartRates !== null) { $props['heartRates'] = array_values(array_map(static function($idx) use ($heartRates) { return $heartRates[$idx]; }, $indices)); }
                    if ($cadences !== null) { $props['cadences'] = array_values(array_map(static function($idx) use ($cadences) { return $cadences[$idx]; }, $indices)); }
                    if ($temperatures !== null) { $props['temperatures'] = array_values(array_map(static function($idx) use ($temperatures) { return $temperatures[$idx]; }, $indices)); }
                    if ($powers !== null) { $props['powers'] = array_values(array_map(static function($idx) use ($powers) { return $powers[$idx]; }, $indices)); }
                    if ($windSpeeds !== null) { $props['windSpeeds'] = array_values(array_map(static function($idx) use ($windSpeeds) { return $windSpeeds[$idx]; }, $indices)); }
                    if ($windDirections !== null) { $props['windDirections'] = array_values(array_map(static function($idx) use ($windDirections) { return $windDirections[$idx]; }, $indices)); }
                    if ($windImpacts !== null) { $props['windImpacts'] = array_values(array_map(static function($idx) use ($windImpacts) { return $windImpacts[$idx]; }, $indices)); }
                    $decodedGeo['properties'] = $props;
                }
            }
        }

        $systemWeightKg = (float) \get_option('fgpx_system_weight_kg', '75');
        $powerEstimation = self::ensurePowerDataWithEstimate($decodedGeo, $systemWeightKg);
        $decodedGeo = $powerEstimation['geojson'];
        $estimatedPower = $powerEstimation['estimatedPower'];

        // Photos from host post (if provided), with fallbacks
        $photos = [];
        $collectFromPost = $hostPost > 0 ? $hostPost : 0;
        $sourcePostId = 0;
        $sourcePostTitle = '';
        if ($collectFromPost > 0) {
            $sourcePostId = $collectFromPost;
            $sourcePostTitle = (string) \get_the_title($collectFromPost) ?: '';
        }
        $attachmentIds = [];
        $fallbackAttachmentIds = [];
        $imageUrls = [];
        $hasHostSourcedPhotos = false;
        if ($collectFromPost > 0) {
            $attached = \get_attached_media('image', $collectFromPost);
            if (\is_array($attached)) {
                foreach ($attached as $att) { $attachmentIds[(int) $att->ID] = true; }
            }
            $galleries = function_exists('get_post_galleries') ? get_post_galleries($collectFromPost, false) : [];
            if (\is_array($galleries)) {
                foreach ($galleries as $gal) {
                    if (!empty($gal['ids'])) {
                        $ids = array_filter(array_map('intval', explode(',', (string) $gal['ids'])));
                        foreach ($ids as $gid) { $attachmentIds[$gid] = true; }
                    }
                }
            }
            $content = (string) get_post_field('post_content', $collectFromPost);
            if ($content !== '') {
                if (preg_match_all('/wp-image-(\d+)/', $content, $m)) {
                    foreach ($m[1] as $mid) { $attachmentIds[(int) $mid] = true; }
                }
                if (preg_match_all('/<img[^>]+src="([^\"]+\.(?:jpe?g|png|webp))(?:\?[^\"]*)?"/i', $content, $m2)) {
                    foreach ($m2[1] as $url) {
                        $imageUrls[] = (string) $url;
                        $aid = function_exists('attachment_url_to_postid') ? attachment_url_to_postid($url) : 0;
                        if ($aid) { $attachmentIds[(int) $aid] = true; }
                    }
                }
                if (preg_match_all('/<a[^>]+href="([^\"]+\.(?:jpe?g|png|webp))(?:\?[^\"]*)?"/i', $content, $mA)) {
                    foreach ($mA[1] as $urlA) { $imageUrls[] = (string) $urlA; $aid = function_exists('attachment_url_to_postid') ? attachment_url_to_postid($urlA) : 0; if ($aid) { $attachmentIds[(int) $aid] = true; } }
                }
            }
        }
        if (empty($attachmentIds)) {
            $fallback = \get_children([
                'post_parent' => $id,
                'post_type' => 'attachment',
                'post_status' => 'inherit',
                'numberposts' => -1,
                'post_mime_type' => 'image'
            ]);
            if (\is_array($fallback)) {
                foreach ($fallback as $att) {
                    $attId = (int) $att->ID;
                    $attachmentIds[$attId] = true;
                    $fallbackAttachmentIds[$attId] = true;
                }
            }
        }
        foreach (array_keys($attachmentIds) as $att_id) {
            $file = \get_attached_file($att_id);
            if (!$file || !is_readable($file)) { continue; }
            $thumb = \wp_get_attachment_image_src($att_id, 'medium');
            $full = \wp_get_attachment_image_src($att_id, 'large');
            $meta = \wp_read_image_metadata($file);
            $lat = isset($meta['latitude']) ? (float) $meta['latitude'] : null;
            $lon = isset($meta['longitude']) ? (float) $meta['longitude'] : null;
            $createdTs = isset($meta['created_timestamp']) ? (int) $meta['created_timestamp'] : null;
            if (($lat === null || $lon === null) && function_exists('exif_read_data')) {
                $ex = @exif_read_data($file, 'EXIF', true, false);
                if (is_array($ex) && isset($ex['GPS'])) {
                    $gps = $ex['GPS'];
                    $lat = isset($gps['GPSLatitude'], $gps['GPSLatitudeRef']) ? self::exif_gps_to_float($gps['GPSLatitude'], $gps['GPSLatitudeRef']) : $lat;
                    $lon = isset($gps['GPSLongitude'], $gps['GPSLongitudeRef']) ? self::exif_gps_to_float($gps['GPSLongitude'], $gps['GPSLongitudeRef']) : $lon;
                }
                if ($createdTs === null && isset($ex['EXIF']['DateTimeOriginal'])) {
                    $dto = $ex['EXIF']['DateTimeOriginal'];
                    $createdTs = $dto ? strtotime(str_replace(':', '-', substr($dto,0,10)) . substr($dto,10)) : null;
                }
            }
            $cap = function_exists('wp_get_attachment_caption') ? (\wp_get_attachment_caption($att_id) ?: '') : '';
            if ($cap === '') { $cap = (string) get_post_field('post_excerpt', $att_id) ?: ''; }
            $desc = (string) get_post_field('post_content', $att_id);
            $photoSourcePostId = isset($fallbackAttachmentIds[$att_id]) ? 0 : $sourcePostId;
            $photoSourcePostTitle = isset($fallbackAttachmentIds[$att_id]) ? '' : $sourcePostTitle;
            if ($photoSourcePostId > 0) {
                $hasHostSourcedPhotos = true;
            }
            $photos[] = [
                'id' => (int) $att_id,
                'title' => (string) \get_the_title($att_id),
                'caption' => $cap,
                'description' => $desc,
                'lat' => $lat,
                'lon' => $lon,
                'timestamp' => $createdTs ? gmdate('c', $createdTs) : null,
                'thumbUrl' => \is_array($thumb) ? (string) $thumb[0] : (string) \wp_get_attachment_url($att_id),
                'fullUrl' => \is_array($full) ? (string) $full[0] : (string) \wp_get_attachment_url($att_id),
                'source_post_id' => $photoSourcePostId,
                'source_post_title' => $photoSourcePostTitle,
            ];
        }
        if (!empty($imageUrls)) {
            $uploads = \wp_upload_dir();
            $baseurl = isset($uploads['baseurl']) ? (string) $uploads['baseurl'] : '';
            $basedir = isset($uploads['basedir']) ? (string) $uploads['basedir'] : '';
            $uploadsPath = is_string($baseurl) ? (string) parse_url($baseurl, PHP_URL_PATH) : '';
            foreach ($imageUrls as $u) {
                $exists = false; foreach ($photos as $p) { if (!empty($p['fullUrl']) && $p['fullUrl'] === $u) { $exists = true; break; } }
                if ($exists) { continue; }
                $parsed = @parse_url((string) $u);
                $path = isset($parsed['path']) ? (string) $parsed['path'] : '';
                if ($path === '' || $basedir === '') { continue; }
                $rel = '';
                if ($uploadsPath && strpos($path, $uploadsPath) !== false) {
                    $rel = ltrim(str_replace($uploadsPath, '', $path), '/');
                } elseif (preg_match('#/uploads/(.+)$#', $path, $mRel)) {
                    $rel = $mRel[1];
                } else { continue; }
                $rel = preg_replace('/-\d+x\d+(?=\.[a-zA-Z]{3,4}$)/', '', $rel);
                $candidate = rtrim($basedir, '/\\') . DIRECTORY_SEPARATOR . str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $rel);
                // Security hardening: normalize path and ensure it's inside uploads basedir; reject traversal
                $realBase = realpath($basedir);
                $realCand = $candidate !== '' ? realpath($candidate) : false;
                if ($realBase === false || $realCand === false) { continue; }
                if (strpos($realCand, $realBase) !== 0) { continue; }
                if (strpos($rel, '..') !== false) { continue; }
                if (!is_readable($realCand)) { continue; }
                $meta = \wp_read_image_metadata($realCand);
                $lat = isset($meta['latitude']) ? (float) $meta['latitude'] : null;
                $lon = isset($meta['longitude']) ? (float) $meta['longitude'] : null;
                $createdTs = isset($meta['created_timestamp']) ? (int) $meta['created_timestamp'] : null;
                if (($lat === null || $lon === null) && function_exists('exif_read_data')) {
                    $ex = @exif_read_data($realCand, 'EXIF', true, false);
                    if (is_array($ex) && isset($ex['GPS'])) {
                        $gps = $ex['GPS'];
                        $lat = isset($gps['GPSLatitude'], $gps['GPSLatitudeRef']) ? self::exif_gps_to_float($gps['GPSLatitude'], $gps['GPSLatitudeRef']) : $lat;
                        $lon = isset($gps['GPSLongitude'], $gps['GPSLongitudeRef']) ? self::exif_gps_to_float($gps['GPSLongitude'], $gps['GPSLongitudeRef']) : $lon;
                    }
                    if ($createdTs === null && isset($ex['EXIF']['DateTimeOriginal'])) {
                        $dto = $ex['EXIF']['DateTimeOriginal'];
                        $createdTs = $dto ? strtotime(str_replace(':', '-', substr($dto,0,10)) . substr($dto,10)) : null;
                    }
                }
                if ($sourcePostId > 0) {
                    $hasHostSourcedPhotos = true;
                }
                $photos[] = [
                    'id' => 0,
                    'title' => '',
                    'caption' => '',
                    'description' => '',
                    'lat' => $lat,
                    'lon' => $lon,
                    'timestamp' => $createdTs ? gmdate('c', $createdTs) : null,
                    'thumbUrl' => (string) $u,
                    'fullUrl' => (string) $u,
                    'source_post_id' => $sourcePostId,
                    'source_post_title' => $sourcePostTitle,
                ];
            }
        }

        $responseSourcePostId = ($sourcePostId > 0 && $hasHostSourcedPhotos) ? $sourcePostId : 0;
        $responseSourcePostTitle = ($sourcePostId > 0 && $hasHostSourcedPhotos) ? $sourcePostTitle : '';

        // Get weather data (already retrieved for cache key)
        $weatherSummary = \get_post_meta($id, 'fgpx_weather_summary', true);
        $decodedWeatherAjax = null;
        $decodedWeatherSummary = null;
        
        if (\is_string($weatherPoints) && $weatherPoints !== '') {
            $decodedWeatherAjax = \json_decode($weatherPoints, true);
            if (\json_last_error() !== JSON_ERROR_NONE) {
                ErrorHandler::warning('JSON decode error for weather points in AJAX endpoint', [
                    'error' => \json_last_error_msg(),
                    'track_id' => $id,
                    'weather_points_length' => \strlen($weatherPoints),
                ]);
                $decodedWeatherAjax = null;
            }
        }
        
        if (\is_string($weatherSummary) && $weatherSummary !== '') {
            $decodedWeatherSummary = \json_decode($weatherSummary, true);
            if (\json_last_error() !== JSON_ERROR_NONE) {
                ErrorHandler::warning('JSON decode error for weather summary in AJAX endpoint', [
                    'error' => \json_last_error_msg(),
                    'track_id' => $id,
                    'weather_summary_length' => \strlen($weatherSummary),
                ]);
                $decodedWeatherSummary = null;
            }
        }

        $waypointsRaw = \get_post_meta($id, 'fgpx_waypoints', true);
        $waypoints = [];
        if (\is_array($waypointsRaw)) {
            $waypoints = $waypointsRaw;
        }

        // Provide proper fallback structure when no GPX data is available (matches existing structure)
        $fallbackGeojson = [
            'type' => 'LineString',
            'coordinates' => [],
            'properties' => [
                'timestamps' => [],
                'cumulativeDistance' => [],
                'heartRates' => [],
                'cadences' => [],
                'temperatures' => [],
                'powers' => [],
                'windSpeeds' => [],
                'windDirections' => [],
                'windImpacts' => []
            ]
        ];

        $data = [
            'id' => $id,
            'name' => $post->post_title,
            'stats' => is_array($stats) ? $stats : (object) [],
            'geojson' => is_array($decodedGeo) ? $decodedGeo : $fallbackGeojson,
            'bounds' => is_array($bounds) ? $bounds : [],
            'points_count' => $pointsCount,
            'photos' => self::dedupe_photos_by_location($photos),
            'waypoints' => $waypoints,
            'simplified' => $simplifyEnabled ? true : false,
            'estimatedPower' => $estimatedPower,
            'source_post_id' => $responseSourcePostId,
            'source_post_title' => $responseSourcePostTitle,
            'weather' => \is_array($decodedWeatherAjax) ? $decodedWeatherAjax : ['type' => 'FeatureCollection', 'features' => []],
            'weatherSummary' => \is_array($decodedWeatherSummary) ? $decodedWeatherSummary : null,
        ];

        // Log completion of photo collection for observability (AJAX endpoint)
        ErrorHandler::debug('Gallery photo collection completed (AJAX)', [
            'track_id' => $id,
            'photos_found' => count($photos),
            'source_post_id' => $responseSourcePostId,
            'strategy' => $strategy,
        ]);

        \set_transient($cache_key, $data, 6 * HOUR_IN_SECONDS);
        \update_post_meta($id, 'fgpx_cached_key', $cache_key);

        header('Cache-Control: public, max-age=300');
        \wp_send_json($data, 200);
    }

    /**
     * Serve the original GPX file as a download.
     * Validates nonce, post visibility, and file path before streaming.
     */
    public function ajax_download_gpx(): void
    {
        $id    = (int) ($_REQUEST['id'] ?? 0);
        $nonce = (string) ($_REQUEST['nonce'] ?? '');

        if ($id <= 0 || !\wp_verify_nonce($nonce, 'fgpx_download_gpx_' . $id)) {
            \wp_die('Invalid request', '', ['response' => 403]);
        }

        $post = \get_post($id);
        if (!$post || $post->post_type !== 'fgpx_track') {
            \wp_die('Not found', '', ['response' => 404]);
        }
        if ($post->post_status !== 'publish' && !\current_user_can('read_post', $id)) {
            \wp_die('Forbidden', '', ['response' => 403]);
        }

        $filePath = (string) \get_post_meta($id, 'fgpx_file_path', true);
        if ($filePath === '') {
            \wp_die('File not found', '', ['response' => 404]);
        }

        // Resolve real path and ensure it is inside the uploads directory
        $uploadsDir = \wp_upload_dir();
        $realBase   = \realpath((string) ($uploadsDir['basedir'] ?? ''));
        $realPath   = \realpath($filePath);
        if ($realBase === false || $realPath === false || \strpos($realPath, $realBase) !== 0) {
            \wp_die('Forbidden', '', ['response' => 403]);
        }
        if (!\is_readable($realPath)) {
            \wp_die('File not found', '', ['response' => 404]);
        }

        $filename = \basename($realPath);
        \header('Content-Type: application/gpx+xml');
        if (\preg_match('/^[a-zA-Z0-9._-]+$/', $filename)) {
            \header('Content-Disposition: attachment; filename="' . $filename . '"');
        } else {
            \header("Content-Disposition: attachment; filename*=UTF-8''" . \rawurlencode($filename));
        }
        \header('Content-Length: ' . \filesize($realPath));
        \header('Cache-Control: no-store');
        \readfile($realPath);
        exit;
    }

    /**
     * Extract track IDs from shortcode content.
     * Mirrors Admin class method for consistent behavior.
     *
     * @param string $content Post content to search
     * @return array<int>
     */
    private function extract_track_ids_from_content(string $content): array
    {
        if ($content === '' || stripos($content, '[flyover_gpx') === false) {
            return [];
        }

        $ids = [];
        if (preg_match_all('/\[flyover_gpx\b[^\]]*\bid\s*=\s*(["\']?)(\d+)\1[^\]]*\]/i', $content, $matches) !== false) {
            foreach (($matches[2] ?? []) as $rawId) {
                $trackId = (int) $rawId;
                if ($trackId > 0) {
                    $ids[$trackId] = $trackId;
                }
            }
        }

        return array_values($ids);
    }

    /**
     * Get allowed post types for finding embedding posts.
     * Mirrors Admin class method for consistent behavior.
     *
     * @return array<string>
     */
    private function get_preview_reference_post_types(): array
    {
        $postTypes = ['post', 'page'];
        if (function_exists('get_post_types')) {
            $detected = \get_post_types(['public' => true], 'names');
            if (\is_array($detected) && !empty($detected)) {
                $postTypes = array_map('strval', $detected);
            }
        }

        $excluded = ['fgpx_track', 'attachment'];
        $postTypes = array_values(array_filter(array_unique($postTypes), static function (string $postType) use ($excluded): bool {
            return $postType !== '' && !\in_array($postType, $excluded, true);
        }));

        return !empty($postTypes) ? $postTypes : ['post', 'page'];
    }

    /**
     * Find the latest published post that embeds a specific track.
     * Mirrors Admin class method for consistent behavior in gallery photo enrichment.
     *
     * Tiebreaker: When multiple posts have the same post_date_gmt, the post with the highest ID is selected.
     * This ensures deterministic behavior when posts are published at exactly the same second.
     * Ordering: ORDER BY post_date_gmt DESC, ID DESC
     *
     * @param int $trackId Track post ID to find embeddings for
     * @return int Latest embedding post ID, or 0 if not found
     */
    private function find_latest_embedding_post_id(int $trackId): int
    {
        if ($trackId <= 0) {
            return 0;
        }

        global $wpdb;
        if (!isset($wpdb->posts)) {
            return 0;
        }

        $allowedPostTypes = $this->get_preview_reference_post_types();
        $typePlaceholders = implode(', ', array_fill(0, count($allowedPostTypes), '%s'));
        $queryArgs = array_merge(['publish'], $allowedPostTypes, ['%[flyover_gpx%']);

        $query = $wpdb->prepare(
            "SELECT ID, post_content FROM {$wpdb->posts} WHERE post_status = %s AND post_type IN ({$typePlaceholders}) AND post_content LIKE %s ORDER BY post_date_gmt DESC, ID DESC",
            ...$queryArgs
        );

        $rows = $wpdb->get_results($query);
        if (!\is_array($rows) || empty($rows)) {
            return 0;
        }

        foreach ($rows as $row) {
            $postId = isset($row->ID) ? (int) $row->ID : 0;
            if ($postId <= 0) {
                continue;
            }

            $content = isset($row->post_content) ? (string) $row->post_content : '';
            if ($content === '') {
                continue;
            }

            $ids = $this->extract_track_ids_from_content($content);
            if (\in_array($trackId, $ids, true)) {
                return $postId;
            }
        }

        return 0;
    }
}


