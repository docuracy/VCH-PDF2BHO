<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
    <xsl:output method="xml" indent="yes" version="1.0" encoding="UTF-8" />

    <!-- Root Template to output the XML wrapper -->
    <xsl:template match="/">
        <xml>
            <!-- Apply templates to transform the rest of the document -->
            <xsl:apply-templates/>
        </xml>
    </xsl:template>

    <!-- Match <sup> elements containing <a> -->
    <xsl:template match="sup/a">
        <!-- Extract the value of the data-endnote attribute -->
        <xsl:variable name="idref" select="@data-endnote" />
        <ref idref="{$idref}">
            <xsl:value-of select="."/>
        </ref>
    </xsl:template>
    <xsl:template match="sup">
        <!-- Remove the <sup> tag, but process its children (like <a>) -->
        <xsl:apply-templates/>
    </xsl:template>

    <!-- Template to match <div> elements with class="endnote" -->
    <xsl:template match="div[contains(@class, 'endnote')]">
        <xsl:variable name="idref" select="a/@data-endnote" />
        <note id="n{$idref}" number="{$idref}">
            <xsl:apply-templates/>
        </note>
    </xsl:template>
    <!-- Special treatment for the <a> inside -->
    <xsl:template match="div[contains(@class, 'endnote')]/a">
        <xsl:value-of select="."/>
    </xsl:template>

    <!-- Template to match <div> elements with class="caption" -->
    <xsl:template match="div[contains(@class, 'caption')]">
        <xsl:variable name="number" select="@data-number" />
        <figure id="fig{$number}" number="{$number}" graphic="/images/fig{$number}.jpg">
            <title>
                <xsl:value-of select="."/>
            </title>
        </figure>
    </xsl:template>

    <!-- Template to remove <div> elements with class="drawing" -->
    <xsl:template match="div[contains(@class, 'drawing')]">
    </xsl:template>

    <!-- Template to match <div> elements with class="title" -->
    <xsl:template match="div[contains(@class, 'title')]">
        <title>
            <xsl:value-of select="h1"/>
        </title>
    </xsl:template>

    <!-- Template to match <div> elements with class="subtitle" -->
    <xsl:template match="div[contains(@class, 'subtitle')]">
        <subtitle>
            <xsl:value-of select="h2"/>
        </subtitle>
    </xsl:template>

    <!-- Template to match <div> elements with class="header" -->
    <xsl:template match="div[contains(@class, 'header')]">
        <section id="s{count(preceding::div[contains(@class, 'header') or contains(@class, 'paragraph')]) + 1}">
            <head>
                <xsl:value-of select="h3 | h4 | h5 | h6"/>
            </head>
        </section>
    </xsl:template>

    <!-- Convert <div class="paragraph"> elements to <para> elements, dropping attributes -->
    <xsl:template match="div[contains(@class, 'paragraph')]">
        <section id="s{count(preceding::div[contains(@class, 'header') or contains(@class, 'paragraph')]) + 1}">
            <para id="p{count(preceding::div[contains(@class, 'paragraph')]) + 1}">
                <xsl:apply-templates/>
            </para>
        </section>
    </xsl:template>

    <!-- Template to remove all image elements -->
    <xsl:template match="img">
        <!-- Empty template: do not copy <img> elements -->
    </xsl:template>

    <!-- Template to remove elements with class="remove" -->
    <xsl:template match="*[contains(@class, 'remove')]">
        <!-- Empty template: do not copy this element -->
    </xsl:template>

    <!-- Template to transform <p class="pageNum" start="..."> to <page start="..."/> -->
    <xsl:template match="p[contains(@class, 'pageNum')]">
        <page>
            <xsl:copy-of select="@start"/>
        </page>
    </xsl:template>

    <!-- Convert <em> elements to <emph type="i">, preserving attributes -->
    <xsl:template match="em">
        <emph type="i">
            <xsl:copy-of select="@*"/>
            <xsl:apply-templates/>
        </emph>
    </xsl:template>

    <!-- Convert <b> elements to <emph type="b">, preserving attributes -->
    <xsl:template match="b">
        <emph type="b">
            <xsl:copy-of select="@*"/>
            <xsl:apply-templates/>
        </emph>
    </xsl:template>

    <!-- Template to match <div> elements with class="table" -->
    <xsl:template match="div[contains(@class, 'table')]">
        <xsl:apply-templates/>
    </xsl:template>

    <!-- Remove class of table and apply numbering -->
    <xsl:template match="table">
        <table id="t{count(preceding::table) + 1}">
            <xsl:apply-templates/>
        </table>
    </xsl:template>

    <!-- Remove class of tr and apply numbering -->
    <xsl:template match="tr">
        <tr id="tr{count(preceding::tr) + 1}">
            <xsl:apply-templates/>
        </tr>
    </xsl:template>

    <!-- Remove wrapper around line-end hyphen -->
    <xsl:template match="span[contains(@class, 'line-end-hyphen')]">
        <xsl:apply-templates/>
    </xsl:template>

    <!-- Identity transform: copies everything as-is -->
    <xsl:template match="@*|node()">
        <xsl:copy>
            <xsl:apply-templates select="@*|node()"/>
        </xsl:copy>
    </xsl:template>

</xsl:stylesheet>
