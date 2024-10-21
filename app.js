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

                    // const commonOpsWithArgs = await findCommonOperatorsWithValues(pdf);
                    // console.log('Common Operators with Identical Values:', commonOpsWithArgs);

                    let docHTML = ''; // Initialize the document HTML content
                    let endnoteHTML = `<hr class="remove" /><h3 class="remove">ENDNOTES</h3>`; // Initialize the endnote HTML content
                    let endnoteLookup = []; // Initialize the endnote lookup array

                    const stylings = {
                        'remove': {'condition': (i) => (i.fontName.includes('Helvetica') || i.fontName.includes('Myriad-Roman'))},
                        'italic': {'condition': (i) => i.fontName.endsWith('it')},
                        'bold': {'condition': (i) => i.fontName.includes('bold')},
                        'smallCaps': {'condition': (i) => i.fontName.endsWith('sc')},
                        'heading': {'condition': (i) => i.transform[0] >= 15},
                        // 'gutter' for items that appear outside of A4 page bounds: Bottom Left: 28.346, 79.37; Top Right: 623.622, 761.920
                        'gutter': {'condition': (i) => i.transform[4] < 28.346 || i.transform[5] < 79.37 || i.x_max > 623.622 || i.y_max > 761.920},
                    };

                    // Iterate over pages and process content
                    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {

                        // Short-circuit until last page
                        // if (pageNum < pdf.numPages) {
                        //     endnoteLookup.push([]);
                        //     continue;
                        // }

                        // Call helper function to get content and font map
                        const { content, fontMap, quadrilaterals, lines, viewport } = await getPageContentAndFonts(pdf, pageNum);
                        endnoteLookup.push([]);

                        console.log('Quadrilaterals:', quadrilaterals);
                        console.log('Lines:', lines);
                        console.log(`Page width x height: ${viewport.width} x ${viewport.height}`);

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
                            // Get top y position of the item
                            item.y_max = item.transform[5] - item.height;

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
                            item.fontName = fontName;

                            for (const [style, styling] of Object.entries(stylings)) {
                                item[style] = styling.condition(item);
                            }

                        });

                        // Add items to pageHTML
                        let pageHTML = '';
                        let buffer = [];
                        function flushBuffer() {
                            if (buffer.length > 0) {

                                // Function to return class list based on item attributes
                                function getClassList(item) {
                                    const classList = Object.keys(stylings).filter(attr => item[attr]);
                                    return classList.length ? ` class="${classList.join(' ')}"` : '';
                                }

                                let paragraph = `<p>${decodeHtmlEntities(buffer.map(i => `${i.spaceBefore ? ' ' : ''}<span${getClassList(i)}>${i.str}</span>`).join('').trim()).replace(/  /g, ' ').replace(/&/g, '&amp;')}</p>`;
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

                    const stats = await pdf.getStats();
                    console.log('PDF Stats:', stats);

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
        const viewport = page.getViewport({ scale: 1 });

        // Calculate and append fontSize to each style
        Object.keys(content.styles).forEach(styleKey => {
            const style = content.styles[styleKey];
            style.fontSize = (style?.ascent && style?.descent) ? (style.ascent - style.descent) : 0;
        });

        // Retrieve drawing operators and extract potential quadrilaterals from drawing elements
        const operatorList = await page.getOperatorList();
        const quadrilaterals = extractQuadrilaterals(operatorList);
        const lines = extractLineSegments(operatorList);

        return { content, fontMap, quadrilaterals, lines, viewport };
    }

    // Create a reverse lookup object to map operator numbers to their names
    const operatorNames = Object.keys(pdfjsLib.OPS).reduce((acc, key) => {
        acc[pdfjsLib.OPS[key]] = key;
        return acc;
    }, {});

    // Function to extract line segments from operator list with operator name logging
    function extractLineSegments(operatorList) {
        let lines = [];

        operatorList.fnArray.forEach((fn, index) => {
            const args = operatorList.argsArray[index];

            if (fn === pdfjsLib.OPS.constructPath) {
                const operators = args[0]; // Contains the operator data
                const pathArgs = args[1]; // Contains the path data

                let cursor = 0;
                let startX = null;
                let startY = null;

                operators.forEach((op, i) => {
                    if (op === pdfjsLib.OPS.moveTo) {
                        // Capture starting point (moveTo)
                        startX = pathArgs[cursor];
                        startY = pathArgs[cursor + 1];
                        cursor += 2;
                    } else if (op === pdfjsLib.OPS.lineTo) {
                        // Capture line segment end point (lineTo)
                        const endX = pathArgs[cursor];
                        const endY = pathArgs[cursor + 1];
                        cursor += 2;

                        // If we have a valid start point, create the line segment
                        if (startX !== null && startY !== null) {
                            lines.push({
                                x0: startX,
                                y0: startY,
                                x1: endX,
                                y1: endY
                            });

                            // Update start point for the next segment
                            startX = endX;
                            startY = endY;
                        }
                    }
                });
            }
        });

        return lines;
    }


    // Function to extract quadrilaterals from operator list with operator name logging
    function extractQuadrilaterals(operatorList) {
        let rectangles = [];

        operatorList.fnArray.forEach((fn, index) => {
            const args = operatorList.argsArray[index];

            if (fn === pdfjsLib.OPS.rectangle) {
                rectangles.push({
                    x0: args[0],
                    y0: args[1],
                    x1: args[0] + args[2],
                    y1: args[1] + args[3],
                    width: args[2],
                    height: args[3]
                });
            }

            if (fn === pdfjsLib.OPS.constructPath) {

                const operators = args[0]; // Contains the operator data
                const pathArgs = args[1]; // Contains the path data

                cursor = 0;
                operators.forEach((op, i) => {
                    if (op === pdfjsLib.OPS.moveTo) {
                        // Discard a pair of coordinates
                        cursor += 2;
                    }
                    else if (op === pdfjsLib.OPS.rectangle) {
                        const rectangle = pathArgs.slice(cursor, cursor + 4);
                        cursor += 4;
                        console.log('Operators:', operators.map(op => operatorNames[op]));
                        console.log('pathArgs:', pathArgs);
                        console.log('Rectangle:', rectangle);
                        rectangles.push({
                            x0: rectangle[0],
                            y0: rectangle[1],
                            x1: rectangle[0] + rectangle[2],
                            y1: rectangle[1] + rectangle[3],
                            width: rectangle[2],
                            height: rectangle[3]
                        });
                    }
                });
            }
        });

        return rectangles;
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
            // zip.generateAsync({type: 'blob'}).then(function (content) {
            //     saveAs(content, 'pdfs_to_xml.zip');
            //     showAlert('All XML files have been generated and zipped successfully!', 'success');
            // }).catch(err => {
            //     appendLogMessage(`Error generating ZIP: ${err}`);
            //     console.error('Error generating ZIP:', err);
            // });
        }).catch(err => {
            appendLogMessage(`Error processing files: ${err}`);
            console.error('Error processing files:', err);
        }).finally(() => {
            appendLogMessage('End of file processing.');
            appendLogMessage('=======================');
        });
    });

    async function findCommonOperatorsWithValues(pdf) {
        let commonOpsWithArgs = [];

        // Iterate through each page of the PDF in reverse order
        for (let pageNum = pdf.numPages; pageNum >= 1; pageNum--) {
            const page = await pdf.getPage(pageNum);
            const operatorList = await page.getOperatorList();

            // Store operator-argument pairs for this page
            let opsWithArgsForPage = [];

            operatorList.fnArray.forEach((fn, index) => {
                const operatorName = operatorNames[fn];
                const args = operatorList.argsArray[index];

                // Push an object with the operator name and its arguments
                opsWithArgsForPage.push({
                    operator: operatorName,
                    args: JSON.stringify(args) // Use JSON.stringify to compare the arguments
                });
            });

            if (pageNum === pdf.numPages) {
                // Initialize the commonOpsWithArgs with the last page's operators
                commonOpsWithArgs = opsWithArgsForPage;
            } else {
                // For previous pages, keep only operators with matching args across pages
                commonOpsWithArgs = commonOpsWithArgs.filter(opWithArg =>
                    opsWithArgsForPage.some(op =>
                        op.operator === opWithArg.operator && op.args === opWithArg.args
                    )
                );
            }

            // If no common operators left, stop early
            if (commonOpsWithArgs.length === 0) {
                break;
            }
        }

        // Return operator-argument pairs that are common across all pages
        return commonOpsWithArgs;
    }

});
