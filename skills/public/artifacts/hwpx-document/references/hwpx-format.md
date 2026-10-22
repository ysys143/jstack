# HWPX (OWPML) file-format reference

## Overview

HWPX is Hancom Office Hangul's next-generation document format, following **OWPML**
(Open Word-Processor Markup Language), KS X 6101:2024. It is a ZIP-based XML container
with an OPC-like structure comparable to DOCX/XLSX.

## Internal file structure

```
document.hwpx (ZIP archive)
├── mimetype                    # "application/hwp+zip" (first entry, uncompressed)
├── META-INF/
│   ├── container.xml           # Package root location
│   ├── container.rdf           # Relationships
│   └── manifest.xml            # File inventory
├── Contents/
│   ├── content.hpf             # Manifest (OPF; sections and headers)
│   ├── header.xml              # Document header (styles, fonts, CharShape, ParaShape)
│   ├── section0.xml            # Body section (paragraphs, tables, images)
│   ├── section1.xml            # Additional section, if present
│   └── ...
├── Preview/
│   ├── PrvImage.png            # Preview image
│   └── PrvText.txt             # Preview text
├── settings.xml                # Editor settings
└── version.xml                 # Version information
```

### Core rules

- **mimetype** must be the ZIP archive's **first entry**, stored with **ZIP_STORED** (uncompressed).
- **content.hpf** is an OPF manifest referencing all content files.
- **header.xml** defines document-wide styles such as CharShape, ParaShape, and BorderFill.
- **section*.xml** contains actual document content.

## XML namespaces

| Prefix | URI | Purpose |
|--------|-----|---------|
| `hp` | `http://www.hancom.co.kr/hwpml/2011/paragraph` | Paragraphs, runs, text, tables, controls |
| `hs` | `http://www.hancom.co.kr/hwpml/2011/section` | Section root |
| `hc` | `http://www.hancom.co.kr/hwpml/2011/core` | Core data types |
| `hh` | `http://www.hancom.co.kr/hwpml/2011/head` | Header: styles and property definitions |
| `ha` | `http://www.hancom.co.kr/hwpml/2011/app` | Application metadata |
| `hp10` | `http://www.hancom.co.kr/hwpml/2016/paragraph` | Extended paragraph elements |
| `hpf` | `http://www.hancom.co.kr/schema/2011/hpf` | Manifest (content.hpf) |
| `opf` | `http://www.idpf.org/2007/opf/` | OPF package |

## Main XML elements

### Sections (section*.xml)

```xml
<hs:sec xmlns:hp="..." xmlns:hs="...">
  <hp:p>...</hp:p>     <!-- Paragraph -->
  <hp:p>...</hp:p>     <!-- Paragraph -->
</hs:sec>
```

### Paragraphs

```xml
<hp:p id="..." paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
  <hp:run charPrIDRef="0">
    <hp:t>텍스트 내용</hp:t>
  </hp:run>
</hp:p>
```

- `paraPrIDRef`: ParaShape reference ID in header.xml.
- `styleIDRef`: Style reference ID in header.xml.
- `charPrIDRef`: CharShape reference ID in header.xml, at run level.

### Text runs

```xml
<hp:run charPrIDRef="2">
  <hp:t>볼드 텍스트</hp:t>
</hp:run>
```

- A paragraph can contain multiple runs with different formatting.
- `charPrIDRef` references character formatting.

### Tables

```xml
<hp:tbl id="..." rowCnt="2" colCnt="3" cellSpacing="0" borderFillIDRef="3">
  <hp:sz width="21600" height="7200" />
  <hp:pos treatAsChar="1" />
  <hp:tr>                           <!-- Row -->
    <hp:tc borderFillIDRef="3">     <!-- Cell -->
      <hp:cellAddr colAddr="0" rowAddr="0" colSpan="1" rowSpan="1"/>
      <hp:cellSz width="7200" height="3600"/>
      <hp:cellMargin left="510" right="510" top="142" bottom="142"/>
      <hp:subList>
        <hp:p ...>
          <hp:run ...>
            <hp:t>셀 내용</hp:t>
          </hp:run>
        </hp:p>
      </hp:subList>
    </hp:tc>
  </hp:tr>
</hp:tbl>
```

### Section properties

Included in the first run of the first paragraph:

```xml
<hp:secPr textDirection="HORIZONTAL" ...>
  <hp:pagePr landscape="WIDELY" width="59528" height="84186" gutterType="LEFT_ONLY">
    <hp:margin header="4252" footer="4252" gutter="0"
               left="8504" right="8504" top="5668" bottom="4252"/>
  </hp:pagePr>
</hp:secPr>
```

- Unit: HWPUNIT (1/7200 inch). For example, 59528 approximates A4 width (210mm).
- `width="59528"` is A4 width; `height="84186"` is A4 height.
- Margins use `left/right/top/bottom` in HWPUNIT.

### Inline controls

```xml
<hp:run>
  <hp:ctrl>
    <hp:colPr type="NEWSPAPER" colCount="1" />
  </hp:ctrl>
</hp:run>
```

```xml
<hp:run>
  <hp:lineBreak/>    <!-- Line break -->
  <hp:tab/>          <!-- Tab -->
</hp:run>
```

## Main header.xml structures

### CharShape: character formatting

```xml
<hh:charProperties itemCnt="...">
  <hh:charPr id="0" height="1000" textColor="#000000" shadeColor="none"
             useFontSpace="0" useKerning="0" symMark="NONE"
             borderFillIDRef="0">
    <hh:fontRef hangul="1" latin="1" hanja="1" japanese="1"
                other="1" symbol="1" user="1"/>
    <hh:ratio hangul="100" latin="100" .../>
    <hh:spacing hangul="0" latin="0" .../>
    <hh:relSz hangul="100" latin="100" .../>
    <hh:offset hangul="0" latin="0" .../>
    <hh:bold/>          <!-- Bold: enabled by element presence -->
    <hh:italic/>        <!-- Italic -->
    <hh:underline type="BOTTOM" shape="SOLID" color="#000000"/>
    <hh:strikeout type="NONE"/>
    <hh:outline type="NONE"/>
    <hh:shadow type="NONE"/>
    <hh:emboss type="NONE"/>
    <hh:engrave type="NONE"/>
    <hh:supscript type="NONE"/>
  </hh:charPr>
</hh:charProperties>
```

**`hh:fontRef` attributes contain numeric IDs, not font names.** An earlier example
used `hangul="한양신명조"`, which is incorrect: Hancom does not resolve a name there
and ignores the font assignment.

`hangul` takes the **ID of an `<hh:font>` inside `<hh:fontface lang="HANGUL">`**.
`latin` uses `lang="LATIN"`; `hanja` uses `lang="HANJA"`. Each language has a
**separate ID namespace**, so `hangul="1"` and `latin="1"` may identify different fonts.

The template provides evidence: `charPr id="0"` in
`templates/base/Contents/header.xml` uses `<hh:fontRef hangul="1" latin="1" …/>`,
and its HANGUL fontface contains `<hh:font id="1" face="함초롬바탕"/>`.
Thus `hangul="1"` selects **함초롬바탕**.

```xml
<hh:fontfaces itemCnt="7">
  <hh:fontface lang="HANGUL" fontCnt="2">
    <hh:font id="0" face="함초롬돋움" type="TTF" isEmbedded="0">…</hh:font>
    <hh:font id="1" face="함초롬바탕" type="TTF" isEmbedded="0">…</hh:font>
  </hh:fontface>
  <hh:fontface lang="LATIN" fontCnt="2">…</hh:fontface>
</hh:fontfaces>
```

To change fonts, **add an `hh:font` under `hh:fontface` and reference its ID from
`fontRef`**, also increasing `fontCnt`. Do not insert the font name into the reference.

- `height`: font size in HWPUNIT; 1000 = 10pt.
- `textColor`: font color in #RRGGBB.
- Bold and italic are determined by element presence.
- Proposal conversion note: this skill unwraps Markdown emphasis (`*text*`, `**text**`) as plain text; do not convert Markdown emphasis to HWPX bold/italic in proposal output.

### ParaShape: paragraph formatting

```xml
<hh:paraProperties itemCnt="...">
  <hh:paraPr id="0" align="JUSTIFY" vertalign="BASELINE"
             headingType="NONE" level="0" tabPrIDRef="0"
             condense="0" fontLineHeight="0" snapToGrid="1"
             suppressLineNumbers="0" checked="0">
    <hh:margin indent="0" left="0" right="0"/>
    <hh:lineSpacing type="PERCENT" value="160" unit="HWPUNIT"/>
    <hh:heading type="NONE" idRef="0" level="0"/>
    <hh:border borderFillIDRef="0" offsetLeft="0" offsetRight="0"
               offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>
    <hh:autoSpacing eAsianEng="0" eAsianNum="0"/>
  </hh:paraPr>
</hh:paraProperties>
```

> **The example above uses attributes, but the actual schema uses child elements.**
> Alignment is `<hh:align horizontal="JUSTIFY" vertical="BASELINE"/>`; margins use
> `value` and `unit` pairs below `<hh:margin>`. The canonical structure is in
> `references/xml-structure.md` §4.

- `align`: `JUSTIFY`, `LEFT`, `RIGHT`, `CENTER`.
- `lineSpacing`: `type="PERCENT"`, `value="160"` means 160% line spacing.

## Unit conversions

| Unit | Meaning | Conversion |
|------|---------|------------|
| HWPUNIT | Hangul internal unit | 1 HWPUNIT = 1/7200 inch |
| pt (points) | Font size | 1pt = 100 HWPUNIT |
| mm (millimeters) | Paper and margins | 1mm ≈ 283.46 HWPUNIT |

### Common values

- A4 paper: width=59528, height=84186.

**84186 is the value Hangul uses, not a calculated conversion.** Computing
`297mm × 7200 ÷ 25.4` yields 84189; some versions of references give 84188.
The evidence for 84186 is the **actual template**:
`templates/base/Contents/section0.xml` uses `<hp:pagePr width="59528" height="84186">`.
Using the calculated value makes Hangul recognize a custom page instead of A4,
misaligning standard A4 printing.

- 10pt font: height=1000.
- 12pt font: height=1200.
- Default left/right margins: 8504 (≈30mm).
- Default top margin: 5668 (≈20mm).
- Default bottom margin: 4252 (≈15mm).

## python-hwpx API mapping

| Operation | python-hwpx method | Notes |
|-----------|--------------------|-------|
| New document | `HwpxDocument.new()` | Uses an empty Skeleton template |
| Open file | `HwpxDocument.open(path)` | Accepts paths, bytes, or BinaryIO |
| Add paragraph | `doc.add_paragraph(text, section=)` | Can format through charPrIDRef |
| Add table | `doc.add_table(rows, cols, section=)` | Automatically creates borderFillIDRef |
| Cell text | `table.set_cell_text(row, col, text)` | Zero-indexed |
| Header | `doc.set_header_text(text, section=)` | |
| Footer | `doc.set_footer_text(text, section=)` | |
| Memo | `doc.add_memo_with_anchor(text, ...)` | Automatically creates a MEMO field |
| Bold/italic run style | `doc.ensure_run_style(bold=True)` | Returns charPrIDRef |
| Extract text | `TextExtractor(path).extract_text()` | Optionally includes tables |
| Save | `doc.save_to_path(path)` | |
| Return bytes | `doc.to_bytes()` | |

## Low-level XML access

When the high-level python-hwpx API is insufficient:

1. Use **unpack**, edit XML directly, then **pack**.
2. Access the low-level XML tree through `doc.oxml`.
3. Manipulate the lxml Element directly through `doc.sections[0].element`.

### Example: change paper size from A4 to B5

```python
# Edit section0.xml after unpacking
# Change width and height on <hp:pagePr>
# B5: width=51592, height=72850
```

### Example: change fonts in header.xml

```python
# 1) Add the font under <hh:fontface lang="HANGUL"> and increment fontCnt
#    <hh:font id="2" face="맑은 고딕" type="TTF" isEmbedded="0"/>
# 2) Reference its ID with <hh:fontRef hangul="2"/> in <hh:charPr id="0">
#    Using a name such as hangul="맑은 고딕" causes the assignment to be ignored
```
