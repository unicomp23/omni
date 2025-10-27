#!/usr/bin/env python3
"""
Clean up non-production files from Master logs.
Removes files that contain only automation/stage/eng data.
"""

import json
import sys
from pathlib import Path
from collections import Counter

def check_file_environment(filepath):
    """Check if a file contains production data."""
    try:
        with open(filepath, 'r') as f:
            data = json.load(f)

        messages = data.get('messages', [])
        if not messages:
            return 'empty', []

        # Check collectors from first 10 messages
        collectors = []
        for msg in messages[:10]:
            collector = msg.get('map', {}).get('_collector', '')
            if collector:
                collectors.append(collector)

        if not collectors:
            return 'no_collector', []

        # Check if any collectors are production
        has_prod = any('-prod-' in c for c in collectors)
        has_automation = any('automation' in c.lower() for c in collectors)
        has_stage = any('-stage-' in c for c in collectors)
        has_eng = any('-eng-' in c for c in collectors)

        if has_prod:
            return 'production', collectors
        elif has_automation:
            return 'automation', collectors
        elif has_stage:
            return 'stage', collectors
        elif has_eng:
            return 'eng', collectors
        else:
            return 'unknown', collectors

    except Exception as e:
        return 'error', [str(e)]

def cleanup_nonprod(directory, dry_run=True):
    """Remove non-production files from directory."""
    data_dir = Path(directory)

    if not data_dir.exists():
        print(f"Error: {directory} does not exist")
        return

    json_files = sorted(data_dir.glob('master_chunk_*.json'))

    print(f"Scanning {len(json_files)} Master chunk files...")
    print()

    env_counts = Counter()
    to_remove = []

    for i, filepath in enumerate(json_files):
        if (i + 1) % 100 == 0:
            print(f"  Processed {i+1}/{len(json_files)}...", end='\r')

        env, collectors = check_file_environment(filepath)
        env_counts[env] += 1

        # Mark non-production files for removal
        if env in ['automation', 'stage', 'eng']:
            to_remove.append((filepath, env, collectors[0] if collectors else 'none'))

    print(f"  Processed {len(json_files)}/{len(json_files)}... Done!")
    print()

    # Report findings
    print("=" * 80)
    print("ENVIRONMENT BREAKDOWN")
    print("=" * 80)
    for env, count in sorted(env_counts.items()):
        emoji = "✅" if env == "production" else "❌"
        print(f"{emoji} {env}: {count} files")
    print()

    if not to_remove:
        print("✅ No non-production files found!")
        return

    print("=" * 80)
    print(f"NON-PRODUCTION FILES TO REMOVE: {len(to_remove)}")
    print("=" * 80)

    # Show sample
    print("\nSample files to remove:")
    for filepath, env, collector in to_remove[:10]:
        print(f"  {filepath.name} - {env} ({collector})")
    if len(to_remove) > 10:
        print(f"  ... and {len(to_remove) - 10} more")
    print()

    if dry_run:
        print("=" * 80)
        print("DRY RUN MODE - No files removed")
        print("=" * 80)
        print()
        print("To actually remove these files, run:")
        print(f"  {sys.argv[0]} {directory} --remove")
        print()
        print(f"This will free up approximately:")
        total_size = sum(f[0].stat().st_size for f in to_remove)
        print(f"  {total_size / 1024 / 1024:.1f} MB")
    else:
        print("=" * 80)
        print("REMOVING NON-PRODUCTION FILES")
        print("=" * 80)

        removed_count = 0
        total_size = 0

        for filepath, env, collector in to_remove:
            try:
                size = filepath.stat().st_size
                filepath.unlink()
                removed_count += 1
                total_size += size
                if removed_count % 10 == 0:
                    print(f"  Removed {removed_count}/{len(to_remove)}...", end='\r')
            except Exception as e:
                print(f"\n  ❌ Error removing {filepath.name}: {e}")

        print(f"  Removed {removed_count}/{len(to_remove)}... Done!")
        print()
        print(f"✅ Removed {removed_count} non-production files")
        print(f"   Freed {total_size / 1024 / 1024:.1f} MB")
        print()

        # Show new counts
        remaining = list(data_dir.glob('master_chunk_*.json'))
        print(f"📦 Remaining files: {len(remaining)}")

def main():
    if len(sys.argv) < 2:
        print("Usage: python cleanup_nonprod.py <directory> [--remove]")
        print()
        print("Examples:")
        print("  python cleanup_nonprod.py latency.study/master_logs")
        print("  python cleanup_nonprod.py latency.study/master_logs --remove")
        sys.exit(1)

    directory = sys.argv[1]
    dry_run = '--remove' not in sys.argv

    if not dry_run:
        print("⚠️  WARNING: This will permanently delete non-production files!")
        response = input("Are you sure? Type 'yes' to continue: ")
        if response.lower() != 'yes':
            print("Aborted.")
            return
        print()

    cleanup_nonprod(directory, dry_run)

if __name__ == '__main__':
    main()
