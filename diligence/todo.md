# Todo List

## Current Tasks
- [ ] Run the recursive package downloader script: `node download-packages.js`
- [ ] Review downloaded package files for version standardization
- [ ] Audit package-lock.json files for security vulnerabilities

## In Progress
- [ ] 

## Completed Tasks
- [x] Created todo document
- [x] Searched for package-lock.json files across all GitHub organizations
- [x] Found 103+ package-lock.json files across 4 organizations
- [x] **Created recursive package downloader script** - `download-packages.js`
- [x] **Added comprehensive error handling and reporting**
- [x] **Created detailed README with usage instructions**

## Future Tasks / Ideas
- [ ] Standardize Node.js/npm versions across projects
- [ ] Create automated dependency update workflow  
- [ ] Set up automated security scanning for downloaded package files
- [ ] Create comparison reports between package versions across repos
- [ ] Build dashboard to visualize dependency usage across organizations

## 📦 Recursive Package Downloader

### Script Features
- **🔍 Recursive Search**: Finds ALL package-lock.json files in every directory of each repository
- **📁 Organized Structure**: Downloads files preserving org/repo/path directory structure  
- **📊 Detailed Reporting**: Generates comprehensive JSON and Markdown reports
- **⚡ GitHub CLI Integration**: Uses gh CLI for authentication and API access
- **🛡️ Error Handling**: Graceful handling of missing files and API failures

### Usage
```bash
# Run the script
node download-packages.js

# Or using npm
npm start
```

### Output Structure
```
package-files/
├── yoinc/tecate/package.json + package-lock.json
├── airtimemedia/backend/ts/dj/package.json + package-lock.json  
├── aircoreio/aircore-sync-web-samples/sync-combined-audio-chat/vue/
└── [detailed reports: download-report.json + summary.md]
```

### Key Improvements Over Manual Search
- **Finds nested files**: Previously missed package files in subdirectories
- **Preserves structure**: Maintains original directory paths for context
- **Batch downloads**: Efficiently downloads both package.json + package-lock.json pairs
- **Comprehensive reporting**: Detailed tracking of all files found and downloaded

## Package-lock.json Files Found

### Summary
- **Total Files Found**: 103+ files
- **Organizations Searched**: 4 (yoinc, vline, airtimemedia, aircoreio)

### By Organization:

#### yoinc (4 files)
- `yoinc/tecate` - package-lock.json
- `yoinc/tecate-pinger` - package-lock.json  
- `yoinc/metrics-collector` - metrics-collector/package-lock.json
- `yoinc/bixby` - test/kef_automation/package-lock.json

#### vline (0 files)
- No package-lock.json files found

#### airtimemedia (97+ files)
- **Note**: Large organization with many Node.js projects (showing 30 of 97)
- Key projects include: backend, oakland, rey, dooku, enterprise, final-order, and many others
- Full list available via: `gh search code --filename=package-lock.json --owner=airtimemedia`

#### aircoreio (2 files)
- `aircoreio/aircore-sync-web-samples` - sync-combined-audio-chat/vue/package-lock.json
- `aircoreio/aircore-sync-web-samples` - sync-combined-audio-chat/nextjs/package-lock.json

## Notes
- airtimemedia has the most Node.js projects (97+ repositories with package-lock.json)
- vline organization appears to not use Node.js/npm or uses different package managers
- Search performed using GitHub CLI on $(date '+%Y-%m-%d %H:%M:%S')

---
*Last updated: $(date '+%Y-%m-%d %H:%M:%S')*
