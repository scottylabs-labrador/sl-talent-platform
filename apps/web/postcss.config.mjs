// Explicit (empty) PostCSS config. Without this file Next.js walks up parent
// directories and can pick up an unrelated postcss.config outside the repo.
const config = { plugins: {} };

export default config;
