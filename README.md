# VCH PDF to BHO-XML Converter

## Overview

This project is a web-based application that converts Victoria County History (VCH) PDF files to the British History Online (BHO) custom XML format. It provides a user-friendly interface for selecting PDF files, configuring options, and viewing the conversion results.

## Features

- **PDF to XML Conversion**: Convert PDF files to BHO-XML format.
- **Batch Processing**: Select and process multiple PDF files at once.
- **Hyphenation Check**: Option to check and correct hyphenation in words broken at the ends of lines.
- **HTML Preview**: View the converted XML content in an HTML preview modal.
- **Cache Busting**: Automatically update CSS and JS links with a cache-busting timestamp.

## Technologies Used

- **JavaScript**: Core language for the application logic.
- **HTML/CSS**: Markup and styling for the user interface.
- **Bootstrap**: Framework for responsive design and UI components.
- **jQuery**: Simplified DOM manipulation and event handling.
- **PDF.js**: Library for parsing and rendering PDF files.
- **JSZip**: Library for handling ZIP files.
- **FileSaver.js**: Library for saving files on the client-side.
- **Simple Statistics**: Library for statistical calculations.
- **LZ-String**: Library for string compression.

## Project Structure

- `index.html`: Main HTML file for the application interface.
- `css/styles.css`: Custom styles for the application.
- `js/app.js`: Main JavaScript file for application logic.
- `js/utilities.js`: Utility functions used across the application.
- `js/imaging.js`: Functions related to image processing.
- `js/text.js`: Functions related to text processing.
- `js/pdf.js`: Functions related to PDF processing.
- `scripts/anti-cache.js`: Script for adding cache-busting timestamps to CSS and JS links.
- `build.yml`: GitHub Actions workflow for deploying the application to GitHub Pages.

## Usage

1. **Select PDF Files**: Use the file input to select one or more PDF files.
2. **Configure Options**: Check the "Check Hyphenation" option if needed.
3. **Convert to XML**: Click the "Convert to XML" button to start the conversion process.
4. **View Results**: The converted XML content will be displayed in the HTML preview modal.

## Deployment

The project uses GitHub Actions for continuous deployment to GitHub Pages. The `build.yml` workflow handles the deployment process, including cache busting for static assets.

## License

This project is licensed under the Creative Commons Attribution-NonCommercial 4.0 International License. See the [LICENSE](LICENSE.md) file for more details.