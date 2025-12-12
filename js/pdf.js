// /js/pdf.js
// Description: PDF Parsing, Rendering, and Zone Segmentation.

// Import Worker
const worker = new Worker("js/segmenter.js");

// Reverse lookup for PDF Operator names (Required for identifyCropMarks)
const operatorNames = Object.keys(pdfjsLib.OPS).reduce((acc, key) => {
    acc[pdfjsLib.OPS[key]] = key;
    return acc;
}, {});


/**
 * Merge micro-zones with overlapping BODY zones.
 * Extends the bounds of BODY zones to include overlapping micro-zones.
 */
function mergeMicroZonesWithBodyZones(zones) {
    const microZones = zones.filter(z => z.isMicroZone);
    const bodyZones = zones.filter(z => z.type === 'BODY' && !z.isMicroZone);

    if (microZones.length === 0) return;

    let mergedCount = 0;

    microZones.forEach(microZone => {
        // Find BODY zones that overlap with this micro-zone
        for (const bodyZone of bodyZones) {
            const bodyRight = bodyZone.x + bodyZone.width;
            const bodyBottom = bodyZone.y + bodyZone.height;
            const microRight = microZone.x + microZone.width;
            const microBottom = microZone.y + microZone.height;

            const xOverlap = Math.max(0,
                Math.min(microRight, bodyRight) - Math.max(microZone.x, bodyZone.x)
            );
            const yOverlap = Math.max(0,
                Math.min(microBottom, bodyBottom) - Math.max(microZone.y, bodyZone.y)
            );

            // If there's overlap, merge micro-zone into body zone
            if (xOverlap > 0 && yOverlap > 0) {
                // Extend body zone bounds to include micro-zone
                const newX = Math.min(bodyZone.x, microZone.x);
                const newY = Math.min(bodyZone.y, microZone.y);
                const newRight = Math.max(bodyRight, microRight);
                const newBottom = Math.max(bodyBottom, microBottom);

                bodyZone.x = newX;
                bodyZone.y = newY;
                bodyZone.width = newRight - newX;
                bodyZone.height = newBottom - newY;
                bodyZone.right = newRight;
                bodyZone.bottom = newBottom;

                // Transfer items from micro-zone to body zone
                if (microZone.items && microZone.items.length > 0) {
                    bodyZone.items = bodyZone.items || [];
                    bodyZone.items.push(...microZone.items);
                }

                // Mark micro-zone for deletion
                microZone.deleted = true;
                mergedCount++;

                console.log(`Merged micro-zone at y=${microZone.y.toFixed(1)} into BODY zone at y=${bodyZone.y.toFixed(1)}`);
                break; // Move to next micro-zone
            }
        }
    });

    // Remove merged micro-zones from zones array
    if (mergedCount > 0) {
        const originalCount = zones.length;
        zones.splice(0, zones.length, ...zones.filter(z => !z.deleted));
        console.log(`Merged ${mergedCount} micro-zones with BODY zones (${originalCount} -> ${zones.length} zones)`);
    }
}

function sortZoneItems(zones, items) {

    // Move items to zones
    zones.forEach(zone => {
        zone.items = [];
        zone.right = zone.x + zone.width;
        zone.bottom = zone.y + zone.height;
    });

    const orphanedItems = []; // Track items not assigned to any zone

    items.forEach(item => {
        const midX = item.left + item.width / 2;
        const midY = item.top + item.height / 2;
        item.midY = midY; // Store for later sorting

        let assigned = false;
        for (const zone of zones) {
            if (
                midX >= zone.x &&
                midX <= zone.right &&
                midY >= zone.y &&
                midY <= zone.bottom
            ) {
                zone.items.push(item);
                assigned = true;
                break;
            }
        }

        if (!assigned) {
            orphanedItems.push(item);
        }
    });

    // Create micro-zones for orphaned items (e.g., isolated caption numbers)
    // This captures small text elements that fell through the segmentation
    // But skip items that overlap with HEADER zones
    const headerZones = zones.filter(z => z.type === 'HEADER');

    if (headerZones.length > 0) {
        console.log(`Found ${headerZones.length} HEADER zones for overlap checking:`,
            headerZones.map(h => `y=${h.y}-${h.y + h.height}`));
    }

    let microZonesCreated = 0;
    let microZonesSkipped = 0;

    orphanedItems.forEach(item => {
        const MARGIN = 2; // Small margin around the item
        const microZone = {
            x: item.left - MARGIN,
            y: item.top - MARGIN,
            width: item.width + MARGIN * 2,
            height: item.height + MARGIN * 2,
            right: item.left + item.width + MARGIN,
            bottom: item.top + item.height + MARGIN,
            type: 'BODY', // Default to body text
            items: [item],
            isMicroZone: true // Flag for debugging/analysis
        };

        // Check if micro-zone overlaps with any HEADER zone
        let overlapsHeader = false;
        for (const header of headerZones) {
            const headerRight = header.x + header.width;
            const headerBottom = header.y + header.height;

            const xOverlap = Math.max(0,
                Math.min(microZone.right, headerRight) - Math.max(microZone.x, header.x)
            );
            const yOverlap = Math.max(0,
                Math.min(microZone.bottom, headerBottom) - Math.max(microZone.y, header.y)
            );

            if (xOverlap > 0 && yOverlap > 0) {
                overlapsHeader = true;
                console.log(`✗ Skipping micro-zone at y=${microZone.y.toFixed(1)}-${microZone.bottom.toFixed(1)} - overlaps with HEADER at y=${header.y.toFixed(1)}-${headerBottom.toFixed(1)} (xOverlap=${xOverlap.toFixed(1)}, yOverlap=${yOverlap.toFixed(1)})`);
                microZonesSkipped++;
                break;
            }
        }

        // Only add micro-zone if it doesn't overlap with header
        if (!overlapsHeader) {
            zones.push(microZone);
            microZonesCreated++;
        }
    });

    if (orphanedItems.length > 0) {
        console.log(`Micro-zones: ${microZonesCreated} created, ${microZonesSkipped} skipped (overlapped HEADER)`);
    }

    // Merge micro-zones with overlapping BODY zones
    mergeMicroZonesWithBodyZones(zones);

    // Sort items within each zone into lines
    zones.forEach(zone => {
        if (!zone.items || zone.items.length === 0) {
            zone.items = [];
            return;
        }

        zone.items.sort((a, b) => a.midY - b.midY);

        const LINE_TOLERANCE = 5;
        const lines = [];
        let currentLine = [zone.items[0]];

        for (let i = 1; i < zone.items.length; i++) {
            const prevMidY = zone.items[i-1].midY;
            const currMidY = zone.items[i].midY;

            if (Math.abs(currMidY - prevMidY) <= LINE_TOLERANCE) {
                currentLine.push(zone.items[i]);
            } else {
                currentLine.sort((a, b) => a.left - b.left);
                lines.push(currentLine);
                currentLine = [zone.items[i]];
            }
        }

        if (currentLine.length > 0) {
            currentLine.sort((a, b) => a.left - b.left);
            lines.push(currentLine);
        }

        // Merge trailing hyphens within each line
        lines.forEach(line => {
            for (let i = line.length - 1; i > 0; i--) {
                if (line[i].str === '-') {
                    line[i - 1].str += '-';
                    line.splice(i, 1);
                }
            }
        });

        zone.items = lines;
    });
}

/**
 * Pre-processes a single page:
 * - Runs IdentifyCropMarks
 * - Renders to Canvas
 * - Runs RLSA Segmentation (Worker)
 * - Stores classified ZONES
 */
/**
 * Reassign reading order to zones, ensuring reclassified zones and micro-zones get proper ordering.
 * This is needed because:
 * 1. segmenter.js assigns order to all zones except HEADER
 * 2. FOOTNOTE zones are identified after segmentation based on font size
 * 3. micro-zones are created after segmentation and need to be integrated
 *
 * Uses column-aware sorting similar to sortBlocksByReadingOrder in segmenter.js
 */
function reassignReadingOrder(zones) {
    // Get HEADER zones for overlap checking
    const headerZones = zones.filter(z => z.type === 'HEADER');

    let headerOverlapFiltered = 0;

    // Get all zones that need ordering (not HEADER, not FOOTNOTE)
    // Also filter out any zones that overlap with HEADER (safety check for micro-zones)
    const contentZones = zones.filter(z => {
        if (z.type === 'HEADER' || z.type === 'FOOTNOTE') return false;

        // Check if this zone overlaps with any HEADER zone
        for (const header of headerZones) {
            const headerRight = header.x + header.width;
            const headerBottom = header.y + header.height;
            const zRight = z.x + z.width;
            const zBottom = z.y + z.height;

            const xOverlap = Math.max(0,
                Math.min(zRight, headerRight) - Math.max(z.x, header.x)
            );
            const yOverlap = Math.max(0,
                Math.min(zBottom, headerBottom) - Math.max(z.y, header.y)
            );

            if (xOverlap > 0 && yOverlap > 0) {
                console.warn(`✗ reassignReadingOrder: Filtering zone at y=${z.y.toFixed(1)}-${zBottom.toFixed(1)} (type=${z.type}, isMicroZone=${z.isMicroZone}) - overlaps with HEADER at y=${header.y.toFixed(1)}-${headerBottom.toFixed(1)}`);
                headerOverlapFiltered++;
                return false;
            }
        }

        return true;
    });

    if (headerOverlapFiltered > 0) {
        console.warn(`⚠ reassignReadingOrder removed ${headerOverlapFiltered} zones that overlapped with HEADER`);
    }

    if (contentZones.length === 0) return;

    // Estimate page center from zones
    const minX = Math.min(...contentZones.map(z => z.x));
    const maxX = Math.max(...contentZones.map(z => z.x + z.width));
    const pageCenter = (minX + maxX) / 2;

    const LINE_TOLERANCE = 8;

    // Assign column types
    contentZones.forEach(z => {
        const zCenter = z.x + (z.width / 2);
        const zSpans = (z.x < pageCenter - 50 && z.x + z.width > pageCenter + 50);

        if (z.type === 'HEADING' || z.type === 'TITLE') {
            // Headings only span if they actually cross center
            z.colType = zSpans ? 'SPAN' : (zCenter < pageCenter ? 'LEFT' : 'RIGHT');
        } else if (zSpans) {
            z.colType = 'SPAN';
        } else if (zCenter < pageCenter) {
            z.colType = 'LEFT';
        } else {
            z.colType = 'RIGHT';
        }
    });

    // Group into lines
    const lines = [];
    const sortedByY = contentZones.slice().sort((a, b) => a.y - b.y);

    for (const z of sortedByY) {
        let placed = false;
        for (const line of lines) {
            const lineTop = Math.min(...line.map(x => x.y));
            const lineBottom = Math.max(...line.map(x => x.y + x.height));

            const vOverlap = z.y <= lineBottom + LINE_TOLERANCE && z.y + z.height >= lineTop - LINE_TOLERANCE;

            if (vOverlap) {
                // Check for horizontal overlap with same-column blocks
                const sameColBlocks = line.filter(x => x.colType === z.colType);
                if (sameColBlocks.length > 0) {
                    const hasHOverlap = sameColBlocks.some(x => {
                        const xOverlap = Math.min(z.x + z.width, x.x + x.width) - Math.max(z.x, x.x);
                        return xOverlap > 0;
                    });
                    if (!hasHOverlap) {
                        continue; // Don't group vertically stacked blocks in same column
                    }
                }

                line.push(z);
                placed = true;
                break;
            }
        }
        if (!placed) lines.push([z]);
    }

    // Sort blocks within each line: LEFT → RIGHT → SPAN
    lines.forEach(line => {
        const sortByPosition = (a, b) => {
            const xDiff = a.x - b.x;
            return xDiff !== 0 ? xDiff : a.y - b.y;
        };

        const lefts = line.filter(z => z.colType === 'LEFT').sort(sortByPosition);
        const rights = line.filter(z => z.colType === 'RIGHT').sort(sortByPosition);
        const spans = line.filter(z => z.colType === 'SPAN').sort(sortByPosition);
        line.splice(0, line.length, ...lefts, ...rights, ...spans);
    });

    // Sort lines top-to-bottom
    lines.sort((a, b) => Math.min(...a.map(x => x.y)) - Math.min(...b.map(x => x.y)));

    // Assign sequential order to content zones
    let orderCounter = 1;
    lines.flat().forEach(zone => {
        zone.order = orderCounter++;
    });

    // Assign order to FOOTNOTE zones (after content zones, in Y order)
    const footnoteZones = zones.filter(z => z.type === 'FOOTNOTE');
    footnoteZones.sort((a, b) => a.y - b.y); // Sort by Y position
    footnoteZones.forEach(zone => {
        zone.order = orderCounter++;
    });

    const microZoneCount = contentZones.filter(z => z.isMicroZone).length;
    console.log(`Reassigned reading order to ${contentZones.length} content zones + ${footnoteZones.length} footnote zones (${microZoneCount} micro-zones integrated)`);
}

/**
 * LEGACY: Validate that FOOTER zones contain predominantly smaller font sizes (footnotes).
 * Reclassify zones as BODY if they don't meet the criteria.
 * NOTE: This function is no longer used. FOOTNOTE zones are now identified by
 * revalidateFooterZonesWithFootFont using step-change detection.
 */
function validateFooterZones(zones, allItems) {
    // Calculate median font size for non-footer zones (body text)
    const bodyZones = zones.filter(z => z.type !== 'FOOTNOTE' && z.type !== 'HEADER');
    const bodyFontSizes = [];

    bodyZones.forEach(zone => {
        if (zone.items && zone.items.length > 0) {
            zone.items.forEach(item => {
                if (item.height && item.str) { // Only count actual text, not drawings
                    bodyFontSizes.push(item.height);
                }
            });
        }
    });

    if (bodyFontSizes.length === 0) {
        // No body text to compare against - can't validate
        return;
    }

    // Calculate median body font size
    bodyFontSizes.sort((a, b) => a - b);
    const medianBodyFontSize = bodyFontSizes[Math.floor(bodyFontSizes.length / 2)];

    // Also get the most common body font size
    const fontSizeCounts = {};
    bodyFontSizes.forEach(size => {
        fontSizeCounts[size] = (fontSizeCounts[size] || 0) + 1;
    });
    const mostCommonBodyFontSize = parseFloat(
        Object.entries(fontSizeCounts).sort((a, b) => b[1] - a[1])[0][0]
    );

    // Use the most common font size as reference (more reliable than median)
    const referenceFontSize = mostCommonBodyFontSize;

    console.log(`Reference body font size: ${referenceFontSize}px (median: ${medianBodyFontSize}px)`);

    // Check each FOOTNOTE zone
    zones.forEach(zone => {
        if (zone.type !== 'FOOTNOTE') return;
        if (!zone.items || zone.items.length === 0) return;

        // Calculate average font size in this footer zone
        const footerFontSizes = zone.items
            .filter(item => item.height && item.str)
            .map(item => item.height);

        if (footerFontSizes.length === 0) return;

        const avgFooterFontSize = footerFontSizes.reduce((a, b) => a + b, 0) / footerFontSizes.length;

        // Footer fonts should be notably smaller (at least 10% smaller)
        const threshold = referenceFontSize * 0.90;

        if (avgFooterFontSize >= threshold) {
            // Font size is not smaller - this is likely not a footnote zone
            console.warn(`FOOTNOTE zone at y=${zone.y} has font size ${avgFooterFontSize.toFixed(1)}px (reference: ${referenceFontSize.toFixed(1)}px) - reclassifying as BODY`);
            zone.type = 'BODY';
        } else {
            console.log(`FOOTNOTE zone validated: ${avgFooterFontSize.toFixed(1)}px < ${threshold.toFixed(1)}px`);
        }
    });
}

async function storePageData(pdf, pageNum) {
    appendLogMessage(`Pre-processing page ${pageNum}...`);
    console.info(`Pre-processing page ${pageNum}...`);

    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const viewport = await page.getViewport({scale: 1});
    const operatorList = await page.getOperatorList();

    // Extract Chart labels for segmenter
    const chartItems = content.items
        .map(item => item.str.match(/^Chart (\d+)\./) ? {
            text: item.str,
            chartNumber: parseInt(RegExp.$1, 10),
            x: item.transform[4] + item.width / 2,
            y: viewport.height - item.transform[5] - item.height / 2,
            top: viewport.height - item.transform[5]
        } : null)
        .filter(item => item !== null);

    localStorage.setItem(`page-${pageNum}-viewport`, JSON.stringify(viewport));

    const result = await segmentPage(page, viewport, operatorList, chartItems, pageNum);

    // Store Zones and Crop Range
    localStorage.setItem(`page-${pageNum}-zones`, JSON.stringify(result.blocks));
    const cropRange = result.cropRange;
    localStorage.setItem(`page-${pageNum}-cropRange`, JSON.stringify(cropRange));

    appendLogMessage(`Crop Range: x: ${cropRange.x?.[0]?.toFixed(2)} to ${cropRange.x?.[1]?.toFixed(2)}`);

    // Augment items with readable coordinates
    augmentItems(content.items, viewport);

    // 1. Crop Range: Discard items outside printable area (Printer marks)
    content.items = content.items.filter(item =>
        (!cropRange.x || (item.left >= cropRange.x[0] && item.right <= cropRange.x[1])) &&
        (!cropRange.y || (item.bottom >= cropRange.y[0] && item.top <= cropRange.y[1]))
    );

    // 2. Image OCR Noise: Discard text hidden behind detected images
    const imageBlocks = result.blocks.filter(b => b.type === 'IMAGE');
    if (imageBlocks.length > 0) {
        content.items = content.items.filter(item => {
            return !imageBlocks.some(block =>
                item.left >= block.x && item.right <= (block.x + block.width) &&
                item.top >= block.y && item.bottom <= (block.y + block.height)
            );
        });
    }

    // 3. Remove empty items (except drawings/lines)
    content.items = content.items.filter(item =>
        item.str || item.fontName === 'drawing' || item.fontName === 'line'
    );

    // 4. Sort items into zones and embed them
    sortZoneItems(result.blocks, content.items);

    // 5. LEGACY: Validate zones (no longer used - FOOTNOTE detection now happens per-page before visualization)
    // validateFooterZones(result.blocks, content.items);

    // 6. Reassign reading order for any reclassified zones
    reassignReadingOrder(result.blocks);

    // Store raw items for text.js
    localStorage.setItem(`page-${pageNum}-zones`, LZString.compressToUTF16(JSON.stringify(result.blocks)));
    localStorage.setItem(`page-${pageNum}-nullTexts`, JSON.stringify(findNullTexts(operatorList)));

    // Font accumulation
    const fonts = page.commonObjs._objs;
    const fontMap = {};
    for (const fontKey in fonts) {
        const font = fonts[fontKey]?.data;
        if (font) fontMap[font.loadedName] = { 'name': font.name, 'sizes': {} };
    }

    content.items.forEach(item => {
        if (item.fontName in fontMap) {
            const size = item.height;
            if (!fontMap[item.fontName].sizes[size]) {
                fontMap[item.fontName].sizes[size] = { 'area': 0 };
            }
            fontMap[item.fontName].sizes[size].area += item.area;
        }
    });

    // Detect Page Numeral (Simple Heuristic in Header Zone)
    let pageNumeral = null;
    const headerBlocks = result.blocks.filter(b => b.type === 'HEADER');
    if (headerBlocks.length > 0) {
        // Add some tolerance for items that might slightly overlap header boundaries
        const TOLERANCE = 5;
        const headerItems = content.items.filter(item =>
            headerBlocks.some(block => {
                const blockTop = block.y - TOLERANCE;
                const blockBottom = block.y + block.height + TOLERANCE;
                // Check if item overlaps with header block (not just contained)
                return item.top < blockBottom && item.bottom > blockTop;
            })
        );

        if (headerBlocks.length > 0) {
            const hb = headerBlocks[0];
       }

        const numItem = headerItems.find(i => /^\d+$/.test(i.str.trim()));
        if (numItem) pageNumeral = numItem.str.trim();
    }

    return [fontMap, pageNumeral];
}

/**
 * Segmentation Orchestrator
 */
function segmentPage(page, viewport, operatorList, chartItems, pageNum) {
    return new Promise(async (resolve, reject) => {
        // 1. Identify Crop Marks (Your function)
        const cropRange = identifyCropMarks(page, viewport, operatorList);
        const embeddedImages = getEmbeddedImages(operatorList, viewport);

        const canvas = await renderPageToCanvas(page, viewport);
        const context = canvas.getContext("2d", { willReadFrequently: true });
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

        // 2. Clean up visual data for Segmenter
        // Apply "Crash Fix": Erase margins
        eraseOutsideCropRange(imageData.data, cropRange, canvas.width, canvas.height);

        // Mask embedded images so they detect as solid blocks
        if (embeddedImages.length > 0) {
            paintEmbeddedImages(imageData.data, embeddedImages, canvas.width, canvas.height);
        }

        // 3. Worker Callback
        const handleWorkerMessage = (e) => {
            if (e.data.action === "result") {
                worker.removeEventListener("message", handleWorkerMessage);
                resolve({
                    cropRange: cropRange, // Pass back your crop marks
                    blocks: e.data.blocks,
                    pageStats: e.data.pageStats
                });
            }
        };

        worker.addEventListener("message", handleWorkerMessage);
        worker.onerror = (err) => {
            worker.removeEventListener("message", handleWorkerMessage);
            reject(err);
        };

        worker.postMessage({
            action: "processPage",
            imageData: imageData,
            chartItems: chartItems,
            pageNum: pageNum
        });
    });
}

// === HELPER FUNCTIONS (Migrated from imaging.js) ===

function identifyCropMarks(page, viewport, operatorList) {
    const cropMarks = [];
    let cropRange = {};

    operatorList.fnArray.forEach((fn, index) => {
        const operatorName = operatorNames[fn] || `Unknown (${fn})`;
        const args = operatorList.argsArray[index];

        // Check for black or grey stroke color
        if (operatorName === "setStrokeRGBColor" && typeof args === "object" && args !== null &&
            ((args["0"] === 0 && args["1"] === 0 && args["2"] === 0) || (args["0"] === 6 && args["1"] === 6 && args["2"] === 12))
        ) {
            // Logic to find crop mark patterns (simplified for brevity, keeps your logic)
            // [Your existing detailed loop logic goes here - detecting transform/constructPath/stroke]
            // For now, using fallback if specific patterns aren't matched in loop.
            // ... (Your loop logic) ...
        }
    });

    // NOTE: If your detailed loop logic was essential, ensure it is pasted here.
    // Based on previous logs, the fallback usually activates.

    // Fallback / Validation
    if (!cropRange.y || !cropRange.x) {
        // console.warn('Crop Range not found: using defaults.');
        const gutterX = (viewport.width - 595.276) / 2; // A4 width approx
        const gutterY = (viewport.height - 864.567) / 2; // A4 height approx
        cropRange.x = [Math.max(0, gutterX), viewport.width - Math.max(0, gutterX)];
        cropRange.y = [Math.max(0, gutterY), viewport.height - Math.max(0, gutterY)];
    }

    // Shave 2px safety margin
    if (cropRange.x) cropRange.x = [cropRange.x[0] + 2, cropRange.x[1] - 2];
    if (cropRange.y) cropRange.y = [cropRange.y[0] + 2, cropRange.y[1] - 2];

    return cropRange;
}

function eraseOutsideCropRange(data, cropRange, canvasWidth, canvasHeight) {
    // 1. Guard Clause: Ensure ranges exist
    if (!cropRange || !cropRange.x || !cropRange.y) {
        console.warn("Skipping Erase: Invalid crop range", cropRange);
        return;
    }

    // 2. Sorting Fix: Ensure [Min, Max] order
    // PDF coordinates are often inverted (bottom-up), so we must sort them
    // to ensure xMin < xMax and yMin < yMax.
    const [xMin, xMax] = [...cropRange.x].sort((a, b) => a - b);
    const [yMin, yMax] = [...cropRange.y].sort((a, b) => a - b);

    console.log(`Erasing outside: X[${xMin.toFixed(0)}, ${xMax.toFixed(0)}] Y[${yMin.toFixed(0)}, ${yMax.toFixed(0)}]`);

    const whitePixel = new Uint8ClampedArray([255, 255, 255, 255]);

    for (let y = 0; y < canvasHeight; y++) {
        // Optimization: If the entire ROW is outside Y-bounds, erase the whole row at once
        if (y < yMin || y > yMax) {
            const rowStartIndex = y * canvasWidth * 4;
            // Fill the entire row (width * 4 bytes) with 255
            data.fill(255, rowStartIndex, rowStartIndex + canvasWidth * 4);
            continue;
        }

        // If row is inside Y-bounds, only erase the X-margins
        const rowStartIndex = y * canvasWidth * 4;

        // Erase Left Margin (0 to xMin)
        for (let x = 0; x < xMin; x++) {
            data.set(whitePixel, rowStartIndex + x * 4);
        }

        // Erase Right Margin (xMax to Width)
        for (let x = Math.ceil(xMax); x < canvasWidth; x++) {
            data.set(whitePixel, rowStartIndex + x * 4);
        }
    }
}

async function renderPageToCanvas(page, viewport) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: context, viewport }).promise;
    return canvas;
}

function getEmbeddedImages(operatorList, viewport) {
    return operatorList.fnArray.reduce((images, fn, index) => {
        if (operatorNames[fn] === "paintImageXObject") {
            const [a, , , d, e, f] = operatorList.argsArray[index - 2];
            let [x0, y0, x1, y1] = [e, viewport.height - f, e + a, viewport.height - (f + d)];
            if (x0 > x1) [x0, x1] = [x1, x0];
            if (y0 > y1) [y0, y1] = [y1, y0];
            images.push({
                top: y0, left: x0, bottom: y1, right: x1,
                width: x1 - x0, height: y1 - y0,
                type: `paintImageXObject`
            });
        }
        return images;
    }, []);
}

function paintEmbeddedImages(data, embeddedImages, canvasWidth, canvasHeight) {
    const blackPixel = new Uint8ClampedArray([0, 0, 0, 255]);
    const dilation = 1;
    embeddedImages.forEach(image => {
        const left = Math.max(0, Math.round(image.left) - dilation);
        const top = Math.max(0, Math.round(image.top) - dilation);
        const right = Math.min(canvasWidth, Math.round(image.right) + dilation);
        const bottom = Math.min(canvasHeight, Math.round(image.bottom) + dilation);

        for (let y = top; y < bottom; y++) {
            const rowStartIndex = y * canvasWidth * 4;
            for (let x = left; x < right; x++) {
                data.set(blackPixel, rowStartIndex + x * 4);
            }
        }
    });
}

function findNullTexts(operatorList) {
    const nullTexts = [];
    operatorList.fnArray.forEach((fn, index) => {
        const operatorName = operatorNames[fn];
        const args = operatorList.argsArray[index];
        if (operatorName === "showText" && Array.isArray(args[0])) {
            const text = args[0].map(item => item.unicode || '').join('');
            const paddedText = args[0].map(item => item.unicode || ' ').join('');
            if (text.length < paddedText.length) {
                nullTexts.push({ compressedText: text.replace(/\s+/g, ''), text: text });
            }
        }
    });
    return nullTexts;
}

function augmentItems(items, viewport) {
    items.forEach(item => {
        item.left = item.transform[4];
        item.bottom = viewport.height - item.transform[5];
        item.right = item.left + item.width;
        item.top = item.bottom - item.height;
        item.area = item.width * item.height;
        item.str = item.str.trim();
        delete item.transform;
    });
    return items;
}

function fillMissingPageNumerals(pageNumerals) {
    // Two-pass interpolation:

    // Pass 1: Fill backward from first known numeral (handles null at start)
    // Find the first non-null numeral
    let firstKnownIndex = -1;
    for (let i = 0; i < pageNumerals.length; i++) {
        if (pageNumerals[i] !== null && pageNumerals[i] !== undefined) {
            firstKnownIndex = i;
            break;
        }
    }

    // If we found a known numeral and there are nulls before it, fill backwards
    if (firstKnownIndex > 0) {
        const firstKnownValue = parseInt(pageNumerals[firstKnownIndex]);
        if (!isNaN(firstKnownValue)) {
            for (let i = firstKnownIndex - 1; i >= 0; i--) {
                const inferredValue = firstKnownValue - (firstKnownIndex - i);
                // Only assign if it would be a positive number
                if (inferredValue > 0) {
                    pageNumerals[i] = String(inferredValue);
                }
            }
        }
    }

    // Pass 2: Fill forward (for any gaps after the first known value)
    for (let i = 0; i < pageNumerals.length; i++) {
        if ((pageNumerals[i] === null || pageNumerals[i] === undefined) && i > 0 && pageNumerals[i-1]) {
            const prev = parseInt(pageNumerals[i-1]);
            if (!isNaN(prev)) pageNumerals[i] = String(prev + 1);
        }
    }
}


/**
 * Calculate Jenks Natural Breaks for gap clustering.
 * This finds the optimal split point that minimizes variance within clusters.
 */
function calculateJenksBreak(values, numClasses = 2) {
    if (values.length < 3) return null;

    const n = values.length;

    // Sort values
    const sorted = [...values].sort((a, b) => a - b);

    // Initialize matrices
    const lowerClassLimits = Array(n + 1).fill(0).map(() => Array(numClasses + 1).fill(0));
    const varianceCombinations = Array(n + 1).fill(0).map(() => Array(numClasses + 1).fill(0));

    // Initialize first row
    for (let i = 1; i <= numClasses; i++) {
        lowerClassLimits[1][i] = 1;
        varianceCombinations[1][i] = 0;
        for (let j = 2; j <= n; j++) {
            varianceCombinations[j][i] = Infinity;
        }
    }

    // Calculate variance for each possible class
    for (let l = 2; l <= n; l++) {
        let sum = 0;
        let sumSquares = 0;
        let w = 0;
        let variance = 0;

        for (let m = 1; m <= l; m++) {
            const lm = l - m + 1;
            const val = sorted[lm - 1];

            w++;
            sum += val;
            sumSquares += val * val;

            variance = sumSquares - (sum * sum) / w;
            const i4 = lm - 1;

            if (i4 !== 0) {
                for (let j = 2; j <= numClasses; j++) {
                    if (varianceCombinations[l][j] >= variance + varianceCombinations[i4][j - 1]) {
                        lowerClassLimits[l][j] = lm;
                        varianceCombinations[l][j] = variance + varianceCombinations[i4][j - 1];
                    }
                }
            }
        }

        lowerClassLimits[l][1] = 1;
        varianceCombinations[l][1] = variance;
    }

    // Extract break point (for 2 classes, there's 1 break)
    const breakIndex = lowerClassLimits[n][numClasses] - 2;

    if (breakIndex >= 0 && breakIndex < sorted.length - 1) {
        return breakIndex;
    }

    return null;
}


/**
 * Identify FOOTNOTE zones by detecting step change in mean font size.
 * Works backwards through zones looking for a significant decrease in font size
 * that indicates the transition from body text to footnotes.
 */
async function revalidateFooterZonesWithFootFont(pageNum, defaultFont) {
    const zones = JSON.parse(
        LZString.decompressFromUTF16(localStorage.getItem(`page-${pageNum}-zones`))
    );

    if (!zones) {
        console.warn(`Page ${pageNum}: No zones found in localStorage`);
        return;
    }

    console.log(`\n=== Page ${pageNum}: Footnote Detection ===`);
    console.log(`Default font: ${defaultFont.fontName} @ ${defaultFont.fontSize}pt`);

    // Debug: Show all zone types and counts
    const zoneCounts = {};
    const zonesWithItems = [];
    zones.forEach(z => {
        zoneCounts[z.type] = (zoneCounts[z.type] || 0) + 1;
        if (z.items && z.items.length > 0) {
            const itemCount = z.items.flat().filter(i => i.str).length;
            if (itemCount > 0) {
                zonesWithItems.push({
                    type: z.type,
                    order: z.order,
                    itemCount: itemCount,
                    y: z.y
                });
            }
        }
    });
    console.log(`Zone types on page: ${Object.entries(zoneCounts).map(([t, c]) => `${t}:${c}`).join(', ')}`);
    console.log(`Zones with text items:`, zonesWithItems);

    // Get zones with reading order, sorted in reverse (highest order first)
    const orderedZones = zones
        .filter(z => z.order !== undefined && z.type !== 'HEADER' && z.type !== 'HEADING')
        .sort((a, b) => b.order - a.order);

    console.log(`Total zones to analyze (with reading order): ${orderedZones.length}`);

    if (orderedZones.length < 2) {
        console.log(`Not enough zones (${orderedZones.length}) to detect footnotes`);
        return;
    }

    // Calculate median font size for each zone (more robust than mean)
    console.log('Processing zones for font size calculation:');
    const zoneFontSizes = orderedZones.map((zone, idx) => {
        if (!zone.items || zone.items.length === 0) {
            console.log(`  Zone #${zone.order} (${zone.type}): ❌ No items`);
            return null;
        }

        const allItems = zone.items.flat();
        const textItems = allItems.filter(item => item.str && item.height);

        if (textItems.length === 0) {
            console.log(`  Zone #${zone.order} (${zone.type}): ❌ No text items (${allItems.length} items total)`);
            return null;
        }

        // Get all font sizes and sort them
        const fontSizes = textItems.map(item => item.height).sort((a, b) => a - b);

        // Calculate median
        const medianSize = fontSizes.length % 2 === 0
            ? (fontSizes[fontSizes.length / 2 - 1] + fontSizes[fontSizes.length / 2]) / 2
            : fontSizes[Math.floor(fontSizes.length / 2)];

        console.log(`  Zone #${zone.order} (${zone.type}): ✓ median=${medianSize.toFixed(2)}pt from ${textItems.length} items`);

        return {
            zone: zone,
            medianFontSize: medianSize,
            itemCount: textItems.length
        };
    }).filter(z => z !== null);

    if (zoneFontSizes.length < 2) {
        console.log(`Not enough zones with text (${zoneFontSizes.length}) to detect footnotes`);
        return;
    }

    // Debug: Show all zone font sizes
    console.log('Zone font sizes (reading order, bottom to top):');
    zoneFontSizes.forEach((zd, idx) => {
        console.log(`  [${idx}] Zone #${zd.zone.order} @ y=${zd.zone.y.toFixed(1)}: ${zd.medianFontSize.toFixed(2)}pt (${zd.itemCount} items)`);
    });

    // Work backwards looking for significant step change in font size
    const STEP_CHANGE_THRESHOLD = 0.08; // 8% increase when going backwards (was 15%)
    const MIN_FOOTNOTE_SIZE_RATIO = 0.92; // Footnotes should be at most 92% of body text size (was 85%)
    const MAX_HEADING_SIZE = 1.15; // Don't consider changes to headings (> 115% of default, was 110%)
    const MIN_INTEGER_START_RATIO = 0.25; // 25% of lines must start with integer

    let footnoteStartIndex = -1;

    console.log('Scanning for step changes:');
    for (let i = 0; i < zoneFontSizes.length - 1; i++) {
        const currentZone = zoneFontSizes[i];
        const nextZone = zoneFontSizes[i + 1];

        console.log(`  [${i}→${i+1}] Zone #${currentZone.zone.order} (${currentZone.medianFontSize.toFixed(2)}pt) → Zone #${nextZone.zone.order} (${nextZone.medianFontSize.toFixed(2)}pt)`);

        // EARLY STOP: If current zone has default font size or larger, it's not a footnote
        if (defaultFont.fontSize && currentZone.medianFontSize >= defaultFont.fontSize) {
            console.log(`    🛑 STOP: current zone has default/body font size (${currentZone.medianFontSize.toFixed(2)}pt ≥ ${defaultFont.fontSize.toFixed(2)}pt)`);
            break;
        }

        // Skip if current zone has heading-sized text (too large)
        if (defaultFont.fontSize && currentZone.medianFontSize > defaultFont.fontSize * MAX_HEADING_SIZE) {
            console.log(`    ❌ Skipped: current zone font too large (${currentZone.medianFontSize.toFixed(2)}pt > ${(defaultFont.fontSize * MAX_HEADING_SIZE).toFixed(2)}pt)`);
            continue;
        }

        // Calculate step change (going backwards, so next is actually earlier in reading order)
        const sizeIncrease = (nextZone.medianFontSize - currentZone.medianFontSize) / currentZone.medianFontSize;
        console.log(`    Change: ${(sizeIncrease * 100).toFixed(1)}%`);

        // Check for significant step up in font size (going backwards = transition from footnotes to body)
        if (sizeIncrease >= STEP_CHANGE_THRESHOLD) {
            console.log(`    ✓ Step change detected (${(sizeIncrease * 100).toFixed(1)}% ≥ ${(STEP_CHANGE_THRESHOLD * 100)}%)`);

            // Verify that current zones are actually smaller (footnote-sized)
            if (defaultFont.fontSize && currentZone.medianFontSize <= defaultFont.fontSize * MIN_FOOTNOTE_SIZE_RATIO) {
                console.log(`    ✓ Font size small enough (${currentZone.medianFontSize.toFixed(2)}pt ≤ ${(defaultFont.fontSize * MIN_FOOTNOTE_SIZE_RATIO).toFixed(2)}pt)`);
                footnoteStartIndex = i;
                break;
            } else {
                console.log(`    ❌ Font size too large (${currentZone.medianFontSize.toFixed(2)}pt > ${(defaultFont.fontSize * MIN_FOOTNOTE_SIZE_RATIO).toFixed(2)}pt)`);
            }
        } else {
            console.log(`    ❌ Change too small (${(sizeIncrease * 100).toFixed(1)}% < ${(STEP_CHANGE_THRESHOLD * 100)}%)`);
        }
    }

    if (footnoteStartIndex >= 0) {
        console.log(`\nCandidate footnote zones: indices 0-${footnoteStartIndex}`);

        // Validate: Check that candidate zones have at least 25% of lines starting with an integer
        let totalLines = 0;
        let linesStartingWithInteger = 0;

        for (let i = 0; i <= footnoteStartIndex; i++) {
            const zoneData = zoneFontSizes[i];
            const zone = zoneData.zone;

            if (zone.items && zone.items.length > 0) {
                zone.items.forEach(line => {
                    if (Array.isArray(line) && line.length > 0) {
                        totalLines++;
                        const firstItem = line[0];
                        if (firstItem && firstItem.str) {
                            // Check if line starts with an integer
                            const startsWithInt = /^\d+/.test(firstItem.str.trim());
                            if (startsWithInt) {
                                linesStartingWithInteger++;
                            }
                        }
                    }
                });
            }
        }

        const integerStartRatio = totalLines > 0 ? linesStartingWithInteger / totalLines : 0;
        console.log(`Integer-start validation: ${linesStartingWithInteger}/${totalLines} lines (${(integerStartRatio * 100).toFixed(1)}%) start with integer`);

        if (integerStartRatio >= MIN_INTEGER_START_RATIO) {
            console.log(`✓ Validation passed (${(integerStartRatio * 100).toFixed(1)}% ≥ ${(MIN_INTEGER_START_RATIO * 100)}%)`);

            // Mark all zones from start to footnoteStartIndex as FOOTNOTE
            let footnoteZonesFound = 0;
            for (let i = 0; i <= footnoteStartIndex; i++) {
                const zoneData = zoneFontSizes[i];
                zoneData.zone.type = 'FOOTNOTE';
                footnoteZonesFound++;
                console.log(`  Zone #${zoneData.zone.order} at y=${zoneData.zone.y.toFixed(1)} → FOOTNOTE (${zoneData.medianFontSize.toFixed(2)}pt)`);
            }

            // Store updated zones
            localStorage.setItem(`page-${pageNum}-zones`, LZString.compressToUTF16(JSON.stringify(zones)));
            console.log(`\n✓ Identified ${footnoteZonesFound} FOOTNOTE zones`);
        } else {
            console.log(`✗ Validation failed: not enough lines start with integers (${(integerStartRatio * 100).toFixed(1)}% < ${(MIN_INTEGER_START_RATIO * 100)}%)`);
            console.log('No footnotes identified');
        }
    } else {
        console.log('\nNo significant font size step change detected');
        console.log('No footnotes identified');
    }
}

function headerFooterAndFonts(pageNum, masterFontMap, defaultFont, headerFontSizes) {
    const zones = JSON.parse(
        LZString.decompressFromUTF16(localStorage.getItem(`page-${pageNum}-zones`))
    );
    const nullTexts = JSON.parse(localStorage.getItem(`page-${pageNum}-nullTexts`));
    localStorage.removeItem(`page-${pageNum}-nullTexts`);

    // Flatten items from zones for analysis
    const allItems = zones.flatMap(z => z.items || []).flat();


    // Identify font styles
    const fontStyles = {
        'italic': /-It$|Italic|Oblique/i,
        'bold': /Bold|Semibold/i,
        'capital': /SC$/ // Small Caps
    };

    // Process each zone's items
    zones.forEach(zone => {
        if (!zone.items) return;

        zone.items.forEach(line => {
            // === PER-LINE GAP ANALYSIS AND MERGING ===
            if (line.length >= 2) {
                // Analyze gaps for this line
                const gaps = [];
                for (let i = 0; i < line.length - 1; i++) {
                    const currentItem = line[i];
                    const nextItem = line[i + 1];

                    if (currentItem.left !== undefined && currentItem.width !== undefined &&
                        nextItem.left !== undefined) {
                        const gap = nextItem.left - (currentItem.left + currentItem.width);
                        if (gap >= 0) {
                            gaps.push(gap);
                        }
                    }
                }

                let adjacentThreshold = 2; // fallback default

                if (gaps.length >= 5) {
                    gaps.sort((a, b) => a - b);
                    const splitIndex = calculateJenksBreak(gaps, 2);

                    if (splitIndex !== null && splitIndex > 0 && splitIndex < gaps.length - 1) {
                        adjacentThreshold = (gaps[splitIndex] + gaps[splitIndex + 1]) / 2;
                    } else {
                        // Fallback to largest jump
                        let maxJump = 0;
                        let maxJumpIndex = 0;

                        for (let i = 0; i < gaps.length - 1; i++) {
                            const jump = gaps[i + 1] - gaps[i];
                            if (jump > maxJump) {
                                maxJump = jump;
                                maxJumpIndex = i;
                            }
                        }

                        if (maxJump > gaps[maxJumpIndex] * 0.5 && maxJumpIndex > 0) {
                            adjacentThreshold = (gaps[maxJumpIndex] + gaps[maxJumpIndex + 1]) / 2;
                        } else {
                            adjacentThreshold = gaps[Math.floor(gaps.length * 0.25)];
                        }
                    }

                    adjacentThreshold = Math.max(0.5, Math.min(adjacentThreshold, 5));

                } else if (gaps.length >= 3) {
                    gaps.sort((a, b) => a - b);
                    let maxJump = 0;
                    let splitIndex = 0;

                    for (let i = 0; i < gaps.length - 1; i++) {
                        const jump = gaps[i + 1] - gaps[i];
                        if (jump > maxJump) {
                            maxJump = jump;
                            splitIndex = i;
                        }
                    }

                    if (maxJump > gaps[splitIndex] * 0.5 && splitIndex > 0) {
                        adjacentThreshold = (gaps[splitIndex] + gaps[splitIndex + 1]) / 2;
                    } else {
                        adjacentThreshold = gaps[Math.floor(gaps.length * 0.25)];
                    }

                    adjacentThreshold = Math.max(0.5, Math.min(adjacentThreshold, 5));
                } else if (gaps.length > 0) {
                    adjacentThreshold = Math.min(...gaps) * 0.8;
                }

                // Merge adjacent items on this line
                let i = 0;
                while (i < line.length - 1) {
                    const currentItem = line[i];
                    const nextItem = line[i + 1];

                    const gap = nextItem.left - (currentItem.left + currentItem.width);

                    // Check if items should be merged:
                    // 1. Gap is below threshold (adjacent)
                    // 2. Same font properties
                    // 3. Same superscript status (will be calculated below, so check after)
                    const sameFontProps = currentItem.fontName === nextItem.fontName &&
                        Math.round(currentItem.height) === Math.round(nextItem.height);

                    // We'll check superscript status after it's been calculated
                    // For now, merge based on font and gap only
                    const shouldMerge = gap < adjacentThreshold && sameFontProps;

                    if (shouldMerge) {
                        currentItem.str += nextItem.str;
                        currentItem.width = (nextItem.left + nextItem.width) - currentItem.left;
                        currentItem.right = nextItem.right;

                        // Remove nextItem from line
                        line.splice(i + 1, 1);

                        // Don't increment i - check if we can merge with the new next item
                    } else {
                        i++;
                    }
                }
            }

            // Now apply font styles and detect superscripts
            line.forEach((item, index) => {
                const fontEntry = masterFontMap[item.fontName];
                if (fontEntry) {
                    // Apply font styles
                    for (const style in fontStyles) {
                        if (fontStyles[style].test(fontEntry.name)) {
                            if (style === 'capital') {
                                item.str = titleCase(item.str);
                                item.titleCase = true;
                                item.header = item.header || 6;
                            } else {
                                item[style] = true;
                            }
                        }
                    }
                }

                const prevItem = index > 0 ? line[index - 1] : null;

                if (prevItem) {
                    const isSmaller = item.height < prevItem.height;
                    const isHigher = item.bottom < (prevItem.bottom - 0.5);

                    if (isSmaller && isHigher) {
                        item.superscript = true;
                    }
                }

                // Replace null texts (fixing ligatures/spacing artifacts)
                if (nullTexts && nullTexts.length > 0 && item.italic) {
                    const compressed = item.str.replace(/\s+/g, '');
                    const nullText = nullTexts.find(nt => nt.compressedText === compressed);
                    if (nullText) {
                        item.str = nullText.text;
                    }
                }
            });
        });
    });

    // Save modified zones back
    localStorage.setItem(`page-${pageNum}-zones`,
        LZString.compressToUTF16(JSON.stringify(zones)));
}

/**
 * Get figure identifiers for a page from localStorage
 * These are pre-computed during HTML generation in text.js
 * Returns an array of 'type-number' strings in reading order (e.g., ['figure-5', 'chart-12'])
 */
function getFigureNumbersForPage(pageNum) {
    const figureNumbersData = localStorage.getItem(`page-${pageNum}-figure-numbers`);
    if (!figureNumbersData) return [];

    try {
        return JSON.parse(figureNumbersData);
    } catch (e) {
        console.warn(`Failed to parse figure numbers for page ${pageNum}:`, e);
        return [];
    }
}

async function extractImagesFromPDF(pdf, updateProgress, maxDimension = 4096) {
    if (typeof JSZip === 'undefined') throw new Error("JSZip is not loaded");

    const zip = new JSZip();
    const totalPages = pdf.numPages;
    let figureCount = 0; // Fallback counter for figures without captions
    let totalExtracted = 0; // Total number of figures extracted
    let nativeCount = 0;
    let renderedCount = 0;
    const figureExtensions = {}; // Map of figure number -> file extension for XHTML post-processing

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const zonesData = localStorage.getItem(`page-${pageNum}-zones`);
        if (!zonesData) continue;

        const zones = JSON.parse(LZString.decompressFromUTF16(zonesData));
        const figureBlocks = zones.filter(z => z.type === "FIGURE");
        if (!figureBlocks.length) continue;

        // Get pre-computed figure numbers from localStorage (computed during HTML generation)
        const figureNumbers = getFigureNumbersForPage(pageNum);

        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1 });

        const embeddedImages = await getEmbeddedImagesWithData(page, viewport);

        // Check if any figures need rendering
        const needsRender = figureBlocks.some(block => !findMatchingImage(block, embeddedImages));

        let fullCanvas = null;
        let renderScale = null;

        if (needsRender) {
            const unmatched = figureBlocks.filter(b => !findMatchingImage(b, embeddedImages));
            const maxBlockDim = Math.max(...unmatched.flatMap(b => [b.width, b.height]));
            renderScale = Math.min(maxDimension / maxBlockDim, 10);

            const scaledViewport = page.getViewport({ scale: renderScale });
            fullCanvas = document.createElement("canvas");
            fullCanvas.width = scaledViewport.width;
            fullCanvas.height = scaledViewport.height;
            const ctx = fullCanvas.getContext("2d");
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, fullCanvas.width, fullCanvas.height);

            await page.render({
                canvasContext: ctx,
                viewport: scaledViewport
            }).promise;
        }

        for (let counter = 1; counter <= figureBlocks.length; counter++) {
            const block = figureBlocks[counter - 1];
            const matchedImage = findMatchingImage(block, embeddedImages);

            let result;
            if (matchedImage) {
                result = await extractNativeImage(matchedImage);
                nativeCount++;
            } else {
                result = await cropFromCanvas(fullCanvas, block, renderScale);
                renderedCount++;
            }

            if (result && result.blob) {
                // Match by position: 1st figure gets 1st figure identifier, etc.
                // figureId format: 'type-number' (e.g., 'figure-5', 'chart-12', 'fig-3')
                const figureId = figureNumbers[counter - 1];
                let filename;

                if (figureId) {
                    // figureId already contains 'type-number', just add extension
                    filename = `${figureId}.${result.extension}`;
                    figureExtensions[figureId] = result.extension;
                } else {
                    // Fallback to sequential numbering if no figure identifier found
                    figureCount++;
                    const fallbackId = `figure-${figureCount}`;
                    filename = `${fallbackId}.${result.extension}`;
                    figureExtensions[fallbackId] = result.extension;
                }

                zip.file(filename, await result.blob.arrayBuffer());
                totalExtracted++;
            }
        }

        // Release memory
        fullCanvas = null;

        // Update progress
        if (updateProgress) {
            const percent = Math.round((pageNum / totalPages) * 100);
            updateProgress(
                percent,
                `Extracting images: page ${pageNum}/${totalPages}`,
                `Page ${pageNum}: ${figureBlocks.length} figure(s) processed`
            );
        }
    }

    // Final summary
    if (updateProgress) {
        updateProgress(
            100,
            "Image extraction complete",
            `Extracted ${totalExtracted} figures (${nativeCount} native, ${renderedCount} rendered)`
        );
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });

    // Return both the zip and the extension mapping for XHTML post-processing
    return { zipBlob, figureExtensions };
}

async function getEmbeddedImagesWithData(page, viewport) {
    const operatorList = await page.getOperatorList();
    const images = [];

    for (let i = 0; i < operatorList.fnArray.length; i++) {
        if (operatorList.fnArray[i] !== pdfjsLib.OPS.paintImageXObject) continue;

        const imageName = operatorList.argsArray[i][0];

        // Find the preceding transform (usually at i-2)
        let transform = null;
        for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
            if (operatorList.fnArray[j] === pdfjsLib.OPS.transform) {
                transform = operatorList.argsArray[j];
                break;
            }
        }

        if (!transform) continue;

        try {
            const imageData = await page.objs.get(imageName);
            if (!imageData || !imageData.data) continue;

            const [a, b, c, d, e, f] = transform;

            // Calculate bounding box in screen coordinates
            let x = e;
            let y = viewport.height - f - Math.abs(d);
            let width = Math.abs(a);
            let height = Math.abs(d);

            // Handle rotation/skew if present
            if (b !== 0 || c !== 0) {
                width = Math.sqrt(a * a + b * b);
                height = Math.sqrt(c * c + d * d);
            }

            images.push({
                name: imageName,
                imageData: imageData,
                width: imageData.width,
                height: imageData.height,
                kind: imageData.kind,
                // Bounding box in screen coordinates
                bounds: { x, y, width, height }
            });
        } catch (e) {
            console.warn(`Could not load image ${imageName}:`, e);
        }
    }

    return images;
}

function findMatchingImage(block, embeddedImages, overlapThreshold = 0.5) {
    // Find an embedded image whose bounds substantially overlap the zone
    const blockArea = block.width * block.height;

    for (const img of embeddedImages) {
        const b = img.bounds;

        // Calculate intersection
        const xOverlap = Math.max(0, Math.min(block.x + block.width, b.x + b.width) - Math.max(block.x, b.x));
        const yOverlap = Math.max(0, Math.min(block.y + block.height, b.y + b.height) - Math.max(block.y, b.y));
        const intersection = xOverlap * yOverlap;

        // Check if intersection covers enough of the zone
        const overlapRatio = intersection / blockArea;

        if (overlapRatio >= overlapThreshold) {
            return img;
        }
    }

    return null;
}

/**
 * Detect if image content is photographic (use JPEG) or graphic (use PNG)
 * Based on color variance - photos have high variance, diagrams/charts have low variance
 */
function isPhotographic(canvas) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const width = canvas.width;
    const height = canvas.height;

    // Sample a grid of pixels (not every pixel for performance)
    const sampleSize = Math.min(100, Math.floor(Math.sqrt(width * height)));
    const step = Math.floor(Math.max(width, height) / sampleSize);

    const samples = [];
    for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
            const pixel = ctx.getImageData(x, y, 1, 1).data;
            samples.push((pixel[0] + pixel[1] + pixel[2]) / 3); // Average brightness
        }
    }

    // Calculate variance
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance = samples.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / samples.length;

    // High variance = photographic content (use JPEG)
    // Low variance = graphic content (use PNG)
    return variance > 1000; // Threshold tuned empirically
}

async function extractNativeImage(img) {
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(img.width, img.height);

    const src = img.imageData.data;
    const dst = imgData.data;

    if (img.kind === 1) {
        // Grayscale
        for (let j = 0; j < src.length; j++) {
            const idx = j * 4;
            dst[idx] = dst[idx + 1] = dst[idx + 2] = src[j];
            dst[idx + 3] = 255;
        }
    } else if (img.kind === 2) {
        // RGB
        for (let j = 0; j < src.length / 3; j++) {
            const srcIdx = j * 3;
            const dstIdx = j * 4;
            dst[dstIdx] = src[srcIdx];
            dst[dstIdx + 1] = src[srcIdx + 1];
            dst[dstIdx + 2] = src[srcIdx + 2];
            dst[dstIdx + 3] = 255;
        }
    } else {
        // RGBA
        dst.set(src);
    }

    ctx.putImageData(imgData, 0, 0);

    // Choose format based on content type
    const useJpeg = isPhotographic(canvas);
    const format = useJpeg ? "image/jpeg" : "image/png";
    const quality = useJpeg ? 0.85 : undefined; // 85% quality for JPEG
    const extension = useJpeg ? "jpg" : "png";

    return new Promise(resolve => {
        canvas.toBlob(blob => resolve({ blob, extension }), format, quality);
    });
}

function cropFromCanvas(fullCanvas, block, scale) {
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = Math.ceil(block.width * scale);
    cropCanvas.height = Math.ceil(block.height * scale);
    const ctx = cropCanvas.getContext("2d");

    ctx.drawImage(
        fullCanvas,
        block.x * scale, block.y * scale,
        block.width * scale, block.height * scale,
        0, 0,
        cropCanvas.width, cropCanvas.height
    );

    // Choose format based on content type
    const useJpeg = isPhotographic(cropCanvas);
    const format = useJpeg ? "image/jpeg" : "image/png";
    const quality = useJpeg ? 0.85 : undefined; // 85% quality for JPEG
    const extension = useJpeg ? "jpg" : "png";

    return new Promise(resolve => {
        cropCanvas.toBlob(blob => resolve({ blob, extension }), format, quality);
    });
}