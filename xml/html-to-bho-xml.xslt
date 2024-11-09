<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
    <xsl:output method="xml" indent="yes"/>

    <!-- Template to match <p> elements with class="endnote" -->
    <xsl:template match="p[contains(@class, 'endnote')]">
        <note>
            <!-- Copy the idref attribute from the <span> into <note> -->
            <xsl:attribute name="idref">
                <xsl:value-of select="span/@idref"/>
            </xsl:attribute>
            <!-- Apply the rest of the templates (content inside <p>) -->
            <xsl:apply-templates select="node()[not(self::span)]"/>
        </note>
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

    <!-- Convert <p> elements to <para> elements, preserving attributes -->
    <xsl:template match="p">
        <para>
            <xsl:copy-of select="@*"/>
            <xsl:apply-templates/>
        </para>
    </xsl:template>

    <!-- Convert <i> elements to <emph type="i">, preserving attributes -->
    <xsl:template match="i">
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

    <!-- Convert <sup> elements to <ref>, preserving attributes -->
    <xsl:template match="sup">
        <ref>
            <xsl:copy-of select="@*"/>
            <xsl:apply-templates/>
        </ref>
    </xsl:template>

    <!-- Identity transform: copies everything as-is -->
    <xsl:template match="@*|node()">
        <xsl:copy>
            <xsl:apply-templates select="@*|node()"/>
        </xsl:copy>
    </xsl:template>

</xsl:stylesheet>
