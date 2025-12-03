// Convert flat HTML with heading[font-signature] tags to nested section structure
export function convertToNestedSections(htmlString, pubid = "") {
    // Parse the HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    const body = doc.body;
    console.debug(doc);

    // Create article element
    const article = doc.createElement('article');
    if (pubid) {
        article.setAttribute('data-pubid', pubid);
    }

    // Find all headings in document order
    const allHeadings = Array.from(body.querySelectorAll('heading[font-signature]'));

    if (allHeadings.length === 0) {
        console.warn('No headings found in document');
        return htmlString;
    }

    // Build font signature hierarchy based on order of first appearance
    const fontSignatureMap = new Map(); // font-signature -> level
    let currentLevel = 1;

    allHeadings.forEach(heading => {
        const fontSig = heading.getAttribute('font-signature');
        if (fontSig && !fontSignatureMap.has(fontSig)) {
            fontSignatureMap.set(fontSig, currentLevel);
            currentLevel++;
        }
    });

    console.debug('Font signature hierarchy:', Array.from(fontSignatureMap.entries()));

    // First heading becomes both title and first header
    const firstHeading = allHeadings[0];
    const titleText = firstHeading.textContent;

    // Add title element
    const title = doc.createElement('title');
    title.textContent = titleText;
    article.appendChild(title);

    // Add first header element
    const firstHeader = doc.createElement('header');
    firstHeader.textContent = titleText;
    article.appendChild(firstHeader);

    // Remove first heading from DOM so it doesn't get processed again
    firstHeading.remove();

    // Get all content nodes (everything in body)
    const contentNodes = Array.from(body.childNodes);

    // Build nested section structure
    const sectionStack = [article]; // Stack to track current section nesting
    let currentSection = article;

    contentNodes.forEach(node => {
        // Skip empty text nodes
        if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) {
            return;
        }

        // Check if node is a heading with font-signature
        if (node.nodeType === Node.ELEMENT_NODE &&
            node.tagName === 'HEADING' &&
            node.hasAttribute('font-signature')) {

            const fontSig = node.getAttribute('font-signature');
            const level = fontSignatureMap.get(fontSig);

            if (level === undefined) {
                console.warn('Unknown font signature:', fontSig);
                currentSection.appendChild(node.cloneNode(true));
                return;
            }

            // Close sections until we're at the right depth
            while (sectionStack.length > level) {
                sectionStack.pop();
            }

            // Create new section
            const newSection = doc.createElement('section');
            const header = doc.createElement('header');
            header.textContent = node.textContent;
            newSection.appendChild(header);

            // Add to parent section
            currentSection = sectionStack[sectionStack.length - 1];
            currentSection.appendChild(newSection);

            // Push onto stack
            sectionStack.push(newSection);
            currentSection = newSection;
        } else {
            // Regular content - add to current section
            if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
                currentSection.appendChild(node.cloneNode(true));
            }
        }
    });

    // Create final XHTML document
    const serializer = new XMLSerializer();
    let articleHTML = serializer.serializeToString(article);

    // Reduce multiple consecutive spaces to single spaces
    articleHTML = articleHTML.replace(/ {2,}/g, ' ');

    // Remove empty <p> tags (handling attributes and &nbsp;)
    articleHTML = articleHTML.replace(/<p[^>]*>(?:\s|&nbsp;)*<\/p>/gi, '');

    const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
    <meta charset="UTF-8"/>
    <meta content="application/xhtml+xml"/>
</head>
<body>
${articleHTML}
</body>
</html>`;

    return xhtml;
}