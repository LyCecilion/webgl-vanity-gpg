import { createApp } from 'vue';
import App from './ui/App.vue';
import { translate } from './ui/i18n/translate.ts';
import { preferences } from './ui/preferences.ts';
import { setupTheme } from './ui/theme.ts';
import './ui/styles/tokens.css';
import './ui/styles/app.css';

setupTheme();

// Apply the stored locale before the first paint so the document language and
// title match the rendered UI.
document.documentElement.lang = preferences.locale;
document.title = translate(preferences.locale, 'app.name');

createApp(App).mount('#app');
