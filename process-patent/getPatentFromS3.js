import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(rootDir, ".env") });

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

const resolveKey = (input) => {
  // If it's already a full S3 key (contains folders)
  if (input.includes("/")) {
    return { primary: input };
  }

  // Otherwise, clean the name (remove .json if present)
  const cleanName = input.endsWith(".json") ? input.slice(0, -5) : input;

  // Run the prefix calculation
  const prefixed = calculatePrefix(cleanName);
  const flat = `${cleanName}.json`;

  if (prefixed === flat) {
    return { primary: flat };
  }

  return { primary: prefixed, fallback: flat };
};

const extractPatentsFromCSV = (csvContent) => {
  const lines = csvContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return [];

  // Simple CSV parser that handles quotes
  const parseCSVLine = (line) => {
    const result = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result.map((val) => val.replace(/^"|"$/g, "").trim());
  };

  const rows = lines.map((line) => parseCSVLine(line));
  if (rows.length === 0) return [];

  const headers = rows[0];
  let patentColIndex = -1;

  // Refined regexes for matching headers hierarchically
  const specificPatentHeaderRegex =
    /^(patent[-_\s]?number|patent[-_\s]?no|patent[-_\s]?id|pub[-_\s]?number|publication[-_\s]?number|publication[-_\s]?no|publication[-_\s]?id|application[-_\s]?number|app[-_\s]?number)$/i;
  const generalPatentHeaderRegex = /^(patent|patno)$/i;
  const genericHeaderRegex = /^(number|id)$/i;

  // 1. Look for highly specific patent headers
  for (let i = 0; i < headers.length; i++) {
    if (specificPatentHeaderRegex.test(headers[i])) {
      patentColIndex = i;
      break;
    }
  }

  // 2. If not found, look for general patent headers
  if (patentColIndex === -1) {
    for (let i = 0; i < headers.length; i++) {
      if (generalPatentHeaderRegex.test(headers[i])) {
        patentColIndex = i;
        break;
      }
    }
  }

  // 3. If not found, look for generic headers (like ID or Number)
  if (patentColIndex === -1) {
    for (let i = 0; i < headers.length; i++) {
      if (genericHeaderRegex.test(headers[i])) {
        patentColIndex = i;
        break;
      }
    }
  }

  // 4. If no header matched, let's analyze the columns of the first few rows (up to 5)
  // to find the column that looks most like patent numbers.
  if (patentColIndex === -1) {
    const numCols = headers.length;
    const patentScore = Array(numCols).fill(0);
    const sampleRows = rows.slice(0, Math.min(5, rows.length));

    // Patent-like pattern: e.g. starts with 2 letters, has digits, or just general format
    const patentPattern = /^[A-Z]{2}\d+[A-Z0-9]*$/i;

    for (const row of sampleRows) {
      for (let i = 0; i < Math.min(row.length, numCols); i++) {
        const val = row[i];
        if (patentPattern.test(val)) {
          patentScore[i]++;
        }
      }
    }

    // Find the column with the highest score
    let maxScore = 0;
    for (let i = 0; i < numCols; i++) {
      if (patentScore[i] > maxScore) {
        maxScore = patentScore[i];
        patentColIndex = i;
      }
    }
  }

  // 5. Fallback: if we still don't know, use the first column
  if (patentColIndex === -1) {
    patentColIndex = 0;
  }

  console.log(
    `Detected patent numbers in CSV column index: ${patentColIndex} (header: "${headers[patentColIndex] || ""}").`,
  );

  const patentNumbers = [];
  // Skip the first row if we detected a header row.
  // We consider it a header row if the detected header cell does not itself look like a patent number,
  // and matches one of our header patterns.
  const isHeaderPattern =
    specificPatentHeaderRegex.test(headers[patentColIndex]) ||
    generalPatentHeaderRegex.test(headers[patentColIndex]) ||
    genericHeaderRegex.test(headers[patentColIndex]);
  const patentPattern = /^[A-Z]{2}\d+[A-Z0-9]*$/i;
  const skipFirstRow =
    isHeaderPattern && !patentPattern.test(headers[patentColIndex]);
  const startRow = skipFirstRow ? 1 : 0;

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    if (row.length > patentColIndex) {
      const val = row[patentColIndex];
      if (val) {
        patentNumbers.push(val);
      }
    }
  }

  return patentNumbers;
};

async function downloadInParallel(
  targets,
  targetDownloadDir,
  s3Client,
  bucketName,
  concurrencyLimit
) {
  let successCount = 0;
  let failCount = 0;
  let index = 0;

  async function worker() {
    while (index < targets.length) {
      const currentIndex = index++;
      if (currentIndex >= targets.length) break;

      const target = targets[currentIndex];
      const { primary, fallback } = resolveKey(target);
      const baseName = path.basename(primary);
      const outputPath = path.join(targetDownloadDir, baseName);

      let success = false;
      let errorMsg = "";

      try {
        const response = await s3Client.send(
          new GetObjectCommand({
            Bucket: bucketName,
            Key: primary,
          }),
        );

        if (!response.Body) {
          throw new Error("Empty body returned from S3");
        }

        const fileStream = fs.createWriteStream(outputPath);
        await pipeline(response.Body, fileStream);
        success = true;
      } catch (error) {
        errorMsg = error.message;
        if (
          fallback &&
          (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404)
        ) {
          try {
            const response = await s3Client.send(
              new GetObjectCommand({
                Bucket: bucketName,
                Key: fallback,
              }),
            );

            if (!response.Body) {
              throw new Error("Empty body returned from S3");
            }

            const fileStream = fs.createWriteStream(outputPath);
            await pipeline(response.Body, fileStream);
            success = true;
          } catch (fallbackError) {
            errorMsg = `${error.message} (Fallback failed: ${fallbackError.message})`;
          }
        }
      }

      if (success) {
        console.log(`[${currentIndex + 1}/${targets.length}] Downloading ${target}... Done.`);
        successCount++;
      } else {
        console.log(`[${currentIndex + 1}/${targets.length}] Downloading ${target}... Failed. (${errorMsg})`);
        failCount++;
      }
    }
  }

  const workers = [];
  const limit = Math.min(concurrencyLimit, targets.length);
  for (let i = 0; i < limit; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return { successCount, failCount };
}

async function main() {
  console.log("=========================================");
  console.log("       S3 PATENT JSON DOWNLOADER         ");
  console.log("=========================================\n");

  // 1. Gather AWS Credentials (check env first, fallback to prompt)
  let accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  if (!accessKeyId) {
    accessKeyId = await askQuestion("Enter AWS Access Key ID: ");
    if (!accessKeyId) {
      console.error("Error: AWS Access Key ID is required.");
      process.exit(1);
    }
  }

  let secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!secretAccessKey) {
    secretAccessKey = await askQuestion("Enter AWS Secret Access Key: ");
    if (!secretAccessKey) {
      console.error("Error: AWS Secret Access Key is required.");
      process.exit(1);
    }
  }

  let region = process.env.AWS_REGION;
  if (!region) {
    region = await askQuestion("Enter AWS Region [us-east-1]: ");
    region = region || "us-east-1";
  }

  let bucketName = process.env.AWS_BUCKET_NAME;
  if (!bucketName) {
    bucketName = await askQuestion("Enter S3 Bucket Name: ");
    if (!bucketName) {
      console.error("Error: S3 Bucket Name is required.");
      process.exit(1);
    }
  }

  console.log("\nInitializing S3 Client...");
  const endpoint = process.env.AWS_ENDPOINT;
  const s3Config = {
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  };
  if (endpoint) {
    s3Config.endpoint = endpoint;
    s3Config.forcePathStyle = true;
  }
  const s3Client = new S3Client(s3Config);

  const downloadsDir = path.join(__dirname, "downloads");
  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
  }

  const csvDir = path.join(__dirname, "csv");
  if (!fs.existsSync(csvDir)) {
    fs.mkdirSync(csvDir, { recursive: true });
  }

  // Scan the 'csv' directory for .csv files
  const csvFiles = fs.existsSync(csvDir)
    ? fs.readdirSync(csvDir).filter((file) => file.toLowerCase().endsWith(".csv"))
    : [];

  if (csvFiles.length === 0) {
    console.error(`Error: No CSV files found in the 'csv' directory: ${csvDir}`);
    console.error("Please place your CSV files in the 'csv' directory and try again.");
    process.exit(1);
  }

  console.log(`Found ${csvFiles.length} CSV file(s) in the 'csv' folder.`);

  // Read concurrency limit from env
  const concurrencyLimit = parseInt(process.env.CONCURRENCY_LIMIT || "10", 10);
  console.log(`Concurrency limit set to: ${concurrencyLimit}`);

  for (const csvFile of csvFiles) {
    const csvPath = path.join(csvDir, csvFile);
    console.log(`\n=========================================`);
    console.log(`Processing CSV file: ${csvFile}`);
    console.log(`=========================================`);

    let keysToDownload = [];
    try {
      const content = fs.readFileSync(csvPath, "utf-8");
      keysToDownload = extractPatentsFromCSV(content);
      console.log(`Loaded ${keysToDownload.length} patent numbers from ${csvFile}.`);
    } catch (err) {
      console.error(`Error reading CSV file ${csvFile}: ${err.message}`);
      continue;
    }

    if (keysToDownload.length === 0) {
      console.log(`No patent numbers found in ${csvFile}. Skipping.`);
      continue;
    }

    const csvBaseName = path.basename(csvPath, path.extname(csvPath));
    const targetDownloadDir = path.join(downloadsDir, csvBaseName);
    if (!fs.existsSync(targetDownloadDir)) {
      fs.mkdirSync(targetDownloadDir, { recursive: true });
    }

    console.log(
      `Starting parallel download of ${keysToDownload.length} files to temporary folder ${targetDownloadDir}...\n`,
    );

    const { successCount, failCount } = await downloadInParallel(
      keysToDownload,
      targetDownloadDir,
      s3Client,
      bucketName,
      concurrencyLimit
    );

    // ZIP the downloads folder
    const zipPath = path.join(downloadsDir, `${csvBaseName}.zip`);
    console.log(`\nPackaging downloaded files into single ZIP archive: ${zipPath}...`);
    try {
      execSync(`zip -rj "${zipPath}" "${targetDownloadDir}"`, { stdio: 'ignore' });
      // Delete the temporary folder
      fs.rmSync(targetDownloadDir, { recursive: true, force: true });
    } catch (zipErr) {
      console.error(`Error zipping downloads: ${zipErr.message}`);
    }

    console.log("\n=========================================");
    console.log(`      DOWNLOAD SUMMARY FOR ${csvFile}     `);
    console.log("=========================================");
    console.log(`Total requested:  ${keysToDownload.length}`);
    console.log(`Successfully:     ${successCount}`);
    console.log(`Failed:           ${failCount}`);
    console.log(`Saved ZIP to:     ${zipPath}`);
    console.log("=========================================");
  }
}

main().catch((err) => {
  console.error("An unexpected error occurred:", err);
});
