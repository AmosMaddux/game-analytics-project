# Cost feasibility: conditional planning pass

Checked 10 October 2026. USD. The planned private pilot may fit below **$30/month**, but no measured operating bill, deployed capacity pass or production cost guarantee exists.

## Planning envelope

- Cloudflare hosting/database: **$5/month** proposed allocation
- Future OpenAI application allowance: **$12/month** proposed enforced cap
- Contingency: **$5/month**
- Planned subtotal: **$22/month**, before tax and excluding an optional domain

The remaining $8 must cover tax and any other required costs. This is not spending authorization. OpenAI is not integrated; no model quote, quality result or token-use benchmark is claimed. Account usage, licensing, private-access services, search, backups and Codespaces overage must be reconciled before claiming an under-$30 result.

## Workload and storage

Planning estimates include daily Steam metrics, daily IGDB refresh and five monthly tag rounds only if permitted. For 36 games: **2,534 first-month external requests**, or **2,788 with a 10% reserve**. The proposed 500-game design: **38,906**, or **42,797 with reserve**. These are not scheduled jobs or collector capabilities. Review-date pagination, new-game discovery and marketing research are additional work not included in those headline totals.

The observed IGDB import used **8 successful requests**, logged **369,727 response-body bytes**, saved **2,174,772 artifact bytes** and took **10.896 seconds**. Network waits are not Worker CPU time, and external source fetches are not each billable Worker invocations. The refreshed Steam run is one-time feasibility evidence; it does not establish recurring monthly cost.

D1 meters scanned/written rows, not merely returned rows. Its 2,000,000-byte single-row/value limit rules out storing the expanded catalog import as one BLOB. Normalized records, bounded retention and measured indexing/storage are still needed.

## Codespaces cost caution

The preview is private development hosting. GitHub Free personal allowances are **120 core-hours** and **15 GB-month** per cycle: at two cores, 120 core-hours means **60 running hours**. Beyond included usage, two-core compute is **$0.18/hour**, plus **$0.07/GB-month** storage. Eligibility, machine size, remaining allowance and the actual bill have not been inspected.

At two cores with a full allowance, 720 running hours would be **$118.80 compute** before storage and tax. Closing a browser tab does not stop the Codespace; stopping compute leaves retained storage usage. Do not treat this preview as always-on hosting within $30.

## Before an operating-cost pass

Measure actual CPU, memory, query scans/writes, storage/index growth, private access, model usage and account allowances. Simulate a full month, include tax and all required services, and test spending stops. Source rights and quotas remain independent conditions.

## Primary pricing sources

- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [GitHub Codespaces billing](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces)
- [Codespaces lifecycle](https://docs.github.com/en/codespaces/about-codespaces/understanding-the-codespace-lifecycle)

Detailed source record: `cost-validation-2026-10-10.md` in the original research workspace, retained there and not bundled. See [M1 outcome](../MILESTONE-1.md) for scope and evidence limitations.
