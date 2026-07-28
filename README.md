# Modular Patent Processing Tools

This project is organized into module-wise process folders sharing common root configuration files (`.env`, `shortcode.json`, `examplejson.json`).

## Directory Structure

```text
RW-scripts/
├── package.json                 # Node.js project configuration & scripts
├── README.md                    # Project documentation
├── .env                         # Shared AWS & Elasticsearch credentials & configurations
├── shortcode.json               # Shared common patent shortcode mappings
├── examplejson.json             # Shared common patent JSON format reference
│
├── process-patent/              # Module 1: Patent Download & Filtering Process
│   ├── getPatentFromS3.js       # S3 patent downloader script
│   ├── processPatentfromDownlods.js # Patent filtering and TXT conversion script
│   ├── structurePatents.js      # Patent directory structurer script
│   ├── field.csv                # Field extraction configuration
│   ├── field2.csv               # Secondary field extraction configuration
│   ├── csv/                     # Module CSV input folder containing lists of patents
│   ├── downloads/               # Module folder for downloaded patent ZIPs/JSONs
│   ├── processed_patent/        # Module output folder for processed patent archives
│   └── structured_patent/       # Module output folder for structured patent files
│
├── sync-es-patent/              # Module 2: Batch S3 Fetch, ES Indexing & S3 Re-upload Process
│   ├── syncEsPatent.js          # Batch S3 fetch, JSON field update, ES index & upload script
│   ├── updatePatentData.js      # Customizable field transformation logic
│   └── txt/                     # Input directory for TXT files containing patent numbers
│
└── export-es-patent/            # Module 3: Elasticsearch Paginated Query & Aggregation Exporter
    ├── exportEsPatent.js        # Script fetching > 10,000 patent numbers via composite aggregation
    ├── query.json               # Custom ES search query configuration
    └── output/                  # Output directory for exported patent_numbers.txt file
```

## Modular Design

- **Shared Root Config**: `.env`, `shortcode.json`, and `examplejson.json` reside at the root level to share environment variables and shortcode dictionary mappings across all process modules.
- **Module Isolation**: Each module has its own processing scripts and input/output directories.

## Configuration (`.env`)

Add AWS and Elasticsearch settings to `.env`:
```env
AWS_ACCESS_KEY_ID="your_access_key"
AWS_SECRET_ACCESS_KEY="your_secret_key"
AWS_REGION="ap-south-1"
AWS_BUCKET_NAME="rwire-all-patent-json-112024"

# Batching & Export
BATCH_SIZE=20
CONCURRENCY_LIMIT=10
EXPORT_FIELD="PN_B.keyword"
EXPORT_BUCKET_SIZE=10000

# Elasticsearch
ELASTICSEARCH_NODE="http://localhost:9200"
ELASTICSEARCH_INDEX="patents"
ELASTICSEARCH_USERNAME=""
ELASTICSEARCH_PASSWORD=""
ELASTICSEARCH_API_KEY=""
```

## Usage

First, install the dependencies:
```bash
npm install
```

### 1. Run the Patent Downloader
To download patents from S3 using `process-patent/getPatentFromS3.js`:
```bash
npm run get-patents
```

### 2. Run the Patent Processor
To filter and convert downloaded patent archives using `process-patent/processPatentfromDownlods.js`:
```bash
npm run process
```

### 3. Run the Patent Directory Structurer
To organize patent files into standard folder hierarchies using `process-patent/structurePatents.js`:
```bash
npm run structure
```

### 4. Run the Batch Elasticsearch & S3 Sync
To process patent lists from `sync-es-patent/txt/` in batches, update fields, index into Elasticsearch, and re-upload to S3:
```bash
npm run sync-es
```

### 5. Run the Elasticsearch Patent Exporter
To execute the ES query in `export-es-patent/query.json` and export > 10,000 patent numbers into `export-es-patent/output/patent_numbers.txt` using fast 10,000-bucket composite aggregations:
```bash
npm run export-es
```
