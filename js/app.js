jQuery(document).ready(function ($) {

    // Set the workerSrc for PDF.js
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.7.570/pdf.worker.min.js';

    // Un-register Any Pre-existing Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(registrations => {
            registrations.forEach(registration => {
                registration.unregister();
            });
        });
    }

    // Initialise Bootstrap tooltips using JQuery
    $(document).ready(function() {
        $('body').tooltip({
            selector: '[data-bs-toggle="tooltip"]',
            html: true,
            trigger: 'manual',  // Manual control over show/hide
            boundary: 'window',  // Prevent tooltip from overflowing
        });

        // Show tooltip on mouse enter and hide on mouse leave (default is unreliable)
        $('[data-bs-toggle="tooltip"]').on('mouseenter', function() {
            $(this).tooltip('show');
        }).on('mouseleave', function() {
            $(this).tooltip('hide');
        });
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

        $('#conversionInputs').addClass('d-none');

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
            // Generate the ZIP file and store in session storage
            zip.generateAsync({type: 'blob'}).then(function (content) {
                // Convert blob to Base64 and save in session storage
                const reader = new FileReader();
                reader.onload = function () {
                    sessionStorage.setItem('preparedZip', reader.result);
                    showAlert('All XML files have been generated and zipped successfully! Click "XML Download" to save the file.', 'success');
                };
                reader.readAsDataURL(content); // Convert blob to Base64
            }).catch(err => {
                console.error('Error generating ZIP:', err);
                showAlert('Error generating ZIP. Please try again.', 'danger');
            });
        }).catch(err => {
            appendLogMessage(`Error processing files: ${err}`);
            console.error('Error processing files:', err);
        }).finally(() => {
            appendLogMessage('End of file processing.');
            appendLogMessage('=======================');
            $('#resultInputs').removeClass('d-none');
        });
    });

});
