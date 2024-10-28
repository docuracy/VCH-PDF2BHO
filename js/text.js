// /js/text.js
// Description: Contains functions for extracting text from PDFs.


function findColumns(numPages, defaultFont, footFont, columnSpacing = 11.75, significanceThreshold = 0.5) {
    let columnItems = [];

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const items = JSON.parse(localStorage.getItem(`page-${pageNum}-items`));
        columnItems.push(...items.filter(item => {
            return (item.fontName === defaultFont.fontName && item.height === defaultFont.fontSize) ||
                (item.fontName === footFont.fontName && item.height === footFont.fontSize);
        }));
    }

    // Extract leftmost values and crop range
    const leftMin = Math.min(...columnItems.map(item => item.left));
    const rightMax = Math.max(...columnItems.map(item => item.right));
    const marginWidth = rightMax - leftMin;
    const columnWidth2 = (marginWidth - columnSpacing) / 2;
    const columnWidth3 = (marginWidth - 2 * columnSpacing) / 3;
    const columnCentres = [leftMin + columnWidth2, leftMin + columnWidth3, (rightMax - leftMin) / 2, rightMax - columnWidth3, rightMax - columnWidth2];

    // Initialize groupedCentres with the calculated column centres
    const groupedCentres = columnCentres.reduce((acc, centre) => {
        acc[centre] = 0; // Initialize counts to zero
        return acc;
    }, {});

    // Extract centre points from the columnItems
    const centres = columnItems.map(item => item.left + item.width / 2);

    // Group centres into closest seeded centre
    centres.forEach(centre => {
        const closestCentre = columnCentres.reduce((closest, current) =>
            Math.abs(current - centre) < Math.abs(closest - centre) ? current : closest
        );
        groupedCentres[closestCentre] += 1; // Increment count for the closest group
    });

    // Log the counts table for each grouped centre
    console.log('Potential Columns:');
    console.table(groupedCentres);

    // Convert grouped centers to an array of entries
    const centreEntries = Object.entries(groupedCentres)
        .map(([centre, count]) => ({ centre: parseFloat(centre), count }))
        .sort((a, b) => b.count - a.count); // Sort by count descending

    // Determine if there are significantly more tallies
    const maxCount = centreEntries[0].count;
    const significantGroups = centreEntries.filter(entry => entry.count >= maxCount * significanceThreshold);

    // Calculate column boundaries based on significant groups
    const maxColumnWidth = marginWidth / significantGroups.length;

    // Find maximum width for items whose .width is less than columnWidth
    const maxItemWidth = Math.max(
        ...columnItems
            .filter(item => item.width < maxColumnWidth)
            .map(item => item.width),
        0
    );

    return significantGroups.length > 1 ? {
        count: significantGroups.length,
        width: maxItemWidth
    } : null;
}


function tagRowsAndColumns(pageNum, defaultFont, footFont, columns) {
    const items = JSON.parse(localStorage.getItem(`page-${pageNum}-items`));
    const cropRange = JSON.parse(localStorage.getItem(`page-${pageNum}-cropRange`));

    // Filter items by default and footer font specs
    const columnItems = items.filter(item =>
        (item.fontName === defaultFont.fontName && item.height === defaultFont.fontSize) ||
        (item.fontName === footFont.fontName && item.height === footFont.fontSize)
    );

    // Define column ranges
    const leftMin = Math.min(...columnItems.map(item => item.left));
    const rightMax = Math.max(...columnItems.map(item => item.right));
    const textWidth = rightMax - leftMin;
    const columnSpacing = (textWidth - columns.width * columns.count) / (columns.count - 1);
    const columnRanges = Array.from({ length: columns.count }, (_, index) => {
        const left = leftMin + index * (columnSpacing + columns.width);
        return [left - columnSpacing / 2, left + columns.width + columnSpacing / 2];
    });

    // Extract and sort bottom coordinates
    const bottomCoords = columnItems.map(item => item.bottom).sort((a, b) => a - b);

    // Helper function to cluster bottoms within a given threshold
    function clusterBottoms(coords, threshold) {
        const clusters = [];
        let currentCluster = [];

        coords.forEach(coord => {
            if (!currentCluster.length || coord - currentCluster.at(-1) <= threshold) {
                currentCluster.push(coord);
            } else {
                clusters.push([Math.min(...currentCluster), Math.max(...currentCluster)]);
                currentCluster = [coord];
            }
        });

        if (currentCluster.length) clusters.push([Math.min(...currentCluster), Math.max(...currentCluster)]);
        return clusters;
    }

    // Define a threshold based on average item height
    const avgHeight = columnItems.reduce((sum, item) => sum + item.height, 0) / columnItems.length || 0;
    const bottomThreshold = 2 * avgHeight;

    // Cluster bottom coordinates
    const filteredRows = clusterBottoms(bottomCoords, bottomThreshold);

    // Map each row range to include the minimum top coordinate
    const columnisedRowRanges = filteredRows.map(row => {
        const topsInRow = columnItems
            .filter(item => item.bottom >= row[0] && item.bottom <= row[1])
            .map(item => item.top);

        const topMin = topsInRow.length > 0 ? Math.min(...topsInRow) : Infinity;
        return { columnised: true, range: [topMin, row[1]] };
    });

    // Fill gaps in cropRange.y and add rows
    const rows = [{ range: [cropRange.y[0], columnisedRowRanges[0]?.range[0] || cropRange.y[1]], columnised: false }];

    columnisedRowRanges.forEach((row, index) => {
        rows.push(row);
        const nextRowStart = columnisedRowRanges[index + 1]?.range[0];
        if (nextRowStart && nextRowStart - row.range[1] > 1) {
            rows.push({ range: [row.range[1], nextRowStart], columnised: false });
        }
    });

    rows.push({ range: [columnisedRowRanges.at(-1)?.range[1] || cropRange.y[0], cropRange.y[1]], columnised: false });

    localStorage.setItem(`page-${pageNum}-rows`, JSON.stringify(rows));

    // Tag items with row and column numbers
    items.forEach(item => {
        item.row = rows.findIndex(row => item.top >= row.range[0] && item.bottom <= row.range[1]);
        // If row is columnised, find the column
        if (rows[item.row]?.columnised) {
            item.column = columnRanges.findIndex(column => item.left >= column[0] && item.right <= column[1]);
        }
    });

    appendLogMessage(`=== Page ${pageNum} Rows & Columns ===`);
    appendLogMessage(`Row Ranges: ${JSON.stringify(rows)}`);
    appendLogMessage(`Column Ranges: ${JSON.stringify(columnRanges)}`);
    localStorage.setItem(`page-${pageNum}-items`, JSON.stringify(items));
}
