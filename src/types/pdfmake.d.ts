/**
 * Local type declarations for pdfmake 0.3.3.
 *
 * pdfmake 0.3.3 ships NO TypeScript declarations at all — the existing
 * `import ... from 'pdfmake/interfaces'` lines compiled only because TS2307
 * degraded the imports to `any` (part of the old typecheck baseline). This file
 * gives the doc builders real types without changing any runtime behaviour.
 *
 * The `pdfmake/interfaces` shapes below are a faithful subset of
 * DefinitelyTyped's `@types/pdfmake@0.3.3` (MIT), trimmed to what this app
 * uses. The `pdfmake/build/*` declarations intentionally describe the shape the
 * app's runtime code relies on (`pdfMake.vfs = pdfFonts.vfs`, `createPdf`),
 * which differs from DT's module-style typings for newer 0.3.x builds.
 */
declare module 'pdfmake/interfaces' {
  export type Margins = number | [number, number] | [number, number, number, number];

  export type Alignment = 'left' | 'right' | 'justify' | 'center';

  export type PageOrientation = 'portrait' | 'landscape';

  export type PageSize = string | { width: number; height: number | 'auto' };

  /** Column/table width: pt, 'auto', star, or a percentage string. */
  export type Size = number | 'auto' | '*' | string;

  export type Decoration = 'underline' | 'lineThrough' | 'overline';

  export interface Style {
    font?: string;
    fontSize?: number;
    lineHeight?: number;
    bold?: boolean;
    italics?: boolean;
    alignment?: Alignment;
    color?: string;
    background?: string;
    markerColor?: string;
    decoration?: Decoration;
    decorationStyle?: 'dashed' | 'dotted' | 'double' | 'wavy';
    decorationColor?: string;
    margin?: Margins;
    preserveLeadingSpaces?: boolean;
    preserveTrailingSpaces?: boolean;
    opacity?: number;
    characterSpacing?: number;
    leadingIndent?: number;
    noWrap?: boolean;
    // Table-cell styling
    fillColor?: string;
    fillOpacity?: number;
    colSpan?: number;
    rowSpan?: number;
    border?: [boolean, boolean, boolean, boolean];
    borderColor?: [string, string, string, string];
    sub?: boolean;
    sup?: boolean;
  }

  export interface StyleDictionary {
    [name: string]: Style;
  }

  export interface StyleReference {
    style?: string | string[] | Style;
  }

  /** Properties shared by every content node. */
  export interface ContentBase extends Style, StyleReference {
    /** Width when the node is used as a column (kept here for convenience). */
    width?: Size;
    height?: Size;
    absolutePosition?: { x?: number; y?: number };
    relativePosition?: { x?: number; y?: number };
    pageBreak?: 'before' | 'after';
    pageOrientation?: PageOrientation;
    headlineLevel?: number;
    id?: string;
    link?: string;
    linkToPage?: number;
    linkToDestination?: string;
    tocItem?: boolean | string | string[];
  }

  export interface ContentText extends ContentBase {
    text: Content;
  }

  export type Column = Content & { width?: Size };

  export interface ContentColumns extends ContentBase {
    columns: Column[];
    columnGap?: number;
  }

  export interface ContentStack extends ContentBase {
    stack: Content[];
  }

  export interface ContentUnorderedList extends ContentBase {
    ul: Content[];
    type?: string;
  }

  export interface ContentOrderedList extends ContentBase {
    ol: Content[];
    start?: number;
    reversed?: boolean;
  }

  export interface ContentImage extends ContentBase {
    image: string;
    fit?: [number, number];
    cover?: { width?: number; height?: number; valign?: string; align?: string };
  }

  export interface ContentSvg extends ContentBase {
    svg: string;
    fit?: [number, number];
  }

  export interface ContentQr extends ContentBase {
    qr: string;
    foreground?: string;
    fit?: number;
    version?: number;
    eccLevel?: 'L' | 'M' | 'Q' | 'H';
    mode?: 'numeric' | 'alphanumeric' | 'octet';
    mask?: number;
  }

  export interface ContentCanvas extends ContentBase {
    canvas: CanvasElement[];
  }

  export interface ContentTable extends ContentBase {
    table: Table;
    layout?: TableLayout;
  }

  export interface ContentPageReference extends ContentBase {
    pageReference: string;
  }

  export interface ContentTextReference extends ContentBase {
    textReference: string;
  }

  export type Content =
    | string
    | number
    | boolean
    | Content[]
    | ContentText
    | ContentColumns
    | ContentStack
    | ContentUnorderedList
    | ContentOrderedList
    | ContentImage
    | ContentSvg
    | ContentQr
    | ContentCanvas
    | ContentTable
    | ContentPageReference
    | ContentTextReference;

  export interface CanvasRect {
    type: 'rect';
    x: number;
    y: number;
    w: number;
    h: number;
    r?: number;
    color?: string;
    lineWidth?: number;
    lineColor?: string;
    fillOpacity?: number;
    dash?: { length: number; space?: number };
  }

  export interface CanvasLine {
    type: 'line';
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    lineWidth?: number;
    lineColor?: string;
    dash?: { length: number; space?: number };
  }

  export interface CanvasPolyline {
    type: 'polyline';
    points: { x: number; y: number }[];
    closePath?: boolean;
    color?: string;
    lineWidth?: number;
    lineColor?: string;
  }

  export interface CanvasEllipse {
    type: 'ellipse';
    x: number;
    y: number;
    r1: number;
    r2?: number;
    color?: string;
    lineWidth?: number;
    lineColor?: string;
  }

  export type CanvasElement = CanvasRect | CanvasLine | CanvasPolyline | CanvasEllipse;

  export type TableCell = Content | (ContentBase & { text?: Content });

  export interface Table {
    body: TableCell[][];
    widths?: '*' | 'auto' | Size[];
    heights?: number | number[] | ((row: number) => number);
    headerRows?: number;
    dontBreakRows?: boolean;
    keepWithHeaderRows?: number;
  }

  export interface CustomTableLayout {
    hLineWidth?: (i: number, node: ContentTable) => number;
    vLineWidth?: (i: number, node: ContentTable) => number;
    hLineColor?: string | ((i: number, node: ContentTable) => string);
    vLineColor?: string | ((i: number, node: ContentTable) => string);
    hLineStyle?: (i: number, node: ContentTable) => { dash: { length: number; space?: number } } | null;
    vLineStyle?: (i: number, node: ContentTable) => { dash: { length: number; space?: number } } | null;
    paddingLeft?: (i: number, node: ContentTable) => number;
    paddingRight?: (i: number, node: ContentTable) => number;
    paddingTop?: (i: number, node: ContentTable) => number;
    paddingBottom?: (i: number, node: ContentTable) => number;
    fillColor?: string | ((rowIndex: number, node: ContentTable, columnIndex: number) => string | null);
    fillOpacity?: number | ((rowIndex: number, node: ContentTable, columnIndex: number) => number);
    defaultBorder?: boolean;
  }

  export type PredefinedTableLayout = 'noBorders' | 'headerLineOnly' | 'lightHorizontalLines';

  export type TableLayout = PredefinedTableLayout | CustomTableLayout | string;

  export interface ContextPageSize {
    width: number;
    height: number;
    orientation: PageOrientation;
  }

  export type DynamicContent = (
    currentPage: number,
    pageCount: number,
    pageSize: ContextPageSize,
  ) => Content | null | undefined;

  export interface Watermark {
    text: string;
    color?: string;
    opacity?: number;
    bold?: boolean;
    italics?: boolean;
    fontSize?: number;
    angle?: number;
  }

  export interface DocumentInfo {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string;
    creator?: string;
    producer?: string;
    creationDate?: Date;
    modDate?: Date;
  }

  export interface TDocumentDefinitions {
    content: Content;
    pageSize?: PageSize;
    pageOrientation?: PageOrientation;
    pageMargins?: Margins;
    header?: DynamicContent | Content;
    footer?: DynamicContent | Content;
    background?: DynamicContent | Content;
    styles?: StyleDictionary;
    defaultStyle?: Style;
    images?: { [name: string]: string };
    info?: DocumentInfo;
    compress?: boolean;
    watermark?: string | Watermark;
    pageBreakBefore?: (
      currentNode: unknown,
      followingNodesOnPage: unknown[],
      nodesOnNextPage: unknown[],
      previousNodesOnPage: unknown[],
    ) => boolean;
  }

  export type TVirtualFileSystem = Record<string, string>;

  export interface TFontFamily {
    normal?: string;
    bold?: string;
    italics?: string;
    bolditalics?: string;
  }

  export interface TFontDictionary {
    [name: string]: TFontFamily;
  }

  export interface TCreatedPdf {
    download(defaultFileName?: string): Promise<void>;
    open(win?: Window | null): Promise<void>;
    print(win?: Window | null): Promise<void>;
    getBlob(): Promise<Blob>;
    getBuffer(): Promise<Uint8Array>;
    getDataUrl(): Promise<string>;
  }
}

declare module 'pdfmake/build/pdfmake' {
  import type { TCreatedPdf, TDocumentDefinitions, TFontDictionary, TVirtualFileSystem } from 'pdfmake/interfaces';

  interface PdfMakeStatic {
    vfs: TVirtualFileSystem | undefined;
    fonts: TFontDictionary | undefined;
    createPdf(documentDefinitions: TDocumentDefinitions): TCreatedPdf;
    addVirtualFileSystem(vfs: TVirtualFileSystem): void;
  }

  const pdfMake: PdfMakeStatic;
  export default pdfMake;
}

declare module 'pdfmake/build/vfs_fonts' {
  import type { TVirtualFileSystem } from 'pdfmake/interfaces';

  const pdfFonts: { vfs: TVirtualFileSystem };
  export default pdfFonts;
}
