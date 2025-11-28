import { EditorView, basicSetup } from "https://esm.sh/codemirror";
import { xml } from "https://esm.sh/@codemirror/lang-xml";

export const editor = new EditorView({
    doc: "<!DOCTYPE html>\n<html>\n...</html>",
    extensions: [basicSetup, xml()],
    parent: document.getElementById("xhtml-editor")
});

// Format function using vkBeautify (loaded via script tag in HTML)
export function formatDocument() {
    if (typeof vkbeautify === 'undefined') {
        console.error('vkBeautify not loaded');
        alert('XML formatter not loaded. Please reload the page.');
        return;
    }

    const currentContent = editor.state.doc.toString();

    try {
        // Use vkBeautify to format XML with 4-space indentation
        const formatted = vkbeautify.xml(currentContent, 4);

        editor.dispatch({
            changes: {
                from: 0,
                to: editor.state.doc.length,
                insert: formatted
            }
        });
    } catch (error) {
        console.error('Error formatting XML:', error);
        alert('Error formatting XML: ' + error.message);
    }
}