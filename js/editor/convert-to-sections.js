// Convert flat HTML with h2-h5 headings to nested section structure
export function convertToNestedSections(htmlString, pubid = "") {
    // Parse the HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    const body = doc.body;
    console.debug(doc)

    // Create article element
    const article = doc.createElement('article');
    if (pubid) {
        article.setAttribute('data-pubid', pubid);
    }

    // Find title (h2#title) and subtitle
    const title = body.querySelector('h2#title, h1#title');
    const subtitle = body.querySelector('p#subtitle');

    if (title) {
        const header = doc.createElement('header');
        header.textContent = title.textContent;
        article.appendChild(header);
        title.remove();
    }

    if (subtitle) {
        const subtitleP = doc.createElement('p');
        subtitleP.id = 'subtitle';
        subtitleP.textContent = subtitle.textContent;
        article.appendChild(subtitleP);
        subtitle.remove();
    }

    // Get all content nodes (everything except title/subtitle)
    const contentNodes = Array.from(body.childNodes);

    // Build nested section structure
    const sectionStack = [article]; // Stack to track current section nesting
    let currentSection = article;

    contentNodes.forEach(node => {
        // Skip empty text nodes
        if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) {
            return;
        }

        // Check if node is a heading (h3, h4, h5)
        if (node.nodeType === Node.ELEMENT_NODE && /^H[3-5]$/.test(node.tagName)) {
            const level = parseInt(node.tagName.charAt(1)); // 3, 4, or 5
            const targetDepth = level - 2; // h3=1, h4=2, h5=3

            // Close sections until we're at the right depth
            while (sectionStack.length > targetDepth) {
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

    // 2. Remove empty <p> tags (handling attributes and &nbsp;)
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

    console.debug(xhtml)
    return xhtml;
}