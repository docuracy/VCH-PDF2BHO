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