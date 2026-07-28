/**
 * Helper to generate all combinations for patent numbers:
 * - PNW (Without Kindcode): Omits/strips Kindcode suffix completely.
 * - PNWK (With Kindcode): Includes Kindcode suffix.
 * 
 * Generated Combination Forms:
 * 1. [Prefix][DigitsWithZero][Suffix]          (e.g., RE041900 / RE041900E)
 * 2. [PNC][Prefix][DigitsWithZero][Suffix]     (e.g., USRE041900 / USRE041900E)
 * 3. [Prefix][DigitsWithoutZero][Suffix]       (e.g., RE41900 / RE41900E)
 * 4. [PNC][Prefix][DigitsWithoutZero][Suffix]  (e.g., USRE41900 / USRE41900E)
 *
 * @param {string|string[]} inputValues - Patent number(s) to transform
 * @param {string} pnc - Country code (e.g., "US")
 * @param {boolean} isPnw - If true, strips kindcode for PNW. If false, includes kindcode for PNWK.
 * @param {string} fallbackKindCode - Fallback Kindcode from PKC / KC if available
 * @returns {string[]} Unique array of patent number combinations
 */
export function transformPatentCombinations(inputValues, pnc, isPnw = false, fallbackKindCode = "") {
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
    } else if (!currentPnc && item.match(/^[A-Z]{2}/i)) {
      currentPnc = item.substring(0, 2).toUpperCase();
      item = item.substring(2).trim();
    }

    // Parse remaining core into [prefix][digits][suffix]
    // e.g. "RE041900E" -> prefix="RE", digits="041900", suffix="E"
    const match = item.match(/^([A-Za-z]*)(\d+)([A-Za-z0-9]*)$/);
    if (!match) {
      let coreVal = rawItem;
      if (isPnw && currentPnc && coreVal.toUpperCase().startsWith(currentPnc)) {
        coreVal = coreVal.substring(currentPnc.length);
      }
      resultSet.add(coreVal);
      if (currentPnc && !coreVal.toUpperCase().startsWith(currentPnc)) {
        resultSet.add(currentPnc + coreVal);
      }
      continue;
    }

    const prefix = match[1];
    const digitsWithZero = match[2];
    const extractedSuffix = match[3] || "";
    const digitsWithoutZero = digitsWithZero.replace(/^0+/, "") || "0";

    // For PNW (Without Kindcode): suffix must be empty string ""
    // For PNWK (With Kindcode): preference goes to extractedSuffix, fallback to fallbackKindCode
    const cleanSuffix = (extractedSuffix || fallbackKindCode || "").trim();
    const suffix = isPnw ? "" : cleanSuffix;

    // Form 1: Prefix + DigitsWithZero + Suffix (e.g. RE041900 for PNW, RE041900E for PNWK)
    const form1 = `${prefix}${digitsWithZero}${suffix}`;
    // Form 2: PNC + Prefix + DigitsWithZero + Suffix (e.g. USRE041900 for PNW, USRE041900E for PNWK)
    const form2 = currentPnc ? `${currentPnc}${prefix}${digitsWithZero}${suffix}` : form1;
    // Form 3: Prefix + DigitsWithoutZero + Suffix (e.g. RE41900 for PNW, RE41900E for PNWK)
    const form3 = `${prefix}${digitsWithoutZero}${suffix}`;
    // Form 4: PNC + Prefix + DigitsWithoutZero + Suffix (e.g. USRE41900 for PNW, USRE41900E for PNWK)
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

  // Determine Kind Code (PKC)
  let pkc = (jsonData.PKC || jsonData.KC || "").trim();
  if (!pkc && patentId) {
    // Extract trailing kind code suffix after digits (e.g. "USRE015592E" -> "E", "US7654321B2" -> "B2")
    const match = patentId.match(/\d+([A-Za-z][A-Za-z0-9]*)$/);
    if (match) {
      pkc = match[1];
    }
  }

  // Transform PNW field (isPnw = true: strips any KindCode)
  if (jsonData.PNW) {
    jsonData.PNW = transformPatentCombinations(jsonData.PNW, pnc, true, pkc);
  }

  // Transform PNWK field (isPnw = false: includes KindCode)
  if (jsonData.PNWK) {
    jsonData.PNWK = transformPatentCombinations(jsonData.PNWK, pnc, false, pkc);
  }

  return jsonData;
}
