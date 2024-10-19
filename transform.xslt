<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
    <xsl:output method="xml" indent="yes"/>

    <!-- Template to match the document root and apply templates to its children -->
    <xsl:template match="/document">
        <xsl:apply-templates select="page"/>
    </xsl:template>

    <!-- Template to copy each page element and its attributes -->
    <xsl:template match="page">
        <xsl:copy>
            <xsl:copy-of select="@*"/> <!-- Copy all attributes of <page> -->
            <xsl:apply-templates select="*"/> <!-- Process all children of <page> -->
        </xsl:copy>
    </xsl:template>

    <!-- Template for item to copy attributes and text -->
    <xsl:template match="item">
        <item>
            <xsl:copy-of select="@*"/> <!-- Copy all attributes -->
            <xsl:value-of select="."/> <!-- Copy text content -->
        </item>
    </xsl:template>

<!--    &lt;!&ndash; Merge consecutive items with matching n, s, f, and d attributes &ndash;&gt;-->
<!--    <xsl:template match="item[-->
<!--        @n = following-sibling::item[1]/@n and -->
<!--        @s = following-sibling::item[1]/@s and -->
<!--        @f = following-sibling::item[1]/@f and -->
<!--        @d = following-sibling::item[1]/@d-->
<!--    ]">-->
<!--        <xsl:copy>-->
<!--            <xsl:apply-templates select="@*"/>-->
<!--            &lt;!&ndash; Loop through the consecutive matching items and concatenate their content &ndash;&gt;-->
<!--            <xsl:variable name="mergedContent">-->
<!--                <xsl:for-each select="following-sibling::item[-->
<!--                    @n = current()/@n and -->
<!--                    @s = current()/@s and -->
<!--                    @f = current()/@f and -->
<!--                    @d = current()/@d-->
<!--                ] | current()">-->
<!--                    <xsl:value-of select="."/>-->
<!--                    &lt;!&ndash; Insert a space between merged content &ndash;&gt;-->
<!--                    <xsl:if test="position() != last()">-->
<!--                        <xsl:text> </xsl:text>-->
<!--                    </xsl:if>-->
<!--                </xsl:for-each>-->
<!--            </xsl:variable>-->
<!--            <xsl:value-of select="$mergedContent"/>-->
<!--        </xsl:copy>-->
<!--        &lt;!&ndash; Skip over the merged following-sibling items &ndash;&gt;-->
<!--        <xsl:apply-templates select="following-sibling::item[-->
<!--            not(@n = current()/@n and -->
<!--                @s = current()/@s and -->
<!--                @f = current()/@f and -->
<!--                @d = current()/@d-->
<!--            )-->
<!--        ]"/>-->
<!--    </xsl:template>-->

</xsl:stylesheet>
