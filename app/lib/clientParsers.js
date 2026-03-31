// ═══════════════════════════════════════════════════════════
//  CLIENT AUTO-DETECTION
//  Looks at the file content/name to figure out which client
// ═══════════════════════════════════════════════════════════
export function detectClient(text, fileName) {
  const lower = (text || "").toLowerCase();
  const fileLower = (fileName || "").toLowerCase();

  // Red Oak always sends Excel
  if (fileLower.endsWith(".xlsx") || fileLower.endsWith(".xls")) return "Red Oak";

  // King Aerospace PDF contains their report title
  if (lower.includes("kacc weekly") || lower.includes("kacc")) return "King Aerospace";

  // Bombardier Hartford PDF contains their system name or company identifiers
  if (
    lower.includes("autotime") ||
    lower.includes("bombardier") ||
    lower.includes("learjet") ||
    lower.includes("hadg")
  )
    return "Bombardier Hartford";

  return null;
}

// ═══════════════════════════════════════════════════════════
//  KING AEROSPACE PARSER
//
//  Report: "KACC Weekly Timecard Detail"
//  Key line per employee:
//    "Totals for Grimmet, Jonnie .00 8.05 8.15 8.10 8.08 4.13 .00 36.51 36.51 .00 .00"
//  Column order: Sun Mon Tue Wed Thu Fri Sat Total Regular OT DT
// ═══════════════════════════════════════════════════════════
export function parseKingAerospace(text) {
  const entries = [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  console.log("[KingAero] Lines:", lines); // debug

  // Extract the period end date — try a few formats
  let weekEnding = "";
  const dateMatch =
    text.match(/To Period End Date:\s*(\d{2})\/(\d{2})\/(\d{2})/) ||
    text.match(/Period End Date:\s*(\d{2})\/(\d{2})\/(\d{2})/);
  if (dateMatch) {
    weekEnding = `20${dateMatch[3]}-${dateMatch[1]}-${dateMatch[2]}`;
  }

  // Helper: extract the last N numbers from a line
  function trailingNums(line, n) {
    const nums = [...line.matchAll(/([\d]+\.[\d]+|\.[\d]+|\d+)/g)].map((m) => m[1]);
    return nums.length >= n ? nums.slice(-n) : null;
  }

  // Strategy 1: Look for "Totals for [Name]" lines
  for (const line of lines) {
    if (!line.toLowerCase().includes("totals for ")) continue;
    if (line.toLowerCase().includes("report totals")) continue;

    // Extract name: everything between "Totals for " and the first number
    const nameMatch = line.match(/[Tt]otals\s+for\s+(.+?)\s+[\d.]/);
    if (!nameMatch) continue;

    const name = nameMatch[1].trim();
    const nums = trailingNums(line, 4); // we need at least [Total, Regular, OT, DT]
    if (!nums) continue;

    const regHours = parseFloat(nums[nums.length - 3]) || 0;
    const otHours  = parseFloat(nums[nums.length - 2]) || 0;
    const dtHours  = parseFloat(nums[nums.length - 1]) || 0;

    console.log("[KingAero] Parsed:", name, regHours, otHours, dtHours);

    if (regHours > 0 || otHours > 0 || dtHours > 0) {
      entries.push({ name, weekEnding, regHours, otHours, dtHours, status: "complete" });
    }
  }

  // Strategy 2 (fallback): "Period Ending MM/DD/YY ..." lines followed by name
  if (entries.length === 0) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.match(/^Period Ending\s+\d{2}\/\d{2}\/\d{2}/)) continue;

      const nums = trailingNums(line, 4);
      if (!nums) continue;

      // Name is on the line(s) before — scan backwards for "Last, First" pattern
      let name = "";
      for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
        if (lines[j].match(/^[A-Z][a-z]+,\s+[A-Z]/)) { name = lines[j]; break; }
      }
      if (!name) continue;

      const regHours = parseFloat(nums[nums.length - 3]) || 0;
      const otHours  = parseFloat(nums[nums.length - 2]) || 0;
      const dtHours  = parseFloat(nums[nums.length - 1]) || 0;

      if (regHours > 0 || otHours > 0 || dtHours > 0) {
        entries.push({ name, weekEnding, regHours, otHours, dtHours, status: "complete" });
      }
    }
  }

  console.log("[KingAero] Final entries:", entries);
  return entries;
}

// ═══════════════════════════════════════════════════════════
//  BOMBARDIER HARTFORD PARSER
//
//  Page 1: Invoice summary (number, date, total amount)
//  Page 2: AUTOTIME table — one row per employee
//    Columns: Dated | EE# | First Name | Last Name | Agency | #Days
//
//  NOTE: Hours are NOT in this file.
//  Entries are created with status: "needs_hours" → ADG fills them in.
// ═══════════════════════════════════════════════════════════
export function parseBombardier(text) {
  const lines = text.split("\n").map((l) => l.trim());

  // Extract invoice details from page 1
  const invNumMatch = text.match(/Invoice Number:\s*(\S+)/);
  const invDateMatch = text.match(/Invoice date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
  const amountMatch = text.match(/\$\s*([\d,]+(?:\.\d{2})?)/);

  const invoiceNumber = invNumMatch ? invNumMatch[1] : "";
  const invoiceDate = invDateMatch ? invDateMatch[1] : "";
  const invoiceAmount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, "")) : 0;

  // Find employee rows in the AUTOTIME table
  const entries = [];
  let inTable = false;

  for (const line of lines) {
    if (line.includes("Dated") && line.includes("EE#")) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (line.startsWith("Week ending") || !line) continue;

    // Pattern: MM/DD/YYYY  EE#  FirstName [MiddleName] LastName  HADG  #Days  ...
    const match = line.match(/^(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d+)\s+(.+?)\s+HADG\s+(\d+)/);
    if (!match) continue;

    const dateStr = match[1];
    const eeNumber = match[2];
    const fullName = match[3].trim();
    const daysWorked = parseInt(match[4]) || 0;

    // Convert MM/DD/YYYY → YYYY-MM-DD
    const [m, d, y] = dateStr.split("/");
    const weekEnding = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;

    // Format name: "Gemel Deshun Williams" → "Williams, Gemel"
    const parts = fullName.split(/\s+/);
    const lastName = parts[parts.length - 1];
    const firstName = parts[0];
    const name = `${lastName}, ${firstName}`;

    entries.push({
      name,
      importedFullName: fullName,
      eeNumber,
      weekEnding,
      daysWorked,
      invoiceAmount,
      invoiceNumber,
      invoiceDate,
      regHours: 0,  // ADG must fill in
      otHours: 0,
      status: "needs_hours",
    });
  }

  return { entries, invoiceAmount, invoiceNumber, invoiceDate };
}

// ═══════════════════════════════════════════════════════════
//  RED OAK (QARBON) EXCEL PARSER
//
//  Columns in sheet "ALL Red Oak Contractors":
//    A: Employee Name   E: S/T Hours   F: ST Rate (bill rate)
//    H: O/T Hours       I: OT Rate (bill rate × 1.5)
// ═══════════════════════════════════════════════════════════
export function parseRedOak(rows, headers) {
  const entries = [];

  // Map header names to column indices
  const idx = {};
  headers.forEach((h, i) => {
    const lower = h.toLowerCase().trim();
    if (lower.includes("employee name")) idx.name = i;
    if (lower.includes("s/t hours") || lower === "s/t hours worked") idx.regHours = i;
    if (lower.includes("st rate") || lower.includes("st earnings")) {
      if (!lower.includes("earning")) idx.billREG = i;
    }
    if (lower.includes("o/t hours") || lower === "o/t hours worked") idx.otHours = i;
    if (lower.includes("ot rate")) idx.billOT = i;
    if (lower.includes("emp number")) idx.empNumber = i;
    if (lower.includes("timekeeping notes")) idx.notes = i;
  });

  for (const row of rows) {
    const name = String(row[idx.name] ?? "").trim();
    if (!name) continue;

    const regHours = parseFloat(row[idx.regHours]) || 0;
    const otHours = parseFloat(row[idx.otHours]) || 0;
    const billREG = parseFloat(row[idx.billREG]) || 0;
    const billOT = parseFloat(row[idx.billOT]) || 0;
    const notes = idx.notes !== undefined ? String(row[idx.notes] ?? "") : "";

    if (regHours === 0 && otHours === 0) continue;

    entries.push({ name, regHours, otHours, billREG, billOT, notes, status: "complete" });
  }

  return entries;
}
