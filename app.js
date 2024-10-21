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

                    let docHTML = ''; // Initialize the document HTML content
                    let endnoteHTML = `<hr class="remove" /><h3 class="remove">ENDNOTES</h3>`; // Initialize the endnote HTML content
                    let endnoteLookup = []; // Initialize the endnote lookup array

                    // Iterate over pages and process content
                    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {

                        // Call helper function to get content and font map
                        const { content, fontMap } = await getPageContentAndFonts(pdf, pageNum);
                        endnoteLookup.push([]);

                        // TODO:
                        // Add `review` class to anything that needs to be reviewed manually: build a javascript function to pick options during HTML review
                        // Add `remove` class to any elements that should be removed on conversion to XML

                        // Loop through items with index, and analyse geometry

                        let column_width = 0;

                        content.items.forEach((item, index) => {
                            console.log('Item index:', index, item);

                            // Get difference in x and y positions from the previous item
                            item.dx = item.transform[4] - (content.items[index - 1]?.transform[4] || 0);
                            item.dy = (content.items[index - 1]?.transform[5] || 9999) - item.transform[5];

                            // Get right-hand x position of the item
                            item.x_max = item.transform[4] + item.width;

                            // Identify new lines and paragraphs
                            if (Math.abs(item.dy) < 0.1) { // Allows for a continuation across columns. TODO: Need to check for a threshold value - most consecutive lines at scale 10 have dy = 12
                                console.log('Same line:', item.str);
                                column_width = Math.max(column_width, item.x_max); // Update column width
                                // Get line-height from previous item
                                item.lineHeight = content.items[index - 1]?.lineHeight || 0;
                                // Get horizontal distance between items, taking account of width of previous item
                                item.spaceBefore = item.dx - (content.items[index - 1]?.x_max || 0) > 0.1; // TODO: Need to check for a threshold value
                            }
                            else {
                                // Check for new paragraph: is dy > previous item's line-height, or did the previous line end short of the column width?
                                item.newParagraph = item.dy > (content.items[index - 1]?.lineHeight || 0) || column_width - (content.items[index - 1]?.x_max || 0) > 0.1; // TODO: Need to check for a threshold value


                                if (item.newParagraph) {
                                    console.log('New paragraph:', item.str);
                                    // Get line-height from dy
                                    item.lineHeight = item.dy;
                                    item.spaceBefore = false; // No space before new paragraph
                                    column_width = item.x_max; // Update column width
                                }
                                else {
                                    console.log('New line:', item.str);
                                    column_width = Math.max(column_width, item.x_max); // Update column width
                                    // Get line-height from previous item (which may have been a new column within the same paragraph)
                                    item.lineHeight = content.items[index - 1]?.lineHeight || 0;
                                    // Check for hyphenation: does previous line end with a hyphen?
                                    if (content.items[index - 1]?.str.endsWith('-')) {
                                        content.items[index - 1].str = content.items[index - 1].str.slice(0, -1) + '<span class="review hyphen">-</span>'; // Wrap hyphen in a span for review
                                        item.spaceBefore = false; // No space before hyphenated word
                                    }
                                    else {
                                        item.spaceBefore = true; // Space before new line
                                    }
                                }
                            }

                            // Identify superscript (footnote) items: higher on page, smaller font size, and integer content value
                            if (item.dy < 0 && item.transform[0] < (content.items[index - 1]?.transform[0] || 0) && parseInt(item.str) > 0) {
                                const footnoteNumber = parseInt(item.str);
                                endnoteLookup[pageNum - 1].push(footnoteNumber);
                                const endnoteNumber = endnoteLookup[pageNum - 1].length + 1;
                                item.str = `<sup idref="n${endnoteNumber}">${endnoteNumber}</sup>`;
                            }

                            // Identify footnotes: content begins with an integer followed by a period
                            const footnoteMatch = item.str.match(/^(\d+)\./);
                            item.endnote = footnoteMatch;
                            if (footnoteMatch) {
                                const footnoteReferenceNumber = parseInt(footnoteMatch[1]);
                                const endnoteNumber = endnoteLookup[pageNum - 1].indexOf(footnoteReferenceNumber) + 1;
                                // trim the footnote number from the start of the string
                                item.str = item.str.replace(footnoteMatch[0], '').trim();
                                // Wrap the footnote content in a span with a reference ID
                                item.str = `<span class="footnote-reference" id="n${endnoteNumber}" number="${endnoteNumber}"><span class="remove">${endnoteNumber}. </span>${item.str}</span>`;
                            }

                            // Look up item font name from fontMap
                            let fontName = fontMap[item.fontName] || 'Unknown'

                            // Helper function to apply tags
                            function applyTag(item, index, content, tag, condition, closingTag) {
                                const previousItem = content.items[index - 1];

                                if (condition(item) && (!previousItem || !condition(previousItem))) {
                                    item.str = `<${tag}>${item.str}`;
                                }
                                if (!condition(item) && previousItem && condition(previousItem)) {
                                    previousItem.str = `${previousItem.str}</${closingTag}>`;
                                }
                                if (index === content.items.length - 1 && condition(item)) {
                                    item.str = `${item.str}</${closingTag}>`;
                                }
                            }

                            // Apply italic based on font name ending with 'it'
                            applyTag(item, index, content, 'i', (i) => fontName.endsWith('it'), 'i');

                            // Apply bold based on font name containing 'bold'
                            applyTag(item, index, content, 'b', (i) => fontName.includes('bold'), 'b');

                            // Apply small-caps based on font name ending with 'sc'
                            applyTag(item, index, content, 'span class="small-caps"', (i) => fontName.endsWith('sc'), 'span');

                            // Apply heading based on item.transform[0] being >= 10
                            applyTag(item, index, content, 'span class="heading"', (i) => i.transform[0] >= 10, 'span');

                        });

                        // Add items to pageHTML
                        let pageHTML = '';
                        let buffer = [];
                        function flushBuffer() {
                            if (buffer.length > 0) {
                                let paragraph = `<p>${decodeHtmlEntities(buffer.map(i => (i.spaceBefore ? ' ' : '') + i.str).join('').trim()).replace(/  /g, ' ').replace(/&/g, '&amp;')}</p>`;
                                if (buffer[0].endnote) {
                                    endnoteHTML += paragraph;
                                }
                                else {
                                    pageHTML += paragraph;
                                }
                                buffer = [];
                            }
                        }

                        while (content.items.length > 0) {
                            const item = content.items.shift();
                            if (item.newParagraph) {
                                flushBuffer();
                            }
                            buffer.push(item);
                        }
                        flushBuffer();

                        console.log('Page:', pageNum, 'Content:', pageHTML);
                        pageHTML += `<hr class="remove" /><p class="pageNum remove">End of page ${pageNum}</p>`;

                        // Append the constructed page content to docHTML
                        docHTML += pageHTML;
                    }

                    docHTML += endnoteHTML;

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

        // Calculate and append fontSize to each style
        Object.keys(content.styles).forEach(styleKey => {
            const style = content.styles[styleKey];
            style.fontSize = (style?.ascent && style?.descent) ? (style.ascent - style.descent) : 0;
        });

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
