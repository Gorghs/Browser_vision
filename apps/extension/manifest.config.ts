/**
 * Manifest V3 definition.
 *
 * Kept as TypeScript so the build can emit it and so the reasoning behind each
 * permission stays next to the permission itself. Every entry below is required
 * by code that exists; nothing is requested speculatively.
 */
const manifest: chrome.runtime.ManifestV3 = {
  manifest_version: 3,
  name: 'Visual AI Browser Agent',
  version: '0.1.0',
  description: 'Turns permitted browser activity into a searchable activity timeline.',
  minimum_chrome_version: '116',

  permissions: [
    // Tab lifecycle events, and the URL/title of tracked tabs.
    'tabs',
    // Extension settings and the offline event buffer.
    'storage',
    // Committed navigations, which `chrome.tabs` alone reports unreliably.
    'webNavigation',
    // Periodic queue flush that survives service worker termination.
    'alarms',
  ],

  // No `<all_urls>`: the extension only ever talks to its own backend, and the
  // user can point that at a different origin from the popup.
  host_permissions: ['http://localhost/*', 'http://127.0.0.1/*'],

  // Capturing a tab's pixels requires permission over the pages being captured.
  // It is optional and requested at the moment the user switches visual capture
  // on, so installing the extension never grants the ability to see pages, and
  // revoking the setting hands the permission back.
  optional_host_permissions: ['http://*/*', 'https://*/*'],

  background: {
    service_worker: 'background.js',
    type: 'module',
  },

  content_scripts: [
    {
      // Interaction tracking needs a script on the pages the user visits. It is
      // inert until the user turns tracking on, and it reads no field values.
      matches: ['http://*/*', 'https://*/*'],
      js: ['content.js'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],

  action: {
    default_popup: 'popup.html',
    default_title: 'Visual AI Browser Agent',
    default_icon: {
      '16': 'icons/icon-16.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    },
  },

  icons: {
    '16': 'icons/icon-16.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png',
  },
};

export default manifest;
