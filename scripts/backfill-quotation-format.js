// scripts/backfill-quotation-format.js
/**
 * Back-fill the 28 quotations held in "Quotation Formet.xlsx".
 *
 * 26 are domestic PM Surya Ghar sheets and 2 are project sheets (SE/BOB/.../42
 * and /44, both for Bank of Baroda, each with a 5 kWp on-grid section and a
 * 2 kWp off-grid section). Every number is used exactly as the spreadsheet
 * writes it — nothing is allocated by the counter — which is why this goes
 * through the service (so the printed document is built the same way as any
 * other quotation) rather than straight into the collection.
 *
 *   node scripts/backfill-quotation-format.js            # dry run, writes nothing
 *   node scripts/backfill-quotation-format.js --commit    # writes the records
 *
 * Lines the sheet gives as "5 or 6" (three of the 3 kW quotations) are recorded
 * as 6, which is what every other 3-3.54 kW quotation in the same file uses.
 * The sheet's own wording is kept in the description.
 */
import dns from 'node:dns';
import mongoose from 'mongoose';
import config from '../src/config/env.js';
import { Quotation, User } from '../src/models/index.js';
import { quotationService } from '../src/services/quotation.service.js';

/* A mongodb+srv:// URI needs an SRV lookup and c-ares intermittently refuses it
   on this machine. Public resolvers answer reliably. */
dns.setServers(['1.1.1.1', '8.8.8.8', '9.9.9.9']);

const COMMIT = process.argv.includes('--commit');

const SHEET_SOURCE = 'Quotation Formet.xlsx';

// ---------------------------------------------------------------- BOQ builders

/** The older six-line sheet: modules, PCU, structure, boxes, earthing, labour. */
const sixLine = ({ moduleDesc, moduleBrand, moduleQty, pcuKW, structureLine }) => [
  { description: moduleDesc, brandModel: moduleBrand, qty: moduleQty, unit: 'nos' },
  { description: `Solar MPPT PCU (Capacity: ${pcuKW}KW)`, qty: 1, unit: 'nos' },
  { description: structureLine, qty: 1, unit: 'lot' },
  { description: 'DCDB/ACDB Distribution Box, cabling', qty: 1, unit: 'lot' },
  { description: 'LA, Earthing, Chemical bags', qty: 1, unit: 'lot' },
  { description: 'Design, Installation & Testing', qty: 1, unit: 'lot' },
];

/** The newer eight-line sheet: modules, string inverter, GI structure, boxes, cables, labour. */
const eightLine = ({ moduleDesc, moduleBrand, moduleQty, inverterDesc, inverterBrand, structureLine }) => [
  { description: moduleDesc, brandModel: moduleBrand, qty: moduleQty, unit: 'nos' },
  { description: inverterDesc, brandModel: inverterBrand, qty: 1, unit: 'nos' },
  { description: structureLine, qty: 1, unit: 'lot' },
  { description: 'DCDB with SPD 1IN-1OUT', qty: 1, unit: null },
  { description: 'ACDB Box', qty: 1, unit: null },
  { description: 'Lighting Arrester copper bonded, Earthing copper bonded 3nos, Chemical bags', qty: 1, unit: 'lot' },
  { description: 'AC/DC cable, Earthing cable, Busbar lug, mc4 connector etc.', qty: 1, unit: 'lot' },
  { description: 'Transportation, Installation, Testing & commissing', qty: 1, unit: 'lot' },
];

// ------------------------------------------------------------ the 26 PM Surya Ghar sheets

const CONSUMER_SHEETS = [
  {
    sheet: 'Seikh Ansar Ali', no: 'SE/PMSGY/2026-27/16', date: '2026-07-09',
    name: 'Seikh Ansar Ali', consumerId: '517013089', phone: '8116834713',
    addressLine1: 'Sultanpur, Memari', addressLine2: 'Purba Bardhaman', pincode: '713146',
    kW: 3, inverterKW: 3, panelWp: 590, panelQty: 5, panelBrand: 'TATA POWER SOLAR', inverterBrand: '',
    structure: 'tin_shed', amount: 180000,
    items: sixLine({
      moduleDesc: 'Solar Modules Bifacial Panel(590 wp) - 3KW.', moduleBrand: 'TATA POWER SOLAR',
      moduleQty: 5, pcuKW: 3, structureLine: 'Structure for Tin Shed',
    }),
  },
  {
    sheet: 'Dilip Chakborty', no: 'SE/PMSGY/2026-27/17', date: '2026-07-21',
    name: 'Dilip Chakraborty', consumerId: '500301785', phone: '9681371456',
    addressLine1: 'Srikrishnapur, Jotsriram', addressLine2: 'Burdwan', pincode: '713408',
    kW: 3, inverterKW: 3, panelWp: 600, panelQty: 6, panelBrand: 'Vikram', inverterBrand: '',
    structure: 'rcc_rooftop', amount: 210000,
    items: sixLine({
      moduleDesc: 'Solar Modules Bifacial Panel(500/600 wp) - 3 KW.', moduleBrand: 'Vikram',
      moduleQty: 6, pcuKW: 3, structureLine: 'solar roof top mounting structures',
    }),
  },
  {
    sheet: 'Amarnath Daw', no: 'SE/PMSGY/2026-27/18', date: '2026-07-30',
    name: 'Amarnath Daw', consumerId: '502659102', phone: '6295017349',
    addressLine1: 'Paratal Patra Para', addressLine2: '', pincode: '713408',
    kW: 3, inverterKW: 3, panelWp: 600, panelQty: 6, panelBrand: '', inverterBrand: '',
    structure: 'tin_shed', amount: 210000,
    items: sixLine({
      moduleDesc: 'Solar Modules Bifacial Panel(500/600 wp) - 3 KW.', moduleBrand: '',
      moduleQty: 6, pcuKW: 3, structureLine: 'Structure for Tin Shed',
    }),
  },
  {
    sheet: 'Raj Kumar Dawn', no: 'SE/PMSGY/2026-27/19', date: '2026-07-21',
    name: 'Raj Kumar Dawn', consumerId: '517097188', phone: '9832261761',
    addressLine1: 'Paratal Burdwan', addressLine2: '', pincode: '713408',
    kW: 3, inverterKW: 3, panelWp: 600, panelQty: 6, panelBrand: '', inverterBrand: '',
    structure: 'tin_shed', amount: 210000,
    items: sixLine({
      moduleDesc: 'Solar Modules Bifacial Panel(500/600 wp) - 3KW.', moduleBrand: '',
      moduleQty: 6, pcuKW: 3, structureLine: 'Structure for Tin Shed',
    }),
  },
  {
    sheet: 'Sanjoy Kumar Ghosh', no: 'SE/PMSGY/2026-27/20', date: '2026-07-21',
    name: 'Sanjoy Kumar Ghosh', consumerId: '500783407', phone: '9531689041',
    addressLine1: 'Dosimana, Parbatpur', addressLine2: 'Burdwan', pincode: '713408',
    kW: 3, inverterKW: 3, panelWp: 600, panelQty: 6, panelBrand: '', inverterBrand: '',
    structure: 'rcc_rooftop', amount: 210000,
    items: sixLine({
      moduleDesc: 'Solar Modules Bifacial Panel(500/600 wp) - 3KW.', moduleBrand: '',
      moduleQty: 6, pcuKW: 3, structureLine: 'solar roof top mounting structures',
    }),
  },
  {
    sheet: 'Swapan Kr. Dey', no: 'SE/PMSGY/2026-27/21', date: '2026-07-30',
    name: 'Swapan Kr. Dey', consumerId: '517063747', phone: '9093928875',
    addressLine1: 'Jamalpur', addressLine2: '', pincode: '713408',
    kW: 3, inverterKW: 3, panelWp: 600, panelQty: 6, panelBrand: 'TATA', inverterBrand: '',
    structure: 'tin_shed', amount: 210000,
    items: sixLine({
      moduleDesc: 'Solar Modules Bifacial Panel(500/600 wp) - 3KW.', moduleBrand: 'TATA',
      moduleQty: 6, pcuKW: 3, structureLine: 'Structure for Tin Shed',
    }),
  },
  {
    sheet: 'Sourav Singha Roy', no: 'SE/PMSGY/2026-27/22', date: '2026-07-21',
    name: 'Sourav Singha Roy', consumerId: '503815089', phone: '9832148972',
    addressLine1: 'C/o-rathindra Singha Roy Vill-banglapara', addressLine2: '', pincode: '713401',
    kW: 3, inverterKW: 3, panelWp: 600, panelQty: 6, panelBrand: '', inverterBrand: '',
    structure: 'rcc_rooftop', amount: 210000,
    items: sixLine({
      moduleDesc: 'Solar Modules Bifacial Panel(500/600 wp) - 3KW.', moduleBrand: '',
      moduleQty: 6, pcuKW: 3, structureLine: 'solar roof top mounting structures',
    }),
  },
  {
    sheet: 'Samar Ray', no: 'SE/PMSGY/2026-27/23', date: '2026-07-30',
    name: 'Samar Ray', consumerId: '503648718', phone: '9732366181',
    addressLine1: 'C/o-tarak Ray Vill-keliri', addressLine2: '', pincode: '713401',
    kW: 2, inverterKW: 2, panelWp: 600, panelQty: 4, panelBrand: '', inverterBrand: '',
    structure: 'rcc_rooftop', amount: 150000,
    items: sixLine({
      moduleDesc: 'Solar Modules Bifacial Panel(500/600 wp) - 2KW.', moduleBrand: '',
      moduleQty: 4, pcuKW: 2, structureLine: 'solar roof top mounting structures',
    }),
  },
  {
    sheet: 'Bholanath Ghosh', no: 'SE/PMSGY/2026-27/24', date: '2026-08-11',
    name: 'Bholanath Ghosh', consumerId: '500161136', phone: '9002656345',
    addressLine1: 'S/o-sudhir Ghosh Basantapur, paratal', addressLine2: 'Burdwan', pincode: '713408',
    kW: 2, inverterKW: 2, panelWp: 620, panelQty: 4, panelBrand: '', inverterBrand: '',
    structure: 'rcc_rooftop', amount: 167000,
    items: sixLine({
      moduleDesc: 'Solar Modules Bifacial Panel(540/620 wp)', moduleBrand: '',
      moduleQty: 4, pcuKW: 2, structureLine: 'solar roof top mounting structures',
    }),
  },
  {
    sheet: 'Kanchan Ghosh', no: 'SE/PMSGY/2026-27/25', date: '2026-07-29',
    name: 'Kanchan Ghosh', consumerId: '517054795', phone: '9832206010',
    addressLine1: 'Vill.doshimana', addressLine2: 'Purba Bardhaman', pincode: '713408',
    kW: 3, inverterKW: 3, panelWp: 600, panelQty: 6, panelBrand: '', inverterBrand: '',
    structure: 'rcc_rooftop', amount: 210000,
    items: sixLine({
      moduleDesc: 'Solar Modules Bifacial Panel(500/600 wp) - 3KW.', moduleBrand: '',
      moduleQty: 6, pcuKW: 3, structureLine: 'solar roof top mounting structures',
    }),
  },
  {
    sheet: 'Arindam Chakrabartty', no: 'SE/PMSGY/2026-27/26', date: '2026-07-30',
    name: 'Arindam Chakrabartty', consumerId: '501088979', phone: '7872233232',
    addressLine1: 'Asok Chakrabaty, Dhuluk(purbo Para) Jamalpur', addressLine2: 'Burdwan', pincode: '713166',
    kW: 2.36, inverterKW: 2, panelWp: 590, panelQty: 4, panelBrand: '', inverterBrand: '',
    structure: 'rcc_rooftop', amount: 165200,
    items: sixLine({
      moduleDesc: 'Solar Modules Bifacial Panel(590 wp) - 2.36KW.', moduleBrand: '',
      moduleQty: 4, pcuKW: 2, structureLine: 'solar roof top mounting structures',
    }),
  },
  {
    sheet: 'Nasiba Begam Kazi', no: 'SE/PMSGY/2026-27/28', date: '2026-08-11',
    name: 'Nasiba Begam Kazi', consumerId: '501164215', phone: '9641275183',
    addressLine1: 'Bizla, keotara(paschim Para) Jamalpur', addressLine2: 'Burdwan', pincode: '713166',
    kW: 3, inverterKW: 3, panelWp: 600, panelQty: 6, panelBrand: '', inverterBrand: '',
    structure: 'rcc_rooftop', amount: 210000,
    items: sixLine({
      moduleDesc: 'Solar Modules Bifacial Panel(500/600 wp) - 3 KW.', moduleBrand: '',
      moduleQty: 6, pcuKW: 3, structureLine: 'solar roof top mounting structures',
    }),
  },
  {
    sheet: 'Suvendu Pal', no: 'SE/PMSGY/2026-27/29', date: '2026-07-30',
    name: 'Suvendu Pal', consumerId: '503599225', phone: '9100918799',
    addressLine1: 'C/o Rabin Pal Harogobindapur Horogobindapur, Jamalpur', addressLine2: '', pincode: '713404',
    kW: 3, inverterKW: 3, panelWp: 600, panelQty: 6, panelBrand: '', inverterBrand: '',
    structure: 'rcc_rooftop', amount: 210000,
    items: sixLine({
      moduleDesc: 'Solar Modules Bifacial Panel(500/600 wp) - 3KW.', moduleBrand: '',
      moduleQty: 6, pcuKW: 3, structureLine: 'solar roof top mounting structures',
    }),
  },
  {
    sheet: 'Harendra Nath Koley', no: 'SE/PMSGY/2026-27/30', date: '2026-07-30',
    name: 'Harendra Nath Koley', consumerId: '164042923', phone: '9932333311',
    addressLine1: 'Baliguri. Tarakeswar', addressLine2: 'Hooghly', pincode: '712410',
    kW: 3, inverterKW: 3, panelWp: 600, panelQty: 6, panelBrand: '', inverterBrand: '',
    structure: 'rcc_rooftop', amount: 210000,
    items: sixLine({
      moduleDesc: 'Solar Modules Bifacial Panel(500/600 wp) - 3KW.', moduleBrand: '',
      moduleQty: 6, pcuKW: 3, structureLine: 'solar roof top mounting structures',
    }),
  },
  {
    sheet: 'Utpal Mondal', no: 'SE/PMSGY/2026-27/31', date: '2026-09-01',
    name: 'Utpal Mondal', consumerId: '517024427', phone: '9679375324',
    addressLine1: 'Kaklyanpur Bijur', addressLine2: 'Purba Bardhaman', pincode: '713422',
    kW: 3, inverterKW: 3, panelWp: 600, panelQty: 6, panelBrand: '', inverterBrand: '',
    structure: 'high_rise', amount: 198000,
    items: sixLine({
      moduleDesc: 'Solar Modules Bifacial Panel(500/600 wp) - 3KW.', moduleBrand: '',
      moduleQty: 6, pcuKW: 3, structureLine: 'solar roof top high-rice mounting structures',
    }),
  },
  {
    sheet: 'Biswanath Ghosh', no: 'SE/PMSGY/2026-27/32', date: '2026-09-11',
    name: 'Biswanath Ghosh', consumerId: '503393311', phone: '9609551412',
    addressLine1: 'Duttapara Lakuddi', addressLine2: '', pincode: '713102',
    kW: 2, inverterKW: 2, panelWp: 620, panelQty: 4, panelBrand: '', inverterBrand: '',
    structure: 'rcc_rooftop', amount: 167000,
    items: sixLine({
      moduleDesc: 'Solar Modules Bifacial Panel(540/620 wp) - 2KW.', moduleBrand: '',
      moduleQty: 4, pcuKW: 2, structureLine: 'solar roof top mounting structures',
    }),
  },
  {
    sheet: 'Chaina Ghosh', no: 'SE/PMSGY/2026-27/33', date: '2026-09-01',
    name: 'Chaina Ghosh', consumerId: '67164101031', phone: '8910979861',
    addressLine1: '13/1 Palpara Bye Lane (Mankundu) Lp-79/24/6/1', addressLine2: 'Hooghly', pincode: '712139',
    kW: 2.95, inverterKW: 3, panelWp: 590, panelQty: 5, panelBrand: '', inverterBrand: '',
    structure: 'rcc_rooftop', amount: 150000,
    items: sixLine({
      moduleDesc: 'Solar Modules Bifacial Panel(590 wp) - 2.95KW.', moduleBrand: '',
      moduleQty: 5, pcuKW: 2.95, structureLine: 'solar roof top mounting structures',
    }),
  },
  {
    sheet: 'Ramen Dutta', no: 'SE/PMSGY/2026-27/34', date: '2026-09-07',
    name: 'Ramen Dutta', consumerId: '101441929', phone: '9903469659',
    addressLine1: '2 No. Rabindranagar', addressLine2: 'Hooghly', pincode: '712106',
    kW: 2.95, inverterKW: 3, panelWp: 600, panelQty: 5, panelBrand: '', inverterBrand: '',
    structure: 'rcc_rooftop', amount: 150000,
    items: sixLine({
      moduleDesc: 'Solar Modules Bifacial Panel(500/600 wp) - 2.95KW.', moduleBrand: '',
      moduleQty: 5, pcuKW: 2.95, structureLine: 'solar roof top mounting structures',
    }),
  },
  {
    sheet: 'Sk. Khairul Alam', no: 'SE/PMSGY/2026-27/35', date: '2026-09-11',
    name: 'Sk Khairul Alam', consumerId: '512195671', phone: '9333283136',
    addressLine1: 'Baramuria Galsi', addressLine2: 'Purba Bardhaman', pincode: '713406',
    kW: 3, inverterKW: 3, panelWp: 620, panelQty: 6, panelBrand: '', inverterBrand: '',
    structure: 'rcc_rooftop', amount: 220000,
    items: sixLine({
      moduleDesc: 'Solar Modules Bifacial Panel(540/620 wp) - 3KW.', moduleBrand: '',
      moduleQty: 6, pcuKW: 3, structureLine: 'solar roof top mounting structures',
    }),
  },
  {
    sheet: 'Kanchan Singha Roy', no: 'SE/PMSGY/2026-27/36', date: '2026-09-11',
    name: 'Kanchan Singha Roy', consumerId: '517088529', phone: '9635202194',
    addressLine1: 'Dogachia Jougram', addressLine2: '', pincode: '713166',
    kW: 2, inverterKW: 2, panelWp: 620, panelQty: 4, panelBrand: '', inverterBrand: '',
    structure: 'rcc_rooftop', amount: 167000,
    items: sixLine({
      moduleDesc: 'Solar Modules Bifacial Panel(540/620 wp) - 2KW.', moduleBrand: '',
      moduleQty: 4, pcuKW: 2, structureLine: 'solar roof top mounting structures',
    }),
  },
  {
    sheet: 'Tulu Saha', no: 'SE/PMSGY/2026-27/37', date: '2026-09-13',
    name: 'TULU SAHA', consumerId: '', phone: '',
    addressLine1: 'C/O Dinesh Saha, C-01, Basatpur, Sarulia', addressLine2: 'Purba Bardhaman', pincode: '713128',
    kW: 3.54, inverterKW: 3, panelWp: 590, panelQty: 6, panelBrand: 'TATA POWER SOLAR', inverterBrand: 'Solis/GoodWe',
    structure: 'rcc_rooftop', amount: 225000,
    items: eightLine({
      moduleDesc: 'Solar Modules Bifacial Panel(590 wp).', moduleBrand: 'TATA POWER SOLAR', moduleQty: 6,
      inverterDesc: 'On grid Solar String Inverter (Capacity: 3KW) Solis/GoodWe', inverterBrand: 'Solis/GoodWe',
      structureLine: 'solar roof top mounting GI structures, SS nut bolt',
    }),
  },
  {
    sheet: 'Souvik Ghosh', no: 'SE/PMSGY/2026-27/38', date: '2026-09-24',
    name: 'Souvik Ghosh', consumerId: '502178060', phone: '9432665126',
    addressLine1: 'Birpur, Gurap', addressLine2: 'Hooghly', pincode: '712303',
    kW: 3, inverterKW: 5, panelWp: 610, panelQty: 6, panelBrand: 'Waaree/Adani', inverterBrand: 'Deye',
    structure: 'high_rise', amount: 207000,
    items: eightLine({
      moduleDesc: 'Solar Modules Bifacial TOPcon Panel(600/610 wp).', moduleBrand: 'Waaree/Adani', moduleQty: 6,
      inverterDesc: 'On grid Solar String Inverter (Capacity: 5KW)', inverterBrand: 'Deye',
      structureLine: 'solar roof top high-rice GI structures, SS nut bolt',
    }),
  },
  {
    sheet: 'Aparna Pramanik', no: 'SE/PMSGY/2026-27/39', date: '2026-09-23',
    name: 'Aparna Pramanick', consumerId: '102370374', phone: '9007062281',
    addressLine1: 'W/o-dharanidhar Pramanick, Madaribar, gutinagori, shyampur', addressLine2: 'Howrah', pincode: '711315',
    kW: 2.36, inverterKW: 2, panelWp: 590, panelQty: 4, panelBrand: 'TATA POWER SOLAR', inverterBrand: 'Solis/GoodWe',
    structure: 'rcc_rooftop', amount: 176000,
    items: eightLine({
      moduleDesc: 'Solar Modules Bifacial Panel(590 wp).', moduleBrand: 'TATA POWER SOLAR', moduleQty: 4,
      inverterDesc: 'On grid Solar String Inverter (Capacity: 2KW) Solis/GoodWe', inverterBrand: 'Solis/GoodWe',
      structureLine: 'solar roof top mounting GI structures, SS nut bolt',
    }),
  },
  {
    sheet: 'Rajeswar Das', no: 'SE/PMSGY/2026-27/40', date: '2026-09-22',
    name: 'Rajeswar Das', consumerId: '517031475', phone: '9434033827',
    addressLine1: 'Debipur Station Bazar, Memari-1', addressLine2: '', pincode: '',
    kW: 4.95, inverterKW: 5, panelWp: 550, panelQty: 9, panelBrand: '', inverterBrand: '',
    structure: 'rcc_rooftop', amount: 290000,
    items: eightLine({
      moduleDesc: 'Solar Modules Bifacial Panel(550 wp).', moduleBrand: '', moduleQty: 9,
      inverterDesc: 'On grid Solar String Inverter (Capacity: 5KW)', inverterBrand: '',
      structureLine: 'solar roof top mounting GI structures, SS nut bolt',
    }),
  },
  {
    sheet: 'Arabinda Roy', no: 'SE/PMSGY/2026-27/41', date: '2026-09-25',
    name: 'Arabinda Roy', consumerId: '521019291', phone: '9476100415',
    addressLine1: 'Rajgramroad, Makarampur, Bolpur', addressLine2: 'Birbhum', pincode: '731204',
    kW: 3.54, inverterKW: 3, panelWp: 590, panelQty: 6, panelBrand: 'TATA', inverterBrand: '',
    structure: 'high_rise', amount: 220000,
    items: eightLine({
      moduleDesc: 'Solar Modules Bifacial TOPcon Panel(590 wp).', moduleBrand: 'TATA', moduleQty: 6,
      inverterDesc: 'On grid Solar String Inverter (Capacity: 3KW)', inverterBrand: '',
      structureLine: 'solar roof top high-rice GI structures, SS nut bolt',
    }),
  },
  {
    sheet: 'Raja Karmakar', no: 'SE/PMSGY/2026-27/43', date: '2026-09-26',
    name: 'Raja Karmakar', consumerId: '502818425', phone: '7001125980',
    addressLine1: 'Vill P.o- Eklakshmi, P.s- Madhabdihi, C/o- Sasthi Karmakar, Raina 2',
    addressLine2: 'Purba Bardhaman', pincode: '713427',
    kW: 3, inverterKW: 3, panelWp: 550, panelQty: 6, panelBrand: '', inverterBrand: '',
    structure: 'rcc_rooftop', amount: 200000,
    items: eightLine({
      moduleDesc: 'Solar Modules Bifacial Panel(540/550 wp).', moduleBrand: '', moduleQty: 6,
      inverterDesc: 'On grid Solar String Inverter (Capacity: 3KW)', inverterBrand: '',
      structureLine: 'solar roof top mounting GI structures, SS nut bolt',
    }),
  },
];

// ------------------------------------------------- the 2 Bank of Baroda project sheets

const ON_GRID_START = '5KWP SOLAR POWER PLANT (ON-GRID)';
const OFF_GRID_START = '2KWP SOLAR POWER PLANT (OFF-GRID)';

/** [description, specification, brandModel, unit, qty] — straight off the sheet. */
const ON_GRID_LINES = [
  ['Solar PV Module', 'Mono crystalline/ CIGS, 550Wp-600WP (MNRE LISTED)', '(EMVEE/Goldi Green/ HR', 'kwp', 5],
  ['Module Mounting Structure with all accessories', 'Hot dip galvanized, 80 Microns thick, Design wind speed 150 kmph, Minimum height from roof or ground level will be 5 Feet', 'Reputed make', 'kwp', 5],
  ['PV Array junction box', 'Will consists of fuse in each string, DC SPD 600V, blocking diode, DC MCB & Cu busbar.-5 KW', 'Reputed make', 'nos', 1],
  ['Inverter Data Logger', '3 phase 415V, 50Hz AC 5 KVA Grid-Tied Inverter with Data logger Compatible with inverter', 'Powerone/Growatt/ THEA', 'nos', 1],
  ['ACDB', 'IP-42/43 PVC door Enclosure, Dust & Vermin proof as per technical spce & drawing. Should consists of MCB, Indicator, AC SPD- FOR 5 KWP', 'Reputed make ABB/L&T MCCB', 'set', 1],
  ['Net Meter Liasoning with DISCOM', 'WBSEDCL - APPLICATION FEES, IMPORT-EXPORT METER, GENERATION METER, METER TEST, EXTRA CHARGES', '', 'job', 1],
  ['Cables', 'DC Cable 4 sqmm 1C (Conductor:Tinned annealed stranded flexible copper according to IEC 60228 XLPE Solar Cable (Type-1)', 'Polycab / KEI/ Havells/ Finolex', 'mtr', 50],
  ['Cables', 'AC Cable 4 sq.mm 4 C XLPE Insulated Copper Cable (IS 7098-1 & Rated Voltage: 1.1kV)', 'Polycab/MESCAB/ Havells / Finolex', 'mtr', 20],
  ['Cables', 'Earth Cable Green 6 Sq.mm 1 C CU', 'Polycab/MESCAB/ Havells / Finolex', 'mtr', 75],
  ['Lightning Arrestor', '1 mtr cu bonded lighting arrestor with 50mm dia 3mtr long GI pipe spike as per Provision of IS2309-1969', 'TRUE POWER/ SG POWER', 'nos', 1],
  ['Earthing System', '17.2 MM dia 1 Mtr. CU Bonded Rod, BFC Compound with pit cover as per IS 3043', 'TRUE POWER/ SG POWER', 'nos', 3],
  ['Installation & Wiring Materials for completion of work.', '', 'Reputed make', 'set', 1],
  ['Safety Signage (Danger Notice) For DC & AC', 'DC- 200X150 mm as per Approved technical spce & drawing & AC- 200X150 mm as per Approved technical spce & drawing', 'Reputed make', 'nos', 2],
  ['Signage', 'Project Signage & Schematic Diagram', 'Reputed make', 'nos', 1],
  ['Cleaning arrangement & fire extinguisher', '', 'Reputed make', 'set', 1],
];

const OFF_GRID_LINES = [
  ['Solar PV Module', 'Mono crystalline/ CIGS, 550Wp-600WP', '(EMVEE/Goldi Green/ HR', 'kwp', 2],
  ['Module Mounting Structure with all accessories', 'Hot dip galvanized, 80 Microns thick, Design wind speed 150 kmph, Minimum height from roof or ground level will be 5 Feet', 'Reputed make', 'kwp', 2],
  ['PV Array junction box', 'Will consists of fuse in each string, DC SPD 600V, blocking diode, DC MCB & Cu busbar.-2 KW', 'Reputed make', 'nos', 1],
  ['Off-Grid Inverter with Grid charging facility', '1 phase 220V, 50Hz AC 2 KVA, 24 volt off-Grid Inverter', 'LUMINOUS, UTL, EAPRO, STATCON ENERGIA', 'nos', 1],
  ['Solar Battery with Battery Rack', '12v, 200Ah solar Tubular low Mainatence lead acid battery', 'LUMINOUS, UTL, EAPRO, SPARK', 'nos', 2],
  ['ACDB', 'IP-42/43 PVC door Enclosure, Dust & Vermin proof as per technical spce & drawing. Should consists of MCB, Indicator, AC SPD- FOR 2 KW', 'Reputed make ABB/L&T MCB', 'set', 1],
  ['Cables', 'DC Cable 4 sqmm 1C (Conductor:Tinned annealed stranded flexible copper according to IEC 60228 XLPE Solar Cable (Type-1)', 'Polycab / KEI/ Havells / Finolex', 'mtr', 30],
  ['Cables', 'FOR BATTERY DC Cable 16 sqmm 1C (Conductor:Tinned annealed stranded flexible copper according to IEC 60228 XLPE Solar Cable (Type-1)', 'Polycab / KEI/ Havells / Finolex', 'mtr', 10],
  ['Cables', 'AC Cable 6 sq.mm 2C Insulated Copper Cable (IS 7098-1 & Rated Voltage: 1.1kV)', 'Polycab/MESCAB/Havells / Finolex', 'mtr', 30],
  ['Cables', 'Earth Cable Green 6 Sq.mm 1 C CU', 'Polycab/MESCAB/Havells / Finolex', 'mtr', 50],
  ['Earthing System', '17.2 MM DIA 1 MTR CU BONDED ROD, BFC COMPOUND WITH PIT COVER As per IS 3043', 'TRUE POWER/ SG POWER', 'nos', 2],
  ['Installation & Wiring Materials for completion of work.', '', 'Reputed make', 'set', 1],
  ['Safety Signage (Danger Notice) For DC &AC', 'DC- 200X150 mm as per Approved technical spce & drawing, AC- 200X150 mm as per Approved technical spce & drawing', 'Reputed make', 'nos', 2],
  ['Signage', 'Project Signage & Schematic Diagram', 'Reputed make', 'nos', 1],
];

/**
 * Build the 29 BOQ lines of a project sheet. The section's figure sits on the
 * first line of the section, exactly as the manual sheet shows it — the printer
 * merges that one number down the whole section.
 */
const projectItems = (onGridTotal, offGridTotal) => {
  const toItem = ([description, specification, brandModel, unit, qty], index, section, amount) => ({
    description,
    specification,
    brandModel,
    unit,
    qty,
    section,
    amount: index === 0 ? amount : null,
    order: 0,
  });

  const onGrid = ON_GRID_LINES.map((line, index) => toItem(line, index, ON_GRID_START, onGridTotal));
  const offGrid = OFF_GRID_LINES.map((line, index) => toItem(line, index, OFF_GRID_START, offGridTotal));
  return [...onGrid, ...offGrid].map((item, index) => ({ ...item, order: index + 1 }));
};

const PARTNER_SHEETS = [
  {
    sheet: 'Bank Of Baroda', type: 'partner', scheme: 'BOB', no: 'SE/BOB/2026-27/42', date: '2026-09-24',
    name: 'BRANCH MANAGER', consumerId: '', phone: '',
    addressLine1: 'BANK OF BARODA, AMDANGRA, TALDANGRA', addressLine2: 'BANKURA, WEST BENGAL', pincode: '722149',
    kW: 7, inverterKW: 5, panelWp: 600, panelQty: null, panelBrand: '(EMVEE/Goldi Green/ HR',
    inverterBrand: 'Powerone/Growatt/ THEA', structure: 'rcc_rooftop', amount: 485296,
    items: projectItems(298246, 187050),
  },
  {
    sheet: 'BOB', type: 'partner', scheme: 'BOB', no: 'SE/BOB/2026-27/44', date: '2026-09-28',
    name: 'BRANCH MANAGER', consumerId: '', phone: '',
    addressLine1: 'BANK OF BARODA, 3NO. ANANTA HARI MITRA ROAD, NEDERPARA MORE',
    addressLine2: 'KRISHNANAGAR, NADIA, WEST BENGAL', pincode: '741101',
    kW: 7, inverterKW: 5, panelWp: 600, panelQty: null, panelBrand: '(EMVEE/Goldi Green/ HR',
    inverterBrand: 'Powerone/Growatt/ THEA', structure: 'rcc_rooftop', amount: 372900,
    items: projectItems(190150, 182750),
  },
];

// ------------------------------------------------------------------------- run

const toPayload = (sheet) => ({
  quotationNo: sheet.no,
  quotationType: sheet.type || 'consumer',
  schemeCode: sheet.scheme || 'PMSGY',
  issueDate: sheet.date,
  customerName: sheet.name,
  consumerId: sheet.consumerId || '',
  phoneNo: sheet.phone || '',
  addressLine1: sheet.addressLine1 || '',
  addressLine2: sheet.addressLine2 || '',
  pincode: sheet.pincode || '',
  systemSizeKW: sheet.kW,
  inverterCapacityKW: sheet.inverterKW,
  panelWp: sheet.panelWp,
  panelQty: sheet.panelQty,
  panelBrand: sheet.panelBrand || '',
  inverterBrand: sheet.inverterBrand || '',
  structureType: sheet.structure,
  amount: sheet.amount,
  // The domestic sheet quotes all-in; the project sheet quotes before tax and
  // states the 8.9% rate in its own terms.
  amountIncludesGST: sheet.type !== 'partner',
  status: 'sent',
  notes: `Back-filled from ${SHEET_SOURCE} (sheet: ${sheet.sheet})`,
  items: sheet.items,
});

const run = async () => {
  const sheets = [...CONSUMER_SHEETS, ...PARTNER_SHEETS];

  await mongoose.connect(config.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  console.log(`connected${COMMIT ? '' : '  (DRY RUN — nothing will be written)'}\n`);

  const admin = await User.findOne({ role: 'admin' }).sort({ createdAt: 1 }).lean();
  if (!admin && COMMIT) {
    throw new Error('No admin user found — cannot create quotations.');
  }
  console.log(`acting as: ${admin ? `${admin.name} <${admin.email}>` : '(dry run, no user needed)'}\n`);

  const results = [];
  for (const sheet of sheets) {
    const payload = toPayload(sheet);

    // Idempotent: a live record with this number means it is already done.
    // Soft-deleted records do not block — the unique index only covers live ones.
    // eslint-disable-next-line no-await-in-loop
    const existing = await Quotation.findOne({ quotationNo: payload.quotationNo, isActive: true }).lean();
    if (existing) {
      results.push({ no: payload.quotationNo, outcome: 'SKIPPED (live record already exists)' });
      continue;
    }

    if (!COMMIT) {
      results.push({
        no: payload.quotationNo,
        outcome: `would create · ${payload.quotationType.padEnd(8)} · ${String(payload.items.length).padStart(2)} lines · Rs ${payload.amount} · ${payload.customerName}`,
      });
      continue;
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      const created = await quotationService.createQuotation(payload, admin);
      // The service may hand back the document itself or a wrapper around it.
      const doc = created?.quotation ?? created ?? {};
      results.push({
        no: doc.quotationNo ?? payload.quotationNo,
        outcome: `CREATED · ${String(doc.quotationType ?? payload.quotationType).padEnd(8)} · ${String(doc.items?.length ?? payload.items.length).padStart(2)} lines · Rs ${doc.amount ?? payload.amount} · ${doc.customerName ?? payload.customerName}`,
      });
    } catch (error) {
      results.push({ no: payload.quotationNo, outcome: `FAILED: ${error.message}`, failed: true });
    }
  }

  console.log('no                       | outcome');
  console.log('-'.repeat(110));
  for (const row of results) console.log(`${row.no.padEnd(24)} | ${row.outcome}`);

  const created = results.filter((r) => r.outcome.startsWith('CREATED')).length;
  const skipped = results.filter((r) => r.outcome.startsWith('SKIPPED')).length;
  const failed = results.filter((r) => r.failed).length;
  console.log(`\ntotal ${results.length} · created ${created} · skipped ${skipped} · failed ${failed}`);

  await mongoose.disconnect();
  if (failed) process.exit(1);
};

run().catch(async (error) => {
  console.error('FAILED:', error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
