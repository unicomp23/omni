#!/usr/bin/env python3
"""
Analyze Bixby-Master latency data from SumoLogic chunks.

This script processes JSON log files containing RegisterStream and NotifyStream
latency measurements from Bixby (client perspective). The logged latencyMs
represents round-trip time (request sent → response received).

NOTE: To calculate true one-way latency (Bixby sent → Master received),
we would need Master server logs with receiveTimeMs to correlate with Bixby sendTimeMs.
Without Master logs, this reports the round-trip latency as measured by Bixby.

Output includes:
- Per-hour metrics: min, max, median, p99, p99.9, p99.99
- Overall metrics for the entire period
"""

import json
import sys
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict
import re

def extract_latency_from_raw(raw_line):
    """Extract latencyMs value from log line."""
    match = re.search(r'latencyMs=(\d+(?:\.\d+)?)', raw_line)
    if match:
        return float(match.group(1))
    return None

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

def process_json_files(directory):
    """Process all JSON files in directory and organize by hour."""
    data_dir = Path(directory)
    json_files = sorted(data_dir.glob('*.json'))

    if not json_files:
        print(f"Error: No JSON files found in {directory}", file=sys.stderr)
        sys.exit(1)

    # Store latencies by hour: hour_key -> list of latencies
    hourly_latencies = defaultdict(list)
    all_latencies = []

    # Track time range
    min_time = None
    max_time = None

    files_processed = 0
    messages_seen = 0
    latencies_extracted = 0

    for json_file in json_files:
        try:
            with open(json_file, 'r') as f:
                payload = json.load(f)
        except Exception as e:
            print(f"Warning: Skipping {json_file.name}: {e}", file=sys.stderr)
            continue

        files_processed += 1

        messages = payload.get('messages', [])
        for message in messages:
            messages_seen += 1

            message_map = message.get('map', {})
            raw_line = message_map.get('_raw', '')

            # Extract latency
            latency = extract_latency_from_raw(raw_line)
            if latency is None:
                continue

            latencies_extracted += 1
            all_latencies.append(latency)

            # Extract timestamp and organize by hour
            message_time_ms = message_map.get('_messagetime')
            if message_time_ms:
                try:
                    message_time_ms = int(message_time_ms)
                    dt = datetime.fromtimestamp(message_time_ms / 1000.0, tz=timezone.utc)

                    # Track overall time range
                    if min_time is None or dt < min_time:
                        min_time = dt
                    if max_time is None or dt > max_time:
                        max_time = dt

                    # Group by hour
                    hour_key = dt.strftime('%Y-%m-%d %H:00')
                    hourly_latencies[hour_key].append(latency)
                except (ValueError, OSError) as e:
                    print(f"Warning: Invalid timestamp {message_time_ms}: {e}", file=sys.stderr)

    print(f"Processed {files_processed} files, {messages_seen} messages, {latencies_extracted} latencies extracted\n")

    if not all_latencies:
        print("Error: No latencies found in any file", file=sys.stderr)
        sys.exit(1)

    # Sort hours chronologically
    sorted_hours = sorted(hourly_latencies.keys())

    # Build results
    results = {
        'metadata': {
            'files_processed': files_processed,
            'messages_seen': messages_seen,
            'latencies_extracted': latencies_extracted,
            'start_time': min_time.isoformat() if min_time else None,
            'end_time': max_time.isoformat() if max_time else None,
            'measurement_type': 'round-trip',
            'note': 'Round-trip latency from Bixby perspective (request sent → response received). To calculate one-way latency, need Master logs with receiveTimeMs.'
        },
        'hourly': {},
        'overall': None
    }

    # Compute hourly stats
    for hour in sorted_hours:
        latencies = hourly_latencies[hour]
        results['hourly'][hour] = compute_stats(latencies)

    # Compute overall stats
    results['overall'] = compute_stats(all_latencies)

    return results

def print_report(results):
    """Print formatted report."""
    metadata = results['metadata']

    print("=" * 80)
    print("BIXBY-MASTER LATENCY ANALYSIS (ROUND-TRIP)")
    print("=" * 80)
    print(f"Time Period: {metadata['start_time']} to {metadata['end_time']}")
    print(f"Files Processed: {metadata['files_processed']}")
    print(f"Latencies Extracted: {metadata['latencies_extracted']}")
    print(f"Measurement Type: {metadata['measurement_type'].upper()}")
    print(f"Note: {metadata['note']}")
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

    for hour in sorted(results['hourly'].keys()):
        stats = results['hourly'][hour]
        print(f"{hour:<20} {stats['count']:>8,} {stats['min']:>8.2f} {stats['median']:>8.2f} "
              f"{stats['max']:>8.2f} {stats['p99']:>8.2f} {stats['p99_9']:>8.2f} {stats['p99_99']:>8.2f}")

    print("=" * 80)

def main():
    if len(sys.argv) < 2:
        data_dir = Path(__file__).parent / 'latency.study'
    else:
        data_dir = Path(sys.argv[1])

    if not data_dir.exists():
        print(f"Error: Directory {data_dir} does not exist", file=sys.stderr)
        sys.exit(1)

    # Process files
    results = process_json_files(data_dir)

    # Print formatted report
    print_report(results)

    # Also save JSON output
    output_file = Path(__file__).parent / 'latency_analysis_report.json'
    with open(output_file, 'w') as f:
        json.dump(results, f, indent=2)

    print(f"\nDetailed JSON report saved to: {output_file}")

if __name__ == '__main__':
    main()
