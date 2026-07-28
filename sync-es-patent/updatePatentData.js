/**
 * Helper to generate all combinations for patent numbers (PNW and PNWK):
 * 1. [Prefix][DigitsWithZero][Suffix]          (e.g., RE041900 / RE041900E)
 * 2. [PNC][Prefix][DigitsWithZero][Suffix]     (e.g., USRE041900 / USRE041900E)
 * 3. [Prefix][DigitsWithoutZero][Suffix]       (e.g., RE41900 / RE41900E)
 * 4. [PNC][Prefix][DigitsWithoutZero][Suffix]  (e.g., USRE41900 / USRE41900E)
 *
 * @param {string|string[]} inputValues - Patent number(s) to transform
 * @param {string} pnc - Country code (e.g., "US")
 * @returns {string[]} Unique array of patent number combinations
 */
export function transformPatentCombinations(inputValues, pnc) {
  if (!inputValues) return inputValues;

  const items = Array.isArray(inputValues) ? inputValues : [inputValues];
  const resultSet = new Set();
  const cleanPnc = (pnc || "").trim().toUpperCase();

  for (const rawItem of items) {
    if (typeof rawItem !== "string" || !rawItem.trim()) continue;

    let item = rawItem.trim();
    let currentPnc = cleanPnc;

    // If item starts with country code PNC (e.g. US), strip it to get the core
    if (currentPnc && item.toUpperCase().startsWith(currentPnc)) {
      item = item.substring(currentPnc.length).trim();
    }

    // Parse remaining core into [prefix][digits][suffix]
    // e.g. "RE041900E" -> prefix="RE", digits="041900", suffix="E"
    const match = item.match(/^([A-Za-z]*)(\d+)([A-Za-z0-9]*)$/);
    if (!match) {
      resultSet.add(rawItem);
      if (currentPnc && !rawItem.toUpperCase().startsWith(currentPnc)) {
        resultSet.add(currentPnc + rawItem);
      }
      continue;
    }

    const prefix = match[1];
    const digitsWithZero = match[2];
    const suffix = match[3];
    const digitsWithoutZero = digitsWithZero.replace(/^0+/, "") || "0";

    // Form 1: Prefix + DigitsWithZero + Suffix (e.g. RE041900)
    const form1 = `${prefix}${digitsWithZero}${suffix}`;
    // Form 2: PNC + Prefix + DigitsWithZero + Suffix (e.g. USRE041900)
    const form2 = currentPnc ? `${currentPnc}${prefix}${digitsWithZero}${suffix}` : form1;
    // Form 3: Prefix + DigitsWithoutZero + Suffix (e.g. RE41900)
    const form3 = `${prefix}${digitsWithoutZero}${suffix}`;
    // Form 4: PNC + Prefix + DigitsWithoutZero + Suffix (e.g. USRE41900)
    const form4 = currentPnc ? `${currentPnc}${prefix}${digitsWithoutZero}${suffix}` : form3;

    resultSet.add(form1);
    resultSet.add(form2);
    resultSet.add(form3);
    resultSet.add(form4);
  }

  return Array.from(resultSet);
}

/**
 * Custom hook to update fields in the patent JSON object before ES indexing and S3 upload.
 * 
 * @param {object} jsonData - Parsed patent JSON document from S3
 * @param {string} patentId - The patent ID / file key
 * @returns {object} Updated patent JSON object
 */
export function updatePatentData(jsonData, patentId) {
  if (!jsonData || typeof jsonData !== "object") {
    return jsonData;
  }

  // Determine Country Code (PNC)
  const pnc = (
    jsonData.PNC ||
    (patentId && patentId.match(/^[A-Z]{2}/i) ? patentId.match(/^[A-Z]{2}/i)[0] : "") ||
    ""
  ).trim().toUpperCase();

  // Transform PNW field into all combinations
  if (jsonData.PNW) {
    jsonData.PNW = transformPatentCombinations(jsonData.PNW, pnc);
  }

  // Transform PNWK field into all combinations
  if (jsonData.PNWK) {
    jsonData.PNWK = transformPatentCombinations(jsonData.PNWK, pnc);
  }

  return jsonData;
}
