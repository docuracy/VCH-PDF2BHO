// /js/text.js
// Description: Contains functions for extracting text from PDFs.

function escapeHTML(str) {
    return str
        .replace(/&/g, '&amp;')
        // .replace(/</g, '&lt;')
        // .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Wrap strings with formatting tags (bold, italic, underline) but NOT URLs.
 * URLs should be handled separately before escaping to avoid mangling href attributes.
 * This is used for footnotes where URL handling is done first.
 */
function wrapStringsNoURLs(items) {
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

        // NOTE: URLs are NOT handled here - they should be processed before escaping
    });
}

function mergeConsecutiveTags(html, tags = ['b','i','u', 'data']) {
    for (const tag of tags) {
        // (<tag>...)(\s*)(<tag>...) — capture any existing whitespace
        const re = new RegExp(
            `<${tag}>(.*?)</${tag}>(\\s*)<${tag}>(.*?)</${tag}>`,
            'gis'
        );

        // Replace until stable
        let prev;
        do {
            prev = html;
            html = html.replace(re, (full, a, ws, b) =>
                `<${tag}>${a}${ws}${b}</${tag}>`
            );
        } while (html !== prev);
    }
    return html;
}

function buildFootnoteLookup(zones) {
    // Find superscripts in relevant zones and mark them
    let foundFootnoteIndices = new Set();
    let foundFootnoteItems = [];
    zones.forEach(zone => {
        if (['FOOTER', 'TABLE', 'FIGURE'].includes(zone.type)) return;
        zone.items.forEach(line => {
            line.forEach((item, index) => {
                if (item.bottom < line[index - 1]?.bottom && /^\d+$/.test(item.str)) {
                    const footIndex = parseInt(item.str);
                    foundFootnoteIndices.add(footIndex);
                    item.footIndex = footIndex;
                    foundFootnoteItems.push(item);
                }
            })
        });
    });
    foundFootnoteIndices = Array.from(foundFootnoteIndices).sort((a, b) => a - b);

    // Concatenate FOOTER zone items
    const footnoteLines = zones
        .filter(z => z.type === 'FOOTER')
        .flatMap(z => z.items);

    // Process footnoteLines into lookup table
    const footnoteLookup = new Map();
    let currentFootnoteIndex = null;
    let currentFootnoteText = [];
    let expectedNextIndex = 1;

    footnoteLines.forEach((line, lineIdx) => {
        // Check if first item in line is a footnote number
        const firstItem = line[0];
        const match = firstItem?.str.match(/^(\d+)$/);

        if (match) {
            const potentialIndex = parseInt(match[1]);

            // Only treat as new footnote if it's the expected next index
            if (potentialIndex === expectedNextIndex) {
                // Found a new footnote marker
                // Save previous footnote if exists
                if (currentFootnoteIndex !== null) {
                    footnoteLookup.set(currentFootnoteIndex, currentFootnoteText);
                }

                // Start new footnote
                currentFootnoteIndex = potentialIndex;
                expectedNextIndex = potentialIndex + 1;
                // Collect items from rest of line (skip the number)
                currentFootnoteText = line.slice(1);
            } else {
                // Integer exists but not the expected footnote number
                // Treat as continuation of current footnote
                if (currentFootnoteIndex !== null) {
                    currentFootnoteText.push(...line);
                } else {
                    console.warn(`Line ${lineIdx} starts with ${potentialIndex} but no footnote context exists`);
                }
            }
        } else if (currentFootnoteIndex !== null) {
            // Continuation of current footnote
            currentFootnoteText.push(...line);
        }
    });

    // Don't forget the last footnote
    if (currentFootnoteIndex !== null) {
        footnoteLookup.set(currentFootnoteIndex, currentFootnoteText);
    }

    // Check for missing footnotes
    const maxIndex = Math.max(...foundFootnoteIndices);
    const missingFootnotes = [];
    for (let i = 1; i <= maxIndex; i++) {
        if (foundFootnoteIndices.includes(i) && !footnoteLookup.has(i)) {
            missingFootnotes.push(i);
        }
    }

    if (missingFootnotes.length > 0) {
        console.warn("Missing footnote text for indices:", missingFootnotes);
    }

    // Also check for footnotes without references
    const unreferencedFootnotes = Array.from(footnoteLookup.keys())
        .filter(idx => !foundFootnoteIndices.includes(idx));
    if (unreferencedFootnotes.length > 0) {
        console.warn("Footnotes without references in body:", unreferencedFootnotes);
    }

    footnoteLookup.forEach((footnote, index) => {
        // Process URLs BEFORE escaping to avoid mangling href attributes
        // Extract and replace URLs with placeholders, then restore after escaping
        const urlPlaceholders = [];
        footnote.forEach(item => {
            // Find URLs and replace with placeholders
            const urlRegex = /(https?:\/\/[^\s<>"')\]]+)/g;
            item.str = item.str.replace(urlRegex, (url) => {
                // Clean trailing punctuation that's not part of URL
                let cleanUrl = url;
                const trailingMatch = cleanUrl.match(/[.,;:!?]+$/);
                let trailing = '';
                if (trailingMatch) {
                    trailing = trailingMatch[0];
                    cleanUrl = cleanUrl.slice(0, -trailing.length);
                }
                const placeholder = `\x00URL${urlPlaceholders.length}\x00`;
                urlPlaceholders.push({ placeholder, url: cleanUrl, trailing });
                return placeholder + trailing;
            });
        });

        // Escape raw text BEFORE adding HTML tags
        footnote.forEach(item => {
            item.str = escapeHTML(item.str);
        });

        // Now add formatting tags (bold, italic, underline - but NOT URLs)
        wrapStringsNoURLs(footnote);

        // Join items with dehyphenation
        let footnoteText = joinItemsWithDehyphenation(footnote);
        footnoteText = mergeConsecutiveTags(footnoteText.replace(/ {2,}/g, ' ').trim());

        // Restore URLs with proper anchor tags
        urlPlaceholders.forEach(({ placeholder, url, trailing }) => {
            footnoteText = footnoteText.replace(placeholder, `<a href="${url}">${url}</a>`);
        });

        footnoteLookup.set(index, footnoteText);
    });

    // Insert footnote texts into items
    foundFootnoteItems.forEach(
        item => {
            item.str = `<data>${footnoteLookup.get(item.footIndex)}</data>`;
        }
    )

    console.debug("Footnote Lookup:", footnoteLookup);
}

/**
 * Join items with proper dehyphenation handling.
 * Handles cases like "typi-" + "cal" -> "typical" and "typi- " + "cal" -> "typical"
 */
function joinItemsWithDehyphenation(items) {
    if (items.length === 0) return '';
    if (items.length === 1) return items[0].str;

    // 1. PREFIXES: These usually KEEP the hyphen (e.g., "cross-reference")
    const prefixesToKeep = /^(mid|early|late|pre|post|non|ex|self|all|quasi|cross|counter|neo|semi|multi)$/i;

    // 2. SUFFIXES: If the next line starts with these, ALWAYS remove hyphen (e.g., "cross-ing")
    // This fixes your "cross-ings" issue automatically without listing every word.
    const commonSuffixes = /^(ing|ings|ed|er|est|ist|ism|ment|tion|sional|tural|ance|ence|ly|ness)$/i;

    // 3. EXCEPTIONS: Specific full words that start with a prefix but should have NO hyphen.
    // Add words here that fail the logic above.
    const solidCompounds = new Set([
        'crossroad', 'crossroads', 'crossword', 'crossover',
        'middleware', 'midnight', 'midsummer',
        'nonsense', 'nonstop',
        'semicolon', 'seminar'
    ]);

    let result = '';

    for (let i = 0; i < items.length; i++) {
        let str = items[i].str;

        // Ensure we are processing the hyphen correctly
        // Some PDFs use a "Soft Hyphen" (\u00AD) or different dash types
        const hasHyphen = /[-\u00AD\u2010\u2011]\s*$/.test(str);

        if (i < items.length - 1 && hasHyphen) {

            // Clean the current part (remove hyphen and space)
            const currentPart = str.replace(/[-\u00AD\u2010\u2011]\s*$/, '');
            const currentLower = currentPart.toLowerCase();

            // Look ahead to the next item
            const nextStr = items[i+1].str.trim();
            // Get just the first word of the next line, stripping punctuation (like "ings,")
            const nextFirstWord = nextStr.split(/[^a-zA-Z0-9]/)[0];
            const nextLower = nextFirstWord.toLowerCase();

            const combinedWord = currentLower + nextLower; // e.g., "crossings"

            let keepHyphen = false;

            // --- LOGIC GATES ---

            // Gate 1: Is the next part a suffix fragment? (e.g. "ings") -> REMOVE HYPHEN
            if (commonSuffixes.test(nextLower)) {
                keepHyphen = false;
            }
            // Gate 2: Is the combined word in our "Solid" list? -> REMOVE HYPHEN
            else if (solidCompounds.has(combinedWord)) {
                keepHyphen = false;
            }
            // Gate 3: Is the current part a special prefix? -> KEEP HYPHEN
            else if (prefixesToKeep.test(currentLower)) {
                // Double check: modern English drops hyphens if the next letter is consonant
                // unless it is the same letter (e.g. non-native vs nonnative).
                // But generally, for your list, we default to keeping it.
                keepHyphen = true;
            }
            // Gate 4: Default behavior for standard text -> REMOVE HYPHEN
            else {
                keepHyphen = false;
            }

            if (keepHyphen) {
                // Ensure we output a standard hyphen, removing extra space
                result += currentPart + '-';
            } else {
                // Join them directly
                result += currentPart;
            }

        } else {
            // Not a hyphenated line break, just append
            // If it's the last item, just add it
            if (i === items.length - 1) {
                result += str;
            } else {
                // Standard space between words
                result += str + ' ';
            }
        }
    }

    return result;
}


function flushBuffer(buffer, isHeading = false, fontSignature = null, isCaption = false) {
    if (buffer.length === 0) return '';

    // Process URLs BEFORE escaping to avoid mangling href attributes
    const urlPlaceholders = [];
    buffer.forEach(item => {
        if (!item.str.startsWith('<')) { // Don't process if already HTML
            const urlRegex = /(https?:\/\/[^\s<>"')\]]+)/g;
            item.str = item.str.replace(urlRegex, (url) => {
                // Clean trailing punctuation that's not part of URL
                let cleanUrl = url;
                const trailingMatch = cleanUrl.match(/[.,;:!?]+$/);
                let trailing = '';
                if (trailingMatch) {
                    trailing = trailingMatch[0];
                    cleanUrl = cleanUrl.slice(0, -trailing.length);
                }
                const placeholder = `\x00URL${urlPlaceholders.length}\x00`;
                urlPlaceholders.push({ placeholder, url: cleanUrl, trailing });
                return placeholder + trailing;
            });
        }
    });

    // Escape HTML entities in the raw text
    buffer.forEach(item => {
        if (!item.str.startsWith('<')) { // Don't escape if already HTML
            item.str = escapeHTML(item.str);
        }
    });

    // Use wrapStringsNoURLs since we handle URLs separately
    wrapStringsNoURLs(buffer);

    // Join items with dehyphenation handling
    let text = joinItemsWithDehyphenation(buffer);
    text = mergeConsecutiveTags(text.trim());

    // Restore URLs with proper anchor tags
    urlPlaceholders.forEach(({ placeholder, url, trailing }) => {
        text = text.replace(placeholder, `<a href="${url}">${url}</a>`);
    });

    if (isHeading && fontSignature) {
        // Apply title case to headings
        // First strip out any HTML tags temporarily
        const tagPattern = /<[^>]+>/g;
        const tags = [];
        let tagIndex = 0;

        // Replace tags with placeholders using non-alphanumeric characters
        const textWithPlaceholders = text.replace(tagPattern, (match) => {
            tags.push(match);
            return `\x00${tagIndex++}\x00`; // Use null character as delimiter
        });

        // Apply title case
        const titleCased = titleCase(textWithPlaceholders);

        // Restore tags
        const finalText = titleCased.replace(/\x00(\d+)\x00/g, (match, index) => {
            return tags[parseInt(index)];
        });

        return `<heading font-signature="${fontSignature}">${finalText}</heading>`;
    } else if (isCaption) {
        // Get integer part if exists
        const figNumberMatch = text.match(/^(\d+)\s*/);
        const figNumber = figNumberMatch ? figNumberMatch[1] : null;
        const figCaption = figNumberMatch ? text.slice(figNumberMatch[0].length).trim() : text;
        if (figNumber) {
            return `<figure><img src="" alt="Figure ${figNumber}" /><figcaption data-start="${figNumber}">${figCaption}</figcaption></figure>`;
        }
        return `<figure><img src="" alt="Figure" /><figcaption>${text}</figcaption></figure>`;
    } else {
        return `<p>${text}</p>`;
    }
}

/**
 * Flush buffer for table cells - simpler version without heading/caption detection
 */
function flushTableCellBuffer(buffer) {
    if (buffer.length === 0) return '';

    // Process URLs BEFORE escaping
    const urlPlaceholders = [];
    buffer.forEach(item => {
        if (!item.str.startsWith('<')) {
            const urlRegex = /(https?:\/\/[^\s<>"')\]]+)/g;
            item.str = item.str.replace(urlRegex, (url) => {
                let cleanUrl = url;
                const trailingMatch = cleanUrl.match(/[.,;:!?]+$/);
                let trailing = '';
                if (trailingMatch) {
                    trailing = trailingMatch[0];
                    cleanUrl = cleanUrl.slice(0, -trailing.length);
                }
                const placeholder = `\x00URL${urlPlaceholders.length}\x00`;
                urlPlaceholders.push({ placeholder, url: cleanUrl, trailing });
                return placeholder + trailing;
            });
        }
    });

    // Escape HTML entities
    buffer.forEach(item => {
        if (!item.str.startsWith('<')) {
            item.str = escapeHTML(item.str);
        }
    });

    // Apply formatting tags
    wrapStringsNoURLs(buffer);

    // Join items with dehyphenation
    let text = joinItemsWithDehyphenation(buffer);
    text = mergeConsecutiveTags(text.trim());

    // Restore URLs
    urlPlaceholders.forEach(({ placeholder, url, trailing }) => {
        text = text.replace(placeholder, `<a href="${url}">${url}</a>`);
    });

    return text;
}

/**
 * Calculate typical line metrics for a zone to help with paragraph detection
 */
function calculateZoneMetrics(zone) {
    if (!zone.items || zone.items.length === 0) return null;

    const lineLefts = [];
    const lineRights = [];
    const lineGaps = [];

    zone.items.forEach((line, i) => {
        if (line.length === 0) return;
        const firstItem = line[0];
        const lastItem = line[line.length - 1];
        if (firstItem) lineLefts.push(firstItem.left);
        if (lastItem) lineRights.push(lastItem.right);

        // Calculate gap from previous line
        if (i > 0) {
            const prevLine = zone.items[i - 1];
            if (prevLine.length > 0) {
                const prevBottom = Math.max(...prevLine.map(item => item.bottom));
                const currTop = Math.min(...line.map(item => item.top));
                const gap = currTop - prevBottom;
                if (gap > 0) lineGaps.push(gap);
            }
        }
    });

    if (lineLefts.length === 0) return null;

    // The "normal" left margin is the MINIMUM left position (flush left)
    // Lines indented from this are paragraph starts
    const minLeft = Math.min(...lineLefts);

    // Find max right position
    const maxRight = Math.max(...lineRights);

    // Normal gap is the median of all gaps (or a default if not enough data)
    lineGaps.sort((a, b) => a - b);
    const normalGap = lineGaps.length > 2
        ? lineGaps[Math.floor(lineGaps.length / 2)]
        : 5;

    return {
        normalLeft: minLeft,
        maxRight,
        lineWidth: maxRight - minLeft,
        normalGap,
        captionGapThreshold: normalGap * 1.5
    };
}

/**
 * Process TABLE zone items into simple text (no heading/caption detection)
 */
function mergeTableZoneItems(zone) {
    if (!zone.items || zone.items.length === 0) {
        return '';
    }

    let buffer = [];

    zone.items.forEach(line => {
        buffer.push(...line);
    });

    return flushTableCellBuffer(buffer);
}

function mergeZoneItems(zones, defaultFont) {
    const defaultFontKey = `${defaultFont.fontName}@${Math.round(defaultFont.fontSize)}`;

    zones.forEach(zone => {
        if (['FOOTER', 'FIGURE'].includes(zone.type)) {
            zone.html = '';
            return;
        }

        // Handle TABLE zones with simplified processing
        // BUT preserve items for 'notes' sections - they need special parsing in buildTables
        if (zone.type === 'TABLE') {
            if (zone.section === 'notes') {
                // Don't process notes yet - buildTables will handle them with parseTableNotes
                zone.html = '';
                // Keep zone.items for later parsing
            } else {
                zone.html = mergeTableZoneItems(zone);
                delete zone.items;
            }
            return;
        }

        if (!zone.items || zone.items.length === 0) {
            zone.html = '';
            delete zone.items;
            return;
        }

        // Calculate zone metrics for paragraph and caption detection
        const metrics = calculateZoneMetrics(zone);
        const INDENT_THRESHOLD = 5; // pixels

        let html = '';
        let buffer = [];
        let inHeading = false;
        let inCaption = false;
        let currentFontSignature = null;
        let prevLine = null;
        let prevLineWasHeading = false;
        let prevLineBottom = 0;

        // Track zone boundaries for cross-zone paragraph merging
        zone.startsWithIndent = false;
        zone.endsWithFullLine = false;

        zone.items.forEach((line, lineIdx) => {
            const firstItem = line[0];
            if (!firstItem) return;

            const lastItem = line[line.length - 1];
            const lineTop = Math.min(...line.map(item => item.top));
            const lineBottom = Math.max(...line.map(item => item.bottom));

            // Check gap from previous line (for caption end detection)
            const gapFromPrevLine = prevLineBottom > 0 ? lineTop - prevLineBottom : 0;

            // Build font signature for this line
            const roundedHeight = Math.round(firstItem.height);
            const fontKey = `${firstItem.fontName}@${roundedHeight}`;

            // Detect caption start: non-italic integer followed by italic text
            let isCaptionStart = false;
            if (!inCaption && !inHeading && /^\d+$/.test(firstItem.str.trim()) && !firstItem.italic) {
                const hasItalicAfter = line.slice(1).some(item => item.italic);
                if (hasItalicAfter) {
                    isCaptionStart = true;
                    console.debug(`Caption start detected at line ${lineIdx}: "${line.map(i => i.str).join(' ').substring(0, 50)}..."`);
                }
            }

            // Check if caption should end (large gap before this line)
            let captionEnded = false;
            if (inCaption && metrics && gapFromPrevLine > metrics.captionGapThreshold) {
                captionEnded = true;
                console.debug(`Caption end detected at line ${lineIdx}: gap=${gapFromPrevLine.toFixed(1)}px (threshold=${metrics.captionGapThreshold.toFixed(1)})`);
            }

            // Check if this line is a potential heading:
            // 1. Not the default font
            // 2. All items in line have same font and height
            // 3. NOT in caption mode or starting a caption
            const allSameFont = line.every(item =>
                item.fontName === firstItem.fontName &&
                Math.round(item.height) === roundedHeight
            );

            let isHeadingLine = (fontKey !== defaultFontKey) && allSameFont && !inCaption && !isCaptionStart;
            let lineFontSignature = isHeadingLine ? fontKey : null;

            // Additional check: if previous line exists and wasn't a heading,
            // and this line's first item has same font as previous line's last item,
            // AND the previous line was NOT all in the same font (i.e., was mixed),
            // then this is NOT a heading (it's a continuation)
            if (isHeadingLine && prevLine && !prevLineWasHeading) {
                const lastItemOfPrevLine = prevLine[prevLine.length - 1];
                const prevRoundedHeight = Math.round(lastItemOfPrevLine.height);

                // Check if previous line was all the same font
                const prevLineAllSameFont = prevLine.every(item =>
                    item.fontName === lastItemOfPrevLine.fontName &&
                    Math.round(item.height) === prevRoundedHeight
                );

                // Only treat as continuation if prev line was MIXED fonts
                if (!prevLineAllSameFont &&
                    firstItem.fontName === lastItemOfPrevLine.fontName &&
                    roundedHeight === prevRoundedHeight) {
                    isHeadingLine = false;
                    lineFontSignature = null;
                }
            }

            // Handle caption end (before processing current line)
            if (captionEnded && buffer.length > 0) {
                html += flushBuffer(buffer, false, null, true); // true = isCaption
                buffer = [];
                inCaption = false;
            }

            // Handle caption start
            if (isCaptionStart) {
                // Flush any previous content
                if (buffer.length > 0) {
                    html += flushBuffer(buffer, inHeading, inHeading ? currentFontSignature : null, false);
                    buffer = [];
                }
                inHeading = false;
                currentFontSignature = null;
                inCaption = true;
                buffer.push(...line);
                prevLineWasHeading = false;
            }
            // Handle heading
            else if (isHeadingLine) {
                // Flush any previous content (including caption)
                if (!inHeading && buffer.length > 0) {
                    html += flushBuffer(buffer, false, null, inCaption);
                    buffer = [];
                    inCaption = false;
                }

                // Check if font signature changed
                if (inHeading && lineFontSignature !== currentFontSignature) {
                    html += flushBuffer(buffer, true, currentFontSignature, false);
                    buffer = [];
                }

                inHeading = true;
                currentFontSignature = lineFontSignature;
                buffer.push(...line);
                prevLineWasHeading = true;

            } else if (inCaption) {
                // Continue caption mode
                buffer.push(...line);
                prevLineWasHeading = false;

            } else {
                // Regular text line

                // Flush heading if we were in one
                if (inHeading) {
                    html += flushBuffer(buffer, true, currentFontSignature, false);
                    buffer = [];
                    inHeading = false;
                    currentFontSignature = null;
                }

                // Check for paragraph break using zone metrics
                // A new paragraph starts when a line is indented from the left margin
                let isNewParagraph = false;

                if (metrics && prevLine) {
                    // Check if this line is indented relative to normal left margin
                    const lineIndent = firstItem.left - metrics.normalLeft;
                    isNewParagraph = lineIndent > INDENT_THRESHOLD;

                    if (isNewParagraph) {
                        console.debug(`Paragraph break detected at line ${lineIdx}: indent=${lineIndent.toFixed(1)}px (threshold=${INDENT_THRESHOLD})`);
                    }
                }

                // Track if first line is indented (for cross-zone merging)
                if (lineIdx === 0) {
                    if (metrics) {
                        const lineIndent = firstItem.left - metrics.normalLeft;
                        zone.startsWithIndent = lineIndent > INDENT_THRESHOLD;
                    }
                }

                if (isNewParagraph && buffer.length > 0) {
                    html += flushBuffer(buffer, false, null, false);
                    buffer = [];
                }

                buffer.push(...line);
                prevLineWasHeading = false;
            }

            prevLine = line;
            prevLineBottom = lineBottom;
        });

        // Check if zone ends with a full line (no right indent) - for cross-zone merging
        if (prevLine && prevLine.length > 0 && metrics) {
            const lastItem = prevLine[prevLine.length - 1];
            if (lastItem) {
                // If last item extends close to max right (within 10%), consider it a full line
                const rightGap = metrics.maxRight - lastItem.right;
                zone.endsWithFullLine = rightGap < (metrics.lineWidth * 0.1);
            }
        }

        // Flush remaining buffer
        if (buffer.length > 0) {
            html += flushBuffer(buffer, inHeading, inHeading ? currentFontSignature : null, inCaption);
        }

        zone.html = html;
        console.info(`Zone ${zone.type} HTML:`, zone.html);

        delete zone.items;
    });
}

/**
 * Parse table notes into a structured list.
 * Notes typically start with an integer, and continuation lines don't.
 * Returns HTML as an ordered list.
 */
function parseTableNotes(notesZones) {
    if (notesZones.length === 0) return '';

    // Collect all items from all notes zones, preserving line structure
    const allLines = [];
    notesZones.forEach(c => {
        if (c.zone.items && c.zone.items.length > 0) {
            allLines.push(...c.zone.items);
        }
    });

    if (allLines.length === 0) return '';

    // Parse lines into numbered notes
    const notes = [];
    let currentNote = null;
    let currentNoteNum = null;

    allLines.forEach(line => {
        if (line.length === 0) return;

        const firstItem = line[0];
        const firstStr = firstItem.str.trim();

        // Check if line starts with an integer
        const numMatch = firstStr.match(/^(\d+)$/);

        if (numMatch) {
            // Save previous note if exists
            if (currentNote !== null && currentNote.length > 0) {
                notes.push({ num: currentNoteNum, items: currentNote });
            }

            // Start new note - skip the number itself, take rest of line
            currentNoteNum = parseInt(numMatch[1]);
            currentNote = line.slice(1);
        } else if (currentNote !== null) {
            // Continuation of current note
            currentNote.push(...line);
        } else {
            // Text before first numbered note - start note 0
            currentNoteNum = 0;
            currentNote = [...line];
        }
    });

    // Don't forget the last note
    if (currentNote !== null && currentNote.length > 0) {
        notes.push({ num: currentNoteNum, items: currentNote });
    }

    if (notes.length === 0) return '';

    // Build HTML - use ordered list if we have numbered notes
    const hasNumberedNotes = notes.some(n => n.num > 0);

    if (hasNumberedNotes) {
        // Find the starting number
        const startNum = Math.min(...notes.filter(n => n.num > 0).map(n => n.num));

        const listItems = notes.map(note => {
            const text = flushTableCellBuffer(note.items);
            if (note.num === 0) {
                // Unnumbered preamble - output before the list
                return null;
            }
            return `<li value="${note.num}">${text}</li>`;
        }).filter(Boolean);

        // Check for preamble (note with num 0)
        const preamble = notes.find(n => n.num === 0);
        let preambleHtml = '';
        if (preamble) {
            preambleHtml = `<p>${flushTableCellBuffer(preamble.items)}</p>`;
        }

        return `${preambleHtml}<ol class="table-notes" start="${startNum}">${listItems.join('')}</ol>`;
    } else {
        // No numbered notes - just output as paragraph
        const allItems = notes.flatMap(n => n.items);
        return flushTableCellBuffer(allItems);
    }
}

/**
 * Build HTML tables from TABLE zones using segmentation attributes.
 *
 * Each TABLE zone has attributes from segmentation:
 * - tableId: unique identifier for the table
 * - section: 'caption', 'header', 'body', or 'notes'
 * - row: row index (null for caption/notes)
 * - column: column index (null for caption/notes)
 */
function buildTables(zones) {
    // Group TABLE zones by tableId
    const tableGroups = new Map();

    zones.forEach((zone, index) => {
        if (zone.type !== 'TABLE') return;

        const tableId = zone.tableId;
        if (!tableId) {
            console.warn(`TABLE zone at index ${index} has no tableId`);
            return;
        }

        if (!tableGroups.has(tableId)) {
            tableGroups.set(tableId, []);
        }
        tableGroups.get(tableId).push({ zone, index });
    });

    console.debug(`Found ${tableGroups.size} tables`);

    // Process each table
    tableGroups.forEach((cells, tableId) => {
        console.debug(`Building table ${tableId} with ${cells.length} cells`);

        // Separate cells by section
        const caption = cells.filter(c => c.zone.section === 'caption');
        const headerCells = cells.filter(c => c.zone.section === 'header');
        const bodyCells = cells.filter(c => c.zone.section === 'body');
        const notes = cells.filter(c => c.zone.section === 'notes');

        // Determine table dimensions from body cells
        const maxRow = bodyCells.length > 0
            ? Math.max(...bodyCells.map(c => c.zone.row ?? -1))
            : -1;
        const maxCol = Math.max(
            headerCells.length > 0 ? Math.max(...headerCells.map(c => c.zone.column ?? -1)) : -1,
            bodyCells.length > 0 ? Math.max(...bodyCells.map(c => c.zone.column ?? -1)) : -1
        );

        const numRows = maxRow + 1;
        const numCols = maxCol + 1;

        console.debug(`Table ${tableId}: ${numRows} rows, ${numCols} columns`);

        // Build caption HTML
        let captionHtml = '';
        if (caption.length > 0) {
            const captionText = caption.map(c => c.zone.html || '').join(' ').trim();
            if (captionText) {
                captionHtml = `<caption>${captionText}</caption>`;
            }
        }

        // Build header HTML
        let theadHtml = '';
        if (headerCells.length > 0 && numCols > 0) {
            // Create a row for header cells
            const headerRow = new Array(numCols).fill('');
            headerCells.forEach(c => {
                const col = c.zone.column;
                if (col !== null && col !== undefined && col < numCols) {
                    headerRow[col] = c.zone.html || '';
                }
            });

            const thCells = headerRow.map(content => `<th>${content}</th>`).join('');
            theadHtml = `<thead><tr>${thCells}</tr></thead>`;
        }

        // Build body HTML
        let tbodyHtml = '';
        if (bodyCells.length > 0 && numRows > 0 && numCols > 0) {
            // Create a 2D array for body cells
            const bodyGrid = Array.from({ length: numRows }, () => new Array(numCols).fill(''));

            bodyCells.forEach(c => {
                const row = c.zone.row;
                const col = c.zone.column;
                if (row !== null && row !== undefined &&
                    col !== null && col !== undefined &&
                    row < numRows && col < numCols) {
                    bodyGrid[row][col] = c.zone.html || '';
                }
            });

            const rows = bodyGrid.map(row => {
                const tdCells = row.map(content => `<td>${content}</td>`).join('');
                return `<tr>${tdCells}</tr>`;
            }).join('');

            tbodyHtml = `<tbody>${rows}</tbody>`;
        }

        // Build notes HTML (as tfoot) - parse numbered list structure
        let tfootHtml = '';
        if (notes.length > 0) {
            const notesHtml = parseTableNotes(notes);
            if (notesHtml) {
                tfootHtml = `<tfoot><tr><td colspan="${numCols || 1}">${notesHtml}</td></tr></tfoot>`;
            }
        }

        // Combine into full table HTML
        const tableHtml = `<table>${captionHtml}${theadHtml}${tbodyHtml}${tfootHtml}</table>`;

        // Store the complete table HTML in the first cell's zone
        // and mark other cells for removal
        const firstCell = cells.sort((a, b) => a.index - b.index)[0];
        firstCell.zone.html = tableHtml;
        firstCell.zone.isTableRoot = true;

        // Mark other cells for skipping
        cells.forEach(c => {
            if (c !== firstCell) {
                c.zone.skipInOutput = true;
            }
        });
    });
}

async function processItems(pageNum, defaultFont, footFont, maxEndnote, pdf, pageNumeral, isIndex, isNewPageNumeral = true) {

    console.info(`Processing page ${pageNum}...`);

    const zones = JSON.parse(
        LZString.decompressFromUTF16(localStorage.getItem(`page-${pageNum}-zones`))
    ) || [];

    if (!zones || zones.length === 0) {
        console.warn(`No zones found for page ${pageNum}`);
        return '';
    }

    buildFootnoteLookup(zones);

    mergeZoneItems(zones, defaultFont);

    buildTables(zones);

    // Iterate zones to generate HTML
    let pageHTML = isNewPageNumeral
        ? `<hr class="page-break" data-start="${pageNumeral}"/>`
        : `<hr class="page-break" />`;

    // Track previous zone for potential paragraph merging
    let pendingParagraphContent = null;

    for (let i = 0; i < zones.length; i++) {
        const zone = zones[i];

        // Skip table cells that have been merged into the table root
        if (zone.skipInOutput) continue;

        let zoneHtml = zone.html || '';

        switch (zone.type) {

            case 'TABLE':
                // Flush any pending paragraph content
                if (pendingParagraphContent) {
                    pageHTML += `<p>${pendingParagraphContent}</p>`;
                    pendingParagraphContent = null;
                }
                pageHTML += zoneHtml;
                break;

            case 'FIGURE':
                // Flush any pending paragraph content
                if (pendingParagraphContent) {
                    pageHTML += `<p>${pendingParagraphContent}</p>`;
                    pendingParagraphContent = null;
                }
                // Figure structure is already handled based on caption detection
                break;

            case 'HEADER':
                break;

            case 'FOOTER':
                break;

            default:
                // Check if we should merge with previous zone's trailing content
                if (pendingParagraphContent && !zone.startsWithIndent && zoneHtml.startsWith('<p>')) {
                    // Extract first paragraph content
                    const firstPMatch = zoneHtml.match(/^<p>(.*?)<\/p>/s);
                    if (firstPMatch) {
                        // Merge with pending content
                        const mergedContent = pendingParagraphContent + ' ' + firstPMatch[1];
                        pageHTML += `<p>${mergedContent}</p>`;
                        // Remove first paragraph from zoneHtml
                        zoneHtml = zoneHtml.slice(firstPMatch[0].length);
                        pendingParagraphContent = null;
                    }
                } else if (pendingParagraphContent) {
                    // Zone starts with indent or isn't a paragraph - flush pending
                    pageHTML += `<p>${pendingParagraphContent}</p>`;
                    pendingParagraphContent = null;
                }

                // Check if this zone ends with an incomplete paragraph (no right indent)
                if (zone.endsWithFullLine && zoneHtml.endsWith('</p>')) {
                    // Extract last paragraph content
                    const lastPMatch = zoneHtml.match(/<p>(.*?)<\/p>$/s);
                    if (lastPMatch) {
                        // Save for potential merging with next zone
                        pendingParagraphContent = lastPMatch[1];
                        // Remove last paragraph from output
                        zoneHtml = zoneHtml.slice(0, -lastPMatch[0].length);
                    }
                }

                pageHTML += zoneHtml;
                break;
        }
    }

    // Flush any remaining pending content
    if (pendingParagraphContent) {
        pageHTML += `<p>${pendingParagraphContent}</p>`;
    }

    return [maxEndnote, pageHTML];
}