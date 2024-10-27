// /js/pdf.js


// Function to process PDF files
function processPDF(file, fileName, zip) {  // Accept zip as a parameter
    return new Promise((resolve, reject) => {
        const fileReader = new FileReader();
        fileReader.onload = function () {
            let typedarray = new Uint8Array(this.result);
            pdfjsLib.getDocument(typedarray).promise.then(async (pdf) => {

                // Iterate over pages to find crop, map, and table bounds; create font dictionary; store augmented items in localStorage
                masterFontMap = {};
                for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                    const pageFontMap = await storePageData(pdf, pageNum);
                    Object.keys(pageFontMap).forEach(font => {
                        if (!(font in masterFontMap)) {
                            masterFontMap[font] = pageFontMap[font];
                        }
                    });
                }
                console.log('Master Font Map:', masterFontMap);

                // Iterate over pages to preprocess footnote areas
                for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                    continue;
                }

                let docHTML = ''; // Initialize the document HTML content
                let endnoteHTML = `<hr class="remove" /><h3 class="remove">ENDNOTES</h3>`; // Initialize the endnote HTML content
                let endnoteLookup = []; // Initialize the endnote lookup array
                let endnoteNumber = 1; // Initialize the endnote number

                // Iterate over pages and process content
                for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {

                    if (pageNum > 1) {
                        docHTML += '<hr class="remove" />'; // Add horizontal rule between pages
                        // break;
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


async function storePageData(pdf, pageNum) {
    appendLogMessage(`Processing page ${pageNum}...`);
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const viewport = await page.getViewport({scale: 1});
    const operatorList = await page.getOperatorList();

    localStorage.setItem(`page-${pageNum}-viewport`, JSON.stringify(viewport));
    appendLogMessage(`Page ${pageNum} size: ${viewport.width.toFixed(2)} x ${viewport.height.toFixed(2)}`);

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

    const mapBorders = findMap(operatorList, cropRange, viewport);
    localStorage.setItem(`page-${pageNum}-mapBorders`, JSON.stringify(mapBorders));
    appendLogMessage(`${mapBorders.length} map(s) found`);

    augmentItems(content.items);
    localStorage.setItem(`page-${pageNum}-items`, JSON.stringify(content.items));

    const fonts = page.commonObjs._objs;
    const fontMap = {};
    for (const fontKey in fonts) {
        const font = fonts[fontKey]?.data;
        if (font) {
            fontMap[font.loadedName] = font.name;
        }
    }

    return fontMap;
}