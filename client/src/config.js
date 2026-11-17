/** Shared frontend constants. */

// Company website — every "StackAmit" brand reference links here.
export const COMPANY_URL = 'https://stackamit.netlify.app';

export const APP_NAME = 'StackAmit-IDE';
export const APP_TAGLINE = 'Code. Compile. Create.';

// Company logo served from client/public/logo.jpg (falls back to the built-in mark).
export const LOGO_SRC = `${import.meta.env.BASE_URL || '/'}logo.jpg`.replace(/\/{2,}/g, '/');
