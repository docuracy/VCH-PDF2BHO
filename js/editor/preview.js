export async function generatePreview(xhtml) {
    if (!window.bhoXSLT) {
        const resp = await fetch("xsl/bho-transform.xsl");
        const txt = await resp.text();
        window.bhoXSLT = new DOMParser()
            .parseFromString(txt, "application/xml");
    }

    const xmlDoc = new DOMParser()
        .parseFromString(xhtml, "application/xml");

    const proc = new XSLTProcessor();
    proc.importStylesheet(window.bhoXSLT);

    const result = proc.transformToFragment(xmlDoc, document);

    const iframe = document.getElementById("preview-frame");
    const doc = iframe.contentDocument;
    doc.open();
    doc.write("<!DOCTYPE html><html><head></head><body></body></html>");
    doc.body.appendChild(result);
    doc.close();
}
