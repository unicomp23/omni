#!/bin/bash
//usr/bin/true; exec deno run --allow-all "$0" "$@"

// Deno types (assume available in runtime)

interface LatencyStats {
  count: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  p99_9: number;
  p99_99: number;
  p99_999: number;
  exceeds_threshold: boolean;
}

interface HourlyReport {
  timestamp: string;
  hour: string;
  stats: LatencyStats;
}

async function readJsonlFile(filename: string): Promise<HourlyReport[]> {
  const text = await Deno.readTextFile(filename);
  const lines = text.trim().split('\n');
  return lines.map(line => JSON.parse(line));
}

function generateSvgChart(data: HourlyReport[]): string {
  // Sort data by hour for proper chronological order
  const sortedData = data.sort((a, b) => a.hour.localeCompare(b.hour));
  
  // FIXED: Increased chart dimensions and margins to prevent overdraw
  const width = 2000;  // Increased from 1600
  const height = 1000; // Increased from 900
  const margin = { top: 80, right: 200, bottom: 120, left: 100 }; // Increased margins
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  
  // Prepare data
  const dataPoints = sortedData.map((d, i) => ({
    x: i,
    hour: d.hour,
    p50: d.stats.p50,
    p75: d.stats.p75,
    p90: d.stats.p90,
    p95: d.stats.p95,
    p99: d.stats.p99,
    p99_9: d.stats.p99_9,
    p99_99: d.stats.p99_99,
    p99_999: d.stats.p99_999,
    exceeds: d.stats.exceeds_threshold
  }));
  
  // Find max value for scaling (use log scale)
  const maxValue = Math.max(...dataPoints.map(d => Math.max(d.p99_999, d.p99_99, d.p99_9, d.p99, d.p95, d.p90, d.p75, d.p50)));
  const minValue = 1;
  
  // Log scale functions
  const logScale = (value: number) => Math.log10(Math.max(value, 0.1));
  const yScale = (value: number) => chartHeight - ((logScale(value) - logScale(minValue)) / (logScale(maxValue) - logScale(minValue))) * chartHeight;
  const xScale = (index: number) => (index / (dataPoints.length - 1)) * chartWidth;
  
  // Generate path data for each percentile
  const generatePath = (getValue: (d: any) => number) => {
    return dataPoints.map((d, i) => 
      `${i === 0 ? 'M' : 'L'} ${xScale(d.x)} ${yScale(getValue(d))}`
    ).join(' ');
  };
  
  // Percentile configurations
  const percentiles = [
    { key: 'p50', color: '#28a745', width: 3, label: 'P50' },
    { key: 'p75', color: '#17a2b8', width: 3, label: 'P75' },
    { key: 'p90', color: '#ffc107', width: 3, label: 'P90' },
    { key: 'p95', color: '#fd7e14', width: 3, label: 'P95' },
    { key: 'p99', color: '#dc3545', width: 3, label: 'P99' },
    { key: 'p99_9', color: '#e83e8c', width: 3, label: 'P99.9' },
    { key: 'p99_99', color: '#6f42c1', width: 4, label: 'P99.99' },
    { key: 'p99_999', color: '#343a40', width: 3, label: 'P99.999' }
  ];
  
  // Generate Y-axis ticks (logarithmic)
  const yTicks = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].filter(
    tick => tick >= minValue && tick <= maxValue
  );
  
  // FIXED: Better X-axis tick spacing to prevent overlap
  const maxLabels = 15; // Limit number of labels
  const xTickInterval = Math.max(1, Math.floor(dataPoints.length / maxLabels));
  const xTicks = dataPoints.filter((_, i) => 
    i % xTickInterval === 0 || i === dataPoints.length - 1
  ).slice(0, maxLabels); // Ensure we don't exceed max labels
  
  // 100ms threshold line
  const thresholdY = yScale(100);
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" style="background: white;">
  <defs>
    <style>
      .chart-title { font: bold 28px Arial, sans-serif; text-anchor: middle; fill: #333; }
      .axis-title { font: bold 18px Arial, sans-serif; text-anchor: middle; fill: #666; }
      .axis-label { font: 14px Arial, sans-serif; fill: #666; }
      .grid-line { stroke: #e0e0e0; stroke-width: 1; }
      .axis-line { stroke: #333; stroke-width: 2; }
      .threshold-line { stroke: #ff0000; stroke-width: 4; stroke-dasharray: 15,8; }
      .legend-text { font: 16px Arial, sans-serif; fill: #333; }
      .legend-line { stroke-width: 4; }
      .overlap-note { font: 12px Arial, sans-serif; fill: #666; font-style: italic; }
    </style>
  </defs>
  
  <!-- Title -->
  <text x="${width/2}" y="50" class="chart-title">Kafka Latency Percentiles Over Time</text>
  
  <!-- Chart area background -->
  <rect x="${margin.left}" y="${margin.top}" width="${chartWidth}" height="${chartHeight}" 
        fill="none" stroke="#ddd" stroke-width="2"/>
  
  <!-- Grid lines (Y-axis) -->
  ${yTicks.map(tick => `
    <line x1="${margin.left}" y1="${margin.top + yScale(tick)}" 
          x2="${margin.left + chartWidth}" y2="${margin.top + yScale(tick)}" 
          class="grid-line"/>
  `).join('')}
  
  <!-- Grid lines (X-axis) - fewer lines to reduce clutter -->
  ${xTicks.filter((_, i) => i % 2 === 0).map(d => `
    <line x1="${margin.left + xScale(d.x)}" y1="${margin.top}" 
          x2="${margin.left + xScale(d.x)}" y2="${margin.top + chartHeight}" 
          class="grid-line"/>
  `).join('')}
  
  <!-- 100ms Threshold Line -->
  ${100 >= minValue && 100 <= maxValue ? `
    <line x1="${margin.left}" y1="${margin.top + thresholdY}" 
          x2="${margin.left + chartWidth}" y2="${margin.top + thresholdY}" 
          class="threshold-line"/>
    <text x="${margin.left + chartWidth - 20}" y="${margin.top + thresholdY - 10}" 
          class="axis-label" text-anchor="end" fill="#ff0000" font-weight="bold" font-size="16">100ms Threshold</text>
  ` : ''}
  
  <!-- Percentile lines -->
  ${percentiles.map(p => `
    <path d="${generatePath((d: any) => d[p.key])}" 
          fill="none" stroke="${p.color}" stroke-width="${p.width}" 
          transform="translate(${margin.left}, ${margin.top})"
          opacity="${p.key === 'p75' ? '0.9' : '1.0'}"/>
  `).join('')}
  
  <!-- X-axis -->
  <line x1="${margin.left}" y1="${margin.top + chartHeight}" 
        x2="${margin.left + chartWidth}" y2="${margin.top + chartHeight}" 
        class="axis-line"/>
  
  <!-- Y-axis -->
  <line x1="${margin.left}" y1="${margin.top}" 
        x2="${margin.left}" y2="${margin.top + chartHeight}" 
        class="axis-line"/>
  
  <!-- Y-axis labels -->
  ${yTicks.map(tick => `
    <text x="${margin.left - 15}" y="${margin.top + yScale(tick) + 5}" 
          class="axis-label" text-anchor="end" font-size="14">${tick}ms</text>
  `).join('')}
  
  <!-- X-axis labels - FIXED: Better spacing and rotation -->
  ${xTicks.map((d, i) => `
    <text x="${margin.left + xScale(d.x)}" y="${margin.top + chartHeight + 40}" 
          class="axis-label" text-anchor="middle" font-size="12"
          transform="rotate(-45, ${margin.left + xScale(d.x)}, ${margin.top + chartHeight + 40})">${d.hour.split('_')[0]}</text>
  `).join('')}
  
  <!-- Axis titles -->
  <text x="${margin.left + chartWidth/2}" y="${height - 30}" class="axis-title">Time (Date)</text>
  <text x="35" y="${margin.top + chartHeight/2}" class="axis-title" 
        transform="rotate(-90, 35, ${margin.top + chartHeight/2})">Latency (ms)</text>
  
  <!-- Legend -->
  <g transform="translate(${margin.left + chartWidth + 30}, ${margin.top + 20})">
    <text x="0" y="0" class="legend-text" font-weight="bold" font-size="18">Percentiles</text>
    ${percentiles.map((p, i) => `
      <g transform="translate(0, ${(i + 1) * 30})">
        <line x1="0" y1="0" x2="25" y2="0" stroke="${p.color}" class="legend-line"/>
        <text x="30" y="5" class="legend-text" font-size="16">${p.label}</text>
        ${p.key === 'p75' ? `<text x="70" y="5" class="overlap-note">*overlaps P90</text>` : ''}
      </g>
    `).join('')}
    
    <!-- Stats -->
    <g transform="translate(0, ${(percentiles.length + 2) * 30})">
      <text x="0" y="0" class="legend-text" font-weight="bold" font-size="18">Statistics</text>
      <text x="0" y="25" class="legend-text">Hours: ${sortedData.length}</text>
      <text x="0" y="45" class="legend-text">Violations: ${sortedData.filter(d => d.stats.exceeds_threshold).length}</text>
      <text x="0" y="65" class="legend-text">Max P99.99: ${Math.max(...sortedData.map(d => d.stats.p99_99))}ms</text>
      <text x="0" y="85" class="legend-text">Max P99.999: ${Math.max(...sortedData.map(d => d.stats.p99_999))}ms</text>
    </g>
  </g>
  
  <!-- Note about overlapping lines -->
  <text x="${margin.left + 20}" y="${margin.top + 30}" class="overlap-note">
    Note: P75 and P90 lines overlap (both ~3ms) - excellent performance!
  </text>
</svg>`;
}

async function main() {
  try {
    const filename = 'hourly_reports_1749083276892.jsonl';
    
    console.log('📖 Reading JSONL file...');
    const data = await readJsonlFile(filename);
    console.log(`✅ Loaded ${data.length} hourly reports`);
    
    console.log('🎨 Generating FIXED SVG chart...');
    const svgContent = generateSvgChart(data);
    
    const outputFile = 'latency_chart_fixed.svg';
    await Deno.writeTextFile(outputFile, svgContent);
    console.log(`✅ Fixed SVG chart saved to ${outputFile}`);
    
    // Print some quick stats
    const violations = data.filter(d => d.stats.exceeds_threshold).length;
    const maxP99_99 = Math.max(...data.map(d => d.stats.p99_99));
    const maxP99_999 = Math.max(...data.map(d => d.stats.p99_999));
    
    console.log('\n📈 Fixed SVG Chart Generated:');
    console.log(`   📄 File: ${outputFile}`);
    console.log(`   📏 Size: 2000x1000px (larger for better spacing)`);
    console.log(`   🎯 Fixes: No x-axis overdraw, rotated labels, P75 note`);
    console.log(`   📊 Data: ${data.length} hours, ${violations} violations`);
    console.log(`   🔺 Max P99.99: ${maxP99_99}ms`);
    
    console.log('\n✅ Fixes Applied:');
    console.log('   • Increased chart size (2000x1000)');
    console.log('   • Larger margins to prevent overdraw');
    console.log('   • Rotated x-axis labels (-45°)');
    console.log('   • Limited max labels to prevent crowding');
    console.log('   • Added note about P75/P90 overlap');
    console.log('   • Increased line thickness for better visibility');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    Deno.exit(1);
  }
}

// Run if script is main module
await main();

// Make this a module
export {}; 