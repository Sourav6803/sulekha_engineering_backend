import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env.development') });

import config from '../config/env.js';
import Material from '../models/Material.js';
import Counter from '../models/Counter.js';

const MONGO_URI = config.MONGO_URI;

const MATERIALS = [
  { name: 'Adani Topcon -DCR', desc: '620 Wp', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/Solar_panel_on_roof.jpg/640px-Solar_panel_on_roof.jpg' },
  { name: 'SOLAR STRING INVERTERS (Microtek)', desc: 'PVB Link 3.3 kWp - 1 ph', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Solar_inverter.jpg/640px-Solar_inverter.jpg' },
  { name: 'LEG (FRONT)-80CS40X15X2', desc: '2060 mm', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Metal_structure.jpg/640px-Metal_structure.jpg' },
  { name: 'LEG (BACK)-80CS40X15X2', desc: '2704 mm', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Metal_structure.jpg/640px-Metal_structure.jpg' },
  { name: 'RAFTER-60CS40X15X2', desc: '4100 mm', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Metal_structure.jpg/640px-Metal_structure.jpg' },
  { name: 'FRONT BRACING -ISA50X50X5', desc: '1330 mm', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Metal_structure.jpg/640px-Metal_structure.jpg' },
  { name: 'BACK BRACING -ISA50X50X5', desc: '1297 mm', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Metal_structure.jpg/640px-Metal_structure.jpg' },
  { name: 'Purlin [SQ. TUBE]', desc: '3600 mm', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Metal_structure.jpg/640px-Metal_structure.jpg' },
  { name: 'Nut-Bolt-Double Washer', desc: 'M10X25', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Nut_and_bolt.jpg/640px-Nut_and_bolt.jpg' },
  { name: 'Star Nut Bolt Washer', desc: 'M10X100', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Nut_and_bolt.jpg/640px-Nut_and_bolt.jpg' },
  { name: 'U CLAMP', desc: 'M8', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Nut_and_bolt.jpg/640px-Nut_and_bolt.jpg' },
  { name: 'Mid Clamp [75 LONG]', desc: '25 mm', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Metal_structure.jpg/640px-Metal_structure.jpg' },
  { name: 'End Clamp[75 LONG]', desc: '30 mm', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Metal_structure.jpg/640px-Metal_structure.jpg' },
  { name: 'NUT PLATE', desc: '30 mm', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Nut_and_bolt.jpg/640px-Nut_and_bolt.jpg' },
  { name: 'DR. FIXIT', desc: '200 ml', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/Dr_Fixit_logo.png/640px-Dr_Fixit_logo.png' },
  { name: 'GROUTED CHEMICAL', desc: '', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/Dr_Fixit_logo.png/640px-Dr_Fixit_logo.png' },
  { name: 'DCDB', desc: '1 in 1 out (600V SPD)', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Solar_inverter.jpg/640px-Solar_inverter.jpg' },
  { name: 'DC CABLE', desc: '4 Sq mm 1 Core Type-1', unit: 'mtr', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Electrical_cable.jpg/640px-Electrical_cable.jpg' },
  { name: 'MC4 CONNECTOR', desc: '(M+F)', unit: 'pair', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Electrical_cable.jpg/640px-Electrical_cable.jpg' },
  { name: 'RING LUG', desc: '4 - 6 mm', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Nut_and_bolt.jpg/640px-Nut_and_bolt.jpg' },
  { name: 'PIN LUG', desc: '4 - 6 mm', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Nut_and_bolt.jpg/640px-Nut_and_bolt.jpg' },
  { name: 'MMS PVC PIPE', desc: '25 mm 3 mtr', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/PVC_pipe.jpg/640px-PVC_pipe.jpg' },
  { name: 'CHINA SHADDLE', desc: '25mm', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/PVC_pipe.jpg/640px-PVC_pipe.jpg' },
  { name: 'PVC TEE', desc: '25mm', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/PVC_pipe.jpg/640px-PVC_pipe.jpg' },
  { name: 'PVC ELBOW', desc: '25mm', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/PVC_pipe.jpg/640px-PVC_pipe.jpg' },
  { name: 'ACDB', desc: '1 phase (16 amp)', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Solar_inverter.jpg/640px-Solar_inverter.jpg' },
  { name: 'AC CABLE', desc: '4 sq mm 2 core ALU armoured', unit: 'mtr', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Electrical_cable.jpg/640px-Electrical_cable.jpg' },
  { name: 'CHINA SHADDLE', desc: '14 mm', unit: 'packet', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/PVC_pipe.jpg/640px-PVC_pipe.jpg' },
  { name: 'RING LUG', desc: '10mm', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Nut_and_bolt.jpg/640px-Nut_and_bolt.jpg' },
  { name: 'PIN LUG', desc: '10 mm', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Nut_and_bolt.jpg/640px-Nut_and_bolt.jpg' },
  { name: 'BUSBAR (1PH / 3PH) WITH BOX', desc: '1ph', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Solar_inverter.jpg/640px-Solar_inverter.jpg' },
  { name: 'PVC CABLE TRAY', desc: '45 x 45', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Electrical_cable.jpg/640px-Electrical_cable.jpg' },
  { name: 'MCB', desc: '32 amp 2 Pole', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Electrical_cable.jpg/640px-Electrical_cable.jpg' },
  { name: 'MCB ENCLOSER', desc: 'PVC', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Electrical_cable.jpg/640px-Electrical_cable.jpg' },
  { name: 'AC CABLE', desc: '4 SQ MM AC CABLE 2 CORE Cu', unit: 'mtr', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Electrical_cable.jpg/640px-Electrical_cable.jpg' },
  { name: 'LA', desc: '1 mtr coper', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Electrical_cable.jpg/640px-Electrical_cable.jpg' },
  { name: 'MS Angke for Extension [ISA25x25x5]', desc: 'ISA 25x25x5', unit: 'mtr', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Metal_structure.jpg/640px-Metal_structure.jpg' },
  { name: 'Insulated Pipe (FRP Material)', desc: '1/2 inch Dia FRP material', unit: 'mm', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/PVC_pipe.jpg/640px-PVC_pipe.jpg' },
  { name: 'Nut Bolt Washer (M6X40)', desc: 'M6x40mm', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Nut_and_bolt.jpg/640px-Nut_and_bolt.jpg' },
  { name: 'Self thread screw', desc: '2 inch', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Nut_and_bolt.jpg/640px-Nut_and_bolt.jpg' },
  { name: 'LA INSULATOR', desc: 'Big', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Electrical_cable.jpg/640px-Electrical_cable.jpg' },
  { name: 'EARTHING CABLE', desc: '6 Sq mm Cu 1 core', unit: 'mtr', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Electrical_cable.jpg/640px-Electrical_cable.jpg' },
  { name: 'EARTHING CABLE', desc: '16 Sq mm Cu 1 core', unit: 'mtr', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Electrical_cable.jpg/640px-Electrical_cable.jpg' },
  { name: 'EARTHING ROD', desc: 'CU bounded 2 mtr 16 mm', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Metal_structure.jpg/640px-Metal_structure.jpg' },
  { name: 'EARTHING PIT COVER', desc: 'PVC Small', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/PVC_pipe.jpg/640px-PVC_pipe.jpg' },
  { name: 'EARTHING BUS Bar', desc: '4 hole', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Metal_structure.jpg/640px-Metal_structure.jpg' },
  { name: 'GI STRIP', desc: '19x3', unit: 'kg', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Metal_structure.jpg/640px-Metal_structure.jpg' },
  { name: 'PVC INSULATOR', desc: 'Flat', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/PVC_pipe.jpg/640px-PVC_pipe.jpg' },
  { name: 'BUSBAR NUT BOLT WASHER', desc: 'SS M8 x 30', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Nut_and_bolt.jpg/640px-Nut_and_bolt.jpg' },
  { name: 'GI STRIP JOINT NUT BOLT WASHER', desc: 'SS M6 x 25', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Nut_and_bolt.jpg/640px-Nut_and_bolt.jpg' },
  { name: 'BFC', desc: '25 kg', unit: 'bag', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/Dr_Fixit_logo.png/640px-Dr_Fixit_logo.png' },
  { name: 'CABLE TIE', desc: 'PVC 200mm uv protected', unit: 'packet', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Electrical_cable.jpg/640px-Electrical_cable.jpg' },
  { name: 'SCREW', desc: 'SS 8 x 35', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Nut_and_bolt.jpg/640px-Nut_and_bolt.jpg' },
  { name: 'Cleaning Brush', desc: '6 Mtr.', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Brush.jpg/640px-Brush.jpg' },
  { name: 'Zink Spray', desc: '', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/Dr_Fixit_logo.png/640px-Dr_Fixit_logo.png' },
  { name: 'PVC TAPE - (R,G,B)', desc: 'R 1 G 1 B 1', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/PVC_pipe.jpg/640px-PVC_pipe.jpg' },
  { name: 'WOODEN GUJI', desc: 'WOODEN', unit: 'packet', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Metal_structure.jpg/640px-Metal_structure.jpg' },
  { name: 'SLD STICKER', desc: '', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Metal_structure.jpg/640px-Metal_structure.jpg' },
  { name: 'SULEKHA LOGO STICKER', desc: '', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Metal_structure.jpg/640px-Metal_structure.jpg' },
  { name: 'EARTHING STICKER', desc: '', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Metal_structure.jpg/640px-Metal_structure.jpg' },
  { name: 'PVC casing pin', desc: '', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/PVC_pipe.jpg/640px-PVC_pipe.jpg' },
  { name: 'DANGER STICKER', desc: '', unit: 'nos', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Metal_structure.jpg/640px-Metal_structure.jpg' },
];

async function seedMaterials() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    const existingCount = await Material.countDocuments({ isActive: true });
    console.log(`Existing active materials: ${existingCount}`);

    let inserted = 0;
    let skipped = 0;

    for (const item of MATERIALS) {
      const existing = await Material.findOne({
        name: { $regex: `^${item.name}$`, $options: 'i' },
        isActive: true,
      });

      if (existing) {
        skipped++;
        existing.createdBy = '6a7ad273f91a079190f7de2d';
        existing.updatedBy = '6a7ad273f91a079190f7de2d';
        if (item.imageUrl && !existing.images?.length) {
          existing.images = [{ url: item.imageUrl, caption: item.name, isPrimary: true }];
        }
        await existing.save();
        continue;
      }

      const counter = await Counter.findByIdAndUpdate(
        'materialCode',
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );

      const materialCode = `MAT-${String(counter.seq).padStart(4, '0')}`;

      await Material.create({
        materialCode,
        name: item.name,
        description: item.desc,
        unit: item.unit,
        currentStock: 0,
        reservedStock: 0,
        minimumStockLevel: 0,
        maximumStockLevel: 0,
        unitCost: 0,
        status: 'active',
        isActive: true,
        isConsumable: true,
        createdBy: '6a7ad273f91a079190f7de2d',
        updatedBy: '6a7ad273f91a079190f7de2d',
        images: item.imageUrl ? [{ url: item.imageUrl, caption: item.name, isPrimary: true }] : [],
      });

      inserted++;
    }

    console.log(`\nSeeding completed:`);
    console.log(`  Inserted: ${inserted}`);
    console.log(`  Skipped (already exists): ${skipped}`);
    console.log(`  Total active materials: ${await Material.countDocuments({ isActive: true })}`);

    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding materials:', error);
    process.exit(1);
  }
}

seedMaterials();
