// src/models/ProjectShowcase.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * One completed installation, told as a story for the website.
 *
 * This is the "blog" the office asked for: the admin picks a finished job, adds
 * the photographs and films taken on site, and publishes it. The public site
 * reads only published entries, and only the fields below — never the internal
 * notes, and never the customer's name unless `customerConsent` says the family
 * agreed to be named.
 *
 * Media is embedded rather than kept in its own collection: a project's gallery
 * has no meaning apart from the project, it is always read with it, and the whole
 * set is bounded (see MAX_MEDIA below).
 */

/** A gallery is bounded so one project cannot turn into an unbounded document. */
export const MAX_MEDIA_PER_PROJECT = 24;

const MediaSchema = new Schema(
  {
    kind: {
      type: String,
      enum: ['image', 'video'],
      required: [true, 'Media kind is required'],
    },

    url: {
      type: String,
      required: [true, 'Media url is required'],
      trim: true,
    },

    /** Cloudinary handle, kept so the asset can be removed with the row. */
    publicId: {
      type: String,
      trim: true,
    },

    /**
     * Where the file actually lives. A short clip is uploaded; a long film is
     * usually already on YouTube, so both are allowed and the UI can embed
     * accordingly.
     */
    provider: {
      type: String,
      enum: ['cloudinary', 'youtube', 'vimeo', 'drive', 'other'],
      default: 'cloudinary',
    },

    /** Poster frame for a video, or a smaller copy for a gallery tile. */
    thumbnailUrl: {
      type: String,
      trim: true,
    },

    caption: {
      type: String,
      trim: true,
      maxlength: [200, 'Caption cannot exceed 200 characters'],
    },

    width: Number,
    height: Number,
    durationSeconds: Number,

    order: {
      type: Number,
      default: 0,
    },
  },
  { _id: true }
);

const ProjectShowcaseSchema = new Schema(
  {
    // ---------------------------------------------------------------- identity
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      minlength: [3, 'Title must be at least 3 characters'],
      maxlength: [120, 'Title cannot exceed 120 characters'],
    },

    /** Public, human-readable address: /showcase/3kw-rooftop-bardhaman */
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },

    /** One line under the title on a card. */
    summary: {
      type: String,
      trim: true,
      maxlength: [300, 'Summary cannot exceed 300 characters'],
    },

    /** The long form: what the site was like, what was built, what changed. */
    story: {
      type: String,
      trim: true,
      maxlength: [8000, 'Story cannot exceed 8000 characters'],
    },

    // ------------------------------------------------------------------ person
    /** Kept for the office; only published when the family agreed to be named. */
    customerName: {
      type: String,
      trim: true,
      maxlength: [100, 'Customer name cannot exceed 100 characters'],
    },

    customerConsent: {
      type: Boolean,
      default: false,
    },

    // ---------------------------------------------------------------- location
    location: {
      district: { type: String, trim: true, index: true },
      state: { type: String, trim: true, default: 'West Bengal' },
      area: { type: String, trim: true },
      pincode: {
        type: String,
        trim: true,
        match: [/^[0-9]{6}$/, 'Please enter a valid 6-digit pincode'],
      },
    },

    // ------------------------------------------------------------------ system
    capacityKW: {
      type: Number,
      required: [true, 'System capacity is required'],
      min: [0.1, 'Capacity must be greater than 0'],
      max: [1000, 'Capacity looks wrong'],
      index: true,
    },

    panelBrand: {
      type: String,
      trim: true,
      maxlength: [60, 'Panel brand cannot exceed 60 characters'],
      index: true,
    },

    panelModel: {
      type: String,
      trim: true,
      maxlength: [80, 'Panel model cannot exceed 80 characters'],
    },

    panelCount: {
      type: Number,
      min: [0, 'Panel count cannot be negative'],
    },

    inverterBrand: {
      type: String,
      trim: true,
      maxlength: [60, 'Inverter brand cannot exceed 60 characters'],
    },

    systemType: {
      type: String,
      enum: ['on-grid', 'off-grid', 'hybrid'],
      default: 'on-grid',
    },

    structureType: {
      type: String,
      trim: true,
      maxlength: [60, 'Structure type cannot exceed 60 characters'],
    },

    scheme: {
      type: String,
      trim: true,
      default: 'PMSGY',
    },

    commissionedAt: {
      type: Date,
      index: true,
    },

    // ------------------------------------------------------------------- media
    /** Card image. Falls back to the first image in the gallery when absent. */
    coverImage: {
      url: { type: String, trim: true },
      publicId: { type: String, trim: true },
    },

    media: {
      type: [MediaSchema],
      default: [],
      validate: {
        validator: (items) => (items?.length ?? 0) <= MAX_MEDIA_PER_PROJECT,
        message: `A project can hold at most ${MAX_MEDIA_PER_PROJECT} media items`,
      },
    },

    // ------------------------------------------------------------------ public
    tags: {
      type: [String],
      default: [],
    },

    highlight: {
      type: Boolean,
      default: false,
    },

    isPublished: {
      type: Boolean,
      default: false,
      index: true,
    },

    publishedAt: {
      type: Date,
      index: true,
    },

    /** Cheap social proof, and a hint about which stories are worth writing. */
    views: {
      type: Number,
      default: 0,
      min: 0,
    },

    seo: {
      title: { type: String, trim: true, maxlength: 70 },
      description: { type: String, trim: true, maxlength: 160 },
    },

    // ---------------------------------------------------------------- metadata
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

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

/** A card needs an image even when nobody set a cover. */
ProjectShowcaseSchema.virtual('displayCover').get(function () {
  if (this.coverImage?.url) return this.coverImage.url;
  const first = [...(this.media || [])]
    .filter((item) => item.kind === 'image' && item.url)
    .sort((a, b) => a.order - b.order)[0];
  return first?.url || null;
});

ProjectShowcaseSchema.virtual('mediaCount').get(function () {
  return this.media?.length ?? 0;
});

// ==================== METHODS ====================

/**
 * What the website is allowed to see.
 *
 * Written as an explicit allow-list rather than a delete-list: a field added to
 * the schema later stays private until someone decides it should be public.
 */
ProjectShowcaseSchema.methods.toPublic = function () {
  return {
    id: this._id,
    title: this.title,
    slug: this.slug,
    summary: this.summary || null,
    story: this.story || null,
    customerName: this.customerConsent ? this.customerName || null : null,
    location: {
      district: this.location?.district || null,
      state: this.location?.state || null,
      area: this.location?.area || null,
    },
    capacityKW: this.capacityKW,
    panelBrand: this.panelBrand || null,
    panelModel: this.panelModel || null,
    panelCount: this.panelCount ?? null,
    inverterBrand: this.inverterBrand || null,
    systemType: this.systemType,
    structureType: this.structureType || null,
    scheme: this.scheme || null,
    commissionedAt: this.commissionedAt || null,
    coverImage: this.displayCover,
    media: (this.media || [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((item) => ({
        id: item._id,
        kind: item.kind,
        url: item.url,
        provider: item.provider,
        thumbnailUrl: item.thumbnailUrl || null,
        caption: item.caption || null,
        width: item.width ?? null,
        height: item.height ?? null,
        durationSeconds: item.durationSeconds ?? null,
        // The gallery is ordered on the way out, and the office needs the number
        // back to drag an item to a new position.
        order: item.order ?? 0,
      })),
    tags: this.tags || [],
    highlight: this.highlight,
    publishedAt: this.publishedAt || null,
    views: this.views || 0,
  };
};

// ==================== HOOKS ====================

/**
 * Derive a unique slug from the title.
 *
 * Done here rather than in the service so every write path — including a future
 * import — produces an addressable URL. `select: false` on the check keeps the
 * lookup to one field.
 */
ProjectShowcaseSchema.pre('validate', async function () {
  /*
   * A published story has a URL that may already be printed, shared or linked
   * from a QR banner, so a later title edit must not silently move it. The slug
   * is derived on creation only; changing it afterwards is a deliberate act.
   */
  if (!this.isNew) return;
  if (!this.title) return;

  const base = String(this.title)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'project';

  let candidate = base;
  let suffix = 1;
  // Bounded: a title repeated more than 50 times is a data problem, not a slug.
  while (suffix <= 50) {
    const clash = await this.constructor.exists({
      slug: candidate,
      _id: { $ne: this._id },
    });
    if (!clash) break;
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }

  this.slug = candidate;
});

/** Publishing stamps the date once, and unpublishing leaves it for the record. */
ProjectShowcaseSchema.pre('save', function () {
  if (this.isModified('isPublished') && this.isPublished && !this.publishedAt) {
    this.publishedAt = new Date();
  }
});

// ==================== INDEXES ====================

// The public list is "published, newest first, optionally by district or brand".
ProjectShowcaseSchema.index({ isPublished: 1, isActive: 1, publishedAt: -1 });
ProjectShowcaseSchema.index({ isPublished: 1, isActive: 1, highlight: -1, publishedAt: -1 });
ProjectShowcaseSchema.index({ 'location.district': 1, isPublished: 1 });
ProjectShowcaseSchema.index({ panelBrand: 1, isPublished: 1 });
ProjectShowcaseSchema.index({ capacityKW: 1, isPublished: 1 });
ProjectShowcaseSchema.index({ title: 'text', summary: 'text', story: 'text' });

const ProjectShowcase = mongoose.model('ProjectShowcase', ProjectShowcaseSchema);
export default ProjectShowcase;
