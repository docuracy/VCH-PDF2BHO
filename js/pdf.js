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

                // Discard all except the first `n` pages (set to `Infinity` to process all pages)
                const maxPages = Infinity

                // Iterate over pages to find crop, map, and table bounds; create font dictionary; store augmented items in localStorage
                let masterFontMap = {};
                for (let pageNum = 1; pageNum <= Math.min(pdf.numPages, maxPages); pageNum++) {
                    const pageFontMap = await storePageData(pdf, pageNum);
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
                console.log('headerFontSizes:', headerFontSizes);

                // Iterate over pages to preprocess footnote areas and remove header; tag headers and italic, bold, and capital fonts
                for (let pageNum = 1; pageNum <= Math.min(pdf.numPages, maxPages); pageNum++) {
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

                console.log('Master Font Map:', masterFontMap);
                console.log(`Default Font: ${defaultFont.fontName} @ ${defaultFont.fontSize}`);
                console.log(`Footnote Font: ${footFont.fontName} @ ${footFont.fontSize}`);

                const columns = findColumns(Math.min(pdf.numPages, maxPages), defaultFont, footFont);
                console.log('Columns:', columns || '(none)');

                let docHTML = ''; // Initialize the document HTML content

                let maxEndnote = 0;
                if (columns) { // TODO: Fix tagRowsAndColumns to handle null columns
                    // Iterate over pages to identify rows and then process items
                    for (let pageNum = 1; pageNum <= Math.min(pdf.numPages, maxPages); pageNum++) {
                        let pageHTML = '';
                        [maxEndnote, pageHTML] = await tagRowsAndColumns(pageNum, defaultFont, footFont, columns, maxEndnote, pdf);
                        docHTML += `${pageHTML}<hr class="remove" />`; // Add horizontal rule between pages
                    }
                }

                // Loop through pages to add footnotes to endnotes
                docHTML += `<hr class="remove" /><h3 class="remove">ENDNOTES</h3>`;
                docHTML += Array.from({ length: Math.min(pdf.numPages, maxPages) }, (_, i) => {
                    let footnotes;
                    try {
                        footnotes = JSON.parse(LZString.decompressFromUTF16(localStorage.getItem(`page-${i + 1}-footnotes`)));
                    } catch (err) {
                        footnotes = [];
                    }
                    return footnotes.map(item => `<div class="endnote">${item.str}</div>`).join('');
                }).join('');

                showHtmlPreview(docHTML); // Display HTML in modal overlay for checking
                appendLogMessage(`Generated HTML for file: ${fileName}, size: ${docHTML.length} characters`); // Debugging log

                docHTML = `<document><head></head><body>${docHTML}</body></document>`;

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
    appendLogMessage(`====================`);
    appendLogMessage(`Processing page ${pageNum}...`);
    console.log(`Processing page ${pageNum}...`);
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const viewport = await page.getViewport({scale: 1});
    const operatorList = await page.getOperatorList();

    // if (pageNum === 4) {
    //     console.log(structuredClone(content.items));
    //     listOperators(operatorList)
    // }

    localStorage.setItem(`page-${pageNum}-viewport`, JSON.stringify(viewport));
    appendLogMessage(`Page size: ${viewport.width.toFixed(2)} x ${viewport.height.toFixed(2)}`);

    const segments = await segmentPage(page, viewport, operatorList);
    console.log(`Segments:`, segments);

    const cropRange = segments.cropRange;
    localStorage.setItem(`page-${pageNum}-cropRange`, JSON.stringify(cropRange));
    appendLogMessage(`Crop Range: x: ${cropRange.x[0].toFixed(2)} to ${cropRange.x[1].toFixed(2)}; y: ${cropRange.y[0].toFixed(2)} to ${cropRange.y[1].toFixed(2)}`);
    appendLogMessage(`Cropped size: ${cropRange.x[1].toFixed(2) - cropRange.x[0].toFixed(2)} x ${cropRange.y[1].toFixed(2) - cropRange.y[0].toFixed(2)}`);

    const drawingBorders = findDrawings(operatorList, cropRange, viewport);

    augmentItems(content.items, viewport);
    // Discard content items falling outside crop range or within drawing outlines
    content.items = content.items.filter(item =>
        item.left >= cropRange.x[0] && item.right <= cropRange.x[1] &&
        item.bottom >= cropRange.y[0] && item.top <= cropRange.y[1] &&
        !drawingBorders.some(border =>
            item.left >= border.left && item.right <= border.right &&
            item.bottom <= border.bottom && item.top >= border.top
        )
    );

    if (drawingBorders.length > 0) {
        localStorage.setItem(`page-${pageNum}-drawingBorders`, JSON.stringify(drawingBorders));
        appendLogMessage(`${drawingBorders.length} drawing(s) found`);
        // Add new items to represent drawings
        content.items.push(...drawingBorders.map(drawingBorder => ({
            ...drawingBorder,
            'bottom': drawingBorder.top, // Switch to top value to ensure that label follows drawing in reading layout
            'str': '',
            'fontName': 'drawing',
            'paragraph': true
        })));
    }

    localStorage.setItem(`page-${pageNum}-items`, LZString.compressToUTF16(JSON.stringify(content.items)));
    localStorage.setItem(`page-${pageNum}-nullTexts`, JSON.stringify(findNullTexts(operatorList)));

    const fonts = page.commonObjs._objs;
    const fontMap = {};
    for (const fontKey in fonts) {
        const font = fonts[fontKey]?.data;
        if (font) {
            fontMap[font.loadedName] = { 'name': font.name, 'sizes': {} };
        }
    }

    // Calculate font areas
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

    return fontMap;
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

    // Identify the top line and extract the page number (items do not typically share the exact same bottom position)
    const topItemBottom = Math.min(...items.map(item => item.bottom));
    const topLineItems = items.filter(item => item.top <= topItemBottom);
    const pageNumberItem = topLineItems.find(item => /^\d+$/.test(item.str));

    if (pageNumberItem) {
        localStorage.setItem(`page-${pageNum}-pageNumber`, pageNumberItem?.str || '');
        // Remove header items
        items = items.filter(item => item.top > topItemBottom);
    }
    else {
        console.error(`Page ${pageNum} - Page Number Not Found`);
    }

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
                // Get the index of the font size in the sorted array and normalise between 2 and 6-maximum
                const index = headerFontSizes.indexOf(item.height);
                item.header = index > 6 ? 6 : index;
            }
            // Apply font styles
            for (const style in fontStyles) {
                if (fontStyles[style].test(masterFontMap[item.fontName].name)) {
                    if (['capital', 'bold'].includes(style)) {
                        // Many such strings are entirely lowercase, but "Small Caps are to be rendered as Ordinary Text, and not marked up".
                        item.str = titleCase(item.str);
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