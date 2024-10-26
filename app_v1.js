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
                    let endnoteNumber = 1; // Initialize the endnote number

                    const stylings = {
                        'italic': {'condition': (i) => i.fontName.toLowerCase().endsWith('it')},
                        'bold': {'condition': (i) => i.fontName.toLowerCase().includes('bold')},
                        'customItalic': {'condition': (i) => /^[A-Z]{6}\+/.test(i.fontName)},
                        'remove': {
                            'condition': (i) => (
                                // /^[A-Z]{6}\+/.test(i.fontName) ||
                                i.fontName.includes('Helvetica') ||
                                i.fontName.includes('Myriad-Roman')
                            )
                        },
                        'smallCaps': {'condition': (i) => i.fontName.toLowerCase().endsWith('sc')},
                        'heading': {'condition': (i) => i.height >= 15},
                        'majorHeading': {'condition': (i) => i.height >= 20},
                        // 'gutter' for items that appear outside the main text area: TODO: Need to check values or use crop marks
                        'gutter': {'condition': (i) => i.x < 28.346 || i.y < 79.37 || i.x_max > 623.622 || i.y_max > 840},
                    };

                    // Iterate over pages and process content
                    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {

                        // Short-circuit until last page
                        // if (pageNum < pdf.numPages) {
                        //     endnoteLookup.push([]);
                        //     continue;
                        // }

                        // Stop processing after the n-th page
                        // if (pageNum > 5) {
                        //     break;
                        // }

                        if (pageNum > 1) {
                            docHTML += '<hr class="remove" />'; // Add horizontal rule between pages
                        }

                        // Call helper function to get content and font map
                        const {
                            content,
                            fontMap,
                            quadrilaterals,
                            lines,
                            viewport
                        } = await getPageContentAndFonts(pdf, pageNum);
                        endnoteLookup.push([]);

                        // console.log('Quadrilaterals:', quadrilaterals);
                        // console.log('Lines:', lines);
                        console.log(`Page width x height: ${viewport.width} x ${viewport.height}`);

                        // TODO:
                        // Add `review` class to anything that needs to be reviewed manually: build a javascript function to pick options during HTML review
                        // Add `remove` class to any elements that should be removed on conversion to XML

                        let column_right = 0;
                        let found_first_endnote = false;

                        content.items.forEach((item, index) => {
                            console.log('Item index:', index, item);

                            previousItem = content.items[index - 1];

                            // Get x and y positions of the item
                            item.x = item.transform[4];
                            item.y = item.transform[5];
                            item.x_max = item.x + item.width;
                            item.y_max = item.y + item.height;

                            // Get difference in x and y positions from the previous item
                            item.dx = item.x - (previousItem?.x || 0);
                            item.dy = (previousItem?.y || 9999) - item.y;

                            item.column_x_max = column_right;

                            // Look up item font name from fontMap
                            let fontName = fontMap[item.fontName] || 'Unknown'
                            item.fontName = fontName;

                            for (const [style, styling] of Object.entries(stylings)) {
                                item[style] = styling.condition(item);
                                item.spaceBefore = item.spaceBefore || (item[style] && ['italic', 'bold'].includes(style)); // Add space before if item has a style
                            }

                            // Identify new lines and paragraphs
                            if (Math.abs(item.dy) < item.height) { // Allows for superscripts. TODO: Need to check for a threshold value - most consecutive lines at scale 10 have dy = 12
                                console.log('Same line:', item.str);
                                column_right = Math.max(column_right, item.x_max); // Update column width
                                // Get line-height from previous item
                                item.lineHeight = previousItem?.lineHeight || 0;
                                // Get horizontal distance between items, taking account of width of previous item
                                item.spaceBefore = item.spaceBefore || (item.dx - (previousItem?.x_max || 0) > 0); // TODO: Need to check for a threshold value
                            } else {
                                item.newParagraph =
                                    // is the vertical distance between items significantly greater than the height of the previous item?
                                    Math.abs(item.dy) > 1.5 * (previousItem?.height || 0) ||
                                    // or did the previous line have smallCaps and this one doesn't?
                                    (previousItem?.smallCaps && !item.smallCaps) ||
                                    // or did the previous line have a custom italic font and this one doesn't?
                                    (previousItem?.italic && previousItem?.customItalic && !item.italic) ||
                                    // or did the previous line end short of the column width?
                                    column_right - (previousItem?.x_max || 0) > 1; // TODO: Need to check for a threshold value

                                if (item.x > previousItem?.x_max && item.y > previousItem?.y) {
                                    item.newParagraph = false; // This is a probably a continuation of the previous paragraph in a new column
                                }

                                if (item.newParagraph) {
                                    console.log('New paragraph:', item.str);
                                    // Get line-height from dy
                                    item.lineHeight = index === 0 ? item.height : item.dy;
                                    item.spaceBefore = false; // No space before new paragraph
                                    column_right = item.x_max; // Update column width
                                } else {
                                    console.log('New line:', item.str);
                                    column_right = Math.max(column_right, item.x_max); // Update column width
                                    // Get line-height from previous item (which may have been a new column within the same paragraph)
                                    item.lineHeight = previousItem?.lineHeight || 0;
                                    // Check for hyphenation: does previous line end with a hyphen?
                                    if (previousItem?.str.endsWith('-')) {
                                        previousItem.str = previousItem.str.slice(0, -1) + '<span class="review hyphen">-</span>'; // Wrap hyphen in a span for review
                                        item.spaceBefore = false; // No space before hyphenated word
                                    } else {
                                        item.spaceBefore = true; // Space before new line
                                    }
                                }
                            }

                            // Identify superscript (footnote) items: higher on page, smaller font size, and integer content value
                            if (item.dy < 0 && item.height < (previousItem?.height || 0) && parseInt(item.str) > 0) {
                                item.newParagraph = false; // Footnotes are part of the same paragraph
                                item.str = `<sup idref="n${endnoteNumber}">${endnoteNumber}</sup> `;
                                endnoteLookup[pageNum - 1].push(endnoteNumber++);
                            }

                            if (!found_first_endnote) {
                                // Identify endnotes: content begins with an integer followed by a space
                                const footnoteMatch = item.str.match(/^(\d+)\s/);
                                // Endnotes are smaller font size and have a height of 8.5
                                item.endnote = footnoteMatch && item.height === 8.5;
                                // Some endnotes are condensed on the same line as the previous item: matching 
                                // after the first footnote is unpredictable, so text from this point will be processed separately 
                            }

                            if (item.smallCaps) {
                                item.str = item.str.toUpperCase();
                            }

                        });

                        // Merge items and re-order before pushing to HTML
                        let mergedItemBuffer = [];

                        // Start page with number tag
                        // Extract page number from .gutter items like "VCH Staff 11 txt 5+index_VCHistories 16/01/2013 10:02 Page 15
                        // Find first gutter item with "Page "
                        const metaGutterItem = content.items.find(i => i.gutter && i.str.includes('Page '));
                        // Extract page number from the string
                        const printPageNum = (metaGutterItem?.str.split('Page ')[1] || '0').padStart(3, '0');
                        // Extract date from metaGutterItem
                        const pdfDate = metaGutterItem?.str.match(/\d{2}\/\d{2}\/\d{4}/)?.[0] || '--/--/----';
                        docHTML += `<p class="pageNum" start="${printPageNum}">Page ${printPageNum} [PDF ${pdfDate} ${pageNum}]</p>`;

                        // Function to return class list based on item attributes
                        function getClassList(item) {
                            const classList = Object.keys(stylings).filter(attr => attr !== 'italic' && attr !== 'bold' && item[attr]);
                            return classList.length ? ` class="${classList.join(' ')}"` : '';
                        }

                        let itemBuffer = [];

                        function flushItemBuffer() {
                            if (itemBuffer.length > 0) {

                                // Merge items with same styles
                                let mergedItem;
                                let nextItem;
                                let classes;
                                while (itemBuffer.length > 0) {
                                    nextItem = itemBuffer.shift();
                                    classes = getClassList(nextItem);
                                    if (classes.length > 0) {
                                        nextItem.str = `<span${classes}>${nextItem.str}</span>`;
                                    }
                                    if (nextItem.italic) {
                                        nextItem.str = `<i>${nextItem.str}</i>`;
                                    }
                                    if (nextItem.bold) {
                                        nextItem.str = `<b>${nextItem.str}</b>`;
                                    }

                                    if (mergedItem === undefined) {
                                        mergedItem = nextItem;
                                    } else {
                                        mergedItem.str += `${nextItem.spaceBefore ? ' ' : ''}${nextItem.str}`;
                                        mergedItem.x_max = Math.max(mergedItem.x_max, nextItem.x_max);
                                    }
                                }
                                mergedItem.str = mergedItem.str
                                    .replace('</b> <b>', ' ')
                                    .replace('</i> <i>', ' ')
                                    .replace(/  /g, ' ')
                                    .replace(/&/g, '&amp;');

                                mergedItemBuffer.push(mergedItem);
                                itemBuffer = [];
                            }
                        }

                        let endnoting = false;
                        while (content.items.length > 0) {
                            const item = content.items.shift();
                            endnoting = endnoting || item.endnote;
                            if (item.newParagraph || endnoting) {
                                flushItemBuffer();
                            }
                            itemBuffer.push(item);
                        }
                        flushItemBuffer();

                        mergedItemBuffer = elevateHeadings(mergedItemBuffer);

                        while (mergedItemBuffer.length > 0 && !mergedItemBuffer[0].endnote) {
                            const item = mergedItemBuffer.shift();
                            const tag = item.majorHeading ? 'h1' : item.heading ? 'h2' : 'p';
                            docHTML += `<${tag}>${item.str}</${tag}>`;
                        }

                        // ENDNOTES: These need special handling because of peculiarities of layout.
                        // Concatenate all remaining item.str values
                        let remainingContent = mergedItemBuffer
                            .filter(item => !item.gutter) // Exclude items with .gutter = true
                            .map(item => `${item.spaceBefore ? ' ' : ''}${item.str.trim()}`) // Map remaining items
                            .join('');
                        // Loop from 1 to endnoteLookup[pageNum - 1].length
                        let currentTag = '';
                        let previousTag;
                        for (let i = 1; i <= endnoteLookup[pageNum - 1].length; i++) {
                            // Try first to find `${i} ` at the beginning of one of the mergedItemBuffer items
                            const endnoteNumber = endnoteLookup[pageNum - 1][i - 1];
                            previousTag = currentTag;
                            const previousTagEndIndex = previousTag ? remainingContent.indexOf(previousTag) + previousTag.length : 0;
                            let iIndex = remainingContent.indexOf(`${i} `, previousTagEndIndex);
                            currentTag = `${(i !== 1 ? '***' : '')}<span idref="n${endnoteNumber}" class="remove">${endnoteNumber}. [p${pageNum} fn${i}]</span>. `;

                            const item = mergedItemBuffer.find(item => item.str.startsWith(`${i} `));
                            console.log(`Endnote item ${i}:`, item);
                            if (item) {
                                // Replace first occurrence of item.str after previousTagEndIndex
                                remainingContent = remainingContent.slice(0, previousTagEndIndex) + remainingContent.slice(previousTagEndIndex).replace(item.str.trim(), `${currentTag}${item.str.trim().slice(`${i}`.length)}`);
                            } else if (iIndex > -1){
                                remainingContent = remainingContent.slice(0, iIndex) + currentTag + remainingContent.slice(iIndex + `${i} `.length);
                            } else {
                                // Footnote digits are occasionally separated with a space
                                const spacedLoopIndex = i.toString().split('').join(' ');
                                iIndex = remainingContent.indexOf(`${spacedLoopIndex} `, previousTagEndIndex);
                                if (iIndex > -1) {
                                    remainingContent = remainingContent.slice(0, iIndex) + currentTag + remainingContent.slice(iIndex + `${spacedLoopIndex} `.length);
                                } else {
                                    console.warn(`Footnote ${i} not found on page ${pageNum}`);
                                }
                            }
                        }

                        endnoteHTML += `<p class="endnote">${remainingContent.replace(/  /g, ' ').split('***').join('</p><p class="endnote">')}</p>`;
                    }

                    docHTML += endnoteHTML;

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

    function elevateHeadings(paragraphs) {
        // Iterate through all paragraphs, starting from the second one
        for (let i = 1; i < paragraphs.length; i++) {
            // Check if the current paragraph is a heading
            if (paragraphs[i].heading) {
                let index = i;
                const currentHeading = paragraphs[i];

                // Move the heading upwards as long as the preceding paragraph is a gutter item or has a lower y value
                while ((index > 0 && paragraphs[index - 1].gutter) || (index > 0 && currentHeading.y > paragraphs[index - 1].y)) {
                    // Swap the heading with the paragraph above it
                    paragraphs[index] = paragraphs[index - 1];
                    paragraphs[index - 1] = currentHeading;

                    index--;  // Continue moving upwards
                }
            }
        }

        return paragraphs;
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
        const viewport = page.getViewport({scale: 1});

        // Calculate and append fontSize to each style
        Object.keys(content.styles).forEach(styleKey => {
            const style = content.styles[styleKey];
            style.fontSize = (style?.ascent && style?.descent) ? (style.ascent - style.descent) : 0;
        });

        // Retrieve drawing operators and extract potential quadrilaterals from drawing elements
        const operatorList = await page.getOperatorList();
        const quadrilaterals = extractQuadrilaterals(operatorList);
        const lines = extractLineSegments(operatorList);

        return {content, fontMap, quadrilaterals, lines, viewport};
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
                    } else if (op === pdfjsLib.OPS.rectangle) {
                        const rectangle = pathArgs.slice(cursor, cursor + 4);
                        cursor += 4;
                        // console.log('Operators:', operators.map(op => operatorNames[op]));
                        // console.log('pathArgs:', pathArgs);
                        // console.log('Rectangle:', rectangle);
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
