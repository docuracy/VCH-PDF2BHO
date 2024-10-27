// /js/text.js
// Description: Contains functions for extracting text from PDFs.


// Helper function to retrieve page, its text content, and identified fonts
async function getPageContentAndFonts(pdf, pageNum) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const fontMap = await identifyFonts(page);
    const viewport = await page.getViewport({scale: 1});
    const operatorList = await page.getOperatorList();

    appendLogMessage(`Page size: ${viewport.width.toFixed(2)} x ${viewport.height.toFixed(2)}`);
    // listOperators(operatorList);

    const cropRange = identifyCropMarks(operatorList);
    if (!!cropRange.y) {
        // Convert ranges to top-down reading order
        cropRange.y = [viewport.height.toFixed(2) - cropRange.y[0].toFixed(2), viewport.height.toFixed(2) - cropRange.y[1].toFixed(2)];
    }
    else {
        console.warn('Crop Range not found: using defaults.');
        // Use default crop range based on printed page size 595.276 x 864.567
        const gutterX = (viewport.width - 595.276) / 2;
        const gutterY = (viewport.height - 864.567) / 2;
        cropRange.x = [gutterX, viewport.width - gutterX];
        cropRange.y = [gutterY, viewport.height - gutterY];
    }
    appendLogMessage(`Crop Range: x: ${cropRange.x[0].toFixed(2)} to ${cropRange.x[1].toFixed(2)}; y: ${cropRange.y[0].toFixed(2)} to ${cropRange.y[1].toFixed(2)}`);
    appendLogMessage(`Cropped size: ${cropRange.x[1].toFixed(2) - cropRange.x[0].toFixed(2)} x ${cropRange.y[1].toFixed(2) - cropRange.y[0].toFixed(2)}`);

    const mapBorders = findMap(operatorList, cropRange, viewport);
    console.log('Map Borders:', mapBorders);
    appendLogMessage(`${mapBorders.length} map(s) found`);

    // Calculate and append fontSize to each style
    Object.keys(content.styles).forEach(styleKey => {
        const style = content.styles[styleKey];
        style.fontSize = (style?.ascent && style?.descent) ? (style.ascent - style.descent) : 0;
    });

    augmentItems(content.items);
    console.log('Unfiltered content Items:', content.items);

    // Discard content items falling outside crop range or within map outlines
    content.items = content.items.filter(item =>
        item.left >= cropRange.x[0] && item.right <= cropRange.x[1] &&
        item.bottom >= cropRange.y[0] && item.top <= cropRange.y[1] &&
        !mapBorders.some(border =>
            item.left >= border.x0 && item.right <= border.x1 &&
            item.bottom >= border.y0 && item.top <= border.y1
        )
    );

    const textLayout = getTextLayout(content);
    appendLogMessage(`Text Layout: ${textLayout.columns.length} column(s), ${textLayout.rows.length} row(s) ${textLayout.footnoteRow.length > 0 ? '+footnotes' : '(no footnotes)'}`);
    console.log('Text Layout:', textLayout);

    // Add textLayoutRows
    textLayout.rows.forEach((row, index) => {
        row.columnised = true;
        row.range = [row[0], row[1]];
        delete row[0];
        delete row[1];
    });
    // Add rows to fill gaps in cropRange.y
    // Start with a row at the top of the cropped area and add rows for each gap
    const paddedRows = [{range: [cropRange.y[0], textLayout.rows[0].range[0]], columnised: false}];
    for (let i = 0; i < textLayout.rows.length - 1; i++) {
        paddedRows.push(textLayout.rows[i]);
        const gap = textLayout.rows[i + 1].range[0] - textLayout.rows[i].range[1];
        if (gap > 1) {
            paddedRows.push({range: [textLayout.rows[i].range[1], textLayout.rows[i + 1].range[0]], columnised: false});
        }
    }
    paddedRows.push(textLayout.rows[textLayout.rows.length - 1]);
    // Add a row at the bottom of the main area
    paddedRows.push({range: [textLayout.rows[textLayout.rows.length - 1].range[1], cropRange.y[1]], columnised: false});
    textLayout.rows = paddedRows;
    console.log('Text Layout with padded rows:', textLayout);

    // Tag items with row and column numbers
    content.items.forEach(item => {
        item.row = textLayout.rows.findIndex(row => item.bottom >= row.range[0] && item.top <= row.range[1]);
        // If row is columnised, find the column
        if (textLayout.rows[item.row]?.columnised) {
            item.column = textLayout.columns.findIndex(column => item.left >= column[0] && item.right <= column[1]);
        }
    });
    console.log('Content Items:', content.items);

    // Sort items within each column of each row by line and then by left position
    textLayout.rows.forEach(row => {
        textLayout.columns.forEach(column => {
            const itemsInColumn = content.items.filter(i => i.row === row.index && i.column === column.index);
            // TODO: Consider superscripts
            itemsInColumn.sort((a, b) => a.bottom - b.bottom || a.left - b.left);
        });
        // TODO: Push to new item array
    });

    return {content, fontMap, textLayout, viewport};
}

function getTextLayout(content) {

    // Identify the most commonly-used font and its height
    const fontCounts = {};
    content.items.forEach(item => {
        const key = `${item.fontName}-${item.height}`; // Create a composite key of fontName and height
        fontCounts[key] = (fontCounts[key] || 0) + 1; // Count occurrences for each unique font-height combination
    });

    // Identify the most common font-height combination
    const mostCommonFontKey = Object.keys(fontCounts).reduce((a, b) => fontCounts[a] > fontCounts[b] ? a : b);
    const [mostCommonFont, mostCommonHeight] = mostCommonFontKey.split('-'); // Split back into fontName and height

    // Items with the most common font and height
    const mostCommonFontItems = content.items.filter(i => i.fontName === mostCommonFont && i.height === parseFloat(mostCommonHeight));

    // Sort x-coordinates for columns and y-coordinates for rows
    const xCoordinates = mostCommonFontItems.map(i => i.left).sort((a, b) => a - b);
    const yCoordinates = mostCommonFontItems.map(i => i.bottom).sort((a, b) => a - b);

    // Define a clustering function to group X coordinates
    const clusterXCoordinates = (coordinates, threshold) => {
        const mean = ss.mean(coordinates);
        const stdDev = ss.standardDeviation(coordinates) || 1;
        const clusters = {};

        coordinates.forEach(coord => {
            const clusterKey = Math.round((coord - mean) / (threshold * stdDev));
            (clusters[clusterKey] ||= []).push(coord); // Push coord into cluster, creating cluster if needed
        });

        // Calculate mean and standard deviation of cluster sizes
        const clusterSizes = Object.values(clusters).map(cluster => cluster.length);
        const sizeMean = ss.mean(clusterSizes);
        const sizeStdDev = ss.standardDeviation(clusterSizes);

        // Define a sparsity threshold for cluster size
        const sparsityThreshold = sizeMean - 0.5 * sizeStdDev;

        console.log('Cluster Sizes / Sparsity Threshold:', clusterSizes, sparsityThreshold);

        // Filter clusters based on sparsity threshold and map to ranges
        return Object.values(clusters)
            .filter(cluster => cluster.length >= sparsityThreshold)
            .map(cluster => [Math.min(...cluster), Math.max(...cluster)])
            .sort((a, b) => a[0] - b[0]);
    };

    const xThreshold = .5; // TODO: May need to be adjusted
    const filteredColumns = clusterXCoordinates(xCoordinates, xThreshold);


    const clusterYCoordinates = (sortedCoords, threshold) => {
        const clusters = [];
        let currentCluster = [];

        for (let i = 0; i < sortedCoords.length; i++) {
            const coord = sortedCoords[i];

            // If the current cluster is empty or the distance to the last coordinate in the current cluster is within the threshold
            if (currentCluster.length === 0 || (coord - currentCluster[currentCluster.length - 1] <= threshold)) {
                currentCluster.push(coord);
            } else {
                // Push the completed cluster and start a new one
                clusters.push([Math.min(...currentCluster), Math.max(...currentCluster)]);
                currentCluster = [coord]; // Start new cluster
            }
        }

        // Push the last cluster if it exists
        if (currentCluster.length > 0) {
            clusters.push([Math.min(...currentCluster), Math.max(...currentCluster)]);
        }

        return clusters;
    };

    const yThreshold = 2 * mostCommonFontItems.reduce((sum, item) => sum + item.height, 0) / mostCommonFontItems.length || 0;
    const filteredRows = clusterYCoordinates(yCoordinates, yThreshold);

    // Find maximum .right for each item in each column
    const overlappingColumnRanges = filteredColumns.map(column => {
        const rightMax = mostCommonFontItems
            .filter(i => i.left >= column[0] && i.left <= column[1])
            .reduce((acc, i) => Math.max(acc, i.right), 0);
        return [column[0], rightMax];
    });

    // Now filter out encompassed ranges
    const columnRanges = overlappingColumnRanges.filter(currentRange =>
        !overlappingColumnRanges.some(otherRange =>
            currentRange[0] >= otherRange[0] && currentRange[1] <= otherRange[1] && currentRange !== otherRange
        )
    );

    // Find minimum top for each item in each row
    const rowRanges = filteredRows.map(row => {
        const topsInRow = mostCommonFontItems
            .filter(i => i.bottom >= row[0] && i.bottom <= row[1])
            .map(i => i.top); // Collect all tops in the row

        const topMin = topsInRow.length > 0 ? Math.min(...topsInRow) : Infinity; // Set to Infinity if no items
        return [topMin, row[1]];
    });

    mostCommonFontBottom = rowRanges[rowRanges.length - 1][1];
    potentialFootnotes = content.items.filter(i => i.bottom > mostCommonFontBottom);
    footnoteRowRange = [];

    const potentialFootnoteFontCounts = {};
    potentialFootnotes.forEach(item => {
        const key = `${item.fontName}-${item.height}`; // Create a composite key of fontName and height
        potentialFootnoteFontCounts[key] = (potentialFootnoteFontCounts[key] || 0) + 1; // Count occurrences for each unique font-height combination
    });

    if (Object.keys(potentialFootnoteFontCounts).length === 0) {
        console.log('No potential footnotes found.');
    } else {
        // Identify the most common font-height combination among potential footnotes
        const footnoteFontKey = Object.keys(potentialFootnoteFontCounts).reduce((a, b) => potentialFootnoteFontCounts[a] > potentialFootnoteFontCounts[b] ? a : b);
        const [footnoteFont, footnoteHeight] = footnoteFontKey.split('-'); // Split back into fontName and height
        console.log('Footnote Font:', footnoteFont, 'Height:', footnoteHeight);

        // Deduce row range for footnotes
        footnoteRowRange = [Math.min(...potentialFootnotes.map(i => i.top)), Math.max(...potentialFootnotes.map(i => i.bottom))];
    }

    return {
        columns: columnRanges,
        rows: rowRanges,
        footnoteRow: footnoteRowRange
    };
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