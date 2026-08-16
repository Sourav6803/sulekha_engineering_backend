import mongoose from 'mongoose';
import config from './src/config/env.js';
import Material from './src/models/Material.js';

const MASTER_BOM_DESCRIPTIONS = [
  ['Adani Topcon -DCR', '620 Wp'],
  ['SOLAR STRING INVERTERS (Microtek)', 'PVB Link 3.3 kWp - 1 ph'],
  ['LEG (FRONT)-80CS40X15X2', '2060 mm'],
  ['LEG (BACK)-80CS40X15X2', '2704 mm'],
  ['RAFTER-60CS40X15X2', '4100 mm'],
  ['FRONT BRACING -ISA50X50X5', '1330 mm'],
  ['BACK BRACING -ISA50X50X5', '1297 mm'],
  ['Purlin [SQ. TUBE]', '3600 mm'],
  ['Nut-Bolt-Double Washer', 'M10X25'],
  ['Star Nut Bolt Washer', 'M10X100'],
  ['U CLAMP', 'M8'],
  ['Mid Clamp [75 Long]', '25 mm'],
  ['End Clamp[75 LONG]', '30 mm'],
  ['NUT PLATE', '30 mm'],
  ['DR. FIXIT', '200 ml'],
  ['GROUTED CHEMICAL', ''],
  ['DCDB', '1 in 1 out (600V SPD)'],
  ['DC CABLE', '4 Sq mm 1 Core Type-1'],
  ['MC4 CONNECTOR', '(M+F)'],
  ['RING LUG', '4 - 6 mm'],
  ['PIN LUG', '4 - 6 mm'],
  ['MMS PVC PIPE', '25 mm 3 mtr'],
  ['CHINA SHADDLE', '25mm'],
  ['PVC TEE', '25mm'],
  ['PVC ELBOW', '25mm'],
  ['ACDB', '1 phase (16 amp)'],
  ['AC CABLE', '4 sq mm 2 core ALU armoured'],
  ['CHINA SHADDLE', '14 mm'],
  ['RING LUG', '10mm'],
  ['PIN LUG', '10 mm'],
  ['BUSBAR (1PH / 3PH) WITH BOX', '1ph'],
  ['PVC CABLE TRAY', '45 x 45'],
  ['MCB', '32 amp 2 Pole'],
  ['MCB ENCLOSER', 'PVC'],
  ['AC CABLE', '4 SQ MM AC CABLE 2 CORE Cu'],
  ['LA', '1 mtr coper'],
  ['MS Angke for Extension [ISA25x25x5]', 'ISA 25x25x5'],
  ['Insulated Pipe (FRP Material)', '1/2 inch Dia FRP material'],
  ['Nut Bolt Washer (M6X40)', 'M6x40mm'],
  ['Self thread screw', '2 inch'],
  ['LA INSULATOR', 'Big'],
  ['EARTHING CABLE', '6 Sq mm Cu 1 core'],
  ['EARTHING CABLE', '16 Sq mm Cu 1 core'],
  ['EARTHING ROD', 'CU bounded 2 mtr 16 mm'],
  ['EARTHING PIT COVER', 'PVC Small'],
  ['EARTHING BUS Bar', '4 hole'],
  ['GI STRIP', '19x3'],
  ['PVC INSULATOR', 'Flat'],
  ['BUSBAR NUT BOLT WASHER', 'SS M8 x 30'],
  ['GI STRIP JOINT NUT BOLT WASHER', 'SS M6 x 25'],
  ['BFC', '25 kg'],
  ['CABLE TIE', 'PVC 200mm uv protected'],
  ['SCREW', 'SS 8 x 35'],
  ['Cleaning Brush', '6 Mtr.'],
  ['Zink Spray', ''],
  ['PVC TAPE - (R,G,B)', 'R 1 G 1 B 1'],
  ['WOODEN GUJI', 'WOODEN'],
  ['SLD STICKER', ''],
  ['SULEKHA LOGO STICKER', ''],
  ['EARTHING STICKER', ''],
  ['PVC casing pin', ''],
  ['DANGER STICKER', ''],
];

await mongoose.connect(config.MONGO_URI);

let totalUpdated = 0;

for (const [name, desc] of MASTER_BOM_DESCRIPTIONS) {
  const result = await Material.updateMany(
    {
      name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      $or: [{ description: '' }, { description: { $exists: false } }],
    },
    { $set: { description: desc } }
  );
  totalUpdated += result.modifiedCount;
}

console.log(`Updated ${totalUpdated} material documents with descriptions`);

const stats = await Material.aggregate([
  { $group: { _id: null, total: { $sum: 1 }, withDesc: { $sum: { $cond: [{ $ne: ['$description', ''] }, 1, 0] } } } },
]);
console.log('DB Stats:', JSON.stringify(stats[0], null, 2));

await mongoose.disconnect();
