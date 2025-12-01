#!/usr/bin/env python3
"""
Analyze AWS/MSK latency data and generate Confluence-formatted report.
"""

import json
from datetime import datetime
from collections import defaultdict

def main():
    # Load data
    with open('/tmp/msk_data_points.json', 'r') as f:
        data_points = json.loads(f.read())

    print(f"Analyzing {len(data_points)} minute-level data points...")

    # Group by hour and find high-latency minutes
    hourly_data = defaultdict(lambda: {
        'minutes': [],
        'high_latency_count': 0,
        'total_minutes': 0
    })

    # Parse time period
    first_time = datetime.strptime(data_points[0]['timeLabel'], '%Y-%m-%d_%H:%M')
    last_time = datetime.strptime(data_points[-1]['timeLabel'], '%Y-%m-%d_%H:%M')

    print(f"Time period: {first_time} to {last_time}")
    print(f"Duration: {(last_time - first_time).days} days\n")

    # Group by hour
    for point in data_points:
        time_str = point['timeLabel']
        dt = datetime.strptime(time_str, '%Y-%m-%d_%H:%M')
        hour_key = dt.strftime('%Y-%m-%d %H:00')

        hourly_data[hour_key]['minutes'].append(point)
        hourly_data[hour_key]['total_minutes'] += 1

        # Check if this minute had >600ms latency
        if point.get('max', 0) > 600 or point.get('p99_999', 0) > 600:
            hourly_data[hour_key]['high_latency_count'] += 1

    # Filter hours with high latency
    high_latency_hours = []
    for hour_str, data in sorted(hourly_data.items()):
        if data['high_latency_count'] > 0:
            dt = datetime.strptime(hour_str, '%Y-%m-%d %H:%M')

            # Calculate hour statistics
            all_maxes = [m['max'] for m in data['minutes']]
            all_p99_999 = [m['p99_999'] for m in data['minutes']]
            all_p99_99 = [m['p99_99'] for m in data['minutes']]
            all_p99_9 = [m['p99_9'] for m in data['minutes']]

            high_latency_hours.append({
                'date': dt.strftime('%Y-%m-%d'),
                'start_time': dt.strftime('%H:00:00'),
                'end_time': dt.strftime('%H:59:59'),
                'count_minutes': data['high_latency_count'],
                'total_minutes': data['total_minutes'],
                'percentage': (data['high_latency_count'] / data['total_minutes']) * 100,
                'max': max(all_maxes),
                'max_p99_999': max(all_p99_999),
                'max_p99_99': max(all_p99_99),
                'max_p99_9': max(all_p99_9),
                'datetime': dt
            })

    print(f"Found {len(high_latency_hours)} hours with >600ms latency\n")

    # Summary statistics
    total_minutes = len(data_points)
    high_latency_minutes = sum(h['count_minutes'] for h in high_latency_hours)
    total_hours = len(hourly_data)
    affected_hours = len(high_latency_hours)

    print("="*80)
    print("AWS/MSK LATENCY ANALYSIS - >600ms Events")
    print("="*80)
    print()
    print("Dataset Overview:")
    print(f"  Analysis Period: {first_time.strftime('%Y-%m-%d %H:%M:%S')} UTC to {last_time.strftime('%Y-%m-%d %H:%M:%S')} UTC")
    print(f"  Total Duration: ~{(last_time - first_time).days} days ({total_hours} one-hour buckets analyzed)")
    print(f"  Data Granularity: Per-minute statistics")
    print(f"  Measurement: Consumer group latency (P99.999 latency)")
    print()
    print(f"High Latency Events (>600ms at P99.999 or Max):")
    print(f"  Total minutes affected: {high_latency_minutes:,} out of {total_minutes:,} ({(high_latency_minutes/total_minutes)*100:.3f}%)")
    print(f"  Hours affected: {affected_hours} out of {total_hours} ({(affected_hours/total_hours)*100:.1f}%)")
    print(f"  Hours without issues: {total_hours - affected_hours} ({((total_hours - affected_hours)/total_hours)*100:.1f}%)")
    print()

    # Generate HTML table
    print("="*80)
    print("HTML TABLE FOR CONFLUENCE")
    print("="*80)
    print()
    print("<table>")
    print("<tbody>")
    print("<tr>")
    print("<th>Date</th>")
    print("<th>Start Time (UTC)</th>")
    print("<th>End Time (UTC)</th>")
    print("<th>Minutes >600ms</th>")
    print("<th>% of Hour</th>")
    print("<th>Max P99.9</th>")
    print("<th>Max P99.99</th>")
    print("<th>Max P99.999</th>")
    print("<th>Max</th>")
    print("</tr>")

    for h in high_latency_hours[:50]:  # Limit to first 50 for readability
        max_p999 = h['max_p99_999']
        max_val = h['max']

        # Bold if really bad
        if max_val > 1000 or max_p999 > 600:
            max_p999_str = f"<strong>{max_p999:.0f}ms</strong>"
            max_str = f"<strong>{max_val:.0f}ms</strong>"
        else:
            max_p999_str = f"{max_p999:.0f}ms"
            max_str = f"{max_val:.0f}ms"

        print(f"<tr>")
        print(f"<td>{h['date']}</td>")
        print(f"<td>{h['start_time']}</td>")
        print(f"<td>{h['end_time']}</td>")
        print(f"<td>{h['count_minutes']}</td>")
        print(f"<td>{h['percentage']:.1f}%</td>")
        print(f"<td>{h['max_p99_9']:.0f}ms</td>")
        print(f"<td>{h['max_p99_99']:.0f}ms</td>")
        print(f"<td>{max_p999_str}</td>")
        print(f"<td>{max_str}</td>")
        print(f"</tr>")

    if len(high_latency_hours) > 50:
        print(f"<!-- ... and {len(high_latency_hours) - 50} more hours -->")

    print("</tbody>")
    print("</table>")

    # Summary statistics table
    worst_hour = max(high_latency_hours, key=lambda x: x['max'])
    print()
    print("="*80)
    print("SUMMARY STATISTICS")
    print("="*80)
    print(f"Total high-latency minutes: {high_latency_minutes:,}")
    print(f"Hours with issues: {affected_hours} out of {total_hours} ({(affected_hours/total_hours)*100:.1f}%)")
    print(f"Worst hour: {worst_hour['date']} {worst_hour['start_time']} (max {worst_hour['max']:.0f}ms)")
    print(f"Worst P99.999: {max(h['max_p99_999'] for h in high_latency_hours):.0f}ms")
    print(f"Overall impact: ~{(high_latency_minutes/total_minutes)*100:.3f}% of all minutes")

if __name__ == '__main__':
    main()
