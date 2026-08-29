# BHO / VCH schema references

Where the authoritative material lives. The format itself is specified in
[the report XML specification](bho-report-xml-specification.md), and the DTDs
are reviewed — faults, divergence, redundancy — in
[the DTD review](bho-dtd-review.md).

---

## 1. The DTDs — normative, and public

Both are readable without a login, at the site root. The `SYSTEM`
identifier in a published file (`dtd/report.dtd`) resolves against the site
root, not against the directory holding the XML.

| File | URL |
|---|---|
| `report.dtd` | <https://www.british-history.ac.uk/dtd/report.dtd> |
| `index.dtd` | <https://www.british-history.ac.uk/dtd/index.dtd> |

`<report>` and `<index>` are **separate document types**. `entry`, `key`
and `sub` belong to `index.dtd` only.

Both pull in the ISO public entity sets and BHO's own additions, all in the
same directory (the directory itself is not listable, but each file
fetches):

`bhoa.ent` (BHO palaeographic expansions and extra fractions),
`isolat1.ent`, `isolat2.ent`, `isonum.ent`, `isopub.ent`, `isodia.ent`,
`isotech.ent`, `isobox.ent`, `isogrk1.ent`–`isogrk4.ent`,
`isoamsa.ent`, `isoamsb.ent`, `isoamsc.ent`, `isoamsn.ent`, `isoamso.ent`,
`isoamsr.ent`, `isocyr1.ent`, `isocyr2.ent`
— each at `https://www.british-history.ac.uk/dtd/<name>`.

### Validating against them

```bash
mkdir dtd && cd dtd
for f in report.dtd index.dtd bhoa.ent isoamsa.ent isoamsb.ent isoamsc.ent \
         isoamsn.ent isoamso.ent isoamsr.ent isobox.ent isocyr1.ent \
         isocyr2.ent isodia.ent isogrk1.ent isogrk2.ent isogrk3.ent \
         isogrk4.ent isolat1.ent isolat2.ent isonum.ent isopub.ent \
         isotech.ent; do
  curl -sSO "https://www.british-history.ac.uk/dtd/$f"
done
cd ..

xmllint --noout --dtdvalid dtd/report.dtd yourfile.xml
```

One tolerated exception: `figure/@visible` is honoured by BHO's stylesheet
but is not declared in the DTD, so files using it report a single
"No declaration for attribute visible" error and are otherwise valid.

## 2. A reference file that validates

Nettlebed, VCH Oxfordshire XVIII — a real published article, clean against
the DTD apart from the `@visible` exception above:

- XML: <https://www.british-history.ac.uk/sites/default/files/publications/pubid-1516/155040.xml>
- As published: <https://www.british-history.ac.uk/vch/oxon/vol18/pp275-302>

Reading the two side by side settles most questions of convention: nested
sections with exactly one `<head>` each, the title repeated as the
outermost head, an empty `<subtitle/>`, notes closing the outermost
section, `/images/fig75.jpg` becoming
`/sites/default/files/publications/pubid-1516/images/fig75.jpg`, and
footnote markers numbered from the note ids rather than from `@number`.

## 3. BHO's display stylesheet

The DTD says what is *accepted*; BHO's "Report 2" stylesheet says what is
*rendered*, and the two do not entirely agree. Our annotated copy:

- [SCHEMAS.md § BHO XSLT stylesheet example](https://github.com/docuracy/VCH-PDF2BHO/blob/master/SCHEMAS.md#bho-xslt-stylesheet-example)

## 4. Our own notes and converters

Repository: <https://github.com/docuracy/VCH-PDF2BHO>

**`SCHEMAS.md`** — working notes on both formats.
[rendered](https://github.com/docuracy/VCH-PDF2BHO/blob/master/SCHEMAS.md)
· [raw](https://raw.githubusercontent.com/docuracy/VCH-PDF2BHO/refs/heads/master/SCHEMAS.md)

| Section | Link |
|---|---|
| BHO XML schema, with a minimal document | [#bho-xml-schema](https://github.com/docuracy/VCH-PDF2BHO/blob/master/SCHEMAS.md#bho-xml-schema) |
| BHO's "Report 2" stylesheet, cleaned up and commented | [#bho-xslt-stylesheet-example](https://github.com/docuracy/VCH-PDF2BHO/blob/master/SCHEMAS.md#bho-xslt-stylesheet-example) |
| The VCH XHTML intermediate format | [#vch-xhtml-schema](https://github.com/docuracy/VCH-PDF2BHO/blob/master/SCHEMAS.md#vch-xhtml-schema) |
| Converting VCH XHTML to BHO's display HTML | [#vch-xhtml-to-bho-xml-xslt-stylesheet](https://github.com/docuracy/VCH-PDF2BHO/blob/master/SCHEMAS.md#vch-xhtml-to-bho-xml-xslt-stylesheet) |

**The three stylesheets.** Each is committed twice — the `.xsl` source and
a compiled `.sef.json`; the app loads the `.sef.json`, so read the source.

| Stylesheet | Direction | Link |
|---|---|---|
| `html-to-bho.xsl` | VCH XHTML → **BHO legacy XML** | [source](https://github.com/docuracy/VCH-PDF2BHO/blob/master/xhtml-view/xsl/html-to-bho.xsl) · [raw](https://raw.githubusercontent.com/docuracy/VCH-PDF2BHO/refs/heads/master/xhtml-view/xsl/html-to-bho.xsl) |
| `xhtml.xsl` | VCH XHTML → BHO-styled HTML (editor preview) | [source](https://github.com/docuracy/VCH-PDF2BHO/blob/master/xhtml-view/xsl/xhtml.xsl) · [raw](https://raw.githubusercontent.com/docuracy/VCH-PDF2BHO/refs/heads/master/xhtml-view/xsl/xhtml.xsl) |
| `bho-html-to-xhtml.xsl` | Existing BHO HTML → VCH XHTML (import) | [source](https://github.com/docuracy/VCH-PDF2BHO/blob/master/xhtml-view/xsl/bho-html-to-xhtml.xsl) · [raw](https://raw.githubusercontent.com/docuracy/VCH-PDF2BHO/refs/heads/master/xhtml-view/xsl/bho-html-to-xhtml.xsl) |

`html-to-bho.xsl` is the one that matters for the XML. Its comments record
why each decision was taken, usually naming the volume that exposed the
problem.

The same transform runs offline over files or whole folders, using the
compiled stylesheets so the output matches the browser:

```bash
node scripts/xhtml-to-bho.js -o OUTDIR path/to/files ...
```

[`scripts/xhtml-to-bho.js`](https://github.com/docuracy/VCH-PDF2BHO/blob/master/scripts/xhtml-to-bho.js)

## 5. The VCH XHTML intermediate format

What the editor holds and the human corrects, before either transform runs.
Defined by example rather than by schema:

| File | What it is | Link |
|---|---|---|
| `template.xhtml` | Empty starting document — the format in skeleton | [source](https://github.com/docuracy/VCH-PDF2BHO/blob/master/xhtml-view/template.xhtml) · [raw](https://raw.githubusercontent.com/docuracy/VCH-PDF2BHO/refs/heads/master/xhtml-view/template.xhtml) |
| `example.xhtml` | Worked example with figures, tables and footnotes | [source](https://github.com/docuracy/VCH-PDF2BHO/blob/master/xhtml-view/example.xhtml) · [raw](https://raw.githubusercontent.com/docuracy/VCH-PDF2BHO/refs/heads/master/xhtml-view/example.xhtml) |

In outline: an `<article>` with a `<header id="title">` holding an `<h1>`,
an optional `<p id="subtitle">`, nested `<section>` elements headed by
`h2`–`h6`, `<hr class="page-break">` markers, `<figure>` with
`<figcaption>`, ordinary HTML tables, inline `<data>` footnotes, and a
`<footer>` carrying the collected footnote list.

## 6. Background

- Project README: <https://github.com/docuracy/VCH-PDF2BHO/blob/master/README.md>
- The live tool: <https://docuracy.github.io/VCH-PDF2BHO/>
