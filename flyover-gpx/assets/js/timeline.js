/**
 * Flyover GPX Timeline Component
 * 
 * Renders tracks in chronological timeline layout (vertical/horizontal).
 * Features: month grouping, infinite scroll, modal player integration, responsive design.
 */

(function() {
	'use strict';

	var DBG = window.DBG || function() {}; // Forward reference to debug logging

	// ---- Asset loading (same pattern as gallery.js) ----

	function loadStyles(urls) {
		return Promise.all((urls || []).map(function(u) {
			return new Promise(function(resolve) {
				if (!u) { return resolve(); }
				if ([].slice.call(document.styleSheets).some(function(ss) { return (ss.href || '') === u; })) { return resolve(); }
				var link = document.createElement('link');
				link.rel = 'stylesheet';
				link.href = u;
				link.onload = resolve;
				link.onerror = resolve;
				document.head.appendChild(link);
			});
		}));
	}

	function loadScriptsSequential(urls) {
		return (urls || []).reduce(function(promise, url) {
			return promise.then(function() {
				return new Promise(function(resolve, reject) {
					if (!url) { return resolve(); }
					if ([].slice.call(document.scripts).some(function(s) { return (s.src || '') === url; })) { return resolve(); }
					var script = document.createElement('script');
					script.src = url;
					script.async = false;
					script.defer = false;
					script.onload = resolve;
					script.onerror = function() {
						if (script.parentNode) { script.parentNode.removeChild(script); }
						reject(new Error('Failed to load script: ' + url));
					};
					document.head.appendChild(script);
				});
			});
		}, Promise.resolve());
	}

	function ensurePlayerAssets(cfg) {
		if (window.FGPX && typeof window.FGPX.initContainer === 'function') {
			return Promise.resolve();
		}
		if (!window.__FGPXTimelinePlayerAssetsPromise) {
			window.__FGPXTimelinePlayerAssetsPromise = loadStyles(cfg.playerStyles || [])
				.then(function() { return loadScriptsSequential(cfg.playerScripts || []); })
				.then(function() {
					if (!window.FGPX || typeof window.FGPX.initContainer !== 'function') {
						throw new Error('Player boot function is unavailable.');
					}
				})
				.catch(function(error) {
					window.__FGPXTimelinePlayerAssetsPromise = null;
					throw error;
				});
		}
		return window.__FGPXTimelinePlayerAssetsPromise;
	}

	// ---- End asset loading ----

	/**
	 * Main boot function: discovers all timeline containers and initializes them.
	 */
	function boot() {
		if (!window.FGPXTimelineInstances) {
			return;
		}

		var containers = document.querySelectorAll('.fgpx-timeline');
		containers.forEach(function(container) {
			var rootId = container.getAttribute('data-root-id');
			if (!rootId) {
				return;
			}

			var config = window.FGPXTimelineInstances[rootId];
			if (!config) {
				return;
			}

			initTimeline(container, config);
		});
	}

	/**
	 * Initialize a single timeline instance.
	 * 
	 * @param {HTMLElement} container - Timeline root element
	 * @param {Object} config - Configuration object with REST URL, orientation, etc.
	 */
	function initTimeline(container, config) {
		DBG('Timeline init', { rootId: config.rootId, orientation: config.orientation });

		var state = {
			rootId: config.rootId,
			container: container,
			config: config,
			currentPage: 1,
			isLoading: false,
			hasMore: true,
			tracks: [],
			months: [],
			scrollObserver: null,
			observedItem: null,
			modalOpen: false,
			isFirstLoad: true,
		};

		// Build initial HTML structure
		var contentWrapper = document.createElement('div');
		contentWrapper.className = 'timeline-content';
		if (config.orientation === 'horizontal') {
			contentWrapper.classList.add('timeline-horizontal');
		} else {
			contentWrapper.classList.add('timeline-vertical');
		}

		// Show loading skeleton on initial load
		var skeleton = document.createElement('div');
		skeleton.className = 'timeline-loading-skeleton';
		skeleton.innerHTML = '<div class="skeleton-item"></div><div class="skeleton-item"></div><div class="skeleton-item"></div>';

		container.innerHTML = '';
		container.appendChild(contentWrapper);
		contentWrapper.appendChild(skeleton);

		// Load first batch of tracks
		loadTrackBatch(state, contentWrapper);
	}

	/**
	 * Load a batch of tracks via REST or AJAX, group by month, and render.
	 * 
	 * @param {Object} state - Timeline state object
	 * @param {HTMLElement} contentWrapper - Container for monitor list
	 */
	function loadTrackBatch(state, contentWrapper) {
		if (state.isLoading || !state.hasMore) {
			return;
		}

		state.isLoading = true;
		var params = {
			page: state.currentPage,
			per_page: state.config.perPage || 20,
		};

		// Try REST endpoint first when fetch exists, otherwise use AJAX fallback directly.
		var url = state.config.restUrl + '?' + buildQueryString(params);
		var requestPromise;

		if (typeof window.fetch === 'function') {
			requestPromise = window.fetch(url, {
				method: 'GET',
				headers: {
					'X-WP-Nonce': state.config.restNonce,
				},
			})
				.then(function(response) {
					if (!response.ok) {
						throw new Error('HTTP ' + response.status);
					}
					return response.json();
				})
				.catch(function(error) {
					DBG('REST fetch failed, trying AJAX', error);
					return ajaxLoadTracks(state, params);
				});
		} else {
			requestPromise = ajaxLoadTracks(state, params);
		}

		requestPromise
			.then(function(data) {
				state.isLoading = false;

				if (!data || !Array.isArray(data.months)) {
					DBG('Invalid response structure', data);
					showTimelineError(contentWrapper, new Error('Invalid response structure'));
					return;
				}

				// Remove skeleton on first successful load
				if (state.isFirstLoad) {
					var skeleton = contentWrapper.querySelector('.timeline-loading-skeleton');
					if (skeleton && skeleton.parentNode) {
						skeleton.parentNode.removeChild(skeleton);
					}
					state.isFirstLoad = false;
				}

				// Show "no tracks" message if first page is empty
				if (state.currentPage === 1 && (!data.months || data.months.length === 0)) {
					showEmptyState(contentWrapper);
					return;
				}

				// Append months to timeline
				renderMonths(state, contentWrapper, data.months);

				// Update pagination
				if (data.pagination) {
					state.hasMore = data.pagination.hasMore || false;
					state.currentPage = (data.pagination.page || 1) + 1;
				}

				// Setup/rebind scroll observer to the latest tail item.
				if (state.hasMore) {
					setupScrollObserver(state, contentWrapper);
				} else if (state.scrollObserver) {
					state.scrollObserver.disconnect();
					state.observedItem = null;
				}

				DBG('Timeline batch loaded', {
					months: data.months.length,
					hasMore: state.hasMore,
				});
			})
			.catch(function(error) {
				DBG('Timeline load error', error);
				state.isLoading = false;
				showTimelineError(contentWrapper, error);
			});
	}

	/**
	 * AJAX fallback for loading tracks.
	 * 
	 * @param {Object} state - Timeline state
	 * @param {Object} params - Query parameters
	 * @return {Promise<Object>} Response data
	 */
	function ajaxLoadTracks(state, params) {
		return new Promise(function(resolve, reject) {
			var xhr = new XMLHttpRequest();
			xhr.open('GET', state.config.ajaxUrl + '?action=fgpx_timeline_tracks&' + buildQueryString(params));
			xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');

			xhr.onload = function() {
				if (xhr.status === 200) {
					try {
						var data = JSON.parse(xhr.responseText);
						resolve(data);
					} catch (e) {
						reject(e);
					}
				} else {
					reject(new Error('AJAX HTTP ' + xhr.status));
				}
			};

			xhr.onerror = reject;
			xhr.send();
		});
	}

	/**
	 * Render month sections with their tracks.
	 * 
	 * @param {Object} state - Timeline state
	 * @param {HTMLElement} contentWrapper - Container for months
	 * @param {Array} months - Array of { month, monthTs, items: [...] }
	 */
	function renderMonths(state, contentWrapper, months) {
		months.forEach(function(monthGroup) {
			var monthSection = document.createElement('div');
			monthSection.className = 'timeline-month-section';

			// Month header with timeline line marker
			var monthHeader = document.createElement('div');
			monthHeader.className = 'timeline-month-header';

			var monthLabel = document.createElement('h3');
			monthLabel.className = 'timeline-month-label';
			monthLabel.textContent = monthGroup.month;
			monthLabel.setAttribute('data-month-ts', monthGroup.monthTs);

			monthHeader.appendChild(monthLabel);
			monthSection.appendChild(monthHeader);

			// Track items for this month
			var itemsContainer = document.createElement('ul');
			itemsContainer.className = 'timeline-month-items';

			monthGroup.items.forEach(function(track, index) {
				var li = document.createElement('li');
				li.className = 'timeline-track-item';
				li.setAttribute('data-track-id', track.id);
				li.style.animationDelay = index * 45 + 'ms'; // Staggered animation

				var card = buildTrackCard(track, state);
				li.appendChild(card);

				// Store event handlers for cleanup
				var handlers = {
					click: function() {
						openTrackModal(state, track);
					},
					keydown: function(e) {
						// Enter or Space to open modal
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							openTrackModal(state, track);
						}
						// Arrow keys for card navigation (across months)
						else if (e.key === 'ArrowUp') {
							e.preventDefault();
							navigateToTrack(card, -1, state.container);
						}
						else if (e.key === 'ArrowDown') {
							e.preventDefault();
							navigateToTrack(card, 1, state.container);
						}
					},
				};

				card.addEventListener('click', handlers.click);
				card.addEventListener('keydown', handlers.keydown);

				// Store handlers for potential cleanup
				li.setAttribute('data-handlers', 'click,keydown');

				itemsContainer.appendChild(li);
			});

			monthSection.appendChild(itemsContainer);
			contentWrapper.appendChild(monthSection);
		});
	}

	/**
	 * Navigate to adjacent track item (up or down), crossing month boundaries.
	 * 
	 * @param {HTMLElement} currentItem - Current track card
	 * @param {number} direction - -1 for up, +1 for down
	 * @param {HTMLElement} scopeRoot - Timeline root container
	 */
	function navigateToTrack(currentItem, direction, scopeRoot) {
		var root = scopeRoot || document;
		var allItems = root.querySelectorAll('.timeline-track-card');
		var currentIndex = Array.from(allItems).indexOf(currentItem);

		if (currentIndex === -1) {
			return;
		}

		var nextIndex = currentIndex + direction;

		// Wrap at boundaries
		if (nextIndex < 0) {
			nextIndex = allItems.length - 1; // Wrap to last
		} else if (nextIndex >= allItems.length) {
			nextIndex = 0; // Wrap to first
		}

		if (allItems[nextIndex]) {
			allItems[nextIndex].focus();
		}
	}

	/**
	 * Build HTML card for a single track.
	 * 
	 * @param {Object} track - Track data { id, title, distanceKm, durationLabel, ... }
	 * @param {Object} state - Timeline state
	 * @return {HTMLElement} Card element
	 */
	function buildTrackCard(track, state) {
		var i18n = window.FGPXTimelineI18n || {};
		var card = document.createElement('div');
		card.className = 'timeline-track-card';
		card.setAttribute('role', 'button');
		card.setAttribute('tabindex', '0');
		card.setAttribute('aria-label', (i18n.viewTrackLabelPrefix || 'View track: ') + track.title);

		// Preview image or placeholder
		var preview = document.createElement('div');
		preview.className = 'timeline-track-preview';

		if (track.previewUrl) {
			var img = document.createElement('img');
			img.src = track.previewUrl;
			img.alt = track.title;
			img.classList.add('timeline-track-image');
			preview.appendChild(img);
		} else {
			preview.classList.add('timeline-track-placeholder');
			preview.innerHTML = '<svg class="timeline-placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
		}

		card.appendChild(preview);

		// Overlay with title and stats
		var overlay = document.createElement('div');
		overlay.className = 'timeline-track-overlay';

		var title = document.createElement('h4');
		title.className = 'timeline-track-title';
		title.textContent = track.title;

		var stats = document.createElement('div');
		stats.className = 'timeline-track-stats';

		if (track.distanceKm) {
			var distSpan = document.createElement('span');
			distSpan.className = 'stat-distance';
			distSpan.title = i18n.distanceLabel || 'Distance';
			var distIcon = document.createElement('span');
			distIcon.className = 'stat-icon';
			distIcon.textContent = '📍';
			distSpan.appendChild(distIcon);
			distSpan.appendChild(document.createTextNode(' ' + track.distanceKm + ' ' + (i18n.distanceUnitKm || 'km')));
			stats.appendChild(distSpan);
		}
		if (track.durationLabel) {
			var durSpan = document.createElement('span');
			durSpan.className = 'stat-duration';
			durSpan.title = i18n.durationLabel || 'Duration';
			var durIcon = document.createElement('span');
			durIcon.className = 'stat-icon';
			durIcon.textContent = '⏱️';
			durSpan.appendChild(durIcon);
			durSpan.appendChild(document.createTextNode(' ' + track.durationLabel));
			stats.appendChild(durSpan);
		}
		if (track.elevationGainLabel) {
			var gainSpan = document.createElement('span');
			gainSpan.className = 'stat-elevation';
			gainSpan.title = i18n.elevationGainLabel || 'Elevation Gain';
			var gainIcon = document.createElement('span');
			gainIcon.className = 'stat-icon';
			gainIcon.textContent = '📈';
			gainSpan.appendChild(gainIcon);
			gainSpan.appendChild(document.createTextNode(' ' + track.elevationGainLabel + ' ' + (i18n.elevationUnitM || 'm')));
			stats.appendChild(gainSpan);
		}
		overlay.appendChild(title);
		overlay.appendChild(stats);
		card.appendChild(overlay);

		return card;
	}

	/**
	 * Setup intersection observer for infinite scroll.
	 * 
	 * @param {Object} state - Timeline state
	 * @param {HTMLElement} contentWrapper - Container to observe
	 */
	function setupScrollObserver(state, contentWrapper) {
		if (!window.IntersectionObserver) {
			return;
		}

		var lastItem = contentWrapper.querySelector('.timeline-track-item:last-child');
		if (!lastItem) {
			return;
		}

		// Responsive root margin: trigger earlier on mobile for smoother scrolling
		var rootMargin = '200px';
		if (window.innerWidth < 740) {
			// Mobile: more aggressive pre-loading
			rootMargin = '400px';
		} else if (window.innerWidth < 1100) {
			// Tablet: medium pre-loading
			rootMargin = '300px';
		}

		if (!state.scrollObserver) {
			state.scrollObserver = new IntersectionObserver(
				function(entries) {
					entries.forEach(function(entry) {
						if (entry.isIntersecting && !state.isLoading && state.hasMore) {
							loadTrackBatch(state, contentWrapper);
						}
					});
				},
				{ rootMargin: rootMargin }
			);
		}

		if (state.observedItem && state.observedItem !== lastItem) {
			state.scrollObserver.disconnect();
		}

		state.observedItem = lastItem;
		state.scrollObserver.observe(lastItem);
	}

	/**
	 * Open a modal with the track player.
	 * 
	 * @param {Object} state - Timeline state
	 * @param {Object} track - Track data
	 */
	function openTrackModal(state, track) {
		if (state.modalOpen) {
			return; // Only one modal at a time
		}

		state.modalOpen = true;
		DBG('Opening modal for track', track.id);

		// Create modal overlay
		var modal = document.createElement('div');
		modal.className = 'timeline-modal-overlay';

		// Store modal state for cleanup
		var modalState = {
			escHandler: null,
			clickHandler: null,
			playerContainerId: null,
		};

		// Modal content
		var modalContent = document.createElement('div');
		modalContent.className = 'timeline-modal-content';

		// Close button
		var closeBtn = document.createElement('button');
		closeBtn.className = 'timeline-modal-close';
		closeBtn.innerHTML = '×';
		closeBtn.setAttribute('aria-label', (window.FGPXTimelineI18n && window.FGPXTimelineI18n.closeLabel) || 'Close');
		closeBtn.addEventListener('click', function() {
			closeTrackModal(state, modal, modalState);
		});

		// Player container
		var playerContainer = document.createElement('div');
		playerContainer.className = 'timeline-modal-player';
		playerContainer.id = 'fgpx-timeline-player-' + track.id;

		// Build player config
		var playerConfig = {
			trackId: track.id,
			height: state.config.playerHeight || '636px',
			style: state.config.style || 'default',
			styleUrl: state.config.styleUrl || '',
			styleJson: state.config.styleJson || '',
			resolvedApiKey: state.config.resolvedApiKey || state.config.apiKey || '',
			photoOrderMode: state.config.photoOrderMode || 'geo_first',
		};

		// Store config for player initialization
		if (!window.FGPX) {
			window.FGPX = { instances: {} };
		}
		if (!window.FGPX.instances) {
			window.FGPX.instances = {};
		}

		window.FGPX.instances[playerContainer.id] = playerConfig;
		modalState.playerContainerId = playerContainer.id;

		// Build data attribute for player
		playerContainer.setAttribute('data-track-id', track.id);
		playerContainer.setAttribute('data-height', playerConfig.height);
		playerContainer.setAttribute('data-style', playerConfig.style);
		if (playerConfig.styleUrl) {
			playerContainer.setAttribute('data-style-url', playerConfig.styleUrl);
		}
		playerContainer.classList.add('fgpx-player-container');

		// Append to modal
		modalContent.appendChild(closeBtn);
		modalContent.appendChild(playerContainer);
		modal.appendChild(modalContent);
		document.body.appendChild(modal);

		// Close on outside click - store handler for cleanup
		modalState.clickHandler = function(e) {
			if (e.target === modal) {
				closeTrackModal(state, modal, modalState);
			}
		};
		modal.addEventListener('click', modalState.clickHandler);

		// Close on ESC key - store handler for cleanup
		modalState.escHandler = function(e) {
			if (e.key === 'Escape') {
				closeTrackModal(state, modal, modalState);
			}
		};
		document.addEventListener('keydown', modalState.escHandler);

		// Load player assets on demand, then boot (works even if front.js is not yet on page)
		ensurePlayerAssets(state.config)
			.then(function() {
				window.FGPX.initContainer(playerContainer);
			})
			.catch(function(err) {
				DBG('Player asset load failed', err);
				playerContainer.innerHTML = '';
				var errorMsg = document.createElement('div');
				errorMsg.className = 'timeline-error';
				var p = document.createElement('p');
				p.textContent = (window.FGPXTimelineI18n && window.FGPXTimelineI18n.playerLoadFailed) || 'Unable to load player. Please try again.';
				errorMsg.appendChild(p);
				playerContainer.appendChild(errorMsg);
			});

		// Prevent scroll while modal is open
		document.body.style.overflow = 'hidden';
	}

	/**
	 * Close the track modal.
	 * 
	 * @param {Object} state - Timeline state
	 * @param {HTMLElement} modal - Modal element to remove
	 * @param {Object} modalState - Modal event listener state for cleanup
	 */
	function closeTrackModal(state, modal, modalState) {
		state.modalOpen = false;
		DBG('Closing modal');

		// Remove event listeners
		if (modalState && modalState.escHandler) {
			document.removeEventListener('keydown', modalState.escHandler);
		}
		if (modalState && modalState.clickHandler && modal) {
			modal.removeEventListener('click', modalState.clickHandler);
		}

		// Clean up FGPX player instance to prevent memory leak
		if (modalState && modalState.playerContainerId && window.FGPX && window.FGPX.instances) {
			delete window.FGPX.instances[modalState.playerContainerId];
		}

		if (modal && modal.parentNode) {
			modal.parentNode.removeChild(modal);
		}

		// Restore scroll
		document.body.style.overflow = '';
	}

	/**
	 * Show error message in timeline container.
	 * 
	 * @param {HTMLElement} container - Container element
	 * @param {Error} error - Error object
	 */
	function showTimelineError(container, error) {
		var i18n = window.FGPXTimelineI18n || {};
		var errorDiv = document.createElement('div');
		errorDiv.className = 'timeline-error';

		var errorMsg = i18n.errorLoadingTracks || 'Failed to load timeline tracks';
		var detailMsg = '';

		if (error && error.message) {
			// Distinguish error types
			if (error.message.indexOf('HTTP') === 0) {
				// HTTP error
				var statusCode = error.message.match(/\d+/);
				if (statusCode) {
					statusCode = statusCode[0];
					if (statusCode >= 500) {
						detailMsg = (i18n.serverError || 'Server error') + ' (HTTP ' + statusCode + ')';
					} else if (statusCode >= 400) {
						detailMsg = (i18n.httpError || 'HTTP error') + ' (' + statusCode + ')';
					}
				}
			} else if (error.message.indexOf('JSON') >= 0 || error.message.indexOf('Unexpected') >= 0) {
				// Parse/invalid response error
				detailMsg = i18n.invalidResponse || 'Invalid response from server';
			} else if (error.message.indexOf('Failed to fetch') >= 0 || error.message.indexOf('NetworkError') >= 0) {
				// Network error
				detailMsg = i18n.networkError || 'Network error';
			}

			// Fallback to original message if no specific type matched
			if (!detailMsg) {
				detailMsg = error.message;
			}
		}

		if (!detailMsg) {
			detailMsg = i18n.unknownError || 'Unknown error';
		}

		var p = document.createElement('p');
		p.textContent = errorMsg + ': ' + detailMsg;
		errorDiv.appendChild(p);
		container.innerHTML = '';
		container.appendChild(errorDiv);
	}

	/**
	 * Show empty state message when no tracks found.
	 * 
	 * @param {HTMLElement} container - Container element
	 */
	function showEmptyState(container) {
		var i18n = window.FGPXTimelineI18n || {};
		var emptyDiv = document.createElement('div');
		emptyDiv.className = 'timeline-empty-state';

		var icon = document.createElement('div');
		icon.className = 'timeline-empty-icon';
		icon.textContent = '📍';

		var title = document.createElement('h3');
		title.className = 'timeline-empty-title';
		title.textContent = i18n.noTracksTitle || 'No tracks found';

		var message = document.createElement('p');
		message.className = 'timeline-empty-message';
		message.textContent = i18n.noTracksMessage || 'Start by uploading your first GPX file to see tracks here.';

		emptyDiv.appendChild(icon);
		emptyDiv.appendChild(title);
		emptyDiv.appendChild(message);
		container.innerHTML = '';
		container.appendChild(emptyDiv);
	}

	/**
	 * Build URL query string from object.
	 * 
	 * @param {Object} params - Parameters object
	 * @return {string} Query string
	 */
	function buildQueryString(params) {
		return Object.keys(params)
			.map(function(key) {
				return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
			})
			.join('&');
	}

	/**
	 * Handle document ready or DOMContentLoaded.
	 */
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', boot);
	} else {
		boot();
	}
})();
