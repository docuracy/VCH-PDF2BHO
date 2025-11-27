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
};

document.getElementById("preview-tab").onclick = async () => {
    document.getElementById("edit-container").style.display = "none";
    document.getElementById("preview-container").style.display = "block";

    await generatePreview(editor.state.doc.toString());
};

document.getElementById("file-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const text = await file.text();
    editor.dispatch({
        changes: {from: 0, to: editor.state.doc.length, insert: text}
    });
});

document.getElementById("edit-tab").classList.add("active");
document.getElementById("preview-tab").classList.remove("active");

