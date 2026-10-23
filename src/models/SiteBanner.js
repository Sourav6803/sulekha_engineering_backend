// src/models/SiteBanner.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * A strip of artwork on the public site.
 *
 * Two kinds end up here and they are managed the same way:
 *
 *  - **Scheme banners** — the official PM Surya Ghar artwork. The office uploads
 *    the government's own file; nothing is generated or redrawn here.
 *  - **Campaign banners** — the ones printed for a festival or a locality, with a
 *    QR code that brings the reader back to this site. `campaign` records which
 *    banner the visit came from, so a scan can be told apart from a walk-in.
 *
 * A banner is shown only while it is active *and* inside its date window, which
 * is what lets a seasonal banner be scheduled ahead of time and expire by itself.
 */

const SiteBannerSchema = new Schema(
  {
    title: {
      type: String,
      required: [true, 'Banner title is required'],
      trim: true,
      maxlength: [120, 'Title cannot exceed 120 characters'],
    },

    /** Read out by a screen reader, and used as the fallback if the image fails. */
    altText: {
      type: String,
      trim: true,
      maxlength: [200, 'Alt text cannot exceed 200 characters'],
    },

    imageUrl: {
      type: String,
      required: [true, 'Banner image is required'],
      trim: true,
    },

    publicId: {
      type: String,
      trim: true,
    },

    /** Where a click goes. Empty means the banner is informational only. */
    linkUrl: {
      type: String,
      trim: true,
    },

    ctaLabel: {
      type: String,
      trim: true,
      maxlength: [40, 'CTA label cannot exceed 40 characters'],
    },

    placement: {
      type: String,
      enum: ['home_hero', 'scheme_strip', 'home_popup', 'footer', 'other'],
      default: 'scheme_strip',
      index: true,
    },

    /**
     * The printed banner's identifier, e.g. "puja-2026". Anything arriving with
     * ?utm_source=<campaign> is attributed to it on the lead.
     */
    campaign: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: [60, 'Campaign tag cannot exceed 60 characters'],
    },

    order: {
      type: Number,
      default: 0,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    /** Optional window. Empty means "for as long as it is active". */
    startsAt: Date,
    endsAt: Date,

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ==================== VIRTUALS ====================

/** Active and inside its window, judged at read time. */
SiteBannerSchema.virtual('isLive').get(function () {
  if (!this.isActive) return false;
  const now = Date.now();
  if (this.startsAt && this.startsAt.getTime() > now) return false;
  if (this.endsAt && this.endsAt.getTime() < now) return false;
  return true;
});

// ==================== METHODS ====================

/** What the public site receives. Nothing internal travels with it. */
SiteBannerSchema.methods.toPublic = function () {
  return {
    id: this._id,
    title: this.title,
    altText: this.altText || this.title,
    imageUrl: this.imageUrl,
    linkUrl: this.linkUrl || null,
    ctaLabel: this.ctaLabel || null,
    placement: this.placement,
    campaign: this.campaign || null,
    order: this.order,
  };
};

// ==================== INDEXES ====================

// The site asks for "live banners in this placement, in order".
SiteBannerSchema.index({ placement: 1, isActive: 1, order: 1 });
SiteBannerSchema.index({ campaign: 1 });

const SiteBanner = mongoose.model('SiteBanner', SiteBannerSchema);
export default SiteBanner;
