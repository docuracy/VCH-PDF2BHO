jQuery(document).ready(function ($) {
    // Set the workerSrc for PDF.js
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.7.570/pdf.worker.min.js';

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./service-worker.js')
            .then(reg => {
                console.log('Service Worker registered.', reg);
            })
            .catch(err => {
                console.error('Service Worker registration failed:', err);
            });
    }

    // Function to process PDF files
    function processPDF(file, fileName, zip) {  // Accept zip as a parameter
        return new Promise((resolve, reject) => {
            const fileReader = new FileReader();
            fileReader.onload = function () {
                let typedarray = new Uint8Array(this.result);
                pdfjsLib.getDocument(typedarray).promise.then(async (pdf) => {

                    // const commonOpsWithArgs = await findCommonOperatorsWithValues(pdf);
                    // console.log('Common Operators with Identical Values:', commonOpsWithArgs);

                    let docHTML = ''; // Initialize the document HTML content
                    let endnoteHTML = `<hr class="remove" /><h3 class="remove">ENDNOTES</h3>`; // Initialize the endnote HTML content
                    let endnoteLookup = []; // Initialize the endnote lookup array
                    let endnoteNumber = 1; // Initialize the endnote number

                    const stylings = {
                        'italic': {'condition': (i) => i.fontName.toLowerCase().endsWith('it')},
                        'bold': {'condition': (i) => i.fontName.toLowerCase().includes('bold')},
                        'customItalic': {'condition': (i) => /^[A-Z]{6}\+/.test(i.fontName)},
                        'remove': {
                            'condition': (i) => (
                                // /^[A-Z]{6}\+/.test(i.fontName) ||
                                i.fontName.includes('Helvetica') ||
                                i.fontName.includes('Myriad-Roman')
                            )
                        },
                        'smallCaps': {'condition': (i) => i.fontName.toLowerCase().endsWith('sc')},
                        'heading': {'condition': (i) => i.height >= 15},
                        'majorHeading': {'condition': (i) => i.height >= 20},
                        // 'gutter' for items that appear outside the main text area: TODO: Need to check values or use crop marks
                        'gutter': {'condition': (i) => i.x < 28.346 || i.y < 79.37 || i.x_max > 623.622 || i.y_max > 840},
                    };

                    // Iterate over pages and process content
                    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {

                        // Short-circuit until last page
                        // if (pageNum < pdf.numPages) {
                        //     endnoteLookup.push([]);
                        //     continue;
                        // }

                        // Stop processing after the n-th page
                        if (pageNum > 1) {
                            break;
                        }

                        if (pageNum > 1) {
                            docHTML += '<hr class="remove" />'; // Add horizontal rule between pages
                        }

                        // Call helper function to get content and font map
                        const {
                            content,
                            fontMap,
                            textLayout,
                            viewport
                        } = await getPageContentAndFonts(pdf, pageNum);
                        endnoteLookup.push([]);

                        continue; // Skip the rest of the processing for now

                        // TODO:
                        // Add `review` class to anything that needs to be reviewed manually: build a javascript function to pick options during HTML review
                        // Add `remove` class to any elements that should be removed on conversion to XML

                        let column_right = 0;
                        let found_first_endnote = false;

                        content.items.forEach((item, index) => {
                            console.log('Item index:', index, item);

                            previousItem = content.items[index - 1];

                            // Get x and y positions of the item
                            item.x = item.transform[4];
                            item.y = item.transform[5];
                            item.x_max = item.x + item.width;
                            item.y_max = item.y + item.height;

                            // Get difference in x and y positions from the previous item
                            item.dx = item.x - (previousItem?.x || 0);
                            item.dy = (previousItem?.y || 9999) - item.y;

                            item.column_x_max = column_right;

                            // Look up item font name from fontMap
                            let fontName = fontMap[item.fontName] || 'Unknown'
                            item.fontName = fontName;

                            for (const [style, styling] of Object.entries(stylings)) {
                                item[style] = styling.condition(item);
                                item.spaceBefore = item.spaceBefore || (item[style] && ['italic', 'bold'].includes(style)); // Add space before if item has a style
                            }

                            // Identify new lines and paragraphs
                            if (Math.abs(item.dy) < item.height) { // Allows for superscripts. TODO: Need to check for a threshold value - most consecutive lines at scale 10 have dy = 12
                                console.log('Same line:', item.str);
                                column_right = Math.max(column_right, item.x_max); // Update column width
                                // Get line-height from previous item
                                item.lineHeight = previousItem?.lineHeight || 0;
                                // Get horizontal distance between items, taking account of width of previous item
                                item.spaceBefore = item.spaceBefore || (item.dx - (previousItem?.x_max || 0) > 0); // TODO: Need to check for a threshold value
                            } else {
                                item.newParagraph =
                                    // is the vertical distance between items significantly greater than the height of the previous item?
                                    Math.abs(item.dy) > 1.5 * (previousItem?.height || 0) ||
                                    // or did the previous line have smallCaps and this one doesn't?
                                    (previousItem?.smallCaps && !item.smallCaps) ||
                                    // or did the previous line have a custom italic font and this one doesn't?
                                    (previousItem?.italic && previousItem?.customItalic && !item.italic) ||
                                    // or did the previous line end short of the column width?
                                    column_right - (previousItem?.x_max || 0) > 1; // TODO: Need to check for a threshold value

                                if (item.x > previousItem?.x_max && item.y > previousItem?.y) {
                                    item.newParagraph = false; // This is a probably a continuation of the previous paragraph in a new column
                                }

                                if (item.newParagraph) {
                                    console.log('New paragraph:', item.str);
                                    // Get line-height from dy
                                    item.lineHeight = index === 0 ? item.height : item.dy;
                                    item.spaceBefore = false; // No space before new paragraph
                                    column_right = item.x_max; // Update column width
                                } else {
                                    console.log('New line:', item.str);
                                    column_right = Math.max(column_right, item.x_max); // Update column width
                                    // Get line-height from previous item (which may have been a new column within the same paragraph)
                                    item.lineHeight = previousItem?.lineHeight || 0;
                                    // Check for hyphenation: does previous line end with a hyphen?
                                    if (previousItem?.str.endsWith('-')) {
                                        previousItem.str = previousItem.str.slice(0, -1) + '<span class="review hyphen">-</span>'; // Wrap hyphen in a span for review
                                        item.spaceBefore = false; // No space before hyphenated word
                                    } else {
                                        item.spaceBefore = true; // Space before new line
                                    }
                                }
                            }

                            // Identify superscript (footnote) items: higher on page, smaller font size, and integer content value
                            if (item.dy < 0 && item.height < (previousItem?.height || 0) && parseInt(item.str) > 0) {
                                item.newParagraph = false; // Footnotes are part of the same paragraph
                                item.str = `<sup idref="n${endnoteNumber}">${endnoteNumber}</sup> `;
                                endnoteLookup[pageNum - 1].push(endnoteNumber++);
                            }

                            if (!found_first_endnote) {
                                // Identify endnotes: content begins with an integer followed by a space
                                const footnoteMatch = item.str.match(/^(\d+)\s/);
                                // Endnotes are smaller font size and have a height of 8.5
                                item.endnote = footnoteMatch && item.height === 8.5;
                                // Some endnotes are condensed on the same line as the previous item: matching 
                                // after the first footnote is unpredictable, so text from this point will be processed separately 
                            }

                            if (item.smallCaps) {
                                item.str = item.str.toUpperCase();
                            }

                        });

                        // Merge items and re-order before pushing to HTML
                        let mergedItemBuffer = [];

                        // Start page with number tag
                        // Extract page number from .gutter items like "VCH Staff 11 txt 5+index_VCHistories 16/01/2013 10:02 Page 15
                        // Find first gutter item with "Page "
                        const metaGutterItem = content.items.find(i => i.gutter && i.str.includes('Page '));
                        // Extract page number from the string
                        const printPageNum = (metaGutterItem?.str.split('Page ')[1] || '0').padStart(3, '0');
                        // Extract date from metaGutterItem
                        const pdfDate = metaGutterItem?.str.match(/\d{2}\/\d{2}\/\d{4}/)?.[0] || '--/--/----';
                        docHTML += `<p class="pageNum" start="${printPageNum}">Page ${printPageNum} [PDF ${pdfDate} ${pageNum}]</p>`;

                        // Function to return class list based on item attributes
                        function getClassList(item) {
                            const classList = Object.keys(stylings).filter(attr => attr !== 'italic' && attr !== 'bold' && item[attr]);
                            return classList.length ? ` class="${classList.join(' ')}"` : '';
                        }

                        let itemBuffer = [];

                        function flushItemBuffer() {
                            if (itemBuffer.length > 0) {

                                // Merge items with same styles
                                let mergedItem;
                                let nextItem;
                                let classes;
                                while (itemBuffer.length > 0) {
                                    nextItem = itemBuffer.shift();
                                    classes = getClassList(nextItem);
                                    if (classes.length > 0) {
                                        nextItem.str = `<span${classes}>${nextItem.str}</span>`;
                                    }
                                    if (nextItem.italic) {
                                        nextItem.str = `<i>${nextItem.str}</i>`;
                                    }
                                    if (nextItem.bold) {
                                        nextItem.str = `<b>${nextItem.str}</b>`;
                                    }

                                    if (mergedItem === undefined) {
                                        mergedItem = nextItem;
                                    } else {
                                        mergedItem.str += `${nextItem.spaceBefore ? ' ' : ''}${nextItem.str}`;
                                        mergedItem.x_max = Math.max(mergedItem.x_max, nextItem.x_max);
                                    }
                                }
                                mergedItem.str = mergedItem.str
                                    .replace('</b> <b>', ' ')
                                    .replace('</i> <i>', ' ')
                                    .replace(/  /g, ' ')
                                    .replace(/&/g, '&amp;');

                                mergedItemBuffer.push(mergedItem);
                                itemBuffer = [];
                            }
                        }

                        let endnoting = false;
                        while (content.items.length > 0) {
                            const item = content.items.shift();
                            endnoting = endnoting || item.endnote;
                            if (item.newParagraph || endnoting) {
                                flushItemBuffer();
                            }
                            itemBuffer.push(item);
                        }
                        flushItemBuffer();

                        mergedItemBuffer = elevateHeadings(mergedItemBuffer);

                        while (mergedItemBuffer.length > 0 && !mergedItemBuffer[0].endnote) {
                            const item = mergedItemBuffer.shift();
                            const tag = item.majorHeading ? 'h1' : item.heading ? 'h2' : 'p';
                            docHTML += `<${tag}>${item.str}</${tag}>`;
                        }

                        // ENDNOTES: These need special handling because of peculiarities of layout.
                        // Concatenate all remaining item.str values
                        let remainingContent = mergedItemBuffer
                            .filter(item => !item.gutter) // Exclude items with .gutter = true
                            .map(item => `${item.spaceBefore ? ' ' : ''}${item.str.trim()}`) // Map remaining items
                            .join('');
                        // Loop from 1 to endnoteLookup[pageNum - 1].length
                        let currentTag = '';
                        let previousTag;
                        for (let i = 1; i <= endnoteLookup[pageNum - 1].length; i++) {
                            // Try first to find `${i} ` at the beginning of one of the mergedItemBuffer items
                            const endnoteNumber = endnoteLookup[pageNum - 1][i - 1];
                            previousTag = currentTag;
                            const previousTagEndIndex = previousTag ? remainingContent.indexOf(previousTag) + previousTag.length : 0;
                            let iIndex = remainingContent.indexOf(`${i} `, previousTagEndIndex);
                            currentTag = `${(i !== 1 ? '***' : '')}<span idref="n${endnoteNumber}" class="remove">${endnoteNumber}. [p${pageNum} fn${i}]</span>. `;

                            const item = mergedItemBuffer.find(item => item.str.startsWith(`${i} `));
                            console.log(`Endnote item ${i}:`, item);
                            if (item) {
                                // Replace first occurrence of item.str after previousTagEndIndex
                                remainingContent = remainingContent.slice(0, previousTagEndIndex) + remainingContent.slice(previousTagEndIndex).replace(item.str.trim(), `${currentTag}${item.str.trim().slice(`${i}`.length)}`);
                            } else if (iIndex > -1) {
                                remainingContent = remainingContent.slice(0, iIndex) + currentTag + remainingContent.slice(iIndex + `${i} `.length);
                            } else {
                                // Footnote digits are occasionally separated with a space
                                const spacedLoopIndex = i.toString().split('').join(' ');
                                iIndex = remainingContent.indexOf(`${spacedLoopIndex} `, previousTagEndIndex);
                                if (iIndex > -1) {
                                    remainingContent = remainingContent.slice(0, iIndex) + currentTag + remainingContent.slice(iIndex + `${spacedLoopIndex} `.length);
                                } else {
                                    console.warn(`Footnote ${i} not found on page ${pageNum}`);
                                }
                            }
                        }

                        endnoteHTML += `<p class="endnote">${remainingContent.replace(/  /g, ' ').split('***').join('</p><p class="endnote">')}</p>`;
                    }

                    docHTML += endnoteHTML;

                    showHtmlPreview(docHTML); // Display HTML in modal overlay for checking
                    appendLogMessage(`Generated HTML for file: ${fileName}, size: ${docHTML.length} characters`); // Debugging log

                    // Extract metadata from the PDF
                    let metadata = '';
                    try {
                        const meta = await pdf.getMetadata();
                        console.log('Metadata:', meta);
                        metadata += `<metadata><title>${escapeXML(meta.info.Title || 'Untitled')}</title><author>${escapeXML(meta.info.Author || 'Unknown')}</author><filename>${escapeXML(fileName)}</filename></metadata>`;
                    } catch (metaErr) {
                        console.warn('Failed to retrieve metadata:', metaErr);
                    }

                    const stats = await pdf.getStats();
                    console.log('PDF Stats:', stats);

                    docHTML = `<document><head>${metadata}</head><body>${docHTML}</body></document>`;

                    // Fetch the XSLT file and transform the HTML document to BHO XML
                    const xsltResponse = await fetch('./html-to-bho-xml.xslt');
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

    function elevateHeadings(paragraphs) {
        // Iterate through all paragraphs, starting from the second one
        for (let i = 1; i < paragraphs.length; i++) {
            // Check if the current paragraph is a heading
            if (paragraphs[i].heading) {
                let index = i;
                const currentHeading = paragraphs[i];

                // Move the heading upwards as long as the preceding paragraph is a gutter item or has a lower y value
                while ((index > 0 && paragraphs[index - 1].gutter) || (index > 0 && currentHeading.y > paragraphs[index - 1].y)) {
                    // Swap the heading with the paragraph above it
                    paragraphs[index] = paragraphs[index - 1];
                    paragraphs[index - 1] = currentHeading;

                    index--;  // Continue moving upwards
                }
            }
        }

        return paragraphs;
    }

    // Display HTML in the modal overlay for checking
    function showHtmlPreview(htmlContent) {
        $('#htmlPreviewContent').html(htmlContent);
        $('#previewModal').modal('show');
    }

    // Helper function to retrieve page, its text content, and identified fonts
    async function getPageContentAndFonts(pdf, pageNum) {
        const page = await pdf.getPage(pageNum);
        const content = await page.getTextContent();
        const fontMap = await identifyFonts(page);
        const viewport = await page.getViewport({scale: 1});
        const operatorList = await page.getOperatorList();

        appendLogMessage(`Page size: ${viewport.width.toFixed(2)} x ${viewport.height.toFixed(2)}`);
        // listOperators(operatorList);

        const cropRange = identifyCropMarks(operatorList);
        if (!!cropRange.y) {
            // Convert ranges to top-down reading order
            cropRange.y = [viewport.height.toFixed(2) - cropRange.y[0].toFixed(2), viewport.height.toFixed(2) - cropRange.y[1].toFixed(2)];
        }
        else {
            console.warn('Crop Range not found.');
            // Use default crop range based on printed page size 595.276 x 864.567
            const gutterX = (viewport.width - 595.276) / 2;
            const gutterY = (viewport.height - 864.567) / 2;
            cropRange.x = [gutterX, viewport.width - gutterX];
            cropRange.y = [gutterY, viewport.height - gutterY];
        }
        appendLogMessage(`Crop Range: x: ${cropRange.x[0].toFixed(2)} to ${cropRange.x[1].toFixed(2)}; y: ${cropRange.y[0].toFixed(2)} to ${cropRange.y[1].toFixed(2)}`);
        appendLogMessage(`Cropped size: ${cropRange.x[1].toFixed(2) - cropRange.x[0].toFixed(2)} x ${cropRange.y[1].toFixed(2) - cropRange.y[0].toFixed(2)}`);

        const mapBorders = findMap(operatorList, cropRange, viewport);
        console.log('Map Borders:', mapBorders);
        appendLogMessage(`${mapBorders.length} map(s) found`);

        // Calculate and append fontSize to each style
        Object.keys(content.styles).forEach(styleKey => {
            const style = content.styles[styleKey];
            style.fontSize = (style?.ascent && style?.descent) ? (style.ascent - style.descent) : 0;
        });

        // Set item coordinates and dimensions
        // Convert cartesian y-values to top-down reading order (eases identification of footnote numerals)
        content.items.forEach(item => {
            item.left = item.transform[4];
            item.bottom = viewport.height - item.transform[5];
            item.right = item.left + item.width;
            item.top = item.bottom - item.height;
            delete item.transform; // Remove transform array
        });
        console.log('Unfiltered content Items:', content.items);

        // Discard content items falling outside crop range or within map outlines
        content.items = content.items.filter(item =>
            item.left >= cropRange.x[0] && item.right <= cropRange.x[1] &&
            item.bottom >= cropRange.y[0] && item.top <= cropRange.y[1] &&
            !mapBorders.some(border =>
                item.left >= border.x0 && item.right <= border.x1 &&
                item.bottom >= border.y0 && item.top <= border.y1
            )
        );

        const textLayout = getTextLayout(content);
        appendLogMessage(`Text Layout: ${textLayout.columns.length} column(s), ${textLayout.rows.length} row(s) ${textLayout.footnoteRow.length > 0 ? '+footnotes' : '(no footnotes)'}`);
        console.log('Text Layout:', textLayout);

        // Add textLayoutRows
        textLayout.rows.forEach((row, index) => {
            row.columnised = true;
            row.range = [row[0], row[1]];
            delete row[0];
            delete row[1];
        });
        // Add rows to fill gaps in cropRange.y
        // Start with a row at the top of the cropped area and add rows for each gap
        const paddedRows = [{range: [cropRange.y[0], textLayout.rows[0].range[0]], columnised: false}];
        for (let i = 0; i < textLayout.rows.length - 1; i++) {
            paddedRows.push(textLayout.rows[i]);
            const gap = textLayout.rows[i + 1].range[0] - textLayout.rows[i].range[1];
            if (gap > 1) {
                paddedRows.push({range: [textLayout.rows[i].range[1], textLayout.rows[i + 1].range[0]], columnised: false});
            }
        }
        paddedRows.push(textLayout.rows[textLayout.rows.length - 1]);
        // Add a row at the bottom of the main area
        paddedRows.push({range: [textLayout.rows[textLayout.rows.length - 1].range[1], cropRange.y[1]], columnised: false});
        textLayout.rows = paddedRows;
        console.log('Text Layout with padded rows:', textLayout);

        // Tag items with row and column numbers
        content.items.forEach(item => {
            item.row = textLayout.rows.findIndex(row => item.bottom >= row.range[0] && item.top <= row.range[1]);
            // If row is columnised, find the column
            if (textLayout.rows[item.row].columnised) {
                item.column = textLayout.columns.findIndex(column => item.left >= column[0] && item.right <= column[1]);
            }
        });
        console.log('Content Items:', content.items);

        // Sort items within each column of each row by line and then by left position
        textLayout.rows.forEach(row => {
            textLayout.columns.forEach(column => {
                const itemsInColumn = content.items.filter(i => i.row === row.index && i.column === column.index);
                // TODO: Consider superscripts
                itemsInColumn.sort((a, b) => a.bottom - b.bottom || a.left - b.left);
            });
            // TODO: Push to new item array
        });

        return {content, fontMap, textLayout, viewport};
    }

    function getTextLayout(content) {

        // Identify the most commonly-used font and its height
        const fontCounts = {};
        content.items.forEach(item => {
            const key = `${item.fontName}-${item.height}`; // Create a composite key of fontName and height
            fontCounts[key] = (fontCounts[key] || 0) + 1; // Count occurrences for each unique font-height combination
        });

        // Identify the most common font-height combination
        const mostCommonFontKey = Object.keys(fontCounts).reduce((a, b) => fontCounts[a] > fontCounts[b] ? a : b);
        const [mostCommonFont, mostCommonHeight] = mostCommonFontKey.split('-'); // Split back into fontName and height

        // Items with the most common font and height
        const mostCommonFontItems = content.items.filter(i => i.fontName === mostCommonFont && i.height === parseFloat(mostCommonHeight));

        // Sort x-coordinates for columns and y-coordinates for rows
        const xCoordinates = mostCommonFontItems.map(i => i.left).sort((a, b) => a - b);
        const yCoordinates = mostCommonFontItems.map(i => i.bottom).sort((a, b) => a - b);

        // Define a clustering function to group X coordinates
        const clusterXCoordinates = (coordinates, threshold) => {
            const mean = ss.mean(coordinates);
            const stdDev = ss.standardDeviation(coordinates) || 1;
            const clusters = {};

            coordinates.forEach(coord => {
                const clusterKey = Math.round((coord - mean) / (threshold * stdDev));
                (clusters[clusterKey] ||= []).push(coord); // Push coord into cluster, creating cluster if needed
            });

            // Calculate mean and standard deviation of cluster sizes
            const clusterSizes = Object.values(clusters).map(cluster => cluster.length);
            const sizeMean = ss.mean(clusterSizes);
            const sizeStdDev = ss.standardDeviation(clusterSizes);

            // Define a sparsity threshold for cluster size
            const sparsityThreshold = sizeMean - 0.5 * sizeStdDev;

            console.log('Cluster Sizes / Sparsity Threshold:', clusterSizes, sparsityThreshold);

            // Filter clusters based on sparsity threshold and map to ranges
            return Object.values(clusters)
                .filter(cluster => cluster.length >= sparsityThreshold)
                .map(cluster => [Math.min(...cluster), Math.max(...cluster)])
                .sort((a, b) => a[0] - b[0]);
        };

        const xThreshold = .5; // TODO: May need to be adjusted
        const filteredColumns = clusterXCoordinates(xCoordinates, xThreshold);


        const clusterYCoordinates = (sortedCoords, threshold) => {
            const clusters = [];
            let currentCluster = [];

            for (let i = 0; i < sortedCoords.length; i++) {
                const coord = sortedCoords[i];

                // If the current cluster is empty or the distance to the last coordinate in the current cluster is within the threshold
                if (currentCluster.length === 0 || (coord - currentCluster[currentCluster.length - 1] <= threshold)) {
                    currentCluster.push(coord);
                } else {
                    // Push the completed cluster and start a new one
                    clusters.push([Math.min(...currentCluster), Math.max(...currentCluster)]);
                    currentCluster = [coord]; // Start new cluster
                }
            }

            // Push the last cluster if it exists
            if (currentCluster.length > 0) {
                clusters.push([Math.min(...currentCluster), Math.max(...currentCluster)]);
            }

            return clusters;
        };

        const yThreshold = 2 * mostCommonFontItems.reduce((sum, item) => sum + item.height, 0) / mostCommonFontItems.length || 0;
        const filteredRows = clusterYCoordinates(yCoordinates, yThreshold);

        // Find maximum .right for each item in each column
        const overlappingColumnRanges = filteredColumns.map(column => {
            const rightMax = mostCommonFontItems
                .filter(i => i.left >= column[0] && i.left <= column[1])
                .reduce((acc, i) => Math.max(acc, i.right), 0);
            return [column[0], rightMax];
        });

        // Now filter out encompassed ranges
        const columnRanges = overlappingColumnRanges.filter(currentRange =>
            !overlappingColumnRanges.some(otherRange =>
                currentRange[0] >= otherRange[0] && currentRange[1] <= otherRange[1] && currentRange !== otherRange
            )
        );

        // Find minimum top for each item in each row
        const rowRanges = filteredRows.map(row => {
            const topsInRow = mostCommonFontItems
                .filter(i => i.bottom >= row[0] && i.bottom <= row[1])
                .map(i => i.top); // Collect all tops in the row

            const topMin = topsInRow.length > 0 ? Math.min(...topsInRow) : Infinity; // Set to Infinity if no items
            return [topMin, row[1]];
        });

        mostCommonFontBottom = rowRanges[rowRanges.length - 1][1];
        potentialFootnotes = content.items.filter(i => i.bottom > mostCommonFontBottom);
        footnoteRowRange = [];

        const potentialFootnoteFontCounts = {};
        potentialFootnotes.forEach(item => {
            const key = `${item.fontName}-${item.height}`; // Create a composite key of fontName and height
            potentialFootnoteFontCounts[key] = (potentialFootnoteFontCounts[key] || 0) + 1; // Count occurrences for each unique font-height combination
        });

        if (Object.keys(potentialFootnoteFontCounts).length === 0) {
            console.log('No potential footnotes found.');
        } else {
            // Identify the most common font-height combination among potential footnotes
            const footnoteFontKey = Object.keys(potentialFootnoteFontCounts).reduce((a, b) => potentialFootnoteFontCounts[a] > potentialFootnoteFontCounts[b] ? a : b);
            const [footnoteFont, footnoteHeight] = footnoteFontKey.split('-'); // Split back into fontName and height
            console.log('Footnote Font:', footnoteFont, 'Height:', footnoteHeight);

            // Deduce row range for footnotes
            footnoteRowRange = [Math.min(...potentialFootnotes.map(i => i.top)), Math.max(...potentialFootnotes.map(i => i.bottom))];
        }

        return {
            columns: columnRanges,
            rows: rowRanges,
            footnoteRow: footnoteRowRange
        };
    }

    // Create a reverse lookup object to map operator numbers to their names
    const operatorNames = Object.keys(pdfjsLib.OPS).reduce((acc, key) => {
        acc[pdfjsLib.OPS[key]] = key;
        return acc;
    }, {});

    function listOperators(operatorList) {
        const operatorListArray = operatorList.fnArray.map((fn, index) => {
            const operatorName = operatorNames[fn] || `Unknown (${fn})`;
            const args = operatorList.argsArray[index];

            // Check if this is a text operation
            if (operatorName === "showText" && Array.isArray(args[0])) {
                const text = args[0].map(item => item.unicode || '').join('');
                const widths = args[0].map(item => item.width);
                console.log(`Operation: ${operatorName}, Text: "${text}", Widths: ${JSON.stringify(widths)}`);
            }
            // Check for constructPath operation
            else if (operatorName === "constructPath" && Array.isArray(args)) {
                const [commandArray, coordinatesArray] = args;

                // Iterate over command array to log suboperations
                commandArray.forEach((command, index) => {
                    const coordIndex = index * 2; // Assuming each command has 2 coordinates
                    const coords = coordinatesArray.slice(coordIndex, coordIndex + 2);
                    const commandName = operatorNames[command] || `Unknown Command (${command})`;

                    // Alert orthogonal lineTo with long length
                    if (commandName === 'lineTo' && (coords[0] > 100 || coords[1] > 100) && (coords[0] === 0 || coords[1] === 0)) {
                        console.warn(`Long lineTo operation`);
                    }

                    console.log(`Suboperation: ${commandName}, Coordinates: ${JSON.stringify(coords)}`);
                });
            }
            else {
                // Log other operations in their basic form
                console.log(`Operation: ${operatorName}, Arguments: ${JSON.stringify(args)}`);
            }
        });
    }

    function identifyCropMarks(operatorList, lengthThreshold = [9, 16], coordTolerance = 1) {
        const cropMarks = [];
        let cropRange = {};

        operatorList.fnArray.forEach((fn, index) => {
            const operatorName = operatorNames[fn] || `Unknown (${fn})`;
            const args = operatorList.argsArray[index];

            // Check for black or particular grey stroke color to start
            if (operatorName === "setStrokeRGBColor" &&
                typeof args === "object" &&
                args !== null &&
                ((args["0"] === 0 && args["1"] === 0 && args["2"] === 0)||(args["0"] === 6 && args["1"] === 6 && args["2"] === 12))
                ) {
                let foundMarks = [];

                // Check for 8 sets of operations at specified intervals
                for (let i = 1; i <= 8; i++) {
                    const transformIndex = index + 3 * i; // 3-step interval for transform
                    const pathIndex = transformIndex + 1; // 3-step interval for constructPath
                    const strokeIndex = pathIndex + 1; // 3-step interval for stroke

                    // Ensure indices are within bounds
                    if (
                        transformIndex >= operatorList.fnArray.length ||
                        pathIndex >= operatorList.fnArray.length ||
                        strokeIndex >= operatorList.fnArray.length
                    ) {
                        continue; // Skip this iteration if any index is out of bounds
                    }

                    const transformFn = operatorNames[operatorList.fnArray[transformIndex]] || `Unknown (${transformIndex})`;
                    const constructPathFn = operatorNames[operatorList.fnArray[pathIndex]] || `Unknown (${pathIndex})`;
                    const strokeFn = operatorNames[operatorList.fnArray[strokeIndex]] || `Unknown (${strokeIndex})`;

                    // Check for transform operation
                    if (transformFn === "transform") {
                        // Check for constructPath operation
                        if (constructPathFn === "constructPath" && Array.isArray(operatorList.argsArray[pathIndex])) {
                            const pathArgs = operatorList.argsArray[pathIndex];
                            const [pathArgsSet, coords] = pathArgs;

                            // Check if the path arguments match the required pattern
                            if (
                                Array.isArray(pathArgsSet) &&
                                pathArgsSet[0] === 13 && pathArgsSet[1] === 14 &&
                                (coords[2] === 0 || coords[3] === 0) // Either x or y is zero
                            ) {
                                // Check for stroke operation
                                if (strokeFn === "stroke") {
                                    foundMarks.push({
                                        transform: {
                                            name: operatorNames[transformFn],
                                            args: operatorList.argsArray[transformIndex]
                                        },
                                        constructPath: {
                                            name: operatorNames[constructPathFn],
                                            args: pathArgs
                                        },
                                        stroke: {
                                            name: operatorNames[strokeFn],
                                            args: operatorList.argsArray[strokeIndex]
                                        }
                                    });
                                }
                            }
                        }
                    }
                }

                if (foundMarks.length === 8) {
                    // Assuming the crop marks are found in the following order: top-left-vertical, top-left-horizontal,
                    // top-right-vertical, top-right-horizontal, bottom-left-vertical, bottom-left-horizontal,
                    // bottom-right-vertical, bottom-right-horizontal
                    cropRange = {
                        x: [
                            foundMarks[0].transform.args[4],
                            foundMarks[0].transform.args[4] +
                            foundMarks[1].transform.args[4] +
                            foundMarks[2].transform.args[4]
                        ],
                        y: [
                            foundMarks[0].transform.args[5] + foundMarks[1].transform.args[5],
                            foundMarks[0].transform.args[5] +
                            foundMarks[1].transform.args[5] +
                            foundMarks[2].transform.args[5] +
                            foundMarks[3]?.transform.args[5] +
                            foundMarks[4]?.transform.args[5] +
                            foundMarks[5]?.transform.args[5]
                        ]
                    }
                    console.log('Crop Range found by primary method.');
                    cropMarks.push(...foundMarks);
                }
                else {
                    let operator = operatorNames[operatorList.fnArray[index + 4]] || `Unknown (${pathIndex})`;
                    if (operator === 'constructPath') {
                        let pathArgs = operatorList.argsArray[index + 4];
                        const targetArray = [13, 14, 13, 14, 13, 14, 13, 14, 13, 14, 13, 14, 13, 14, 13, 14];
                        if (Array.isArray(pathArgs) &&
                            Array.isArray(pathArgs[0]) &&
                            pathArgs[0].length === targetArray.length &&
                            pathArgs[0].every((val, index) => val === targetArray[index])) {
                            operator = operatorNames[operatorList.fnArray[index + 3]] || `Unknown (${pathIndex})`;
                            if (operator === 'transform') {
                                const transformArgs = operatorList.argsArray[index + 3];
                                pathArgs = pathArgs[1];
                                cropRange = {
                                    x: [pathArgs[14] - pathArgs[24], pathArgs[14] - pathArgs[16]],
                                    y: [transformArgs[5], transformArgs[5] + pathArgs[9]]
                                }
                                console.log('Crop Range found by secondary method.');
                            }
                        }
                    }
                }
                if (Object.keys(cropRange).length === 0) {
                    // Check for 4 sets of operations at specified intervals
                    for (let i = 1; i <= 4; i++) {
                        const pathIndex = index + 5 + 2 * i; // 2-step interval for constructPath
                        const strokeIndex = pathIndex + 1; // 2-step interval for stroke

                        // Ensure indices are within bounds
                        if (
                            pathIndex >= operatorList.fnArray.length ||
                            strokeIndex >= operatorList.fnArray.length
                        ) {
                            continue; // Skip this iteration if any index is out of bounds
                        }

                        const constructPathFn = operatorNames[operatorList.fnArray[pathIndex]] || `Unknown (${pathIndex})`;
                        const strokeFn = operatorNames[operatorList.fnArray[strokeIndex]] || `Unknown (${strokeIndex})`;

                        if (strokeFn === "stroke") {
                            if (constructPathFn === "constructPath" && Array.isArray(operatorList.argsArray[pathIndex])) {
                                const pathArgs = operatorList.argsArray[pathIndex][1];
                                if (pathIndex - index === 7) {
                                    cropRange['y'] = [pathArgs[1], pathArgs[5]];
                                }
                                else if (pathIndex - index === 11) {
                                    cropRange['x']= [pathArgs[0], pathArgs[4]];
                                    console.log('Crop Range found by tertiary method.');
                                }
                            }
                        }
                    }
                }
            }
        });

        return cropRange;
    }

    // Function to extract rectangles from operator list
    function findMap(operatorList, cropRange, viewport) {
        let rectangles = [];

        operatorList.fnArray.forEach((fn, index) => {
            const args = operatorList.argsArray[index];

            if (fn === pdfjsLib.OPS.rectangle) {
                rectangles.push({
                    x0: args[0],
                    y0: args[1],
                    x1: args[0] + args[2],
                    y1: args[1] + args[3],
                    width: args[2],
                    height: args[3]
                });
            }

            if (fn === pdfjsLib.OPS.constructPath) {

                const operators = args[0]; // Contains the operator data
                const pathArgs = args[1]; // Contains the path data

                cursor = 0;
                operators.forEach((op, i) => {
                    if (op === pdfjsLib.OPS.moveTo) {
                        // Discard a pair of coordinates
                        cursor += 2;
                    } else if (op === pdfjsLib.OPS.rectangle) {
                        const rectangle = pathArgs.slice(cursor, cursor + 4);
                        cursor += 4;
                        // console.log('Operators:', operators.map(op => operatorNames[op]));
                        // console.log('pathArgs:', pathArgs);
                        // console.log('Rectangle:', rectangle);
                        rectangles.push({
                            x0: rectangle[0],
                            y0: rectangle[1],
                            x1: rectangle[0] + rectangle[2],
                            y1: rectangle[1] + rectangle[3],
                            width: rectangle[2],
                            height: rectangle[3]
                        });
                    }
                });
            }
        });

        // Convert y-values to top-down reading order, set absolute width and height, and calculate area
        rectangles.forEach(rect => {
                rect.y0 = viewport.height - rect.y0;
                rect.y1 = viewport.height - rect.y1;
                // Swap x0 and x1 if x0 > x1
                if (rect.x0 > rect.x1) {
                    [rect.x0, rect.x1] = [rect.x1, rect.x0];
                }
                // Set absolute width and height
                rect.width = Math.abs(rect.width);
                rect.height = Math.abs(rect.height);
                rect.area = rect.width * rect.height;
            }
        );

        // Filter out rectangles with area less than 10% of the crop area
        const cropArea = (cropRange.x[1] - cropRange.x[0]) * (cropRange.y[1] - cropRange.y[0]);
        rectangles = rectangles.filter(rect => rect.area > 0.1 * cropArea);

        // Filter out rectangles outside the crop range
        rectangles = rectangles.filter(rect => {
            return rect.x0 >= cropRange.x[0] && rect.x1 <= cropRange.x[1] &&
                rect.y0 >= cropRange.y[0] && rect.y1 <= cropRange.y[1];
        });

        // Sort rectangles by area in descending order
        rectangles.sort((rect1, rect2) => rect2.area - rect1.area);

        // Filter out rectangles within other rectangles
        rectangles = rectangles.filter((rect1, i) => {
            // Check if rect1 is within any other rect
            return !rectangles.some((rect2, j) => {
                return (
                    i !== j && // Make sure we're not comparing the same rectangle
                    rect1.x0 >= rect2.x0 &&
                    rect1.x1 <= rect2.x1 &&
                    rect1.y0 >= rect2.y0 &&
                    rect1.y1 <= rect2.y1
                );
            });
        });

        return rectangles;
    }

    // Helper function: Identify and map fonts for a given page
    function identifyFonts(page) {
        return page.getOperatorList().then(() => {
            const fonts = page.commonObjs._objs;
            const fontMap = {};
            for (const fontKey in fonts) {
                const font = fonts[fontKey]?.data;
                if (font) {
                    fontMap[font.loadedName] = font.name;
                }
            }
            return fontMap;
        });
    }

    // Helper function to compare relevant attributes between two objects
    const areAttributesEqual = (attrs1, attrs2, keys) => {
        return keys.every(key => attrs1[key] === attrs2[key]);
    };

    // List of keys to compare
    const comparisonKeys = ['fontName', 'fontFamily', 'fontSize', 'itemDirection', 'itemScale'];

    // Function to decode HTML entities to UTF-8
    // TODO: Check that this works - escapeXML converts "&" back to "&amp;" which may not be necessary
    const decodeHtmlEntities = (html) => {
        const txt = document.createElement('textarea');
        txt.innerHTML = html;
        return txt.value;
    };

    // Function to Escape XML Special Characters
    function escapeXML(input) {
        const str = (input != null) ? String(input) : '';
        return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    // Function to Display Alerts
    function showAlert(message, type) {
        const alertHtml = `
      <div class="alert alert-${type} alert-dismissible fade show" role="alert">
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
      </div>`;
        $('#alertPlaceholder').html(alertHtml);
    }

    function appendLogMessage(message) {
        const logContainer = $('#logContainer');
        logContainer.append('<p>' + message + '</p>').show();
        logContainer.scrollTop(logContainer.prop("scrollHeight"));
    }

    // Clear logContainer when files are chosen
    $('#pdfInput').on('change', function () {
        $('#alertPlaceholder').empty(); // Clear any existing alerts
        $('#logContainer').hide().html('<p><strong>Logs:</strong></p>'); // Clear the log container
    });

    function transformXml(xml, xslt) {
        // Create a new XSLTProcessor
        const xsltProcessor = new XSLTProcessor();

        // Parse the XSLT string into a document
        const parser = new DOMParser();
        const xsltDoc = parser.parseFromString(xslt, 'application/xml');

        // Import the XSLT stylesheet
        xsltProcessor.importStylesheet(xsltDoc);

        // Parse the XML string into a document
        const xmlDoc = parser.parseFromString(xml, 'application/xml');

        // Perform the transformation
        const transformedDoc = xsltProcessor.transformToFragment(xmlDoc, document);

        // Serialize the transformed document back to a string
        const serializer = new XMLSerializer();
        return serializer.serializeToString(transformedDoc);
    }

    // Handle Convert Button Click
    $('#convertBtn').on('click', function () {
        const fileInput = $('#pdfInput')[0];
        if (fileInput.files.length === 0) {
            showAlert('Please select at least one PDF or ZIP file.', 'warning');
            return;
        }

        const zip = new JSZip();  // Initialize the JSZip instance here
        const pdfFiles = Array.from(fileInput.files);
        const promises = [];

        // Iterate through selected files
        pdfFiles.forEach(file => {
            const extension = file.name.split('.').pop().toLowerCase();
            const fileType = (extension === 'pdf') ? 'application/pdf' :
                (extension === 'zip') ? 'application/zip' : '';

            appendLogMessage(`Processing file: ${file.name}, extension: ${extension}, type: ${fileType}`); // Debugging log
            if (fileType === 'application/zip') {
                const zipFileReaderPromise = new Promise((resolve, reject) => {
                    const zipFileReader = new FileReader();
                    zipFileReader.onload = function (event) {
                        const arrayBuffer = event.target.result;

                        // Load the ZIP file from the ArrayBuffer
                        JSZip.loadAsync(arrayBuffer).then(zipContent => {
                            appendLogMessage(`Loaded ZIP file: ${file.name}`);
                            const pdfPromises = Object.keys(zipContent.files).map(pdfFileName => {
                                if (pdfFileName.endsWith('.pdf')) {
                                    appendLogMessage(`Found PDF in ZIP: ${pdfFileName}`);
                                    return zipContent.files[pdfFileName].async('blob').then(blob => {
                                        // Process the PDF and return the promise
                                        return processPDF(blob, pdfFileName, zip);
                                    });
                                }
                            }).filter(Boolean); // Filter out undefined values (non-PDF files)

                            // Ensure all PDF promises resolve before completing the ZIP processing
                            return Promise.all(pdfPromises);
                        }).then(() => {
                            appendLogMessage(`Processed all PDFs in ZIP: ${file.name}`);
                            resolve(); // Resolve the outer promise when done
                        }).catch(err => {
                            appendLogMessage(`Error processing ZIP file: ${err}`);
                            console.error('Error processing ZIP file:', err);
                            reject(err); // Reject the outer promise if there's an error
                        });
                    };
                    zipFileReader.onerror = (err) => {
                        appendLogMessage(`Error reading ZIP file: ${err}`);
                        console.error('Error reading ZIP file:', err);
                        reject(err); // Reject if FileReader fails
                    };
                    zipFileReader.readAsArrayBuffer(file);
                });

                // Push the zip file reader promise to the promises array
                promises.push(zipFileReaderPromise);
            } else if (fileType === 'application/pdf') {
                // Process single PDF files directly
                appendLogMessage(`Processing PDF file: ${file.name}`);
                promises.push(processPDF(file, file.name, zip)); // Pass the zip object to processPDF
            } else {
                showAlert('Unsupported file type: ' + file.name, 'danger');
            }
        });

        // Wait for all promises to resolve
        Promise.all(promises).then(() => {
            appendLogMessage('All PDF files processed successfully. Generating ZIP...');

            // Generate the ZIP file and trigger download
            // zip.generateAsync({type: 'blob'}).then(function (content) {
            //     saveAs(content, 'pdfs_to_xml.zip');
            //     showAlert('All XML files have been generated and zipped successfully!', 'success');
            // }).catch(err => {
            //     appendLogMessage(`Error generating ZIP: ${err}`);
            //     console.error('Error generating ZIP:', err);
            // });
        }).catch(err => {
            appendLogMessage(`Error processing files: ${err}`);
            console.error('Error processing files:', err);
        }).finally(() => {
            appendLogMessage('End of file processing.');
            appendLogMessage('=======================');
        });
    });

    async function findCommonOperatorsWithValues(pdf) {
        let commonOpsWithArgs = [];

        // Iterate through each page of the PDF in reverse order
        for (let pageNum = pdf.numPages; pageNum >= 1; pageNum--) {
            const page = await pdf.getPage(pageNum);
            const operatorList = await page.getOperatorList();

            // Store operator-argument pairs for this page
            let opsWithArgsForPage = [];

            operatorList.fnArray.forEach((fn, index) => {
                const operatorName = operatorNames[fn];
                const args = operatorList.argsArray[index];

                // Push an object with the operator name and its arguments
                opsWithArgsForPage.push({
                    operator: operatorName,
                    args: JSON.stringify(args) // Use JSON.stringify to compare the arguments
                });
            });

            if (pageNum === pdf.numPages) {
                // Initialize the commonOpsWithArgs with the last page's operators
                commonOpsWithArgs = opsWithArgsForPage;
            } else {
                // For previous pages, keep only operators with matching args across pages
                commonOpsWithArgs = commonOpsWithArgs.filter(opWithArg =>
                    opsWithArgsForPage.some(op =>
                        op.operator === opWithArg.operator && op.args === opWithArg.args
                    )
                );
            }

            // If no common operators left, stop early
            if (commonOpsWithArgs.length === 0) {
                break;
            }
        }

        // Return operator-argument pairs that are common across all pages
        return commonOpsWithArgs;
    }

});
