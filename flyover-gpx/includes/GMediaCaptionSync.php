<?php

declare(strict_types=1);

namespace FGpx;

if (!\defined('ABSPATH')) {
    exit;
}

final class GMediaCaptionSync
{
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

        $attachmentIds = $wpdb->get_col("SELECT ID FROM {$wpdb->posts} WHERE post_type = 'attachment' AND post_mime_type LIKE 'image/%' ORDER BY ID ASC");
        if (!\is_array($attachmentIds)) {
            $result['errors'] = 1;
            $result['message'] = 'Unable to read WordPress attachments.';
            return $result;
        }

        foreach ($attachmentIds as $rawId) {
            $attachmentId = (int) $rawId;
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
