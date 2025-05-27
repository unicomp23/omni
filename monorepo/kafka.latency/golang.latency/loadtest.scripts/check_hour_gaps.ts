// check_hour_gaps.ts
import { parse } from "https://deno.land/std/jsonc/mod.ts";

interface HourlyStats {
  hour: string;
  stats: {
    count: number;
    p99_99: number;
    // ... other stats fields
  };
}

interface HourlyReport {
  timestamp: string;
  test_run: string;
  hourly_stats: HourlyStats[];
}

function parseHourString(hour: string): Date {
  const [date, hourStr] = hour.split('_');
  return new Date(`${date}T${hourStr}:00:00Z`);
}

async function main() {
  const filePath = Deno.args[0];
  if (!filePath) {
    console.error("Please provide the hourly report file path");
    Deno.exit(1);
  }

  try {
    const content = await Deno.readTextFile(filePath);
    const report: HourlyReport = parse(content);

    // Sort hourly_stats by hour
    const stats = report.hourly_stats.sort((a, b) => {
      const dateA = parseHourString(a.hour);
      const dateB = parseHourString(b.hour);
      return dateA.getTime() - dateB.getTime();
    });

    console.log("\nHourly Report Summary (chronological order):");
    console.log("----------------------------------------");
    console.log(`Test run: ${report.test_run}`);
    console.log("----------------------------------------");

    let prevDate: Date | null = null;
    for (const stat of stats) {
      const currentDate = parseHourString(stat.hour);
      
      if (prevDate) {
        const diffHours = (currentDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60);
        
        if (diffHours > 1) {
          console.log(`\n⚠️  GAP DETECTED: ${diffHours - 1} hour(s) missing between:`);
          console.log(`   ${prevDate.toISOString()} and`);
          console.log(`   ${currentDate.toISOString()}\n`);
        }
      }

      console.log(`Hour: ${stat.hour}`);
      console.log(`  Events: ${stat.stats.count}`);
      console.log(`  P99.99: ${stat.stats.p99_99.toFixed(2)}ms`);
      console.log("----------------------------------------");

      prevDate = currentDate;
    }

    const totalHours = stats.length;
    const firstHour = parseHourString(stats[0].hour);
    const lastHour = parseHourString(stats[stats.length - 1].hour);
    const expectedHours = Math.floor((lastHour.getTime() - firstHour.getTime()) / (1000 * 60 * 60)) + 1;
    const missingHours = expectedHours - totalHours;

    console.log("\nSummary:");
    console.log(`Total hours: ${totalHours}`);
    console.log(`Time span: ${firstHour.toISOString()} to ${lastHour.toISOString()}`);
    console.log(`Expected hours in span: ${expectedHours}`);
    console.log(`Missing hours: ${missingHours}`);
    console.log(`Coverage: ${((totalHours / expectedHours) * 100).toFixed(1)}%`);

  } catch (error) {
    console.error("Error processing file:", error);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
