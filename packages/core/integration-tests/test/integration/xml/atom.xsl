<?xml version="1.0" encoding="utf-8"?>
<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:atom="http://www.w3.org/2005/Atom">
  <xsl:output method="html" />
  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title><xsl:value-of select="/atom:feed/atom:title" /></title>
      </head>
      <body>
        <ul>
          <xsl:for-each select="/atom:feed/atom:entry">
            <li>
              <a>
                <xsl:attribute name="href"><xsl:value-of select="atom:link/@href" /></xsl:attribute>
                <xsl:value-of select="atom:title" />
              </a>
            </li>
          </xsl:for-each>
        </ul>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
