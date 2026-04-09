// components/ExportButton.tsx
// Dependências: xlsx (npm i xlsx), jspdf (npm i jspdf), html2canvas (npm i html2canvas)

import React, { useState, useRef, useEffect } from 'react';
import { Download, FileSpreadsheet, FileText, Image, X, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';

// ── Tipos ────────────────────────────────────────────────────────────────────
type ExportData = {
  clientName: string;
  period: { start: Date; end: Date };
  kpis: {
    totalVisitors: number;
    avgVisitorsPerDay: number;
    avgVisitSeconds: number;
    avgAttentionSeconds: number;
  };
  dailyStats: number[];
  hourlyStats: number[];
  genderStats: { label: string; value: number }[];
  ageStats: { age: string; m: number; f: number }[];
  attributeStats: { label: string; value: number }[];
  hairTypeData: { label: string; value: number }[];
  hairColorData: { label: string; value: number }[];
  visitorsPerDayMap: Record<string, number>;
  quarterBars: { label: string; visitors: number; sales: number }[];
  dashboardRef: React.RefObject<HTMLDivElement>;
};

type Props = {
  data: ExportData;
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmtDate = (d: Date) =>
  d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

const fmtDuration = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${String(mm).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

const DAY_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

// ── Estilos das células Excel ────────────────────────────────────────────────
const STYLES = {
  headerDark: {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 13 },
    fill: { fgColor: { rgb: '0F172A' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: { bottom: { style: 'medium', color: { rgb: '1D9E75' } } },
  },
  sectionHeader: {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
    fill: { fgColor: { rgb: '1D9E75' } },
    alignment: { horizontal: 'left', vertical: 'center' },
  },
  colHeader: {
    font: { bold: true, color: { rgb: '1D9E75' }, sz: 10 },
    fill: { fgColor: { rgb: 'F0FDF4' } },
    alignment: { horizontal: 'center' },
    border: { bottom: { style: 'thin', color: { rgb: '1D9E75' } } },
  },
  value: {
    font: { sz: 11 },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: { top: { style: 'thin', color: { rgb: 'E5E7EB' } }, bottom: { style: 'thin', color: { rgb: 'E5E7EB' } }, left: { style: 'thin', color: { rgb: 'E5E7EB' } }, right: { style: 'thin', color: { rgb: 'E5E7EB' } } },
  },
  valueAlt: {
    font: { sz: 11 },
    fill: { fgColor: { rgb: 'F9FAFB' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: { top: { style: 'thin', color: { rgb: 'E5E7EB' } }, bottom: { style: 'thin', color: { rgb: 'E5E7EB' } }, left: { style: 'thin', color: { rgb: 'E5E7EB' } }, right: { style: 'thin', color: { rgb: 'E5E7EB' } } },
  },
  labelLeft: {
    font: { bold: true, sz: 11 },
    alignment: { horizontal: 'left', vertical: 'center' },
    border: { top: { style: 'thin', color: { rgb: 'E5E7EB' } }, bottom: { style: 'thin', color: { rgb: 'E5E7EB' } }, left: { style: 'thin', color: { rgb: 'E5E7EB' } }, right: { style: 'thin', color: { rgb: 'E5E7EB' } } },
  },
  kpiValue: {
    font: { bold: true, sz: 14, color: { rgb: '1D9E75' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: { top: { style: 'thin', color: { rgb: 'E5E7EB' } }, bottom: { style: 'thin', color: { rgb: 'E5E7EB' } }, left: { style: 'thin', color: { rgb: 'E5E7EB' } }, right: { style: 'thin', color: { rgb: 'E5E7EB' } } },
  },
};

const cell = (v: any, s?: any): XLSX.CellObject => ({ v, t: typeof v === 'number' ? 'n' : 's', s });
const blank = (s?: any): XLSX.CellObject => ({ v: '', t: 's', s });

// ── Gerador Excel ─────────────────────────────────────────────────────────────
function generateExcel(data: ExportData) {
  const wb = XLSX.utils.book_new();

  // ── Aba 1: Resumo ──────────────────────────────────────────────────────────
  const summaryRows: XLSX.CellObject[][] = [
    [cell(`RELATÓRIO DE ANÁLISE — ${data.clientName.toUpperCase()}`, STYLES.headerDark), blank(STYLES.headerDark), blank(STYLES.headerDark), blank(STYLES.headerDark)],
    [cell(`Período: ${fmtDate(data.period.start)} até ${fmtDate(data.period.end)}`, { font: { italic: true, color: { rgb: '6B7280' } } }), blank(), blank(), blank()],
    [cell(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, { font: { italic: true, color: { rgb: '6B7280' } } }), blank(), blank(), blank()],
    [blank(), blank(), blank(), blank()],

    [cell('KPIs PRINCIPAIS', STYLES.sectionHeader), blank(STYLES.sectionHeader), blank(STYLES.sectionHeader), blank(STYLES.sectionHeader)],
    [cell('Indicador', STYLES.colHeader), cell('Valor', STYLES.colHeader), blank(), blank()],
    [cell('Total de Visitantes', STYLES.labelLeft), cell(data.kpis.totalVisitors, STYLES.kpiValue), blank(), blank()],
    [cell('Média de Visitantes por Dia', STYLES.labelLeft), cell(data.kpis.avgVisitorsPerDay, STYLES.kpiValue), blank(), blank()],
    [cell('Tempo Médio de Visita', STYLES.labelLeft), cell(fmtDuration(data.kpis.avgVisitSeconds), STYLES.kpiValue), blank(), blank()],
    [cell('Tempo Médio de Atenção', STYLES.labelLeft), cell(data.kpis.avgAttentionSeconds > 0 ? fmtDuration(data.kpis.avgAttentionSeconds) : '—', STYLES.kpiValue), blank(), blank()],
    [blank(), blank(), blank(), blank()],

    [cell('DISTRIBUIÇÃO DE GÊNERO', STYLES.sectionHeader), blank(STYLES.sectionHeader), blank(STYLES.sectionHeader), blank(STYLES.sectionHeader)],
    [cell('Gênero', STYLES.colHeader), cell('Percentual (%)', STYLES.colHeader), blank(), blank()],
    ...data.genderStats.map((g, i) => [cell(g.label, i % 2 === 0 ? STYLES.labelLeft : { ...STYLES.labelLeft, fill: { fgColor: { rgb: 'F9FAFB' } } }), cell(g.value, i % 2 === 0 ? STYLES.value : STYLES.valueAlt), blank(), blank()]),
    [blank(), blank(), blank(), blank()],

    [cell('ÚLTIMO TRIMESTRE', STYLES.sectionHeader), blank(STYLES.sectionHeader), blank(STYLES.sectionHeader), blank(STYLES.sectionHeader)],
    [cell('Mês', STYLES.colHeader), cell('Visitantes', STYLES.colHeader), cell('Vendas', STYLES.colHeader), blank()],
    ...data.quarterBars.map((q, i) => [
      cell(q.label, i % 2 === 0 ? STYLES.labelLeft : { ...STYLES.labelLeft, fill: { fgColor: { rgb: 'F9FAFB' } } }),
      cell(q.visitors, i % 2 === 0 ? STYLES.value : STYLES.valueAlt),
      cell(q.sales, i % 2 === 0 ? STYLES.value : STYLES.valueAlt),
      blank(),
    ]),
  ];

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows.map(r => r.map(c => c.v)));
  summaryRows.forEach((row, ri) => row.forEach((c, ci) => {
    const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
    if (!wsSummary[addr]) wsSummary[addr] = {};
    Object.assign(wsSummary[addr], c);
  }));
  wsSummary['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 3 } },
    { s: { r: 4, c: 0 }, e: { r: 4, c: 3 } },
    { s: { r: 11, c: 0 }, e: { r: 11, c: 3 } },
    { s: { r: 14, c: 0 }, e: { r: 14, c: 3 } },
  ];
  wsSummary['!cols'] = [{ wch: 34 }, { wch: 18 }, { wch: 18 }, { wch: 10 }];
  wsSummary['!rows'] = summaryRows.map(() => ({ hpt: 22 }));
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumo');

  // ── Aba 2: Fluxo Diário ────────────────────────────────────────────────────
  const dailyEntries = Object.entries(data.visitorsPerDayMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count], i) => [
      cell(new Date(date + 'T00:00:00Z').toLocaleDateString('pt-BR', { timeZone: 'UTC' }), i % 2 === 0 ? STYLES.value : STYLES.valueAlt),
      cell(Number(count), i % 2 === 0 ? STYLES.value : STYLES.valueAlt),
    ]);

  const dailyRows: XLSX.CellObject[][] = [
    [cell('FLUXO DIÁRIO DE VISITANTES', STYLES.sectionHeader), blank(STYLES.sectionHeader)],
    [cell('Data', STYLES.colHeader), cell('Visitantes', STYLES.colHeader)],
    ...dailyEntries,
  ];

  const wsDaily = XLSX.utils.aoa_to_sheet(dailyRows.map(r => r.map(c => c.v)));
  dailyRows.forEach((row, ri) => row.forEach((c, ci) => {
    const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
    if (!wsDaily[addr]) wsDaily[addr] = {};
    Object.assign(wsDaily[addr], c);
  }));
  wsDaily['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  wsDaily['!cols'] = [{ wch: 20 }, { wch: 18 }];
  wsDaily['!rows'] = dailyRows.map(() => ({ hpt: 22 }));
  XLSX.utils.book_append_sheet(wb, wsDaily, 'Fluxo Diário');

  // ── Aba 3: Fluxo Semanal & Horário ────────────────────────────────────────
  const weekRows: XLSX.CellObject[][] = [
    [cell('FLUXO POR DIA DA SEMANA', STYLES.sectionHeader), blank(STYLES.sectionHeader)],
    [cell('Dia', STYLES.colHeader), cell('Visitantes Médios', STYLES.colHeader)],
    ...DAY_LABELS.map((d, i) => [cell(d, i % 2 === 0 ? STYLES.labelLeft : { ...STYLES.labelLeft, fill: { fgColor: { rgb: 'F9FAFB' } } }), cell(data.dailyStats[i] ?? 0, i % 2 === 0 ? STYLES.value : STYLES.valueAlt)]),
    [blank(), blank()],
    [cell('FLUXO POR HORA DO DIA', STYLES.sectionHeader), blank(STYLES.sectionHeader)],
    [cell('Hora', STYLES.colHeader), cell('Média de Visitantes', STYLES.colHeader)],
    ...Array.from({ length: 24 }, (_, i) => [
      cell(`${String(i).padStart(2, '0')}:00`, i % 2 === 0 ? STYLES.value : STYLES.valueAlt),
      cell(data.hourlyStats[i] ?? 0, i % 2 === 0 ? STYLES.value : STYLES.valueAlt),
    ]),
  ];

  const wsWeek = XLSX.utils.aoa_to_sheet(weekRows.map(r => r.map(c => c.v)));
  weekRows.forEach((row, ri) => row.forEach((c, ci) => {
    const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
    if (!wsWeek[addr]) wsWeek[addr] = {};
    Object.assign(wsWeek[addr], c);
  }));
  wsWeek['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }, { s: { r: 10, c: 0 }, e: { r: 10, c: 1 } }];
  wsWeek['!cols'] = [{ wch: 18 }, { wch: 22 }];
  wsWeek['!rows'] = weekRows.map(() => ({ hpt: 22 }));
  XLSX.utils.book_append_sheet(wb, wsWeek, 'Fluxo por Hora');

  // ── Aba 4: Dados Demográficos ──────────────────────────────────────────────
  const displayforceAgeOrder = ['1-19', '20-29', '30-45', '46-100'];
  const legacyAgeOrder = ['18-', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
  const ageOrder = displayforceAgeOrder.some((age) => data.ageStats.some((item) => item.age === age))
    ? displayforceAgeOrder
    : legacyAgeOrder;
  const ageLblMap: Record<string, string> = {
    '1-19': '<20', '20-29': '20-29', '30-45': '30-45', '46-100': '>45',
    '18-': '<18', '18-24': '18-24', '25-34': '25-34', '35-44': '35-44', '45-54': '45-54', '55-64': '55-64', '65+': '65+'
  };
  const ageMap = new Map(data.ageStats.map(a => [a.age, a]));

  const demoRows: XLSX.CellObject[][] = [
    [cell('DADOS DEMOGRÁFICOS', STYLES.sectionHeader), blank(STYLES.sectionHeader), blank(STYLES.sectionHeader), blank(STYLES.sectionHeader)],
    [blank(), blank(), blank(), blank()],
    [cell('PIRÂMIDE ETÁRIA', { font: { bold: true, sz: 11 } }), blank(), blank(), blank()],
    [cell('Faixa Etária', STYLES.colHeader), cell('Masculino (%)', STYLES.colHeader), cell('Feminino (%)', STYLES.colHeader), cell('Total (%)', STYLES.colHeader)],
    ...ageOrder.map((age, i) => {
      const d = ageMap.get(age) ?? { m: 0, f: 0 };
      const s = i % 2 === 0 ? STYLES.value : STYLES.valueAlt;
      return [cell(ageLblMap[age] ?? age, i % 2 === 0 ? STYLES.labelLeft : { ...STYLES.labelLeft, fill: { fgColor: { rgb: 'F9FAFB' } } }), cell(Number(d.m.toFixed(1)), s), cell(Number(d.f.toFixed(1)), s), cell(Number((d.m + d.f).toFixed(1)), { ...s, font: { bold: true } })];
    }),
    [blank(), blank(), blank(), blank()],
    [cell('ATRIBUTOS', { font: { bold: true, sz: 11 } }), blank(), blank(), blank()],
    [cell('Atributo', STYLES.colHeader), cell('Percentual (%)', STYLES.colHeader), blank(), blank()],
    ...data.attributeStats.filter(a => !a.label.startsWith('_')).map((a, i) => [
      cell(a.label, i % 2 === 0 ? STYLES.labelLeft : { ...STYLES.labelLeft, fill: { fgColor: { rgb: 'F9FAFB' } } }),
      cell(a.value, i % 2 === 0 ? STYLES.value : STYLES.valueAlt),
      blank(), blank(),
    ]),
    [blank(), blank(), blank(), blank()],
    [cell('TIPO DE CABELO', { font: { bold: true, sz: 11 } }), blank(), blank(), blank()],
    [cell('Tipo', STYLES.colHeader), cell('Percentual (%)', STYLES.colHeader), blank(), blank()],
    ...data.hairTypeData.map((h, i) => [
      cell(h.label, i % 2 === 0 ? STYLES.labelLeft : { ...STYLES.labelLeft, fill: { fgColor: { rgb: 'F9FAFB' } } }),
      cell(h.value, i % 2 === 0 ? STYLES.value : STYLES.valueAlt),
      blank(), blank(),
    ]),
    [blank(), blank(), blank(), blank()],
    [cell('COR DE CABELO', { font: { bold: true, sz: 11 } }), blank(), blank(), blank()],
    [cell('Cor', STYLES.colHeader), cell('Percentual (%)', STYLES.colHeader), blank(), blank()],
    ...data.hairColorData.map((h, i) => [
      cell(h.label, i % 2 === 0 ? STYLES.labelLeft : { ...STYLES.labelLeft, fill: { fgColor: { rgb: 'F9FAFB' } } }),
      cell(h.value, i % 2 === 0 ? STYLES.value : STYLES.valueAlt),
      blank(), blank(),
    ]),
  ];

  const wsDemo = XLSX.utils.aoa_to_sheet(demoRows.map(r => r.map(c => c.v)));
  demoRows.forEach((row, ri) => row.forEach((c, ci) => {
    const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
    if (!wsDemo[addr]) wsDemo[addr] = {};
    Object.assign(wsDemo[addr], c);
  }));
  wsDemo['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
  wsDemo['!cols'] = [{ wch: 24 }, { wch: 18 }, { wch: 18 }, { wch: 14 }];
  wsDemo['!rows'] = demoRows.map(() => ({ hpt: 22 }));
  XLSX.utils.book_append_sheet(wb, wsDemo, 'Dados Demográficos');

  return wb;
}

// ── ExportButton ─────────────────────────────────────────────────────────────
export const ExportButton: React.FC<Props> = ({ data }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<'excel' | 'pdf' | 'screenshot' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // ── Exportar Excel ─────────────────────────────────────────────────────────
  const handleExcel = async () => {
    setLoading('excel');
    try {
      const wb = generateExcel(data);
      const fileName = `Relatorio_${data.clientName.replace(/\s+/g, '_')}_${data.period.start.toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, fileName);
    } catch (err) {
      console.error('Erro ao gerar Excel:', err);
      alert('Erro ao gerar Excel. Verifique o console.');
    } finally {
      setLoading(null);
      setOpen(false);
    }
  };

  // ── Exportar PDF de dados ──────────────────────────────────────────────────
  const handlePdfReport = async () => {
    setLoading('pdf');
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const W = 210; const margin = 16; const col = W - margin * 2;

      let y = 0;

      const addPage = () => { doc.addPage(); y = margin; };

      const checkY = (needed: number) => { if (y + needed > 280) addPage(); };

      // Cabeçalho
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, W, 28, 'F');
      doc.setFillColor(29, 158, 117);
      doc.rect(0, 26, W, 2, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text(`RELATÓRIO — ${data.clientName.toUpperCase()}`, margin, 12);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(156, 163, 175);
      doc.text(`Período: ${fmtDate(data.period.start)} até ${fmtDate(data.period.end)}   |   Gerado em: ${new Date().toLocaleString('pt-BR')}`, margin, 21);

      y = 38;

      // Seção helper
      const section = (title: string) => {
        checkY(14);
        doc.setFillColor(29, 158, 117);
        doc.rect(margin, y, col, 7, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text(title, margin + 3, y + 5);
        y += 10;
      };

      const row = (label: string, value: string, shade = false) => {
        checkY(8);
        if (shade) { doc.setFillColor(249, 250, 251); doc.rect(margin, y, col, 7, 'F'); }
        doc.setDrawColor(229, 231, 235);
        doc.rect(margin, y, col, 7, 'S');
        doc.setTextColor(55, 65, 81);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(label, margin + 3, y + 5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(29, 158, 117);
        doc.text(value, W - margin - 3, y + 5, { align: 'right' });
        doc.setTextColor(55, 65, 81);
        y += 7;
      };

      // KPIs
      section('KPIs PRINCIPAIS');
      row('Total de Visitantes', data.kpis.totalVisitors.toLocaleString('pt-BR'));
      row('Média de Visitantes por Dia', data.kpis.avgVisitorsPerDay.toLocaleString('pt-BR'), true);
      row('Tempo Médio de Visita', fmtDuration(data.kpis.avgVisitSeconds));
      row('Tempo Médio de Atenção', data.kpis.avgAttentionSeconds > 0 ? fmtDuration(data.kpis.avgAttentionSeconds) : '—', true);
      y += 6;

      // Gênero
      section('DISTRIBUIÇÃO DE GÊNERO');
      data.genderStats.forEach((g, i) => row(g.label, `${g.value}%`, i % 2 !== 0));
      y += 6;

      // Trimestre
      if (data.quarterBars.length) {
        section('ÚLTIMO TRIMESTRE');
        data.quarterBars.forEach((q, i) => row(q.label, `${q.visitors.toLocaleString('pt-BR')} visitantes`, i % 2 !== 0));
        y += 6;
      }

      // Pirâmide etária
      section('FAIXA ETÁRIA');
      const ageLblMap: Record<string, string> = {
        '1-19': '<20', '20-29': '20-29', '30-45': '30-45', '46-100': '>45',
        '18-': '<18', '18-24': '18-24', '25-34': '25-34', '35-44': '35-44', '45-54': '45-54', '55-64': '55-64', '65+': '65+'
      };
      data.ageStats.forEach((a, i) => {
        const total = (Number(a.m) + Number(a.f)).toFixed(1);
        row(`${ageLblMap[a.age] ?? a.age}`, `M: ${a.m.toFixed(1)}%  F: ${a.f.toFixed(1)}%  Total: ${total}%`, i % 2 !== 0);
      });
      y += 6;

      // Atributos
      section('ATRIBUTOS');
      data.attributeStats.filter(a => !a.label.startsWith('_')).forEach((a, i) => row(a.label, `${a.value}%`, i % 2 !== 0));
      y += 6;

      // Tipo de cabelo
      if (data.hairTypeData.length) {
        section('TIPO DE CABELO');
        data.hairTypeData.forEach((h, i) => row(h.label, `${h.value}%`, i % 2 !== 0));
        y += 6;
      }

      // Cor de cabelo
      if (data.hairColorData.length) {
        section('COR DE CABELO');
        data.hairColorData.forEach((h, i) => row(h.label, `${h.value}%`, i % 2 !== 0));
        y += 6;
      }

      // Fluxo diário
      const dailyEntries = Object.entries(data.visitorsPerDayMap).sort(([a], [b]) => a.localeCompare(b));
      if (dailyEntries.length) {
        section('FLUXO DIÁRIO');
        dailyEntries.forEach(([date, count], i) => {
          const d = new Date(date + 'T00:00:00Z').toLocaleDateString('pt-BR', { timeZone: 'UTC' });
          row(d, Number(count).toLocaleString('pt-BR'), i % 2 !== 0);
        });
        y += 6;
      }

      // Rodapé em todas as páginas
      const totalPages = (doc as any).internal.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 288, W, 9, 'F');
        doc.setTextColor(107, 114, 128);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.text(`${data.clientName} — Relatório Analytics`, margin, 293);
        doc.text(`Página ${p} de ${totalPages}`, W - margin, 293, { align: 'right' });
      }

      doc.save(`Relatorio_${data.clientName.replace(/\s+/g, '_')}_${data.period.start.toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      console.error('Erro ao gerar PDF:', err);
      alert('Erro ao gerar PDF. Verifique se jspdf está instalado.');
    } finally {
      setLoading(null);
      setOpen(false);
    }
  };

  // ── Screenshot do dashboard ────────────────────────────────────────────────
  const handleScreenshot = async () => {
    setLoading('screenshot');
    try {
      const { default: html2canvas } = await import('html2canvas');
      const { jsPDF } = await import('jspdf');

      const target = data.dashboardRef.current;
      if (!target) throw new Error('dashboardRef não encontrado');

      const canvas = await html2canvas(target, {
        backgroundColor: '#030712',
        scale: 2,
        useCORS: true,
        allowTaint: false,
        logging: false,
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      const imgW = canvas.width / 2;
      const imgH = canvas.height / 2;

      const pageW = 297; const pageH = 210; // A4 landscape mm
      const ratio = Math.min(pageW / imgW, pageH / imgH);
      const drawW = imgW * ratio; const drawH = imgH * ratio;
      const offX = (pageW - drawW) / 2; const offY = (pageH - drawH) / 2;

      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      doc.setFillColor(3, 7, 18);
      doc.rect(0, 0, pageW, pageH, 'F');
      doc.addImage(imgData, 'JPEG', offX, offY, drawW, drawH);

      doc.setFontSize(6);
      doc.setTextColor(107, 114, 128);
      doc.text(`${data.clientName} — ${fmtDate(data.period.start)} até ${fmtDate(data.period.end)}   |   ${new Date().toLocaleString('pt-BR')}`, pageW / 2, pageH - 3, { align: 'center' });

      doc.save(`Dashboard_${data.clientName.replace(/\s+/g, '_')}_${data.period.start.toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      console.error('Erro ao capturar screenshot:', err);
      alert('Erro ao capturar o dashboard. Verifique se html2canvas e jspdf estão instalados.');
    } finally {
      setLoading(null);
      setOpen(false);
    }
  };

  const isLoading = loading !== null;

  return (
    <div className="relative" ref={menuRef}>
      {/* Botão principal */}
      <button
        onClick={() => !isLoading && setOpen((v) => !v)}
        title="Exportar relatório"
        className="flex items-center justify-center bg-gray-900 border border-gray-800 text-white rounded-lg hover:border-emerald-600 hover:text-emerald-400 transition-colors flex-shrink-0 h-[38px] w-[38px] relative"
      >
        {isLoading ? <Loader2 size={16} className="animate-spin text-emerald-400" /> : <Download size={16} />}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 right-0 mt-2 w-64 bg-gray-950 border border-gray-800 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900">
            <span className="text-xs font-bold text-white uppercase tracking-wider">Exportar Relatório</span>
            <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-white transition-colors">
              <X size={14} />
            </button>
          </div>

          {/* Opções */}
          <div className="p-2">
            <button
              onClick={handleExcel}
              disabled={isLoading}
              className="w-full flex items-start gap-3 px-3 py-3 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-left group"
            >
              <div className="w-8 h-8 rounded-lg bg-emerald-950 border border-emerald-900 flex items-center justify-center flex-shrink-0 group-hover:border-emerald-700 transition-colors">
                <FileSpreadsheet size={16} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Planilha Excel</p>
                <p className="text-[11px] text-gray-500 mt-0.5">4 abas: resumo, fluxo diário, horário e dados demográficos</p>
              </div>
            </button>

            <button
              onClick={handlePdfReport}
              disabled={isLoading}
              className="w-full flex items-start gap-3 px-3 py-3 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-left group"
            >
              <div className="w-8 h-8 rounded-lg bg-blue-950 border border-blue-900 flex items-center justify-center flex-shrink-0 group-hover:border-blue-700 transition-colors">
                <FileText size={16} className="text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Relatório PDF</p>
                <p className="text-[11px] text-gray-500 mt-0.5">Relatório completo com todos os dados formatados</p>
              </div>
            </button>

            <button
              onClick={handleScreenshot}
              disabled={isLoading}
              className="w-full flex items-start gap-3 px-3 py-3 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-left group"
            >
              <div className="w-8 h-8 rounded-lg bg-purple-950 border border-purple-900 flex items-center justify-center flex-shrink-0 group-hover:border-purple-700 transition-colors">
                <Image size={16} className="text-purple-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Captura do Dashboard</p>
                <p className="text-[11px] text-gray-500 mt-0.5">Screenshot dos widgets em PDF A4 landscape</p>
              </div>
            </button>
          </div>

          {/* Info período */}
          <div className="px-4 pb-3">
            <div className="bg-gray-900 rounded-lg px-3 py-2 text-center">
              <p className="text-[10px] text-gray-500">
                Período: <span className="text-gray-300 font-medium">{fmtDate(data.period.start)} → {fmtDate(data.period.end)}</span>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
