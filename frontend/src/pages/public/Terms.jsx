// Terms of Service v1.0
// Source of truth: docs/legal/terms-of-service.md
// When you change the text, bump the version constant below AND update the
// markdown source — the signup flow sends this version to the backend so
// every tenant row carries a verifiable proof-of-consent record.
export const TERMS_VERSION = "1.0";

export default function Terms() {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-3xl rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">Terms of Service</h1>
        <p className="mt-1 text-xs text-slate-500">
          Version {TERMS_VERSION} &middot; Effective Date: [Effective Date] &middot; Last Updated: [Last Updated Date]
        </p>

        <div className="prose prose-sm prose-slate mt-6 max-w-none leading-relaxed text-slate-700">
          <p>
            These Terms of Service ("Terms") form a binding agreement between
            <strong> [Legal Entity Name]</strong>, a company organized under the laws of the
            Islamic Republic of Pakistan with its registered office at
            <strong> [Registered Address]</strong> ("SanoPOS", "we", "us", or "our"), and the
            person or entity accessing or using our software-as-a-service platform (the
            "Service").
          </p>
          <p>
            By creating an account, signing up for a free trial, or otherwise accessing or
            using the Service, you agree to be bound by these Terms. If you are entering
            into these Terms on behalf of a company or other legal entity, you represent
            that you have the authority to bind that entity. If you do not agree to these
            Terms, you must not access or use the Service.
          </p>

          <h2>1. The Service</h2>
          <h3>1.1 What SanoPOS Provides</h3>
          <p>
            SanoPOS is a cloud-hosted, multi-tenant point-of-sale and business-management
            platform. Features may include POS transaction processing, inventory and stock
            management, customer relationship management, employee management, purchase
            orders, sales reporting and analytics, integrations with third-party services
            (e-commerce platforms, couriers, payment gateways, tax authorities, messaging
            providers), tax computation and electronic invoicing (where supported), and
            optional artificial-intelligence (AI) features. Exact features depend on your
            plan and configuration.
          </p>
          <h3>1.2 SanoPOS Is a Tool, Not an Advisor</h3>
          <p>
            SanoPOS does not provide legal, tax, accounting, financial, regulatory, or
            professional advice. You are solely responsible for ensuring that your use of
            the Service complies with all laws applicable to your business in every
            jurisdiction in which you operate. Consult qualified professionals before
            relying on outputs from the Service for any regulated purpose.
          </p>

          <h2>2. Accounts and Eligibility</h2>
          <h3>2.1 Eligibility</h3>
          <p>You must be at least 18 years of age, or the age of legal majority in your jurisdiction (whichever is higher); have legal capacity to enter into a binding contract; provide accurate information at signup; and not be barred from receiving the Service under any applicable law.</p>
          <h3>2.2 Account Security</h3>
          <p>You are responsible for keeping your credentials confidential, for all activity under your account, for notifying us at <strong>support@sanopos.com</strong> of any unauthorized access, and for ensuring your employees comply with these Terms. Use the role-based permission system to restrict access appropriately.</p>
          <h3>2.3 One Account Per Business</h3>
          <p>Each tenant account is provisioned for a single business entity. Operating multiple unrelated businesses under one tenant account requires our written consent.</p>

          <h2>3. Subscription, Trial, and Billing</h2>
          <h3>3.1 Free Trial</h3>
          <p>We may offer a free trial of paid features (currently 45 days for the Pro plan), with no payment information required at signup. At trial end, accounts that have not subscribed transition to a grace period (currently 7 days), then to read-only mode. We may modify or discontinue free trials at any time.</p>
          <h3>3.2 Paid Plans</h3>
          <p>If you subscribe to a paid plan, you agree to pay the fees published on our pricing page or otherwise communicated in writing, in the currency and on the billing cycle specified.</p>
          <h3>3.3 Payment</h3>
          <p>Payments are processed through third-party providers. SanoPOS does not store full payment-card numbers — card data is handled by the payment provider in accordance with PCI-DSS.</p>
          <h3>3.4 Failed Payments and Grace Period</h3>
          <p>If a payment fails, your account enters a grace period with reminder notices. If payment is not received by the end of the grace period, the account is placed in read-only mode; you retain read access to historical data for a limited period.</p>
          <h3>3.5 No Refunds</h3>
          <p><strong>All fees are non-refundable.</strong> We do not refund or credit partial periods, unused features, downgrades, or mid-cycle cancellations, except where required by applicable law. Suspension or termination for breach does not entitle you to a refund.</p>
          <h3>3.6 Price Changes</h3>
          <p>We may change fees on at least 30 days' notice by email or in-app notification. Price changes take effect at the start of your next billing cycle.</p>
          <h3>3.7 Taxes</h3>
          <p>All fees are exclusive of sales tax, VAT, GST, withholding tax, and similar taxes. You are responsible for paying such taxes; where we are required to collect them they will be added to your invoice.</p>

          <h2>4. Acceptable Use</h2>
          <p>You agree not to use the Service to conduct illegal business; process transactions for unrelated third parties; resell, sublicense, or lease the Service without our consent; reverse-engineer or attempt to derive source code; circumvent security, rate-limiting, or plan-limit mechanisms; use bots or scrapers outside our documented APIs; upload unlawful, infringing, defamatory, obscene, harassing, or malicious content; send unsolicited commercial communications; impersonate any person or entity; or disrupt the Service's integrity or performance. We may investigate and take action — including suspension or termination — against violators.</p>

          <h2>5. Your Content and Data</h2>
          <h3>5.1 Ownership of Your Data</h3>
          <p>You retain all rights to data you upload, store, or generate through the Service, including customer records, product catalog, sales, employee records, and uploaded files ("Customer Data"). We do not claim ownership.</p>
          <h3>5.2 Licence to Process</h3>
          <p>You grant us a worldwide, non-exclusive, royalty-free licence to host, copy, transmit, display, and process Customer Data solely to provide and maintain the Service, address technical or security issues, comply with legal obligations, and improve the Service in aggregated, de-identified form.</p>
          <h3>5.3 Your Responsibilities for Customer Data</h3>
          <p>You represent that you have all necessary rights and legal bases to upload Customer Data — including personal data of your customers and employees — and that your collection and processing complies with all applicable data-protection laws in every relevant jurisdiction. You will respond directly to data-subject requests from your customers and employees, using the Service's export and deletion tools where appropriate.</p>
          <h3>5.4 Processor Role</h3>
          <p>For personal data of your customers and employees, we act as processor and you act as controller. A separate Data Processing Agreement (DPA) is available on request.</p>
          <h3>5.5 Data Export and Deletion</h3>
          <p>You may export Customer Data at any time. Upon termination, you have 30 days to export before permanent deletion from active systems. Backups may persist up to 7 additional days in ordinary rotation.</p>

          <h2>6. Third-Party Integrations</h2>
          <p>Optional integrations (e.g., Shopify, WooCommerce, Daraz, Meta Commerce, WhatsApp Business, couriers, payment gateways, tax authorities) are governed by separate terms with those third parties. You are responsible for reviewing and complying with those terms, maintaining your credentials, paying applicable third-party fees, and resolving disputes with them directly. SanoPOS is not liable for the availability, accuracy, security, or actions of any third-party service.</p>

          <h2>7. Tax and E-Invoicing Features</h2>
          <p><strong>You are solely responsible for verifying that the Service supports the statutory tax and invoicing requirements of every jurisdiction in which you operate.</strong> We currently provide direct integration with the Federal Board of Revenue (FBR) of Pakistan for digital invoicing. For other jurisdictions, tax fields are informational only and are not transmitted to any tax authority unless and until we publish official support. You are responsible for the accuracy of all tax configuration (rates, HS codes, NTN/registration numbers, classifications), keeping it current, reviewing all invoices, and filing periodic returns. SanoPOS is not liable for any tax penalties, interest, or fines.</p>

          <h2>8. Payment Processing</h2>
          <p>Integrated payment processing is provided by third-party payment providers and is available only in jurisdictions where those providers operate. International customers may use the Service without integrated payment processing. SanoPOS is not a financial institution, does not hold customer funds, and is not liable for the actions, fees, or availability of any payment provider.</p>

          <h2>9. Intellectual Property</h2>
          <p>The Service — including all software, designs, logos, trademarks, and documentation (other than Customer Data) — is owned by SanoPOS or its licensors. Subject to compliance with these Terms, we grant you a limited, non-exclusive, non-transferable, revocable licence to access and use the Service for your internal business operations during the subscription term. If you provide feedback, you grant us a perpetual, irrevocable, royalty-free licence to use it for any purpose without obligation to you. "SanoPOS" and our logos may not be used without our prior written consent except to factually identify the Service.</p>

          <h2>10. Service Availability and Support</h2>
          <p>We will use commercially reasonable efforts to keep the Service available, but the Service is provided "as is" and "as available". We do not guarantee uninterrupted or error-free operation. Email support is best-effort during business hours (Mon–Fri, 9:00 AM–6:00 PM PKT, excluding Pakistani public holidays). We aim to respond to support tickets within 48 hours, although this is a goal, not a contractual SLA. Support is provided through <strong>support@sanopos.com</strong> and the in-app support widget.</p>

          <h2>11. Modifications to the Service</h2>
          <p>We may modify, suspend, or discontinue features at any time, with or without notice. We will use reasonable efforts to notify you of material adverse changes. Continued use after a modification constitutes acceptance.</p>

          <h2>12. Suspension and Termination</h2>
          <p>You may terminate at any time via billing settings or by emailing <strong>support@sanopos.com</strong>. Termination takes effect at the end of your current billing period; no pro-rated refund applies. We may suspend or terminate for breach (with 15 days to cure where curable), non-payment, prohibited use, legal compulsion, security/operational risk, or general discontinuation of the Service. On termination, your access ceases immediately; accrued fees remain payable; you have 30 days to export data; and surviving clauses (5, 9, 13, 14, 15, 16, 17, 18) continue in force.</p>

          <h2>13. Disclaimers</h2>
          <p><strong>To the maximum extent permitted by applicable law, the Service is provided "as is" and "as available", without warranties of any kind — express, implied, or statutory — including merchantability, fitness for a particular purpose, non-infringement, accuracy, or uninterrupted operation.</strong> We do not warrant that the Service will meet your specific requirements, be uninterrupted or error-free, produce accurate or suitable results for any regulatory purpose, correct all defects, or be free of viruses. Your reliance on the Service is at your own risk.</p>

          <h2>14. Limitation of Liability</h2>
          <p><strong>To the maximum extent permitted by applicable law: (a) in no event will SanoPOS, its directors, officers, employees, agents, or licensors be liable for any indirect, incidental, special, consequential, exemplary, or punitive damages — including lost profits, lost revenue, lost data, business interruption, regulatory penalties, or tax liabilities — arising out of or in connection with these Terms or your use of (or inability to use) the Service, even if we have been advised of the possibility of such damages. (b) Our aggregate liability, in contract, tort (including negligence), or otherwise, will not exceed the total fees you actually paid to us for the Service during the 12 months immediately preceding the event giving rise to the claim, or USD 100, whichever is greater.</strong> These limitations apply regardless of the form of action and even if any limited remedy fails of its essential purpose. Where applicable law disallows certain limitations, our liability is limited to the maximum extent permitted.</p>

          <h2>15. Indemnification</h2>
          <p>You agree to indemnify, defend, and hold harmless SanoPOS, its directors, officers, employees, agents, and licensors from claims, demands, losses, liabilities, damages, costs, and expenses (including reasonable legal fees) arising out of: your use of the Service; your Customer Data (including infringement or legal-violation claims); your breach of these Terms; your violation of any law, regulation, or third-party right; or any tax, regulatory, employment, or consumer-protection claim brought by your customers, employees, or any government authority in connection with your business.</p>

          <h2>16. Force Majeure</h2>
          <p>Neither party is liable for failure or delay in performance (other than payment) due to circumstances beyond reasonable control — acts of God, war, terrorism, civil unrest, government action, pandemic, internet outage, denial-of-service attack, power failure, or failure of third-party infrastructure providers.</p>

          <h2>17. Governing Law and Dispute Resolution</h2>
          <h3>17.1 Governing Law</h3>
          <p>These Terms and any related dispute are governed by the laws of the <strong>Islamic Republic of Pakistan</strong>, without regard to conflict-of-law principles.</p>
          <h3>17.2 Jurisdiction and Arbitration</h3>
          <p>Any dispute arising out of or in connection with these Terms shall be referred to and finally resolved by arbitration in <strong>Karachi, Pakistan</strong> under the <strong>Arbitration Act, 1940</strong> (or any successor legislation). The arbitration shall be in English by a sole arbitrator appointed by mutual agreement, or otherwise per the said Act. Subject to the arbitration clause, the courts of <strong>Karachi, Pakistan</strong> shall have exclusive jurisdiction for matters not subject to arbitration, including interim relief.</p>
          <h3>17.3 No Class Actions</h3>
          <p>You agree any dispute is resolved on an individual basis. You may not bring or participate in any class, collective, or representative action against SanoPOS.</p>

          <h2>18. General</h2>
          <p><strong>Entire Agreement:</strong> these Terms, our Privacy Policy, and any signed order form constitute the entire agreement. <strong>Amendments:</strong> material amendments will be communicated by email and/or in-app notice at least 30 days in advance (or shorter where legally necessary). Continued use after the effective date constitutes acceptance. <strong>Assignment:</strong> you may not assign without our consent; we may assign in connection with a merger, acquisition, or sale of substantially all assets. <strong>Severability:</strong> invalid provisions are modified to the minimum extent necessary to be enforceable; remainder continues in force. <strong>No waiver:</strong> failure to enforce any right is not a waiver. <strong>No agency:</strong> nothing here creates agency, partnership, joint venture, employment, or franchise. <strong>Notices:</strong> to you, by email to your account address, in-app, or by posting on our website; to us, by email to <strong>support@sanopos.com</strong>. <strong>Language:</strong> drafted in English; translations are for convenience only and the English version controls.</p>

          <h2>19. Contact</h2>
          <p>Questions about these Terms: <strong>[Legal Entity Name]</strong>, <strong>[Registered Address]</strong>, email <strong>support@sanopos.com</strong>.</p>

          <p className="mt-8 text-xs italic text-slate-500">
            By creating an account or using the Service, you acknowledge that you have
            read, understood, and agree to be bound by these Terms of Service.
          </p>
        </div>
      </div>
    </div>
  );
}
