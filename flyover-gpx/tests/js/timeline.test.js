/**
 * Timeline Component Tests
 * Tests cover month grouping, pagination, modal, error handling, and keyboard navigation
 */

const fs = require('fs');
const path = require('path');

// setup.js (configured in jest.config.js) defines IntersectionObserver globally.
global.DBG = () => {}; // Debug logging stub

const TIMELINE_SRC = fs.readFileSync(
	path.join(__dirname, '../../assets/js/timeline.js'),
	'utf-8'
);

function flushPromises() {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeMonth(monthTs, items) {
	return {
		month: 'March 2025',
		monthTs,
		items: items || [
			{
				id: 1,
				title: 'Test Track',
				distanceKm: 10.5,
				durationLabel: '1h 5m',
				elevationGainLabel: '320',
				dateLabel: 'March 15, 2025',
				activityDateTs: 1710432000,
				previewUrl: '',
			},
		],
	};
}

function makePayload(months, hasMore) {
	return {
		months: months || [makeMonth(1746144000)],
		pagination: { page: 1, perPage: 20, hasMore: hasMore !== undefined ? hasMore : false },
	};
}

function mockFetchSuccess(payload) {
	window.fetch = jest.fn(() =>
		Promise.resolve({ ok: true, json: () => Promise.resolve(payload) })
	);
}

function mockFetchFailure() {
	window.fetch = jest.fn(() => Promise.reject(new Error('Network error')));
}

describe('Timeline Component', () => {
	let container;
	let mockConfig;
	let originalXMLHttpRequest;

	beforeEach(() => {
		jest.clearAllMocks();
		originalXMLHttpRequest = window.XMLHttpRequest;

		// Clear any existing instances
		delete window.FGPXTimelineInstances;
		delete window.FGPXTimelineI18n;
		delete window.FGPX;
		delete window.__FGPXTimelinePlayerAssetsPromise;

		// Create test container
		container = document.createElement('div');
		container.id = 'test-timeline';
		container.setAttribute('data-root-id', 'test-root-id-1');
		container.classList.add('fgpx-timeline');
		document.body.appendChild(container);

		// Create mock config
		mockConfig = {
			rootId: 'test-root-id-1',
			orientation: 'vertical',
			perPage: 20,
			cardWidth: '280px',
			cardHeight: '280px',
			monthGrouping: true,
			style: 'default',
			styleUrl: '',
			photoOrderMode: 'geo_first',
			ajaxUrl: '/wp-admin/admin-ajax.php',
			restUrl: '/wp-json/fgpx/v1/timeline/tracks',
			restNonce: 'test-nonce-123',
			playerConfig: {
				restUrl: '/wp-json/fgpx/v1',
				restBase: '/wp-json/fgpx/v1',
				nonce: 'player-nonce-456',
				ajaxUrl: '/wp-admin/admin-ajax.php',
				preferAjaxFirst: true,
				hostPostId: 987,
				mapSelectorDefault: 'satellite_contours',
				contoursEnabled: true,
				contoursTilesUrl: 'https://tiles.example.test/contours/{z}/{x}/{y}.png',
				contoursSourceLayer: 'contour',
				satelliteLayerId: 'satellite',
				satelliteTilesUrl: 'https://tiles.example.test/sat/{z}/{x}/{y}.jpg',
				weatherEnabled: true,
				weatherOpacity: 0.7,
				weatherVisibleByDefault: false,
				photoOrderMode: 'geo_first',
				photosEnabled: true,
				galleryPhotoStrategy: 'latest_embed',
			},
			playerStyles: [],
			playerScripts: [],
		};

		// Set up i18n strings
		window.FGPXTimelineI18n = {
			errorLoadingTracks: 'Failed to load timeline tracks',
			unknownError: 'Unknown error',
			networkError: 'Network error',
			serverError: 'Server error',
			httpError: 'HTTP error',
			invalidResponse: 'Invalid response from server',
			distanceLabel: 'Distance',
			durationLabel: 'Duration',
			elevationGainLabel: 'Elevation Gain',
			distanceUnitKm: 'km',
			elevationUnitM: 'm',
			viewTrackLabelPrefix: 'View track: ',
			closeLabel: 'Close',
			noTracksTitle: 'No tracks found',
			noTracksMessage: 'Start by uploading your first GPX file to see tracks here.',
			playerLoadFailed: 'Unable to load player. Please try again.',
		};

		// Set up instances
		window.FGPXTimelineInstances = {};
		window.FGPXTimelineInstances['test-root-id-1'] = mockConfig;

		// Default successful fetch
		mockFetchSuccess(makePayload());
	});

	afterEach(() => {
		// Clean up
		if (container && container.parentNode) {
			container.parentNode.removeChild(container);
		}
		delete window.FGPXTimelineInstances;
		delete window.FGPXTimelineI18n;
		delete window.FGPX;
		delete window.fetch;
		window.XMLHttpRequest = originalXMLHttpRequest;
		delete window.__FGPXTimelinePlayerAssetsPromise;
	});

	test('boot creates timeline-content with vertical orientation', () => {
		eval(TIMELINE_SRC);

		const content = container.querySelector('.timeline-content');
		expect(content).not.toBeNull();
		expect(content.classList.contains('timeline-vertical')).toBe(true);
	});

	test('boot applies horizontal orientation class', () => {
		mockConfig.orientation = 'horizontal';
		eval(TIMELINE_SRC);

		const content = container.querySelector('.timeline-content');
		expect(content.classList.contains('timeline-horizontal')).toBe(true);
	});

	test('mobile viewport forces vertical orientation regardless of config', () => {
		mockConfig.orientation = 'horizontal';
		Object.defineProperty(window, 'innerWidth', { value: 700, configurable: true });

		eval(TIMELINE_SRC);

		const content = container.querySelector('.timeline-content');
		expect(content.classList.contains('timeline-vertical')).toBe(true);
		expect(content.classList.contains('timeline-horizontal')).toBe(false);
	});

	test('skeleton is shown immediately on boot before fetch resolves', () => {
		eval(TIMELINE_SRC);

		const skeleton = container.querySelector('.timeline-loading-skeleton');
		expect(skeleton).not.toBeNull();
	});

	test('renders month sections and track cards after successful fetch', async () => {
		const payload = makePayload([makeMonth(1746144000, [
			{ id: 42, title: 'My Track', distanceKm: 5.1, durationLabel: '30m', elevationGainLabel: '50', dateLabel: 'March 1, 2025', activityDateTs: 1740825600, previewUrl: '' },
		])]);
		mockFetchSuccess(payload);

		eval(TIMELINE_SRC);

		await flushPromises();
		await flushPromises();

		const sections = container.querySelectorAll('.timeline-month-section');
		expect(sections.length).toBe(1);

		const card = container.querySelector('[data-track-id="42"]');
		expect(card).not.toBeNull();
	});

	test('shows empty state when months array is empty', async () => {
		mockFetchSuccess(makePayload([], false));

		eval(TIMELINE_SRC);

		await flushPromises();
		await flushPromises();

		const emptyState = container.querySelector('.timeline-empty-state');
		expect(emptyState).not.toBeNull();
	});

	test('month grouping disabled renders tracks without month headers', async () => {
		mockConfig.monthGrouping = false;
		mockFetchSuccess(makePayload([
			makeMonth(1746144000, [{ id: 1, title: 'P1', distanceKm: 1, durationLabel: '5m', elevationGainLabel: '10', dateLabel: 'March 1, 2025', activityDateTs: 1740825600, previewUrl: '' }]),
			makeMonth(1748822400, [{ id: 2, title: 'P2', distanceKm: 2, durationLabel: '10m', elevationGainLabel: '20', dateLabel: 'April 1, 2025', activityDateTs: 1743465600, previewUrl: '' }]),
		], false));

		eval(TIMELINE_SRC);
		await flushPromises();
		await flushPromises();

		expect(container.querySelectorAll('.timeline-month-header').length).toBe(0);
		expect(container.querySelectorAll('.timeline-track-item').length).toBe(2);
	});

	       test('shows error state on network failure', async () => {
		       mockFetchFailure();

		       eval(TIMELINE_SRC);

		       // Wait for error element to appear (poll up to 50ms)
		       let error = null;
		       for (let i = 0; i < 10; i++) {
			       await flushPromises();
			       error = container.querySelector('.timeline-error');
			       if (error) break;
		       }
		       expect(error).not.toBeNull();
	       });

	test('shows error state on invalid response structure', async () => {
		window.fetch = jest.fn(() =>
			Promise.resolve({ ok: true, json: () => Promise.resolve({ unexpected: true }) })
		);

		eval(TIMELINE_SRC);

		await flushPromises();
		await flushPromises();

		const error = container.querySelector('.timeline-error');
		expect(error).not.toBeNull();
	});

	test('skeleton is removed after successful fetch', async () => {
		mockFetchSuccess(makePayload());

		eval(TIMELINE_SRC);

		expect(container.querySelector('.timeline-loading-skeleton')).not.toBeNull();

		await flushPromises();
		await flushPromises();

		expect(container.querySelector('.timeline-loading-skeleton')).toBeNull();
	});

	test('two timelines on same page initialize independently', async () => {
		const container2 = document.createElement('div');
		container2.id = 'test-timeline-2';
		container2.setAttribute('data-root-id', 'test-root-id-2');
		container2.classList.add('fgpx-timeline');
		document.body.appendChild(container2);

		window.FGPXTimelineInstances['test-root-id-2'] = {
			...mockConfig,
			rootId: 'test-root-id-2',
			orientation: 'horizontal',
		};

		eval(TIMELINE_SRC);

		await flushPromises();
		await flushPromises();

		expect(container.querySelector('.timeline-content').classList.contains('timeline-vertical')).toBe(true);
		expect(container2.querySelector('.timeline-content').classList.contains('timeline-horizontal')).toBe(true);

		document.body.removeChild(container2);
	});

	test('hasMore false prevents additional pages from loading', async () => {
		mockFetchSuccess(makePayload([makeMonth(1746144000)], false));

		eval(TIMELINE_SRC);

		await flushPromises();
		await flushPromises();

		// Only one fetch call should have been made
		expect(window.fetch).toHaveBeenCalledTimes(1);
	});

	test('timeline list uses AJAX first when configured', async () => {
		mockConfig.preferAjaxFirst = true;
		window.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(makePayload()) }));

		const xhrOpen = jest.fn();
		const xhrSetRequestHeader = jest.fn();
		const xhrSend = jest.fn(function() {
			this.status = 200;
			this.responseText = JSON.stringify(makePayload());
			if (typeof this.onload === 'function') {
				this.onload();
			}
		});

		window.XMLHttpRequest = jest.fn(function() {
			this.open = xhrOpen;
			this.setRequestHeader = xhrSetRequestHeader;
			this.send = xhrSend;
		});

		eval(TIMELINE_SRC);
		await flushPromises();
		await flushPromises();

		expect(xhrOpen).toHaveBeenCalledWith('GET', '/wp-admin/admin-ajax.php?action=fgpx_timeline_tracks&page=1&per_page=20');
		expect(window.fetch).not.toHaveBeenCalled();
	});

	test('arrow navigation keeps focus on timeline cards', async () => {
		const payload = makePayload([makeMonth(1746144000, [
			{ id: 1, title: 'First', distanceKm: 1, durationLabel: '5m', elevationGainLabel: '10', dateLabel: 'March 1, 2025', activityDateTs: 1740825600, previewUrl: '' },
			{ id: 2, title: 'Second', distanceKm: 2, durationLabel: '10m', elevationGainLabel: '20', dateLabel: 'March 2, 2025', activityDateTs: 1740912000, previewUrl: '' },
		])], false);
		mockFetchSuccess(payload);

		eval(TIMELINE_SRC);
		await flushPromises();
		await flushPromises();

		const cards = container.querySelectorAll('.timeline-track-card');
		expect(cards.length).toBe(2);

		cards[0].focus();
		cards[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		expect(document.activeElement).toBe(cards[1]);
	});

	test('infinite scroll re-observes new tail item after next page render', async () => {
		window.fetch = jest
			.fn()
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(makePayload([makeMonth(1746144000, [{ id: 1, title: 'P1', distanceKm: 1, durationLabel: '5m', elevationGainLabel: '10', dateLabel: 'March 1, 2025', activityDateTs: 1740825600, previewUrl: '' }])], true)) })
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(makePayload([makeMonth(1748822400, [{ id: 2, title: 'P2', distanceKm: 2, durationLabel: '10m', elevationGainLabel: '20', dateLabel: 'April 1, 2025', activityDateTs: 1743465600, previewUrl: '' }])], false)) });

		eval(TIMELINE_SRC);
		await flushPromises();
		await flushPromises();

		expect(global.IntersectionObserver).toHaveBeenCalled();
		const observerInstance = global.IntersectionObserver.mock.instances[0];
		expect(observerInstance).toBeTruthy();

		observerInstance._callback([{ isIntersecting: true }]);
		await flushPromises();
		await flushPromises();

		expect(observerInstance.disconnect).toHaveBeenCalled();
		expect(container.querySelector('[data-track-id="2"]')).not.toBeNull();
	});

	test('modal shows user-facing error when player assets fail to load', async () => {
		mockFetchSuccess(makePayload());
		delete window.FGPX;

		eval(TIMELINE_SRC);
		await flushPromises();
		await flushPromises();

		const card = container.querySelector('.timeline-track-card');
		expect(card).not.toBeNull();
		card.click();

		await flushPromises();
		await flushPromises();

		const modalError = document.querySelector('.timeline-modal-player .timeline-error');
		expect(modalError).not.toBeNull();
	});

	test('modal boot hydrates global player transport config for front.js', async () => {
		mockFetchSuccess(makePayload());
		window.FGPX = {
			ajaxUrl: null,
			restUrl: undefined,
			nonce: undefined,
			preferAjaxFirst: false,
			contoursEnabled: false,
			weatherEnabled: false,
			galleryPhotoStrategy: 'default',
			instances: {},
			initContainer: jest.fn(),
		};

		eval(TIMELINE_SRC);
		await flushPromises();
		await flushPromises();

		const card = container.querySelector('.timeline-track-card');
		expect(card).not.toBeNull();
		card.click();

		await flushPromises();

		expect(window.FGPX.ajaxUrl).toBe('/wp-admin/admin-ajax.php');
		expect(window.FGPX.restUrl).toBe('/wp-json/fgpx/v1');
		expect(window.FGPX.nonce).toBe('player-nonce-456');
		expect(window.FGPX.preferAjaxFirst).toBe(true);
		expect(window.FGPX.hostPostId).toBe(987);
		expect(window.FGPX.contoursEnabled).toBe(true);
		expect(window.FGPX.contoursTilesUrl).toBe('https://tiles.example.test/contours/{z}/{x}/{y}.png');
		expect(window.FGPX.satelliteTilesUrl).toBe('https://tiles.example.test/sat/{z}/{x}/{y}.jpg');
		expect(window.FGPX.weatherEnabled).toBe(true);
		expect(window.FGPX.photosEnabled).toBe(true);
		expect(window.FGPX.galleryPhotoStrategy).toBe('latest_embed');
		expect(window.FGPX.initContainer).toHaveBeenCalled();
	});

	test('modal player root matches front player container contract', async () => {
		mockFetchSuccess(makePayload());
		window.FGPX = {
			instances: {},
			initContainer: jest.fn(),
		};

		eval(TIMELINE_SRC);
		await flushPromises();
		await flushPromises();

		const card = container.querySelector('.timeline-track-card');
		expect(card).not.toBeNull();
		card.click();

		await flushPromises();

		const playerRoot = document.getElementById('fgpx-timeline-player-1');
		expect(playerRoot).not.toBeNull();
		expect(playerRoot.classList.contains('fgpx')).toBe(true);
		expect(playerRoot.classList.contains('timeline-modal-player')).toBe(true);
		expect(playerRoot.style.height).toBe('');
		expect(playerRoot.getAttribute('data-style')).toBe('default');
		expect(window.FGPX.instances[playerRoot.id].photosEnabled).toBe(true);
		expect(window.FGPX.instances[playerRoot.id].galleryPhotoStrategy).toBe('latest_embed');

		const modalContent = document.querySelector('.timeline-modal-content');
		expect(modalContent.style.maxWidth).toBe('');
		expect(modalContent.style.maxHeight).toBe('');
	});

	test('boot applies card sizing css variables from timeline config', () => {
		eval(TIMELINE_SRC);

		expect(container.style.getPropertyValue('--fgpx-card-width')).toBe('280px');
		expect(container.style.getPropertyValue('--fgpx-card-height')).toBe('280px');
	});

	test('boot skips gracefully when FGPXTimelineInstances missing', () => {
		delete window.FGPXTimelineInstances;

		expect(() => eval(TIMELINE_SRC)).not.toThrow();
	});

	test('i18n strings fall back when FGPXTimelineI18n missing', () => {
		delete window.FGPXTimelineI18n;

		expect(() => eval(TIMELINE_SRC)).not.toThrow();
		expect(container.querySelector('.timeline-content')).not.toBeNull();
	});
});
