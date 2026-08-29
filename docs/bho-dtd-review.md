# BHO's DTDs: faults, divergence, and how they could be repaired

A review of the two grammars BHO validates against —
[`report.dtd`](https://www.british-history.ac.uk/dtd/report.dtd) and
[`index.dtd`](https://www.british-history.ac.uk/dtd/index.dtd) — with repairs that would
make them agree with each other, with BHO's own display stylesheet, and with the files
BHO already publishes.

These DTDs govern the whole of British History Online, not one series, so every
recommendation below is weighed against a sample of the live corpus rather than against
VCH alone. Measurements are in [§2](#2-what-the-corpus-actually-contains).

**Nothing proposed here changes a published page.** These are changes to the grammar,
not to the markup: no element or attribute is renamed, no content is restructured.

Copies of both DTDs are vendored, unmodified, in [`dtd/`](../dtd/). See
[the format specification](bho-report-xml-specification.md) for what the grammar
requires, and [the reference list](bho-schema-references.md) for where everything lives.

## 1. The finding that frames the rest

**The DTDs are not enforced at publication.** In a sample of 215 files drawn from 155
publications:

- one file is **not well-formed XML at all** — `pubid-423/63526.xml` line 169 reads
  `4< emph type="i">from the bottom</emph>`, a space after the `<`;
- one has a **root element neither DTD declares** — `pubid-544/160020.xml` is rooted on
  `<xml>`, wrapping a `<document>`, and opens with three `<head>` elements in a single
  section;
- 24 files carry duplicate ids of a kind one DTD or the other forbids.

A grammar that nothing checks against is documentation, not a gate. That changes what
repairing it is *for*: the valuable work is making the DTDs describe what BHO genuinely
publishes and renders, so that anyone validating gets a meaningful answer. Tightening
them to reject more is close to worthless while nothing validates at all, and expensive
if validation is ever switched on.

The recommendations are graded accordingly:

| Grade | Meaning |
|---|---|
| **A — refactor** | The set of valid documents is unchanged. Pure tidying. |
| **B — accepts more** | Files BHO already publishes stop being rejected. Nothing valid today becomes invalid. |
| **C — accepts less** | Catches real errors, but rejects files now in the corpus. Measured cost given in each case. |

## 2. What the corpus actually contains

215 files parsed, from 155 publications (up to two per publication, taken from the
managed-file list). A sample, not a census, and weighted towards recently touched files
— but broad enough to settle several questions.

| Measure | Result |
|---|---|
| Root element | `report` 140, **`index` 74**, `xml` 1 |
| Not well-formed | 1 |
| `figure`/`plate` carrying `@visible` | 4 |
| Files with duplicate ids | `table` 11, `para` 7, `section` 5, **`figure` 1** |
| `quote` with more than one `quosource` | 1 |
| `figure` with more than one `title`/`caption` | 1 |
| Index files with `ref` inside a `para` | **0** |
| `emph/@type` values in use | `i` 303,690 · `b` 124,127 · `p` 3,479 · `d` 2 · `u` 1 · `c` 0 · `k` 0 · malformed `"p "` 2, `" i"` 1 |
| Element counts | `entry` 313,686 · `key` 304,363 · `td` 293,513 · `sub` 121,050 · `note` 39,355 · `page` 8,830 · `a` 2,540 · `mdr` 185 · `plt` 138 · `list` 67 · `quote` 18 · `intro` 30 · `name` 6 |
| Never seen | `person`, `glink`, `fig`, `plate`, `nhead`, `nkey`, `nsub`, `place`, `addenda`, `business`, `dataset`, `geodata`, `catalogue`, `mapset` |

Three things follow.

**Indexes are a third of the corpus.** `entry`, `key` and `sub` are the three most
numerous elements in BHO after `td`. `index.dtd` is not a sideline, and its divergences
from `report.dtd` deserve the same care.

**Half the declared vocabulary is unexercised here.** The dataset, mapping, catalogue
and business structures did not appear once. That does not mean they are dead — a
two-file sample per publication would miss a structure used by one publication — but it
does mean they can be moved into a module of their own without disturbing anything, and
that nobody should assume they still work.

**`c` and `k` appear to be dead `emph` values**, while three attribute values are
corrupted by stray whitespace (`"p "`, `" i"`). Those three are invalid against the
enumeration today, and would be caught the moment anything validated.

## 3. Faults

### 3.1 `figure/@visible` is used but never declared — **B**

BHO's stylesheet branches on `figure[@visible='false']` and substitutes a "restricted"
placeholder. Four instances in the sample. Declared nowhere, so every file using it is
invalid against the DTD shipped with it — the one error that must be discounted when
validating anything BHO has published.

```
<!ATTLIST figure visible (true|false) "true">
<!ATTLIST plate  visible (true|false) "true">
```

### 3.2 `geoitem/@place` is an IDREF with nothing to point at — **B**

`place/@id` is `CDATA`, which can never satisfy an `IDREF`; the only element nearby
declaring an `ID` is `geolocation`. Any document exercising this part of the grammar is
unvalidatable. Either rename the attribute for what it references, or:

```
<!ATTLIST place id ID #REQUIRED>
```

Unexercised in the sample, so the fix is free.

### 3.3 `list` requires a `head` that HTML cannot supply — **B**

```
<!ELEMENT list (head,(li|page)+)>
```

A list converted from HTML has no heading to give, so the only way to satisfy the
grammar is an empty `<head/>`, which BHO renders as an empty bold paragraph. With 67
lists in the sample this is a small population, and making the head optional costs
nothing:

```
<!ELEMENT list (head?,(li|page)+)>
```

### 3.4 A dead declaration — **A**

Both files carry a commented-out enumeration directly below the live one:

```
         publish CDATA #IMPLIED>
<!--         publish (false|true) "true"> -->
```

Delete the comment, or adopt the enumeration (then grade C — it would reject any other
value).

### 3.5 `quote` and `figure` allow shapes the stylesheet cannot render — **C, cost: 2 files**

```
<!ELEMENT quote  (quotext|quosource)*>
<!ELEMENT figure (title|caption)*>
```

Any number of each, in any order. The stylesheet renders one `quosource` and one figure
`title`/`caption`; documents with two are accepted and silently mis-rendered. One file
of each kind exists in the sample, so tightening is cheap here — but it is still a
change that rejects published content:

```
<!ELEMENT quote  (quotext*, quosource?)>
<!ELEMENT figure (title?, caption?)>
```

### 3.6 Identifier typing is inconsistent — **C, cost: ~10% of files**

| Declared `ID` (unique, enforced) | Declared `CDATA` (collisions pass silently) |
|---|---|
| `note`, `figure`, `plate`, `tr`, `quote`, `group`, `geoclass`, `geolocation`, `geoitem`, `range`, `dsclass`, `dsrecord` | `section`, `para`, `table`, `list`, `place` |

BHO builds page anchors from both columns — `h2-{section/@id}`, `p{para/@id}`,
`mt{table/@id}` — so a duplicate in the right-hand column yields colliding anchors and
broken in-page navigation with no error anywhere.

The measured cost of declaring them `ID`: 11 files in 215 have duplicate `table` ids,
7 have duplicate `para` ids, 5 duplicate `section` ids. Extrapolated, that is thousands
of files across BHO — a corpus clean-up, not a DTD edit.

Note the asymmetry: one file already has **duplicate `figure` ids**, and `figure/@id`
*is* declared `ID`. That file is invalid today and published anyway, which is §1 in
miniature.

**Recommendation:** leave the DTD as it is, and put this check in an external validator
run over the corpus, so that broken anchors get reported without blocking publication.
The same tool should flag the whitespace-corrupted `emph/@type` values.

## 4. The two DTDs disagree with each other

Nine elements are declared identically in both files. Eight more share a name and differ
in content model:

| Element | `report.dtd` | `index.dtd` | Bites in practice? |
|---|---|---|---|
| `subtitle` | `(#PCDATA\|emph\|ref)*` | `(#PCDATA)` | An index subtitle cannot be italicised. Plausible in principle |
| `emph` | `(#PCDATA\|emph\|ref\|page\|br\|mdr)*` | `(#PCDATA\|emph)*` | No footnote marker inside italics in an index. Plausible |
| `emph/@type` | `(b\|i\|p\|d\|c\|k\|u)` | `(b\|i\|p\|c\|d)` | No strikethrough or underline in an index. `k` unused anywhere; `u` used once |
| `para` | 10 alternatives incl. `ref` | `(#PCDATA\|emph\|br)*` | **No.** Zero index files put a `ref` in a `para`, though `index.dtd` declares both |
| `note` | adds `plt`, `figure`, `para`, `page` | `(#PCDATA\|ref\|emph\|br\|table)*` | Not observed |
| `head` | `(#PCDATA\|ref\|emph\|plt\|a)*` | adds `key`, `addenda`, `page` | Divergent by design |
| `td` | adds `plt`, `mdr`, `list` | `(#PCDATA\|ref\|emph\|br\|page)*` | A table moved from a report into an index may stop validating |
| `th` | adds `plt` | `(#PCDATA\|ref\|emph\|br)*` | As above |

`index.dtd` records the cause in its own comment — `<!-- table copied in from report
June 5th, 2006 -->`. Copied, then drifted.

Worth stating plainly: **none of these differences is currently breaking anything I can
measure.** The case for aligning them is maintenance, not repair — today a change to a
shared construct has to be made twice, by someone who knows to look in both files.

## 5. Redundancy

- **The 20 entity-set inclusions are duplicated verbatim** across both files: the ISO
  sets plus BHO's own `bhoa.ent`. Forty lines maintained in two places.
- **Nine element declarations are byte-for-byte identical**: `br`, `caption`, `figure`,
  `page`, `plt`, `ref`, `table`, `title`, `tr`.
- **`plate` is a clone of `figure`** — same content model, same attributes.
- **One element, many `ATTLIST` declarations**: `dsclass` has six, `geolocation` four,
  `geoitem`, `range` and `dsrecord` three each, `ref`, `page`, `geoclass` and `poi` two.
  Legal, but an attribute list must be assembled by reading the whole file.

## 6. A shape that would fix §4 and §5

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
<!ATTLIST figure id ID        #REQUIRED
                 number CDATA #REQUIRED
                 graphic CDATA #REQUIRED
                 visible (true|false) "true">
```

**`bho-legacy.dtd`** — `business`, `geodata`, `dataset`, `catalogue`, `mapset`: declared,
unexercised in the sample, and better quarantined than deleted.

**`report.dtd`** and **`index.dtd`** then reduce to their genuine differences:

```
<!ENTITY % inline "#PCDATA|ref|emph|br|plt|mdr|a">   <!-- report -->
<!ENTITY % common SYSTEM "bho-common.dtd">
%common;
<!ELEMENT report (title, subtitle, (page*,section*,geodata?))>
```

All grade **A**: the set of valid documents is identical.

**One operational caveat.** Every published file names its DTD by `SYSTEM` identifier,
so the grammar is fetched at parse time by anything that validates. Splitting one file
into four means four requests instead of one, and any consumer mirroring the `dtd/`
directory — this repository included — must mirror the new parts too. Worth doing, but
it is a deployment change, not only an editing one.

## 7. What must not change

The points where a well-meant tidy-up would break published pages:

- Element and attribute **names**, including `emph/@type`'s single letters.
- `@graphic` beginning `/images/` — the stylesheet takes `substring(@graphic, 9)`.
- The rendered footnote number coming from the **id**, not `@number`.
- `<page start="N"/>` marking the page that *follows* it.
- `<title>` and `<subtitle>` remaining mandatory and unrendered.

## 8. Summary

| # | Change | Grade | Measured cost |
|---|---|---|---|
| 3.1 | Declare `figure/@visible`, `plate/@visible` | B | none; fixes 4 files in the sample |
| 3.2 | `place/@id` as `ID`, or repoint `geoitem/@place` | B | none |
| 3.3 | `list` head optional | B | none |
| 3.4 | Delete the dead `publish` comment | A | none |
| 5, 6 | Shared module, parameter entities, merged `ATTLIST`s | A | none; four DTD files served instead of two |
| — | Line endings (CRLF), typos (`depracted`, `dervied`), version header | A | none |
| 3.5 | Sequence `quote`, `figure`, `plate` | C | 2 files in 215 |
| 4 | Align the eight divergent content models | C | none observed; maintenance benefit only |
| 3.6 | `ID` typing for `section`, `para`, `table`, `list` | C | ~10% of files; do this as an external check instead |

The A and B rows can be applied without touching a single file in the corpus, and are
worth doing on their own. The C rows are worth deciding *against* explicitly, and
handling in a validator run over the corpus, for as long as nothing validates at
publication time.

---

*Corpus measurements: 215 files from 155 publications, sampled from BHO's managed-file
list, August 2026. A sample, not a census; counts skew towards recently modified files.*
