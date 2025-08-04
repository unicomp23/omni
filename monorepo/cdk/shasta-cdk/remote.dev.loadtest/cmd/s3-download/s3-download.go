package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/s3"
	"github.com/aws/aws-sdk-go/service/s3/s3manager"

	"loadtest/pkg/utils"
)

const (
	defaultBucketName = "redpanda-load-test-358474168551-us-east-1"
	defaultOutputDir  = "./downloads"
	defaultRegion     = "us-east-1"
	defaultPrefix     = "latency-logs/"
)

type S3Downloader struct {
	bucket     string
	outputDir  string
	region     string
	prefix     string
	downloader *s3manager.Downloader
	s3Client   *s3.S3
}

type S3Object struct {
	Key          string
	Size         int64
	LastModified time.Time
	ETag         string
}

func NewS3Downloader(bucket, outputDir, region, prefix string) (*S3Downloader, error) {
	// Create AWS session with shared config enabled and profile support
	sess, err := session.NewSessionWithOptions(session.Options{
		Config: aws.Config{
			Region: aws.String(region),
		},
		SharedConfigState: session.SharedConfigEnable,
		Profile:           getEnvOrDefault("AWS_PROFILE", "358474168551_admin"),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create AWS session: %w", err)
	}

	return &S3Downloader{
		bucket:     bucket,
		outputDir:  outputDir,
		region:     region,
		prefix:     prefix,
		downloader: s3manager.NewDownloader(sess),
		s3Client:   s3.New(sess),
	}, nil
}

func (d *S3Downloader) listObjects(maxResults int64) ([]S3Object, error) {
	utils.TimestampedPrintfLn("🔍 Listing objects in s3://%s/%s", d.bucket, d.prefix)

	var objects []S3Object

	input := &s3.ListObjectsV2Input{
		Bucket: aws.String(d.bucket),
		Prefix: aws.String(d.prefix),
	}

	if maxResults > 0 {
		input.MaxKeys = aws.Int64(maxResults)
	}

	err := d.s3Client.ListObjectsV2Pages(input, func(page *s3.ListObjectsV2Output, lastPage bool) bool {
		for _, obj := range page.Contents {
			objects = append(objects, S3Object{
				Key:          *obj.Key,
				Size:         *obj.Size,
				LastModified: *obj.LastModified,
				ETag:         strings.Trim(*obj.ETag, "\""),
			})
		}
		return !lastPage
	})

	if err != nil {
		return nil, fmt.Errorf("failed to list objects: %w", err)
	}

	// Sort by last modified (newest first)
	sort.Slice(objects, func(i, j int) bool {
		return objects[i].LastModified.After(objects[j].LastModified)
	})

	return objects, nil
}

func (d *S3Downloader) fileExists(filePath string) bool {
	_, err := os.Stat(filePath)
	return err == nil
}

func (d *S3Downloader) downloadFile(object S3Object, overwrite bool) error {
	// Create local file path
	relPath := strings.TrimPrefix(object.Key, d.prefix)
	if relPath == "" {
		relPath = filepath.Base(object.Key)
	}

	localPath := filepath.Join(d.outputDir, relPath)

	// Check if file already exists
	if !overwrite && d.fileExists(localPath) {
		utils.TimestampedPrintfLn("⏭️  Skipping %s - file already exists locally", filepath.Base(localPath))
		return nil
	}

	// Create directory structure if needed
	if err := os.MkdirAll(filepath.Dir(localPath), 0755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", filepath.Dir(localPath), err)
	}

	// Create local file
	file, err := os.Create(localPath)
	if err != nil {
		return fmt.Errorf("failed to create file %s: %w", localPath, err)
	}
	defer file.Close()

	utils.TimestampedPrintfLn("⬇️  Downloading %s (%.2f MB)",
		filepath.Base(localPath), float64(object.Size)/(1024*1024))

	startTime := time.Now()

	// Download the file
	_, err = d.downloader.Download(file, &s3.GetObjectInput{
		Bucket: aws.String(d.bucket),
		Key:    aws.String(object.Key),
	})

	downloadDuration := time.Since(startTime)

	if err != nil {
		// Clean up partial file on error
		os.Remove(localPath)
		return fmt.Errorf("failed to download file: %w", err)
	}

	downloadSpeedMBps := (float64(object.Size) / (1024 * 1024)) / downloadDuration.Seconds()
	utils.TimestampedPrintfLn("✅ Download completed in %v (%.2f MB/s): %s",
		downloadDuration, downloadSpeedMBps, localPath)

	// Preserve the original modification time
	if err := os.Chtimes(localPath, object.LastModified, object.LastModified); err != nil {
		utils.TimestampedPrintfLn("⚠️  Warning: failed to set file timestamps: %v", err)
	}

	return nil
}

func (d *S3Downloader) downloadAll(pattern string, maxFiles int, overwrite bool) error {
	// List all objects
	objects, err := d.listObjects(0) // Get all objects
	if err != nil {
		return err
	}

	if len(objects) == 0 {
		utils.TimestampedPrintfLn("📂 No objects found in s3://%s/%s", d.bucket, d.prefix)
		return nil
	}

	// Filter by pattern if provided
	var filteredObjects []S3Object
	for _, obj := range objects {
		if pattern == "" || strings.Contains(obj.Key, pattern) {
			filteredObjects = append(filteredObjects, obj)
		}
	}

	if len(filteredObjects) == 0 {
		utils.TimestampedPrintfLn("📂 No objects matching pattern '%s'", pattern)
		return nil
	}

	// Limit number of files if specified
	if maxFiles > 0 && len(filteredObjects) > maxFiles {
		filteredObjects = filteredObjects[:maxFiles]
		utils.TimestampedPrintfLn("📋 Limiting to %d most recent files", maxFiles)
	}

	utils.TimestampedPrintfLn("📋 Found %d files to download", len(filteredObjects))

	// Create output directory
	if err := os.MkdirAll(d.outputDir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory %s: %w", d.outputDir, err)
	}

	// Download each file
	successCount := 0
	errorCount := 0

	for i, obj := range filteredObjects {
		utils.TimestampedPrintfLn("🔄 Processing %d/%d: %s", i+1, len(filteredObjects), filepath.Base(obj.Key))

		if err := d.downloadFile(obj, overwrite); err != nil {
			utils.TimestampedPrintfLn("❌ Failed to download %s: %v", filepath.Base(obj.Key), err)
			errorCount++
		} else {
			successCount++
		}
	}

	utils.TimestampedPrintfLn("📊 Download summary: %d successful, %d errors", successCount, errorCount)
	return nil
}

func (d *S3Downloader) listOnly(pattern string, maxFiles int, detailed bool) error {
	objects, err := d.listObjects(0)
	if err != nil {
		return err
	}

	if len(objects) == 0 {
		utils.TimestampedPrintfLn("📂 No objects found in s3://%s/%s", d.bucket, d.prefix)
		return nil
	}

	// Filter by pattern if provided
	var filteredObjects []S3Object
	for _, obj := range objects {
		if pattern == "" || strings.Contains(obj.Key, pattern) {
			filteredObjects = append(filteredObjects, obj)
		}
	}

	if len(filteredObjects) == 0 {
		utils.TimestampedPrintfLn("📂 No objects matching pattern '%s'", pattern)
		return nil
	}

	// Limit number of files if specified
	if maxFiles > 0 && len(filteredObjects) > maxFiles {
		filteredObjects = filteredObjects[:maxFiles]
	}

	utils.TimestampedPrintfLn("📋 Found %d objects in s3://%s/%s", len(filteredObjects), d.bucket, d.prefix)
	fmt.Printf("\n")

	totalSize := int64(0)
	for i, obj := range filteredObjects {
		totalSize += obj.Size
		filename := filepath.Base(obj.Key)

		if detailed {
			fmt.Printf("%3d. %-50s %8.2f MB  %s  %s\n",
				i+1,
				filename,
				float64(obj.Size)/(1024*1024),
				obj.LastModified.Format("2006-01-02 15:04:05"),
				obj.ETag)
		} else {
			fmt.Printf("%3d. %-50s %8.2f MB  %s\n",
				i+1,
				filename,
				float64(obj.Size)/(1024*1024),
				obj.LastModified.Format("2006-01-02 15:04:05"))
		}
	}

	fmt.Printf("\n📊 Total: %d files, %.2f MB\n", len(filteredObjects), float64(totalSize)/(1024*1024))
	return nil
}

func getEnvOrDefault(envVar, defaultValue string) string {
	if value := os.Getenv(envVar); value != "" {
		return value
	}
	return defaultValue
}

func printUsage() {
	fmt.Printf(`S3 Download for RedPanda Load Test Logs
═══════════════════════════════════════

Usage: %s [OPTIONS]

OPTIONS:
  -bucket string     S3 bucket name (default: %s)
  -output string     Local output directory (default: %s)
  -region string     AWS region (default: %s)
  -prefix string     S3 key prefix (default: %s)
  -pattern string    Filter files by pattern (substring match)
  -max int           Maximum number of files to process (0 = all)
  -overwrite         Overwrite existing local files (default: false)
  -list              List files only, don't download (default: false)
  -detailed          Show detailed information when listing (default: false)
  -help              Show this help message

ENVIRONMENT VARIABLES:
  S3_BUCKET         Override default bucket name
  OUTPUT_DIR        Override default output directory
  AWS_REGION        Override default AWS region
  AWS_PROFILE       AWS profile name (default: 358474168551_admin)
  S3_PREFIX         Override default S3 prefix
  MAX_FILES         Maximum number of files to process
  OVERWRITE_FILES   Set to 'true' to overwrite existing files

EXAMPLES:
  # List all files
  %s -list

  # List files with pattern matching
  %s -list -pattern "2024-01-15"

  # Download all files
  %s

  # Download specific files with pattern
  %s -pattern "2024-01-15" -max 10

  # Download to custom directory with overwrite
  %s -output ./custom-logs -overwrite

  # Download from custom bucket and prefix
  %s -bucket my-bucket -prefix "logs/" -output ./downloads

  # List with detailed information
  %s -list -detailed -max 20
`, os.Args[0], defaultBucketName, defaultOutputDir, defaultRegion, defaultPrefix,
		os.Args[0], os.Args[0], os.Args[0], os.Args[0], os.Args[0], os.Args[0], os.Args[0])
}

func main() {
	// Parse environment variables
	var (
		bucket    = getEnvOrDefault("S3_BUCKET", defaultBucketName)
		outputDir = getEnvOrDefault("OUTPUT_DIR", defaultOutputDir)
		region    = getEnvOrDefault("AWS_REGION", defaultRegion)
		prefix    = getEnvOrDefault("S3_PREFIX", defaultPrefix)
		pattern   = getEnvOrDefault("PATTERN", "")
		maxFiles  = 0
		overwrite = strings.ToLower(getEnvOrDefault("OVERWRITE_FILES", "false")) == "true"
		listOnly  = false
		detailed  = false
	)

	// Simple argument parsing
	for i, arg := range os.Args[1:] {
		switch arg {
		case "-bucket":
			if i+1 < len(os.Args[1:]) {
				bucket = os.Args[i+2]
			}
		case "-output":
			if i+1 < len(os.Args[1:]) {
				outputDir = os.Args[i+2]
			}
		case "-region":
			if i+1 < len(os.Args[1:]) {
				region = os.Args[i+2]
			}
		case "-prefix":
			if i+1 < len(os.Args[1:]) {
				prefix = os.Args[i+2]
			}
		case "-pattern":
			if i+1 < len(os.Args[1:]) {
				pattern = os.Args[i+2]
			}
		case "-max":
			if i+1 < len(os.Args[1:]) {
				fmt.Sscanf(os.Args[i+2], "%d", &maxFiles)
			}
		case "-overwrite":
			overwrite = true
		case "-list":
			listOnly = true
		case "-detailed":
			detailed = true
		case "-help", "--help", "-h":
			printUsage()
			return
		}
	}

	fmt.Printf("RedPanda Load Test - S3 Downloader\n")
	fmt.Printf("══════════════════════════════════\n\n")

	// Create downloader
	downloader, err := NewS3Downloader(bucket, outputDir, region, prefix)
	if err != nil {
		log.Fatalf("❌ Failed to create S3 downloader: %v", err)
	}

	// Run operation
	if listOnly {
		utils.TimestampedPrintfLn("📋 Listing files in s3://%s/%s", bucket, prefix)
		if pattern != "" {
			utils.TimestampedPrintfLn("🔍 Filter pattern: %s", pattern)
		}
		if maxFiles > 0 {
			utils.TimestampedPrintfLn("📏 Max files: %d", maxFiles)
		}
		fmt.Printf("\n")

		if err := downloader.listOnly(pattern, maxFiles, detailed); err != nil {
			log.Fatalf("❌ List failed: %v", err)
		}
	} else {
		utils.TimestampedPrintfLn("⬇️  Starting download from s3://%s/%s", bucket, prefix)
		utils.TimestampedPrintfLn("📁 Output directory: %s", outputDir)
		if pattern != "" {
			utils.TimestampedPrintfLn("🔍 Filter pattern: %s", pattern)
		}
		if maxFiles > 0 {
			utils.TimestampedPrintfLn("📏 Max files: %d", maxFiles)
		}
		utils.TimestampedPrintfLn("🔄 Overwrite existing: %t", overwrite)
		utils.TimestampedPrintfLn("═══════════════════════════════════════\n")

		if err := downloader.downloadAll(pattern, maxFiles, overwrite); err != nil {
			log.Fatalf("❌ Download failed: %v", err)
		}
		utils.TimestampedPrintfLn("✅ Download operation completed!")
	}
}
