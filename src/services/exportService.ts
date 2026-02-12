import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// NOTE: You need to install these dependencies:
// npm install xlsx jspdf jspdf-autotable

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