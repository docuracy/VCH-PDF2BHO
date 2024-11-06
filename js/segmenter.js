// Import OpenCV
self.importScripts('./opencv.js');

// Ensure OpenCV is ready before processing
cv.onRuntimeInitialized = () => {
    console.log('OpenCV loaded and ready');
    self.onmessage = async (e) => {
        const { action, imageData } = e.data;

        if (action === 'processPage') {
            // Process the image data
            const [blocks, lineItems, rectangles] = processPage(imageData);

            // Send the results back to the main script
            self.postMessage({ action: 'result', segmentation: blocks, lineItems: lineItems, rectangles: rectangles });
        }
    };
};

// Processing function
function processPage(imageData) {
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
                innerRows: innerRowBoundaries
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

