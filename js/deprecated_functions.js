function deprecatedFunction() {
    // TODO:
    // Add `review` class to anything that needs to be reviewed manually: build a javascript function to pick options during HTML review
    // Add `remove` class to any elements that should be removed on conversion to XML

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

    function metadata() {
        // Extract metadata from the PDF
        let metadata = '';
        try {
            const meta = await pdf.getMetadata();
            console.log('Metadata:', meta);
            metadata += `<metadata><title>${escapeXML(meta.info.Title || 'Untitled')}</title><author>${escapeXML(meta.info.Author || 'Unknown')}</author><filename>${escapeXML(fileName)}</filename></metadata>`;
        } catch (metaErr) {
            console.warn('Failed to retrieve metadata:', metaErr);
        }
    }

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
        console.warn('Crop Range not found: using defaults.');
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

    augmentItems(content.items);
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
        if (textLayout.rows[item.row]?.columnised) {
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