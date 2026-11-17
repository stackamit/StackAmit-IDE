import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import Logo from '../ui/Logo.jsx';
import SocialLinks from '../ui/SocialLinks.jsx';
import { useSiteContent } from '../../hooks/useSiteContent.js';
import { useUserAuth } from '../../context/UserAuthContext.jsx';

function isExternal(href) { return /^https?:\/\//i.test(href); }
function isLegalLink(item) { return /privacy|terms|legal|cookie/i.test(`${item.id} ${item.label}`); }

function FooterLink({ item, accent = false }) {
  const className = `group inline-flex max-w-full items-center gap-2 break-words text-[15px] leading-6 transition-all duration-200 ${accent ? 'text-blue-100/75 hover:translate-x-0.5 hover:text-cyan-300' : 'text-blue-100/75 hover:translate-x-0.5 hover:text-cyan-300'}`;
  if (isExternal(item.href)) return <a href={item.href} target="_blank" rel="noopener noreferrer" className={className}>{item.label}<ArrowUpRight className="shrink-0 text-blue-400/70 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" size={13} /></a>;
  return <Link to={item.href} className={className}>{item.label}</Link>;
}

function sortLinks(column) {
  return (column?.links || []).filter((item) => item?.enabled !== false && item?.label && item?.href && !isLegalLink(item)).sort((a, b) => (a.order || 0) - (b.order || 0));
}

function findColumn(columns, pattern, fallbackIndex) {
  return columns.find((column) => pattern.test(`${column.id} ${column.title}`)) || columns[fallbackIndex] || { title: '', links: [] };
}

export default function SiteFooter() {
  const { footer, social, socialVisibility, branding } = useSiteContent();
  const { user } = useUserAuth();
  const columns = (footer?.columns || []).slice(0, 3);
  const product = findColumn(columns, /product/i, 0);
  const resources = findColumn(columns, /resource|company/i, 1);
  const productLinks = sortLinks(product);
  const resourceLinks = sortLinks(resources);
  const legalLinks = columns.flatMap((column) => column.links || [])
    .filter((item) => item?.enabled !== false && item?.label && item?.href && isLegalLink(item))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const hasDashboard = user && !resourceLinks.some((item) => /dashboard/i.test(`${item.id} ${item.label}`));
  const year = new Date().getFullYear();
  const brandName = branding?.name || 'StackAmit IDE';
  const description = branding?.description || 'A powerful online IDE for developers, with AI assistance and modern tools.';

  return (
    <footer className="relative isolate overflow-hidden border-t border-blue-900/30 bg-[#030b22] text-white dark:bg-[#030b22]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-32 -top-40 h-96 w-[42rem] rounded-full bg-blue-700/25 blur-3xl" />
        <div className="absolute -right-40 top-0 h-80 w-[34rem] rounded-full bg-indigo-700/20 blur-3xl" />
        <div className="absolute bottom-[-15rem] left-1/3 h-96 w-[38rem] rounded-full bg-blue-600/15 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(37,99,235,0.12),transparent_35%),linear-gradient(115deg,rgba(4,16,48,0.97),rgba(2,7,24,0.98))]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 py-14 sm:px-8 sm:py-16 lg:px-12 lg:py-20">
        <div className="grid grid-cols-2 gap-x-8 gap-y-12 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1fr)] md:gap-x-0 md:gap-y-0">
          <section className="col-span-2 min-w-0 md:col-span-1 md:border-r md:border-blue-500/35 md:pr-12" aria-label="Brand and social links">
            <Link to="/" className="focus-ring inline-flex items-center gap-4 rounded-xl">
              <span className="rounded-2xl bg-blue-500/15 p-2 shadow-[0_0_28px_rgba(37,99,235,0.2)] ring-1 ring-blue-400/30"><Logo size={52} src={branding?.logoUrl} alt={`${brandName} logo`} /></span>
              <span className="min-w-0"><span className="block text-2xl font-black tracking-tight text-white sm:text-3xl">{brandName}</span><span className="mt-1 block text-sm font-semibold tracking-wide text-blue-300">{branding?.tagline || 'Code. Compile. Create.'}</span></span>
            </Link>
            <p className="mt-7 max-w-sm text-[15px] leading-7 text-blue-100/75">{description}</p>
            <div className="mt-7"><SocialLinks social={social} socialVisibility={socialVisibility} className="gap-3" iconClass="rounded-full border-blue-300/15 bg-blue-950/70 p-3 text-blue-100 shadow-[0_0_18px_rgba(37,99,235,0.12)] hover:border-blue-400/60 hover:bg-blue-500/20 hover:text-white hover:shadow-[0_0_22px_rgba(37,99,235,0.32)]" /></div>
          </section>

          <nav className="min-w-0 md:border-r md:border-blue-500/35 md:px-10" aria-label={product.title || 'Product'}>
            <h2 className="mb-6 text-lg font-bold tracking-tight text-white">{product.title || 'Product'}</h2>
            <ul className="space-y-3.5">{productLinks.map((item) => <li key={item.id}><FooterLink item={item} /></li>)}</ul>
          </nav>

          <nav className="min-w-0 md:pl-10" aria-label={resources.title || 'Resources & Company'}>
            <h2 className="mb-6 text-lg font-bold tracking-tight text-white">{resources.title || 'Resources & Company'}</h2>
            <ul className="space-y-3.5">{resourceLinks.map((item) => <li key={item.id}><FooterLink item={item} /></li>)}{hasDashboard ? <li><Link to="/account/dashboard" className="inline-flex text-[15px] leading-6 text-blue-100/75 transition-all duration-200 hover:translate-x-0.5 hover:text-cyan-300">Dashboard</Link></li> : null}</ul>
          </nav>
        </div>
      </div>

      <div className="relative border-t border-blue-500/35 bg-[#020817]/75"><div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-6 text-sm text-blue-100/70 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-12"><span className="shrink-0">© {year} {brandName}. {footer?.copyright || 'All rights reserved.'}</span>{legalLinks.length ? <nav aria-label="Legal" className="flex flex-wrap items-center gap-x-5 gap-y-2 lg:justify-center">{legalLinks.map((item) => <FooterLink key={item.id} item={item} accent />)}</nav> : null}<span className="shrink-0 text-blue-100/80 lg:text-right">Made by {brandName} for future Developers.</span></div></div>
    </footer>
  );
}
