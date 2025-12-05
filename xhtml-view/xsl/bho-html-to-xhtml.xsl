<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
                xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns="http://www.w3.org/1999/xhtml"
                xmlns:html="http://www.w3.org/1999/xhtml"
                exclude-result-prefixes="xsl html">

    <xsl:output method="xml" encoding="UTF-8" indent="yes" omit-xml-declaration="no"/>

    <!-- Main template -->
    <xsl:template match="/">
        <xsl:text disable-output-escaping="yes">&#10;&lt;!DOCTYPE html&gt;&#10;</xsl:text>
        <html xmlns="http://www.w3.org/1999/xhtml" lang="en">
            <head>
                <meta charset="UTF-8"/>
                <meta content="application/xhtml+xml"/>
            </head>
            <body>
                <xsl:apply-templates select="//html:article[contains(@class,'node-benefactor')] | //article[contains(@class,'node-benefactor')]"/>
            </body>
        </html>
    </xsl:template>

    <!-- Article template - match both namespaced and non-namespaced -->
    <xsl:template match="html:article[contains(@class,'node-benefactor')] | article[contains(@class,'node-benefactor')]">
        <article data-pubid="xxxxxx">
            <header>
                <xsl:value-of select=".//html:h1[@class='title'] | .//h1[@class='title'] | .//html:h1 | .//h1"/>
            </header>
            <hr class="page-break" data-start="1"/>
            <section>
                <!-- Process paragraphs and images, excluding footnotes div -->
                <xsl:apply-templates select=".//*[self::html:p or self::p or self::html:img or self::img][not(ancestor::html:div[@class='footnotes']) and not(ancestor::div[@class='footnotes'])]" mode="content"/>
            </section>
        </article>
    </xsl:template>

    <!-- Process paragraphs -->
    <xsl:template match="html:p | p" mode="content">
        <xsl:choose>
            <xsl:when test="normalize-space(.) = ''"/>
            <xsl:otherwise>
                <p>
                    <xsl:apply-templates select="node()" mode="inline"/>
                </p>
            </xsl:otherwise>
        </xsl:choose>
    </xsl:template>

    <!-- Process standalone images (outside paragraphs) -->
    <xsl:template match="html:img | img" mode="content">
        <figure>
            <img src="{@src}"/>
            <figcaption><xsl:value-of select="@title"/></figcaption>
        </figure>
    </xsl:template>

    <!-- Footnote link: convert to data -->
    <xsl:template match="html:a[starts-with(@href, '#ftn') and not(starts-with(@href, '#ftnref'))] | a[starts-with(@href, '#ftn') and not(starts-with(@href, '#ftnref'))]" mode="inline">
        <xsl:variable name="ftnref" select="substring-after(@href, '#ftn')"/>
        <xsl:variable name="footnote" select="//html:div[@id=concat('ftn', $ftnref)] | //div[@id=concat('ftn', $ftnref)]"/>
        <xsl:if test="$footnote">
            <data>
                <xsl:apply-templates select="$footnote/html:p/node()[not(self::html:a[starts-with(@href, '#ftnref')])] | $footnote/p/node()[not(self::a[starts-with(@href, '#ftnref')])]" mode="footnote"/>
            </data>
        </xsl:if>
    </xsl:template>

    <!-- Footnote mode templates -->
    <xsl:template match="text()" mode="footnote">
        <xsl:value-of select="."/>
    </xsl:template>

    <xsl:template match="html:em | em" mode="footnote">
        <i><xsl:apply-templates mode="footnote"/></i>
    </xsl:template>

    <xsl:template match="html:a[not(starts-with(@href, '#ftnref'))] | a[not(starts-with(@href, '#ftnref'))]" mode="footnote">
        <a href="{@href}"><xsl:apply-templates mode="footnote"/></a>
    </xsl:template>

    <xsl:template match="*" mode="footnote">
        <xsl:apply-templates mode="footnote"/>
    </xsl:template>

    <!-- Inline mode templates -->
    <xsl:template match="text()" mode="inline">
        <xsl:value-of select="."/>
    </xsl:template>

    <xsl:template match="html:em | em" mode="inline">
        <i><xsl:apply-templates mode="inline"/></i>
    </xsl:template>

    <xsl:template match="html:sup | sup" mode="inline">
        <sup><xsl:apply-templates mode="inline"/></sup>
    </xsl:template>

    <xsl:template match="*" mode="inline">
        <xsl:apply-templates mode="inline"/>
    </xsl:template>

</xsl:stylesheet>