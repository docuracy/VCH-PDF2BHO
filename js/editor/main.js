import {editor} from "./editor.js";
import {generatePreview} from "./preview.js";

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

document.getElementById("edit-tab").onclick = () => {
    document.getElementById("edit-container").style.display = "block";
    document.getElementById("preview-container").style.display = "none";
    document.getElementById("edit-tab").classList.add("active");
    document.getElementById("preview-tab").classList.remove("active");
};

document.getElementById("preview-tab").onclick = async () => {
    document.getElementById("edit-container").style.display = "none";
    document.getElementById("preview-container").style.display = "block";
    document.getElementById("edit-tab").classList.remove("active");
    document.getElementById("preview-tab").classList.add("active");

    await generatePreview(editor.state.doc.toString());
};

document.getElementById("validate-btn").onclick = () => {
    const xhtml = editor.state.doc.toString();
    const resultEl = document.getElementById("validation-result");

    try {
        const xmlDoc = new DOMParser().parseFromString(xhtml, "application/xml");
        // Check for parsererror element with namespace
        const parseError = xmlDoc.getElementsByTagName("parsererror")[0];

        if (parseError) {
            // Extract the actual error message from the div
            const errorDiv = parseError.querySelector("div");
            const errorText = errorDiv ? errorDiv.textContent : parseError.textContent;
            resultEl.textContent = "❌ " + errorText.trim();
            resultEl.className = "invalid";
        } else {
            resultEl.textContent = "✓ Valid XML";
            resultEl.className = "valid";
        }

    } catch (e) {
        console.error("Exception:", e);
        resultEl.textContent = "❌ Parse error: " + e.message;
        resultEl.className = "invalid";
    }

    console.log("=== Validation End ===");
};

document.getElementById("file-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const text = await file.text();
    editor.dispatch({
        changes: {from: 0, to: editor.state.doc.length, insert: text}
    });
});