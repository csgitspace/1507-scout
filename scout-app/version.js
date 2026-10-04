// The app version. Bump this on EVERY change to the scout app, or iPads keep
// running the old cached copy. It is shared by the page and the service
// worker (sw.js), and travels in every record so the laptop can see which
// version produced it. (Field changes also need SCHEMA_VERSION in shared/fields.js.)
self.APP_VERSION = '1.0.1';
