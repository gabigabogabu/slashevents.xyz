import { describe, test } from "bun:test";

import { expect } from "@/test-expect";
import {
  normalizeFingerprintSha256,
  parsePublicCertificate,
  requestBodySha256,
  signedRequestPayload,
} from "./agents";

const testCertificate = `-----BEGIN CERTIFICATE-----
MIIBfzCCASWgAwIBAgIUQBOxIZiIYRKQRY5dD9MdiLXjy9AwCgYIKoZIzj0EAwIw
FTETMBEGA1UEAwwKYWdlbnQtbmFtZTAeFw0yNjA2MTcxMjUyNDBaFw0yNzA2MTcx
MjUyNDBaMBUxEzARBgNVBAMMCmFnZW50LW5hbWUwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAASmOWm6JNgeXvbYG4pzmV2F012kYKEvixDnFbnrAaZBtnLCIbaKtvQe
K4mEHOWKjOVD2x3kIOf27iSCCbpmX5dyo1MwUTAdBgNVHQ4EFgQU4og7xbCsHp9G
BgE6ZdqJY7iVUWwwHwYDVR0jBBgwFoAU4og7xbCsHp9GBgE6ZdqJY7iVUWwwDwYD
VR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNIADBFAiEAnbgjWmj7dynSN4xf0XVL
4+qIULcg+Cj5kOO879MPMvsCIB7gKNTa2myEboke2CLWw6b1EokEYDIIlTd8rlWX
ektR
-----END CERTIFICATE-----`;

describe("agent certificates", () => {
  test("normalizes openssl SHA-256 fingerprint output", () => {
    const fingerprint = normalizeFingerprintSha256(
      "sha256 Fingerprint=11:0d:f8:dc:dd:14:6d:89:01:eb:a5:61:dd:7b:48:f5:71:b5:f6:11:39:44:ca:49:91:93:10:f4:83:6f:dd:d0",
    );

    expect(fingerprint).toBe("11:0D:F8:DC:DD:14:6D:89:01:EB:A5:61:DD:7B:48:F5:71:B5:F6:11:39:44:CA:49:91:93:10:F4:83:6F:DD:D0");
  });

  test("rejects malformed fingerprints", () => {
    expect(() => normalizeFingerprintSha256("not-a-fingerprint")).toThrow();
  });

  test("parses public certificate PEM", () => {
    const parsed = parsePublicCertificate(testCertificate);

    expect(parsed.fingerprintSha256).toBe("D9:C2:C8:90:E1:2B:FF:9E:FC:B9:AA:1A:32:FB:A6:87:CF:15:CF:71:D1:76:51:8A:BF:5A:70:26:BE:06:9A:1C");
    expect(parsed.subject).toBe("CN=agent-name");
    expect(parsed.publicCertPem).toBe(testCertificate);
    expect(parsed.validFrom?.getUTCFullYear()).toBe(2026);
    expect(parsed.validTo?.getUTCFullYear()).toBe(2027);
  });

  test("builds the signed request payload from method, path, timestamp, and body hash", () => {
    const body = '{"method":"getProjects","params":{}}';

    expect(requestBodySha256(body)).toBe("935548fb55f6754b34ff54cab05162647ad436d61b9a9134250cbcc76333c2fe");
    expect(signedRequestPayload({
      method: "post",
      pathWithQuery: "/rpc",
      timestamp: "123",
      body,
    })).toBe("POST\n/rpc\n123\n935548fb55f6754b34ff54cab05162647ad436d61b9a9134250cbcc76333c2fe");
  });
});
