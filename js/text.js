// /js/text.js
// Description: Contains functions for extracting text from PDFs.


async function processItems(pageNum, defaultFont, footFont, maxEndnote, pdf) {
    let items = JSON.parse(LZString.decompressFromUTF16(localStorage.getItem(`page-${pageNum}-items`)));
    const segments = JSON.parse(localStorage.getItem(`page-${pageNum}-segments`));
    const drawingBorders = JSON.parse(localStorage.getItem(`page-${pageNum}-drawingBorders`));
    const viewport = JSON.parse(localStorage.getItem(`page-${pageNum}-viewport`));

    const segmentation = segments.segmentation;
    const page = await pdf.getPage(pageNum);
    const drawings = drawingBorders ? await extractDrawingsAsBase64(page, viewport, drawingBorders) : [];

    // Release localStorage memory
    localStorage.removeItem(`page-${pageNum}-items`);
    localStorage.removeItem(`page-${pageNum}-viewport`);
    
    // Identify rows for each item and tally font types in the bottom row
    const bottomRow = segmentation.length - 1;
    let defaultFontArea = 0;
    let footFontArea = 0;
    items.forEach(item => {
        item.row = segmentation.findIndex(row => item.top <= row.range[1]);
        if (item.row === bottomRow) {
            if (item.fontName === footFont.fontName && item.height === footFont.fontSize) {
                footFontArea += item.area;
            } else if (item.fontName === defaultFont.fontName && item.height === defaultFont.fontSize) {
                defaultFontArea += item.area;
            }
        }
    })

    // Split off bottom row if it contains footnotes
    let footnotes = [];
    if (footFontArea > defaultFontArea) {
        footnotes = items.filter(item => item.row === bottomRow);
        items = items.filter(item => item.row !== bottomRow);
    }
    console.log(`Page ${pageNum} row ${bottomRow} - footnotes: ${footnotes.length}:`, footnotes);

    // Discard any invisible items above visible text in row 0 (e.g. hidden headers)
    items = items.filter(item => item.row > 0 || item.bottom > segmentation[0].range[0]);

    // Split off header
    let pageNumeral = '(unidentified)';
    if (segmentation[0].height < 12 && segmentation[0].columns.length > 1) { // Assume header if first row is less than 12 pixels high
        const headerItems = items.filter(item => item.row === 0);
        // Sort header items into columns
        headerItems.forEach(item => {
            item.column = segmentation[0].columns.findIndex(column => item.left <= column.range[1]);
        });
        console.log(`Page ${pageNum} - header items: ${headerItems.length}:`, headerItems);
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
        items = items.filter(item => item.row !== 0);
    }

    console.log(`Page ${pageNum} - items: ${items.length}:`, items);

    // Assign columns and lines to each item, and sort into reading order
    try {
        items.forEach((item, index) => {
            try {
                item.column = segmentation[item.row].columns.findIndex(column => item.left <= column.range[1]);
                item.line = segmentation[item.row].columns[item.column].lines.findIndex(line => item.top <= line[1]);
                item.innerRow = segmentation[item.row].columns[item.column].innerRows.findIndex(innerRow => item.top <= innerRow.range[1]);
            }
            catch (error) {
                console.error(`Error assigning columns and lines to item ${index} on page ${pageNum}:`, item, error);
                throw error;
            }
        });
    }
    catch (error) {
        console.error(`Error assigning columns and lines to items on page ${pageNum}:`, error);
        throw error;
    }
    items.sort((a, b) => a.row - b.row || a.column - b.column || a.line - b.line || a.left - b.left);

    // Initialise set to store found footnote numbers
    let foundFootnoteIndices = new Set();
    items.forEach((item, index) => {
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

    processFootnotes(segmentation[bottomRow], footnotes, pageNum, pageNumeral, maxEndnote, foundFootnoteIndices);
    // footnotes = null;

    // Identify paragraph ends
    const tolerance = 5;

    function isSameBlock(item, reference) {
        return item?.row === reference?.row && item?.column === reference?.column;
    }

    items.forEach((item, index) => {
        const nextItem = items[index + 1];
        const prevItem = items[index - 1];

        item.isPreviousItemSameLine = prevItem?.line === item.line && isSameBlock(prevItem, item);
        item.isItemAtLineEnd = item.right + tolerance > segmentation[item.row].columns[item.column][1];
        item.isItemIndented = item.left - tolerance > segmentation[item.row].columns[item.column][0] && !item.isPreviousItemSameLine;

        item.isNextItemInRow = nextItem?.row === item.row;
        item.isNextItemSameLine = nextItem?.line === item.line && isSameBlock(nextItem, item);
        item.isNextItemTabbed = item.isNextItemSameLine && nextItem?.left - 2 * tolerance > item.right;
        item.isNextItemIndented = nextItem?.left - tolerance > segmentation[item.row].columns[item.column][0] && !item.isNextItemSameLine;
        item.isMidCaption = items.filter(i => isSameBlock(i, item))[0]?.fontName === 'drawing' && item.italic && nextItem?.italic;

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

    appendLogMessage(`=== Page ${pageNum} Rows ===`);
    appendLogMessage(`Row Ranges: ${JSON.stringify(segmentation.map(row => row.range))}`);

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


function processFootnotes(segmentation, footnotes, pageNum, pageNumeral, maxEndnote, foundFootnoteIndices) {

    footnotes.forEach((item, index) => {
        item.column = segmentation.columns.findIndex(column => item.left <= column.range[1]);
        item.line = segmentation.columns[item.column].lines.findIndex(line => item.top <= line[1]);
        item.footnote = true;
    });

    // Sort footnotes in reading order based on row and column (allow tolerance in bottom)
    footnotes.sort((a, b) => a.column - b.column || a.line - b.line || a.left - b.left);

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
