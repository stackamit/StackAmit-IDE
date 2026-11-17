import { Schema, model } from 'mongoose';

const str = (max = 2000) => ({ type: String, default: '', maxlength: max });

const sectionSchema = (fields) => {
  const obj = {};
  for (const [name, max] of fields) obj[name] = str(max);
  return new Schema(obj, { _id: false });
};
const linkSchema = new Schema({ id: { type: String, required: true }, label: { type: String, required: true, maxlength: 80 }, href: { type: String, required: true, maxlength: 500 }, enabled: { type: Boolean, default: true }, order: { type: Number, default: 10 } }, { _id: false });
const navigationSchema = new Schema({ links: { type: [linkSchema], default: [] } }, { _id: false });
const footerSchema = new Schema({ copyright: { type: String, maxlength: 200, default: 'All rights reserved.' }, columns: { type: [{ id: String, title: { type: String, maxlength: 80 }, links: [linkSchema] }], default: [] } }, { _id: false });

const siteContentSchema = new Schema(
  {
    _id: { type: String, default: 'site' },
    published: { type: Boolean, default: true },
    branding: sectionSchema([['name', 80], ['tagline', 160], ['description', 300], ['logoUrl', 500]]),
    navigation: navigationSchema,
    footer: footerSchema,
    seo: sectionSchema([['title', 160], ['description', 320]]),
    home: sectionSchema([['badge', 80], ['heroTitle', 160], ['heroSubtitle', 500], ['ctaPrimary', 40], ['ctaSecondary', 40]]),
    about: sectionSchema([['heading', 120], ['mission', 80], ['intro', 600], ['body', 4000]]),
    ai: sectionSchema([
      ['badge', 80], ['heading', 160], ['intro', 800], ['overview', 4000], ['mission', 120],
      ['capabilities', 4000], ['providers', 3000], ['privacy', 3000], ['offline', 3000],
      ['roadmap', 3000], ['cta', 160], ['ctaLabel', 80],
    ]),
    // Structured documentation is kept in the existing site document so the
    // public page and Pages editor share one publication boundary.
    aiDocumentation: { type: Schema.Types.Mixed, default: {} },
    contact: sectionSchema([['heading', 120], ['subtitle', 400], ['email', 160], ['responseTime', 160]]),
    privacy: sectionSchema([['title', 160], ['intro', 1000], ['body', 12000]]),
    terms: sectionSchema([['title', 160], ['intro', 1000], ['body', 12000]]),
    support: sectionSchema([['title', 160], ['intro', 1000], ['body', 12000], ['email', 160]]),
    social: sectionSchema([
      ['website', 200], ['facebook', 200], ['twitter', 200], ['instagram', 200],
      ['linkedin', 200], ['github', 200], ['youtube', 200],
    ]),
    socialVisibility: { type: Schema.Types.Mixed, default: {} },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

export const SiteContent = model('SiteContent', siteContentSchema);

/** Read the stored override doc, or null if nothing has been saved yet. */
export async function readStoredContent() {
  return SiteContent.findById('site').lean();
}

export async function writeStoredContent(content) {
  return SiteContent.findByIdAndUpdate('site', content, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
  }).lean();
}
