//<![CDATA[
document.addEventListener("DOMContentLoaded", function () {
    var root = document.querySelector('body');
    var startVal = parseInt(root.getAttribute('data-start')) || 1;
    var allNotes = document.querySelectorAll('data');

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

    // Build "In this section" header navigation
    var titleElement = root.querySelector('h1#title, h2#title');
    if (titleElement) {
        // First pass: assign IDs to all headings
        var h3Counter = 1;
        var h4Counter = 1;
        var h5Counter = 1;

        var allH3 = root.querySelectorAll('h3:not(#title)');
        allH3.forEach(function(h3) {
            h3.id = 'h3-s' + h3Counter;
            h3Counter++;
        });

        var allH4 = root.querySelectorAll('h4:not(#title)');
        allH4.forEach(function(h4) {
            h4.id = 'h4-s' + h4Counter;
            h4Counter++;
        });

        var allH5 = root.querySelectorAll('h5:not(#title)');
        allH5.forEach(function(h5) {
            h5.id = 'h5-s' + h5Counter;
            h5Counter++;
        });

        // Second pass: build navigation structure
        var headerNav = document.createElement('header');
        headerNav.className = 'header';

        var navHeading = document.createElement('h2');
        navHeading.textContent = 'In this section';
        headerNav.appendChild(navHeading);

        var topList = document.createElement('ul');

        // Add title as first item
        var titleLi = document.createElement('li');
        var titleLink = document.createElement('a');
        titleLink.href = '#title';
        titleLink.textContent = titleElement.textContent;
        titleLi.appendChild(titleLink);

        // Find all H3 headings (main sections)
        var h3Elements = root.querySelectorAll('h3:not(#title)');
        if (h3Elements.length > 0) {
            var h3List = document.createElement('ul');

            h3Elements.forEach(function(h3) {
                var h3Li = document.createElement('li');
                var h3Link = document.createElement('a');
                h3Link.href = '#' + h3.id;
                h3Link.textContent = h3.textContent;
                h3Li.appendChild(h3Link);

                // Find H4 children of this H3 (all H4s until next H3)
                var h4Children = [];
                var currentEl = h3.nextElementSibling;

                while (currentEl) {
                    // Use toUpperCase() for case-insensitive comparison
                    if (currentEl.tagName.toUpperCase() === 'H3') {
                        break;
                    }

                    if (currentEl.tagName.toUpperCase() === 'H4' && currentEl.id !== 'title') {
                        h4Children.push(currentEl);
                    }

                    currentEl = currentEl.nextElementSibling;
                }

                if (h4Children.length > 0) {
                    var h4List = document.createElement('ul');

                    h4Children.forEach(function(h4) {
                        var h4Li = document.createElement('li');
                        var h4Link = document.createElement('a');
                        h4Link.href = '#' + h4.id;
                        h4Link.textContent = h4.textContent;
                        h4Li.appendChild(h4Link);

                        // Find H5 children of this H4
                        var h5Children = [];
                        var currentH5El = h4.nextElementSibling;

                        while (currentH5El) {
                            if (currentH5El.tagName.toUpperCase() === 'H3' || currentH5El.tagName.toUpperCase() === 'H4') {
                                break;
                            }
                            if (currentH5El.tagName.toUpperCase() === 'H5' && currentH5El.id !== 'title') {
                                h5Children.push(currentH5El);
                            }
                            currentH5El = currentH5El.nextElementSibling;
                        }

                        if (h5Children.length > 0) {
                            var h5List = document.createElement('ul');

                            h5Children.forEach(function(h5) {
                                var h5Li = document.createElement('li');
                                var h5Link = document.createElement('a');
                                h5Link.href = '#' + h5.id;
                                h5Link.textContent = h5.textContent;
                                h5Li.appendChild(h5Link);
                                h5List.appendChild(h5Li);
                            });

                            h4Li.appendChild(h5List);
                        }

                        h4List.appendChild(h4Li);
                    });

                    h3Li.appendChild(h4List);
                }

                h3List.appendChild(h3Li);
            });

            titleLi.appendChild(h3List);
        }

        topList.appendChild(titleLi);
        headerNav.appendChild(topList);

        // Add footnotes link if there are any notes
        if (allNotes.length > 0) {
            var footnotesUl = document.createElement('ul');
            var footnotesLink = document.createElement('a');
            footnotesLink.href = '#fns';
            footnotesLink.textContent = 'Footnotes';
            footnotesUl.appendChild(footnotesLink);
            headerNav.appendChild(footnotesUl);
        }

        // Insert header before the title element
        titleElement.parentNode.insertBefore(headerNav, titleElement);
    }

    // Insert numbering into figcaption elements
    var allFigcaptions = document.querySelectorAll('figcaption');
    var figCounter = 1;
    allFigcaptions.forEach(function (figcap) {
        var startAttr = figcap.getAttribute('data-start');
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
        var startAttr = tabcap.getAttribute('data-start');
        if (startAttr) {
            tableCounter = parseInt(startAttr);
        }
        tabcap.innerText = 'Table ' + tableCounter + ': ' + tabcap.innerText;
        tableCounter++;
    });

    // Add page numbers to hr.page-break elements
    var pageMarkers = document.querySelectorAll('hr.page-break');
    if (pageMarkers.length > 0) {
        var currentPageNum = parseInt(pageMarkers[0].getAttribute('data-start')) || 1;
        pageMarkers.forEach(function (marker, index) {
            marker.setAttribute('data-page', currentPageNum + index);
        });
    }

    // Number paragraphs
    var allParagraphs = root.querySelectorAll('p:not(#subtitle)');
    var pCounter = 1;
    allParagraphs.forEach(function(p) {
        var startAttr = p.getAttribute('data-start');
        if (startAttr) {
            pCounter = parseInt(startAttr);
        }
        if (!p.id) {
            p.id = 'p' + pCounter;
        }
        pCounter++;
    });

    // Remove space from before data elements
    allNotes.forEach(function (note) {
        if (note.previousSibling && note.previousSibling.nodeType === Node.TEXT_NODE) {
            note.previousSibling.textContent = note.previousSibling.textContent.replace(/\s+$/, '');
        }
    });

    // Process each data element
    for (var i = 0; i < allNotes.length; i++) {
        var note = allNotes[i];
        var noteNum = counter;

        // Trim trailing whitespace before the data
        var prev = note.previousSibling;
        if (prev && prev.nodeType === Node.TEXT_NODE) {
            prev.textContent = prev.textContent.replace(/\s+$/, '');
        }

        // Number and record this note
        note.setAttribute('data-preview-num', noteNum);
        note.id = 'fnr' + noteNum;
        sourceNotes[noteNum] = note.innerHTML;

        // Wrap contents in <span class="note-content">
        var contentSpan = document.createElement('span');
        contentSpan.className = 'note-content';

        while (note.firstChild) {
            contentSpan.appendChild(note.firstChild);
        }

        note.appendChild(contentSpan);
        counter++;
    }

    // Create footnotes section at the end of the body
    if (sourceNotes.length > startVal) {
        var hr = document.createElement('hr');
        root.appendChild(hr);

        var footnotesSection = document.createElement('section');
        footnotesSection.className = 'footnotes';
        footnotesSection.id = 'fns';

        var footnotesHeading = document.createElement('h2');
        footnotesHeading.textContent = 'Notes';
        footnotesSection.appendChild(footnotesHeading);

        // Create footnote paragraphs
        for (var n = startVal; n < counter; n++) {
            if (sourceNotes[n]) {
                var footnotePara = document.createElement('p');
                footnotePara.className = 'footnote';
                footnotePara.id = 'fnn' + n;

                var backlink = document.createElement('a');
                backlink.href = '#fnr' + n;
                backlink.textContent = n + '. ';
                footnotePara.appendChild(backlink);

                // Add the footnote content
                var contentSpan = document.createElement('span');
                contentSpan.innerHTML = sourceNotes[n];
                footnotePara.appendChild(contentSpan);

                footnotesSection.appendChild(footnotePara);
            }
        }

        root.appendChild(footnotesSection);
    }
});
//]]>