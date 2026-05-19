# GPX Filter Import Script

This script (`gpx_filter_import.py`) batch-imports GPX files into WordPress using WP-CLI and the Flyover GPX plugin. It is designed for robust, resumable, and parallelized import workflows, with safety checks and status file persistence.

## Logging

- **Logging is enabled by default.** All actions, errors, and user choices are logged to `gpx_filter_import.log` in the script directory.
- Use `--log-file PATH` to specify a custom log file location.
- Use `--no-log` to disable logging entirely.
- The log file records timestamps and is thread-safe. All major phases, errors, and user prompts are logged for audit/history.

## Features

- **Three-phase workflow:**
  1. **Filter & Table:** Parse and filter GPX files by date, distance, duration, speed.
  2. **Match Posts:** Find WordPress posts containing each GPX filename.
  3. **Import & Append:** Import GPX as `fgpx_track` and append a shortcode to matched posts.
- **Parallel processing** for parsing, matching, and import/append.
- **Persistent status files** for safe abort/resume and incremental imports.
- **Duplicate detection:** Already-imported GPX files are skipped unless forced.
- **Interactive and non-interactive modes.**
- **Dry-run mode** for safe preview.
- **Corruption/schema drift protection** for status files.

## Usage

```sh
python3 gpx_filter_import.py [options]
```

### Common Options

- `--gpx-dir PATH` Directory containing `.gpx` files (default: `scripts/gpx/`)
- `--parse-threads N` Threads for GPX parsing (default: 4)
- `--import-threads N` Threads for import/append (default: 4)
- `--dry-run` Preview actions without writing to WordPress
- `-y`, `--yes` Auto-confirm prompts
- `--non-interactive` No prompts; use `--already-imported-action`
- `--already-imported-action [skip|skip-all|reimport|quit]` Action for duplicates
- `--force-import` Force re-import of all GPX files
- `--force-append` Force append template to all posts
- `--replace-append` Replace template in posts if already present
- `--phase [1|2|3]` Start from a specific phase (uses status files)

### Filtering Options

- `--start YYYY-MM-DD` Start date (inclusive)
- `--end YYYY-MM-DD` End date (inclusive)
- `--days N` Tracks from last N days
- `--weeks N` Tracks from last N weeks
- `--months N` Tracks from last N months
- `--min-distance KM` Minimum distance (km)
- `--min-duration MIN` Minimum duration (minutes)
- `--min-speed KMH` Minimum average speed (km/h)

### Examples

- Import all tracks interactively:
  ```sh
  python3 gpx_filter_import.py
  ```
- Dry-run, last 30 days, distance > 20 km:
  ```sh
  python3 gpx_filter_import.py --days=30 --min-distance=20 --dry-run
  ```
- Resume from phase 2 after adding new GPX files:
  ```sh
  python3 gpx_filter_import.py --phase=2
  ```

## How It Works

- **Phase 1:** Parses all `.gpx` files, applies filters, and saves results to `gpx_import_phase1.json`.
- **Phase 2:** Loads all WordPress posts, matches GPX filenames, and saves mapping to `gpx_import_phase2.json`.
- **Phase 3:** Imports new GPX files (skipping already-imported unless forced), appends shortcodes to posts, and summarizes results.
- **Status files** are checked for corruption and version drift; if invalid, the script warns and restarts the phase.

## Incremental Import

- If you add new GPX files later, just rerun the script. Already-imported files are skipped automatically.
- If status files are missing or invalid, the script will re-scan as needed.

## Requirements

- Python 3.7+
- `gpxpy`, `tabulate`, `tqdm` (install with `pip install -r requirements_gpx_import.txt`)
- WP-CLI installed and in PATH
- Flyover GPX plugin installed in WordPress

## Troubleshooting

- If a status file is corrupted or from an old script version, the script will warn and ignore it.
- For a full reset, delete the status files (`gpx_import_phase1.json`, `gpx_import_phase2.json`).
- For forced reimport, use `--force-import`.

## Configuration

Edit the CONFIGURATION block at the top of the script to set your WordPress path and template file if needed.

## License

See repository LICENSE file.
