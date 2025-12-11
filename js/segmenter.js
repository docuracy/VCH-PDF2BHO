// segmenter.js
// Description: Hybrid Layout Analysis - Multi-Line Title / Boxed-Figure / Expanded-Table / Split-Body (RLSA-Only) / Constrained-Footer
// Extended with table cell segmentation

self.Module = {
    locateFile(path) {
        if (path.endsWith(".wasm")) {
            return "library/opencv_js.wasm";
        }
        return path;
    }
};

self.importScripts('library/opencv.js');

cv.onRuntimeInitialized = () => {
    console.debug('OpenCV (Worker) loaded and ready');
    self.onmessage = handleMessage;
};

async function handleMessage(e) {
    const { action, imageData, chartItems, pageNum } = e.data;

    if (action === 'processPage') {
        try {
            const result = processPageHybrid(imageData, chartItems, pageNum);
            self.postMessage({
                action: 'result',
                blocks: result.blocks,
                pageStats: result.stats
            });
        } catch (err) {
            console.error("Segmenter Worker Error:", err);
            self.postMessage({ action: 'result', blocks: [], pageStats: {} });
        }
    }
}

function processPageHybrid(imageData, chartItems, pageNum) {
    const src = cv.matFromImageData(imageData);
    const gray = new cv.Mat();
    const binary = new cv.Mat();

    // 1. Threshold
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.adaptiveThreshold(gray, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 31, 10);

    const width = src.cols;
    const height = src.rows;
    let blocks = [];
    const rawData = binary.data;

    // === STEP 1: HEADER / TITLE DETECTION ===
    let headerBottom = 0;

    // A. Helper to scan a single horizontal strip of ink
    function scanLine(startY, endY) {
        let firstY = -1;
        let lastY = -1;

        // Find Start
        for (let y = startY; y < endY; y++) {
            let hasPixel = false;
            const rowOffset = y * width;
            for (let x = 0; x < width; x += 5) {
                if (rawData[rowOffset + x] > 0) {
                    hasPixel = true;
                    break;
                }
            }
            if (hasPixel) {
                firstY = y;
                break;
            }
        }

        if (firstY === -1) return null; // No ink found

        // Find End (Gap)
        const GAP_TOLERANCE = 5;
        let gapCounter = 0;

        for (let y = firstY; y < endY; y++) {
            let hasPixel = false;
            const rowOffset = y * width;
            for (let x = 0; x < width; x += 5) {
                if (rawData[rowOffset + x] > 0) {
                    hasPixel = true;
                    break;
                }
            }

            if (!hasPixel) {
                gapCounter++;
                if (gapCounter >= GAP_TOLERANCE) {
                    lastY = y - GAP_TOLERANCE;
                    break;
                }
            } else {
                gapCounter = 0;
            }
        }

        if (lastY === -1) lastY = endY; // Hit limit

        return { y: firstY, h: lastY - firstY, bottom: lastY };
    }

    // B. Detect
    const headerScanLimit = Math.floor(height * (pageNum === 1 ? 0.35 : 0.20));

    // Find the first line
    let primaryLine = scanLine(0, headerScanLimit);

    if (primaryLine) {
        let finalBottom = primaryLine.bottom;

        // If Page 1, try to collect multi-line TITLEs
        if (pageNum === 1) {
            let currentBottom = primaryLine.bottom;
            const refHeight = primaryLine.h;

            while (true) {
                // Look for next line within reasonable gap
                const nextLine = scanLine(currentBottom + 5, headerScanLimit);

                if (!nextLine) break;

                // Gap Check: Is the next line close? (< 40px)
                const gap = nextLine.y - currentBottom;
                if (gap > 40) break;

                // Height Check: Is it roughly the same size? (within 30%)
                const hDiff = Math.abs(nextLine.h - refHeight);
                if (hDiff > (refHeight * 0.3)) break;

                // Match! Extend block.
                currentBottom = nextLine.bottom;
                finalBottom = nextLine.bottom;
            }
        }

        // Create the Block (Header or Title)
        // Find X-bounds for the whole detected vertical region
        const roiH = finalBottom - primaryLine.y;
        if (roiH > 0) {
            const headerROI = binary.roi(new cv.Rect(0, primaryLine.y, width, roiH));
            const hContours = new cv.MatVector();
            const hHier = new cv.Mat();
            cv.findContours(headerROI, hContours, hHier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            let minX = width, maxX = 0;
            let foundContent = false;

            for (let i = 0; i < hContours.size(); i++) {
                const rect = cv.boundingRect(hContours.get(i));
                if (rect.width > 2) {
                    if (rect.x < minX) minX = rect.x;
                    if (rect.x + rect.width > maxX) maxX = rect.x + rect.width;
                    foundContent = true;
                }
            }

            if (foundContent) {
                const type = (pageNum === 1) ? 'HEADING' : 'HEADER';
                blocks.push({
                    x: minX, y: primaryLine.y,
                    width: maxX - minX, height: roiH,
                    type: type
                });
                headerBottom = finalBottom + 5;
            }
            headerROI.delete(); hContours.delete(); hHier.delete();
        }
    }


    // === STEP 2: FIND FOOTER SEPARATOR ===
    // Scan from bottom to top looking for a significantly wide horizontal white gap
    // This gap separates footnotes from body text

    const searchStart = height; // Start from the very bottom
    const searchEnd = Math.floor(height * 0.1); // Don't scan above 90% of page
    const HARD_THRESHOLD = 5; // Absolute gap size that's definitely a separator
    const SIGNIFICANT_INCREASE = 3.5; // Gap must be 3x larger than previous gaps
    const MIN_GAP_SIZE = 1; // Minimum gap to consider

    const gaps = []; // Track all gaps from bottom up
    let currentGapStart = -1;
    let currentGapEnd = -1;

    // Scan from bottom to top
    for (let y = searchStart - 1; y >= searchEnd; y--) {
        let hasContent = false;
        const rowOffset = y * width;
        for (let x = 0; x < width; x += 10) {
            if (rawData[rowOffset + x] > 0) {
                hasContent = true;
                break;
            }
        }

        if (!hasContent) {
            // In a gap
            if (currentGapStart === -1) {
                currentGapStart = y; // Start of gap (from bottom up)
            }
            currentGapEnd = y; // Update end of gap (top edge)
        } else {
            // Hit content - end of gap
            if (currentGapStart !== -1) {
                const gapSize = currentGapStart - currentGapEnd + 1;
                if (gapSize >= MIN_GAP_SIZE) {
                    gaps.push({
                        topY: currentGapEnd,
                        bottomY: currentGapStart,
                        size: gapSize
                    });

                    // Skip the first gap - it's the bottom margin
                    if (gaps.length === 1) {
                        currentGapStart = -1;
                        currentGapEnd = -1;
                        continue;
                    }

                    // Check if this gap is significantly larger than previous gaps
                    // or exceeds hard threshold
                    if (gapSize >= HARD_THRESHOLD) {
                        // Found a definite separator
                        break;
                    }

                    // Compare with previous gaps (excluding first gap which is bottom margin)
                    if (gaps.length > 2) {
                        const previousGaps = gaps.slice(1, -1); // Skip first (margin) and last (current)
                        const maxPreviousGap = Math.max(...previousGaps.map(g => g.size));
                        if (gapSize >= maxPreviousGap * SIGNIFICANT_INCREASE) {
                            // This gap is significantly larger - likely the separator
                            break;
                        }
                    }
                }
                currentGapStart = -1;
                currentGapEnd = -1;
            }
        }
    }

    // Determine split point
    let splitY = height;
    console.debug(`Footer separator gaps found: ${gaps.length}`, gaps);
    if (gaps.length > 1) {
        // Use the last gap found (largest/most significant from bottom-up scan)
        // Skip gaps[0] which is the bottom margin
        const separatorGap = gaps[gaps.length - 1];
        splitY = separatorGap.bottomY + 1; // Split just after the gap

        // Don't create a tiny footer zone
        if (splitY > height - 20) {
            splitY = height;
        }
    }

    // === STEP 3: SEGMENT BODY (Figures + Tables + RLSA Text) ===
    if (splitY > headerBottom) {
        const bodyHeight = splitY - headerBottom;
        if (bodyHeight > 0) {
            const bodyRect = new cv.Rect(0, headerBottom, width, bodyHeight);

            // PRIORITY: 1. Figure -> 2. Table -> 3. Text (Raw RLSA Blocks)
            const bodyBlocks = segmentBodyDetailed(binary, bodyRect, 'BODY', chartItems);
            blocks.push(...bodyBlocks);
        }
    }

    // === STEP 4: SEGMENT FOOTER ===
    if (splitY < height) {
        const footHeight = height - splitY;
        const footRect = new cv.Rect(0, splitY, width, footHeight);
        const footBlocks = segmentFooterZone(binary, footRect, chartItems);
        blocks.push(...footBlocks);
    }

    // === STEP 5: DETECT HEADINGS ===
    const headingBlocks = detectHeadings(gray, blocks, width);
    blocks = applyHeadingResults(blocks, headingBlocks);

    // === STEP 6: SEGMENT TABLES INTO CELLS ===
    blocks = segmentTableCells(binary, blocks);

    // === STEP 7: CLEANUP & SORT ===
    blocks = mergeOverlappingBlocks(blocks);
    blocks = mergeBlocksOnSameLine(blocks, width);
    sortBlocksByReadingOrder(blocks, width);

    let orderCounter = 1;
    blocks.forEach(b => {
        if (b.type !== 'HEADER' && b.type !== 'FOOTER') {
            b.order = orderCounter++;
        }
    });

    src.delete(); gray.delete(); binary.delete();

    return { blocks, stats: { width, height } };
}

/**
 * Segment detected TABLE blocks into cells with row/column/section attributes.
 *
 * Tables are characterised by:
 * - At least 3 horizontal solid lines
 * - No vertical solid lines
 * - Caption (optional) above first line
 * - Header between lines 1 and 2
 * - Body below line 2, above last line
 * - Notes (optional) below last line
 * - Columns distinguished by vertical white rivers
 * - Rows distinguished by horizontal white rivers or lines
 */
function segmentTableCells(binaryImage, blocks) {
    const newBlocks = [];

    // Separate TABLE blocks from others
    const tableBlocks = blocks.filter(b => b.type === 'TABLE');
    const otherBlocks = blocks.filter(b => b.type !== 'TABLE');

    // Deduplicate TABLE blocks with identical or near-identical bounds
    const uniqueTables = [];
    const TOLERANCE = 5; // pixels

    for (const table of tableBlocks) {
        const isDuplicate = uniqueTables.some(existing =>
            Math.abs(existing.x - table.x) <= TOLERANCE &&
            Math.abs(existing.y - table.y) <= TOLERANCE &&
            Math.abs(existing.width - table.width) <= TOLERANCE &&
            Math.abs(existing.height - table.height) <= TOLERANCE
        );

        if (!isDuplicate) {
            uniqueTables.push(table);
        }
    }

    console.debug(`Deduplicated ${tableBlocks.length} TABLE blocks to ${uniqueTables.length}`);

    // Add non-table blocks
    newBlocks.push(...otherBlocks);

    // Process unique tables
    for (const block of uniqueTables) {
        // Extract ROI for this table
        const tableROI = binaryImage.roi(new cv.Rect(block.x, block.y, block.width, block.height));

        try {
            const cellBlocks = parseTableStructure(tableROI, block);
            newBlocks.push(...cellBlocks);
        } catch (err) {
            console.error("Table segmentation error:", err);
            // Fall back to original block if parsing fails
            newBlocks.push(block);
        }

        tableROI.delete();
    }

    return newBlocks;
}

/**
 * Parse table structure and return cell blocks
 */
function parseTableStructure(tableROI, tableBlock) {
    const width = tableROI.cols;
    const height = tableROI.rows;
    const absX = tableBlock.x;
    const absY = tableBlock.y;

    // === STEP 1: Detect horizontal lines ===
    const horizontalLines = detectHorizontalLines(tableROI);

    console.debug(`Table at (${absX}, ${absY}): Found ${horizontalLines.length} horizontal lines`);

    // Need at least 3 lines for a valid table structure
    if (horizontalLines.length < 3) {
        console.debug("Insufficient horizontal lines for table parsing, returning original block");
        return [{
            ...tableBlock,
            right: tableBlock.x + tableBlock.width,
            bottom: tableBlock.y + tableBlock.height
        }];
    }

    // Sort lines by y position
    horizontalLines.sort((a, b) => a.y - b.y);

    // === STEP 2: Identify table sections ===
    const firstLineY = horizontalLines[0].y;
    const firstLineBottom = horizontalLines[0].y + horizontalLines[0].height;
    const secondLineY = horizontalLines[1].y;
    const secondLineBottom = horizontalLines[1].y + horizontalLines[1].height;
    const lastLineY = horizontalLines[horizontalLines.length - 1].y;
    const lastLineBottom = horizontalLines[horizontalLines.length - 1].y + horizontalLines[horizontalLines.length - 1].height;

    // Section boundaries (relative to table ROI)
    // Body starts AFTER the second line and ends BEFORE the last line
    const sections = {
        caption: { start: 0, end: firstLineY },
        header: { start: firstLineBottom, end: secondLineY },
        body: { start: secondLineBottom, end: lastLineY },
        notes: { start: lastLineBottom, end: height }
    };

    // === STEP 3: Detect column dividers from header region ===
    const headerHeight = sections.header.end - sections.header.start;
    let columnRivers = [];

    if (headerHeight > 5) {
        const headerROI = tableROI.roi(new cv.Rect(0, sections.header.start, width, headerHeight));
        columnRivers = detectVerticalRivers(headerROI, 5); // minimum river width threshold
        headerROI.delete();
    }

    console.debug(`Found ${columnRivers.length} column dividers:`, columnRivers);

    // Build column boundaries
    const columnBounds = buildColumnBounds(columnRivers, width);

    // === STEP 4: Detect row dividers in body ===
    const bodyHeight = sections.body.end - sections.body.start;
    let rowDividers = [];

    if (bodyHeight > 5) {
        // Check for lines within the body (between line 2 and last line)
        const bodyLines = horizontalLines.filter(line =>
            line.y > sections.body.start && line.y < sections.body.end
        );

        if (bodyLines.length > 0) {
            // If there are additional horizontal lines, use them as the only dividers
            rowDividers = bodyLines.map(l => ({
                y: l.y - sections.body.start,
                height: l.height,
                source: 'line'
            }));
        } else {
            // No additional lines - fall back to white river detection
            const bodyROI = tableROI.roi(new cv.Rect(0, sections.body.start, width, bodyHeight));
            const whiteRowDividers = detectHorizontalRivers(bodyROI, 3);
            bodyROI.delete();

            // Use only the y-centre of each river as the divider position
            rowDividers = whiteRowDividers.map(r => ({
                y: Math.floor(r.center),
                height: 0,  // point divider, not a range
                source: 'river'
            }));
        }

        // Sort and deduplicate
        rowDividers.sort((a, b) => a.y - b.y);
        rowDividers = deduplicateDividers(rowDividers, 10);
    }

    console.debug(`Found ${rowDividers.length} row dividers`);

    // Build row boundaries for body
    const rowBounds = buildRowBounds(rowDividers, bodyHeight);

    // === STEP 5: Generate cell blocks ===
    const cellBlocks = [];
    const tableId = `table_${absX}_${absY}`;

    // Caption (if present - check for content)
    if (sections.caption.end - sections.caption.start > 3) {
        const captionBlock = extractSectionBlock(
            tableROI, sections.caption.start, sections.caption.end,
            absX, absY, tableId, 'caption', null, null, width
        );
        if (captionBlock) cellBlocks.push(captionBlock);
    }

    // Header cells
    for (let col = 0; col < columnBounds.length; col++) {
        const colBound = columnBounds[col];
        const cellBlock = extractCellBlock(
            tableROI,
            sections.header.start, sections.header.end,
            colBound.start, colBound.end,
            absX, absY, tableId,
            'header', 0, col
        );
        if (cellBlock) cellBlocks.push(cellBlock);
    }

    // Body cells
    for (let row = 0; row < rowBounds.length; row++) {
        const rowBound = rowBounds[row];
        for (let col = 0; col < columnBounds.length; col++) {
            const colBound = columnBounds[col];
            const cellBlock = extractCellBlock(
                tableROI,
                sections.body.start + rowBound.start,
                sections.body.start + rowBound.end,
                colBound.start, colBound.end,
                absX, absY, tableId,
                'body', row, col
            );
            if (cellBlock) cellBlocks.push(cellBlock);
        }
    }

    // Notes (if present - check for content)
    if (sections.notes.end - sections.notes.start > 3) {
        const notesBlock = extractSectionBlock(
            tableROI, sections.notes.start, sections.notes.end,
            absX, absY, tableId, 'notes', null, null, width
        );
        if (notesBlock) cellBlocks.push(notesBlock);
    }

    console.debug(`Generated ${cellBlocks.length} cell blocks for table`);

    return cellBlocks.length > 0 ? cellBlocks : [{
        ...tableBlock,
        right: tableBlock.x + tableBlock.width,
        bottom: tableBlock.y + tableBlock.height
    }];
}

/**
 * Detect horizontal lines using morphological operations
 */
function detectHorizontalLines(roi) {
    const width = roi.cols;
    const height = roi.rows;

    // Use a long horizontal kernel to detect solid lines
    const minLineWidth = Math.max(50, width * 0.3);
    const lineKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(Math.floor(minLineWidth), 1));
    const linesMat = new cv.Mat();
    cv.morphologyEx(roi, linesMat, cv.MORPH_OPEN, lineKernel);

    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(linesMat, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const lines = [];
    for (let i = 0; i < contours.size(); i++) {
        const rect = cv.boundingRect(contours.get(i));
        // Filter: must be wide and thin
        if (rect.width > minLineWidth * 0.8 && rect.height < 15) {
            lines.push({
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: Math.max(rect.height, 1)
            });
        }
    }

    lineKernel.delete();
    linesMat.delete();
    contours.delete();
    hierarchy.delete();

    return lines;
}

/**
 * Detect vertical white rivers (column dividers) in a region.
 * Returns array of river objects with { start, end, center } coordinates.
 * Filters out edge rivers (margins at x=0 or x=width).
 */
function detectVerticalRivers(roi, minWidth) {
    const width = roi.cols;
    const height = roi.rows;

    // Clone the ROI to get contiguous memory layout
    // (ROI.data uses parent's stride which causes incorrect indexing)
    const roiClone = roi.clone();
    const rawData = roiClone.data;

    // For each column, count the percentage of ink pixels
    const columnInkDensity = [];
    for (let x = 0; x < width; x++) {
        let inkCount = 0;
        for (let y = 0; y < height; y++) {
            if (rawData[y * width + x] > 0) {
                inkCount++;
            }
        }
        columnInkDensity.push(inkCount / height);
    }

    roiClone.delete();

    // Find runs of low-density columns (rivers)
    const rivers = [];
    let riverStart = -1;
    const densityThreshold = 0.01; // columns with < 1% ink are considered white

    for (let x = 0; x < width; x++) {
        if (columnInkDensity[x] < densityThreshold) {
            if (riverStart === -1) riverStart = x;
        } else {
            if (riverStart !== -1) {
                const riverWidth = x - riverStart;
                if (riverWidth >= minWidth) {
                    rivers.push({
                        start: riverStart,
                        end: x,
                        width: riverWidth,
                        center: riverStart + riverWidth / 2
                    });
                }
                riverStart = -1;
            }
        }
    }

    // Handle river at end
    if (riverStart !== -1) {
        const riverWidth = width - riverStart;
        if (riverWidth >= minWidth) {
            rivers.push({
                start: riverStart,
                end: width,
                width: riverWidth,
                center: riverStart + riverWidth / 2
            });
        }
    }

    // Filter out edge rivers (margins) - only keep interior rivers
    // An interior river doesn't touch x=0 or x=width
    const interiorRivers = rivers.filter(r => r.start > 0 && r.end < width);

    return interiorRivers;
}

/**
 * Detect horizontal white rivers (row dividers) in a region.
 * Filters out edge rivers (at y=0 or y=height) as these are just margins.
 */
function detectHorizontalRivers(roi, minHeight) {
    const width = roi.cols;
    const height = roi.rows;

    // Clone the ROI to get contiguous memory layout
    const roiClone = roi.clone();
    const rawData = roiClone.data;

    // For each row, count the percentage of ink pixels
    const rowInkDensity = [];
    for (let y = 0; y < height; y++) {
        let inkCount = 0;
        const rowOffset = y * width;
        for (let x = 0; x < width; x++) {
            if (rawData[rowOffset + x] > 0) {
                inkCount++;
            }
        }
        rowInkDensity.push(inkCount / width);
    }

    roiClone.delete();

    // Find runs of low-density rows (rivers)
    const rivers = [];
    let riverStart = -1;
    const densityThreshold = 0.02; // rows with < 2% ink are considered white

    for (let y = 0; y < height; y++) {
        if (rowInkDensity[y] < densityThreshold) {
            if (riverStart === -1) riverStart = y;
        } else {
            if (riverStart !== -1) {
                const riverHeight = y - riverStart;
                if (riverHeight >= minHeight) {
                    rivers.push({
                        y: riverStart,
                        height: riverHeight,
                        center: riverStart + riverHeight / 2
                    });
                }
                riverStart = -1;
            }
        }
    }

    // Handle river at end
    if (riverStart !== -1) {
        const riverHeight = height - riverStart;
        if (riverHeight >= minHeight) {
            rivers.push({
                y: riverStart,
                height: riverHeight,
                center: riverStart + riverHeight / 2
            });
        }
    }

    // Filter out edge rivers (margins at top/bottom of body)
    // An interior river doesn't touch y=0 or y=height
    const interiorRivers = rivers.filter(r => r.y > 0 && (r.y + r.height) < height);

    return interiorRivers;
}

/**
 * Build column boundaries from river divider objects.
 * Each river has { start, end } - dividers are at the right-hand edge (end) of each river.
 * Columns run from one divider to the next.
 */
function buildColumnBounds(rivers, totalWidth) {
    const bounds = [];

    if (rivers.length === 0) {
        // Single column spanning full width
        bounds.push({ start: 0, end: totalWidth });
    } else {
        // Sort rivers by position
        rivers.sort((a, b) => a.start - b.start);

        // Extract divider positions (right-hand edge of each river)
        const dividers = rivers.map(r => r.end);

        // First column: from 0 to first divider
        bounds.push({ start: 0, end: dividers[0] });

        // Middle columns: from one divider to the next
        for (let i = 0; i < dividers.length - 1; i++) {
            bounds.push({
                start: dividers[i],
                end: dividers[i + 1]
            });
        }

        // Last column: from last divider to totalWidth
        bounds.push({
            start: dividers[dividers.length - 1],
            end: totalWidth
        });
    }

    // Filter out any zero-width or negative-width columns
    return bounds.filter(b => b.end > b.start);
}

/**
 * Build row boundaries from divider positions
 */
function buildRowBounds(dividers, totalHeight) {
    const bounds = [];

    if (dividers.length === 0) {
        // Single row spanning full height
        bounds.push({ start: 0, end: totalHeight });
    } else {
        // First row
        bounds.push({ start: 0, end: Math.floor(dividers[0].y) });

        // Middle rows
        for (let i = 0; i < dividers.length - 1; i++) {
            const startY = Math.floor(dividers[i].y + (dividers[i].height || 0));
            const endY = Math.floor(dividers[i + 1].y);
            if (endY > startY) {
                bounds.push({ start: startY, end: endY });
            }
        }

        // Last row
        const lastDiv = dividers[dividers.length - 1];
        const lastStart = Math.floor(lastDiv.y + (lastDiv.height || 0));
        if (totalHeight > lastStart) {
            bounds.push({ start: lastStart, end: totalHeight });
        }
    }

    return bounds.filter(b => b.end > b.start);
}

/**
 * Deduplicate dividers that are close together
 */
function deduplicateDividers(dividers, tolerance) {
    if (dividers.length === 0) return [];

    const result = [dividers[0]];
    for (let i = 1; i < dividers.length; i++) {
        const last = result[result.length - 1];
        if (dividers[i].y - last.y > tolerance) {
            result.push(dividers[i]);
        }
    }
    return result;
}

/**
 * Extract a cell block from the table ROI
 */
function extractCellBlock(roi, yStart, yEnd, xStart, xEnd, absX, absY, tableId, section, row, col) {
    const cellHeight = yEnd - yStart;
    const cellWidth = xEnd - xStart;

    if (cellHeight < 3 || cellWidth < 3) return null;

    // Check if there's actual content in this cell
    const cellROI = roi.roi(new cv.Rect(
        Math.max(0, xStart),
        Math.max(0, yStart),
        Math.min(cellWidth, roi.cols - xStart),
        Math.min(cellHeight, roi.rows - yStart)
    ));

    const nonZero = cv.countNonZero(cellROI);
    cellROI.delete();

    // Skip empty cells (but still create block for structure)
    const hasContent = nonZero > (cellWidth * cellHeight * 0.005);

    return {
        x: absX + xStart,
        y: absY + yStart,
        width: cellWidth,
        height: cellHeight,
        right: absX + xEnd,
        bottom: absY + yEnd,
        type: 'TABLE',
        tableId: tableId,
        section: section,
        row: row,
        column: col,
        hasContent: hasContent
    };
}

/**
 * Extract a section block (caption or notes) from the table ROI
 */
function extractSectionBlock(roi, yStart, yEnd, absX, absY, tableId, section, row, col, totalWidth) {
    const sectionHeight = yEnd - yStart;

    if (sectionHeight < 3) return null;

    // Check if there's actual content
    const sectionROI = roi.roi(new cv.Rect(0, yStart, totalWidth, sectionHeight));
    const nonZero = cv.countNonZero(sectionROI);
    sectionROI.delete();

    // Only create block if there's meaningful content
    if (nonZero < totalWidth * sectionHeight * 0.005) return null;

    // Find actual content bounds within the section
    const contentROI = roi.roi(new cv.Rect(0, yStart, totalWidth, sectionHeight));
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(contentROI, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let minX = totalWidth, maxX = 0, minY = sectionHeight, maxY = 0;
    let foundContent = false;

    for (let i = 0; i < contours.size(); i++) {
        const rect = cv.boundingRect(contours.get(i));
        if (rect.width > 2 && rect.height > 2) {
            minX = Math.min(minX, rect.x);
            maxX = Math.max(maxX, rect.x + rect.width);
            minY = Math.min(minY, rect.y);
            maxY = Math.max(maxY, rect.y + rect.height);
            foundContent = true;
        }
    }

    contours.delete();
    hierarchy.delete();
    contentROI.delete();

    if (!foundContent) return null;

    return {
        x: absX + minX,
        y: absY + yStart + minY,
        width: maxX - minX,
        height: maxY - minY,
        right: absX + maxX,
        bottom: absY + yStart + maxY,
        type: 'TABLE',
        tableId: tableId,
        section: section,
        row: row,
        column: col,
        hasContent: true
    };
}

function mergeOverlappingBlocks(blocks) {
    let changed = true;
    while (changed) {
        changed = false;
        for (let i = 0; i < blocks.length; i++) {
            if (blocks[i].deleted) continue;

            for (let j = i + 1; j < blocks.length; j++) {
                if (blocks[j].deleted) continue;

                const b1 = blocks[i];
                const b2 = blocks[j];

                // Don't merge TABLE cells
                if (b1.type === 'TABLE' && b1.section) continue;
                if (b2.type === 'TABLE' && b2.section) continue;

                const x1 = Math.max(b1.x, b2.x);
                const y1 = Math.max(b1.y, b2.y);
                const x2 = Math.min(b1.right, b2.right);
                const y2 = Math.min(b1.bottom, b2.bottom);

                if (x1 < x2 && y1 < y2) {
                    const interArea = (x2 - x1) * (y2 - y1);
                    const minArea = Math.min(b1.width * b1.height, b2.width * b2.height);

                    if (interArea / minArea > 0.95) {
                        b1.x = Math.min(b1.x, b2.x);
                        b1.y = Math.min(b1.y, b2.y);
                        b1.right = Math.max(b1.right, b2.right);
                        b1.bottom = Math.max(b1.bottom, b2.bottom);
                        b1.width = b1.right - b1.x;
                        b1.height = b1.bottom - b1.y;

                        if (b2.type.match(/FIGURE|TABLE|IMAGE/)) b1.type = b2.type;

                        b2.deleted = true;
                        changed = true;
                    }
                }
            }
        }
    }
    return blocks.filter(b => !b.deleted);
}

/**
 * Merge blocks that share the same horizontal line (narrow y-bands).
 * Maintains discrimination between blocks that span center-line vs those that don't.
 */
function mergeBlocksOnSameLine(blocks, pageWidth) {
    const pageCenter = pageWidth / 2;
    const Y_TOLERANCE = 10; // pixels - blocks within this vertical distance are considered on same line
    const CENTER_MARGIN = 50; // pixels from center to consider a block as "spanning"

    // Helper: determine if block spans center
    function spansCenter(block) {
        return block.x < pageCenter - CENTER_MARGIN && block.right > pageCenter + CENTER_MARGIN;
    }

    // Helper: check if two blocks are on the same line (overlap in y-dimension)
    function onSameLine(b1, b2) {
        const y1Top = b1.y;
        const y1Bottom = b1.bottom;
        const y2Top = b2.y;
        const y2Bottom = b2.bottom;

        // Check if y-ranges overlap with tolerance
        return (y1Top <= y2Bottom + Y_TOLERANCE) && (y1Bottom >= y2Top - Y_TOLERANCE);
    }

    // Helper: check if blocks should be merged
    function shouldMerge(b1, b2) {
        // Don't merge special types
        if (b1.type === 'FIGURE' || b2.type === 'FIGURE') return false;
        if (b1.type === 'IMAGE' || b2.type === 'IMAGE') return false;
        if (b1.type === 'TABLE' || b2.type === 'TABLE') return false;
        if (b1.type === 'HEADER' || b2.type === 'HEADER') return false;
        if (b1.type === 'FOOTER' || b2.type === 'FOOTER') return false;

        // Check if they're on the same line
        if (!onSameLine(b1, b2)) return false;

        // Get span status
        const b1Spans = spansCenter(b1);
        const b2Spans = spansCenter(b2);

        // Only merge if both span or both don't span center
        if (b1Spans !== b2Spans) return false;

        // If neither spans center, check they're on same side
        if (!b1Spans && !b2Spans) {
            const b1Center = b1.x + b1.width / 2;
            const b2Center = b2.x + b2.width / 2;
            const b1Left = b1Center < pageCenter;
            const b2Left = b2Center < pageCenter;

            // Only merge if on same side of page
            if (b1Left !== b2Left) return false;
        }

        return true;
    }

    // Merge blocks
    let changed = true;
    let iterations = 0;
    const MAX_ITERATIONS = 10;

    while (changed && iterations < MAX_ITERATIONS) {
        changed = false;
        iterations++;

        // Sort blocks left-to-right, top-to-bottom for consistent merging
        blocks.sort((a, b) => {
            const yDiff = a.y - b.y;
            if (Math.abs(yDiff) > Y_TOLERANCE) return yDiff;
            return a.x - b.x;
        });

        for (let i = 0; i < blocks.length; i++) {
            if (blocks[i].deleted) continue;

            for (let j = i + 1; j < blocks.length; j++) {
                if (blocks[j].deleted) continue;

                const b1 = blocks[i];
                const b2 = blocks[j];

                if (shouldMerge(b1, b2)) {
                    // Merge b2 into b1
                    b1.x = Math.min(b1.x, b2.x);
                    b1.y = Math.min(b1.y, b2.y);
                    b1.right = Math.max(b1.right, b2.right);
                    b1.bottom = Math.max(b1.bottom, b2.bottom);
                    b1.width = b1.right - b1.x;
                    b1.height = b1.bottom - b1.y;

                    b2.deleted = true;
                    changed = true;
                }
            }
        }
    }

    return blocks.filter(b => !b.deleted);
}

function sortBlocksByReadingOrder(blocks, pageW) {
    const pageCenter = pageW / 2;
    const LINE_TOLERANCE = 8; // pixels for vertical alignment

    // Step 0: assign column type
    blocks.forEach(b => {
        const bCenter = b.x + (b.width / 2);
        if (b.type.match(/HEADER|HEADING|FOOTER|TITLE/) || (b.x < pageCenter - 50 && b.x + b.width > pageCenter + 50)) {
            b.colType = 'SPAN';
        } else if (bCenter < pageCenter) {
            b.colType = 'LEFT';
        } else {
            b.colType = 'RIGHT';
        }
    });

    // Step 1: group blocks into vertical lines with tolerance
    const lines = [];
    const sortedByY = blocks.slice().sort((a,b) => a.y - b.y);
    for (const b of sortedByY) {
        let placed = false;
        for (const line of lines) {
            const lineTop = Math.min(...line.map(x => x.y));
            const lineBottom = Math.max(...line.map(x => x.y + x.height));
            if (b.y <= lineBottom + LINE_TOLERANCE && b.y + b.height >= lineTop - LINE_TOLERANCE) {
                line.push(b);
                placed = true;
                break;
            }
        }
        if (!placed) lines.push([b]);
    }

    // Step 2: sort blocks within each line: LEFT → RIGHT → SPAN
    lines.forEach(line => {
        const lefts = line.filter(b => b.colType === 'LEFT').sort((a,b) => a.x - b.x);
        const rights = line.filter(b => b.colType === 'RIGHT').sort((a,b) => a.x - b.x);
        const spans = line.filter(b => b.colType === 'SPAN').sort((a,b) => a.x - b.x);
        line.splice(0, line.length, ...lefts, ...rights, ...spans);
    });

    // Step 3: sort lines top-to-bottom by the top of the line
    lines.sort((a,b) => Math.min(...a.map(x => x.y)) - Math.min(...b.map(x => x.y)));

    // Step 4: flatten
    const sorted = lines.flat();

    // Step 5: overwrite original array
    blocks.splice(0, blocks.length, ...sorted);
}


function segmentBodyDetailed(fullBinary, roiRect, zoneType, chartItems) {
    const roi = fullBinary.roi(roiRect);
    const blocks = [];

    // A. DETECT BOXED FIGURES
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(roi, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

    const figureMask = new cv.Mat.zeros(roi.rows, roi.cols, cv.CV_8UC1);
    const figureRects = [];

    for (let i = 0; i < contours.size(); i++) {
        const rect = cv.boundingRect(contours.get(i));
        const hasChild = hierarchy.intPtr(0, i)[2] !== -1;
        const absX = rect.x + roiRect.x;
        const absY = rect.y + roiRect.y;

        const hasLabel = chartItems.some(item =>
            item.x >= absX && item.x <= absX + rect.width &&
            item.y >= absY && item.y <= absY + rect.height
        );

        if (hasLabel || (rect.width > 100 && rect.height > 100 && hasChild)) {
            blocks.push({
                x: absX, y: absY, width: rect.width, height: rect.height,
                right: absX + rect.width, bottom: absY + rect.height,
                density: 0, type: 'FIGURE'
            });
            figureRects.push(rect);
            const pt1 = new cv.Point(rect.x, rect.y);
            const pt2 = new cv.Point(rect.x + rect.width, rect.y + rect.height);
            cv.rectangle(figureMask, pt1, pt2, [255, 255, 255, 255], -1);
        }
    }
    contours.delete(); hierarchy.delete();

    // B. MASK FIGURES
    const cleanROI = roi.clone();
    figureRects.forEach(rect => {
        const pt1 = new cv.Point(rect.x, rect.y);
        const pt2 = new cv.Point(rect.x + rect.width, rect.y + rect.height);
        cv.rectangle(cleanROI, pt1, pt2, [0, 0, 0, 0], -1);
    });

    // C. DETECT TABLES
    const tableRects = detectTableRegions(cleanROI, roiRect);
    tableRects.forEach(tRect => {
        blocks.push({
            x: tRect.x, y: tRect.y,
            width: tRect.width, height: tRect.height,
            right: tRect.x + tRect.width, bottom: tRect.y + tRect.height,
            density: 0, type: 'TABLE'
        });

        const relX = tRect.x - roiRect.x;
        const relY = tRect.y - roiRect.y;
        if (relX >= 0 && relY >= 0 && relX + tRect.width <= cleanROI.cols && relY + tRect.height <= cleanROI.rows) {
            const pt1 = new cv.Point(relX, relY);
            const pt2 = new cv.Point(relX + tRect.width, relY + tRect.height);
            cv.rectangle(cleanROI, pt1, pt2, [0, 0, 0, 0], -1);
        }
    });

    // D. DETECT TEXT (Raw RLSA)
    const rawBlocks = runStandardRLSA(cleanROI, roiRect, zoneType, chartItems, 5, 15);
    blocks.push(...rawBlocks);

    roi.delete(); figureMask.delete(); cleanROI.delete();

    return blocks;
}

function detectTableRegions(binaryROI, roiRect) {
    const width = binaryROI.cols;
    const height = binaryROI.rows;
    const rawData = binaryROI.data;

    const lineKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(50, 1));
    const linesMat = new cv.Mat();
    cv.morphologyEx(binaryROI, linesMat, cv.MORPH_OPEN, lineKernel);

    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(linesMat, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const lines = [];
    for (let i = 0; i < contours.size(); i++) {
        const rect = cv.boundingRect(contours.get(i));
        if (rect.width > 50 && rect.height < 20) {
            lines.push(rect);
        }
    }

    lines.sort((a, b) => a.y - b.y);
    const tableCores = [];

    if (lines.length > 0) {
        let currentBlock = { ...lines[0] };
        const MERGE_TOLERANCE = 60;

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            const prevBottom = currentBlock.y + currentBlock.height;

            if (line.y - prevBottom < MERGE_TOLERANCE) {
                const minX = Math.min(currentBlock.x, line.x);
                const maxX = Math.max(currentBlock.x + currentBlock.width, line.x + line.width);
                const minY = currentBlock.y;
                const maxY = Math.max(prevBottom, line.y + line.height);
                currentBlock = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
            } else {
                tableCores.push(currentBlock);
                currentBlock = { ...line };
            }
        }
        tableCores.push(currentBlock);
    }

    lineKernel.delete(); linesMat.delete(); contours.delete(); hierarchy.delete();

    const RIVER_THRESHOLD = 20;

    return tableCores.map(core => {
        let topY = core.y;
        let bottomY = core.y + core.height;

        let gapCount = 0;
        for (let y = topY - 1; y >= 0; y--) {
            let hasPixel = false;
            const rowOffset = y * width;
            for (let x = 0; x < width; x += 10) {
                if (rawData[rowOffset + x] > 0) {
                    hasPixel = true;
                    break;
                }
            }
            if (hasPixel) {
                gapCount = 0;
                topY = y;
            } else {
                gapCount++;
                if (gapCount > RIVER_THRESHOLD) break;
            }
        }

        gapCount = 0;
        for (let y = bottomY; y < height; y++) {
            let hasPixel = false;
            const rowOffset = y * width;
            for (let x = 0; x < width; x += 10) {
                if (rawData[rowOffset + x] > 0) {
                    hasPixel = true;
                    break;
                }
            }
            if (hasPixel) {
                gapCount = 0;
                bottomY = y + 1;
            } else {
                gapCount++;
                if (gapCount > RIVER_THRESHOLD) break;
            }
        }

        return {
            x: Math.max(0, core.x - 5) + roiRect.x,
            y: topY + roiRect.y,
            width: (core.width + 10),
            height: bottomY - topY
        };
    });
}

function segmentFooterZone(binaryImage, zoneRect, chartItems) {
    const results = [];
    const midX = Math.floor(zoneRect.width / 2);

    const leftRect = new cv.Rect(zoneRect.x, zoneRect.y, midX, zoneRect.height);
    const leftROI = binaryImage.roi(leftRect);
    results.push(...runStandardRLSA(leftROI, leftRect, 'FOOTER', chartItems, 40, 10));
    leftROI.delete();

    const rightWidth = zoneRect.width - midX;
    if (rightWidth > 10) {
        const rightRect = new cv.Rect(zoneRect.x + midX, zoneRect.y, rightWidth, zoneRect.height);
        const rightROI = binaryImage.roi(rightRect);
        results.push(...runStandardRLSA(rightROI, rightRect, 'FOOTER', chartItems, 40, 10));
        rightROI.delete();
    }

    return results;
}

function runStandardRLSA(roi, offsetRect, zoneType, chartItems, hSize, vSize) {
    const hKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(hSize, 1));
    const hMorphed = new cv.Mat();
    cv.morphologyEx(roi, hMorphed, cv.MORPH_CLOSE, hKernel);

    const vKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, vSize));
    const finalMorphed = new cv.Mat();
    cv.morphologyEx(hMorphed, finalMorphed, cv.MORPH_CLOSE, vKernel);

    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(finalMorphed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const blocks = [];

    for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const rect = cv.boundingRect(cnt);

        // Reduced thresholds to capture small text elements (e.g., single digits in captions)
        if (rect.width < 4 || rect.height < 4) continue;

        const absX = rect.x + offsetRect.x;
        const absY = rect.y + offsetRect.y;

        const blockROI = roi.roi(rect);
        const whitePixels = cv.countNonZero(blockROI);
        const density = whitePixels / (rect.width * rect.height);
        blockROI.delete();

        let type = zoneType;
        if (density > 0.85) type = 'IMAGE';
        else if (chartItems.some(item =>
            item.x >= absX && item.x <= absX + rect.width &&
            item.y >= absY && item.y <= absY + rect.height
        )) type = 'FIGURE';

        blocks.push({
            x: absX, y: absY,
            width: rect.width, height: rect.height,
            right: absX + rect.width, bottom: absY + rect.height,
            density: density,
            type: type
        });
    }

    hMorphed.delete(); finalMorphed.delete();
    contours.delete(); hierarchy.delete(); hKernel.delete(); vKernel.delete();

    return blocks;
}

/**
 * Detect headings using OpenCV.js block lists.
 *
 * Inputs:
 *   pageMat     : cv.Mat (grayscale image of page)
 *   blocks      : [{x, y, width, height}, ...] from your contour/block detector
 *   pageWidth   : number
 *
 * Output:
 *   mergedHeadings : array of merged heading blocks
 */

function detectHeadings(pageMat, blocks) {
    //----------------------------------------
    // 0. Filter only unclassified blocks
    //----------------------------------------
    const relevantBlocks = blocks.filter(b => !['FOOTER','HEADER','FIGURE','TABLE'].includes(b.type));

    if (relevantBlocks.length === 0) return [];

    //----------------------------------------
    // 1. Compute centre between minX and maxX of relevant blocks
    //----------------------------------------
    const minX = Math.min(...relevantBlocks.map(b => b.x));
    const maxX = Math.max(...relevantBlocks.map(b => b.x + b.width));
    const centerX = (minX + maxX) / 2;

    // 2. Candidate blocks = indices of relevantBlocks crossing center
    const candidates = relevantBlocks
        .map((b,i) => ({b,i}))
        .filter(({b}) => (b.x <= centerX && (b.x + b.width) >= centerX))
        .map(({i}) => i);

    console.debug("Center Crossing Blocks:", candidates.length);

    function vOverlap(a,b) { return (a.y <= b.y+b.height) && (b.y <= a.y+a.height); }

    const n = relevantBlocks.length;
    const adj = Array.from({length:n},()=>new Set());
    for (const i of candidates) {
        const bi = relevantBlocks[i];
        if (!(bi.x <= centerX && bi.x+bi.width >= centerX)) continue;
        for (let j = 0; j < n; j++) {
            if (i===j) continue;
            if (vOverlap(bi,relevantBlocks[j])) { adj[i].add(j); adj[j].add(i); }
        }
    }
    console.debug("Adjacency", adj);

    //----------------------------------------
    // 7. Connected components & merge
    //----------------------------------------
    const visited = new Set();
    const mergedHeadings = [];

    for (let i=0;i<n;i++) {
        if (visited.has(i) || adj[i].size===0) { visited.add(i); continue; }

        const stack = [i];
        const group = [];
        while(stack.length) {
            const u = stack.pop();
            if (visited.has(u)) continue;
            visited.add(u);
            group.push(u);
            for(const v of adj[u]) if(!visited.has(v)) stack.push(v);
        }

        const hasTrigger = group.some(idx => candidates.includes(idx));
        if (!hasTrigger) continue;

        const xs = group.map(idx => relevantBlocks[idx].x);
        const ys = group.map(idx => relevantBlocks[idx].y);
        const rights = group.map(idx => relevantBlocks[idx].x + relevantBlocks[idx].width);
        const bottoms = group.map(idx => relevantBlocks[idx].y + relevantBlocks[idx].height);

        mergedHeadings.push({
            x: Math.min(...xs),
            y: Math.min(...ys),
            width: Math.max(...rights) - Math.min(...xs),
            height: Math.max(...bottoms) - Math.min(...ys),
            type: 'HEADING'
        });
    }

    return mergedHeadings;
}


function applyHeadingResults(blocks, headings) {

    if (!headings || headings.length === 0) {
        return blocks;   // nothing to modify
    }

    //------------------------------------------------------------
    // Build a set of blocks to remove.
    //
    // We remove any block whose bounding box lies entirely inside
    // any merged heading region. This is robust even without
    // member indices.
    //------------------------------------------------------------
    const toRemove = new Set();

    function blockInside(b, h) {
        return (
            b.x >= h.x &&
            b.y >= h.y &&
            (b.x + b.width) <= (h.x + h.width) &&
            (b.y + b.height) <= (h.y + h.height)
        );
    }

    for (const h of headings) {
        for (let i = 0; i < blocks.length; i++) {
            if (blockInside(blocks[i], h)) {
                toRemove.add(i);
            }
        }
    }

    //------------------------------------------------------------
    // Build the new block list:
    //   1. Keep all non-removed blocks
    //   2. Append merged heading blocks
    //------------------------------------------------------------
    const newBlocks = [];

    for (let i = 0; i < blocks.length; i++) {
        if (!toRemove.has(i)) {
            newBlocks.push(blocks[i]);
        }
    }

    // Insert merged headings last (order is not yet important;
    // sortBlocksByReadingOrder() will handle ordering correctly)
    for (const h of headings) {
        newBlocks.push({
            x: h.x,
            y: h.y,
            width: h.width,
            height: h.height,
            type: "HEADING"
        });
    }

    return newBlocks;
}