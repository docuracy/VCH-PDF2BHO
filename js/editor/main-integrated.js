import {editor, formatDocument, clearAutoSave} from "./editor.js";
import {generatePreview, convertToBHO} from "./preview.js";
import {validateXML} from "./validator.js";
import {convertToNestedSections} from "./convert-to-sections.js";
import {transformBHOHTML, isBHOHTML} from "./bho-html-transform.js";

// Expose formatDocument globally for the button
window.formatDocument = formatDocument;

// Initialize PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.7.570/pdf.worker.min.js';

// State for PDF extraction
let extractionModal = null;
let extractedXHTML = null;
let isDebugMode = true;

// Helper to show a temporary modal
function showTempModal(title, message, duration = 2500) {
    const modalEl = document.getElementById('notification-modal');
    if (!modalEl) {
        console.warn("Notification modal element not found in DOM");
        return;
    }

    // Force high z-index to ensure visibility over editor/other modals
    modalEl.style.zIndex = "1070";

    // Update text
    const titleEl = document.getElementById('notification-title');
    const msgEl = document.getElementById('notification-message');
    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;

    // Create or retrieve modal instance
    let modal = bootstrap.Modal.getInstance(modalEl);
    if (!modal) {
        modal = new bootstrap.Modal(modalEl, {
            backdrop: false, // Less intrusive
            keyboard: false,
            focus: false     // Prevents stealing focus
        });
    }

    modal.show();

    // Auto-hide after duration
    setTimeout(() => {
        modal.hide();
    }, duration);
}

// Helper to show a loading modal (for BHO HTML transformation)
function showLoadingModal(title, message) {
    const modalEl = document.getElementById('notification-modal');
    if (!modalEl) {
        console.warn("Notification modal element not found in DOM");
        return null;
    }

    // Force high z-index
    modalEl.style.zIndex = "1070";

    // Update text
    const titleEl = document.getElementById('notification-title');
    const msgEl = document.getElementById('notification-message');
    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;

    // Create or retrieve modal instance
    let modal = bootstrap.Modal.getInstance(modalEl);
    if (!modal) {
        modal = new bootstrap.Modal(modalEl, {
            backdrop: 'static', // Don't allow closing during transformation
            keyboard: false,
            focus: false
        });
    }

    modal.show();
    return modal;
}

// Initialize on load
window.addEventListener("DOMContentLoaded", async () => {
    // Initialize Bootstrap modal
    const extractModalEl = document.getElementById('pdf-extraction-modal');
    if (extractModalEl) {
        extractionModal = new bootstrap.Modal(extractModalEl);
    }

    // === INJECT UI ELEMENTS ===
    setupDebugUI();
    // ==========================

    // Try to load default XHTML file
    try {
        const url = "./xhtml-view/template.xhtml";
        const resp = await fetch(url);
        if (resp.ok) {
            const text = await resp.text();
            // Only insert template if editor is empty or we are about to overwrite it
            if (editor.state.doc.length === 0) {
                editor.dispatch({
                    changes: {from: 0, to: editor.state.doc.length, insert: text}
                });
                updateFileDisplay(url.split('/').pop());
            }
        }
    } catch (e) {
        console.error("Failed to load default XHTML:", e);
    }

    // Set up extraction modal button handlers
    const loadBtn = document.getElementById("extraction-load");
    if (loadBtn) loadBtn.onclick = loadExtractedXHTML;

    const closeBtn = document.getElementById("extraction-close");
    if (closeBtn) closeBtn.onclick = () => extractionModal && extractionModal.hide();

    // Template selector handler
    const templateSelector = document.getElementById('template-selector');
    if (templateSelector) {
        templateSelector.addEventListener('change', async (e) => {
            const filename = e.target.value;
            const url = `./xhtml-view/${filename}`;

            // Switch to Edit tab if we're on Preview tab
            const previewTab = document.getElementById("preview-tab");
            const editTab = document.getElementById("edit-tab");
            if (previewTab.classList.contains("active")) {
                previewTab.classList.remove("active");
                editTab.classList.add("active");
                document.getElementById("preview-container").style.display = "none";
                document.getElementById("edit-container").style.display = "block";
            }

            try {
                const resp = await fetch(url);
                if (resp.ok) {
                    const text = await resp.text();
                    editor.dispatch({
                        changes: {from: 0, to: editor.state.doc.length, insert: text}
                    });
                    updateFileDisplay(filename);
                }
            } catch (error) {
                console.error("Failed to load template:", error);
                alert("Failed to load " + filename);
            }
        });
    }

    // Session Restore Check (Delayed slightly to ensure Bootstrap is ready)
    setTimeout(() => {
        const savedContent = localStorage.getItem("vch_editor_content");
        if (savedContent && savedContent.length > 50) {
            console.log("Restoring auto-saved content...");
            editor.dispatch({
                changes: {from: 0, to: editor.state.doc.length, insert: savedContent}
            });
            updateFileDisplay("Restored from Backup");
            showTempModal("Session Restored", "We found unsaved work from your previous session.", 3000);
        }
    }, 500); // 500ms delay to let UI settle
});

function updateFileDisplay(filename) {
    const el = document.getElementById('file-name');
    if (el) el.textContent = filename;
}

function getCurrentFilename() {
    const el = document.getElementById('file-name');
    return el ? el.textContent : 'document.xhtml';
}

// ===== TAB SWITCHING =====
const editTab = document.getElementById("edit-tab");
if (editTab) {
    editTab.onclick = (e) => {
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
}

const previewTab = document.getElementById("preview-tab");
if (previewTab) {
    previewTab.onclick = async (e) => {
        if (e.target.id === "download-html-icon" || e.target.closest('#download-html-icon')) {
            e.stopPropagation();
            await downloadHTML();
            return;
        }

        if (e.target.id === "convert-to-bho-btn" || e.target.closest('#convert-to-bho-btn')) {
            e.stopPropagation();
            console.log("Convert to BHO button clicked");

            const bhoXml = await convertToBHO();

            if (bhoXml) {
                // Download BHO XML with filename based on current file
                const currentFilename = getCurrentFilename();
                const bhoFilename = currentFilename.replace(/\.(xhtml|xml|html)$/i, '.xml');

                const blob = new Blob([bhoXml], { type: 'application/xml' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = bhoFilename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);

                // Clean up the URL after a delay
                setTimeout(() => URL.revokeObjectURL(url), 100);

                console.log("BHO XML downloaded as:", bhoFilename);
            }
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
}

// ===== FILE HANDLING =====
// ===== FILE HANDLING =====
const fileInput = document.getElementById("file-input");
if (fileInput) {
    fileInput.addEventListener("change", async (e) => {
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
        } else if (extension === 'html' || extension === 'htm') {
            // Handle HTML files - check if BHO HTML format
            const htmlText = await file.text();

            // Check if this is BHO HTML
            if (isBHOHTML(htmlText)) {
                console.log("Detected BHO HTML - transforming to XHTML...");

                // Show loading modal
                const loadingModal = showLoadingModal(
                    "Transforming BHO HTML",
                    "Converting HTML to BHO XHTML format..."
                );

                try {
                    // Transform using SaxonJS
                    const xhtmlText = await transformBHOHTML(htmlText);

                    // Load transformed XHTML into editor
                    editor.dispatch({
                        changes: {from: 0, to: editor.state.doc.length, insert: xhtmlText}
                    });

                    // Force update local storage
                    localStorage.setItem("vch_editor_content", xhtmlText);
                    updateFileDisplay(file.name.replace(/\.html?$/i, '.xhtml'));

                    // Hide loading modal and show success
                    if (loadingModal) {
                        loadingModal.hide();
                    }
                    showTempModal("Success", "BHO HTML transformed to XHTML", 2000);

                } catch (error) {
                    console.error("BHO transformation failed:", error);

                    // Hide loading modal
                    if (loadingModal) {
                        loadingModal.hide();
                    }

                    // Show error and ask if user wants to load untransformed
                    const loadAnyway = confirm(
                        `BHO HTML transformation failed:\n\n${error.message}\n\n` +
                        `Would you like to load the HTML file without transformation?`
                    );

                    if (loadAnyway) {
                        editor.dispatch({
                            changes: {from: 0, to: editor.state.doc.length, insert: htmlText}
                        });
                        localStorage.setItem("vch_editor_content", htmlText);
                        updateFileDisplay(file.name);
                    }
                }
            } else {
                // Regular HTML - load directly
                console.log("Loading HTML file (not BHO format)");
                editor.dispatch({
                    changes: {from: 0, to: editor.state.doc.length, insert: htmlText}
                });
                localStorage.setItem("vch_editor_content", htmlText);
                updateFileDisplay(file.name);
            }
        } else {
            // Load other text files directly (XHTML, XML, etc.)
            const text = await file.text();
            editor.dispatch({
                changes: {from: 0, to: editor.state.doc.length, insert: text}
            });
            // Force update local storage
            localStorage.setItem("vch_editor_content", text);
            updateFileDisplay(file.name);
        }

        // Reset input value so same file can be selected again
        e.target.value = '';
    });
}

function markNonDefaultFonts(pageNum, defaultFont) {
    const zones = JSON.parse(
        LZString.decompressFromUTF16(localStorage.getItem(`page-${pageNum}-zones`))
    );

    const defaultFontKey = `${defaultFont.fontName}@${Math.round(defaultFont.height)}`;

    zones.forEach(zone => {
        if (!zone.items) return;

        zone.items.forEach(line => {
            const firstItem = line[0];
            if (!firstItem) return;

            const fontKey = `${firstItem.fontName}@${Math.round(firstItem.height)}`;

            // Skip if this is the default font
            if (fontKey === defaultFontKey) return;

            // Check if ALL items in the line have the same font AND height
            const roundedHeight = Math.round(firstItem.height);
            const allSameFont = line.every(item =>
                item.fontName === firstItem.fontName &&
                Math.round(item.height) === roundedHeight
            );

            if (allSameFont) {
                // Mark all items in this line with font signature
                line.forEach(item => {
                    item.fontSignature = fontKey;
                });
            }
        });
    });

    localStorage.setItem(`page-${pageNum}-zones`,
        LZString.compressToUTF16(JSON.stringify(zones)));
}

function applyFontRanks(pageNum, fontRankMap) {
    const zones = JSON.parse(
        LZString.decompressFromUTF16(localStorage.getItem(`page-${pageNum}-zones`))
    );

    zones.forEach(zone => {
        if (!zone.items) return;

        zone.items.forEach(line => {
            const firstItem = line[0];
            if (!firstItem) return;

            const roundedHeight = Math.round(firstItem.height);
            const fontKey = `${firstItem.fontName}@${roundedHeight}`;
            const rank = fontRankMap.get(fontKey);
            if (!rank) return; // First item is default font at default size

            // Check if ALL items in the line have the same font AND similar height
            const allSameFont = line.every(item =>
                item.fontName === firstItem.fontName &&
                Math.round(item.height) === roundedHeight
            );

            if (allSameFont) {
                // Mark all items in this line as heading with this rank
                line.forEach(item => {
                    item.headingRank = rank;
                });
            }
        });
    });

    localStorage.setItem(`page-${pageNum}-zones`,
        LZString.compressToUTF16(JSON.stringify(zones)));
}

// ===== PDF EXTRACTION WORKFLOW =====
async function handlePDFExtraction(file) {
    // Update filename display immediately
    updateFileDisplay(file.name);
    // CRITICAL: Clear auto-save so we don't restore old session over new PDF
    clearAutoSave();

    showExtractionModal();

    try {
        await extractPDFToXHTML(file);
    } catch (error) {
        console.error("PDF extraction failed:", error);
        updateExtractionUI(100, "Extraction failed", `Error: ${error.message}`);
        const closeBtn = document.getElementById("extraction-close");
        if (closeBtn) closeBtn.style.display = "inline-block";
    }
}

function showExtractionModal() {
    // Reset modal state
    const logEl = document.getElementById('extraction-log');
    if (logEl) logEl.innerHTML = '<p><strong>Processing Log:</strong></p>';

    const bar = document.getElementById('extraction-progress-bar');
    if (bar) bar.style.width = '0%';

    const status = document.getElementById('extraction-status');
    if (status) status.textContent = 'Initializing...';

    const loadBtn = document.getElementById('extraction-load');
    if (loadBtn) loadBtn.style.display = 'none';

    const closeBtn = document.getElementById('extraction-close');
    if (closeBtn) closeBtn.style.display = 'none';

    if (extractionModal) extractionModal.show();
}

function updateExtractionUI(percent, status, logMessage = null) {
    const progressBar = document.getElementById('extraction-progress-bar');
    const statusEl = document.getElementById('extraction-status');

    if (progressBar) {
        progressBar.style.width = percent + '%';
        progressBar.setAttribute('aria-valuenow', percent);
    }
    if (statusEl) statusEl.textContent = status;

    if (logMessage) {
        const logEl = document.getElementById('extraction-log');
        if (logEl) {
            const p = document.createElement('p');
            p.textContent = logMessage;
            logEl.appendChild(p);
            logEl.scrollTop = logEl.scrollHeight;
        }
    }
}

// Helper to clean only PDF extraction artifacts
function clearPDFStorage() {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
        // Only remove keys generated by the PDF processor
        if (key.startsWith('page-')) {
            localStorage.removeItem(key);
        }
    });
    console.log("PDF temporary storage cleaned.");
}

function setupDebugUI() {
    // 1. Add Checkbox to Extraction Modal
    const modalFooter = document.querySelector('#pdf-extraction-modal .modal-footer');
    if (modalFooter && !document.getElementById('debug-mode-chk')) {
        const div = document.createElement('div');
        div.className = 'form-check form-switch me-auto';
        div.innerHTML = `
            <input class="form-check-input" type="checkbox" id="debug-mode-chk" ${isDebugMode ? 'checked' : ''}>
            <label class="form-check-label" for="debug-mode-chk">Visual Debug Mode</label>
        `;
        modalFooter.insertBefore(div, modalFooter.firstChild);

        document.getElementById('debug-mode-chk').addEventListener('change', (e) => {
            isDebugMode = e.target.checked;
        });
    }

    // 2. Create Visualization Overlay (Hidden by default)
    if (!document.getElementById('segmentation-overlay')) {
        const overlay = document.createElement('div');
        overlay.id = 'segmentation-overlay';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.85); z-index: 1060; display: none;
            flex-direction: column; align-items: center; justify-content: center;
        `;
        overlay.innerHTML = `
            <div style="background: white; padding: 10px; border-radius: 4px; margin-bottom: 10px; text-align: center;">
                <h5 style="margin:0;">Segmentation Debugger</h5>
                <p id="debug-page-info" style="margin:0; color:#666;">Page 1</p>
            </div>
            <div id="debug-canvas-container" style="overflow: auto; max-width: 90%; max-height: 80vh; border: 2px solid #fff;"></div>
            <div style="margin-top: 15px;">
                <button id="debug-continue-btn" class="btn btn-primary btn-lg">Continue >></button>
                <button id="debug-stop-btn" class="btn btn-secondary">Stop Debugging</button>
            </div>
        `;
        document.body.appendChild(overlay);
    }
}

async function extractPDFToXHTML(file) {
    clearPDFStorage();
    updateExtractionUI(5, "Loading PDF...", `Processing: ${file.name}`);

    // Read PDF
    const arrayBuffer = await file.arrayBuffer();
    const typedArray = new Uint8Array(arrayBuffer);
    const pdf = await pdfjsLib.getDocument(typedArray).promise;

    let totalPages = pdf.numPages;
    const earlyStop = 0; // Set to >0 to limit pages
    totalPages = earlyStop > 0 ? Math.min(earlyStop, totalPages) : totalPages;

    updateExtractionUI(10, `Analyzing ${totalPages} pages...`, `PDF loaded: ${totalPages} pages`);

    // Pre-process pages
    let masterFontMap = {};
    const pageNumerals = [];

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const progress = 10 + (pageNum / totalPages * 40);
        updateExtractionUI(progress, `Pre-processing page ${pageNum}...`, `Page ${pageNum}: Analyzing layout`);

        const [pageFontMap, pageNumeral] = await storePageData(pdf, pageNum);
        pageNumerals.push(pageNumeral);

        // === VISUAL DEBUG PAUSE ===
        if (isDebugMode) {
            const zones = JSON.parse(
                LZString.decompressFromUTF16(localStorage.getItem(`page-${pageNum}-zones`))
            ) || [];
            await showSegmentationVisualizer(pdf, pageNum, zones);
        }
        // ==========================

        if (pageNum === 1) {
            masterFontMap = pageFontMap;
        } else {
            // Merge fonts (keep existing logic)
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

    console.debug("Master Font Map:", masterFontMap);

    fillMissingPageNumerals(pageNumerals);

    // Font Analysis (Default, Header, Footnote)
    const defaultFont = Object.entries(masterFontMap).reduce((mostCommon, [fontName, fontEntry]) => {
        Object.entries(fontEntry.sizes).forEach(([size, sizeEntry]) => {
            if (sizeEntry.area > mostCommon.maxArea) {
                mostCommon = { fontName, fontSize: parseFloat(size), maxArea: sizeEntry.area };
            }
        });
        return mostCommon;
    }, { fontName: null, fontSize: null, maxArea: 0 });
    console.info(`Default Font Identified: ${defaultFont.fontName} at ${defaultFont.fontSize}pt`);

    const headerFontSizes = Array.from(new Set(
        Object.entries(masterFontMap).flatMap(([fontName, fontEntry]) => {
            return Object.entries(fontEntry.sizes)
                .filter(([size]) => parseFloat(size) > defaultFont.fontSize)
                .map(([size]) => parseFloat(size));
        })
    )).sort((a, b) => b - a);

    const footFont = Object.entries(masterFontMap).reduce((mostCommon, [fontName, fontEntry]) => {
        Object.entries(fontEntry.sizes).forEach(([size, sizeEntry]) => {
            if (sizeEntry.footarea > mostCommon.maxFootArea) {
                mostCommon = { fontName, fontSize: parseFloat(size), maxFootArea: sizeEntry.footarea };
            }
        });
        return mostCommon;
    }, { fontName: null, fontSize: null, maxFootArea: 0 });

    // Header tagging pass
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        headerFooterAndFonts(pageNum, masterFontMap, defaultFont, headerFontSizes);
    }

    // Build Content
    let maxEndnote = 0;
    let lastPageNumeral = null;
    const pageResults = [];

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const progress = 50 + (pageNum / totalPages * 40);
        updateExtractionUI(progress, `Building page ${pageNum}...`, `Page ${pageNum}: Extracting text`);

        const currentPageNumeral = pageNumerals[pageNum - 1];
        const currentNum = parseInt(currentPageNumeral, 10);
        const lastNum = parseInt(lastPageNumeral, 10);

        // Only mark as new page numeral if:
        // 1. First page, OR
        // 2. Current numeral is not sequential (lastNum + 1)
        const isNewPageNumeral = (pageNum === 1) || isNaN(lastNum) || isNaN(currentNum) || (currentNum !== lastNum + 1);

        let pageHTML, firstContinuationTableMetadata, lastContentTableMetadata;
        [maxEndnote, pageHTML, firstContinuationTableMetadata, lastContentTableMetadata] = await processItems(pageNum, defaultFont, footFont, maxEndnote, pdf, currentPageNumeral, false, isNewPageNumeral);

        pageResults.push({
            html: pageHTML,
            firstContinuationTableMetadata,
            lastContentTableMetadata
        });

        lastPageNumeral = currentPageNumeral;
    }

    // Merge tables that span across pages
    const mergedPages = mergeTablesAcrossPages(pageResults);
    const docHTML = mergedPages.join('');

    updateExtractionUI(95, "Validating XHTML...", "Checking document structure");
    await new Promise(resolve => setTimeout(resolve, 0));

    extractedXHTML = convertHTMLToXHTML(docHTML, file.name);

    updateExtractionUI(90, "Extracting images...", "Scanning for figures");
    const { zipBlob, figureExtensions } = await extractImagesFromPDF(pdf, (percent, status, log) => {
        const mappedPercent = 90 + Math.round(percent * 0.08); // 90-98%
        updateExtractionUI(mappedPercent, status, log);
    });

    updateExtractionUI(99, "Finalizing...", "Preparing download");

    // Post-process XHTML to use correct image extensions (jpg/png based on content)
    if (figureExtensions && Object.keys(figureExtensions).length > 0) {
        Object.entries(figureExtensions).forEach(([figureId, ext]) => {
            // figureId format: 'type-number' (e.g., 'figure-5', 'chart-12')
            // Only replace if extension is not .png (since .png is the default)
            if (ext !== 'png') {
                // Escape hyphens in the figureId for regex
                const escapedId = figureId.replace(/-/g, '\\-');
                const pattern = new RegExp(`${escapedId}\\.png`, 'g');
                extractedXHTML = extractedXHTML.replace(pattern, `${figureId}.${ext}`);
            }
        });
    }

    updateExtractionUI(100, "Extraction complete!", `Successfully extracted ${totalPages} pages`);
    const loadBtn = document.getElementById('extraction-load');
    const closeBtn = document.getElementById('extraction-close');
    if (loadBtn) loadBtn.style.display = 'inline-block';
    if (closeBtn) closeBtn.style.display = 'inline-block';

    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "extracted-images.zip";
    document.body.appendChild(a); // required in Firefox
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    clearPDFStorage();
    setTimeout(() => {
        if (extractedXHTML) loadExtractedXHTML();
    }, 2000);
}

function convertHTMLToXHTML(html, filename) {
    // Convert flat HTML to nested section structure
    const xhtml = convertToNestedSections(html, "xxxxxx");

    return xhtml;
}

function loadExtractedXHTML() {
    if (!extractedXHTML) return;

    editor.dispatch({
        changes: {from: 0, to: editor.state.doc.length, insert: extractedXHTML}
    });

    console.log("Auto-formatting extracted XHTML...");
    formatDocument();

    const filename = getCurrentFilename().replace(/\.pdf$/i, '.xhtml');
    updateFileDisplay(filename);

    extractionModal.hide();
    extractedXHTML = null;
}

// ===== DOWNLOAD FUNCTIONS =====
function downloadXML() {
    const xhtml = editor.state.doc.toString();
    const filename = getCurrentFilename();

    const blob = new Blob([xhtml], {type: 'application/xml'});
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

    const blob = new Blob([window.transformedHTML], {type: 'text/html'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = htmlFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function showSegmentationVisualizer(pdf, pageNum, zones) {
    const overlay = document.getElementById('segmentation-overlay');
    const container = document.getElementById('debug-canvas-container');
    const info = document.getElementById('debug-page-info');

    // 1. Render Page
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({scale: 1.0}); // View at 100%

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');

    await page.render({canvasContext: ctx, viewport}).promise;

    // 2. Draw Zones
    if (zones) {
        zones.forEach(zone => {
            // Pick Color based on Type
            ctx.lineWidth = 2;
            let label = zone.type;

            switch (zone.type) {
                case 'HEADER':
                    ctx.strokeStyle = 'red';
                    ctx.fillStyle = 'rgba(255, 0, 0, 0.2)';
                    break;
                case 'HEADING':
                    ctx.strokeStyle = 'gold';
                    ctx.fillStyle = 'rgba(255, 215, 0, 0.3)';
                    break;
                case 'FOOTER':
                    ctx.strokeStyle = 'blue';
                    ctx.fillStyle = 'rgba(0, 0, 255, 0.2)';
                    break;
                case 'IMAGE':
                    ctx.strokeStyle = 'orange';
                    ctx.fillStyle = 'rgba(255, 165, 0, 0.3)';
                    break;
                case 'FIGURE':
                    ctx.strokeStyle = 'purple';
                    ctx.fillStyle = 'rgba(128, 0, 128, 0.2)';
                    break;
                case 'TABLE':
                    ctx.strokeStyle = 'teal';
                    ctx.fillStyle = 'rgba(0, 255, 255, 0.2)';
                    break;
                case 'UNKNOWN':
                    ctx.strokeStyle = '#666';
                    ctx.fillStyle = 'rgba(100, 100, 100, 0.1)';
                    break;
                default: // BODY
                    ctx.strokeStyle = 'green';
                    ctx.fillStyle = 'rgba(0, 255, 0, 0.1)';
                    break;
            }

            // Draw Box
            ctx.fillRect(zone.x, zone.y, zone.width, zone.height);
            ctx.strokeRect(zone.x, zone.y, zone.width, zone.height);

            // Draw Label
            if (zone.order) {
                // Draw circle badge
                ctx.beginPath();
                ctx.arc(zone.x + 15, zone.y + 15, 12, 0, 2 * Math.PI);
                ctx.fillStyle = "white";
                ctx.fill();
                ctx.lineWidth = 1;
                ctx.strokeStyle = "black";
                ctx.stroke();

                // Draw Number
                ctx.fillStyle = "black";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.font = "bold 12px Arial";
                ctx.fillText(zone.order, zone.x + 15, zone.y + 15);
            }
        });
    }

    // 3. Show Overlay
    container.innerHTML = '';
    container.appendChild(canvas);
    info.textContent = `Page ${pageNum} Analysis - (${zones ? zones.length : 0} zones detected)`;
    overlay.style.display = 'flex';

    // 4. Wait for user to click Continue
    return new Promise(resolve => {
        const contBtn = document.getElementById('debug-continue-btn');
        const stopBtn = document.getElementById('debug-stop-btn');

        // Clean up old listeners (simple cloning trick)
        const newCont = contBtn.cloneNode(true);
        const newStop = stopBtn.cloneNode(true);
        contBtn.parentNode.replaceChild(newCont, contBtn);
        stopBtn.parentNode.replaceChild(newStop, stopBtn);

        newCont.onclick = () => {
            overlay.style.display = 'none';
            resolve();
        };

        newStop.onclick = () => {
            overlay.style.display = 'none';
            isDebugMode = false; // Turn off debug for remaining pages
            document.getElementById('debug-mode-chk').checked = false;
            resolve();
        };
    });
}