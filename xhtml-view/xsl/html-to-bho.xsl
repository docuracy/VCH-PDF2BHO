<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
                xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                exclude-result-prefixes="xsl">

    <!-- UTF-8, not iso-8859-1: the browser writes the serialised result to a Blob, which always
         encodes as UTF-8. Declaring iso-8859-1 made every latin-1 character (£, æ, ½, ç, é ...)
         mis-declared, so a conforming parser read it as mojibake. -->
    <xsl:output method="xml"
                encoding="UTF-8"
                indent="yes"
                standalone="no"
                doctype-system="dtd/report.dtd"/>

    <xsl:strip-space elements="*"/>

    <!-- Content sitting directly inside <article> before the first <section>: the author line,
         the opening paragraph(s), leading page breaks, and any leading figure. This used to be
         dropped entirely, because the article template only processed <section> children. It is
         now emitted inside a leading <section> with no <head>, which keeps <report>'s children
         to the title/page/section shapes BHO already accepts, and keeps the untitled section out
         of BHO's table of contents (which is keyed on section/head). -->
    <xsl:variable name="preamble"
                  select="//article/*[not(self::header) and not(self::title) and not(self::section)
                                      and not(self::footer) and not(self::p[@id='subtitle'])]
                                    [count(preceding-sibling::section) = 0]"/>

    <!-- 1 when a leading section is emitted, so top-level section numbering allows for it. One is
         emitted whenever there is pre-section content, and also when there are no sections at all,
         because <report> must hold the footnotes somewhere and every <section> needs a <head>. -->
    <xsl:variable name="preamble-offset">
        <xsl:choose>
            <xsl:when test="$preamble">1</xsl:when>
            <xsl:when test="not(//article/section[not(@class='footnotes')])">1</xsl:when>
            <xsl:otherwise>0</xsl:otherwise>
        </xsl:choose>
    </xsl:variable>

    <!-- Index volumes are a different document type: <entry>, <key> and <sub> are declared in
         index.dtd, with an <index> root, and do not exist in report.dtd at all. Emitting them
         inside a <report> made the whole index invalid. The DOCTYPE is switched to match by the
         caller (convertToBHO in preview.js, and scripts/xhtml-to-bho.js), because XSLT 1.0 cannot
         vary xsl:output. -->
    <xsl:variable name="root-element">
        <xsl:choose>
            <xsl:when test="//entry">index</xsl:when>
            <xsl:otherwise>report</xsl:otherwise>
        </xsl:choose>
    </xsl:variable>

    <!-- Root template -->
    <xsl:template match="/">
        <xsl:processing-instruction name="xml-stylesheet">
            <xsl:text>type="text/xsl" href="report.xsl"</xsl:text>
        </xsl:processing-instruction>
        <xsl:apply-templates select="//article"/>
    </xsl:template>

    <!-- Article becomes report -->
    <xsl:template match="article">
        <xsl:element name="{$root-element}">
            <xsl:attribute name="id"/>
            <xsl:attribute name="publish">false</xsl:attribute>
            <xsl:attribute name="pubid">
                <xsl:value-of select="@data-pubid"/>
            </xsl:attribute>

            <!-- Title from first header/h1. <title> is mandatory, so a document without one
                 falls back to its first heading rather than omitting the element. -->
            <xsl:choose>
                <xsl:when test="header[@id='title']/h1">
                    <xsl:apply-templates select="header[@id='title']/h1" mode="title"/>
                </xsl:when>
                <xsl:otherwise>
                    <title><xsl:value-of select="(.//h2 | .//h3)[1]"/></title>
                </xsl:otherwise>
            </xsl:choose>

            <!-- <subtitle> is mandatory - report is (title, subtitle, (page*,section*,geodata?)) -
                 so an article without one still needs an empty element. Omitting it made every
                 file we have ever exported invalid. -->
            <xsl:choose>
                <xsl:when test="p[@id='subtitle']">
                    <xsl:apply-templates select="p[@id='subtitle']" mode="subtitle"/>
                </xsl:when>
                <xsl:otherwise>
                    <subtitle/>
                </xsl:otherwise>
            </xsl:choose>

            <!-- Pre-section content, in document order, in an untitled leading section. The page
                 breaks it contains become <page> markers via section-content mode, so the first
                 page number no longer needs extracting separately. -->
            <xsl:if test="$preamble-offset = 1">
                <section id="s1">
                    <!-- Every section needs exactly one <head>, first: the content model is
                         (head, (para|list|table|note|figure|...)*). This one used to have none.
                         The document title is the right head for it, and it is also the only
                         place the title becomes visible - BHO's stylesheet never renders
                         <title>, so an article whose title appears nowhere else publishes
                         untitled. Published files (e.g. Nettlebed, Oxon. XVIII) repeat the
                         title as the first section's head in exactly this way. -->
                    <head>
                        <xsl:choose>
                            <xsl:when test="header[@id='title']/h1">
                                <xsl:apply-templates select="header[@id='title']/h1/node()"/>
                            </xsl:when>
                            <xsl:otherwise><xsl:value-of select="(.//h2 | .//h3)[1]"/></xsl:otherwise>
                        </xsl:choose>
                    </head>
                    <xsl:apply-templates select="$preamble" mode="section-content"/>
                    <!-- Nowhere else to put them if the document has no sections of its own. -->
                    <xsl:if test="not(section[not(@class='footnotes')])">
                        <xsl:apply-templates select="//footer//section[@class='footnotes']" mode="footnotes"/>
                    </xsl:if>
                </section>
            </xsl:if>

            <!-- Process top-level sections. The footnotes are emitted at the end of the last of
                 them, by the section template below. -->
            <xsl:apply-templates select="section[not(@class='footnotes')]"/>
        </xsl:element>
    </xsl:template>

    <!-- Title and subtitle -->
    <xsl:template match="h1" mode="title">
        <title><xsl:apply-templates/></title>
    </xsl:template>

    <xsl:template match="p[@id='subtitle']" mode="subtitle">
        <subtitle><xsl:apply-templates/></subtitle>
    </xsl:template>

    <!-- Process section elements recursively -->
    <xsl:template match="section[not(@class='footnotes')]">
        <section>
            <xsl:attribute name="id">
                <xsl:text>s</xsl:text>
                <xsl:call-template name="section-number"/>
            </xsl:attribute>

            <!-- Section heading from h2, h3, h4, h5, etc. -->
            <xsl:if test="h2 | h3 | h4 | h5 | h6">
                <head>
                    <xsl:apply-templates select="(h2 | h3 | h4 | h5 | h6)[1]/node()"/>
                </head>
            </xsl:if>

            <!-- Content and nested sections in a single document-order pass. Emitting all the
                 content first and all the nested sections afterwards reordered any content that
                 followed a sub-section - which put page markers out of sequence wherever a page
                 break fell just after one (Poling in Sussex 5 pt 2). Headings are skipped: the
                 first became <head> above. -->
            <xsl:for-each select="*[not(self::h2 or self::h3 or self::h4 or self::h5 or self::h6)]">
                <xsl:choose>
                    <xsl:when test="self::section[not(@class='footnotes')]">
                        <xsl:apply-templates select="."/>
                    </xsl:when>
                    <!-- footnote sections are collected separately, at report level -->
                    <xsl:when test="self::section"/>
                    <xsl:otherwise>
                        <xsl:apply-templates select="." mode="section-content"/>
                    </xsl:otherwise>
                </xsl:choose>
            </xsl:for-each>

            <!-- Article-level content sitting between this top-level section and the next one
                 (typically a page break at a section boundary). It is emitted at the end of this
                 section, which is where it falls in reading order - it must not be hoisted into
                 the leading preamble section, which would move it out of document order. -->
            <xsl:if test="parent::article">
                <xsl:variable name="index" select="count(preceding-sibling::section) + 1"/>
                <xsl:apply-templates mode="section-content"
                    select="../*[not(self::section) and not(self::header) and not(self::title)
                                 and not(self::footer) and not(self::p[@id='subtitle'])]
                               [count(preceding-sibling::section) = $index]"/>
            </xsl:if>

            <!-- The document's footnotes close the last top-level section. <note> is legal
                 anywhere in a section, and this is where the published volumes put them. They
                 used to go in a section of their own, which is invalid without a <head> - and
                 giving it one would publish a spurious "Footnotes" heading, since BHO renders
                 the footnote list itself from //note. -->
            <xsl:if test="parent::article and not(following-sibling::section[not(@class='footnotes')])">
                <xsl:apply-templates select="//footer//section[@class='footnotes']" mode="footnotes"/>
            </xsl:if>
        </section>
    </xsl:template>

    <!-- Generate hierarchical section numbering -->
    <xsl:template name="section-number">
        <xsl:for-each select="ancestor-or-self::section[not(@class='footnotes')]">
            <xsl:variable name="n" select="count(preceding-sibling::section[not(@class='footnotes')]) + 1"/>
            <xsl:choose>
                <!-- position() = 1 is the outermost section, which follows any preamble section -->
                <xsl:when test="position() = 1">
                    <xsl:value-of select="$n + $preamble-offset"/>
                </xsl:when>
                <xsl:otherwise>
                    <xsl:value-of select="$n"/>
                </xsl:otherwise>
            </xsl:choose>
            <xsl:if test="position() != last()">
                <xsl:text>-</xsl:text>
            </xsl:if>
        </xsl:for-each>
    </xsl:template>

    <!-- Section content processing -->
    <xsl:template match="*" mode="section-content">
        <xsl:choose>
            <!-- Page breaks -->
            <xsl:when test="self::p[@class='page-break']">
                <xsl:variable name="page-num" select="normalize-space(substring-before(substring-after(., '[Page '), ']'))"/>
                <page start="{$page-num}"/>
            </xsl:when>

            <!-- Regular paragraphs. A <br/> is a hard line break in the source and is rendered as
                 one in the HTML preview, but BHO XML has no line-break element, so a paragraph
                 containing them becomes one <para> per line - the form the published Oxfordshire
                 19 donor and source lists take. Without this the lines ran together ("All Souls
                 College, OxfordThe Barnsbury Charitable Trust"), and the preview misrepresented
                 what BHO would publish.

                 Numbering counts <br/> alongside <p> so the split paragraphs stay sequential.
                 Documents with no <br/> are numbered exactly as before. -->
            <xsl:when test="self::p[not(@class='page-break' or @id='subtitle')]">
                <xsl:choose>
                    <xsl:when test="br">
                        <!-- text before the first <br/> -->
                        <xsl:variable name="lead" select="node()[not(self::br)][count(preceding-sibling::br) = 0]"/>
                        <xsl:if test="normalize-space(.) != '' and count($lead) &gt; 0 and normalize-space(string($lead)) != ''">
                            <para>
                                <xsl:attribute name="id">
                                    <xsl:text>p</xsl:text>
                                    <xsl:number count="p[not(@class='page-break' or @id='subtitle' or @class='footnote')] | br[ancestor::p[not(@class='page-break' or @id='subtitle' or @class='footnote')]]" level="any"/>
                                </xsl:attribute>
                                <xsl:apply-templates select="$lead"/>
                            </para>
                        </xsl:if>
                        <!-- one paragraph per line thereafter -->
                        <xsl:for-each select="br">
                            <xsl:variable name="k" select="position()"/>
                            <xsl:variable name="line" select="../node()[not(self::br)][count(preceding-sibling::br) = $k]"/>
                            <xsl:if test="normalize-space(string($line)) != '' or normalize-space(string(.)) != ''">
                                <para>
                                    <xsl:attribute name="id">
                                        <xsl:text>p</xsl:text>
                                        <xsl:number count="p[not(@class='page-break' or @id='subtitle' or @class='footnote')] | br[ancestor::p[not(@class='page-break' or @id='subtitle' or @class='footnote')]]" level="any"/>
                                    </xsl:attribute>
                                    <!-- text may sit inside the <br> (XHTML source) or after it
                                         (HTML preview, where <br/> is void) -->
                                    <xsl:apply-templates select="node()"/>
                                    <xsl:apply-templates select="$line"/>
                                </para>
                            </xsl:if>
                        </xsl:for-each>
                    </xsl:when>
                    <xsl:otherwise>
                        <para>
                            <xsl:attribute name="id">
                                <xsl:text>p</xsl:text>
                                <xsl:number count="p[not(@class='page-break' or @id='subtitle' or @class='footnote')] | br[ancestor::p[not(@class='page-break' or @id='subtitle' or @class='footnote')]]" level="any"/>
                            </xsl:attribute>
                            <xsl:apply-templates/>
                        </para>
                    </xsl:otherwise>
                </xsl:choose>
            </xsl:when>

            <!-- Tables: wrap in div.table-wrap and extract caption -->
            <xsl:when test="self::table">
                <xsl:variable name="table-num">
                    <xsl:number count="table" level="any"/>
                </xsl:variable>

                <!-- table is (head?,(tr|page)+). The caption is the <head> child and the label
                     comes from @number, which BHO renders as a bold "Table N" above it. This
                     used to emit an HTML <div class="table-wrap"> wrapper and a
                     <p class="table-caption">, neither of which is declared anywhere in
                     report.dtd - BHO wraps the table in div.table-wrap itself. -->
                <table>
                    <xsl:attribute name="id">
                        <xsl:text>t</xsl:text>
                        <xsl:value-of select="$table-num"/>
                    </xsl:attribute>
                    <xsl:if test="caption">
                        <xsl:attribute name="number">
                            <xsl:value-of select="$table-num"/>
                        </xsl:attribute>
                        <head><xsl:apply-templates select="caption/node()"/></head>
                    </xsl:if>
                    <!-- Elements only: loose text between rows is not allowed in <table>, and a
                         page break landing there used to serialise as a bare "[Page 1]". -->
                    <xsl:apply-templates select="*[not(self::caption)]"/>
                </table>
            </xsl:when>

            <!-- Lists. <section> allows <list>, so it is emitted in place. -->
            <xsl:when test="self::ul or self::ol">
                <xsl:apply-templates select="."/>
            </xsl:when>

            <!-- Index entries pass through as-is. BHO's accepted index format (see the published
                 Oxfordshire 19 index) uses the same <entry>/<head>/<key>/<sub> structure as the
                 VCH XHTML, differing only in <i>/<b> becoming <emph>, which the inline templates
                 below already handle. Without this branch the whole index was discarded. -->
            <xsl:when test="self::entry">
                <xsl:apply-templates select="."/>
            </xsl:when>

            <!-- Figures.

                 BHO rebuilds the image URL itself: its stylesheet takes substring(@graphic, 9),
                 which strips exactly "/images/", and re-prefixes the result with the site path and
                 the real publication id. So @graphic must be "/images/<filename>". Emitting the
                 full "/sites/default/files/publications/pubid-xxxxxx/images/..." path that the
                 preview needs produced a doubled, broken URL once published.

                 @number is what BHO keys the figure label on, and @id is "fig" plus the figure's
                 own number rather than its position in the document. Both match the published
                 Oxfordshire 19 volume, which renders correctly. -->
            <xsl:when test="self::figure">
                <xsl:variable name="fig-num" select="normalize-space(substring-after(@aria-label, 'Figure '))"/>
                <xsl:variable name="src" select="string(.//img/@src)"/>
                <xsl:variable name="filename">
                    <xsl:choose>
                        <xsl:when test="contains($src, '/images/')">
                            <xsl:value-of select="substring-after($src, '/images/')"/>
                        </xsl:when>
                        <xsl:otherwise>
                            <xsl:value-of select="$src"/>
                        </xsl:otherwise>
                    </xsl:choose>
                </xsl:variable>
                <figure>
                    <xsl:attribute name="id">
                        <xsl:text>fig</xsl:text>
                        <xsl:choose>
                            <xsl:when test="$fig-num != ''">
                                <xsl:value-of select="$fig-num"/>
                            </xsl:when>
                            <xsl:otherwise>
                                <xsl:number count="figure" level="any"/>
                            </xsl:otherwise>
                        </xsl:choose>
                    </xsl:attribute>
                    <!-- @number and @graphic are both #REQUIRED. An unnumbered figure takes
                         number="", which is the empty value BHO's stylesheet tests for before
                         deciding whether to print a "Figure N:" label. -->
                    <xsl:attribute name="number">
                        <xsl:value-of select="$fig-num"/>
                    </xsl:attribute>
                    <xsl:if test="$src = ''">
                        <xsl:attribute name="graphic"/>
                    </xsl:if>
                    <xsl:if test="$src != ''">
                        <xsl:attribute name="graphic">
                            <xsl:choose>
                                <xsl:when test="starts-with($src, 'data:')">
                                    <xsl:value-of select="$src"/>
                                </xsl:when>
                                <xsl:otherwise>
                                    <xsl:text>/images/</xsl:text>
                                    <xsl:value-of select="$filename"/>
                                </xsl:otherwise>
                            </xsl:choose>
                        </xsl:attribute>
                    </xsl:if>
                    <xsl:if test="figcaption">
                        <title><xsl:apply-templates select="figcaption/node()"/></title>
                    </xsl:if>
                </figure>
            </xsl:when>
        </xsl:choose>
    </xsl:template>

    <!-- Table structure -->
    <xsl:template match="thead">
        <xsl:apply-templates/>
    </xsl:template>

    <xsl:template match="tbody">
        <xsl:apply-templates/>
    </xsl:template>

    <xsl:template match="tr">
        <tr>
            <xsl:attribute name="id">
                <xsl:text>tr</xsl:text>
                <!-- level="any" over the whole document. The default level="single" counts only
                     preceding siblings, so rows restarted at 1 in every <thead>/<tbody> and every
                     table, producing wholesale duplicate ids (259 rows sharing 41 ids in the
                     Oxfordshire 20 abbreviations list). -->
                <xsl:number count="tr" level="any"/>
            </xsl:attribute>
            <!-- tr is (th|td)* - nothing else, text included. A page break falling between two
                 cells used to leak into the row as bare text; it is kept, in a cell of its own,
                 because <td> does allow <page> and BHO renders a marker for it there. -->
            <xsl:apply-templates select="td | th | p[@class='page-break']
                                         | text()[normalize-space()][not(preceding-sibling::td or preceding-sibling::th)]"/>
        </tr>
    </xsl:template>

    <!-- A page break between rows sits directly in the table, where <page> is allowed. -->
    <xsl:template match="p[@class='page-break']">
        <page start="{normalize-space(substring-before(substring-after(., '[Page '), ']'))}"/>
    </xsl:template>

    <!-- ... but inside a row it needs a cell to live in. -->
    <xsl:template match="tr/p[@class='page-break']">
        <td>
            <page start="{normalize-space(substring-before(substring-after(., '[Page '), ']'))}"/>
        </td>
    </xsl:template>

    <!-- Text that escaped its cell - a stray "400" left in the row by segmentation. <tr> is
         (th|td)* and cannot hold it, so it is folded into a neighbouring cell, which keeps the
         value and leaves the column count alone. Text before any cell gets a cell of its own. -->
    <!-- A lone closing bracket stranded between cells belongs to whichever cell holds the
         matching opener, which may be the one after it: Kirby-le-Soken has
         <td/>)<td>1 (free</td>, where the ")" closes the cell that follows. Anything else is
         appended to the cell it follows. -->
    <xsl:template name="absorb-tail">
        <xsl:variable name="tail" select="following-sibling::node()[1][self::text()]"/>
        <xsl:variable name="next" select="following-sibling::*[1][self::td or self::th]"/>
        <xsl:variable name="belongs-to-next"
                      select="string-length(normalize-space($tail)) = 1
                              and contains(')]}', normalize-space($tail))
                              and contains($next, '(') and not(contains($next, ')'))"/>
        <xsl:if test="normalize-space($tail) != '' and not(contains($tail, '[Page '))
                      and not($belongs-to-next)">
            <xsl:value-of select="$tail"/>
        </xsl:if>
    </xsl:template>

    <xsl:template name="absorb-closer">
        <xsl:variable name="lead" select="preceding-sibling::node()[1][self::text()]"/>
        <xsl:if test="string-length(normalize-space($lead)) = 1
                      and contains(')]}', normalize-space($lead))
                      and contains(., '(') and not(contains(., ')'))">
            <xsl:value-of select="normalize-space($lead)"/>
        </xsl:if>
    </xsl:template>

    <xsl:template match="tr/text()[normalize-space()][not(preceding-sibling::td or preceding-sibling::th)]">
        <td><xsl:value-of select="."/></td>
    </xsl:template>

    <xsl:template match="td | th">
        <td>
            <xsl:if test="@colspan">
                <xsl:attribute name="cols">
                    <xsl:value-of select="@colspan"/>
                </xsl:attribute>
            </xsl:if>
            <xsl:if test="@rowspan">
                <xsl:attribute name="rows">
                    <xsl:value-of select="@rowspan"/>
                </xsl:attribute>
            </xsl:if>
            <xsl:apply-templates/>
            <xsl:call-template name="absorb-closer"/>
            <xsl:call-template name="absorb-tail"/>
        </td>
    </xsl:template>

    <!-- Inline formatting -->
    <xsl:template match="em | i">
        <emph type="i"><xsl:apply-templates/></emph>
    </xsl:template>

    <xsl:template match="strong | b">
        <emph type="b"><xsl:apply-templates/></emph>
    </xsl:template>

    <xsl:template match="u">
        <emph type="u"><xsl:apply-templates/></emph>
    </xsl:template>

    <!-- emph/@type is an enumeration: (b|i|p|d|c|k|u). "p" is BHO's small superscript; "super"
         was invalid and fell through its stylesheet's otherwise branch as plain text. -->
    <xsl:template match="sup">
        <emph type="p"><xsl:apply-templates/></emph>
    </xsl:template>

    <!-- A <sup> holding nothing but footnote references is just how the marker is rendered in
         HTML. BHO produces its own "(fn. N)" marker from <ref>, so the superscript wrapper is
         redundant - it does not appear in previously accepted XML. Superscripts carrying anything
         else (table note markers, for instance) keep their <emph type="super">. -->
    <xsl:template match="sup[a[@class='footnote']][not(*[not(self::a[@class='footnote'])])]">
        <xsl:apply-templates/>
    </xsl:template>

    <!-- There is no subscript in the enumeration, and "sub" was invalid. The text is kept
         unwrapped rather than marked up wrongly. -->
    <xsl:template match="sub">
        <xsl:apply-templates/>
    </xsl:template>

    <!-- Index entry structure, copied through verbatim. Matched at any depth inside <entry>,
         because sub-entries nest (a <sub> inside a <sub> for "his w. Mary, 122" and the like, as
         in the published Oxfordshire 19 index). A <sub> here is an index sub-entry, not an HTML
         subscript, so this must out-rank the generic sub template above - the predicate gives it
         the higher priority. -->
    <!-- index.dtd has head as (#PCDATA|key|emph|addenda|ref|page|plt)* - a <sub> nested inside
         it is a sub-entry that belongs to the entry, as a sibling of the head. -->
    <xsl:template match="head[ancestor::entry][sub]">
        <head><xsl:apply-templates select="node()[not(self::sub)]"/></head>
        <xsl:apply-templates select="sub"/>
    </xsl:template>

    <xsl:template match="entry | head[ancestor::entry] | key[ancestor::entry] | sub[ancestor::entry]">
        <xsl:element name="{local-name()}">
            <xsl:apply-templates/>
        </xsl:element>
    </xsl:template>

    <!-- Footnote references from <a class="footnote"> -->
    <xsl:template match="a[@class='footnote']">
        <xsl:variable name="note-id" select="substring-after(@href, '#fnn')"/>
        <ref idref="n{$note-id}">
            <xsl:value-of select="$note-id"/>
        </ref>
    </xsl:template>

    <!-- Footnotes, emitted as the closing children of whichever section called for them. -->
    <xsl:template match="section[@class='footnotes']" mode="footnotes">
        <xsl:apply-templates select=".//li[@class='footnote']" mode="footnote"/>
    </xsl:template>

    <!-- Process individual footnotes from li elements -->
    <xsl:template match="li[@class='footnote']" mode="footnote">
        <xsl:variable name="note-num" select="substring-after(@id, 'fnn')"/>

        <note id="n{$note-num}" number="{$note-num}">
            <!-- Get text after the first anchor (the back-reference link) -->
            <xsl:apply-templates select="a[1]/following-sibling::node()"/>
        </note>
    </xsl:template>

    <!-- Skip elements that shouldn't appear in output. <ul> used to be in this list, which
         silently discarded every content list in the document along with the table of contents
         it was meant to suppress - the contents list is inside <nav>, which is dropped anyway.
         <code> used to be here too, taking its text with it. -->
    <xsl:template match="nav | header[@class='header'] | hr"/>

    <!-- No <code> in the DTD, but the text inside it is content. -->
    <xsl:template match="code">
        <xsl:apply-templates/>
    </xsl:template>

    <!-- list is (head,(li|page)+) with a required id. The head has no source in HTML, so it is
         emitted empty: BHO renders it as the list's anchor, and an empty one is harmless. -->
    <xsl:template match="ul[li] | ol[li]" name="list">
        <list>
            <xsl:attribute name="id">
                <xsl:text>l</xsl:text>
                <xsl:number count="ul[not(ancestor::nav)] | ol[not(ancestor::nav)]" level="any"/>
            </xsl:attribute>
            <head/>
            <xsl:apply-templates select="li"/>
        </list>
    </xsl:template>

    <!-- li is (#PCDATA|page|ref|emph|br)*: it cannot hold a nested list, so the items of one are
         flattened out alongside their parent rather than dropped. -->
    <xsl:template match="li[not(@class='footnote')]">
        <li><xsl:apply-templates select="node()[not(self::ul or self::ol)]"/></li>
        <xsl:apply-templates select="ul/li | ol/li"/>
    </xsl:template>

    <!-- Skip links unless they're footnote references -->
    <xsl:template match="a[not(@class='footnote')]">
        <xsl:apply-templates/>
    </xsl:template>

    <!-- Text content - preserve as-is (XML output will handle entity encoding) -->
    <xsl:template match="text()">
        <xsl:value-of select="."/>
    </xsl:template>

</xsl:stylesheet>