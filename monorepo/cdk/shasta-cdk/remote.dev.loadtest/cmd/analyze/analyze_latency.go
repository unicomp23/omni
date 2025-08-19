package main

import (
	"bufio"
	"compress/gzip"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"loadtest/pkg/types"
)

// PartitionLatencyStats holds latency statistics for a single partition
type PartitionLatencyStats struct {
	Partition    int32
	MessageCount int
	MinLatency   float64
	MaxLatency   float64
	AvgLatency   float64
	P50          float64
	P90          float64
	P95          float64
	P99          float64
	P99_9        float64
	P99_99       float64
	P99_999      float64
}

// LatencyAnalysis holds computed statistics
type LatencyAnalysis struct {
	TotalMessages         int
	TimeSpan              time.Duration
	ThroughputMsgSec      float64
	MinLatency            float64
	MaxLatency            float64
	AvgLatency            float64
	P50                   float64
	P90                   float64
	P95                   float64
	P99                   float64
	P99_9                 float64
	P99_99                float64
	P99_999               float64
	ConsumerBreakdown     map[int]int
	PartitionBreakdown    map[int32]int
	PartitionLatencyStats []PartitionLatencyStats
	FiveMinuteBuckets     []FiveMinuteBucket // Only populated when 5min analysis is enabled
}

// FiveMinuteBucket holds latency analysis for a 5-minute time window
type FiveMinuteBucket struct {
	StartTime             time.Time
	EndTime               time.Time
	TotalMessages         int
	PartitionLatencyStats []PartitionLatencyStats
	OverallP99_99         float64 // Overall P99.99 across all partitions in this bucket
}

// TimeBucket represents a 5-minute time bucket for grouping messages
type TimeBucket struct {
	StartTime         time.Time
	EndTime           time.Time
	PartitionMessages map[int32][]types.LatencyLogEntry
}

func main() {
	// Command line flags
	var fiveMinChunks bool
	flag.BoolVar(&fiveMinChunks, "5min", false, "Enable 5-minute bucket analysis for 99.99% availability reporting")
	flag.Parse()
	
	// Default to downloads folder (where S3 download script puts files)
	logDir := "./downloads"
	args := flag.Args()
	if len(args) > 0 {
		logDir = args[0]
	}

	if fiveMinChunks {
		fmt.Printf("🔍 Analyzing latency logs with 5-minute buckets in: %s\n\n", logDir)
	} else {
		fmt.Printf("🔍 Analyzing latency logs in: %s\n\n", logDir)
	}

	// Find all log files
	files, err := findLogFiles(logDir)
	if err != nil {
		fmt.Printf("❌ Failed to find log files: %v\n", err)
		printUsageHelp()
		os.Exit(1)
	}

	if len(files) == 0 {
		fmt.Printf("❌ No log files found in %s\n", logDir)
		printUsageHelp()
		os.Exit(1)
	}

	fmt.Printf("📂 Found %d log files:\n", len(files))
	for _, file := range files {
		fmt.Printf("   • %s\n", filepath.Base(file))
	}
	fmt.Println()

	// Parse and analyze each file individually
	if !fiveMinChunks {
		fmt.Println("📊 INDIVIDUAL FILE ANALYSIS")
		fmt.Println("═══════════════════════════════════")
	}

	totalEntries := 0
	filesProcessed := 0

	for _, filePath := range files {
		if !fiveMinChunks {
			fmt.Printf("\n📖 Analyzing: %s\n", filepath.Base(filePath))
		}

		entries, err := parseLogFile(filePath)
		if err != nil {
			fmt.Printf("❌ Failed to parse %s: %v\n", filePath, err)
			continue
		}

		if len(entries) == 0 {
			if !fiveMinChunks {
				fmt.Printf("   ⚠️  No valid entries found\n")
			}
			continue
		}

		if !fiveMinChunks {
			fmt.Printf("   ✅ Loaded %d entries\n", len(entries))
		}

		// Analyze this file individually
		fileAnalysis := analyzeLatencies(entries, fiveMinChunks)
		
		if fiveMinChunks {
			// Only show 5-minute bucket analysis when -5min flag is used
			if len(fileAnalysis.FiveMinuteBuckets) > 0 {
				fmt.Printf("\n📖 File: %s (%d entries)\n", filepath.Base(filePath), len(entries))
				displayFiveMinuteBucketAnalysis(fileAnalysis.FiveMinuteBuckets)
			}
		} else {
			// Show regular analysis when -5min flag is NOT used
			displayFileResults(filepath.Base(filePath), fileAnalysis)
			// Display per-partition latency analysis for rebalance study
			displayPartitionLatencyStats(fileAnalysis.PartitionLatencyStats)
		}

		// Track totals for summary
		totalEntries += len(entries)
		filesProcessed++

		// Free memory immediately after processing each file
		entries = nil
	}

	if filesProcessed == 0 {
		log.Fatalf("❌ No latency data found in any log files")
	}

	if !fiveMinChunks {
		fmt.Printf("\n📊 Successfully processed %d files with %d total entries\n", filesProcessed, totalEntries)
		fmt.Println("💡 Individual file analysis complete - memory optimized!")
	}
}

func findLogFiles(logDir string) ([]string, error) {
	// Check if directory exists
	if _, err := os.Stat(logDir); os.IsNotExist(err) {
		return nil, fmt.Errorf("directory '%s' does not exist", logDir)
	}

	var files []string

	err := filepath.Walk(logDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if !info.IsDir() {
			name := info.Name()
			if strings.HasPrefix(name, "latency-") &&
				(strings.HasSuffix(name, ".jsonl") || strings.HasSuffix(name, ".jsonl.gz")) {
				files = append(files, path)
			}
		}
		return nil
	})

	// Sort files by name (which includes timestamp, so chronological order)
	sort.Strings(files)

	return files, err
}

func parseLogFile(filePath string) ([]types.LatencyLogEntry, error) {
	var entries []types.LatencyLogEntry

	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var scanner *bufio.Scanner

	// Handle gzipped files
	if strings.HasSuffix(filePath, ".gz") {
		gzReader, err := gzip.NewReader(file)
		if err != nil {
			return nil, err
		}
		defer gzReader.Close()
		scanner = bufio.NewScanner(gzReader)
	} else {
		scanner = bufio.NewScanner(file)
	}

	lineNum := 0
	for scanner.Scan() {
		lineNum++
		line := scanner.Text()

		if strings.TrimSpace(line) == "" {
			continue
		}

		var entry types.LatencyLogEntry
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			// Log parsing errors but continue
			fmt.Printf("   ⚠️  Line %d parse error: %v\n", lineNum, err)
			continue
		}

		entries = append(entries, entry)
	}

	// Check for scanner errors, but be resilient to EOF and other I/O errors
	if err := scanner.Err(); err != nil {
		// Log the error but don't fail completely - we may have successfully
		// parsed many entries before hitting corruption/EOF
		fmt.Printf("   ⚠️  Scanner error encountered: %v\n", err)
		fmt.Printf("   ℹ️  Continuing with %d successfully parsed entries\n", len(entries))
	}

	return entries, nil
}

func analyzeLatencies(entries []types.LatencyLogEntry, fiveMinChunks bool) LatencyAnalysis {
	if len(entries) == 0 {
		return LatencyAnalysis{}
	}

	// Extract latencies and sort
	latencies := make([]float64, len(entries))
	consumerCounts := make(map[int]int)
	partitionCounts := make(map[int32]int)
	partitionLatencies := make(map[int32][]float64)

	var minTime, maxTime time.Time
	var totalLatency float64

	for i, entry := range entries {
		latencies[i] = entry.LatencyMs
		totalLatency += entry.LatencyMs

		// Track consumer and partition distribution
		consumerCounts[entry.ConsumerID]++
		partitionCounts[entry.Partition]++

		// Track latencies per partition for detailed analysis
		partitionLatencies[entry.Partition] = append(partitionLatencies[entry.Partition], entry.LatencyMs)

		// Track time span
		if minTime.IsZero() || entry.Timestamp.Before(minTime) {
			minTime = entry.Timestamp
		}
		if maxTime.IsZero() || entry.Timestamp.After(maxTime) {
			maxTime = entry.Timestamp
		}
	}

	sort.Float64s(latencies)

	count := len(latencies)
	timeSpan := maxTime.Sub(minTime)
	throughput := float64(count) / timeSpan.Seconds()

	// Calculate per-partition latency statistics
	partitionStats := calculatePartitionLatencyStats(partitionLatencies)

	analysis := LatencyAnalysis{
		TotalMessages:         count,
		TimeSpan:              timeSpan,
		ThroughputMsgSec:      throughput,
		MinLatency:            latencies[0],
		MaxLatency:            latencies[count-1],
		AvgLatency:            totalLatency / float64(count),
		P50:                   percentile(latencies, 50.0),
		P90:                   percentile(latencies, 90.0),
		P95:                   percentile(latencies, 95.0),
		P99:                   percentile(latencies, 99.0),
		P99_9:                 percentile(latencies, 99.9),
		P99_99:                percentile(latencies, 99.99),
		P99_999:               percentile(latencies, 99.999),
		ConsumerBreakdown:     consumerCounts,
		PartitionBreakdown:    partitionCounts,
		PartitionLatencyStats: partitionStats,
	}
	
	// Add 5-minute bucket analysis if requested
	if fiveMinChunks {
		analysis.FiveMinuteBuckets = analyzeFiveMinuteBuckets(entries)
	}

	return analysis
}

// calculatePartitionLatencyStats computes latency statistics for each partition
func calculatePartitionLatencyStats(partitionLatencies map[int32][]float64) []PartitionLatencyStats {
	var stats []PartitionLatencyStats

	for partition, latencies := range partitionLatencies {
		if len(latencies) == 0 {
			continue
		}

		// Sort latencies for percentile calculation
		sortedLatencies := make([]float64, len(latencies))
		copy(sortedLatencies, latencies)
		sort.Float64s(sortedLatencies)

		// Calculate average
		var total float64
		for _, latency := range latencies {
			total += latency
		}

		stat := PartitionLatencyStats{
			Partition:    partition,
			MessageCount: len(latencies),
			MinLatency:   sortedLatencies[0],
			MaxLatency:   sortedLatencies[len(sortedLatencies)-1],
			AvgLatency:   total / float64(len(latencies)),
			P50:          percentile(sortedLatencies, 50.0),
			P90:          percentile(sortedLatencies, 90.0),
			P95:          percentile(sortedLatencies, 95.0),
			P99:          percentile(sortedLatencies, 99.0),
			P99_9:        percentile(sortedLatencies, 99.9),
			P99_99:       percentile(sortedLatencies, 99.99),
			P99_999:      percentile(sortedLatencies, 99.999),
		}

		stats = append(stats, stat)
	}

	// Sort by partition ID for consistent output
	sort.Slice(stats, func(i, j int) bool {
		return stats[i].Partition < stats[j].Partition
	})

	return stats
}

// analyzeFiveMinuteBuckets groups messages into 5-minute time buckets and analyzes each bucket
func analyzeFiveMinuteBuckets(entries []types.LatencyLogEntry) []FiveMinuteBucket {
	if len(entries) == 0 {
		return nil
	}

	// Find time bounds
	var minTime, maxTime time.Time
	for _, entry := range entries {
		if minTime.IsZero() || entry.Timestamp.Before(minTime) {
			minTime = entry.Timestamp
		}
		if maxTime.IsZero() || entry.Timestamp.After(maxTime) {
			maxTime = entry.Timestamp
		}
	}

	// Create 5-minute time buckets
	buckets := createFiveMinuteBuckets(minTime, maxTime)
	
	// Group entries by time bucket
	for _, entry := range entries {
		for i := range buckets {
			if (entry.Timestamp.Equal(buckets[i].StartTime) || entry.Timestamp.After(buckets[i].StartTime)) &&
			   entry.Timestamp.Before(buckets[i].EndTime) {
				if buckets[i].PartitionMessages == nil {
					buckets[i].PartitionMessages = make(map[int32][]types.LatencyLogEntry)
				}
				buckets[i].PartitionMessages[entry.Partition] = append(buckets[i].PartitionMessages[entry.Partition], entry)
				break
			}
		}
	}

	// Analyze each bucket
	var fiveMinBuckets []FiveMinuteBucket
	for _, bucket := range buckets {
		if len(bucket.PartitionMessages) == 0 {
			continue // Skip empty buckets
		}

		fiveMinBucket := FiveMinuteBucket{
			StartTime: bucket.StartTime,
			EndTime:   bucket.EndTime,
		}

		// Calculate partition stats for this bucket
		partitionLatencies := make(map[int32][]float64)
		allLatencies := []float64{}
		
		for partition, messages := range bucket.PartitionMessages {
			fiveMinBucket.TotalMessages += len(messages)
			
			latencies := make([]float64, len(messages))
			for i, msg := range messages {
				latencies[i] = msg.LatencyMs
				allLatencies = append(allLatencies, msg.LatencyMs)
			}
			partitionLatencies[partition] = latencies
		}

		fiveMinBucket.PartitionLatencyStats = calculatePartitionLatencyStats(partitionLatencies)
		
		// Calculate overall P99.99 for this bucket
		if len(allLatencies) > 0 {
			sort.Float64s(allLatencies)
			fiveMinBucket.OverallP99_99 = percentile(allLatencies, 99.99)
		}

		fiveMinBuckets = append(fiveMinBuckets, fiveMinBucket)
	}

	return fiveMinBuckets
}

// createFiveMinuteBuckets creates 5-minute time buckets from minTime to maxTime
func createFiveMinuteBuckets(minTime, maxTime time.Time) []TimeBucket {
	var buckets []TimeBucket
	
	// Round down to the nearest 5-minute mark
	start := minTime.Truncate(5 * time.Minute)
	
	for current := start; current.Before(maxTime); current = current.Add(5 * time.Minute) {
		bucket := TimeBucket{
			StartTime: current,
			EndTime:   current.Add(5 * time.Minute),
		}
		buckets = append(buckets, bucket)
	}
	
	return buckets
}

func percentile(sortedData []float64, p float64) float64 {
	if len(sortedData) == 0 {
		return 0
	}

	if p <= 0 {
		return sortedData[0]
	}
	if p >= 100 {
		return sortedData[len(sortedData)-1]
	}

	// Use linear interpolation for more accurate percentiles
	index := (p / 100.0) * float64(len(sortedData)-1)
	lower := int(index)
	upper := lower + 1

	if upper >= len(sortedData) {
		return sortedData[len(sortedData)-1]
	}

	// Linear interpolation between lower and upper
	weight := index - float64(lower)
	return sortedData[lower]*(1.0-weight) + sortedData[upper]*weight
}

func displayFileResults(filename string, analysis LatencyAnalysis) {
	fmt.Printf("   📈 Messages: %d | Span: %v | Throughput: %.1f msg/sec\n",
		analysis.TotalMessages, analysis.TimeSpan, analysis.ThroughputMsgSec)
	fmt.Printf("   🎯 Latency: P50=%.2f P95=%.2f P99=%.2f P99.9=%.2f P99.99=%.2f ms\n",
		analysis.P50, analysis.P95, analysis.P99, analysis.P99_9, analysis.P99_99)
	fmt.Printf("   📊 Range: %.3f - %.3f ms (avg: %.3f ms)\n",
		analysis.MinLatency, analysis.MaxLatency, analysis.AvgLatency)
}

func displayResults(analysis LatencyAnalysis) {
	fmt.Println("📊 COMPREHENSIVE LATENCY ANALYSIS")
	fmt.Println("═══════════════════════════════════")
	fmt.Printf("Total Messages:    %d\n", analysis.TotalMessages)
	fmt.Printf("Time Span:         %v\n", analysis.TimeSpan)
	fmt.Printf("Throughput:        %.2f msg/sec\n", analysis.ThroughputMsgSec)
	fmt.Println()

	fmt.Println("🎯 LATENCY PERCENTILES (milliseconds)")
	fmt.Println("════════════════════════════════════")
	fmt.Printf("Min:               %.6f ms\n", analysis.MinLatency)
	fmt.Printf("Average:           %.6f ms\n", analysis.AvgLatency)
	fmt.Printf("P50 (Median):      %.6f ms\n", analysis.P50)
	fmt.Printf("P90:               %.6f ms\n", analysis.P90)
	fmt.Printf("P95:               %.6f ms\n", analysis.P95)
	fmt.Printf("P99:               %.6f ms\n", analysis.P99)
	fmt.Printf("P99.9:             %.6f ms\n", analysis.P99_9)
	fmt.Printf("P99.99:            %.6f ms ⭐\n", analysis.P99_99)
	fmt.Printf("P99.999:           %.6f ms\n", analysis.P99_999)
	fmt.Printf("Max:               %.6f ms\n", analysis.MaxLatency)
	fmt.Println()

	fmt.Println("📈 DISTRIBUTION BREAKDOWN")
	fmt.Println("═════════════════════════")

	// Consumer breakdown
	fmt.Println("By Consumer:")
	for consumerID := 0; consumerID < 8; consumerID++ {
		count := analysis.ConsumerBreakdown[consumerID]
		percentage := float64(count) / float64(analysis.TotalMessages) * 100
		fmt.Printf("  Consumer %d:      %7d messages (%.1f%%)\n", consumerID, count, percentage)
	}
	fmt.Println()

	// Partition breakdown (top 10)
	fmt.Println("By Partition (Top 10):")
	type partitionCount struct {
		partition int32
		count     int
	}

	var partitions []partitionCount
	for partition, count := range analysis.PartitionBreakdown {
		partitions = append(partitions, partitionCount{partition, count})
	}

	sort.Slice(partitions, func(i, j int) bool {
		return partitions[i].count > partitions[j].count
	})

	for i, pc := range partitions {
		if i >= 10 {
			break
		}
		percentage := float64(pc.count) / float64(analysis.TotalMessages) * 100
		fmt.Printf("  Partition %2d:     %7d messages (%.1f%%)\n", pc.partition, pc.count, percentage)
	}

	if len(partitions) > 10 {
		fmt.Printf("  ... and %d more partitions\n", len(partitions)-10)
	}
	fmt.Println()

	// Performance insights
	fmt.Println("💡 PERFORMANCE INSIGHTS")
	fmt.Println("═══════════════════════")
	fmt.Printf("• 50%% of messages processed in under %.3f ms\n", analysis.P50)
	fmt.Printf("• 99%% of messages processed in under %.3f ms\n", analysis.P99)
	fmt.Printf("• 99.99%% of messages processed in under %.3f ms ⭐\n", analysis.P99_99)

	if analysis.P99_99 < 10.0 {
		fmt.Println("• 🏆 EXCELLENT: P99.99 latency under 10ms!")
	} else if analysis.P99_99 < 50.0 {
		fmt.Println("• ✅ GOOD: P99.99 latency under 50ms")
	} else {
		fmt.Println("• ⚠️  NEEDS OPTIMIZATION: P99.99 latency above 50ms")
	}

	outlierThreshold := analysis.P99 * 2
	if analysis.P99_99 > outlierThreshold {
		fmt.Printf("• ⚠️  OUTLIER DETECTION: P99.99 is %.1fx higher than P99\n", analysis.P99_99/analysis.P99)
	}
}

// displayPartitionLatencyStats shows per-partition latency percentiles for rebalance analysis
func displayPartitionLatencyStats(stats []PartitionLatencyStats) {
	if len(stats) == 0 {
		return
	}

	fmt.Println("\n🎯 PER-PARTITION LATENCY ANALYSIS (Rebalance Study)")
	fmt.Println("═══════════════════════════════════════════════════")
	fmt.Printf("%-9s %8s %8s %8s %8s %8s %8s %10s ⭐\n",
		"Partition", "Messages", "P50", "P90", "P95", "P99", "P99.9", "P99.99")
	fmt.Println("─────────────────────────────────────────────────────────────────────────────")

	// Sort by P99.99 descending to highlight problematic partitions
	sortedStats := make([]PartitionLatencyStats, len(stats))
	copy(sortedStats, stats)
	sort.Slice(sortedStats, func(i, j int) bool {
		return sortedStats[i].P99_99 > sortedStats[j].P99_99
	})

	for _, stat := range sortedStats {
		// Highlight partitions with high P99.99 latency
		icon := "  "
		if stat.P99_99 > 50.0 {
			icon = "⚠️ "
		} else if stat.P99_99 > 100.0 {
			icon = "🔴"
		}

		fmt.Printf("%s%7d %8d %8.2f %8.2f %8.2f %8.2f %8.2f %10.2f\n",
			icon, stat.Partition, stat.MessageCount,
			stat.P50, stat.P90, stat.P95, stat.P99, stat.P99_9, stat.P99_99)
	}

	// Summary insights for rebalance analysis
	fmt.Println("\n💡 REBALANCE ANALYSIS INSIGHTS")
	fmt.Println("═════════════════════════════")

	// Find partition with highest P99.99
	var maxP9999 PartitionLatencyStats
	var minP9999 PartitionLatencyStats
	var avgP9999 float64

	for i, stat := range stats {
		avgP9999 += stat.P99_99
		if i == 0 || stat.P99_99 > maxP9999.P99_99 {
			maxP9999 = stat
		}
		if i == 0 || stat.P99_99 < minP9999.P99_99 {
			minP9999 = stat
		}
	}
	avgP9999 /= float64(len(stats))

	fmt.Printf("• Highest P99.99 latency: Partition %d (%.2f ms)\n", maxP9999.Partition, maxP9999.P99_99)
	fmt.Printf("• Lowest P99.99 latency:  Partition %d (%.2f ms)\n", minP9999.Partition, minP9999.P99_99)
	fmt.Printf("• Average P99.99 latency: %.2f ms\n", avgP9999)
	fmt.Printf("• Latency spread (max/min): %.1fx\n", maxP9999.P99_99/minP9999.P99_99)

	// Count problematic partitions
	highLatencyCount := 0
	for _, stat := range stats {
		if stat.P99_99 > 50.0 {
			highLatencyCount++
		}
	}

	if highLatencyCount > 0 {
		fmt.Printf("• ⚠️  %d/%d partitions have P99.99 > 50ms (potential rebalance impact)\n",
			highLatencyCount, len(stats))
	} else {
		fmt.Printf("• ✅ All partitions have P99.99 < 50ms (healthy during rebalance)\n")
	}

	if maxP9999.P99_99/minP9999.P99_99 > 3.0 {
		fmt.Printf("• ⚠️  High latency variance detected - investigate partition %d\n", maxP9999.Partition)
	}
}

// displayFiveMinuteBucketAnalysis displays 5-minute bucket analysis for 99.99% availability reporting
func displayFiveMinuteBucketAnalysis(buckets []FiveMinuteBucket) {
	if len(buckets) == 0 {
		return
	}

	fmt.Println("\n⏰ 5-MINUTE BUCKET ANALYSIS (99.99% Availability)")
	fmt.Println("═══════════════════════════════════════════════")
	
	// Display header for bucket table
	fmt.Printf("%-6s %-10s %-10s %8s %10s\n", "Bucket", "Start", "End", "Messages", "P99.99 ms")
	fmt.Println("────────────────────────────────────────────────────")
	
	for i, bucket := range buckets {
		startStr := bucket.StartTime.Format("15:04:05")
		endStr := bucket.EndTime.Format("15:04:05")
		
		fmt.Printf("%-6d %-10s %-10s %8d %10.2f\n",
			i+1, startStr, endStr, bucket.TotalMessages, bucket.OverallP99_99)
	}
}

// printUsageHelp prints consistent usage help messages
func printUsageHelp() {
	fmt.Printf("💡 TIP: Download files first using: ./run-s3-download.sh\n")
	fmt.Printf("💡 Or specify a different directory: go run cmd/analyze/analyze_latency.go /path/to/logs\n")
	fmt.Printf("💡 For 5-minute bucket analysis: go run cmd/analyze/analyze_latency.go -5min [/path/to/logs]\n")
}
