// /js/text.js
// Description: Contains functions for extracting text from PDFs.


async function processItems(pageNum, defaultFont, footFont, maxEndnote, pdf, pageNumeral, isIndex, isNewPageNumeral = true) {

    console.info(`Processing page ${pageNum}...`);

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

    // Loop backwards to remove empty items
    for (let i = items.length - 1; i >= 0; i--) {
        if (!items[i].str && items[i].fontName !== 'drawing' && items[i].fontName !== 'line') {
            items.splice(i, 1);
        }
    }

    // Loop backwards to merge trailing hyphens
    for (let i = items.length - 1; i > 0; i--) {
        if (items[i].str === '-') {
            items[i - 1].str = items[i - 1].str + '-';
            items.splice(i, 1);
        }
    }

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

    escapeStrings(items); // Assumed global function

    // Split off bottom row if it contains footnotes
    let footnotes = [];
    if (footFontArea > defaultFontArea) {
        footnotes = items.filter(item => item.row === bottomRow);
        items = items.filter(item => item.row !== bottomRow);
    }
    console.debug(`Page ${pageNum} row ${bottomRow} - footnotes: ${footnotes.length}:`, footnotes);

    // Discard any invisible items above visible text in row 0 (e.g. hidden headers)
    items = items.filter(item => item.row > 0 || item.bottom > segmentation[0].range[0]);

    // Split off header (items already analysed and pageNumeral extracted in `storePageData`)
    if (segmentation[0].height < 12 && segmentation[0].columns.length > 1) { // Assume header if first row is less than 12 pixels high
        items = items.filter(item => item.row !== 0);
    }

    // Assign columns and lines to each item, and sort into reading order
    try {
        items.forEach((item, index) => {
            try {
                // Find the column index where the item's left boundary falls within the column range
                item.column = segmentation[item.row].columns.findIndex(column => item.left <= column.range[1]);

                // Check if item.column was found
                if (item.column !== -1) {
                    // Find the line index where the item's middle falls within the line range
                    item.line = segmentation[item.row].columns[item.column].lines.findIndex(line => item.top + item.height / 2 <= line[1]);

                    // Find the innerRow index where the item's middle falls within the innerRow range
                    item.innerRow = segmentation[item.row].columns[item.column].innerRows?.findIndex(innerRow => item.top + item.height / 2 <= innerRow.range[1]) ?? -1;

                    // Find a subColumn index where the item's left boundary falls within the subColumn range
                    const tabular = segmentation[item.row].columns[item.column].innerRows[item.innerRow]?.subColumns.length >= 3;
                    if (tabular) {
                        item.subColumn = segmentation[item.row].columns[item.column].innerRows[item.innerRow].subColumns.findIndex(subColumn => item.left <= subColumn[1]);
                    }
                }
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
    items.sort((a, b) =>
        a.row - b.row ||
        a.column - b.column ||
        a.line - b.line ||
        a.left - b.left
    );

    console.debug(`Page ${pageNum} - segmentation:`, structuredClone(segmentation));
    console.debug(`Page ${pageNum} - items pre-overlap: ${items.length}:`, structuredClone(items));

    // if (!isIndex) closeOverlaps(items);

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
            item.drawingNumber = item.str.slice(0, -1);
        }
    });

    await processFootnotes(segmentation[bottomRow], footnotes, pageNum, pageNumeral, maxEndnote, foundFootnoteIndices);
    // footnotes = null;

    // Identify paragraph ends
    const tolerance = 5;
    let indexRow = 1000000;

    function isSameBlock(item, reference) {
        return item?.row === reference?.row && item?.column === reference?.column;
    }

    items.forEach((item, index) => {
        const nextItem = items[index + 1];
        const prevItem = items[index - 1];

        item.isPreviousItemSameLine = prevItem?.line === item.line && isSameBlock(prevItem, item);
        item.isPreviousFullStop = prevItem?.str.endsWith('.');
        item.isPreviousItemMidCaption = prevItem?.isMidCaption;

        item.isItemAtLineEnd = item.right + tolerance > (segmentation[item.row].columns[item.column]?.range[1] ?? 'Infinity');
        item.isItemIndented = item.left - tolerance > (segmentation[item.row].columns[item.column]?.range[0] ?? 'Infinity') && !item.isPreviousItemSameLine;
        item.isItalic = item.italic || item.str.startsWith('<em>') || item.str.startsWith('<i>');

        item.isNextItemInRow = nextItem?.row === item.row && nextItem?.innerRow === item.innerRow;
        item.isNextItemInColumn = nextItem?.column === item.column;
        item.isNextItemSameLine = nextItem?.line === item.line && isSameBlock(nextItem, item);
        item.isNextItemTabbed = item.isNextItemSameLine && nextItem?.left - 2 * tolerance > item.right;
        item.isNextItemIndented = nextItem?.left - tolerance > (segmentation[nextItem?.row]?.columns[nextItem?.column]?.range[0] ?? 'Infinity') && !item.isNextItemSameLine;
        item.isNextItemItalic = nextItem?.italic || nextItem?.str.startsWith('<em>') || nextItem?.str.startsWith('<i>');
        item.isNextItemFootindex = nextItem?.footIndex;

        item.isMidCaption =
            (['drawing', 'line'].includes(items.filter(i => isSameBlock(i, item))[0]?.fontName) || (item.isPreviousItemSameLine && prevItem?.drawingNumber) || item.isPreviousItemMidCaption) &&
            item.isItalic && item.isNextItemItalic;
        item.isItemFootindex = item?.footIndex;

        // Define paragraph conditions with identifiers
        const paragraphConditions = [
            { id: '!indented!midCaption|indented!footIndex', check: !item.isNextItemFootindex && item.isNextItemIndented && !item.isMidCaption && !item.isItemIndented },
            { id: 'endsPeriod!lineEnd!midCaption|!sameLine!footIndex', check: (item.str?.endsWith('.') || (item.isPreviousFullStop && item.isItemFootindex)) && !item.isItemAtLineEnd && !item.isNextItemSameLine && !item.isMidCaption && !item.isNextItemFootindex },
            { id: 'bold|!bold', check: item.bold && !nextItem?.bold },
            { id: 'indented&italic!midCaption|!sameLine', check: item.isItemIndented && item.isItalic && !item.isNextItemSameLine && !item.isMidCaption },
            { id: 'italic|tabbed!sameLine', check: item.isItalic && item.isNextItemTabbed && !item.isNextItemSameLine },
            { id: '!titleCase|titleCase', check: !item?.titleCase && nextItem?.titleCase },
            { id: 'titleCase|!titleCase', check: item?.titleCase && !nextItem?.titleCase },
            { id: '-|sameColumn!sameRow', check: !item.isNextItemInRow && item.isNextItemInColumn }
        ];

        // Check each condition and set the paragraph property if a match is found
        const matchedCondition = paragraphConditions.find(condition => condition.check);
        if (matchedCondition) {
            item.paragraph = matchedCondition.id;
        }

        if (isIndex) {
            const subLeft = 10;
            item.index = item.height === 8.5;
            item.entryStart = item.index && !item.isItemIndented;
            item.subStart = item.index && item.isItemIndented && !item.isPreviousItemSameLine && item.left - subLeft < (segmentation[item.row].columns[item.column]?.range[0] ?? 'Infinity');
            if (item.entryStart || item.subStart) indexRow++;
            item.row = indexRow;
        }
    });

    // Mark footnote indices for later replacement with <data> elements
    items.filter(item => item.footIndex).forEach(item => {
        const footnoteIndex = item.footIndex;
        // Use a placeholder that will be replaced with the actual data content
        item.str = `___FOOTNOTE_${footnoteIndex}___`;
        item.isFootnoteMarker = true;
    });
    console.debug(`Page ${pageNum} - items pre-merge: ${items.length}:`, structuredClone(items));

    await mergeItems(items, ['row', 'subColumns', 'fontName', 'height', 'header', 'italic', 'bold']);
    console.debug(`Page ${pageNum} - items post-merge: ${items.length}:`, structuredClone(items));

    // Identify tables
    let tabular = false;
    items.forEach((item, index) => {
        if (item?.tableLine) {
            tabular = true;
        }
        if (tabular) {
            // Check for end of table: `.str` begins with "Table \d+." or "\d+."
            if (/^(Table \d+\.|\d+\.)$/.test(item.str)) {
                tabular = false;
                item.tableHead = true;
            } else {
                item.tabular = true;
                item.tableColumn = item?.subColumn ?? item.column;
                item.columnMax = item?.subColumn ?
                    segmentation[item.row].columns[item.column].innerRows[item.innerRow].subColumns.length - 1 :
                    segmentation[item.row].columns.length - 1;
            }
        }
    });

    console.debug(`Page ${pageNum} - remaining items: ${items.length}:`, structuredClone(items));

    wrapStrings(items); // Assumed global function

    await buildTables(items);

    await mergeItems(items, ['row']);

    // Merge consecutive headers of the same level (e.g., split titles)
    for (let i = items.length - 1; i > 0; i--) {
        const currentItem = items[i];
        const previousItem = items[i - 1];

        if (currentItem.header && previousItem.header &&
            currentItem.header === previousItem.header) {
            // Merge headers of the same level
            previousItem.str += ' ' + currentItem.str;
            items.splice(i, 1);
        }
    }

    await moveTableCaptions(items);

    trimStrings(items); // Assumed global function

    // Add drawing images to items
    items.filter(item => item.fontName === 'drawing').forEach((item, index) => {
        item.str = `<img src="${drawings[index]}" />`;
    });

    console.debug(`Page ${pageNum} - pre-HTML: ${items.length}:`, structuredClone(items));

    // Log header levels found
    const headerLevels = items.filter(item => item.header).map(item => ({
        level: item.header,
        text: item.str.substring(0, 50)
    }));
    if (headerLevels.length > 0) {
        console.log(`Page ${pageNum} - Header levels found:`, headerLevels);
    }

    // =========================================================================
    // BLOCK BUILDER PIPELINE
    // =========================================================================

    // 1. CLASSIFY: Ensure every item has a distinct 'type'
    const classifiedItems = items.map(item => {
        if (item.fontName === 'drawing' || item.drawingNumber) return { ...item, type: 'FIGURE' };
        if (item.paragraph === 'table') return { ...item, type: 'TABLE' };
        if (item.index) return { ...item, type: 'INDEX' };
        if (item.header) return { ...item, type: 'HEADER', level: Math.min(item.header, 5) };
        if (item.tableHead || item.orphanCaption) return { ...item, type: 'CAPTION' };
        // Default to text
        return { ...item, type: 'TEXT' };
    });

    // 2. GROUP: Aggregate continuous items into semantic Blocks
    const blocks = [];
    let currentBlock = null;
    let pendingParagraphBreak = false;

    for (const item of classifiedItems) {
        let startNew = false;

        // Check if we need to execute a pending paragraph break from the PREVIOUS item
        // But delay the break if the current item is a footnote marker (it belongs to previous sentence)
        if (pendingParagraphBreak && !item.isFootnoteMarker) {
            startNew = true;
            pendingParagraphBreak = false; // Break executed
        }

        // Standard Block type switching
        if (!currentBlock) {
            startNew = true;
            pendingParagraphBreak = false;
        } else if (currentBlock.type !== item.type) {
            startNew = true;
            pendingParagraphBreak = false;
        }

        // Forced breaks for structural elements (Headers/Figures always start new blocks)
        if (!startNew && (item.type === 'HEADER' || item.type === 'FIGURE' || item.type === 'TABLE' || item.type === 'CAPTION')) {
            startNew = true;
            // Note: We do NOT reset pendingParagraphBreak here if we are breaking due to structure
            // effectively consuming the break.
            pendingParagraphBreak = false;
        }

        if (startNew) {
            if (currentBlock) blocks.push(currentBlock);
            currentBlock = {
                type: item.type,
                items: [item],
                // Carry over specific metadata from the first item
                level: item.level,
                entryStart: item.entryStart,
                subStart: item.subStart
            };
        } else {
            currentBlock.items.push(item);
        }

        // Set pending break if this item ENDS a paragraph (e.g. ends in a period)
        if (item.type === 'TEXT' && item.paragraph) {
            pendingParagraphBreak = true;
        }
    }
    if (currentBlock) blocks.push(currentBlock);

    // 3. RENDER: Iterate blocks to generate HTML
    let pageHTML = isNewPageNumeral
        ? `<hr class="vch-page" data-start="${pageNumeral}"/>`
        : `<hr class="vch-page" />`;

    let indexBuffer = '';

    for (const block of blocks) {
        // Flush index buffer if we are no longer processing index items
        if (block.type !== 'INDEX' && indexBuffer) {
            pageHTML += `<div class="entry">${indexBuffer}</div>`;
            indexBuffer = '';
        }

        let blockText = block.items.map(i => i.str).join(' '); // Join content within block

        switch (block.type) {
            case 'HEADER':
                if (blockText && blockText === blockText.toUpperCase() && /[A-Z]/.test(blockText)) {
                    blockText = toTitleCase(blockText);
                }

                if (block.level === 1) pageHTML += `<h2 id="title">${blockText}</h2>`;
                else if (block.level === 2) pageHTML += `<p id="subtitle">${blockText}</p>`;
                else pageHTML += `<h${block.level}>${blockText}</h${block.level}>`;
                break;

            case 'TABLE':
                // Tables are already pre-formatted HTML in .str
                pageHTML += blockText;
                break;

            case 'FIGURE':
                // Handle complex figure/caption logic
                pageHTML += `<figure>`;
                block.items.forEach(itm => {
                    if (itm.fontName === 'drawing') pageHTML += itm.str; // The <img> tag
                    else pageHTML += `<figcaption>${itm.str}</figcaption>`;
                });
                pageHTML += `</figure>`;
                break;

            case 'CAPTION':
                pageHTML += `<p class="caption">${blockText}</p>`;
                break;

            case 'INDEX':
                // Replicate specific index logic
                block.items.forEach(itm => {
                    if (itm.entryStart) {
                        if (indexBuffer) pageHTML += `<div class="entry">${indexBuffer}</div>`;
                        indexBuffer = `<div class="index-head">${normaliseIndexEntry(itm.str, true)}</div>`;
                    } else if (itm.subStart) {
                        indexBuffer += `<div class="index-sub">${normaliseIndexEntry(itm.str)}</div>`;
                    } else {
                        // Fallback or continuation
                        indexBuffer += ` ${itm.str}`;
                    }
                });
                break;

            case 'TEXT':
            default:
                pageHTML += `<p>${blockText}</p>`;
                break;
        }
    }

    // Final flush
    if (indexBuffer) {
        pageHTML += `<div class="entry">${indexBuffer}</div>`;
    }

    /////////////////////////////
    // FINALISE
    /////////////////////////////

    // Remove drawing images from items to avoid bloating localStorage
    items.filter(item => item.fontName === 'drawing').forEach(item => {
        item.str = ''; // Fixed typo: items.str to item.str
    });

    try {
        localStorage.setItem(`page-${pageNum}-items`, LZString.compressToUTF16(JSON.stringify(items)));
    } catch (error) {
        console.error('Error saving to localStorage:', error);
    }

    appendLogMessage(`=== Page ${pageNum} Rows ===`);
    appendLogMessage(`Row Ranges: ${JSON.stringify(segmentation.map(row => row.range))}`);

    maxEndnote += Math.max(...(foundFootnoteIndices.size ? foundFootnoteIndices : [0]));

    return [maxEndnote, pageHTML];
}

// Title Case Helper
// Handles small words, hyphens, and start-of-sentence logic
function toTitleCase(str) {
    const smallWords = /^(a|an|and|as|at|but|by|en|for|if|in|nor|of|on|or|per|the|to|v.?|vs.?|via)$/i;
    const wordSeparators = /([^\W_]+[^\s-]*) */g;

    return str.toLowerCase().replace(wordSeparators, function (match, index, title) {
        // Always capitalize the first word
        // Ignore small words (unless they are the first word)
        if (index > 0 && index + match.length !== title.length &&
            match.match(smallWords) && title.charAt(index - 2) !== ":" &&
            (title.charAt(index + 1).search(/[^\s-]/) < 0 || title.charAt(index - 1).search(/[^\s-]/) < 0) &&
            title.charAt(index - 1) !== "-"
        ) {
            return match.toLowerCase();
        }

        // Ignore intentional mixed-case words (e.g. "iPhone", "LaTeX")
        if (match.substr(1).search(/[A-Z]|\../) > -1) {
            return match;
        }

        // Capitalize the first letter
        return match.charAt(0).toUpperCase() + match.substr(1);
    });
}


async function dehyphenate(item, nextItem) {
    // 1. Define prefixes that usually RETAIN the hyphen
    // \b ensures we match the start of the word (avoiding things like "pyramid-")
    // The 'i' flag makes it case-insensitive (Matches "Mid-" and "mid-")
    const prefixesToKeep = /\b(mid|early|late|pre|post|non|ex|self|all|quasi|cross|counter|neo|semi|multi)-$/i;

    const isLineBreak = (item.right + 1 > nextItem.left) || (item.column < nextItem.column);

    if (item.str.endsWith('-') && isLineBreak) {
        // Check if this is a special prefix
        if (prefixesToKeep.test(item.str)) {
            // It is a prefix (e.g. "mid-").
            // Do NOT remove the hyphen.
            // Just let the function append nextItem.str at the end.
        } else {
            // It is a standard broken word (e.g. "yell- ow").
            // Remove the hyphen.
            item.str = item.str.slice(0, -1);
        }
    } else if ((!nextItem.footIndex) && (!nextItem.str.startsWith(')'))) {
        // Standard word separation (no hyphen involved) -> Add space
        item.str += ' ';
    }

    // Append the next chunk of text
    item.str += nextItem.str;
}


async function checkHyphenation(a, b) {

    b = b.replace(/<.*$/, '') // Remove any HTML tags at the end
        .replace(/\'s$/, '') // Remove possessive apostrophe-s
        .replace(/[\])}\.,;:!?\'\s]+$/, ''); // Remove any punctuation or whitespace at the end

    const timeout = 5000; // 5 seconds timeout

    // Create a promise that rejects after the timeout
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timed out')), timeout)
    );

    try {
        const response = await Promise.race([
            fetch(`https://api.datamuse.com/words?sp=${a}${b}`),
            timeoutPromise
        ]);

        // Check if the response is OK (status in the range 200-299)
        if (!response.ok) {
            console.error(`API error: ${response.status} ${response.statusText}`);
            return null; // Return null if the response is not OK
        }

        const data = await response.json();

        // Find if the hyphenated form exists in the response and get its score
        const hyphenEntry = data.find(entry => entry.word === `${a}-${b}`);
        const hyphen = hyphenEntry ? hyphenEntry.score : 0;

        const noHyphenEntry = data.find(entry => entry.word === `${a}${b}`);
        const noHyphen = noHyphenEntry ? noHyphenEntry.score : 0;

        const keepHyphen = hyphen >= noHyphen / 2; // Weight any hyphenated form

        console.debug(`Hyphenation: ${a}-${b}${keepHyphen ? '*' : ''}: ${hyphen}, ${a}${b}${keepHyphen ? '' : '*'}: ${noHyphen}`);

        return keepHyphen;
    } catch (error) {
        console.error(`Error: ${error.message}`);
        return null; // Return null if there is an error (timeout or fetch error)
    }
}


async function mergeItems(items, properties) {
    for (let i = items.length - 1; i > 0; i--) { // Start from the end and move to the beginning
        const currentItem = items[i];
        const previousItem = items[i - 1];

        // Don't merge footnote markers
        if (currentItem.isFootnoteMarker || previousItem.isFootnoteMarker) {
            continue;
        }

        if ((!currentItem.index && !previousItem.paragraph && !previousItem.tableLine) || (currentItem.index && !currentItem.entryStart && !currentItem.subStart)) {
            // Merge if all properties match
            if (properties.every(prop => (
                ((prop in currentItem && prop in previousItem) &&
                    currentItem[prop] === previousItem[prop]) || // Check that property values match if present in both items
                (!(prop in currentItem) && !(prop in previousItem)) // or that the property is missing in both items
            ))) {
                await dehyphenate(previousItem, currentItem);
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


async function processFootnotes(segmentation, footnotes, pageNum, pageNumeral, maxEndnote, foundFootnoteIndices) {

    footnotes.forEach((item, index) => {
        item.column = segmentation.columns.findIndex(column => item.left <= column.range[1]);
        // item.line = segmentation.columns[item.column].lines.findIndex(line => item.top <= line[1]); // Footnote lines are too close for this method
        item.footnote = true;
    });

    // Sort footnotes in reading order based on row and column (allow tolerance in bottom)
    // footnotes.sort((a, b) => a.column - b.column || a.line - b.line || a.left - b.left);
    footnotes.sort((a, b) => a.column - b.column || a.bottom - b.bottom || a.left - b.left);

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

    // Iterate through foundFootnoteIndices and match them in footnotes array
    let footnoteCursor = 0;
    foundFootnoteIndices.forEach(footnoteIndex => {
        const indexToFind = footnoteIndex.toString().split('').join('\\s*'); // Pattern for spaced digits
        const indexPattern = new RegExp(`^(${indexToFind})(\\s|$)`); // Start of string match

        while (footnoteCursor < footnotes.length) {
            const footnoteText = footnotes[footnoteCursor].str;

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

    wrapStrings(footnotes); // Assumed global function

    // Merge footnotes with the previous item if they don't have a footNumber
    for (let i = footnotes.length - 1; i > 0; i--) { // Start from the end and move to the beginning
        const currentItem = footnotes[i];
        const previousItem = footnotes[i - 1];
        if (!currentItem.footNumber) {
            await dehyphenate(previousItem, currentItem);
            footnotes.splice(i, 1); // Remove the current item after merging
        }
    }

    // Store endnote numbers but don't add links (XSLT will handle linking)
    footnotes.forEach((item, index) => {
        item.endnoteNumber = maxEndnote + item.footNumber;
        // Remove the footnote number from the start of the text
        const regex = new RegExp(`^${item.footNumber}\\s*`);
        item.str = item.str.replace(regex, '');
    });

    trimStrings(footnotes); // Assumed global function

    localStorage.setItem(`page-${pageNum}-footnotes`, LZString.compressToUTF16(JSON.stringify(footnotes)));

}


async function moveTableCaptions(items) {
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (item?.tableHead) {
            let tableIndex = -1;
            // Search backwards 5 items
            for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
                // The item must be a table
                if (items[j].paragraph === 'table') {
                    tableIndex = j;
                    break;
                }
            }

            if (tableIndex !== -1 && items[tableIndex].str.includes('@@@CAPTION@@@')) {
                const associatedTable = items[tableIndex];
                associatedTable.str = associatedTable.str.replace('@@@CAPTION@@@', item.str);
                items.splice(i, 1); // Remove the tableHead item after merging
            } else {
                // Flag this caption so the Block Builder knows to render it standalone
                item.orphanCaption = true;
                delete item.tableHead;
            }
        }
    }
}


async function buildTables(items) {
    let currentGroup = [];

    // Store properties of last item in the group
    let firstItem = structuredClone(items[0]);


    // Reverse pass: Group consecutive items with `tabular` property
    let spliceLength = 0;
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (item?.tableLine) {
            spliceLength++;
            continue;
        }
        if (item?.tabular) {
            currentGroup.unshift(item);
        } else {
            if (currentGroup.length > 0) {
                // Build and insert the table HTML for the current group
                spliceLength += currentGroup.length;
                const tableHTML = await buildTableHTML(currentGroup);
                items.splice(i + 1, spliceLength, { str: tableHTML });
                currentGroup = [];
            }
        }
    }
    // Process any remaining group if we ended with table items
    if (currentGroup.length > 0) {
        spliceLength += currentGroup.length;
        const tableHTML = await buildTableHTML(currentGroup);
        items.splice(0, spliceLength, { ...firstItem, str: tableHTML, fontName: 'table', paragraph: 'table' });
    }
}


// Helper function to build HTML for a table based on grouped items
async function buildTableHTML(tableItems) {
    const rows = {};
    const rowColMax = {};

    tableItems.sort((a, b) =>
        a.row - b.row ||
        a.top - b.top ||
        a.tableColumn - b.tableColumn ||
        a.left - b.left
    );

    await mergeItems(tableItems, ['row', 'tableColumn']);

    console.debug('Merged table items:', structuredClone(tableItems));

    // Group items by row and column
    tableItems.forEach(item => {
        const { row, line, tableColumn, columnMax, str } = item;
        const trKey = `${row}-${line}`;
        if (!rows[trKey]) {
            rows[trKey] = {};
            rowColMax[trKey] = columnMax;
        }
        rows[trKey][tableColumn] = str;
    });

    // Split tabbed items followed by a missing column key
    Object.keys(rows).forEach(rowKey => {
        const row = rows[rowKey];
        const keys = Object.keys(row).map(Number); // Convert keys to numbers to handle missing ones easily
        keys.sort((a, b) => a - b); // Sort the keys in ascending order

        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            const nextKey = keys[i + 1];

            // Check if there is a gap in keys and multiple spaces in the value of the current key
            if (nextKey !== key + 1 && /\s{2,}/.test(row[key])) {
                // Split at the first occurrence of two or more spaces
                const [firstPart, secondPart] = row[key].split(/\s{2,}/);

                // Assign parts to the current key and the missing next key
                row[key] = firstPart || ''; // First part remains in the current key
                row[key + 1] = secondPart || ''; // Second part is assigned to the missing key
            }
        }
    });

    // Generate HTML table
    let tableHTML = '<table><caption>@@@CAPTION@@@</caption><tbody>';
    // Find maximum number of columns
    const maxColumns = Math.max(...Object.values(rows).map(row => Object.keys(row).length));
    for (const rowKey of Object.keys(rows)) {
        const row = rows[rowKey];
        // Include colspan if the row has fewer columns than the maximum
        const colspan = maxColumns - rowColMax[rowKey];
        tableHTML += '<tr>';
        // Loop through maxColumns to ensure all rows have the same number of columns
        for (let i = 0; i < maxColumns - colspan + 1; i++) {
            tableHTML += `<td${i === 0 && colspan > 1 ? ` colspan="${colspan}"` : ''}>${row[i] || ''}</td>`;
        }
        tableHTML += '</tr>';
    }
    tableHTML += '</tbody></table>';

    return tableHTML;
}