GOARCH ?= amd64
GOOS ?= linux
GOHOSTARCH = $(shell go env GOHOSTARCH)
GOHOSTOS = $(shell go env GOHOSTOS)
AppName ?= producer

.PHONY: all
all: build-amd64 build-arm64

.PHONY: local
local: GOARCH = ${GOHOSTARCH}
local: GOOS = ${GOHOSTOS}
local: build

.PHONY: build-amd64
build-amd64:
	GOOS=${GOOS} GOARCH=amd64 go build -v -o bin/${AppName}-${GOOS}-amd64 \
	  -ldflags="-X main.AppName=${AppName}" ./...

.PHONY: build-arm64
build-arm64:
	GOOS=${GOOS} GOARCH=arm64 go build -v -o bin/${AppName}-${GOOS}-arm64 \
	  -ldflags="-X main.AppName=${AppName}" ./...

.PHONY: build
build:  ## Build a version
	GOOS=${GOOS} GOARCH=${GOARCH} go build -v -o bin/${AppName}-${GOOS}-${GOARCH} \
	  -ldflags="-X main.AppName=${AppName}" ./...
