<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
                xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                exclude-result-prefixes="xsl">

    <xsl:output method="xml"
                encoding="iso-8859-1"
                indent="yes"
                standalone="no"
                doctype-system="dtd/report.dtd"/>

    <xsl:strip-space elements="*"/>

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

            <!-- Get first page number from first page break -->
            <xsl:variable name="first-page" select="normalize-space(substring-before(substring-after((p[@class='page-break'])[1], '[Page '), ']'))"/>
            <xsl:if test="$first-page">
                <page start="{$first-page}"/>
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

            <!-- Process content, excluding headings and nested sections -->
            <xsl:apply-templates select="*[not(self::h2 or self::h3 or self::h4 or self::h5 or self::h6 or self::section)]" mode="section-content"/>

            <!-- Process nested sections -->
            <xsl:apply-templates select="section[not(@class='footnotes')]"/>
        </section>
    </xsl:template>

    <!-- Generate hierarchical section numbering -->
    <xsl:template name="section-number">
        <xsl:for-each select="ancestor-or-self::section[not(@class='footnotes')]">
            <xsl:value-of select="count(preceding-sibling::section[not(@class='footnotes')]) + 1"/>
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

            <!-- Regular paragraphs -->
            <xsl:when test="self::p[not(@class='page-break' or @id='subtitle')]">
                <para>
                    <xsl:attribute name="id">
                        <xsl:text>p</xsl:text>
                        <xsl:number count="p[not(@class='page-break' or @id='subtitle' or @class='footnote')]" level="any"/>
                    </xsl:attribute>
                    <xsl:apply-templates/>
                </para>
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
                <xsl:number count="tr" from="table"/>
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