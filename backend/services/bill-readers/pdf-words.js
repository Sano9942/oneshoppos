/**
 * Every word of a computer-made PDF with its position (One Toy Store F9 (b)).
 *
 * pdfjs-dist gives text runs ("ONE SHOP Packages Mall") with the run's start
 * and width; a run is cut into words with the x shared out by characters.
 * Coordinates are turned to "top from the page top" like a screen, in PDF
 * points. A photo / scanned PDF has no text: pages come back with no words.
 */

let pdfjsPromise = null;
function loadPdfjs() {
  // pdfjs-dist is an ES module; the backend is CommonJS.
  if (!pdfjsPromise) pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
}

async function extractPdfWords(buffer, { maxPages = 40 } = {}) {
  const pdfjs = await loadPdfjs();
  const data = Uint8Array.from(buffer);
  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;
  try {
    const pages = [];
    const n = Math.min(doc.numPages, maxPages);
    for (let p = 1; p <= n; p++) {
      const page = await doc.getPage(p);
      const { height, width } = page.getViewport({ scale: 1 });
      const { items } = await page.getTextContent();
      const words = [];
      for (const it of items) {
        const str = it.str || "";
        if (!str.trim()) continue;
        const [a, , , d, x, y] = it.transform;
        const size = Math.abs(d) || Math.abs(a) || 10;
        const runWidth = it.width || str.length * size * 0.5;
        const perChar = runWidth / str.length;
        const top = height - y - size;
        for (const m of str.matchAll(/\S+/g)) {
          const x0 = x + m.index * perChar;
          words.push({ text: m[0], x0, x1: x0 + m[0].length * perChar, top, bottom: top + size, page: p });
        }
      }
      pages.push({ page: p, width, height, words });
    }
    return { pageCount: doc.numPages, pages };
  } finally {
    await doc.destroy();
  }
}

module.exports = { extractPdfWords };
