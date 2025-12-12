// /js/text.js
// Description: Contains functions for extracting text from PDFs.

// Caption type whitelist
const CAPTION_TYPES = ['figure', 'fig', 'plate'];

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

        // 4. Handle Superscript
        if (item.superscript) {
            item.str = `<sup>${item.str}</sup>`;
            item.str = item.str.replace(/(\s+)<\/sup>/, '</sup>$1');
            item.str = item.str.replace(/<sup>(\s+)/, '$1<sup>');
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
    console.log('\n=== buildFootnoteLookup: Start ===');

    // Debug: Show FOOTNOTE zones and their items
    const footnoteZones = zones.filter(z => z.type === 'FOOTNOTE');
    console.log(`Found ${footnoteZones.length} FOOTNOTE zones`);
    footnoteZones.forEach((zone, idx) => {
        console.log(`\nFOOTNOTE Zone ${idx + 1}:`);
        console.log(`  Order: ${zone.order}, Y: ${zone.y?.toFixed(1)}`);
        console.log(`  Items: ${zone.items ? zone.items.length : 0} lines`);
        if (zone.items && zone.items.length > 0) {
            zone.items.forEach((line, lineIdx) => {
                const lineText = Array.isArray(line) ? line.map(i => i.str).join(' ') : 'NOT AN ARRAY';
                console.log(`    Line ${lineIdx}: [${line.length} items] "${lineText.substring(0, 80)}${lineText.length > 80 ? '...' : ''}"`);
                if (lineIdx === 0 && Array.isArray(line) && line.length > 0) {
                    console.log(`      First item: str="${line[0].str}", height=${line[0].height}, fontName=${line[0].fontName}`);
                }
            });
        } else {
            console.log(`    ⚠️ NO ITEMS IN THIS ZONE`);
        }
    });

    // Find superscripts in relevant zones and mark them
    let foundFootnoteIndices = new Set();
    let foundFootnoteItems = [];
    zones.forEach(zone => {
        if (['FOOTNOTE', 'TABLE', 'FIGURE'].includes(zone.type)) return;
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

    // Concatenate FOOTNOTE zone items
    const footnoteLines = zones
        .filter(z => z.type === 'FOOTNOTE')
        .flatMap(z => z.items);

    console.log(`\nProcessing ${footnoteLines.length} footnote lines`);

    // Process footnoteLines into lookup table
    const footnoteLookup = new Map();
    let currentFootnoteIndex = null;
    let currentFootnoteText = [];
    let expectedNextIndex = 1;

    console.log('Processing footnote lines:');
    footnoteLines.forEach((line, lineIdx) => {
        // Check if first item in line starts with a footnote number
        const firstItem = line[0];
        const lineText = line.map(i => i.str).join(' ');

        // Try to match footnote number at start of first item's text
        // Pattern: start of string, digit(s), followed by space or end
        const match = firstItem?.str.match(/^(\d+)(?:\s|$)/);

        if (match) {
            const potentialIndex = parseInt(match[1]);
            console.log(`  Line ${lineIdx}: First item="${firstItem.str.substring(0, 60)}..." (potential footnote ${potentialIndex}), expected=${expectedNextIndex}`);

            // Only treat as new footnote if it's the expected next index
            if (potentialIndex === expectedNextIndex) {
                // Found a new footnote marker
                // Save previous footnote if exists
                if (currentFootnoteIndex !== null) {
                    const prevText = currentFootnoteText.map(i => i.str).join(' ');
                    console.log(`    ✓ Saved footnote ${currentFootnoteIndex}: "${prevText.substring(0, 60)}${prevText.length > 60 ? '...' : ''}"`);
                    footnoteLookup.set(currentFootnoteIndex, currentFootnoteText);
                }

                // Start new footnote
                currentFootnoteIndex = potentialIndex;
                expectedNextIndex = potentialIndex + 1;

                // Remove the footnote number from the first item's text
                // If the number is the entire item, use rest of line
                // If the number is part of the item, split it
                if (firstItem.str === match[0].trim()) {
                    // Number is the entire item (e.g., "1")
                    currentFootnoteText = line.slice(1);
                } else {
                    // Number is part of the item (e.g., "1  For the history...")
                    // Create a new item with the text after the number
                    const textAfterNumber = firstItem.str.substring(match[0].length).trim();
                    if (textAfterNumber) {
                        const newItem = {...firstItem, str: textAfterNumber};
                        currentFootnoteText = [newItem, ...line.slice(1)];
                    } else {
                        currentFootnoteText = line.slice(1);
                    }
                }
                console.log(`    → Start footnote ${potentialIndex}: "${lineText.substring(0, 60)}${lineText.length > 60 ? '...' : ''}"`);
            } else {
                // Integer exists but not the expected footnote number
                // Treat as continuation of current footnote
                console.log(`    ⚠️ Number ${potentialIndex} found but expected ${expectedNextIndex} - treating as continuation`);
                if (currentFootnoteIndex !== null) {
                    currentFootnoteText.push(...line);
                } else {
                    console.warn(`    ❌ Line ${lineIdx} starts with ${potentialIndex} but no footnote context exists`);
                }
            }
        } else {
            if (currentFootnoteIndex !== null) {
                // Continuation of current footnote
                console.log(`  Line ${lineIdx}: Continuation of footnote ${currentFootnoteIndex}: "${lineText.substring(0, 60)}${lineText.length > 60 ? '...' : ''}"`);
                currentFootnoteText.push(...line);
            } else {
                console.log(`  Line ${lineIdx}: ⚠️ No footnote started yet, first item="${firstItem?.str}"`);
            }
        }
    });

    // Don't forget the last footnote
    if (currentFootnoteIndex !== null) {
        const lastText = currentFootnoteText.map(i => i.str).join(' ');
        console.log(`  ✓ Saved last footnote ${currentFootnoteIndex}: "${lastText.substring(0, 60)}${lastText.length > 60 ? '...' : ''}"`);
        footnoteLookup.set(currentFootnoteIndex, currentFootnoteText);
    }

    console.log(`\n=== buildFootnoteLookup: Summary ===`);
    console.log(`Total footnotes found: ${footnoteLookup.size}`);
    if (footnoteLookup.size > 0) {
        console.log(`Footnote indices: ${Array.from(footnoteLookup.keys()).join(', ')}`);
    } else {
        console.warn('⚠️ NO FOOTNOTES WERE ADDED TO THE LOOKUP!');
        if (footnoteZones.length > 0) {
            console.warn(`   But ${footnoteZones.length} FOOTNOTE zones exist - check if items are formatted correctly`);
        }
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
    const commonSuffixes = /^(ing|ings|ed|er|est|ist|ism|ment|tion|sional|tural|ance|ence|ly|ness)$/i;

    // 3. EXCEPTIONS: Specific full words that start with a prefix but should have NO hyphen.
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
        const hasHyphen = /[-\u00AD\u2010\u2011]\s*$/.test(str);

        if (i < items.length - 1 && hasHyphen) {
            // Clean the current part (remove hyphen and space)
            const currentPart = str.replace(/[-\u00AD\u2010\u2011]\s*$/, '');
            const currentLower = currentPart.toLowerCase();

            // Look ahead to the next item
            const nextStr = items[i+1].str.trim();
            const nextFirstWord = nextStr.split(/[^a-zA-Z0-9]/)[0];
            const nextLower = nextFirstWord.toLowerCase();

            const combinedWord = currentLower + nextLower;

            let keepHyphen = false;

            // --- LOGIC GATES ---

            // Gate 1: Is the next part a suffix fragment? -> REMOVE HYPHEN
            if (commonSuffixes.test(nextLower)) {
                keepHyphen = false;
            }
            // Gate 2: Is the combined word in our "Solid" list? -> REMOVE HYPHEN
            else if (solidCompounds.has(combinedWord)) {
                keepHyphen = false;
            }
            // Gate 3: Is the current part a special prefix? -> KEEP HYPHEN
            else if (prefixesToKeep.test(currentLower)) {
                keepHyphen = true;
            }
            // Gate 4: Default behavior for standard text -> REMOVE HYPHEN
            else {
                keepHyphen = false;
            }

            if (keepHyphen) {
                result += currentPart + '-';
            } else {
                result += currentPart;
            }

        } else {
            // Not a hyphenated line break
            // Items are already merged if adjacent, so just add space between them
            if (i === items.length - 1) {
                result += str;
            } else {
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
        if (!item.str) return; // Skip items without str property
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
        if (!item.str) return; // Skip items without str property
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
        // Parse caption: [OptionalType][.][space][number][.][space][caption text]
        // Examples: "Figure 5 Map...", "Fig. 3. Text...", "5 Text...", "Chart 12 Data..."
        const captionPattern = /^(?:([A-Za-z]+)\.?\s+)?(\d+)\.?\s+(.+)/;
        const match = text.match(captionPattern);

        if (match) {
            const type = match[1] ? match[1].toLowerCase() : 'figure';  // Default to 'figure'
            const number = match[2];
            const caption = match[3];

            return `<figure><img src="${type}-${number}.png" alt="${type.charAt(0).toUpperCase() + type.slice(1)} ${number}" /><figcaption data-start="${number}">${caption}</figcaption></figure>`;
        }

        // Fallback for malformed captions
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
        if (['FOOTNOTE', 'FIGURE'].includes(zone.type)) {
            zone.html = '';
            return;
        }

        // Handle TABLE zones with simplified processing
        if (zone.type === 'TABLE') {
            if (zone.section === 'notes') {
                zone.html = '';
            } else {
                zone.html = mergeTableZoneItems(zone);
                delete zone.items;
            }
            processedZones.add(zone);
            return;
        }

        if (!zone.items || zone.items.length === 0) {
            zone.html = '';
            delete zone.items;
            processedZones.add(zone);
            return;
        }

        // Check if this zone starts with a heading that might continue into following zones
        if (zone.type === 'BODY' && zone.startsWithHeading) {
            console.log(`\n>>> Calling processHeadingSequence for zone #${zone.order}`);
            // Process this zone and any following zones as a heading sequence
            processHeadingSequence(zone, zones, zoneIdx, defaultFont, defaultFontKey, processedZones);
            return;
        } else if (zone.type === 'BODY') {
            console.log(`Zone #${zone.order}: BODY but not startsWithHeading (${zone.startsWithHeading})`);
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

            // Detect caption start: [OptionalType][.][space][number][.][space][italic text]
            // Examples: "Figure 5 Text...", "Fig. 3. Text...", "Plate 12 Text..."
            let isCaptionStart = false;
            if (!inCaption && !inHeading && line.length > 1) {
                // Build the line text to check for caption pattern
                // Use space to join items since PDF items don't have hard-coded spaces
                const lineText = line.map(i => i.str).join(' ');

                // Build pattern from whitelist - match any variant with at least one capital letter
                // Create alternatives like: (?:Figure|FIG|FIGURE|Fig|...)
                const typeAlternatives = CAPTION_TYPES.map(type => {
                    // Generate common capitalization variants that have at least one capital
                    const lower = type.toLowerCase();
                    const upper = type.toUpperCase();
                    const title = lower.charAt(0).toUpperCase() + lower.slice(1);
                    // Return unique variants (using Set to dedupe)
                    return [title, upper].filter((v, i, arr) => arr.indexOf(v) === i).join('|');
                }).join('|');

                // Pattern: optional type (from whitelist, with capital), optional period, space, number, optional period, space
                const captionPattern = new RegExp(`^(?:(${typeAlternatives})\\.?\\s+)?(\\d+)\\.?\\s+`);
                const match = lineText.match(captionPattern);

                if (match) {
                    // If there's a type prefix, verify it has at least one capital letter
                    const typePrefix = match[1];
                    if (typePrefix && !/[A-Z]/.test(typePrefix)) {
                        // Type exists but has no capital letters - reject
                        // This shouldn't happen with our generated pattern, but safety check
                        match[0] = null;
                    }

                    if (match[0]) {
                        // Check if there's italic text after the number
                        // Find where the number ends in the line items
                        let hasItalic = false;
                        let charCount = 0;
                        for (const item of line) {
                            charCount += item.str.length + 1; // +1 for the space we added in join
                            if (charCount >= match[0].length && item.italic) {
                                hasItalic = true;
                                break;
                            }
                        }

                        if (hasItalic) {
                            isCaptionStart = true;
                            const typeName = typePrefix || '(no type)';
                            console.debug(`Caption start detected at line ${lineIdx}: type="${typeName}", number=${match[2]}, text="${lineText.substring(0, 50)}..."`);
                        }
                    }
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
                // 1. ^((?:<[^>]+>\s*)*)  -> Capture Group $1: Matches any number of HTML tags (like <i>, <b>) at the start
                // 2. Table\s+\d+...      -> Matches the "Table X" part we want to remove
                const captionTextClean = captionText
                    .replace(/^((?:<[^>]+>\s*)*)Table\s+\d+(?:\.\d+)?\s*[:.-]?\s*/i, '$1')
                    .trim();

                captionHtml = `<caption>${captionTextClean}</caption>`;
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
        let notesHtml = '';
        if (notes.length > 0) {
            notesHtml = parseTableNotes(notes);
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

        // Store metadata for cross-page merging
        firstCell.zone.tableMetadata = {
            numCols,
            numRows,
            hasCaption: captionHtml !== '',
            captionHtml,
            theadHtml,
            tbodyHtml,
            tfootHtml,
            notesHtml
        };

        // Mark other cells for skipping
        cells.forEach(c => {
            if (c !== firstCell) {
                c.zone.skipInOutput = true;
            }
        });
    });
}

/**
 * Merge two tables that span across pages (horizontal continuation).
 * Returns merged table HTML or null if tables are not compatible.
 *
 * These tables have the SAME rows but DIFFERENT columns - the second table
 * continues the columns of the first table horizontally.
 *
 * Conditions for merging:
 * - Same number of body rows (same row structure)
 * - Second table has empty caption
 * - If both have notes with ordered lists, merge the lists
 */
function mergeCrossPageTables(prevTableMeta, currTableMeta) {
    // Check body row count matches (same row structure)
    if (prevTableMeta.numRows !== currTableMeta.numRows) {
        console.debug('Cross-page table merge failed: row count mismatch',
            prevTableMeta.numRows, 'vs', currTableMeta.numRows);
        return null;
    }

    // Check second table has no caption
    if (currTableMeta.hasCaption) {
        console.debug('Cross-page table merge failed: continuation has caption');
        return null;
    }

    console.debug('Merging cross-page tables horizontally');

    // Use caption from first table
    const captionHtml = prevTableMeta.captionHtml;

    // Merge thead: append cells from second header row to first header row
    const theadHtml = mergeTableSection(prevTableMeta.theadHtml, currTableMeta.theadHtml, 'th');

    // Merge tbody: append cells from each row of second table to corresponding row of first
    const tbodyHtml = mergeTableSection(prevTableMeta.tbodyHtml, currTableMeta.tbodyHtml, 'td');

    // Calculate total columns for tfoot colspan
    const totalCols = prevTableMeta.numCols + currTableMeta.numCols;

    // Merge notes if both have them
    let tfootHtml = '';

    if (prevTableMeta.notesHtml && currTableMeta.notesHtml) {
        // Both have notes - try to merge ordered lists
        const mergedNotes = mergeNotesLists(prevTableMeta.notesHtml, currTableMeta.notesHtml);
        tfootHtml = `<tfoot><tr><td colspan="${totalCols}">${mergedNotes}</td></tr></tfoot>`;
    } else if (prevTableMeta.notesHtml) {
        // Update colspan in first table's tfoot
        tfootHtml = prevTableMeta.tfootHtml.replace(/colspan="\d+"/, `colspan="${totalCols}"`);
    } else if (currTableMeta.notesHtml) {
        // Update colspan in second table's tfoot
        tfootHtml = currTableMeta.tfootHtml.replace(/colspan="\d+"/, `colspan="${totalCols}"`);
    }

    return `<table>${captionHtml}${theadHtml}${tbodyHtml}${tfootHtml}</table>`;
}

/**
 * Merge two table sections (thead or tbody) horizontally.
 * Appends cells from each row of section2 to the corresponding row of section1.
 *
 * @param {string} section1Html - First section HTML (e.g., <thead>...</thead>)
 * @param {string} section2Html - Second section HTML
 * @param {string} cellTag - 'th' or 'td'
 * @returns {string} Merged section HTML
 */
function mergeTableSection(section1Html, section2Html, cellTag) {
    if (!section1Html || !section2Html) {
        return section1Html || section2Html || '';
    }

    // Extract rows from both sections
    const rows1 = [...section1Html.matchAll(/<tr>(.*?)<\/tr>/gs)].map(m => m[1]);
    const rows2 = [...section2Html.matchAll(/<tr>(.*?)<\/tr>/gs)].map(m => m[1]);

    // Determine the section tag (thead or tbody)
    const sectionTagMatch = section1Html.match(/^<(\w+)>/);
    const sectionTag = sectionTagMatch ? sectionTagMatch[1] : 'tbody';

    // Merge corresponding rows
    const mergedRows = [];
    const maxRows = Math.max(rows1.length, rows2.length);

    for (let i = 0; i < maxRows; i++) {
        const row1Cells = rows1[i] || '';
        const row2Cells = rows2[i] || '';
        mergedRows.push(`<tr>${row1Cells}${row2Cells}</tr>`);
    }

    return `<${sectionTag}>${mergedRows.join('')}</${sectionTag}>`;
}

/**
 * Merge two notes sections, combining ordered lists if present.
 */
function mergeNotesLists(notes1, notes2) {
    // Check if both contain ordered lists
    const olMatch1 = notes1.match(/<ol[^>]*class="table-notes"[^>]*>(.*?)<\/ol>/s);
    const olMatch2 = notes2.match(/<ol[^>]*class="table-notes"[^>]*>(.*?)<\/ol>/s);

    if (olMatch1 && olMatch2) {
        // Extract list items from both
        const items1 = olMatch1[1];
        const items2 = olMatch2[1];

        // Get start attribute from first list
        const startMatch = notes1.match(/<ol[^>]*start="(\d+)"/);
        const startNum = startMatch ? startMatch[1] : '1';

        // Any preamble from first notes (text before <ol>)
        const preamble1 = notes1.substring(0, notes1.indexOf('<ol'));

        return `${preamble1}<ol class="table-notes" start="${startNum}">${items1}${items2}</ol>`;
    }

    // Can't merge as lists - just concatenate
    return notes1 + ' ' + notes2;
}

/**
 * Post-process HTML to merge tables that span across pages.
 * The continuation table is moved back to the previous page.
 *
 * @param {Array} pageResults - Array of {html, tableMetadata} for each page
 * @returns {Array} - Array of merged HTML strings
 */
function mergeTablesAcrossPages(pageResults) {
    console.debug('=== mergeTablesAcrossPages called ===');
    console.debug(`Processing ${pageResults.length} pages`);

    if (pageResults.length === 0) return [];

    const mergedPages = [];
    let i = 0;

    while (i < pageResults.length) {
        let currentPage = pageResults[i];
        let currentHtml = currentPage.html;
        let currentTableMeta = currentPage.lastContentTableMetadata;

        console.debug(`\nProcessing page ${i + 1}, hasTable: ${!!currentTableMeta}`);

        // Look ahead to see if next page has a continuation table
        while (i + 1 < pageResults.length) {
            const nextPage = pageResults[i + 1];
            const nextTableMeta = nextPage.firstContinuationTableMetadata;

            if (!currentTableMeta || !nextTableMeta) {
                break;
            }

            // Check if tables can be merged
            if (currentTableMeta.numRows === nextTableMeta.numRows) {

                console.debug(`  -> MERGE CONDITIONS MET! Merging table from page ${i + 2} into page ${i + 1}`);

                // Merge the tables
                const mergedTableHtml = mergeCrossPageTables(currentTableMeta, nextTableMeta);

                if (mergedTableHtml) {
                    // 1. UPDATE CURRENT PAGE (Inject merged table)
                    const allTables = [...currentHtml.matchAll(/<table>.*?<\/table>/gs)];
                    const lastTableMatch = allTables.length > 0 ? allTables[allTables.length - 1] : null;

                    if (lastTableMatch) {
                        const beforeTable = currentHtml.substring(0, lastTableMatch.index);
                        const afterTable = currentHtml.substring(lastTableMatch.index + lastTableMatch[0].length);
                        currentHtml = beforeTable + mergedTableHtml + afterTable;
                    }

                    // 2. UPDATE NEXT PAGE (Remove the moved table)
                    const nextHtml = nextPage.html;
                    const allNextTables = [...nextHtml.matchAll(/<table>.*?<\/table>/gs)];
                    let firstCaptionlessTableMatch = null;

                    for (const tableMatch of allNextTables) {
                        const tableHtml = tableMatch[0];
                        const captionMatch = tableHtml.match(/<caption>(.*?)<\/caption>/s);
                        if (!captionMatch || captionMatch[1].trim() === '') {
                            firstCaptionlessTableMatch = tableMatch;
                            break;
                        }
                    }

                    let updatedNextHtml = nextHtml;
                    if (firstCaptionlessTableMatch) {
                        const tableToRemove = firstCaptionlessTableMatch[0];
                        const tableStart = firstCaptionlessTableMatch.index;
                        const tableEnd = tableStart + tableToRemove.length;

                        const beforeTable = nextHtml.substring(0, tableStart);
                        const afterTable = nextHtml.substring(tableEnd);
                        updatedNextHtml = beforeTable + afterTable;
                    }

                    // Update next page result in the array so it's ready for the next iteration of the outer loop
                    pageResults[i + 1] = {
                        ...nextPage,
                        html: updatedNextHtml,
                        firstContinuationTableMetadata: null
                    };

                    // Update local currentTableMeta metadata in case we want to try merging i with i+2 (unlikely but safe)
                    currentTableMeta = {
                        ...currentTableMeta,
                        numCols: currentTableMeta.numCols + nextTableMeta.numCols,
                        theadHtml: mergedTableHtml.match(/<thead>.*<\/thead>/s)?.[0] || '',
                        tbodyHtml: mergedTableHtml.match(/<tbody>.*<\/tbody>/s)?.[0] || '',
                        tfootHtml: mergedTableHtml.match(/<tfoot>.*<\/tfoot>/s)?.[0] || '',
                        notesHtml: currentTableMeta.notesHtml || nextTableMeta.notesHtml
                    };
                }
            }

            // Break the inner loop (standard behavior after checking next page)
            break;
        }

        mergedPages.push(currentHtml);
        i++;
    }

    console.debug(`\n=== mergeTablesAcrossPages complete, returning ${mergedPages.length} pages ===`);
    return mergedPages;
}

/**
 * Extract figure identifiers from zones with HTML containing <figure> elements
 * Returns an array of 'type-number' strings in reading order (e.g., ['figure-5', 'chart-12', 'fig-3'])
 */
function extractFigureNumbersFromZones(zones) {
    const figureIds = [];

    zones.forEach(zone => {
        if (!zone.html) return;

        // Look for img src with type-number pattern (primary method)
        const imgSrcMatch = zone.html.match(/<img[^>]+src="([a-z]+-\d+)\.png"/);
        if (imgSrcMatch) {
            figureIds.push(imgSrcMatch[1]);
            return;
        }

        // Fallback: look for data-start attribute and try to extract type from img src or alt
        const dataStartMatch = zone.html.match(/<figcaption[^>]+data-start="(\d+)"/);
        if (dataStartMatch) {
            // Try to get type from img src or default to 'figure'
            const imgMatch = zone.html.match(/<img[^>]+src="([a-z]+)-\d+\./);
            const type = imgMatch ? imgMatch[1] : 'figure';
            figureIds.push(`${type}-${dataStartMatch[1]}`);
        }
    });

    return figureIds;
}

async function processItems(pageNum, defaultFont, maxEndnote, pdf, pageNumeral, isIndex, isNewPageNumeral = true) {

    console.info(`Processing page ${pageNum}...`);

    const zones = JSON.parse(
        LZString.decompressFromUTF16(localStorage.getItem(`page-${pageNum}-zones`))
    ) || [];

    if (!zones || zones.length === 0) {
        console.warn(`No zones found for page ${pageNum}`);
        return [maxEndnote, '', null, null];
    }

    buildFootnoteLookup(zones);

    mergeZoneItems(zones, defaultFont);

    buildTables(zones);

    // Extract figure numbers from captions for image extraction
    const figureNumbers = extractFigureNumbersFromZones(zones);
    if (figureNumbers.length > 0) {
        localStorage.setItem(`page-${pageNum}-figure-numbers`, JSON.stringify(figureNumbers));
    }

    // Iterate zones to generate HTML
    let pageHTML = isNewPageNumeral
        ? `<hr class="page-break" data-start="${pageNumeral}"/>`
        : `<hr class="page-break" />`;

    // Track previous zone for potential paragraph merging
    let pendingParagraphContent = null;

    // Track first and last table metadata for cross-page merging
    let firstTableMetadata = null;
    let lastTableMetadata = null;

    const visibleZones = zones.filter(z => !z.skipInOutput);

    for (let i = 0; i < visibleZones.length; i++) {
        const zone = visibleZones[i];
        let zoneHtml = zone.html || '';

        switch (zone.type) {

            case 'TABLE':
                // Flush any pending paragraph content
                if (pendingParagraphContent) {
                    pageHTML += `<p>${pendingParagraphContent}</p>`;
                    pendingParagraphContent = null;
                }

                // Track table metadata
                if (zone.isTableRoot && zone.tableMetadata) {
                    if (firstTableMetadata === null) {
                        firstTableMetadata = zone.tableMetadata;
                    }
                    lastTableMetadata = zone.tableMetadata;
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
            case 'FOOTNOTE':
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

    // Find the last table on the page (for potential continuation on next page)
    // Search backwards through all zones
    let lastContentTableMetadata = null;
    for (let j = visibleZones.length - 1; j >= 0; j--) {
        const zone = visibleZones[j];
        if (zone.type === 'TABLE' && zone.isTableRoot && zone.tableMetadata) {
            lastContentTableMetadata = zone.tableMetadata;
            break;
        }
    }

    // Find first captionless table on page (potential continuation from previous page)
    // Search forward through all zones
    let firstContinuationTableMetadata = null;
    for (const zone of visibleZones) {
        if (zone.type === 'TABLE' && zone.isTableRoot && zone.tableMetadata) {
            if (!zone.tableMetadata.hasCaption) {
                firstContinuationTableMetadata = zone.tableMetadata;
            }
            // Stop at first TABLE - if it has a caption, it's not a continuation
            break;
        }
    }

    console.debug(`Page ${pageNum} table detection:`, {
        lastContentTableMetadata: lastContentTableMetadata ? {
            numCols: lastContentTableMetadata.numCols,
            numRows: lastContentTableMetadata.numRows,
            hasCaption: lastContentTableMetadata.hasCaption
        } : null,
        firstContinuationTableMetadata: firstContinuationTableMetadata ? {
            numCols: firstContinuationTableMetadata.numCols,
            numRows: firstContinuationTableMetadata.numRows,
            hasCaption: firstContinuationTableMetadata.hasCaption
        } : null,
        visibleZoneTypes: visibleZones.map(z => z.type)
    });

    return [
        maxEndnote,
        pageHTML,
        firstContinuationTableMetadata,
        lastContentTableMetadata
    ];
}