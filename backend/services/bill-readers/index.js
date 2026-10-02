/**
 * One Toy Store F9 (b): read a supplier bill file into lines (no AI).
 * PDFs made by the supplier's software are read by word position
 * (layouts.js). A PDF with no text (a scan) or a photo needs the photo
 * reader (step e) or typing.
 */
const { extractPdfWords } = require("./pdf-words");
const { parseBillWords } = require("./layouts");

async function readBillPdf(buffer) {
  const { pageCount, pages } = await extractPdfWords(buffer);
  const words = pages.flatMap((p) => p.words);
  if (!words.length) {
    return {
      layout: null, layout_label: null, supplier_hint: null, bill_number: null, bill_date: null,
      printed: {}, lines: [], lines_total: 0, total_matches: null, page_count: pageCount,
      warnings: ["No text in this PDF (a scan or photo): use the photo reader or type it in"],
    };
  }
  return { ...parseBillWords(words), page_count: pageCount };
}

module.exports = { readBillPdf };
