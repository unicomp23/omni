package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/s3"
	"github.com/aws/aws-sdk-go/service/s3/s3manager"
)

const (
	defaultBucketName = "redpanda-load-test-358474168551-us-east-1"
	defaultLogsDir    = "./logs"
	defaultRegion     = "us-east-1"
	syncInterval      = 60 * time.Second // Check for new files every minute
)

type S3Syncer struct {
	bucket     string
	logsDir    string
	region     string
	uploader   *s3manager.Uploader
	s3Client   *s3.S3
	cleanupLocal bool
}

func NewS3Syncer(bucket, logsDir, region string, cleanupLocal bool) (*S3Syncer, error) {
	// Create AWS session
	sess, err := session.NewSession(&aws.Config{
		Region: aws.String(region),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create AWS session: %w", err)
	}

	return &S3Syncer{
		bucket:       bucket,
		logsDir:      logsDir,
		region:       region,
		uploader:     s3manager.NewUploader(sess),
		s3Client:     s3.New(sess),
		cleanupLocal: cleanupLocal,
	}, nil
}

func (s *S3Syncer) fileExistsInS3(key string) (bool, error) {
	_, err := s.s3Client.HeadObject(&s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		if strings.Contains(err.Error(), "NotFound") {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (s *S3Syncer) uploadFile(filePath, key string) error {
	file, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("failed to open file %s: %w", filePath, err)
	}
	defer file.Close()

	// Get file info for metadata
	fileInfo, err := file.Stat()
	if err != nil {
		return fmt.Errorf("failed to get file info: %w", err)
	}

	timestampedPrintf("📤 Uploading %s to s3://%s/%s (size: %.2f MB)", 
		filepath.Base(filePath), s.bucket, key, float64(fileInfo.Size())/(1024*1024))

	startTime := time.Now()
	
	// Upload the file
	result, err := s.uploader.Upload(&s3manager.UploadInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
		Body:   file,
		Metadata: map[string]*string{
			"original-filename": aws.String(filepath.Base(filePath)),
			"upload-time":       aws.String(time.Now().UTC().Format(time.RFC3339)),
			"source-host":       aws.String(getHostname()),
			"file-size":         aws.String(fmt.Sprintf("%d", fileInfo.Size())),
		},
		ContentType:     aws.String("application/gzip"),
		ContentEncoding: aws.String("gzip"),
		StorageClass:    aws.String("STANDARD_IA"), // Use Infrequent Access for cost optimization
	})
	
	uploadDuration := time.Since(startTime)
	
	if err != nil {
		return fmt.Errorf("failed to upload file: %w", err)
	}

	uploadSpeedMBps := (float64(fileInfo.Size()) / (1024 * 1024)) / uploadDuration.Seconds()
	timestampedPrintf("✅ Upload completed in %v (%.2f MB/s): %s", 
		uploadDuration, uploadSpeedMBps, result.Location)

	return nil
}

func (s *S3Syncer) syncFile(filePath string) error {
	// Generate S3 key (preserve directory structure if any)
	relPath, err := filepath.Rel(s.logsDir, filePath)
	if err != nil {
		relPath = filepath.Base(filePath)
	}
	
	// Use a prefix to organize files by date
	key := fmt.Sprintf("latency-logs/%s", relPath)

	// Check if file already exists in S3
	exists, err := s.fileExistsInS3(key)
	if err != nil {
		return fmt.Errorf("failed to check if file exists in S3: %w", err)
	}

	if exists {
		timestampedPrintf("⏭️  Skipping %s - already exists in S3", filepath.Base(filePath))
		
		// If cleanup is enabled and file exists in S3, remove local file
		if s.cleanupLocal {
			if err := os.Remove(filePath); err != nil {
				timestampedPrintf("⚠️  Warning: failed to remove local file %s: %v", filePath, err)
			} else {
				timestampedPrintf("🗑️  Removed local file: %s", filepath.Base(filePath))
			}
		}
		return nil
	}

	// Upload the file
	if err := s.uploadFile(filePath, key); err != nil {
		return err
	}

	// Remove local file if cleanup is enabled
	if s.cleanupLocal {
		if err := os.Remove(filePath); err != nil {
			timestampedPrintf("⚠️  Warning: failed to remove local file %s after upload: %v", filePath, err)
		} else {
			timestampedPrintf("🗑️  Removed local file after successful upload: %s", filepath.Base(filePath))
		}
	}

	return nil
}

func (s *S3Syncer) scanAndSync() error {
	timestampedPrintf("🔍 Scanning %s for .gz files...", s.logsDir)

	// Check if logs directory exists
	if _, err := os.Stat(s.logsDir); os.IsNotExist(err) {
		timestampedPrintf("📁 Logs directory %s does not exist yet", s.logsDir)
		return nil
	}

	var gzFiles []string
	
	err := filepath.Walk(s.logsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Only process .gz files
		if !info.IsDir() && strings.HasSuffix(strings.ToLower(info.Name()), ".gz") {
			gzFiles = append(gzFiles, path)
		}

		return nil
	})

	if err != nil {
		return fmt.Errorf("failed to scan logs directory: %w", err)
	}

	if len(gzFiles) == 0 {
		timestampedPrintf("📂 No .gz files found in %s", s.logsDir)
		return nil
	}

	timestampedPrintf("📋 Found %d .gz files to process", len(gzFiles))

	// Process each file
	successCount := 0
	errorCount := 0
	
	for _, filePath := range gzFiles {
		timestampedPrintf("🔄 Processing: %s", filepath.Base(filePath))
		
		if err := s.syncFile(filePath); err != nil {
			timestampedPrintf("❌ Failed to sync %s: %v", filepath.Base(filePath), err)
			errorCount++
		} else {
			successCount++
		}
	}

	timestampedPrintf("📊 Sync summary: %d successful, %d errors", successCount, errorCount)
	return nil
}

func (s *S3Syncer) runContinuous() {
	timestampedPrintf("🚀 Starting continuous S3 sync service")
	timestampedPrintf("📍 Bucket: s3://%s", s.bucket)
	timestampedPrintf("📁 Local directory: %s", s.logsDir)
	timestampedPrintf("🕐 Sync interval: %v", syncInterval)
	timestampedPrintf("🗑️  Cleanup local files: %t", s.cleanupLocal)
	timestampedPrintf("═══════════════════════════════════════\n")

	ticker := time.NewTicker(syncInterval)
	defer ticker.Stop()

	// Initial sync
	if err := s.scanAndSync(); err != nil {
		timestampedPrintf("❌ Initial sync failed: %v", err)
	}

	// Continuous sync
	for range ticker.C {
		if err := s.scanAndSync(); err != nil {
			timestampedPrintf("❌ Sync failed: %v", err)
		}
	}
}

func (s *S3Syncer) runOnce() error {
	timestampedPrintf("🔄 Running one-time S3 sync")
	timestampedPrintf("📍 Bucket: s3://%s", s.bucket)
	timestampedPrintf("📁 Local directory: %s", s.logsDir)
	timestampedPrintf("🗑️  Cleanup local files: %t", s.cleanupLocal)
	timestampedPrintf("═══════════════════════════════════════\n")

	return s.scanAndSync()
}

func getHostname() string {
	hostname, err := os.Hostname()
	if err != nil {
		return "unknown"
	}
	return hostname
}

func getEnvOrDefault(envVar, defaultValue string) string {
	if value := os.Getenv(envVar); value != "" {
		return value
	}
	return defaultValue
}

func timestampedPrintf(format string, args ...interface{}) {
	timestamp := time.Now().Format("2006-01-02 15:04:05")
	fmt.Printf("[%s] %s\n", timestamp, fmt.Sprintf(format, args...))
}

func printUsage() {
	fmt.Printf(`S3 Sync for RedPanda Load Test Logs
═══════════════════════════════════

Usage: %s [OPTIONS]

OPTIONS:
  -bucket string     S3 bucket name (default: %s)
  -logs string       Local logs directory (default: %s)
  -region string     AWS region (default: %s)
  -cleanup           Remove local files after successful upload (default: false)
  -once              Run sync once and exit (default: run continuously)
  -help              Show this help message

ENVIRONMENT VARIABLES:
  S3_BUCKET         Override default bucket name
  LOGS_DIR          Override default logs directory  
  AWS_REGION        Override default AWS region
  CLEANUP_LOCAL     Set to 'true' to enable local file cleanup
  SYNC_ONCE         Set to 'true' to run once instead of continuously

EXAMPLES:
  # Run continuously with default settings
  %s

  # Run once with custom bucket and cleanup enabled
  %s -bucket my-custom-bucket -cleanup -once

  # Run with custom logs directory
  %s -logs /var/log/redpanda -region us-west-2

  # Use environment variables
  export S3_BUCKET=my-bucket
  export CLEANUP_LOCAL=true
  %s
`, os.Args[0], defaultBucketName, defaultLogsDir, defaultRegion, os.Args[0], os.Args[0], os.Args[0], os.Args[0])
}

func main() {
	// Parse command line arguments (simple parsing)
	var (
		bucket      = getEnvOrDefault("S3_BUCKET", defaultBucketName)
		logsDir     = getEnvOrDefault("LOGS_DIR", defaultLogsDir)
		region      = getEnvOrDefault("AWS_REGION", defaultRegion)
		cleanupLocal = strings.ToLower(getEnvOrDefault("CLEANUP_LOCAL", "false")) == "true"
		runOnce     = strings.ToLower(getEnvOrDefault("SYNC_ONCE", "false")) == "true"
	)

	// Simple argument parsing
	for i, arg := range os.Args[1:] {
		switch arg {
		case "-bucket":
			if i+1 < len(os.Args[1:]) {
				bucket = os.Args[i+2]
			}
		case "-logs":
			if i+1 < len(os.Args[1:]) {
				logsDir = os.Args[i+2]
			}
		case "-region":
			if i+1 < len(os.Args[1:]) {
				region = os.Args[i+2]
			}
		case "-cleanup":
			cleanupLocal = true
		case "-once":
			runOnce = true
		case "-help", "--help", "-h":
			printUsage()
			return
		}
	}

	fmt.Printf("RedPanda Load Test - S3 Log Syncer\n")
	fmt.Printf("═══════════════════════════════════\n\n")

	// Create syncer
	syncer, err := NewS3Syncer(bucket, logsDir, region, cleanupLocal)
	if err != nil {
		log.Fatalf("❌ Failed to create S3 syncer: %v", err)
	}

	// Run sync
	if runOnce {
		if err := syncer.runOnce(); err != nil {
			log.Fatalf("❌ Sync failed: %v", err)
		}
		timestampedPrintf("✅ One-time sync completed!")
	} else {
		syncer.runContinuous()
	}
} 