import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import AdmZip from "adm-zip";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// Define input and output paths
const downloadsDir = path.join(__dirname, "downloads");
const outputDir = path.join(__dirname, "structured_patent");

/**
 * Calculates the structured path for a patent file based on its filename pattern.
 * E.g., AP151S1.json -> AP/S1/15/AP151S1.json
 * 
 * @param {string} filePath - Path or filename of the patent file
 * @returns {string} The structured relative path for the patent
 */
function getStructuredPath(filePath) {
  const fName = filePath.split(/[\\/]/).pop();
  
  // Extract file extension and base patent name
  const ext = path.extname(fName); // e.g. ".json"
  const baseName = fName.slice(0, -ext.length); // e.g. "AP151S1"

  const regex = /^([A-Z]{2})([A-Z]{0,3})(\d{0,2})(\d{0,2})(\d{0,2})(\d{0,2})(\d{0,2})(\d{0,2})(\d{0,2})([a-zA-Z]{1}[a-zA-Z0-9]{0,2})$/;
  if (!regex.test(baseName)) {
    // If name doesn't match standard naming pattern, place it at the root of the output directory
    return fName;
  }

  // Split and splice to extract hierarchy fields: Country Code, Kind Code, and number prefix chunks
  let x = baseName.split(regex).filter((i) => i);
  const y = [...x.splice(0, 1), ...x.splice(-1, 1), ...x];
  y.splice(-1, 1);
  
  return `${y.join("/")}/${fName}`;
}

/**
 * Main execution function
 */
function main() {
  console.log("=========================================");
  console.log("      PATENT DIRECTORY STRUCTURER        ");
  console.log("=========================================\n");

  if (!fs.existsSync(downloadsDir)) {
    console.error(`[-] Input directory not found: ${downloadsDir}`);
    console.error("Please ensure the 'downloads' directory exists and contains files/zips.");
    process.exit(1);
  }

  // Create the output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`[+] Created output directory: ${outputDir}`);
  }

  // Scan downloads directory for files
  let items;
  try {
    items = fs.readdirSync(downloadsDir);
  } catch (err) {
    console.error(`[-] Error reading downloads directory: ${err.message}`);
    process.exit(1);
  }

  let totalFilesStructured = 0;
  let totalZipsProcessed = 0;

  for (const item of items) {
    const itemPath = path.join(downloadsDir, item);
    const stat = fs.statSync(itemPath);

    if (stat.isDirectory()) {
      // If there is a subdirectory in downloads, we scan its loose files
      console.log(`[*] Scanning subdirectory: ${item}`);
      const subItems = fs.readdirSync(itemPath);
      for (const subItem of subItems) {
        const subItemPath = path.join(itemPath, subItem);
        const subStat = fs.statSync(subItemPath);
        if (subStat.isFile() && !subItem.startsWith(".")) {
          processFile(subItemPath);
        }
      }
    } else if (stat.isFile()) {
      if (item.startsWith(".")) {
        // Skip hidden files like .gitkeep or .DS_Store
        continue;
      }

      if (item.toLowerCase().endsWith(".zip")) {
        // Handle ZIP archive
        processZip(itemPath);
      } else {
        // Handle loose file
        processFile(itemPath);
      }
    }
  }

  console.log("\n=========================================");
  console.log("           PROCESSING SUMMARY            ");
  console.log("=========================================");
  console.log(`Total ZIP archives processed: ${totalZipsProcessed}`);
  console.log(`Total patent files structured:  ${totalFilesStructured}`);
  console.log(`Output saved inside:          ${outputDir}`);
  console.log("=========================================");

  /**
   * Processes a ZIP archive by extracting each patent file inside to its structured path.
   * @param {string} zipFilePath 
   */
  function processZip(zipFilePath) {
    const zipName = path.basename(zipFilePath);
    console.log(`\n[~] Processing ZIP archive: ${zipName}`);
    try {
      const zip = new AdmZip(zipFilePath);
      const entries = zip.getEntries();
      
      let count = 0;
      for (const entry of entries) {
        if (entry.isDirectory || entry.entryName.startsWith(".")) {
          continue;
        }

        const entryFileName = path.basename(entry.entryName);
        const relativeStructuredPath = getStructuredPath(entryFileName);
        const targetPath = path.join(outputDir, relativeStructuredPath);

        // Ensure parent directory exists
        const targetDir = path.dirname(targetPath);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        // Extract content and write to structured path
        const content = entry.getData();
        fs.writeFileSync(targetPath, content);
        
        console.log(`   -> Extracted & Structured: ${entryFileName} to ${relativeStructuredPath}`);
        count++;
      }
      
      console.log(`[+] Finished ZIP ${zipName}: structured ${count} files.`);
      totalZipsProcessed++;
      totalFilesStructured += count;
    } catch (err) {
      console.error(`[!] Error processing ZIP ${zipName}: ${err.message}`);
    }
  }

  /**
   * Reorganizes a loose patent file into its structured path inside the output directory.
   * @param {string} filePath 
   */
  function processFile(filePath) {
    const fName = path.basename(filePath);
    console.log(`\n[~] Processing file: ${fName}`);
    try {
      const relativeStructuredPath = getStructuredPath(fName);
      const targetPath = path.join(outputDir, relativeStructuredPath);

      // Ensure parent directory exists
      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // Copy file to target path
      fs.copyFileSync(filePath, targetPath);
      
      console.log(`[+] Structured: ${fName} to ${relativeStructuredPath}`);
      totalFilesStructured++;
    } catch (err) {
      console.error(`[!] Error processing file ${fName}: ${err.message}`);
    }
  }
}

main();
