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

// BucketStats holds aggregated latency statistics (used for both overall and time buckets)
type BucketStats struct {
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
}

// LatencyAnalysis holds computed statistics
type LatencyAnalysis struct {
	TotalMessages      int
	TimeSpan           time.Duration
	ThroughputMsgSec   float64
	MinLatency         float64
	MaxLatency         float64
	AvgLatency         float64
	P50                float64
	P90                float64
	P95                float64
	P99                float64
	P99_9              float64
	P99_99             float64
	ConsumerBreakdown  map[int]int
	PartitionBreakdown map[int32]int
	FiveMinuteBuckets  []TimeBucket // 5-minute buckets
	OneHourBuckets     []TimeBucket // 1-hour buckets
}

// TimeBucket represents a time bucket for grouping messages (5min or 1hr)
type TimeBucket struct {
	StartTime    time.Time
	EndTime      time.Time
	Stats        BucketStats
	Messages     []types.LatencyLogEntry // Store all messages for this bucket
}

func main() {
	// Command line flags
	var timeBuckets bool
	var jsonlOutput bool
	flag.BoolVar(&timeBuckets, "buckets", false, "Enable time bucket analysis (5-minute and 1-hour buckets)")
	flag.BoolVar(&jsonlOutput, "jsonl", false, "Write JSONL records for time buckets to file")
	flag.Parse()
	
	// Validate flag combinations
	if jsonlOutput && !timeBuckets {
		fmt.Printf("❌ Error: -jsonl flag requires -buckets flag to be enabled\n")
		fmt.Printf("💡 Use: go run cmd/analyze/analyze_latency.go -buckets -jsonl [directory]\n")
		os.Exit(1)
	}
	
	// Default to downloads folder (where S3 download script puts files)
	logDir := "./downloads"
	args := flag.Args()
	if len(args) > 0 {
		logDir = args[0]
	}

	if timeBuckets {
		if jsonlOutput {
			fmt.Printf("🔍 Analyzing latency logs with time buckets (5min & 1hr) and JSONL output in: %s\n\n", logDir)
		} else {
			fmt.Printf("🔍 Analyzing latency logs with time buckets (5min & 1hr) in: %s\n\n", logDir)
		}
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
	if !timeBuckets {
		fmt.Println("📊 INDIVIDUAL FILE ANALYSIS")
		fmt.Println("═══════════════════════════════════")
	}

	totalEntries := 0
	filesProcessed := 0
	var jsonlFile *os.File
	var jsonlEncoder *json.Encoder
	
	// Create single JSONL output file if requested
	if jsonlOutput {
		jsonlOutputFile := "bucket_analysis.jsonl"
		var err error
		jsonlFile, err = os.Create(jsonlOutputFile)
		if err != nil {
			fmt.Printf("❌ Failed to create JSONL output file: %v\n", err)
			os.Exit(1)
		}
		defer jsonlFile.Close()
		jsonlEncoder = json.NewEncoder(jsonlFile)
		fmt.Printf("📝 Writing JSONL records to: %s\n\n", jsonlOutputFile)
	}

	for _, filePath := range files {
		if !timeBuckets {
			fmt.Printf("\n📖 Analyzing: %s\n", filepath.Base(filePath))
		}

		entries, err := parseLogFile(filePath)
		if err != nil {
			fmt.Printf("❌ Failed to parse %s: %v\n", filePath, err)
			continue
		}

		if len(entries) == 0 {
			if !timeBuckets {
				fmt.Printf("   ⚠️  No valid entries found\n")
			}
			continue
		}

		if !timeBuckets {
			fmt.Printf("   ✅ Loaded %d entries\n", len(entries))
		}

		// Analyze this file individually
		fileAnalysis := analyzeLatencies(entries, timeBuckets)
		
		if timeBuckets {
			// Show time bucket analysis when -buckets flag is used
			if len(fileAnalysis.FiveMinuteBuckets) > 0 || len(fileAnalysis.OneHourBuckets) > 0 {
				fmt.Printf("\n📖 File: %s (%d entries)\n", filepath.Base(filePath), len(entries))
				displayTimeBucketAnalysis(fileAnalysis)

				// Write JSONL output if requested
				if jsonlOutput {
					if err := writeJSONLRecordsToFile(filepath.Base(filePath), fileAnalysis, jsonlEncoder, jsonlFile); err != nil {
						fmt.Printf("⚠️  Failed to write JSONL for %s: %v\n", filepath.Base(filePath), err)
					}
				}
			}
		} else {
			// Show regular analysis when -buckets flag is NOT used
			displayFileResults(filepath.Base(filePath), fileAnalysis)
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

	if !timeBuckets {
		fmt.Printf("\n📊 Successfully processed %d files with %d total entries\n", filesProcessed, totalEntries)
		fmt.Println("💡 Individual file analysis complete - memory optimized!")
	} else if jsonlOutput {
		fmt.Printf("\n📝 JSONL output complete - all bucket records written to bucket_analysis.jsonl\n")
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

func analyzeLatencies(entries []types.LatencyLogEntry, timeBuckets bool) LatencyAnalysis {
	if len(entries) == 0 {
		return LatencyAnalysis{}
	}

	// Extract latencies and sort
	latencies := make([]float64, len(entries))
	consumerCounts := make(map[int]int)
	partitionCounts := make(map[int32]int)

	var minTime, maxTime time.Time
	var totalLatency float64

	for i, entry := range entries {
		latencies[i] = entry.LatencyMs
		totalLatency += entry.LatencyMs

		// Track consumer and partition distribution
		consumerCounts[entry.ConsumerID]++
		partitionCounts[entry.Partition]++

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

	analysis := LatencyAnalysis{
		TotalMessages:      count,
		TimeSpan:           timeSpan,
		ThroughputMsgSec:   throughput,
		MinLatency:         latencies[0],
		MaxLatency:         latencies[count-1],
		AvgLatency:         totalLatency / float64(count),
		P50:                percentile(latencies, 50.0),
		P90:                percentile(latencies, 90.0),
		P95:                percentile(latencies, 95.0),
		P99:                percentile(latencies, 99.0),
		P99_9:              percentile(latencies, 99.9),
		P99_99:             percentile(latencies, 99.99),
		ConsumerBreakdown:  consumerCounts,
		PartitionBreakdown: partitionCounts,
	}

	// Add time bucket analysis if requested
	if timeBuckets {
		analysis.FiveMinuteBuckets = analyzeTimeBuckets(entries, 5*time.Minute)
		analysis.OneHourBuckets = analyzeTimeBuckets(entries, 1*time.Hour)
	}

	return analysis
}

// calculateBucketStats computes statistics for a collection of latency values
func calculateBucketStats(latencies []float64) BucketStats {
	if len(latencies) == 0 {
		return BucketStats{}
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

	return BucketStats{
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
	}
}

// analyzeTimeBuckets groups messages into time buckets and analyzes each bucket
func analyzeTimeBuckets(entries []types.LatencyLogEntry, bucketDuration time.Duration) []TimeBucket {
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

	// Create time buckets
	buckets := createTimeBuckets(minTime, maxTime, bucketDuration)

	// Group entries by time bucket
	for _, entry := range entries {
		for i := range buckets {
			if (entry.Timestamp.Equal(buckets[i].StartTime) || entry.Timestamp.After(buckets[i].StartTime)) &&
				entry.Timestamp.Before(buckets[i].EndTime) {
				buckets[i].Messages = append(buckets[i].Messages, entry)
				break
			}
		}
	}

	// Analyze each bucket and filter out empty ones
	var analyzedBuckets []TimeBucket
	for _, bucket := range buckets {
		if len(bucket.Messages) == 0 {
			continue // Skip empty buckets
		}

		// Extract latencies for this bucket
		latencies := make([]float64, len(bucket.Messages))
		for i, msg := range bucket.Messages {
			latencies[i] = msg.LatencyMs
		}

		// Calculate statistics for this bucket
		bucket.Stats = calculateBucketStats(latencies)
		analyzedBuckets = append(analyzedBuckets, bucket)
	}

	return analyzedBuckets
}

// createTimeBuckets creates time buckets from minTime to maxTime with given duration
func createTimeBuckets(minTime, maxTime time.Time, bucketDuration time.Duration) []TimeBucket {
	var buckets []TimeBucket

	// Round down to the nearest bucket mark
	start := minTime.Truncate(bucketDuration)

	for current := start; current.Before(maxTime); current = current.Add(bucketDuration) {
		bucket := TimeBucket{
			StartTime: current,
			EndTime:   current.Add(bucketDuration),
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
	fmt.Printf("   📊 Min: %.2f ms | Max: %.2f ms | Avg: %.2f ms\n",
		analysis.MinLatency, analysis.MaxLatency, analysis.AvgLatency)
	fmt.Printf("   🎯 P50: %.2f | P90: %.2f | P95: %.2f | P99: %.2f | P99.9: %.2f | P99.99: %.2f ms\n",
		analysis.P50, analysis.P90, analysis.P95, analysis.P99, analysis.P99_9, analysis.P99_99)
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

// displayTimeBucketAnalysis displays both 5-minute and 1-hour bucket analysis
func displayTimeBucketAnalysis(analysis LatencyAnalysis) {
	if len(analysis.FiveMinuteBuckets) > 0 {
		fmt.Println("\n⏰ 5-MINUTE BUCKET ANALYSIS")
		fmt.Println("══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════")
		displayBuckets(analysis.FiveMinuteBuckets, "5min")
	}

	if len(analysis.OneHourBuckets) > 0 {
		fmt.Println("\n⏰ 1-HOUR BUCKET ANALYSIS")
		fmt.Println("══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════")
		displayBuckets(analysis.OneHourBuckets, "1hr")
	}

}

// displayBuckets displays time bucket analysis
func displayBuckets(buckets []TimeBucket, bucketType string) {
	if len(buckets) == 0 {
		return
	}

	// Display header for bucket table
	fmt.Printf("%-6s %-19s %-19s %8s %8s %8s %8s %8s %8s %8s %8s %8s %10s\n",
		"Bucket", "Start", "End", "Messages", "Min", "Max", "Avg", "P50", "P90", "P95", "P99", "P99.9", "P99.99")
	fmt.Println("──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────")

	for i, bucket := range buckets {
		var timeFormat string
		if bucketType == "5min" {
			timeFormat = "2006-01-02 15:04:05"
		} else {
			timeFormat = "2006-01-02 15:04"
		}
		startStr := bucket.StartTime.Format(timeFormat)
		endStr := bucket.EndTime.Format(timeFormat)

		fmt.Printf("%-6d %-19s %-19s %8d %8.2f %8.2f %8.2f %8.2f %8.2f %8.2f %8.2f %8.2f %10.2f\n",
			i+1, startStr, endStr, bucket.Stats.MessageCount,
			bucket.Stats.MinLatency, bucket.Stats.MaxLatency, bucket.Stats.AvgLatency,
			bucket.Stats.P50, bucket.Stats.P90, bucket.Stats.P95,
			bucket.Stats.P99, bucket.Stats.P99_9, bucket.Stats.P99_99)
	}
}

// BucketJSONLRecord represents a JSONL record for time buckets
type BucketJSONLRecord struct {
	Filename      string    `json:"filename"`
	BucketType    string    `json:"bucket_type"` // "5min" or "1hr"
	BucketIndex   int       `json:"bucket_index"`
	StartTime     time.Time `json:"start_time"`
	EndTime       time.Time `json:"end_time"`
	TotalMessages int       `json:"total_messages"`
	MinLatency    float64   `json:"min_ms"`
	MaxLatency    float64   `json:"max_ms"`
	AvgLatency    float64   `json:"avg_ms"`
	P50           float64   `json:"p50_ms"`
	P90           float64   `json:"p90_ms"`
	P95           float64   `json:"p95_ms"`
	P99           float64   `json:"p99_ms"`
	P99_9         float64   `json:"p99_9_ms"`
	P99_99        float64   `json:"p99_99_ms"`
}

// writeJSONLRecordsToFile writes bucket analysis as JSONL records to the shared output file
func writeJSONLRecordsToFile(filename string, analysis LatencyAnalysis, encoder *json.Encoder, file *os.File) error {
	// Write 5-minute bucket records
	for i, bucket := range analysis.FiveMinuteBuckets {
		record := BucketJSONLRecord{
			Filename:      filename,
			BucketType:    "5min",
			BucketIndex:   i + 1,
			StartTime:     bucket.StartTime,
			EndTime:       bucket.EndTime,
			TotalMessages: bucket.Stats.MessageCount,
			MinLatency:    bucket.Stats.MinLatency,
			MaxLatency:    bucket.Stats.MaxLatency,
			AvgLatency:    bucket.Stats.AvgLatency,
			P50:           bucket.Stats.P50,
			P90:           bucket.Stats.P90,
			P95:           bucket.Stats.P95,
			P99:           bucket.Stats.P99,
			P99_9:         bucket.Stats.P99_9,
			P99_99:        bucket.Stats.P99_99,
		}

		if err := encoder.Encode(record); err != nil {
			return fmt.Errorf("failed to encode JSONL record: %v", err)
		}

		// Flush after each record to make it immediately visible to tail -f
		if err := file.Sync(); err != nil {
			return fmt.Errorf("failed to flush JSONL record: %v", err)
		}
	}

	// Write 1-hour bucket records
	for i, bucket := range analysis.OneHourBuckets {
		record := BucketJSONLRecord{
			Filename:      filename,
			BucketType:    "1hr",
			BucketIndex:   i + 1,
			StartTime:     bucket.StartTime,
			EndTime:       bucket.EndTime,
			TotalMessages: bucket.Stats.MessageCount,
			MinLatency:    bucket.Stats.MinLatency,
			MaxLatency:    bucket.Stats.MaxLatency,
			AvgLatency:    bucket.Stats.AvgLatency,
			P50:           bucket.Stats.P50,
			P90:           bucket.Stats.P90,
			P95:           bucket.Stats.P95,
			P99:           bucket.Stats.P99,
			P99_9:         bucket.Stats.P99_9,
			P99_99:        bucket.Stats.P99_99,
		}

		if err := encoder.Encode(record); err != nil {
			return fmt.Errorf("failed to encode JSONL record: %v", err)
		}

		// Flush after each record to make it immediately visible to tail -f
		if err := file.Sync(); err != nil {
			return fmt.Errorf("failed to flush JSONL record: %v", err)
		}
	}

	return nil
}

// printUsageHelp prints consistent usage help messages
func printUsageHelp() {
	fmt.Printf("💡 TIP: Download files first using: ./run-s3-download.sh\n")
	fmt.Printf("💡 Or specify a different directory: go run cmd/analyze/analyze_latency.go /path/to/logs\n")
	fmt.Printf("💡 For time bucket analysis: go run cmd/analyze/analyze_latency.go -buckets [/path/to/logs]\n")
	fmt.Printf("💡 For JSONL output: go run cmd/analyze/analyze_latency.go -buckets -jsonl [/path/to/logs]\n")
}
