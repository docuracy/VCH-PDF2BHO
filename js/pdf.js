// /js/pdf.js


// Function to process PDF files
function processPDF(file, fileName, zip) {  // Accept zip as a parameter

    const isIndex = fileName.includes('_Index');

    return new Promise((resolve, reject) => {
        const fileReader = new FileReader();
        fileReader.onload = function () {
            let typedarray = new Uint8Array(this.result);
            pdfjsLib.getDocument(typedarray).promise.then(async (pdf) => {

                // Start by clearing localStorage of any previous data
                localStorage.clear();

                // Start at page `startPage` (set to 1 to start at the beginning)
                // const startPage = 1;
                const startPage = 1; // DEBUG: Start at page 3 for testing

                // Discard all except the first `n` pages (set to `Infinity` to process all pages)
                let maxPages = Infinity;
                maxPages = 2; // DEBUG: Limit to first 2 pages for testing

                const maxPage = Math.min(pdf.numPages, startPage + maxPages - 1);

                // Iterate over pages to find crop, map, and table bounds; create font dictionary; store augmented items in localStorage
                let masterFontMap = {};
                const pageNumerals = [];
                for (let pageNum = startPage; pageNum <= maxPage; pageNum++) {
                    const [pageFontMap, pageNumeral] = await storePageData(pdf, pageNum);
                    pageNumerals.push(pageNumeral);
                    if (pageNum === 1) {
                        masterFontMap = pageFontMap;
                    }
                    else {
                        // Merge page font map with master font map
                        for (const font in pageFontMap) {
                            if (!(font in masterFontMap)) {
                                masterFontMap[font] = { name: pageFontMap[font].name, sizes: {} };
                            }

                            for (const size in pageFontMap[font].sizes) {
                                if (size in masterFontMap[font].sizes) {
                                    masterFontMap[font].sizes[size].area += pageFontMap[font].sizes[size].area;
                                } else {
                                    masterFontMap[font].sizes[size] = {
                                        area: pageFontMap[font].sizes[size].area
                                    };
                                }
                            }
                        }
                    }
                }
                fillMissingPageNumerals(pageNumerals);
                console.debug('Page Numerals:', pageNumerals);

                // Find the most common font
                const defaultFont = Object.entries(masterFontMap).reduce((mostCommon, [fontName, fontEntry]) => {
                    Object.entries(fontEntry.sizes).forEach(([size, sizeEntry]) => {
                        if (sizeEntry.area > mostCommon.maxArea) {
                            mostCommon = { fontName, fontSize: parseFloat(size), maxArea: sizeEntry.area };
                        }
                    });
                    return mostCommon;
                }, { fontName: null, fontSize: null, maxArea: 0 });

                // Identify header fonts (larger than default font or name ending in "SC") and rank by size
                const headerFontSizes = Array.from(
                    new Set(
                        Object.entries(masterFontMap)
                            .flatMap(([fontName, fontEntry]) => {
                                return Object.entries(fontEntry.sizes)
                                    .filter(([size]) => {
                                        const fontSize = parseFloat(size);
                                        const isLargerThanDefault = fontSize > defaultFont.fontSize;
                                        const isSameAsDefault = fontSize === defaultFont.fontSize;
                                        const isSmallCaps = masterFontMap[fontName].name.endsWith("SC");
                                        return isLargerThanDefault // || (isSmallCaps && isSameAsDefault); // DISABLED: Would need means to differentiate between small caps and regular text
                                    })
                                    .map(([size]) => parseFloat(size)); // Extract the size as a number
                            })
                    )
                ).sort((a, b) => b - a);
                console.info('headerFontSizes:', headerFontSizes);

                // Iterate over pages to preprocess footnote areas and remove header; tag headers and italic, bold, and capital fonts
                for (let pageNum = startPage; pageNum <= maxPage; pageNum++) {
                    headerFooterAndFonts(pageNum, masterFontMap, defaultFont, headerFontSizes);
                }
                // Find the most common footArea font
                const footFont = Object.entries(masterFontMap).reduce((mostCommon, [fontName, fontEntry]) => {
                    Object.entries(fontEntry.sizes).forEach(([size, sizeEntry]) => {
                        if (sizeEntry.footarea > mostCommon.maxFootArea) {
                            mostCommon = { fontName, fontSize: parseFloat(size), maxFootArea: sizeEntry.footarea };
                        }
                    });
                    return mostCommon;
                }, { fontName: null, fontSize: null, maxFootArea: 0 });

                console.info('Master Font Map:', masterFontMap);
                console.debug(`Default Font: ${defaultFont.fontName} @ ${defaultFont.fontSize}`);
                console.debug(`Footnote Font: ${footFont.fontName} @ ${footFont.fontSize}`);

                let docHTML = ''; // Initialize the document HTML content

                let maxEndnote = 0;
                // Iterate over pages to process items
                for (let pageNum = startPage; pageNum <= maxPage; pageNum++) {
                    let pageHTML = '';
                    [maxEndnote, pageHTML] = await processItems(pageNum, defaultFont, footFont, maxEndnote, pdf, pageNumerals[pageNum - 1], isIndex);
                    docHTML += `${pageHTML}<hr class="remove" />`; // Add horizontal rule between pages
                }

                // Loop through pages to add footnotes to endnotes
                docHTML += `<hr class="remove" /><h3 class="remove">ENDNOTES</h3>`;
                docHTML += Array.from({ length: Math.min(pdf.numPages, maxPages) }, (_, i) => {
                    let footnotes;
                    try {
                        footnotes = JSON.parse(LZString.decompressFromUTF16(localStorage.getItem(`page-${i + startPage}-footnotes`)));
                    } catch (err) {
                        footnotes = [];
                    }
                    return footnotes.map(item => `<div class="endnote">${item.str}</div>`).join('');
                }).join('');

                appendLogMessage(`Generated HTML for file: ${fileName}, size: ${docHTML.length} characters`); // Debugging log

                // Save the HTML to session storage
                sessionStorage.setItem('htmlPreview', docHTML);
                console.log('HTML saved to session storage.');

                docHTML = `<document>${docHTML}</document>`;

                // Fetch the XSLT file and transform the HTML document to BHO XML
                let xsltResponse = await fetch('./xml/html-to-bho-xml.xslt');
                let xsltText = await xsltResponse.text();
                let docXML = transformXml(docHTML, xsltText); // Transform the page XML
                appendLogMessage(`Transformed XML for file: ${fileName}, size: ${docXML.length} characters`); // Debug

                // Save the XML to session storage
                sessionStorage.setItem('XMLPreview', docXML);
                console.log('XML saved to session storage.', docXML);

                // Clear docHTML to free up memory
                docHTML = null;

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
    appendLogMessage(`====================`);
    appendLogMessage(`Pre-processing page ${pageNum}...`);
    console.info(`Pre-processing page ${pageNum}...`);
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const viewport = await page.getViewport({scale: 1});
    const operatorList = await page.getOperatorList();

    console.debug("Content", content);

    // Find item.str values starting with "Chart \d+." for use in density scan in segmentor
    const chartItems = content.items
        .map(item => item.str.match(/^Chart (\d+)\./) ? {
            text: item.str,
            chartNumber: parseInt(RegExp.$1, 10),
            x: item.transform[4] + item.width / 2,
            y: viewport.height - item.transform[5] - item.height / 2,
            top: viewport.height - item.transform[5]
        } : null)
        .filter(item => item !== null);

    localStorage.setItem(`page-${pageNum}-viewport`, JSON.stringify(viewport));
    appendLogMessage(`Page size: ${viewport.width.toFixed(2)} x ${viewport.height.toFixed(2)}`);

    const segments = await segmentPage(page, viewport, operatorList, chartItems);
    localStorage.setItem(`page-${pageNum}-segments`, JSON.stringify(segments));
    console.debug(`Segments for page ${pageNum}:`, segments);

    // Ensure cropRange exists and has valid X/Y dimensions
    const cropRange = segments.cropRange || {};

    // Fallback if X is missing
    if (!cropRange.x) {
        console.warn(`Page ${pageNum}: Missing Crop X, applying default.`);
        const gutterX = Math.max(0, (viewport.width - 595.276) / 2);
        cropRange.x = [gutterX, viewport.width - gutterX];
    }

    // Fallback if Y is missing
    if (!cropRange.y) {
        console.warn(`Page ${pageNum}: Missing Crop Y, applying default.`);
        const gutterY = Math.max(0, (viewport.height - 864.567) / 2);
        cropRange.y = [gutterY, viewport.height - gutterY];
    }

    localStorage.setItem(`page-${pageNum}-cropRange`, JSON.stringify(cropRange));
    appendLogMessage(`Crop Range: x: ${cropRange.x[0].toFixed(2)} to ${cropRange.x[1].toFixed(2)}; y: ${cropRange.y[0].toFixed(2)} to ${cropRange.y[1].toFixed(2)}`);
    appendLogMessage(`Cropped size: ${cropRange.x[1].toFixed(2) - cropRange.x[0].toFixed(2)} x ${cropRange.y[1].toFixed(2) - cropRange.y[0].toFixed(2)}`);

    // Add item coordinates and dimensions
    augmentItems(content.items, viewport);

    // Combine segments.embeddedImages and segments.rectangles
    const drawingBorders = segments.embeddedImages.concat(segments.rectangles);

    if (segments.lineItems.length > 0) {
        console.debug(`Detected Line Items:`, segments.lineItems);
        content.items.push(...segments.lineItems);
    }

    // Discard content items falling outside crop range or within drawing outlines
    content.items = content.items.filter(item =>
        item.left >= cropRange.x[0] && item.right <= cropRange.x[1] &&
        item.bottom >= cropRange.y[0] && item.top <= cropRange.y[1] &&
        !drawingBorders.some(border =>
            item.left >= border.left && item.right <= border.right &&
            item.bottom <= border.bottom && item.top >= border.top
        )
    );

    // Log remaining lineItems
    if (segments.lineItems.length > 0) {
        console.debug('Cropped line Items:', content.items.filter(item => item.tableLine === true));
    }

    if (drawingBorders.length > 0) {
        localStorage.setItem(`page-${pageNum}-drawingBorders`, JSON.stringify(drawingBorders));
        appendLogMessage(`${drawingBorders.length} drawing/image(s) found`);
        // Add new items to represent drawings
        content.items.push(...drawingBorders.map(drawingBorder => ({
            ...drawingBorder,
            // Placing coordinates at the centre of the drawing mitigates accidental out-of-bounds erasure, and helps caption-placing
            'top': drawingBorder.bottom - drawingBorder.height / 2,
            'left': drawingBorder.left + drawingBorder.width / 2,
            'bottom': drawingBorder.bottom - drawingBorder.height / 2,
            'right': drawingBorder.left + drawingBorder.width / 2,
            'str': '',
            'fontName': 'drawing',
            'paragraph': true
        })));
    }

    localStorage.setItem(`page-${pageNum}-items`, LZString.compressToUTF16(JSON.stringify(content.items)));
    localStorage.setItem(`page-${pageNum}-nullTexts`, JSON.stringify(findNullTexts(operatorList)));

    // Create a font map for the page (accumulated across the entire document)
    const fonts = page.commonObjs._objs;
    const fontMap = {};
    for (const fontKey in fonts) {
        const font = fonts[fontKey]?.data;
        if (font) {
            fontMap[font.loadedName] = { 'name': font.name, 'sizes': {} };
        }
    }

    // Calculate font areas (accumulated across the entire document)
    content.items.forEach(item => {
        if (item.fontName in fontMap) {
            const size = item.height; // Use item.height as the font size identifier

            // Initialize size entry if it doesn't exist
            if (!fontMap[item.fontName].sizes[size]) {
                fontMap[item.fontName].sizes[size] = { 'area': 0, 'footarea': 0 };
            }

            // Accumulate area for this font size
            fontMap[item.fontName].sizes[size].area += item.area;
        }
    });

    // Find page number in header
    const segmentation = segments.segmentation;
    let pageNumeral = null;
    if (segmentation[0].height < 12 && segmentation[0].columns.length > 1) { // Assume header if first row is less than 12 pixels high
        const headerItems = content.items.filter(item =>
            (item.bottom - item.top) / 2 + item.top > segmentation[0].range[0] &&
            (item.bottom - item.top) / 2 + item.top < segmentation[0].range[1]
        );
        // Sort header items into columns
        headerItems.forEach(item => {
            item.column = segmentation[0].columns.findIndex(column => item.left <= column.range[1]);
        });
        console.debug(`Page ${pageNum} - header items: ${headerItems.length}:`, headerItems);
        // Check first and last columns for page number
        const firstColumn = headerItems.filter(item => item.column === 0).map(item => item.str).join(' ').trim();
        const lastColumn = headerItems.filter(item => item.column === segmentation[0].columns.length - 1).map(item => item.str).join(' ').trim();
        if (/^\d+$/.test(firstColumn)) {
            pageNumeral = firstColumn;
        } else if (/^\d+$/.test(lastColumn)) {
            pageNumeral = lastColumn;
        }  else {
            console.error(`Page ${pageNum} - Page Number Not Found`);
        }
    }

    return [fontMap, pageNumeral];
}

function headerFooterAndFonts(pageNum, masterFontMap, defaultFont, headerFontSizes) {
    let items = JSON.parse(LZString.decompressFromUTF16(localStorage.getItem(`page-${pageNum}-items`)));
    const nullTexts = JSON.parse(localStorage.getItem(`page-${pageNum}-nullTexts`));
    // console.log(`Null Texts: ${nullTexts.length}`, nullTexts);
    localStorage.removeItem(`page-${pageNum}-nullTexts`);

    // Find bottom of lowest instance of default font
    const defaultFontBottom = Math.max(...items.filter(item => item.fontName === defaultFont.fontName && item.height === defaultFont.fontSize).map(item => item.bottom));

    // Accumulate foot area for items below the default font's lowest position
    items
        .filter(item => item.top > defaultFontBottom)
        .forEach(item => {
            const fontEntry = masterFontMap[item.fontName];
            const fontSize = item.height;

            if (fontEntry && fontEntry.sizes[fontSize]) {
                fontEntry.sizes[fontSize].footarea += item.area;
            }
        });

    // Identify font styles
    const fontStyles = {
        'italic': /-It$|Italic|Oblique/,
        'bold': /Bold|Semibold/,
        'capital': /SC$/
    };
    items.forEach(item => {
        const fontEntry = masterFontMap[item.fontName];
        if (fontEntry) { // drawings have no font entry
            // Apply header tags
            if (headerFontSizes.includes(item.height)) {
                // Get the index of the font size in the sorted array and normalise between 1 and 6-maximum
                const index = headerFontSizes.indexOf(item.height) + 1;
                item.header = index > 6 ? 6 : index;
            }
            // Apply font styles
            for (const style in fontStyles) {
                if (fontStyles[style].test(masterFontMap[item.fontName].name)) {
                    if (['bold', 'capital'].includes(style)) {
                        // Many such strings are entirely lowercase, but "Small Caps are to be rendered as Ordinary Text, and not marked up".
                        item.str = titleCase(item.str);
                        item.titleCase = true;
                        item.header = item.header || 6; // Capitalised or bold text is assumed to be a header
                        continue; // Skip to next style
                    }
                    item[style] = true;
                }
            }
        }
    });

    // Replace null texts in italicised items e.g. "Wr in ehi l l" -> "Wringehill"
    items.forEach(item => {
        if (item.italic) {
            const nullText = nullTexts.find(nullText => nullText.compressedText === item.str.replace(/\s+/g, ''),);
            if (nullText) {
                item.str = nullText.text;
            }
        }
    });

    localStorage.setItem(`page-${pageNum}-items`, LZString.compressToUTF16(JSON.stringify(items)));
}