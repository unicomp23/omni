# Package Files Downloader

A collection of scripts to download and extract `package.json` and `package-lock.json` files from all your GitHub organizations and repositories while preserving their directory structure.

## 🆕 **Recommended Approach: Bash Scripts (Fast & No Rate Limits)**

The bash scripts clone repositories locally and search with native file system commands - **much faster** than API calls and **no rate limiting**!

## Methods Available

### 🚀 **Method 1: Bash Scripts (Recommended)**
- **Fast**: Local file system operations
- **No rate limits**: Avoids GitHub API limitations  
- **Complete**: Clones entire repositories for comprehensive analysis
- **Parallel**: Batch processing for speed
- **Robust**: Handles timeouts and errors gracefully

### 🐌 **Method 2: Node.js API Script (Alternative)**  
- **Selective**: Downloads only package files via GitHub API
- **Rate limited**: Subject to GitHub search API limits
- **Lighter**: No full repository clones needed

## Features

🔍 **Recursive Search**: Finds ALL package files in every directory of each repository  
📁 **Organized Structure**: Preserves the `org/repo/path` directory structure  
📊 **Detailed Reporting**: Generates comprehensive JSON and Markdown reports  
⚡ **GitHub CLI Integration**: Uses `gh` CLI for authentication and access  
🛡️ **Error Handling**: Graceful handling of missing files and failures  
🏃‍♂️ **Parallel Processing**: Batch processing for optimal performance  

## Prerequisites

- [GitHub CLI (`gh`)](https://cli.github.com/) installed and authenticated
- Node.js 14+ installed
- Access to the organizations you want to scan

## Installation

```bash
# Clone or download the script
chmod +x download-packages.js
```

## Usage

### 🚀 **Method 1: Bash Scripts (Recommended)**

#### Quick Start - Full Process
```bash
# Run complete process: clone repos + extract package files  
./run-full-process.sh
```

#### Step by Step
```bash
# Step 1: Clone all repositories (may take time depending on repo sizes)
./clone-all-repos.sh

# Step 2: Search and extract package files from cloned repos
./search-package-files.sh
```

#### Advanced Options
```bash
# Clone with custom settings
./clone-all-repos.sh --depth 5 --batch 10 --output ./my-repos

# Search in custom location
./search-package-files.sh --clone-dir ./my-repos --output-dir ./my-packages

# Get help
./clone-all-repos.sh --help
./search-package-files.sh --help
```

### 🐌 **Method 2: Node.js API Script (Alternative)**

#### Quick Start
```bash
node download-packages.js
```

#### Using npm scripts
```bash
npm start          # API-based download (rate limited)
npm run clone      # Full clone approach  
```

## How It Works

1. **Fetches Organizations**: Gets all orgs you belong to using `gh org list`
2. **Lists Repositories**: For each org, gets all repositories using `gh repo list`
3. **Recursive Search**: Uses `gh search code` to find ALL `package-lock.json` files in each repo
4. **Smart Download**: For each `package-lock.json` found, also tries to download the corresponding `package.json` from the same directory
5. **Preserves Structure**: Maintains the original directory structure: `./package-files/org/repo/path/to/file.json`
6. **Generates Reports**: Creates detailed JSON and human-readable Markdown reports

## Output Structure

### Bash Scripts Output
```
cloned-repos/                 # Full repository clones
├── yoinc/
│   ├── tecate/              # Complete repo with history
│   ├── metrics-collector/
│   └── ...
└── airtimemedia/
    ├── backend/
    ├── oakland/
    └── ...

package-files/               # Extracted package files only
├── yoinc/
│   ├── tecate/
│   │   ├── package.json
│   │   └── package-lock.json
│   └── metrics-collector/
│       └── metrics-collector/
│           ├── package.json
│           └── package-lock.json
├── airtimemedia/
│   ├── backend/
│   │   └── ts/dj/
│   │       ├── package.json
│   │       └── package-lock.json
│   └── oakland/
│       ├── package.json
│       └── package-lock.json

# Reports generated
├── clone-summary.txt         # Clone results summary  
├── clone-log.txt            # Detailed clone log
├── package-search-summary.txt # Search results summary
├── package-search-report.json # JSON report
├── package-files-list.txt   # Complete file list
└── search-log.txt          # Detailed search log
```

### Node.js Script Output  
```
package-files/               # Only package files (no full repos)
├── [same structure as above]
├── download-report.json     # Detailed JSON report
└── summary.md              # Human-readable summary
```

## Reports Generated

### 1. Detailed JSON Report (`download-report.json`)
Contains complete information about:
- All organizations processed
- Every repository scanned
- Each file downloaded with full paths
- Error details for failed downloads

### 2. Summary Markdown Report (`summary.md`)
Human-readable overview including:
- Overall statistics
- Breakdown by organization
- List of Node.js repositories found
- Specific files downloaded per repository

## Example Output

```
[2025-01-07T20:43:30.123Z] 🚀 Starting package files download process...
[2025-01-07T20:43:30.234Z] Fetching organizations...
[2025-01-07T20:43:30.456Z] Found 4 organizations: yoinc, vline, airtimemedia, aircoreio

=== Processing Organization: yoinc ===
[2025-01-07T20:43:31.123Z] Fetching repositories for organization: yoinc
[2025-01-07T20:43:31.234Z] Found 15 repositories in yoinc

--- Processing yoinc/tecate ---
[2025-01-07T20:43:31.345Z] Searching for package-lock.json files in yoinc/tecate...
[2025-01-07T20:43:31.456Z] Found 1 package-lock.json file(s) in yoinc/tecate: package-lock.json
[2025-01-07T20:43:31.567Z] Downloading package-lock.json from yoinc/tecate...
[2025-01-07T20:43:31.678Z] ✓ Downloaded package-lock.json to ./package-files/yoinc/tecate/package-lock.json
[2025-01-07T20:43:31.789Z] Downloading package.json from yoinc/tecate...
[2025-01-07T20:43:31.890Z] ✓ Downloaded package.json to ./package-files/yoinc/tecate/package.json
[2025-01-07T20:43:31.901Z] ✅ Repository yoinc/tecate processed: 1 lock files, 1 package files downloaded

✅ Recursive download process completed!
📁 Files downloaded to: /root/repo/dev/omni/diligence/package-files
📊 Summary: 25 package.json + 30 package-lock.json files
🔍 Method: Recursively searched all directories in each repository
```

## Rate Limiting

The script includes:
- 200ms delay between repository processing
- Proper error handling for API rate limits
- GitHub CLI handles authentication and rate limiting

## Troubleshooting

### GitHub CLI Not Authenticated
```bash
gh auth login
```

### Permission Denied
Make sure you have access to the organizations and repositories:
```bash
gh org list
gh repo list ORG_NAME
```

### Rate Limiting
The script is already configured with appropriate delays. If you hit rate limits, the GitHub CLI will handle retries.

## Customization

You can modify the script to:
- Change the base directory for downloads (modify `baseDir`)
- Adjust the delay between requests (modify `setTimeout` value)
- Filter specific file types or repositories
- Add additional file patterns to search for

## Requirements

- Node.js 14.0.0 or higher
- GitHub CLI authenticated with appropriate permissions
- Network access to GitHub API
