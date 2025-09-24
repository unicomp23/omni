#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const inputPath = path.resolve(__dirname, '..', 'bucket_analysis.jsonl');
const outputDir = __dirname;

if (!fs.existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`);
  process.exit(1);
}

const rawLines = fs.readFileSync(inputPath, 'utf8')
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(Boolean);

if (!rawLines.length) {
  console.error('bucket_analysis.jsonl is empty');
  process.exit(1);
}

const records = rawLines.map((line, idx) => {
  try {
    return JSON.parse(line);
  } catch (err) {
    throw new Error(`Failed to parse JSON on line ${idx + 1}: ${err.message}`);
  }
});

const percentiles = [
  { key: 'p50_ms', label: 'p50', color: '#1f77b4' },
  { key: 'p90_ms', label: 'p90', color: '#ff7f0e' },
  { key: 'p95_ms', label: 'p95', color: '#2ca02c' },
  { key: 'p99_ms', label: 'p99', color: '#d62728' },
  { key: 'p99_9_ms', label: 'p99.9', color: '#9467bd' },
  { key: 'p99_99_ms', label: 'p99.99', color: '#8c564b' }
];

function safeJSONStringify(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/&/g, '\\u0026');
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function groupByBucketType(items) {
  return items.reduce((acc, item) => {
    const bucketType = item.bucket_type || 'unknown';
    if (!acc[bucketType]) {
      acc[bucketType] = [];
    }
    acc[bucketType].push(item);
    return acc;
  }, {});
}

const bucketsByType = groupByBucketType(records);

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatLabel(record) {
  const start = parseDate(record.start_time);
  if (start) {
    const month = `${start.getUTCMonth() + 1}`.padStart(2, '0');
    const day = `${start.getUTCDate()}`.padStart(2, '0');
    const hours = `${start.getUTCHours()}`.padStart(2, '0');
    const minutes = `${start.getUTCMinutes()}`.padStart(2, '0');
    return `${month}-${day} ${hours}:${minutes}Z`;
  }
  return `Bucket ${record.bucket_index ?? ''}`.trim();
}

function buildSvg(bucketType, data) {
  if (!data.length) {
    return '';
  }

  const sorted = data.slice().sort((a, b) => {
    const dateA = parseDate(a.start_time);
    const dateB = parseDate(b.start_time);
    if (dateA && dateB) {
      return dateA - dateB;
    }
    return (a.bucket_index ?? 0) - (b.bucket_index ?? 0);
  });

  const percentileValues = percentiles.flatMap(p => sorted
    .map(row => row[p.key])
    .filter(value => typeof value === 'number' && Number.isFinite(value))
  );

  if (!percentileValues.length) {
    console.warn(`No percentile data found for bucket type ${bucketType}`);
    return '';
  }

  const yMin = 0;
  const yDomainMax = 400;
  const yTickStep = 50;
  const hasClippedValues = percentileValues.some(value => value > yDomainMax);

  const margin = { top: 40, right: 220, bottom: 140, left: 80 };
  const chartHeight = 420;
  const pointSpacing = 160;
  const width = Math.max(900, margin.left + margin.right + pointSpacing * (sorted.length - 1));
  const height = margin.top + chartHeight + margin.bottom;
  const chartWidth = width - margin.left - margin.right;
  const chartBottom = margin.top + chartHeight;

  const yScale = value => {
    const clamped = Math.min(Math.max(value, yMin), yDomainMax);
    const ratio = (clamped - yMin) / (yDomainMax - yMin);
    return margin.top + chartHeight - ratio * chartHeight;
  };

  const xScale = index => margin.left + index * pointSpacing;

  const gridLines = [];
  for (let value = yMin; value <= yDomainMax; value += yTickStep) {
    const ratio = (value - yMin) / (yDomainMax - yMin);
    const y = margin.top + chartHeight - ratio * chartHeight;
    gridLines.push({ y, value });
  }

  const axisLines = `
    <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + chartHeight}" stroke="#555" stroke-width="1" />
    <line x1="${margin.left}" y1="${margin.top + chartHeight}" x2="${width - margin.right}" y2="${margin.top + chartHeight}" stroke="#555" stroke-width="1" />
  `;

  const gridSvg = gridLines.map(line => `
    <g>
      <line x1="${margin.left}" x2="${width - margin.right}" y1="${line.y}" y2="${line.y}" stroke="#ddd" stroke-width="1" stroke-dasharray="4 6" />
      <text x="${margin.left - 12}" y="${line.y + 4}" text-anchor="end" font-size="12">${line.value.toFixed(0)} ms</text>
    </g>
  `).join('\n');

  const xTicks = sorted.map((row, index) => {
    const x = xScale(index);
    const label = formatLabel(row);
    return `
      <g transform="translate(${x}, ${margin.top + chartHeight})">
        <line x1="0" x2="0" y1="0" y2="6" stroke="#555" />
        <text x="0" y="20" text-anchor="middle" font-size="12" transform="rotate(45)">${label}</text>
      </g>
    `;
  }).join('\n');

  const categoryOrder = Array.from(new Set(sorted.map(row => row.bucket_type || bucketType)));
  if (!categoryOrder.length) {
    categoryOrder.push(bucketType);
  }
  const categoryPriority = { '1hr': 0, '5min': 1 };
  categoryOrder.sort((a, b) => {
    const aScore = Object.prototype.hasOwnProperty.call(categoryPriority, a) ? categoryPriority[a] : 10;
    const bScore = Object.prototype.hasOwnProperty.call(categoryPriority, b) ? categoryPriority[b] : 10;
    if (aScore !== bScore) {
      return aScore - bScore;
    }
    return a.localeCompare(b);
  });

  const interactivePayload = {
    isCombined: bucketType === 'combined',
    categories: categoryOrder,
    buckets: sorted.map((row, index) => ({
      label: formatLabel(row),
      category: row.bucket_type || bucketType,
      x: xScale(index),
      values: percentiles.map(p => {
        const raw = row[p.key];
        if (typeof raw === 'number' && Number.isFinite(raw)) {
          const clipped = raw > yDomainMax;
          return {
            label: p.label,
            display: `${raw.toFixed(3)} ms${clipped ? ' (capped)' : ''}`,
            clipped
          };
        }
        return { label: p.label, display: 'n/a', clipped: false };
      })
    })),
    chart: {
      left: margin.left,
      right: width - margin.right,
      top: margin.top,
      bottom: chartBottom
    },
    viewWidth: width,
    viewHeight: height
  };

  const interactiveJson = safeJSONStringify(interactivePayload);

  const seriesSvg = percentiles.map(percentile => {
    const pathCommands = [];
    const circles = [];

    sorted.forEach((row, index) => {
      const value = row[percentile.key];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return;
      }
      const x = xScale(index);
      const y = yScale(value);
      const clipped = value > yDomainMax;
      const strokeAttrs = clipped ? ' stroke="#111" stroke-width="2"' : '';
      pathCommands.push(`${pathCommands.length ? 'L' : 'M'} ${x} ${y}`);
      const titleLabel = bucketType === 'combined'
        ? `${formatLabel(row)} (${row.bucket_type || 'unknown'})`
        : formatLabel(row);
      const tooltipContent = escapeXml([
        titleLabel,
        ...percentiles.map(p => {
          const rawVal = row[p.key];
          if (typeof rawVal === 'number' && Number.isFinite(rawVal)) {
            const clippedVal = rawVal > yDomainMax;
            return `${p.label}: ${rawVal.toFixed(3)} ms${clippedVal ? ' (capped)' : ''}`;
          }
          return `${p.label}: n/a`;
        })
      ].join('\n')).replace(/\n/g, '&#10;');
      circles.push(`<circle cx="${x}" cy="${y}" r="5" fill="${percentile.color}"${strokeAttrs}><title>${tooltipContent}</title></circle>`);
    });

    if (!pathCommands.length) {
      return '';
    }

    return `
      <g>
        <path d="${pathCommands.join(' ')}" fill="none" stroke="${percentile.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        ${circles.join('\n')}
      </g>
    `;
  }).join('\n');

  const legendItems = percentiles.map((percentile, idx) => {
    const x = width - margin.right + 20;
    const y = margin.top + idx * 24;
    return `
      <g transform="translate(${x}, ${y})">
        <rect x="0" y="-12" width="18" height="18" fill="${percentile.color}" rx="3" />
        <text x="26" y="2" font-size="13">${percentile.label}</text>
      </g>
    `;
  }).join('\n');

  const title = `Latency Percentiles (${bucketType} buckets)`;
  const footnoteParts = [];
  if (bucketType === 'combined') {
    footnoteParts.push('Filtered to 5min buckets within hours where 1hr p99.99 > 800 ms.');
  }
  footnoteParts.push(hasClippedValues
    ? 'Scale fixed to 0-400 ms (black-outlined markers indicate capped values; tooltip shows actual latency).'
    : 'Scale fixed to 0-400 ms.');
  const footnote = footnoteParts.join(' ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    text { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; fill: #222; }
    svg { background: #fff; }
    circle { cursor: pointer; }
  </style>
  <rect width="100%" height="100%" fill="#fafafa" />
  <text x="${margin.left}" y="24" font-size="20" font-weight="600">${title}</text>
  <text x="${margin.left}" y="44" font-size="13" fill="#555">Source: bucket_analysis.jsonl</text>
  ${axisLines}
  ${gridSvg}
  ${seriesSvg}
  ${xTicks}
   ${legendItems}
   <text x="${margin.left}" y="${height - 16}" font-size="12" fill="#555">${footnote}</text>
   <rect id="hover-target" x="${margin.left}" y="${margin.top}" width="${chartWidth}" height="${chartHeight}" fill="transparent" pointer-events="none" />
   <line id="hover-line" x1="${margin.left}" x2="${margin.left}" y1="${margin.top}" y2="${chartBottom}" stroke="#888" stroke-width="1" stroke-dasharray="6 6" visibility="hidden" />
   <g id="tooltip" visibility="hidden" pointer-events="none" transform="translate(0,0)">
     <rect x="0" y="0" rx="8" ry="8" fill="#ffffff" opacity="0.97" stroke="#888" stroke-opacity="0.6" stroke-width="1.2" />
     <text x="0" y="0" font-size="13" fill="#222"></text>
   </g>
   <script type="application/ecmascript"><![CDATA[
     (function() {
       var scriptEl = document.currentScript;
       if (!scriptEl) {
         var scriptNodes = document.getElementsByTagName('script');
         scriptEl = scriptNodes && scriptNodes[scriptNodes.length - 1];
       }
       if (!scriptEl) return;
       var svg = scriptEl.ownerSVGElement;
       if (!svg) return;
       const payload = ${interactiveJson};
       const buckets = payload && payload.buckets ? payload.buckets : [];
       if (!buckets.length) return;
       const isCombined = !!payload.isCombined;
       const categories = (payload.categories && payload.categories.length)
         ? payload.categories
         : [buckets[0].category || 'unknown'];
       const chart = payload.chart;
       const viewWidth = payload.viewWidth;
       const viewHeight = payload.viewHeight;
       const hoverRect = svg.getElementById('hover-target');
       const tooltip = svg.getElementById('tooltip');
       const tooltipRect = tooltip && tooltip.querySelector('rect');
       const tooltipText = tooltip && tooltip.querySelector('text');
       const hoverLine = svg.getElementById('hover-line');
       if (!hoverRect || !tooltip || !tooltipRect || !tooltipText) return;
       if (!svg.createSVGPoint || !svg.getScreenCTM) return;
       const paddingX = 14;
       const paddingY = 18;
       const svgPoint = svg.createSVGPoint();

       hoverRect.setAttribute('pointer-events', 'all');

       const bucketsByCategory = {};
       buckets.forEach(function(bucket) {
         const category = bucket.category || 'unknown';
         if (!bucketsByCategory[category]) {
           bucketsByCategory[category] = [];
         }
         bucketsByCategory[category].push(bucket);
       });

       Object.keys(bucketsByCategory).forEach(function(category) {
         bucketsByCategory[category].sort(function(a, b) {
           return a.x - b.x;
         });
       });

       const combinedCategories = categories.filter(function(category) {
         return bucketsByCategory[category] && bucketsByCategory[category].length;
       });

       function findNearestBucket(list, targetX) {
         if (!list || !list.length) return null;
         var nearest = list[0];
         var minDist = Math.abs(nearest.x - targetX);
         for (var i = 1; i < list.length; i += 1) {
           var dist = Math.abs(list[i].x - targetX);
           if (dist < minDist) {
             minDist = dist;
             nearest = list[i];
           }
         }
         return nearest;
       }

       function buildTooltipSections(pointerX) {
         if (isCombined && combinedCategories.length > 1) {
           var sections = [];
           var anchor = null;
           combinedCategories.forEach(function(category, idx) {
             var list = bucketsByCategory[category];
             if (!list || !list.length) {
               return;
             }
             var nearest = findNearestBucket(list, pointerX);
             if (!nearest) {
               return;
             }
             if (!anchor) {
               anchor = nearest;
             }
             var header = '[' + category + '] ' + nearest.label;
             sections.push({ text: header, bold: true });
             nearest.values.forEach(function(v) {
               sections.push({ text: '  ' + v.label + ': ' + v.display, bold: false });
             });
             if (idx !== combinedCategories.length - 1) {
               sections.push({ text: '', bold: false, spacer: true });
             }
           });
           return { anchor: anchor, lines: sections };
         }

         var nearestBucket = findNearestBucket(buckets, pointerX);
         if (!nearestBucket) {
           return { anchor: null, lines: [] };
         }
         var lines = [{ text: nearestBucket.label, bold: true }];
         nearestBucket.values.forEach(function(v) {
           lines.push({ text: v.label + ': ' + v.display, bold: false });
         });
         return { anchor: nearestBucket, lines: lines };
       }

       function updateTooltip(pointerX) {
           while (tooltipText.firstChild) {
             tooltipText.removeChild(tooltipText.firstChild);
           }
           var content = buildTooltipSections(pointerX);
           if (!content.anchor || !content.lines.length) {
             return null;
           }
           content.lines.forEach(function(line, index) {
             var tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
             tspan.setAttribute('x', paddingX);
             if (index === 0) {
               tspan.setAttribute('dy', '1em');
             } else if (line.spacer) {
               tspan.setAttribute('dy', '1.2em');
             } else {
               tspan.setAttribute('dy', '1.2em');
             }
             if (line.bold) {
               tspan.setAttribute('font-weight', '600');
             }
             tspan.textContent = line.text;
             tooltipText.appendChild(tspan);
           });
           const bbox = tooltipText.getBBox();
           const width = bbox.width + paddingX * 1.6;
           const height = bbox.height + paddingY;
           tooltipRect.setAttribute('width', width);
           tooltipRect.setAttribute('height', height);
           tooltipRect.setAttribute('x', 0);
           tooltipRect.setAttribute('y', 0);
           tooltipText.setAttribute('y', paddingY / 2);
           return { dims: { width: width, height: height }, anchorX: content.anchor.x };
       }

       function positionTooltip(pointer, dims) {
         var x = pointer.x + 18;
         var y = pointer.y - dims.height / 2;
         if (x + dims.width > viewWidth - 10) {
           x = viewWidth - dims.width - 10;
         }
         if (x < 10) {
           x = 10;
         }
         if (y < chart.top) {
           y = chart.top;
         }
         if (y + dims.height > chart.bottom) {
           y = chart.bottom - dims.height;
         }
         tooltip.setAttribute('transform', 'translate(' + x + ',' + y + ')');
       }

       function handleMove(evt) {
         const matrix = svg.getScreenCTM();
         if (!matrix) return;
         svgPoint.x = evt.clientX;
         svgPoint.y = evt.clientY;
         const transformed = svgPoint.matrixTransform(matrix.inverse());
         const clampedX = Math.max(chart.left, Math.min(chart.right, transformed.x));
         const result = updateTooltip(clampedX);
         if (!result || !result.dims) {
           handleLeave();
           return;
         }
         tooltip.setAttribute('visibility', 'visible');
         const pointer = {
           x: transformed.x,
           y: Math.max(chart.top, Math.min(chart.bottom, transformed.y))
         };
         positionTooltip(pointer, result.dims);
         if (hoverLine) {
           hoverLine.setAttribute('visibility', 'visible');
           const anchorX = result.anchorX != null ? result.anchorX : clampedX;
           hoverLine.setAttribute('x1', anchorX);
           hoverLine.setAttribute('x2', anchorX);
         }
       }

       function handleLeave() {
         tooltip.setAttribute('visibility', 'hidden');
         if (hoverLine) {
           hoverLine.setAttribute('visibility', 'hidden');
         }
       }

       hoverRect.addEventListener('mousemove', handleMove);
       hoverRect.addEventListener('mouseenter', handleMove);
       hoverRect.addEventListener('mouseleave', handleLeave);
       svg.addEventListener('mouseleave', handleLeave);
     })();
   ]]></script>
</svg>`;
}

Object.entries(bucketsByType).forEach(([bucketType, data]) => {
  if (!['1hr', '5min'].includes(bucketType)) {
    return;
  }
  const svg = buildSvg(bucketType, data);
  if (!svg) {
    return;
  }
  const fileName = `latency-percentiles-${bucketType}.svg`;
  const outputPath = path.join(outputDir, fileName);
  fs.writeFileSync(outputPath, svg, 'utf8');
  console.log(`Generated ${fileName} (${data.length} records)`);
});

const highLatencyHours = (bucketsByType['1hr'] || []).filter(row => {
  const value = row.p99_99_ms;
  return typeof value === 'number' && Number.isFinite(value) && value > 800;
});

if (highLatencyHours.length) {
  const fiveMinuteBuckets = bucketsByType['5min'] || [];
  const hourRanges = highLatencyHours
    .map(hour => {
      const start = parseDate(hour.start_time);
      const end = parseDate(hour.end_time) || (start ? new Date(start.getTime() + 60 * 60 * 1000) : null);
      if (!start || !end) {
        return null;
      }
      return { record: hour, start, end };
    })
    .filter(Boolean);

  const combinedData = [];

  hourRanges.forEach(({ record }) => {
    combinedData.push(record);
  });

  fiveMinuteBuckets.forEach(bucket => {
    const bucketStart = parseDate(bucket.start_time);
    if (!bucketStart) {
      return;
    }
    const match = hourRanges.some(({ start, end }) => bucketStart >= start && bucketStart < end);
    if (match) {
      combinedData.push(bucket);
    }
  });

  const combinedSvg = buildSvg('combined', combinedData);
  if (combinedSvg) {
    const outputPath = path.join(outputDir, 'latency-percentiles-combined.svg');
    fs.writeFileSync(outputPath, combinedSvg, 'utf8');
    console.log(`Generated latency-percentiles-combined.svg (${combinedData.length} records)`);
  }
}
