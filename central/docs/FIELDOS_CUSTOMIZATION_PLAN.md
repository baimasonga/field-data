# Field Data Customization Plan

## 1. Where Product Name Appears
The name "ODK Central" appears across both the frontend (`client`) and backend (`server`) repositories, as well as in the root Docker configuration.
- **Frontend**: 
  - `client/apps/central/src/i18n.js` (or in locales/ translation strings)
  - `client/apps/central/src/components/account/login.vue`
  - `client/apps/central/src/components/navbar.vue`
  - `client/apps/central/src/components/app.vue`
  - `client/README.md`
- **Backend**: 
  - `server/README.md`, `server/NOTICE`, `server/CONTRIBUTING.md`
  - Email templates: `server/lib/external/mail.js`, `server/lib/formats/mail.js`
  - Copyright headers in files like `server/lib/constants.js`
- **Root**: `.env.template`, `docker-compose.yml`, `README.md`

## 2. Where Logo Assets are Stored
- **Favicons / Web Manifest**: `client/public/` (e.g. `favicon.ico`, `favicon-32x32.png`, `android-chrome-*.png`, `apple-touch-icon.png`)
- **App Logos**: `client/apps/central/src/assets/images/odk-logo.png`

## 3. Where Colors/Theme are Defined
- SCSS Variables: `client/apps/central/src/assets/scss/_variables.scss`
- Global Styles: `client/apps/central/src/assets/scss/app.scss`

## 4. Where Navigation Items are Defined
- Main navigation bar: `client/apps/central/src/components/navbar.vue` (and related components inside `src/components/navbar/`)

## 5. Where Dashboard/Home Page is Defined
- `client/apps/central/src/components/project/list.vue`
- `client/apps/central/src/components/home/home.vue` and `home-block.vue`

## 6. Where Login Page is Defined
- `client/apps/central/src/components/account/login.vue`

## 7. Where Project Pages are Defined
- `client/apps/central/src/components/project/show.vue` (Project details/routing)
- `client/apps/central/src/components/project/overview.vue` (Project overview)
- `client/apps/central/src/components/project/settings.vue` (Project settings)

## 8. Recommended Safe Modification Order
To safely modify this application without breaking compatibility:
1. **Configuration & Documentation**: Set up branding variables, `.env.Field_Data.example`, and update documentation (e.g., `README.md`, `Field_Data_BRANDING.md`).
2. **Static Assets**: Replace logos in `client/public` and `client/apps/central/src/assets/images`.
3. **UI Text & Strings**: Update translation files and text in Vue components (`login.vue`, `project/list.vue`).
4. **Email Templates**: Update branding in the backend email formats.
5. **Styles**: Modify SCSS variables to match the new brand color scheme.
6. **Docker/Build config**: Ensure that `docker-compose.yml` mounts the correct `client` files and points to the new local build source if necessary.
7. **Verification**: Run `docker compose up --build` and perform end-to-end testing.
