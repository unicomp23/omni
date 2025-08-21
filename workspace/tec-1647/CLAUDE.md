# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Structure

This is a multi-repository workspace containing three interconnected projects cloned into the `repo/` directory:

- **bixby/**: C++ WebRTC media server for real-time audio/video processing
- **tecate/**: Node.js stream management services (master and stream-notifier)
- **media-ansible/**: Infrastructure-as-code for AWS deployment automation

## Build Commands

### Bixby (C++ WebRTC Server)
```bash
cd repo/bixby
make update           # Update dependencies
make clean           # Clean build artifacts
make release         # Build release version
make debug           # Build debug version
make osx-x86_64-release    # macOS build
make linux-x86_64-release  # Linux build
```

### Tecate (Node.js Services)
```bash
cd repo/tecate
nvm use              # Use Node v16.17.1
npm ci               # Install dependencies
make node-master-package-setup      # Package master service
make stream-notifier-package-setup  # Package stream-notifier
```

### Media-Ansible (Infrastructure)
```bash
cd repo/media-ansible
make update          # Update dependencies
make setup           # Setup build directory
make release         # Build for deployment
```

## Test Commands

### Bixby Tests
```bash
cd repo/bixby
build/osx-x86_64-release/test/bixbytest      # macOS tests
build/linux-x86_64-release/test/bixbytest    # Linux tests
./run-webrtc-parallel-tests.sh               # WebRTC parallel tests (macOS only)
```

### Tecate Tests
```bash
cd repo/tecate
npm test             # Run all unit tests
./test-node-master.sh           # Integration test for master
./test-stream-notifier.sh       # Integration test for stream-notifier
```

## Lint Commands

### Bixby
C++ linting (cpplint) is automatically run during the CMake build process.

### Tecate
```bash
cd repo/tecate
npm run lint         # Run ESLint
npm run lint:fix     # Auto-fix linting issues
```

## High-Level Architecture

### System Overview
This is a real-time media streaming platform with three main components:

1. **Bixby**: WebRTC media server handling client connections, media processing, and stream optimization
2. **Tecate**: Distributed stream orchestration services for registration, discovery, and lifecycle management
3. **Media-Ansible**: AWS deployment automation and infrastructure management

### Key Integration Points

- **Stream Publishing**: Client → Bixby (WebRTC) → Tecate Master (registration) → Stream Notifier (discovery)
- **Stream Subscription**: Client → Stream Notifier (discovery) → Bixby (WebRTC media delivery)
- **Infrastructure**: All components deployed via Ansible to AWS with ZooKeeper for service discovery

### Core Architectural Components

**Bixby Components**:
- `server/`: Media session management, WebRTC pipeline, and client notification
- `webrtc/`: PeerConnection handling, custom encoders/decoders, and RTP processing
- `streamoptimizer/`: Dynamic quality adaptation based on device capabilities and network conditions
- `event_report/`: Analytics and monitoring event system

**Tecate Components**:
- `src/master/`: Global stream registry with tag-based management and priority enforcement
- `src/tecate/`: Stream notifier for real-time discovery and WebSocket push notifications
- Authentication via JWT tokens for all stream operations

**Media-Ansible Components**:
- `roles/`: 100+ Ansible roles for different service deployments
- Environment-specific configurations in `group_vars/`
- AWS integration for EC2, Route53, load balancers, and monitoring

## Running Services Locally

### Bixby
```bash
cd repo/bixby
# Build first, then run the binary from build directory
./build/osx-x86_64-release/bixby/bixby -c bixby.conf
```

### Tecate Master
```bash
cd repo/tecate
nvm use
node src/master/master-server.js -c master-config.json
```

### Tecate Stream Notifier
```bash
cd repo/tecate
nvm use
node src/tecate/tecate-server.js -c stream-notifier-config.json
```

## Key Development Notes

- Bixby uses CMake and requires XCode Developer Tools on macOS
- Tecate requires Node.js v16.17.1 (use nvm for version management)
- All repositories are git submodules with media-deps and at-deps for dependencies
- WebRTC implementation includes custom video codecs (H264, VP8) and transcoders
- Stream optimization dynamically adjusts bitrate, resolution, and frame rate based on client capabilities
- The system supports tag-based stream discovery and priority-based publisher eviction
- Comprehensive monitoring and analytics are built into all components
- do not mention claude or anthropic in git commit messages
