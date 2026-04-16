# Project Guidelines

## Scope
These instructions apply to the whole repository. The WordPress plugin code lives in `flyover-gpx/`.

## Build and Test
Run all development commands from `flyover-gpx/`.

```bash
composer update --no-interaction --prefer-dist
composer lint
composer test
npm install
npm test
```

Release packaging uses production dependencies:

```bash
composer install --no-dev --optimize-autoloader
```

## Architecture
- Entry point: `flyover-gpx/flyover-gpx.php`.
- PHP classes are in `flyover-gpx/includes/` under namespace `FGpx`.
- Frontend player is a large IIFE in `flyover-gpx/assets/js/front.js`.
- Lazy bootstrap is in `flyover-gpx/assets/js/fgpx-lazy.js`.
- REST data endpoint is provided by `FGpx\Rest` at `GET /wp-json/fgpx/v1/track/{id}`.

## Critical Conventions
- Keep `declare(strict_types=1);` in PHP files and preserve typed signatures.
- Use WordPress escaping/sanitization helpers for output and input handling.
- Keep nonce and capability checks in admin flows.
- JavaScript is served directly (no transpile/minify build step); write browser-ready code.

## High-Risk Pitfalls
- Do not reorder manual `require_once` class includes in `flyover-gpx/flyover-gpx.php` unless dependencies are re-validated.
- Preserve multi-shortcode behavior: first container id is `fgpx-app`, additional instances use `fgpx-app-N` with per-instance config in `window.FGPX.instances`.
- When extending PHP unit tests that touch WordPress functions, add stubs in `flyover-gpx/tests/bootstrap.php`.
- JS tests execute IIFE scripts in jsdom via `eval()`. Keep tests aligned with that loading model.

## Testing Expectations
- For PHP changes: run `composer lint` and `composer test`.
- For JS changes: run `npm test`.
- Prefer focused tests near touched areas:
  - PHP: `flyover-gpx/tests/Unit/`
  - JS: `flyover-gpx/tests/js/`

## Link, Do Not Duplicate
Use existing docs for details instead of repeating them:
- Developer deep dive: `CLAUDE.md`
- User-facing overview and features: `README.md`
- CI checks and release pipeline: `.github/workflows/ci.yml`, `.github/workflows/release.yml`
