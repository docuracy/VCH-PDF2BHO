export async function generatePreview(xhtml) {
    const sizeKB = xhtml.length / 1024;
    console.log("XHTML length:", xhtml?.length);

    // Clear the iframe first
    const iframe = document.getElementById("preview-frame");
    if (iframe && iframe.contentDocument) {
        const doc = iframe.contentDocument;
        doc.open();
        doc.write(`<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      background: #f5f5f5;
    }
    .loading-container {
      text-align: center;
      padding: 40px;
    }
    .spinner {
      border: 4px solid #f3f3f3;
      border-top: 4px solid #3498db;
      border-radius: 50%;
      width: 50px;
      height: 50px;
      animation: spin 1s linear infinite;
      margin: 0 auto 20px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .loading-text {
      color: #333;
      font-size: 16px;
    }
    .loading-detail {
      color: #666;
      font-size: 14px;
      margin-top: 10px;
    }
    .timer {
      color: #999;
      font-size: 13px;
      margin-top: 15px;
      font-family: monospace;
    }
  </style>
</head>
<body>
  <div class="loading-container">
    <div class="spinner"></div>
    <div class="loading-text">Transforming document...</div>
    <div class="loading-detail">${sizeKB.toFixed(0)} KB</div>
  </div>
</body>
</html>`);
        doc.close();
    }

    // Yield to browser to render spinner
    await new Promise(resolve => setTimeout(resolve, 100));

    // Try SaxonJS first if available (access via window in ES modules)
    if (typeof window.SaxonJS !== 'undefined') {
        try {
            console.log("Using SaxonJS for transformation");
            await generatePreviewWithSaxonJS(xhtml);
            return;
        } catch (saxonError) {
            console.warn("SaxonJS failed:", saxonError.message);
            console.log("Falling back to native XSLT...");
            // Don't throw - fall through to native XSLT
        }
    } else {
        console.log("SaxonJS not available, using native XSLT");
    }

    // Fallback to native XSLT 1.0
    await generatePreviewNative(xhtml);
}

async function generatePreviewWithSaxonJS(xmlString) {
    // Build sef from XSLT file using:
    // npx xslt3 -t -xsl:xhtml-view/xsl/xhtml.xsl -export:xhtml-view/xsl/xhtml.sef.json -nogo -ns:##html5

    const sefUrl = "./xhtml-view/xsl/xhtml.sef.json";

    try {
        console.log("Loading SEF file:", sefUrl);

        // Run XSLT 3.0 - use "serialized" for HTML string output
        const result = await window.SaxonJS.transform({
            stylesheetLocation: sefUrl,
            sourceText: xmlString,
            destination: "serialized"
        }, "async");

        console.log("SaxonJS transformation complete");

        // Get the HTML string
        let htmlOutput = result.principalResult;

        if (!htmlOutput || typeof htmlOutput !== 'string') {
            throw new Error("No HTML output from transformation");
        }

        console.log("HTML output length:", htmlOutput.length);

        // Clean up for HTML5:
        // 1. Remove XML declaration
        htmlOutput = htmlOutput.replace(/<\?xml[^?]*\?>\s*/i, '');
        // 2. Remove XHTML namespace declaration
        htmlOutput = htmlOutput.replace(/\sxmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '');
        // 3. Fix self-closing void elements (remove trailing slash)
        htmlOutput = htmlOutput.replace(/<(meta|link|br|hr|img|input)([^>]*?)\s*\/>/gi, '<$1$2>');

        // Inject CSS link into the head if not present
        if (!htmlOutput.includes('xhtml.css')) {
            htmlOutput = htmlOutput.replace(
                '</head>',
                '<link rel="stylesheet" href="./xhtml-view/css/xhtml.css"/>\n</head>'
            );
        }

        // Write cleanly to iframe
        const iframe = document.getElementById("preview-frame");

        // Clear the timer interval if it exists
        if (iframe.contentWindow.loadingTimerInterval) {
            clearInterval(iframe.contentWindow.loadingTimerInterval);
        }

        const doc = iframe.contentDocument;
        doc.open();
        doc.write(htmlOutput);
        doc.close();

        window.transformedHTML = doc.documentElement.outerHTML;

        console.log("SaxonJS preview rendered successfully");

    } catch (e) {
        console.error("Saxon-JS Transformation Error:", e);
        throw new Error("SaxonJS transformation failed: " + e.message);
    }
}

async function generatePreviewNative(xhtml) {
    try {
        console.log("Native XSLT: Loading stylesheet...");
        if (!window.bhoXSLT) {
            const resp = await fetch("xhtml-view/xsl/xhtml.xsl");
            const txt = await resp.text();
            window.bhoXSLT = new DOMParser().parseFromString(txt, "application/xml");
            console.log("Native XSLT: Stylesheet loaded");
        }

        console.log("Native XSLT: Parsing input XHTML...");
        console.log("Native XSLT: Input preview:", xhtml.substring(0, 500));
        const xmlDoc = new DOMParser().parseFromString(xhtml, "application/xml");
        console.log("Native XSLT: Parsed XML doc:", xmlDoc);
        console.log("Native XSLT: Document element:", xmlDoc.documentElement?.tagName);

        const parseError = xmlDoc.getElementsByTagName("parsererror")[0];
        if (parseError) {
            console.error("Native XSLT: XML parse error:", parseError.textContent);
            throw new Error("Invalid XHTML: " + parseError.textContent);
        }

        console.log("Native XSLT: Creating processor and importing stylesheet...");
        const proc = new XSLTProcessor();
        proc.importStylesheet(window.bhoXSLT);

        console.log("Native XSLT: Transforming to document...");
        const resultDoc = proc.transformToDocument(xmlDoc);
        console.log("Native XSLT: Transform result:", resultDoc);
        console.log("Native XSLT: Result document element:", resultDoc?.documentElement);

        if (!resultDoc || !resultDoc.documentElement) {
            console.error("Native XSLT: Transformation returned null or no document element");
            console.log("Native XSLT: Trying transformToFragment instead...");

            const resultFragment = proc.transformToFragment(xmlDoc, document);
            console.log("Native XSLT: Fragment result:", resultFragment);
            console.log("Native XSLT: Fragment has children:", resultFragment?.childNodes?.length);

            if (!resultFragment || !resultFragment.firstChild) {
                throw new Error("XSLT transformation produced no output (both document and fragment failed)");
            }

            // Use the fragment result
            const tempDiv = document.createElement('div');
            tempDiv.appendChild(resultFragment.cloneNode(true));
            let htmlOutput = tempDiv.innerHTML;

            // Wrap in HTML structure if not already there
            if (!htmlOutput.includes('<html')) {
                htmlOutput = `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="./xhtml-view/css/xhtml.css"/>
</head>
<body>
${htmlOutput}
</body>
</html>`;
            }

            // Write to iframe
            const iframe = document.getElementById("preview-frame");

            // Clear the timer interval if it exists
            if (iframe.contentWindow.loadingTimerInterval) {
                clearInterval(iframe.contentWindow.loadingTimerInterval);
            }

            const doc = iframe.contentDocument;
            doc.open();
            doc.write(htmlOutput);
            doc.close();

            window.transformedHTML = doc.documentElement.outerHTML;
            console.log("Native XSLT: Preview rendered using fragment");
            return;
        }

        console.log("Native XSLT: Serializing result...");
        const serializer = new XMLSerializer();
        let htmlOutput = serializer.serializeToString(resultDoc);

        // Clean up for HTML5:
        // 1. Remove XML declaration
        htmlOutput = htmlOutput.replace(/<\?xml[^?]*\?>\s*/i, '');
        // 2. Remove XHTML namespace declarations
        htmlOutput = htmlOutput.replace(/\sxmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '');
        htmlOutput = htmlOutput.replace(/\sxmlns:xml="[^"]*"/g, '');
        // 3. Fix self-closing void elements (remove trailing slash)
        htmlOutput = htmlOutput.replace(/<(meta|link|br|hr|img|input)([^>]*?)\s*\/>/gi, '<$1$2>');

        // Add CSS if not present
        if (!htmlOutput.includes('xhtml.css')) {
            htmlOutput = htmlOutput.replace(
                '</head>',
                '<link rel="stylesheet" href="./xhtml-view/css/xhtml.css"/>\n</head>'
            );
        }

        console.log("Native XSLT: Writing to iframe...");
        const iframe = document.getElementById("preview-frame");

        // Clear the timer interval if it exists
        if (iframe.contentWindow.loadingTimerInterval) {
            clearInterval(iframe.contentWindow.loadingTimerInterval);
        }

        const doc = iframe.contentDocument;
        doc.open();
        doc.write(htmlOutput);
        doc.close();

        window.transformedHTML = doc.documentElement.outerHTML;
        console.log("Native XSLT: Preview rendered successfully");
    } catch (error) {
        console.error("Error in native preview:", error);
        alert("Preview error: " + error.message);
        throw error;
    }
}

export async function convertToBHO() {
    console.log("=== BHO CONVERSION START ===");

    // Get the HTML from the preview iframe
    const iframe = document.getElementById("preview-frame");
    if (!iframe || !iframe.contentDocument) {
        alert("No preview available. Please generate a preview first.");
        return null;
    }

    const htmlDoc = iframe.contentDocument;

    // Serialize as XML to ensure proper self-closing tags
    const serializer = new XMLSerializer();
    let htmlString = serializer.serializeToString(htmlDoc.documentElement);

    // Clean up problematic attributes and namespaces from XMLSerializer output
    htmlString = htmlString.replace(/\sxmlns="[^"]*"/g, ''); // Remove xmlns attributes
    htmlString = htmlString.replace(/\sxmlns:[^=]+="[^"]*"/g, ''); // Remove xmlns:prefix attributes
    htmlString = htmlString.replace(/<html[^>]*>/i, '<html>'); // Simplify html tag

    // Fix void elements - ensure they're self-closing (but avoid double slashes)
    // Only add / if it's not already there
    htmlString = htmlString.replace(/<link([^>]*?)(?<!\/)>/g, '<link$1/>');
    htmlString = htmlString.replace(/<meta([^>]*?)(?<!\/)>/g, '<meta$1/>');
    htmlString = htmlString.replace(/<br(?!\/)>/g, '<br/>');
    htmlString = htmlString.replace(/<hr(?!\/)>/g, '<hr/>');
    htmlString = htmlString.replace(/<img([^>]*?)(?<!\/)>/g, '<img$1/>');
    htmlString = htmlString.replace(/<input([^>]*?)(?<!\/)>/g, '<input$1/>');

    console.log("HTML to convert (length):", htmlString.length);
    console.log("HTML preview:", htmlString.substring(0, 1000));

    // Use SaxonJS for BHO conversion (access via window in ES modules)
    console.log("Checking SaxonJS availability...");
    console.log("typeof window.SaxonJS:", typeof window.SaxonJS);
    console.log("window.SaxonJS:", window.SaxonJS);

    if (typeof window.SaxonJS === 'undefined') {
        console.error("SaxonJS is not defined!");
        alert("SaxonJS is required for BHO conversion but is not loaded.\n\nPlease ensure you have an internet connection and refresh the page.");
        return null;
    }

    console.log("SaxonJS is available:", window.SaxonJS);

    // Build sef from XSLT file using:
    // npx xslt3 -t -xsl:xhtml-view/xsl/html-to-bho.xsl -export:xhtml-view/xsl/html-to-bho.sef.json -nogo -ns:##html5
    const sefUrl = "./xhtml-view/xsl/html-to-bho.sef.json";

    try {
        console.log("Loading BHO SEF file:", sefUrl);

        // Run XSLT transformation
        const result = await window.SaxonJS.transform({
            stylesheetLocation: sefUrl,
            sourceText: htmlString,
            destination: "serialized"
        }, "async");

        console.log("BHO transformation complete");

        let bhoXml = result.principalResult;
        console.log("BHO XML length:", bhoXml.length);
        console.log("BHO XML preview:", bhoXml.substring(0, 500));

        return bhoXml;

    } catch (error) {
        console.error("BHO conversion error:", error);
        console.error("HTML that failed:", htmlString.substring(0, 2000));
        alert("BHO conversion failed: " + error.message + "\n\nCheck console for details.");
        return null;
    }
}