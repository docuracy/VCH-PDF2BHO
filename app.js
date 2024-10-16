// app.js

$(document).ready(function() {
    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/service-worker.js')
            .then(reg => {
                console.log('Service Worker registered.', reg);
            })
            .catch(err => {
                console.error('Service Worker registration failed:', err);
            });
    }

    // Handle Convert Button Click
    $('#convertBtn').on('click', function() {
        const fileInput = $('#pdfInput')[0];
        if (fileInput.files.length === 0) {
            showAlert('Please select a PDF file first.', 'warning');
            return;
        }

        const file = fileInput.files[0];
        const fileReader = new FileReader();

        fileReader.onload = function() {
            const typedarray = new Uint8Array(this.result);

            pdfjsLib.getDocument(typedarray).promise.then(async (pdf) => {
                let fullText = '';
                let metadata = '';

                try {
                    const meta = await pdf.getMetadata();
                    metadata += `  <metadata>
    <title>${escapeXML(meta.info.Title || 'Untitled')}</title>
    <author>${escapeXML(meta.info.Author || 'Unknown')}</author>
  </metadata>
`;
                } catch (metaErr) {
                    console.warn('Failed to retrieve metadata:', metaErr);
                }

                for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                    const page = await pdf.getPage(pageNum);
                    const content = await page.getTextContent();
                    const strings = content.items.map(item => item.str);
                    fullText += `  <page number="${pageNum}">
    <content>${escapeXML(strings.join(' '))}</content>
  </page>
`;
                }

                const xmlContent = `<document>
${metadata}${fullText}</document>`;

                downloadXML(xmlContent, file.name.replace(/\.pdf$/i, '.xml'));
                showAlert('XML file has been generated successfully!', 'success');
            }).catch(err => {
                console.error('Error parsing PDF:', err);
                showAlert('Failed to parse PDF.', 'danger');
            });
        };

        fileReader.readAsArrayBuffer(file);
    });

    // Function to Download XML using FileSaver.js
    function downloadXML(content, fileName) {
        const blob = new Blob([content], { type: 'application/xml;charset=utf-8' });
        saveAs(blob, fileName);
    }

    // Function to Escape XML Special Characters
    function escapeXML(str) {
        return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    // Function to Display Alerts
    function showAlert(message, type) {
        const alertHtml = `
      <div class="alert alert-${type} alert-dismissible fade show" role="alert">
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
      </div>`;
        $('#alertPlaceholder').html(alertHtml);
    }
});
