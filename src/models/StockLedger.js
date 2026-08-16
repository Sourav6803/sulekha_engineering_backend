import mongoose from 'mongoose';

const StockLedgerSchema = new mongoose.Schema({}, {
  strict: false,
  timestamps: true,
});

const StockLedger = mongoose.models.StockLedger || mongoose.model('StockLedger', StockLedgerSchema);

export default StockLedger;
