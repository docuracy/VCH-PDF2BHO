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

    // Clear logContainer when files are chosen
    $('#pdfInput').on('change', function () {
        $('#alertPlaceholder').empty(); // Clear any existing alerts
        $('#logContainer').hide().html('<p><strong>Logs:</strong></p>'); // Clear the log container
    });

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

            appendLogMessage(`Processing file: ${file.name}, extension: ${extension}, type: ${fileType}`); // Debugging log
            if (fileType === 'application/zip') {
                const zipFileReaderPromise = new Promise((resolve, reject) => {
                    const zipFileReader = new FileReader();
                    zipFileReader.onload = function (event) {
                        const arrayBuffer = event.target.result;

                        // Load the ZIP file from the ArrayBuffer
                        JSZip.loadAsync(arrayBuffer).then(zipContent => {
                            appendLogMessage(`Loaded ZIP file: ${file.name}`);
                            const pdfPromises = Object.keys(zipContent.files).map(pdfFileName => {
                                if (pdfFileName.endsWith('.pdf')) {
                                    appendLogMessage(`Found PDF in ZIP: ${pdfFileName}`);
                                    return zipContent.files[pdfFileName].async('blob').then(blob => {
                                        // Process the PDF and return the promise
                                        return processPDF(blob, pdfFileName, zip);
                                    });
                                }
                            }).filter(Boolean); // Filter out undefined values (non-PDF files)

                            // Ensure all PDF promises resolve before completing the ZIP processing
                            return Promise.all(pdfPromises);
                        }).then(() => {
                            appendLogMessage(`Processed all PDFs in ZIP: ${file.name}`);
                            resolve(); // Resolve the outer promise when done
                        }).catch(err => {
                            appendLogMessage(`Error processing ZIP file: ${err}`);
                            console.error('Error processing ZIP file:', err);
                            reject(err); // Reject the outer promise if there's an error
                        });
                    };
                    zipFileReader.onerror = (err) => {
                        appendLogMessage(`Error reading ZIP file: ${err}`);
                        console.error('Error reading ZIP file:', err);
                        reject(err); // Reject if FileReader fails
                    };
                    zipFileReader.readAsArrayBuffer(file);
                });

                // Push the zip file reader promise to the promises array
                promises.push(zipFileReaderPromise);
            } else if (fileType === 'application/pdf') {
                // Process single PDF files directly
                appendLogMessage(`Processing PDF file: ${file.name}`);
                promises.push(processPDF(file, file.name, zip)); // Pass the zip object to processPDF
            } else {
                showAlert('Unsupported file type: ' + file.name, 'danger');
            }
        });

        // Wait for all promises to resolve
        Promise.all(promises).then(() => {
            appendLogMessage('All PDF files processed successfully. Generating ZIP...');
            // Generate the ZIP file and trigger download
            zip.generateAsync({ type: 'blob' }).then(function (content) {
                saveAs(content, 'pdfs_to_xml.zip');
                showAlert('All XML files have been generated and zipped successfully!', 'success');
            }).catch(err => {
                appendLogMessage(`Error generating ZIP: ${err}`);
                console.error('Error generating ZIP:', err);
            });
        }).catch(err => {
            appendLogMessage(`Error processing files: ${err}`);
            console.error('Error processing files:', err);
        }).finally(() => {
            appendLogMessage('End of file processing.');
            appendLogMessage('=======================');
        });
    });

    // Function to process PDF files
    function processPDF(file, fileName, zip) {  // Accept zip as a parameter
        return new Promise((resolve, reject) => {
            const fileReader = new FileReader();
            fileReader.onload = function () {
                let typedarray = new Uint8Array(this.result);
                pdfjsLib.getDocument(typedarray).promise.then(async (pdf) => {
                    let fullText = '';
                    let metadata = '';

                    try {
                        const meta = await pdf.getMetadata();
                        metadata += `<metadata><title>${escapeXML(meta.info.Title || 'Untitled')}</title><author>${escapeXML(meta.info.Author || 'Unknown')}</author><filename>${escapeXML(fileName)}</filename></metadata>`;
                    } catch (metaErr) {
                        console.warn('Failed to retrieve metadata:', metaErr);
                    }

                    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                        const page = await pdf.getPage(pageNum);
                        const content = await page.getTextContent();

                        // Create an XML representation of the page content
                        let pageContent = '';
                        content.items.forEach(item => {
                            // Construct the item XML tag with attributes
                            const itemXML = `<item fontName="${escapeXML(item.fontName)}" fontSize="${escapeXML(item.fontSize)}" width="${escapeXML(item.width)}" height="${escapeXML(item.height)}" textDirection="${escapeXML(item.dir)}">${escapeXML(item.str)}</item>`;
                            pageContent += itemXML;
                        });

                        // Append the constructed page content to fullText
                        fullText += `<page number="${pageNum}"><content>${pageContent}</content></page>`;
                    }

                    const xmlContent = `<document>${metadata}${fullText}</document>`;
                    appendLogMessage(`Generated XML for file: ${fileName}, size: ${xmlContent.length} characters`); // Debugging log

                    // Fetch the XSLT file
                    const xsltResponse = await fetch('./transform.xslt');
                    const xsltText = await xsltResponse.text();

                    // Transform the XML using XSLT
                    const transformedXml = transformXml(xmlContent, xsltText);
                    appendLogMessage(`Transformed XML for file: ${fileName}, size: ${transformedXml.length} characters`); // Debugging log

                    // Add the transformed XML content to the ZIP file
                    zip.file(fileName.replace(/\.pdf$/i, '.xml'), transformedXml); // Use the passed zip object
                    resolve();
                }).catch(err => {
                    console.error('Error parsing PDF:', err);
                    showAlert('Failed to parse PDF: ' + fileName, 'danger');
                    reject(err);
                }).finally(() => {
                    // Clean up references to potentially large objects to aid garbage collection
                    typedarray = null;
                    pdf = null;
                });
            };

            fileReader.readAsArrayBuffer(file);
        });
    }

    // Function to Escape XML Special Characters
    function escapeXML(input) {
        const str = (input != null) ? String(input) : '';
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

    function appendLogMessage(message) {
        const logContainer = $('#logContainer');
        logContainer.append('<p>' + message + '</p>').show();
        logContainer.scrollTop(logContainer.prop("scrollHeight"));
    }

    function transformXml(xml, xslt) {
        // Create a new XSLTProcessor
        const xsltProcessor = new XSLTProcessor();

        // Parse the XSLT string into a document
        const parser = new DOMParser();
        const xsltDoc = parser.parseFromString(xslt, 'application/xml');

        // Import the XSLT stylesheet
        xsltProcessor.importStylesheet(xsltDoc);

        // Parse the XML string into a document
        const xmlDoc = parser.parseFromString(xml, 'application/xml');

        // Perform the transformation
        const transformedDoc = xsltProcessor.transformToFragment(xmlDoc, document);

        // Serialize the transformed document back to a string
        const serializer = new XMLSerializer();
        return serializer.serializeToString(transformedDoc);
    }

});
