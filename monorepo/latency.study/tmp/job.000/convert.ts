// Read the CSV file
const csvContent = await Deno.readTextFile("search-results-2024-09-20T16_16_01.109-0700.csv");

// Split the content into lines and parse manually
const lines = csvContent.trim().split("\n");
const headers = lines[0].split(",").map(h => h.replace(/"/g, "").trim());
const records = lines.slice(1).map(line => {
  return line.split(",").map(field => {
    field = field.replace(/"/g, "").trim();
    // Check if the field is a number and not an empty string
    if (field !== "" && !isNaN(Number(field))) {
      // Convert the field to a number and format it with two decimals
      field = Number(field).toFixed(2);
    }
    return field;
  });
});

// Calculate the maximum length of each column
const columnLengths = headers.map((header, i) => Math.max(header.length, ...records.map(record => record[i]?.length || 0)));

// Create the README.md table
let mdTable = headers.map((header, i) => header.padEnd(columnLengths[i])).join(" | ") + "\n";

// Add rows
for (const record of records) {
  mdTable += record.map((field, i) => field.padEnd(columnLengths[i])).join(" | ") + "\n";
}

// Write the markdown table to a file
await Deno.writeTextFile("output_readme.md", mdTable);

console.log("Conversion complete. Output written to output_readme.md");