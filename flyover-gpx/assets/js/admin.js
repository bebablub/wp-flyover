/**
 * Admin JavaScript for Flyover GPX plugin
 */
(function($) {
    'use strict';

    const previewCfg = window.FGPXAdminPreview || {};
    const BULK_MAX_TRACKS = Number(previewCfg.bulkMaxTracks) > 0 ? Number(previewCfg.bulkMaxTracks) : 25;
    const BULK_PAUSE_MS = Number(previewCfg.bulkPauseMs) >= 0 ? Number(previewCfg.bulkPauseMs) : 200;

    $(document).ready(function() {
        // File size validation and preview
        function validateAndPreviewFile($input, maxSizeMB = 20) {
            const file = $input[0].files[0];
            if (!file) return true;
            
            const maxSizeBytes = maxSizeMB * 1024 * 1024;
            const fileSize = file.size;
            const fileName = file.name;
            
            // Remove existing messages
            $input.siblings('.file-info, .file-error').remove();
            
            if (fileSize > maxSizeBytes) {
                const errorMsg = $('<div class="file-error notice notice-error inline" style="margin: 5px 0;"><p>File size (' + (fileSize / 1024 / 1024).toFixed(1) + 'MB) exceeds maximum allowed size of ' + maxSizeMB + 'MB.</p></div>');
                $input.after(errorMsg);
                return false;
            }
            
            // Show file info
            const fileInfo = $('<div class="file-info notice notice-success inline" style="margin: 5px 0;"><p></p></div>');
            fileInfo.find('p').append($('<strong>').text('Selected: ')).append(document.createTextNode(fileName + ' (' + (fileSize / 1024 / 1024).toFixed(1) + 'MB)'));
            $input.after(fileInfo);
            
            return true;
        }
        
        // Handle GPX upload form loading state (both settings page and Add New Track page)
        $('form').on('submit', function(e) {
            const $form = $(this);
            // Check if this is a GPX upload form
            if ($form.find('input[name="action"][value="fgpx_upload"]').length === 0) {
                return true; // Not our form, continue normally
            }
            
            const $submitBtn = $form.find('button[type="submit"], input[type="submit"]');
            const $fileInput = $form.find('input[type="file"]');
            
            // Check if file is selected and submit button exists
            if (!$fileInput.length || !$fileInput[0].files.length) {
                return true; // Let browser handle validation
            }
            
            if (!$submitBtn.length) {
                return true; // No submit button found, continue normally
            }
            
            // Validate file size
            if (!validateAndPreviewFile($fileInput)) {
                e.preventDefault();
                return false;
            }
            
            // Show loading state
            const originalText = $submitBtn.text();
            $submitBtn.prop('disabled', true);
            $submitBtn.addClass('fgpx-uploading');
            $submitBtn.html('<span class="spinner is-active"></span>Uploading...');
            
            // Add progress message
            const $progressMsg = $('<div class="fgpx-upload-progress notice notice-info" style="margin-top: 15px;"><p><strong>Uploading and processing GPX file...</strong><br>This may take a few moments for large files. Please do not close this page.</p></div>');
            $form.after($progressMsg);
            
            return true; // Continue with form submission
        });
        
        // File input change handlers for validation
        $('input[name="fgpx_file"]').on('change', function() {
            validateAndPreviewFile($(this));
        });
        
        // Replace GPX functionality removed - use "Add New Track" instead

        // Handle individual weather enrichment action links
        $('.fgpx-enrich-weather').on('click', function(e) {
            e.preventDefault();
            
            const $link = $(this);
            const postId = $link.data('post-id');
            const nonce = $link.data('nonce');
            
            if (!postId || !nonce) {
                alert('Invalid data for weather enrichment.');
                return;
            }
            
            // Disable the link and show loading state
            $link.css('pointer-events', 'none').attr('aria-disabled', 'true');
            const originalText = $link.text();
            $link.text('Enriching...');
            
            // Make AJAX request
            $.ajax({
                url: ajaxurl, // WordPress global
                type: 'POST',
                data: {
                    action: 'fgpx_enrich_weather',
                    post_id: postId,
                    nonce: nonce
                },
                success: function(response) {
                    if (response.success) {
                        // Show success message
                        $link.text('✓ Enriched');
                        $link.css('color', '#46b450');
                        
                        // Show admin notice
                        showAdminNotice('Weather data enriched successfully.', 'success');
                    } else {
                        // Show error message
                        $link.text('✗ Failed');
                        $link.css('color', '#dc3232');
                        
                        const errorMsg = response.data && response.data.message 
                            ? response.data.message 
                            : 'Failed to enrich with weather data.';
                        showAdminNotice(errorMsg, 'error');
                    }
                },
                error: function(xhr, status, error) {
                    // Show error message
                    $link.text('✗ Error');
                    $link.css('color', '#dc3232');
                    
                    // Log detailed error information to console
                    console.error('[FGPX] Weather enrichment AJAX error:', {
                        status: status,
                        error: error,
                        statusCode: xhr.status,
                        statusText: xhr.statusText,
                        responseText: xhr.responseText,
                        readyState: xhr.readyState
                    });
                    
                    // Try to parse error response
                    let errorMsg = 'Network error during weather enrichment.';
                    try {
                        const response = JSON.parse(xhr.responseText);
                        if (response && response.data && response.data.message) {
                            errorMsg = response.data.message;
                        }
                    } catch (e) {
                        // If response is not JSON, check for plain text error
                        if (xhr.responseText && xhr.responseText.length < 200) {
                            errorMsg = 'Error: ' + xhr.responseText;
                        } else if (xhr.status > 0) {
                            errorMsg = 'Network error (HTTP ' + xhr.status + '): ' + xhr.statusText;
                        }
                    }
                    
                    showAdminNotice(errorMsg, 'error');
                    console.error('[FGPX] Full error response:', xhr.responseText);
                },
                complete: function() {
                    // Re-enable the link after a delay
                    setTimeout(function() {
                        $link.css('pointer-events', '').removeAttr('aria-disabled');
                        if ($link.text() === 'Enriching...') {
                            $link.text(originalText);
                        }
                    }, 2000);
                }
            });
        });

        $('.fgpx-generate-preview').on('click', async function(e) {
            e.preventDefault();

            const $btn = $(this);
            const postId = parseInt($btn.data('post-id'), 10);
            const nonce = $btn.data('nonce');
            const trackTitle = String($btn.data('track-title') || '').trim();

            if (!postId || !nonce) {
                showAdminNotice('Invalid data for preview generation.', 'error');
                return;
            }

            const originalText = $btn.text();
            $btn.css('pointer-events', 'none').attr('aria-disabled', 'true').text('Generating...');

            try {
                const response = await generatePreviewForTrack(postId, nonce, trackTitle);
                if (response && response.success) {
                    const usedSource = response.data && response.data.source ? response.data.source : 'none';
                    const previewUrl = response.data && response.data.previewUrl ? response.data.previewUrl : '';
                    const message = response.data && response.data.message ? String(response.data.message) : 'Preview generated successfully.';

                    $btn.text('✓ Preview Ready').css('color', '#46b450').attr('data-has-preview', '1');
                    showAdminNotice(message, 'success');

                    const $sourceLabel = $('.fgpx-preview-current-source code').first();
                    if ($sourceLabel.length) {
                        $sourceLabel.text(usedSource || 'none');
                    }

                    if (previewUrl) {
                        upsertPreviewImage(previewUrl);
                    } else {
                        removePreviewImage();
                    }
                } else {
                    const message = response && response.data && response.data.message
                        ? response.data.message
                        : 'Preview generation failed.';
                    $btn.text('✗ Failed').css('color', '#dc3232');
                    showAdminNotice(message, 'error');
                }
            } catch (xhr) {
                let message = 'Network error during preview generation.';
                try {
                    const payload = JSON.parse(xhr.responseText || '{}');
                    if (payload && payload.data && payload.data.message) {
                        message = payload.data.message;
                    }
                } catch (_) {
                    if (xhr && xhr.status) {
                        message = 'Network error (HTTP ' + xhr.status + ').';
                    }
                }
                $btn.text('✗ Error').css('color', '#dc3232');
                showAdminNotice(message, 'error');
            } finally {
                setTimeout(function() {
                    $btn.css('pointer-events', '').removeAttr('aria-disabled');
                    if ($btn.text() === 'Generating...') {
                        $btn.text(originalText);
                    }
                }, 1200);
            }
        });

        // Handle clear cache action
        $('.fgpx-clear-cache').on('click', function(e) {
            e.preventDefault();

            const $link = $(this);
            const postId = $link.data('post-id');
            const nonce = $link.data('nonce');

            if (!postId || !nonce) {
                alert('Invalid data for cache clearing.');
                return;
            }

            if (!confirm('Clear cache for this track? The player will regenerate track data on next page load.')) {
                return;
            }

            // Disable the link and show loading state
            $link.css('pointer-events', 'none').attr('aria-disabled', 'true');
            const originalText = $link.text();
            $link.text('Clearing...');

            // Make AJAX request
            $.ajax({
                url: ajaxurl,
                type: 'POST',
                data: {
                    action: 'fgpx_clear_cache',
                    post_id: postId,
                    nonce: nonce
                },
                success: function(response) {
                    if (response.success) {
                        $link.text('✓ Cleared');
                        $link.css('color', '#46b450');
                        showAdminNotice('Cache cleared successfully! The page will reload.', 'success');
                        
                        // Reload the page after 1.5 seconds
                        setTimeout(function() {
                            location.reload();
                        }, 1500);
                    } else {
                        $link.text('✗ Failed');
                        $link.css('color', '#dc3232');
                        const errorMsg = response.data && response.data.message 
                            ? response.data.message 
                            : 'Failed to clear cache.';
                        showAdminNotice(errorMsg, 'error');
                    }
                },
                error: function(xhr, status, error) {
                    $link.text('✗ Error');
                    $link.css('color', '#dc3232');
                    console.error('[FGPX] Clear cache AJAX error:', {
                        status: status,
                        error: error,
                        statusCode: xhr.status
                    });
                    
                    let errorMsg = 'Network error during cache clearing.';
                    try {
                        const response = JSON.parse(xhr.responseText);
                        if (response && response.data && response.data.message) {
                            errorMsg = response.data.message;
                        }
                    } catch (_) { }
                    
                    showAdminNotice(errorMsg, 'error');
                },
                complete: function() {
                    setTimeout(function() {
                        $link.css('pointer-events', '').removeAttr('aria-disabled');
                        if ($link.text() === 'Clearing...') {
                            $link.text(originalText);
                        }
                    }, 2000);
                }
            });
        });

        $('#doaction, #doaction2').on('click', async function(e) {
            const triggerId = this.id;
            const select = triggerId === 'doaction2' ? $('#bulk-action-selector-bottom') : $('#bulk-action-selector-top');
            const action = String(select.val() || '');

            if (action !== 'fgpx_generate_previews' && action !== 'fgpx_regenerate_previews') {
                return;
            }

            const selectedIds = $('input[name="post[]"]:checked').map(function() {
                return parseInt($(this).val(), 10);
            }).get().filter(function(v) { return Number.isFinite(v) && v > 0; });

            if (selectedIds.length === 0) {
                e.preventDefault();
                showAdminNotice('Select at least one track to generate previews.', 'warning');
                return;
            }

            let targetIds = selectedIds.slice();
            if (targetIds.length > BULK_MAX_TRACKS) {
                e.preventDefault();
                targetIds = targetIds.slice(0, BULK_MAX_TRACKS);
                showAdminNotice(
                    'Safety limit applied: processing first ' + BULK_MAX_TRACKS + ' tracks now, leaving ' + (selectedIds.length - BULK_MAX_TRACKS) + ' for the next run.',
                    'warning'
                );
            }

            e.preventDefault();
            const force = action === 'fgpx_regenerate_previews';
            const $trigger = $(this);
            const originalText = $trigger.val();
            $trigger.prop('disabled', true).val('Working...');

            let generated = 0;
            let skipped = 0;
            let failed = 0;

            for (let i = 0; i < targetIds.length; i += 1) {
                const trackId = targetIds[i];
                const $rowAction = $('.fgpx-generate-preview[data-post-id="' + trackId + '"]').first();
                const nonce = String($rowAction.data('nonce') || '');
                const hasPreview = String($rowAction.data('has-preview') || '0') === '1';
                const trackTitle = String($rowAction.data('track-title') || ('Track #' + trackId));

                $trigger.val('Working... ' + (i + 1) + '/' + targetIds.length);

                if (!nonce) {
                    failed += 1;
                    continue;
                }

                if (!force && hasPreview) {
                    skipped += 1;
                    continue;
                }

                try {
                    const response = await generatePreviewForTrack(trackId, nonce, trackTitle);
                    if (response && response.success) {
                        generated += 1;
                        $rowAction.attr('data-has-preview', '1');
                        $rowAction.text('Regenerate Preview');
                    } else {
                        failed += 1;
                    }
                } catch (_) {
                    failed += 1;
                }

                if (BULK_PAUSE_MS > 0) {
                    // Space requests slightly to reduce rate-limit spikes.
                    // eslint-disable-next-line no-await-in-loop
                    await sleep(BULK_PAUSE_MS);
                }
            }

            $trigger.prop('disabled', false).val(originalText);
            showAdminNotice('Preview generation finished: ' + generated + ' generated, ' + skipped + ' skipped, ' + failed + ' failed.', failed > 0 ? 'warning' : 'success');
        });

        $(document).on('change', '.fgpx-preview-mode-select', function() {
            const $box = $(this).closest('.fgpx-preview-mode-box');
            const mode = String($(this).val() || 'auto');
            $box.find('.fgpx-preview-custom-wrap').toggle(mode === 'custom');
        });

        $(document).on('click', '.fgpx-preview-custom-select', function(e) {
            e.preventDefault();

            if (!window.wp || !wp.media) {
                showAdminNotice('WordPress media library is not available on this screen.', 'error');
                return;
            }

            const $box = $(this).closest('.fgpx-preview-mode-box');
            const frame = wp.media({
                title: 'Select custom track preview image',
                button: { text: 'Use this image' },
                multiple: false,
                library: { type: 'image' }
            });

            frame.on('select', function() {
                const selected = frame.state().get('selection').first();
                if (!selected) {
                    return;
                }

                const data = selected.toJSON();
                const id = Number(data.id) > 0 ? Number(data.id) : 0;
                const url = data.sizes && data.sizes.medium_large && data.sizes.medium_large.url
                    ? data.sizes.medium_large.url
                    : (data.url || '');

                $box.find('.fgpx-preview-custom-id').val(String(id));
                if (url) {
                    $box.find('.fgpx-preview-custom-thumb').html(
                        '<img src="' + String(url).replace(/"/g, '&quot;') + '" alt="Custom preview image" style="max-width:100%;height:auto;border:1px solid #ccd0d4;border-radius:6px" />'
                    ).show();
                }
            });

            frame.open();
        });

        $(document).on('click', '.fgpx-preview-custom-clear', function(e) {
            e.preventDefault();
            const $box = $(this).closest('.fgpx-preview-mode-box');
            $box.find('.fgpx-preview-custom-id').val('0');
            $box.find('.fgpx-preview-custom-thumb').empty().hide();
        });

        $(document).on('click', '.fgpx-preview-mode-save', function(e) {
            e.preventDefault();

            const $btn = $(this);
            const $box = $btn.closest('.fgpx-preview-mode-box');
            const postId = Number($box.data('post-id')) || 0;
            const nonce = String($box.data('nonce') || '');
            const mode = String($box.find('.fgpx-preview-mode-select').val() || 'auto');
            const customAttachmentId = Number($box.find('.fgpx-preview-custom-id').val() || 0);
            const $status = $box.find('.fgpx-preview-mode-status');

            if (!postId || !nonce) {
                showAdminNotice('Cannot save preview mode due to missing track data.', 'error');
                return;
            }

            $btn.prop('disabled', true);
            $status.text('Saving...');

            $.ajax({
                url: ajaxurl,
                type: 'POST',
                data: {
                    action: 'fgpx_save_preview_mode',
                    post_id: postId,
                    nonce: nonce,
                    mode: mode,
                    custom_attachment_id: customAttachmentId
                },
                success: function(response) {
                    if (!response || !response.success) {
                        const message = response && response.data && response.data.message
                            ? response.data.message
                            : 'Failed to save preview mode.';
                        $status.text('Failed').css('color', '#d63638');
                        showAdminNotice(message, 'error');
                        return;
                    }

                    const previewUrl = response.data && response.data.previewUrl ? String(response.data.previewUrl) : '';
                    if (previewUrl) {
                        upsertPreviewImage(previewUrl);
                    } else {
                        removePreviewImage();
                    }

                    const source = response.data && response.data.source ? String(response.data.source) : 'none';
                    $box.find('.fgpx-preview-current-source code').text(source || 'none');

                    $status.text('Saved').css('color', '#2271b1');
                    showAdminNotice('Preview mode updated.', 'success');
                },
                error: function() {
                    $status.text('Failed').css('color', '#d63638');
                    showAdminNotice('Network error while saving preview mode.', 'error');
                },
                complete: function() {
                    $btn.prop('disabled', false);
                }
            });
        });
    });

    function sleep(ms) {
        return new Promise(function(resolve) {
            setTimeout(resolve, ms);
        });
    }

    async function generatePreviewForTrack(postId, nonce, trackTitle) {
        const payload = await buildPreviewImagePayload(postId, trackTitle);

        return new Promise(function(resolve, reject) {
            $.ajax({
                url: ajaxurl,
                type: 'POST',
                data: {
                    action: 'fgpx_generate_preview',
                    post_id: postId,
                    nonce: nonce,
                    source: payload.source,
                    image_data: payload.imageData
                },
                success: resolve,
                error: reject
            });
        });
    }

    async function buildPreviewImagePayload(postId, trackTitle) {
        const inlineMapSnapshot = getMapSnapshotDataUrl();
        if (inlineMapSnapshot) {
            return { imageData: inlineMapSnapshot, source: 'map_snapshot' };
        }

        const offscreenSnapshot = await generateOffscreenMapSnapshotDataUrl(postId);
        if (offscreenSnapshot) {
            return { imageData: offscreenSnapshot, source: 'map_snapshot' };
        }

        return {
            imageData: createFallbackCardDataUrl(trackTitle || ('Track #' + postId), postId),
            source: 'fallback_card'
        };
    }

    function getMapSnapshotDataUrl() {
        const canvas = document.querySelector('#fgpx_preview .maplibregl-canvas')
            || document.querySelector('.maplibregl-canvas');
        if (!canvas || typeof canvas.toDataURL !== 'function') {
            return '';
        }

        try {
            return canvas.toDataURL('image/jpeg', 0.86);
        } catch (_) {
            return '';
        }
    }

    async function generateOffscreenMapSnapshotDataUrl(postId) {
        if (!window.maplibregl || typeof window.maplibregl.Map !== 'function') {
            return '';
        }

        const trackData = await fetchTrackData(postId);
        const coordinates = extractTrackCoordinates(trackData);
        if (!coordinates.length) {
            return '';
        }

        const cfg = window.FGPXAdminPreview || {};
        const width = Number(cfg.snapshotWidth) > 0 ? Number(cfg.snapshotWidth) : 1200;
        const height = Number(cfg.snapshotHeight) > 0 ? Number(cfg.snapshotHeight) : 630;

        const container = document.createElement('div');
        container.style.position = 'fixed';
        container.style.left = '-10000px';
        container.style.top = '-10000px';
        container.style.width = width + 'px';
        container.style.height = height + 'px';
        container.style.pointerEvents = 'none';
        document.body.appendChild(container);

        let map = null;
        try {
            map = new window.maplibregl.Map({
                container: container,
                style: getSnapshotStyle(cfg),
                center: coordinates[0],
                zoom: 11,
                interactive: false,
                attributionControl: false,
                preserveDrawingBuffer: true,
                fadeDuration: 0
            });

            await waitForMapLoad(map, 12000);

            map.addSource('fgpx-preview-route', {
                type: 'geojson',
                data: {
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: coordinates
                    },
                    properties: {}
                }
            });

            map.addLayer({
                id: 'fgpx-preview-route-layer',
                type: 'line',
                source: 'fgpx-preview-route',
                paint: {
                    'line-color': '#ff6a00',
                    'line-width': 4,
                    'line-opacity': 0.92
                }
            });

            const bounds = coordinates.reduce(function(b, coord) {
                return b.extend(coord);
            }, new window.maplibregl.LngLatBounds(coordinates[0], coordinates[0]));

            map.fitBounds(bounds, {
                padding: 48,
                duration: 0,
                maxZoom: 13
            });

            await new Promise(function(resolve) { setTimeout(resolve, 700); });
            return map.getCanvas().toDataURL('image/jpeg', 0.86);
        } catch (_) {
            return '';
        } finally {
            try {
                if (map) {
                    map.remove();
                }
            } catch (_) {}
            if (container.parentNode) {
                container.parentNode.removeChild(container);
            }
        }
    }

    async function fetchTrackData(postId) {
        const cfg = window.FGPXAdminPreview || {};
        const restBase = String(cfg.restBase || '').replace(/\/$/, '');
        const ajaxUrl = String(cfg.ajaxUrl || ajaxurl || '');

        if (restBase) {
            try {
                const restResponse = await fetch(restBase + '/track/' + encodeURIComponent(postId), {
                    credentials: 'same-origin'
                });
                if (restResponse.ok) {
                    return await restResponse.json();
                }
            } catch (_) {}
        }

        if (ajaxUrl) {
            try {
                const url = ajaxUrl + (ajaxUrl.indexOf('?') === -1 ? '?' : '&') + 'action=fgpx_track&id=' + encodeURIComponent(postId);
                const ajaxResponse = await fetch(url, { credentials: 'same-origin' });
                if (ajaxResponse.ok) {
                    return await ajaxResponse.json();
                }
            } catch (_) {}
        }

        return null;
    }

    function extractTrackCoordinates(trackData) {
        const coordinates = trackData && trackData.geojson && Array.isArray(trackData.geojson.coordinates)
            ? trackData.geojson.coordinates
            : [];

        return coordinates
            .map(function(coord) {
                if (!Array.isArray(coord) || coord.length < 2) {
                    return null;
                }
                const lng = Number(coord[0]);
                const lat = Number(coord[1]);
                if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
                    return null;
                }
                return [lng, lat];
            })
            .filter(function(coord) { return !!coord; });
    }

    function getSnapshotStyle(cfg) {
        const useVector = String(cfg.defaultStyle || '') === 'vector';
        const styleUrl = String(cfg.defaultStyleUrl || '');
        if (useVector && styleUrl) {
            return styleUrl;
        }

        return {
            version: 8,
            sources: {
                osm: {
                    type: 'raster',
                    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                    tileSize: 256,
                    attribution: '&copy; OpenStreetMap contributors'
                }
            },
            layers: [
                {
                    id: 'osm-base',
                    type: 'raster',
                    source: 'osm'
                }
            ]
        };
    }

    function waitForMapLoad(map, timeoutMs) {
        return new Promise(function(resolve, reject) {
            let timeout = null;
            const cleanup = function() {
                if (timeout) {
                    clearTimeout(timeout);
                }
                map.off('load', onLoad);
                map.off('error', onError);
            };
            const onLoad = function() {
                cleanup();
                resolve();
            };
            const onError = function() {
                cleanup();
                reject(new Error('Map load error'));
            };

            map.once('load', onLoad);
            map.once('error', onError);
            timeout = setTimeout(function() {
                cleanup();
                reject(new Error('Map load timeout'));
            }, timeoutMs);
        });
    }

    function createFallbackCardDataUrl(title, postId) {
        const canvas = document.createElement('canvas');
        canvas.width = 1200;
        canvas.height = 630;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return '';
        }

        const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        gradient.addColorStop(0, '#0f4c81');
        gradient.addColorStop(1, '#2d83c7');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.beginPath();
        ctx.arc(1060, 120, 240, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(1140, 620, 180, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#e5f3ff';
        ctx.font = 'bold 38px sans-serif';
        ctx.fillText('Flyover GPX', 68, 108);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 54px sans-serif';
        const safeTitle = String(title || ('Track #' + postId)).slice(0, 48);
        ctx.fillText(safeTitle, 68, 210);

        ctx.fillStyle = '#e5f3ff';
        ctx.font = '30px sans-serif';
        ctx.fillText('Fallback preview image', 68, 304);
        ctx.fillText('Track ID: ' + postId, 68, 360);

        return canvas.toDataURL('image/png');
    }

    function upsertPreviewImage(previewUrl) {
        const holder = document.querySelector('#fgpx_preview');
        if (!holder) {
            return;
        }

        let wrap = holder.querySelector('.fgpx-preview-current-wrap');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.className = 'fgpx-preview-current-wrap';
            wrap.innerHTML = '<p style="margin:8px 0 0">Current gallery preview image:</p>';
            holder.appendChild(wrap);
        }
        wrap.style.display = '';

        let image = wrap.querySelector('img[data-fgpx-track-preview="1"]');
        if (!image) {
            image = document.createElement('img');
            image.setAttribute('data-fgpx-track-preview', '1');
            image.alt = 'Track preview image';
            image.style.maxWidth = '100%';
            image.style.height = 'auto';
            image.style.border = '1px solid #ccd0d4';
            image.style.borderRadius = '6px';
            image.style.marginTop = '8px';
            wrap.appendChild(image);
        }

        image.src = previewUrl;
    }

    function removePreviewImage() {
        const holder = document.querySelector('#fgpx_preview');
        if (!holder) {
            return;
        }

        const wrap = holder.querySelector('.fgpx-preview-current-wrap');
        if (!wrap) {
            return;
        }

        const image = wrap.querySelector('img[data-fgpx-track-preview="1"]');
        if (image && image.parentNode) {
            image.parentNode.removeChild(image);
        }

        wrap.style.display = 'none';
    }
    
    /**
     * Show admin notice dynamically
     */
    function showAdminNotice(message, type) {
        type = type || 'info';
        const noticeClass = 'notice notice-' + type + ' is-dismissible';
        
        const $notice = $('<div class="' + noticeClass + '"><p></p></div>');
        $notice.find('p').text(message);
        
        // Insert after .wrap h1 or at the top of .wrap
        const $wrap = $('.wrap');
        const $h1 = $wrap.find('h1').first();
        
        if ($h1.length) {
            $h1.after($notice);
        } else {
            $wrap.prepend($notice);
        }
        
        // Auto-dismiss after 5 seconds
        setTimeout(function() {
            $notice.fadeOut(function() {
                $(this).remove();
            });
        }, 5000);
        
        // Handle manual dismiss
        $notice.on('click', '.notice-dismiss', function() {
            $notice.fadeOut(function() {
                $(this).remove();
            });
        });
        
        // Add dismiss button if not present
        if (!$notice.find('.notice-dismiss').length) {
            $notice.append('<button type="button" class="notice-dismiss"><span class="screen-reader-text">Dismiss this notice.</span></button>');
        }
    }
    
})(jQuery);
