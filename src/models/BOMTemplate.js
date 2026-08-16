import mongoose from 'mongoose';

const BOMTemplateSchema = new mongoose.Schema({}, {
  strict: false,
  timestamps: true,
});

const BOMTemplate = mongoose.models.BOMTemplate || mongoose.model('BOMTemplate', BOMTemplateSchema);

export default BOMTemplate;
