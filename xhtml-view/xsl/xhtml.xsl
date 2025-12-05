<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="3.0"
                xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xhtml="http://www.w3.org/1999/xhtml"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:local="http://local-functions"
                exclude-result-prefixes="xhtml xs local">

    <xsl:output method="html" encoding="UTF-8" indent="yes" html-version="5"/>

    <!-- Capture metadata from article element -->
    <xsl:variable name="pubid" select="//xhtml:article/@data-pubid"/>
    <xsl:variable name="title" select="//xhtml:article/xhtml:header[1]"/>
    <xsl:variable name="subtitle" select="//xhtml:article/xhtml:p[@id='subtitle']"/>

    <!-- Cache expensive queries -->
    <xsl:variable name="all-data" select="//xhtml:data"/>

    <!-- Pre-index footnotes for O(1) lookup instead of O(n) counting -->
    <xsl:key name="data-by-id" match="xhtml:data" use="generate-id()"/>

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
                <xsl:if test="$all-data">
                    <footer role="contentinfo" aria-label="Footnotes">
                        <section class="footnotes" id="fns">
                            <header>
                                <h2>Notes</h2>
                            </header>
                            <ul>
                                <xsl:choose>
                                    <!-- If pre-processed, use the attributes -->
                                    <xsl:when test="$all-data[1]/@data-fn-num">
                                        <xsl:for-each select="$all-data">
                                            <xsl:variable name="n" select="@data-fn-num"/>
                                            <li class="footnote" id="fnn{$n}" value="{$n}" role="doc-endnote">
                                                <a href="#fnr{$n}" role="doc-backlink" aria-label="Back to reference {$n}">
                                                    <xsl:value-of select="$n"/>
                                                    <xsl:text>.</xsl:text>
                                                </a>
                                                <xsl:apply-templates select="node()"/>
                                            </li>
                                        </xsl:for-each>
                                    </xsl:when>
                                    <!-- Otherwise use position() -->
                                    <xsl:otherwise>
                                        <xsl:for-each select="$all-data">
                                            <xsl:variable name="n" select="position()"/>
                                            <li class="footnote" id="fnn{$n}" value="{$n}" role="doc-endnote">
                                                <a href="#fnr{$n}" role="doc-backlink" aria-label="Back to reference {$n}">
                                                    <xsl:value-of select="$n"/>
                                                    <xsl:text>.</xsl:text>
                                                </a>
                                                <xsl:apply-templates select="node()"/>
                                            </li>
                                        </xsl:for-each>
                                    </xsl:otherwise>
                                </xsl:choose>
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
                <xsl:if test="$all-data">
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
        <xsl:text>section-</xsl:text>
        <xsl:value-of select="string-join(
            for $s in ancestor-or-self::xhtml:section
            return string(count($s/preceding-sibling::xhtml:section) + 1),
            '-'
        )"/>
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
    <xsl:function name="local:get-filename" as="xs:string">
        <xsl:param name="path" as="xs:string"/>
        <xsl:sequence select="tokenize($path, '/')[last()]"/>
    </xsl:function>

    <!-- Convert <data> in text to inline footnote link with title attribute -->
    <xsl:template match="xhtml:data">
        <xsl:variable name="n">
            <xsl:choose>
                <!-- Use pre-processed number if available -->
                <xsl:when test="@data-fn-num">
                    <xsl:value-of select="@data-fn-num"/>
                </xsl:when>
                <!-- Fall back to expensive counting -->
                <xsl:otherwise>
                    <xsl:value-of select="index-of($all-data/generate-id(), generate-id(.))"/>
                </xsl:otherwise>
            </xsl:choose>
        </xsl:variable>
        <a class="footnote" href="#fnn{$n}" id="fnr{$n}" title="{.}" role="doc-noteref" aria-label="Footnote {$n}">
            <xsl:text> (fn. </xsl:text>
            <xsl:value-of select="$n"/>
            <xsl:text>)</xsl:text>
        </a>
    </xsl:template>

    <!-- Page breaks: transform hr.page-break to page marker -->
    <xsl:template match="xhtml:hr[@class='page-break']">
        <xsl:variable name="page-num">
            <xsl:choose>
                <!-- Use pre-processed number if available -->
                <xsl:when test="@data-page-num">
                    <xsl:value-of select="@data-page-num"/>
                </xsl:when>
                <!-- Fall back to expensive calculation -->
                <xsl:otherwise>
                    <xsl:choose>
                        <xsl:when test="@data-start">
                            <xsl:value-of select="@data-start"/>
                        </xsl:when>
                        <xsl:otherwise>
                            <xsl:variable name="last-reset" select="preceding::xhtml:hr[@class='page-break'][@data-start][1]/@data-start"/>
                            <xsl:choose>
                                <xsl:when test="$last-reset">
                                    <xsl:variable name="pages-since-reset" select="count(preceding::xhtml:hr[@class='page-break'][preceding::xhtml:hr[@class='page-break'][@data-start][1]/@data-start = $last-reset]) + 1"/>
                                    <xsl:value-of select="xs:integer($last-reset) + $pages-since-reset"/>
                                </xsl:when>
                                <xsl:otherwise>
                                    <xsl:value-of select="count(preceding::xhtml:hr[@class='page-break']) + 1"/>
                                </xsl:otherwise>
                            </xsl:choose>
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

        <xsl:variable name="alt-text" select="string(xhtml:figcaption)"/>

        <figure role="figure" aria-label="Figure {$fig-num}">
            <xsl:apply-templates select="@*"/>
            <xsl:for-each select="xhtml:img">
                <xsl:variable name="original-src" select="@src"/>

                <img>
                    <xsl:choose>
                        <xsl:when test="starts-with($original-src, 'data:')">
                            <xsl:attribute name="src" select="$original-src"/>
                        </xsl:when>
                        <xsl:otherwise>
                            <xsl:variable name="filename" select="local:get-filename($original-src)"/>
                            <xsl:attribute name="src" select="concat('/sites/default/files/publications/pubid-', $pubid, '/images/', $filename)"/>
                        </xsl:otherwise>
                    </xsl:choose>

                    <xsl:attribute name="alt" select="if (@alt) then @alt else $alt-text"/>
                    <xsl:attribute name="onerror">this.onerror=null; this.src='./images/fallback-image.png';</xsl:attribute>

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