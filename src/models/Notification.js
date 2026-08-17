// src/models/Notification.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

const NotificationSchema = new Schema({
  type: {
    type: String,
    enum: ['low_stock', 'installation', 'purchase', 'system', 'scheme', 'external'],
    required: true,
    index: true,
  },
  source: {
    type: String,
    enum: ['internal', 'PM Surya Ghar', 'MNRE', 'PIB', 'DISCOM'],
    default: 'internal',
    index: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters'],
  },
  message: {
    type: String,
    required: true,
    trim: true,
    maxlength: [1000, 'Message cannot exceed 1000 characters'],
  },
  link: {
    type: String,
    trim: true,
  },
  category: {
    type: String,
    enum: ['scheme_update', 'subsidy', 'registration', 'general', 'alert', 'info', 'warning'],
    default: 'general',
    index: true,
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium',
    index: true,
  },
  isRead: {
    type: Boolean,
    default: false,
    index: true,
  },
  isExternal: {
    type: Boolean,
    default: false,
    index: true,
  },
  metadata: {
    type: Schema.Types.Mixed,
    default: {},
  },
}, {
  timestamps: true,
});

NotificationSchema.index({ type: 1, createdAt: -1 });
NotificationSchema.index({ source: 1, createdAt: -1 });
NotificationSchema.index({ isRead: 1, createdAt: -1 });
NotificationSchema.index({ category: 1, priority: 1 });

const Notification = mongoose.models.Notification || mongoose.model('Notification', NotificationSchema);

export default Notification;
