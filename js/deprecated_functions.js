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

function findColumns(numPages, defaultFont, footFont, columnSpacing = 11.75, significanceThreshold = 0.5) {
    let columnItems = [];

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const items = JSON.parse(LZString.decompressFromUTF16(localStorage.getItem(`page-${pageNum}-items`)));
        columnItems.push(...items.filter(item => {
            return (item.fontName === defaultFont.fontName && item.height === defaultFont.fontSize) ||
                (item.fontName === footFont.fontName && item.height === footFont.fontSize);
        }));
    }

    // Extract leftmost values and crop range
    const leftMin = Math.min(...columnItems.map(item => item.left));
    const rightMax = Math.max(...columnItems.map(item => item.right));
    const marginWidth = rightMax - leftMin;
    const columnWidth2 = (marginWidth - columnSpacing) / 2;
    const columnWidth3 = (marginWidth - 2 * columnSpacing) / 3;
    const columnCentres = [leftMin + columnWidth2, leftMin + columnWidth3, (rightMax - leftMin) / 2, rightMax - columnWidth3, rightMax - columnWidth2];

    // Initialize groupedCentres with the calculated column centres
    const groupedCentres = columnCentres.reduce((acc, centre) => {
        acc[centre] = 0; // Initialize counts to zero
        return acc;
    }, {});

    // Extract centre points from the columnItems
    const centres = columnItems.map(item => item.left + item.width / 2);

    // Group centres into closest seeded centre
    centres.forEach(centre => {
        const closestCentre = columnCentres.reduce((closest, current) =>
            Math.abs(current - centre) < Math.abs(closest - centre) ? current : closest
        );
        groupedCentres[closestCentre] += 1; // Increment count for the closest group
    });

    // Log the counts table for each grouped centre
    console.log('Potential Columns:');
    console.table(groupedCentres);

    // Convert grouped centers to an array of entries
    const centreEntries = Object.entries(groupedCentres)
        .map(([centre, count]) => ({centre: parseFloat(centre), count}))
        .sort((a, b) => b.count - a.count); // Sort by count descending

    // Determine if there are significantly more tallies
    const maxCount = centreEntries[0].count;
    const significantGroups = centreEntries.filter(entry => entry.count >= maxCount * significanceThreshold);

    // Calculate column boundaries based on significant groups
    const maxColumnWidth = marginWidth / significantGroups.length;

    // Find maximum width for items whose .width is less than columnWidth
    const maxItemWidth = Math.max(
        ...columnItems
            .filter(item => item.width < maxColumnWidth)
            .map(item => item.width),
        0
    );

    return significantGroups.length > 1 ? {
        count: significantGroups.length,
        width: maxItemWidth
    } : null;
}


async function tagRowsAndColumns(pageNum, defaultFont, footFont, columns, maxEndnote, pdf) {
    let items = JSON.parse(LZString.decompressFromUTF16(localStorage.getItem(`page-${pageNum}-items`)));
    const pageNumeral = JSON.parse(localStorage.getItem(`page-${pageNum}-pageNumber`));
    const cropRange = JSON.parse(localStorage.getItem(`page-${pageNum}-cropRange`));
    const drawingBorders = JSON.parse(localStorage.getItem(`page-${pageNum}-drawingBorders`));
    const viewport = JSON.parse(localStorage.getItem(`page-${pageNum}-viewport`));

    const page = await pdf.getPage(pageNum);
    const drawings = drawingBorders ? await extractDrawingsAsBase64(page, viewport, drawingBorders) : [];

    // Release localStorage memory
    localStorage.removeItem(`page-${pageNum}-items`);
    localStorage.removeItem(`page-${pageNum}-pageNumber`);
    localStorage.removeItem(`page-${pageNum}-cropRange`);
    localStorage.removeItem(`page-${pageNum}-rows`);
    localStorage.removeItem(`page-${pageNum}-viewport`);

    // Filter items by default and footer font specifications
    const columnItems = items.filter(item =>
        (item.fontName === defaultFont.fontName && item.height === defaultFont.fontSize) ||
        (item.fontName === footFont.fontName && item.height === footFont.fontSize)
    );

    // Define column ranges
    const leftMin = Math.min(...columnItems.map(item => item.left));
    const rightMax = Math.max(...columnItems.map(item => item.right));
    const textWidth = rightMax - leftMin;
    const columnSpacing = (textWidth - columns.width * columns.count) / (columns.count - 1);
    const columnRanges = Array.from({length: columns.count}, (_, index) => {
        const left = leftMin + index * (columnSpacing + columns.width);
        return [left - columnSpacing / 2, left + columns.width + columnSpacing / 2];
    });

    // Extract and sort bottom coordinates
    const bottomCoords = columnItems.map(item => item.bottom).sort((a, b) => a - b);

    // Helper function to cluster bottoms within a given threshold
    function clusterBottoms(coords, threshold) {
        const clusters = [];
        let currentCluster = [];

        coords.forEach(coord => {
            if (!currentCluster.length || coord - currentCluster.at(-1) <= threshold) {
                currentCluster.push(coord);
            } else {
                clusters.push([Math.min(...currentCluster), Math.max(...currentCluster)]);
                currentCluster = [coord];
            }
        });

        if (currentCluster.length) clusters.push([Math.min(...currentCluster), Math.max(...currentCluster)]);
        return clusters;
    }

    // Define a threshold based on average item height
    const avgHeight = columnItems.reduce((sum, item) => sum + item.height, 0) / columnItems.length || 0;
    const bottomThreshold = 3 * avgHeight;

    // Cluster bottom coordinates
    const filteredRows = clusterBottoms(bottomCoords, bottomThreshold);

    // Map each row range to include the minimum top coordinate
    const columnisedRowRanges = filteredRows.map(row => {
        const topsInRow = columnItems
            .filter(item => item.bottom >= row[0] && item.bottom <= row[1])
            .map(item => item.top);

        const topMin = topsInRow.length > 0 ? Math.min(...topsInRow) : Infinity;
        return {columnised: true, range: [topMin, row[1]]};
    });

    // Fill gaps in cropRange.y and add rows
    const rows = [{range: [cropRange.y[0], columnisedRowRanges[0]?.range[0] || cropRange.y[1]], columnised: false}];

    columnisedRowRanges.forEach((row, index) => {
        rows.push(row);
        const nextRowStart = columnisedRowRanges[index + 1]?.range[0];
        if (nextRowStart && nextRowStart - row.range[1] > 1) {
            rows.push({range: [row.range[1], nextRowStart], columnised: false});
        }
    });

    rows.push({range: [columnisedRowRanges.at(-1)?.range[1] || cropRange.y[0], cropRange.y[1]], columnised: false});

    localStorage.setItem(`page-${pageNum}-rows`, JSON.stringify(rows));

    // Tag items with row and column numbers; normalise bottoms of superscript items
    // Initialise set to store found footnote numbers
    let foundFootnoteIndices = new Set();

    // Find the lowest bottom of default font items
    const defaultBottom = Math.max(...items.filter(item => item.fontName === defaultFont.fontName && item.height === defaultFont.fontSize).map(item => item.bottom) || 0);
    // Find the highest top of foot font items which are below defaultBottom
    const footnoteTop = Math.min(...items.filter(item => item.fontName === footFont.fontName && item.height === footFont.fontSize && item.top > defaultBottom).map(item => item.top) || Infinity);

    // Split off as footnotes any items below footnoteTop, and remove them from the main items array
    let footnotes = items.filter(item => item.top >= footnoteTop);
    items = items.filter(item => item.top < footnoteTop);

    items.forEach((item, index) => {
        item.row = rows.findIndex(row => item.top >= row.range[0] && item.bottom <= row.range[1]);
        // If row is columnised, find the column
        if (rows[item.row]?.columnised) {
            item.column = columnRanges.findIndex(column => item.left >= column[0] && item.right <= column[1]);
        }
        // Footnote Indices: Normalise attributes of integer superscript items (assumes that item and previous item are rendered in reading order)
        // TODO: The above upsets reading order of drawing labels, also polluting the footnote indices
        // Check that previous item is not a drawing
        if (items[index - 1]?.fontName !== 'drawing' && item.bottom < items[index - 1]?.bottom && /^\d+$/.test(item.str)) {
            const footIndex = parseInt(item.str);
            foundFootnoteIndices.add(footIndex);
            item.footIndex = footIndex;
            item.str = String(footIndex + maxEndnote);
            item.bottom = items[index - 1].bottom; // Required for sorting
            item.height = items[index - 1].height; // Required for merging
            item.fontName = items[index - 1].fontName; // Required for merging
        }
        // Drawing Numbers: integer items with a period mark and with the same bottom as the next item
        if (item.bottom === items[index + 1]?.bottom && /^\d+.$/.test(item.str)) {
            item.drawingNumber = true;
        }
    });

    processFootnotes(rows, columnRanges, footnotes, pageNum, pageNumeral, maxEndnote, foundFootnoteIndices);
    footnotes = null;

    // Sort items in reading order based on row and column (allow tolerance in bottom)
    items.sort((a, b) => a.row - b.row || a.column - b.column || a.bottom - b.bottom + b.height / 2 || a.left - b.left);

    // Identify paragraph ends
    const tolerance = 5;

    function isSameBlock(item, reference) {
        return item.row === reference.row && item.column === reference.column;
    }

    function calculateBlockEdges(blockItems) {
        return {
            maxRight: Math.max(...blockItems.map(i => i.right)),
            minLeft: Math.min(...blockItems.map(i => i.left))
        };
    }

    items.forEach((item, index) => {
        const nextItem = items[index + 1];
        const prevItem = items[index - 1];
        const thisBlockItems = items.filter(i => isSameBlock(i, item));
        const nextBlockItems = thisBlockItems.includes(nextItem)
            ? thisBlockItems
            : items.filter(i => i.row === nextItem?.row + 1 && i.column === nextItem?.column);

        const { maxRight: thisBlockMaxRight, minLeft: thisBlockMinLeft } = calculateBlockEdges(thisBlockItems);
        const { minLeft: nextBlockMinLeft } = calculateBlockEdges(nextBlockItems);

        item.isPreviousItemSameLine = prevItem?.isNextItemSameLine;
        item.isItemAtLineEnd = item.right + tolerance > thisBlockMaxRight;
        item.isItemIndented = item.left - tolerance > thisBlockMinLeft && !item.isPreviousItemSameLine;

        item.isNextItemInRow = nextItem?.row === item.row;
        item.isNextItemSameLine = nextItem?.bottom < item.bottom + item.height / 2 && nextItem?.column === item.column;
        item.isNextItemTabbed = item.isNextItemSameLine && nextItem?.left - 2 * tolerance > item.right;
        item.isNextItemIndented = nextItem?.left - tolerance > nextBlockMinLeft && !item.isNextItemSameLine;
        item.isMidCaption = thisBlockItems[0]?.fontName === 'drawing' && item.italic && nextItem?.italic;

        const isEndOfParagraph = (
            (item.isNextItemIndented && !item.isItemIndented) ||
            (item.str?.endsWith('.') && !item.isItemAtLineEnd && !item.isNextItemSameLine && !item.isMidCaption) ||
            (item.bold && !nextItem?.bold) ||
            (item.isItemIndented && item.italic && !item.isNextItemSameLine && !item.isMidCaption) ||
            (item.italic && item.isNextItemTabbed) ||
            !item.isNextItemInRow
        );

        if (isEndOfParagraph) {
            item.paragraph = true;
        }
    });

    // console.log(structuredClone(items));

    // Wrap footnote indices in superscript tags
    items.filter(item => item.footIndex).forEach(item => {
        const endnoteNumber = item.footIndex + maxEndnote;
        item.str = `<sup><a id="endnoteIndex${endnoteNumber}" href="#endnote${endnoteNumber}" data-footnote="${item.footIndex}" data-endnote="${endnoteNumber}">${endnoteNumber}</a></sup>`;
    });

    mergeItems(items, ['row', 'fontName', 'height', 'header', 'italic', 'bold']);

    wrapStrings(items);

    mergeItems(items, ['row']);

    trimStrings(items);

    // Add drawing images to items
    items.filter(item => item.fontName === 'drawing').forEach((item, index) => {
        item.str = `<img src="${drawings[index]}" />`;
    });

    // Construct page HTML
    let pageHTML = `<p class="pageNum">--- Page ${pageNumeral} (PDF ${pageNum}) ---</p>`;
    items.forEach(item => {
        if (item.fontName === 'drawing') {
            pageHTML += `<div class="drawing">${item.str}</div>`;
        } else {
            const classes = ['paragraph', 'tooltip-item'];
            if (item.drawingNumber) classes.push('drawing-label');
            // Create an HTML string for the tooltip content
            const tooltipContent = Object.entries(item).filter(([key]) => key !== 'str')
                .map(([key, value]) => `<strong>${escapeXML(key)}:</strong> ${escapeXML(value)}`)
                .join('<br>');

            pageHTML += `<div class="${classes.join(' ')}" data-bs-title="${tooltipContent}" data-bs-toggle="tooltip">${item.str}</div>`;
        }
    });

    // Initialise Bootstrap tooltips using JQuery
    $(document).ready(function() {
        $('[data-bs-toggle="tooltip"]').tooltip({
            container: 'body',
            html: true,
            trigger: 'manual',  // Manual control over show/hide
            boundary: 'window',  // Prevent tooltip from overflowing
        });

        // Show tooltip on mouse enter and hide on mouse leave (default is unreliable)
        $('.tooltip-item').on('mouseenter', function() {
            $(this).tooltip('show');
        }).on('mouseleave', function() {
            $(this).tooltip('hide');
        });
    });


    /////////////////////////////
    // FINALISE
    /////////////////////////////

    // Remove drawing images from items to avoid bloating localStorage: they can be re-extracted at higher resolution and added to zip file when needed
    items.filter(item => item.fontName === 'drawing').forEach(item => {
        items.str = '';
    });

    try {
        localStorage.setItem(`page-${pageNum}-items`, LZString.compressToUTF16(JSON.stringify(items)));
    } catch (error) {
        console.error('Error saving to localStorage:', error);
    }

    appendLogMessage(`=== Page ${pageNum} Rows & Columns ===`);
    appendLogMessage(`Row Ranges: ${JSON.stringify(rows)}`);
    appendLogMessage(`Column Ranges: ${JSON.stringify(columnRanges)}`);

    maxEndnote += Math.max(...(foundFootnoteIndices.size ? foundFootnoteIndices : [0]));

    // console.log(`Page ${pageNum}: maxEndnote is ${maxEndnote}`);

    return [maxEndnote, pageHTML];
}


// Function to extract rectangles from operator list
function findDrawings(operatorList, cropRange, viewport) {
    let rectangles = [];
    let origin = [0, 0];

    operatorList.fnArray.forEach((fn, index) => {
        const args = operatorList.argsArray[index];

        const nextOperator = index < operatorList.fnArray.length - 1 ? operatorList.fnArray[index + 1] : null;
        const nextOp = nextOperator ? operatorNames[nextOperator] || `Unknown (${nextOperator})` : null;

        if (fn === pdfjsLib.OPS.transform) {
            origin = [args[4], args[5]];
        }

        // Detect images
        if (fn === pdfjsLib.OPS.paintImageXObject) {
            const transformArgs = operatorList.argsArray[index - 2];
            rectangles.push({
                x0: transformArgs[4],
                y0: transformArgs[5],
                x1: transformArgs[4] + transformArgs[0],
                y1: transformArgs[5] + transformArgs[3],
                type: `paintImageXObject (#${index})`,
                nextOp: nextOp
            });
        }

        function addRectangle(args, move = [0, 0]) {
            rectangles.push({
                x0: origin[0] + move[0] + args[0],
                y0: origin[1] + move[1] + args[1],
                x1: origin[0] + move[0] + args[0] + args[2],
                y1: origin[1] + move[1] + args[1] + args[3],
                type: `transform (#${index})`,
                nextOp: nextOp
            });
        }

        if (fn === pdfjsLib.OPS.rectangle) {
            addRectangle(args);
        }

        if (fn === pdfjsLib.OPS.constructPath) {

            const operators = args[0]; // Contains the operator data
            const pathArgs = args[1]; // Contains the path data

            if (operators[0] === 13 && operators[1] === 19) {
                const move = [pathArgs[0], pathArgs[1]];
                addRectangle(pathArgs.slice(2), move);
            } else if (operators[1] === 19) {
                addRectangle(pathArgs.slice(0, 4));
            }
        }
    });

    rectangles = normaliseRectangles(rectangles, viewport);

    // Keep rectangles within 10% - 90% of the crop area
    const cropArea = (cropRange.x[1] - cropRange.x[0]) * (cropRange.y[1] - cropRange.y[0]);
    rectangles = rectangles.filter(rect => rect.area > 0.1 * cropArea && rect.area < 0.9 * cropArea);

    // Filter out rectangles outside the crop range
    rectangles = rectangles.filter(rect => {
        return rect.left >= cropRange.x[0] && rect.right <= cropRange.x[1] &&
            rect.top >= cropRange.y[0] && rect.bottom <= cropRange.y[1];
    });

    // Sort rectangles by area in descending order
    rectangles.sort((rect1, rect2) => rect2.area - rect1.area);

    // Filter out rectangles wholly within other rectangles which are not images
    rectangles = rectangles.filter((rect1, i) => {
        // Check if rect1 is within any other rect
        return !rectangles.some((rect2, j) => {
            return (
                i !== j && // Make sure we're not comparing the same rectangle
                rect1.top >= rect2.top &&
                rect1.left >= rect2.left &&
                rect1.bottom <= rect2.bottom &&
                rect1.right <= rect2.right &&
                !rect1.type.startsWith('paintImageXObject') // Exclude images
            );
        });
    });

    // Process intersections and return the final list of rectangles
    return processRectangles(rectangles);
}

// Function to check if two rectangles intersect
function intersects(rect1, rect2) {
    return (
        rect1.left < rect2.right &&
        rect1.right > rect2.left &&
        rect1.top < rect2.bottom &&
        rect1.bottom > rect2.top
    );
}


function normaliseRectangles(rectangles, viewport) {
    return rectangles.map(rect => {
        // Swap y-coordinates if they’re in reverse order
        if (rect.y0 > rect.y1) [rect.y0, rect.y1] = [rect.y1, rect.y0];
        if (rect.x0 > rect.x1) [rect.x0, rect.x1] = [rect.x1, rect.x0];

        // Transform to top-down coordinates
        const top = viewport.height - rect.y1; // Convert y1 to top-down
        const bottom = viewport.height - rect.y0; // Convert y0 to top-down

        return {
            top,
            left: rect.x0,
            bottom,
            right: rect.x1,
            width: rect.x1 - rect.x0,
            height: bottom - top,
            area: (rect.x1 - rect.x0) * (bottom - top),
            type: rect.type,
        };
    });
}

// Main function to process rectangles
function processRectangles(rectangles) {
    const intersectingRectangles = [];
    const nonIntersectingRectangles = [];

    // Sort rectangles into intersecting and non-intersecting arrays
    for (let i = 0; i < rectangles.length; i++) {
        const rect1 = rectangles[i];
        let hasIntersection = false;

        for (let j = 0; j < rectangles.length; j++) {
            if (i !== j) {
                const rect2 = rectangles[j];

                // Check if rect1 intersects with rect2
                if (intersects(rect1, rect2)) {
                    hasIntersection = true;
                    break; // No need to check further if an intersection is found
                }
            }
        }

        // Add to appropriate array
        if (hasIntersection) {
            intersectingRectangles.push(rect1);
        } else {
            nonIntersectingRectangles.push(rect1);
        }
    }

    // Calculate intersections for the intersecting rectangles
    const intersectionResults = [];

    for (let i = 0; i < intersectingRectangles.length; i++) {
        const rect1 = intersectingRectangles[i];

        for (let j = i + 1; j < intersectingRectangles.length; j++) {
            const rect2 = intersectingRectangles[j];
            const intersection = calculateIntersection(rect1, rect2);

            if (intersection) {
                intersectionResults.push(intersection);
            }
        }
    }

    // Combine non-intersecting rectangles with the intersections
    return [...nonIntersectingRectangles, ...intersectionResults];
}

// Function to calculate intersection of two rectangles
function calculateIntersection(rect1, rect2) {
    const intersectTop = Math.max(rect1.top, rect2.top);
    const intersectLeft = Math.max(rect1.left, rect2.left);
    const intersectBottom = Math.min(rect1.bottom, rect2.bottom);
    const intersectRight = Math.min(rect1.right, rect2.right);

    // Only return a valid intersection if it exists
    if (intersectTop < intersectBottom && intersectLeft < intersectRight) {
        return {
            top: intersectTop,
            left: intersectLeft,
            bottom: intersectBottom,
            right: intersectRight,
            width: intersectRight - intersectLeft,
            height: intersectBottom - intersectTop,
            area: (intersectRight - intersectLeft) * (intersectBottom - intersectTop),
            x0: Math.max(rect1.x0, rect2.x0),
            y0: Math.max(rect1.y0, rect2.y0),
            x1: Math.min(rect1.x1, rect2.x1),
            y1: Math.min(rect1.y1, rect2.y1),
            type: `${rect1.type} + ${rect2.type}`,
            nextOp: `${rect1.nextOp} + ${rect2.nextOp}`
        };
    }
    return null; // No valid intersection
}


// Function to extract rectangles from operator list
function findRectangles(operatorList, viewport, printExtent, embeddedImages) {
    let rectangles = [];
    let origin = [0, 0];

    // listOperators(operatorList);

    operatorList.fnArray.forEach((fn, index) => {
        const args = operatorList.argsArray[index];

        const nextOperator = index < operatorList.fnArray.length - 1 ? operatorList.fnArray[index + 1] : null;
        const nextOp = nextOperator ? operatorNames[nextOperator] || `Unknown (${nextOperator})` : null;

        if (fn === pdfjsLib.OPS.transform) {
            origin = [args[4], args[5]];
        }

        function addRectangle(args, move = [0, 0]) {
            console.warn('Adding rectangle:', args);
            rectangles.push({
                x0: origin[0] + move[0] + args[0],
                y0: origin[1] + move[1] + args[1],
                x1: origin[0] + move[0] + args[0] + args[2],
                y1: origin[1] + move[1] + args[1] + args[3],
                type: `transform (#${index})`,
                nextOp: nextOp
            });
        }

        if (fn === pdfjsLib.OPS.rectangle) {
            addRectangle(args);
        }

        if (fn === pdfjsLib.OPS.constructPath) {

            const operators = args[0]; // Contains the operator data
            const pathArgs = args[1]; // Contains the path data

            if (operators[0] === 13 && operators[1] === 19) {
                const move = [pathArgs[0], pathArgs[1]];
                addRectangle(pathArgs.slice(2), move);
            } else if (operators[1] === 19) {
                addRectangle(pathArgs.slice(0, 4));
            } else if (operators.includes(19)) {
                if (operators.length === 1 && pathArgs[2] > 450 && pathArgs[2] < 460) {
                    // console.error(`Missed Rectangle ${index}:`, operators, args);
                }
            }
        }
    });

    rectangles = normaliseRectangles(rectangles, viewport);

    console.log('rectangles:',structuredClone(rectangles));

    // Remove invisible rectangles
    rectangles = rectangles.filter(rect => rect.left >= printExtent[0] && rect.right <= printExtent[2] &&
        rect.top >= printExtent[1] && rect.bottom <= printExtent[3]);

    console.log('rectangles:',structuredClone(rectangles));

    // Sort rectangles by area in descending order
    rectangles.sort((rect1, rect2) => rect2.area - rect1.area);

    // Filter out rectangles which contain embedded images and are within +10% of the image area
    rectangles = rectangles.filter(rect => {
        return !embeddedImages.some(image => {
            return (
                rect.left >= image.left &&
                rect.right <= image.right &&
                rect.top >= image.top &&
                rect.bottom <= image.bottom &&
                rect.area < 1.1 * image.area
            );
        });
    });

    return rectangles;
}




// Step 1: Tag each row as line, text, or blank based on non-zero pixel count
let minLineWidth = Math.floor((rightMargin - leftMargin) * minLineWidthRatio);
for (let y = 0; y < mat.rows; y++) {
    const rowNonZero = cv.countNonZero(mat.row(y));
    rowTags.push(rowNonZero >= minLineWidth ? 'line' : rowNonZero > 0 ? 'text' : 'blank');
}

// Step 2: Mark up to maxTextLineSeparation contiguous blanks between text rows as text rows
for (let i = 1; i < rowTags.length - 1; i++) {
    if (rowTags[i] === 'blank') {
        let blanks = 1;
        // Count contiguous blanks
        while (i + blanks < rowTags.length && rowTags[i + blanks] === 'blank') blanks++;

        // Check if blanks are surrounded by text rows
        if (blanks <= maxTextLineSeparation && rowTags[i - 1] === 'text' && rowTags[i + blanks] === 'text') {
            for (let j = 0; j < blanks; j++) rowTags[i + j] = 'text'; // Mark blanks as text
        }

        // Skip ahead by the number of blanks processed
        i += blanks - 1;
    }
}

// Step 3: Detect row boundaries based on transitions between blank and non-blank rows
let start = 0;
let inNonBlankSegment = rowTags[0] !== 'blank';
for (let y = 1; y < rowTags.length; y++) {
    const isBlank = rowTags[y] === 'blank';


    if (isBlank !== inNonBlankSegment) {
        // Log boundary when switching between blank and non-blank rows
        if (!isBlank) {
            start = y; // Start of a new non-blank segment
        } else {
            rowBoundaries.push([start, y - 1]); // End of a non-blank segment
        }
        inNonBlankSegment = !isBlank;
    }
}

// Step 4: Detect lines based on tagged rows
start = 0;
currentTag = rowTags[0];
for (let y = 1; y <= rowTags.length; y++) {
    if (y === rowTags.length || rowTags[y] !== currentTag) {
        // End of a contiguous segment
        if (currentTag === 'line') { // Save lineItem
            lineItems.push({ top: topOffset + start, left: leftOffset + leftMargin, height: y - start, width: rightMargin - leftMargin + 1, bottom: topOffset + y - 1, right: leftOffset + rightMargin + 1, tableLine: true, fontName: 'line', str: '' });
        }
        // Start a new segment
        start = y;
        currentTag = rowTags[y] ?? 'blank';
    }
}
