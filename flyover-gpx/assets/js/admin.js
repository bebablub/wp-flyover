/**
 * Admin JavaScript for Flyover GPX plugin
 */
(function($) {
    'use strict';

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
            const fileInfo = $('<div class="file-info notice notice-success inline" style="margin: 5px 0;"><p><strong>Selected:</strong> ' + fileName + ' (' + (fileSize / 1024 / 1024).toFixed(1) + 'MB)</p></div>');
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
            $link.prop('disabled', true);
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
                        $link.prop('disabled', false);
                        if ($link.text() === 'Enriching...') {
                            $link.text(originalText);
                        }
                    }, 2000);
                }
            });
        });
    });
    
    /**
     * Show admin notice dynamically
     */
    function showAdminNotice(message, type) {
        type = type || 'info';
        const noticeClass = 'notice notice-' + type + ' is-dismissible';
        
        const $notice = $('<div class="' + noticeClass + '"><p>' + message + '</p></div>');
        
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
