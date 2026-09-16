/** Tailwind v4 ships its own PostCSS plugin package; there is no separate autoprefixer step. */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
