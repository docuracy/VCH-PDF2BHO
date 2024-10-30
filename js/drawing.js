// /js/drawing.js
// Description: Contains functions to extract drawings from PDF files.


// Create a reverse lookup object to map operator numbers to their names
const operatorNames = Object.keys(pdfjsLib.OPS).reduce((acc, key) => {
    acc[pdfjsLib.OPS[key]] = key;
    return acc;
}, {});

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
            const [commandArray, coordinatesArray] = args;

            // Iterate over command array to log suboperations
            commandArray.forEach((command, i) => {
                const coordIndex = i * 2; // Assuming each command has 2 coordinates
                const coords = coordinatesArray.slice(coordIndex, coordIndex + 2);
                const commandName = operatorNames[command] || `Unknown Command (${command})`;

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

function identifyCropMarks(operatorList) {
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

    return cropRange;
}


// Function to extract rectangles from operator list
function findDrawings(operatorList, cropRange, viewport) {
    let rectangles = [];

    operatorList.fnArray.forEach((fn, index) => {
        const args = operatorList.argsArray[index];

        const nextOperator = index < operatorList.fnArray.length - 1 ? operatorList.fnArray[index + 1] : null;
        const nextOp = nextOperator ? operatorNames[nextOperator] || `Unknown (${nextOperator})` : null;

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

        if (fn === pdfjsLib.OPS.rectangle) {
            rectangles.push({
                x0: args[0],
                y0: args[1],
                x1: args[0] + args[2],
                y1: args[1] + args[3],
                type: `rectangle (#${index})`,
                nextOp: nextOp
            });
        }

        if (fn === pdfjsLib.OPS.constructPath) {

            const operators = args[0]; // Contains the operator data
            const pathArgs = args[1]; // Contains the path data

            cursor = 0;
            operators.forEach((op, i) => {

                if (op === pdfjsLib.OPS.moveTo) {
                    // Discard a pair of coordinates
                    cursor += 2;
                } else if (op === pdfjsLib.OPS.rectangle) {
                    const rectangle = pathArgs.slice(cursor, cursor + 4);
                    cursor += 4;
                    // console.log('Operators:', operators.map(op => operatorNames[op]));
                    // console.log('pathArgs:', pathArgs);
                    // console.log('Rectangle:', rectangle);
                    rectangles.push({
                        x0: rectangle[0],
                        y0: rectangle[1],
                        x1: rectangle[0] + rectangle[2],
                        y1: rectangle[1] + rectangle[3],
                        type: `constructPath (#${index})`,
                        nextOp: nextOp
                    });
                }
            });
        }
    });

    // Convert y-values to top-down reading order, set absolute width and height, and calculate area
    rectangles.forEach(rect => {
            if (rect.y0 > rect.y1) {
                [rect.y0, rect.y1] = [rect.y1, rect.y0];
            }
            if (rect.x0 > rect.x1) {
                [rect.x0, rect.x1] = [rect.x1, rect.x0];
            }
            rect.top = viewport.height - rect.y1;
            rect.left = rect.x0;
            rect.bottom = viewport.height - rect.y0;
            rect.right = rect.x1;
            rect.width = rect.right - rect.left;
            rect.height = rect.bottom - rect.top;
            rect.area = rect.width * rect.height;
        }
    );

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


async function extractDrawingsAsBase64(page, viewport, drawingBorders) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    // Set the canvas size to the page dimensions
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    // Render PDF page to the canvas
    await page.render({ canvasContext: context, viewport: viewport }).promise;

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
