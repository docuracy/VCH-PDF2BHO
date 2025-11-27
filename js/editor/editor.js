import { EditorView, basicSetup } from "https://esm.sh/codemirror";
import { xml } from "https://esm.sh/@codemirror/lang-xml";

export const editor = new EditorView({
    doc: "<!DOCTYPE html>\n<html>\n...</html>",
    extensions: [basicSetup, xml()],
    parent: document.getElementById("xhtml-editor")
});
