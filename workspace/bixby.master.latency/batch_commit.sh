#!/bin/bash
# Batch commit large number of files in chunks

BATCH_SIZE=80
REPO_ROOT="/root/repo/dev/omni"

cd "$REPO_ROOT" || exit 1

# Get all unstaged files in latency.study/
mapfile -t files < <(git status --short | grep ' workspace/bixby.master.latency/latency.study/' | awk '{print $2}')

total_files=${#files[@]}
echo "📊 Found $total_files files to commit"
echo "📦 Will create $(( (total_files + BATCH_SIZE - 1) / BATCH_SIZE )) commits"
echo ""

batch_num=1
for ((i=0; i<total_files; i+=BATCH_SIZE)); do
    # Get batch of files
    batch=("${files[@]:i:BATCH_SIZE}")
    batch_count=${#batch[@]}

    # Determine date range for this batch
    first_file=$(basename "${batch[0]}")
    last_file=$(basename "${batch[$((batch_count-1))]}")
    first_date=$(echo "$first_file" | grep -oP '\d{8}' | head -1)
    last_date=$(echo "$last_file" | grep -oP '\d{8}' | head -1)

    echo "📦 Batch $batch_num: $batch_count files ($first_date to $last_date)"

    # Stage files
    git add "${batch[@]}"

    # Commit
    git commit -m "Latency data batch $batch_num: $first_date to $last_date ($batch_count files)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"

    batch_num=$((batch_num + 1))
done

echo ""
echo "✅ Created $((batch_num - 1)) commits"
echo "🚀 Ready to push with: git push origin main"
