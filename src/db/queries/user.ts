import type { SQL } from "@/db/types";
import { randomBytes, type UUID } from "crypto";

type UserDbRow = {
  id: UUID;
  display_name: string;
  fingerprint_sha256: string;
  public_cert_pem: string;
  subject: string | null;
  cert_valid_from: Date | string | null;
  cert_valid_to: Date | string | null;
  revoked: boolean;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export type AgentUserDbRow = Pick<
  UserDbRow,
  | "id"
  | "display_name"
  | "fingerprint_sha256"
  | "public_cert_pem"
  | "subject"
  | "cert_valid_from"
  | "cert_valid_to"
  | "created_at"
  | "revoked"
  | "revoked_at"
>;

export const insertUser = async (db: SQL, params: {
  display_name?: string | null;
  fingerprint_sha256?: string | null;
  public_cert_pem?: string | null;
}): Promise<string | undefined> => {
  const row = {
    display_name: params.display_name ?? "Agent",
    fingerprint_sha256: params.fingerprint_sha256
      ?? randomBytes(32).toString("hex").match(/.{2}/g)?.join(":").toUpperCase()
      ?? randomBytes(32).toString("hex"),
    public_cert_pem: params.public_cert_pem ?? "test certificate placeholder",
  };
  const res = await db`
    INSERT INTO users ${db(row, "display_name", "fingerprint_sha256", "public_cert_pem")}
    RETURNING id;
  ` as Pick<UserDbRow, "id">[];
  return res[0]?.id;
};

export const getUserById = async (db: SQL, params: { id: UUID }): Promise<Pick<UserDbRow, "id" | "display_name" | "created_at" | "updated_at"> | undefined> => {
  const res = await db`SELECT id, display_name, created_at, updated_at FROM users WHERE id = ${params.id};` as Pick<UserDbRow, "id" | "display_name" | "created_at" | "updated_at">[];
  return res[0];
};

export const insertAgentUser = async (
  db: SQL,
  params: {
    display_name: string;
    fingerprint_sha256: string;
    public_cert_pem: string;
    subject?: string | null;
    cert_valid_from?: Date | null;
    cert_valid_to?: Date | null;
  },
): Promise<Pick<AgentUserDbRow, "id" | "created_at"> | undefined> => {
  const validFrom = params.cert_valid_from ? db`${params.cert_valid_from}` : db`NULL`;
  const validTo = params.cert_valid_to ? db`${params.cert_valid_to}` : db`NULL`;
  const res = await db`
    INSERT INTO users (
      display_name,
      fingerprint_sha256,
      public_cert_pem,
      subject,
      cert_valid_from,
      cert_valid_to
    )
    VALUES (
      ${params.display_name},
      ${params.fingerprint_sha256},
      ${params.public_cert_pem},
      ${params.subject ?? null},
      ${validFrom},
      ${validTo}
    )
    RETURNING id, created_at;
  ` as Pick<AgentUserDbRow, "id" | "created_at">[];
  return res[0];
};

export const getAgentUserByFingerprint = async (
  db: SQL,
  params: { fingerprint_sha256: string },
): Promise<AgentUserDbRow | undefined> => {
  const res = await db`
    SELECT id, display_name, fingerprint_sha256, public_cert_pem, subject,
      cert_valid_from, cert_valid_to, created_at, revoked, revoked_at
    FROM users
    WHERE fingerprint_sha256 = ${params.fingerprint_sha256}
    LIMIT 1;
  ` as AgentUserDbRow[];
  return res[0];
};
