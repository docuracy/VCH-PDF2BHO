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

    <!-- 1 when a preamble section is emitted, so top-level section numbering allows for it. -->
    <xsl:variable name="preamble-offset" select="count($preamble[1])"/>

    <!-- Root template -->
    <xsl:template match="/">
        <xsl:processing-instruction name="xml-stylesheet">
            <xsl:text>type="text/xsl" href="report.xsl"</xsl:text>
        </xsl:processing-instruction>
        <xsl:apply-templates select="//article"/>
    </xsl:template>

    <!-- Article becomes report -->
    <xsl:template match="article">
        <report id="" publish="false">
            <xsl:attribute name="pubid">
                <xsl:value-of select="@data-pubid"/>
            </xsl:attribute>

            <!-- Title from first header/h1 -->
            <xsl:apply-templates select="header[@id='title']/h1" mode="title"/>

            <!-- Subtitle if present -->
            <xsl:apply-templates select="p[@id='subtitle']" mode="subtitle"/>

            <!-- Pre-section content, in document order, in an untitled leading section. The page
                 breaks it contains become <page> markers via section-content mode, so the first
                 page number no longer needs extracting separately. -->
            <xsl:if test="$preamble">
                <section id="s1">
                    <xsl:apply-templates select="$preamble" mode="section-content"/>
                </section>
            </xsl:if>

            <!-- Process top-level sections -->
            <xsl:apply-templates select="section[not(@class='footnotes')]"/>

            <!-- Process footnotes section if it exists -->
            <xsl:apply-templates select="//footer//section[@class='footnotes']" mode="footnotes-section"/>
        </report>
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
            <xsl:for-each select="node()[not(self::h2 or self::h3 or self::h4 or self::h5 or self::h6)]">
                <xsl:choose>
                    <xsl:when test="self::section[not(@class='footnotes')]">
                        <xsl:apply-templates select="."/>
                    </xsl:when>
                    <!-- footnote sections are collected separately, at report level -->
                    <xsl:when test="self::section"/>
                    <xsl:when test="self::p or self::table or self::figure or self::div or self::entry
                                    or self::header or self::nav or self::ul or self::ol">
                        <xsl:apply-templates select="." mode="section-content"/>
                    </xsl:when>
                    <xsl:otherwise>
                        <!-- Text or inline markup sitting directly in the section, not wrapped in
                             a <p>. Valid XHTML, and it happens in hand-edited files, but iterating
                             elements alone dropped it silently along with any footnote references
                             it carried. Each unbroken run becomes one paragraph, so an inline
                             footnote marker stays attached to its sentence. -->
                        <xsl:variable name="blocks-before"
                                      select="count(preceding-sibling::*[self::p or self::section or self::table
                                              or self::figure or self::div or self::entry or self::header
                                              or self::nav or self::ul or self::ol or self::h1 or self::h2
                                              or self::h3 or self::h4 or self::h5 or self::h6])"/>
                        <xsl:variable name="run"
                                      select="../node()[not(self::p or self::section or self::table or self::figure
                                              or self::div or self::entry or self::header or self::nav or self::ul
                                              or self::ol or self::h1 or self::h2 or self::h3 or self::h4
                                              or self::h5 or self::h6)]
                                             [count(preceding-sibling::*[self::p or self::section or self::table
                                              or self::figure or self::div or self::entry or self::header
                                              or self::nav or self::ul or self::ol or self::h1 or self::h2
                                              or self::h3 or self::h4 or self::h5 or self::h6]) = $blocks-before]"/>
                        <!-- emit once per run, at its first node -->
                        <xsl:if test="count($run[1] | .) = 1 and normalize-space(string($run)) != ''">
                            <para>
                                <!-- counted, not xsl:number: the current node is not itself a <p>,
                                     and xsl:number yields NaN when nothing matching precedes it -->
                                <xsl:attribute name="id">
                                    <xsl:text>p</xsl:text>
                                    <xsl:value-of select="count(preceding::p[not(@class='page-break' or @id='subtitle' or @class='footnote')])
                                                          + count(preceding::br[ancestor::p[not(@class='page-break' or @id='subtitle' or @class='footnote')]])"/>
                                    <xsl:text>s</xsl:text>
                                    <xsl:value-of select="$blocks-before"/>
                                </xsl:attribute>
                                <xsl:apply-templates select="$run"/>
                            </para>
                        </xsl:if>
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

                <div class="table-wrap">
                    <!-- Extract caption and put it in a p.table-caption before the table -->
                    <xsl:if test="caption">
                        <p class="table-caption">
                            <strong>Table <xsl:value-of select="$table-num"/>: </strong>
                            <xsl:apply-templates select="caption/node()"/>
                        </p>
                    </xsl:if>

                    <table>
                        <xsl:attribute name="id">
                            <xsl:text>t</xsl:text>
                            <xsl:value-of select="$table-num"/>
                        </xsl:attribute>
                        <!-- Process table content except caption -->
                        <xsl:apply-templates select="*[not(self::caption)]"/>
                    </table>
                </div>
            </xsl:when>

            <!-- Index entries pass through as-is. BHO's accepted index format (see the published
                 Oxfordshire 19 index) uses the same <entry>/<head>/<key>/<sub> structure as the
                 VCH XHTML, differing only in <i>/<b> becoming <emph>, which the inline templates
                 below already handle. Without this branch the whole index was discarded. -->
            <xsl:when test="self::entry">
                <xsl:apply-templates select="."/>
            </xsl:when>

            <!-- Figures -->
            <xsl:when test="self::figure">
                <figure>
                    <xsl:attribute name="id">
                        <xsl:text>fig</xsl:text>
                        <xsl:number count="figure" level="any"/>
                    </xsl:attribute>
                    <xsl:if test="@data-number">
                        <xsl:attribute name="number">
                            <xsl:value-of select="@data-number"/>
                        </xsl:attribute>
                    </xsl:if>
                    <xsl:if test=".//img/@src">
                        <xsl:attribute name="graphic">
                            <xsl:value-of select=".//img/@src"/>
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
            <xsl:apply-templates/>
        </tr>
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

    <xsl:template match="sup">
        <emph type="super"><xsl:apply-templates/></emph>
    </xsl:template>

    <xsl:template match="sub">
        <emph type="sub"><xsl:apply-templates/></emph>
    </xsl:template>

    <!-- Index entry structure, copied through verbatim. Matched at any depth inside <entry>,
         because sub-entries nest (a <sub> inside a <sub> for "his w. Mary, 122" and the like, as
         in the published Oxfordshire 19 index). A <sub> here is an index sub-entry, not an HTML
         subscript, so this must out-rank the generic sub template above - the predicate gives it
         the higher priority. -->
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

    <!-- Footnotes section -->
    <xsl:template match="section[@class='footnotes']" mode="footnotes-section">
        <section>
            <xsl:attribute name="id">
                <xsl:text>s</xsl:text>
                <xsl:number count="section[not(@class='footnotes')]" level="any"/>
                <xsl:text>notes</xsl:text>
            </xsl:attribute>

            <!-- Process footnotes from ul/li structure -->
            <xsl:apply-templates select=".//li[@class='footnote']" mode="footnote"/>
        </section>
    </xsl:template>

    <!-- Process individual footnotes from li elements -->
    <xsl:template match="li[@class='footnote']" mode="footnote">
        <xsl:variable name="note-num" select="substring-after(@id, 'fnn')"/>

        <note id="n{$note-num}" number="{$note-num}">
            <!-- Get text after the first anchor (the back-reference link) -->
            <xsl:apply-templates select="a[1]/following-sibling::node()"/>
        </note>
    </xsl:template>

    <!-- Skip elements that shouldn't appear in output -->
    <xsl:template match="nav | header[@class='header'] | ul | code | hr"/>

    <!-- Skip links unless they're footnote references -->
    <xsl:template match="a[not(@class='footnote')]">
        <xsl:apply-templates/>
    </xsl:template>

    <!-- Text content - preserve as-is (XML output will handle entity encoding) -->
    <xsl:template match="text()">
        <xsl:value-of select="."/>
    </xsl:template>

</xsl:stylesheet>