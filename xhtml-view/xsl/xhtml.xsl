<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
                xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xhtml="http://www.w3.org/1999/xhtml"
                exclude-result-prefixes="xhtml">

    <xsl:output method="html" encoding="UTF-8" indent="yes"/>

    <!-- Capture metadata -->
    <xsl:variable name="pubid" select="//xhtml:meta[@data-pubid]/@data-pubid"/>
    <xsl:variable name="title" select="//xhtml:h1[@id='title'] | //xhtml:h2[@id='title']"/>
    <xsl:variable name="subtitle" select="//xhtml:p[@id='subtitle']"/>

    <!-- Identity template for generic pass-through -->
    <xsl:template match="@*|node()">
        <xsl:copy>
            <xsl:apply-templates select="@*|node()"/>
        </xsl:copy>
    </xsl:template>

    <!-- Root: produce html/head/body -->
    <xsl:template match="xhtml:html">
        <html>
            <head>
                <xsl:apply-templates select="xhtml:head/*[not(@data-xsl-ignore='true')]"/>
            </head>
            <body class="vch-report" data-pubid="{$pubid}">
                <!-- Header section with "In this section" links -->
                <xsl:call-template name="build-header"/>

                <!-- Main content -->
                <xsl:apply-templates select="xhtml:body/node()[not(self::xhtml:aside) and not(@data-xsl-ignore='true')]"/>

                <!-- Footnotes section -->
                <xsl:if test="//xhtml:aside">
                    <hr/>
                    <section class="footnotes" id="fns">
                        <h2>Notes</h2>
                        <xsl:apply-templates select="//xhtml:aside" mode="footnotes"/>
                    </section>
                </xsl:if>
            </body>
        </html>
    </xsl:template>

    <!-- Build header with "In this section" nested list -->
    <xsl:template name="build-header">
        <header class="header">
            <h2>In this section</h2>

            <ul>
                <!-- Add the title as first item in TOC -->
                <xsl:if test="$title">
                    <li>
                        <a href="#title">
                            <xsl:value-of select="$title"/>
                        </a>

                        <!-- H3 headings are nested inside the title -->
                        <xsl:if test="//xhtml:body//xhtml:h3[not(@id='title')]">
                            <ul>
                                <xsl:for-each select="//xhtml:body//xhtml:h3[not(@id='title')]">
                                    <xsl:variable name="current-h3" select="."/>
                                    <xsl:variable name="h3-num">
                                        <xsl:number level="any" from="xhtml:body" count="xhtml:h3[not(@id='title')]"/>
                                    </xsl:variable>

                                    <!-- Get H4 children: those that come after this H3 but before the next H3 -->
                                    <xsl:variable name="next-h3" select="following-sibling::xhtml:h3[not(@id='title')][1]"/>

                                    <li>
                                        <a href="#h3-s{$h3-num}">
                                            <xsl:value-of select="."/>
                                        </a>

                                        <!-- If this H3 has H4 children, add them in a nested ul -->
                                        <xsl:if test="$next-h3 and following-sibling::xhtml:h4[not(@id='title')][preceding-sibling::xhtml:h3[not(@id='title')][1][generate-id() = generate-id($current-h3)]]">
                                            <ul>
                                                <xsl:for-each select="following-sibling::xhtml:h4[not(@id='title')][preceding-sibling::xhtml:h3[not(@id='title')][1][generate-id() = generate-id($current-h3)]]">
                                                    <xsl:call-template name="output-h4-with-children">
                                                        <xsl:with-param name="h4" select="."/>
                                                    </xsl:call-template>
                                                </xsl:for-each>
                                            </ul>
                                        </xsl:if>

                                        <xsl:if test="not($next-h3) and following-sibling::xhtml:h4[not(@id='title')]">
                                            <ul>
                                                <xsl:for-each select="following-sibling::xhtml:h4[not(@id='title')]">
                                                    <xsl:call-template name="output-h4-with-children">
                                                        <xsl:with-param name="h4" select="."/>
                                                    </xsl:call-template>
                                                </xsl:for-each>
                                            </ul>
                                        </xsl:if>
                                    </li>
                                </xsl:for-each>
                            </ul>
                        </xsl:if>
                    </li>
                </xsl:if>
            </ul>

            <!-- Link to footnotes -->
            <xsl:if test="//xhtml:aside">
                <ul>
                    <a href="#fns">Footnotes</a>
                </ul>
            </xsl:if>
        </header>
    </xsl:template>

    <!-- Template to output H4 with its H5 children -->
    <xsl:template name="output-h4-with-children">
        <xsl:param name="h4"/>

        <xsl:variable name="h4-num">
            <xsl:for-each select="$h4">
                <xsl:number level="any" from="xhtml:body" count="xhtml:h4[not(@id='title')]"/>
            </xsl:for-each>
        </xsl:variable>

        <li>
            <a href="#h4-s{$h4-num}">
                <xsl:value-of select="$h4"/>
            </a>

            <!-- Get H5 children: those that come after this H4 but before the next H4 or H3 -->
            <xsl:variable name="next-h4" select="$h4/following-sibling::xhtml:h4[not(@id='title')][1]"/>
            <xsl:variable name="next-h3" select="$h4/following-sibling::xhtml:h3[not(@id='title')][1]"/>

            <xsl:variable name="has-h5-children">
                <xsl:choose>
                    <xsl:when test="$next-h4 and (not($next-h3) or generate-id($next-h4) &lt; generate-id($next-h3))">
                        <xsl:value-of select="count($h4/following-sibling::xhtml:h5[not(@id='title')][preceding-sibling::xhtml:h4[not(@id='title')][1][generate-id() = generate-id($h4)]]) > 0"/>
                    </xsl:when>
                    <xsl:when test="$next-h3 and (not($next-h4) or generate-id($next-h3) &lt; generate-id($next-h4))">
                        <xsl:value-of select="count($h4/following-sibling::xhtml:h5[not(@id='title')][preceding-sibling::xhtml:h4[not(@id='title')][1][generate-id() = generate-id($h4)]]) > 0"/>
                    </xsl:when>
                    <xsl:otherwise>
                        <xsl:value-of select="count($h4/following-sibling::xhtml:h5[not(@id='title')]) > 0"/>
                    </xsl:otherwise>
                </xsl:choose>
            </xsl:variable>

            <xsl:if test="$has-h5-children = 'true'">
                <ul>
                    <xsl:choose>
                        <xsl:when test="$next-h4 or $next-h3">
                            <xsl:for-each select="$h4/following-sibling::xhtml:h5[not(@id='title')][preceding-sibling::xhtml:h4[not(@id='title')][1][generate-id() = generate-id($h4)]]">
                                <xsl:variable name="h5-num">
                                    <xsl:number level="any" from="xhtml:body" count="xhtml:h5[not(@id='title')]"/>
                                </xsl:variable>

                                <li>
                                    <a href="#h5-s{$h5-num}">
                                        <xsl:value-of select="."/>
                                    </a>
                                </li>
                            </xsl:for-each>
                        </xsl:when>
                        <xsl:otherwise>
                            <xsl:for-each select="$h4/following-sibling::xhtml:h5[not(@id='title')]">
                                <xsl:variable name="h5-num">
                                    <xsl:number level="any" from="xhtml:body" count="xhtml:h5[not(@id='title')]"/>
                                </xsl:variable>

                                <li>
                                    <a href="#h5-s{$h5-num}">
                                        <xsl:value-of select="."/>
                                    </a>
                                </li>
                            </xsl:for-each>
                        </xsl:otherwise>
                    </xsl:choose>
                </ul>
            </xsl:if>
        </li>
    </xsl:template>

    <!-- Template to extract filename from path -->
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

    <!-- Title headings: output in content with id -->
    <xsl:template match="xhtml:h1[@id='title']">
        <h1 id="title">
            <xsl:apply-templates select="@*[name() != 'id']"/>
            <xsl:apply-templates select="node()"/>
        </h1>
    </xsl:template>

    <xsl:template match="xhtml:h2[@id='title']">
        <h2 id="title">
            <xsl:apply-templates select="@*[name() != 'id']"/>
            <xsl:apply-templates select="node()"/>
        </h2>
    </xsl:template>

    <!-- Subtitle: output normally -->
    <xsl:template match="xhtml:p[@id='subtitle']">
        <p id="subtitle">
            <xsl:apply-templates select="@*[name() != 'id']"/>
            <xsl:apply-templates select="node()"/>
        </p>
    </xsl:template>

    <!-- H2 headings: numbered with id -->
    <xsl:template match="xhtml:h2[not(@id='title')]">
        <xsl:variable name="h-num">
            <xsl:number level="any" from="xhtml:body" count="xhtml:h2[not(@id='title')]"/>
        </xsl:variable>
        <h2 id="h2-s{$h-num}">
            <xsl:apply-templates select="@*[name() != 'id']"/>
            <xsl:apply-templates select="node()"/>
        </h2>
    </xsl:template>

    <!-- H3 headings: numbered with id -->
    <xsl:template match="xhtml:h3[not(@id='title')]">
        <xsl:variable name="h-num">
            <xsl:number level="any" from="xhtml:body" count="xhtml:h3[not(@id='title')]"/>
        </xsl:variable>
        <h3 id="h3-s{$h-num}">
            <xsl:apply-templates select="@*[name() != 'id']"/>
            <xsl:apply-templates select="node()"/>
        </h3>
    </xsl:template>

    <!-- H4 headings: numbered with id -->
    <xsl:template match="xhtml:h4[not(@id='title')]">
        <xsl:variable name="h-num">
            <xsl:number level="any" from="xhtml:body" count="xhtml:h4[not(@id='title')]"/>
        </xsl:variable>
        <h4 id="h4-s{$h-num}">
            <xsl:apply-templates select="@*[name() != 'id']"/>
            <xsl:apply-templates select="node()"/>
        </h4>
    </xsl:template>

    <!-- H5 headings: numbered with id -->
    <xsl:template match="xhtml:h5[not(@id='title')]">
        <xsl:variable name="h-num">
            <xsl:number level="any" from="xhtml:body" count="xhtml:h5[not(@id='title')]"/>
        </xsl:variable>
        <h5 id="h5-s{$h-num}">
            <xsl:apply-templates select="@*[name() != 'id']"/>
            <xsl:apply-templates select="node()"/>
        </h5>
    </xsl:template>

    <!-- Paragraphs: numbered with id -->
    <xsl:template match="xhtml:p[not(@id='subtitle')]">
        <xsl:variable name="p-num">
            <xsl:choose>
                <xsl:when test="@data-idstart">
                    <xsl:value-of select="@data-idstart"/>
                </xsl:when>
                <xsl:otherwise>
                    <xsl:number level="any" from="xhtml:body" count="xhtml:p[not(@id='subtitle')]"/>
                </xsl:otherwise>
            </xsl:choose>
        </xsl:variable>
        <p id="p{$p-num}">
            <xsl:apply-templates select="@*[name() != 'id' and name() != 'data-idstart']"/>
            <xsl:apply-templates select="node()"/>
        </p>
    </xsl:template>

    <!-- Convert <aside> in text to inline footnote link (BHO format) with title attribute -->
    <xsl:template match="xhtml:aside">
        <xsl:variable name="n" select="count(preceding::xhtml:aside) + 1"/>
        <xsl:variable name="footnote-text">
            <xsl:value-of select="."/>
        </xsl:variable>
        <a class="footnote" href="#fnn{$n}" id="fnr{$n}" title="{$footnote-text}">
            <xsl:text> (fn. </xsl:text>
            <xsl:value-of select="$n"/>
            <xsl:text>)</xsl:text>
        </a>
    </xsl:template>

    <!-- Collect footnotes at bottom (BHO format) -->
    <xsl:template match="xhtml:aside" mode="footnotes">
        <xsl:variable name="n" select="count(preceding::xhtml:aside) + 1"/>
        <p class="footnote" id="fnn{$n}">
            <a href="#fnr{$n}">
                <xsl:value-of select="$n"/>
                <xsl:text>. </xsl:text>
            </a>
            <xsl:apply-templates/>
        </p>
    </xsl:template>

    <!-- Page breaks: transform hr.vch-page to page marker -->
    <xsl:template match="xhtml:hr[@class='vch-page']">
        <xsl:variable name="page-num">
            <xsl:choose>
                <xsl:when test="@data-idstart">
                    <xsl:value-of select="@data-idstart"/>
                </xsl:when>
                <xsl:otherwise>
                    <!-- Find the most recent preceding page break with data-idstart -->
                    <xsl:variable name="last-reset" select="preceding::xhtml:hr[@class='vch-page'][@data-idstart][1]/@data-idstart"/>
                    <xsl:choose>
                        <xsl:when test="$last-reset">
                            <!-- Count pages since the last reset and add to the reset value -->
                            <xsl:variable name="pages-since-reset" select="count(preceding::xhtml:hr[@class='vch-page'][preceding::xhtml:hr[@class='vch-page'][@data-idstart][1]/@data-idstart = $last-reset])"/>
                            <xsl:value-of select="number($last-reset) + $pages-since-reset"/>
                        </xsl:when>
                        <xsl:otherwise>
                            <!-- No reset found, use sequential numbering from 1 -->
                            <xsl:value-of select="count(preceding::xhtml:hr[@class='vch-page']) + 1"/>
                        </xsl:otherwise>
                    </xsl:choose>
                </xsl:otherwise>
            </xsl:choose>
        </xsl:variable>
        <p class="page-break">[Page <xsl:value-of select="$page-num"/>]</p>
    </xsl:template>

    <!-- Tables: wrap in div, add numbered caption -->
    <xsl:template match="xhtml:table">
        <xsl:variable name="table-num">
            <xsl:choose>
                <xsl:when test="xhtml:caption/@data-idstart">
                    <xsl:value-of select="xhtml:caption/@data-idstart"/>
                </xsl:when>
                <xsl:otherwise>
                    <xsl:number level="any" count="xhtml:table"/>
                </xsl:otherwise>
            </xsl:choose>
        </xsl:variable>

        <div class="table-wrap">
            <xsl:if test="xhtml:caption">
                <p class="table-caption">
                    <strong>Table <xsl:value-of select="$table-num"/>: </strong>
                    <xsl:apply-templates select="xhtml:caption/node()"/>
                </p>
            </xsl:if>
            <table>
                <xsl:apply-templates select="@*"/>
                <xsl:apply-templates select="xhtml:thead | xhtml:tbody | xhtml:tr"/>
            </table>
        </div>
    </xsl:template>

    <!-- Skip caption in normal processing -->
    <xsl:template match="xhtml:caption"/>

    <!-- Figures: add numbered figcaption, alt text, and construct BHO-style src URLs -->
    <xsl:template match="xhtml:figure">
        <xsl:variable name="fig-num">
            <xsl:choose>
                <xsl:when test="xhtml:figcaption/@data-idstart">
                    <xsl:value-of select="xhtml:figcaption/@data-idstart"/>
                </xsl:when>
                <xsl:otherwise>
                    <xsl:number level="any" count="xhtml:figure"/>
                </xsl:otherwise>
            </xsl:choose>
        </xsl:variable>

        <xsl:variable name="alt-text">
            <xsl:value-of select="xhtml:figcaption"/>
        </xsl:variable>

        <figure>
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

    <!-- Ignore elements with data-xsl-ignore="true" -->
    <xsl:template match="*[@data-xsl-ignore='true']"/>

    <!-- Elements that should be copied to output without namespace -->
    <xsl:template match="xhtml:*">
        <xsl:element name="{local-name()}">
            <xsl:apply-templates select="@*|node()"/>
        </xsl:element>
    </xsl:template>

</xsl:stylesheet>