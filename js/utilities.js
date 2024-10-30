// /js/utilities.js
// Description: Contains utility functions for the PDF to XML conversion tool.


//////////////////////////
// Listeners
//////////////////////////

// Clear logContainer when files are chosen
$('#pdfInput').on('change', function () {
    $('#alertPlaceholder').empty(); // Clear any existing alerts
    $('#logContainer').hide().html('<p><strong>Logs:</strong></p>'); // Clear the log container
});

//////////////////////////
// Functions
//////////////////////////

// Display HTML in the modal overlay for checking
function showHtmlPreview(htmlContent) {
    $('#htmlPreviewContent').html(htmlContent);
    $('#previewModal').modal('show');
}

// Function to decode HTML entities to UTF-8
// TODO: Check that this works - escapeXML converts "&" back to "&amp;" which may not be necessary
const decodeHtmlEntities = (html) => {
    const txt = document.createElement('textarea');
    txt.innerHTML = html;
    return txt.value;
};

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
        if (item.header) {
            item.str = `<h${item.header}>${item.str}</h${item.header}>`;
            delete item.header;
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