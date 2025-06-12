#!/bin/bash
//usr/bin/true; exec deno run --allow-all "$0" "$@"

// Deno types (assume available in runtime)
declare const Deno: {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
  exit(code: number): void;
  args: string[];
  readDir(path: string): AsyncIterableIterator<{ name: string; isFile: boolean }>;
};

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

// Generic interface that can handle both minute and hourly reports
interface LatencyReport {
  timestamp: string;
  minute?: string;  // For minute-level data
  hour?: string;    // For hourly data
  stats: LatencyStats;
}

// Legacy interface for backward compatibility
interface HourlyReport extends LatencyReport {
  hour: string;
}

async function readJsonlFile(filename: string): Promise<LatencyReport[]> {
  const text = await Deno.readTextFile(filename);
  const lines = text.trim().split('\n');
  return lines.map(line => JSON.parse(line));
}

function detectDataType(data: LatencyReport[]): 'minute' | 'hour' {
  if (data.length === 0) return 'hour';
  
  // Check if the first record has minute or hour field
  if (data[0].minute) return 'minute';
  if (data[0].hour) return 'hour';
  
  // Fallback - shouldn't happen with proper data
  return 'hour';
}

function getTimeLabel(report: LatencyReport, dataType: 'minute' | 'hour'): string {
  if (dataType === 'minute' && report.minute) {
    return report.minute;
  } else if (dataType === 'hour' && report.hour) {
    return report.hour;
  }
  
  // Fallback
  return report.minute || report.hour || 'unknown';
}

function generateSvgChart(data: LatencyReport[]): { svg: string; width: number; height: number; } {
  if (data.length === 0) {
    throw new Error('No data provided to generate chart');
  }
  
  const dataType = detectDataType(data);
  const timeUnit = dataType === 'minute' ? 'minutes' : 'hours';
  const timeAxisLabel = dataType === 'minute' ? 'Time (Date_Hour:Minute)' : 'Time (Date)';
  
  // Sort data by time for proper chronological order
  const sortedData = data.sort((a, b) => {
    const timeA = getTimeLabel(a, dataType);
    const timeB = getTimeLabel(b, dataType);
    return timeA.localeCompare(timeB);
  });
  
  // DYNAMIC SIZING: Make chart much wider for minute data to show every minute (6x spacing)
  const isMinuteData = dataType === 'minute';
  const baseWidth = isMinuteData ? Math.max(24000, sortedData.length * 12) : 12000; // 12px per minute minimum (6x spacing)
  const width = Math.min(baseWidth, 300000); // Cap at 300k pixels for sanity (6x increase)
  const height = 1000;
  const margin = { 
    top: 80, 
    right: 200, 
    bottom: isMinuteData ? 180 : 120, // More space for minute labels
    left: 100 
  };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  
  console.log(`📏 Chart dimensions: ${width}x${height} (${isMinuteData ? 'extra wide with 6x spacing for minutes' : 'standard with 6x spacing'})`);
  
  // Prepare data
  const dataPoints = sortedData.map((d, i) => ({
    x: i,
    timeLabel: getTimeLabel(d, dataType),
    min: d.stats.min,
    max: d.stats.max,
    avg: d.stats.avg,
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
  const maxValue = Math.max(...dataPoints.map(d => Math.max(d.max, d.p99_99, d.p99_9, d.p99, d.p95, d.p90, d.p75, d.p50, d.avg)));
  const minValue = Math.min(...dataPoints.map(d => Math.min(d.min, 0.1)));
  
  // Log scale functions
  const logScale = (value: number) => Math.log10(Math.max(value, 0.1));
  const yScale = (value: number) => chartHeight - ((logScale(value) - logScale(minValue)) / (logScale(maxValue) - logScale(minValue))) * chartHeight;
  const xScale = (index: number) => (index / Math.max(dataPoints.length - 1, 1)) * chartWidth;
  
  // Generate path data for each percentile
  const generatePath = (getValue: (d: any) => number) => {
    return dataPoints.map((d, i) => 
      `${i === 0 ? 'M' : 'L'} ${xScale(d.x)} ${yScale(getValue(d))}`
    ).join(' ');
  };
  
  // Percentile configurations - now including min, max, avg
  const percentiles = [
    { key: 'min', color: '#20c997', width: 2, label: 'Min', opacity: '0.8' },
    { key: 'avg', color: '#6c757d', width: 3, label: 'Avg', opacity: '1.0' },
    { key: 'p50', color: '#28a745', width: 3, label: 'P50', opacity: '1.0' },
    { key: 'p75', color: '#17a2b8', width: 3, label: 'P75', opacity: '0.9' },
    { key: 'p90', color: '#ffc107', width: 3, label: 'P90', opacity: '1.0' },
    { key: 'p95', color: '#fd7e14', width: 3, label: 'P95', opacity: '1.0' },
    { key: 'p99', color: '#dc3545', width: 3, label: 'P99', opacity: '1.0' },
    { key: 'p99_9', color: '#e83e8c', width: 3, label: 'P99.9', opacity: '1.0' },
    { key: 'p99_99', color: '#6f42c1', width: 4, label: 'P99.99', opacity: '1.0' },
    { key: 'max', color: '#343a40', width: 2, label: 'Max', opacity: '0.7' }
  ];
  
  // Generate Y-axis ticks (logarithmic)
  const yTicks = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].filter(
    tick => tick >= minValue && tick <= maxValue
  );
  
  // X-AXIS LABELS: Show every minute for minute data, limited labels for hourly
  let xTicks: typeof dataPoints;
  if (isMinuteData) {
    // For minute data: show every Nth minute to prevent complete overlap
    // But show many more labels than before
    const labelInterval = Math.max(1, Math.floor(dataPoints.length / 500)); // Up to 500 labels
    xTicks = dataPoints.filter((_, i) => i % labelInterval === 0);
    console.log(`📏 Showing ${xTicks.length} minute labels (every ${labelInterval} minutes)`);
  } else {
    // For hourly data: use the existing logic
    const maxLabels = 15;
    const xTickInterval = Math.max(1, Math.floor(dataPoints.length / maxLabels));
    xTicks = dataPoints.filter((_, i) => 
      i % xTickInterval === 0 || i === dataPoints.length - 1
    ).slice(0, maxLabels);
  }
  
  // 100ms threshold line
  const thresholdY = yScale(100);
  
  // Format time label for display
  const formatTimeLabel = (timeLabel: string) => {
    if (dataType === 'minute') {
      // For minute data: "2025-06-04_15:38" -> "060425 15:38" 
      const parts = timeLabel.split('_');
      if (parts.length === 2) {
        const datePart = parts[0]; // "2025-06-04"
        const timePart = parts[1]; // "15:38"
        
        // Convert date to mmddyy format
        const dateComponents = datePart.split('-');
        if (dateComponents.length === 3) {
          const year = dateComponents[0].slice(-2); // Last 2 digits of year
          const month = dateComponents[1];
          const day = dateComponents[2];
          return `${month}${day}${year} ${timePart}`;
        }
        
        return timePart; // Fallback to just time if date parsing fails
      }
    }
    // For hourly data: show just the date part
    return timeLabel.split('_')[0];
  };
  
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" style="background: white;">
  <defs>
    <style>
      .chart-title { font: bold 28px Arial, sans-serif; text-anchor: middle; fill: #333; }
      .axis-title { font: bold 18px Arial, sans-serif; text-anchor: middle; fill: #666; }
      .axis-label { font: 14px Arial, sans-serif; fill: #666; }
      .axis-label-minute { font: 10px Arial, sans-serif; fill: #666; } /* Smaller for minute labels */
      .grid-line { stroke: #e0e0e0; stroke-width: 1; }
      .axis-line { stroke: #333; stroke-width: 2; }
      .threshold-line { stroke: #ff0000; stroke-width: 4; stroke-dasharray: 15,8; }
      .legend-text { font: 16px Arial, sans-serif; fill: #333; }
      .legend-line { stroke-width: 4; }
      .overlap-note { font: 12px Arial, sans-serif; fill: #666; font-style: italic; }
      .tooltip { 
        pointer-events: none; 
        opacity: 0; 
        transition: opacity 0.2s ease-in-out;
        font-family: monospace;
      }
      .tooltip-bg { 
        fill: rgba(255, 255, 255, 0.95); 
        stroke: #333; 
        stroke-width: 2; 
        rx: 8; 
        ry: 8;
        filter: drop-shadow(0 4px 8px rgba(0,0,0,0.2));
      }
      .tooltip-text { 
        font: 12px monospace; 
        fill: #333; 
        text-anchor: start;
      }
      .tooltip-title { 
        font: bold 14px monospace; 
        fill: #000; 
        text-anchor: start;
      }
      .tooltip-threshold { 
        font: bold 12px monospace; 
        fill: #ff0000; 
        text-anchor: start;
      }
      .color-hint { 
        stroke-width: 3; 
        rx: 2; 
        ry: 2;
      }
      .chart-overlay { 
        fill: transparent; 
        cursor: crosshair; 
      }
      .data-point { 
        fill: rgba(0,0,0,0.6); 
        stroke: white; 
        stroke-width: 1; 
        r: 3;
        opacity: 0;
        transition: opacity 0.2s ease-in-out;
      }
      .data-point.active { 
        opacity: 1; 
        r: 5;
      }
    </style>
  </defs>
  
  <!-- Title -->
  <text x="${width/2}" y="50" class="chart-title">Kafka Latency Percentiles Over Time (${timeUnit.charAt(0).toUpperCase() + timeUnit.slice(1)} Resolution)</text>
  
  <!-- Chart area background -->
  <rect x="${margin.left}" y="${margin.top}" width="${chartWidth}" height="${chartHeight}" 
        fill="none" stroke="#ddd" stroke-width="2"/>
  
  <!-- Grid lines (Y-axis) -->
  ${yTicks.map(tick => `
    <line x1="${margin.left}" y1="${margin.top + yScale(tick)}" 
          x2="${margin.left + chartWidth}" y2="${margin.top + yScale(tick)}" 
          class="grid-line"/>
  `).join('')}
  
  <!-- Grid lines (X-axis) - Show more for minute data -->
  ${(isMinuteData ? xTicks.filter((_, i) => i % 5 === 0) : xTicks.filter((_, i) => i % 2 === 0)).map(d => `
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
          opacity="${p.opacity}"/>
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
  
  <!-- X-axis labels - Different styling for minute vs hour data -->
  ${xTicks.map((d, i) => `
    <text x="${margin.left + xScale(d.x)}" y="${margin.top + chartHeight + (isMinuteData ? 50 : 40)}" 
          class="${isMinuteData ? 'axis-label-minute' : 'axis-label'}" text-anchor="middle"
          transform="rotate(-90, ${margin.left + xScale(d.x)}, ${margin.top + chartHeight + (isMinuteData ? 50 : 40)})">${formatTimeLabel(d.timeLabel)}</text>
  `).join('')}
  
  <!-- Axis titles -->
  <text x="${margin.left + chartWidth/2}" y="${height - 30}" class="axis-title">${timeAxisLabel}</text>
  <text x="35" y="${margin.top + chartHeight/2}" class="axis-title" 
        transform="rotate(-90, 35, ${margin.top + chartHeight/2})">Latency (ms)</text>
  
  <!-- Legend -->
  <g transform="translate(${margin.left + chartWidth + 30}, ${margin.top + 20})">
    <text x="0" y="0" class="legend-text" font-weight="bold" font-size="18">Percentiles</text>
    ${percentiles.map((p, i) => `
      <g transform="translate(0, ${(i + 1) * 30})">
        <line x1="0" y1="0" x2="25" y2="0" stroke="${p.color}" class="legend-line"/>
        <text x="30" y="5" class="legend-text" font-size="16">${p.label}</text>
      </g>
    `).join('')}
    
    <!-- Stats -->
    <g transform="translate(0, ${(percentiles.length + 2) * 30})">
      <text x="0" y="0" class="legend-text" font-weight="bold" font-size="18">Statistics</text>
      <text x="0" y="25" class="legend-text">${timeUnit.charAt(0).toUpperCase() + timeUnit.slice(1)}: ${sortedData.length}</text>
      <text x="0" y="45" class="legend-text">Violations: ${sortedData.filter(d => d.stats.exceeds_threshold).length}</text>
      <text x="0" y="65" class="legend-text">Overall Min: ${Math.min(...sortedData.map(d => d.stats.min))}ms</text>
      <text x="0" y="85" class="legend-text">Overall Max: ${Math.max(...sortedData.map(d => d.stats.max))}ms</text>
      <text x="0" y="105" class="legend-text">Overall Avg: ${Math.round(sortedData.reduce((sum, d) => sum + d.stats.avg, 0) / sortedData.length)}ms</text>
      <text x="0" y="125" class="legend-text">Max P99.99: ${Math.max(...sortedData.map(d => d.stats.p99_99))}ms</text>
      ${isMinuteData ? `<text x="0" y="145" class="legend-text">Chart Width: ${width}px</text>` : ''}
    </g>
  </g>
  
  <!-- Note about data resolution -->
  <text x="${margin.left + 20}" y="${margin.top + 30}" class="overlap-note">
    Resolution: ${dataType} data (${sortedData.length} data points)${isMinuteData ? ` - Wide chart for minute detail` : ''}
  </text>
  
  ${isMinuteData ? `
  <!-- Scroll hint for minute data -->
  <text x="${margin.left + 20}" y="${margin.top + 50}" class="overlap-note">
    💡 Tip: This chart is ${width}px wide - use horizontal scroll to see all minutes
  </text>
  ` : ''}
  
  <!-- Interactive data points (invisible, for hover detection) -->
  ${dataPoints.map(d => `
    <circle cx="${margin.left + xScale(d.x)}" cy="${margin.top + yScale(d.p99)}" 
            class="data-point" data-index="${d.x}"/>
  `).join('')}
  
  <!-- Chart overlay for mouse tracking -->
  <rect x="${margin.left}" y="${margin.top}" width="${chartWidth}" height="${chartHeight}" 
        class="chart-overlay" id="chartOverlay"/>
  
  <!-- Floating tooltip -->
  <g class="tooltip" id="tooltip">
    <rect class="tooltip-bg" x="0" y="0" width="280" height="320"/>
    <text class="tooltip-title" x="10" y="20" id="tooltipTitle">Data Point</text>
    <text class="tooltip-text" x="10" y="40" id="tooltipTime">Time: --</text>
    
    <!-- Min with color hint -->
    <rect class="color-hint" x="10" y="50" width="12" height="12" fill="#20c997"/>
    <text class="tooltip-text" x="27" y="60" id="tooltipMin">Min: --</text>
    
    <!-- Avg with color hint -->
    <rect class="color-hint" x="10" y="70" width="12" height="12" fill="#6c757d"/>
    <text class="tooltip-text" x="27" y="80" id="tooltipAvg">Avg: --</text>
    
    <!-- P50 with color hint -->
    <rect class="color-hint" x="10" y="90" width="12" height="12" fill="#28a745"/>
    <text class="tooltip-text" x="27" y="100" id="tooltipP50">P50: --</text>
    
    <!-- P75 with color hint -->
    <rect class="color-hint" x="10" y="110" width="12" height="12" fill="#17a2b8"/>
    <text class="tooltip-text" x="27" y="120" id="tooltipP75">P75: --</text>
    
    <!-- P90 with color hint -->
    <rect class="color-hint" x="10" y="130" width="12" height="12" fill="#ffc107"/>
    <text class="tooltip-text" x="27" y="140" id="tooltipP90">P90: --</text>
    
    <!-- P95 with color hint -->
    <rect class="color-hint" x="10" y="150" width="12" height="12" fill="#fd7e14"/>
    <text class="tooltip-text" x="27" y="160" id="tooltipP95">P95: --</text>
    
    <!-- P99 with color hint -->
    <rect class="color-hint" x="10" y="170" width="12" height="12" fill="#dc3545"/>
    <text class="tooltip-text" x="27" y="180" id="tooltipP99">P99: --</text>
    
    <!-- P99.9 with color hint -->
    <rect class="color-hint" x="10" y="190" width="12" height="12" fill="#e83e8c"/>
    <text class="tooltip-text" x="27" y="200" id="tooltipP99_9">P99.9: --</text>
    
    <!-- P99.99 with color hint -->
    <rect class="color-hint" x="10" y="210" width="12" height="12" fill="#6f42c1"/>
    <text class="tooltip-text" x="27" y="220" id="tooltipP99_99">P99.99: --</text>
    
    <!-- Max with color hint -->
    <rect class="color-hint" x="10" y="230" width="12" height="12" fill="#343a40"/>
    <text class="tooltip-text" x="27" y="240" id="tooltipMax">Max: --</text>
    
    <text class="tooltip-threshold" x="10" y="270" id="tooltipThreshold">Threshold: --</text>
    <text class="tooltip-text" x="10" y="300" id="tooltipPosition">Position: --</text>
  </g>
  
  <script type="text/javascript">
    <![CDATA[
    // Chart configuration
    const chartConfig = {
      margin: { top: ${margin.top}, right: ${margin.right}, bottom: ${margin.bottom}, left: ${margin.left} },
      chartWidth: ${chartWidth},
      chartHeight: ${chartHeight},
      dataType: "${dataType}",
      minValue: ${minValue},
      maxValue: ${maxValue}
    };
    
    // Data points for tooltip
    const dataPoints = ${JSON.stringify(dataPoints)};
    
    // Scaling functions
    function logScale(value) {
      return Math.log10(Math.max(value, 0.1));
    }
    
    function yScale(value) {
      return chartConfig.chartHeight - ((logScale(value) - logScale(chartConfig.minValue)) / (logScale(chartConfig.maxValue) - logScale(chartConfig.minValue))) * chartConfig.chartHeight;
    }
    
    function xScale(index) {
      return (index / Math.max(dataPoints.length - 1, 1)) * chartConfig.chartWidth;
    }
    
    // Format time label for display
    function formatTimeLabel(timeLabel) {
      if (chartConfig.dataType === 'minute') {
        const parts = timeLabel.split('_');
        if (parts.length === 2) {
          const datePart = parts[0];
          const timePart = parts[1];
          const dateComponents = datePart.split('-');
          if (dateComponents.length === 3) {
            const year = dateComponents[0].slice(-2);
            const month = dateComponents[1];
            const day = dateComponents[2];
            return month + '/' + day + '/' + year + ' ' + timePart;
          }
          return timePart;
        }
      }
      return timeLabel.split('_')[0];
    }
    
    // Find closest data point to mouse position
    function findClosestDataPoint(mouseX) {
      const chartMouseX = mouseX - chartConfig.margin.left;
      const relativeX = chartMouseX / chartConfig.chartWidth;
      const index = Math.round(relativeX * (dataPoints.length - 1));
      return Math.max(0, Math.min(index, dataPoints.length - 1));
    }
    
    // Update tooltip content
    function updateTooltip(dataIndex) {
      const data = dataPoints[dataIndex];
      
      document.getElementById('tooltipTitle').textContent = \`Data Point \${dataIndex + 1}/\${dataPoints.length}\`;
      document.getElementById('tooltipTime').textContent = \`Time: \${formatTimeLabel(data.timeLabel)}\`;
      document.getElementById('tooltipMin').textContent = \`Min:    \${data.min.toFixed(2)}ms\`;
      document.getElementById('tooltipAvg').textContent = \`Avg:    \${data.avg.toFixed(2)}ms\`;
      document.getElementById('tooltipP50').textContent = \`P50:    \${data.p50.toFixed(2)}ms\`;
      document.getElementById('tooltipP75').textContent = \`P75:    \${data.p75.toFixed(2)}ms\`;
      document.getElementById('tooltipP90').textContent = \`P90:    \${data.p90.toFixed(2)}ms\`;
      document.getElementById('tooltipP95').textContent = \`P95:    \${data.p95.toFixed(2)}ms\`;
      document.getElementById('tooltipP99').textContent = \`P99:    \${data.p99.toFixed(2)}ms\`;
      document.getElementById('tooltipP99_9').textContent = \`P99.9:  \${data.p99_9.toFixed(2)}ms\`;
      document.getElementById('tooltipP99_99').textContent = \`P99.99: \${data.p99_99.toFixed(2)}ms\`;
      document.getElementById('tooltipMax').textContent = \`Max:    \${data.max.toFixed(2)}ms\`;
      document.getElementById('tooltipThreshold').textContent = data.exceeds ? 'EXCEEDS 100ms THRESHOLD!' : 'Within 100ms threshold';
      document.getElementById('tooltipPosition').textContent = \`Chart: \${((dataIndex / (dataPoints.length - 1)) * 100).toFixed(1)}%\`;
    }
    
    // Position tooltip to avoid going off-screen
    function positionTooltip(mouseX, mouseY) {
      const tooltip = document.getElementById('tooltip');
      const tooltipWidth = 280;
      const tooltipHeight = 320;
      const svgWidth = ${width};
      const svgHeight = ${height};
      
      let x = mouseX + 15;
      let y = mouseY - 160;
      
      // Prevent tooltip from going off right edge
      if (x + tooltipWidth > svgWidth) {
        x = mouseX - tooltipWidth - 15;
      }
      
      // Prevent tooltip from going off top edge
      if (y < 0) {
        y = mouseY + 15;
      }
      
      // Prevent tooltip from going off bottom edge
      if (y + tooltipHeight > svgHeight) {
        y = svgHeight - tooltipHeight - 15;
      }
      
      tooltip.setAttribute('transform', \`translate(\${x}, \${y})\`);
    }
    
    // Event handlers
    const overlay = document.getElementById('chartOverlay');
    const tooltip = document.getElementById('tooltip');
    let currentDataIndex = -1;
    
    overlay.addEventListener('mousemove', function(e) {
      const rect = e.target.getBoundingClientRect();
      const svgRect = e.target.ownerSVGElement.getBoundingClientRect();
      const mouseX = e.clientX - svgRect.left;
      const mouseY = e.clientY - svgRect.top;
      
      const dataIndex = findClosestDataPoint(mouseX);
      
      if (dataIndex !== currentDataIndex) {
        // Remove active class from all data points
        document.querySelectorAll('.data-point').forEach(point => {
          point.classList.remove('active');
        });
        
        // Add active class to current data point
        const currentPoint = document.querySelector(\`[data-index="\${dataIndex}"]\`);
        if (currentPoint) {
          currentPoint.classList.add('active');
        }
        
        updateTooltip(dataIndex);
        currentDataIndex = dataIndex;
      }
      
      positionTooltip(mouseX, mouseY);
      tooltip.style.opacity = '1';
    });
    
    overlay.addEventListener('mouseleave', function() {
      tooltip.style.opacity = '0';
      currentDataIndex = -1;
      
      // Remove active class from all data points
      document.querySelectorAll('.data-point').forEach(point => {
        point.classList.remove('active');
      });
    });
    ]]>
  </script>
</svg>`;

  return { svg, width, height };
}

async function findReportFiles(): Promise<string[]> {
  const files: string[] = [];
  try {
    for await (const entry of Deno.readDir('.')) {
      if (entry.isFile && entry.name.endsWith('.jsonl') && 
          (entry.name.includes('hourly_reports') || entry.name.includes('minute_reports'))) {
        files.push(entry.name);
      }
    }
  } catch (error) {
    console.warn('Could not read directory:', error.message);
  }
  return files.sort();
}

function showHelp() {
  console.log(`
🎨 Kafka Latency SVG Chart Generator

USAGE:
  deno run --allow-all latency_svg_fixed.ts [OPTIONS] [FILENAME]

ARGUMENTS:
  FILENAME           JSONL file containing latency reports (optional)
                     If not provided, will auto-detect report files

OPTIONS:
  --help, -h         Show this help message

EXAMPLES:
  # Auto-detect and use most recent report file
  deno run --allow-all latency_svg_fixed.ts

  # Use specific minute-level report file  
  deno run --allow-all latency_svg_fixed.ts minute_reports_1749251676646.jsonl

  # Use specific hourly report file
  deno run --allow-all latency_svg_fixed.ts hourly_reports_1749083276892.jsonl

FEATURES:
  ✨ Auto-detects minute vs hourly data resolution
  📊 Displays Min, Max, Avg + all percentiles (P50-P99.99)
  📏 Dynamic chart sizing (extra wide for minute data)
  🎯 100ms threshold line with violation tracking
  📈 Logarithmic Y-axis for better visualization
  🔍 Detailed statistics in legend

OUTPUT:
  Generates an SVG file with the same base name + "_[minute|hour]_chart.svg"
`);
}

async function main() {
  try {
    let filename = '';
    
    // Check command line arguments
    if (Deno.args.length > 0) {
      // Check for help flag
      if (Deno.args[0] === '--help' || Deno.args[0] === '-h') {
        showHelp();
        Deno.exit(0);
      }
      filename = Deno.args[0];
    } else {
      // Auto-detect available report files
      console.log('🔍 No filename provided, searching for report files...');
      const availableFiles = await findReportFiles();
      
      if (availableFiles.length === 0) {
        console.error('❌ No report files found. Please provide a filename or ensure .jsonl files are in the current directory.');
        console.log('Usage: deno run --allow-all latency_svg_fixed.ts [filename.jsonl]');
        Deno.exit(1);
      }
      
      console.log(`📁 Found ${availableFiles.length} report file(s):`);
      availableFiles.forEach((file, i) => {
        console.log(`   ${i + 1}. ${file}`);
      });
      
      // Use the most recent file (last in sorted order)
      filename = availableFiles[availableFiles.length - 1];
      console.log(`📄 Using most recent file: ${filename}`);
    }
    
    console.log(`📖 Reading JSONL file: ${filename}`);
    const data = await readJsonlFile(filename);
    console.log(`✅ Loaded ${data.length} reports`);
    
    // Detect data type
    const dataType = detectDataType(data);
    const timeUnit = dataType === 'minute' ? 'minutes' : 'hours';
    console.log(`📊 Data type: ${dataType}-level data (${data.length} ${timeUnit})`);
    
    console.log(`🎨 Generating SVG chart for ${dataType} data...`);
    const { svg, width, height } = generateSvgChart(data);
    
    // Generate output filename based on input and data type
    const baseName = filename.replace('.jsonl', '');
    const outputFile = `${baseName}_${dataType}_chart.svg`;
    await Deno.writeTextFile(outputFile, svg);
    console.log(`✅ SVG chart saved to ${outputFile}`);
    
    // Print some quick stats
    const violations = data.filter(d => d.stats.exceeds_threshold).length;
    const overallMin = Math.min(...data.map(d => d.stats.min));
    const overallMax = Math.max(...data.map(d => d.stats.max));
    const overallAvg = Math.round(data.reduce((sum, d) => sum + d.stats.avg, 0) / data.length);
    const maxP99_99 = Math.max(...data.map(d => d.stats.p99_99));
    
    console.log(`\n📈 SVG Chart Generated:`);
    console.log(`   📄 File: ${outputFile}`);
    console.log(`   📏 Size: ${width}x${height}px${dataType === 'minute' ? ' (Extra Wide!)' : ''}`);
    console.log(`   📊 Data: ${data.length} ${timeUnit}, ${violations} violations`);
    console.log(`   📉 Min: ${overallMin}ms, Max: ${overallMax}ms, Avg: ${overallAvg}ms`);
    console.log(`   🔺 Max P99.99: ${maxP99_99}ms`);
    console.log(`   ⏱️  Resolution: ${dataType}-level`);
    
    if (dataType === 'minute') {
      console.log('\n⚡ Minute-level data provides high-resolution latency tracking');
      console.log(`🔍 Chart spans ${Math.floor(data.length / 60)} hours of minute-by-minute data`);
      console.log(`📏 Use horizontal scroll to explore the ${width}px wide timeline`);
    } else {
      console.log('\n📅 Hourly data provides good overview of latency trends');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log('\n💡 Use --help for usage information:');
    console.log('   deno run --allow-all latency_svg_fixed.ts --help');
    Deno.exit(1);
  }
}

// Run if script is main module
await main();

// Make this a module
export {}; 