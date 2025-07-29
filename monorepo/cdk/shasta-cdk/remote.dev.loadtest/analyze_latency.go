package main

import (
	"bufio"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// LatencyLogEntry matches the structure from the main load test
type LatencyLogEntry struct {
	Timestamp   time.Time `json:"timestamp"`
	SendTime    time.Time `json:"send_time"`
	ReceiveTime time.Time `json:"receive_time"`
	LatencyMs   float64   `json:"latency_ms"`
	ConsumerID  int       `json:"consumer_id"`
	Partition   int32     `json:"partition"`
	Offset      int64     `json:"offset"`
}

// LatencyAnalysis holds computed statistics
type LatencyAnalysis struct {
	TotalMessages    int
	TimeSpan         time.Duration
	ThroughputMsgSec float64
	MinLatency       float64
	MaxLatency       float64
	AvgLatency       float64
	P50              float64
	P90              float64
	P95              float64
	P99              float64
	P99_9            float64
	P99_99           float64
	P99_999          float64
	ConsumerBreakdown map[int]int
	PartitionBreakdown map[int32]int
}

func main() {
	logDir := "./logs"
	if len(os.Args) > 1 {
		logDir = os.Args[1]
	}

	fmt.Printf("🔍 Analyzing latency logs in: %s\n\n", logDir)

	// Find all log files
	files, err := findLogFiles(logDir)
	if err != nil {
		log.Fatalf("❌ Failed to find log files: %v", err)
	}

	if len(files) == 0 {
		log.Fatalf("❌ No log files found in %s", logDir)
	}

	fmt.Printf("📂 Found %d log files:\n", len(files))
	for _, file := range files {
		fmt.Printf("   • %s\n", filepath.Base(file))
	}
	fmt.Println()

	// Parse all log files
	allLatencies, err := parseLogFiles(files)
	if err != nil {
		log.Fatalf("❌ Failed to parse log files: %v", err)
	}

	if len(allLatencies) == 0 {
		log.Fatalf("❌ No latency data found in log files")
	}

	// Analyze the data
	analysis := analyzeLatencies(allLatencies)

	// Display results
	displayResults(analysis)
}

func findLogFiles(logDir string) ([]string, error) {
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

func parseLogFiles(files []string) ([]LatencyLogEntry, error) {
	var allEntries []LatencyLogEntry

	for _, filePath := range files {
		fmt.Printf("📖 Reading: %s\n", filepath.Base(filePath))

		entries, err := parseLogFile(filePath)
		if err != nil {
			return nil, fmt.Errorf("failed to parse %s: %v", filePath, err)
		}

		fmt.Printf("   ✅ Loaded %d entries\n", len(entries))
		allEntries = append(allEntries, entries...)
	}

	fmt.Printf("\n📊 Total entries loaded: %d\n\n", len(allEntries))
	return allEntries, nil
}

func parseLogFile(filePath string) ([]LatencyLogEntry, error) {
	var entries []LatencyLogEntry

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

		var entry LatencyLogEntry
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			// Log parsing errors but continue
			fmt.Printf("   ⚠️  Line %d parse error: %v\n", lineNum, err)
			continue
		}

		entries = append(entries, entry)
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	return entries, nil
}

func analyzeLatencies(entries []LatencyLogEntry) LatencyAnalysis {
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
		TimeSpan:          timeSpan,
		ThroughputMsgSec:  throughput,
		MinLatency:        latencies[0],
		MaxLatency:        latencies[count-1],
		AvgLatency:        totalLatency / float64(count),
		P50:               percentile(latencies, 50.0),
		P90:               percentile(latencies, 90.0),
		P95:               percentile(latencies, 95.0),
		P99:               percentile(latencies, 99.0),
		P99_9:             percentile(latencies, 99.9),
		P99_99:            percentile(latencies, 99.99),
		P99_999:           percentile(latencies, 99.999),
		ConsumerBreakdown: consumerCounts,
		PartitionBreakdown: partitionCounts,
	}

	return analysis
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