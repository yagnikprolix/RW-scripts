#!/usr/bin/env node

/**
 * RW-scripts Interactive Terminal Help Menu
 */

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const DIM = "\x1b[2m";

function showHelp() {
  console.log(`
${BOLD}${CYAN}========================================================================${RESET}
${BOLD}${CYAN}              RW-SCRIPTS - MODULAR PATENT PROCESSING TOOLBOX             ${RESET}
${BOLD}${CYAN}========================================================================${RESET}

${BOLD}AVAILABLE COMMANDS:${RESET}

${GREEN}1. Download Patents from S3${RESET}
   ${BOLD}Command:${RESET}      ${YELLOW}npm run get-patents${RESET}
   ${DIM}Description:${RESET}  Downloads raw patent JSON files from AWS S3 based on CSV lists.
   ${DIM}Input Folder:${RESET} ${MAGENTA}process-patent/csv/*.csv${RESET}
   ${DIM}Output Folder:${RESET}${MAGENTA}process-patent/downloads/*.zip${RESET}

${GREEN}2. Process & Filter Patent JSONs into TXT${RESET}
   ${BOLD}Command:${RESET}      ${YELLOW}npm run process${RESET}
   ${DIM}Description:${RESET}  Filters JSON keys using field.csv and extracts plain-text sections into TXT.
   ${DIM}Input Folder:${RESET} ${MAGENTA}process-patent/downloads/*.zip${RESET}
   ${DIM}Output Folder:${RESET}${MAGENTA}process-patent/processed_patent/*.zip${RESET}

${GREEN}3. Structure Patent Directory Hierarchy${RESET}
   ${BOLD}Command:${RESET}      ${YELLOW}npm run structure${RESET}
   ${DIM}Description:${RESET}  Organizes patent files into structured folder paths (e.g. AP/S1/15/AP151S1.json).
   ${DIM}Input Folder:${RESET} ${MAGENTA}process-patent/downloads/*.zip${RESET}
   ${DIM}Output Folder:${RESET}${MAGENTA}process-patent/structured_patent/${RESET}

${GREEN}4. Batch S3 Fetch, Field Update & ES Sync${RESET}
   ${BOLD}Command:${RESET}      ${YELLOW}npm run sync-es${RESET}
   ${DIM}Description:${RESET}  Fetches patent JSONs from S3 in batches, updates fields via updatePatentData.js,
                 bulk-indexes into Elasticsearch, and re-uploads to S3.
   ${DIM}Input Folder:${RESET} ${MAGENTA}sync-es-patent/txt/*.txt${RESET}
   ${DIM}Config File:${RESET}  ${MAGENTA}sync-es-patent/updatePatentData.js${RESET}

${GREEN}5. Export Patent Numbers from Elasticsearch Query${RESET}
   ${BOLD}Command:${RESET}      ${YELLOW}npm run export-es${RESET}
   ${DIM}Description:${RESET}  Executes query in query.json and exports >10,000 patent numbers into a TXT file
                 using fast 10,000-bucket Composite Aggregation / Search_After pagination.
   ${DIM}Query Config:${RESET} ${MAGENTA}export-es-patent/query.json${RESET}
   ${DIM}Output File:${RESET}  ${MAGENTA}export-es-patent/output/patent_numbers.txt${RESET}

${BOLD}${CYAN}------------------------------------------------------------------------${RESET}
${BOLD}ENVIRONMENT CONFIGURATION (.env):${RESET}
   ${DIM}AWS Settings:${RESET}           AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_BUCKET_NAME, AWS_ENDPOINT
   ${DIM}Elasticsearch Settings:${RESET} ELASTICSEARCH_NODE, ELASTICSEARCH_INDEX, ELASTICSEARCH_USERNAME, ELASTICSEARCH_PASSWORD
   ${DIM}Control Flags:${RESET}          ENABLE_S3_UPLOAD, ENABLE_ES_INDEX, DEBUG_LOG_UPDATED_FIELDS, PROGRESS_INTERVAL, BATCH_SIZE

${BOLD}${CYAN}========================================================================${RESET}
`);
}

showHelp();
