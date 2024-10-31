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
    const items = JSON.parse(LZString.decompressFromUTF16(localStorage.getItem(`page-${pageNum}-items`)));
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
    let nextFootnoteNumber = 0;
    items.forEach((item, index) => {
        item.row = rows.findIndex(row => item.top >= row.range[0] && item.bottom <= row.range[1]);
        // If row is columnised, find the column
        if (rows[item.row]?.columnised) {
            item.column = columnRanges.findIndex(column => item.left >= column[0] && item.right <= column[1]);
        }
        // Footnote Indices: Normalise attributes of integer superscript items (assumes that item and previous item are rendered in reading order)
        if (item.bottom < items[index - 1]?.bottom && /^\d+$/.test(item.str)) {
            item.footIndex = true;
            item.bottom = items[index - 1].bottom; // Required for sorting
            item.height = items[index - 1].height; // Required for merging
            item.fontName = items[index - 1].fontName; // Required for merging
        }
        // Drawing Numbers: integer items with a period mark and with the same bottom as the next item
        if (item.bottom === items[index + 1]?.bottom && /^\d+.$/.test(item.str)) {
            item.drawingNumber = true;
        }
        // Footnotes
        if (item.fontName === footFont.fontName && item.height === footFont.fontSize && item.row === rows.length - 2) {
            item.footnote = true;
            if (item.str.endsWith('.')) {
                item.paragraph = true;
            }
            // Identify footnote numbers
            const initialNumber = item.str.match(/^\d+(\s|$)/);
            if ((items[index - 1]?.footnote !== true || items[index - 1]?.paragraph === true) && initialNumber) {
                item.footNumber = true;
            }
            if (initialNumber) {
                nextFootnoteNumber = parseInt(initialNumber) + 1;
            }
            // Identify shared-line footnotes by searching for the next number
            const match = item.str.match(`(\\.\\s{3,})(${nextFootnoteNumber})`);
            if (match) {
                item.str = item.str.replace(match[0], `.@@@${match[2]}`);
                item.splitFootnote = true;
            }
        }
    });

    // Sort items in reading order based on row and column (allow tolerance in bottom)
    items.sort((a, b) => a.row - b.row || a.column - b.column || a.bottom - b.bottom + b.height / 2 || a.left - b.left);

    /////////////////////////////
    // FOOTNOTES -> ENDNOTES
    /////////////////////////////

    // Split footnote items from main text items
    const firstFootnoteIndex = items.findIndex(item => item.footnote);
    let footnotes = [];
    if (firstFootnoteIndex !== -1) {
        footnotes = items.slice(firstFootnoteIndex);
        items.splice(firstFootnoteIndex);
    }

    processFootnotes(footnotes, pageNum, maxEndnote);

    // Release footnotes from memory
    footnotes = null;

    /////////////////////////////
    // MAIN TEXT
    /////////////////////////////

    // Identify paragraph ends and line-end hyphenations
    items.forEach((item, index) => {
        const thisBlockItems = items.filter(i => i.row === item.row && i.column === item.column);
        const isNextItemInRow = items[index + 1]?.row === item.row;
        const isNextItemSameLine = items[index + 1]?.bottom < item.bottom + item.height / 2;
        const isNextItemTabbed = isNextItemSameLine && items[index + 1]?.left - 1 > item.right;
        const isItemAtLineEnd = item.right + 1 > Math.max(...thisBlockItems.map(i => i.right));
        const isNextItemIndented = items[index + 1]?.bottom >= item.bottom + item.height && items[index + 1]?.left - 1 > Math.min(...thisBlockItems.map(i => i.left));
        if (
            !isNextItemInRow ||
            isNextItemIndented ||
            (item.str?.endsWith('.') && !isItemAtLineEnd && !isNextItemSameLine) ||
            item.bold ||
            (item.italic && !isNextItemSameLine) ||
            (item.italic && isNextItemTabbed)
        ) {
            item.paragraph = true;
        }

        if (item.str?.endsWith('-') && isItemAtLineEnd) {
            item.str = item.str.slice(0, -1);
            item.hyphenated = true;
        }
    });

    // Merge consecutive items which share font, italic, bold, and capital properties, and if the first item is not a paragraph end
    const properties = ['row', 'column', 'fontName', 'height', 'header', 'italic', 'bold'];
    for (let i = items.length - 1; i > 0; i--) { // Start from the end and move to the beginning
        const currentItem = items[i];
        const previousItem = items[i - 1];

        // Check if previousItem exists and both items have all required properties
        if (!previousItem.paragraph) {
            // Merge if all properties match and the previous item is not a paragraph end
            if (properties.every(prop => currentItem[prop] === previousItem[prop])) {
                const joint = previousItem.hyphenated ? '<span class="line-end-hyphen">-</span>' : currentItem.footIndex ? '' : ' ';
                previousItem.str = `${previousItem.str}${joint}${currentItem.str}`;
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

    wrapStrings(items);

    // Repeat merging of consecutive items until no more merges are possible
    // let merged = true;
    // while (merged) {
    //     merged = false;
    //     for (let i = items.length - 1; i > 0; i--) { // Start from the end and move to the beginning
    //         const currentItem = items[i];
    //         const previousItem = items[i - 1];
    //         if (!previousItem.paragraph) {
    //             previousItem.str += ' ' + currentItem.str;
    //             if (currentItem.paragraph) {
    //                 previousItem.paragraph = true;
    //             }
    //             items.splice(i, 1); // Remove the current item after merging
    //             merged = true;
    //         }
    //     }
    // }

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
            pageHTML += `<div>${item.str}</div>`;
        }
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

    return [maxEndnote, pageHTML];
}


function processFootnotes(footnotes, pageNum, maxEndnote) {

    // Split footnotes tagged with splitFootnote
    for (let i = footnotes.length - 1; i >= 0; i--) { // Start from the end and move to the beginning
        const item = footnotes[i];

        if (item.splitFootnote === true) {
            const [first, second] = item.str.split('@@@');
            item.str = first;

            // Create a new item with the second part of the string
            const newItem = {...item, str: second};
            newItem.footNumber = true;

            // Insert the new item into the original footnotes array right after the current item
            footnotes.splice(i + 1, 0, newItem);

            // Mark the current item as a paragraph
            item.paragraph = true;
        }
    }
    // Fix footnote numbers split by a rogue space, then split numbers into separate items
    for (let i = footnotes.length - 1; i >= 0; i--) { // Start from the end and move to the beginning
        const item = footnotes[i];

        if (item.footNumber === true) {
            if (item.str.match(/^\d\s\d/)) {
                item.str = item.str.replace(/^(\d)\s(\d)/, '$1$2');
            }

            // Use regex to match leading digits and keep the rest of the string
            const match = item.str.match(/^(\d+)(.*)/); // Match leading digits and everything else
            if (match) {
                // Set item.str to only the leading digits (keep the digits)
                item.str = match[1].trim(); // Keep just the digits and trim any whitespace

                // Create a new item with the rest of the text after the digits
                const newItem = {
                    ...item,
                    str: match[2].trim(), // The rest of the string after the digits
                    footNumber: false // Set footNumber to false for the new item
                };

                // Insert the new footnote into the original footnotes array right after the current item
                footnotes.splice(i + 1, 0, newItem);
            }
        }
    }

    // Find footnote indices and increment endnote numbers
    footnotes.filter(item => item.footIndex === true).forEach((item, index) => {
        // find matching footnote
        const footnote = footnotes.find(footnote => footnote.footnote === true && footnote.str === item.str);
        maxEndnote++;
        const footnoteIndex = item.str
        item.str = `<sup data-footnote-index="${footnoteIndex}" data-endnote-index="${maxEndnote}">${maxEndnote}</sup>`;
        if (footnote) {
            footnote.str = `<span data-footnote-index="${footnoteIndex}" data-endnote="${maxEndnote}">${maxEndnote}</span>`;
        } else {
            console.error(`Page ${pageNum}: footnote not found for index ${footnoteIndex} (${maxEndnote})`);
            item.str += '/??/'
        }
    });

    wrapStrings(footnotes);

    // Merge footnotes with the previous item if they don't have a footnumber
    for (let i = footnotes.length - 1; i > 0; i--) { // Start from the end and move to the beginning
        const currentItem = footnotes[i];
        const previousItem = footnotes[i - 1];
        if (!currentItem.footnumber) {
            previousItem.str += ' ' + currentItem.str;
            previousItem.footnote = true;
            footnotes.splice(i, 1); // Remove the current item after merging
        }
    }

    trimStrings(footnotes);

    localStorage.setItem(`page-${pageNum}-footnotes`, LZString.compressToUTF16(JSON.stringify(footnotes)));

}
