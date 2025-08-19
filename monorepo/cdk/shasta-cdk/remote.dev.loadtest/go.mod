module loadtest

go 1.24.5

require (
	github.com/aws/aws-sdk-go v1.55.5
	github.com/google/uuid v1.6.0
	github.com/twmb/franz-go v1.19.5
	github.com/twmb/franz-go/pkg/kmsg v1.11.2
)

require (
	github.com/jmespath/go-jmespath v0.4.0 // indirect
	github.com/klauspost/compress v1.18.0 // indirect
	github.com/pierrec/lz4/v4 v4.1.22 // indirect
	golang.org/x/crypto v0.38.0 // indirect
)

replace loadtest => ./
