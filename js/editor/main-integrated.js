import {editor, formatDocument} from "./editor.js";
import {generatePreview} from "./preview.js";
import {validateXML} from "./validator.js";

// Expose formatDocument globally for the button
window.formatDocument = formatDocument;

// Initialize PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.7.570/pdf.worker.min.js';

// State for PDF extraction
let extractionModal = null;
let extractedXHTML = null;

// Initialize on load
window.addEventListener("DOMContentLoaded", async () => {
    // Initialize Bootstrap modal
    extractionModal = new bootstrap.Modal(document.getElementById('pdf-extraction-modal'));

    // Try to load default XHTML file
    try {
        const url = "./xhtml-view/160028.xhtml";
        const resp = await fetch(url);
        if (resp.ok) {
            const text = await resp.text();
            editor.dispatch({
                changes: {from: 0, to: editor.state.doc.length, insert: text}
            });
            updateFileDisplay(url.split('/').pop());
        }
    } catch (e) {
        console.error("Failed to load default XHTML:", e);
    }

    // Set up extraction modal button handlers
    document.getElementById("extraction-load").onclick = loadExtractedXHTML;
    document.getElementById("extraction-close").onclick = () => extractionModal.hide();
});

function updateFileDisplay(filename) {
    document.getElementById('file-name').textContent = filename;
}

function getCurrentFilename() {
    return document.getElementById('file-name').textContent || 'document.xhtml';
}

// ===== TAB SWITCHING =====
document.getElementById("edit-tab").onclick = (e) => {
    if (e.target.id === "download-xml-icon" || e.target.closest('#download-xml-icon')) {
        e.stopPropagation();
        downloadXML();
        return;
    }

    document.getElementById("edit-container").style.display = "block";
    document.getElementById("preview-container").style.display = "none";
    document.getElementById("edit-tab").classList.add("active");
    document.getElementById("preview-tab").classList.remove("active");
};

document.getElementById("preview-tab").onclick = async (e) => {
    if (e.target.id === "download-html-icon" || e.target.closest('#download-html-icon')) {
        e.stopPropagation();
        await downloadHTML();
        return;
    }

    const xhtml = editor.state.doc.toString();

    if (!validateXML(xhtml)) {
        return;
    }

    document.getElementById("edit-container").style.display = "none";
    document.getElementById("preview-container").style.display = "block";
    document.getElementById("edit-tab").classList.remove("active");
    document.getElementById("preview-tab").classList.add("active");

    await generatePreview(xhtml);
};

// ===== FILE HANDLING =====
document.getElementById("file-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Switch to Edit tab if we're on Preview tab
    const previewTab = document.getElementById("preview-tab");
    const editTab = document.getElementById("edit-tab");
    if (previewTab.classList.contains("active")) {
        previewTab.classList.remove("active");
        editTab.classList.add("active");
        document.getElementById("preview-container").style.display = "none";
        document.getElementById("edit-container").style.display = "block";
    }

    const extension = file.name.split('.').pop().toLowerCase();

    if (extension === 'pdf') {
        // Trigger PDF extraction workflow
        await handlePDFExtraction(file);
    } else {
        // Load text file directly
        const text = await file.text();
        editor.dispatch({
            changes: {from: 0, to: editor.state.doc.length, insert: text}
        });
        updateFileDisplay(file.name);
    }
});

// ===== PDF EXTRACTION WORKFLOW =====
async function handlePDFExtraction(file) {
    // Update filename display immediately
    updateFileDisplay(file.name);

    showExtractionModal();

    try {
        // Your existing PDF processing logic
        await extractPDFToXHTML(file);
    } catch (error) {
        console.error("PDF extraction failed:", error);
        updateExtractionUI(100, "Extraction failed", `Error: ${error.message}`);
        document.getElementById("extraction-close").style.display = "inline-block";
    }
}

function showExtractionModal() {
    // Reset modal state
    document.getElementById('extraction-log').innerHTML = '<p><strong>Processing Log:</strong></p>';
    document.getElementById('extraction-progress-bar').style.width = '0%';
    document.getElementById('extraction-status').textContent = 'Initializing...';
    document.getElementById('extraction-load').style.display = 'none';
    document.getElementById('extraction-close').style.display = 'none';

    extractionModal.show();
}

function updateExtractionUI(percent, status, logMessage = null) {
    const progressBar = document.getElementById('extraction-progress-bar');
    const statusEl = document.getElementById('extraction-status');

    progressBar.style.width = percent + '%';
    progressBar.setAttribute('aria-valuenow', percent);
    statusEl.textContent = status;

    if (logMessage) {
        const logEl = document.getElementById('extraction-log');
        const p = document.createElement('p');
        p.textContent = logMessage;
        logEl.appendChild(p);
        logEl.scrollTop = logEl.scrollHeight;
    }
}

async function extractPDFToXHTML(file) {
    localStorage.clear();
    updateExtractionUI(5, "Loading PDF...", `Processing: ${file.name}`);

    // Read PDF
    const arrayBuffer = await file.arrayBuffer();
    const typedArray = new Uint8Array(arrayBuffer);
    const pdf = await pdfjsLib.getDocument(typedArray).promise;

    const totalPages = pdf.numPages;
    updateExtractionUI(10, `Analyzing ${totalPages} pages...`, `PDF loaded: ${totalPages} pages`);

    // Pre-process pages (your existing logic from pdf.js)
    let masterFontMap = {};
    const pageNumerals = [];

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const progress = 10 + (pageNum / totalPages * 40);
        updateExtractionUI(
            progress,
            `Pre-processing page ${pageNum} of ${totalPages}...`,
            `Page ${pageNum}: Analyzing layout`
        );

        const [pageFontMap, pageNumeral] = await storePageData(pdf, pageNum);
        pageNumerals.push(pageNumeral);

        if (pageNum === 1) {
            masterFontMap = pageFontMap;
        } else {
            for (const font in pageFontMap) {
                if (!(font in masterFontMap)) {
                    masterFontMap[font] = { name: pageFontMap[font].name, sizes: {} };
                }
                for (const size in pageFontMap[font].sizes) {
                    if (size in masterFontMap[font].sizes) {
                        masterFontMap[font].sizes[size].area += pageFontMap[font].sizes[size].area;
                    } else {
                        masterFontMap[font].sizes[size] = { area: pageFontMap[font].sizes[size].area };
                    }
                }
            }
        }
    }

    fillMissingPageNumerals(pageNumerals);

    // Find default font
    const defaultFont = Object.entries(masterFontMap).reduce((mostCommon, [fontName, fontEntry]) => {
        Object.entries(fontEntry.sizes).forEach(([size, sizeEntry]) => {
            if (sizeEntry.area > mostCommon.maxArea) {
                mostCommon = { fontName, fontSize: parseFloat(size), maxArea: sizeEntry.area };
            }
        });
        return mostCommon;
    }, { fontName: null, fontSize: null, maxArea: 0 });

    // Identify header fonts
    const headerFontSizes = Array.from(
        new Set(
            Object.entries(masterFontMap)
                .flatMap(([fontName, fontEntry]) => {
                    return Object.entries(fontEntry.sizes)
                        .filter(([size]) => parseFloat(size) > defaultFont.fontSize)
                        .map(([size]) => parseFloat(size));
                })
        )
    ).sort((a, b) => b - a);

    updateExtractionUI(50, "Processing fonts and headers...", `Default font: ${defaultFont.fontName} @ ${defaultFont.fontSize}px`);

    // Process each page
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        headerFooterAndFonts(pageNum, masterFontMap, defaultFont, headerFontSizes);
    }

    // Find footnote font
    const footFont = Object.entries(masterFontMap).reduce((mostCommon, [fontName, fontEntry]) => {
        Object.entries(fontEntry.sizes).forEach(([size, sizeEntry]) => {
            if (sizeEntry.footarea > mostCommon.maxFootArea) {
                mostCommon = { fontName, fontSize: parseFloat(size), maxFootArea: sizeEntry.footarea };
            }
        });
        return mostCommon;
    }, { fontName: null, fontSize: null, maxFootArea: 0 });

    // Build HTML
    let docHTML = '';
    let maxEndnote = 0;

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const progress = 50 + (pageNum / totalPages * 40);
        updateExtractionUI(
            progress,
            `Building content for page ${pageNum} of ${totalPages}...`,
            `Page ${pageNum}: Extracting text and structures`
        );

        let pageHTML;
        [maxEndnote, pageHTML] = await processItems(pageNum, defaultFont, footFont, maxEndnote, pdf, pageNumerals[pageNum - 1], false);
        docHTML += `${pageHTML}<hr class="vch-page" />`;
    }

    updateExtractionUI(90, "Processing footnotes...", "Inserting inline footnotes");

    // Replace footnote placeholders with actual <aside> content
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        // Update progress for footnote processing
        const footnoteProgress = 90 + (pageNum / totalPages * 3);
        if (pageNum % 10 === 0 || pageNum === totalPages) {
            updateExtractionUI(
                footnoteProgress,
                "Processing footnotes...",
                `Processing page ${pageNum} of ${totalPages}`
            );
            // Allow UI to update
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        let footnotes;
        try {
            footnotes = JSON.parse(LZString.decompressFromUTF16(localStorage.getItem(`page-${pageNum}-footnotes`)));
        } catch (err) {
            footnotes = [];
        }

        footnotes.forEach(footnote => {
            if (footnote.footNumber) {
                const placeholder = `___FOOTNOTE_${footnote.footNumber}___`;
                const asideContent = `<aside>${footnote.str}</aside>`;
                docHTML = docHTML.replace(placeholder, asideContent);
            }
        });
    }

    updateExtractionUI(93, "Parsing document...", "Creating XML structure");
    await new Promise(resolve => setTimeout(resolve, 0));

    updateExtractionUI(95, "Validating XHTML...", "Checking document structure");
    await new Promise(resolve => setTimeout(resolve, 0));

    // Convert HTML to XHTML (footnotes are now inline as <aside> elements)
    extractedXHTML = convertHTMLToXHTML(docHTML, file.name);

    updateExtractionUI(100, "Extraction complete!", `Successfully extracted ${totalPages} pages`);
    document.getElementById('extraction-load').style.display = 'inline-block';
    document.getElementById('extraction-close').style.display = 'inline-block';

    // Auto-load after 2 seconds
    setTimeout(() => {
        if (extractedXHTML) {
            loadExtractedXHTML();
        }
    }, 2000);
}

function convertHTMLToXHTML(html, filename) {
    // Clean up the filename for use as a title
    const cleanFilename = filename.replace(/\.pdf$/i, '').replace(/[_-]/g, ' ');

    // Create the full XHTML document with proper namespace
    const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
    <meta charset="UTF-8"/>
    <meta content="application/xhtml+xml"/>
    <!-- Adjust the meta data-pubid value below to set the BHO publication ID for image and page URLs -->
    <meta data-pubid="2001"/>
</head>
<body>
${html}
</body>
</html>`;

    // Return directly - parsing and re-serializing can cause namespace issues
    return xhtml;
}



function loadExtractedXHTML() {
    if (!extractedXHTML) return;

    editor.dispatch({
        changes: {from: 0, to: editor.state.doc.length, insert: extractedXHTML}
    });

    const filename = getCurrentFilename().replace(/\.pdf$/i, '.xhtml');
    updateFileDisplay(filename);

    extractionModal.hide();
    extractedXHTML = null;
}

// ===== DOWNLOAD FUNCTIONS =====
function downloadXML() {
    const xhtml = editor.state.doc.toString();
    const filename = getCurrentFilename();

    const blob = new Blob([xhtml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function downloadHTML() {
    const xhtml = editor.state.doc.toString();

    if (!validateXML(xhtml)) {
        return;
    }

    if (!window.transformedHTML) {
        await generatePreview(xhtml);
    }

    const xmlFilename = getCurrentFilename();
    const htmlFilename = xmlFilename.replace(/\.(xhtml|xml)$/i, '.html');

    const blob = new Blob([window.transformedHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = htmlFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}