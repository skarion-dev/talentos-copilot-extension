// pdfGen.js — client-side PDF generation via vendored jsPDF (MIT, see
// vendor/LICENSE-jspdf). Same library Falood Studio's own resume export uses
// (src/lib/falood/skarionPdfDocument.tsx) — @react-pdf/renderer's server-side
// path is disabled on the Cloudflare Worker deployment (Node-only libraries
// don't run in the Workers runtime), so nothing here talks to a server for
// rendering; it all happens in this extension's own JS context.

// Professional file naming: "FirstName_LastName_Resume.pdf" / "..._CoverLetter.pdf".
function professionalFileName(candidateName, kind) {
  const safe = String(candidateName || 'Candidate')
    .replace(/\(.*?\)/g, '')          // drop parenthetical suffixes like "(QA Dummy)"
    .replace(/[^a-zA-Z\s-]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join('_');
  return `${safe || 'Candidate'}_${kind}.pdf`;
}

// Renders a simple, professional 1-page business letter. jsPDF's default
// Helvetica + basic text wrapping is intentionally plain — an ATS/hiring
// manager cares about the words, not a fancy template, and this stays
// entirely dependency-free beyond the one vendored library.
function buildCoverLetterPdf(candidateName, letterText) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const marginX = 64;
  const marginTop = 72;
  const maxWidth = 612 - marginX * 2;
  const lineHeight = 15;
  let y = marginTop;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);

  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  doc.text(dateStr, marginX, y);
  y += lineHeight * 2;

  const paragraphs = String(letterText || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  for (const para of paragraphs) {
    const lines = doc.splitTextToSize(para, maxWidth);
    for (const line of lines) {
      if (y > 720) { doc.addPage(); y = marginTop; }
      doc.text(line, marginX, y);
      y += lineHeight;
    }
    y += lineHeight * 0.6;
  }

  if (!/\n\s*$/.test(letterText) && candidateName && !paragraphs[paragraphs.length - 1]?.includes(candidateName)) {
    if (y > 700) { doc.addPage(); y = marginTop; }
    y += lineHeight * 0.5;
    doc.text(candidateName, marginX, y);
  }

  return doc.output('blob');
}

window.TosPdfGen = { professionalFileName, buildCoverLetterPdf };
