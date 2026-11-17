import { Facebook, Twitter, Instagram, Linkedin, Github, Youtube, Globe } from 'lucide-react';

// Field name in the content.social object → { Icon, label }.
const NETWORKS = [
  { key: 'facebook', Icon: Facebook, label: 'Facebook' },
  { key: 'twitter', Icon: Twitter, label: 'X (Twitter)' },
  { key: 'instagram', Icon: Instagram, label: 'Instagram' },
  { key: 'linkedin', Icon: Linkedin, label: 'LinkedIn' },
  { key: 'github', Icon: Github, label: 'GitHub' },
  { key: 'youtube', Icon: Youtube, label: 'YouTube' },
  { key: 'website', Icon: Globe, label: 'Website' },
];

/**
 * Renders only the social channels the admin has actually filled in. When none
 * are set, renders nothing (so public layouts never show dead placeholder links).
 */
export default function SocialLinks({ social = {}, socialVisibility = {}, className = '', iconClass = 'p-2' }) {
  const configured = NETWORKS.filter(({ key }) => {
    const v = social[key];
    return socialVisibility[key] !== false && typeof v === 'string' && /^https?:\/\//i.test(v.trim());
  });
  const configuredUrls = new Set();
  const items = configured.filter(({ key }) => {
    const href = social[key].trim();
    // A stale CMS record can contain the same URL in several platform fields.
    // Keep the explicit Website entry as the canonical representation instead
    // of showing misleading duplicate platform icons.
    if (configuredUrls.has(href)) return false;
    if (key !== 'website' && social.website && socialVisibility.website !== false && social.website.trim() === href) return false;
    configuredUrls.add(href);
    return true;
  });
  if (items.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {items.map(({ key, Icon, label }) => (
        <a
          key={key}
          href={social[key].trim()}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          title={label}
          className={`focus-ring rounded-lg border border-slate-200 text-slate-500 hover:border-brand-300 hover:text-brand-500 dark:border-ink-800 dark:text-slate-400 ${iconClass}`}
        >
          <Icon size={16} />
        </a>
      ))}
    </div>
  );
}
