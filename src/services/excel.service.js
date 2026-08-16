// src/services/excel.service.js
import ExcelJS from 'exceljs';
import { format } from 'date-fns';
import { ApiError } from '../utils/ApiError.js';
import logger from '../utils/logger.js';

const COMPANY = {
  name: 'SULEKHA ENGINEERING',
  tagline: 'PM Surya Ghar Registered Vendor • Solar Power Plant',
  phone: '+91 98321 17393',
};

const MASTER_BOM = [
  {
    title: '1. SPV MODULE',
    items: [
      ['Adani Topcon -DCR', '620 Wp', 'nos', '', 'n'],
    ],
  },
  {
    title: '2. INVERTER',
    items: [
      ['SOLAR STRING INVERTERS (Microtek)', 'PVB Link 3.3 kWp - 1 ph', 'nos', '', 1],
    ],
  },
  {
    title: '3. RCC STRUCTURE (Man hight structure)',
    items: [
      ['LEG (FRONT)-80CS40X15X2', '2060 mm', 'nos', 'Modification Required', 'n'],
      ['LEG (BACK)-80CS40X15X2', '2704 mm', 'nos', 'Modification Required', 'n'],
      ['RAFTER-60CS40X15X2', '4100 mm', 'nos', '', 'n'],
      ['FRONT BRACING -ISA50X50X5', '1330 mm', 'nos', 'Modification Required', 'n'],
      ['BACK BRACING -ISA50X50X5', '1297 mm', 'nos', 'Modification Required', 'n'],
      ['Purlin [SQ. TUBE]', '3600 mm', 'nos', '', 'n'],
      ['Nut-Bolt-Double Washer', 'M10X25', 'nos', '', 'n8'],
      ['Star Nut Bolt Washer', 'M10X100', 'nos', '', 'n4'],
      ['U CLAMP', 'M8', 'nos', '', 'n2'],
      ['Mid Clamp [75 LONG]', '25 mm', 'nos', '', 'mid'],
      ['End Clamp[75 LONG]', '30 mm', 'nos', '', 'end'],
      ['NUT PLATE', '30 mm', 'nos', '', 'n'],
      ['DR. FIXIT', '200 ml', 'nos', '', 1],
      ['GROUTED CHEMICAL', '', 'nos', '', 1],
    ],
  },
  {
    title: '4. DC PART',
    items: [
      ['DCDB', '1 in 1 out (600V SPD)', 'nos', '', 1],
      ['DC CABLE', '4 Sq mm 1 Core Type-1', 'mtr', '', 'm20'],
      ['MC4 CONNECTOR', '(M+F)', 'pair', '', 'n2'],
      ['RING LUG', '4 - 6 mm', 'nos', '', 'n2'],
      ['PIN LUG', '4 - 6 mm', 'nos', '', 'n2'],
      ['MMS PVC PIPE', '25 mm 3 mtr', 'nos', '', 'm4'],
      ['CHINA SHADDLE', '25mm', 'nos', '', 'm6'],
      ['PVC TEE', '25mm', 'nos', '', 'm3'],
      ['PVC ELBOW', '25mm', 'nos', '', 'm4'],
    ],
  },
  {
    title: '5. AC PART',
    items: [
      ['ACDB', '1 phase (16 amp)', 'nos', '', 1],
      ['AC CABLE', '4 sq mm 2 core ALU armoured', 'mtr', '', 'm15'],
      ['CHINA SHADDLE', '14 mm', 'packet', '', 2],
      ['RING LUG', '10mm', 'nos', '', 4],
      ['PIN LUG', '10 mm', 'nos', '', 4],
      ['BUSBAR (1PH / 3PH) WITH BOX', '1ph', 'nos', '', 1],
      ['PVC CABLE TRAY', '45 x 45', 'nos', '', 'm3'],
      ['MCB', '32 amp 2 Pole', 'nos', '', 1],
      ['MCB ENCLOSER', 'PVC', 'nos', '', 1],
      ['AC CABLE', '4 SQ MM AC CABLE 2 CORE Cu', 'mtr', '', 'm8'],
      ['LA', '1 mtr coper', 'nos', '', 1],
    ],
  },
  {
    title: '6. EARTHING PART 1',
    items: [
      ['MS Angke for Extension [ISA25x25x5]', 'ISA 25x25x5', 'mtr', 'LA Extension', 'm3'],
      ['Insulated Pipe (FRP Material)', '1/2 inch Dia FRP material', 'mm', '', 2],
      ['Nut Bolt Washer (M6X40)', 'M6x40mm', 'nos', '', 8],
      ['Self thread screw', '2 inch', 'nos', '', 8],
      ['LA INSULATOR', 'Big', 'nos', '', 2],
      ['EARTHING CABLE', '6 Sq mm Cu 1 core', 'mtr', '', 'm6'],
      ['EARTHING CABLE', '16 Sq mm Cu 1 core', 'mtr', '', 'm6'],
      ['EARTHING ROD', 'CU bounded 2 mtr 16 mm', 'nos', '', 2],
      ['EARTHING PIT COVER', 'PVC Small', 'nos', '', 2],
      ['EARTHING BUS Bar', '4 hole', 'nos', '', 2],
    ],
  },
  {
    title: '7. EARTHING PART 2',
    items: [
      ['GI STRIP', '19x3', 'kg', '', 'm5'],
      ['PVC INSULATOR', 'Flat', 'nos', '', 4],
      ['BUSBAR NUT BOLT WASHER', 'SS M8 x 30', 'nos', '', 8],
      ['GI STRIP JOINT NUT BOLT WASHER', 'SS M6 x 25', 'nos', '', 8],
      ['BFC', '25 kg', 'bag', '', 2],
    ],
  },
  {
    title: '8. MISCELLANEOUS',
    items: [
      ['CABLE TIE', 'PVC 200mm uv protected', 'packet', '', 2],
      ['SCREW', 'SS 8 x 35', 'nos', '', 'n10'],
      ['Cleaning Brush', '6 Mtr.', 'nos', '', 1],
      ['Zink Spray', '', 'nos', '', 2],
      ['PVC TAPE - (R,G,B)', 'R 1 G 1 B 1', 'nos', '', 3],
      ['WOODEN GUJI', 'WOODEN', 'packet', '', 2],
    ],
  },
  {
    title: '9. STICKER',
    items: [
      ['SLD STICKER', '', 'nos', '', 1],
      ['SULEKHA LOGO STICKER', '', 'nos', '', 1],
      ['EARTHING STICKER', '', 'nos', '', 1],
      ['PVC casing pin', '', 'nos', '', 'n4'],
      ['DANGER STICKER', '', 'nos', '', 1],
    ],
  },
];

function qtyFor(systemSizeKW, key) {
  const kW = Number(systemSizeKW) || 0;
  const n = Math.max(1, Math.round((kW * 1000) / 620));

  if (typeof key === 'number') return key;
  switch (key) {
    case 'n': return n;
    case 'n2': return n * 2;
    case 'n4': return n * 4;
    case 'n8': return n * 8;
    case 'n10': return n * 10;
    case 'mid': return Math.max(0, (n - 1) * 2);
    case 'end': return 4;
    case 'm': return Math.max(1, Math.ceil(kW));
    case 'm3': return Math.max(1, Math.ceil(kW * 3));
    case 'm4': return Math.max(1, Math.ceil(kW * 4));
    case 'm5': return Math.max(1, Math.ceil(kW * 5));
    case 'm6': return Math.max(1, Math.ceil(kW * 6));
    case 'm8': return Math.max(1, Math.ceil(kW * 8));
    case 'm15': return Math.max(1, Math.ceil(kW * 15));
    case 'm20': return Math.max(1, Math.ceil(kW * 20));
    default: return 1;
  }
}

export const excelService = {
  /**
   * Build flat rows for the canonical BOM.
   */
  buildMasterRows(systemSizeKW, variant = 'suggested', materialsUsed = []) {
    const kW = Number(systemSizeKW) || 0;
    const usageByKey = new Map();
    if (variant === 'final' && Array.isArray(materialsUsed)) {
      for (const usage of materialsUsed) {
        if (usage.status === 'reversed') continue;
        const code = String(usage.materialCodeSnapshot || '').toLowerCase();
        const name = String(usage.materialNameSnapshot || '').toLowerCase();
        if (code) usageByKey.set(code, usage);
        if (name) usageByKey.set(name, usage);
      }
    }

    const rows = [];
    let serial = 0;
    for (const section of MASTER_BOM) {
      for (const [name, desc, uom, remark, qtyKey] of section.items) {
        serial += 1;
        let qty = qtyFor(kW, qtyKey);
        if (usageByKey.size > 0) {
          const haystack = `${name} ${desc}`.toLowerCase();
          let matched = usageByKey.get(haystack);
          if (!matched) {
            for (const usage of usageByKey.values()) {
              const uname = String(usage.materialNameSnapshot || '').toLowerCase();
              if (uname && (name.toLowerCase().includes(uname) || uname.includes(name.toLowerCase()))) {
                matched = usage;
                break;
              }
            }
          }
          if (matched && matched.qty != null) qty = matched.qty;
        }
        rows.push({ serial, section: section.title, name, desc, uom, remark, qty: variant === 'suggested' ? qty : qty });
      }
    }
    return rows;
  },

  /**
   * Generate BOM Excel workbook and return Buffer.
   */
  async generateBOMExcel(installation, variant = 'suggested') {
    try {
      const customer = installation.customer || {};
      const rows = this.buildMasterRows(
        installation.systemSizeKW,
        variant,
        installation.materialsUsed || []
      );
      const currentDate = format(new Date(), 'dd/MM/yyyy');
      const requirement = `${installation.systemSizeKW} KW ON GRID System`;

      const workbook = new ExcelJS.Workbook();
      workbook.creator = COMPANY.name;
      workbook.created = new Date();

      const sheet = workbook.addWorksheet('BOM List');

      // Column widths matching the Excel sheet proportions
      sheet.columns = [
        { header: 'PART', key: 'part', width: 22 },
        { header: 'SL NO', key: 'sl', width: 6 },
        { header: 'ITEM NAME', key: 'name', width: 32 },
        { header: 'ITEM DESCRIPTION', key: 'desc', width: 28 },
        { header: 'UOM', key: 'uom', width: 8 },
        { header: 'TOTAL QTY', key: 'qty', width: 12 },
        { header: 'REMARK', key: 'remark', width: 22 },
      ];

      // Company header
      sheet.mergeCells('A1:G1');
      const titleCell = sheet.getCell('A1');
      titleCell.value = COMPANY.name;
      titleCell.font = { bold: true, size: 16, color: { argb: 'FFB72B28' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

      sheet.mergeCells('A2:G2');
      const taglineCell = sheet.getCell('A2');
      taglineCell.value = `${COMPANY.tagline} • ${COMPANY.phone}`;
      taglineCell.font = { size: 10, color: { argb: 'FF666666' } };
      taglineCell.alignment = { horizontal: 'center', vertical: 'middle' };

      sheet.mergeCells('A3:G3');
      const docTitleCell = sheet.getCell('A3');
      docTitleCell.value = 'SULEKHA ENGINEERING  —  BOM LIST';
      docTitleCell.font = { bold: true, size: 12, color: { argb: 'FFB72B28' } };
      docTitleCell.alignment = { horizontal: 'center', vertical: 'middle' };

      // Job details
      const jobStartRow = 5;
      sheet.mergeCells(`A${jobStartRow}:B${jobStartRow}`);
      sheet.getCell(`A${jobStartRow}`).value = 'Project No';
      sheet.getCell(`A${jobStartRow}`).font = { bold: true };
      sheet.mergeCells(`C${jobStartRow}:D${jobStartRow}`);
      sheet.getCell(`C${jobStartRow}`).value = installation.projectNo || '—';

      sheet.mergeCells(`E${jobStartRow}:F${jobStartRow}`);
      sheet.getCell(`E${jobStartRow}`).value = 'Quotation No';
      sheet.getCell(`E${jobStartRow}`).font = { bold: true };
      sheet.mergeCells(`G${jobStartRow}:G${jobStartRow}`);
      sheet.getCell(`G${jobStartRow}`).value = installation.quotationNo || '—';

      sheet.mergeCells(`A${jobStartRow + 1}:C${jobStartRow + 1}`);
      sheet.getCell(`A${jobStartRow + 1}`).value = 'Customer Name';
      sheet.getCell(`A${jobStartRow + 1}`).font = { bold: true };
      sheet.mergeCells(`D${jobStartRow + 1}:G${jobStartRow + 1}`);
      sheet.getCell(`D${jobStartRow + 1}`).value = customer.name || installation.customerNameSnapshot || '—';

      sheet.mergeCells(`A${jobStartRow + 2}:C${jobStartRow + 2}`);
      sheet.getCell(`A${jobStartRow + 2}`).value = 'GST Details';
      sheet.getCell(`A${jobStartRow + 2}`).font = { bold: true };
      sheet.mergeCells(`D${jobStartRow + 2}:G${jobStartRow + 2}`);
      sheet.getCell(`D${jobStartRow + 2}`).value = customer.gstNumber || '—';

      sheet.mergeCells(`A${jobStartRow + 3}:B${jobStartRow + 3}`);
      sheet.getCell(`A${jobStartRow + 3}`).value = 'Requirement';
      sheet.getCell(`A${jobStartRow + 3}`).font = { bold: true };
      sheet.mergeCells(`C${jobStartRow + 3}:F${jobStartRow + 3}`);
      sheet.getCell(`C${jobStartRow + 3}`).value = requirement;

      sheet.mergeCells(`A${jobStartRow + 4}:C${jobStartRow + 4}`);
      sheet.getCell(`A${jobStartRow + 4}`).value = 'Mobile No';
      sheet.getCell(`A${jobStartRow + 4}`).font = { bold: true };
      sheet.mergeCells(`D${jobStartRow + 4}:G${jobStartRow + 4}`);
      sheet.getCell(`D${jobStartRow + 4}`).value = customer.phone || installation.customerPhoneSnapshot || '—';

      const fullAddress = [customer.address, customer.city, customer.state, customer.pincode]
        .filter(Boolean)
        .join(', ');
      sheet.mergeCells(`A${jobStartRow + 5}:C${jobStartRow + 5}`);
      sheet.getCell(`A${jobStartRow + 5}`).value = 'Shipping Address';
      sheet.getCell(`A${jobStartRow + 5}`).font = { bold: true };
      sheet.mergeCells(`D${jobStartRow + 5}:G${jobStartRow + 5}`);
      sheet.getCell(`D${jobStartRow + 5}`).value = fullAddress || '—';

      // Table header
      const headerRow = jobStartRow + 7;
      const header = sheet.getRow(headerRow);
      header.values = ['PART', 'SL NO', 'ITEM NAME', 'ITEM DESCRIPTION', 'UOM', 'TOTAL QTY', 'REMARK'];
      header.font = { bold: true };
      header.alignment = { horizontal: 'center', vertical: 'middle' };
      header.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          bottom: { style: 'thin' },
          left: { style: 'thin' },
          right: { style: 'thin' },
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE5E5E5' },
        };
      });

      // Data rows
      let currentSection = null;
      let excelRow = headerRow + 1;
      for (const row of rows) {
        const dataRow = sheet.getRow(excelRow);
        const isFirstInSection = row.section !== currentSection;
        currentSection = row.section;

        dataRow.values = [
          isFirstInSection ? row.section : '',
          row.serial,
          row.name,
          row.desc,
          row.uom,
          row.qty,
          row.remark || '',
        ];

        dataRow.alignment = { vertical: 'middle', wrapText: true };
        dataRow.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin' },
            bottom: { style: 'thin' },
            left: { style: 'thin' },
            right: { style: 'thin' },
          };
        });

        if (isFirstInSection) {
          dataRow.getCell('A').font = { bold: true };
        }

        excelRow++;
      }

      // Footer with signature lines
      const footerRow = excelRow + 2;
      sheet.mergeCells(`A${footerRow}:C${footerRow}`);
      sheet.getCell(`A${footerRow}`).value = 'Prepared By';
      sheet.getCell(`A${footerRow}`).font = { size: 10 };
      sheet.getCell(`A${footerRow}`).border = { top: { style: 'thin' } };

      sheet.mergeCells(`E${footerRow}:G${footerRow}`);
      sheet.getCell(`E${footerRow}`).value = 'Authorized Signatory';
      sheet.getCell(`E${footerRow}`).font = { size: 10 };
      sheet.getCell(`E${footerRow}`).border = { top: { style: 'thin' } };

      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    } catch (error) {
      logger.error('BOM Excel generation failed:', error);
      throw new ApiError(500, 'Failed to generate Excel: ' + error.message);
    }
  },
};
