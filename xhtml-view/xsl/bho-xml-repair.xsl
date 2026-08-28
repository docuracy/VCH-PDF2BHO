<?xml version="1.0" encoding="UTF-8"?>
<!--
    Repairs BHO XML that was exported before html-to-bho.xsl was corrected against BHO's DTD
    (https://www.british-history.ac.uk/dtd/report.dtd). It is an identity transform with one
    override per defect, so anything already correct passes through untouched.

    This exists because the affected files were delivered as XML and their VCH XHTML sources are
    not to hand; new exports come out correct and do not need it.

    Defects repaired:
      1. <subtitle> missing            - report is (title, subtitle, ...), both mandatory
      2. headless leading section      - section is (head, ...); the title becomes its head
      3. headless notes section        - dissolved into the preceding section, where <note> is legal
      4. <div class="table-wrap">      - not declared anywhere; the caption becomes <head>/@number
      5. emph/@type "super"/"sub"      - not in (b|i|p|d|c|k|u)
      6. loose text in <table>/<tr>    - a page break that leaked out as "[Page N]"
      7. <entry>/<key>/<sub> in report - an index is a different document type, root <index>
      8. figure without @number/@graphic - both are #REQUIRED
-->
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">

    <xsl:output method="xml" encoding="UTF-8" indent="yes" standalone="no"
                doctype-system="dtd/report.dtd"/>

    <!-- Identity -->
    <xsl:template match="@*|node()">
        <xsl:copy><xsl:apply-templates select="@*|node()"/></xsl:copy>
    </xsl:template>

    <!-- 7. An index is <index>, governed by index.dtd. The caller rewrites the DOCTYPE. -->
    <xsl:variable name="root-element">
        <xsl:choose>
            <xsl:when test="//entry">index</xsl:when>
            <xsl:otherwise>report</xsl:otherwise>
        </xsl:choose>
    </xsl:variable>

    <xsl:template match="/report">
        <xsl:element name="{$root-element}">
            <xsl:apply-templates select="@*"/>
            <!-- <title> is mandatory too. Where a document has none, the first section's
                 heading is the best reconstruction of it available. -->
            <xsl:choose>
                <xsl:when test="title"><xsl:apply-templates select="title"/></xsl:when>
                <xsl:otherwise><title><xsl:value-of select="(//section/head)[1]"/></title></xsl:otherwise>
            </xsl:choose>
            <!-- 1. subtitle is mandatory and must follow the title -->
            <xsl:choose>
                <xsl:when test="subtitle"><xsl:apply-templates select="subtitle"/></xsl:when>
                <xsl:otherwise><subtitle/></xsl:otherwise>
            </xsl:choose>
            <xsl:apply-templates select="node()[not(self::title or self::subtitle)]"/>
        </xsl:element>
    </xsl:template>

    <!-- 3. A section holding nothing but notes cannot have the <head> the DTD requires without
           publishing a spurious heading, so its notes move into the section before it. -->
    <xsl:template match="section[not(head)][note][not(para|table|figure|section|list|quote)]"/>

    <xsl:template match="section">
        <xsl:copy>
            <xsl:apply-templates select="@*"/>
            <!-- 2. Exactly one <head>, first. A leading section that has none takes the
                   document title, which is also the only way the title becomes visible. -->
            <xsl:if test="not(head)">
                <head><xsl:apply-templates select="/*/title/node()"/></head>
            </xsl:if>
            <xsl:apply-templates select="node()"/>
            <!-- pull in the notes from a dissolved notes-section immediately following -->
            <xsl:apply-templates
                select="following-sibling::*[1][self::section][not(head)][note]/note"/>
        </xsl:copy>
    </xsl:template>

    <!-- 4. div.table-wrap and p.table-caption are HTML that leaked into the XML. -->
    <xsl:template match="div[@class='table-wrap']">
        <xsl:apply-templates select="table"/>
    </xsl:template>
    <xsl:template match="p[@class='table-caption']"/>

    <xsl:template match="table">
        <xsl:variable name="caption"
                      select="../p[@class='table-caption'] | preceding-sibling::*[1][self::p][@class='table-caption']"/>
        <xsl:copy>
            <xsl:apply-templates select="@*"/>
            <xsl:if test="$caption and not(@number)">
                <xsl:attribute name="number"><xsl:value-of select="substring-after(@id, 't')"/></xsl:attribute>
            </xsl:if>
            <xsl:if test="$caption and not(head)">
                <head><xsl:apply-templates select="$caption/node()[not(self::strong)]"/></head>
            </xsl:if>
            <xsl:apply-templates select="node()"/>
        </xsl:copy>
    </xsl:template>

    <!-- 5. emph/@type is (b|i|p|d|c|k|u): "p" is the superscript, and there is no subscript. -->
    <xsl:template match="emph[@type='super']">
        <emph type="p"><xsl:apply-templates select="node()"/></emph>
    </xsl:template>
    <xsl:template match="emph[@type='sub']">
        <xsl:apply-templates select="node()"/>
    </xsl:template>

    <!-- 6. A page break that leaked into a table as bare text. <page> is legal between rows;
           inside a row it needs a cell, which is where BHO renders a marker for it anyway. -->
    <xsl:template match="table/text()[contains(., '[Page ')]">
        <page start="{normalize-space(substring-before(substring-after(., '[Page '), ']'))}"/>
    </xsl:template>
    <xsl:template match="tr/text()[contains(., '[Page ')]">
        <td><page start="{normalize-space(substring-before(substring-after(., '[Page '), ']'))}"/></td>
    </xsl:template>
    <!-- The same leak inside an index entry, where <page> is likewise allowed. -->
    <xsl:template match="entry/text()[contains(., '[Page ')]">
        <page start="{normalize-space(substring-before(substring-after(., '[Page '), ']'))}"/>
    </xsl:template>

    <!-- Text that escaped its cell - a stray "400" or ")" left in the row by segmentation.
         <tr> is (th|td)* and cannot hold it, so it is appended to the cell it follows, which
         keeps the value and leaves the column count alone. Text before any cell, or loose in
         the table itself, gets a cell (and a row) of its own. -->
    <xsl:template name="absorb-tail">
        <xsl:variable name="tail" select="following-sibling::node()[1][self::text()]"/>
        <xsl:if test="normalize-space($tail) != '' and not(contains($tail, '[Page '))">
            <xsl:value-of select="$tail"/>
        </xsl:if>
    </xsl:template>

    <xsl:template match="td | th">
        <xsl:copy>
            <xsl:apply-templates select="@*|node()"/>
            <xsl:call-template name="absorb-tail"/>
        </xsl:copy>
    </xsl:template>

    <xsl:template match="tr/text()[normalize-space()][not(preceding-sibling::td or preceding-sibling::th)]">
        <td><xsl:value-of select="."/></td>
    </xsl:template>

    <xsl:template match="table/text()[normalize-space()]">
        <tr><td><xsl:value-of select="."/></td></tr>
    </xsl:template>

    <!-- text already absorbed by the cell before it -->
    <xsl:template match="tr/text()[normalize-space()]"/>

    <!-- index.dtd has head as (#PCDATA|key|emph|addenda|ref|page|plt)* - a <sub> nested inside
         it is a sub-entry that belongs to the entry, as a sibling of the head. -->
    <xsl:template match="entry/head[sub]">
        <head><xsl:apply-templates select="@*|node()[not(self::sub)]"/></head>
        <xsl:apply-templates select="sub"/>
    </xsl:template>

    <!-- 8. Both are #REQUIRED on figure and plate. -->
    <xsl:template match="figure | plate">
        <xsl:copy>
            <xsl:apply-templates select="@*"/>
            <xsl:if test="not(@number)"><xsl:attribute name="number"/></xsl:if>
            <xsl:if test="not(@graphic)"><xsl:attribute name="graphic"/></xsl:if>
            <xsl:apply-templates select="node()"/>
        </xsl:copy>
    </xsl:template>

</xsl:stylesheet>
