# Vendored libraries

Copied in as plain files so the iPad app works offline with no build step.
Don't edit them. To upgrade, replace the file from npm and run `npm test`.

| File | Package | Version | License |
|---|---|---|---|
| `qrcode.js` | [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (Kazuhiko Arase) | 1.4.4 | MIT |
| `jsQR.js` | [jsqr](https://github.com/cozmo/jsQR) (Cosmo Wolfe) | 1.4.0 | Apache-2.0 (`jsQR.LICENSE`) |

`package.json` here marks these as CommonJS so the Node tests can `require` them.
