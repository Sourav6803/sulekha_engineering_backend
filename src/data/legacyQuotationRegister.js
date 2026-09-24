// src/data/legacyQuotationRegister.js
/**
 * The 24 real records from "QUOTATION SL NUMBUR.xlsx" (Sheet1), transcribed
 * exactly as they appear — including the two numbers that carry a leading space
 * and the twelve rows that have no date at all.
 *
 * Used as the built-in fallback for the register import so the numbering
 * continues from SE/PMSGY/2026-27/38 -> .../39 without depending on the file
 * being available. The uploader can still supply the sheet itself.
 *
 * Columns: SL NO | QUOTATION NO | DETAILS | DATE
 */
export const LEGACY_REGISTER_SOURCE = 'QUOTATION SL NUMBUR.xlsx';

export const LEGACY_REGISTER_ROWS = [
  { slNo: 3, quotationNo: 'SE/GP/2026-27/10', details: 'HARAL GP', date: '17.06.2026' },
  { slNo: 4, quotationNo: 'SE/SOLAR/2026-27/11', details: 'NS HARAL GP', date: '01.07.2026' },
  { slNo: 5, quotationNo: ' SE/PMSGY/2026-27/17', details: 'Dilip Chakraborty', date: '21.07.2026' },
  { slNo: 6, quotationNo: 'SE/PMSGY/2026-27/18', details: 'Amarnath Daw', date: '21.07.2026' },
  { slNo: 7, quotationNo: ' SE/PMSGY/2026-27/19', details: 'Raj Kumar Dawn', date: '21.07.2026' },
  { slNo: 8, quotationNo: 'SE/PMSGY/2026-27/20', details: 'Sanjoy Kumar Ghosh', date: '21.07.2026' },
  { slNo: 9, quotationNo: 'SE/PMSGY/2026-27/21', details: 'Swapan Kr. Dey', date: '21.07.2026' },
  { slNo: 10, quotationNo: 'SE/PMSGY/2026-27/22', details: 'Sourav Singha Roy', date: '21.07.2026' },
  { slNo: 11, quotationNo: 'SE/PMSGY/2026-27/23', details: 'Samar Ray', date: '21.07.2026' },
  { slNo: 12, quotationNo: 'SE/PMSGY/2026-27/24', details: 'Bholanath Ghosh', date: '25.07.2026' },
  { slNo: 13, quotationNo: 'SE/PMSGY/2026-27/25', details: 'Kanchan Ghosh', date: null },
  { slNo: 14, quotationNo: 'SE/PMSGY/2026-27/26', details: 'Arindam Chakrabartty', date: null },
  { slNo: 15, quotationNo: 'SE/MBECL/2026-27/27', details: 'Kurmitar', date: '31.07.2026' },
  { slNo: 16, quotationNo: 'SE/PMSGY/2026-27/28', details: 'Nasiba Begam Kazi', date: '11.08.2026' },
  { slNo: 17, quotationNo: 'SE/PMSGY/2026-27/29', details: 'Suvendu Pal', date: null },
  { slNo: 18, quotationNo: 'SE/PMSGY/2026-27/30', details: 'Harendra Nath Koley', date: null },
  { slNo: 19, quotationNo: 'SE/PMSGY/2026-27/31', details: 'Utpal Mondal', date: null },
  { slNo: 20, quotationNo: 'SE/PMSGY/2026-27/32', details: 'Biswanath Ghosh', date: null },
  { slNo: 21, quotationNo: 'SE/PMSGY/2026-27/33', details: 'Chaina Ghosh', date: null },
  { slNo: 22, quotationNo: 'SE/PMSGY/2026-27/34', details: 'Ramen Dutta', date: null },
  { slNo: 23, quotationNo: 'SE/PMSGY/2026-27/35', details: 'Sk Khairul Alam', date: null },
  { slNo: 24, quotationNo: 'SE/PMSGY/2026-27/36', details: 'Kanchan Singha Roy', date: null },
  { slNo: 25, quotationNo: 'SE/PMSGY/2026-27/37', details: 'Tulu Saha', date: null },
  { slNo: 26, quotationNo: 'SE/PMSGY/2026-27/38', details: 'Souvik Ghosh', date: null },
];

export default LEGACY_REGISTER_ROWS;
