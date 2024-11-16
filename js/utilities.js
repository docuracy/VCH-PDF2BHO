// /js/utilities.js
// Description: Contains utility functions for the PDF to XML conversion tool.


//////////////////////////
// Listeners
//////////////////////////

// Clear logContainer when files are chosen
$('#pdfInput').on('change', function () {
    $('#alertPlaceholder').empty(); // Clear any existing alerts
    $('#logContainer').hide().html('<p><strong>Logs:</strong></p>'); // Clear the log container
    $('#resultInputs').addClass('d-none'); // Hide the result inputs
    $('#conversionInputs').removeClass('d-none'); // Show the conversion inputs
}).on('click', function () {
    this.value = ''; // Clear the file input value to allow re-selection of the same file
});

$('#downloadBtn').on('click', function () {
    const base64Zip = sessionStorage.getItem('preparedZip');
    if (base64Zip) {
        const binaryZip = atob(base64Zip.split(',')[1]); // Decode Base64 to binary
        const array = new Uint8Array(binaryZip.length);
        for (let i = 0; i < binaryZip.length; i++) {
            array[i] = binaryZip.charCodeAt(i);
        }
        const blob = new Blob([array], { type: 'application/zip' });
        saveAs(blob, 'pdfs_to_xml.zip');
    } else {
        showAlert('No ZIP file prepared. Please convert the files first.', 'warning');
    }
});

$('#previewHTMLBtn').on('click', function () {

    const savedHTML = sessionStorage.getItem('htmlPreview');
    if (savedHTML) {
        $('#htmlPreviewContent').html(savedHTML);
    } else {
        alert('No saved preview found!');
    }

    $('#previewModal').modal('show');
});

$('#previewXMLBtn').on('click', function () {

    const savedXML = sessionStorage.getItem('XMLPreview');
    if (savedXML) {
        // Parse and pretty-print the saved XML
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(savedXML, "application/xml");

        const serializer = new XMLSerializer();
        const prettyXML = formatXML(serializer.serializeToString(xmlDoc));

        $('#htmlPreviewContent').text(prettyXML);
    } else {
        alert('No saved preview found!');
    }

    $('#previewModal').modal('show');
});

// Helper function to pretty-print XML with indentation
function formatXML(xmlString) {
    const PADDING = '    '; // 4 spaces for indentation
    const lines = xmlString.split(/>\s*</);
    let indent = 0;

    return lines.map((line, i) => {
        if (line.match(/^\/\w/)) indent -= 1; // Decrease indent level if closing tag
        const padding = PADDING.repeat(Math.max(indent, 0));
        if (line.match(/^<?\w[^>]*[^/]$/) && !line.startsWith('?xml')) indent += 1; // Increase indent level if opening tag
        return padding + '<' + line + (i === lines.length - 1 ? '' : '>');
    }).join('\n');
}

//////////////////////////
// Functions
//////////////////////////

// Function to decode HTML entities to UTF-8
// TODO: Check that this works - escapeXML converts "&" back to "&amp;" which may not be necessary
const decodeHtmlEntities = (html) => {
    const txt = document.createElement('textarea');
    txt.innerHTML = html;
    return txt.value;
};

function closeOverlaps(items) {
    // Reverse loop to merge overlapping items
    for (let i = items.length - 1; i > 0; i--) {
        const item = items[i];
        const prevItem = items[i - 1];
        if (item.row === prevItem.row && item.column === prevItem.column && item.line === prevItem.line && item.height === prevItem.height && item.left < prevItem.right) {
            // Merge the items if they overlap
            prevItem.str += item.str;
            prevItem.right = item.right;
            prevItem.width = prevItem.right - prevItem.left;
            prevItem.area += item.area;
            items.splice(i, 1);
        }
    }
}

// Function to capitalise the first letter of each word in a string
function titleCase(str) {
    const skipWords = ['and', 'the', 'of', 'in', 'on', 'at', 'with', 'to'];
    return str
        .replace(/\s+/g, ' ')
        .split(' ')
        .map((word, index) => {
            const lowerWord = word.toLowerCase(); // Convert the word to lowercase
            // Capitalise if it's the first word or not a skip word
            if (index === 0 || !skipWords.includes(lowerWord)) {
                const hyphenatedParts = lowerWord.split('-'); // Split by hyphen
                // Capitalise the first letter of the first part
                hyphenatedParts[0] = hyphenatedParts[0].charAt(0).toUpperCase() + hyphenatedParts[0].slice(1);
                // Capitalise the first letter of any subsequent parts if they are not skip words
                for (let i = 1; i < hyphenatedParts.length; i++) {
                    if (!skipWords.includes(hyphenatedParts[i])) {
                        hyphenatedParts[i] = hyphenatedParts[i].charAt(0).toUpperCase() + hyphenatedParts[i].slice(1);
                    }
                }
                return hyphenatedParts.join('-'); // Join the hyphenated parts back together
            }
            return lowerWord; // Return the lowercased word if it's a skip word
        })
        .join(' ');
}

// Wrap strings in HTML style tags
function wrapStrings(items) {
    items.forEach(item => {
        if (item?.header) {
            item.str = `<h${item.header}>${item.str}</h${item.header}>`;
            delete item.fontName
        } else if (item.bold) {
            item.str = `<strong>${item.str}</strong>`;
            delete item.bold;
            delete item.fontName
        } else if (item.italic) {
            item.str = `<em>${item.str}</em>`;
            delete item.italic;
            delete item.fontName
        }
    });
}


function trimStrings(items) {
    items.forEach(item => {
        item.str = item.str
            .replace(/\s+/g, ' ')                   // Replace multiple spaces with a single space
            .replace(/\s([,.])/g, '$1')             // Remove space before commas or full stops
            .replace(/(\()\s+/g, '$1');             // Remove space after opening brackets
    });
}


function escapeStrings(items) {
    items.forEach(item => {
        item.str = item.str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    });
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

function transformXml(html, xslt) {
    // Create a new XSLTProcessor
    const xsltProcessor = new XSLTProcessor();

    // Parse the XSLT string into a document
    const parser = new DOMParser();
    const xsltDoc = parser.parseFromString(xslt, 'application/xml');

    // Import the XSLT stylesheet
    xsltProcessor.importStylesheet(xsltDoc);

    // Parse the HTML string into an XML document
    const xmlDoc = parser.parseFromString(html, 'application/xml');

    // Perform the transformation
    const transformedDoc = xsltProcessor.transformToFragment(xmlDoc, document);

    // Serialize the transformed document back to a string
    const serializer = new XMLSerializer();
    return serializer.serializeToString(transformedDoc);
}


function fillMissingPageNumerals(pageNumerals) {
    // Find the first non-null value and set the start value
    let startValue = pageNumerals.find(value => value !== null);
    if (startValue !== undefined) {
        startValue = parseInt(startValue) - pageNumerals.indexOf(startValue);
    } else {
        return; // No non-null values, nothing to fill
    }

    // Fill all null values with a contiguous sequence
    for (let i = 0; i < pageNumerals.length; i++) {
        if (pageNumerals[i] === null) {
            pageNumerals[i] = (startValue + i).toString();
        }
    }
}
