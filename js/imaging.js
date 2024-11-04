// /js/drawing.js
// Description: Contains functions to extract drawings from PDF files.


// Create a reverse lookup object to map operator numbers to their names
const operatorNames = Object.keys(pdfjsLib.OPS).reduce((acc, key) => {
    acc[pdfjsLib.OPS[key]] = key;
    return acc;
}, {});


function findNullTexts(operatorList) {
    const nullTexts = [];
    operatorList.fnArray.forEach((fn, index) => {
        const operatorName = operatorNames[fn] || `Unknown (${fn})`;
        const args = operatorList.argsArray[index];

        // Check if this is a text operation
        if (operatorName === "showText" && Array.isArray(args[0])) {
            const text = args[0].map(item => item.unicode || '').join('');
            const paddedText = args[0].map(item => item.unicode || ' ').join('');
            if (text.length < paddedText.length) {
                nullTexts.push({
                    compressedText: text.replace(/\s+/g, ''),
                    text: text
                });
            }
        }
    });
    return nullTexts;
}


function listOperators(operatorList) {
    let origin = [0, 0];
    const operatorListArray = operatorList.fnArray.map((fn, index) => {
        const operatorName = operatorNames[fn] || `Unknown (${fn})`;
        const args = operatorList.argsArray[index];

        if (fn === pdfjsLib.OPS.transform) {
            origin = [args[4], args[5]];
        } else if (fn === pdfjsLib.OPS.moveTo) {
            origin = [origin[0] + args[0], origin[1] + args[1]];
        }

        // Check if this is a text operation
        if (operatorName === "showText" && Array.isArray(args[0])) {
            const text = args[0].map(item => item.unicode || '').join('');
            const widths = args[0].map(item => item.width);
            console.log(`Operation ${index}: ${operatorName}, Text: "${text}", Widths: ${JSON.stringify(widths)}`);
        }
        // Check for constructPath operation
        else if (operatorName === "constructPath" && Array.isArray(args)) {
            console.log(`Operation ${index}: ${operatorName}, Arguments: ${JSON.stringify(args)}`);
            const [commandArray, coordinatesArray] = args;

            // Iterate over command array to log suboperations
            coordCursor = 0;
            commandArray.forEach((command, i) => {
                const commandName = operatorNames[command] || `Unknown Command (${command})`;

                const coordCount = commandName === 'rectangle' ? 4 : 2;
                const coords = coordinatesArray.slice(coordCursor, coordCursor + coordCount);

                coordCursor += coordCount;

                if (commandName === 'lineTo' || commandName === 'moveTo') {
                    // Alert orthogonal lineTo with long length
                    if (commandName === 'lineTo' && (Math.abs(coords[0]) > 450 || Math.abs(coords[1]) > 530) && (coords[0] === 0 || coords[1] === 0)) {
                        console.warn(`Long lineTo operation`);
                    }
                    console.log(`Suboperation ${index}/${i}: ${origin} ${commandName} ${JSON.stringify(coords)}`);
                }

                if (coordCount === 2) {
                    origin = [origin[0] + coords[0], origin[1] + coords[1]];
                }
            });
        }
        else {
            // Log other operations in their basic form
            console.log(`Operation ${index}: ${operatorName}, Arguments: ${JSON.stringify(args)}`);
        }
    });
}

// console.log(`Segmenting page ${pageNum}...`);
// const segments = await segmentPage(page, viewport);
// console.log('segments:',segments);

function identifyCropMarks(page, viewport, operatorList) {
    const cropMarks = [];
    let cropRange = {};

    operatorList.fnArray.forEach((fn, index) => {
        const operatorName = operatorNames[fn] || `Unknown (${fn})`;
        const args = operatorList.argsArray[index];

        // Check for black or particular grey stroke color to start
        if (operatorName === "setStrokeRGBColor" &&
            typeof args === "object" &&
            args !== null &&
            ((args["0"] === 0 && args["1"] === 0 && args["2"] === 0)||(args["0"] === 6 && args["1"] === 6 && args["2"] === 12))
        ) {
            let foundMarks = [];

            // Check for 8 sets of operations at specified intervals
            for (let i = 1; i <= 8; i++) {
                const transformIndex = index + 3 * i; // 3-step interval for transform
                const pathIndex = transformIndex + 1; // 3-step interval for constructPath
                const strokeIndex = pathIndex + 1; // 3-step interval for stroke

                // Ensure indices are within bounds
                if (
                    transformIndex >= operatorList.fnArray.length ||
                    pathIndex >= operatorList.fnArray.length ||
                    strokeIndex >= operatorList.fnArray.length
                ) {
                    continue; // Skip this iteration if any index is out of bounds
                }

                const transformFn = operatorNames[operatorList.fnArray[transformIndex]] || `Unknown (${transformIndex})`;
                const constructPathFn = operatorNames[operatorList.fnArray[pathIndex]] || `Unknown (${pathIndex})`;
                const strokeFn = operatorNames[operatorList.fnArray[strokeIndex]] || `Unknown (${strokeIndex})`;

                // Check for transform operation
                if (transformFn === "transform") {
                    // Check for constructPath operation
                    if (constructPathFn === "constructPath" && Array.isArray(operatorList.argsArray[pathIndex])) {
                        const pathArgs = operatorList.argsArray[pathIndex];
                        const [pathArgsSet, coords] = pathArgs;

                        // Check if the path arguments match the required pattern
                        if (
                            Array.isArray(pathArgsSet) &&
                            pathArgsSet[0] === 13 && pathArgsSet[1] === 14 &&
                            (coords[2] === 0 || coords[3] === 0) // Either x or y is zero
                        ) {
                            // Check for stroke operation
                            if (strokeFn === "stroke") {
                                foundMarks.push({
                                    transform: {
                                        name: operatorNames[transformFn],
                                        args: operatorList.argsArray[transformIndex]
                                    },
                                    constructPath: {
                                        name: operatorNames[constructPathFn],
                                        args: pathArgs
                                    },
                                    stroke: {
                                        name: operatorNames[strokeFn],
                                        args: operatorList.argsArray[strokeIndex]
                                    }
                                });
                            }
                        }
                    }
                }
            }

            if (foundMarks.length === 8) {
                // Assuming the crop marks are found in the following order: top-left-vertical, top-left-horizontal,
                // top-right-vertical, top-right-horizontal, bottom-left-vertical, bottom-left-horizontal,
                // bottom-right-vertical, bottom-right-horizontal
                cropRange = {
                    x: [
                        foundMarks[0].transform.args[4],
                        foundMarks[0].transform.args[4] +
                        foundMarks[1].transform.args[4] +
                        foundMarks[2].transform.args[4]
                    ],
                    y: [
                        foundMarks[0].transform.args[5] + foundMarks[1].transform.args[5],
                        foundMarks[0].transform.args[5] +
                        foundMarks[1].transform.args[5] +
                        foundMarks[2].transform.args[5] +
                        foundMarks[3]?.transform.args[5] +
                        foundMarks[4]?.transform.args[5] +
                        foundMarks[5]?.transform.args[5]
                    ]
                }
                cropMarks.push(...foundMarks);
            }
            else {
                let operator = operatorNames[operatorList.fnArray[index + 4]] || `Unknown (${pathIndex})`;
                if (operator === 'constructPath') {
                    let pathArgs = operatorList.argsArray[index + 4];
                    const targetArray = [13, 14, 13, 14, 13, 14, 13, 14, 13, 14, 13, 14, 13, 14, 13, 14];
                    if (Array.isArray(pathArgs) &&
                        Array.isArray(pathArgs[0]) &&
                        pathArgs[0].length === targetArray.length &&
                        pathArgs[0].every((val, index) => val === targetArray[index])) {
                        operator = operatorNames[operatorList.fnArray[index + 3]] || `Unknown (${pathIndex})`;
                        if (operator === 'transform') {
                            const transformArgs = operatorList.argsArray[index + 3];
                            pathArgs = pathArgs[1];
                            cropRange = {
                                x: [pathArgs[14] - pathArgs[24], pathArgs[14] - pathArgs[16]],
                                y: [transformArgs[5], transformArgs[5] + pathArgs[9]]
                            }
                        }
                    }
                }
            }
            if (Object.keys(cropRange).length === 0) {
                // Check for 4 sets of operations at specified intervals
                for (let i = 1; i <= 4; i++) {
                    const pathIndex = index + 5 + 2 * i; // 2-step interval for constructPath
                    const strokeIndex = pathIndex + 1; // 2-step interval for stroke

                    // Ensure indices are within bounds
                    if (
                        pathIndex >= operatorList.fnArray.length ||
                        strokeIndex >= operatorList.fnArray.length
                    ) {
                        continue; // Skip this iteration if any index is out of bounds
                    }

                    const constructPathFn = operatorNames[operatorList.fnArray[pathIndex]] || `Unknown (${pathIndex})`;
                    const strokeFn = operatorNames[operatorList.fnArray[strokeIndex]] || `Unknown (${strokeIndex})`;

                    if (strokeFn === "stroke") {
                        if (constructPathFn === "constructPath" && Array.isArray(operatorList.argsArray[pathIndex])) {
                            const pathArgs = operatorList.argsArray[pathIndex][1];
                            if (pathIndex - index === 7) {
                                cropRange['y'] = [pathArgs[1], pathArgs[5]];
                            }
                            else if (pathIndex - index === 11) {
                                cropRange['x']= [pathArgs[0], pathArgs[4]];
                            }
                        }
                    }
                }
            }
        }
    });

    if (!!cropRange.y) {
        // Convert ranges to top-down reading order
        cropRange.y = [viewport.height - cropRange.y[0], viewport.height - cropRange.y[1]];
    }
    else {
        console.warn('Crop Range not found: using defaults.');
        // Use default crop range based on printed page size 595.276 x 864.567
        const gutterX = (viewport.width - 595.276) / 2;
        const gutterY = (viewport.height - 864.567) / 2;
        cropRange.x = [gutterX, viewport.width - gutterX];
        cropRange.y = [gutterY, viewport.height - gutterY];
    }

    // Shave 2px off the crop range to ensure the crop marks are not included
    if (!!cropRange.x) {
        cropRange.x = [cropRange.x[0] + 2, cropRange.x[1] - 2];
    }
    if (!!cropRange.y) {
        cropRange.y = [cropRange.y[0] + 2, cropRange.y[1] - 2];
    }

    return cropRange;
}


async function renderPageToCanvas(page, viewport) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    // Render the page to the canvas
    await page.render({ canvasContext: context, viewport }).promise;

    return canvas;
}


function eraseOutsideCropRange(data, cropRange, canvasWidth, canvasHeight) {
    const [xMin, xMax] = cropRange.x;
    const [yMin, yMax] = cropRange.y;
    const whitePixel = new Uint8ClampedArray([255, 255, 255, 255]);

    for (let y = 0; y < canvasHeight; y++) {
        const rowStartIndex = y * canvasWidth * 4;

        for (let x = 0; x < canvasWidth; x++) {
            if (x < xMin || x > xMax || y < yMin || y > yMax) {
                data.set(whitePixel, rowStartIndex + x * 4);
            }
        }
    }
}


function paintEmbeddedImages(data, embeddedImages, canvasWidth, canvasHeight) {
    // Paint over embedded images to ensure that they are properly segmented
    const blackPixel = new Uint8ClampedArray([0, 0, 0, 255]);

    console.log(`Painting over ${embeddedImages.length} embedded images on ${canvasWidth}x${canvasHeight}`, embeddedImages);

    embeddedImages.forEach(image => {
        // Convert coordinates to integers
        const left = Math.round(image.left);
        const top = Math.round(image.top);
        const right = Math.round(image.right);
        const bottom = Math.round(image.bottom);

        console.log(`Painting over embedded image: ${left}, ${top}, ${right}, ${bottom}`);

        for (let y = top; y < bottom; y++) {
            if (y < 0 || y >= canvasHeight) continue; // Skip out of bounds

            const rowStartIndex = y * canvasWidth * 4;

            for (let x = left; x < right; x++) {
                if (x < 0 || x >= canvasWidth) continue; // Skip out of bounds
                data.set(blackPixel, rowStartIndex + x * 4);
            }
        }
    });
}


function getEmbeddedImages(operatorList, viewport) {
    const images = [];

    operatorList.fnArray.forEach((fn, index) => {
        const operatorName = operatorNames[fn] || `Unknown (${fn})`;

        if (operatorName === "paintImageXObject") {
            const transformArgs = operatorList.argsArray[index - 2];

            // Extract and normalize rectangle coordinates
            let x0 = transformArgs[4];
            let y0 = viewport.height - transformArgs[5];  // Flip y-coordinate to top-down
            let x1 = x0 + transformArgs[0];
            let y1 = viewport.height - (transformArgs[5] + transformArgs[3]);  // Flip y-coordinate

            // Ensure x0 < x1 and y0 < y1 for consistency
            if (x0 > x1) [x0, x1] = [x1, x0];
            if (y0 > y1) [y0, y1] = [y1, y0];

            // Calculate dimensions
            const width = x1 - x0;
            const height = y1 - y0;
            const area = width * height;

            images.push({
                top: y0,
                left: x0,
                bottom: y1,
                right: x1,
                width,
                height,
                area,
                type: `paintImageXObject (#${index})`
            });
        }
    });

    return images;
}


const worker = new Worker("js/segmenter.js");
function segmentPage(page, viewport, operatorList) {
    return new Promise(async (resolve, reject) => {
        const cropRange = identifyCropMarks(page, viewport, operatorList);
        const canvas = await renderPageToCanvas(page, viewport);
        const context = canvas.getContext("2d");
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const embeddedImages = getEmbeddedImages(operatorList, viewport);

        eraseOutsideCropRange(imageData.data, cropRange, canvas.width, canvas.height);
        paintEmbeddedImages(imageData.data, embeddedImages, canvas.width, canvas.height);
        context.putImageData(imageData, 0, 0);

        // Event listener for the worker message that resolves this promise
        const handleWorkerMessage = (e) => {
            if (e.data.action === "result") {
                worker.removeEventListener("message", handleWorkerMessage); // Clean up listener
                const segmentation = e.data.segmentation;
                const printExtent = segmentation.reduce(([colmin, rowmin, colmax, rowmax], row) => {
                    const columnRanges = row.columns.flatMap(col => col.range);
                    return [
                        Math.min(colmin, ...columnRanges),
                        Math.min(rowmin, row.range[0]),
                        Math.max(colmax, ...columnRanges),
                        Math.max(rowmax, row.range[1])
                    ];
                }, [Infinity, Infinity, -Infinity, -Infinity]);

                // Extract rectangles from segmentation
                let rectangles = segmentation.flatMap(row =>
                    row.columns
                        .filter(column => column.rectangle)
                        .map(column => ({
                            left: column.range[0],
                            top: row.range[0],
                            right: column.range[1],
                            bottom: row.range[1],
                            width: column.range[1] - column.range[0],
                            height: row.range[1] - row.range[0],
                            type: 'segmentation'
                        }))
                );

                // Remove rectangles which contain embedded images
                const tolerance = 3;
                rectangles = rectangles.filter(rect =>
                    !embeddedImages.some(image => (
                        rect.left <= image.right + tolerance &&
                        rect.right >= image.left - tolerance &&
                        rect.top <= image.bottom + tolerance &&
                        rect.bottom >= image.top - tolerance
                    ))
                );

                resolve({
                    cropRange: cropRange,
                    embeddedImages: embeddedImages,
                    rectangles: rectangles,
                    printExtent: printExtent,
                    segmentation: segmentation
                }); // Resolve the promise with the worker's result
            }
        };

        // Listen for the worker's response
        worker.addEventListener("message", handleWorkerMessage);

        // Handle errors in the worker
        worker.onerror = (error) => {
            worker.removeEventListener("message", handleWorkerMessage);
            reject(error);
        };

        // Send ImageData to worker for OpenCV processing
        worker.postMessage({ action: "processPage", imageData });
    });
}


async function extractDrawingsAsBase64(page, viewport, drawingBorders) {
    const canvas = await renderPageToCanvas(page, viewport);
    const context = canvas.getContext("2d");

    const base64Images = await Promise.all(
        drawingBorders.map(async (rect) => {
            const tempCanvas = document.createElement("canvas");
            const tempContext = tempCanvas.getContext("2d");
            tempCanvas.width = rect.width;
            tempCanvas.height = rect.height;

            tempContext.drawImage(
                canvas,
                rect.left,           // Source x
                rect.top,            // Source y (now in top-down order)
                rect.width,          // Source width
                rect.height,         // Source height
                0,                   // Destination x
                0,                   // Destination y
                rect.width,          // Destination width
                rect.height          // Destination height
            );

            return tempCanvas.toDataURL("image/png");
        })
    );

    return base64Images;
}
