<?php

declare(strict_types=1);

namespace FGpx;

if (!\defined('ABSPATH')) {
    exit;
}

final class GMediaCaptionSync
{
    private const ATTACHMENT_BATCH_SIZE = 500;
    private const GMEDIA_MAP_TRANSIENT = 'fgpx_gmedia_caption_map';
    private const GMEDIA_MAP_TTL = 300; // 5 min: covers any realistic multi-chunk sync session

    /**
     * Detect whether Grand Media runtime and schema are available.
     *
     * @return array<string,mixed>
     */
    public static function detect(): array
    {
        global $wpdb;

        $classAvailable = \class_exists('GmediaDB');
        $globalReady = $classAvailable
            && isset($GLOBALS['gmDB'])
            && \is_object($GLOBALS['gmDB'])
            && \is_a($GLOBALS['gmDB'], 'GmediaDB');

        $tableName = isset($wpdb->prefix) ? (string) $wpdb->prefix . 'gmedia' : '';
        $tableExists = false;

        if ($tableName !== '' && isset($wpdb) && \method_exists($wpdb, 'prepare') && \method_exists($wpdb, 'get_var')) {
            $query = $wpdb->prepare('SHOW TABLES LIKE %s', $tableName);
            $found = \is_string($query) ? (string) $wpdb->get_var($query) : '';
            $tableExists = ($found === $tableName);
        }

        $version = (string) \get_option('gmediaVersion', '');
        $dbVersion = (string) \get_option('gmediaDbVersion', '');

        $active = $classAvailable && $globalReady && $tableExists;
        $reason = '';
        if (!$active) {
            if (!$classAvailable) {
                $reason = 'Grand Media classes are not loaded.';
            } elseif (!$globalReady) {
                $reason = 'Grand Media global runtime is not initialized.';
            } elseif (!$tableExists) {
                $reason = 'Grand Media database table was not found.';
            } else {
                $reason = 'Grand Media is not available.';
            }
        }

        return [
            'active' => $active,
            'classAvailable' => $classAvailable,
            'globalReady' => $globalReady,
            'tableExists' => $tableExists,
            'tableName' => $tableName,
            'version' => $version,
            'dbVersion' => $dbVersion,
            'reason' => $reason,
        ];
    }

    /**
     * Sync Grand Media title -> WP attachment caption by filename.
     *
     * @return array<string,mixed>
     */
    public static function syncCaptions(bool $overwrite = true): array
    {
        global $wpdb;

        $detection = self::detect();
        $result = [
            'available' => (bool) ($detection['active'] ?? false),
            'overwrite' => $overwrite,
            'scanned' => 0,
            'matched' => 0,
            'updated' => 0,
            'unchanged' => 0,
            'skipped_existing' => 0,
            'skipped_no_filename' => 0,
            'skipped_empty_title' => 0,
            'unmatched' => 0,
            'duplicates' => 0,
            'errors' => 0,
            'detection' => $detection,
            'message' => '',
        ];

        if (!$result['available']) {
            $result['message'] = (string) ($detection['reason'] ?? 'Grand Media is not available.');
            return $result;
        }

        $gmediaTable = (string) $detection['tableName'];
        if ($gmediaTable === '' || !isset($wpdb)) {
            $result['errors'] = 1;
            $result['message'] = 'Unable to resolve Grand Media table.';
            return $result;
        }

        $rows = $wpdb->get_results("SELECT ID, gmuid, title, modified FROM {$gmediaTable} WHERE gmuid <> '' ORDER BY gmuid ASC, modified DESC, ID DESC");
        if (!\is_array($rows)) {
            $result['errors'] = 1;
            $result['message'] = 'Unable to read Grand Media records.';
            return $result;
        }

        $gmediaByFilename = [];
        $dupCounts = [];
        foreach ($rows as $row) {
            $filename = strtolower((string) ($row->gmuid ?? ''));
            if ($filename === '') {
                continue;
            }
            if (!isset($gmediaByFilename[$filename])) {
                $gmediaByFilename[$filename] = $row;
            }
            $dupCounts[$filename] = (int) ($dupCounts[$filename] ?? 0) + 1;
        }

        $offset = 0;
        $batchSize = self::ATTACHMENT_BATCH_SIZE;

        while (true) {
            $attachmentIds = self::fetchAttachmentIdsBatch($offset, $batchSize);
            if ($attachmentIds === null) {
                $result['errors'] = 1;
                $result['message'] = 'Unable to read WordPress attachments.';
                return $result;
            }

            if ($attachmentIds === []) {
                break;
            }

            if (\function_exists('update_meta_cache')) {
                \update_meta_cache('post', $attachmentIds);
            }

            foreach ($attachmentIds as $attachmentId) {
                $attachmentId = (int) $attachmentId;
                if ($attachmentId <= 0) {
                    continue;
                }

                $result['scanned']++;

                $filename = self::resolveAttachmentFilename($attachmentId);
                if ($filename === '') {
                    $result['skipped_no_filename']++;
                    continue;
                }

                $key = strtolower($filename);
                if (!isset($gmediaByFilename[$key])) {
                    $result['unmatched']++;
                    continue;
                }

                $result['matched']++;
                if (($dupCounts[$key] ?? 0) > 1) {
                    $result['duplicates']++;
                }

                $gmediaTitle = \sanitize_text_field((string) ($gmediaByFilename[$key]->title ?? ''));
                if ($gmediaTitle === '') {
                    $result['skipped_empty_title']++;
                    continue;
                }

                $currentCaption = \function_exists('wp_get_attachment_caption')
                    ? (string) (\wp_get_attachment_caption($attachmentId) ?: '')
                    : '';

                if (!$overwrite && trim($currentCaption) !== '') {
                    $result['skipped_existing']++;
                    continue;
                }

                if ($currentCaption === $gmediaTitle) {
                    $result['unchanged']++;
                    continue;
                }

                $update = \wp_update_post([
                    'ID' => $attachmentId,
                    'post_excerpt' => $gmediaTitle,
                ], true);

                if (\is_wp_error($update) || (int) $update <= 0) {
                    $result['errors']++;
                    continue;
                }

                $result['updated']++;
            }

            $offset += $batchSize;
        }

        $result['message'] = sprintf(
            'Caption sync finished: %d scanned, %d matched, %d updated, %d unchanged, %d unmatched, %d duplicate filename matches, %d errors.',
            (int) $result['scanned'],
            (int) $result['matched'],
            (int) $result['updated'],
            (int) $result['unchanged'],
            (int) $result['unmatched'],
            (int) $result['duplicates'],
            (int) $result['errors']
        );

        return $result;
    }

    /**
     * Sync one attachment batch and return cursor progress for resumable clients.
     *
     * Grand Media records are cached in a short-lived transient so repeated chunk
     * requests within the same sync session do not reload the full GM table each time.
     *
     * @return array<string,mixed>
     */
    public static function syncCaptionsChunk(bool $overwrite = true, int $offset = 0, int $limit = 250): array
    {
        global $wpdb;

        $offset = max(0, $offset);
        $limit = max(1, min(1000, $limit));

        $detection = self::detect();
        $result = [
            'available' => (bool) ($detection['active'] ?? false),
            'overwrite' => $overwrite,
            'offset' => $offset,
            'next_offset' => $offset,
            'limit' => $limit,
            'done' => false,
            'scanned' => 0,
            'matched' => 0,
            'updated' => 0,
            'unchanged' => 0,
            'skipped_existing' => 0,
            'skipped_no_filename' => 0,
            'skipped_empty_title' => 0,
            'unmatched' => 0,
            'duplicates' => 0,
            'errors' => 0,
            'fatal' => false,
            'detection' => $detection,
            'message' => '',
        ];

        if (!$result['available']) {
            $result['done'] = true;
            $result['fatal'] = true;
            $result['message'] = (string) ($detection['reason'] ?? 'Grand Media is not available.');
            return $result;
        }

        $gmediaTable = (string) $detection['tableName'];
        if ($gmediaTable === '' || !isset($wpdb)) {
            $result['done'] = true;
            $result['fatal'] = true;
            $result['errors'] = 1;
            $result['message'] = 'Unable to resolve Grand Media table.';
            return $result;
        }

        // Load GM lookup map from transient cache to avoid a full table scan on every chunk.
        // Cache key includes the table name so it's safe across multi-site prefixes.
        $cacheKey = self::GMEDIA_MAP_TRANSIENT . '_' . md5($gmediaTable);
        $cached = \get_transient($cacheKey);
        if (\is_array($cached) && isset($cached['map']) && isset($cached['dup'])) {
            $gmediaByFilename = $cached['map'];
            $dupCounts = $cached['dup'];
        } else {
            $rows = $wpdb->get_results("SELECT ID, gmuid, title, modified FROM {$gmediaTable} WHERE gmuid <> '' ORDER BY gmuid ASC, modified DESC, ID DESC");
            if (!\is_array($rows)) {
                $result['done'] = true;
                $result['fatal'] = true;
                $result['errors'] = 1;
                $result['message'] = 'Unable to read Grand Media records.';
                return $result;
            }

            $gmediaByFilename = [];
            $dupCounts = [];
            foreach ($rows as $row) {
                $filename = strtolower((string) ($row->gmuid ?? ''));
                if ($filename === '') {
                    continue;
                }
                if (!isset($gmediaByFilename[$filename])) {
                    $gmediaByFilename[$filename] = $row;
                }
                $dupCounts[$filename] = (int) ($dupCounts[$filename] ?? 0) + 1;
            }

            \set_transient($cacheKey, ['map' => $gmediaByFilename, 'dup' => $dupCounts], self::GMEDIA_MAP_TTL);
        }

        $attachmentIds = self::fetchAttachmentIdsBatch($offset, $limit);
        if ($attachmentIds === null) {
            $result['done'] = true;
            $result['fatal'] = true;
            $result['errors'] = 1;
            $result['message'] = 'Unable to read WordPress attachments.';
            return $result;
        }

        $result['scanned'] = count($attachmentIds);
        $result['next_offset'] = $offset + $result['scanned'];
        // If fewer than limit, or next batch would be empty, mark as done
        if ($result['scanned'] < $limit) {
            $result['done'] = true;
        } else {
            // Check if there are more attachments in the next batch
            $nextBatch = self::fetchAttachmentIdsBatch($result['next_offset'], 1);
            if (is_array($nextBatch) && count($nextBatch) === 0) {
                $result['done'] = true;
            } else if ($nextBatch === null) {
                // Defensive: treat null as done (no more attachments)
                $result['done'] = true;
            } else {
                $result['done'] = false;
            }
        }

        if ($attachmentIds === []) {
            $result['done'] = true;
            $result['message'] = 'Caption sync finished: no additional attachments to process.';
            return $result;
        }

        if (\function_exists('update_meta_cache')) {
            \update_meta_cache('post', $attachmentIds);
        }

        foreach ($attachmentIds as $attachmentId) {
            $attachmentId = (int) $attachmentId;
            if ($attachmentId <= 0) {
                continue;
            }

            $filename = self::resolveAttachmentFilename($attachmentId);
            if ($filename === '') {
                $result['skipped_no_filename']++;
                continue;
            }

            $key = strtolower($filename);
            if (!isset($gmediaByFilename[$key])) {
                $result['unmatched']++;
                continue;
            }

            $result['matched']++;
            if (($dupCounts[$key] ?? 0) > 1) {
                $result['duplicates']++;
            }

            $gmediaTitle = \sanitize_text_field((string) ($gmediaByFilename[$key]->title ?? ''));
            if ($gmediaTitle === '') {
                $result['skipped_empty_title']++;
                continue;
            }

            $currentCaption = \function_exists('wp_get_attachment_caption')
                ? (string) (\wp_get_attachment_caption($attachmentId) ?: '')
                : '';

            if (!$overwrite && trim($currentCaption) !== '') {
                $result['skipped_existing']++;
                continue;
            }

            if ($currentCaption === $gmediaTitle) {
                $result['unchanged']++;
                continue;
            }

            $update = \wp_update_post([
                'ID' => $attachmentId,
                'post_excerpt' => $gmediaTitle,
            ], true);

            if (\is_wp_error($update) || (int) $update <= 0) {
                $result['errors']++;
                continue;
            }

            $result['updated']++;
        }

        $result['message'] = sprintf(
            'Caption sync batch: %d scanned, %d matched, %d updated, %d unchanged, %d unmatched, %d duplicate filename matches, %d errors.',
            (int) $result['scanned'],
            (int) $result['matched'],
            (int) $result['updated'],
            (int) $result['unchanged'],
            (int) $result['unmatched'],
            (int) $result['duplicates'],
            (int) $result['errors']
        );

        if ($result['done']) {
            self::clearGmediaCacheTransient();
        }

        return $result;
    }

    public static function clearGmediaCacheTransient(): void
    {
        global $wpdb;
        $tableName = isset($wpdb->prefix) ? (string) $wpdb->prefix . 'gmedia' : '';
        if ($tableName !== '') {
            \delete_transient(self::GMEDIA_MAP_TRANSIENT . '_' . md5($tableName));
        }
    }

    /**
     * @return array<int,int>|null
     */
    private static function fetchAttachmentIdsBatch(int $offset, int $limit): ?array
    {
        global $wpdb;

        if (!isset($wpdb) || !isset($wpdb->posts) || !\is_string($wpdb->posts) || !\method_exists($wpdb, 'get_col')) {
            return null;
        }

        $offset = max(0, $offset);
        $limit = max(1, $limit);

        $query = "SELECT ID FROM {$wpdb->posts} WHERE post_type = 'attachment' AND post_mime_type LIKE 'image/%' ORDER BY ID ASC LIMIT {$limit} OFFSET {$offset}";
        $attachmentIds = $wpdb->get_col($query);
        if (!\is_array($attachmentIds)) {
            return null;
        }

        return array_values(array_filter(array_map('intval', $attachmentIds), static function (int $id): bool {
            return $id > 0;
        }));
    }

    private static function resolveAttachmentFilename(int $attachmentId): string
    {
        if ($attachmentId <= 0) {
            return '';
        }

        $attached = (string) \get_post_meta($attachmentId, '_wp_attached_file', true);
        if ($attached !== '') {
            $base = basename($attached);
            if ($base !== '') {
                return (string) $base;
            }
        }

        $url = \function_exists('wp_get_attachment_url') ? (string) (\wp_get_attachment_url($attachmentId) ?: '') : '';
        if ($url !== '') {
            $path = (string) \parse_url($url, PHP_URL_PATH);
            $base = basename($path);
            if ($base !== '') {
                return (string) $base;
            }
        }

        return '';
    }
}
