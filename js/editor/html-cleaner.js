/**
 * Clean and prepare BHO-HTML for XSLT transformation
 * Converts potentially malformed HTML into well-formed XHTML
 */
export function cleanBHOHTML(htmlString) {
    console.log("=== CLEANING BHO HTML ===");
    console.log("Input length:", htmlString.length);

    try {
        const parser = new DOMParser();
        const htmlDoc = parser.parseFromString(htmlString, "text/html");

        const parserError = htmlDoc.querySelector('parsererror');
        if (parserError) {
            console.warn("HTML parse warning:", parserError.textContent);
        }

        const article = htmlDoc.querySelector('article');
        if (!article) {
            console.warn("No article element found, using full document");
        }

        const cleanDoc = document.implementation.createHTMLDocument("BHO-HTML");
        const html = cleanDoc.documentElement;
        html.setAttribute('lang', 'en');
        html.setAttribute('dir', 'ltr');

        if (article) {
            const h1 = htmlDoc.querySelector('h1.title, h1[id*="title"]') || htmlDoc.querySelector('h1');
            const clonedArticle = article.cloneNode(true);

            if (h1 && !clonedArticle.querySelector('h1')) {
                const clonedH1 = h1.cloneNode(true);
                clonedArticle.insertBefore(clonedH1, clonedArticle.firstChild);
            }

            cleanDoc.body.appendChild(clonedArticle);
        } else {
            const originalBody = htmlDoc.body;
            if (originalBody) {
                Array.from(originalBody.childNodes).forEach(node => {
                    cleanDoc.body.appendChild(node.cloneNode(true));
                });
            }
        }

        cleanHTML(cleanDoc);

        const serializer = new XMLSerializer();
        let cleanedHTML = serializer.serializeToString(cleanDoc.documentElement);
        cleanedHTML = '<!DOCTYPE html>\n' + cleanedHTML;
        cleanedHTML = fixSerializationIssues(cleanedHTML);

        console.log("Cleaned HTML length:", cleanedHTML.length);
        console.log("Cleaned HTML preview:", cleanedHTML.substring(0, 500));
        console.log("=== HTML CLEANING COMPLETE ===");

        return cleanedHTML;

    } catch (error) {
        console.error("HTML cleaning error:", error);
        console.warn("Returning original HTML due to cleaning error");
        return htmlString;
    }
}

function cleanHTML(doc) {
    doc.querySelectorAll('script, style').forEach(el => el.remove());

    const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_COMMENT, null, false);
    const comments = [];
    let node;
    while (node = walker.nextNode()) {
        comments.push(node);
    }
    comments.forEach(comment => comment.remove());

    doc.querySelectorAll('p:empty, div:empty').forEach(el => {
        if (el.tagName === 'DIV' && el.id && el.id.startsWith('ftn')) return;
        if (!el.hasChildNodes() && !el.hasAttributes()) el.remove();
    });

    // Extract images from paragraphs
    doc.querySelectorAll('img').forEach(img => {
        img.removeAttribute('style');
        img.removeAttribute('class');
        if (!img.getAttribute('src')) img.setAttribute('src', '');
        if (!img.getAttribute('title')) img.setAttribute('title', img.getAttribute('alt') || '');

        const parentP = img.closest('p');
        if (parentP) {
            // Clone the image and insert it before the paragraph
            const clonedImg = img.cloneNode(true);
            parentP.parentNode.insertBefore(clonedImg, parentP);

            // Remove the image from inside the paragraph
            img.remove();
        }
    });

    doc.querySelectorAll('a').forEach(link => {
        const href = link.getAttribute('href');
        if (href && href.includes('#ftn')) {
            link.setAttribute('href', href.substring(href.indexOf('#')));
        }
        if (href && (href.startsWith('#ftn') || href.startsWith('#ftnref'))) return;

        link.removeAttribute('target');
        link.removeAttribute('rel');
        if (!link.hasAttribute('href') && !link.hasAttribute('name')) {
            link.setAttribute('href', '#');
        }
    });

    doc.querySelectorAll('div[class*="field-items"], div[class*="field-item"]').forEach(div => {
        div.removeAttribute('class');
    });
}

function fixSerializationIssues(htmlString) {
    htmlString = htmlString.replace(/\sxmlns="[^"]*"/g, '');
    htmlString = htmlString.replace(/\sxmlns:[^=]+="[^"]*"/g, '');
    htmlString = htmlString.replace(/<br(?!\s*\/?>)([^>]*)>/gi, '<br$1/>');
    htmlString = htmlString.replace(/<hr(?!\s*\/?>)([^>]*)>/gi, '<hr$1/>');
    htmlString = htmlString.replace(/<img([^>]*?)(?<!\/)>/gi, '<img$1/>');
    htmlString = htmlString.replace(/<meta([^>]*?)(?<!\/)>/gi, '<meta$1/>');
    htmlString = htmlString.replace(/<link([^>]*?)(?<!\/)>/gi, '<link$1/>');
    htmlString = htmlString.replace(/<input([^>]*?)(?<!\/)>/gi, '<input$1/>');
    htmlString = htmlString.replace(/\/\/>/g, '/>');
    htmlString = htmlString.replace(/>\s+</g, '><');
    htmlString = htmlString.replace(/<(\w+)([^>]*)><\/\1>/g, '');
    return htmlString;
}

export function minimalCleanHTML(htmlString) {
    console.log("=== MINIMAL HTML CLEANING ===");
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, "text/html");
        const serializer = new XMLSerializer();
        let result = serializer.serializeToString(doc.documentElement);
        if (!result.includes('<!DOCTYPE')) result = '<!DOCTYPE html>\n' + result;
        result = result.replace(/\sxmlns="[^"]*"/g, '');
        result = fixSerializationIssues(result);
        return result;
    } catch (error) {
        console.error("Minimal cleaning failed:", error);
        return htmlString;
    }
}