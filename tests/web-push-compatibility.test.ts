import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("preserves encrypted Web Push requests on Node with a fake HTTPS transport", () => {
  const result = spawnSync(process.execPath, ["--trace-deprecation", "-e", `
    const assert = require('node:assert/strict');
    const https = require('node:https');
    const { EventEmitter } = require('node:events');
    const { createECDH, randomBytes } = require('node:crypto');
    const webPush = require('web-push');
    const vapid = webPush.generateVAPIDKeys();
    const recipient = createECDH('prime256v1');
    const publicKey = recipient.generateKeys().toString('base64url');
    let encryptedBytes = 0;
    https.request = (options, callback) => {
      assert.equal(options.hostname, 'push.example.invalid');
      assert.equal(options.path, '/send/a%2Fb?token=synthetic');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.TTL, 86400);
      assert.equal(options.headers['Content-Encoding'], 'aes128gcm');
      assert.match(options.headers.Authorization, /^vapid /);
      const request = new EventEmitter();
      request.write = (body) => { encryptedBytes += body.length; };
      request.end = () => {
        const response = new EventEmitter();
        response.statusCode = 201;
        response.headers = {};
        callback(response);
        response.emit('end');
      };
      return request;
    };
    webPush.sendNotification({ endpoint: 'https://push.example.invalid/send/a%2Fb?token=synthetic',
      keys: { p256dh: publicKey, auth: randomBytes(16).toString('base64url') }
    }, 'synthetic reminder', { TTL: 86400, vapidDetails: {
      subject: 'mailto:qa@example.invalid', publicKey: vapid.publicKey, privateKey: vapid.privateKey
    }}).then(result => {
      assert.equal(result.statusCode, 201);
      assert.ok(encryptedBytes > 0);
      console.log('encrypted request passed');
    }).catch(() => process.exitCode = 1);
  `], { encoding: "utf8", timeout: 10_000 });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("encrypted request passed");
  // Ticket 105: web-push 4 uses WHATWG URL parsing. Regressions must not restore
  // the legacy url.parse() warning or introduce another Node deprecation.
  const warningCodes = [...result.stderr.matchAll(/\[(DEP\d+)\]/g)].map((match) => match[1]);
  expect(warningCodes).toEqual([]);
});
