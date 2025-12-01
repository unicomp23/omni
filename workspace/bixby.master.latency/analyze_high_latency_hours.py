#!/usr/bin/env python3
"""
Analyze detailed statistics for hours with >600ms latency events.
"""

import json
from datetime import datetime

def main():
    # Load the hourly data
    with open('oneway_latency_report.json', 'r') as f:
        data = json.load(f)

    hourly_stats = data['hourly']

    # Find hours with >600ms events
    high_latency_hours = []

    for hour_str, stats in hourly_stats.items():
        if stats['max'] > 600:
            # Parse the hour string (format: "2025-09-08 17:00")
            dt = datetime.fromisoformat(hour_str.replace(' ', 'T') + ':00+00:00')

            high_latency_hours.append({
                'date': dt.strftime('%Y-%m-%d'),
                'start_time': dt.strftime('%H:%M:%S'),
                'end_time': dt.strftime('%H:59:59'),
                'count': stats['count'],
                'median': stats['median'],
                'max': stats['max'],
                'p99': stats['p99'],
                'p99_9': stats['p99_9'],
                'p99_99': stats['p99_99'],
                'datetime': dt
            })

    # Sort by date
    high_latency_hours.sort(key=lambda x: x['datetime'])

    print("="*100)
    print("HOURS WITH >600ms LATENCY EVENTS - DETAILED STATISTICS")
    print("="*100)
    print(f"\nFound {len(high_latency_hours)} hours with max latency >600ms\n")

    # Print as table
    header = f"{'Date':<12} {'Start (UTC)':<12} {'End (UTC)':<12} {'Count':>8} {'Median':>8} {'P99':>8} {'P99.9':>8} {'P99.99':>10} {'Max':>10}"
    print(header)
    print("-" * 100)

    for h in high_latency_hours:
        print(f"{h['date']:<12} {h['start_time']:<12} {h['end_time']:<12} "
              f"{h['count']:>8} {h['median']:>7.0f}ms {h['p99']:>7.0f}ms "
              f"{h['p99_9']:>7.0f}ms {h['p99_99']:>9.0f}ms {h['max']:>9.0f}ms")

    # Generate Confluence table format
    print("\n" + "="*100)
    print("CONFLUENCE TABLE FORMAT (copy/paste ready)")
    print("="*100)
    print()

    print("|| Date || Start Time (UTC) || End Time (UTC) || Total Requests || Median || P99 || P99.9 || P99.99 || Max ||")
    for h in high_latency_hours:
        print(f"| {h['date']} | {h['start_time']} | {h['end_time']} | "
              f"{h['count']:,} | {h['median']:.0f}ms | {h['p99']:.0f}ms | "
              f"{h['p99_9']:.0f}ms | {h['p99_99']:.0f}ms | {h['max']:.0f}ms |")

    # Generate HTML table format
    print("\n" + "="*100)
    print("HTML TABLE FORMAT (for Confluence API)")
    print("="*100)
    print()

    print("<table>")
    print("<tbody>")
    print("<tr>")
    print("<th>Date</th>")
    print("<th>Start Time (UTC)</th>")
    print("<th>End Time (UTC)</th>")
    print("<th>Total Requests</th>")
    print("<th>Median</th>")
    print("<th>P99</th>")
    print("<th>P99.9</th>")
    print("<th>P99.99</th>")
    print("<th>Max</th>")
    print("</tr>")

    for h in high_latency_hours:
        print(f"<tr>")
        print(f"<td>{h['date']}</td>")
        print(f"<td>{h['start_time']}</td>")
        print(f"<td>{h['end_time']}</td>")
        print(f"<td>{h['count']:,}</td>")
        print(f"<td>{h['median']:.0f}ms</td>")
        print(f"<td>{h['p99']:.0f}ms</td>")
        print(f"<td>{h['p99_9']:.0f}ms</td>")
        print(f"<td>{h['p99_99']:.0f}ms</td>")
        print(f"<td>{h['max']:.0f}ms</td>")
        print(f"</tr>")

    print("</tbody>")
    print("</table>")

    # Summary statistics
    print("\n" + "="*100)
    print("SUMMARY STATISTICS FOR HIGH LATENCY HOURS")
    print("="*100)

    total_requests = sum(h['count'] for h in high_latency_hours)
    avg_median = sum(h['median'] for h in high_latency_hours) / len(high_latency_hours)
    avg_p99 = sum(h['p99'] for h in high_latency_hours) / len(high_latency_hours)
    worst_max = max(h['max'] for h in high_latency_hours)
    worst_hour = max(high_latency_hours, key=lambda x: x['max'])

    print(f"\nTotal requests in high-latency hours: {total_requests:,}")
    print(f"Average median latency: {avg_median:.1f}ms")
    print(f"Average P99 latency: {avg_p99:.1f}ms")
    print(f"Worst max latency: {worst_max:.0f}ms")
    print(f"Worst hour: {worst_hour['date']} {worst_hour['start_time']}")

if __name__ == '__main__':
    main()
