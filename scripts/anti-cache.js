const fs = require('fs');
const path = require('path');

// Files to update with cache-busting timestamp
const htmlFilePath = path.join(__dirname, '../index.html');
const timestamp = new Date().getTime();

fs.readFile(htmlFilePath, 'utf8', (err, data) => {
    if (err) throw err;

    // Replace CSS and JS links with cache-busting timestamp query strings
    const updatedData = data
        .replace(/(href="css\/styles\.css)(\?v=\d+)?"/, `$1?v=${timestamp}"`)
        .replace(/(src="js\/app\.js)(\?v=\d+)?"/, `$1?v=${timestamp}"`)
        .replace(/(src="js\/utilities\.js)(\?v=\d+)?"/, `$1?v=${timestamp}"`)
        .replace(/(src="js\/imaging\.js)(\?v=\d+)?"/, `$1?v=${timestamp}"`)
        .replace(/(src="js\/text\.js)(\?v=\d+)?"/, `$1?v=${timestamp}"`)
        .replace(/(src="js\/pdf\.js)(\?v=\d+)?"/, `$1?v=${timestamp}"`);

    fs.writeFile(htmlFilePath, updatedData, 'utf8', (err) => {
        if (err) throw err;
        console.log(`Updated HTML with cache-busting timestamp: ${timestamp}`);
    });
});
