package utils

import (
	"fmt"
	"log"
	"time"
)

// TimestampedPrintf prints a message with a timestamp prefix
func TimestampedPrintf(format string, args ...interface{}) {
	timestamp := time.Now().Format("2006-01-02 15:04:05")
	fmt.Printf("[%s] %s", timestamp, fmt.Sprintf(format, args...))
}

// TimestampedPrintfLn prints a message with a timestamp prefix and adds a newline
func TimestampedPrintfLn(format string, args ...interface{}) {
	timestamp := time.Now().Format("2006-01-02 15:04:05")
	fmt.Printf("[%s] %s\n", timestamp, fmt.Sprintf(format, args...))
}

// TimestampedLogf logs a message with a timestamp (log.Printf already includes timestamps but this ensures consistency)
func TimestampedLogf(format string, args ...interface{}) {
	timestamp := time.Now().Format("2006-01-02 15:04:05")
	log.Printf("[%s] %s", timestamp, fmt.Sprintf(format, args...))
}
