// src/models/Counter.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

const CounterSchema = new Schema({
  _id: {
    type: String,
    required: true
  },
  seq: {
    type: Number,
    default: 0
  }
});

// Static method to get next sequence
CounterSchema.statics = {
  async getNextSequence(name) {
    const result = await this.findByIdAndUpdate(
      name,
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    return result.seq;
  },

  async resetSequence(name, value = 0) {
    await this.findByIdAndUpdate(
      name,
      { seq: value },
      { new: true, upsert: true }
    );
  }
};

const Counter = mongoose.model('Counter', CounterSchema);
export default Counter;
