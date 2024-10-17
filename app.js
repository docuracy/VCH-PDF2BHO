jQuery(document).ready(function ($) {
    // Set the workerSrc for PDF.js
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.7.570/pdf.worker.min.js';

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./service-worker.js')
            .then(reg => {
                console.log('Service Worker registered.', reg);
            })
            .catch(err => {
                console.error('Service Worker registration failed:', err);
            });
    }

    // Handle Convert Button Click
    $('#convertBtn').on('click', function () {
        const fileInput = $('#pdfInput')[0];
        if (fileInput.files.length === 0) {
            showAlert('Please select at least one PDF file.', 'warning');
            return;
        }

        const zip = new JSZip();
        const pdfFiles = Array.from(fileInput.files);

        const promises = pdfFiles.map(file => {
            return new Promise((resolve, reject) => {
                const fileReader = new FileReader();

                fileReader.onload = function () {
                    const typedarray = new Uint8Array(this.result);

                    pdfjsLib.getDocument(typedarray).promise.then(async (pdf) => {
                        let fullText = '';
                        let metadata = '';

                        try {
                            const meta = await pdf.getMetadata();
                            metadata += `<metadata><title>${escapeXML(meta.info.Title || 'Untitled')}</title><author>${escapeXML(meta.info.Author || 'Unknown')}</author></metadata>`;
                        } catch (metaErr) {
                            console.warn('Failed to retrieve metadata:', metaErr);
                        }

                        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                            const page = await pdf.getPage(pageNum);
                            const content = await page.getTextContent();
                            const strings = content.items.map(item => item.str);
                            fullText += `<page number="${pageNum}"><content>${escapeXML(strings.join(' '))}</content></page>`;
                        }

                        const xmlContent = `<document>${metadata}${fullText}</document>`;
                        // Add XML content to the ZIP file
                        zip.file(file.name.replace(/\.pdf$/i, '.xml'), xmlContent);
                        resolve();
                    }).catch(err => {
                        console.error('Error parsing PDF:', err);
                        showAlert('Failed to parse PDF: ' + file.name, 'danger');
                        reject(err);
                    });
                };

                fileReader.readAsArrayBuffer(file);
            });
        });

        Promise.all(promises).then(() => {
            // Generate the ZIP file and trigger download
            zip.generateAsync({ type: 'blob' }).then(function (content) {
                saveAs(content, 'pdfs_to_xml.zip');
                showAlert('All XML files have been generated and zipped successfully!', 'success');
            });
        }).catch(err => {
            console.error('Error processing files:', err);
        });
    });

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
