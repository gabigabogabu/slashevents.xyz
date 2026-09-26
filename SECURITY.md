# Security

Report vulnerabilities privately through [GitHub security advisories](https://github.com/gabigabogabu/slashevents.xyz/security/advisories/new). Include the affected image version, reproduction steps, and impact. Do not include live credentials or customer webhook payloads.

The instance API token grants full access to all projects. Keep it secret, use HTTPS for remote clients, and rotate it by updating the server configuration and all clients. The current stable release receives security fixes; use versioned images and review release notes when updating.

Webhook ingress is intentionally separate from management authentication. An allowlisted URL accepts events from anyone who knows it. Consumers should validate their webhook provider's signatures before trusting an event. Stored headers and payloads may be sensitive; protect database access and backups.
