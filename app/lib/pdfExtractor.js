// ═══════════════════════════════════════════════════════════
//  BROWSER-SIDE PDF TEXT EXTRACTOR
//  Uses PDF.js loaded from CDN with proper line reconstruction.
// ═══════════════════════════════════════════════════════════

const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";

async function loadPDFJS() {
  if (window._pdfjsLib) return window._pdfjsLib;

  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${PDFJS_CDN}/pdf.min.js`;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Failed to load PDF.js. Check internet connection."));
    document.head.appendChild(script);
  });

  window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
  window._pdfjsLib = window.pdfjsLib;
  return window._pdfjsLib;
}

export async function extractPDFText(file) {
  const pdfjs = await loadPDFJS();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;

  let fullText = "";

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    // Group text items by their Y position to reconstruct lines.
    // PDF coordinates have Y increasing upward, so sort descending (top → bottom).
    const lineMap = {};
    for (const item of textContent.items) {
      if (!item.str.trim()) continue;
      // Round Y to group items that are on the same visual line
      const y = Math.round(item.transform[5]);
      if (!lineMap[y]) lineMap[y] = [];
      lineMap[y].push({ x: item.transform[4], str: item.str });
    }

    // Sort lines top→bottom (highest Y first), sort items within each line left→right
    const sortedYs = Object.keys(lineMap)
      .map(Number)
      .sort((a, b) => b - a);

    const pageLines = sortedYs.map((y) => {
      const items = lineMap[y].sort((a, b) => a.x - b.x);
      return items.map((i) => i.str).join(" ");
    });

    fullText += pageLines.join("\n") + "\n";
  }

  console.log("[PDF Extract] Text:\n", fullText); // helpful for debugging
  return fullText;
}
