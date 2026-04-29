# Project Guidelines

## Scope
These instructions apply to the whole repository. The WordPress plugin code lives in `flyover-gpx/`.

## Architecture
- Entry point: `flyover-gpx/flyover-gpx.php`.
- PHP classes are in `flyover-gpx/includes/` under namespace `FGpx`.
- Frontend player is a large IIFE in `flyover-gpx/assets/js/front.js`.
- Lazy bootstrap is in `flyover-gpx/assets/js/fgpx-lazy.js`.
- REST data endpoint is provided by `FGpx\Rest` at `GET /wp-json/fgpx/v1/track/{id}`.
- Simulation tab behavior lives in `flyover-gpx/assets/js/front.js` + `flyover-gpx/assets/css/front.css`; keep headwind/tailwind/sidewind mapping and smooth weather fades consistent.

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
- Do not forget to update the AJAX endpoint alongside with the REST endpoint
- Do not break anything, take care of cache, take care that already uploaded tracks are correctly shown with changes, take care of backward compatibility

## Testing Expectations
- Don't test to detailed, test only main flows and most important edge cases, not every single line of code.
- Don't test implementation details, test expected behavior and outputs.
- Don't try to run tests cause needed binaries may not be available.
- Do always veriprocfy your code against tests by a code review.

## Link, Do Not Duplicate
Use existing docs for details instead of repeating them:
- Developer deep dive: `CLAUDE.md`
- User-facing overview and features: `README.md`
- CI checks and release pipeline: `.github/workflows/ci.yml`, `.github/workflows/release.yml`
