import {editor} from "./editor.js";
import {generatePreview} from "./preview.js";
import {validateXML} from "./validator.js";

window.addEventListener("DOMContentLoaded", async () => {
    const url = "./xhtml-view/160028.xhtml";

    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(resp.status);
        const text = await resp.text();

        editor.dispatch({
            changes: {from: 0, to: editor.state.doc.length, insert: text}
        });
    } catch (e) {
        console.error("Failed to load XHTML:", e);
    }
});

document.getElementById("edit-tab").onclick = (e) => {
    // Check if download icon was clicked
    if (e.target.id === "download-xml-icon") {
        e.stopPropagation();
        downloadXML();
        return;
    }

    document.getElementById("edit-container").style.display = "block";
    document.getElementById("preview-container").style.display = "none";
    document.getElementById("edit-tab").classList.add("active");
    document.getElementById("preview-tab").classList.remove("active");
};

document.getElementById("preview-tab").onclick = async (e) => {
    // Check if download icon was clicked
    if (e.target.id === "download-html-icon") {
        e.stopPropagation();
        await downloadHTML();
        return;
    }

    const xhtml = editor.state.doc.toString();

    // Validate first
    if (!validateXML(xhtml)) {
        return; // Short-circuit on validation failure
    }

    document.getElementById("edit-container").style.display = "none";
    document.getElementById("preview-container").style.display = "block";
    document.getElementById("edit-tab").classList.remove("active");
    document.getElementById("preview-tab").classList.add("active");

    await generatePreview(xhtml);
};

function downloadXML() {
    const xhtml = editor.state.doc.toString();
    const blob = new Blob([xhtml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'document.xhtml';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function downloadHTML() {
    const xhtml = editor.state.doc.toString();

    // Validate first
    if (!validateXML(xhtml)) {
        return; // Short-circuit on validation failure
    }

    // Generate preview if not already done
    if (!window.transformedHTML) {
        await generatePreview(xhtml);
    }

    const blob = new Blob([window.transformedHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'document.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

document.getElementById("file-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const text = await file.text();
    editor.dispatch({
        changes: {from: 0, to: editor.state.doc.length, insert: text}
    });
});