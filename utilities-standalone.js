// Standalone utilities for PDF processing (no jQuery dependencies)
// These functions are extracted from utilities.js and made independent

// Title Case Helper
// Handles small words, hyphens, and start-of-sentence logic
function titleCase(str) {
    if (!str) return '';

    const placeholderPattern = /(\x00\d+\x00)/; // Capture delimiter for splitting
    const placeholderCheck = /^\x00\d+\x00$/;   // Check if a part is a placeholder

    // 1. Analyze Source Casing (ignoring placeholders)
    const rawClean = str.replace(/\x00\d+\x00/g, '').replace(/[^a-zA-Z]/g, '');
    const isSourceAllCaps = rawClean.length > 0 && rawClean === rawClean.toUpperCase();

    const smallWords = /^(a|an|and|as|at|but|by|en|for|if|in|nor|of|on|or|per|the|to|v\.?|vs\.?|via)$/i;
    const romanNumerals = /^(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI|XVII|XVIII|XIX|XX|XXI|XXII|XXIII|XXIV|XXV|XXX|XL|L|LX|LXX|LXXX|XC|C|CC|CCC|CD|D|DC|DCC|DCCC|CM|M|MM|MMM)$/i;

    str = str.replace(/\s+/g, ' ').trim();
    const words = str.split(' ');

    // 2. Identify "Visual" indices (words that actually contain text)
    const visibleIndices = words
        .map((w, i) => w.replace(/\x00\d+\x00/g, '').trim() ? i : -1)
        .filter(i => i !== -1);

    const firstVisualIndex = visibleIndices[0];
    const lastVisualIndex = visibleIndices[visibleIndices.length - 1];

    // 3. Process Words
    return words.map((token, index) => {
        // A "token" might be "\x000\x00Hello" or "World\x001\x00".
        // Split keeps the placeholders because of the capturing group in regex.
        const parts = token.split(placeholderPattern).filter(Boolean);

        return parts.map(part => {
            // If this part is a placeholder, return it exactly as is
            if (placeholderCheck.test(part)) return part;

            // --- TEXT PROCESSING ---
            const cleanWord = part;
            const lower = cleanWord.toLowerCase();

            // Determine Visual Context
            const isVisualFirst = index === firstVisualIndex;
            const isVisualLast = index === lastVisualIndex;

            // "After Colon" check (scanning previous tokens)
            let afterColon = false;
            if (!isVisualFirst) {
                let prevIndex = index - 1;
                while (prevIndex >= 0) {
                    const prevClean = words[prevIndex].replace(/\x00\d+\x00/g, '');
                    if (prevClean) {
                        afterColon = prevClean.endsWith(':');
                        break;
                    }
                    prevIndex--;
                }
            }

            // Mixed Case (iPhone)
            const hasLower = /[a-z]/.test(cleanWord);
            const hasUpper = /[A-Z]/.test(cleanWord);
            if (!isSourceAllCaps && hasLower && hasUpper && !romanNumerals.test(cleanWord)) {
                return part;
            }

            // Circa (c.1500)
            if (/^c\.?\d/.test(lower)) {
                return 'c.' + lower.replace(/^c\.?/, '');
            }

            // Hyphenated
            if (cleanWord.includes('-')) {
                return cleanWord.split('-').map((subPart, pIdx, subParts) => {
                    if (romanNumerals.test(subPart)) return subPart.toUpperCase();
                    const subLower = subPart.toLowerCase();
                    if (isVisualFirst || isVisualLast || afterColon || pIdx === 0 || pIdx === subParts.length - 1) {
                        return subLower.charAt(0).toUpperCase() + subLower.slice(1);
                    }
                    if (smallWords.test(subPart.toLowerCase())) return subLower;
                    return subLower.charAt(0).toUpperCase() + subLower.slice(1);
                }).join('-');
            }

            // Roman Numerals
            if (romanNumerals.test(cleanWord)) return cleanWord.toUpperCase();

            // Acronyms (NASA vs Forest)
            if (!isSourceAllCaps && /^[A-Z]{2,}$/.test(cleanWord)) {
                return part;
            }

            // Standard Rules
            if (isVisualFirst || isVisualLast || afterColon) {
                return lower.charAt(0).toUpperCase() + lower.slice(1);
            }
            if (smallWords.test(lower)) {
                return lower;
            }
            return lower.charAt(0).toUpperCase() + lower.slice(1);

        }).join(''); // Rejoin the parts (tag + text + tag)
    }).join(' ');
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

// Make functions globally available
window.titleCase = titleCase;
window.showAlert = showAlert;
window.appendLogMessage = appendLogMessage;
window.fillMissingPageNumerals = fillMissingPageNumerals;