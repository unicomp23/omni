#!/bin/bash
//usr/bin/true; exec deno run --allow-all "$0" "$@"

// Type declarations for Deno APIs
declare global {
  const Deno: {
    readTextFile(path: string): Promise<string>;
    writeTextFile(path: string, data: string): Promise<void>;
    build: { os: string };
    Command: new (command: string, options?: any) => {
      output(): Promise<any>;
    };
    exit(code: number): never;
  };
  
  namespace ImportMeta {
    interface ImportMeta {
      main: boolean;
    }
  }
}

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

function generateHtmlChart(data: HourlyReport[]): string {
  // Sort data by hour for proper chronological order
  const sortedData = data.sort((a, b) => a.hour.localeCompare(b.hour));
  
  // Prepare data for Chart.js
  const labels = sortedData.map(d => d.hour);
  const p50Data = sortedData.map(d => d.stats.p50);
  const p75Data = sortedData.map(d => d.stats.p75);
  const p90Data = sortedData.map(d => d.stats.p90);
  const p95Data = sortedData.map(d => d.stats.p95);
  const p99Data = sortedData.map(d => d.stats.p99);
  const p99_9Data = sortedData.map(d => d.stats.p99_9);
  const p99_99Data = sortedData.map(d => d.stats.p99_99);
  const p99_999Data = sortedData.map(d => d.stats.p99_999);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kafka Latency Percentiles</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            text-align: center;
            color: #333;
            margin-bottom: 30px;
        }
        .chart-container {
            position: relative;
            height: 600px;
            margin-bottom: 20px;
        }
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-top: 20px;
        }
        .stat-card {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 6px;
            border-left: 4px solid #007bff;
        }
        .stat-title {
            font-weight: bold;
            color: #495057;
            margin-bottom: 5px;
        }
        .stat-value {
            font-size: 1.2em;
            color: #212529;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Kafka Latency Percentiles Over Time</h1>
        <div class="chart-container">
            <canvas id="latencyChart"></canvas>
        </div>
        
        <div class="stats">
            <div class="stat-card">
                <div class="stat-title">Total Data Points</div>
                <div class="stat-value">${sortedData.length} hours</div>
            </div>
            <div class="stat-card">
                <div class="stat-title">Time Range</div>
                <div class="stat-value">${sortedData[0]?.hour} to ${sortedData[sortedData.length - 1]?.hour}</div>
            </div>
            <div class="stat-card">
                <div class="stat-title">Threshold Violations</div>
                <div class="stat-value">${sortedData.filter(d => d.stats.exceeds_threshold).length} hours</div>
            </div>
            <div class="stat-card">
                <div class="stat-title">Max P99.99</div>
                <div class="stat-value">${Math.max(...p99_99Data)}ms</div>
            </div>
        </div>
    </div>

    <script>
        const ctx = document.getElementById('latencyChart').getContext('2d');
        
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: ${JSON.stringify(labels)},
                datasets: [
                    {
                        label: 'P50',
                        data: ${JSON.stringify(p50Data)},
                        borderColor: '#28a745',
                        backgroundColor: 'rgba(40, 167, 69, 0.1)',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.1
                    },
                    {
                        label: 'P75',
                        data: ${JSON.stringify(p75Data)},
                        borderColor: '#17a2b8',
                        backgroundColor: 'rgba(23, 162, 184, 0.1)',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.1
                    },
                    {
                        label: 'P90',
                        data: ${JSON.stringify(p90Data)},
                        borderColor: '#ffc107',
                        backgroundColor: 'rgba(255, 193, 7, 0.1)',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.1
                    },
                    {
                        label: 'P95',
                        data: ${JSON.stringify(p95Data)},
                        borderColor: '#fd7e14',
                        backgroundColor: 'rgba(253, 126, 20, 0.1)',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.1
                    },
                    {
                        label: 'P99',
                        data: ${JSON.stringify(p99Data)},
                        borderColor: '#dc3545',
                        backgroundColor: 'rgba(220, 53, 69, 0.1)',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.1
                    },
                    {
                        label: 'P99.9',
                        data: ${JSON.stringify(p99_9Data)},
                        borderColor: '#e83e8c',
                        backgroundColor: 'rgba(232, 62, 140, 0.1)',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.1
                    },
                    {
                        label: 'P99.99',
                        data: ${JSON.stringify(p99_99Data)},
                        borderColor: '#6f42c1',
                        backgroundColor: 'rgba(111, 66, 193, 0.1)',
                        borderWidth: 3,
                        fill: false,
                        tension: 0.1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    title: {
                        display: true,
                        text: 'Latency Percentiles (ms)',
                        font: {
                            size: 16
                        }
                    },
                    legend: {
                        position: 'top',
                    },
                    annotation: {
                        annotations: {
                            line1: {
                                type: 'line',
                                yMin: 100,
                                yMax: 100,
                                borderColor: '#ff0000',
                                borderWidth: 3,
                                borderDash: [10, 5],
                                label: {
                                    content: '100ms Threshold',
                                    enabled: true,
                                    position: 'end',
                                    backgroundColor: 'rgba(255, 0, 0, 0.8)',
                                    color: 'white',
                                    font: {
                                        weight: 'bold'
                                    }
                                }
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: 'Time (Hour)'
                        },
                        ticks: {
                            maxTicksLimit: 20,
                            callback: function(value, index, values) {
                                const label = this.getLabelForValue(value);
                                return label.split('_')[0]; // Show only date part for readability
                            }
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Latency (ms)'
                        },
                        beginAtZero: true,
                        type: 'logarithmic',
                        min: 1,
                        ticks: {
                            callback: function(value, index, values) {
                                if (value === 1 || value === 10 || value === 100 || value === 1000 || value === 10000) {
                                    return value + 'ms';
                                }
                                return '';
                            }
                        }
                    }
                }
            }
        });
    </script>
    
    <!-- Add Chart.js annotation plugin -->
    <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@2.2.1/dist/chartjs-plugin-annotation.min.js"></script>
    <script>
        Chart.register(ChartAnnotation);
    </script>
</body>
</html>`;
}

async function main() {
  try {
    const filename = '../reports.msk/hourly_reports_1749083276892.jsonl';
    
    console.log('📖 Reading JSONL file...');
    const data = await readJsonlFile(filename);
    console.log(`✅ Loaded ${data.length} hourly reports`);
    
    console.log('📊 Generating HTML chart...');
    const htmlContent = generateHtmlChart(data);
    
    const outputFile = 'latency_chart.html';
    await Deno.writeTextFile(outputFile, htmlContent);
    console.log(`✅ Chart saved to ${outputFile}`);
    
    // Try to open the file in default browser
    try {
      const cmd = Deno.build.os === 'darwin' ? 'open' : 
                  Deno.build.os === 'windows' ? 'start' : 'xdg-open';
      
      const process = new Deno.Command(cmd, {
        args: [outputFile],
        stdout: 'null',
        stderr: 'null'
      });
      
      await process.output();
      console.log('🌐 Opening chart in browser...');
    } catch (error) {
      console.log(`📋 Please open ${outputFile} manually in your browser`);
    }
    
    // Print some quick stats
    const violations = data.filter(d => d.stats.exceeds_threshold).length;
    const maxP99_99 = Math.max(...data.map(d => d.stats.p99_99));
    const maxP99_999 = Math.max(...data.map(d => d.stats.p99_999));
    
    console.log('\n📈 Quick Stats:');
    console.log(`   Total hours: ${data.length}`);
    console.log(`   Threshold violations: ${violations} (${(violations/data.length*100).toFixed(1)}%)`);
    console.log(`   Max P99.99: ${maxP99_99}ms`);
    console.log(`   Max P99.999: ${maxP99_999}ms`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
} 