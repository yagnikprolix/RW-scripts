#!/usr/bin/env node

import { Client } from "@elastic/elasticsearch";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// Load .env configuration
dotenv.config({ path: path.join(rootDir, ".env") });

/**
 * Loads custom ES search parameters from query.json if present.
 */
function loadQueryParams() {
  const queryFilePath = path.join(__dirname, "query.json");
  let rawObj = { match_all: {} };

  if (fs.existsSync(queryFilePath)) {
    try {
      const content = fs.readFileSync(queryFilePath, "utf8").trim();
      if (content) {
        rawObj = JSON.parse(content);
        console.log(`[+] Loaded custom ES query configuration from query.json`);
      }
    } catch (err) {
      console.warn(`[!] Warning: Failed to parse query.json (${err.message}). Using default match_all query.`);
    }
  }

  let query = rawObj;
  let runtime_mappings = undefined;
  let sort = undefined;

  // Extract nested properties if rawObj is a full ES request body
  if (rawObj.query && typeof rawObj.query === "object") {
    query = rawObj.query;
  }
  if (rawObj.runtime_mappings && typeof rawObj.runtime_mappings === "object") {
    runtime_mappings = rawObj.runtime_mappings;
  }
  if (rawObj.sort && Array.isArray(rawObj.sort)) {
    sort = rawObj.sort;
  }

  return { query, runtime_mappings, sort };
}

async function main() {
  console.log("=================================================");
  console.log("   ELASTICSEARCH PATENT NUMBER EXPORTER          ");
  console.log("=================================================\n");

  // 1. ES Client Connection Configuration
  const esNode = process.env.ELASTICSEARCH_NODE || "http://localhost:9200";
  const esIndex = process.env.ELASTICSEARCH_INDEX || "patents";
  const exportField = process.env.EXPORT_FIELD || "PN_B.keyword";
  const fallbackField = "PN_B";
  const bucketSize = parseInt(process.env.EXPORT_BUCKET_SIZE || "10000", 10);

  const esAuthConfig = {};
  if (process.env.ELASTICSEARCH_API_KEY) {
    esAuthConfig.apiKey = process.env.ELASTICSEARCH_API_KEY;
  } else if (process.env.ELASTICSEARCH_USERNAME) {
    esAuthConfig.username = process.env.ELASTICSEARCH_USERNAME;
    esAuthConfig.password = process.env.ELASTICSEARCH_PASSWORD || "";
  }

  const esClient = new Client({
    node: esNode,
    auth: Object.keys(esAuthConfig).length > 0 ? esAuthConfig : undefined,
    tls: {
      rejectUnauthorized: process.env.ELASTICSEARCH_REJECT_UNAUTHORIZED === "true",
    },
  });

  console.log(`[+] Connected ES Node: ${esNode}`);
  console.log(`[*] Target Index: ${esIndex}`);
  console.log(`[*] Primary Target Field: ${exportField}`);
  console.log(`[*] Batch Size per Request: ${bucketSize}`);

  // 2. Prepare Output Directory & File
  const outputDir = path.join(__dirname, "output");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputFile = path.join(outputDir, "patent_numbers.txt");
  fs.writeFileSync(outputFile, "", "utf8");
  console.log(`[*] Output File: ${outputFile}\n`);

  // 3. Load Query Configuration
  const { query: esQuery, runtime_mappings: esRuntimeMappings, sort: esSort } = loadQueryParams();

  // 4. Try Composite Aggregation Fetching
  let activeField = exportField;
  let pageCount = 0;
  let totalExported = 0;
  let totalHits = 0;
  let afterKey = null;
  let triedFallbackField = false;

  console.log(`[*] Executing ES Search & Aggregation Query...`);

  do {
    pageCount++;
    const compositeConfig = {
      size: bucketSize,
      sources: [
        {
          patent_number: {
            terms: {
              field: activeField,
            },
          },
        },
      ],
    };

    if (afterKey) {
      compositeConfig.after = afterKey;
    }

    const searchPayload = {
      index: esIndex,
      size: 0,
      track_total_hits: true,
      query: esQuery,
      aggs: {
        patent_buckets: {
          composite: compositeConfig,
        },
      },
    };

    if (esRuntimeMappings) {
      searchPayload.runtime_mappings = esRuntimeMappings;
    }

    let response;
    try {
      response = await esClient.search(searchPayload);
      totalHits = response.hits?.total?.value ?? response.hits?.total ?? 0;
      if (pageCount === 1) {
        console.log(`[+] Total Hits matching search query: ${totalHits}`);
        if (totalHits === 0) {
          console.log(`[-] Query returned 0 total hits. Check your query filters (e.g. PNC, PKC, DELETE) or index name.`);
          break;
        }
      }
    } catch (err) {
      console.warn(`[!] Aggregation query failed on field '${activeField}': ${err.message}`);
      if (err.meta?.body?.error) {
        console.warn(`    Root Cause:`, err.meta.body.error.reason || JSON.stringify(err.meta.body.error));
      }

      if (!triedFallbackField && activeField === exportField && exportField.endsWith(".keyword")) {
        console.log(`[*] Retrying composite aggregation with fallback field '${fallbackField}'...`);
        activeField = fallbackField;
        triedFallbackField = true;
        pageCount--;
        continue;
      } else {
        break;
      }
    }

    const patentBuckets = response?.aggregations?.patent_buckets;
    const buckets = patentBuckets?.buckets || [];

    if (buckets.length === 0) {
      if (!triedFallbackField && activeField === exportField && exportField.endsWith(".keyword")) {
        console.log(`[*] 0 aggregation buckets on '${exportField}'. Retrying with fallback field '${fallbackField}'...`);
        activeField = fallbackField;
        triedFallbackField = true;
        pageCount--;
        continue;
      } else {
        break;
      }
    }

    // Extract patent numbers from buckets
    const patentNumbers = buckets
      .map((b) => b.key.patent_number)
      .filter((val) => val !== null && val !== undefined && String(val).trim() !== "");

    if (patentNumbers.length > 0) {
      fs.appendFileSync(outputFile, patentNumbers.join("\n") + "\n", "utf8");
      totalExported += patentNumbers.length;
    }

    console.log(
      `    [+] Page ${pageCount}: Exported ${patentNumbers.length} patent numbers (Total: ${totalExported}/${totalHits})`
    );

    afterKey = patentBuckets.after_key;

  } while (afterKey);

  // 5. Fallback Mode: Search_after Hit Extraction if Aggregation returned 0 documents
  if (totalExported === 0 && totalHits > 0) {
    console.log(`\n[*] Aggregation field does not support bucket extraction. Switching to search_after hit extraction for ${totalHits} matching documents...`);

    let searchAfterValues = null;
    let searchPageCount = 0;
    let currentSort = esSort || [{ _doc: { order: "asc" } }];

    do {
      searchPageCount++;
      const hitsPayload = {
        index: esIndex,
        size: Math.min(bucketSize, 10000),
        track_total_hits: true,
        query: esQuery,
        sort: currentSort,
        fields: ["PN_B", "PN_B.keyword", "PNWK", "PNW"],
      };

      if (esRuntimeMappings) {
        hitsPayload.runtime_mappings = esRuntimeMappings;
      }
      if (searchAfterValues) {
        hitsPayload.search_after = searchAfterValues;
      }

      let hitsResponse;
      try {
        hitsResponse = await esClient.search(hitsPayload);
      } catch (searchErr) {
        console.warn(`[!] search_after query failed with custom sort (${searchErr.message}).`);
        if (searchErr.meta?.body?.error) {
          console.warn(`    Details:`, JSON.stringify(searchErr.meta.body.error, null, 2));
        }
        // Fallback to simple _doc sort if custom script sort fails in search_after
        console.log(`[*] Retrying search_after with default '_doc' sort...`);
        currentSort = [{ _doc: { order: "asc" } }];
        hitsPayload.sort = currentSort;
        try {
          hitsResponse = await esClient.search(hitsPayload);
        } catch (retryErr) {
          console.error(`[!] search_after retry failed: ${retryErr.message}`);
          break;
        }
      }

      const hits = hitsResponse?.hits?.hits || [];
      if (hits.length === 0) {
        console.log(`[-] No hits returned on search_after page ${searchPageCount}.`);
        break;
      }

      const pagePatentNumbers = [];
      for (const hit of hits) {
        const fieldsObj = hit.fields || {};
        const srcObj = hit._source || {};

        const rawVal = fieldsObj["PN_B"] || fieldsObj["PN_B.keyword"] || fieldsObj["PNWK"] || fieldsObj["PNW"]
                    || srcObj.PN_B || srcObj.PNWK || srcObj.PNW || hit._id;

        if (Array.isArray(rawVal)) {
          for (const item of rawVal) {
            if (item) pagePatentNumbers.push(String(item).trim());
          }
        } else if (rawVal) {
          pagePatentNumbers.push(String(rawVal).trim());
        }
      }

      if (pagePatentNumbers.length > 0) {
        fs.appendFileSync(outputFile, pagePatentNumbers.join("\n") + "\n", "utf8");
        totalExported += pagePatentNumbers.length;
      }

      console.log(
        `    [+] Page ${searchPageCount}: Exported ${pagePatentNumbers.length} patent numbers (Total exported: ${totalExported}/${totalHits})`
      );

      const lastHit = hits[hits.length - 1];
      searchAfterValues = lastHit?.sort;

    } while (searchAfterValues);
  }

  console.log(`\n=================================================`);
  console.log(`             EXPORT SUMMARY                      `);
  console.log(`=================================================`);
  console.log(`Total Hits Matching Query:    ${totalHits}`);
  console.log(`Total Patent Numbers Exported: ${totalExported}`);
  console.log(`Saved To File:                ${outputFile}`);
  console.log(`=================================================\n`);
}

main().catch((err) => {
  console.error("An error occurred during ES export execution:", err.stack || err);
});
