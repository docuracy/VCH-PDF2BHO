<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
                xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xhtml="http://www.w3.org/1999/xhtml"
                exclude-result-prefixes="xhtml">

    <xsl:output method="html" encoding="UTF-8" indent="yes"/>

    <!-- Capture metadata from article element -->
    <xsl:variable name="pubid" select="//xhtml:article/@data-pubid"/>
    <xsl:variable name="title" select="//xhtml:article/xhtml:header[1]"/>
    <xsl:variable name="subtitle" select="//xhtml:article/xhtml:p[@id='subtitle']"/>

    <!-- Identity template for generic pass-through -->
    <xsl:template match="@*|node()">
        <xsl:copy>
            <xsl:apply-templates select="@*|node()"/>
        </xsl:copy>
    </xsl:template>

    <!-- Remove all comments -->
    <xsl:template match="comment()"/>

    <!-- Root: produce html/head/body -->
    <xsl:template match="xhtml:html">
        <html lang="en">
            <head>
                <meta charset="UTF-8"/>
                <title>
                    <xsl:value-of select="$title"/>
                </title>
                <xsl:apply-templates select="xhtml:head/*[not(self::xhtml:meta[@charset]) and not(self::xhtml:title)]"/>
            </head>
            <body data-pubid="{$pubid}">
                <!-- Navigation section with "In this section" links -->
                <xsl:call-template name="build-navigation"/>

                <!-- Main content wrapper -->
                <main role="main" aria-label="Main content">
                    <xsl:apply-templates select="xhtml:body/xhtml:article"/>
                </main>

                <!-- Footnotes section -->
                <xsl:if test="//xhtml:aside">
                    <footer role="contentinfo" aria-label="Footnotes">
                        <section class="footnotes" id="fns">
                            <header>
                                <h2>Notes</h2>
                            </header>
                            <ul>
                                <xsl:apply-templates select="//xhtml:aside" mode="footnotes"/>
                            </ul>
                        </section>
                    </footer>
                </xsl:if>
            </body>
        </html>
    </xsl:template>

    <!-- Build navigation with "In this section" nested list -->
    <xsl:template name="build-navigation">
        <nav role="navigation" aria-label="Table of contents">
            <header>
                <h2>In this section</h2>
            </header>
            <ul>
                <!-- Add the title as first item in TOC -->
                <xsl:if test="$title">
                    <li>
                        <a href="#title">
                            <xsl:value-of select="$title"/>
                        </a>

                        <!-- Build nested section structure -->
                        <xsl:variable name="sections" select="//xhtml:article/xhtml:section"/>
                        <xsl:if test="$sections">
                            <ul>
                                <xsl:apply-templates select="$sections" mode="toc"/>
                            </ul>
                        </xsl:if>
                    </li>
                </xsl:if>

                <!-- Link to footnotes -->
                <xsl:if test="//xhtml:aside">
                    <li>
                        <a href="#fns">Footnotes</a>
                    </li>
                </xsl:if>
            </ul>
        </nav>
    </xsl:template>

    <!-- Build TOC recursively for nested sections -->
    <xsl:template match="xhtml:section" mode="toc">
        <xsl:variable name="section-id">
            <xsl:call-template name="generate-section-id"/>
        </xsl:variable>

        <li>
            <a href="#{$section-id}">
                <xsl:value-of select="xhtml:header"/>
            </a>

            <!-- If this section has child sections, recurse -->
            <xsl:if test="xhtml:section">
                <ul>
                    <xsl:apply-templates select="xhtml:section" mode="toc"/>
                </ul>
            </xsl:if>
        </li>
    </xsl:template>

    <!-- Generate unique section IDs based on position in hierarchy -->
    <xsl:template name="generate-section-id">
        <xsl:variable name="depth" select="count(ancestor::xhtml:section) + 1"/>
        <xsl:text>section-</xsl:text>
        <xsl:for-each select="ancestor-or-self::xhtml:section">
            <xsl:value-of select="count(preceding-sibling::xhtml:section) + 1"/>
            <xsl:if test="position() != last()">
                <xsl:text>-</xsl:text>
            </xsl:if>
        </xsl:for-each>
    </xsl:template>

    <!-- Process article element -->
    <xsl:template match="xhtml:article">
        <article data-pubid="{@data-pubid}" role="article">
            <!-- Title -->
            <xsl:if test="xhtml:header[1]">
                <header id="title">
                    <h1>
                        <xsl:value-of select="xhtml:header[1]"/>
                    </h1>
                </header>
            </xsl:if>

            <!-- Subtitle -->
            <xsl:if test="$subtitle">
                <p id="subtitle" class="subtitle">
                    <xsl:apply-templates select="$subtitle/node()"/>
                </p>
            </xsl:if>

            <!-- Process remaining content, skipping first header and subtitle -->
            <xsl:apply-templates select="node()[not(generate-id() = generate-id($title)) and not(self::xhtml:p[@id='subtitle'])]"/>
        </article>
    </xsl:template>

    <!-- Process section elements with proper heading levels -->
    <xsl:template match="xhtml:section">
        <xsl:variable name="section-id">
            <xsl:call-template name="generate-section-id"/>
        </xsl:variable>

        <xsl:variable name="depth" select="count(ancestor::xhtml:section) + 1"/>

        <section id="{$section-id}" role="region">
            <xsl:if test="xhtml:header">
                <xsl:variable name="heading-level" select="$depth + 1"/>
                <xsl:element name="h{$heading-level}">
                    <xsl:apply-templates select="xhtml:header/node()"/>
                </xsl:element>
            </xsl:if>

            <!-- Process remaining content, skipping the header -->
            <xsl:apply-templates select="node()[not(self::xhtml:header)]"/>
        </section>
    </xsl:template>

    <!-- Skip section headers since we process them specially -->
    <xsl:template match="xhtml:section/xhtml:header"/>

    <!-- Helper template to extract filename from path -->
    <xsl:template name="get-filename">
        <xsl:param name="path"/>
        <xsl:choose>
            <xsl:when test="contains($path, '/')">
                <xsl:call-template name="get-filename">
                    <xsl:with-param name="path" select="substring-after($path, '/')"/>
                </xsl:call-template>
            </xsl:when>
            <xsl:otherwise>
                <xsl:value-of select="$path"/>
            </xsl:otherwise>
        </xsl:choose>
    </xsl:template>

    <!-- Convert <aside> in text to inline footnote link with title attribute -->
    <xsl:template match="xhtml:aside">
        <xsl:variable name="n" select="count(preceding::xhtml:aside) + 1"/>
        <xsl:variable name="footnote-text">
            <xsl:value-of select="."/>
        </xsl:variable>
        <a class="footnote" href="#fnn{$n}" id="fnr{$n}" title="{$footnote-text}" role="doc-noteref" aria-label="Footnote {$n}">
            <xsl:text> (fn. </xsl:text>
            <xsl:value-of select="$n"/>
            <xsl:text>)</xsl:text>
        </a>
    </xsl:template>

    <!-- Collect footnotes at bottom as ordered list items -->
    <xsl:template match="xhtml:aside" mode="footnotes">
        <xsl:variable name="n" select="count(preceding::xhtml:aside) + 1"/>
        <li class="footnote" id="fnn{$n}" value="{$n}" role="doc-endnote">
            <a href="#fnr{$n}" role="doc-backlink" aria-label="Back to reference {$n}">
                <xsl:value-of select="$n"/>
                <xsl:text>.</xsl:text>
            </a>
            <xsl:apply-templates/>
        </li>
    </xsl:template>

    <!-- Page breaks: transform hr.page-break to page marker -->
    <xsl:template match="xhtml:hr[@class='page-break']">
        <xsl:variable name="page-num">
            <xsl:choose>
                <xsl:when test="@data-start">
                    <xsl:value-of select="@data-start"/>
                </xsl:when>
                <xsl:otherwise>
                    <xsl:variable name="last-reset" select="preceding::xhtml:hr[@class='page-break'][@data-start][1]/@data-start"/>
                    <xsl:choose>
                        <xsl:when test="$last-reset">
                            <xsl:variable name="pages-since-reset" select="count(preceding::xhtml:hr[@class='page-break'][preceding::xhtml:hr[@class='page-break'][@data-start][1]/@data-start = $last-reset]) + 1"/>
                            <xsl:value-of select="number($last-reset) + $pages-since-reset"/>
                        </xsl:when>
                        <xsl:otherwise>
                            <xsl:value-of select="count(preceding::xhtml:hr[@class='page-break']) + 1"/>
                        </xsl:otherwise>
                    </xsl:choose>
                </xsl:otherwise>
            </xsl:choose>
        </xsl:variable>
        <p class="page-break" role="note" aria-label="Page {$page-num}">[Page <xsl:value-of select="$page-num"/>]</p>
    </xsl:template>

    <!-- Tables: add numbered caption -->
    <xsl:template match="xhtml:table">
        <table role="table">
            <xsl:apply-templates select="@*"/>
            <xsl:apply-templates select="node()"/>
        </table>
    </xsl:template>

    <!-- Process table captions with numbering -->
    <xsl:template match="xhtml:caption">
        <xsl:variable name="table-num">
            <xsl:choose>
                <xsl:when test="@data-start">
                    <xsl:value-of select="@data-start"/>
                </xsl:when>
                <xsl:otherwise>
                    <xsl:number level="any" count="xhtml:table"/>
                </xsl:otherwise>
            </xsl:choose>
        </xsl:variable>

        <caption>
            <strong>Table <xsl:value-of select="$table-num"/>: </strong>
            <xsl:apply-templates select="node()"/>
        </caption>
    </xsl:template>

    <!-- Figures: add numbered figcaption, alt text, construct BHO-style src URLs, and add error handling -->
    <xsl:template match="xhtml:figure">
        <xsl:variable name="fig-num">
            <xsl:choose>
                <xsl:when test="xhtml:figcaption/@data-start">
                    <xsl:value-of select="xhtml:figcaption/@data-start"/>
                </xsl:when>
                <xsl:otherwise>
                    <xsl:number level="any" count="xhtml:figure"/>
                </xsl:otherwise>
            </xsl:choose>
        </xsl:variable>

        <xsl:variable name="alt-text">
            <xsl:value-of select="xhtml:figcaption"/>
        </xsl:variable>

        <figure role="figure" aria-label="Figure {$fig-num}">
            <xsl:apply-templates select="@*"/>
            <xsl:for-each select="xhtml:img">
                <xsl:variable name="original-src" select="@src"/>

                <img>
                    <xsl:choose>
                        <xsl:when test="starts-with($original-src, 'data:')">
                            <xsl:attribute name="src">
                                <xsl:value-of select="$original-src"/>
                            </xsl:attribute>
                        </xsl:when>
                        <xsl:otherwise>
                            <xsl:variable name="filename">
                                <xsl:call-template name="get-filename">
                                    <xsl:with-param name="path" select="$original-src"/>
                                </xsl:call-template>
                            </xsl:variable>
                            <xsl:attribute name="src">
                                <xsl:text>/sites/default/files/publications/pubid-</xsl:text>
                                <xsl:value-of select="$pubid"/>
                                <xsl:text>/images/</xsl:text>
                                <xsl:value-of select="$filename"/>
                            </xsl:attribute>
                        </xsl:otherwise>
                    </xsl:choose>

                    <xsl:attribute name="alt">
                        <xsl:choose>
                            <xsl:when test="@alt">
                                <xsl:value-of select="@alt"/>
                            </xsl:when>
                            <xsl:otherwise>
                                <xsl:value-of select="$alt-text"/>
                            </xsl:otherwise>
                        </xsl:choose>
                    </xsl:attribute>

                    <xsl:attribute name="onerror">this.onerror=null; this.src='../images/fallback-image.jpg';</xsl:attribute>

                    <xsl:apply-templates select="@*[name() != 'src' and name() != 'alt']"/>
                </img>
            </xsl:for-each>

            <xsl:if test="xhtml:figcaption">
                <figcaption>
                    <strong>Figure <xsl:value-of select="$fig-num"/>: </strong>
                    <xsl:apply-templates select="xhtml:figcaption/node()"/>
                </figcaption>
            </xsl:if>
        </figure>
    </xsl:template>

    <!-- Skip figcaption in normal processing since we handle it in figure template -->
    <xsl:template match="xhtml:figcaption"/>

    <!-- Elements that should be copied to output without namespace -->
    <xsl:template match="xhtml:*">
        <xsl:element name="{local-name()}">
            <xsl:apply-templates select="@*|node()"/>
        </xsl:element>
    </xsl:template>

</xsl:stylesheet>