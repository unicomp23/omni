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
	// Default to downloads folder (where S3 download script puts files)
	logDir := "./downloads"
	if len(os.Args) > 1 {
		logDir = os.Args[1]
	}

	fmt.Printf("🔍 Analyzing latency logs in: %s\n\n", logDir)

	// Find all log files
	files, err := findLogFiles(logDir)
	if err != nil {
		fmt.Printf("❌ Failed to find log files: %v\n", err)
		fmt.Printf("💡 TIP: Download files first using: ./run-s3-download.sh\n")
		fmt.Printf("💡 Or specify a different directory: go run analyze_latency.go /path/to/logs\n")
		os.Exit(1)
	}

	if len(files) == 0 {
		fmt.Printf("❌ No log files found in %s\n", logDir)
		fmt.Printf("💡 TIP: Download files first using: ./run-s3-download.sh\n")
		fmt.Printf("💡 Or specify a different directory: go run analyze_latency.go /path/to/logs\n")
		os.Exit(1)
	}

	fmt.Printf("📂 Found %d log files:\n", len(files))
	for _, file := range files {
		fmt.Printf("   • %s\n", filepath.Base(file))
	}
	fmt.Println()

	// Parse and analyze each file individually first
	var allLatencies []LatencyLogEntry
	fmt.Println("📊 INDIVIDUAL FILE ANALYSIS")
	fmt.Println("═══════════════════════════════════")
	
	for _, filePath := range files {
		fmt.Printf("\n📖 Analyzing: %s\n", filepath.Base(filePath))
		
		entries, err := parseLogFile(filePath)
		if err != nil {
			fmt.Printf("❌ Failed to parse %s: %v\n", filePath, err)
			continue
		}
		
		if len(entries) == 0 {
			fmt.Printf("   ⚠️  No valid entries found\n")
			continue
		}
		
		fmt.Printf("   ✅ Loaded %d entries\n", len(entries))
		
		// Analyze this file individually
		fileAnalysis := analyzeLatencies(entries)
		displayFileResults(filepath.Base(filePath), fileAnalysis)
		
		// Add to combined dataset
		allLatencies = append(allLatencies, entries...)
	}

	if len(allLatencies) == 0 {
		log.Fatalf("❌ No latency data found in any log files")
	}

	fmt.Printf("\n📊 Total entries across all files: %d\n", len(allLatencies))

	// Analyze the combined data
	fmt.Println("\n" + strings.Repeat("═", 60))
	fmt.Println("📊 COMBINED ANALYSIS (ALL FILES)")
	fmt.Println(strings.Repeat("═", 60))
	analysis := analyzeLatencies(allLatencies)
	displayResults(analysis)
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

	// Check for scanner errors, but be resilient to EOF and other I/O errors
	if err := scanner.Err(); err != nil {
		// Log the error but don't fail completely - we may have successfully
		// parsed many entries before hitting corruption/EOF
		fmt.Printf("   ⚠️  Scanner error encountered: %v\n", err)
		fmt.Printf("   ℹ️  Continuing with %d successfully parsed entries\n", len(entries))
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