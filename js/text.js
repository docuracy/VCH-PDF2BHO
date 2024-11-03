// /js/text.js
// Description: Contains functions for extracting text from PDFs.


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


function dehyphenate(item, nextItem) {
    if (item.str.endsWith('-') && ((item.right + 1 > nextItem.left) || (item.column < nextItem.column))) {
        item.str = item.str.slice(0, -1) + '<span class="line-end-hyphen" data-bs-title="Hyphen found at the end of a line - will be removed from XML." data-bs-toggle="tooltip">-</span>';
    } else if ((!nextItem.footIndex) && (!nextItem.str.startsWith(')'))) {
        item.str += ' ';
    }
    item.str += nextItem.str;
}


function mergeItems(items, properties) {
    for (let i = items.length - 1; i > 0; i--) { // Start from the end and move to the beginning
        const currentItem = items[i];
        const previousItem = items[i - 1];
        if (!previousItem.paragraph) {
            // Merge if all properties match and the previous item is not a paragraph end
            if (properties.every(prop => currentItem[prop] === previousItem[prop])) {
                dehyphenate(previousItem, currentItem);
                if (currentItem.paragraph) {
                    previousItem.paragraph = true;
                }
                delete previousItem.area;
                delete previousItem.right;
                delete previousItem.width;
                items.splice(i, 1); // Remove the current item after merging
            }
        }
    }
}


function processFootnotes(rows, columnRanges, footnotes, pageNum, pageNumeral, maxEndnote, foundFootnoteIndices) {

    footnotes.forEach((item, index) => {
        item.row = rows.findIndex(row => item.top >= row.range[0] && item.bottom <= row.range[1]);
        // If row is columnised, find the column
        if (rows[item.row]?.columnised) {
            item.column = columnRanges.findIndex(column => item.left >= column[0] && item.right <= column[1]);
        }
        item.footnote = true;
    });

    // Sort footnotes in reading order based on row and column (allow tolerance in bottom)
    footnotes.sort((a, b) => a.row - b.row || a.column - b.column || a.bottom - b.bottom + b.height / 2 || a.left - b.left);

    // Split footnotes if they include an integer after three or more spaces
    for (let i = footnotes.length - 1; i >= 0; i--) { // Start from the end and move to the beginning
        const item = footnotes[i];
        const match = item.str.match(/\s{3,}(\d+)/);
        if (match) {
            const [first, second] = item.str.split(match[0]);
            item.str = first;
            // Create a new item with the second part of the string
            const newItem = {...item, str: (match[0] + second).trim()};
            // Insert the new item into the original footnotes array right after the current item
            footnotes.splice(i + 1, 0, newItem);
        }
    }

    // Sort foundFootnoteIndices in ascending order
    foundFootnoteIndices = Array.from(foundFootnoteIndices).sort((a, b) => a - b);

    // console.log(structuredClone(footnotes));
    // console.log(foundFootnoteIndices);

    // Iterate through foundFootnoteIndices and match them in footnotes array
    let footnoteCursor = 0;
    foundFootnoteIndices.forEach(footnoteIndex => {
        const indexToFind = footnoteIndex.toString().split('').join('\\s*'); // Pattern for spaced digits
        const indexPattern = new RegExp(`^(${indexToFind})(\\s|$)`); // Start of string match

        while (footnoteCursor < footnotes.length) {
            const footnoteText = footnotes[footnoteCursor].str;

            // console.log(`Looking for ${footnoteIndex} in "${footnoteText}"`);

            // Check for footnoteIndex at the start of the string
            if (footnoteText.match(indexPattern)) {
                footnotes[footnoteCursor].footNumber = footnoteIndex;
                footnotes[footnoteCursor].str = footnoteText.replace(indexPattern, footnoteIndex + ' ').trim();
                footnoteCursor++; // Move the cursor to avoid rechecking this item
                break; // Exit while loop to move to the next index in foundFootnoteIndices
            }

            footnoteCursor++;
        }
    });

    // Identify any foundFootnoteIndices that are not foundFootnoteNumbers
    foundFootnoteNumbers = new Set(footnotes.map(item => item.footNumber));
    const missingFootnoteNumbers = [...foundFootnoteIndices].filter(index => !foundFootnoteNumbers.has(index));
    if (missingFootnoteNumbers.length) {
        console.error(`Page ${pageNumeral} (PDF ${pageNum}): missing footnotes ${missingFootnoteNumbers.join(', ')}`);
    }

    wrapStrings(footnotes);

    // Merge footnotes with the previous item if they don't have a footNumber
    for (let i = footnotes.length - 1; i > 0; i--) { // Start from the end and move to the beginning
        const currentItem = footnotes[i];
        const previousItem = footnotes[i - 1];
        if (!currentItem.footNumber) {
            dehyphenate(previousItem, currentItem);
            footnotes.splice(i, 1); // Remove the current item after merging
        }
    }

    // Replace footnote numbers with endnote numbers
    footnotes.forEach((item, index) => {
        item.endnoteNumber = maxEndnote + item.footNumber;
        const regex = new RegExp(`^${item.footNumber}`);
        if (regex.test(item.str)) {
            item.str = item.str.replace(regex, `<a id="endnote${item.endnoteNumber}" href="#endnoteIndex${item.endnoteNumber}" data-footnote="${item.footNumber}" data-endnote="${item.endnoteNumber}" title="p.${pageNumeral} fn.${item.footNumber}">${item.endnoteNumber}</a>`);
        }
    });

    trimStrings(footnotes);

    localStorage.setItem(`page-${pageNum}-footnotes`, LZString.compressToUTF16(JSON.stringify(footnotes)));

}
