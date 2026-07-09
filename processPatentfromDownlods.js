#!/usr/bin/env node

import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Reads the fields to extract from the CSV file.
 * Filters out common header strings.
 * Identifies fields that are text fields (indicated by 'text' in the second column).
 * @param {string} csvPath
 * @returns {{fields: Set<string>, textFields: Set<string>}}
 */
function readFields(csvPath) {
  const fields = new Set();
  const textFields = new Set();
  if (!fs.existsSync(csvPath)) {
    console.log(`[-] CSV file not found at: ${csvPath}`);
    return { fields, textFields };
  }

  try {
    const content = fs.readFileSync(csvPath, "utf8");
    // Split by newlines
    const lines = content.split(/\r?\n/);

    const langSuffixes = ["_EN", "_FR", "_DE", "_CN", "_ES", "_JP", "_KR"];

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      // Split by comma or tab
      const parts = line.split(/[,\t]/);
      let val = parts[0].trim();
      // Remove surrounding quotes (both double and single)
      val = val.replace(/^["']|["']$/g, "").trim();

      // Skip empty or header rows
      const lowerVal = val.toLowerCase();
      if (
        lowerVal === "field" ||
        lowerVal === "fields" ||
        lowerVal === "key" ||
        lowerVal === "keys" ||
        val === ""
      ) {
        continue;
      }

      const isText = parts[1] && parts[1].trim().toLowerCase() === "text";

      // If it has a language suffix, expand it to all languages
      let matchedSuffix = null;
      for (const suffix of langSuffixes) {
        if (val.endsWith(suffix)) {
          matchedSuffix = suffix;
          break;
        }
      }

      if (matchedSuffix) {
        const prefix = val.substring(0, val.length - matchedSuffix.length);
        for (const suffix of langSuffixes) {
          const langVal = prefix + suffix;
          fields.add(langVal);
          if (isText) {
            textFields.add(langVal);
          }
        }
      } else {
        fields.add(val);
        if (isText) {
          textFields.add(val);
        }
      }
    }

    console.log(
      `[+] Loaded ${fields.size} fields to extract (including language variants).`,
    );
    console.log(`[+] Found ${textFields.size} text fields for TXT generation.`);
  } catch (e) {
    console.error(
      `[!] Error: Failed reading or parsing fields CSV at ${csvPath}: ${e.message}`,
    );
  }
  return { fields, textFields };
}

/**
 * Reads the shortcode mapping from the JSON file.
 * @param {string} shortcodePath
 * @returns {Record<string, string>}
 */
function readShortcodes(shortcodePath) {
  if (!fs.existsSync(shortcodePath)) {
    console.log(`[-] Shortcode file not found at: ${shortcodePath}`);
    return {};
  }
  try {
    const content = fs.readFileSync(shortcodePath, "utf8");
    return JSON.parse(content);
  } catch (e) {
    console.error(`[-] Error reading/parsing shortcode.json: ${e.message}`);
    return {};
  }
}

const langSuffixes = ["_EN", "_FR", "_DE", "_CN", "_ES", "_JP", "_KR"];

/**
 * Strips language names ("English", "French", "German", "Chinese", "Spanish", "Japanese", "Korean")
 * from the description and cleans up whitespace and hyphens.
 * @param {string} description
 * @returns {string}
 */
function getBaseDescription(description) {
  if (!description) return "";
  return description
    .replace(
      /\b(English|French|German|Chinese|Spanish|Japanese|Korean)\b/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*$/, "")
    .replace(/^\s*-\s*/, "")
    .replace(/\s+-\s+/, " - ")
    .trim();
}

/**
 * Finds the base mapped key for a language prefix base.
 * Checks all possible language suffixes in shortcodes.
 * @param {string} base
 * @param {Record<string, string>} shortcodes
 * @returns {string}
 */
function getBaseMappedKey(base, shortcodes) {
  for (const suffix of langSuffixes) {
    const fullKey = base + suffix;
    if (shortcodes[fullKey]) {
      return getBaseDescription(shortcodes[fullKey]);
    }
  }
  return base;
}

/**
 * Prepares the final JSON output from filteredData by:
 * 1. Excluding keys in textFields.
 * 2. Recursively removing fields with empty values ("", empty arrays, empty objects, null, undefined).
 * 3. Mapping original keys to their shortcode descriptions.
 * @param {any} filteredData
 * @param {Set<string>} textFields
 * @param {Record<string, string>} shortcodes
 * @returns {any}
 */
function prepareJsonOutput(filteredData, textFields, shortcodes) {
  if (Array.isArray(filteredData)) {
    return filteredData
      .map((item) => prepareJsonOutput(item, textFields, shortcodes))
      .filter((item) => {
        return (
          item !== null &&
          item !== undefined &&
          item !== "" &&
          (!Array.isArray(item) || item.length > 0) &&
          (typeof item !== "object" || Object.keys(item).length > 0)
        );
      });
  } else if (filteredData !== null && typeof filteredData === "object") {
    const output = {};
    const processedBases = new Set();

    for (const key in filteredData) {
      if (Object.prototype.hasOwnProperty.call(filteredData, key)) {
        // Skip text fields
        if (textFields.has(key)) {
          continue;
        }

        // Check if key is a language field
        let isLanguageField = false;
        let base = "";
        for (const suffix of langSuffixes) {
          if (key.endsWith(suffix)) {
            isLanguageField = true;
            base = key.substring(0, key.length - suffix.length);
            break;
          }
        }

        if (isLanguageField) {
          if (processedBases.has(base)) {
            continue;
          }
          processedBases.add(base);

          const combined = [];
          const seen = new Set();

          for (const suffix of langSuffixes) {
            const fullKey = base + suffix;
            if (Object.prototype.hasOwnProperty.call(filteredData, fullKey)) {
              let val = filteredData[fullKey];

              // Recursively clean if it's an object/array
              if (val !== null && typeof val === "object") {
                val = prepareJsonOutput(val, textFields, shortcodes);
              }

              if (val !== null && val !== undefined) {
                if (Array.isArray(val)) {
                  for (const item of val) {
                    if (item !== null && item !== undefined && item !== "") {
                      const strVal = String(item).trim();
                      if (strVal && !seen.has(strVal)) {
                        seen.add(strVal);
                        combined.push(item);
                      }
                    }
                  }
                } else if (val !== "") {
                  const strVal = String(val).trim();
                  if (strVal && !seen.has(strVal)) {
                    seen.add(strVal);
                    combined.push(val);
                  }
                }
              }
            }
          }

          if (combined.length === 0) {
            continue;
          }

          const mappedKey = getBaseMappedKey(base, shortcodes);
          output[mappedKey] = combined;
        } else {
          // Non-language field
          let value = filteredData[key];

          // Recursively clean objects and arrays
          if (value !== null && typeof value === "object") {
            value = prepareJsonOutput(value, textFields, shortcodes);
          }

          // Check if value is empty/no-value
          const isEmpty =
            value === null ||
            value === undefined ||
            value === "" ||
            (Array.isArray(value) && value.length === 0) ||
            (typeof value === "object" && Object.keys(value).length === 0);

          if (isEmpty) {
            continue;
          }

          // Translate key using shortcodes mapping if available
          const mappedKey = shortcodes[key] || key;
          output[mappedKey] = value;
        }
      }
    }
    return output;
  }
  return filteredData;
}

/**
 * Recursively filters a dictionary or a list of dictionaries,
 * keeping only the keys that are specified in the 'fields' set.
 * @param {any} data
 * @param {Set<string>} fields
 * @returns {any}
 */
function filterData(data, fields) {
  if (Array.isArray(data)) {
    return data.map((item) => filterData(item, fields));
  } else if (data !== null && typeof data === "object") {
    const filtered = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        if (fields.has(key)) {
          filtered[key] = data[key];
        }
      }
    }
    return filtered;
  }
  return data;
}

/**
 * Cleans the input text by:
 * 1. Replacing newlines and HTML tags with a single space.
 * 2. Collapsing multiple spaces into one.
 * 3. Trimming leading and trailing spaces.
 * @param {string} text
 * @returns {string}
 */
function cleanText(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/[\r\n]+/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Formats the filtered patent data into a plain text representation.
 * @param {any} filteredData
 * @param {Set<string>} textFields
 * @returns {string|null}
 */
function generateTxtContent(filteredData, textFields) {
  const types = [
    { prefix: "AB", name: "Abstract" },
    { prefix: "DESC", name: "Description" },
    { prefix: "TI", name: "Title" },
    { prefix: "CL", name: "Claims" },
  ];

  const langMap = {
    EN: "english",
    DE: "german",
    FR: "french",
    ES: "spanish",
    JP: "japanese",
    KR: "korean",
    CN: "chinese",
  };

  const sections = [];

  for (const type of types) {
    // Find keys starting with the prefix that are in the textFields set
    const keys = Object.keys(filteredData)
      .filter(
        (k) =>
          textFields.has(k) &&
          (k === type.prefix || k.startsWith(type.prefix + "_")),
      )
      .sort((a, b) => {
        const langA = a.split("_")[1] || "";
        const langB = b.split("_")[1] || "";
        return langA.localeCompare(langB);
      });

    for (const key of keys) {
      const value = filteredData[key];
      if (!value) continue;

      let contentStr = "";
      if (Array.isArray(value)) {
        contentStr = value
          .map((item) => cleanText(item))
          .filter((item) => item !== "")
          .join("\n");
      } else {
        contentStr = cleanText(value);
      }

      if (!contentStr) continue;

      const parts = key.split("_");
      const suffix = parts[1];
      let header = type.name;
      if (suffix) {
        const lang = langMap[suffix] || suffix.toLowerCase();
        header = `${type.name}-${lang}`;
      }
      header = `${header}:`;

      sections.push(`${header}\n${contentStr}`);
    }
  }

  if (sections.length === 0) return null;

  // Join sections with double newlines and ensure a trailing newline at the end of the file
  return sections.join("\n\n") + "\n";
}

/**
 * Finds all zip files in inputDirs, extracts JSON files in-memory,
 * filters them, and saves the filtered output JSONs and matching TXT files
 * into a new zip archive with the same name inside outputDir.
 * @param {string[]} inputDirs
 * @param {string} outputDir
 * @param {Set<string>} fields
 * @param {Set<string>} textFields
 */
function processZips(inputDirs, outputDir, fields, textFields, shortcodes) {
  if (!fs.existsSync(outputDir)) {
    try {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log(`[+] Created output directory: ${outputDir}`);
    } catch (e) {
      console.error(
        `[!] Error: Failed to create output directory ${outputDir}: ${e.message}`,
      );
      return;
    }
  }

  // Ensure the primary downloads directory exists
  const primaryDownloads = inputDirs[0];
  if (primaryDownloads && !fs.existsSync(primaryDownloads)) {
    try {
      fs.mkdirSync(primaryDownloads, { recursive: true });
      console.log(`[+] Created downloads directory: ${primaryDownloads}`);
    } catch (e) {
      console.error(
        `[!] Error: Failed to create downloads directory ${primaryDownloads}: ${e.message}`,
      );
    }
  }

  // Compile all zip files from the configured directories
  const zipFiles = [];
  const scannedDirs = [];

  for (const dir of inputDirs) {
    if (fs.existsSync(dir)) {
      scannedDirs.push(dir);
      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          if (file.toLowerCase().endsWith(".zip")) {
            zipFiles.push(path.join(dir, file));
          }
        }
      } catch (e) {
        console.error(
          `[!] Error: Failed to read directory ${dir}: ${e.message}`,
        );
      }
    }
  }

  console.log(`[*] Scanned directories: ${scannedDirs.join(", ")}`);

  if (zipFiles.length === 0) {
    console.log(`[-] No zip files found in the scanned directories.`);
    console.log(
      "Please place your zip archive(s) in the downloads directory and try again.",
    );
    return;
  }

  console.log(`[+] Found ${zipFiles.length} zip file(s) to process.`);

  // Get chunk size from environment variable (default to 100)
  const envChunkSize = process.env.CHUNK_SIZE;
  const chunkSize =
    envChunkSize && !isNaN(parseInt(envChunkSize, 10))
      ? parseInt(envChunkSize, 10)
      : 100;
  console.log(`[*] Chunk size configured from env (CHUNK_SIZE): ${chunkSize}`);

  let totalProcessed = 0;
  let totalFailed = 0;

  for (const zipPath of zipFiles) {
    const zipFileName = path.basename(zipPath);
    console.log(`\n[~] Reading and processing zip archive from: ${zipPath}`);

    let inputZip;
    try {
      inputZip = new AdmZip(zipPath);
    } catch (e) {
      console.log(
        `    [!] Error: Failed to load zip file ${zipFileName} at ${zipPath}: ${e.message}`,
      );
      continue;
    }

    let zipEntries;
    try {
      zipEntries = inputZip.getEntries();
    } catch (e) {
      console.log(
        `    [!] Error: Failed to read entries from zip file ${zipFileName}: ${e.message}`,
      );
      continue;
    }

    // Filter out only JSON files in the zip and not directories
    const jsonEntries = zipEntries.filter(
      (entry) =>
        !entry.isDirectory && entry.entryName.toLowerCase().endsWith(".json"),
    );
    console.log(
      `    [*] Found ${jsonEntries.length} JSON file(s) inside ${zipFileName}`,
    );

    if (jsonEntries.length === 0) {
      console.log(`    [-] No JSON files found to process in this archive.`);
      continue;
    }

    // Split entries into chunks
    const chunks = [];
    for (let i = 0; i < jsonEntries.length; i += chunkSize) {
      chunks.push(jsonEntries.slice(i, i + chunkSize));
    }

    if (chunks.length > 1) {
      console.log(
        `    [*] Splitting patent list into ${chunks.length} chunks (max ${chunkSize} patents per chunk)`,
      );
    } else {
      console.log(
        `    [*] Processing all ${jsonEntries.length} patents in a single batch`,
      );
    }

    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
      const chunkEntries = chunks[chunkIdx];
      const chunkNum = chunkIdx + 1;

      if (chunks.length > 1) {
        console.log(
          `\n    --- [Chunk ${chunkNum}/${chunks.length}] Processing ${chunkEntries.length} patent(s) ---`,
        );
      }

      const outputZip = new AdmZip();
      const usedNamesInZip = new Set();
      let processedInThisChunk = 0;

      for (const entry of chunkEntries) {
        console.log(
          `\n        [>] Running processing for: ${entry.entryName} (extracted from ${zipFileName})`,
        );
        try {
          // Read the JSON file content from zip in memory
          let text;
          try {
            text = entry.getData().toString("utf8");
          } catch (de) {
            console.log(
              `        [!] Error: Failed to read data for ${entry.entryName}: ${de.message}`,
            );
            totalFailed++;
            continue;
          }

          let data;
          try {
            data = JSON.parse(text);
          } catch (je) {
            console.log(
              `        [!] Error: Failed to parse JSON for ${entry.entryName}: ${je.message}`,
            );
            totalFailed++;
            continue;
          }

          // Filter the JSON contents
          let filteredData;
          try {
            filteredData = filterData(data, fields);
          } catch (fe) {
            console.log(
              `        [!] Error: Failed during field filtering for ${entry.entryName}: ${fe.message}`,
            );
            totalFailed++;
            continue;
          }

          // Get the base name of the entry
          const baseName = path.basename(entry.entryName);
          if (!baseName) {
            console.log(
              `        [!] Error: Could not determine base name for entry ${entry.entryName}`,
            );
            totalFailed++;
            continue;
          }

          // Handle duplicate filenames within this specific output zip
          let uniqueName = baseName;
          if (usedNamesInZip.has(uniqueName)) {
            const ext = path.extname(baseName);
            const name = path.basename(baseName, ext);
            let counter = 1;
            while (usedNamesInZip.has(`${name}_${counter}${ext}`)) {
              counter++;
            }
            uniqueName = `${name}_${counter}${ext}`;
            console.log(
              `        [*] Duplicate name resolved. Renaming output to: ${uniqueName}`,
            );
          }
          usedNamesInZip.add(uniqueName);

          // Prepare the mapped JSON output (skipping text fields, stripping empty keys, mapping with shortcodes)
          let jsonOutputData;
          try {
            jsonOutputData = prepareJsonOutput(
              filteredData,
              textFields,
              shortcodes,
            );
          } catch (oe) {
            console.log(
              `        [!] Error: Failed preparing JSON output for ${entry.entryName}: ${oe.message}`,
            );
            totalFailed++;
            continue;
          }

          // Add the filtered JSON file to the output zip
          try {
            outputZip.addFile(
              uniqueName,
              Buffer.from(JSON.stringify(jsonOutputData, null, 2), "utf8"),
            );
            console.log(
              `        [+] Added JSON output to target: ${uniqueName}`,
            );
          } catch (ae) {
            console.log(
              `        [!] Error: Failed to add ${uniqueName} to output zip: ${ae.message}`,
            );
            totalFailed++;
            continue;
          }

          // Generate the TXT content if there are any text fields in the data
          try {
            const txtContent = generateTxtContent(filteredData, textFields);
            if (txtContent) {
              const ext = path.extname(uniqueName);
              const name = path.basename(uniqueName, ext);
              const txtName = `${name}.txt`;
              outputZip.addFile(txtName, Buffer.from(txtContent, "utf8"));
              console.log(
                `        [+] Generated and added text output to target: ${txtName}`,
              );
            }
          } catch (te) {
            console.log(
              `        [!] Error: Failed generating or adding TXT for ${entry.entryName}: ${te.message}`,
            );
          }

          processedInThisChunk++;
          totalProcessed++;
        } catch (fe) {
          console.log(
            `        [!] Unexpected error processing ${entry.entryName}: ${fe.message}`,
          );
          totalFailed++;
        }
      }

      if (processedInThisChunk > 0) {
        // Output zip filename: if we have multiple chunks, append part index
        let outputZipName = zipFileName;
        if (chunks.length > 1) {
          const ext = path.extname(zipFileName);
          const name = path.basename(zipFileName, ext);
          outputZipName = `${name}_part${chunkNum}${ext}`;
        }
        const outputZipPath = path.join(outputDir, outputZipName);
        try {
          outputZip.writeZip(outputZipPath);
          console.log(
            `\n    [+] Successfully wrote output zip archive to: ${outputZipPath}`,
          );
        } catch (we) {
          console.log(
            `    [!] Error: Failed to write output zip file to ${outputZipPath}: ${we.message}`,
          );
        }
      } else {
        console.log(
          `    [-] No files were successfully processed for Chunk ${chunkNum}. Output zip was not written.`,
        );
      }
    }
  }

  console.log("\n================ Processing Summary ================");
  console.log(`Successfully processed JSON files: ${totalProcessed}`);
  console.log(`Failed JSON files:                  ${totalFailed}`);
  console.log(`Outputs saved to:                   ${outputDir}`);
  console.log("====================================================");
}

function main() {
  // Setup paths relative to the script location
  const csvPath = path.join(__dirname, "field2.csv");
  const outputDir = path.join(__dirname, "processed_patent");
  const shortcodePath = path.join(__dirname, "shortcode.json");

  // Configure the directories to check for zip files (using 'downloads' as primary)
  const inputDirs = [path.join(__dirname, "downloads")];

  // If 'downloads' is present in the sibling 'getpatent' folder (AWS setup fallback)
  const siblingDownloads = path.join(__dirname, "../getpatent/downloads");
  if (fs.existsSync(siblingDownloads)) {
    inputDirs.push(siblingDownloads);
  }

  console.log("[*] Starting Patent Processing Script");
  const { fields, textFields } = readFields(csvPath);
  const shortcodes = readShortcodes(shortcodePath);

  if (fields.size === 0) {
    console.log("[-] No valid fields to filter. Exiting.");
    return;
  }

  processZips(inputDirs, outputDir, fields, textFields, shortcodes);
}

if (process.argv[1] === __filename) {
  main();
}
