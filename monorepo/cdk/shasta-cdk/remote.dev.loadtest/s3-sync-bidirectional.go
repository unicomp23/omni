package main

import (
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
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
	syncInterval      = 60 * time.Second
	s3KeyPrefix       = "latency-logs/"
)

type HashType string

const (
	HashMD5    HashType = "md5"
	HashSHA256 HashType = "sha256"
)

type FileInfo struct {
	Path         string
	Size         int64
	ModTime      time.Time
	Hash         string
	HashType     HashType
	ExistsLocal  bool
	ExistsRemote bool
	LocalHash    string
	RemoteHash   string
	RemoteSize   int64
	RemoteTime   time.Time
}

type BidirectionalS3Syncer struct {
	bucket        string
	logsDir       string
	region        string
	uploader      *s3manager.Uploader
	downloader    *s3manager.Downloader
	s3Client      *s3.S3
	cleanupLocal  bool
	hashType      HashType
	downloadMode  bool
	uploadMode    bool
}

func NewBidirectionalS3Syncer(bucket, logsDir, region string, cleanupLocal bool, hashType HashType) (*BidirectionalS3Syncer, error) {
	// Create AWS session
	sess, err := session.NewSession(&aws.Config{
		Region: aws.String(region),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create AWS session: %w", err)
	}

	return &BidirectionalS3Syncer{
		bucket:       bucket,
		logsDir:      logsDir,
		region:       region,
		uploader:     s3manager.NewUploader(sess),
		downloader:   s3manager.NewDownloader(sess),
		s3Client:     s3.New(sess),
		cleanupLocal: cleanupLocal,
		hashType:     hashType,
		downloadMode: true,  // Default: enable both directions
		uploadMode:   true,
	}, nil
}

func (s *BidirectionalS3Syncer) SetSyncMode(upload, download bool) {
	s.uploadMode = upload
	s.downloadMode = download
}

func (s *BidirectionalS3Syncer) calculateFileHash(filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	switch s.hashType {
	case HashMD5:
		hasher := md5.New()
		if _, err := io.Copy(hasher, file); err != nil {
			return "", err
		}
		return hex.EncodeToString(hasher.Sum(nil)), nil
	case HashSHA256:
		hasher := sha256.New()
		if _, err := io.Copy(hasher, file); err != nil {
			return "", err
		}
		return hex.EncodeToString(hasher.Sum(nil)), nil
	default:
		return "", fmt.Errorf("unsupported hash type: %s", s.hashType)
	}
}

func (s *BidirectionalS3Syncer) getS3ObjectInfo(key string) (*FileInfo, error) {
	// Get object metadata
	headResult, err := s.s3Client.HeadObject(&s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		if strings.Contains(err.Error(), "NotFound") {
			return &FileInfo{ExistsRemote: false}, nil
		}
		return nil, err
	}

	info := &FileInfo{
		ExistsRemote: true,
		RemoteSize:   *headResult.ContentLength,
		RemoteTime:   *headResult.LastModified,
	}

	// Extract hash from metadata
	if headResult.Metadata != nil {
		if hash, exists := headResult.Metadata["file-hash"]; exists && hash != nil {
			info.RemoteHash = *hash
		}
		if hashType, exists := headResult.Metadata["hash-type"]; exists && hashType != nil {
			info.HashType = HashType(*hashType)
		}
	}

	// Fallback to ETag if no custom hash (ETag is MD5 for single-part uploads)
	if info.RemoteHash == "" && headResult.ETag != nil {
		// Remove quotes from ETag
		etag := strings.Trim(*headResult.ETag, "\"")
		if !strings.Contains(etag, "-") { // Single-part upload, ETag is MD5
			info.RemoteHash = etag
			info.HashType = HashMD5
		}
	}

	return info, nil
}

func (s *BidirectionalS3Syncer) getLocalFileInfo(filePath string) (*FileInfo, error) {
	stat, err := os.Stat(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return &FileInfo{Path: filePath, ExistsLocal: false}, nil
		}
		return nil, err
	}

	info := &FileInfo{
		Path:        filePath,
		Size:        stat.Size(),
		ModTime:     stat.ModTime(),
		ExistsLocal: true,
	}

	// Calculate hash
	hash, err := s.calculateFileHash(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to calculate hash for %s: %w", filePath, err)
	}
	
	info.LocalHash = hash
	info.Hash = hash
	info.HashType = s.hashType

	return info, nil
}

func (s *BidirectionalS3Syncer) listS3Objects() ([]string, error) {
	var keys []string
	
	input := &s3.ListObjectsV2Input{
		Bucket: aws.String(s.bucket),
		Prefix: aws.String(s3KeyPrefix),
	}

	err := s.s3Client.ListObjectsV2Pages(input, func(page *s3.ListObjectsV2Output, lastPage bool) bool {
		for _, obj := range page.Contents {
			if obj.Key != nil && strings.HasSuffix(strings.ToLower(*obj.Key), ".gz") {
				keys = append(keys, *obj.Key)
			}
		}
		return !lastPage
	})

	return keys, err
}

func (s *BidirectionalS3Syncer) listLocalFiles() ([]string, error) {
	var files []string
	
	// Check if logs directory exists
	if _, err := os.Stat(s.logsDir); os.IsNotExist(err) {
		return files, nil
	}

	err := filepath.Walk(s.logsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if !info.IsDir() && strings.HasSuffix(strings.ToLower(info.Name()), ".gz") {
			files = append(files, path)
		}

		return nil
	})

	return files, err
}

func (s *BidirectionalS3Syncer) uploadFile(localPath, s3Key string, fileInfo *FileInfo) error {
	file, err := os.Open(localPath)
	if err != nil {
		return fmt.Errorf("failed to open file %s: %w", localPath, err)
	}
	defer file.Close()

	timestampedPrintf("⬆️  Uploading %s to s3://%s/%s (size: %.2f MB, %s: %s)", 
		filepath.Base(localPath), s.bucket, s3Key, 
		float64(fileInfo.Size)/(1024*1024), s.hashType, fileInfo.Hash[:8]+"...")

	startTime := time.Now()
	
	// Upload with hash metadata
	result, err := s.uploader.Upload(&s3manager.UploadInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s3Key),
		Body:   file,
		Metadata: map[string]*string{
			"original-filename": aws.String(filepath.Base(localPath)),
			"upload-time":       aws.String(time.Now().UTC().Format(time.RFC3339)),
			"source-host":       aws.String(getHostname()),
			"file-size":         aws.String(fmt.Sprintf("%d", fileInfo.Size)),
			"file-hash":         aws.String(fileInfo.Hash),
			"hash-type":         aws.String(string(s.hashType)),
		},
		ContentType:     aws.String("application/gzip"),
		ContentEncoding: aws.String("gzip"),
		StorageClass:    aws.String("STANDARD_IA"),
	})
	
	uploadDuration := time.Since(startTime)
	
	if err != nil {
		return fmt.Errorf("failed to upload file: %w", err)
	}

	uploadSpeedMBps := (float64(fileInfo.Size) / (1024 * 1024)) / uploadDuration.Seconds()
	timestampedPrintf("✅ Upload completed in %v (%.2f MB/s): %s", 
		uploadDuration, uploadSpeedMBps, result.Location)

	return nil
}

func (s *BidirectionalS3Syncer) downloadFile(s3Key, localPath string, remoteInfo *FileInfo) error {
	// Create directory if needed
	dir := filepath.Dir(localPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", dir, err)
	}

	file, err := os.Create(localPath)
	if err != nil {
		return fmt.Errorf("failed to create file %s: %w", localPath, err)
	}
	defer file.Close()

	timestampedPrintf("⬇️  Downloading s3://%s/%s to %s (size: %.2f MB)", 
		s.bucket, s3Key, filepath.Base(localPath), 
		float64(remoteInfo.RemoteSize)/(1024*1024))

	startTime := time.Now()
	
	// Download file
	_, err = s.downloader.Download(file, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s3Key),
	})
	
	downloadDuration := time.Since(startTime)
	
	if err != nil {
		os.Remove(localPath) // Clean up partial file
		return fmt.Errorf("failed to download file: %w", err)
	}

	downloadSpeedMBps := (float64(remoteInfo.RemoteSize) / (1024 * 1024)) / downloadDuration.Seconds()
	timestampedPrintf("✅ Download completed in %v (%.2f MB/s)", 
		downloadDuration, downloadSpeedMBps)

	// Verify hash if available
	if remoteInfo.RemoteHash != "" {
		localInfo, err := s.getLocalFileInfo(localPath)
		if err != nil {
			timestampedPrintf("⚠️  Warning: Could not verify download hash: %v", err)
		} else if localInfo.Hash != remoteInfo.RemoteHash {
			timestampedPrintf("❌ Hash verification failed! Local: %s, Remote: %s", 
				localInfo.Hash[:8]+"...", remoteInfo.RemoteHash[:8]+"...")
			return fmt.Errorf("hash verification failed after download")
		} else {
			timestampedPrintf("✅ Hash verification passed: %s", localInfo.Hash[:8]+"...")
		}
	}

	return nil
}

func (s *BidirectionalS3Syncer) syncFile(localPath, s3Key string) error {
	// Get local file info
	localInfo, err := s.getLocalFileInfo(localPath)
	if err != nil {
		return fmt.Errorf("failed to get local file info: %w", err)
	}

	// Get S3 object info
	remoteInfo, err := s.getS3ObjectInfo(s3Key)
	if err != nil {
		return fmt.Errorf("failed to get S3 object info: %w", err)
	}

	// Merge information
	fileInfo := &FileInfo{
		Path:         localPath,
		ExistsLocal:  localInfo.ExistsLocal,
		ExistsRemote: remoteInfo.ExistsRemote,
		LocalHash:    localInfo.Hash,
		RemoteHash:   remoteInfo.RemoteHash,
		Size:         localInfo.Size,
		RemoteSize:   remoteInfo.RemoteSize,
		ModTime:      localInfo.ModTime,
		RemoteTime:   remoteInfo.RemoteTime,
		Hash:         localInfo.Hash,
		HashType:     s.hashType,
	}

	timestampedPrintf("🔍 Analyzing: %s", filepath.Base(localPath))
	timestampedPrintf("   Local: exists=%t, hash=%s", fileInfo.ExistsLocal, 
		func() string {
			if fileInfo.LocalHash != "" { return fileInfo.LocalHash[:8] + "..." }
			return "none"
		}())
	timestampedPrintf("   Remote: exists=%t, hash=%s", fileInfo.ExistsRemote,
		func() string {
			if fileInfo.RemoteHash != "" { return fileInfo.RemoteHash[:8] + "..." }
			return "none"
		}())

	// Sync decision logic
	switch {
	case !fileInfo.ExistsLocal && !fileInfo.ExistsRemote:
		timestampedPrintf("⏭️  File doesn't exist locally or remotely")
		return nil

	case fileInfo.ExistsLocal && !fileInfo.ExistsRemote:
		if s.uploadMode {
			timestampedPrintf("⬆️  Local file exists, remote doesn't - uploading")
			return s.uploadFile(localPath, s3Key, fileInfo)
		} else {
			timestampedPrintf("⏭️  Upload disabled - skipping local-only file")
			return nil
		}

	case !fileInfo.ExistsLocal && fileInfo.ExistsRemote:
		if s.downloadMode {
			timestampedPrintf("⬇️  Remote file exists, local doesn't - downloading")
			return s.downloadFile(s3Key, localPath, remoteInfo)
		} else {
			timestampedPrintf("⏭️  Download disabled - skipping remote-only file")
			return nil
		}

	case fileInfo.ExistsLocal && fileInfo.ExistsRemote:
		// Both exist - compare hashes
		if fileInfo.LocalHash == fileInfo.RemoteHash && fileInfo.LocalHash != "" {
			timestampedPrintf("✅ Files are identical (hash match)")
			
			// Cleanup local file if enabled and hashes match
			if s.cleanupLocal {
				if err := os.Remove(localPath); err != nil {
					timestampedPrintf("⚠️  Warning: failed to remove local file: %v", err)
				} else {
					timestampedPrintf("🗑️  Removed identical local file")
				}
			}
			return nil
		}

		// Hashes don't match or unavailable - decide based on modification time
		if fileInfo.ModTime.After(fileInfo.RemoteTime) {
			if s.uploadMode {
				timestampedPrintf("⬆️  Local file is newer - uploading")
				return s.uploadFile(localPath, s3Key, fileInfo)
			} else {
				timestampedPrintf("⏭️  Upload disabled - local file is newer but not uploading")
				return nil
			}
		} else {
			if s.downloadMode {
				timestampedPrintf("⬇️  Remote file is newer - downloading")
				return s.downloadFile(s3Key, localPath, remoteInfo)
			} else {
				timestampedPrintf("⏭️  Download disabled - remote file is newer but not downloading")
				return nil
			}
		}
	}

	return nil
}

func (s *BidirectionalS3Syncer) scanAndSync() error {
	timestampedPrintf("🔍 Starting bidirectional sync scan...")
	timestampedPrintf("   Upload mode: %t, Download mode: %t", s.uploadMode, s.downloadMode)
	
	// Get all local files
	localFiles, err := s.listLocalFiles()
	if err != nil {
		return fmt.Errorf("failed to list local files: %w", err)
	}

	// Get all remote files
	remoteKeys, err := s.listS3Objects()
	if err != nil {
		return fmt.Errorf("failed to list S3 objects: %w", err)
	}

	// Create a map of all unique files (union of local and remote)
	allFiles := make(map[string]bool)
	
	// Add local files
	for _, localPath := range localFiles {
		relPath, err := filepath.Rel(s.logsDir, localPath)
		if err != nil {
			relPath = filepath.Base(localPath)
		}
		s3Key := s3KeyPrefix + relPath
		allFiles[s3Key] = true
	}
	
	// Add remote files
	for _, s3Key := range remoteKeys {
		allFiles[s3Key] = true
	}

	if len(allFiles) == 0 {
		timestampedPrintf("📂 No .gz files found locally or remotely")
		return nil
	}

	timestampedPrintf("📋 Found %d unique files to analyze", len(allFiles))

	// Process each unique file
	successCount := 0
	errorCount := 0
	
	for s3Key := range allFiles {
		// Convert S3 key back to local path
		relPath := strings.TrimPrefix(s3Key, s3KeyPrefix)
		localPath := filepath.Join(s.logsDir, relPath)
		
		timestampedPrintf("🔄 Processing: %s", filepath.Base(localPath))
		
		if err := s.syncFile(localPath, s3Key); err != nil {
			timestampedPrintf("❌ Failed to sync %s: %v", filepath.Base(localPath), err)
			errorCount++
		} else {
			successCount++
		}
	}

	timestampedPrintf("📊 Sync summary: %d successful, %d errors", successCount, errorCount)
	return nil
}

func (s *BidirectionalS3Syncer) runContinuous() {
	timestampedPrintf("🚀 Starting continuous bidirectional S3 sync service")
	timestampedPrintf("📍 Bucket: s3://%s", s.bucket)
	timestampedPrintf("📁 Local directory: %s", s.logsDir)
	timestampedPrintf("🕐 Sync interval: %v", syncInterval)
	timestampedPrintf("🔄 Upload mode: %t, Download mode: %t", s.uploadMode, s.downloadMode)
	timestampedPrintf("🔐 Hash algorithm: %s", s.hashType)
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

func (s *BidirectionalS3Syncer) runOnce() error {
	timestampedPrintf("🔄 Running one-time bidirectional S3 sync")
	timestampedPrintf("📍 Bucket: s3://%s", s.bucket)
	timestampedPrintf("📁 Local directory: %s", s.logsDir)
	timestampedPrintf("🔄 Upload mode: %t, Download mode: %t", s.uploadMode, s.downloadMode)
	timestampedPrintf("🔐 Hash algorithm: %s", s.hashType)
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
	fmt.Printf(`Bidirectional S3 Sync for RedPanda Load Test Logs
════════════════════════════════════════════════

Usage: %s [OPTIONS]

OPTIONS:
  -bucket string     S3 bucket name (default: %s)
  -logs string       Local logs directory (default: %s)
  -region string     AWS region (default: %s)
  -hash string       Hash algorithm: md5|sha256 (default: sha256)
  -cleanup           Remove local files after successful upload (default: false)
  -upload-only       Only upload, don't download (default: bidirectional)
  -download-only     Only download, don't upload (default: bidirectional)
  -once              Run sync once and exit (default: run continuously)
  -help              Show this help message

ENVIRONMENT VARIABLES:
  S3_BUCKET         Override default bucket name
  LOGS_DIR          Override default logs directory  
  AWS_REGION        Override default AWS region
  HASH_TYPE         Hash algorithm (md5|sha256)
  CLEANUP_LOCAL     Set to 'true' to enable local file cleanup
  UPLOAD_ONLY       Set to 'true' for upload-only mode
  DOWNLOAD_ONLY     Set to 'true' for download-only mode
  SYNC_ONCE         Set to 'true' to run once instead of continuously

SYNC MODES:
  Bidirectional     Both upload and download (default)
  Upload-only       Only upload local files to S3
  Download-only     Only download S3 files to local

HASH-BASED SYNC:
  • Files are compared using %s hashes for integrity
  • Identical files (same hash) are skipped
  • Different files sync based on modification time
  • Hash verification on downloads ensures data integrity

EXAMPLES:
  # Bidirectional sync with SHA256 hashes
  %s

  # Upload-only mode with cleanup
  %s -upload-only -cleanup

  # Download-only mode (useful for analysis instances)
  %s -download-only

  # One-time sync with MD5 hashes
  %s -hash md5 -once

  # Custom bucket and hash algorithm
  %s -bucket my-bucket -hash sha256 -cleanup
`, os.Args[0], defaultBucketName, defaultLogsDir, defaultRegion, 
   string(HashSHA256), os.Args[0], os.Args[0], os.Args[0], os.Args[0], os.Args[0])
}

func main() {
	// Parse command line arguments
	var (
		bucket       = getEnvOrDefault("S3_BUCKET", defaultBucketName)
		logsDir      = getEnvOrDefault("LOGS_DIR", defaultLogsDir)
		region       = getEnvOrDefault("AWS_REGION", defaultRegion)
		hashType     = HashType(getEnvOrDefault("HASH_TYPE", string(HashSHA256)))
		cleanupLocal = strings.ToLower(getEnvOrDefault("CLEANUP_LOCAL", "false")) == "true"
		uploadOnly   = strings.ToLower(getEnvOrDefault("UPLOAD_ONLY", "false")) == "true"
		downloadOnly = strings.ToLower(getEnvOrDefault("DOWNLOAD_ONLY", "false")) == "true"
		runOnce      = strings.ToLower(getEnvOrDefault("SYNC_ONCE", "false")) == "true"
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
		case "-hash":
			if i+1 < len(os.Args[1:]) {
				hashType = HashType(os.Args[i+2])
			}
		case "-cleanup":
			cleanupLocal = true
		case "-upload-only":
			uploadOnly = true
		case "-download-only":
			downloadOnly = true
		case "-once":
			runOnce = true
		case "-help", "--help", "-h":
			printUsage()
			return
		}
	}

	// Validate hash type
	if hashType != HashMD5 && hashType != HashSHA256 {
		log.Fatalf("❌ Invalid hash type: %s (must be md5 or sha256)", hashType)
	}

	// Validate sync mode
	if uploadOnly && downloadOnly {
		log.Fatalf("❌ Cannot specify both -upload-only and -download-only")
	}

	fmt.Printf("RedPanda Load Test - Bidirectional S3 Sync with Hash Verification\n")
	fmt.Printf("═══════════════════════════════════════════════════════════════\n\n")

	// Create syncer
	syncer, err := NewBidirectionalS3Syncer(bucket, logsDir, region, cleanupLocal, hashType)
	if err != nil {
		log.Fatalf("❌ Failed to create S3 syncer: %v", err)
	}

	// Set sync mode
	if uploadOnly {
		syncer.SetSyncMode(true, false)
	} else if downloadOnly {
		syncer.SetSyncMode(false, true)
	}
	// Default is bidirectional (true, true)

	// Run sync
	if runOnce {
		if err := syncer.runOnce(); err != nil {
			log.Fatalf("❌ Sync failed: %v", err)
		}
		timestampedPrintf("✅ One-time bidirectional sync completed!")
	} else {
		syncer.runContinuous()
	}
} 