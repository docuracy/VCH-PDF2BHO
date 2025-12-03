// segmenter.js
// Description: Hybrid Layout Analysis - Multi-Line Title / Boxed-Figure / Expanded-Table / Split-Body (RLSA-Only) / Constrained-Footer

self.importScripts('./opencv.js');

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
    const searchStart = Math.floor(height * 0.6);
    const searchEnd = height;

    let maxGapSize = 0;
    let maxGapEnd = -1;
    let currentGapStart = -1;

    for (let y = searchStart; y < searchEnd; y++) {
        let hasContent = false;
        const rowOffset = y * width;
        for (let x = 0; x < width; x += 10) {
            if (rawData[rowOffset + x] > 0) {
                hasContent = true;
                break;
            }
        }

        if (!hasContent) {
            if (currentGapStart === -1) currentGapStart = y;
        } else {
            if (currentGapStart !== -1) {
                const gapSize = y - currentGapStart;
                if (gapSize > maxGapSize) {
                    maxGapSize = gapSize;
                    maxGapEnd = y;
                }
                currentGapStart = -1;
            }
        }
    }

    let splitY = height;
    if (maxGapSize > 15) {
        splitY = maxGapEnd;
        if (splitY > height - 20) splitY = height;
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

    // === STEP 6: CLEANUP & SORT ===
    blocks = mergeOverlappingBlocks(blocks);
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

        if (rect.width < 10 || rect.height < 6) continue;

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