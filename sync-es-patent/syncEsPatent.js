#!/usr/bin/env node

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { Client } from "@elastic/elasticsearch";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import readline from "readline";
import { pipeline } from "stream/promises";
import { fileURLToPath } from "url";
import { Readable } from "stream";
import { updatePatentData } from "./updatePatentData.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// Load .env from root directory
dotenv.config({ path: path.join(rootDir, ".env") });

/**
  Prompts user for input if env variable is missing
 */
const askQuestion = (query) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
};

/**
 * Calculates S3 folder prefix based on patent ID naming pattern.
 */
const calculatePrefix = (fileName) => {
  const regex =
    /^([A-Z]{2})([A-Z]{0,3})(\d{0,2})(\d{0,2})(\d{0,2})(\d{0,2})(\d{0,2})(\d{0,2})(\d{0,2})([a-zA-Z]{1}[a-zA-Z0-9]{0,2})$/;
  if (!regex.test(fileName)) {
    return `${fileName}.json`;
  }
  let x = fileName.split(regex).filter((i) => i);
  const y = [...x.splice(0, 1), ...x.splice(-1, 1), ...x];
  y.splice(-1, 1);

  return `${y.join("/")}/${fileName}.json`;
};

/**
 * Resolves full S3 key and fallback flat key
 */
const resolveKey = (input) => {
  if (input.includes("/")) {
    return { primary: input };
  }
  const cleanName = input.endsWith(".json") ? input.slice(0, -5) : input;
  const prefixed = calculatePrefix(cleanName);
  const flat = `${cleanName}.json`;

  if (prefixed === flat) {
    return { primary: flat };
  }

  return { primary: prefixed, fallback: flat };
};

/**
 * Reads patent numbers from TXT content
 */
function parsePatentNumbersFromTxt(content) {
  const lines = content.split(/\r?\n/);
  const patentNumbers = new Set();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Split by comma, tab, or space in case multiple items per line
    const parts = trimmed.split(/[\s,\t]+/);
    for (const part of parts) {
      const clean = part.replace(/^["']|["']$/g, "").trim();
      if (clean) {
        patentNumbers.add(clean);
      }
    }
  }

  return Array.from(patentNumbers);
}



/**
 * Helper to convert stream to string
 */
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Downloads a single JSON object from S3
 */
async function fetchPatentFromS3(s3Client, bucketName, target) {
  const { primary, fallback } = resolveKey(target);
  let resolvedKey = primary;
  let response;

  try {
    response = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: primary,
      })
    );
  } catch (err) {
    if (
      fallback &&
      (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404)
    ) {
      resolvedKey = fallback;
      response = await s3Client.send(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: fallback,
        })
      );
    } else {
      throw err;
    }
  }

  if (!response.Body) {
    throw new Error(`Empty body returned from S3 for key ${resolvedKey}`);
  }

  const jsonText = await streamToString(response.Body);
  const data = JSON.parse(jsonText);
  return { data, resolvedKey };
}

/**
 * Uploads updated JSON document back to S3
 */
async function uploadPatentToS3(s3Client, bucketName, key, jsonData) {
  const jsonString = JSON.stringify(jsonData, null, 2);
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: jsonString,
      ContentType: "application/json",
    })
  );
}

/**
 * Bulk indexes documents into Elasticsearch
 */
async function bulkIndexToElasticsearch(esClient, indexName, docs) {
  if (!esClient || docs.length === 0) return { indexed: 0, failed: 0 };

  const operations = docs.flatMap((doc) => [
    { index: { _index: indexName, _id: doc.id } },
    doc.body,
  ]);

  try {
    const bulkResponse = await esClient.bulk({ refresh: true, operations });
    if (bulkResponse.errors) {
      let failed = 0;
      let indexed = 0;
      bulkResponse.items.forEach((action) => {
        const operation = Object.keys(action)[0];
        if (action[operation].error) {
          failed++;
          console.error(
            `    [!] ES Indexing error for ID ${action[operation]._id}:`,
            action[operation].error.reason || action[operation].error
          );
        } else {
          indexed++;
        }
      });
      return { indexed, failed };
    }
    return { indexed: docs.length, failed: 0 };
  } catch (err) {
    console.error(`    [!] ES Bulk Request Failed: ${err.message}`);
    return { indexed: 0, failed: docs.length };
  }
}

/**
 * Concurrently fetches patent JSONs from S3 for a single batch and updates their fields.
 */
async function fetchBatchData(
  currentBatch,
  batchNum,
  totalBatches,
  s3Client,
  bucketName,
  options,
  totals,
  patentListLength
) {
  const { concurrencyLimit, progressInterval, debugLogFields } = options;
  console.log(`\n--- [Batch ${batchNum}/${totalBatches}] Fetching ${currentBatch.length} patent(s) from S3 ---`);

  const esBatchDocs = [];
  const s3UploadQueue = [];
  let fetchedCount = 0;
  let updatedCount = 0;
  let failedCount = 0;

  let itemIdx = 0;
  async function worker() {
    while (itemIdx < currentBatch.length) {
      const idx = itemIdx++;
      if (idx >= currentBatch.length) break;

      const patentId = currentBatch[idx];
      try {
        const { data, resolvedKey } = await fetchPatentFromS3(s3Client, bucketName, patentId);
        fetchedCount++;

        // Update JSON fields
        const updatedJson = updatePatentData(data, patentId);
        updatedCount++;

        if (debugLogFields) {
          console.log(`\n    [DEBUG] Updated fields for patent '${patentId}':`);
          if (updatedJson.PNW) console.log(`      PNW:  `, JSON.stringify(updatedJson.PNW));
          if (updatedJson.PNWK) console.log(`      PNWK: `, JSON.stringify(updatedJson.PNWK));
        }

        // Prepare ES Doc & S3 Upload item
        const docId = updatedJson.patent_id || updatedJson.id || patentId;
        esBatchDocs.push({ id: docId, body: updatedJson });
        s3UploadQueue.push({ key: resolvedKey, data: updatedJson });

        totals.processedCount++;
        if (totals.processedCount % progressInterval === 0 || totals.processedCount === patentListLength) {
          console.log(`    [>] Progress: [${totals.processedCount}/${patentListLength}] Processed patent: ${patentId}`);
        }
      } catch (itemErr) {
        console.error(`    [!] Failed to process ${patentId}: ${itemErr.message}`);
        failedCount++;
        totals.processedCount++;
      }
    }
  }

  const workers = [];
  const limit = Math.min(concurrencyLimit, currentBatch.length);
  for (let i = 0; i < limit; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return {
    batchNum,
    currentBatch,
    esBatchDocs,
    s3UploadQueue,
    fetchedCount,
    updatedCount,
    failedCount,
  };
}

/**
 * Splits batch docs into sub-chunks of max size `esBulkChunkSize`.
 * For each sub-chunk: bulk indexes into ES and instantly uploads to S3.
 */
async function processBatchChunks(
  batchData,
  esClient,
  esIndex,
  s3Client,
  bucketName,
  options
) {
  const { batchNum, esBatchDocs, s3UploadQueue } = batchData;
  const { enableEsIndex, enableS3Upload, esBulkChunkSize } = options;

  let totalEsIndexed = 0;
  let totalS3Uploaded = 0;

  if (esBatchDocs.length === 0) {
    return { totalEsIndexed, totalS3Uploaded };
  }

  const totalItems = esBatchDocs.length;
  const chunkCount = Math.ceil(totalItems / esBulkChunkSize);

  console.log(`\n  [Batch ${batchNum}] Indexing & Uploading ${totalItems} document(s) in ${chunkCount} sub-chunk(s) (max ${esBulkChunkSize}/chunk)...`);

  for (let cIdx = 0; cIdx < chunkCount; cIdx++) {
    const start = cIdx * esBulkChunkSize;
    const end = Math.min(start + esBulkChunkSize, totalItems);

    const esChunkDocs = esBatchDocs.slice(start, end);
    const s3ChunkQueue = s3UploadQueue.slice(start, end);

    console.log(`\n    [Batch ${batchNum} | Chunk ${cIdx + 1}/${chunkCount}] Processing ${esChunkDocs.length} patent(s)...`);

    // 1. Bulk index chunk into Elasticsearch
    if (enableEsIndex && esClient && esChunkDocs.length > 0) {
      console.log(`      [*] Bulk indexing ${esChunkDocs.length} document(s) into ES index '${esIndex}'...`);
      const { indexed, failed } = await bulkIndexToElasticsearch(esClient, esIndex, esChunkDocs);
      totalEsIndexed += indexed;
      if (failed > 0) {
        console.warn(`      [!] ES Indexing warnings: ${failed} document(s) failed indexing.`);
      } else {
        console.log(`      [+] ES Bulk Indexing successful (${indexed} documents).`);
      }
    } else if (!enableEsIndex) {
      console.log(`      [*] ES Indexing is DISABLED (ENABLE_ES_INDEX=false). Skipping Elasticsearch indexing.`);
    }

    // 2. Instantly re-upload updated JSONs for this chunk to S3
    if (enableS3Upload && s3ChunkQueue.length > 0) {
      console.log(`      [*] Instantly re-uploading ${s3ChunkQueue.length} updated JSON(s) for Chunk ${cIdx + 1} to S3 bucket '${bucketName}'...`);
      for (const item of s3ChunkQueue) {
        try {
          await uploadPatentToS3(s3Client, bucketName, item.key, item.data);
          totalS3Uploaded++;
        } catch (upErr) {
          console.error(`      [!] Failed S3 re-upload for ${item.key}: ${upErr.message}`);
        }
      }
      console.log(`      [+] S3 Chunk ${cIdx + 1} Upload finished.`);
    } else if (!enableS3Upload) {
      console.log(`      [*] S3 Re-upload is DISABLED (ENABLE_S3_UPLOAD=false). Skipping S3 upload.`);
    }
  }

  return { totalEsIndexed, totalS3Uploaded };
}

async function main() {
  console.log("=================================================");
  console.log("   BATCH S3 PATENT FETCH, ES INDEX & UPLOAD      ");
  console.log("=================================================\n");

  // 1. AWS Configuration (optional credentials; falls back to EC2 IAM role)
  let accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  let secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  let region = process.env.AWS_REGION || "ap-south-1";
  let bucketName = process.env.AWS_BUCKET_NAME;

  if (!bucketName) {
    bucketName = await askQuestion("Enter S3 Bucket Name: ");
  }

  const endpoint = process.env.AWS_ENDPOINT;
  const s3Config = { region };

  if (accessKeyId && secretAccessKey) {
    s3Config.credentials = { accessKeyId, secretAccessKey };
  } else {
    console.log("[*] AWS explicit credentials omitted. Using default AWS credential provider chain / EC2 IAM role.");
  }

  if (endpoint) {
    s3Config.endpoint = endpoint;
    s3Config.forcePathStyle = true;
  }
  const s3Client = new S3Client(s3Config);

  // 2. Elasticsearch Client Initialization
  const esNode = process.env.ELASTICSEARCH_NODE || "http://localhost:9200";
  const esIndex = process.env.ELASTICSEARCH_INDEX || "patents";
  let esClient = null;

  try {
    const esAuthConfig = {};
    if (process.env.ELASTICSEARCH_API_KEY) {
      esAuthConfig.apiKey = process.env.ELASTICSEARCH_API_KEY;
    } else if (process.env.ELASTICSEARCH_USERNAME) {
      esAuthConfig.username = process.env.ELASTICSEARCH_USERNAME;
      esAuthConfig.password = process.env.ELASTICSEARCH_PASSWORD || "";
    }

    esClient = new Client({
      node: esNode,
      auth: Object.keys(esAuthConfig).length > 0 ? esAuthConfig : undefined,
      tls: {
        rejectUnauthorized: process.env.ELASTICSEARCH_REJECT_UNAUTHORIZED === "true",
      },
    });

    console.log(`[+] Connected ES Client target node: ${esNode} (Index: ${esIndex})`);
  } catch (esErr) {
    console.warn(`[!] Warning: Failed to initialize ES Client (${esErr.message}). ES Indexing will be skipped.`);
  }

  // 3. Batching & Concurrency Config from .env
  const batchSize = parseInt(process.env.BATCH_SIZE || "20", 10);
  const concurrencyLimit = parseInt(process.env.CONCURRENCY_LIMIT || "10", 10);
  const progressInterval = Math.max(1, parseInt(process.env.PROGRESS_INTERVAL || "10", 10));
  const esBulkChunkSize = parseInt(process.env.ES_BULK_CHUNK_SIZE || process.env.CHUNK_SIZE || "40", 10);
  const enableS3Upload = process.env.ENABLE_S3_UPLOAD === "true";
  const enableEsIndex = process.env.ENABLE_ES_INDEX === "true";
  const debugLogFields = process.env.DEBUG_LOG_UPDATED_FIELDS === "true";

  console.log(`[*] Configured Batch Size: ${batchSize} patents/batch`);
  console.log(`[*] Configured Concurrency Limit: ${concurrencyLimit} parallel workers`);
  console.log(`[*] ES Bulk Chunk Size: ${esBulkChunkSize} docs/chunk (ES index & S3 upload)`);
  console.log(`[*] Progress Log Interval: Every ${progressInterval} patent(s)`);
  console.log(`[*] S3 Re-upload Enabled: ${enableS3Upload}`);
  console.log(`[*] ES Indexing Enabled:  ${enableEsIndex}`);
  console.log(`[*] Debug Logging Enabled: ${debugLogFields}`);

  // 4. Scan 'txt/' directory for patent list files
  const txtDir = path.join(__dirname, "txt");
  if (!fs.existsSync(txtDir)) {
    fs.mkdirSync(txtDir, { recursive: true });
  }

  const txtFiles = fs
    .readdirSync(txtDir)
    .filter((file) => file.toLowerCase().endsWith(".txt"));

  if (txtFiles.length === 0) {
    console.error(`[-] Error: No .txt files found in input directory: ${txtDir}`);
    console.error("Please place your patent list .txt file(s) in 'sync-es-patent/txt/' and try again.");
    process.exit(1);
  }

  console.log(`[+] Found ${txtFiles.length} TXT file(s) in 'sync-es-patent/txt/'.\n`);

  for (const txtFile of txtFiles) {
    const txtPath = path.join(txtDir, txtFile);
    console.log(`=================================================`);
    console.log(`Processing Patent List File: ${txtFile}`);
    console.log(`=================================================`);

    let patentList = [];
    try {
      const content = fs.readFileSync(txtPath, "utf8");
      patentList = parsePatentNumbersFromTxt(content);
    } catch (err) {
      console.error(`[-] Error reading file ${txtFile}: ${err.message}`);
      continue;
    }

    if (patentList.length === 0) {
      console.log(`[-] No patent numbers found in ${txtFile}. Skipping.`);
      continue;
    }

    console.log(`[+] Total patent numbers extracted: ${patentList.length}`);

    // Split into batches
    const batches = [];
    for (let i = 0; i < patentList.length; i += batchSize) {
      batches.push(patentList.slice(i, i + batchSize));
    }

    console.log(`[*] Split into ${batches.length} batch(es) of max ${batchSize} items.`);

    let totalS3Fetched = 0;
    let totalUpdated = 0;
    let totalEsIndexed = 0;
    let totalS3Uploaded = 0;
    let totalFailed = 0;

    const totals = { processedCount: 0 };
    const options = {
      concurrencyLimit,
      progressInterval,
      debugLogFields,
      enableEsIndex,
      enableS3Upload,
      esBulkChunkSize,
    };

    // Pre-fetch Batch 1
    let nextFetchPromise = fetchBatchData(
      batches[0],
      1,
      batches.length,
      s3Client,
      bucketName,
      options,
      totals,
      patentList.length
    );

    for (let bIdx = 0; bIdx < batches.length; bIdx++) {
      const batchNum = bIdx + 1;

      // 1. Await fetch for current batch
      const currentBatchData = await nextFetchPromise;

      totalS3Fetched += currentBatchData.fetchedCount;
      totalUpdated += currentBatchData.updatedCount;
      totalFailed += currentBatchData.failedCount;

      // 2. Trigger background pre-fetch for next batch if available
      if (bIdx + 1 < batches.length) {
        console.log(`\n  [⚡ Pipeline] Triggering pre-fetch for Batch ${batchNum + 1}/${batches.length} in background while Batch ${batchNum} indexes and uploads...`);
        nextFetchPromise = fetchBatchData(
          batches[bIdx + 1],
          batchNum + 1,
          batches.length,
          s3Client,
          bucketName,
          options,
          totals,
          patentList.length
        );
      } else {
        nextFetchPromise = null;
      }

      // 3. Process ES indexing & S3 upload in sub-chunks for current batch
      const { totalEsIndexed: chunkEsCount, totalS3Uploaded: chunkS3Count } =
        await processBatchChunks(
          currentBatchData,
          esClient,
          esIndex,
          s3Client,
          bucketName,
          options
        );

      totalEsIndexed += chunkEsCount;
      totalS3Uploaded += chunkS3Count;
    }

    console.log(`\n=================================================`);
    console.log(`       SUMMARY FOR ${txtFile}`);
    console.log(`=================================================`);
    console.log(`Total Requested:    ${patentList.length}`);
    console.log(`Fetched from S3:    ${totalS3Fetched}`);
    console.log(`Fields Updated:     ${totalUpdated}`);
    console.log(`Indexed in ES:      ${totalEsIndexed}`);
    console.log(`Re-uploaded to S3:  ${totalS3Uploaded}`);
    console.log(`Failed Items:       ${totalFailed}`);
    console.log(`=================================================\n`);
  }
}

main().catch((err) => {
  console.error("An unexpected error occurred during batch sync execution:", err);
});
