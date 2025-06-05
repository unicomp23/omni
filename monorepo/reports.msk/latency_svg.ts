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
  
  // Chart dimensions
  const width = 1600;
  const height = 900;
  const margin = { top: 80, right: 150, bottom: 100, left: 80 };
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
    { key: 'p50', color: '#28a745', width: 2, label: 'P50' },
    { key: 'p75', color: '#17a2b8', width: 2, label: 'P75' },
    { key: 'p90', color: '#ffc107', width: 2, label: 'P90' },
    { key: 'p95', color: '#fd7e14', width: 2, label: 'P95' },
    { key: 'p99', color: '#dc3545', width: 2, label: 'P99' },
    { key: 'p99_9', color: '#e83e8c', width: 2, label: 'P99.9' },
    { key: 'p99_99', color: '#6f42c1', width: 3, label: 'P99.99' },
    { key: 'p99_999', color: '#343a40', width: 2, label: 'P99.999' }
  ];
  
  // Generate Y-axis ticks (logarithmic)
  const yTicks = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].filter(
    tick => tick >= minValue && tick <= maxValue
  );
  
  // Generate X-axis ticks (every ~30 data points)
  const xTickInterval = Math.max(1, Math.floor(dataPoints.length / 20));
  const xTicks = dataPoints.filter((_, i) => i % xTickInterval === 0 || i === dataPoints.length - 1);
  
  // 100ms threshold line
  const thresholdY = yScale(100);
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" style="background: white;">
  <defs>
    <style>
      .chart-title { font: bold 24px Arial, sans-serif; text-anchor: middle; fill: #333; }
      .axis-title { font: bold 16px Arial, sans-serif; text-anchor: middle; fill: #666; }
      .axis-label { font: 12px Arial, sans-serif; fill: #666; }
      .grid-line { stroke: #e0e0e0; stroke-width: 1; }
      .axis-line { stroke: #333; stroke-width: 2; }
      .threshold-line { stroke: #ff0000; stroke-width: 3; stroke-dasharray: 10,5; }
      .legend-text { font: 14px Arial, sans-serif; fill: #333; }
      .legend-line { stroke-width: 3; }
    </style>
  </defs>
  
  <!-- Title -->
  <text x="${width/2}" y="40" class="chart-title">Kafka Latency Percentiles Over Time</text>
  
  <!-- Chart area background -->
  <rect x="${margin.left}" y="${margin.top}" width="${chartWidth}" height="${chartHeight}" 
        fill="none" stroke="#ddd" stroke-width="1"/>
  
  <!-- Grid lines (Y-axis) -->
  ${yTicks.map(tick => `
    <line x1="${margin.left}" y1="${margin.top + yScale(tick)}" 
          x2="${margin.left + chartWidth}" y2="${margin.top + yScale(tick)}" 
          class="grid-line"/>
  `).join('')}
  
  <!-- Grid lines (X-axis) -->
  ${xTicks.map(d => `
    <line x1="${margin.left + xScale(d.x)}" y1="${margin.top}" 
          x2="${margin.left + xScale(d.x)}" y2="${margin.top + chartHeight}" 
          class="grid-line"/>
  `).join('')}
  
  <!-- 100ms Threshold Line -->
  ${100 >= minValue && 100 <= maxValue ? `
    <line x1="${margin.left}" y1="${margin.top + thresholdY}" 
          x2="${margin.left + chartWidth}" y2="${margin.top + thresholdY}" 
          class="threshold-line"/>
    <text x="${margin.left + chartWidth - 10}" y="${margin.top + thresholdY - 5}" 
          class="axis-label" text-anchor="end" fill="#ff0000" font-weight="bold">100ms Threshold</text>
  ` : ''}
  
  <!-- Percentile lines -->
  ${percentiles.map(p => `
    <path d="${generatePath((d: any) => d[p.key])}" 
          fill="none" stroke="${p.color}" stroke-width="${p.width}" 
          transform="translate(${margin.left}, ${margin.top})"/>
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
    <text x="${margin.left - 10}" y="${margin.top + yScale(tick) + 4}" 
          class="axis-label" text-anchor="end">${tick}ms</text>
  `).join('')}
  
  <!-- X-axis labels -->
  ${xTicks.map(d => `
    <text x="${margin.left + xScale(d.x)}" y="${margin.top + chartHeight + 20}" 
          class="axis-label" text-anchor="middle">${d.hour.split('_')[0]}</text>
  `).join('')}
  
  <!-- Axis titles -->
  <text x="${margin.left + chartWidth/2}" y="${height - 20}" class="axis-title">Time (Date)</text>
  <text x="25" y="${margin.top + chartHeight/2}" class="axis-title" 
        transform="rotate(-90, 25, ${margin.top + chartHeight/2})">Latency (ms)</text>
  
  <!-- Legend -->
  <g transform="translate(${margin.left + chartWidth + 20}, ${margin.top + 20})">
    <text x="0" y="0" class="legend-text" font-weight="bold">Percentiles</text>
    ${percentiles.map((p, i) => `
      <g transform="translate(0, ${(i + 1) * 25})">
        <line x1="0" y1="0" x2="20" y2="0" stroke="${p.color}" class="legend-line"/>
        <text x="25" y="4" class="legend-text">${p.label}</text>
      </g>
    `).join('')}
    
    <!-- Stats -->
    <g transform="translate(0, ${(percentiles.length + 2) * 25})">
      <text x="0" y="0" class="legend-text" font-weight="bold">Statistics</text>
      <text x="0" y="20" class="legend-text">Hours: ${sortedData.length}</text>
      <text x="0" y="35" class="legend-text">Violations: ${sortedData.filter(d => d.stats.exceeds_threshold).length}</text>
      <text x="0" y="50" class="legend-text">Max P99.99: ${Math.max(...sortedData.map(d => d.stats.p99_99))}ms</text>
    </g>
  </g>
</svg>`;
}

async function main() {
  try {
    const filename = '../reports.msk/hourly_reports_1749083276892.jsonl';
    
    console.log('📖 Reading JSONL file...');
    const data = await readJsonlFile(filename);
    console.log(`✅ Loaded ${data.length} hourly reports`);
    
    console.log('🎨 Generating SVG chart...');
    const svgContent = generateSvgChart(data);
    
    const outputFile = 'latency_chart.svg';
    await Deno.writeTextFile(outputFile, svgContent);
    console.log(`✅ SVG chart saved to ${outputFile}`);
    
    // Print some quick stats
    const violations = data.filter(d => d.stats.exceeds_threshold).length;
    const maxP99_99 = Math.max(...data.map(d => d.stats.p99_99));
    const maxP99_999 = Math.max(...data.map(d => d.stats.p99_999));
    
    console.log('\n📈 SVG Chart Generated:');
    console.log(`   📄 File: ${outputFile}`);
    console.log(`   📏 Size: 1600x900px (vector, infinitely scalable)`);
    console.log(`   🎯 Features: Log scale, 100ms threshold, all percentiles`);
    console.log(`   📊 Data: ${data.length} hours, ${violations} violations`);
    console.log(`   🔺 Max P99.99: ${maxP99_99}ms`);
    
    console.log('\n💡 Usage Options:');
    console.log('   • Open SVG directly in browser/viewer');
    console.log('   • Convert to PNG: rsvg-convert -h 1800 latency_chart.svg > chart.png');
    console.log('   • Convert to PDF: rsvg-convert -f pdf latency_chart.svg > chart.pdf');
    console.log('   • Import into design tools (Figma, Illustrator, etc.)');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    Deno.exit(1);
  }
}

// Run if script is main module
await main();

// Make this a module
export {}; 