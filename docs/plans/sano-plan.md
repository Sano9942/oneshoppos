# SANO Pakistan Company Structure and SanoPay Strategy

**Date:** 2026-04-10  
**Audience:** Founder, product owner, legal/compliance advisors, implementation engineers, future agents  
**Status:** Founder strategy and execution plan grounded in current repo state and current Pakistan public-regulatory paths  
**Companion files:** `competitive-analysis-2.md`, `CLAUDE.md`, `backend/CLAUDE.md`, `feature-development-references.md`

---

## 1. Purpose

This document answers a founder-level question:

How should the business behind SanoPOS be structured in Pakistan so that:

- the company can operate cleanly as a software business now
- the company can launch `SanoPay` without pretending to be a bank
- the company can partner with Bank Alfalah, JazzCash, easypaisa, and similar rails
- the company can later expand into financing, BNPL, or regulated financial products if economics justify it

This is not a generic fintech memo. It is a repo-specific strategy document for the actual OneShopPOS/SanoPOS codebase and roadmap.

The document is designed to be:

- realistic about Pakistan licensing constraints
- specific about what can be done immediately
- clear about what requires a partner
- explicit about what requires a separate future license
- practical enough that the founder can start execution from it

---

## 2. Current Repo Reality

Before deciding the legal and partner strategy, the current product shape matters.

### 2.1 What the codebase already supports

The repo already treats payments as a modular integration surface rather than a hardcoded internal banking system:

- `CLAUDE.md` documents an extensible payment adapter at `services/payment-gateway.js`
- webhook handling already exists at `routes/webhooks.js`
- billing checkout already uses an intent-based flow
- gateway activation is feature-gated by `PAYMENT_GATEWAY`
- `backend/CLAUDE.md` documents current optional gateway env vars:
  - `PAYMENT_GATEWAY=xpay`
  - `XPAY_API_KEY`
  - `XPAY_WEBHOOK_SECRET`
- when payment gateway config is absent, the system already falls back to manual admin payments

This is strategically important.

It means SanoPOS already has the right architectural direction for `SanoPay`:

- adapter-based gateway abstraction
- webhook-first settlement confirmation
- non-destructive fallback path
- separation between product billing and internal platform logic

### 2.2 What this means for SanoPay

SanoPay does **not** need to begin life as a licensed bank-like institution.

It can begin as:

- payment orchestration
- hosted checkout abstraction
- payment-link generation
- QR and wallet rail aggregation
- merchant onboarding workflow
- unified transaction and settlement reporting
- refund and reconciliation software

That is fully aligned with the current codebase.

### 2.3 What the repo should not assume yet

The codebase should **not** yet assume:

- SANO will hold customer funds
- SANO will issue stored-value wallets
- SANO will directly underwrite loans
- SANO will directly settle card payments as principal
- SANO will own an EMI or PSO/PSP license at launch

Those are business-model and regulatory layers above the current software architecture.

---

## 3. Executive Decisions

These are the recommended founder decisions for this phase.

### 3.1 Legal entity

Form the company in Pakistan as:

- `SANO (Private) Limited`

If that name is not available, reserve one of these immediately:

- `SANO Technologies (Private) Limited`
- `SANO Commerce Technologies (Private) Limited`
- `SANO Digital Commerce (Private) Limited`

### 3.2 Brand architecture

Use one Pakistan legal entity with multiple product brands:

- `SANO` = company / legal umbrella
- `SanoPOS` = commerce operating system / POS / ERP / fulfillment / omnichannel layer
- `SanoPay` = payments orchestration / checkout / reconciliation / partner-rail layer

At launch:

- `SanoPOS` can remain publicly visible immediately
- `SanoPay` should be treated as a **soft-launch brand** first

Meaning:

- use `SanoPay` in internal plans, partner decks, integration docs, architecture docs
- expose it publicly only after at least one live payment partner is contractually active

### 3.3 Company form

Use a `private limited company`, not an SMC, unless speed becomes more important than future flexibility.

Reason:

- SECP states that any two or more persons may form a private company
- a single-member private company is possible, but private limited is cleaner for:
  - future investment
  - bank partnerships
  - equity allocation
  - employee/share options later
  - future regulated subsidiary structures

### 3.4 Regulatory posture at launch

Launch as:

- a software company
- a merchant-enablement company
- a payment-orchestration platform
- an integration layer on top of licensed banks/wallets/gateways

Do **not** launch as:

- a bank
- a wallet issuer
- a deposit taker
- a direct lender
- a claim-based “licensed payment company” unless and until that is actually true

### 3.5 Operating model

Recommended launch model:

- merchant pays via partner rails
- funds settle from partner rail directly to merchant bank/wallet account
- SANO never holds customer funds
- SANO charges software fees and negotiates referral/revenue-share economics where possible

This is the cleanest legal and commercial structure.

---

## 4. Why Pakistan Incorporation Is The Right First Move

The founder question was whether the company should be registered outside Pakistan to get around licensing moats.

The answer is: for this business, **Pakistan-first incorporation is the better starting point**.

### 4.1 Why a foreign company does not remove the moat

The moat is not mainly where the company is incorporated.

The moat is:

- local payment rail access
- acquiring partnerships
- merchant onboarding rights
- KYC and AML obligations
- settlement relationships
- lending permissions

If the target merchants are in Pakistan and the core payment flows are in Pakistan, then:

- local banks
- SBP-regulated rails
- local wallet operators
- local NBFC partners

still control the actual financial rails.

Foreign incorporation can help later with:

- fundraising
- investor familiarity
- IP holding
- regional expansion

But it does **not** magically remove Pakistani licensing requirements for Pakistan-facing payment and lending activity.

### 4.2 Why Pakistan incorporation helps now

Pakistan incorporation helps because:

- SECP company formation is straightforward and digitized
- local partner banks prefer dealing with Pakistan entities
- local contracts, tax registrations, KYC files, and commercial bank accounts are simpler
- SBP payment frameworks reference Pakistan-registered entities for regulated roles
- if SANO later wants a regulated subsidiary, the local path is cleaner

### 4.3 Recommended long-term structure

Start with:

- `SANO (Private) Limited` in Pakistan as the operating company

Later, if needed:

- create a foreign holding company above it for fundraising and IP ownership

Do **not** delay execution waiting for foreign structuring.

---

## 5. SECP Incorporation Strategy For SANO

### 5.1 Legal formation recommendation

Recommended entity:

- `Private Limited Company`

Default founder structure:

- founder holds the vast majority of ordinary shares
- a second subscriber holds the minimum practical shareholding needed for private-limited formation

If there is only one real founder today:

- use a trusted second subscriber/director only if documented cleanly
- put transfer rights, beneficial ownership understanding, and future re-allocation in writing

Do **not** casually use a second name without documentation.

### 5.2 SECP official baseline

SECP’s company formation pages confirm:

- any two or more persons may form a private company
- a single-member company is possible when only one member forms a private company
- name reservation and incorporation are digitized
- company name reservation and incorporation can be filed through SECP eZfile / LEAP flows

### 5.3 Name reservation strategy

Reserve the company name first.

Recommended priority order:

1. `SANO (Private) Limited`
2. `SANO Technologies (Private) Limited`
3. `SANO Commerce Technologies (Private) Limited`

Reason:

- `SANO` is clean, short, and umbrella-friendly
- it lets `SanoPOS` and `SanoPay` operate as product brands
- it avoids prematurely locking the legal company name to one product line

### 5.4 Name-risk caution

The legal company name should avoid words that trigger unnecessary regulatory sensitivity or confusion.

At incorporation stage, avoid putting words like these in the legal company name unless justified and accepted:

- bank
- banking
- finance
- financial
- investment
- exchange
- insurance
- trust
- fund
- holding

That does **not** mean the product brand can never use “Pay”.

It means:

- `SANO (Private) Limited` is safer as legal entity
- `SanoPay` should remain a product brand
- public marketing copy must explain what SanoPay is accurately

### 5.5 Memorandum/object-clause direction

The object clause should be broad enough for:

- software development
- cloud software / SaaS
- point-of-sale systems
- business management software
- ecommerce software
- payment orchestration software
- merchant services enablement
- data processing
- digital integrations
- analytics
- communication and notification software
- APIs and platform services

It should **not** casually claim regulated activities like:

- deposit-taking
- banking
- insurance
- direct lending
- wallet issuance
- payment system operation

unless specifically reviewed by counsel in a way that does not misstate the business.

### 5.6 Practical incorporation checklist

Before filing:

- finalize legal name options
- finalize shareholding table
- finalize at least two directors/subscribers for private limited
- prepare CNIC/passport details
- finalize registered office address
- prepare business objects for the memorandum
- decide authorized share capital
- prepare initial board/resolution drafts if needed

Immediately after incorporation:

- obtain company incorporation certificate
- obtain NTN / e-enrollment credentials
- create company bank account
- configure accounting and tax record-keeping
- prepare founder service/IP assignment documentation
- register primary domains if not already owned by the company
- shift key contracts and platform accounts under company control

---

## 6. FBR, Tax, Banking, And Corporate Hygiene

### 6.1 Income tax registration

FBR confirms the company receives its NTN through e-enrollment and that these credentials provide access to IRIS, which is the online income-tax portal.

This means post-incorporation the company should immediately:

- confirm NTN issuance
- ensure IRIS access is working
- align bank account and tax profile to the same legal name

### 6.2 Sales tax and provincial considerations

This document does not assume one specific sales-tax registration path because:

- software businesses can have different sales-tax footprints depending on product model and province
- digital services can trigger provincial tax considerations

So the correct action is:

- engage a Pakistan tax advisor immediately after incorporation
- map whether SANO will charge:
  - SaaS subscription fees
  - setup/integration fees
  - platform fees
  - referral commissions
  - payment software fees
- then determine relevant sales-tax registrations and invoicing obligations

### 6.3 Bank account strategy

The company should open:

- one primary operating bank account in the company’s legal name

Optional later:

- a second account for payroll/tax segregation

Do not mix:

- founder personal account
- company receipts
- payment partner settlements
- merchant funds

from day one.

### 6.4 Trademark and brand hygiene

After name reservation and company formation:

- run trademark clearance for:
  - `SANO`
  - `SanoPOS`
  - `SanoPay`
- register key domains if not already secured
- unify brand ownership under the company

This matters because the legal entity is separate from product names.

---

## 7. Regulatory Boundary Map

This is the most important section in the document.

If this boundary is understood properly, the founder can move fast without stepping into the wrong regulatory posture.

### 7.1 What SANO can do immediately as a software company

SANO can build and sell:

- POS software
- ecommerce checkout UI
- payment links
- QR generation surfaces
- hosted checkout UX
- subscriptions logic
- tokenization requests routed through partners
- webhook normalization
- merchant admin dashboards
- reconciliation and settlement reporting
- refund workflow software
- fraud/risk scoring software
- merchant onboarding/KYC collection workflow
- business analytics
- invoice and bill presentment

These are software and orchestration functions.

### 7.2 What SANO can do only through partners

SANO can offer the following **through partners**:

- card acceptance
- wallet acceptance
- QR-based payment acceptance
- acquiring / merchant account onboarding
- BNPL checkout option
- pay-by-link backed by licensed rails
- installment options
- merchant settlement
- dispute and chargeback flows
- recurring billing backed by partner card rails

The partner performs the regulated or rail-owning function.

SANO performs:

- merchant acquisition
- software layer
- routing layer
- reporting layer
- reconciliation layer
- user experience layer

### 7.3 What SANO should not do without a separate license or formal legal review

Without a separate future license or specific legal approval, SANO should not:

- accept customer funds into SANO-controlled wallets
- market itself as a bank or digital bank
- market itself as an EMI/PSP/PSO if not licensed
- hold pooled merchant funds
- issue e-money
- underwrite loans from its own balance sheet
- market guaranteed financial products without underlying licensed partner support

### 7.4 SBP payment-licensing reality

SBP’s public material indicates:

- PSO/PSP authorization is staged
- PSO/PSPs are companies registered in Pakistan
- PSO/PSPs are required to maintain capital of `PKR 200 million`
- EMIs are separately regulated and the EMI regulations specify startup capital of `PKR 200 million`

These are not sensible launch prerequisites for SanoPay v1.

### 7.5 SECP lending reality

SECP’s current public NBFC material shows digital lending is becoming more accessible than before, but it is still a regulated business.

The 2026-updated NBFC regulations indicate:

- non-deposit-taking NBFCs for Investment Finance Services require `Rs. 100 million`
- digital lending under that track shows `Rs. 40 million`

SECP’s November 14, 2025 amendments also relaxed parts of the framework to encourage technology-driven lending models.

This means:

- `payments first, lending later` is still the correct order
- if SANO ever wants own-book lending, that should be a later, dedicated workstream

### 7.6 Best immediate regulatory stance

Best immediate stance:

- software company
- no fund custody
- no wallet issuance
- no lending book
- partner-led regulated rails
- legal copy that describes SanoPay accurately as payment software and partner-powered checkout/acceptance infrastructure

---

## 8. Recommended Company And Brand Structure

### 8.1 Recommended structure at launch

Use:

- `SANO (Private) Limited`

Under it:

- `SanoPOS` product line
- `SanoPay` product line

### 8.2 Why one company first is better than multiple entities first

One company first is better because:

- simpler tax and accounting setup
- simpler banking and compliance
- simpler product ownership
- easier partner contracting at the start
- lower legal/admin cost
- less internal transfer-pricing complexity

Do **not** create separate entities for SanoPOS and SanoPay at launch.

Use one OpCo, multiple brands.

### 8.3 When to split later

Only consider splitting later if one of these becomes true:

- a regulated lending subsidiary is needed
- an EMI/PSP/PSO application becomes realistic
- investors want financial-services risk ring-fenced
- the payments business becomes materially different from the software business

At that point a possible structure becomes:

- parent: `SANO Holdings` or foreign holdco later
- Pakistan OpCo: `SANO (Private) Limited` for software
- regulated subsidiary later: payments or NBFC vehicle

That is **not** needed now.

---

## 9. Recommended SanoPay Product Definition

### 9.1 What SanoPay should be in v1

SanoPay v1 should be defined as:

> A merchant payments orchestration and acceptance layer for Pakistan, built on top of licensed bank and wallet rails, integrated into SanoPOS and also usable by external merchants.

### 9.2 What SanoPay should not claim to be in v1

Do not define it as:

- a payment bank
- a wallet issuer
- a licensed payment institution
- a settlement bank
- a direct lender

### 9.3 Exact product surface for v1

SanoPay v1 should include:

- hosted checkout session creation
- payment links
- QR payment generation
- partner-rail selection at checkout
- merchant KYC onboarding intake
- transaction ledger
- settlement ledger
- reversal/refund workflows
- webhook event normalization
- dashboard reporting
- payment status callbacks to SanoPOS

### 9.4 Exact product surface for v2

Once one or two rails are live:

- multi-rail routing
- failover logic
- subscriptions / recurring billing where partner supports it
- saved payment-method references where partner allows it
- invoice payments
- merchant analytics on acceptance performance
- partner payout reconciliation

### 9.5 Exact product surface for v3

After the base is stable:

- Shopify/WooCommerce plugins
- standalone public merchant onboarding
- omnichannel payment reporting
- installment/BNPL options through partners
- merchant financing referral/pre-qualification flows

---

## 10. SanoPay Public Interface Direction

To keep implementation consistent later, these interface names should be used as the platform vocabulary.

### 10.1 Merchant onboarding

- `CreateMerchantProfile`
- `CreateMerchantKYCProfile`
- `SubmitMerchantForPartnerReview`
- `GetMerchantOnboardingStatus`

### 10.2 Checkout and payment creation

- `CreatePaymentIntent`
- `CreateHostedCheckoutSession`
- `CreatePaymentLink`
- `CreateMerchantQR`
- `GetPaymentStatus`

### 10.3 Operations and reconciliation

- `RefundPayment`
- `CapturePartnerWebhook`
- `SyncSettlementReport`
- `ReconcilePartnerPayout`
- `GetMerchantTransactions`
- `GetMerchantSettlements`

### 10.4 Adapter boundary

Each partner should sit behind a common adapter contract:

- `PartnerAdapter`

Minimum responsibilities:

- auth/signing
- payment creation
- redirect/hosted-checkout handling
- QR creation if supported
- webhook verification
- status normalization
- refund execution if supported
- settlement import/report parsing

This fits the repo’s current adapter direction.

---

## 11. Reverse-Engineered Market Model: What XPay Appears To Have Done

Public evidence suggests XPay’s path was likely:

- software/orchestration first
- partner rails underneath
- finance vehicle separately

That is the model SANO should replicate.

### 11.1 Likely model behind XPay

The public evidence suggests XPay is likely:

- orchestration software
- merchant-acquisition and checkout layer
- bank/wallet/gateway integration layer
- not the visible owner of the full regulated payments stack

The public evidence also suggests the financing side sits separately under broader PostEx financial structure rather than under one all-in-one unlicensed software company.

### 11.2 Why this matters for SANO

This means SANO does not need to “solve licensing” on day one.

It needs to solve:

- merchant distribution
- better checkout UX
- partner integration
- unified reporting
- local-market operational value

That is much more achievable.

---

## 12. Ideal Partner Shortlist

Recommended partner order:

1. `Bank Alfalah`
2. `JazzCash`
3. `easypaisa`

This order is based on:

- public openness to merchant onboarding and partnerships
- fit for SanoPay’s v1 product
- availability of clear merchant-facing online-payment programs
- strategic usefulness for cards, wallets, QR, and merchant enablement

---

## 13. Partner 1: Bank Alfalah

### 13.1 Why Bank Alfalah should be first

Bank Alfalah is the strongest first partner because its public ecommerce material already shows the exact type of motion SanoPay needs:

- digital merchant signup
- instant merchant account path
- corporate merchant account path
- API and redirection integrations
- plugin support
- pay-by-link
- refunds and chargebacks through merchant portal
- merchant financing and BNPL adjacency

More importantly, Bank Alfalah has public evidence of fintech partnership behavior:

- bSecure
- Paymob
- SnappRetail QR merchant-acquiring collaboration

That means SanoPay is not pitching a completely foreign partnership model.

### 13.2 What Bank Alfalah publicly signals

Their public ecommerce page states benefits including:

- instant merchant account
- integration plugins
- multiple payment modes
- dashboard and reporting
- online refunds and chargebacks through merchant portal
- pay by link
- merchant financing and other banking services
- BNPL and BIN-based discounting

Their public merchant-signup language also states:

- any business in Pakistan can sign up digitally
- they serve SMEs, individuals, sole proprietors, and registered entities

This is exactly the kind of partner posture SanoPay should exploit.

### 13.3 What to ask Bank Alfalah for

In the first serious meeting, ask for:

- ecommerce/acquiring partnership owner
- sandbox access
- API documentation
- plugin/hosted-checkout capabilities
- pay-by-link capability
- QR and in-store acceptance roadmap
- tokenization and recurring-billing support
- webhook/security model
- merchant onboarding requirements
- merchant underwriting rules
- settlement timelines and fee matrix
- chargeback/refund operations
- whether SANO can bring merchants under:
  - referral model
  - aggregator model
  - delegated onboarding model
  - co-branded flow

### 13.4 Best commercial pitch to Bank Alfalah

Pitch SANO as:

- a merchant-acquisition channel
- a commerce software platform with existing POS and omnichannel capabilities
- a conversion and operations layer that makes Alfa rails easier to adopt

Do not pitch as:

- “we want to replace the bank”
- “we need your license”

Best framing:

> SanoPOS already runs merchant operations. SanoPay will help merchants accept digital payments faster across POS, links, and checkout flows. Bank Alfalah remains the regulated acquiring rail; SANO becomes the merchant software and distribution layer.

### 13.5 Likely first integration with Bank Alfalah

Recommended first Bank Alfalah scope:

- hosted or redirected checkout for online payment acceptance
- payment links for merchants without a website
- settlement status sync
- refunds dashboard synchronization

Then:

- subscriptions
- tokenized repeat payments if supported
- QR acceptance where commercially useful

### 13.6 Strategic upside of Bank Alfalah

Long-term, Bank Alfalah also gives possible adjacency into:

- merchant financing
- card rails
- BIN promotions
- installments/BNPL partnerships
- stronger enterprise merchant credibility

---

## 14. Partner 2: JazzCash

### 14.1 Why JazzCash should be second

JazzCash gives SanoPay broad local-market acceptance relevance because it publicly supports:

- online payments
- mobile account payments
- card payments
- voucher/retailer flows
- QR/business accounts
- corporate online payment gateway
- BNPL

For Pakistan, wallet and mobile-payment acceptance is not optional.

JazzCash is one of the clearest ways to cover that.

### 14.2 What JazzCash publicly signals

JazzCash public materials show:

- online payments for ecommerce
- multiple customer payment channels
- corporate collection/online gateway structure
- business accounts and QR offerings
- BNPL presence

This makes JazzCash a strong rail for:

- wallet acceptance
- online checkout
- QR
- later partner-BNPL distribution

### 14.3 What to ask JazzCash for

Ask for:

- online payment gateway integration docs
- business/merchant onboarding flow
- QR acceptance path
- whether platform/sub-merchant onboarding is supported
- payment-link capabilities
- wallet checkout APIs
- settlement reports
- refunds and reversals
- merchant KYC requirements
- fee structure and payout windows
- partner/commercial program for software platforms
- BNPL distribution rules for merchant checkout

### 14.4 Best commercial pitch to JazzCash

Pitch SANO as:

- merchant acquisition and retention software
- POS + omnichannel software already embedded in merchant workflows
- a growth channel that can place JazzCash acceptance inside stores and online checkout surfaces

Best framing:

> SanoPay can become the merchant-facing software layer that increases digital acceptance volume on top of JazzCash’s payment rails.

### 14.5 Recommended JazzCash role in SanoPay v1

JazzCash should be used for:

- wallet acceptance
- online payment option at checkout
- QR acceptance
- possible SME-friendly early merchant enablement

Later:

- BNPL option distribution

---

## 15. Partner 3: easypaisa

### 15.1 Why easypaisa should be third

easypaisa is strategically important because its public merchant/gateway materials are unusually explicit.

The public online payment gateway page shows:

- merchant registration portal
- KYC verification and due diligence
- merchant integration support
- merchant portal
- settlement and reversal reporting
- real-time settlement claims for specific modes
- no annual/installation charges
- plugin support for major ecommerce systems

That makes easypaisa a strong fit for SanoPay’s external-merchant ambition.

### 15.2 What easypaisa publicly signals

Their public gateway page states:

- businesses can sign up through the merchant registration portal
- KYC verification and due diligence are part of the process
- merchant portal exists for transaction history, settlement reports, and reversal reports
- integration help is provided
- plugins exist for major ecommerce systems
- registration can be completed online

This is very useful because it validates the shape of the process SanoPay itself should mimic.

### 15.3 What to ask easypaisa for

Ask for:

- gateway docs and sandbox
- merchant portal/API access
- merchant onboarding requirements
- whether software-platform referrals or platform partnerships exist
- QR-based merchant acceptance path
- wallet acceptance at checkout
- settlement file/report formats
- refund/reversal handling
- support SLAs
- co-marketing or partner-commercial options

### 15.4 Best commercial pitch to easypaisa

Best framing:

> SanoPay brings merchants and software adoption. easypaisa remains the wallet/gateway/payment rail. We want to embed easypaisa acceptance inside a broader commerce platform used by retailers and ecommerce merchants.

### 15.5 Recommended easypaisa role in SanoPay v1

Use easypaisa for:

- wallet acceptance
- merchant registration path learning
- external merchant onboarding design reference
- QR and mobile-led acceptance

It may also serve as a very strong public proof-point for external merchant support because its current documentation is merchant-oriented and practical.

---

## 16. Commercial Model For SanoPay

### 16.1 Recommended launch commercial model

SANO should charge for:

- software subscription
- integration/setup fees for external merchants
- premium reporting/reconciliation features
- optional payment-link/checkout tools

Where available, SANO should negotiate:

- referral fees
- revenue share
- merchant-acquisition incentives
- co-branded onboarding economics

### 16.2 What not to rely on at launch

Do not build the business model assuming:

- high MDR spreads from day one
- direct share of card acquiring economics
- exclusive partner terms
- large float or settlement income

The v1 economics should work primarily as a software and enablement business.

### 16.3 Best merchant segments for first revenue

Initial merchant segments:

- existing SanoPOS merchants
- Instagram/Facebook sellers needing pay-by-link
- ecommerce merchants needing local checkout options
- SMEs needing QR/wallet acceptance and simple reporting

This is better than trying to start with large enterprise merchants.

---

## 17. Legal And Commercial Document Stack

SANO should prepare a clean document stack before live launch.

### 17.1 Must-have documents

- company incorporation documents
- founder/shareholder documentation
- privacy policy
- platform terms of service
- merchant master service agreement
- acceptable-use policy
- payment-specific terms explaining partner-rail role
- refund/dispute responsibility matrix
- data-processing language for merchant/customer data

### 17.2 Payment-language guardrails

Public and contract language should avoid implying that SANO itself is:

- the bank
- the issuer
- the custodian of customer funds
- the formal lender

Safer language:

- “powered by partner payment rails”
- “integrated with licensed banking and wallet partners”
- “payment acceptance and checkout software”
- “merchant payment orchestration”

### 17.3 Merchant-fund custody rule

Contracts and product design should reflect one rule clearly:

> SANO should not receive, pool, or hold customer funds in its own custody at launch.

That rule simplifies legal risk materially.

---

## 18. Product, Compliance, And Messaging Boundaries For SanoPay

### 18.1 Safe public description

Recommended early public description:

> SanoPay is SANO’s payment acceptance and checkout layer for merchants, built on top of partner banking and wallet rails in Pakistan.

### 18.2 Unsafe public descriptions

Avoid statements like:

- “SanoPay is a digital bank”
- “SanoPay is a wallet”
- “SanoPay stores your money”
- “SanoPay issues merchant accounts”
- “SanoPay provides loans”

unless those become legally and operationally true later.

### 18.3 Internal product language

Inside the company, use precise terms:

- `partner rail`
- `merchant onboarding`
- `direct settlement`
- `reconciliation`
- `payment intent`
- `hosted checkout`
- `BNPL partner`
- `merchant financing referral`

This keeps product and compliance aligned.

---

## 19. Recommended Step-By-Step Execution Plan

This is the practical roadmap.

### 19.1 Stage 0: Incorporate and clean the business foundation

Target: next 2-4 weeks

Actions:

- reserve the legal name with SECP
- incorporate `SANO (Private) Limited`
- obtain NTN and IRIS access
- open company bank account
- lock product/brand ownership under the company
- prepare privacy policy, basic terms, and founder documentation
- ensure domains and key infra accounts are under company control

Deliverable:

- clean legal shell for all future partner outreach

### 19.2 Stage 1: Prepare the SanoPay partner deck and operating model

Target: next 2-3 weeks after incorporation

Actions:

- prepare one short partner deck
- define SanoPay exactly as:
  - payment orchestration
  - merchant software layer
  - distribution channel for merchant acquisition
- prepare a one-page architecture diagram showing:
  - customer
  - SanoPOS/SanoPay
  - partner rail
  - direct merchant settlement
- prepare a merchant-volume narrative:
  - current merchants
  - target sectors
  - expected payment use cases
- prepare a compliance-safe product description

Deliverable:

- partner-ready commercial story

### 19.3 Stage 2: Start partner outreach

Target: next 30 days

Outreach order:

1. Bank Alfalah
2. JazzCash
3. easypaisa

Meeting objective:

- confirm if SANO can partner as a merchant-acquisition/software platform
- obtain sandbox and integration docs
- understand whether a sub-merchant or delegated-onboarding model exists
- understand KYC and settlement requirements

Deliverable:

- one serious partner path with documentation access

### 19.4 Stage 3: Build SanoPay v1 inside the existing architecture

Target: 30-90 days after first partner traction

Implementation focus:

- abstract current xPay-specific adapter into a partner-neutral adapter surface
- add partner config model
- build merchant KYC profile and onboarding status pages
- build payment-link creation
- build hosted checkout session creation
- normalize webhook events
- store settlement and transaction events in a unified ledger

Do not overbuild.

V1 goal is:

- real acceptance through at least one live partner rail

### 19.5 Stage 4: Pilot with selected merchants

Target: 90-180 days

Start with:

- selected SanoPOS merchants
- a few external merchants if partner allows

Measure:

- onboarding completion rate
- payment success rate
- settlement visibility
- refund handling
- support burden
- merchant willingness to pay

Deliverable:

- proof that SanoPay increases merchant value, not just technical capability

### 19.6 Stage 5: Expand rails and use cases

After first stable partner:

- add wallet rails
- add QR
- add invoice and payment-link use cases
- add recurring billing if supported
- add plugins for external merchant platforms

Then evaluate:

- partner BNPL
- merchant financing referral

### 19.7 Stage 6: Evaluate regulated expansion only after traction

Only after meaningful payment volume and merchant demand:

- evaluate dedicated NBFC path for financing
- evaluate whether EMI/PSP/PSO has any economic justification
- evaluate foreign holdco for fundraising

This is a later strategic decision, not a launch dependency.

---

## 20. Recommended Founder Meeting Scripts

### 20.1 Bank partner opening

Recommended opening:

> We run a commerce operating platform for merchants in Pakistan. We want to launch SanoPay as a payment acceptance and checkout layer on top of partner rails. We are not looking to become a bank on day one. We want to bring merchant volume, better checkout UX, unified reporting, and stronger adoption of digital payments on top of your acquiring infrastructure.

### 20.2 Wallet partner opening

Recommended opening:

> We want to embed your wallet and checkout options into a broader merchant operating system used by retailers and online sellers. We can drive merchant acquisition, simplify integration, and surface your payment rails in both POS-adjacent and ecommerce workflows.

### 20.3 If they ask whether SANO is licensed

Recommended answer:

> We are a software and merchant-enablement company. We are structuring SanoPay as an orchestration layer that works with licensed payment partners and settles directly to merchants through those partners.

This is accurate and safe.

---

## 21. What SANO Can Build Immediately In The Repo

These are software workstreams that do not require waiting for a full license.

### 21.1 Merchant onboarding core

- merchant legal profile
- KYC document upload
- onboarding checklist
- partner selection
- onboarding status dashboard

### 21.2 Payment operations core

- partner adapter refactor
- unified transaction schema
- hosted checkout abstraction
- payment links
- QR request flow
- webhook signature verification per partner
- settlement report ingestion

### 21.3 Merchant reporting core

- transaction ledger
- settlement timeline view
- refund history
- failed-payment reasons
- rail-level performance metrics

### 21.4 Commercial core

- enable SanoPay in tenant admin
- plan/package controls
- fee-plan display
- partner-specific availability toggles

These are pure product tasks and align with the current architecture.

---

## 22. What To Delay Intentionally

To keep execution clean, defer the following until later:

- own wallet issuance
- own lending book
- direct claims of financial-product ownership
- EMI/PSP/PSO application work
- complex multi-country company structures
- excessive public marketing of SanoPay before first partner activation

The founder should optimize for:

- execution credibility
- partner traction
- merchant utility

not vanity breadth.

---

## 23. Risk Register

### 23.1 Name reservation risk

Risk:

- `SANO (Private) Limited` may not be available or may attract objections

Mitigation:

- file three strong alternatives immediately
- keep `SanoPOS` and `SanoPay` as product brands independent of legal-name perfection

### 23.2 Brand/regulatory confusion risk

Risk:

- `SanoPay` sounds like a regulated payments business even when it is only orchestration

Mitigation:

- keep public messaging precise
- soft-launch the brand first
- avoid bank/wallet/lender language

### 23.3 Partner rejection risk

Risk:

- a bank or wallet may only support direct merchant contracting and not platform aggregation

Mitigation:

- accept direct merchant contracting first if necessary
- let SanoPay remain the software/control plane even if each merchant has direct partner paperwork

### 23.4 Tax and compliance drift risk

Risk:

- software-fee and payments-related economics can create invoicing/tax complexity

Mitigation:

- involve tax advisor early
- separate software revenue from any partner settlements clearly

### 23.5 Product overreach risk

Risk:

- trying to build a full Stripe/Square clone before first partner traction

Mitigation:

- focus on one rail
- one merchant onboarding flow
- one reporting model
- one launch segment

---

## 24. Recommended Final Position

The recommended founder stance is:

- incorporate in Pakistan as `SANO (Private) Limited`
- keep `SanoPOS` and `SanoPay` as product brands under one legal company
- treat `SanoPay` as payment orchestration software first
- partner with Bank Alfalah, JazzCash, and easypaisa rather than trying to own regulated rails immediately
- use the repo’s existing gateway-adapter architecture as the technical base
- delay direct licensing ambitions until there is enough merchant volume to justify them

This is the most realistic path to turning SanoPOS into a serious commerce company while opening the door to financial products later.

---

## 25. Practical Founder Checklist

### Immediate

- reserve `SANO (Private) Limited` and two fallback names
- incorporate the company
- obtain NTN / IRIS access
- open company bank account
- move domains and critical accounts under company control

### Next

- prepare SanoPay partner deck
- prepare one-page architecture and commercial explainer
- schedule Bank Alfalah outreach first
- schedule JazzCash and easypaisa outreach next

### Product

- refactor payment adapter naming toward partner-neutral architecture
- design merchant onboarding/KYC flow
- design payment-link and transaction-ledger MVP

### Compliance and messaging

- draft merchant terms
- draft privacy policy
- define approved public wording for SanoPay

---

## 26. Source Appendix

### Company formation and tax

- SECP Registration of Company: <https://www.secp.gov.pk/company-formation/registration-of-company/>
- SECP Stepwise Procedure for Online Company Incorporation: <https://www.secp.gov.pk/company-formation/stepwise-procedure-for-online-company-incorporation/>
- SECP Name Availability FAQs: <https://www.secp.gov.pk/company-formation/name-availability-faqs/>
- SECP Prohibited / sensitive words list: <https://www.secp.gov.pk/wp-content/uploads/2016/03/List-of-Prohibited-Words.pdf>
- FBR Register for Income Tax: <https://fbr.gov.pk/categ/register-income-tax/51147/30846/71148>

### SBP and SECP regulatory paths

- SBP PSO/PSP overview: <https://www.sbp.org.pk/ps/PSOSP.htm>
- SBP EMI overview: <https://www.sbp.org.pk/ps/EMI.htm>
- SBP EMI regulations PDF: <https://www.sbp.org.pk/psd/2023/C3-Enclosure-Regulations-EMIs.pdf>
- SBP Regulatory Sandbox Guidelines: <https://www.sbp.org.pk/dfs/pdf/RegulatorySandboxGuidlines.pdf>
- SECP NBFC Regulations updated as of January 15, 2026: <https://www.secp.gov.pk/document/nbfc-regulations-2008-updated-as-of-january-15th-2026/>
- SECP amendments in lending framework, November 14, 2025: <https://www.secp.gov.pk/media-center/press-releases/press-release-14-november-2025-secp-notifies-comprehensive-amendments-in-lending-framework-under-nbfc-regulations-2008/>
- SECP digital lending / licensing signals: <https://www.secp.gov.pk/media-center/press-releases/secp-issues-digital-lending-license-in-push-for-fdi-and-investment-friendly-pakistan/>

### Payment partner paths

- Bank Alfalah ecommerce / Alfa Payment Gateway: <https://www.bankalfalah.com/digital-banking/ecommerce/>
- Bank Alfalah + bSecure: <https://www.bankalfalah.com/press-releases/bank-alfalah-and-bsecure-collaborate-to-provide-digital-payments-infrastructure-to-online-businesses-in-pakistan/>
- Bank Alfalah + Paymob: <https://www.bankalfalah.com/news-room/pr-49/>
- Bank Alfalah + SnappRetail QR merchant-acquiring partnership: <https://www.bankalfalah.com/news-room/pr-60/>
- JazzCash online payments: <https://www.jazzcash.com.pk/digital-payments/online-payments/>
- JazzCash online payment gateway: <https://www.jazzcash.com.pk/corporate/online-payment-gateway/>
- JazzCash business contact: <https://www.jazzcash.com.pk/contact-us-business/>
- JazzCash for Business / business app: <https://www.jazzcash.com.pk/business-karo-baithay-baithay/>
- JazzCash BNPL: <https://www.jazzcash.com.pk/digital-payments/buy-now-pay-later/>
- easypaisa online payment gateway: <https://easypaisa.com.pk/online-payment-gateway/>
- easypaisa online payments solution: <https://easypaisa.com.pk/online-payments-solution/>
- easypaisa business solutions contact: <https://easypaisa.com.pk/contact-us-for-business-solutions/>
- easypaisa merchant QR onboarding: <https://easypaisa.com.pk/become-easypaisa-merchant/>

### Repo-specific context

- `CLAUDE.md`
- `backend/CLAUDE.md`
- `competitive-analysis-2.md`
- `feature-development-references.md`

---

## 27. Final Note

This document is intentionally optimistic about what SANO can become, but conservative about what it should claim right now.

That is the right balance.

The way through the moat is not to start by becoming Square.

The way through the moat is:

- become the best merchant software layer
- sit on top of regulated rails
- earn trust through execution
- then expand into deeper financial services only when the business is strong enough to justify it

