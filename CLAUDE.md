# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A zero-build, browser-hosted app (GitHub Pages) that converts Victoria County History (VCH) PDFs into a constrained
XHTML format, lets the user hand-correct it in a CodeMirror editor, then transforms it to BHO HTML (preview) and BHO
legacy XML (export) via Saxon-JS XSLT 3.0. All processing is client-side. See `README.md` for user-facing docs and
`SCHEMAS.md` for the BHO XML schema and the VCH XHTML schema it maps to.

## Commands

There is no build, bundler, linter, or test suite. `package.json` is a stub (`npm test` deliberately exits 1); nothing
is installed from npm at runtime — third-party libraries are vendored in `js/library/` and `xhtml-view/js/`.

**Run locally** — must be served over HTTP (the Web Worker, `opencv_js.wasm`, and `fetch()` of templates/SEF files all
fail on `file://`):

```bash
python3 -m http.server 8000   # then open http://localhost:8000/
```

**Regenerate SEF files after editing any `.xsl`** — Saxon-JS loads the compiled `.sef.json`, *not* the `.xsl`. Editing a
stylesheet without re-exporting has no effect at runtime. Both artefacts are committed.

```bash
npx xslt3 -t -xsl:xhtml-view/xsl/xhtml.xsl -export:xhtml-view/xsl/xhtml.sef.json -nogo -ns:##html5
npx xslt3 -t -xsl:xhtml-view/xsl/html-to-bho.xsl -export:xhtml-view/xsl/html-to-bho.sef.json -nogo -ns:##html5
npx xslt3 -t -xsl:xhtml-view/xsl/bho-html-to-xhtml.xsl -export:xhtml-view/xsl/bho-html-to-xhtml.sef.json -nogo -ns:##html5
```

**Batch "Save as BHO XML"** — the same two-stage transform the editor performs, run offline over
files or whole folders. Takes VCH XHTML (runs both stages) or saved BHO HTML (second stage only),
skips files that are already BHO XML, and uses the compiled SEFs so output matches the browser:

```bash
node scripts/xhtml-to-bho.js -o OUTDIR path/to/files ...
```

**Deploy**: pushing to `master` triggers `.github/workflows/build.yml`, which runs `node scripts/anti-cache.js`
(appends `?v=<timestamp>` to `css/*.css` and `js/*.js` references in `index.html`, in the CI checkout only) and
publishes the whole repo to Pages. Note the regex only covers top-level `css/` and `js/` paths — assets under
`xhtml-view/` are not cache-busted.

## Architecture

### Two module systems, one page

`index.html` loads vendored libraries and then **non-module globals** (`utilities-standalone.js`, `js/text.js`,
`js/pdf.js`) before the **ES module** entry point `js/editor/main-integrated.js`. The PDF pipeline files export nothing
and are called as globals (`storePageData`, `processItems`, `extractImagesFromPDF`, …); only `js/editor/*` uses
`import`/`export`. Adding a new PDF-stage file means adding a `<script>` tag in load order, not an import.
`utilities-adapter.js` is legacy and is not loaded by `index.html`.

### localStorage is the pipeline bus

Stages do not pass zone data in memory — each page's state round-trips through `localStorage` under `page-<n>-*` keys,
which is how large documents stay within browser memory limits:

- `page-N-zones` — the zone array, **LZString-compressed** (`compressToUTF16`); read/written by nearly every stage
- `page-N-viewport`, `page-N-cropRange`, `page-N-nullTexts`, `page-N-figure-numbers` — plain JSON
- `vch_editor_content` — the editor's debounced autosave (10 s), separate lifecycle

`clearPDFStorage()` in `main-integrated.js` wipes everything prefixed `page-`, and runs at both the start and end of an
extraction. When changing a stage, check whether it must re-compress before writing back.

### PDF → XHTML pipeline

Orchestrated by `extractPDFToXHTML()` in `js/editor/main-integrated.js`. Three passes over all pages:

1. **Pre-process** (`storePageData` in `js/pdf.js`) — detect the crop box from PDF operators (the viewport is not
   aligned to it), render the page to a canvas, mask embedded images and out-of-crop areas, post the ImageData to the
   segmenter worker, then merge/validate zones, identify footnote zones by font size, and drop micro-zones (renumbering
   `zone.order` to stay contiguous). Also accumulates the per-page font map.
2. **Font analysis + header tagging** — the highest-area font/size across the whole document becomes `defaultFont`;
   larger sizes become the ranked heading sizes; `headerFooterAndFonts()` tags zones per page.
3. **Build content** (`processItems` in `js/text.js`) — assign PDF text items to zones in reading order, reassemble
   paragraphs, de-hyphenate line ends, convert page footnotes to document-wide sequential endnotes, and emit flat HTML.
   Then `mergeTablesAcrossPages()` joins tables split across a page boundary, `convertToNestedSections()` builds the
   nested `<section>` tree, and `extractImagesFromPDF()` zips figures (choosing JPG vs PNG via `isPhotographic()`) and
   rewrites `.png` references in the XHTML to match.

`js/segmenter.js` runs entirely inside a Web Worker with OpenCV.js (`self.importScripts('library/opencv.js')` — paths
inside it are relative to `js/`). It does RLSA-based layout analysis, table cell/river detection, heading detection, and
reading-order sorting, returning `blocks` with a `type` of `BODY`, `HEADER`, `FOOTER`, `FOOTNOTE`, `HEADING`, `TABLE`,
`FIGURE`, `IMAGE`, or `UNKNOWN`. Zone geometry and ordering logic is deliberately duplicated on both sides of the worker
boundary (e.g. `sortBlocksByReadingOrder` in the worker vs `reassignReadingOrder` in `js/pdf.js`) — changing one usually
means changing the other.

**Visual debug mode** (`isDebugMode`, hardcoded `true` near the top of `main-integrated.js`) pauses after each page's
pre-processing and overlays colour-coded zone boxes on the rendered page, with Continue/Stop buttons. It is the primary
tool for diagnosing segmentation changes. There is also a "Visual Debug Mode" switch in the extraction modal footer.

### Intermediate format

`js/text.js` emits *flat* HTML in which headings are `<heading font-signature="...">` elements. `convert-to-sections.js`
maps each distinct font signature, in order of first appearance, to a nesting level and rebuilds the document as nested
`<section>`/`<header>`. Footnotes are inline `<data>` elements; page breaks are `<hr class="page-break"/>` with an
optional `data-start`. This is the same schema as `xhtml-view/template.xhtml`, which is what the editor loads on first
open.

### Transformation chain

Three separate stylesheets, all run through Saxon-JS from their `.sef.json`:

- `xhtml.xsl` — VCH XHTML → BHO-styled HTML for the preview iframe (`preview.js`). `preview.js` pre-numbers `<data>`
  footnotes and page breaks in the DOM before transforming purely for speed, then post-processes the output (strips the
  XML declaration and `xmlns`, unslashes void elements, injects `xhtml-view/css/xhtml.css`). A native XSLT 1.0 path is
  the fallback if Saxon-JS is unavailable.
- `html-to-bho.xsl` — XHTML → BHO legacy XML (`<report>`/`<section>`/`<para>`/`<note>`), XSLT 1.0.
- `bho-html-to-xhtml.xsl` — the reverse direction, for importing existing BHO HTML pages; `bho-html-transform.js`
  sniffs for BHO HTML and runs `html-cleaner.js` first to make it well-formed XML.

`xhtml-view/` also contains the standalone viewer assets (`xhtml.css`, `xhtml.js` — client-side footnote renumbering and
"In this section" nav) plus `template.xhtml` / `example.xhtml`, which double as the editor's starting documents.

## Gotchas

- Despite the offline-first framing in the README, two CDN dependencies remain: the PDF.js worker
  (`pdfjsLib.GlobalWorkerOptions.workerSrc`, pinned to cdnjs 2.7.570 in `main-integrated.js`) and CodeMirror 6, imported
  from `esm.sh` in `js/editor/editor.js`. The vendored `js/library/pdf.min.js` must stay version-compatible with that
  pinned worker.
- `prototype.html` is an unrelated PDFium-WASM spike, not part of the app.
- The `img*.png` files in the repo root are README screenshots.
- `.github/workflows/xhtml-view.yml.DEPRECATED` is retained deliberately — a second Pages deployment would conflict with
  `build.yml`.
