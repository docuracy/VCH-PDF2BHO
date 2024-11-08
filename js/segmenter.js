// Import OpenCV
self.importScripts('./opencv.js');

// Ensure OpenCV is ready before processing
cv.onRuntimeInitialized = () => {
    console.log('OpenCV loaded and ready');
    self.onmessage = async (e) => {
        const { action, imageData, chartItems } = e.data;

        if (action === 'processPage') {
            // Process the image data
            const [blocks, lineItems, rectangles] = processPage(imageData, chartItems);

            // Send the results back to the main script
            self.postMessage({ action: 'result', segmentation: blocks, lineItems: lineItems, rectangles: rectangles });
        }
    };
};

// Processing function
function processPage(imageData, chartItems) {
    const src = cv.matFromImageData(imageData);
    const gray = new cv.Mat();
    const binary = new cv.Mat();
    const blocks = [];

    // Convert to grayscale
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // Apply binary thresholding to create a binary image (invert colors)
    cv.threshold(gray, binary, 200, 255, cv.THRESH_BINARY_INV); // Invert to highlight non-white pixels

    // Detect row boundaries
    let [rowBoundaries, lineItems] = detectRows(binary);

    // Merge rows closer than 18 pixels if not the first or last row, and ignoring lines (height <= 5)
    console.log('Row Boundaries:', structuredClone(rowBoundaries));
    for (let i = rowBoundaries.length - 2; i > 1; i--) {
        if (
            rowBoundaries[i][0] - rowBoundaries[i - 1][1] < 18 &&
            rowBoundaries[i][1] - rowBoundaries[i][0] > 5 &&
            rowBoundaries[i - 1][1] - rowBoundaries[i - 1][0] > 5
        ) {
            rowBoundaries[i - 1][1] = rowBoundaries[i][1];
            rowBoundaries.splice(i, 1);
        }
    }

    // Process each detected row to find column boundaries and inner rows
    for (const [start, end] of rowBoundaries) {
        let rowMat;
        try {
            rowMat = binary.roi(new cv.Rect(0, start, binary.cols, end - start));
        }
        catch (err) {
            console.error(err);
            throw err;
        }
        const colBoundaries = detectColumns(rowMat);

        const columns = colBoundaries.map(([colStart, colEnd]) => {
            // Extract column submatrix and detect rows within it
            let colMat;
            try {
                colMat = rowMat.roi(new cv.Rect(colStart, 0, colEnd - colStart, rowMat.rows));
            }
            catch (err) {
                console.error(err);
                throw err;
            }

            let [lineBoundaries, lineBoundaryLineItems] = detectRows(colMat, start, colStart, 0);

            if (colBoundaries.length > 1) lineItems.push(...lineBoundaryLineItems);

            let [innerRowBoundaries, duplicateLineItems] = detectRows(colMat, start, colStart);
            innerRowBoundaries = innerRowBoundaries.map(([innerStart, innerEnd], idx, arr) => {

                const innerRowData = {
                    range: [innerStart, innerEnd],
                    separation: (idx > 0) ? innerStart - (arr[idx - 1][1] + start) : innerStart - start,
                    height: innerEnd - innerStart
                };

                let innerRowMat;
                try {
                    innerRowMat = colMat.roi(new cv.Rect(0, innerStart - start, colMat.cols, innerEnd - innerStart));
                }
                catch (err) {
                    console.error(err);
                    throw err;
                }
                innerRowData.subColumns = detectColumns(innerRowMat, leftOffset = colStart);
                innerRowMat.delete();

                return innerRowData;
            });

            return {
                range: [colStart, colEnd],
                lines: lineBoundaries,
                innerRows: innerRowBoundaries,
            };
        });

        // Store detected blocks
        blocks.push({
            range: [start, end],
            columns: columns
        });
    }

    // Add separation and height properties to each block
    blocks.forEach((block, i) => {
        // Calculate separation before this block
        block.separation = (i > 0) ? block.range[0] - blocks[i - 1].range[1] : block.range[0];
        block.height = block.range[1] - block.range[0];
    });

    // Annotate blocks with solid border detection
    const rectangles = checkSolidBorders(src, binary, blocks);

    if (chartItems.length > 0) addCharts(chartItems, blocks, rectangles, binary);

    // Clean up
    src.delete();
    gray.delete();
    binary.delete();

    return [blocks, lineItems, rectangles];
}

// Helper function to detect row boundaries
function detectRows(mat, topOffset = 0, leftOffset = 0, maxTextLineSeparation = 6, minLineWidthRatio = 0.99) {

    let rowTags = [];
    let lineTags = [];

    // Step 0: For whole-page detection, perform initial scan to find left and right margins
    let leftMargin = mat.cols;
    let rightMargin = 0;
    if (leftOffset === 0) {
        for (let x = 0; x < mat.cols; x++) {
            const colNonZero = cv.countNonZero(mat.col(x));
            if (colNonZero > 0) {
                leftMargin = Math.min(leftMargin, x);
                rightMargin = Math.max(rightMargin, x);
            }
        }
    } else {
        leftMargin = 0;
        rightMargin = mat.cols;
    }

    // Step 1: Classify each row as line, text, or blank
    let minLineWidth = Math.floor((rightMargin - leftMargin) * minLineWidthRatio);
    for (let y = 0; y < mat.rows; y++) {
        const rowNonZero = cv.countNonZero(mat.row(y));
        rowTags.push(rowNonZero > 0 && rowNonZero < minLineWidth);
        lineTags.push(rowNonZero >= minLineWidth);
    }

    // Step 2: Mark up to maxTextLineSeparation contiguous blanks between text rows as text rows
    for (let i = 1; i < rowTags.length - 1; i++) {
        if (rowTags[i] === false) {
            let blanks = 1;
            // Count contiguous blanks
            while (i + blanks < rowTags.length && !rowTags[i + blanks]) blanks++;

            // Check if blanks are surrounded by text rows
            if (blanks <= maxTextLineSeparation && rowTags[i - 1] && rowTags[i + blanks]) {
                for (let j = 0; j < blanks; j++) rowTags[i + j] = true; // Mark blanks as text
            }

            // Skip ahead by the number of blanks processed
            i += blanks - 1;
        }
    }

    // Step 3: Group text rows into blocks
    let rowBoundaries = [];
    let start = 0; // Start index for the text block

    for (let y = 1; y <= rowTags.length; y++) {
        if (y === rowTags.length || rowTags[y] !== rowTags[start]) {
            // If current row is different or it's the last row
            if (rowTags[start]) {
                rowBoundaries.push([topOffset + start, topOffset + y - 1]); // Store boundary of the text block
            }
            // Start a new block
            start = y;
        }
    }

    // Step 4: Group lines into blocks
    let lineItems = [];
    start = 0; // Start index for the line block
    const nudgeDown = 0; // Nudge down to include the line within sorting areas

    for (let y = 1; y <= lineTags.length; y++) {
        if (y === lineTags.length || lineTags[y] !== lineTags[start]) {
            // If current row is different or it's the last row
            if (lineTags[start]) {
                rowBoundaries.push([topOffset + start, topOffset + y - 1]);
                // If it's a line block
                lineItems.push({
                    top: topOffset + start + nudgeDown,
                    bottom: topOffset + y - 1 + nudgeDown,
                    left: leftOffset + leftMargin,
                    right: leftOffset + rightMargin,
                    height: y - start,
                    width: rightMargin - leftMargin + 1,
                    tableLine: true,
                    fontName: 'line',
                    str: ''
                });
            }
            // Start a new block
            start = y;
        }
    }

    rowBoundaries.sort((a, b) => a[0] - b[0]);

    return [rowBoundaries, lineItems];
}

// Helper function to detect column boundaries within a row
function detectColumns(rowMat, leftOffset = 0, minColumnSeparation = 9) {
    let colBoundaries = [];
    let inCol = false;
    let start = 0;
    let blankCols = 0;

    // Step 1: Label each column as text or blank
    const isColText = [];
    for (let x = 0; x < rowMat.cols; x++) {
        const col = rowMat.col(x);
        isColText[x] = cv.countNonZero(col) > 0; // true if column has non-zero pixels
    }

    // Step 2: Group columns into blocks
    for (let x = 0; x < rowMat.cols; x++) {
        if (isColText[x]) {
            if (!inCol) {
                start = x; // Start of a new text block
                inCol = true;
            }
            blankCols = 0; // Reset blank column counter when in a text column
        } else {
            if (inCol) {
                blankCols++;
                if (blankCols >= minColumnSeparation) {
                    colBoundaries.push([leftOffset + start, leftOffset + x - blankCols + 1]); // End of a column block
                    inCol = false;
                }
            }
        }
    }

    // Capture last column boundary if still in a text block
    if (inCol) colBoundaries.push([leftOffset + start, leftOffset + rowMat.cols]);

    return colBoundaries;
}


function checkSolidBorders(src, binary, originalBlocks, width = 3, tolerance = 0.95) {

    const blocks = structuredClone(originalBlocks);
    const rectangles = [];

    // Reverse loop to merge any contiguous blocks
    for (let i = blocks.length - 1; i > 0; i--) {
        const currentBlock = blocks[i];
        const previousBlock = blocks[i - 1];

        // Check if current and previous blocks are contiguous
        if (previousBlock.range[1] + 1 === currentBlock.range[0]) {
            // Merge ranges
            previousBlock.range[1] = currentBlock.range[1];
            previousBlock.height = previousBlock.range[1] - previousBlock.range[0];
            previousBlock.columns.push(...currentBlock.columns);

            // Remove the current block after merging
            blocks.splice(i, 1);
        }
    }

    blocks.forEach((block, i) => {
        const [yStart, yEnd] = block.range;
        const blockHeight = block.height;
        const verticalTolerance = Math.floor(blockHeight * tolerance);

        block.columns.forEach((column, j) => {

            const [xStart, xEnd] = column.range;
            const columnWidth = xEnd - xStart;
            const horizontalTolerance = Math.floor(columnWidth * tolerance);

            // Skip columns with less than 10 pixels in height, which might simply be a line
            if (blockHeight < 10) {
                column.rectangle = false;
                return;
            }

            const edges = {
                top: {
                    positions: Array.from({ length: width }, (_, i) => yStart + i),
                    rect: (y) => new cv.Rect(xStart, y, columnWidth, 1),
                    tolerance: horizontalTolerance,
                },
                bottom: {
                    positions: Array.from({ length: width }, (_, i) => yEnd - i),
                    rect: (y) => new cv.Rect(xStart, y, columnWidth, 1),
                    tolerance: horizontalTolerance,
                },
                left: {
                    positions: Array.from({ length: width }, (_, i) => xStart + i),
                    rect: (x) => new cv.Rect(x, yStart, 1, blockHeight),
                    tolerance: verticalTolerance,
                },
                right: {
                    positions: Array.from({ length: width }, (_, i) => xEnd - i),
                    rect: (x) => new cv.Rect(x, yStart, 1, blockHeight),
                    tolerance: verticalTolerance,
                },
            };

            column.border = {};

            // Check each border for the current column
            for (const [side, { positions, rect, tolerance }] of Object.entries(edges)) {
                const hasBorder = positions.some(pos => {
                    const edge = side === 'top' || side === 'bottom'
                        ? binary.roi(rect(pos)) // For top and bottom, y varies
                        : binary.roi(rect(pos)); // For left and right, x varies
                    const result = cv.countNonZero(edge) >= tolerance;
                    edge.delete(); // Free memory
                    return result;
                });
                column.border[side] = hasBorder;
            }

            if (Object.keys(edges).every(side => column.border[side])) {
                rectangles.push({top: yStart, bottom: yEnd, left: xStart, right: xEnd, height: blockHeight, width: columnWidth, type: 'segmentation'});
            }
        });
    });

    // Remove any duplicate rectangles (iterate in reverse to avoid index issues)
    for (let i = rectangles.length - 1; i > 0; i--) {
        const currentRect = rectangles[i];
        for (let j = i - 1; j >= 0; j--) {
            const previousRect = rectangles[j];
            if (currentRect.top === previousRect.top && currentRect.bottom === previousRect.bottom &&
                currentRect.left === previousRect.left && currentRect.right === previousRect.right) {
                rectangles.splice(i, 1);
                break;
            }
        }
    }

    console.warn('Detected Rectangles:', rectangles);
    return rectangles;
}


function addCharts(chartItems, blocks, rectangles, binary) {

    console.log('Blocks:', structuredClone(blocks));

    // Locate chart items within the detected blocks and check pixel density above them
    chartItems.forEach(item => {
        const block = blocks.find(b =>
            item.y >= b.range[0] && item.y <= b.range[1] &&
            b.columns.some(c => item.x >= c.range[0] && item.x <= c.range[1])
        );
        if (block) {
            const columnRange = block.columns.find(c => item.x >= c.range[0] && item.x <= c.range[1])?.range;
            if (columnRange) {
                const borderWidth = 5;

                // Find index of the current block
                const blockIndex = blocks.findIndex(b => b === block);
                // Loop through blocks between header and blockAboveIndex, finding the column range containing the item's x-coordinate
                let innerRowMax = blocks[1]?.range[0];
                for (let i = 1; i <= blockIndex; i++) {
                    const columnAbove = blocks[i].columns.find(c => item.x >= c.range[0] && item.x <= c.range[1]);
                    if (columnAbove) {
                        columnRange[0] = Math.min(columnRange[0], columnAbove.range[0]);
                        columnRange[1] = Math.max(columnRange[1], columnAbove.range[1]);
                        // Find index of innerRow which contains the item
                        const innerRowAbove = columnAbove.innerRows.findIndex(r => item.y >= r.range[0] && item.y <= r.range[1]) - 1;
                        innerRowMax = Math.max(innerRowMax, columnAbove.innerRows[innerRowAbove]?.range[1] || 0);
                    }
                }
                if (innerRowMax === blocks[1]?.range[0]) {
                    innerRowMax = blockIndex > 1 ? Math.min(blocks[blockIndex - 1]?.range[1], item.top - borderWidth * 2) : item.top - borderWidth * 2;
                }

                const testArea = {
                    left: columnRange[0] - borderWidth,
                    top: blocks[1]?.range[0] - borderWidth,
                    width: columnRange[1] - columnRange[0] + 2 * borderWidth,
                    height: innerRowMax - blocks[1]?.range[0] + 2 * borderWidth
                };

                console.log('Test Area:', testArea);

                // Find area between header and current block
                const testRect = binary.roi(new cv.Rect(testArea.left, testArea.top, testArea.width, testArea.height));
                item.density = cv.countNonZero(testRect) / (testArea.width * testArea.height);

                if (item.density < 0.1) {
                    Object.assign(item, { rowRange: block.range, columnRange });
                    rectangles.push({
                        ...testArea,
                        bottom: testArea.top + testArea.height,
                        right: testArea.left + testArea.width,
                        type: 'chart',
                        chartNumber: item.chartNumber
                    });
                }

                testRect.delete();

            }
        }
    });

    console.info('Chart Items:', structuredClone(chartItems));

}
