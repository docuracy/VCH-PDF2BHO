import {EditorView, basicSetup} from "https://esm.sh/codemirror";
import {xml} from "https://esm.sh/@codemirror/lang-xml";
import {keymap} from "https://esm.sh/@codemirror/view";
import {Prec} from "https://esm.sh/@codemirror/state";
import {indentWithTab} from "https://esm.sh/@codemirror/commands";

// Smart toggle function: Wraps if clean, Unwraps if formatted
function toggleFormatting(view, openTag, closeTag) {
    const {state} = view;
    const {from, to} = state.selection.main;
    const doc = state.doc;

    // Don't act on empty selections
    if (from === to) return false;

    const openLen = openTag.length;
    const closeLen = closeTag.length;

    // 1. CHECK SURROUNDING (e.g. <b>|text|</b>)
    // Check if the text immediately outside the selection matches the tags
    const textBefore = doc.sliceString(from - openLen, from);
    const textAfter = doc.sliceString(to, to + closeLen);

    if (textBefore === openTag && textAfter === closeTag) {
        // UNWRAP: Remove the tags surrounding the selection
        view.dispatch({
            changes: [
                {from: from - openLen, to: from, insert: ""}, // Remove opening tag
                {from: to, to: to + closeLen, insert: ""}     // Remove closing tag
            ],
            // Keep the text selected
            selection: {anchor: from - openLen, head: to - openLen}
        });
        return true;
    }

    // 2. CHECK INSIDE (e.g. |<b>text</b>|)
    // Check if the user selected the tags along with the text
    const selectedText = state.sliceDoc(from, to);
    if (selectedText.startsWith(openTag) && selectedText.endsWith(closeTag)) {
        // UNWRAP: Replace the whole selection with just the inner text
        const innerText = selectedText.slice(openLen, -closeLen);
        view.dispatch({
            changes: {from, to, insert: innerText},
            // Select the inner text
            selection: {anchor: from, head: from + innerText.length}
        });
        return true;
    }

    // 3. DEFAULT: WRAP
    view.dispatch({
        changes: {
            from,
            to,
            insert: `${openTag}${selectedText}${closeTag}`
        },
        selection: {anchor: from + openLen, head: from + openLen + selectedText.length}
    });
    return true;
}

// Define custom keybindings
const formattingKeymap = keymap.of([
    {
        key: "Mod-b", // Ctrl+B or Cmd+B
        run: (view) => toggleFormatting(view, '<b>', '</b>'),
        preventDefault: true
    },
    {
        key: "Mod-i", // Ctrl+I or Cmd+I
        run: (view) => toggleFormatting(view, '<i>', '</i>'),
        preventDefault: true
    },
    {
        key: "Mod-u", // Ctrl+U or Cmd+U
        run: (view) => toggleFormatting(view, '<u>', '</u>'),
        preventDefault: true
    }
]);

export const editor = new EditorView({
    doc: "<!DOCTYPE html>\n<html>\n...</html>",
    extensions: [basicSetup, xml(), keymap.of([indentWithTab]), Prec.highest(formattingKeymap)],
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
        let formatted = vkbeautify.xml(currentContent, 4);

        // Remove empty lines: This regex finds lines that contain only whitespace (spaces/tabs) and removes them
        formatted = formatted.replace(/^\s*[\r\n]/gm, "");

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