# Patent Downloader & Field Processing Tool

This merged utility provides two functionalities in a single unified Node.js project:
1. **Download Patents**: Downloads patent JSON files from AWS S3 (configured via `.env`) based on patent lists in a `csv/` folder and saves them as ZIP archives in the `downloads/` directory.
2. **Process Patents**: Processes ZIP archives of patent JSON files directly from the `downloads/` folder. It filters their keys using a configuration file (`field.csv`), generates clean `.txt` files for any designated text fields (matching line-spacing and tag-stripping rules), and packages the output back into ZIP files inside `processed_patent/`.

## Directory Structure

```text
processpatent/
├── package.json        # Combined Node.js project configuration
├── README.md           # This instructions file
├── getpatent.js        # The AWS S3 patent downloader script (ESM)
├── process.js          # The Node.js patent filtering and TXT conversion script (ESM)
├── field.csv           # Config file designating fields to keep and fields to format into TXT
├── .env                # AWS credentials configuration
├── csv/                # Input folder containing CSV lists of patents to download
├── downloads/          # Unified folder where downloader saves ZIPs & processor reads ZIPs
└── processed_patent/   # Output folder where processed ZIP archives are generated
```

## How It Works

1. **Download (getpatent)**:
   - Place a CSV of patent IDs inside the `csv/` folder.
   - Run the downloader: `npm start` (reads settings from `.env` or prompts for credentials).
   - This downloads the files and packages them into ZIP archives under `downloads/`.

2. **Process (process)**:
   - Ensure the fields you want to filter are configured in `field.csv` (use a second column with value `text` to convert HTML-laden JSON fields into plain TXT files).
   - Run the processor: `npm run process`.
   - The script scans `downloads/` and `../getpatent/downloads/` for input ZIP files.
   - Filters the JSON files, extracts text sections, formats them cleanly into matching `.txt` files, and saves everything back into corresponding ZIP files under `processed_patent/`.

## Usage

First, install the dependencies:
```bash
npm install
```

### 1. Run the Patent Downloader
To download patents from S3:
```bash
npm start
```

### 2. Run the Patent Processor
To process, filter, and convert the downloaded ZIPs:
```bash
npm run process
```

## Script Features
- **Unified Pipeline**: The downloader outputs ZIP files into `downloads/` and the processor reads them directly from `downloads/`, making it easy to run them sequentially.
- **In-Memory ZIP Processing**: Unzips and processes JSON content entirely in-memory, minimizing disk usage.
- **Dynamic TXT Conversion**: Automatically formats JSON text fields (e.g. `AB_EN`, `CL_EN`, etc.) into clean plain-text `.txt` files with strict line-spacing rules and HTML tag stripping.
- **Conflict Resolution**: Ensures unique filenames within output ZIP files by appending numerical suffixes (e.g. `_1.json`, `_1.txt`) if names clash.
- **Flexible Path Scanning**: Scans multiple local and parent sibling paths to locate input ZIPs seamlessly.
