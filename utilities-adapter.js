// This file adapts the jQuery-based utility functions from utilities.js
// to be usable by the ES6 module system

// These functions are already loaded via utilities.js script tag
// We just need to make sure they're available globally

// Utility function adapter - log to modal instead of the old log container
window.appendLogMessage = function(message) {
    const logEl = document.getElementById('extraction-log');
    if (logEl) {
        const p = document.createElement('p');
        p.textContent = message;
        logEl.appendChild(p);
        logEl.scrollTop = logEl.scrollHeight;
    } else {
        console.log(message);
    }
};

// Make sure these are globally available for the PDF processing code
window.showAlert = window.showAlert || function(message, type) {
    console.log(`[${type}] ${message}`);
    alert(message);
};