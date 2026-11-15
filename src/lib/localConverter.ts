import initRhwp, { HwpDocument } from "@rhwp/core";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas-pro";

let rhwpInitPromise: Promise<unknown> | null = null;
let measureCtx: CanvasRenderingContext2D | null = null;
let lastMeasureFont = "";

function ensureMeasureTextWidth() {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.measureTextWidth !== "function") {
    g.measureTextWidth = (font: string, text: string): number => {
      if (!measureCtx) {
        measureCtx = document.createElement("canvas").getContext("2d");
      }
      if (!measureCtx) return text.length * 10;
      if (font !== lastMeasureFont) {
        measureCtx.font = font;
        lastMeasureFont = font;
      }
      return measureCtx.measureText(text).width;
    };
  }
}

async function ensureRhwpReady() {
  ensureMeasureTextWidth();
  if (!rhwpInitPromise) {
    rhwpInitPromise = initRhwp({ module_or_path: "/rhwp_bg.wasm" }).catch((err) => {
      rhwpInitPromise = null;
      throw err;
    });
  }
  await rhwpInitPromise;
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }
}

function decodeTextBuffer(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("euc-kr").decode(bytes);
    } catch {
      return new TextDecoder("utf-8").decode(bytes);
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function renderHtmlToPdfBlob(
  innerHtml: string,
  options?: { landscape?: boolean }
): Promise<Blob> {
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  const landscape = Boolean(options?.landscape);
  const containerWidthPx = landscape ? 1122 : 794;
  const pageWidthPt = landscape ? 841.89 : 595.28;
  const pageHeightPt = landscape ? 595.28 : 841.89;

  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.left = "-100000px";
  wrapper.style.top = "0";
  wrapper.style.width = `${containerWidthPx}px`;
  wrapper.style.backgroundColor = "#ffffff";
  wrapper.style.color = "#111827";
  wrapper.style.padding = "48px 52px";
  wrapper.style.boxSizing = "border-box";
  wrapper.style.zIndex = "-1";
  wrapper.style.fontFamily =
    "'Noto Sans KR', 'Nanum Gothic', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";

  wrapper.innerHTML = `
    <style>
      .local-pdf-root {
        font-family: 'Noto Sans KR', 'Nanum Gothic', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif;
        font-size: 13.5px;
        line-height: 1.7;
        color: #111827;
        word-break: break-word;
        overflow-wrap: break-word;
      }
      .local-pdf-root h1 { font-size: 22px; font-weight: 700; margin: 0 0 14px; color: #0f172a; }
      .local-pdf-root h2 { font-size: 18px; font-weight: 700; margin: 18px 0 10px; color: #0f172a; }
      .local-pdf-root h3 { font-size: 15px; font-weight: 700; margin: 14px 0 8px; color: #1e293b; }
      .local-pdf-root p { margin: 0 0 10px; }
      .local-pdf-root ul, .local-pdf-root ol { margin: 0 0 12px 22px; padding: 0; }
      .local-pdf-root li { margin-bottom: 4px; }
      .local-pdf-root table {
        width: 100%;
        border-collapse: collapse;
        margin: 14px 0;
        font-size: 12px;
      }
      .local-pdf-root th, .local-pdf-root td {
        border: 1px solid #cbd5e1;
        padding: 6px 8px;
        text-align: left;
        vertical-align: top;
      }
      .local-pdf-root th {
        background-color: #f1f5f9;
        font-weight: 700;
      }
      .local-pdf-root img {
        max-width: 100%;
        height: auto;
        display: block;
        margin: 10px 0;
      }
      .local-pdf-root pre {
        white-space: pre-wrap;
        word-break: break-word;
        font-family: 'Noto Sans KR', 'Nanum Gothic', monospace;
        font-size: 13px;
        line-height: 1.65;
        margin: 0;
      }
      .local-pdf-sheet-title {
        font-size: 15px;
        font-weight: 700;
        color: #1e293b;
        margin: 18px 0 8px;
        padding-bottom: 4px;
        border-bottom: 2px solid #e2e8f0;
      }
      .local-pdf-sheet-title:first-child {
        margin-top: 0;
      }
    </style>
    <div class="local-pdf-root">${innerHtml}</div>
  `;

  document.body.appendChild(wrapper);

  try {
    const imgs = Array.from(wrapper.querySelectorAll("img"));
    await Promise.all(
      imgs.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete) {
              resolve();
              return;
            }
            img.onload = () => resolve();
            img.onerror = () => resolve();
          })
      )
    );

    const canvas = await html2canvas(wrapper, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
      windowWidth: containerWidthPx,
    });

    const pdf = new jsPDF({
      orientation: landscape ? "landscape" : "portrait",
      unit: "pt",
      format: "a4",
      compress: true,
    });

    const pagePixelHeight = Math.max(1, Math.floor(canvas.width * (pageHeightPt / pageWidthPt)));
    let offsetY = 0;
    let pageIndex = 0;

    while (offsetY < canvas.height) {
      const sliceHeight = Math.min(pagePixelHeight, canvas.height - offsetY);
      const sliceCanvas = document.createElement("canvas");
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = sliceHeight;

      const sliceCtx = sliceCanvas.getContext("2d");
      if (!sliceCtx) {
        throw new Error("PDF 캔버스 컨텍스트를 생성할 수 없습니다.");
      }

      sliceCtx.fillStyle = "#ffffff";
      sliceCtx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
      sliceCtx.drawImage(
        canvas,
        0,
        offsetY,
        canvas.width,
        sliceHeight,
        0,
        0,
        canvas.width,
        sliceHeight
      );

      const imgData = sliceCanvas.toDataURL("image/png");
      const renderedHeightPt = (sliceHeight / canvas.width) * pageWidthPt;

      if (pageIndex > 0) {
        pdf.addPage("a4", landscape ? "landscape" : "portrait");
      }
      pdf.addImage(imgData, "PNG", 0, 0, pageWidthPt, renderedHeightPt, undefined, "FAST");

      offsetY += sliceHeight;
      pageIndex++;
    }

    return pdf.output("blob");
  } finally {
    wrapper.remove();
  }
}

async function convertHwpOrHwpxToPdf(
  file: File,
  onProgress?: (text: string) => void
): Promise<Blob> {
  onProgress?.("한글(HWP/HWPX) WASM 엔진 초기화 중...");
  await ensureRhwpReady();

  onProgress?.("한글 문서 구조 분석 및 조판 중...");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = new HwpDocument(bytes);

  try {
    const totalPages = doc.pageCount();
    if (totalPages <= 0) {
      throw new Error("문서에서 변환할 페이지를 찾지 못했습니다.");
    }

    const scale = 2.0;
    let pdf: jsPDF | null = null;

    for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
      onProgress?.(`고화질 페이지 렌더링 중 (${pageIdx + 1}/${totalPages})...`);
      const canvas = document.createElement("canvas");

      try {
        doc.renderPageToCanvas(pageIdx, canvas, scale);
      } catch {
        // Fallback via SVG -> Canvas if direct canvas replay fails for a page
        const svgStr = doc.renderPageSvg(pageIdx);
        await renderSvgStringToCanvas(svgStr, canvas, scale);
      }

      if (canvas.width === 0 || canvas.height === 0) {
        continue;
      }

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.save();
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
      }

      const widthPt = (canvas.width / scale) * 0.75;
      const heightPt = (canvas.height / scale) * 0.75;
      const orientation = widthPt > heightPt ? "landscape" : "portrait";

      if (!pdf) {
        pdf = new jsPDF({
          orientation,
          unit: "pt",
          format: [widthPt, heightPt],
          compress: true,
        });
      } else {
        pdf.addPage([widthPt, heightPt], orientation);
      }

      const imgData = canvas.toDataURL("image/png");
      pdf.addImage(imgData, "PNG", 0, 0, widthPt, heightPt, undefined, "FAST");
    }

    if (!pdf) {
      throw new Error("유효한 PDF 페이지를 생성하지 못했습니다.");
    }

    onProgress?.("PDF 파일 패키징 완료 중...");
    return pdf.output("blob");
  } finally {
    doc.free();
  }
}

async function renderSvgStringToCanvas(
  svgString: string,
  canvas: HTMLCanvasElement,
  scale: number
): Promise<void> {
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgString, "image/svg+xml");
  const svgEl = svgDoc.documentElement;
  const viewBox = svgEl.getAttribute("viewBox")?.split(/\s+/).map(Number);
  const widthAttr = parseFloat(svgEl.getAttribute("width") || "0");
  const heightAttr = parseFloat(svgEl.getAttribute("height") || "0");

  const baseWidth = widthAttr || (viewBox && viewBox[2]) || 794;
  const baseHeight = heightAttr || (viewBox && viewBox[3]) || 1123;

  canvas.width = Math.round(baseWidth * scale);
  canvas.height = Math.round(baseHeight * scale);

  const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("SVG 페이지 이미지 로드 실패"));
      image.src = url;
    });

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D 컨텍스트를 생성할 수 없습니다.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function convertDocxToPdf(
  file: File,
  onProgress?: (text: string) => void
): Promise<Blob> {
  onProgress?.("워드(.docx) 문서 구조 변환 중...");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const html = result.value || "<p>(빈 문서)</p>";

  onProgress?.("고화질 PDF 페이지 렌더링 중...");
  return await renderHtmlToPdfBlob(html, { landscape: false });
}

async function convertSpreadsheetToPdf(
  file: File,
  ext: string,
  onProgress?: (text: string) => void
): Promise<Blob> {
  onProgress?.("스프레드시트 시트 데이터 파싱 중...");
  let workbook: XLSX.WorkBook;

  if (ext === "csv") {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = decodeTextBuffer(bytes);
    workbook = XLSX.read(text, { type: "string" });
  } else {
    const arrayBuffer = await file.arrayBuffer();
    workbook = XLSX.read(arrayBuffer, { type: "array" });
  }

  const sheetBlocks = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const tableHtml = XLSX.utils.sheet_to_html(sheet, { editable: false });
    return `<div class="local-pdf-sheet-title">${escapeHtml(sheetName)}</div>${tableHtml}`;
  });

  if (sheetBlocks.length === 0) {
    throw new Error("스프레드시트에 시트가 없습니다.");
  }

  onProgress?.("표 레이아웃 PDF 렌더링 중...");
  return await renderHtmlToPdfBlob(sheetBlocks.join(""), { landscape: true });
}

async function convertImageToPdf(
  file: File,
  onProgress?: (text: string) => void
): Promise<Blob> {
  onProgress?.("이미지 고화질 PDF 변환 중...");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("이미지 파일을 읽을 수 없습니다."));
      image.src = url;
    });

    const isLandscape = img.naturalWidth > img.naturalHeight;
    const pdf = new jsPDF({
      orientation: isLandscape ? "landscape" : "portrait",
      unit: "pt",
      format: "a4",
      compress: true,
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 24;
    const maxW = pageWidth - margin * 2;
    const maxH = pageHeight - margin * 2;
    const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
    const drawW = img.naturalWidth * ratio;
    const drawH = img.naturalHeight * ratio;
    const x = (pageWidth - drawW) / 2;
    const y = (pageHeight - drawH) / 2;

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("이미지 캔버스 초기화 실패");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    const pngData = canvas.toDataURL("image/png");
    pdf.addImage(pngData, "PNG", x, y, drawW, drawH, undefined, "FAST");
    return pdf.output("blob");
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function convertTextOrHtmlToPdf(
  file: File,
  ext: string,
  onProgress?: (text: string) => void
): Promise<Blob> {
  onProgress?.("텍스트 문서 인코딩 분석 및 PDF 렌더링 중...");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = decodeTextBuffer(bytes);

  if (ext === "html" || ext === "htm") {
    const sanitized = text.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
    return await renderHtmlToPdfBlob(sanitized, { landscape: false });
  }

  const html = `<pre>${escapeHtml(text || "(빈 파일)")}</pre>`;
  return await renderHtmlToPdfBlob(html, { landscape: false });
}

export async function convertLocalFileToPdf(
  file: File,
  onProgress?: (text: string) => void
): Promise<Blob> {
  const lowerName = file.name.toLowerCase();
  const dotIdx = lowerName.lastIndexOf(".");
  const ext = dotIdx !== -1 ? lowerName.slice(dotIdx + 1) : "";

  if (ext === "hwp" || ext === "hwpx" || ext === "hml") {
    return await convertHwpOrHwpxToPdf(file, onProgress);
  }

  if (ext === "docx") {
    return await convertDocxToPdf(file, onProgress);
  }

  if (ext === "xlsx" || ext === "xls" || ext === "csv") {
    return await convertSpreadsheetToPdf(file, ext, onProgress);
  }

  if (["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(ext)) {
    return await convertImageToPdf(file, onProgress);
  }

  if (ext === "pdf") {
    onProgress?.("PDF 파일 최적화 및 학번명 적용 중...");
    return new Blob([await file.arrayBuffer()], { type: "application/pdf" });
  }

  if (["txt", "md", "log", "json", "html", "htm", "xml"].includes(ext) || file.type.startsWith("text/")) {
    return await convertTextOrHtmlToPdf(file, ext, onProgress);
  }

  if (ext === "doc") {
    throw new Error(
      "구형 바이너리 .doc 포맷은 브라우저 직접 변환이 지원되지 않습니다. .docx 또는 .hwp로 저장 후 변환하거나 우측 구글 드라이브 변환을 이용해 주세요."
    );
  }

  if (ext === "ppt" || ext === "pptx") {
    throw new Error(
      "파워포인트(.ppt/.pptx) 직접 변환은 우측 구글 드라이브 연동을 통해 지원됩니다."
    );
  }

  throw new Error(
    `지원하지 않는 로컬 파일 형식(.${ext || "알수없음"})입니다. (지원: HWP, HWPX, DOCX, XLSX, XLS, CSV, TXT, HTML, 이미지, PDF)`
  );
}
