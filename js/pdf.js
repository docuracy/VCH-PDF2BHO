// /js/pdf.js


// Function to process PDF files
function processPDF(file, fileName, zip) {  // Accept zip as a parameter
    return new Promise((resolve, reject) => {
        const fileReader = new FileReader();
        fileReader.onload = function () {
            let typedarray = new Uint8Array(this.result);
            pdfjsLib.getDocument(typedarray).promise.then(async (pdf) => {

                // Start by clearing localStorage of any previous data
                localStorage.clear();

                // Iterate over pages to find crop, map, and table bounds; create font dictionary; store augmented items in localStorage
                let masterFontMap = {};
                for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                    const pageFontMap = await storePageData(pdf, pageNum);
                    if (pageNum === 1) {
                        masterFontMap = pageFontMap;
                    }
                    else {
                        // Merge page font map into master font map, adding areas for duplicate fonts
                        for (const font in pageFontMap) {
                            if (font in masterFontMap) {
                                masterFontMap[font].area += pageFontMap[font].area;
                            }
                            else {
                                masterFontMap[font] = pageFontMap[font];
                            }
                        }
                    }
                }

                // Find the most common font
                const defaultFont = Object.keys(masterFontMap).reduce((a, b) => masterFontMap[a].area > masterFontMap[b].area ? a : b);

                // Iterate over pages to preprocess footnote areas and remove header
                for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                    analyseTopAndBottom(pageNum, masterFontMap, defaultFont);
                }
                // Find the most common footArea font
                const footFont = Object.keys(masterFontMap).reduce((a, b) => masterFontMap[a].footarea > masterFontMap[b].footarea ? a : b);

                console.log('Master Font Map:', masterFontMap);
                console.log('Default Font:', defaultFont);
                console.log('Footnote Font:', footFont);

                let docHTML = ''; // Initialize the document HTML content
                let endnoteHTML = `<hr class="remove" /><h3 class="remove">ENDNOTES</h3>`; // Initialize the endnote HTML content
                let endnoteLookup = []; // Initialize the endnote lookup array
                let endnoteNumber = 1; // Initialize the endnote number

                // Iterate over pages and process content
                for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {

                    if (pageNum > 1) {
                        docHTML += '<hr class="remove" />'; // Add horizontal rule between pages
                        break;
                    }

                    // Call helper function to get content and font map
                    const {
                        content,
                        fontMap,
                        textLayout,
                        viewport
                    } = await getPageContentAndFonts(pdf, pageNum);
                    endnoteLookup.push([]);
                }

                docHTML += endnoteHTML;

                showHtmlPreview(docHTML); // Display HTML in modal overlay for checking
                appendLogMessage(`Generated HTML for file: ${fileName}, size: ${docHTML.length} characters`); // Debugging log

                docHTML = `<document><head>${metadata}</head><body>${docHTML}</body></document>`;

                // Fetch the XSLT file and transform the HTML document to BHO XML
                const xsltResponse = await fetch('./xml/html-to-bho-xml.xslt');
                const xsltText = await xsltResponse.text();
                const docXML = transformXml(docHTML, xsltText); // Transform the page XML
                appendLogMessage(`Transformed XML for file: ${fileName}, size: ${docXML.length} characters`); // Debug

                // Add the transformed XML content to the ZIP file
                zip.file(fileName.replace(/\.pdf$/i, '.xml'), docXML); // Use the passed zip object
                resolve();
            }).catch(err => {
                console.error('Error parsing PDF:', err);
                showAlert('Failed to parse PDF: ' + fileName, 'danger');
                reject(err);
            }).finally(() => {
                // Clean up references to potentially large objects to aid garbage collection
                typedarray = null;
                pdf = null;
            });
        };

        fileReader.readAsArrayBuffer(file);
    });
}

function augmentItems(items, viewport) {
    // Add item coordinates and dimensions
    // Convert cartesian y-values to top-down reading order (eases identification of footnote numerals)
    items.forEach(item => {
        item.left = item.transform[4];
        item.bottom = viewport.height - item.transform[5];
        item.right = item.left + item.width;
        item.top = item.bottom - item.height;
        item.area = item.width * item.height;
        item.str = item.str.trim();
        delete item.transform; // Remove transform array
    });
    return items;
}


async function storePageData(pdf, pageNum) {
    appendLogMessage(`Processing page ${pageNum}...`);
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const viewport = await page.getViewport({scale: 1});
    const operatorList = await page.getOperatorList();

    localStorage.setItem(`page-${pageNum}-viewport`, JSON.stringify(viewport));
    appendLogMessage(`====================`);
    appendLogMessage(`Page size: ${viewport.width.toFixed(2)} x ${viewport.height.toFixed(2)}`);

    const cropRange = identifyCropMarks(operatorList);
    if (!!cropRange.y) {
        // Convert ranges to top-down reading order
        cropRange.y = [viewport.height.toFixed(2) - cropRange.y[0].toFixed(2), viewport.height.toFixed(2) - cropRange.y[1].toFixed(2)];
    }
    else {
        console.warn('Crop Range not found: using defaults.');
        // Use default crop range based on printed page size 595.276 x 864.567
        const gutterX = (viewport.width - 595.276) / 2;
        const gutterY = (viewport.height - 864.567) / 2;
        cropRange.x = [gutterX, viewport.width - gutterX];
        cropRange.y = [gutterY, viewport.height - gutterY];
    }
    localStorage.setItem(`page-${pageNum}-cropRange`, JSON.stringify(cropRange));
    appendLogMessage(`Crop Range: x: ${cropRange.x[0].toFixed(2)} to ${cropRange.x[1].toFixed(2)}; y: ${cropRange.y[0].toFixed(2)} to ${cropRange.y[1].toFixed(2)}`);
    appendLogMessage(`Cropped size: ${cropRange.x[1].toFixed(2) - cropRange.x[0].toFixed(2)} x ${cropRange.y[1].toFixed(2) - cropRange.y[0].toFixed(2)}`);

    const drawingBorders = findMap(operatorList, cropRange, viewport);
    localStorage.setItem(`page-${pageNum}-drawingBorders`, JSON.stringify(drawingBorders));
    appendLogMessage(`${drawingBorders.length} drawing(s) found`);

    augmentItems(content.items, viewport);
    // Discard content items falling outside crop range or within drawing outlines
    content.items = content.items.filter(item =>
        item.left >= cropRange.x[0] && item.right <= cropRange.x[1] &&
        item.bottom >= cropRange.y[0] && item.top <= cropRange.y[1] &&
        !drawingBorders.some(border =>
            item.left >= border.x0 && item.right <= border.x1 &&
            item.bottom >= border.y0 && item.top <= border.y1
        )
    );
    localStorage.setItem(`page-${pageNum}-items`, JSON.stringify(content.items));

    const fonts = page.commonObjs._objs;
    const fontMap = {};
    for (const fontKey in fonts) {
        const font = fonts[fontKey]?.data;
        if (font) {
            fontMap[font.loadedName] = {'name': font.name, 'area': 0, 'footarea': 0};
        }
    }

    // Calculate font areas
    content.items.forEach(item => {
        if (item.fontName in fontMap) {
            fontMap[item.fontName].area += item.area;
        }
    });

    // TODO: Save images of drawings

    return fontMap;
}

function analyseTopAndBottom(pageNum, masterFontMap, defaultFont) {
    let content = JSON.parse(localStorage.getItem(`page-${pageNum}-items`));

    // Find bottom of lowest instance of default font
    const defaultFontBottom = Math.max(...content.filter(item => item.fontName === defaultFont).map(item => item.bottom));

    // Augment foot area for items below the default font's lowest position
    content
        .filter(item => item.top > defaultFontBottom)
        .forEach(item => {
            if (masterFontMap[item.fontName]) {
                masterFontMap[item.fontName].footarea += item.area;
            }
        });

    // Identify the top line and extract the page number (items do not typically share the exact same bottom position)
    const topItemBottom = Math.min(...content.map(item => item.bottom));
    const topLineItems = content.filter(item => item.top <= topItemBottom);
    const pageNumberItem = topLineItems.find(item => /^\d+$/.test(item.str));
    console.log(`Page ${pageNum} - Page Number Item: ${pageNumberItem?.str || 'Not Found'}`, topLineItems);

    localStorage.setItem(`page-${pageNum}-pageNumber`, pageNumberItem?.str || '');

    if (pageNumberItem) {
        // Remove header items
        content = content.filter(item => item.top > topItemBottom);
        localStorage.setItem(`page-${pageNum}-items`, JSON.stringify(content));
    }
}