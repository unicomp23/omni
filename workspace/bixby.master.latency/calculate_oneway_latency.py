#!/usr/bin/env python3
"""
Calculate true one-way latency by correlating Bixby and Master logs.

This script:
1. Loads Bixby logs (client-side with round-trip latency)
2. Loads Master logs (server-side with receive timestamps)
3. Correlates by latencyId
4. Calculates one-way latency: Master receiveTimeMs - Bixby sendTimeMs
5. Generates per-hour and overall statistics
"""

import json
import sys
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict
import re

def compute_percentile(sorted_values, percentile):
    """Compute percentile from sorted values."""
    if not sorted_values:
        return None
    if percentile <= 0:
        return sorted_values[0]
    if percentile >= 1:
        return sorted_values[-1]

    index = (len(sorted_values) - 1) * percentile
    lower_index = int(index)
    upper_index = min(lower_index + 1, len(sorted_values) - 1)

    if lower_index == upper_index:
        return sorted_values[lower_index]

    lower_weight = upper_index - index
    upper_weight = index - lower_index

    return sorted_values[lower_index] * lower_weight + sorted_values[upper_index] * upper_weight

def compute_stats(latencies):
    """Compute statistics for a list of latencies."""
    if not latencies:
        return None

    sorted_latencies = sorted(latencies)

    return {
        'count': len(latencies),
        'min': round(sorted_latencies[0], 3),
        'max': round(sorted_latencies[-1], 3),
        'median': round(compute_percentile(sorted_latencies, 0.5), 3),
        'p99': round(compute_percentile(sorted_latencies, 0.99), 3),
        'p99_9': round(compute_percentile(sorted_latencies, 0.999), 3),
        'p99_99': round(compute_percentile(sorted_latencies, 0.9999), 3),
    }

def extract_bixby_data(json_file):
    """Extract latencyId, endTimeMs, and latencyMs from Bixby log file (PRODUCTION ONLY)."""
    data = {}

    try:
        with open(json_file, 'r') as f:
            payload = json.load(f)
    except Exception as e:
        print(f"Warning: Skipping {json_file.name}: {e}", file=sys.stderr)
        return data

    messages = payload.get('messages', [])
    for message in messages:
        message_map = message.get('map', {})

        # FILTER: Only production environment
        if message_map.get('env') != 'prod':
            continue

        raw_line = message_map.get('_raw', '')

        # Extract latencyId
        latency_id_match = re.search(r'latencyId=([^\s]+)', raw_line)
        if not latency_id_match:
            continue
        latency_id = latency_id_match.group(1)

        if latency_id == 'no-latency-id':
            continue

        # Extract latencyMs (round-trip)
        latency_ms_match = re.search(r'latencyMs=(\d+(?:\.\d+)?)', raw_line)
        if not latency_ms_match:
            continue
        latency_ms = float(latency_ms_match.group(1))

        # Extract endTimeMs (when response was received)
        end_time_match = re.search(r'endTimeMs=(\d+)', raw_line)
        if not end_time_match:
            continue
        end_time_ms = int(end_time_match.group(1))

        # Calculate send time
        send_time_ms = end_time_ms - latency_ms

        # Extract timestamp for hourly grouping
        message_time_ms = message_map.get('_messagetime')

        data[latency_id] = {
            'sendTimeMs': send_time_ms,
            'endTimeMs': end_time_ms,
            'latencyMs': latency_ms,
            'messageTimeMs': int(message_time_ms) if message_time_ms else None
        }

    return data

def extract_master_data(json_file):
    """Extract latencyId and receiveTimeMs from Master log file (PRODUCTION ONLY)."""
    data = {}

    try:
        with open(json_file, 'r') as f:
            payload = json.load(f)
    except Exception as e:
        print(f"Warning: Skipping {json_file.name}: {e}", file=sys.stderr)
        return data

    messages = payload.get('messages', [])
    for message in messages:
        message_map = message.get('map', {})

        # FILTER: Only production collectors
        collector = message_map.get('_collector', '')
        if '-prod-' not in collector:
            continue

        raw_line = message_map.get('_raw', '')

        # Extract latencyId
        latency_id_match = re.search(r'latencyId=([^\s]+)', raw_line)
        if not latency_id_match:
            continue
        latency_id = latency_id_match.group(1)

        if latency_id == 'no-latency-id':
            continue

        # Extract receiveTimeMs
        receive_time_match = re.search(r'receiveTimeMs=(\d+)', raw_line)
        if not receive_time_match:
            continue
        receive_time_ms = int(receive_time_match.group(1))

        # Extract timestamp for hourly grouping
        message_time_ms = message_map.get('_messagetime')

        data[latency_id] = {
            'receiveTimeMs': receive_time_ms,
            'messageTimeMs': int(message_time_ms) if message_time_ms else None
        }

    return data

def main():
    base_dir = Path(__file__).parent / 'latency.study'
    bixby_dir = base_dir / 'bixby_logs'
    master_dir = base_dir / 'master_logs'

    if not bixby_dir.exists() or not master_dir.exists():
        print("Error: bixby_logs or master_logs directory not found", file=sys.stderr)
        sys.exit(1)

    print("🔍 Loading Bixby logs (client side, PRODUCTION ONLY)...")
    bixby_files = sorted(bixby_dir.glob('chunk_*.json'))
    print(f"   Found {len(bixby_files)} Bixby chunk files")
    print(f"   Filtering for env=prod only")

    bixby_data = {}
    for i, bixby_file in enumerate(bixby_files, 1):
        if i % 100 == 0:
            print(f"   Processing Bixby file {i}/{len(bixby_files)}...")
        file_data = extract_bixby_data(bixby_file)
        bixby_data.update(file_data)

    print(f"✅ Loaded {len(bixby_data):,} Bixby entries with latencyId\n")

    print("🔍 Loading Master logs (server side, PRODUCTION ONLY)...")
    master_files = sorted(master_dir.glob('master_chunk_*.json'))
    print(f"   Found {len(master_files)} Master chunk files")
    print(f"   Filtering for _collector=*-prod-* only")

    master_data = {}
    for i, master_file in enumerate(master_files, 1):
        if i % 100 == 0:
            print(f"   Processing Master file {i}/{len(master_files)}...")
        file_data = extract_master_data(master_file)
        master_data.update(file_data)

    print(f"✅ Loaded {len(master_data):,} Master entries with latencyId\n")

    print("🔗 Correlating Bixby and Master logs by latencyId...")

    # Correlate and calculate one-way latency
    hourly_latencies = defaultdict(list)
    all_latencies = []

    matched = 0
    unmatched_bixby = 0
    negative_latencies = 0
    min_time = None
    max_time = None

    for latency_id, bixby_entry in bixby_data.items():
        if latency_id not in master_data:
            unmatched_bixby += 1
            continue

        master_entry = master_data[latency_id]

        # Calculate one-way latency: Master receive - Bixby send
        one_way_latency = master_entry['receiveTimeMs'] - bixby_entry['sendTimeMs']

        # Skip negative latencies (clock skew issues)
        if one_way_latency < 0:
            negative_latencies += 1
            continue

        matched += 1
        all_latencies.append(one_way_latency)

        # Group by hour using Bixby's message time
        if bixby_entry['messageTimeMs']:
            dt = datetime.fromtimestamp(bixby_entry['messageTimeMs'] / 1000.0, tz=timezone.utc)

            if min_time is None or dt < min_time:
                min_time = dt
            if max_time is None or dt > max_time:
                max_time = dt

            hour_key = dt.strftime('%Y-%m-%d %H:00')
            hourly_latencies[hour_key].append(one_way_latency)

    print(f"✅ Matched {matched:,} entries (valid positive latencies)")
    print(f"⚠️  Filtered negative latencies: {negative_latencies:,} (clock skew)")
    print(f"⚠️  Unmatched Bixby entries: {unmatched_bixby:,}")
    print(f"⚠️  Unmatched Master entries: {len(master_data) - matched:,}\n")

    if not all_latencies:
        print("Error: No matched latencies found", file=sys.stderr)
        sys.exit(1)

    # Build results
    results = {
        'metadata': {
            'bixby_entries': len(bixby_data),
            'master_entries': len(master_data),
            'matched_entries': matched,
            'negative_latencies': negative_latencies,
            'unmatched_bixby': unmatched_bixby,
            'unmatched_master': len(master_data) - matched,
            'start_time': min_time.isoformat() if min_time else None,
            'end_time': max_time.isoformat() if max_time else None,
            'measurement_type': 'one-way',
            'description': 'One-way latency from Bixby send to Master receive, calculated by correlating latencyId (PRODUCTION ONLY: Bixby env=prod, Master _collector=*-prod-*)'
        },
        'hourly': {},
        'overall': None
    }

    # Compute hourly stats
    sorted_hours = sorted(hourly_latencies.keys())
    for hour in sorted_hours:
        latencies = hourly_latencies[hour]
        results['hourly'][hour] = compute_stats(latencies)

    # Compute overall stats
    results['overall'] = compute_stats(all_latencies)

    # Print report
    print("=" * 80)
    print("ONE-WAY LATENCY ANALYSIS (BIXBY → MASTER) - PRODUCTION ONLY")
    print("=" * 80)
    print(f"Time Period: {results['metadata']['start_time']} to {results['metadata']['end_time']}")
    print(f"Matched Entries: {matched:,} (valid positive latencies)")
    print(f"Filtered Negative Latencies: {negative_latencies:,} (clock skew)")
    print(f"Measurement: Bixby send time → Master receive time")
    print(f"Filters: Bixby env=prod, Master _collector=*-prod-*")
    print("=" * 80)
    print()

    # Print overall stats
    print("OVERALL STATISTICS")
    print("-" * 80)
    overall = results['overall']
    print(f"Count:      {overall['count']:>10,}")
    print(f"Min:        {overall['min']:>10.3f} ms")
    print(f"Median:     {overall['median']:>10.3f} ms")
    print(f"Max:        {overall['max']:>10.3f} ms")
    print(f"P99:        {overall['p99']:>10.3f} ms")
    print(f"P99.9:      {overall['p99_9']:>10.3f} ms")
    print(f"P99.99:     {overall['p99_99']:>10.3f} ms")
    print()

    # Print hourly stats
    print("HOURLY STATISTICS")
    print("-" * 80)
    print(f"{'Hour':<20} {'Count':>8} {'Min':>8} {'Median':>8} {'Max':>8} {'P99':>8} {'P99.9':>8} {'P99.99':>8}")
    print("-" * 80)

    for hour in sorted_hours:
        stats = results['hourly'][hour]
        print(f"{hour:<20} {stats['count']:>8,} {stats['min']:>8.2f} {stats['median']:>8.2f} "
              f"{stats['max']:>8.2f} {stats['p99']:>8.2f} {stats['p99_9']:>8.2f} {stats['p99_99']:>8.2f}")

    print("=" * 80)

    # Save JSON output
    output_file = Path(__file__).parent / 'oneway_latency_report.json'
    with open(output_file, 'w') as f:
        json.dump(results, f, indent=2)

    print(f"\n✅ Detailed JSON report saved to: {output_file}")

    # Also save text output
    text_output = Path(__file__).parent / 'oneway_latency_report.txt'
    with open(text_output, 'w') as f:
        f.write("=" * 80 + "\n")
        f.write("ONE-WAY LATENCY ANALYSIS (BIXBY → MASTER) - PRODUCTION ONLY\n")
        f.write("=" * 80 + "\n")
        f.write(f"Time Period: {results['metadata']['start_time']} to {results['metadata']['end_time']}\n")
        f.write(f"Matched Entries: {matched:,} (valid positive latencies)\n")
        f.write(f"Filtered Negative Latencies: {negative_latencies:,} (clock skew)\n")
        f.write(f"Measurement: Bixby send time → Master receive time\n")
        f.write(f"Filters: Bixby env=prod, Master _collector=*-prod-*\n")
        f.write("=" * 80 + "\n\n")

        f.write("OVERALL STATISTICS\n")
        f.write("-" * 80 + "\n")
        f.write(f"Count:      {overall['count']:>10,}\n")
        f.write(f"Min:        {overall['min']:>10.3f} ms\n")
        f.write(f"Median:     {overall['median']:>10.3f} ms\n")
        f.write(f"Max:        {overall['max']:>10.3f} ms\n")
        f.write(f"P99:        {overall['p99']:>10.3f} ms\n")
        f.write(f"P99.9:      {overall['p99_9']:>10.3f} ms\n")
        f.write(f"P99.99:     {overall['p99_99']:>10.3f} ms\n\n")

        f.write("HOURLY STATISTICS\n")
        f.write("-" * 80 + "\n")
        f.write(f"{'Hour':<20} {'Count':>8} {'Min':>8} {'Median':>8} {'Max':>8} {'P99':>8} {'P99.9':>8} {'P99.99':>8}\n")
        f.write("-" * 80 + "\n")

        for hour in sorted_hours:
            stats = results['hourly'][hour]
            f.write(f"{hour:<20} {stats['count']:>8,} {stats['min']:>8.2f} {stats['median']:>8.2f} "
                   f"{stats['max']:>8.2f} {stats['p99']:>8.2f} {stats['p99_9']:>8.2f} {stats['p99_99']:>8.2f}\n")

        f.write("=" * 80 + "\n")

    print(f"✅ Text report saved to: {text_output}")

if __name__ == '__main__':
    main()
