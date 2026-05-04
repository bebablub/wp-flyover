<?php

declare(strict_types=1);

namespace FGpx\Tests\Unit;

use FGpx\Admin;
use PHPUnit\Framework\TestCase;

final class GalleryCacheInvalidationTest extends TestCase
{
    protected function setUp(): void
    {
        $GLOBALS['fgpx_test_transients'] = [];
        $GLOBALS['fgpx_test_post_meta'] = [];
        $GLOBALS['fgpx_test_posts'] = [];
    }

    protected function tearDown(): void
    {
        unset($GLOBALS['fgpx_test_transients'], $GLOBALS['fgpx_test_post_meta'], $GLOBALS['fgpx_test_posts']);
    }

    public function test_clear_all_track_caches_removes_strategy_specific_transients(): void
    {
        $trackId = 123;
        $modifiedStr = '2026-04-21 10:00:00';
        $modified = (string) strtotime($modifiedStr);
        $GLOBALS['fgpx_test_posts'][$trackId] = new \WP_Post([
            'ID' => $trackId,
            'post_type' => 'fgpx_track',
            'post_status' => 'publish',
            'post_modified_gmt' => $modifiedStr,
        ]);

        $defaultKey = 'fgpx_json_v3_' . $trackId . '_' . $modified . '_hp_0_simp_0_w_0_wind_0_st_default';
        $embedKey = 'fgpx_json_v3_' . $trackId . '_' . $modified . '_hp_0_simp_0_w_0_wind_0_st_latest_embed';
        $resolvedHostKey = 'fgpx_json_v3_' . $trackId . '_' . $modified . '_hp_0_rh_777_sm_20260421103045_simp_0_w_0_wind_0_st_latest_embed';
        $legacyKey = 'fgpx_json_v3_' . $trackId . '_' . $modified . '_hp_0_simp_1500_w_1_wind_1';
        $unrelatedKey = 'fgpx_json_v3_999_' . $modified . '_hp_0_simp_0_w_0_wind_0_st_default';

        $GLOBALS['fgpx_test_transients'][$defaultKey] = ['ok' => true];
        $GLOBALS['fgpx_test_transients'][$embedKey] = ['ok' => true];
        $GLOBALS['fgpx_test_transients'][$resolvedHostKey] = ['ok' => true];
        $GLOBALS['fgpx_test_transients'][$legacyKey] = ['ok' => true];
        $GLOBALS['fgpx_test_transients'][$unrelatedKey] = ['ok' => true];
        $GLOBALS['fgpx_test_post_meta'][$trackId]['fgpx_cached_key'] = $defaultKey;

        Admin::clear_all_track_caches($trackId);

        $this->assertArrayNotHasKey($defaultKey, $GLOBALS['fgpx_test_transients']);
        $this->assertArrayNotHasKey($embedKey, $GLOBALS['fgpx_test_transients']);
        $this->assertArrayNotHasKey($resolvedHostKey, $GLOBALS['fgpx_test_transients']);
        $this->assertArrayNotHasKey($legacyKey, $GLOBALS['fgpx_test_transients']);
        $this->assertArrayHasKey($unrelatedKey, $GLOBALS['fgpx_test_transients']);
        $this->assertArrayNotHasKey('fgpx_cached_key', $GLOBALS['fgpx_test_post_meta'][$trackId]);
    }

    public function test_status_transition_invalidation_clears_referenced_track_caches(): void
    {
        $trackId = 321;
        $embeddingPostId = 900;
        $modifiedStr = '2026-04-21 11:00:00';
        $modified = (string) strtotime($modifiedStr);

        $GLOBALS['fgpx_test_posts'][$trackId] = new \WP_Post([
            'ID' => $trackId,
            'post_type' => 'fgpx_track',
            'post_status' => 'publish',
            'post_modified_gmt' => $modifiedStr,
        ]);

        $cacheKey = 'fgpx_json_v3_' . $trackId . '_' . $modified . '_hp_' . $embeddingPostId . '_simp_0_w_0_wind_0_st_default';
        $GLOBALS['fgpx_test_transients'][$cacheKey] = ['ok' => true];

        $embeddingPost = new \WP_Post([
            'ID' => $embeddingPostId,
            'post_type' => 'post',
            'post_status' => 'publish',
            'post_content' => '[flyover_gpx id="321"]',
        ]);

        $admin = new Admin();
        $admin->invalidate_track_caches_for_embedding_post_status_transition('draft', 'publish', $embeddingPost);

        $this->assertArrayNotHasKey($cacheKey, $GLOBALS['fgpx_test_transients']);
    }

    public function test_embedding_post_deletion_invalidation_clears_host_specific_cache_key(): void
    {
        $trackId = 654;
        $embeddingPostId = 777;
        $modifiedStr = '2026-04-21 12:00:00';
        $modified = (string) strtotime($modifiedStr);

        $GLOBALS['fgpx_test_posts'][$trackId] = new \WP_Post([
            'ID' => $trackId,
            'post_type' => 'fgpx_track',
            'post_status' => 'publish',
            'post_modified_gmt' => $modifiedStr,
        ]);

        $GLOBALS['fgpx_test_posts'][$embeddingPostId] = new \WP_Post([
            'ID' => $embeddingPostId,
            'post_type' => 'post',
            'post_status' => 'publish',
            'post_content' => '[flyover_gpx id="654"]',
        ]);

        $cacheKey = 'fgpx_json_v3_' . $trackId . '_' . $modified . '_hp_' . $embeddingPostId . '_simp_1500_w_1_wind_1_st_latest_embed';
        $dynamicCacheKey = 'fgpx_json_v3_' . $trackId . '_' . $modified . '_hp_' . $embeddingPostId . '_rh_' . $embeddingPostId . '_sm_20260421120000_simp_1500_w_1_wind_1_st_latest_embed';
        $GLOBALS['fgpx_test_transients'][$cacheKey] = ['ok' => true];
        $GLOBALS['fgpx_test_transients'][$dynamicCacheKey] = ['ok' => true];

        $admin = new Admin();
        $admin->invalidate_track_caches_for_embedding_post_deletion($embeddingPostId);

        $this->assertArrayNotHasKey($cacheKey, $GLOBALS['fgpx_test_transients']);
        $this->assertArrayNotHasKey($dynamicCacheKey, $GLOBALS['fgpx_test_transients']);
    }
}
