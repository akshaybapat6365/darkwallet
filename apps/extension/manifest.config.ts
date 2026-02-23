import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'DarkWallet',
  version: '0.2.0',
  description: 'Privacy-preserving Cardano + Midnight extension wallet',
  action: {
    default_title: 'DarkWallet',
    default_popup: 'src/popup/index.html',
  },
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  options_page: 'src/fullpage/index.html',
  permissions: ['storage', 'activeTab', 'scripting', 'tabs'],
  host_permissions: ['<all_urls>'],
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content-scripts/injector.ts'],
      run_at: 'document_start',
    },
  ],
  web_accessible_resources: [
    {
      resources: ['src/injected/provider.ts'],
      matches: ['<all_urls>'],
    },
  ],
});
