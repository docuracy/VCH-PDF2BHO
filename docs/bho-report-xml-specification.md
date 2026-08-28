# "Report" XML Format — Specification

**Status:** Grounded in BHO's own DTD, which is publicly readable at
<https://www.british-history.ac.uk/dtd/report.dtd>. Every content model
quoted below is copied from it verbatim.

**Companion:** [BHO / VCH schema references](bho-schema-references.md) —
where the DTDs, the display stylesheet, the converters and a validating
reference file live.

**Scope:** The XML format used to represent digitized reference-work
content (Victoria County History and comparable series) for ingestion into
British History Online. This describes the format itself — elements,
attributes, structure and conventions — independent of any tool used to
produce it.

---

## 0. Sources, and how to read this

BHO publishes no prose specification of the format, and for a long time
none of us could find the DTD either, so what documentation existed was
inferred from sample files. It need not be. Four sources settle almost
every question, in this order of authority:

1. **`report.dtd`** — <https://www.british-history.ac.uk/dtd/report.dtd>
   (7,654 bytes). The normative grammar. The `SYSTEM` identifier in a
   published file, `dtd/report.dtd`, resolves against the site root rather
   than against the directory holding the XML, which is why it is easy to
   miss.
2. **`index.dtd`** — <https://www.british-history.ac.uk/dtd/index.dtd>.
   A second, separate document type, for volume indexes.
3. **BHO's display stylesheet** ("Report 2"), which turns this XML into the
   published page. It decides what is *rendered*; the DTD decides what is
   *accepted*. The two do not entirely agree, and both matter — a document
   can be perfectly valid and still render as something you did not intend.
4. **Published files**, e.g. Nettlebed, VCH Oxfordshire XVIII
   (`/sites/default/files/publications/pubid-1516/155040.xml`, rendered at
   `/vch/oxon/vol18/pp275-302`). This validates cleanly against the DTD and
   is the model followed throughout.

### Twelve things that are easy to get wrong

Each of these is a plausible reading of the sample files that the DTD or
the live site contradicts. They are collected here because every one of
them has been made in earnest, in more than one converter.

| # | The plausible assumption | What is actually the case | Consequence |
|---|---|---|---|
| 1 | `title` and `subtitle` are optional | **Both are mandatory**, in that order | A file with no `<subtitle/>` is invalid |
| 2 | Sections are a flat sequence | **Sections nest**, and nesting sets heading level | Flat files render every heading as `h2` and lose the hierarchy |
| 3 | A section may have 0, 1 or more `head` | **Exactly one `head`, first** | Headless and two-head sections are invalid |
| 4 | `<li>` sits inside `<para>` | `<li>` sits inside **`<list>`**, which needs its own `<head>` | `<li>` in `<para>` is invalid and renders unbulleted |
| 5 | `<table>` contains `<tbody>` | **There is no `tbody`** — `table` holds `tr` directly | Invalid, and it breaks BHO's per-cell anchors |
| 6 | `tr` ids may restart at `tr1` per table | `tr/@id` is **`ID`** — unique document-wide, and optional | Restarting produces duplicate IDs: invalid |
| 7 | `figure/@alt` carries the alt text | **`@alt` is not declared**; `@number` is required | `@alt` is invalid, and BHO never reads it |
| 8 | `emph` is `i` or `b` | **`(b\|i\|p\|d\|c\|k\|u)`**, required | Anything else is invalid |
| 9 | Notes go in a trailing footnote-only section | Notes may appear in **any** section; published files put them at the end of the outermost section | A notes-only section still needs a `head` |
| 10 | The visible footnote number comes from `@number` or the `ref` text | **Both are ignored by the renderer**; it prints the number in the *id* | See §8 |
| 11 | `<title>` can be omitted, since it is not rendered | It is mandatory — and the title must *also* appear as the outermost `<head>` | Otherwise the article publishes with no visible title |
| 12 | `@graphic` may hold the full image path | It must be exactly `/images/<file>` | BHO takes `substring(@graphic, 9)` and re-prefixes it; anything longer doubles the path |

---

## 1. Overview

A single XML file (a **report**) represents one article or chapter. It
carries a title, a subtitle, and a tree of **sections**. Each section has a
heading and holds a mix of paragraphs, lists, figures, tables, quotations,
page markers, footnotes and further sections, in the order they occur in
the source.

The format has no whitespace significance: structure is expressed entirely
through elements.

## 2. Two document types

| Root | DTD | Used for |
|---|---|---|
| `<report>` | `report.dtd` | Articles, chapters, front matter — everything narrative |
| `<index>` | `index.dtd` | Volume indexes (`entry`, `key`, `sub`) |

These are **separate grammars**. `entry`, `key` and `sub` do not exist in
`report.dtd`; putting index entries inside a `<report>` produces an invalid
document. Indexes are covered in Appendix A.

## 3. File prolog

```xml
<?xml version="1.0" encoding="iso-8859-1" standalone="no"?>
<!DOCTYPE report SYSTEM "dtd/report.dtd">
```

The system identifier resolves **site-root-relative** on BHO
(`https://www.british-history.ac.uk/dtd/report.dtd`), not relative to the
directory the XML sits in — published files use `dtd/report.dtd` and the
XML itself lives in `/sites/default/files/publications/pubid-NNN/`.

`encoding` may be any encoding that correctly describes the bytes. Declare
what you actually wrote: if the file is UTF-8, say `utf-8`. Declaring
`iso-8859-1` over UTF-8 bytes turns every accented character into mojibake
in a conforming parser.

## 4. Document structure at a glance

```
report                      (title, subtitle, page*, section*, geodata?)
├── title                   REQUIRED, exactly one
├── subtitle                REQUIRED, exactly one (may be empty: <subtitle/>)
├── page*                   only here, before the first section
└── section+                nested; depth sets heading level
    ├── head                REQUIRED, exactly one, first
    └── ( para | list | table | note | figure | plate | quote
         | section | fig | name | page | ... )*      in document order
```

Nesting is the whole of the hierarchy. BHO renders
`report/section/head` as `h2`, `section/section/head` as `h3`,
`section/section/section/head` as `h4` and one level further as `h5`.
Deeper than that there is no template and the heading text is emitted
bare. The "In this section" navigation is built from the first two levels
only.

## 5. Element reference

Content models are quoted from `report.dtd`.

### 5.1 `<report>`

```
<!ELEMENT report (title, subtitle, (page*,section*,geodata?))>
<!ATTLIST report id CDATA #REQUIRED
                 pubid CDATA #REQUIRED
                 publish CDATA #IMPLIED>
```

`@id` is the document identifier, `@pubid` the publication identifier.
`@publish` is `true` or `false`.

### 5.2 `<title>` and `<subtitle>`

```
<!ELEMENT title (#PCDATA|emph|ref)*>
<!ELEMENT subtitle (#PCDATA|emph|ref)*>
```

Both are **required**, in that order. An article with no subtitle is
written `<subtitle/>` — that is what published files do.

BHO's stylesheet suppresses both. The title is therefore repeated as the
`<head>` of the outermost section:

```xml
<title>References</title>
<subtitle/>
<section id="s1">
  <head>References</head>
```

Repeat it as the outermost section's single head — not as a second `head`
in the first section, which the DTD forbids.

### 5.3 `<section>`

```
<!ELEMENT section (head,(para|list|table|note|figure|plate|quote|section
                        |fig|name|business|dataset|catalogue|mapset|page)*)>
<!ATTLIST section id CDATA #REQUIRED
                  title CDATA #IMPLIED
                  type CDATA #IMPLIED>
```

Exactly one `head`, and it must come first. Everything else follows in
document order, sections included — a section's sub-sections are its
children, not its siblings.

`@id` is `CDATA`, not `ID`: it need only be unique in practice, because
BHO builds heading anchors (`h2-{@id}`) and navigation links from it.
`s1`, `s2`, ... is the usual scheme; hierarchical forms (`s2-1-3`) and
suffixed forms (`s7notes`) are equally legal.

### 5.4 `<head>`

```
<!ELEMENT head (#PCDATA|ref|emph|plt|a)*>
```

The section's heading. May carry a footnote reference.

### 5.5 `<para>`

```
<!ELEMENT para (#PCDATA|ref|emph|person|glink|plt|br|page|mdr|a)*>
<!ATTLIST para id CDATA #REQUIRED>
```

`@id` is conventionally `p` + an integer, sequential across the whole
document. **`<li>` is not permitted here** — see `<list>`.

`<br/>` is legal inside a paragraph but BHO's stylesheet has no template
for it, so it produces no visible break. Where the source has hard line
breaks that must survive (donor lists, source lists), emit one `<para>`
per line, as the published volumes do.

### 5.6 `<list>` and `<li>`

```
<!ELEMENT list (head,(li|page)+)>
<!ATTLIST list id CDATA #REQUIRED>
<!ELEMENT li (#PCDATA|page|ref|emph|br)*>
```

A list has a **required `<head>`** and a **required `@id`**; BHO renders
the head as a bold paragraph carrying the list's anchor, and the list
itself as a `<ul>`. `<li>` takes no attributes and is not individually
numbered.

Leading marker characters from the source (`-`, `1.`, an em or en dash)
are preserved as literal text where they carry meaning — in VCH material
these are frequently ditto marks standing for "as the entry above".

### 5.7 Inline elements

```
<!ELEMENT emph (#PCDATA|emph|ref|page|br|mdr)*>
<!ATTLIST emph type (b|i|p|d|c|k|u) #REQUIRED>
<!ELEMENT ref (#PCDATA)>
<!ATTLIST ref idref IDREF #IMPLIED>
<!ATTLIST ref type (footnote|reference|addenda) "footnote">
<!ELEMENT a (#PCDATA)>
<!ATTLIST a href CDATA #REQUIRED>
```

| `emph/@type` | Renders as |
|---|---|
| `i` | italic |
| `b` | bold |
| `p` | small superscript |
| `d` | small |
| `k` | strikethrough |
| `u` | underline |
| `c` | declared, but no template — renders as plain text |

There is no subscript. `emph` nests.

`<ref>` is the in-text footnote marker. `@idref` is a true `IDREF`: it
must match the `@id` of a `<note>` in the same document. The element's
text content is conventionally the number printed in the source, but the
renderer discards it — see §8. The same `@idref` may be cited from more
than one place; only one `<note>` exists for it.

### 5.8 `<figure>` (and `<plate>`)

```
<!ELEMENT figure (title|caption)*>
<!ATTLIST figure id ID #REQUIRED
                 number CDATA #REQUIRED
                 graphic CDATA #REQUIRED>
```

- `@id` is a true `ID` — unique across the document. Published volumes use
  `fig` plus the figure's own printed number (`fig75`), unpadded.
- `@number` is **required**. For an unnumbered figure write `number=""`:
  the stylesheet tests for the empty string and omits the "Figure N:"
  label.
- `@graphic` must be `/images/<filename>` exactly. BHO strips the first
  eight characters and rebuilds the URL as
  `/sites/default/files/publications/pubid-<pubid>/images/<filename>`.
  Anything longer produces a doubled, broken path.
- **`@alt` is not declared** and is never read by the stylesheet.
- `@visible="false"` is used by the stylesheet (it substitutes a
  "restricted" placeholder image) but is likewise undeclared, so it is a
  tolerated extension rather than part of the grammar.

Content is `<title>` and/or `<caption>`, both optional and repeatable.
`<title>` renders bold (`p.fig-title`), `<caption>` plain
(`p.fig-caption`). Published VCH volumes use `<title>`. A figure with
neither is written `<figure ... />`.

`<plate>` has the identical shape and is English Heritage only.

### 5.9 `<caption>` and figure `<title>`

```
<!ELEMENT caption (#PCDATA|ref|emph|br)*>
<!ELEMENT title (#PCDATA|emph|ref)*>
```

Since BHO generates the "Figure N:" label itself from `@number`, the
caption text should not repeat it.

### 5.10 Tables

```
<!ELEMENT table (head?,(tr|page)+)>
<!ATTLIST table id CDATA #REQUIRED
                caption CDATA #IMPLIED
                number CDATA #IMPLIED>
<!ELEMENT tr (th|td)*>
<!ATTLIST tr id ID #IMPLIED>
<!ELEMENT th (#PCDATA|ref|emph|br|plt)*>
<!ELEMENT td (#PCDATA|ref|emph|br|plt|page|mdr|list)*>
<!ATTLIST th cols CDATA #IMPLIED rows CDATA #IMPLIED>
<!ATTLIST td cols CDATA #IMPLIED rows CDATA #IMPLIED>
```

- **No `<tbody>`, no `<thead>`.** Rows are direct children of `<table>`.
  BHO's per-cell anchor is built from the id two levels above the cell, so
  an intervening `tbody` breaks every anchor in the table.
- `<th>` exists and should be used for header rows.
- Column and row spans are `@cols` and `@rows` (not `colspan`/`rowspan`).
- `tr/@id` is **`ID`**: optional, but unique document-wide if present.
- The table caption is the optional `<head>` child; BHO renders it inside
  `<caption>` together with "Table {@number}". The `@caption` attribute is
  declared but the stylesheet ignores it.
- `<page>` may appear between rows. Text must not sit loose inside
  `<table>` or `<tr>` — every scrap belongs in a cell.

### 5.11 `<page>`

```
<!ELEMENT page EMPTY>
<!ATTLIST page start CDATA #REQUIRED>
<!ATTLIST page pubid CDATA #IMPLIED>
```

Marks where a new page of the source begins: it precedes the content that
begins on page `@start`. At report level it may appear only *before* the
first section; elsewhere it may sit inside a section, paragraph, cell,
list item, quotation line or note. `@pubid` qualifies a page reference
belonging to another publication.

One quirk to be aware of: outside a table row the stylesheet wraps the
marker in a `<tr class="page-row">`, which is not valid outside a table,
so page markers between paragraphs may not display as intended. Inside a
row it produces a `div.page-number`. This looks like an inversion in the
stylesheet; it is BHO's to fix, not ours to work around.

### 5.12 `<note>`

```
<!ELEMENT note (#PCDATA|ref|emph|br|plt|figure|table|para|page)*>
<!ATTLIST note id ID #REQUIRED
               number CDATA #REQUIRED
               type (footnote|reference|addenda) "footnote">
```

`@id` is a true `ID`, conventionally `n` + an integer in order of first
reference. `@number` is required but is not what gets printed (§8).

Notes are legal in **any** section. Published VCH files place them all
together at the end of the outermost section, after its sub-sections —
which satisfies the "exactly one head" rule without inventing a heading. A
separate notes-only section is also legal, but it needs a `<head>`, and
that head will appear as a visible heading and in the navigation.

BHO renders a note's content from text, `table` and `emph` only. A `<ref>`
or an `<a>` inside a note is silently dropped.

### 5.13 Quotations

```
<!ELEMENT quote (quotext|quosource)*>
<!ATTLIST quote id ID #REQUIRED>
<!ELEMENT quotext (quoline)*>
<!ELEMENT quoline (#PCDATA|ref|emph|page)*>
<!ELEMENT quosource (#PCDATA|ref|emph)*>
```

Renders as a `<blockquote>`, one `<p>` per `quotext`, a `<br/>` per
`quoline`, and `quosource` as a `<cite>` in the footer.

### 5.14 Other declared elements

| Element | Purpose |
|---|---|
| `fig` (`@idref`) | In-text cross-reference to a `figure` |
| `br` | Line break (no rendering template) |
| `person`, `glink` | Person and glossary links |
| `mdr` (`@id`) | Modern document reference (CSP) |
| `plt` (`@target`) | English Heritage plate link |
| `name`, `nhead`, `nkey`, `nsub`, `place` | The "London Inhabitants" name-index form |
| `business`, `dataset`, `catalogue`, `mapset`, `geodata` | Specialist structures — see Appendix C |

## 6. Attribute summary

| Element | Attribute | DTD type | Required | Example |
|---|---|---|---|---|
| `report` | `id` | CDATA | yes | `155040` |
| `report` | `pubid` | CDATA | yes | `1516` |
| `report` | `publish` | CDATA | no | `true` |
| `section` | `id` | CDATA | yes | `s1` |
| `section` | `title`, `type` | CDATA | no | |
| `para` | `id` | CDATA | yes | `p12` |
| `list` | `id` | CDATA | yes | `l1` |
| `emph` | `type` | enum `b i p d c k u` | yes | `i` |
| `ref` | `idref` | IDREF | no | `n478` |
| `ref` | `type` | enum | no (default `footnote`) | |
| `figure`/`plate` | `id` | **ID** | yes | `fig75` |
| `figure`/`plate` | `number` | CDATA | yes | `75` |
| `figure`/`plate` | `graphic` | CDATA | yes | `/images/fig75.jpg` |
| `table` | `id` | CDATA | yes | `t1` |
| `table` | `caption`, `number` | CDATA | no | |
| `tr` | `id` | **ID** | no | `tr1` |
| `th`, `td` | `cols`, `rows` | CDATA | no | `2` |
| `note` | `id` | **ID** | yes | `n478` |
| `note` | `number` | CDATA | yes | `13` |
| `note` | `type` | enum | no (default `footnote`) | |
| `page` | `start` | CDATA | yes | `276` |
| `page` | `pubid` | CDATA | no | |
| `quote` | `id` | **ID** | yes | `q1` |
| `a` | `href` | CDATA | yes | |

`ID`-typed attributes must be unique across the whole document, and every
`IDREF` must match one. These are the constraints that a validating parser
will actually enforce.

## 7. Numbering conventions

| Counter | Scope | Notes |
|---|---|---|
| `section/@id` | document | Any unique scheme; sequential `sN` is usual |
| `para/@id` | document | Sequential, not reset per section. A list occupies one `list`, not one `para` |
| `figure/@id`, `@number` | document | The figure's own printed number; padding is optional |
| `table/@id` | document | Sequential `tN` |
| `tr/@id` | **document** | Must be unique if used — never restart per table |
| `note/@id` | document | Sequential in order of first reference; one note per footnote however often cited |
| `note/@number` | — | The number printed in the source. Required, but not displayed |

## 8. What the renderer derives, and what it ignores

Verified against Nettlebed (`155040.xml`) as published at
`/vch/oxon/vol18/pp275-302`:

- The in-text marker is **`(fn. N)` where N comes from `substring(@idref, 2)`**
  — the note's id, not its `@number` and not the `<ref>` element's text. In
  that file, `<ref idref="n478">13</ref>` pointing at
  `<note id="n478" number="13">` renders as "(fn. 478)".
- The number in the footnote list is likewise `substring(@id, 2)`.
- So footnote numbering as the reader sees it is entirely determined by the
  id sequence. `@number` and the `ref` text are documentation of the
  printed source, nothing more. Plan the id sequence accordingly: it cannot
  restart per page or per chapter and it cannot begin at anything but 1
  without the displayed numbers following suit.
- Image URLs are rebuilt from `@graphic` and `@pubid` (§5.8).
- `<title>` and `<subtitle>` are not rendered at all.

## 9. Character encoding and entities

The DTD declares the full set of ISO public entity sets — `isolat1`,
`isolat2`, `isonum`, `isogrk1`–`4`, `isoamsa`–`r`, `isobox`, `isocyr1`–`2`,
`isodia`, `isopub`, `isotech` — plus BHO's own `bhoa.ent`, which carries
palaeographic expansions (`&bholngs;` for long s, `&bhopcrl;` for p with
curl, and so on) and additional fractions. So `&ndash;`, `&eacute;` and
`&frac17;` are all legal and are used in published files.

Writing every non-ASCII character as a numeric character reference
(`&#x2014;`) is equally valid and is a reasonable house rule — it keeps the
bytes plain ASCII whatever the declaration says. It is a choice, not a
requirement.

The standard XML entities `&amp;`, `&lt;` and `&gt;` are used for those
characters; attribute values additionally escape `"` as `&quot;`. Control
characters other than tab, LF and CR are not permitted anywhere.

## 10. Validating a file

Fetch the DTD and its entity sets once, then validate offline:

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

Expect one tolerated exception: `figure/@visible` is used by BHO but not
declared, so files that carry it report "No declaration for attribute
visible of element figure" and are otherwise valid.

## 11. Complete example

```xml
<?xml version="1.0" encoding="utf-8" standalone="no"?>
<!DOCTYPE report SYSTEM "dtd/report.dtd">
<report id="15915" pubid="55" publish="true">
  <title>Bampton and Weald</title>
  <subtitle/>
  <page start="27"/>
  <section id="s1">
    <head>Bampton and Weald</head>
    <para id="p1">Until the late Anglo-Saxon period the royal manor of
      <emph type="i">BAMPTON</emph> included all the ancient parish and
      much land outside it.<ref idref="n1">39</ref></para>
    <section id="s2">
      <head>MANORS AND CASTLE</head>
      <page start="28"/>
      <list id="l1">
        <head>Lords of the manor</head>
        <li>John Smith (d. 1600)</li>
        <li>&#x2014; Mary Jones</li>
      </list>
      <figure id="fig01" number="1" graphic="/images/015_fig01.jpg">
        <title>Scale <emph type="i">c</emph>. 1900.</title>
      </figure>
      <table id="t1">
        <head>Tenants in 1156</head>
        <tr id="tr1"><th>Name</th><th>Date</th></tr>
        <tr id="tr2"><td>Thierry</td><td>1156</td></tr>
      </table>
    </section>
    <note id="n1" number="39">Above, intro.</note>
  </section>
</report>
```

Note the shape: one head per section, sections nested, the title repeated
as the outermost head, an empty subtitle, the notes closing the outermost
section, no `tbody`, and `<list>` rather than `<li>` in a paragraph.

---

## Appendix A — Index documents (`index.dtd`)

Volume indexes are a **separate document type**, root `<index>`:

```
<!ELEMENT index (title, subtitle, (intro|section|entry|page|note|figure)*)>
<!ELEMENT section (head,(para|section|entry|page|note|figure)*)>
<!ELEMENT entry (head|sub|page|table)*>
<!ELEMENT head (#PCDATA|key|emph|addenda|ref|page|plt)*>
<!ELEMENT key (#PCDATA|emph|addenda|ref)*>
<!ELEMENT sub (#PCDATA|emph|sub|page|addenda|ref|plt)*>
<!ATTLIST emph type (b|i|p|c|d) #REQUIRED>
```

Points of difference from `report.dtd`:

- `entry`, `key` and `sub` exist **only here**. An index inside a
  `<report>` is invalid however well it renders.
- `<sub>` nests, for sub-sub-entries ("his w. Mary, 122"). BHO prefixes one
  level with `-,` and two with `-,-,`.
- `<addenda>` was added for the Survey of London; `entry/@type="addenda"`
  and `ref/@type="addenda"` go with it.
- `emph` here allows only `b i p c d` — no `k`, no `u`.
- `intro` holds the prefatory note.
- BHO renders `/index/section/head` as `h1` and the next level as `h2`,
  a level higher than in a report.

## Appendix B — Conventions that are not part of the format

Practices that a converter may reasonably adopt, and that turn up in
files, but that the format itself does not require. They are recorded
here so that they are not mistaken for rules — and so that nobody
reverse-engineering a specification from a batch of files writes them
down as such.

**Page numbers.** Where the source is OCR of a printed page whose number
appears as a running foot, the marker read from the page belongs to the
page just *ended*, so `<page start="N"/>` takes the source number plus one.
This holds only for sources numbered that way; a source that records the
number of the page beginning needs no adjustment.

**Figure ids.** Zero-padding to two digits (`fig01`) is a house style.
Published volumes use the figure's own printed number, unpadded (`fig75`).
Either is valid, provided `@id` is unique and `@number` is present.

**Figure filenames.** `/images/[chapter]_[figure id].jpg`, where
`[chapter]` is a three-digit run delimited by underscores in the source
filename, is one such naming scheme. The format requires only that
`@graphic` begins `/images/` and that a file of that name exists in the
publication's image directory.

**CSV manifest.** A sidecar CSV (`Chapter, FigID, FigNumber, OldFilename,
NewFilename`) mapping original image filenames to their new names is a
useful asset-tracking artefact for a renaming batch. It is not part of the
format and BHO does not consume it.

## Appendix C — Declared but specialist

`report.dtd` also declares structures used by particular publications, none
of which is needed for ordinary narrative content:

- `business` (house, street, ward, occupier, trade, staff) — deprecated
  business directory.
- `geodata` (geoclass, geolocation, geoitem) — first-generation dataset
  and mapping structure.
- `dataset` (dsclass, dsrecord, prop) — second-generation dataset tables.
  BHO's stylesheet renders these differently per `pubid`.
- `catalogue` (group, item) — catalogue hierarchies.
- `mapset` (mapsheet, tile, eastings and northings, poi) — Ordnance Survey
  map sets.
