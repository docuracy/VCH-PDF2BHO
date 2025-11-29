// Standalone utilities for PDF processing (no jQuery dependencies)
// These functions are extracted from utilities.js and made independent

function normaliseIndexEntry(input, addKey = false) {
    let result = input;

    // Step 1: Move numbers out of <h*> tag
    result = result.replace(/^<h(\d+)>([^<]*?)([ ,;\d–npl.]+)<\/h\1>/i, (match, level, label, nums) => {
        return `<h${level}>${label}</h${level}>, ${nums.trim()}`;
    });

    // Step 2: Spacing fixes
    result = result.replace(/([,;])(?=\S)/g, '$1 ');      // Ensure space after , ;
    result = result.replace(/\s{2,}/g, ' ');              // Collapse multiple spaces
    result = result.replace(/\s+([,;])/g, '$1');          // Remove space before , ;
    result = result.replace(/([^>\s])pl\./g, '$1 pl.');   // Ensure space before 'pl.'
    result = result.replace(/h6>/g, 'b>');                // Replace <h6> with <b>
    result = result.replace(/(\s+)<em>n<\/em>/g, '<em>n</em>'); // Remove space before <em>n</em>

    if (addKey) {
        // Step 3: Add <key> around label before index numbers
        const keyMatch = result.match(
            /^(.*?)(?=(,\s*(<em>see<\/em>|m\.\s+\d+|pl\.\s+\d+|<em>\d+|<b>\d+|\d+)|:$))/i
        );
        if (keyMatch) {
            const key = keyMatch[1].trimEnd();
            result = result.replace(key, `<key>${key}</key>`);
        }
    }

    return result;
}

function closeOverlaps(items) {
    // Reverse loop to merge overlapping items
    for (let i = items.length - 1; i > 0; i--) {
        const item = items[i];
        const prevItem = items[i - 1];
        if (item.row === prevItem.row && item.column === prevItem.column && item.line === prevItem.line && item.height === prevItem.height && item.left < prevItem.right) {
            // Merge the items if they overlap
            prevItem.str += item.str;
            prevItem.right = item.right;
            prevItem.width = prevItem.right - prevItem.left;
            prevItem.area += item.area;
            items.splice(i, 1);
        }
    }
}

function titleCase(str) {
    const skipWords = ['and', 'the', 'of', 'in', 'on', 'at', 'with', 'to'];
    return str
        .replace(/\s+/g, ' ')
        .split(' ')
        .map((word, index) => {
            const lowerWord = word.toLowerCase();
            if (index === 0 || !skipWords.includes(lowerWord)) {
                const hyphenatedParts = lowerWord.split('-');
                hyphenatedParts[0] = hyphenatedParts[0].charAt(0).toUpperCase() + hyphenatedParts[0].slice(1);
                for (let i = 1; i < hyphenatedParts.length; i++) {
                    if (!skipWords.includes(hyphenatedParts[i])) {
                        hyphenatedParts[i] = hyphenatedParts[i].charAt(0).toUpperCase() + hyphenatedParts[i].slice(1);
                    }
                }
                return hyphenatedParts.join('-');
            }
            return lowerWord;
        })
        .join(' ');
}

function wrapStrings(items) {
    items.forEach(item => {
        // DON'T wrap headers here - they're handled in the HTML generation phase
        if (item?.header) {
            delete item.fontName;
            return;
        }

        // 1. Handle Bold
        if (item.bold) {
            item.str = `<b>${item.str}</b>`;
            // Clean up: move trailing spaces outside the tag
            item.str = item.str.replace(/(\s+)<\/b>/, '</b>$1');
            // Clean up: move leading spaces outside the tag
            item.str = item.str.replace(/<b>(\s+)/, '$1<b>');

            delete item.bold;
            delete item.fontName;
        }

        // 2. Handle Italic (Independent 'if' allows for Bold + Italic nesting)
        if (item.italic) {
            item.str = `<i>${item.str}</i>`;
            item.str = item.str.replace(/(\s+)<\/i>/, '</i>$1');
            item.str = item.str.replace(/<i>(\s+)/, '$1<i>');

            delete item.italic;
            delete item.fontName;
        }

        // 3. Handle Underline
        if (item.underline) {
            item.str = `<u>${item.str}</u>`;
            item.str = item.str.replace(/(\s+)<\/u>/, '</u>$1');
            item.str = item.str.replace(/<u>(\s+)/, '$1<u>');

            delete item.underline;
        }

        // 4. Wrap any URLs found in the string
        // Changed wrapper from <emph> to <i>
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        item.str = item.str.replace(urlRegex, (url) => {
            return `<i><a href="${url}">${url}</a></i>`;
        });
    });
}

function trimStrings(items) {
    items.forEach(item => {
        item.str = item.str
            .replace(/\s+/g, ' ')
            .replace(/\s([,.])/g, '$1')
            .replace(/(\()\s+/g, '$1');
    });
}

function escapeStrings(items) {
    items.forEach(item => {
        item.str = item.str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    });
}

function showAlert(message, type) {
    console.log(`[${type}] ${message}`);
}

function appendLogMessage(message) {
    const logEl = document.getElementById('extraction-log');
    if (logEl) {
        const p = document.createElement('p');
        p.textContent = message;
        logEl.appendChild(p);
        logEl.scrollTop = logEl.scrollHeight;
    } else {
        console.log(message);
    }
}

function transformXml(html, xslt) {
    const xsltProcessor = new XSLTProcessor();
    const parser = new DOMParser();
    const xsltDoc = parser.parseFromString(xslt, 'application/xml');
    xsltProcessor.importStylesheet(xsltDoc);
    const xmlDoc = parser.parseFromString(html, 'application/xml');
    const transformedDoc = xsltProcessor.transformToFragment(xmlDoc, document);
    const serializer = new XMLSerializer();
    return serializer.serializeToString(transformedDoc);
}

function fillMissingPageNumerals(pageNumerals) {
    let startValue = pageNumerals.find(value => value !== null);
    if (startValue !== undefined) {
        startValue = parseInt(startValue) - pageNumerals.indexOf(startValue);
    } else {
        return;
    }

    for (let i = 0; i < pageNumerals.length; i++) {
        if (pageNumerals[i] === null) {
            pageNumerals[i] = (startValue + i).toString();
        }
    }
}

function processXML(file, fileName, zip) {
    return new Promise((resolve, reject) => {
        const fileReader = new FileReader();
        fileReader.onload = function (event) {
            const xmlContent = event.target.result;
            sessionStorage.setItem('XMLPreview', xmlContent);
            zip.file(fileName, xmlContent);
            resolve();
        };
        fileReader.readAsText(file);
    });
}

// Make functions globally available
window.normaliseIndexEntry = normaliseIndexEntry;
window.closeOverlaps = closeOverlaps;
window.titleCase = titleCase;
window.wrapStrings = wrapStrings;
window.trimStrings = trimStrings;
window.escapeStrings = escapeStrings;
window.showAlert = showAlert;
window.appendLogMessage = appendLogMessage;
window.transformXml = transformXml;
window.fillMissingPageNumerals = fillMissingPageNumerals;
window.processXML = processXML;