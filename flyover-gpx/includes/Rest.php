<?php

declare(strict_types=1);

namespace FGpx;

if (!\defined('ABSPATH')) {
    exit;
}
use WP_REST_Response;

if (!\defined('ABSPATH')) {
    exit;
}

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
                'permission_callback' => '__return_true',
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
     * Return stored stats, bounds and geojson for a given track with transient caching.
     */
    public function get_track(WP_REST_Request $request)
    {
        $id = (int) $request->get_param('id');

        $post = \get_post($id);
        if (!$post || $post->post_type !== 'fgpx_track') {
            return new WP_REST_Response(['message' => 'Not found'], 404);
        }

        // Gate visibility: allow public read for published, otherwise require capability
        if ($post->post_status !== 'publish' && !\current_user_can('read_post', $id)) {
            return new WP_REST_Response(['message' => 'Forbidden'], 403);
        }

        $modified = (string) $post->post_modified_gmt;
        $simplifyEnabled = (string) \get_option('fgpx_backend_simplify_enabled', '0') === '1';
        $simplifyTarget = (int) \get_option('fgpx_backend_simplify_target', '1500');
        $windAnalysisEnabled = (string) \get_option('fgpx_wind_analysis_enabled', '0');
        $hostPostForCache = (int) $request->get_param('host_post');
        $cache_key = 'fgpx_json_v2_' . $id . '_' . $modified . '_hp_' . $hostPostForCache . '_simp_' . ($simplifyEnabled ? $simplifyTarget : 0) . '_wind_' . $windAnalysisEnabled;

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
        if (\is_string($geojson) && $geojson !== '') {
            $decodedGeo = \json_decode($geojson, true);
            if (\json_last_error() !== JSON_ERROR_NONE) {
                ErrorHandler::warning('JSON decode error in REST endpoint', [
                    'error' => \json_last_error_msg(),
                    'track_id' => $id,
                    'geojson_length' => \strlen($geojson)
                ]);
                $decodedGeo = null;
            }
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
        if ($originalPoints > 1000) {
            ErrorHandler::debug('REST response size monitoring', [
                'track_id' => $id,
                'original_points' => isset($originalPoints) ? $originalPoints : 'unknown',
                'final_points' => $decodedGeo && isset($decodedGeo['coordinates']) ? \count($decodedGeo['coordinates']) : 0,
                'response_size_kb' => round($responseSize / 1024, 1),
                'simplification_enabled' => $simplifyEnabled
            ]);
        }

        // Attempt to collect attached photos (images) with EXIF GPS/time
        $photos = [];
        // Optional: fetch attachments from the host post that contains the shortcode
        $hostPost = (int) $request->get_param('host_post');
        $collectFromPost = $hostPost > 0 ? $hostPost : 0;
        $attachmentIds = [];
        $imageUrls = [];
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
                foreach ($fallback as $att) { $attachmentIds[(int) $att->ID] = true; }
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
            $photos[] = [
                'id' => (int) $att_id,
                'title' => (string) \get_the_title($att_id),
                'caption' => $cap,
                'description' => $desc,
                'lat' => $lat,
                'lon' => $lon,
                'timestamp' => $createdTs ? gmdate('c', $createdTs) : null,
                'thumbUrl' => \is_array($thumb) ? (string) $thumb[0] : (string) \wp_get_attachment_url($att_id),
                'fullUrl' => \is_array($full) ? (string) $full[0] : (string) \wp_get_attachment_url($att_id)
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
                ];
            }
        }

        // Get weather data
        $weatherPoints = \get_post_meta($id, 'fgpx_weather_points', true);
        $weatherSummary = \get_post_meta($id, 'fgpx_weather_summary', true);
        $decodedWeather = null;
        $decodedWeatherSummaryRest = null;
        
        if (\is_string($weatherPoints) && $weatherPoints !== '') {
            $decodedWeather = \json_decode($weatherPoints, true);
        }
        
        if (\is_string($weatherSummary) && $weatherSummary !== '') {
            $decodedWeatherSummaryRest = \json_decode($weatherSummary, true);
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
            'simplified' => $simplifyEnabled ? true : false,
            'weather' => \is_array($decodedWeather) ? $decodedWeather : ['type' => 'FeatureCollection', 'features' => []],
            'weatherSummary' => \is_array($decodedWeatherSummaryRest) ? $decodedWeatherSummaryRest : null,
        ];

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

        $hostPost = isset($_GET['host_post']) ? (int) $_GET['host_post'] : 0;
        $modified = (string) $post->post_modified_gmt;
        $simplifyEnabled = (string) \get_option('fgpx_backend_simplify_enabled', '0') === '1';
        $simplifyTarget = (int) \get_option('fgpx_backend_simplify_target', '1500');
        $windAnalysisEnabled = (string) \get_option('fgpx_wind_analysis_enabled', '0');
        
        // Include weather data status in cache key to invalidate cache when weather data changes
        $weatherPoints = \get_post_meta($id, 'fgpx_weather_points', true);
        $hasWeather = (\is_string($weatherPoints) && $weatherPoints !== '') ? '1' : '0';
        
        $cache_key = 'fgpx_json_v2_' . $id . '_' . $modified . '_hp_' . $hostPost . '_simp_' . ($simplifyEnabled ? $simplifyTarget : 0) . '_w_' . $hasWeather . '_wind_' . $windAnalysisEnabled;
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
        if (is_string($geojson) && $geojson !== '') {
            $decodedGeo = json_decode($geojson, true);
            if (json_last_error() !== JSON_ERROR_NONE) {
                ErrorHandler::warning('JSON decode error in AJAX endpoint', [
                    'error' => json_last_error_msg(),
                    'track_id' => $id,
                    'geojson_length' => strlen($geojson)
                ]);
                $decodedGeo = null;
            }
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

        // Photos from host post (if provided), with fallbacks
        $photos = [];
        $collectFromPost = $hostPost > 0 ? $hostPost : 0;
        $attachmentIds = [];
        $imageUrls = [];
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
                if (preg_match_all('/<img[^>]+src="([^\"]+)"/i', $content, $m2)) {
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
                foreach ($fallback as $att) { $attachmentIds[(int) $att->ID] = true; }
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
            $photos[] = [
                'id' => (int) $att_id,
                'title' => (string) \get_the_title($att_id),
                'caption' => $cap,
                'description' => $desc,
                'lat' => $lat,
                'lon' => $lon,
                'timestamp' => $createdTs ? gmdate('c', $createdTs) : null,
                'thumbUrl' => \is_array($thumb) ? (string) $thumb[0] : (string) \wp_get_attachment_url($att_id),
                'fullUrl' => \is_array($full) ? (string) $full[0] : (string) \wp_get_attachment_url($att_id)
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
                if (!is_readable($candidate)) { continue; }
                $meta = \wp_read_image_metadata($candidate);
                $lat = isset($meta['latitude']) ? (float) $meta['latitude'] : null;
                $lon = isset($meta['longitude']) ? (float) $meta['longitude'] : null;
                $createdTs = isset($meta['created_timestamp']) ? (int) $meta['created_timestamp'] : null;
                if (($lat === null || $lon === null) && function_exists('exif_read_data')) {
                    $ex = @exif_read_data($candidate, 'EXIF', true, false);
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
                ];
            }
        }

        // Get weather data (already retrieved for cache key)
        $weatherSummary = \get_post_meta($id, 'fgpx_weather_summary', true);
        $decodedWeatherAjax = null;
        $decodedWeatherSummary = null;
        
        if (\is_string($weatherPoints) && $weatherPoints !== '') {
            $decodedWeatherAjax = \json_decode($weatherPoints, true);
        }
        
        if (\is_string($weatherSummary) && $weatherSummary !== '') {
            $decodedWeatherSummary = \json_decode($weatherSummary, true);
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
            'simplified' => $simplifyEnabled ? true : false,
            'weather' => \is_array($decodedWeatherAjax) ? $decodedWeatherAjax : ['type' => 'FeatureCollection', 'features' => []],
            'weatherSummary' => \is_array($decodedWeatherSummary) ? $decodedWeatherSummary : null,
        ];

        \set_transient($cache_key, $data, 6 * HOUR_IN_SECONDS);
        \update_post_meta($id, 'fgpx_cached_key', $cache_key);

        header('Cache-Control: public, max-age=300');
        \wp_send_json($data, 200);
    }
}


