#!/usr/bin/env node

/**
 * RW-scripts Interactive Terminal Help Menu
 */

export const RESET = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const CYAN = "\x1b[36m";
export const GREEN = "\x1b[32m";
export const YELLOW = "\x1b[33m";
export const BLUE = "\x1b[34m";
export const MAGENTA = "\x1b[35m";
export const DIM = "\x1b[2m";

export const COMMAND_HELP = {
  "get-patents": `
${GREEN}1. Download Patents from S3${RESET}
   ${BOLD}Command:${RESET}      ${YELLOW}npm run get-patents${RESET}
   ${DIM}Description:${RESET}  Downloads raw patent JSON files from AWS S3 based on CSV lists.
   ${DIM}Input Folder:${RESET} ${MAGENTA}process-patent/csv/*.csv${RESET}
   ${DIM}Output Folder:${RESET}${MAGENTA}process-patent/downloads/*.zip${RESET}
`,
  "process": `
${GREEN}2. Process & Filter Patent JSONs into TXT${RESET}
   ${BOLD}Command:${RESET}      ${YELLOW}npm run process${RESET}
   ${DIM}Description:${RESET}  Filters JSON keys using field.csv and extracts plain-text sections into TXT.
   ${DIM}Input Folder:${RESET} ${MAGENTA}process-patent/downloads/*.zip${RESET}
   ${DIM}Output Folder:${RESET}${MAGENTA}process-patent/processed_patent/*.zip${RESET}
`,
  "structure": `
${GREEN}3. Structure Patent Directory Hierarchy${RESET}
   ${BOLD}Command:${RESET}      ${YELLOW}npm run structure${RESET}
   ${DIM}Description:${RESET}  Organizes patent files into structured folder paths (e.g. AP/S1/15/AP151S1.json).
   ${DIM}Input Folder:${RESET} ${MAGENTA}process-patent/downloads/*.zip${RESET}
   ${DIM}Output Folder:${RESET}${MAGENTA}process-patent/structured_patent/${RESET}
`,
  "sync-es": `
${GREEN}4. Batch S3 Fetch, Field Update, ES Sync & MinIO Upload${RESET}
   ${BOLD}Command:${RESET}      ${YELLOW}npm run sync-es${RESET}
   ${DIM}Description:${RESET}  Fetches patent JSONs from AWS S3 in batches, updates fields via updatePatentData.js,
                 bulk-indexes into Elasticsearch, and uploads to MinIO bucket with folder structure.
   ${DIM}Input Folder:${RESET} ${MAGENTA}sync-es-patent/txt/*.txt${RESET}
   ${DIM}Config File:${RESET}  ${MAGENTA}sync-es-patent/updatePatentData.js${RESET}
`,
  "export-es": `
${GREEN}5. Export Patent Numbers from Elasticsearch Query${RESET}
   ${BOLD}Command:${RESET}      ${YELLOW}npm run export-es${RESET}
   ${DIM}Description:${RESET}  Executes query in query.json and exports >10,000 patent numbers into a TXT file
                 using fast 10,000-bucket Composite Aggregation / Search_After pagination.
   ${DIM}Query Config:${RESET} ${MAGENTA}export-es-patent/query.json${RESET}
   ${DIM}Output File:${RESET}  ${MAGENTA}export-es-patent/output/patent_numbers.txt${RESET}
`
};

export function showHelp() {
  console.log(`
${BOLD}${CYAN}========================================================================${RESET}
${BOLD}${CYAN}              RW-SCRIPTS - MODULAR PATENT PROCESSING TOOLBOX             ${RESET}
${BOLD}${CYAN}========================================================================${RESET}

${BOLD}AVAILABLE COMMANDS:${RESET}
${COMMAND_HELP["get-patents"]}
${COMMAND_HELP["process"]}
${COMMAND_HELP["structure"]}
${COMMAND_HELP["sync-es"]}
${COMMAND_HELP["export-es"]}
------------------------------------------------------------------------
${BOLD}ENVIRONMENT CONFIGURATION (.env):${RESET}
   ${DIM}AWS Settings:${RESET}           AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_BUCKET_NAME, AWS_ENDPOINT
   ${DIM}MinIO Settings:${RESET}         MINIO_ENDPOINT, MINIO_BUCKET_NAME, MINIO_ACCESS_KEY_ID, MINIO_SECRET_ACCESS_KEY, MINIO_REGION
   ${DIM}Elasticsearch Settings:${RESET} ELASTICSEARCH_NODE, ELASTICSEARCH_INDEX, ELASTICSEARCH_USERNAME, ELASTICSEARCH_PASSWORD
   ${DIM}Control Flags:${RESET}          ENABLE_S3_UPLOAD, ENABLE_MINIO_UPLOAD, ENABLE_ES_INDEX, DEBUG_LOG_UPDATED_FIELDS, BATCH_SIZE

${BOLD}${CYAN}========================================================================${RESET}
`);
}

export function getCommandKey(arg) {
  if (!arg) return null;
  const clean = arg.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (clean.includes("getpatent") || clean.includes("download")) return "get-patents";
  if (clean.includes("process") || clean.includes("filter")) return "process";
  if (clean.includes("structure") || clean.includes("organize")) return "structure";
  if (clean.includes("synces") || clean.includes("sync")) return "sync-es";
  if (clean.includes("exportes") || clean.includes("export")) return "export-es";
  return null;
}

export function showCommandHelp(commandName) {
  const key = getCommandKey(commandName);
  const helpText = COMMAND_HELP[key];
  if (helpText) {
    console.log(`
${BOLD}${CYAN}========================================================================${RESET}
${BOLD}${CYAN}              RW-SCRIPTS - MODULAR PATENT PROCESSING TOOLBOX             ${RESET}
${BOLD}${CYAN}========================================================================${RESET}

${BOLD}HELP FOR COMMAND: ${YELLOW}${key}${RESET}
${helpText}
${BOLD}${CYAN}========================================================================${RESET}
`);
  } else {
    console.log(`\n${YELLOW}Unknown command: ${commandName}${RESET}`);
    showHelp();
  }
}

export function checkForHelp(commandName) {
  const args = process.argv.slice(2);
  const helpFlags = ["-help", "--help", "help", "-h"];
  if (args.some(arg => helpFlags.includes(arg.toLowerCase()))) {
    showCommandHelp(commandName);
    process.exit(0);
  }
}

// Run immediately if this script is executed directly
const isMain = process.argv[1] && (
  process.argv[1].endsWith("help.js") || 
  process.argv[1].endsWith("help")
);

if (isMain) {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    showCommandHelp(args[0]);
  } else {
    showHelp();
  }
}
