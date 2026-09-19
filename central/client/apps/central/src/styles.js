/*
Copyright 2022 ODK Central Developers
See the NOTICE file at the top-level directory of this distribution and at
https://github.com/getodk/central-frontend/blob/master/NOTICE.

This file is part of ODK Central. It is subject to the license terms in
the LICENSE file found in the top-level directory of this distribution and at
https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
including this file, may be copied, modified, propagated, or distributed
except according to the terms contained in the LICENSE file.
*/

// Import global styles.
import './assets/css/namespaces.css';
import './assets/css/bootstrap.css';
import './assets/css/icomoon.css';
import './assets/scss/app.scss';

// Gradient design system. Self-hosted faces first, then the token layer, then
// the restyle layer, which is the load order the design handoff requires:
// bootstrap.css -> central app styles -> gradient-tokens -> gradient-overrides.
import '@fontsource/hanken-grotesk/300.css';
import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/500.css';
import '@fontsource/hanken-grotesk/600.css';
import '@fontsource/hanken-grotesk/700.css';
import '@fontsource/hanken-grotesk/800.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';
import '../../../design/gradient/gradient-tokens.css';
import '../../../design/gradient/gradient-overrides.css';
