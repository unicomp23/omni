import { parse } from "https://deno.land/std/csv/mod.ts";

function generateTable(data: any[]): string {
  // Remove the _raw field from headers and data
  const headers = data[0].filter(header => header !== "_raw");
  const cleanData = data.map(row => row.filter((_, index) => data[0][index] !== "_raw"));

  // Define column widths based on the longest content in each column
  const colWidths = headers.map((_, colIndex) => 
    Math.max(...cleanData.map(row => String(row[colIndex]).length), headers[colIndex].length)
  );
  
  // Create header
  const header = headers.map((col, index) => 
    col.padEnd(colWidths[index])
  ).join(" | ");

  // Create separator
  const separator = colWidths.map(width => "-".repeat(width)).join("-+-");

  // Create rows
  const rows = cleanData.slice(1).map(row => 
    row.map((cell, index) => 
      String(cell).padEnd(colWidths[index])
    ).join(" | ")
  );

  return [header, separator, ...rows].join("\n");
}

// Learn more at https://docs.deno.com/runtime/manual/examples/module_metadata#concepts
if (import.meta.main) {
  // Get the filename from command line arguments
  const filename = Deno.args[0];

  if (!filename) {
    console.error("Please provide a CSV filename as an argument.");
    Deno.exit(1);
  }

  try {
    const csvContent = await Deno.readTextFile(filename);
    const records = parse(csvContent, { skipFirstRow: false });

    console.log("Full table of data:");
    const table = generateTable(records);
    console.log(table);

    console.log(`\nTotal number of rows: ${records.length}`);

  } catch (error) {
    console.error(`Error reading or processing file: ${error.message}`);
    Deno.exit(1);
  }
}
