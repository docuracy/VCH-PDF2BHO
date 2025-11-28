export async function generatePreview(xhtml) {
    // Clear the iframe first
    const iframe = document.getElementById("preview-frame");
    if (iframe && iframe.contentDocument) {
        const doc = iframe.contentDocument;
        doc.open();
        doc.write('<html><head></head><body><p>Loading preview...</p></body></html>');
        doc.close();
    }

    // Try SaxonJS first if available
    if (typeof SaxonJS !== 'undefined') {
        try {
            console.log("Using SaxonJS for transformation");
            await generatePreviewWithSaxonJS(xhtml, iframe);
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
    await generatePreviewNative(xhtml, iframe);
}

async function generatePreviewWithSaxonJS(xmlString, iframe) {
    // Generate SEF from XSLT using this command-line tool:
    // npx xslt3 -t -xsl:xhtml-view/xsl/xhtml.xsl -export:xhtml-view/xsl/xhtml.sef.json -nogo -ns:##html5
    const sefUrl = "./xhtml-view/xsl/xhtml.sef.json";

    try {
        console.log("Loading SEF file:", sefUrl);

        // Run XSLT 3.0 - use "serialized" for HTML string output
        const result = await SaxonJS.transform({
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

        // Inject CSS link into the head if not present
        if (!htmlOutput.includes('xhtml.css')) {
            htmlOutput = htmlOutput.replace(
                '</head>',
                '<link rel="stylesheet" href="./xhtml-view/css/xhtml.css"/>\n</head>'
            );
        }

        // Write cleanly to iframe
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

async function generatePreviewNative(xhtml, iframe) {
    try {
        if (!window.bhoXSLT) {
            const resp = await fetch("xhtml-view/xsl/xhtml.xsl");
            const txt = await resp.text();
            window.bhoXSLT = new DOMParser().parseFromString(txt, "application/xml");
        }

        const xmlDoc = new DOMParser().parseFromString(xhtml, "application/xml");

        const parseError = xmlDoc.getElementsByTagName("parsererror")[0];
        if (parseError) {
            throw new Error("Invalid XHTML: " + parseError.textContent);
        }

        const proc = new XSLTProcessor();
        proc.importStylesheet(window.bhoXSLT);
        const resultDoc = proc.transformToDocument(xmlDoc);

        if (!resultDoc || !resultDoc.documentElement) {
            throw new Error("XSLT transformation produced no output");
        }

        // Serialize to string
        const serializer = new XMLSerializer();
        let htmlOutput = serializer.serializeToString(resultDoc);

        // Add CSS if not present
        if (!htmlOutput.includes('xhtml.css')) {
            htmlOutput = htmlOutput.replace(
                '</head>',
                '<link rel="stylesheet" href="./xhtml-view/css/xhtml.css"/>\n</head>'
            );
        }

        // Write to iframe
        const doc = iframe.contentDocument;
        doc.open();
        doc.write(htmlOutput);
        doc.close();

        window.transformedHTML = doc.documentElement.outerHTML;
    } catch (error) {
        console.error("Error in native preview:", error);
        alert("Preview error: " + error.message);
        throw error;
    }
}