import { editor } from "./editor.js";
import { generatePreview } from "./preview.js";

document.getElementById("edit-tab").onclick = () => {
    document.getElementById("edit-container").style.display = "block";
    document.getElementById("preview-container").style.display = "none";
};

document.getElementById("preview-tab").onclick = async () => {
    document.getElementById("edit-container").style.display = "none";
    document.getElementById("preview-container").style.display = "block";

    await generatePreview(editor.state.doc.toString());
};
