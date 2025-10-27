#!/usr/bin/env python3
"""
Detect gaps in downloaded SumoLogic chunk data.

Analyzes chunk files to identify:
1. Missing time intervals (expected chunks that don't exist)
2. Timestamp discontinuities between chunks
3. Large gaps within individual chunks
4. Discrepancies between requested and actual time ranges
5. Anomalously low message counts
"""

import json
import sys
from pathlib import Path
from datetime import datetime, timedelta, timezone
from collections import defaultdict
import re

class GapDetector:
    def __init__(self, data_dir, chunk_minutes=15):
        self.data_dir = Path(data_dir)
        self.chunk_minutes = chunk_minutes
        self.chunks = []
        self.issues = []

    def load_chunks(self):
        """Load all chunk files and extract metadata."""
        json_files = sorted(self.data_dir.glob('*chunk_*.json'))

        if not json_files:
            print(f"Error: No chunk files found in {self.data_dir}", file=sys.stderr)
            sys.exit(1)

        print(f"Loading {len(json_files)} chunk files from {self.data_dir}...")

        for json_file in json_files:
            try:
                with open(json_file, 'r') as f:
                    data = json.load(f)

                metadata = data.get('metadata', {})
                messages = data.get('messages', [])

                # Extract timestamps from messages
                timestamps = []
                for msg in messages:
                    msg_time = msg.get('map', {}).get('_messagetime')
                    if msg_time:
                        try:
                            timestamps.append(int(msg_time))
                        except (ValueError, TypeError):
                            pass

                timestamps.sort()

                chunk_info = {
                    'filename': json_file.name,
                    'filepath': json_file,
                    'requested_from': metadata.get('requestedRange', {}).get('from'),
                    'requested_to': metadata.get('requestedRange', {}).get('to'),
                    'actual_from': metadata.get('actualRange', {}).get('from'),
                    'actual_to': metadata.get('actualRange', {}).get('to'),
                    'message_count': len(messages),
                    'timestamps': timestamps,
                    'chunk_index': metadata.get('chunkIndex'),
                }

                self.chunks.append(chunk_info)

            except Exception as e:
                print(f"Warning: Error loading {json_file.name}: {e}", file=sys.stderr)

        # Sort by requested start time
        self.chunks.sort(key=lambda c: c['requested_from'] or '')
        print(f"Loaded {len(self.chunks)} chunks successfully\n")

    def check_missing_intervals(self):
        """Check for missing expected time intervals."""
        print("=" * 80)
        print("1. CHECKING FOR MISSING TIME INTERVALS")
        print("=" * 80)

        if not self.chunks:
            return

        # Determine expected date range
        first_chunk = self.chunks[0]
        last_chunk = self.chunks[-1]

        if not first_chunk['requested_from'] or not last_chunk['requested_to']:
            print("Warning: Cannot determine expected range (missing requested times)\n")
            return

        start_dt = datetime.fromisoformat(first_chunk['requested_from'].replace('Z', '+00:00'))
        end_dt = datetime.fromisoformat(last_chunk['requested_to'].replace('Z', '+00:00'))

        print(f"Expected range: {start_dt.isoformat()} to {end_dt.isoformat()}")
        print(f"Expected interval: {self.chunk_minutes} minutes")

        # Calculate expected number of chunks
        total_minutes = (end_dt - start_dt).total_seconds() / 60
        expected_chunks = int(total_minutes / self.chunk_minutes)

        print(f"Expected chunks: {expected_chunks}")
        print(f"Actual chunks: {len(self.chunks)}")

        if len(self.chunks) < expected_chunks:
            missing = expected_chunks - len(self.chunks)
            print(f"⚠️  WARNING: Missing {missing} chunk(s)!\n")
            self.issues.append({
                'type': 'missing_chunks',
                'severity': 'high',
                'expected': expected_chunks,
                'actual': len(self.chunks),
                'missing': missing
            })
        else:
            print("✅ All expected chunks are present\n")

        # Check for gaps in the sequence
        print("Checking for gaps in chunk sequence...")
        current_dt = start_dt
        chunk_index = 0
        gaps_found = []

        def normalize_timestamp(ts_str):
            """Normalize timestamp string by removing milliseconds for comparison."""
            if not ts_str:
                return None
            return ts_str.replace('.000Z', 'Z').replace('+00:00', 'Z')

        while current_dt < end_dt and chunk_index < len(self.chunks):
            expected_start = current_dt.isoformat().replace('+00:00', 'Z')
            expected_end = (current_dt + timedelta(minutes=self.chunk_minutes)).isoformat().replace('+00:00', 'Z')

            if chunk_index < len(self.chunks):
                chunk = self.chunks[chunk_index]

                # Check if this chunk matches expected time (normalize for comparison)
                if normalize_timestamp(chunk['requested_from']) != normalize_timestamp(expected_start):
                    gap_info = {
                        'expected_start': expected_start,
                        'expected_end': expected_end,
                        'found': chunk['requested_from'] if chunk_index < len(self.chunks) else None
                    }
                    gaps_found.append(gap_info)
                    print(f"⚠️  GAP: Expected chunk starting at {expected_start}, found {chunk['requested_from']}")

                    # Don't advance chunk_index, this might be the next expected chunk
                    current_dt += timedelta(minutes=self.chunk_minutes)
                    continue

            current_dt += timedelta(minutes=self.chunk_minutes)
            chunk_index += 1

        if gaps_found:
            print(f"\n⚠️  Found {len(gaps_found)} gap(s) in chunk sequence")
            self.issues.append({
                'type': 'sequence_gaps',
                'severity': 'high',
                'gaps': gaps_found
            })
        else:
            print("✅ No gaps in chunk sequence")

        print()

    def check_timestamp_continuity(self):
        """Check for discontinuities between adjacent chunks."""
        print("=" * 80)
        print("2. CHECKING TIMESTAMP CONTINUITY BETWEEN CHUNKS")
        print("=" * 80)

        discontinuities = []

        for i in range(len(self.chunks) - 1):
            curr_chunk = self.chunks[i]
            next_chunk = self.chunks[i + 1]

            # Skip if no actual data
            if not curr_chunk['timestamps'] or not next_chunk['timestamps']:
                continue

            # Get last timestamp of current chunk and first of next
            curr_last_ts = curr_chunk['timestamps'][-1]
            next_first_ts = next_chunk['timestamps'][0]

            # Convert to datetime
            curr_last_dt = datetime.fromtimestamp(curr_last_ts / 1000, tz=timezone.utc)
            next_first_dt = datetime.fromtimestamp(next_first_ts / 1000, tz=timezone.utc)

            # Calculate gap
            gap = (next_first_dt - curr_last_dt).total_seconds()

            # Flag if gap is more than 2x the chunk size (indicating missing data)
            expected_gap = self.chunk_minutes * 60
            if gap > expected_gap * 2:
                gap_info = {
                    'chunk1': curr_chunk['filename'],
                    'chunk2': next_chunk['filename'],
                    'last_timestamp_chunk1': curr_last_dt.isoformat(),
                    'first_timestamp_chunk2': next_first_dt.isoformat(),
                    'gap_seconds': gap,
                    'gap_minutes': gap / 60
                }
                discontinuities.append(gap_info)
                print(f"⚠️  DISCONTINUITY between {curr_chunk['filename']} and {next_chunk['filename']}")
                print(f"    Last timestamp in chunk 1: {curr_last_dt.isoformat()}")
                print(f"    First timestamp in chunk 2: {next_first_dt.isoformat()}")
                print(f"    Gap: {gap / 60:.2f} minutes")

        if discontinuities:
            print(f"\n⚠️  Found {len(discontinuities)} discontinuity/ies")
            self.issues.append({
                'type': 'timestamp_discontinuities',
                'severity': 'medium',
                'discontinuities': discontinuities
            })
        else:
            print("✅ No significant discontinuities found")

        print()

    def check_within_chunk_gaps(self, max_gap_minutes=5):
        """Check for large gaps within individual chunks."""
        print("=" * 80)
        print(f"3. CHECKING FOR GAPS WITHIN CHUNKS (>{max_gap_minutes} min)")
        print("=" * 80)

        chunks_with_gaps = []

        for chunk in self.chunks:
            if len(chunk['timestamps']) < 2:
                continue

            gaps_in_chunk = []
            for i in range(len(chunk['timestamps']) - 1):
                ts1 = chunk['timestamps'][i]
                ts2 = chunk['timestamps'][i + 1]

                dt1 = datetime.fromtimestamp(ts1 / 1000, tz=timezone.utc)
                dt2 = datetime.fromtimestamp(ts2 / 1000, tz=timezone.utc)

                gap = (dt2 - dt1).total_seconds()

                if gap > max_gap_minutes * 60:
                    gaps_in_chunk.append({
                        'from': dt1.isoformat(),
                        'to': dt2.isoformat(),
                        'gap_seconds': gap,
                        'gap_minutes': gap / 60
                    })

            if gaps_in_chunk:
                chunks_with_gaps.append({
                    'filename': chunk['filename'],
                    'gaps': gaps_in_chunk
                })
                print(f"⚠️  {chunk['filename']}: {len(gaps_in_chunk)} internal gap(s)")
                for gap in gaps_in_chunk[:3]:  # Show first 3
                    print(f"    {gap['from']} → {gap['to']} ({gap['gap_minutes']:.2f} min)")
                if len(gaps_in_chunk) > 3:
                    print(f"    ... and {len(gaps_in_chunk) - 3} more")

        if chunks_with_gaps:
            print(f"\n⚠️  {len(chunks_with_gaps)} chunk(s) have internal gaps")
            self.issues.append({
                'type': 'internal_gaps',
                'severity': 'low',
                'chunks_affected': len(chunks_with_gaps),
                'details': chunks_with_gaps
            })
        else:
            print(f"✅ No significant internal gaps found")

        print()

    def check_requested_vs_actual(self):
        """Check for discrepancies between requested and actual time ranges."""
        print("=" * 80)
        print("4. CHECKING REQUESTED VS ACTUAL TIME RANGES")
        print("=" * 80)

        discrepancies = []

        for chunk in self.chunks:
            if not chunk['actual_from'] or not chunk['actual_to']:
                if chunk['message_count'] == 0:
                    continue  # Expected for empty chunks
                else:
                    discrepancies.append({
                        'filename': chunk['filename'],
                        'issue': 'has messages but no actual time range',
                        'message_count': chunk['message_count']
                    })
                    continue

            req_from = datetime.fromisoformat(chunk['requested_from'].replace('Z', '+00:00'))
            req_to = datetime.fromisoformat(chunk['requested_to'].replace('Z', '+00:00'))
            act_from = datetime.fromisoformat(chunk['actual_from'].replace('Z', '+00:00'))
            act_to = datetime.fromisoformat(chunk['actual_to'].replace('Z', '+00:00'))

            # Check if actual range is significantly smaller than requested
            req_duration = (req_to - req_from).total_seconds()
            act_duration = (act_to - act_from).total_seconds()

            # Flag if actual duration is less than 50% of requested
            if act_duration < req_duration * 0.5 and chunk['message_count'] > 10:
                coverage = (act_duration / req_duration) * 100
                discrepancies.append({
                    'filename': chunk['filename'],
                    'requested_from': chunk['requested_from'],
                    'requested_to': chunk['requested_to'],
                    'actual_from': chunk['actual_from'],
                    'actual_to': chunk['actual_to'],
                    'coverage_percent': coverage,
                    'message_count': chunk['message_count']
                })
                print(f"⚠️  {chunk['filename']}: actual range only covers {coverage:.1f}% of requested")

        if discrepancies:
            print(f"\n⚠️  {len(discrepancies)} chunk(s) have range discrepancies")
            self.issues.append({
                'type': 'range_discrepancies',
                'severity': 'medium',
                'discrepancies': discrepancies
            })
        else:
            print("✅ All chunks have appropriate coverage")

        print()

    def check_message_count_anomalies(self):
        """Identify chunks with anomalously low message counts."""
        print("=" * 80)
        print("5. CHECKING FOR MESSAGE COUNT ANOMALIES")
        print("=" * 80)

        # Calculate median message count (excluding zeros)
        non_zero_counts = [c['message_count'] for c in self.chunks if c['message_count'] > 0]

        if not non_zero_counts:
            print("No messages found in any chunks")
            return

        non_zero_counts.sort()
        median_count = non_zero_counts[len(non_zero_counts) // 2]

        print(f"Median message count (non-zero chunks): {median_count}")

        # Flag chunks with counts < 10% of median
        threshold = max(median_count * 0.1, 1)
        low_count_chunks = []
        zero_count_chunks = []

        for chunk in self.chunks:
            if chunk['message_count'] == 0:
                zero_count_chunks.append(chunk['filename'])
            elif chunk['message_count'] < threshold:
                low_count_chunks.append({
                    'filename': chunk['filename'],
                    'message_count': chunk['message_count'],
                    'expected': median_count,
                    'percent_of_median': (chunk['message_count'] / median_count) * 100
                })

        if zero_count_chunks:
            print(f"\n⚠️  {len(zero_count_chunks)} chunk(s) have ZERO messages:")
            for filename in zero_count_chunks[:10]:
                print(f"    {filename}")
            if len(zero_count_chunks) > 10:
                print(f"    ... and {len(zero_count_chunks) - 10} more")

            self.issues.append({
                'type': 'zero_messages',
                'severity': 'medium',
                'count': len(zero_count_chunks),
                'files': zero_count_chunks
            })

        if low_count_chunks:
            print(f"\n⚠️  {len(low_count_chunks)} chunk(s) have LOW message counts (<{threshold:.0f}):")
            for item in low_count_chunks[:10]:
                print(f"    {item['filename']}: {item['message_count']} messages ({item['percent_of_median']:.1f}% of median)")
            if len(low_count_chunks) > 10:
                print(f"    ... and {len(low_count_chunks) - 10} more")

            self.issues.append({
                'type': 'low_message_count',
                'severity': 'low',
                'count': len(low_count_chunks),
                'details': low_count_chunks
            })

        if not zero_count_chunks and not low_count_chunks:
            print("✅ All chunks have reasonable message counts")

        print()

    def generate_summary(self):
        """Generate overall summary."""
        print("=" * 80)
        print("SUMMARY")
        print("=" * 80)

        if not self.issues:
            print("✅ NO ISSUES FOUND - Data appears complete and continuous")
        else:
            print(f"⚠️  FOUND {len(self.issues)} ISSUE TYPE(S):\n")

            high_severity = [i for i in self.issues if i.get('severity') == 'high']
            medium_severity = [i for i in self.issues if i.get('severity') == 'medium']
            low_severity = [i for i in self.issues if i.get('severity') == 'low']

            if high_severity:
                print("HIGH SEVERITY:")
                for issue in high_severity:
                    print(f"  - {issue['type']}")
                print()

            if medium_severity:
                print("MEDIUM SEVERITY:")
                for issue in medium_severity:
                    print(f"  - {issue['type']}")
                print()

            if low_severity:
                print("LOW SEVERITY:")
                for issue in low_severity:
                    print(f"  - {issue['type']}")
                print()

        # Save detailed report
        report_file = self.data_dir.parent / f'gap_analysis_{self.data_dir.name}.json'
        report_data = {
            'directory': str(self.data_dir),
            'chunks_analyzed': len(self.chunks),
            'issues_found': len(self.issues),
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'issues': self.issues
        }

        with open(report_file, 'w') as f:
            json.dump(report_data, f, indent=2)

        print(f"📄 Detailed report saved to: {report_file}")
        print("=" * 80)

def main():
    if len(sys.argv) < 2:
        print("Usage: python detect_gaps.py <directory>")
        print("\nExamples:")
        print("  python detect_gaps.py latency.study/bixby_logs")
        print("  python detect_gaps.py latency.study/master_logs")
        sys.exit(1)

    data_dir = sys.argv[1]

    detector = GapDetector(data_dir)
    detector.load_chunks()
    detector.check_missing_intervals()
    detector.check_timestamp_continuity()
    detector.check_within_chunk_gaps()
    detector.check_requested_vs_actual()
    detector.check_message_count_anomalies()
    detector.generate_summary()

if __name__ == '__main__':
    main()
