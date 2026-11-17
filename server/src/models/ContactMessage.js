import { Schema, model } from 'mongoose';

/**
 * A message submitted through the public Contact form. Visible to the admin
 * inbox only. No execution-provider data, no credentials — just the enquiry.
 */
const contactMessageSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 200 },
    subject: { type: String, trim: true, maxlength: 200, default: '' },
    message: { type: String, required: true, trim: true, maxlength: 5000 },
    read: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

contactMessageSchema.index({ createdAt: -1 });
contactMessageSchema.index({ read: 1, createdAt: -1 });

export const ContactMessage = model('ContactMessage', contactMessageSchema);
