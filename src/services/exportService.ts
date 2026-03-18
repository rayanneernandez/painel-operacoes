import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';

export const exportToExcel = (data: any[], fileName: string) => {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Dados');
  XLSX.writeFile(wb, `${fileName}.xlsx`);
};

export const exportToPDF = (title: string, columns: string[], data: any[], fileName: string) => {
  const doc = new jsPDF();

  doc.text(title, 14, 15);

  autoTable(doc, {
    head: [columns],
    body: data.map(item => Object.values(item)),
    startY: 20,
  });

  doc.save(`${fileName}.pdf`);
};

export const exportElementToPDF = async (
  element: HTMLElement,
  fileName: string,
  opts?: { backgroundColor?: string; scale?: number; marginPt?: number }
) => {
  const canvas = await html2canvas(element, {
    backgroundColor: opts?.backgroundColor ?? '#030712',
    scale: opts?.scale ?? 2,
    useCORS: true,
    logging: false,
  });

  const imgData = canvas.toDataURL('image/png');

  const doc = new jsPDF({
    orientation: canvas.width >= canvas.height ? 'landscape' : 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  const margin = Math.max(0, Number(opts?.marginPt ?? 18));
  const pageW = doc.internal.pageSize.getWidth() - margin * 2;
  const pageH = doc.internal.pageSize.getHeight() - margin * 2;

  const imgW = canvas.width;
  const imgH = canvas.height;

  const ratio = Math.min(pageW / imgW, pageH / imgH);
  const renderW = imgW * ratio;
  const renderH = imgH * ratio;

  doc.addImage(imgData, 'PNG', margin, margin, renderW, renderH, undefined, 'FAST');
  doc.save(`${fileName}.pdf`);
};

export const exportAnalyticsToExcel = (
  payload: {
    fileName: string;
    summary: { Métrica: string; Valor: string | number }[];
    perDay: { Data: string; Visitantes: number }[];
    perHour: { Hora: string; Média: number }[];
  }
) => {
  const wb = XLSX.utils.book_new();

  const wsSummary = XLSX.utils.json_to_sheet(payload.summary);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumo');

  const wsDay = XLSX.utils.json_to_sheet(payload.perDay);
  XLSX.utils.book_append_sheet(wb, wsDay, 'Por Dia');

  const wsHour = XLSX.utils.json_to_sheet(payload.perHour);
  XLSX.utils.book_append_sheet(wb, wsHour, 'Por Hora');

  XLSX.writeFile(wb, `${payload.fileName}.xlsx`);
};