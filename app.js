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
            showAlert('Please select at least one PDF or ZIP file.', 'warning');
            return;
        }

        const zip = new JSZip();  // Initialize the JSZip instance here
        const pdfFiles = Array.from(fileInput.files);
        const promises = [];

        // Iterate through selected files
        pdfFiles.forEach(file => {
            const extension = file.name.split('.').pop().toLowerCase();
            const fileType = (extension === 'pdf') ? 'application/pdf' :
                (extension === 'zip') ? 'application/zip' : '';

            console.log(`Processing file: ${file.name}, extension: ${extension}, type: ${fileType}`); // Debugging log
            if (fileType === 'application/zip') {
                const zipFileReaderPromise = new Promise((resolve, reject) => {
                    const zipFileReader = new FileReader();
                    zipFileReader.onload = function (event) {
                        const arrayBuffer = event.target.result;

                        // Load the ZIP file from the ArrayBuffer
                        JSZip.loadAsync(arrayBuffer).then(zipContent => {
                            const pdfPromises = Object.keys(zipContent.files).map(pdfFileName => {
                                if (pdfFileName.endsWith('.pdf')) {
                                    return zipContent.files[pdfFileName].async('blob').then(blob => {
                                        // Process the PDF and return the promise
                                        return processPDF(blob, pdfFileName, zip);
                                    });
                                }
                            }).filter(Boolean); // Filter out undefined values (non-PDF files)

                            // Ensure all PDF promises resolve before completing the ZIP processing
                            return Promise.all(pdfPromises);
                        }).then(() => {
                            console.log(`Processed all PDFs in ZIP: ${file.name}`);
                            resolve(); // Resolve the outer promise when done
                        }).catch(err => {
                            console.error('Error processing ZIP file:', err);
                            reject(err); // Reject the outer promise if there's an error
                        });
                    };
                    zipFileReader.onerror = (err) => {
                        reject(err); // Reject if FileReader fails
                    };
                    zipFileReader.readAsArrayBuffer(file);
                });

                // Push the zip file reader promise to the promises array
                promises.push(zipFileReaderPromise);
            } else if (fileType === 'application/pdf') {
                // Process single PDF files directly
                promises.push(processPDF(file, file.name, zip)); // Pass the zip object to processPDF
            } else {
                showAlert('Unsupported file type: ' + file.name, 'danger');
            }
        });

        // Wait for all promises to resolve
        Promise.all(promises).then(() => {
            console.log('All PDF files processed successfully. Generating ZIP...'); // Debugging log
            // Generate the ZIP file and trigger download
            zip.generateAsync({ type: 'blob' }).then(function (content) {
                saveAs(content, 'pdfs_to_xml.zip');
                showAlert('All XML files have been generated and zipped successfully!', 'success');
            }).catch(err => {
                console.error('Error generating ZIP:', err);
            });
        }).catch(err => {
            console.error('Error processing files:', err);
        });
    });

    // Function to process PDF files
    function processPDF(file, fileName, zip) {  // Accept zip as a parameter
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
                    console.log(`Generated XML for file: ${fileName}, size: ${xmlContent.length} characters`); // Debugging log
                    // Add XML content to the ZIP file
                    zip.file(fileName.replace(/\.pdf$/i, '.xml'), xmlContent); // Use the passed zip object
                    resolve();
                }).catch(err => {
                    console.error('Error parsing PDF:', err);
                    showAlert('Failed to parse PDF: ' + fileName, 'danger');
                    reject(err);
                });
            };

            fileReader.readAsArrayBuffer(file);
        });
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
