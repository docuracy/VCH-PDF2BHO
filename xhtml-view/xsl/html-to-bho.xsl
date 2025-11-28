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
        <xsl:apply-templates select="//body"/>
    </xsl:template>

    <!-- Body becomes report -->
    <xsl:template match="body">
        <report id="" publish="false">
            <xsl:attribute name="pubid">
                <xsl:value-of select="//meta[@data-pubid]/@data-pubid"/>
            </xsl:attribute>

            <xsl:apply-templates select="h2[@id='title'] | h1[@id='title']" mode="title"/>
            <xsl:apply-templates select="p[@id='subtitle']" mode="subtitle"/>

            <!-- Get first page number from first page break -->
            <xsl:variable name="first-page" select="normalize-space(substring-before(substring-after((p[@class='page-break'])[1], '[Page '), ']'))"/>
            <xsl:if test="$first-page">
                <page start="{$first-page}"/>
            </xsl:if>

            <!-- Process h3 sections and footnotes section -->
            <xsl:apply-templates select="h3" mode="create-section"/>

            <!-- Process footnotes section if it exists -->
            <xsl:apply-templates select="section[@class='footnotes']" mode="footnotes-section"/>
        </report>
    </xsl:template>

    <!-- Title and subtitle -->
    <xsl:template match="h2[@id='title'] | h1[@id='title']" mode="title">
        <title><xsl:apply-templates/></title>
    </xsl:template>

    <xsl:template match="p[@id='subtitle']" mode="subtitle">
        <subtitle><xsl:apply-templates/></subtitle>
    </xsl:template>

    <!-- Create section for each h3 -->
    <xsl:template match="h3" mode="create-section">
        <xsl:variable name="next-h3" select="following-sibling::h3[1]"/>

        <section>
            <xsl:attribute name="id">
                <xsl:text>s</xsl:text>
                <xsl:number count="h3[not(ancestor::section[@class='footnotes'])]" level="any"/>
            </xsl:attribute>

            <head><xsl:apply-templates/></head>

            <!-- Get all content between this h3 and the next h3 (or end) -->
            <xsl:variable name="section-content" select="following-sibling::*[
                not(self::h3) and
                not(self::section[@class='footnotes']) and
                (not($next-h3) or (following-sibling::h3[1] and generate-id(following-sibling::h3[1]) = generate-id($next-h3)))
            ]"/>

            <xsl:apply-templates select="$section-content" mode="section-content"/>
        </section>
    </xsl:template>

    <!-- Section content processing -->
    <xsl:template match="*" mode="section-content">
        <xsl:choose>
            <!-- Page breaks -->
            <xsl:when test="self::p[@class='page-break']">
                <xsl:variable name="page-num" select="normalize-space(substring-before(substring-after(., '[Page '), ']'))"/>
                <page start="{$page-num}"/>
            </xsl:when>

            <!-- H4 and H5 create nested sections -->
            <xsl:when test="self::h4 or self::h5">
                <xsl:variable name="current-level" select="local-name()"/>
                <xsl:variable name="next-same-or-higher" select="following-sibling::*[
                    (self::h4 and $current-level = 'h4') or
                    (self::h5 and $current-level = 'h5') or
                    self::h3
                ][1]"/>

                <section>
                    <xsl:attribute name="id">
                        <xsl:text>s</xsl:text>
                        <xsl:number count="h3[not(ancestor::section[@class='footnotes'])] | h4 | h5" level="any"/>
                    </xsl:attribute>

                    <head><xsl:apply-templates/></head>

                    <!-- Get content until next same-or-higher heading -->
                    <xsl:apply-templates select="following-sibling::*[
                        not(self::h3 or self::h4 or self::h5) and
                        (not($next-same-or-higher) or (following-sibling::*[
                            (self::h4 and $current-level = 'h4') or
                            (self::h5 and $current-level = 'h5') or
                            self::h3
                        ][1] and generate-id(following-sibling::*[
                            (self::h4 and $current-level = 'h4') or
                            (self::h5 and $current-level = 'h5') or
                            self::h3
                        ][1]) = generate-id($next-same-or-higher)))
                    ]" mode="section-content"/>
                </section>
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

            <!-- Tables wrapped in div.table-wrap -->
            <xsl:when test="self::div[@class='table-wrap']">
                <xsl:apply-templates select="table"/>
            </xsl:when>

            <!-- Tables -->
            <xsl:when test="self::table">
                <table>
                    <xsl:attribute name="id">
                        <xsl:text>t</xsl:text>
                        <xsl:number count="table" level="any"/>
                    </xsl:attribute>
                    <xsl:apply-templates/>
                </table>
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

    <!-- Table rows -->
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
                <xsl:number count="h3[not(ancestor::section[@class='footnotes'])]" level="any"/>
                <xsl:text>notes</xsl:text>
            </xsl:attribute>

            <xsl:apply-templates select="p[@class='footnote']" mode="footnote"/>
        </section>
    </xsl:template>

    <xsl:template match="p[@class='footnote']" mode="footnote">
        <xsl:variable name="note-num" select="normalize-space(substring-before(substring-after(a[1], '. '), ' '))"/>
        <xsl:variable name="note-num-clean">
            <xsl:choose>
                <xsl:when test="$note-num != ''">
                    <xsl:value-of select="$note-num"/>
                </xsl:when>
                <xsl:otherwise>
                    <xsl:value-of select="substring-after(@id, 'fnn')"/>
                </xsl:otherwise>
            </xsl:choose>
        </xsl:variable>

        <note id="n{$note-num-clean}" number="{$note-num-clean}">
            <!-- Get text after the first anchor's closing tag -->
            <xsl:apply-templates select="a[1]/following-sibling::node()"/>
        </note>
    </xsl:template>

    <!-- Skip elements that shouldn't appear in output -->
    <xsl:template match="header | ul | code | div[@class='table-wrap']/p"/>

    <!-- Skip links unless they're footnote references -->
    <xsl:template match="a[not(@class='footnote')]">
        <xsl:apply-templates/>
    </xsl:template>

    <!-- Text content - preserve as-is (XML output will handle entity encoding) -->
    <xsl:template match="text()">
        <xsl:value-of select="."/>
    </xsl:template>

</xsl:stylesheet>