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

    // Function to process PDF files
    function processPDF(file, fileName, zip) {  // Accept zip as a parameter
        return new Promise((resolve, reject) => {
            const fileReader = new FileReader();
            fileReader.onload = function () {
                let typedarray = new Uint8Array(this.result);
                pdfjsLib.getDocument(typedarray).promise.then(async (pdf) => {

                    // TODO:
                    // Refactor as multi-pass operation over items: add attributes on the first pass (for-loop), then process on the second pass (while-loop)
                    // Track the x-position and width of consecutive items to determine whether a space should be inserted
                    // Track the y-position and height of consecutive items to determine whether a new paragraph should be started: might need a separate line-height tracker
                    // Determine whether a font is bold, italic, regular, small-caps, etc.
                    // Switch tags to <p>, <h>, or other tags based on font size and style
                    // Add `review` class to anything that needs to be reviewed manually
                    // Generate HTML initially and render in browser for checking, then convert to BHO-compliant XML using refactored `.xslt` file and `transformXml` function

                    let docHTML = '';
                    let currentEndNote = 1;
                    let footnoteMappings = [];

                    // Iterate over pages and process content
                    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {

                        // Call helper function to get content and font map
                        const { content, fontMap } = await getPageContentAndFonts(pdf, pageNum);

                        // Calculate and append fontSize to each style
                        Object.keys(content.styles).forEach(styleKey => {
                            const style = content.styles[styleKey];
                            style.fontSize = (style?.ascent && style?.descent) ? (style.ascent - style.descent) : 0;
                        });

                        let pageHTML = '';
                        let lastAttributes;
                        let currentContentBuffer = [];

                        // Function to add item XML to pageHTML
                        const addItemTopageHTML = (content) => {
                            const dehyphenated = content
                                .map(str => decodeHtmlEntities(str)) // Decode HTML entities
                                // TODO: Spacing should be based on the x-position & width of the items, not like this
                                // TODO: Need to handle normally-hyphenated words properly, e.g. "non-essential": there are no hard-and-fast rules for this, so <span class='review concatenate> concatenated words for review
                                .map((str, index) => str.endsWith('-') ? str.slice(0, -1) : str + (index < content.length - 1 ? ' ' : ''))
                                .join('') // Join without space
                                .replace(/\s+/g, ' ') // Replace multiple spaces with a single space
                                .replace(/ <sup/g, '<sup') // remove space before a <sup> tag
                                .replace(/&/g, '&amp;') // Escape XML special characters
                                .trim(); // Trim any leading or trailing spaces
                            const itemXML = `<p n="${escapeXML(lastAttributes.fontName)}" f="${escapeXML(lastAttributes.fontFamily)}" s="${escapeXML(lastAttributes.fontSize)}" d="${escapeXML(content.dir)}">${dehyphenated}</p>`;
                            pageHTML += itemXML;
                        };

                        // Process each item
                        content.items.forEach(item => {
                            console.log('Item Transform:', item.transform);

                            const itemAttributes = {
                                fontName: fontMap[item.fontName] || 'Unknown',
                                fontFamily: content.styles[item.fontName]?.fontFamily || 'Unknown',
                                fontSize: content.styles[item.fontName]?.fontSize || 0,
                                itemDirection: item.dir,
                                itemScale: item.transform[0],
                                itemX: item.transform[4],
                                itemY: item.transform[5]
                            };

                            // Initialize lastAttributes with the first item's attributes
                            if (lastAttributes === undefined) {
                                lastAttributes = itemAttributes;
                            }

                            // Negative changes in both itemX and itemY indicate a new line
                            // TODO: Need additional check to indicate new paragraph: additional difference in itemY?
                            if (itemAttributes.itemX < lastAttributes.itemX && itemAttributes.itemY < lastAttributes.itemY) {
                                // Flush buffer to pageHTML
                                if (currentContentBuffer.length > 0) {
                                    addItemTopageHTML(currentContentBuffer);
                                }
                                lastAttributes = itemAttributes;
                                currentContentBuffer = [item.str];
                            }
                            // Positive change in itemY and reduction in itemScale indicate superscript (footnote)
                            else if (itemAttributes.itemY > lastAttributes.itemY && itemAttributes.itemScale < lastAttributes.itemScale) {
                                // NO NOT update last attributes - i.e. ignore change in font size
                                currentContentBuffer.push(`<sup idref="n${currentEndNote}">${currentEndNote}</sup>`); // Start new buffer with the current item
                                footnoteMappings.push({n: currentEndNote, f: item.str, p: pageNum}); // Store footnote mappings
                                currentEndNote++;
                            }
                            // Equal comparisonKeys indicate same style
                            else if (areAttributesEqual(itemAttributes, lastAttributes, comparisonKeys)) {
                                // Add to buffer for continuous text in same style
                                currentContentBuffer.push(item.str);
                            // Otherwise, different comparisonKeys probably indicate a new item
                            } else {
                                // Add buffered content if not empty
                                if (currentContentBuffer.length > 0) {
                                    addItemTopageHTML(currentContentBuffer);
                                }
                                // Update last attributes and reset the buffer
                                lastAttributes = itemAttributes;
                                currentContentBuffer = [item.str]; // Start new buffer with the current item
                            }
                            console.log('itemAttributes:', itemAttributes);
                        });

                        // Finalize by adding any remaining buffered content
                        if (currentContentBuffer.length > 0) {
                            addItemTopageHTML(currentContentBuffer);
                        }

                        console.log('Page:', pageNum, 'Content:', pageHTML);
                        pageHTML += `<hr class="remove" /><p class="pageNum remove">End of page ${pageNum}</p>`;

                        // Append the constructed page content to docHTML
                        docHTML += pageHTML;
                    }

                    // TODO: Implement Endnoting of footnotes - use separate endnoteXML object with consecutive numbering

                    showHtmlPreview(docHTML); // Display HTML in modal overlay for checking
                    appendLogMessage(`Generated HTML for file: ${fileName}, size: ${docHTML.length} characters`); // Debugging log

                    // Extract metadata from the PDF
                    let metadata = '';
                    try {
                        const meta = await pdf.getMetadata();
                        console.log('Metadata:', meta);
                        metadata += `<metadata><title>${escapeXML(meta.info.Title || 'Untitled')}</title><author>${escapeXML(meta.info.Author || 'Unknown')}</author><filename>${escapeXML(fileName)}</filename></metadata>`;
                    } catch (metaErr) {
                        console.warn('Failed to retrieve metadata:', metaErr);
                    }

                    docHTML = `<document><head>${metadata}</head><body>${docHTML}</body></document>`;

                    // Fetch the XSLT file and transform the HTML document to BHO XML
                    const xsltResponse = await fetch('./html-to-bho-xml.xslt');
                    const xsltText = await xsltResponse.text();
                    const docXML = transformXml(docHTML, xsltText); // Transform the page XML
                    appendLogMessage(`Transformed XML for file: ${fileName}, size: ${docXML.length} characters`); // Debug

                    // Add the transformed XML content to the ZIP file
                    zip.file(fileName.replace(/\.pdf$/i, '.xml'), docXML); // Use the passed zip object
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

    // Display HTML in the modal overlay for checking
    function showHtmlPreview(htmlContent) {
        $('#htmlPreviewContent').html(htmlContent);
        $('#previewModal').modal('show');
    }

    // Helper function to retrieve page, its text content, and identified fonts
    async function getPageContentAndFonts(pdf, pageNum) {
        const page = await pdf.getPage(pageNum);
        const content = await page.getTextContent();
        const fontMap = await identifyFonts(page);

        return { content, fontMap };
    }

    // Helper function: Identify and map fonts for a given page
    function identifyFonts(page) {
        return page.getOperatorList().then(() => {
            const fonts = page.commonObjs._objs;
            const fontMap = {};
            for (const fontKey in fonts) {
                const font = fonts[fontKey]?.data;
                if (font) {
                    fontMap[font.loadedName] = font.name;
                }
            }
            return fontMap;
        });
    }

    // Helper function to compare relevant attributes between two objects
    const areAttributesEqual = (attrs1, attrs2, keys) => {
        return keys.every(key => attrs1[key] === attrs2[key]);
    };

    // List of keys to compare
    const comparisonKeys = ['fontName', 'fontFamily', 'fontSize', 'itemDirection', 'itemScale'];

    // Function to decode HTML entities to UTF-8
    // TODO: Check that this works - escapeXML converts "&" back to "&amp;" which may not be necessary
    const decodeHtmlEntities = (html) => {
        const txt = document.createElement('textarea');
        txt.innerHTML = html;
        return txt.value;
    };

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

    // Clear logContainer when files are chosen
    $('#pdfInput').on('change', function () {
        $('#alertPlaceholder').empty(); // Clear any existing alerts
        $('#logContainer').hide().html('<p><strong>Logs:</strong></p>'); // Clear the log container
    });

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
            zip.generateAsync({type: 'blob'}).then(function (content) {
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

});
