import { createHash, verify, X509Certificate, type UUID } from "node:crypto";
import { z } from "zod";

import { AppError } from "@/lib/app-error";
import { ErrorCode } from "@/lib/errors";
import type { SQL } from "@/db/types";
import * as queries from "@/db/queries";
import { timestampToIsoString } from "@/db/timestamps";

export type AgentIdentity = {
  userId: UUID;
  name: string;
  fingerprintSha256: string;
};

export type AgentUserSummary = {
  id: UUID;
  alias: string;
  fingerprintSha256: string;
  subject: string | null;
  certValidFrom: string | null;
  certValidTo: string | null;
  createdAt: string;
  revoked: boolean;
  revokedAt: string | null;
};

export const normalizeFingerprintSha256 = (fingerprint: string): string => {
  const normalized = fingerprint
    .trim()
    .replace(/^sha256 Fingerprint=/i, "")
    .replaceAll("-", ":")
    .toUpperCase();
  const parsed = z.string().regex(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/).safeParse(normalized);
  if (!parsed.success) {
    throw new AppError(ErrorCode.INVALID_INPUT, 400, "Invalid SHA-256 certificate fingerprint");
  }
  return parsed.data;
};

const dateFromCert = (value: string | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const parsePublicCertificate = (pem: string): {
  fingerprintSha256: string;
  publicCertPem: string;
  subject: string | null;
  validFrom: Date | null;
  validTo: Date | null;
} => {
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(pem);
  } catch {
    throw new AppError(ErrorCode.INVALID_INPUT, 400, "Invalid certificate PEM");
  }
  return {
    fingerprintSha256: normalizeFingerprintSha256(cert.fingerprint256),
    publicCertPem: pem,
    subject: cert.subject || null,
    validFrom: dateFromCert(cert.validFrom),
    validTo: dateFromCert(cert.validTo),
  };
};

export const createAgentUser = async (
  params: {
    alias: string;
    publicCertPem: string;
  },
  { db }: { db: SQL },
): Promise<{ user: AgentUserSummary }> => {
  const certInfo = parsePublicCertificate(params.publicCertPem);

  const inserted = await queries.insertAgentUser(db, {
    display_name: params.alias,
    fingerprint_sha256: certInfo.fingerprintSha256,
    public_cert_pem: certInfo.publicCertPem,
    subject: certInfo.subject,
    cert_valid_from: certInfo.validFrom,
    cert_valid_to: certInfo.validTo,
  });

  if (!inserted) {
    throw new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 500, "Failed to create user");
  }

  return {
    user: {
      id: inserted.id,
      alias: params.alias,
      fingerprintSha256: certInfo.fingerprintSha256,
      subject: certInfo.subject,
      certValidFrom: certInfo.validFrom?.toISOString() ?? null,
      certValidTo: certInfo.validTo?.toISOString() ?? null,
      createdAt: timestampToIsoString(inserted.created_at),
      revoked: false,
      revokedAt: null,
    },
  };
};

const dbDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const assertRegisteredCertificateIsCurrentlyValid = (row: queries.AgentUserDbRow): void => {
  const validFrom = dbDate(row.cert_valid_from);
  const validTo = dbDate(row.cert_valid_to);
  const now = Date.now();
  if (validFrom && validFrom.getTime() > now)
    throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 401, "Registered certificate is not valid yet");
  if (validTo && validTo.getTime() <= now)
    throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 401, "Registered certificate has expired");
};

export const requestBodySha256 = (body: string): string =>
  createHash("sha256").update(body, "utf8").digest("hex");

export const signedRequestPayload = (params: {
  method: string;
  pathWithQuery: string;
  timestamp: string;
  body: string;
}): string => [
  params.method.toUpperCase(),
  params.pathWithQuery,
  params.timestamp,
  requestBodySha256(params.body),
].join("\n");

const timestampFromHeader = (value: string): number => {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) return parsed;
  throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 401, "Invalid request signature timestamp");
};

const assertTimestampIsFresh = (value: string): void => {
  const timestamp = timestampFromHeader(value);
  const maxSkewMs = 5 * 60 * 1000;
  if (Math.abs(Date.now() - timestamp) > maxSkewMs) {
    throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 401, "Request signature timestamp is outside the allowed window");
  }
};

export const authenticateAgentSignedRequest = async (
  params: {
    fingerprintSha256: string;
    timestamp: string;
    signature: string;
    method: string;
    pathWithQuery: string;
    body: string;
  },
  { db }: { db: SQL },
): Promise<AgentIdentity> => {
  assertTimestampIsFresh(params.timestamp);
  const fingerprintSha256 = normalizeFingerprintSha256(params.fingerprintSha256);
  const row = await queries.getAgentUserByFingerprint(db, {
    fingerprint_sha256: fingerprintSha256,
  });
  if (!row) {
    throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 401, "Unknown certificate fingerprint");
  }
  if (row.revoked) {
    throw new AppError(ErrorCode.FORBIDDEN, 403, "Registered certificate has been revoked");
  }
  if (!row.public_cert_pem) {
    throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 401, "Registered certificate is missing");
  }
  assertRegisteredCertificateIsCurrentlyValid(row);

  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(row.public_cert_pem);
  } catch {
    throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 401, "Registered certificate is invalid");
  }

  const payload = signedRequestPayload({
    method: params.method,
    pathWithQuery: params.pathWithQuery,
    timestamp: params.timestamp,
    body: params.body,
  });
  const signature = Buffer.from(params.signature, "base64");
  const isValid = signature.length > 0 && verify(
    "sha256",
    Buffer.from(payload, "utf8"),
    certificate.publicKey,
    signature,
  );
  if (!isValid) {
    throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 401, "Invalid request signature");
  }

  return {
    userId: row.id,
    name: row.display_name,
    fingerprintSha256,
  };
};
