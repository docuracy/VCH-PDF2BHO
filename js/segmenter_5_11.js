// Import OpenCV
self.importScripts('./opencv.js');

// Ensure OpenCV is ready before processing
cv.onRuntimeInitialized = () => {
    console.log('OpenCV loaded and ready');
    self.onmessage = async (e) => {
        const { action, imageData } = e.data;

        if (action === 'processPage') {
            // Process the image data
            const blocks = processPage(imageData);

            // Send the results back to the main script
            self.postMessage({ action: 'result', segmentation: blocks });
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
    const rowBoundaries = detectRows(binary);

    // Process each detected row to find column boundaries and inner rows
    for (const [start, end, lineBefore] of rowBoundaries) {
        const rowMat = binary.roi(new cv.Rect(0, start, binary.cols, end - start));
        const colBoundaries = detectColumns(rowMat);

        const columns = colBoundaries.map(([colStart, colEnd]) => {
            // Extract column submatrix and detect rows within it
            const colMat = rowMat.roi(new cv.Rect(colStart, 0, colEnd - colStart, rowMat.rows));

            const lineBoundaries = detectRows(colMat, 1).map(([lineStart, lineEnd]) => {
                return [lineStart + start, lineEnd + start];
            });

            const innerRowBoundaries = detectRows(colMat).map(([innerStart, innerEnd, innerLineBefore], idx, arr) => {
                const yStart = innerStart + start; // Adjust for parent row offset
                const yEnd = innerEnd + start;

                const innerRowData = {
                    range: [yStart, yEnd],
                    separation: (idx > 0) ? yStart - (arr[idx - 1][1] + start) : yStart - start,
                    height: yEnd - yStart,
                    lineBefore: innerLineBefore
                };

                // // If `innerLineBefore` is true, augment this inner row by detecting columns (possibly a table)
                // if (innerLineBefore) {
                //     const innerRowMat = colMat.roi(new cv.Rect(0, innerStart, colMat.cols, innerEnd - innerStart));
                //     innerRowData.subColumns = detectColumns(innerRowMat, leftOffset = colStart);
                //     innerRowMat.delete();
                // }

                const innerRowMat = colMat.roi(new cv.Rect(0, innerStart, colMat.cols, innerEnd - innerStart));
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
            columns: columns,
            lineBefore: lineBefore
        });
    }

    // Add separation and height properties to each block
    blocks.forEach((block, i) => {
        // Calculate separation before this block
        block.separation = (i > 0) ? block.range[0] - blocks[i - 1].range[1] : block.range[0];
        block.height = block.range[1] - block.range[0];
    });

    // Annotate blocks with solid border detection
    checkSolidBorders(src, binary, blocks);

    // Clean up
    src.delete();
    gray.delete();
    binary.delete();

    return blocks;
}

// Helper function to detect row boundaries
function detectRows(mat, maxTextLineSeparation = 6, minLineWidthRatio = 0.95) {
    let rowBoundaries = [];
    let inRow = false;
    let start = 0;
    let blankRows = 0;

    let minLineWidth = Math.floor(mat.cols * minLineWidthRatio);
    let lines = [];

    for (let y = 0; y < mat.rows; y++) {
        const rowNonZero = cv.countNonZero(mat.row(y));

        if (rowNonZero >= minLineWidth) { // Line detected
            lines.push(y);
            blankRows++;
        } else if (rowNonZero > 0) { // Text row
            if (!inRow) {
                start = y; // Start of a new row
                inRow = true;
            }
            blankRows = 0;
        } else { // Blank row
            if (inRow) {
                blankRows++;
                if (blankRows >= maxTextLineSeparation) {
                    rowBoundaries.push([start, y - blankRows, false]);
                    inRow = false;
                }
            }
        }
    }

    // Capture last row boundary if still in a paragraph
    if (inRow) rowBoundaries.push([start, mat.rows, false]);

    // Check for lines between rows and mark the line before the boundary
    let previousEnd = 0;
    rowBoundaries.forEach(([start, end], idx, arr) => {
        arr[idx][2] = lines.filter(line => line > previousEnd && line < start).length > 0;
        previousEnd = end;
    });

    return rowBoundaries;
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


function checkSolidBorders(src, binary, blocks, width = 3, tolerance = 0.95) {

    blocks.forEach(block => {
        const [yStart, yEnd] = block.range;
        const blockHeight = block.height;
        const verticalTolerance = Math.floor(blockHeight * tolerance);

        block.columns.forEach(column => {
            const [xStart, xEnd] = column.range;
            const columnWidth = xEnd - xStart;
            const horizontalTolerance = Math.floor(columnWidth * tolerance);

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

            column.rectangle = Object.keys(edges).every(side => column.border[side]);
        });
    });
}

