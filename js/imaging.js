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
    const operatorListArray = operatorList.fnArray.map((fn, index) => {
        const operatorName = operatorNames[fn] || `Unknown (${fn})`;
        const args = operatorList.argsArray[index];

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

                // Alert orthogonal lineTo with long length
                if (commandName === 'lineTo' && (coords[0] > 100 || coords[1] > 100) && (coords[0] === 0 || coords[1] === 0)) {
                    console.warn(`Long lineTo operation`);
                }

                console.log(`Suboperation ${index}/${i}: ${commandName}, Coordinates: ${JSON.stringify(coords)}`);
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


function normaliseRectangles(rectangles, viewport) {
    return rectangles.map(rect => {
        const normalisedRect = { ...rect };

        // Convert y-values to top-down reading order, set absolute width and height, and calculate area
        if (normalisedRect.y0 > normalisedRect.y1) {
            [normalisedRect.y0, normalisedRect.y1] = [normalisedRect.y1, normalisedRect.y0];
        }
        if (normalisedRect.x0 > normalisedRect.x1) {
            [normalisedRect.x0, normalisedRect.x1] = [normalisedRect.x1, normalisedRect.x0];
        }
        normalisedRect.top = viewport.height - normalisedRect.y1;
        normalisedRect.left = normalisedRect.x0;
        normalisedRect.bottom = viewport.height - normalisedRect.y0;
        normalisedRect.right = normalisedRect.x1;
        normalisedRect.width = normalisedRect.right - normalisedRect.left;
        normalisedRect.height = normalisedRect.bottom - normalisedRect.top;
        normalisedRect.area = normalisedRect.width * normalisedRect.height;

        return normalisedRect;
    });
}


// Function to extract rectangles from operator list
function findRectangles(operatorList, cropRange, viewport, embeddedImages) {
    let rectangles = [];
    let origin = [0, 0];

    operatorList.fnArray.forEach((fn, index) => {
        const args = operatorList.argsArray[index];

        const nextOperator = index < operatorList.fnArray.length - 1 ? operatorList.fnArray[index + 1] : null;
        const nextOp = nextOperator ? operatorNames[nextOperator] || `Unknown (${nextOperator})` : null;

        if (fn === pdfjsLib.OPS.transform) {
            origin = [args[4], args[5]];
        }

        function addRectangle(args, move = [0, 0]) {
            rectangles.push({
                x0: origin[0] + move[0] + args[0],
                y0: origin[1] + move[1] + args[1],
                x1: origin[0] + move[0] + args[0] + args[2],
                y1: origin[1] + move[1] + args[1] + args[3],
                type: `transform (#${index})`,
                nextOp: nextOp
            });
        }

        if (fn === pdfjsLib.OPS.rectangle) {
            addRectangle(args);
        }

        if (fn === pdfjsLib.OPS.constructPath) {

            const operators = args[0]; // Contains the operator data
            const pathArgs = args[1]; // Contains the path data

            if (operators[0] === 13 && operators[1] === 19) {
                const move = [pathArgs[0], pathArgs[1]];
                addRectangle(pathArgs.slice(2), move);
            } else if (operators[1] === 19) {
                addRectangle(pathArgs.slice(0, 4));
            }
        }
    });

    rectangles = normaliseRectangles(rectangles, viewport);

    // Keep rectangles within 10% - 90% of the crop area
    const cropArea = (cropRange.x[1] - cropRange.x[0]) * (cropRange.y[1] - cropRange.y[0]);
    rectangles = rectangles.filter(rect => rect.area > 0.1 * cropArea && rect.area < 0.9 * cropArea);

    // Filter out rectangles outside the crop range
    rectangles = rectangles.filter(rect => {
        return rect.left >= cropRange.x[0] && rect.right <= cropRange.x[1] &&
            rect.top >= cropRange.y[0] && rect.bottom <= cropRange.y[1];
    });

    // Sort rectangles by area in descending order
    rectangles.sort((rect1, rect2) => rect2.area - rect1.area);

    // Filter out rectangles which contain embedded images and are within +10% of the image area
    rectangles = rectangles.filter(rect => {
        return !embeddedImages.some(image => {
            return (
                rect.left >= image.left &&
                rect.right <= image.right &&
                rect.top >= image.top &&
                rect.bottom <= image.bottom &&
                rect.area < 1.1 * image.area
            );
        });
    });

    return rectangles;
}


// Function to extract rectangles from operator list
function findDrawings(operatorList, cropRange, viewport) {
    let rectangles = [];
    let origin = [0, 0];

    operatorList.fnArray.forEach((fn, index) => {
        const args = operatorList.argsArray[index];

        const nextOperator = index < operatorList.fnArray.length - 1 ? operatorList.fnArray[index + 1] : null;
        const nextOp = nextOperator ? operatorNames[nextOperator] || `Unknown (${nextOperator})` : null;

        if (fn === pdfjsLib.OPS.transform) {
            origin = [args[4], args[5]];
        }

        // Detect images
        if (fn === pdfjsLib.OPS.paintImageXObject) {
            const transformArgs = operatorList.argsArray[index - 2];
            rectangles.push({
                x0: transformArgs[4],
                y0: transformArgs[5],
                x1: transformArgs[4] + transformArgs[0],
                y1: transformArgs[5] + transformArgs[3],
                type: `paintImageXObject (#${index})`,
                nextOp: nextOp
            });
        }

        function addRectangle(args, move = [0, 0]) {
            rectangles.push({
                x0: origin[0] + move[0] + args[0],
                y0: origin[1] + move[1] + args[1],
                x1: origin[0] + move[0] + args[0] + args[2],
                y1: origin[1] + move[1] + args[1] + args[3],
                type: `transform (#${index})`,
                nextOp: nextOp
            });
        }

        if (fn === pdfjsLib.OPS.rectangle) {
            addRectangle(args);
        }

        if (fn === pdfjsLib.OPS.constructPath) {

            const operators = args[0]; // Contains the operator data
            const pathArgs = args[1]; // Contains the path data

            if (operators[0] === 13 && operators[1] === 19) {
                const move = [pathArgs[0], pathArgs[1]];
                addRectangle(pathArgs.slice(2), move);
            } else if (operators[1] === 19) {
                addRectangle(pathArgs.slice(0, 4));
            }
        }
    });

    rectangles = normaliseRectangles(rectangles, viewport);

    // Keep rectangles within 10% - 90% of the crop area
    const cropArea = (cropRange.x[1] - cropRange.x[0]) * (cropRange.y[1] - cropRange.y[0]);
    rectangles = rectangles.filter(rect => rect.area > 0.1 * cropArea && rect.area < 0.9 * cropArea);

    // Filter out rectangles outside the crop range
    rectangles = rectangles.filter(rect => {
        return rect.left >= cropRange.x[0] && rect.right <= cropRange.x[1] &&
            rect.top >= cropRange.y[0] && rect.bottom <= cropRange.y[1];
    });

    // Sort rectangles by area in descending order
    rectangles.sort((rect1, rect2) => rect2.area - rect1.area);

    // Filter out rectangles wholly within other rectangles which are not images
    rectangles = rectangles.filter((rect1, i) => {
        // Check if rect1 is within any other rect
        return !rectangles.some((rect2, j) => {
            return (
                i !== j && // Make sure we're not comparing the same rectangle
                rect1.top >= rect2.top &&
                rect1.left >= rect2.left &&
                rect1.bottom <= rect2.bottom &&
                rect1.right <= rect2.right &&
                !rect1.type.startsWith('paintImageXObject') // Exclude images
            );
        });
    });

    // Process intersections and return the final list of rectangles
    return processRectangles(rectangles);
}

// Function to check if two rectangles intersect
function intersects(rect1, rect2) {
    return (
        rect1.left < rect2.right &&
        rect1.right > rect2.left &&
        rect1.top < rect2.bottom &&
        rect1.bottom > rect2.top
    );
}

// Function to calculate intersection of two rectangles
function calculateIntersection(rect1, rect2) {
    const intersectTop = Math.max(rect1.top, rect2.top);
    const intersectLeft = Math.max(rect1.left, rect2.left);
    const intersectBottom = Math.min(rect1.bottom, rect2.bottom);
    const intersectRight = Math.min(rect1.right, rect2.right);

    // Only return a valid intersection if it exists
    if (intersectTop < intersectBottom && intersectLeft < intersectRight) {
        return {
            top: intersectTop,
            left: intersectLeft,
            bottom: intersectBottom,
            right: intersectRight,
            width: intersectRight - intersectLeft,
            height: intersectBottom - intersectTop,
            area: (intersectRight - intersectLeft) * (intersectBottom - intersectTop),
            x0: Math.max(rect1.x0, rect2.x0),
            y0: Math.max(rect1.y0, rect2.y0),
            x1: Math.min(rect1.x1, rect2.x1),
            y1: Math.min(rect1.y1, rect2.y1),
            type: `${rect1.type} + ${rect2.type}`,
            nextOp: `${rect1.nextOp} + ${rect2.nextOp}`
        };
    }
    return null; // No valid intersection
}

// Main function to process rectangles
function processRectangles(rectangles) {
    const intersectingRectangles = [];
    const nonIntersectingRectangles = [];

    // Sort rectangles into intersecting and non-intersecting arrays
    for (let i = 0; i < rectangles.length; i++) {
        const rect1 = rectangles[i];
        let hasIntersection = false;

        for (let j = 0; j < rectangles.length; j++) {
            if (i !== j) {
                const rect2 = rectangles[j];

                // Check if rect1 intersects with rect2
                if (intersects(rect1, rect2)) {
                    hasIntersection = true;
                    break; // No need to check further if an intersection is found
                }
            }
        }

        // Add to appropriate array
        if (hasIntersection) {
            intersectingRectangles.push(rect1);
        } else {
            nonIntersectingRectangles.push(rect1);
        }
    }

    // Calculate intersections for the intersecting rectangles
    const intersectionResults = [];

    for (let i = 0; i < intersectingRectangles.length; i++) {
        const rect1 = intersectingRectangles[i];

        for (let j = i + 1; j < intersectingRectangles.length; j++) {
            const rect2 = intersectingRectangles[j];
            const intersection = calculateIntersection(rect1, rect2);

            if (intersection) {
                intersectionResults.push(intersection);
            }
        }
    }

    // Combine non-intersecting rectangles with the intersections
    return [...nonIntersectingRectangles, ...intersectionResults];
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


function getEmbeddedImages(operatorList, viewport) {
    const images = [];

    operatorList.fnArray.forEach((fn, index) => {
        const operatorName = operatorNames[fn] || `Unknown (${fn})`;

        // Check for image operations
        if (operatorName === "paintImageXObject") {
            const transformArgs = operatorList.argsArray[index - 2];
            images.push({
                x0: transformArgs[4],
                y0: transformArgs[5],
                x1: transformArgs[4] + transformArgs[0],
                y1: transformArgs[5] + transformArgs[3],
                type: `paintImageXObject (#${index})`
            });
        }
    });

    return normaliseRectangles(images, viewport);
}


const worker = new Worker("js/segmenter.js");
function segmentPage(page, viewport, operatorList) {
    return new Promise(async (resolve, reject) => {
        const cropRange = identifyCropMarks(page, viewport, operatorList);
        const canvas = await renderPageToCanvas(page, viewport);
        const context = canvas.getContext("2d");
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const embeddedImages = getEmbeddedImages(operatorList, viewport);
        const rectangles = findRectangles(operatorList, cropRange, viewport, embeddedImages);

        eraseOutsideCropRange(imageData.data, cropRange, canvas.width, canvas.height);
        context.putImageData(imageData, 0, 0);

        // Event listener for the worker message that resolves this promise
        const handleWorkerMessage = (e) => {
            if (e.data.action === "result") {
                worker.removeEventListener("message", handleWorkerMessage); // Clean up listener
                resolve({cropRange: cropRange, embeddedImages: embeddedImages, rectangles: rectangles, segmentation: e.data.result}); // Resolve the promise with the worker's result
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
        worker.postMessage({ action: "segmentPage", imageData });
    });
}


async function extractDrawingsAsBase64(page, viewport, drawingBorders) {
    const canvas = await renderPageToCanvas(page, viewport);
    const context = canvas.getContext("2d");

    // Process each crop rectangle
    const base64Images = await Promise.all(
        drawingBorders.map(async (rect) => {
            // Create a temporary canvas to hold the cropped region
            const tempCanvas = document.createElement("canvas");
            const tempContext = tempCanvas.getContext("2d");
            tempCanvas.width = rect.width;
            tempCanvas.height = rect.height;

            // Crop the specified region from the main canvas
            tempContext.drawImage(
                canvas,      // Source canvas
                rect.x0,     // Source x
                viewport.height - rect.y1,     // Source y (bottom-up)
                rect.width,       // Source width
                rect.height,      // Source height
                0,           // Destination x
                0,           // Destination y
                rect.width,       // Destination width
                rect.height       // Destination height
            );

            // Convert the cropped region to a base64 data URL
            return tempCanvas.toDataURL("image/png");
        })
    );

    return base64Images; // Array of base64 images
}
