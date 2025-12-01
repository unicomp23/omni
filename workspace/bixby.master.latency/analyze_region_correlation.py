#!/usr/bin/env python3
"""
Analyze region correlation for high latency cases.

This script correlates Bixby and Master logs to identify region patterns
in high latency (>600ms) cases.
"""

import json
import sys
from pathlib import Path
import re
from collections import defaultdict

def extract_region(message_map):
    """Extract AWS region from message map."""
    # Try direct region field first
    region = message_map.get('region')
    if region:
        return region

    # Fallback: parse from _sourcehost
    sourcehost = message_map.get('_sourcehost', '')
    # Format: "bixby-i-xxx-us-west-2" or "node-master-i-xxx-us-east-1"
    parts = sourcehost.split('-')
    if len(parts) >= 2:
        # Region is typically last 2-3 parts (us-west-2, us-east-1, etc)
        if parts[-1].isdigit() and len(parts) >= 3:
            return f"{parts[-3]}-{parts[-2]}-{parts[-1]}"
        elif len(parts) >= 2:
            return f"{parts[-2]}-{parts[-1]}"

    return 'unknown'

def extract_bixby_data(json_file):
    """Extract latencyId, sendTimeMs, and region from Bixby log file."""
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

        # Extract endTimeMs
        end_time_match = re.search(r'endTimeMs=(\d+)', raw_line)
        if not end_time_match:
            continue
        end_time_ms = int(end_time_match.group(1))

        # Calculate send time
        send_time_ms = end_time_ms - latency_ms

        # Extract region
        region = extract_region(message_map)

        data[latency_id] = {
            'sendTimeMs': send_time_ms,
            'bixby_region': region
        }

    return data

def extract_master_data(json_file):
    """Extract latencyId, receiveTimeMs, and region from Master log file."""
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

        # Extract region
        region = extract_region(message_map)

        data[latency_id] = {
            'receiveTimeMs': receive_time_ms,
            'master_region': region
        }

    return data

def main():
    print("Loading Bixby logs...")
    bixby_dir = Path("latency.study/bixby_logs")
    bixby_data = {}

    bixby_files = sorted(bixby_dir.glob("chunk_*.json"))
    for i, json_file in enumerate(bixby_files):
        if i % 100 == 0:
            print(f"  Processed {i}/{len(bixby_files)} Bixby files...", file=sys.stderr)
        file_data = extract_bixby_data(json_file)
        bixby_data.update(file_data)

    print(f"Loaded {len(bixby_data)} Bixby entries")

    print("\nLoading Master logs...")
    master_dir = Path("latency.study/master_logs")
    master_data = {}

    master_files = sorted(master_dir.glob("master_chunk_*.json"))
    for i, json_file in enumerate(master_files):
        if i % 100 == 0:
            print(f"  Processed {i}/{len(master_files)} Master files...", file=sys.stderr)
        file_data = extract_master_data(json_file)
        master_data.update(file_data)

    print(f"Loaded {len(master_data)} Master entries")

    print("\nCorrelating and analyzing high latency cases...")

    # Track region patterns for high latency
    region_patterns = defaultdict(lambda: {'count': 0, 'latencies': []})
    all_latencies = []
    high_latency_cases = []

    matched = 0
    negative_latency = 0

    for latency_id, bixby_entry in bixby_data.items():
        if latency_id not in master_data:
            continue

        master_entry = master_data[latency_id]

        # Calculate one-way latency
        send_time = bixby_entry['sendTimeMs']
        receive_time = master_entry['receiveTimeMs']
        one_way_latency = receive_time - send_time

        # Skip negative latencies (clock skew)
        if one_way_latency < 0:
            negative_latency += 1
            continue

        matched += 1
        bixby_region = bixby_entry['bixby_region']
        master_region = master_entry['master_region']

        all_latencies.append(one_way_latency)

        # Track region pattern
        region_key = f"{bixby_region} -> {master_region}"
        region_patterns[region_key]['count'] += 1
        region_patterns[region_key]['latencies'].append(one_way_latency)

        # Track high latency cases (>600ms)
        if one_way_latency > 600:
            high_latency_cases.append({
                'latencyId': latency_id,
                'latency': one_way_latency,
                'bixby_region': bixby_region,
                'master_region': master_region,
                'region_pattern': region_key
            })

    print(f"\nMatched {matched} entries (skipped {negative_latency} with negative latency)")
    print(f"Found {len(high_latency_cases)} cases with latency >600ms")

    # Analyze high latency region patterns
    print("\n" + "="*80)
    print("HIGH LATENCY (>600ms) REGION ANALYSIS")
    print("="*80)

    if high_latency_cases:
        # Count by region pattern
        pattern_counts = defaultdict(int)
        for case in high_latency_cases:
            pattern_counts[case['region_pattern']] += 1

        print(f"\nRegion patterns for {len(high_latency_cases)} high latency cases:")
        print(f"{'Region Pattern':<40} {'Count':>10} {'Percentage':>12}")
        print("-" * 64)

        for pattern, count in sorted(pattern_counts.items(), key=lambda x: x[1], reverse=True):
            percentage = (count / len(high_latency_cases)) * 100
            print(f"{pattern:<40} {count:>10} {percentage:>11.2f}%")

        # Show statistics for each region pattern
        print("\n" + "="*80)
        print("STATISTICS BY REGION PATTERN (ALL LATENCIES)")
        print("="*80)
        print(f"\n{'Region Pattern':<40} {'Total':>10} {'Median':>10} {'P99':>10} {'>600ms':>10}")
        print("-" * 82)

        for pattern, data in sorted(region_patterns.items(), key=lambda x: x[1]['count'], reverse=True):
            if data['count'] < 10:  # Skip patterns with too few samples
                continue

            latencies = sorted(data['latencies'])
            count = data['count']
            median = latencies[len(latencies)//2]
            p99_idx = int(len(latencies) * 0.99)
            p99 = latencies[p99_idx]
            high_count = sum(1 for l in latencies if l > 600)

            print(f"{pattern:<40} {count:>10} {median:>9.1f}ms {p99:>9.1f}ms {high_count:>10}")

        # Show top 20 worst cases
        print("\n" + "="*80)
        print("TOP 20 HIGHEST LATENCY CASES")
        print("="*80)
        print(f"\n{'Latency (ms)':<15} {'Bixby Region':<20} {'Master Region':<20} {'latencyId':<36}")
        print("-" * 93)

        for case in sorted(high_latency_cases, key=lambda x: x['latency'], reverse=True)[:20]:
            print(f"{case['latency']:>13.1f}  {case['bixby_region']:<20} {case['master_region']:<20} {case['latencyId']}")

    # Calculate percentage of high latency cases
    high_latency_percentage = (len(high_latency_cases) / matched) * 100 if matched > 0 else 0
    print(f"\n{'='*80}")
    print(f"SUMMARY")
    print(f"{'='*80}")
    print(f"Total matched requests: {matched:,}")
    print(f"High latency (>600ms) cases: {len(high_latency_cases):,} ({high_latency_percentage:.3f}%)")

    # Overall latency statistics
    if all_latencies:
        sorted_latencies = sorted(all_latencies)
        median = sorted_latencies[len(sorted_latencies)//2]
        p99_idx = int(len(sorted_latencies) * 0.99)
        p99 = sorted_latencies[p99_idx]
        print(f"Overall median latency: {median:.1f}ms")
        print(f"Overall P99 latency: {p99:.1f}ms")

if __name__ == '__main__':
    main()
