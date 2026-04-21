const fs = require('fs');
const path = require('path');

const GALLERY_SRC = fs.readFileSync(
  path.resolve(__dirname, '../../assets/js/gallery.js'),
  'utf8'
);

function loadGallery() {
  // eslint-disable-next-line no-eval
  eval(GALLERY_SRC);
}

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeTracks(count) {
  const items = [];
  for (let i = 1; i <= count; i += 1) {
    items.push({
      id: i,
      title: `Track ${i}`,
      distanceKm: i,
      durationS: i * 100,
      durationLabel: `0${i}:00`,
      elevationGainM: i * 10,
      elevationGainLabel: String(i * 10),
      dateTs: i,
      dateLabel: `2026-01-${String(i).padStart(2, '0')}`,
      gpxDownloadUrl: '',
      keywords: i === 3 ? 'forest ridge sunrise' : '',
    });
  }
  return items;
}

function buildPayload(items, page, totalPages) {
  return {
    items,
    pagination: {
      page,
      perPage: items.length,
      totalPages,
      totalItems: items.length * totalPages,
      hasMore: page < totalPages,
    },
  };
}

function mockReducedMotion(matches) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: jest.fn().mockImplementation(() => ({
      matches,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
}

function setupGalleryDom(markup) {
  document.body.innerHTML = markup || `
    <div class="fgpx-gallery" data-root-id="gallery-default">
      <div class="fgpx-gallery-toolbar">
        <input type="search" class="fgpx-gallery-search" />
        <select class="fgpx-gallery-sort">
          <option value="newest">Newest</option>
          <option value="distance">Distance</option>
          <option value="duration">Duration</option>
          <option value="gain">Elevation gain</option>
          <option value="title">Title</option>
        </select>
        <div class="fgpx-gallery-view-toggle">
          <button type="button" class="fgpx-gallery-view-btn is-active" data-view="grid" aria-pressed="true">Grid</button>
          <button type="button" class="fgpx-gallery-view-btn" data-view="list" aria-pressed="false">List</button>
        </div>
      </div>
      <div class="fgpx-gallery-results fgpx-gallery-results-grid" aria-live="polite"></div>
      <div class="fgpx-gallery-footer">
        <button type="button" class="fgpx-gallery-load-more">Load more</button>
      </div>
      <section class="fgpx-gallery-player-panel" hidden>
        <header class="fgpx-gallery-player-header">
          <div class="fgpx-gallery-player-title" tabindex="-1"></div>
          <div class="fgpx-gallery-player-actions">
            <a class="fgpx-share-btn fgpx-share-fb" href="#">Facebook</a>
            <a class="fgpx-share-btn fgpx-share-x" href="#">Twitter</a>
            <a class="fgpx-share-btn fgpx-share-wa" href="#">WhatsApp</a>
            <button type="button" class="fgpx-share-btn fgpx-share-copy">Copy Link</button>
          </div>
        </header>
        <div class="fgpx-gallery-player-mount"></div>
      </section>
    </div>
  `;
}

function baseStrings() {
  return {
    loadMore: 'Load more',
    loading: 'Loading tracks...',
    noResults: 'No tracks found',
    listLoadFailed: 'Could not load the track list. Please try again.',
    distance: 'Distance',
    duration: 'Duration',
    gain: 'Elevation gain',
    uploaded: 'Uploaded',
    launch: 'Open Track',
    copied: 'Link copied',
    copyFailed: 'Could not copy link',
    copyShortcode: 'Copy Link',
    playerLoadFailed: 'Could not load the track player. Please try again.',
  };
}

describe('gallery.js', () => {
  const RealDate = Date;

  beforeEach(() => {
    jest.useRealTimers();
    setupGalleryDom();
    mockReducedMotion(false);
    window.location.hash = '';
    window.FGPX = {
      initContainer: jest.fn(),
    };
    window.FGPXGallery = {
      tracks: makeTracks(15),
      perPage: 12,
      playerHeight: '625px',
      playerStyle: 'raster',
      playerStyleUrl: '',
      defaultSort: 'newest',
      showViewToggle: true,
      strings: baseStrings(),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete window.FGPX;
    delete window.FGPXGallery;
    delete window.FGPXGalleryInstances;
    delete window.fetch;
    delete window.__FGPXGalleryPlayerAssetsPromise;
    delete window.__FGPXGalleryConsumedHash;
    delete window.matchMedia;
    window.location.hash = '';
    global.Date = RealDate;
  });

  test('applies forced bright mode to gallery shell as light', () => {
    window.FGPXGallery.playerConfig = { themeMode: 'bright' };

    loadGallery();

    expect(document.querySelector('.fgpx-gallery').getAttribute('data-fgpx-theme')).toBe('light');
  });

  test('system mode removes forced theme attribute from gallery shell', () => {
    setupGalleryDom(`
      <div class="fgpx-gallery" data-root-id="gallery-default" data-fgpx-theme="dark">
        <div class="fgpx-gallery-toolbar">
          <input type="search" class="fgpx-gallery-search" />
          <select class="fgpx-gallery-sort"><option value="newest">Newest</option></select>
        </div>
        <div class="fgpx-gallery-results fgpx-gallery-results-grid" aria-live="polite"></div>
        <div class="fgpx-gallery-footer"><button type="button" class="fgpx-gallery-load-more">Load more</button></div>
        <section class="fgpx-gallery-player-panel" hidden>
          <header class="fgpx-gallery-player-header"><div class="fgpx-gallery-player-title" tabindex="-1"></div><div class="fgpx-gallery-player-actions"></div></header>
          <div class="fgpx-gallery-player-mount"></div>
        </section>
      </div>
    `);

    window.FGPXGallery.playerConfig = { themeMode: 'system' };

    loadGallery();

    expect(document.querySelector('.fgpx-gallery').hasAttribute('data-fgpx-theme')).toBe(false);
  });

  test('auto mode applies dark at configured time window', () => {
    global.Date = class extends RealDate {
      constructor(...args) {
        if (args.length) {
          return new RealDate(...args);
        }
        return new RealDate('2026-01-01T23:15:30');
      }

      static now() {
        return new RealDate('2026-01-01T23:15:30').getTime();
      }
    };

    jest.spyOn(global, 'setTimeout').mockImplementation(() => 1);
    window.FGPXGallery.playerConfig = {
      themeMode: 'auto',
      themeAutoDarkStart: '22:00',
      themeAutoDarkEnd: '06:00',
    };

    loadGallery();

    expect(document.querySelector('.fgpx-gallery').getAttribute('data-fgpx-theme')).toBe('dark');
    expect(setTimeout).toHaveBeenCalled();
  });

  test('auto mode with equal start and end falls back to system theme', () => {
    setupGalleryDom(`
      <div class="fgpx-gallery" data-root-id="gallery-default" data-fgpx-theme="dark">
        <div class="fgpx-gallery-toolbar">
          <input type="search" class="fgpx-gallery-search" />
          <select class="fgpx-gallery-sort"><option value="newest">Newest</option></select>
        </div>
        <div class="fgpx-gallery-results fgpx-gallery-results-grid" aria-live="polite"></div>
        <div class="fgpx-gallery-footer"><button type="button" class="fgpx-gallery-load-more">Load more</button></div>
        <section class="fgpx-gallery-player-panel" hidden>
          <header class="fgpx-gallery-player-header"><div class="fgpx-gallery-player-title" tabindex="-1"></div><div class="fgpx-gallery-player-actions"></div></header>
          <div class="fgpx-gallery-player-mount"></div>
        </section>
      </div>
    `);

    const timeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation(() => 1);
    window.FGPXGallery.playerConfig = {
      themeMode: 'auto',
      themeAutoDarkStart: '22:00',
      themeAutoDarkEnd: '22:00',
    };

    loadGallery();

    expect(document.querySelector('.fgpx-gallery').hasAttribute('data-fgpx-theme')).toBe(false);
    expect(timeoutSpy).not.toHaveBeenCalled();
  });

  test('auto mode with invalid times falls back to default dark window', () => {
    global.Date = class extends RealDate {
      constructor(...args) {
        if (args.length) {
          return new RealDate(...args);
        }
        return new RealDate('2026-01-01T23:15:30');
      }

      static now() {
        return new RealDate('2026-01-01T23:15:30').getTime();
      }
    };

    window.FGPXGallery.playerConfig = {
      themeMode: 'auto',
      themeAutoDarkStart: '99:99',
      themeAutoDarkEnd: 'bad',
    };

    loadGallery();

    expect(document.querySelector('.fgpx-gallery').getAttribute('data-fgpx-theme')).toBe('dark');
  });

  test('renders initial page and load-more appends additional items in inline mode', () => {
    loadGallery();

    let cards = document.querySelectorAll('.fgpx-gallery-card');
    expect(cards.length).toBe(12);

    const loadMore = document.querySelector('.fgpx-gallery-load-more');
    loadMore.click();

    cards = document.querySelectorAll('.fgpx-gallery-card');
    expect(cards.length).toBe(15);
    expect(loadMore.hidden).toBe(true);
  });

  test('reveals cards on first render and only animates newly added cards on load more', () => {
    loadGallery();

    let cards = Array.from(document.querySelectorAll('.fgpx-gallery-card'));
    expect(cards).toHaveLength(12);
    expect(cards.every((card) => card.classList.contains('fgpx-gallery-card-reveal'))).toBe(true);
    expect(cards[0].style.getPropertyValue('--fgpx-gallery-reveal-delay')).toBe('0ms');
    expect(cards[1].style.getPropertyValue('--fgpx-gallery-reveal-delay')).toBe('45ms');

    document.querySelector('.fgpx-gallery-load-more').click();

    cards = Array.from(document.querySelectorAll('.fgpx-gallery-card'));
    expect(cards).toHaveLength(15);
    expect(cards.slice(0, 12).every((card) => !card.classList.contains('fgpx-gallery-card-reveal'))).toBe(true);
    expect(cards.slice(12).every((card) => card.classList.contains('fgpx-gallery-card-reveal'))).toBe(true);
    expect(cards[12].style.getPropertyValue('--fgpx-gallery-reveal-delay')).toBe('0ms');
  });

  test('skips reveal animation when reduced motion is preferred', () => {
    mockReducedMotion(true);

    loadGallery();

    const cards = Array.from(document.querySelectorAll('.fgpx-gallery-card'));
    expect(cards).toHaveLength(12);
    expect(cards.every((card) => !card.classList.contains('fgpx-gallery-card-reveal'))).toBe(true);
  });

  test('inline search matches metadata and keyword text', () => {
    loadGallery();

    const input = document.querySelector('.fgpx-gallery-search');
    input.value = 'forest ridge';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const cards = document.querySelectorAll('.fgpx-gallery-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Track 3');
  });

  test('renders preview image when available and falls back to icon on image error', () => {
    const tracks = makeTracks(2);
    tracks[1].previewImageUrl = 'https://example.test/preview.jpg';
    window.FGPXGallery.tracks = tracks;
    window.FGPXGallery.perPage = 2;

    loadGallery();

    const firstCard = document.querySelector('.fgpx-gallery-card');
    const image = firstCard.querySelector('.fgpx-gallery-card-image');
    expect(image).not.toBeNull();
    expect(image.getAttribute('src')).toContain('preview.jpg');

    const visual = firstCard.querySelector('.fgpx-gallery-card-visual');
    expect(visual.classList.contains('is-fallback')).toBe(false);

    image.dispatchEvent(new Event('error'));
    expect(image.style.display).toBe('none');
    expect(visual.classList.contains('is-fallback')).toBe(true);
  });

  test('default sort newest shows highest date first and title sort reorders', () => {
    loadGallery();

    let firstTitle = document.querySelector('.fgpx-gallery-card-title').textContent;
    expect(firstTitle).toContain('Track 15');

    const sort = document.querySelector('.fgpx-gallery-sort');
    sort.value = 'title';
    sort.dispatchEvent(new Event('change', { bubbles: true }));

    firstTitle = document.querySelector('.fgpx-gallery-card-title').textContent;
    expect(firstTitle).toContain('Track 1');
  });

  test('applies configured defaultSort on first render', () => {
    window.FGPXGallery.tracks = [
      { id: 10, title: 'Zulu', distanceKm: 3, durationS: 100, durationLabel: '01:40', elevationGainM: 30, elevationGainLabel: '30', dateTs: 300, dateLabel: '2026-01-03', gpxDownloadUrl: '', keywords: '' },
      { id: 20, title: 'Alpha', distanceKm: 2, durationS: 90, durationLabel: '01:30', elevationGainM: 20, elevationGainLabel: '20', dateTs: 200, dateLabel: '2026-01-02', gpxDownloadUrl: '', keywords: '' },
      { id: 30, title: 'Mike', distanceKm: 1, durationS: 80, durationLabel: '01:20', elevationGainM: 10, elevationGainLabel: '10', dateTs: 100, dateLabel: '2026-01-01', gpxDownloadUrl: '', keywords: '' },
    ];
    window.FGPXGallery.defaultSort = 'title';
    window.FGPXGallery.perPage = 3;

    loadGallery();

    const firstTitle = document.querySelector('.fgpx-gallery-card-title').textContent;
    expect(firstTitle).toContain('Alpha');
  });

  test('initializes without search input when markup omits it', () => {
    setupGalleryDom(`
      <div class="fgpx-gallery" data-root-id="gallery-default">
        <div class="fgpx-gallery-toolbar">
          <select class="fgpx-gallery-sort"><option value="newest">Newest</option></select>
          <div class="fgpx-gallery-view-toggle">
            <button type="button" class="fgpx-gallery-view-btn is-active" data-view="grid" aria-pressed="true">Grid</button>
            <button type="button" class="fgpx-gallery-view-btn" data-view="list" aria-pressed="false">List</button>
          </div>
        </div>
        <div class="fgpx-gallery-results fgpx-gallery-results-grid" aria-live="polite"></div>
        <div class="fgpx-gallery-footer"><button type="button" class="fgpx-gallery-load-more">Load more</button></div>
        <section class="fgpx-gallery-player-panel" hidden>
          <header class="fgpx-gallery-player-header"><div class="fgpx-gallery-player-title" tabindex="-1"></div><div class="fgpx-gallery-player-actions"></div></header>
          <div class="fgpx-gallery-player-mount"></div>
        </section>
      </div>
    `);

    loadGallery();

    const cards = document.querySelectorAll('.fgpx-gallery-card');
    expect(cards.length).toBe(12);
  });

  test('clicking a card mounts player and creates share urls', () => {
    loadGallery();

    const cards = document.querySelectorAll('.fgpx-gallery-card');
    cards[0].click();

    const panel = document.querySelector('.fgpx-gallery-player-panel');
    expect(panel.hidden).toBe(false);

    const mount = document.querySelector('.fgpx-gallery-player-mount .fgpx');
    expect(mount).not.toBeNull();
    expect(mount.getAttribute('data-track-id')).toBe('15');
    expect(window.FGPX.initContainer).toHaveBeenCalledTimes(1);

    const fb = document.querySelector('.fgpx-share-fb').href;
    const x = document.querySelector('.fgpx-share-x').href;
    const wa = document.querySelector('.fgpx-share-wa').href;
    expect(fb).toContain('facebook.com/sharer');
    expect(x).toContain('twitter.com/intent/tweet');
    expect(wa).toContain('wa.me');
  });

  test('gallery player mount sets per-instance strategy override without mutating global config', () => {
    window.FGPXGallery.tracks[14].gpxDownloadUrl = 'https://example.test/dl.gpx';
    loadGallery();

    const cards = document.querySelectorAll('.fgpx-gallery-card');
    cards[0].click();

    const mount = document.querySelector('.fgpx-gallery-player-mount .fgpx');
    const playerId = mount.getAttribute('id');
    
    // Verify per-instance override is set
    expect(window.FGPX.instances).not.toBeNull();
    expect(window.FGPX.instances[playerId]).not.toBeUndefined();
    expect(window.FGPX.instances[playerId].galleryPhotoStrategy).toBe('latest_embed');
    expect(window.FGPX.instances[playerId].gpxDownloadUrl).toBe('https://example.test/dl.gpx');
    
    // Verify global strategy key was not promoted to top-level config
    expect(window.FGPX.galleryPhotoStrategy).toBeUndefined();
    expect(window.FGPX.gpxDownloadUrl).toBeUndefined();
  });

  test('copy link falls back to execCommand when Clipboard API is unavailable', async () => {
    delete navigator.clipboard;
    document.execCommand = jest.fn(() => true);

    loadGallery();

    document.querySelector('.fgpx-gallery-card').click();
    document.querySelector('.fgpx-share-copy').click();

    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('.fgpx-share-copy').textContent).toBe('Link copied');

    await flushPromises();
  });

  test('failed lazy asset load shows a player error instead of a blank panel', async () => {
    delete window.FGPX;
    window.FGPXGallery.playerScripts = ['/broken-player.js'];

    const originalAppendChild = document.head.appendChild.bind(document.head);
    jest.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      const appended = originalAppendChild(node);
      if (node.tagName === 'SCRIPT' && typeof node.onerror === 'function') {
        node.onerror(new Event('error'));
      } else if (node.tagName === 'LINK' && typeof node.onload === 'function') {
        node.onload(new Event('load'));
      }
      return appended;
    });

    loadGallery();

    document.querySelector('.fgpx-gallery-card').click();
    await flushPromises();
    await flushPromises();

    expect(document.querySelector('.fgpx-gallery-player-panel').hidden).toBe(false);
    expect(document.querySelector('.fgpx-gallery-player-mount').textContent).toContain('Could not load the track player. Please try again.');
  });

  test('server mode fetches the first page and load more appends the next page', async () => {
    const allTracks = makeTracks(15);
    delete window.FGPXGallery.tracks;
    Object.assign(window.FGPXGallery, {
      endpointUrl: '/wp-json/fgpx/v1/gallery',
      ajaxUrl: '/wp-admin/admin-ajax.php',
      ajaxAction: 'fgpx_gallery_tracks',
    });

    window.fetch = jest.fn((url) => {
      if (String(url).includes('page=2')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(buildPayload(allTracks.slice(12), 2, 2)),
        });
      }

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(buildPayload(allTracks.slice(0, 12), 1, 2)),
      });
    });

    loadGallery();
    await flushPromises();
    await flushPromises();

    let cards = document.querySelectorAll('.fgpx-gallery-card');
    expect(cards.length).toBe(12);
    expect(window.fetch).toHaveBeenCalledTimes(1);

    document.querySelector('.fgpx-gallery-load-more').click();
    await flushPromises();
    await flushPromises();

    cards = document.querySelectorAll('.fgpx-gallery-card');
    expect(cards.length).toBe(15);
    expect(document.querySelector('.fgpx-gallery-load-more').hidden).toBe(true);
    expect(window.fetch).toHaveBeenCalledTimes(2);
  });

  test('server mode hash auto-open fetches a shared track outside the first page', async () => {
    const firstPageTracks = makeTracks(12);
    const sharedTrack = makeTracks(15)[14];
    delete window.FGPXGallery.tracks;
    Object.assign(window.FGPXGallery, {
      endpointUrl: '/wp-json/fgpx/v1/gallery',
      ajaxUrl: '/wp-admin/admin-ajax.php',
      ajaxAction: 'fgpx_gallery_tracks',
    });
    window.location.hash = '#track-15';

    window.fetch = jest.fn((url) => {
      if (String(url).includes('track_id=15')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ item: sharedTrack }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(buildPayload(firstPageTracks, 1, 2)),
      });
    });

    loadGallery();
    await flushPromises();
    await flushPromises();
    await flushPromises();

    const panel = document.querySelector('.fgpx-gallery-player-panel');
    const mount = document.querySelector('.fgpx-gallery-player-mount .fgpx');
    expect(panel.hidden).toBe(false);
    expect(mount).not.toBeNull();
    expect(mount.getAttribute('data-track-id')).toBe('15');
    expect(window.fetch).toHaveBeenCalledTimes(2);
  });

  test('multi-instance: each gallery root reads its own FGPXGalleryInstances config', () => {
    setupGalleryDom(`
      <div class="fgpx-gallery" data-root-id="gallery-a">
        <input type="search" class="fgpx-gallery-search" />
        <select class="fgpx-gallery-sort"><option value="newest">Newest</option></select>
        <div class="fgpx-gallery-results fgpx-gallery-results-grid" aria-live="polite"></div>
        <div class="fgpx-gallery-footer"><button type="button" class="fgpx-gallery-load-more">Load more</button></div>
        <section class="fgpx-gallery-player-panel" hidden>
          <header class="fgpx-gallery-player-header">
            <div class="fgpx-gallery-player-title" tabindex="-1"></div>
            <div class="fgpx-gallery-player-actions"></div>
          </header>
          <div class="fgpx-gallery-player-mount"></div>
        </section>
      </div>
      <div class="fgpx-gallery" data-root-id="gallery-b">
        <input type="search" class="fgpx-gallery-search" />
        <select class="fgpx-gallery-sort"><option value="newest">Newest</option></select>
        <div class="fgpx-gallery-results fgpx-gallery-results-grid" aria-live="polite"></div>
        <div class="fgpx-gallery-footer"><button type="button" class="fgpx-gallery-load-more">Load more</button></div>
        <section class="fgpx-gallery-player-panel" hidden>
          <header class="fgpx-gallery-player-header">
            <div class="fgpx-gallery-player-title" tabindex="-1"></div>
            <div class="fgpx-gallery-player-actions"></div>
          </header>
          <div class="fgpx-gallery-player-mount"></div>
        </section>
      </div>
    `);

    const sharedStrings = {
      loadMore: 'Load more',
      noResults: 'No tracks found',
      distance: 'Distance',
      duration: 'Duration',
      gain: 'Gain',
      uploaded: 'Uploaded',
      launch: 'Open',
      copyShortcode: 'Copy',
    };

    window.FGPXGalleryInstances = {
      'gallery-a': { tracks: makeTracks(15), perPage: 4, defaultSort: 'newest', playerHeight: '400px', playerStyle: 'raster', playerStyleUrl: '', strings: sharedStrings },
      'gallery-b': { tracks: makeTracks(5), perPage: 3, defaultSort: 'newest', playerHeight: '400px', playerStyle: 'raster', playerStyleUrl: '', strings: sharedStrings },
    };
    delete window.FGPXGallery;

    loadGallery();

    const [rootA, rootB] = document.querySelectorAll('.fgpx-gallery');
    expect(rootA.querySelectorAll('.fgpx-gallery-card').length).toBe(4);
    expect(rootA.querySelector('.fgpx-gallery-load-more').hidden).toBe(false);
    expect(rootB.querySelectorAll('.fgpx-gallery-card').length).toBe(3);
    expect(rootB.querySelector('.fgpx-gallery-load-more').hidden).toBe(false);
  });

  test('multi-instance: hash auto-open is consumed per root', async () => {
    setupGalleryDom(`
      <div class="fgpx-gallery" data-root-id="gallery-a">
        <input type="search" class="fgpx-gallery-search" />
        <select class="fgpx-gallery-sort"><option value="newest">Newest</option></select>
        <div class="fgpx-gallery-results fgpx-gallery-results-grid" aria-live="polite"></div>
        <div class="fgpx-gallery-footer"><button type="button" class="fgpx-gallery-load-more">Load more</button></div>
        <section class="fgpx-gallery-player-panel" hidden>
          <header class="fgpx-gallery-player-header">
            <div class="fgpx-gallery-player-title" tabindex="-1"></div>
            <div class="fgpx-gallery-player-actions"></div>
          </header>
          <div class="fgpx-gallery-player-mount"></div>
        </section>
      </div>
      <div class="fgpx-gallery" data-root-id="gallery-b">
        <input type="search" class="fgpx-gallery-search" />
        <select class="fgpx-gallery-sort"><option value="newest">Newest</option></select>
        <div class="fgpx-gallery-results fgpx-gallery-results-grid" aria-live="polite"></div>
        <div class="fgpx-gallery-footer"><button type="button" class="fgpx-gallery-load-more">Load more</button></div>
        <section class="fgpx-gallery-player-panel" hidden>
          <header class="fgpx-gallery-player-header">
            <div class="fgpx-gallery-player-title" tabindex="-1"></div>
            <div class="fgpx-gallery-player-actions"></div>
          </header>
          <div class="fgpx-gallery-player-mount"></div>
        </section>
      </div>
    `);

    const sharedStrings = {
      loadMore: 'Load more',
      noResults: 'No tracks found',
      distance: 'Distance',
      duration: 'Duration',
      gain: 'Gain',
      uploaded: 'Uploaded',
      launch: 'Open',
      copyShortcode: 'Copy',
    };

    const tracks = makeTracks(15);
    window.FGPXGalleryInstances = {
      'gallery-a': { tracks, perPage: 15, defaultSort: 'newest', playerHeight: '400px', playerStyle: 'raster', playerStyleUrl: '', strings: sharedStrings },
      'gallery-b': { tracks, perPage: 15, defaultSort: 'newest', playerHeight: '400px', playerStyle: 'raster', playerStyleUrl: '', strings: sharedStrings },
    };
    delete window.FGPXGallery;
    window.location.hash = '#track-15';

    loadGallery();
    await flushPromises();
    await flushPromises();

    const roots = document.querySelectorAll('.fgpx-gallery');
    const panelA = roots[0].querySelector('.fgpx-gallery-player-panel');
    const panelB = roots[1].querySelector('.fgpx-gallery-player-panel');
    const mountA = roots[0].querySelector('.fgpx-gallery-player-mount .fgpx');
    const mountB = roots[1].querySelector('.fgpx-gallery-player-mount .fgpx');

    expect(panelA.hidden).toBe(false);
    expect(panelB.hidden).toBe(false);
    expect(mountA).not.toBeNull();
    expect(mountB).not.toBeNull();
    expect(mountA.getAttribute('data-track-id')).toBe('15');
    expect(mountB.getAttribute('data-track-id')).toBe('15');
  });
});
