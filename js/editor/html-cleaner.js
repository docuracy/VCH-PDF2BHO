/**
 * Clean and prepare BHO-HTML for XSLT transformation
 * Converts potentially malformed HTML into well-formed XHTML
 */
export function cleanBHOHTML(htmlString) {
    console.log("=== CLEANING BHO HTML ===");
    console.log("Input length:", htmlString.length);

    try {
        // Step 1: Parse as HTML using browser's DOMParser
        // This is more forgiving than XML parsing and handles malformed HTML
        const parser = new DOMParser();
        const htmlDoc = parser.parseFromString(htmlString, "text/html");

        // Check for parse errors
        const parserError = htmlDoc.querySelector('parsererror');
        if (parserError) {
            console.warn("HTML parse warning:", parserError.textContent);
            // Continue anyway - browser parser is forgiving
        }

        // Step 2: Extract the article element (main content)
        // This is what we actually want to transform
        const article = htmlDoc.querySelector('article');

        if (!article) {
            console.warn("No article element found, using full document");
            // Fall through to use full document
        }

        // Step 3: Create a clean document structure
        const cleanDoc = document.implementation.createHTMLDocument("BHO-HTML");

        // Step 4: Add necessary structure
        const html = cleanDoc.documentElement;
        html.setAttribute('lang', 'en');
        html.setAttribute('dir', 'ltr');

        // Step 5: Copy the article (or body content) to clean document
        if (article) {
            // First, check if there's an h1 with title before the article
            const h1 = htmlDoc.querySelector('h1.title, h1[id*="title"]') ||
                htmlDoc.querySelector('h1');

            // Clone the article element
            const clonedArticle = article.cloneNode(true);

            // If h1 exists and isn't already in article, prepend it
            if (h1 && !clonedArticle.querySelector('h1')) {
                const clonedH1 = h1.cloneNode(true);
                clonedArticle.insertBefore(clonedH1, clonedArticle.firstChild);
            }

            cleanDoc.body.appendChild(clonedArticle);
        } else {
            // Copy all body content
            const originalBody = htmlDoc.body;
            if (originalBody) {
                Array.from(originalBody.childNodes).forEach(node => {
                    cleanDoc.body.appendChild(node.cloneNode(true));
                });
            }
        }

        // Step 6: Clean up problematic attributes and elements
        cleanHTML(cleanDoc);

        // Step 7: Serialize as XML (which gives us proper self-closing tags)
        const serializer = new XMLSerializer();
        let cleanedHTML = serializer.serializeToString(cleanDoc.documentElement);

        // Step 8: Add DOCTYPE and XML declaration
        cleanedHTML = '<!DOCTYPE html>\n' + cleanedHTML;

        // Step 9: Fix common serialization issues
        cleanedHTML = fixSerializationIssues(cleanedHTML);

        console.log("Cleaned HTML length:", cleanedHTML.length);
        console.log("Cleaned HTML preview:", cleanedHTML.substring(0, 500));
        console.log("=== HTML CLEANING COMPLETE ===");

        return cleanedHTML;

    } catch (error) {
        console.error("HTML cleaning error:", error);
        // Return original if cleaning fails
        console.warn("Returning original HTML due to cleaning error");
        return htmlString;
    }
}

/**
 * Clean problematic attributes and elements in the document
 */
function cleanHTML(doc) {
    // Remove script and style elements (they can cause issues)
    const scripts = doc.querySelectorAll('script, style');
    scripts.forEach(el => el.remove());

    // Remove comments (they can cause parsing issues)
    const walker = doc.createTreeWalker(
        doc.documentElement,
        NodeFilter.SHOW_COMMENT,
        null,
        false
    );

    const comments = [];
    let node;
    while (node = walker.nextNode()) {
        comments.push(node);
    }
    comments.forEach(comment => comment.remove());

    // Clean up empty elements that shouldn't be empty
    const emptyPs = doc.querySelectorAll('p:empty, div:empty');
    emptyPs.forEach(el => {
        // Don't remove footnote divs even if they appear empty
        if (el.tagName === 'DIV' && el.id && el.id.startsWith('ftn')) {
            return;
        }
        if (!el.hasChildNodes() && !el.hasAttributes()) {
            el.remove();
        }
    });

    // Fix image attributes - ensure they're clean
    const images = doc.querySelectorAll('img');
    images.forEach(img => {
        // Remove problematic attributes
        img.removeAttribute('style'); // CSS can interfere
        img.removeAttribute('class'); // Classes not needed in XHTML output

        // Ensure src and title are present
        if (!img.getAttribute('src')) {
            img.setAttribute('src', '');
        }
        if (!img.getAttribute('title')) {
            img.setAttribute('title', img.getAttribute('alt') || '');
        }
    });

    // Clean up link attributes
    const links = doc.querySelectorAll('a');
    links.forEach(link => {
        const href = link.getAttribute('href');

        // Normalize footnote links to relative anchors
        if (href && href.includes('#ftn')) {
            const anchorPart = href.substring(href.indexOf('#'));
            link.setAttribute('href', anchorPart);
        }

        // Preserve footnote links - they're critical for transformation
        if (href && (href.startsWith('#ftn') || href.startsWith('#ftnref'))) {
            // Keep footnote links as-is (now normalized)
            return;
        }

        // Remove target attributes (not needed)
        link.removeAttribute('target');
        link.removeAttribute('rel');

        // Ensure href is present for links
        if (!link.hasAttribute('href') && !link.hasAttribute('name')) {
            link.setAttribute('href', '#');
        }
    });

    // Remove unnecessary divs that are just wrappers
    const divs = doc.querySelectorAll('div[class*="field-items"], div[class*="field-item"]');
    divs.forEach(div => {
        div.removeAttribute('class');
    });
}

/**
 * Fix common XML serialization issues
 */
function fixSerializationIssues(htmlString) {
    // Remove xmlns attributes from XMLSerializer (we'll add proper XHTML namespace in XSLT)
    htmlString = htmlString.replace(/\sxmlns="[^"]*"/g, '');
    htmlString = htmlString.replace(/\sxmlns:[^=]+="[^"]*"/g, '');

    // Ensure void elements are properly self-closed
    // But avoid double-closing
    htmlString = htmlString.replace(/<br(?!\s*\/?>)([^>]*)>/gi, '<br$1/>');
    htmlString = htmlString.replace(/<hr(?!\s*\/?>)([^>]*)>/gi, '<hr$1/>');
    htmlString = htmlString.replace(/<img([^>]*?)(?<!\/)>/gi, '<img$1/>');
    htmlString = htmlString.replace(/<meta([^>]*?)(?<!\/)>/gi, '<meta$1/>');
    htmlString = htmlString.replace(/<link([^>]*?)(?<!\/)>/gi, '<link$1/>');
    htmlString = htmlString.replace(/<input([^>]*?)(?<!\/)>/gi, '<input$1/>');

    // Fix any double slashes that might have been created
    htmlString = htmlString.replace(/\/\/>/g, '/>');

    // Clean up whitespace around tags
    htmlString = htmlString.replace(/>\s+</g, '><');

    // Ensure proper nesting of <em>, <strong>, etc.
    // (This is hard to do with regex, but we can catch obvious issues)

    // Remove empty elements that XMLSerializer might have created
    htmlString = htmlString.replace(/<(\w+)([^>]*)><\/\1>/g, '');

    return htmlString;
}

/**
 * Alternative cleaning method using template element
 * This can be more robust for some HTML structures
 */
export function cleanBHOHTMLAlternative(htmlString) {
    console.log("=== ALTERNATIVE HTML CLEANING ===");

    try {
        // Create a template element - it can hold any HTML content safely
        const template = document.createElement('template');
        template.innerHTML = htmlString;

        // Get the content
        const content = template.content;

        // Find the article or main content
        const article = content.querySelector('article.node-benefactor') ||
            content.querySelector('article[class*="node-benefactor"]');

        if (!article) {
            console.warn("No article found in template method");
            return htmlString;
        }

        // Clone and clean
        const cleanArticle = article.cloneNode(true);

        // Remove scripts and styles
        cleanArticle.querySelectorAll('script, style').forEach(el => el.remove());

        // Create wrapper document
        const wrapper = document.implementation.createHTMLDocument("BHO-HTML");
        wrapper.body.appendChild(cleanArticle);

        // Serialize
        const serializer = new XMLSerializer();
        let result = '<!DOCTYPE html>\n' +
            serializer.serializeToString(wrapper.documentElement);

        result = fixSerializationIssues(result);

        console.log("Alternative cleaning complete");
        return result;

    } catch (error) {
        console.error("Alternative cleaning failed:", error);
        return htmlString;
    }
}

/**
 * Minimal cleaning - just ensure it's parseable
 * Use this if the main cleaning is too aggressive
 */
export function minimalCleanHTML(htmlString) {
    console.log("=== MINIMAL HTML CLEANING ===");

    try {
        // Just parse and re-serialize to ensure it's well-formed
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, "text/html");

        const serializer = new XMLSerializer();
        let result = serializer.serializeToString(doc.documentElement);

        // Add DOCTYPE
        if (!result.includes('<!DOCTYPE')) {
            result = '<!DOCTYPE html>\n' + result;
        }

        // Basic fixes
        result = result.replace(/\sxmlns="[^"]*"/g, '');
        result = fixSerializationIssues(result);

        return result;

    } catch (error) {
        console.error("Minimal cleaning failed:", error);
        return htmlString;
    }
}