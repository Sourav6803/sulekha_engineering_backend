import mongoose from 'mongoose';

const NotificationSchema = new mongoose.Schema({}, {
  strict: false,
  timestamps: true,
});

const Notification = mongoose.models.Notification || mongoose.model('Notification', NotificationSchema);

export default Notification;
