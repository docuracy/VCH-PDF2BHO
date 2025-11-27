//<![CDATA[
document.addEventListener("DOMContentLoaded", function () {
    var root = document.querySelector('.vch-report');
    var startVal = parseInt(root.getAttribute('data-idstart')) || 1;
    var allNotes = document.querySelectorAll('aside');

    var sourceNotes = [];
    var counter = startVal;

    // Copy title from the first h1 or h2 at start of document to head section
    var firstHeader = root.querySelector('h1, h2');
    if (firstHeader) {
        var titleText = firstHeader.innerText.trim() || 'Untitled Document';
        var headTitle = document.querySelector('head > title');
        if (headTitle) {
            headTitle.innerText = titleText;
        } else {
            headTitle = document.createElement('title');
            headTitle.innerText = titleText;
            document.querySelector('head').appendChild(headTitle);
        }
    }

    // Insert numbering into figcaption elements
    var allFigcaptions = document.querySelectorAll('figcaption');
    var figCounter = 1;
    allFigcaptions.forEach(function (figcap) {
        var startAttr = figcap.getAttribute('data-idstart');
        if (startAttr) {
            figCounter = parseInt(startAttr);
        }
        figcap.innerText = 'Figure ' + figCounter + ': ' + figcap.innerText;
        figCounter++;
    });

    // Insert numbering into tablecaption elements
    var allTablecaptions = document.querySelectorAll('table caption');
    var tableCounter = 1;
    allTablecaptions.forEach(function (tabcap) {
        var startAttr = tabcap.getAttribute('data-idstart');
        if (startAttr) {
            tableCounter = parseInt(startAttr);
        }
        tabcap.innerText = 'Table ' + tableCounter + ': ' + tabcap.innerText;
        tableCounter++;
    });

    // Add page numbers to hr.vch-page elements
    var pageMarkers = document.querySelectorAll('hr.vch-page');
    var currentPageNum = parseInt(pageMarkers[0].getAttribute('data-idstart')) || 1;
    pageMarkers.forEach(function (marker, index) {
        marker.setAttribute('data-page', currentPageNum + index);
    });

    // Remove space from before aside elements
    allNotes.forEach(function (note) {
        if (note.previousSibling && note.previousSibling.nodeType === Node.TEXT_NODE) {
            note.previousSibling.textContent = note.previousSibling.textContent.replace(/\s+$/, '');
        }
    });

    // Process each aside element
    for (var i = 0; i < allNotes.length; i++) {
        var note = allNotes[i];

        // Trim trailing whitespace before the aside
        var prev = note.previousSibling;
        if (prev && prev.nodeType === Node.TEXT_NODE) {
            prev.textContent = prev.textContent.replace(/\s+$/, '');
        }

        // Number and record this note
        note.setAttribute('data-preview-num', counter);
        sourceNotes[counter] = note;
        counter++;

        // Wrap contents in <span class="note-content">
        var contentSpan = document.createElement('span');
        contentSpan.className = 'note-content';

        while (note.firstChild) {
            contentSpan.appendChild(note.firstChild);
        }

        note.appendChild(contentSpan);
    }

});
//]]>