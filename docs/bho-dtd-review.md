# BHO's DTDs: faults, divergence, and how they could be repaired

A review of the two grammars BHO validates against —
[`report.dtd`](https://www.british-history.ac.uk/dtd/report.dtd) and
[`index.dtd`](https://www.british-history.ac.uk/dtd/index.dtd) — with repairs that would
make them agree with each other, with BHO's own display stylesheet, and with the files
BHO already publishes.

**Nothing proposed here changes a single published page.** These are changes to the
grammar, not to the markup: no element or attribute is renamed, no content is
restructured, and every document that is valid today remains valid, except where a
change is explicitly marked as tightening.

Copies of both DTDs are vendored, unmodified, in [`dtd/`](../dtd/). See
[the format specification](bho-report-xml-specification.md) for what the grammar
actually requires, and [the reference list](bho-schema-references.md) for where
everything lives.

## How the recommendations are graded

| Grade | Meaning |
|---|---|
| **A — refactor** | The set of valid documents is unchanged. Pure tidying. |
| **B — accepts more** | Files BHO already publishes stop being rejected. Nothing that validates today stops validating. |
| **C — accepts less** | Catches real errors, but would reject some existing files. Needs a pass over the corpus first. |

---

## 1. Faults

### 1.1 `figure/@visible` is used but never declared — **B**

BHO's own stylesheet branches on `figure[@visible='false']` and substitutes a
"restricted" placeholder image. The attribute appears in published files. It is
declared nowhere, so those files are invalid against the DTD that ships with them —
this is the one error that has to be discounted when validating anything BHO has
published.

```
<!ATTLIST figure visible (true|false) "true">
<!ATTLIST plate  visible (true|false) "true">
```

### 1.2 `geoitem/@place` is an IDREF with nothing to point at — **B**

`place/@id` is `CDATA`, so it can never satisfy an `IDREF`. The only element in the
neighbourhood declaring an `ID` is `geolocation`. Either the attribute means
`geolocation` and should be named for it, or `place/@id` should be `ID`:

```
<!ATTLIST place id ID #REQUIRED>
```

As it stands, any document exercising this part of the grammar is unvalidatable.

### 1.3 `list` requires a `head` that HTML cannot supply — **B**

```
<!ELEMENT list (head,(li|page)+)>
```

A list converted from HTML has no heading to give. The only way to satisfy the
grammar is an empty `<head/>`, which BHO renders as an empty bold paragraph carrying
the list's anchor. Making it optional costs nothing and removes the empty element:

```
<!ELEMENT list (head?,(li|page)+)>
```

### 1.4 `quote` and `figure` allow orders and repetitions the stylesheet cannot render — **C**

```
<!ELEMENT quote  (quotext|quosource)*>     <!-- any number of each, in any order -->
<!ELEMENT figure (title|caption)*>          <!-- likewise -->
```

The stylesheet renders one `quosource` as a `<cite>` in the blockquote footer, and one
`title` and/or `caption` per figure. Documents with two of either are accepted and then
silently mis-rendered. Tighter, and matching what is actually published:

```
<!ELEMENT quote  (quotext*, quosource?)>
<!ELEMENT figure (title?, caption?)>
<!ELEMENT plate  (title?, caption?)>
```

### 1.5 Identifier typing is inconsistent — **C**

| Declared `ID` (unique, enforced) | Declared `CDATA` (collisions pass silently) |
|---|---|
| `note`, `figure`, `plate`, `tr`, `quote`, `group`, `geoclass`, `geolocation`, `geoitem`, `range`, `dsclass`, `dsrecord` | `section`, `para`, `table`, `list`, `place` |

BHO builds page anchors from all of them — `h2-{section/@id}`, `p{para/@id}`,
`mt{table/@id}` — so a duplicate in the second column produces colliding anchors and
broken navigation with no error anywhere. Declaring them `ID` would catch that at
validation time.

This is graded C for a reason: it is exactly the check that would have caught 259 table
rows sharing 41 ids in one of our own deliveries, and it will reject existing files
until they are fixed.

### 1.6 A dead declaration — **A**

Both files carry a commented-out enumeration immediately below the live one:

```
         publish CDATA #IMPLIED>
<!--         publish (false|true) "true"> -->
```

Either adopt the enumeration (grade C — it would reject any other value) or delete the
comment. Leaving it invites the reader to think the enumeration applies.

---

## 2. The two DTDs disagree with each other

Nine elements are declared identically in both files. Eight more are declared in both
with **different content models** — same name, same purpose, different rules:

| Element | `report.dtd` | `index.dtd` | Effect of the difference |
|---|---|---|---|
| `subtitle` | `(#PCDATA\|emph\|ref)*` | `(#PCDATA)` | An index subtitle cannot be italicised or carry a footnote |
| `para` | `(#PCDATA\|ref\|emph\|person\|glink\|plt\|br\|page\|mdr\|a)*` | `(#PCDATA\|emph\|br)*` | **An index paragraph cannot contain `ref`** — no footnote markers, although `index.dtd` declares both `ref` and `note` |
| `emph` | `(#PCDATA\|emph\|ref\|page\|br\|mdr)*` | `(#PCDATA\|emph)*` | A footnote marker cannot sit inside italics in an index |
| `emph/@type` | `(b\|i\|p\|d\|c\|k\|u)` | `(b\|i\|p\|c\|d)` | No strikethrough or underline in an index |
| `note` | adds `plt`, `figure`, `para`, `page` | `(#PCDATA\|ref\|emph\|br\|table)*` | Index notes are more limited |
| `head` | `(#PCDATA\|ref\|emph\|plt\|a)*` | adds `key`, `addenda`, `page` | Divergent by design, but the overlap is untracked |
| `td` | adds `plt`, `mdr`, `list` | `(#PCDATA\|ref\|emph\|br\|page)*` | A table copied from a report into an index may stop validating |
| `th` | adds `plt` | `(#PCDATA\|ref\|emph\|br)*` | As above |

The `para` case is the sharpest: an index that cites a footnote in a paragraph cannot be
valid, though the grammar plainly intends footnotes to exist there.

None of these differences appears deliberate. `index.dtd` records the cause in its own
comment — `<!-- table copied in from report June 5th, 2006 -->` — copied, and then the
two drifted.

---

## 3. Redundancy

- **The 20 entity-set inclusions are duplicated verbatim** in both files: `isolat1`,
  `isolat2`, `isonum`, `isogrk1`–`4`, `isoamsa`–`r`, `isobox`, `isocyr1`–`2`, `isodia`,
  `isopub`, `isotech`, and BHO's own `bhoa.ent`. Forty lines maintained in two places.
- **Nine element declarations are byte-for-byte identical** across the two files: `br`,
  `caption`, `figure`, `page`, `plt`, `ref`, `table`, `title`, `tr`.
- **`plate` is a clone of `figure`** — same content model, same three attributes.
- **One element, many `ATTLIST` declarations**: `dsclass` has six, `geolocation` four,
  `geoitem`, `range` and `dsrecord` three each, `ref`, `page`, `geoclass` and `poi` two.
  Legal, but an attribute list has to be assembled by reading the whole file.

## 4. A shape that would fix all three

Split the shared material into one module and let each document type parameterise it.
The first declaration of a parameter entity wins, so each DTD sets its own inline model
*before* including the common file:

**`bho-entities.ent`** — the twenty inclusions, once.

**`bho-common.dtd`** — shared declarations, written against parameter entities:

```
<!ENTITY % inline    "#PCDATA|ref|emph|br">
<!ENTITY % emphtypes "(b|i|p|d|c|k|u)">

<!ELEMENT emph (%inline;|page|mdr)*>
<!ATTLIST emph type %emphtypes; #REQUIRED>

<!ELEMENT figure (title?, caption?)>
<!ATTLIST figure id ID       #REQUIRED
                 number CDATA #REQUIRED
                 graphic CDATA #REQUIRED
                 visible (true|false) "true">
<!ENTITY % plate-decl "<!ELEMENT plate (title?, caption?)>">
...
<!ENTITY % ent-sets SYSTEM "bho-entities.ent">
%ent-sets;
```

**`report.dtd`** and **`index.dtd`** then reduce to their genuine differences:

```
<!ENTITY % inline "#PCDATA|ref|emph|br|plt|mdr|a">   <!-- report -->
<!ENTITY % common SYSTEM "bho-common.dtd">
%common;
<!ELEMENT report (title, subtitle, (page*,section*,geodata?))>
...
```

Both files shrink to what is actually specific to them, the nine duplicated elements
have one definition, and the eight divergent ones become a deliberate choice recorded
in one line each rather than an accident of copy-and-paste.

All of this is grade **A**: the set of valid documents is identical.

## 5. Cosmetic

- Both files use **CRLF line endings**, alone among the assets BHO serves.
- Two typos in comments: `depracted` (for deprecated) and `dervied` (for derived).
- Neither file carries a version, a date, or a pointer to documentation. A three-line
  header would make it possible to tell two copies apart.

## 6. What must not change

For the avoidance of doubt, and because these are the points where a well-meant tidy-up
would break published pages:

- Element and attribute **names**, including `emph/@type`'s single letters.
- `@graphic` beginning `/images/` — the stylesheet takes `substring(@graphic, 9)`.
- The rendered footnote number coming from the **id**, not `@number`.
- `<page start="N"/>` marking the page that *follows* it.
- `<title>` and `<subtitle>` remaining mandatory and unrendered.

## 7. Summary

| # | Change | Grade |
|---|---|---|
| 1.1 | Declare `figure/@visible` and `plate/@visible` | B |
| 1.2 | Make `place/@id` an `ID`, or repoint `geoitem/@place` | B |
| 1.3 | `list` head optional | B |
| 1.6 | Delete the dead `publish` comment | A |
| 3, 4 | Shared module and parameter entities; merge duplicate `ATTLIST`s | A |
| 5 | Line endings, typos, version header | A |
| 1.4 | Sequence `quote`, `figure`, `plate` | C |
| 1.5 | `ID` typing for `section`, `para`, `table`, `list` | C |
| 2 | Align the eight divergent content models, starting with `para`/`ref` | C |

The A and B rows can be applied without touching a single file in the corpus. The C rows
should be run against the published corpus first; each one exists because it catches a
class of error that currently reaches publication silently.
