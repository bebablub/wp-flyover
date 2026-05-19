#!/usr/bin/env python3
"""gpx_filter_import.py — Filter GPX files and batch-import them into WordPress via WP-CLI.

DESCRIPTION
-----------
Runs in three interactive phases with a confirmation prompt between each:

  Phase 1 – Filter & Table
    Parse all .gpx files in the target directory, apply optional filters
    (date range, min distance, min elapsed duration, min average speed), and
    display the matching tracks as a table sorted by track start date.

  Phase 2 – Match WordPress Posts
    For each matched GPX file, search all WordPress posts (any type, any
    status except trash) whose post_content contains the filename as a
    substring.  Display the resulting (gpx_file → post) mapping as a table.

  Phase 3 – Import & Append
    For each (gpx_file, post) pair:
      1. Detect whether the GPX was already imported as an fgpx_track and
         ask the user what to do (skip / skip-all / re-import / quit).
      2. Import the GPX via  `wp fgpx import`  to create a new fgpx_track.
      3. Fill the append_template (replacing {{fgpx_shortcode}} with the
         generated shortcode).
      4. Append the filled template to the matched WordPress post.

Use --dry-run to preview every planned action without writing anything.
Read-only WP-CLI calls (post search, already-imported check) are still
executed in dry-run mode so the preview reflects real site data.


USAGE
-----
  python3 gpx_filter_import.py [options]

EXAMPLES
--------
  # Show all tracks (no filters), then proceed interactively
  python3 gpx_filter_import.py

  # Last 30 days, distance > 20 km — dry-run preview
  python3 gpx_filter_import.py --days=30 --min-distance=20 --dry-run

  # Specific date range with duration and speed filters
  python3 gpx_filter_import.py --start=2026-01-01 --end=2026-03-31 \\
      --min-duration=60 --min-speed=15

  # Custom GPX directory, last 4 weeks
  python3 gpx_filter_import.py --gpx-dir=/mnt/gpx_archive --weeks=4


CONFIGURATION
-------------
Edit the CONFIGURATION block directly below before running.
Required: set WP_PATH to your WordPress installation root.
"""

# =============================================================================
# CONFIGURATION — edit these values before running
# =============================================================================

# Absolute path to *your* WordPress installation root.
# Passed as --path=<WP_PATH> to every `wp` CLI call.
WP_PATH = "/var/www/html"

# Directory containing the .gpx files to process.
# None → <script_dir>/gpx/   (i.e. scripts/gpx/ relative to this script)
GPX_DIR = None

# Path to the append template containing {{fgpx_shortcode}}.
# None → <script_dir>/append_template
TEMPLATE_FILE = None

# Per-shortcode overrides passed to `wp fgpx import`.
# Set a value to override the WordPress admin default; None = omit the flag.
#   Boolean options: "on" / "off"
#   Color options:   hex string, e.g. "#1976d2"
IMPORT_SETTINGS = {
    "privacy":                   None,   # "on" / "off"
    "privacy-km":                None,   # float, e.g. "3"
    "hud":                       None,   # "on" / "off"
    "elevation-coloring":        None,   # "on" / "off"
    "show-labels":               None,   # "on" / "off"
    "photos-enabled":            None,   # "on" / "off"
    "weather-visible-by-default":None,   # "on" / "off"
    "wind-analysis-enabled":     None,   # "on" / "off"
    "daynight-enabled":          None,   # "on" / "off"
    "daynight-map-enabled":      None,   # "on" / "off"
    "daynight-visible-by-default":None,  # "on" / "off"
    "elevation-color-flat":      None,   # hex color
    "elevation-color-steep":     None,   # hex color
    "speed-chart-color":         None,   # hex color
    "cadence-chart-color":       None,   # hex color
    "temperature-chart-color":   None,   # hex color
    "power-chart-color":         None,   # hex color
    "wind-impact-chart-color":   None,   # hex color
    "wind-rose-chart-color":     None,   # hex color
    "wind-rose-color-north":     None,   # hex color
    "wind-rose-color-south":     None,   # hex color
    "wind-rose-color-east":      None,   # hex color
    "wind-rose-color-west":      None,   # hex color
    "daynight-map-color":        None,   # hex color
    "gpx-download":              None,   # "on" / "off"
}

# =============================================================================
# END CONFIGURATION
# =============================================================================


import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple
# Threading imports
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
try:
    from tqdm import tqdm
except ImportError:
    print("Error: tqdm is not installed.\n  Run:  pip install -r requirements_gpx_import.txt", file=sys.stderr)
    sys.exit(1)

# ---------------------------------------------------------------------------
# Status file constants and helpers
# ---------------------------------------------------------------------------
PHASE1_FILE = "gpx_import_phase1.json"
PHASE2_FILE = "gpx_import_phase2.json"
STATUS_FILE = "gpx_import_status.json"
SCRIPT_VERSION = "1.0.0-resume-forced-phase"  # Update as needed

def _now_iso():
    return datetime.now(timezone.utc).isoformat()

def save_json_status(filename, data):
    meta = {
        "timestamp": _now_iso(),
        "script_version": SCRIPT_VERSION,
    }
    out = {"meta": meta, "data": data}
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, default=str)

def load_json_status(filename):
    """Load a status file, handling corruption, missing keys, and schema drift.
    Returns the .get('data') dict if valid, else None. Warns on error.
    """
    if not os.path.isfile(filename):
        return None
    try:
        with open(filename, "r", encoding="utf-8") as f:
            obj = json.load(f)
    except Exception as exc:
        print(f"Warning: Could not load status file '{filename}': {exc}", file=sys.stderr)
        print("  The file may be corrupted or incomplete. It will be ignored.", file=sys.stderr)
        return None
    # Check for required keys
    if not isinstance(obj, dict) or "meta" not in obj or "data" not in obj:
        print(f"Warning: Status file '{filename}' is missing required keys. It will be ignored.", file=sys.stderr)
        return None
    # Check script_version for schema drift
    meta = obj.get("meta", {})
    file_version = meta.get("script_version")
    if file_version != SCRIPT_VERSION:
        print(f"Warning: Status file '{filename}' was created by script version '{file_version}', but current version is '{SCRIPT_VERSION}'.", file=sys.stderr)
        print("  The file may be incompatible and will be ignored.", file=sys.stderr)
        return None
    return obj.get("data")

# ---------------------------------------------------------------------------
# Dependency checks (before any other imports from third-party packages)
# ---------------------------------------------------------------------------

try:
    import gpxpy        # type: ignore
    import gpxpy.gpx    # type: ignore
except ImportError:
    print(
        "Error: gpxpy is not installed.\n"
        "  Run:  pip install -r requirements_gpx_import.txt",
        file=sys.stderr,
    )
    sys.exit(1)

try:
    from tabulate import tabulate   # type: ignore
except ImportError:
    print(
        "Error: tabulate is not installed.\n"
        "  Run:  pip install -r requirements_gpx_import.txt",
        file=sys.stderr,
    )
    sys.exit(1)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SCRIPT_DIR   = Path(__file__).parent.resolve()
SEPARATOR    = "─" * 72
NO_TIMESTAMP = datetime.min   # Sentinel: GPX file carries no timestamp data


# =============================================================================
# GPX parsing
# =============================================================================

def _normalize_dt(dt: Optional[datetime]) -> Optional[datetime]:
    """Return a timezone-naive UTC datetime, or None."""
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def parse_gpx_metadata(filepath: Path) -> Optional[dict]:
    """Parse a .gpx file and return a metadata dict, or None on failure.

    The returned dict has keys:
        filepath        Path  – absolute path to the file
        filename        str   – basename
        start_time      datetime (naive UTC) or NO_TIMESTAMP if not available
        end_time        datetime (naive UTC) or None
        distance_km     float – total 2-D track length in kilometres
        duration_min    float – elapsed time (end − start) in minutes
        avg_speed_kmh   float – distance / elapsed_hours
        elevation_gain_m int  – cumulative uphill metres
    """
    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as fh:
            gpx = gpxpy.parse(fh)
    except Exception as exc:
        print(f"  Warning: could not parse {filepath.name}: {exc}", file=sys.stderr)
        return None

    time_bounds = gpx.get_time_bounds()
    start_dt = _normalize_dt(time_bounds.start_time) or NO_TIMESTAMP
    end_dt   = _normalize_dt(time_bounds.end_time)

    # Distance (2-D, in kilometres)
    distance_km = (gpx.length_2d() or 0.0) / 1000.0

    # Total elapsed duration (first timestamp → last timestamp)
    duration_min = 0.0
    if end_dt is not None and start_dt is not NO_TIMESTAMP:
        elapsed = end_dt - start_dt
        duration_min = max(0.0, elapsed.total_seconds() / 60.0)

    # Average speed based on elapsed time
    elapsed_h     = duration_min / 60.0
    avg_speed_kmh = (distance_km / elapsed_h) if elapsed_h > 0 else 0.0

    # Elevation gain
    ud = gpx.get_uphill_downhill()
    elevation_gain_m = int(ud.uphill or 0)

    return {
        "filepath":         filepath,
        "filename":         filepath.name,
        "start_time":       start_dt,
        "end_time":         end_dt,
        "distance_km":      round(distance_km, 2),
        "duration_min":     round(duration_min, 1),
        "avg_speed_kmh":    round(avg_speed_kmh, 1),
        "elevation_gain_m": elevation_gain_m,
    }


# =============================================================================
# Filtering
# =============================================================================

def apply_filters(
    tracks:       List[dict],
    start_dt:     Optional[datetime],
    end_dt:       Optional[datetime],
    min_distance: Optional[float],
    min_duration: Optional[float],
    min_speed:    Optional[float],
) -> List[dict]:
    """Return the subset of tracks matching ALL provided filters (AND logic).

    Tracks without timestamp data are excluded when any date filter is active.
    """
    result = []
    for t in tracks:
        ts = t["start_time"]
        has_ts = (ts is not NO_TIMESTAMP)

        # Date filters require a timestamp
        if start_dt and (not has_ts or ts < start_dt):
            continue
        if end_dt and (not has_ts or ts > end_dt):
            continue

        if min_distance is not None and t["distance_km"] < min_distance:
            continue
        if min_duration is not None and t["duration_min"] < min_duration:
            continue
        if min_speed is not None and t["avg_speed_kmh"] < min_speed:
            continue

        result.append(t)
    return result


# =============================================================================
# Output helpers
# =============================================================================

def _fmt_dt(dt: datetime) -> str:
    """Format a datetime for display, or '—' for NO_TIMESTAMP sentinel."""
    if dt is NO_TIMESTAMP:
        return "—"
    try:
        return dt.strftime("%Y-%m-%d %H:%M")
    except (ValueError, OSError):
        return "—"


def print_tracks_table(tracks: List[dict]) -> None:
    """Print track metadata as a formatted table."""
    if not tracks:
        print("  (no tracks to display)")
        return

    rows = [
        [
            t["filename"],
            _fmt_dt(t["start_time"]),
            f"{t['distance_km']:.2f}",
            f"{t['duration_min']:.0f}",
            f"{t['avg_speed_kmh']:.1f}",
            t["elevation_gain_m"],
        ]
        for t in tracks
    ]
    headers = [
        "Filename", "Start Date", "Distance (km)",
        "Duration (min)", "Avg Speed (km/h)", "Elev Gain (m)",
    ]
    print(tabulate(rows, headers=headers, tablefmt="rounded_outline"))


def print_mapping_table(mapping: List[dict]) -> None:
    """Print the GPX-file → WordPress-post mapping as a formatted table."""
    if not mapping:
        print("  (no mappings)")
        return

    rows = [
        [
            m["filename"],
            m.get("post_id", "—"),
            m.get("post_title", "—"),
            m.get("post_status", "—"),
        ]
        for m in mapping
    ]
    headers = ["GPX File", "Post ID", "Post Title", "Post Status"]
    print(tabulate(rows, headers=headers, tablefmt="rounded_outline"))


def _section(title: str) -> None:
    """Print a section separator with a title."""
    print(f"\n{SEPARATOR}")
    print(title)
    print(SEPARATOR)


def confirm(prompt: str, auto_yes: bool = False) -> bool:
    """Ask a yes/no question. Returns True only for 'y'/'yes' or auto-yes mode."""
    if auto_yes:
        print(f"\n{prompt} [y/N]: y  (auto)")
        return True
    try:
        ans = input(f"\n{prompt} [y/N]: ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print()
        return False
    return ans in ("y", "yes")


# =============================================================================
# WP-CLI helpers
# =============================================================================

def _run_wp(
    args:    List[str],
    wp_path: str,
    capture: bool = True,
    check:   bool = False,
) -> subprocess.CompletedProcess:
    """Run a wp-cli command with --path appended.

    Uses list-style subprocess invocation (never shell=True) to prevent
    shell-injection through filenames or post content.
    """
    cmd = ["wp"] + args + [f"--path={wp_path}", "--no-color"]
    return subprocess.run(cmd, capture_output=capture, text=True, check=check)


def _parse_json_from_wp_output(stdout: str) -> Optional[object]:
    """Extract the first JSON value (array or object) from wp output.

    WP-CLI or WordPress may emit notices/warnings before our echo output.
    We scan for the first '[' or '{' and parse from there.
    """
    for start_char in ("[", "{"):
        idx = stdout.find(start_char)
        if idx != -1:
            try:
                return json.loads(stdout[idx:])
            except json.JSONDecodeError:
                continue
    return None


def check_wp_available(wp_path: str) -> bool:
    """Return True if `wp` is reachable and the WordPress install responds."""
    result = _run_wp(["core", "is-installed"], wp_path, capture=True, check=False)
    return result.returncode == 0


def check_wp_command_available() -> bool:
    """Return True if `wp` executable exists in PATH."""
    return shutil.which("wp") is not None


def _write_php_tempfile(code: str) -> Path:
    """Write PHP source to a named temp file and return its Path.

    The caller is responsible for deleting the file (use try/finally).
    """
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".php", delete=False, encoding="utf-8"
    ) as fh:
        fh.write(code)
    return Path(fh.name)


# =============================================================================
# Phase 2 — post search
# =============================================================================

def load_searchable_posts(wp_path: str) -> List[dict]:
    """Load all candidate posts once for filename-substring matching in Python.

    This avoids running one SQL LIKE scan per GPX file and scales much better
    for large batches (thousands of files/posts).
    """
    php_code = (
        "<?php\n"
        "global $wpdb;\n"
        "$rows = $wpdb->get_results(\n"
        "    \"SELECT ID, post_title, post_status, post_content\"\n"
        "    . \" FROM {$wpdb->posts}\"\n"
        "    . \" WHERE post_status NOT IN ('trash', 'auto-draft')\"\n"
        "    . \" AND post_type != 'revision'\",\n"
        "    ARRAY_A\n"
        ");\n"
        "echo json_encode( $rows );\n"
    )

    tmp = _write_php_tempfile(php_code)
    try:
        result = _run_wp(["eval-file", str(tmp)], wp_path, capture=True, check=False)
    finally:
        tmp.unlink(missing_ok=True)

    if result.returncode != 0:
        print(
            "Error: failed to load posts for matching.\n"
            f"  stderr: {result.stderr.strip()[:300]}",
            file=sys.stderr,
        )
        return []

    data = _parse_json_from_wp_output(result.stdout)
    if not isinstance(data, list):
        print(
            "Error: unexpected WP output while loading posts for matching.\n"
            f"  stdout: {result.stdout.strip()[:300]}",
            file=sys.stderr,
        )
        return []

    return data


# =============================================================================
# Phase 3 — already-imported detection
# =============================================================================

# Module-level cache so we query the DB once per script run.
_fgpx_track_cache: Optional[Dict[str, int]] = None


def _load_fgpx_track_paths(wp_path: str) -> Dict[str, int]:
    """Fetch all fgpx_track file-path meta values and build {orig_basename → track_id}.

    The CLI import stores files as:
        uploads/flyover-gpx/fgpx_<uid>-<original_name>.gpx

    Web uploads may store the original name directly.  We extract the original
    name by stripping the  fgpx_<uid>-  prefix when present.
    """
    global _fgpx_track_cache
    if _fgpx_track_cache is not None:
        return _fgpx_track_cache

    php_code = (
        "<?php\n"
        "global $wpdb;\n"
        "$rows = $wpdb->get_results(\n"
        "    \"SELECT p.ID, pm.meta_value AS file_path\"\n"
        "    . \" FROM {$wpdb->posts} p\"\n"
        "    . \" JOIN {$wpdb->postmeta} pm ON p.ID = pm.post_id\"\n"
        "    . \" WHERE p.post_type = 'fgpx_track'\"\n"
        "    . \" AND p.post_status != 'trash'\"\n"
        "    . \" AND pm.meta_key = 'fgpx_file_path'\",\n"
        "    ARRAY_A\n"
        ");\n"
        "echo json_encode( $rows );\n"
    )

    _fgpx_track_cache = {}
    tmp = _write_php_tempfile(php_code)
    try:
        result = _run_wp(["eval-file", str(tmp)], wp_path, capture=True, check=False)
    finally:
        tmp.unlink(missing_ok=True)

    if result.returncode != 0:
        print(
            f"  Warning: could not load existing track records: "
            f"{result.stderr.strip()[:200]}",
            file=sys.stderr,
        )
        return _fgpx_track_cache

    data = _parse_json_from_wp_output(result.stdout)
    if not isinstance(data, list):
        return _fgpx_track_cache

    for row in data:
        stored_path = row.get("file_path", "")
        stored_base = os.path.basename(stored_path)
        # Strip "fgpx_<uid>-" prefix to recover original filename
        m = re.match(r"^fgpx_[a-f0-9]+\.[a-f0-9]+-(.+)$", stored_base)
        orig_name = m.group(1) if m else stored_base
        track_id  = int(row["ID"])
        # First match wins (keeps oldest import)
        if orig_name not in _fgpx_track_cache:
            _fgpx_track_cache[orig_name] = track_id

    return _fgpx_track_cache


def find_imported_track(gpx_basename: str, wp_path: str) -> Optional[int]:
    """Return the fgpx_track post ID for gpx_basename, or None if not imported yet."""
    cache = _load_fgpx_track_paths(wp_path)
    return cache.get(gpx_basename)


# =============================================================================
# Phase 3 — import & append
# =============================================================================

def import_gpx(
    filepath:        Path,
    wp_path:         str,
    import_settings: dict,
    dry_run:         bool = False,
) -> Optional[int]:
    """Import a GPX file via `wp fgpx import` and return the new track post ID.

    Returns None on error.  In dry-run mode prints the command and returns 0
    as a placeholder (the real ID is unknown until the import runs).
    """
    cmd_args = ["fgpx", "import", f"--file={filepath.resolve()}"]
    for key, val in import_settings.items():
        if val is not None:
            cmd_args.append(f"--{key}={val}")

    if dry_run:
        cmd_str = "wp " + " ".join(cmd_args) + f" --path={wp_path}"
        print(f"    [DRY-RUN] Would run: {cmd_str}")
        return 0   # placeholder; real ID assigned at runtime

    result = _run_wp(cmd_args, wp_path, capture=True, check=False)
    combined = result.stdout + result.stderr

    # wp fgpx import prints: "Success: Track imported. ID: <int>"
    m = re.search(r"Track imported\.\s+ID:\s+(\d+)", combined)
    if m:
        return int(m.group(1))

    print(
        f"    Error: import failed for {filepath.name}\n"
        f"      stdout: {result.stdout.strip()[:300]}\n"
        f"      stderr: {result.stderr.strip()[:300]}",
        file=sys.stderr,
    )
    return None


def _get_post_content(post_id: int, wp_path: str) -> Optional[str]:
    """Fetch the raw post_content of a WordPress post, or None on error."""
    result = _run_wp(
        ["post", "get", str(post_id), "--field=post_content"],
        wp_path, capture=True, check=False,
    )
    if result.returncode != 0:
        return None
    # Return as-is (do not strip — preserve existing trailing whitespace)
    return result.stdout


def append_to_post(
    post_id:          int,
    shortcode:        str,
    template_content: str,
    wp_path:          str,
    dry_run:          bool = False,
) -> bool:
    """Append the filled template to a WordPress post.

    Returns True on success (or in dry-run mode), False on error.

    Post content is passed to WordPress via a temp file + wp_update_post()
    inside `wp eval-file` to avoid shell-quoting issues and argument-length
    limits.
    """
    filled = template_content.replace("{{fgpx_shortcode}}", shortcode)

    if dry_run:
        print(f"    [DRY-RUN] Would append to post {post_id}:")
        print("    " + "- " * 30)
        for line in filled.splitlines():
            print(f"    {line}")
        print("    " + "- " * 30)
        return True

    # Fetch current content
    current = _get_post_content(post_id, wp_path)
    if current is None:
        print(f"    Error: could not fetch content of post {post_id}.", file=sys.stderr)
        return False

    # Idempotency guard: do not append the same rendered block twice.
    if filled and filled in current:
        print(f"    Skipping append for post {post_id}: rendered block already present.")
        return True

    # Ensure a clean blank line between existing content and template
    separator = "" if current.endswith("\n\n") else "\n\n"
    new_content = current + separator + filled

    # Write new content to a temp file so we can use file_get_contents() in PHP,
    # avoiding any argument-length limits and quoting issues.
    content_tmp: Optional[Path] = None
    php_tmp: Optional[Path] = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".txt", delete=False, encoding="utf-8"
        ) as fh:
            fh.write(new_content)
            content_tmp = Path(fh.name)

        # The content_tmp path comes from NamedTemporaryFile and is safe to
        # embed inside a PHP single-quoted string (only /tmp/tmpXXX.txt chars).
        php_code = (
            "<?php\n"
            f"$new_content = file_get_contents('{content_tmp}');\n"
            f"$result = wp_update_post([\n"
            f"    'ID'           => {post_id},\n"
            f"    'post_content' => $new_content,\n"
            f"]);\n"
            "if ( is_wp_error( $result ) ) {\n"
            "    echo 'WP_ERROR:' . $result->get_error_message();\n"
            "} else {\n"
            "    echo 'OK:' . $result;\n"
            "}\n"
        )

        php_tmp = _write_php_tempfile(php_code)
        result  = _run_wp(
            ["eval-file", str(php_tmp)], wp_path, capture=True, check=False
        )

        output = (result.stdout + "\n" + result.stderr).strip()
        if result.returncode == 0 and re.search(r"\bOK:\d+\b", output):
            return True

        print(
            f"    Error: wp_update_post failed for post {post_id}: {output[:400]}",
            file=sys.stderr,
        )
        return False

    finally:
        if content_tmp and content_tmp.exists():
            content_tmp.unlink()
        if php_tmp and php_tmp.exists():
            php_tmp.unlink()


# =============================================================================
# Date-argument resolution
# =============================================================================

def resolve_date_filters(args: argparse.Namespace) -> Tuple[Optional[datetime], Optional[datetime]]:
    """Expand CLI date/relative-date flags into (start_dt, end_dt) naive UTC datetimes."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    start_dt: Optional[datetime] = None
    end_dt:   Optional[datetime] = None

    relative_days = 0
    if getattr(args, "days",   None): relative_days = args.days
    elif getattr(args, "weeks",  None): relative_days = args.weeks  * 7
    elif getattr(args, "months", None): relative_days = args.months * 30

    if relative_days > 0:
        start_dt = now - timedelta(days=relative_days)
        end_dt   = now
    else:
        if getattr(args, "start", None):
            try:
                start_dt = datetime.strptime(args.start, "%Y-%m-%d")
            except ValueError:
                print(
                    f"Error: --start must be YYYY-MM-DD, got '{args.start}'",
                    file=sys.stderr,
                )
                sys.exit(1)
        if getattr(args, "end", None):
            try:
                end_dt = datetime.strptime(args.end, "%Y-%m-%d").replace(
                    hour=23, minute=59, second=59
                )
            except ValueError:
                print(
                    f"Error: --end must be YYYY-MM-DD, got '{args.end}'",
                    file=sys.stderr,
                )
                sys.exit(1)

    return start_dt, end_dt


def _non_negative_float(value: str) -> float:
    """argparse type validator for non-negative float values."""
    f = float(value)
    if f < 0:
        raise argparse.ArgumentTypeError("value must be >= 0")
    return f


def _positive_int(value: str) -> int:
    """argparse type validator for strictly positive integer values."""
    i = int(value)
    if i <= 0:
        raise argparse.ArgumentTypeError("value must be > 0")
    return i


# =============================================================================
# Argument parser
# =============================================================================


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="gpx_filter_import.py",
        description=(
            "Filter GPX files by date/distance/duration/speed; "
            "match them to WordPress posts; import and append a template."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "EXAMPLES\n"
            "  python3 gpx_filter_import.py\n"
            "  python3 gpx_filter_import.py --days=30 --min-distance=20 --dry-run\n"
            "  python3 gpx_filter_import.py --start=2026-01-01 --end=2026-03-31\n"
            "  python3 gpx_filter_import.py --weeks=4 --min-speed=15 --min-duration=45\n"
        ),
    )

    parser.add_argument(
        "--gpx-dir", metavar="PATH",
        help="Directory containing .gpx files (default: <script_dir>/gpx/)",
    )

    parser.add_argument(
        "--parse-threads", type=_positive_int, metavar="N", default=4,
        help="Number of threads for GPX parsing (default: 4)",
    )
    parser.add_argument(
        "--import-threads", type=_positive_int, metavar="N", default=4,
        help="Number of threads for GPX import/append (default: 4)",
    )

    # --- Date filters -------------------------------------------------------
    date_g = parser.add_argument_group(
        "explicit date range  (ISO 8601 dates, both optional)"
    )
    date_g.add_argument("--start", metavar="DATE",
                        help="Include tracks on or after this date (YYYY-MM-DD)")
    date_g.add_argument("--end",   metavar="DATE",
                        help="Include tracks on or before this date (YYYY-MM-DD)")

    rel_g = parser.add_argument_group(
        "relative date range  (alternative to --start/--end; pick at most one)"
    )
    rel_mx = rel_g.add_mutually_exclusive_group()
    rel_mx.add_argument("--days",   type=_positive_int, metavar="N",
                        help="Tracks from the last N days")
    rel_mx.add_argument("--weeks",  type=_positive_int, metavar="N",
                        help="Tracks from the last N weeks")
    rel_mx.add_argument("--months", type=_positive_int, metavar="N",
                        help="Tracks from the last N months (~30 days each)")

    # --- Track attribute filters --------------------------------------------
    flt_g = parser.add_argument_group("track attribute filters  (all optional, AND-combined)")
    flt_g.add_argument("--min-distance", type=_non_negative_float, metavar="KM",
                       help="Minimum total track distance in km")
    flt_g.add_argument("--min-duration", type=_non_negative_float, metavar="MIN",
                       help="Minimum elapsed duration in minutes (last_pt - first_pt)")
    flt_g.add_argument("--min-speed",    type=_non_negative_float, metavar="KMH",
                       help="Minimum average speed in km/h (distance / elapsed_time)")

    # --- Mode ---------------------------------------------------------------
    parser.add_argument(
        "--dry-run", action="store_true",
        help=(
            "Preview all actions without writing to WordPress. "
            "Read-only WP-CLI calls are still executed for a realistic preview."
        ),
    )

    parser.add_argument(
        "-y", "--yes", action="store_true",
        help="Automatically confirm phase prompts (proceed without manual y/N input).",
    )
    parser.add_argument(
        "--non-interactive", action="store_true",
        help=(
            "Run without interactive prompts. Implies --yes and uses "
            "--already-imported-action for duplicate handling."
        ),
    )
    parser.add_argument(
        "--already-imported-action",
        choices=["skip", "skip-all", "reimport", "quit"],
        help=(
            "Action when GPX is already imported. In non-interactive mode, "
            "defaults to skip-all if omitted."
        ),
    )

    # --- Resume, force, and phase control ---
    parser.add_argument(
        "--force-import", action="store_true",
        help="Force re-import of all GPX files, even if already imported.",
    )
    parser.add_argument(
        "--force-append", action="store_true",
        help="Force append of template to all posts, even if already present.",
    )
    parser.add_argument(
        "--replace-append", action="store_true",
        help="If template is present in post, replace it with a new one (supports dry-run preview).",
    )
    parser.add_argument(
        "--phase", type=int, choices=[1,2,3],
        help="Start from a specific phase (1, 2, or 3). Uses persisted status files if available.",
    )

    return parser


# =============================================================================
# Main
# =============================================================================

def main() -> None:  # noqa: C901  (complexity is inherent in the interactive flow)
    parser = _build_parser()
    args   = parser.parse_args()
    auto_yes = bool(args.yes or args.non_interactive)

    duplicate_action = args.already_imported_action
    if args.non_interactive and duplicate_action is None:
        duplicate_action = "skip-all"

    # ── Resolve paths ────────────────────────────────────────────────────────
    gpx_dir = (
        Path(args.gpx_dir) if args.gpx_dir
        else (Path(GPX_DIR) if GPX_DIR else SCRIPT_DIR / "gpx")
    )
    template_path = Path(TEMPLATE_FILE) if TEMPLATE_FILE else SCRIPT_DIR / "append_template"

    # ── Validate ─────────────────────────────────────────────────────────────
    if not gpx_dir.is_dir():
        print(f"Error: GPX directory not found: {gpx_dir}", file=sys.stderr)
        sys.exit(1)

    if not template_path.is_file():
        print(f"Error: template file not found: {template_path}", file=sys.stderr)
        sys.exit(1)

    template_content = template_path.read_text(encoding="utf-8")
    if "{{fgpx_shortcode}}" not in template_content:
        print(
            f"Error: template '{template_path}' does not contain {{{{fgpx_shortcode}}}}.",
            file=sys.stderr,
        )
        sys.exit(1)

    dry_run = args.dry_run

    if not check_wp_command_available():
        print(
            "Error: `wp` command is not available in PATH.\n"
            "  Install WP-CLI and/or adjust PATH before running.",
            file=sys.stderr,
        )
        sys.exit(1)

    if dry_run:
        print("\n  ╔══════════════════════════════════════════════╗")
        print("  ║  DRY-RUN MODE — no changes will be written  ║")
        print("  ╚══════════════════════════════════════════════╝")
    if args.non_interactive:
        print("\n  Non-interactive mode enabled.")
        print(f"  Already-imported action: {duplicate_action}")



    # -------------------
    # PHASE 1 — Filter GPX files (Parallel Parsing)
    # -------------------
    phase1_resume = args.phase == 1 or (args.phase is None)
    filtered = None
    all_tracks = None
    if os.path.isfile(PHASE1_FILE) and not (args.phase == 1):
        print(f"Found {PHASE1_FILE}. Resume from previous run? [Y/n]: ", end="")
        ans = input().strip().lower() if not auto_yes else "y"
        if ans in ("", "y", "yes"):
            phase1_data = load_json_status(PHASE1_FILE)
            filtered = phase1_data["filtered"]
            all_tracks = phase1_data["all_tracks"]
            print(f"Resumed {len(filtered)} filtered tracks from {PHASE1_FILE}.")
            phase1_resume = False
    if phase1_resume:
        _section("PHASE 1 — Filter GPX files")
        print(f"  GPX directory : {gpx_dir}")
        print(f"  Template file : {template_path}")
        print(f"  WordPress     : {WP_PATH}")
        print(f"  Parse threads : {args.parse_threads}")

        gpx_files = sorted(gpx_dir.glob("*.gpx"))
        if not gpx_files:
            print(f"\nNo .gpx files found in {gpx_dir}. Exiting.")
            sys.exit(0)

        print(f"\nFound {len(gpx_files)} .gpx file(s). Parsing in parallel…\n")

        all_tracks = []
        all_tracks_lock = threading.Lock()
        def parse_and_collect(f):
            meta = parse_gpx_metadata(f)
            if meta is not None:
                with all_tracks_lock:
                    all_tracks.append(meta)
        with ThreadPoolExecutor(max_workers=args.parse_threads) as executor:
            futures = {executor.submit(parse_and_collect, f): f for f in gpx_files}
            for _ in tqdm(as_completed(futures), total=len(futures), desc="Parsing GPX files"):
                pass
        all_tracks.sort(key=lambda t: t["start_time"] if t["start_time"] is not NO_TIMESTAMP else datetime.max)
        start_dt, end_dt = resolve_date_filters(args)
        if start_dt and end_dt and start_dt > end_dt:
            print("Error: --start must be earlier than or equal to --end.", file=sys.stderr)
            sys.exit(1)
        filtered = apply_filters(
            all_tracks,
            start_dt     = start_dt,
            end_dt       = end_dt,
            min_distance = args.min_distance,
            min_duration = args.min_duration,
            min_speed    = args.min_speed,
        )
        active = []
        if start_dt:          active.append(f"start ≥ {start_dt.strftime('%Y-%m-%d')}")
        if end_dt:            active.append(f"end ≤ {end_dt.strftime('%Y-%m-%d')}")
        if args.min_distance: active.append(f"distance ≥ {args.min_distance} km")
        if args.min_duration: active.append(f"duration ≥ {args.min_duration} min")
        if args.min_speed:    active.append(f"avg speed ≥ {args.min_speed} km/h")
        if active:
            print("Active filters: " + "  |  ".join(active))
        else:
            print("No filters applied — showing all tracks (ordered by start date).")
        print()
        print_tracks_table(filtered)
        print(f"\nMatched {len(filtered)} / {len(all_tracks)} tracks.")
        save_json_status(PHASE1_FILE, {"filtered": filtered, "all_tracks": all_tracks})
        print(f"Saved phase 1 results to {PHASE1_FILE}.")
        if not filtered:
            print("No tracks match the current filters. Exiting.")
            sys.exit(0)
        if not confirm("Proceed to Phase 2 — search WordPress posts?", auto_yes=auto_yes):
            print("Aborted.")
            sys.exit(0)



    # -------------------
    # PHASE 2 — Match filtered GPX files to WordPress posts
    # -------------------
    phase2_resume = args.phase == 2 or (args.phase is None)
    mapping = None
    no_match = None
    if os.path.isfile(PHASE2_FILE) and not (args.phase == 2):
        print(f"Found {PHASE2_FILE}. Resume from previous run? [Y/n]: ", end="")
        ans = input().strip().lower() if not auto_yes else "y"
        if ans in ("", "y", "yes"):
            phase2_data = load_json_status(PHASE2_FILE)
            mapping = phase2_data["mapping"]
            no_match = phase2_data["no_match"]
            print(f"Resumed {len(mapping)} mappings from {PHASE2_FILE}.")
            phase2_resume = False
    if phase2_resume:
        _section("PHASE 2 — Match WordPress posts")
        if not dry_run:
            print("  Checking WordPress connection…")
            if not check_wp_available(WP_PATH):
                print(
                    f"\nError: WordPress not accessible at '{WP_PATH}'.\n"
                    "  Check the WP_PATH constant in the CONFIGURATION block.\n"
                    "  Also verify that `wp` (WP-CLI) is in PATH.",
                    file=sys.stderr,
                )
                sys.exit(1)
            print("  Connection OK.\n")
        print("  Loading posts once for in-memory filename matching…")
        searchable_posts = load_searchable_posts(WP_PATH)
        if not searchable_posts:
            print("\nError: no searchable posts loaded. Aborting.", file=sys.stderr)
            sys.exit(1)
        print(f"  Loaded {len(searchable_posts)} candidate post(s).\n")
        mapping = []
        no_match = []
        mapping_lock = threading.Lock()
        no_match_lock = threading.Lock()
        def match_posts(track):
            fname = track["filename"]
            posts = []
            for p in searchable_posts:
                content = p.get("post_content") or ""
                if fname in content:
                    posts.append(p)
            if not posts:
                with no_match_lock:
                    no_match.append({
                        "filename":    fname,
                        "filepath":    track["filepath"],
                        "post_id":     "—",
                        "post_title":  "(no match)",
                        "post_status": "—",
                    })
            else:
                with mapping_lock:
                    for p in posts:
                        mapping.append({
                            "filename":    fname,
                            "filepath":    track["filepath"],
                            "post_id":     int(p["ID"]),
                            "post_title":  p["post_title"],
                            "post_status": p["post_status"],
                        })
        print("  Matching posts in parallel…")
        with ThreadPoolExecutor(max_workers=args.parse_threads) as executor:
            list(tqdm(executor.map(match_posts, filtered), total=len(filtered), desc="Matching posts"))
        print()
        print("Mapping summary:")
        print_mapping_table(mapping + no_match)
        save_json_status(PHASE2_FILE, {"mapping": mapping, "no_match": no_match})
        print(f"Saved phase 2 results to {PHASE2_FILE}.")
        if no_match:
            print(
                f"\n  ⚠  {len(no_match)} GPX file(s) had no matching post "
                "and will be skipped in Phase 3."
            )
        if not mapping:
            print("\nNo GPX files could be matched to any WordPress post. Exiting.")
            sys.exit(0)
        if not confirm("Proceed to Phase 3 — import and append?", auto_yes=auto_yes):
            print("Aborted.")
            sys.exit(0)


    # =========================================================================
    # PHASE 3 — Import GPX files & append template to posts
    # =========================================================================
    _section(
        "PHASE 3 — Import & Append"
        + ("  [DRY-RUN]" if dry_run else "")
    )

    # Pre-load the existing fgpx_track file-path cache (one DB query)
    if not dry_run:
        print("  Loading existing fgpx_track records for duplicate detection…")
        _load_fgpx_track_paths(WP_PATH)
        print()


    skip_all_already_imported = False
    imported_ids_by_filename: Dict[str, int] = {}

    # Group mappings by GPX filename so each GPX is imported at most once,
    # then appended to every matched post.
    mapping_by_filename: Dict[str, List[dict]] = {}
    for entry in mapping:
        mapping_by_filename.setdefault(entry["filename"], []).append(entry)

    stats = {"imported": 0, "skipped": 0, "appended": 0, "errors": 0}
    stats_lock = threading.Lock()


    def import_and_append_worker(gpx_name, entries, interactive=False):
        nonlocal skip_all_already_imported
        first_entry = entries[0]
        gpx_path = first_entry["filepath"]

        # Already-imported check (forced reimport logic)
        force_import = args.force_import
        force_append = args.force_append
        replace_append = args.replace_append
        # Check if already imported
        existing_id: Optional[int] = find_imported_track(gpx_name, WP_PATH) if not dry_run else None
        action = None
        if existing_id is not None and not force_import:
            if skip_all_already_imported:
                with stats_lock:
                    stats["skipped"] += 1
                return
            if duplicate_action is not None:
                action = duplicate_action
            elif interactive:
                print(f"\n  Track '{gpx_name}' is already imported as fgpx_track #{existing_id}.\n"
                      "  What would you like to do?\n"
                      "    [s] Skip this track\n"
                      "    [a] Skip all already-imported tracks\n"
                      "    [r] Re-import anyway (creates a new duplicate fgpx_track)\n"
                      "    [q] Quit the script")
                while True:
                    try:
                        choice = input("  Choice [s/a/r/q]: ").strip().lower()
                    except (EOFError, KeyboardInterrupt):
                        print("\nAborted.")
                        sys.exit(0)
                    if choice in ("s", "a", "r", "q"):
                        break
                    print("  Please enter s, a, r, or q.")
                action_map = {
                    "s": "skip",
                    "a": "skip-all",
                    "r": "reimport",
                    "q": "quit",
                }
                action = action_map[choice]
            else:
                # Non-interactive, no action specified: skip
                with stats_lock:
                    stats["skipped"] += 1
                return

            if action == "quit":
                print("  Quitting.")
                os._exit(0)
            elif action == "skip":
                with stats_lock:
                    stats["skipped"] += 1
                return
            elif action == "skip-all":
                skip_all_already_imported = True
                with stats_lock:
                    stats["skipped"] += 1
                return
            # action == "reimport": fall through to import

        # Import (forced or not)
        if gpx_name in imported_ids_by_filename:
            track_id = imported_ids_by_filename[gpx_name]
        else:
            track_id = import_gpx(gpx_path, WP_PATH, IMPORT_SETTINGS, dry_run=dry_run)
            if track_id is None:
                with stats_lock:
                    stats["errors"] += len(entries)
                return
            imported_ids_by_filename[gpx_name] = track_id

        with stats_lock:
            stats["imported"] += 1

        # Append template (forced/replace logic)
        for entry in entries:
            post_id = entry["post_id"]
            # Fetch current content for replace-append logic
            current_content = _get_post_content(post_id, WP_PATH) if (replace_append or force_append) and not dry_run else None
            filled = template_content.replace("{{fgpx_shortcode}}", f'[flyover_gpx id="{track_id}"]' if not dry_run else '[flyover_gpx id="<NEW_TRACK_ID>"]')
            already_present = filled in current_content if current_content else False
            replaced = False
            if replace_append and current_content:
                if already_present:
                    # Replace the old block with the new one
                    new_content = current_content.replace(filled, filled)
                    replaced = True
                    if dry_run:
                        print(f"[DRY-RUN] Would replace template in post {post_id}.")
                        continue
                    # Actually update post content
                    # (for safety, could add a backup or preview here)
                    # ...existing code for updating post content...
                    ok = append_to_post(post_id, f'[flyover_gpx id="{track_id}"]', template_content, WP_PATH, dry_run=False)
                else:
                    ok = append_to_post(post_id, f'[flyover_gpx id="{track_id}"]', template_content, WP_PATH, dry_run=dry_run)
            elif force_append:
                ok = append_to_post(post_id, f'[flyover_gpx id="{track_id}"]', template_content, WP_PATH, dry_run=dry_run)
            else:
                # Default: only append if not already present
                if already_present:
                    print(f"    Skipping append for post {post_id}: rendered block already present.")
                    ok = True
                else:
                    ok = append_to_post(post_id, f'[flyover_gpx id="{track_id}"]', template_content, WP_PATH, dry_run=dry_run)
            if ok:
                with stats_lock:
                    stats["appended"] += 1
            else:
                with stats_lock:
                    stats["errors"] += 1

    # Separate interactive duplicate-prompt jobs from parallelizable jobs
    interactive_jobs = []
    parallel_jobs = []
    for gpx_name, entries in mapping_by_filename.items():
        existing_id = find_imported_track(gpx_name, WP_PATH) if not dry_run else None
        if existing_id is not None and duplicate_action is None and not args.non_interactive:
            interactive_jobs.append((gpx_name, entries))
        else:
            parallel_jobs.append((gpx_name, entries))

    print(f"\n  Import threads : {args.import_threads}\n")

    # Run parallelizable jobs with progress bar
    with ThreadPoolExecutor(max_workers=args.import_threads) as executor:
        futures = [executor.submit(import_and_append_worker, g, e, False) for g, e in parallel_jobs]
        for _ in tqdm(as_completed(futures), total=len(futures), desc="Importing/Appending"):
            pass

    # Run interactive jobs sequentially with progress bar
    for g, e in tqdm(interactive_jobs, desc="Interactive duplicates"):
        import_and_append_worker(g, e, True)

    # ── Final summary ─────────────────────────────────────────────────────────
    _section("SUMMARY")
    print(f"  Imported  (new fgpx_track posts) : {stats['imported']}")
    print(f"  Skipped   (already imported)      : {stats['skipped']}")
    print(f"  Appended  (posts updated)         : {stats['appended']}")
    print(f"  Errors                            : {stats['errors']}")

    if dry_run:
        print("\n  *** DRY-RUN complete — no changes were written to WordPress. ***")
    print()


if __name__ == "__main__":
    main()
