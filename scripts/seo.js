// SEO structured-data (JSON-LD) for the storefront.
//
// Ports the Magento `Eighteentech_Seo` module's site-wide structured data to
// EDS. The legacy module emitted, via `structureddata/organization.phtml`
// (wired through `default.xml` into every page's <head>):
//   1. an Organization graph (name, address, contact point, social profiles)
//   2. a WebSite graph with a SearchAction
// Both were driven by the "Organization Structured Data" admin config.
//
// That admin config now lives in the App Builder SEO service (the
// Eighteentech_Seo app, same backend the Commerce Admin SEO console writes
// to). We read it from `config-get` and build the same two JSON-LD graphs
// client-side. The base URL is configured in config.json as `seo-endpoint`;
// mirrors the existing `testimonials-endpoint` pattern.
import { getConfigValue } from '@dropins/tools/lib/aem/configs.js';
import { setJsonLd, rootLink } from './commerce.js';

/**
 * Resolve the SEO config API base URL from config.json.
 * @returns {string} base URL (no trailing slash), or '' if unconfigured
 */
function endpoint() {
  let value;
  try {
    value = getConfigValue('seo-endpoint');
  } catch (e) {
    // config.json not initialized yet
  }
  return (value || '').replace(/\/$/, '');
}

/**
 * Read the singleton SEO config from the App Builder service. Returns the
 * config object, or null if it can't be fetched (never throws — SEO metadata
 * is best-effort and must not break page load).
 */
async function fetchSeoConfig() {
  const base = endpoint();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/config-get`);
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.success === false) return null;
    return json?.config || null;
  } catch (e) {
    return null;
  }
}

/** Absolute site URL for a storefront path, honouring the multistore prefix. */
function siteUrl(path = '/') {
  return new URL(rootLink(path), window.location.origin).href;
}

/**
 * Resolve the organization logo: explicit config override first, then the
 * rendered site logo, then the favicon as a last resort (parity with the legacy
 * theme-logo lookup).
 */
function resolveLogo(config) {
  if (config.logoUrl) return config.logoUrl;
  const img = document.querySelector('header img, .nav-brand img, .logo img, a[href="/"] img');
  if (img?.src) return img.src;
  return siteUrl('/favicon.ico');
}

/**
 * Build the Organization graph. Mirrors organization.phtml field-for-field;
 * omits empty optional sub-objects rather than emitting blank strings.
 */
function buildOrganizationLd(config) {
  const ld = {
    '@context': 'http://schema.org',
    '@type': 'Organization',
    name: config.orgName || '',
    alternateName: config.orgAlternateName || '',
    url: siteUrl('/'),
    logo: resolveLogo(config),
  };

  if (config.orgTelephone) {
    ld.contactPoint = {
      '@type': 'ContactPoint',
      telephone: config.orgTelephone,
      contactType: config.contactType || 'customer support',
      areaServed: config.areaServed || 'AU',
    };
  }

  const {
    streetAddress, addressLocality, addressRegion, postalCode, addressCountry,
  } = config;
  if (streetAddress || addressLocality || addressRegion || postalCode || addressCountry) {
    ld.address = {
      '@type': 'PostalAddress',
      streetAddress: streetAddress || '',
      addressLocality: addressLocality || '',
      addressRegion: addressRegion || '',
      postalCode: postalCode || '',
      addressCountry: addressCountry || '',
    };
  }

  const profiles = Array.isArray(config.socialProfiles)
    ? config.socialProfiles.map((p) => String(p).trim()).filter(Boolean)
    : [];
  if (profiles.length) ld.sameAs = profiles;

  return ld;
}

/**
 * Build the WebSite graph with a search action. Legacy targeted
 * `catalogsearch/result/?q={query}`; the EDS storefront searches at `/search`.
 */
function buildWebsiteLd() {
  return {
    '@context': 'http://schema.org',
    '@type': 'WebSite',
    url: siteUrl('/'),
    potentialAction: {
      '@type': 'SearchAction',
      target: `${siteUrl('/search')}?q={query}`,
      'query-input': 'required name=query',
    },
  };
}

/**
 * Fetch the SEO config and inject the Organization + WebSite JSON-LD into the
 * document head. No-op when the config can't be read or the feature is
 * disabled (parity with the legacy Helper::isEnabled() gate). Best-effort:
 * never throws.
 */
export async function initSeo() {
  const config = await fetchSeoConfig();
  if (!config || String(config.active) !== '1') return;
  if (!config.orgName) return;

  setJsonLd(buildOrganizationLd(config), 'seo-organization');
  setJsonLd(buildWebsiteLd(), 'seo-website');
}

export default initSeo;
