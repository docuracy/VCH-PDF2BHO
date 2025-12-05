import {cleanBHOHTML, minimalCleanHTML} from "./html-cleaner.js";

/**
 * Transform BHO HTML to BHO XHTML format
 * Uses SaxonJS with the pre-compiled SEF file
 */
export async function transformBHOHTML(htmlString) {
    console.log("=== BHO HTML TRANSFORMATION START ===");
    console.log("Input HTML length:", htmlString.length);
    console.log("Input preview:", htmlString.substring(0, 500));

    // Check if SaxonJS is available
    if (typeof window.SaxonJS === 'undefined') {
        throw new Error("SaxonJS is required for BHO HTML transformation but is not loaded.\n\nPlease ensure you have an internet connection and refresh the page.");
    }

    // Path to the SEF file
    const sefUrl = "./xhtml-view/xsl/bho-html-to-xhtml.sef.json";

    try {
        console.log("Cleaning HTML to well-formed XML...");

        // Clean the HTML first - this is critical for XSLT processing
        // Try the full cleaning first
        let cleanedHTML;
        try {
            cleanedHTML = cleanBHOHTML(htmlString);
        } catch (cleanError) {
            console.warn("Full cleaning failed, trying minimal cleaning:", cleanError);
            cleanedHTML = minimalCleanHTML(htmlString);
        }

        console.log("HTML cleaning complete");
        console.log("Cleaned HTML length:", cleanedHTML.length);
        // console.log("Cleaned preview:", cleanedHTML.substring(0, 500));
        console.log("Cleaned preview:", cleanedHTML);

        console.log("Loading BHO HTML SEF file:", sefUrl);

        // Run XSLT 3.0 transformation on cleaned HTML
        console.time('BHO HTML transformation');
        const result = await window.SaxonJS.transform({
            stylesheetLocation: sefUrl,
            sourceText: cleanedHTML,
            destination: "serialized"
        }, "async");
        console.timeEnd('BHO HTML transformation');

        console.log("BHO HTML transformation complete");

        let xhtmlOutput = result.principalResult;

        if (!xhtmlOutput || typeof xhtmlOutput !== 'string') {
            throw new Error("No XHTML output from transformation");
        }

        console.log("XHTML output length:", xhtmlOutput.length);
        console.log("XHTML preview:", xhtmlOutput.substring(0, 500));

        // Clean up the output
        // 1. Ensure proper XML declaration and DOCTYPE
        if (!xhtmlOutput.includes('<?xml')) {
            xhtmlOutput = '<?xml version="1.0" encoding="UTF-8"?>\n' + xhtmlOutput;
        }

        if (!xhtmlOutput.includes('<!DOCTYPE')) {
            xhtmlOutput = xhtmlOutput.replace(
                '<?xml version="1.0" encoding="UTF-8"?>',
                '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>'
            );
        }

        console.log("=== BHO HTML TRANSFORMATION COMPLETE ===");
        return xhtmlOutput;

    } catch (error) {
        console.error("BHO HTML transformation error:", error);
        console.error("HTML that failed:", htmlString.substring(0, 2000));
        throw new Error("BHO HTML transformation failed: " + error.message + "\n\nCheck console for details.");
    }
}

/**
 * Detect if a file appears to be BHO HTML
 * Looks for characteristic patterns in the HTML
 */
export function isBHOHTML(htmlString) {
    // Look for characteristic patterns
    const patterns = [
        /clothworkersproperty\.org/i,
        /class="[^"]*node-benefactor/i,
        /class="[^"]*field-name-body/i,
        /<div[^>]*class="footnotes"/i,
        /<a[^>]*href="#ftn\d+"/i
    ];

    let matchCount = 0;
    for (const pattern of patterns) {
        if (pattern.test(htmlString)) {
            matchCount++;
        }
    }

    // If we match at least 2 patterns, it's likely BHO HTML
    const isBHO = matchCount >= 2;

    console.log(`BHO HTML detection: ${matchCount}/5 patterns matched -> ${isBHO ? 'YES' : 'NO'}`);

    return isBHO;
}