---
description: README.md
alwaysApply: false
---
# Web-Latch
Never lose a webhook.

- receive webhooks from various 3rd parties and store them
- provide an RPC API for the consumer service to (long) poll for new webhooks
  - getWebhooks(afterId, limit, timeout, filter) -> [webhook1, webhook2, ...]
    - afterId skip over webhooks earlier than this id
    - limit max number of webhooks to return
    - timeout max time to wait for new webhooks
    - filter optional filter to apply to the webhooks, e.g. only specific sources
- customer can configure latches, each latch
  - can have a list of acceptable IP addresses to receive webhooks from



# bun-react-tailwind-shadcn-template

To install dependencies:

```bash
bun install
```

To start a development server:

```bash
bun dev
```

To run for production:

```bash
bun start
```

This project was created using `bun init` in bun v1.3.0. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
