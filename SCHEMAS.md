# SCHEMAS AND XSLT STYLESHEETS USED IN BHO

## BHO XML SCHEMA

Part of the difficulty in implementing this project has been the lack of adequate documentation on the BHO XML schema.
It appears to follow a hierarchical structure rooted in a `<report>` element, relying heavily on recursive `<section>`
tags for structure, and a linked reference/note system for citations.

For example, a minimal valid BHO XML document might look like this:

```xml
<?xml version="1.0" encoding="utf-8" standalone="no"?>
<!DOCTYPE report SYSTEM "dtd/report.dtd">
<report id="155040" pubid="1516" publish="true">
    <title>Nettlebed</title>
    <subtitle></subtitle>
    <page start="275"/>

    <section id="s1">
        <head>NETTLEBED</head>
        <para id="p1">
            Nettlebed lies in the Chiltern hills c.8 km north-west of Henley-on-Thames.
            <ref idref="n1">1</ref>
            The village developed along the main Oxford-Henley road...
        </para>

        <section id="s2">
            <head>PARISH BOUNDARIES</head>
            <para id="p2">
                Until 1952 the ancient parish covered 1,172 acres.
                <ref idref="n2">2</ref>
                Its northern and eastern boundaries...
            </para>
        </section>

        <section id="s3">
            <head>LANDSCAPE</head>
            <para id="p3">Nettlebed is a hilltop village towards the south-western end of the Chiltern hills...</para>
            <page start="276"/>
            <figure id="fig75" number="75" graphic="/images/fig75.jpg">
                <title>
                    <emph type="i">Nettlebed parish in 1840. (For common see also Fig. 80.)</emph>
                </title>
            </figure>
            <para id="p4">The view from Windmill Hill was much admired in the late 19th century...</para>
        </section>

        <section id="s4">
            <head>COMMUNICATIONS</head>
            <section id="s5">
                <head>
                    <emph type="i">Roads</emph>
                </head>
                <para id="p5">The village developed along the Oxford-Henley road...</para>
            </section>
            <section id="s6">
                <head>
                    <emph type="i">Coaching, Carriers, and Post</emph>
                    <ref idref="n3">15</ref>
                </head>
                <para id="p6">From the mid 17th century Nettlebed's location on a main Oxford-London road...</para>
            </section>
        </section>

        <section id="s7notes">
            <note id="n1" number="1">This account was written in 2011 and revised in 2015.</note>
            <note id="n2" number="2">OS <emph type="i">Area Bk</emph> (1878); <emph type="i">Census</emph>, 1891&ndash;1961.
                For boundaries, OHC, tithe map; OS Maps 6", Oxon. L and LIII (1883 edn).
            </note>
            <note id="n3" number="3">For Nettlebed's inns, below, econ. hist. (trades); social hist.
                (1500&ndash;1800).
            </note>
        </section>
    </section>
</report>
```

## BHO XSLT STYLESHEET EXAMPLE

This is a cleaned-up version of the XSLT stylesheet (named "Report 2") used by BHO to transform XML into HTML for web
presentation:

```xml
<?xml version="1.0" encoding="ISO-8859-1"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">

    <!--
        === GLOBAL VARIABLES ===
        Extract publication ID from the input <report>.
    -->
    <xsl:variable name="pubid_number" select="/report/@pubid"/>


    <!--
        === ROOT TEMPLATE (REPORT) ===
        Builds the basic HTML structure, optional table of contents,
        inner content, and footnotes.
    -->
    <xsl:template match="report">
        <html>

            <!-- Optional header containing TOC & footnote link -->
            <xsl:if test="count(//section/head) > 1 or (//note)">
                <header class="header">

                    <!-- Table of contents: only included if multiple heads exist -->
                    <xsl:if test="count(//section/head) > 1">
                        <h2>In this section</h2>
                        <ul>
                            <xsl:apply-templates select="section/head | section/section/head"
                                                 mode="table-of-contents"/>
                        </ul>
                    </xsl:if>

                    <!-- Footnote link only included if notes exist -->
                    <xsl:if test="//note">
                        <ul>
                            <a href="#fns">Footnotes</a>
                        </ul>
                    </xsl:if>

                </header>
            </xsl:if>

            <div class="inner">
                <xsl:apply-templates/>
            </div>

            <!-- Footnotes rendered at the bottom of the output -->
            <xsl:if test="//note">
                <footer class="footnotes">
                    <h2 id="fns" name="fns">Footnotes</h2>
                    <ul>
                        <xsl:apply-templates select="//note" mode="footnotes"/>
                    </ul>
                </footer>
            </xsl:if>

        </html>
    </xsl:template>


    <!--
        === HEADINGS (SECTION STRUCTURE) ===
        Each heading level produces an HTML heading with an ID anchor.
    -->
    <xsl:template match="report/section/head">
        <h2 id="h2-{../@id}">
            <xsl:apply-templates/>
        </h2>
    </xsl:template>

    <xsl:template match="report/section/section/head">
        <h3 id="h3-{../@id}">
            <xsl:apply-templates/>
        </h3>
    </xsl:template>

    <xsl:template match="/report/section/section/section/head">
        <h4>
            <xsl:apply-templates/>
        </h4>
    </xsl:template>

    <xsl:template match="/report/section/section/section/section/head">
        <h5>
            <xsl:apply-templates/>
        </h5>
    </xsl:template>


    <!--
        === TABLE OF CONTENTS OUTPUT (MODE: table-of-contents) ===
        Produces nested <ul>/<li> links pointing to generated headings.
    -->
    <xsl:template match="report/section/head" mode="table-of-contents">
        <li>
            <a href="#h2-{../@id}">
                <xsl:apply-templates select="./text() | emph"/>
            </a>
        </li>
    </xsl:template>

    <xsl:template match="report/section/section/head" mode="table-of-contents">
        <ul>
            <li>
                <a href="#h3-{../@id}">
                    <xsl:apply-templates select="./text() | emph"/>
                </a>
            </li>
        </ul>
    </xsl:template>


    <!--
        === SUPPRESSED ELEMENTS ===
        Titles, subtitles, group heads, etc., removed from output.
    -->
    <xsl:template match="/report/title"/>
    <xsl:template match="/report/subtitle"/>
    <xsl:template match="group/head"/>
    <xsl:template match="/index/title"/>
    <xsl:template match="/index/subtitle"/>
    <xsl:template match="dsclass[@showcolumn='False']"/>
    <xsl:template match="dsclass/description"/>
    <xsl:template match="dsclass/shortdesc"/>
    <xsl:template match="dsclass/scale"/>


    <!--
        === LISTS AND PARAGRAPHS ===
        Handles paragraph IDs, list structures, and their headings.
    -->
    <xsl:template match="list/head">
        <p>
            <a name="{../@id}"/>
            <b>
                <xsl:apply-templates/>
            </b>
        </p>
    </xsl:template>

    <xsl:template match="list">
        <ul>
            <xsl:apply-templates/>
        </ul>
    </xsl:template>

    <xsl:template match="li">
        <li>
            <xsl:apply-templates/>
        </li>
    </xsl:template>

    <xsl:template match="para">
        <p id="{@id}">
            <xsl:apply-templates/>
        </p>
    </xsl:template>


    <!--
        === FIGURES AND CAPTIONS ===
        Handles visible/invisible images, publication-image paths,
        and caption formatting.
    -->
    <xsl:template match="figure[@visible='false']">
        <figure class="image">
            <img src="/sites/default/files/default_images/restricted.jpg" class="img-responsive"/>
            <figcaption>
                <xsl:choose>
                    <xsl:when test="@number='' or not(@number)">
                        <xsl:apply-templates/>
                    </xsl:when>
                    <xsl:otherwise>
                        <b>Figure <xsl:value-of select="@number"/>:
                        </b>
                        <xsl:apply-templates/>
                    </xsl:otherwise>
                </xsl:choose>
            </figcaption>
        </figure>
    </xsl:template>

    <xsl:template match="figure">
        <figure class="image">
            <xsl:variable name="graphic_trimmed" select="substring(@graphic, 9)"/>
            <img src="/sites/default/files/publications/pubid-{($pubid_number)}/images/{($graphic_trimmed)}"
                 class="img-responsive"/>

            <figcaption>
                <xsl:choose>
                    <xsl:when test="@number='' or not(@number)">
                        <xsl:apply-templates/>
                    </xsl:when>
                    <xsl:otherwise>
                        <b>Figure <xsl:value-of select="@number"/>:
                        </b>
                        <xsl:apply-templates/>
                    </xsl:otherwise>
                </xsl:choose>
            </figcaption>
        </figure>
    </xsl:template>

    <xsl:template match="figure/title">
        <p class="fig-title">
            <b>
                <xsl:apply-templates/>
            </b>
        </p>
    </xsl:template>

    <xsl:template match="figure/caption">
        <p class="fig-caption">
            <xsl:apply-templates/>
        </p>
    </xsl:template>


    <!--
        === EMPHASIS HANDLING ===
        Converts emph types to appropriate HTML tags.
    -->
    <xsl:template match="emph">
        <xsl:choose>
            <xsl:when test="@type='i'">
                <em>
                    <xsl:apply-templates/>
                </em>
            </xsl:when>
            <xsl:when test="@type='b'">
                <strong>
                    <xsl:apply-templates/>
                </strong>
            </xsl:when>
            <xsl:when test="@type='p'">
                <small>
                    <sup>
                        <xsl:apply-templates/>
                    </sup>
                </small>
            </xsl:when>
            <xsl:when test="@type='d'">
                <small>
                    <xsl:apply-templates/>
                </small>
            </xsl:when>
            <xsl:when test="@type='k'">
                <strike>
                    <xsl:apply-templates/>
                </strike>
            </xsl:when>
            <xsl:when test="@type='u'">
                <u>
                    <xsl:apply-templates/>
                </u>
            </xsl:when>
            <xsl:otherwise>
                <xsl:apply-templates/>
            </xsl:otherwise>
        </xsl:choose>
    </xsl:template>


    <!--
        === FOOTNOTE REFERENCES ===
        Generates anchors linking to rendered footnotes.
    -->
    <xsl:template match="ref">
        <xsl:variable name="get-text" select="following-sibling::text()[1]"/>
        <xsl:text> </xsl:text>
        <a href="#fn{@idref}" name="anchor{@idref}">
            (fn. <xsl:value-of select="substring(@idref, 2)"/>)
        </a>
        <xsl:choose>
            <xsl:when test="starts-with($get-text, ';') or
                            starts-with($get-text, '.') or
                            starts-with($get-text, ',') or
                            starts-with($get-text, ' ')"/>
            <xsl:otherwise>
                <xsl:text> </xsl:text>
            </xsl:otherwise>
        </xsl:choose>
    </xsl:template>


    <!--
        === FOOTNOTE OUTPUT (MODE: footnotes) ===
        Produces numbered list items at page bottom.
    -->
    <xsl:template match="note" mode="footnotes">
        <a id="fn{@id}">
            <li>
                <a href="#anchor{@id}">
                    <xsl:value-of select="substring(@id, 2)"/>
                </a>
                .
                <xsl:apply-templates select="./text() | table | emph"/>
            </li>
        </a>
    </xsl:template>

    <!-- Suppress footnotes inside main flow: only output in footer -->
    <xsl:template match="note"/>


    <!--
        === PAGE MARKERS ===
        Renders page numbers differently depending on context.
    -->
    <xsl:template match="page">
        <xsl:choose>
            <xsl:when test="not(ancestor::tr)">
                <tr class="page-row">
                    <td class="page-number" colspan="999">[Page <xsl:value-of select="@start"/>]
                    </td>
                </tr>
            </xsl:when>
            <xsl:otherwise>
                <div class="page-number">[Page <xsl:value-of select="@start"/>]
                </div>
            </xsl:otherwise>
        </xsl:choose>
    </xsl:template>


    <!--
        === ENTRY STRUCTURES (INDEX-STYLE) ===
        Handles <entry>, <key>, <sub>, <sub/sub>.
    -->
    <xsl:template match="entry">
        <p>
            <xsl:apply-templates/>
        </p>
    </xsl:template>

    <xsl:template match="//entry/head">
        <xsl:apply-templates/>
    </xsl:template>

    <xsl:template match="key">
        <b>
            <xsl:apply-templates/>
        </b>
    </xsl:template>

    <xsl:template match="//entry/sub"><br/>-,
        <xsl:apply-templates/>
    </xsl:template>

    <xsl:template match="//entry/sub/sub"><br/>-,-,
        <xsl:apply-templates/>
    </xsl:template>


    <!--
        === INDEXED HEADINGS (FOR index MODE) ===
    -->
    <xsl:template match="/index/section/head">
        <h1 id="{../@id}">
            <xsl:apply-templates/>
        </h1>
    </xsl:template>

    <xsl:template match="/index/section/section/head">
        <h2 id="{../@id}">
            <xsl:apply-templates/>
        </h2>
    </xsl:template>


    <!--
        === TABLES ===
        Wraps table, builds caption, headings, rows, and cell anchors.
    -->
    <xsl:template match="table">
        <div class="table-wrap">
            <table>
                <caption>
                    <a name="mt{ @id }"/>
                    <xsl:if test="@number">
                        <b>Table
                            <xsl:value-of select="@number"/>
                        </b>
                        <br/>
                    </xsl:if>
                    <xsl:value-of select="head"/>
                </caption>
                <xsl:apply-templates/>
            </table>
        </div>
    </xsl:template>

    <xsl:template match="tr">
        <tr valign="top">
            <xsl:apply-templates/>
        </tr>
    </xsl:template>

    <xsl:template match="th">
        <th>
            <xsl:if test="@cols">
                <xsl:attribute name="colspan">
                    <xsl:value-of select="@cols"/>
                </xsl:attribute>
            </xsl:if>
            <xsl:if test="@rows">
                <xsl:attribute name="rowspan">
                    <xsl:value-of select="@rows"/>
                </xsl:attribute>
            </xsl:if>
            <xsl:apply-templates/>
        </th>
    </xsl:template>

    <xsl:template match="td">
        <td>
            <xsl:if test="@cols">
                <xsl:attribute name="colspan">
                    <xsl:value-of select="@cols"/>
                </xsl:attribute>
            </xsl:if>
            <xsl:if test="@rows">
                <xsl:attribute name="rowspan">
                    <xsl:value-of select="@rows"/>
                </xsl:attribute>
            </xsl:if>

            <a name="m{ ../../@id }-{ count(../preceding-sibling::*)+1 }"/>
            <xsl:apply-templates/>
        </td>
    </xsl:template>


    <!--
        === QUOTES ===
        Formats quotations and sources.
    -->
    <xsl:template match="quote">
        <blockquote>
            <xsl:for-each select="quotext">
                <p>
                    <xsl:for-each select="quoline">
                        <br/>
                        <xsl:apply-templates/>
                    </xsl:for-each>
                </p>
            </xsl:for-each>
            <footer>
                <cite>
                    <xsl:value-of select="quosource"/>
                </cite>
            </footer>
        </blockquote>
    </xsl:template>


    <!--
        === SPECIAL INDEX STRUCTURES (LONDON INHABITANTS) ===
        Handles <name>, <nhead>, <nkey>, <nsub>.
    -->
    <xsl:template match="name">
        <p class="index" name="{ concat('p', count(preceding-sibling::*)) }">
            <xsl:apply-templates/>
        </p>
    </xsl:template>

    <xsl:template match="nhead">
        <xsl:apply-templates/>
    </xsl:template>

    <xsl:template match="nkey">
        <strong>
            <xsl:apply-templates/>
        </strong>
        ,
    </xsl:template>

    <xsl:template match="nsub">
        <br/>
        <xsl:apply-templates/>
    </xsl:template>


    <!--
        === DATASET TABLES (SCHEMA 2) ===
        Handles dataset rows & selective column visibility.
    -->
    <xsl:template match="dataset">
        <table id="t1" class="dataset">
            <xsl:apply-templates/>
        </table>
    </xsl:template>

    <xsl:template match="dsclass/label">
        <td>
            <b>
                <xsl:apply-templates/>
            </b>
            <br/>
            <xsl:apply-templates select="following-sibling::*[1]" mode="copy"/>
        </td>
    </xsl:template>

    <xsl:template match="dsrecord">
        <xsl:if test="/report/@pubid='272'">
            <tr>
                <td>
                    <xsl:apply-templates select="prop[@class='c0']"/>
                </td>
                <td>
                    <xsl:apply-templates select="prop[@class='c1']"/>
                </td>
                <td>
                    <xsl:apply-templates select="prop[@class='c2']"/>
                </td>
                <td>
                    <xsl:apply-templates select="prop[@class='c3']"/>
                </td>
            </tr>
        </xsl:if>
        <xsl:if test="/report/@pubid='345'">
            <tr>
                <td>
                    <xsl:apply-templates select="prop[@class='c0']"/>
                </td>
                <td>
                    <xsl:apply-templates select="prop[@class='c2']"/>
                </td>
                <td>
                    <xsl:apply-templates select="prop[@class='c4']"/>
                </td>
            </tr>
        </xsl:if>
    </xsl:template>


    <!--
        === LINKS ===
        Copies <a href="..."> into HTML <a>.
    -->
    <xsl:template match="a">
        <a href="{@href}">
            <xsl:apply-templates/>
        </a>
    </xsl:template>

</xsl:stylesheet>
```

## VCH XHTML SCHEMA

The schema for the VCH XHTML format used in this application is relatively simple, designed to capture the essential
structure and formatting of VCH content while remaining easy to edit and convert. It uses standard XHTML5 elements with
a few custom attributes for specific needs. See
the [template.xhtml](https://raw.githubusercontent.com/docuracy/VCH-PDF2BHO/refs/heads/master/xhtml-view/template.xhtml)
and [example.xhtml](https://raw.githubusercontent.com/docuracy/VCH-PDF2BHO/refs/heads/master/xhtml-view/example.xhtml)
files in the repository for reference.

## VCH XHTML TO BHO XML XSLT STYLESHEET

The XSLT stylesheet used in this
project [here](https://raw.githubusercontent.com/docuracy/VCH-PDF2BHO/refs/heads/master/xhtml-view/xsl/xhtml.xsl) could
be used on the BHO platform to convert VCH XHTML directly into the HTML required for display, bypassing the need for
intermediate BHO XML generation.