import type { SQL } from "@/db/types";

export default async (db: SQL) => {
  await db`CREATE TABLE IF NOT EXISTS app.users (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    display_name VARCHAR(255) NOT NULL DEFAULT 'Agent',
    fingerprint_sha256 VARCHAR(95) NOT NULL UNIQUE,
    public_cert_pem TEXT NOT NULL,
    subject TEXT NULL,
    cert_valid_from TIMESTAMP NULL,
    cert_valid_to TIMESTAMP NULL,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`;
};
