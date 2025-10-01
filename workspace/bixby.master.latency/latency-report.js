#!/usr/bin/env node
const fs = require('fs/promises');
const path = require('path');

const DEFAULT_TARGET = path.join(process.cwd(), 'latency.study');
const targetDir = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_TARGET;

const latencyRegex = /latencyMs=(\d+(?:\.\d+)?)/i;
const HIGH_LATENCY_THRESHOLD = 800;

async function listJsonFiles(dir) {
  const queue = [dir];
  const files = [];

  while (queue.length > 0) {
    const current = queue.pop();
    let entries; // read this directory's entries lazily to handle permissions issues gracefully
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (err) {
      console.warn(`Skipping ${current}: ${err.message}`);
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        files.push(fullPath);
      }
    }
  }

  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function computePercentile(sortedValues, percentile) {
  if (!sortedValues.length) return null;
  if (percentile <= 0) return sortedValues[0];
  if (percentile >= 1) return sortedValues[sortedValues.length - 1];

  const index = (sortedValues.length - 1) * percentile;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);

  if (lowerIndex === upperIndex) {
    return sortedValues[lowerIndex];
  }

  const lowerWeight = upperIndex - index;
  const upperWeight = index - lowerIndex;

  return sortedValues[lowerIndex] * lowerWeight + sortedValues[upperIndex] * upperWeight;
}

function round(value, digits = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

async function generateReport(dir) {
  const files = await listJsonFiles(dir);

  if (files.length === 0) {
    throw new Error(`No JSON files found under ${dir}`);
  }

  const latencies = [];
  let sum = 0;
  let count = 0;
  let min = Infinity;
  let max = -Infinity;
  let metaStartMs = Infinity;
  let metaEndMs = -Infinity;
  let messageStartMs = Infinity;
  let messageEndMs = -Infinity;
  let messagesSeen = 0;
  let highLatencyCount = 0;

  for (const file of files) {
    let payload;
    try {
      const contents = await fs.readFile(file, 'utf8');
      payload = JSON.parse(contents);
    } catch (err) {
      console.warn(`Skipping ${path.relative(process.cwd(), file)}: ${err.message}`);
      continue;
    }

    const meta = payload?.metadata;
    const actualRange = meta?.actualRange;

    const fromMs = actualRange?.from ? Date.parse(actualRange.from) : NaN;
    const toMs = actualRange?.to ? Date.parse(actualRange.to) : NaN;

    if (Number.isFinite(fromMs)) {
      metaStartMs = Math.min(metaStartMs, fromMs);
    }

    if (Number.isFinite(toMs)) {
      metaEndMs = Math.max(metaEndMs, toMs);
    }

    const messages = Array.isArray(payload?.messages) ? payload.messages : [];

    for (const entry of messages) {
      const messageMap = entry?.map;
      if (!messageMap) continue;

      messagesSeen += 1;

      const rawLine = messageMap._raw;
      if (typeof rawLine !== 'string') continue;

      const match = rawLine.match(latencyRegex);
      if (!match) continue;

      const latency = Number(match[1]);
      if (!Number.isFinite(latency)) continue;

      latencies.push(latency);
      sum += latency;
      count += 1;

      if (latency < min) min = latency;
      if (latency > max) max = latency;
      if (latency > HIGH_LATENCY_THRESHOLD) highLatencyCount += 1;

      const messageTimeMs = Number(messageMap._messagetime);
      if (Number.isFinite(messageTimeMs)) {
        messageStartMs = Math.min(messageStartMs, messageTimeMs);
        messageEndMs = Math.max(messageEndMs, messageTimeMs);
      }
    }
  }

  if (count === 0) {
    return {
      directory: dir,
      filesProcessed: files.length,
      messagesSeen,
      count: 0,
      error: 'No latencyMs values found in the provided JSON files.'
    };
  }

  latencies.sort((a, b) => a - b);

  const percentileDefinitions = [
    { label: 'p25', value: 0.25 },
    { label: 'p50', value: 0.5 },
    { label: 'p75', value: 0.75 },
    { label: 'p90', value: 0.9 },
    { label: 'p95', value: 0.95 },
    { label: 'p99', value: 0.99 },
    { label: 'p99_9', value: 0.999 },
    { label: 'p99_99', value: 0.9999 }
  ];

  const percentiles = {};
  for (const { label, value } of percentileDefinitions) {
    percentiles[label] = round(computePercentile(latencies, value));
  }

  const startMs = messageStartMs !== Infinity ? messageStartMs : metaStartMs;
  const endMs = messageEndMs !== -Infinity ? messageEndMs : metaEndMs;

  return {
    directory: dir,
    filesProcessed: files.length,
    messagesSeen,
    count,
    highLatencyCount,
    startTime: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
    endTime: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null,
    latency: {
      min: round(min),
      max: round(max),
      avg: round(sum / count),
      percentiles
    }
  };
}

(async function main() {
  try {
    const report = await generateReport(targetDir);
    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    console.error(err.message || err);
    process.exitCode = 1;
  }
})();
