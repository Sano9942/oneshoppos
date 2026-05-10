// Privacy Policy v1.0
// Source of truth: docs/legal/privacy-policy.md
// When you change the text, bump the version constant below AND update the
// markdown source — the signup flow sends this version to the backend so
// every tenant row carries a verifiable proof-of-consent record.
export const PRIVACY_VERSION = "1.0";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-3xl rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">Privacy Policy</h1>
        <p className="mt-1 text-xs text-slate-500">
          Version {PRIVACY_VERSION} &middot; Effective Date: [Effective Date] &middot; Last Updated: [Last Updated Date]
        </p>

        <div className="prose prose-sm prose-slate mt-6 max-w-none leading-relaxed text-slate-700">
          <p>
            This Privacy Policy explains how <strong>[Legal Entity Name]</strong>
            ("SanoPOS", "we", "us", or "our") collects, uses, shares, and protects
            information when you use the SanoPOS platform (the "Service"), visit our
            website, or otherwise interact with us.
          </p>
          <p>
            This policy applies to two distinct categories of personal data: (1)
            <strong> Account data</strong> about you (the business owner, administrator, or
            employee using the Service), for which <strong>we are the data controller</strong>;
            and (2) <strong>Customer data you upload</strong> about your end customers,
            employees, and other individuals, for which <strong>you are the data controller</strong>
            and <strong>we are the data processor</strong>.
          </p>
          <p>
            This policy is designed to align with the principles of the EU GDPR, UK GDPR,
            and similar modern data-protection regimes. Where local law gives you stronger
            rights, those rights apply.
          </p>

          <h2>1. Who We Are</h2>
          <p>
            <strong>[Legal Entity Name]</strong>, a company organized under the laws of
            Pakistan with its registered office at <strong>[Registered Address]</strong>,
            is the data controller for the account data described in this policy. For all
            privacy questions, contact us at <strong>support@sanopos.com</strong>.
          </p>

          <h2>2. Information We Collect</h2>
          <h3>2.1 Information You Provide Directly</h3>
          <p>
            <strong>Identity and contact:</strong> name, email, phone, business name,
            address, tax registration number (e.g., NTN in Pakistan), and similar.
            <strong> Authentication:</strong> passwords (bcrypt-hashed — never the
            plaintext), employee PINs (also hashed), and session tokens.
            <strong> Billing:</strong> subscription plan, billing history, and payment
            metadata — full card numbers are handled by our payment provider and are
            never stored by us.
            <strong> Support:</strong> messages, screenshots, and attachments you send to
            support.
            <strong> Configuration:</strong> outlet details, employee records, role
            assignments, integration credentials, tax settings, and similar setup data.
          </p>
          <h3>2.2 Information We Collect Automatically</h3>
          <p>
            <strong>Technical:</strong> IP address, browser type/version, device type, OS,
            time zone, and language.
            <strong> Usage:</strong> pages viewed, features used, action timestamps, and
            unique request identifiers.
            <strong> Error and performance:</strong> error reports, stack traces, and
            performance metrics captured by our error-monitoring tool (Sentry) — may
            incidentally include account data if present in error context.
            <strong> Cookies and similar storage:</strong> first-party cookies and
            localStorage strictly for authentication, session management, theme
            preferences, and similar essential functions. We do not use third-party
            advertising cookies, tracking pixels, or behavioural-advertising technologies.
          </p>
          <h3>2.3 Customer Data You Upload</h3>
          <p>In using the Service, you upload personal data about your own end customers and employees — names, phone numbers, email addresses, addresses, purchase history, loyalty data, attendance and payroll records, and any other personal data you record in customer notes, support tickets, or custom fields. You determine what to collect, why, and how long to retain it. We process this data on your behalf in accordance with these Terms and any signed DPA.</p>
          <h3>2.4 Information from Third Parties</h3>
          <p>If you enable a third-party integration (e.g., Shopify, WooCommerce, Daraz, a courier API), we receive data from that third party — orders, products, tracking events — as needed to provide the integration.</p>

          <h2>3. How We Use Information</h2>
          <p>We use information for the following purposes and legal bases: <strong>providing, operating, and maintaining the Service</strong> (performance of contract); <strong>authenticating users and securing accounts</strong> (contract; legitimate interest in security); <strong>processing payments and managing subscriptions</strong> (contract); <strong>responding to support requests</strong> (contract; legitimate interest); <strong>monitoring service health, detecting fraud, abuse, and security incidents</strong> (legitimate interest); <strong>sending transactional emails</strong> — receipts, password resets, billing notices, account alerts (contract; legal obligation where applicable); <strong>sending product updates and account announcements</strong> (legitimate interest; opt-out available); <strong>improving the Service through aggregated, de-identified analytics</strong> (legitimate interest); <strong>complying with legal obligations</strong> — tax records, lawful authority requests, e-invoicing where applicable (legal obligation); <strong>establishing, exercising, or defending legal claims</strong> (legitimate interest). We do <strong>not</strong> sell personal data and do <strong>not</strong> use it for behavioural advertising.</p>

          <h2>4. AI Features</h2>
          <p>Where you choose to use optional AI features (such as AI-powered insights or chat assistance), your queries and the relevant business data are sent to our AI provider (Anthropic) solely to generate the response. The provider does not use this data to train its general models. You may avoid this by not using AI features.</p>

          <h2>5. How We Share Information</h2>
          <h3>5.1 Sub-Processors</h3>
          <p>We engage trusted sub-processors to perform functions on our behalf, each contractually bound to process data only as instructed and to maintain appropriate security. Our current sub-processors:</p>
          <ul>
            <li><strong>Supabase</strong> — database hosting (United States / European Union)</li>
            <li><strong>Railway</strong> — application hosting (United States)</li>
            <li><strong>Vercel</strong> — frontend hosting and edge delivery (global edge network)</li>
            <li><strong>Cloudflare R2</strong> — file and image storage (global edge network)</li>
            <li><strong>Resend</strong> — transactional email delivery (United States)</li>
            <li><strong>Sentry</strong> — error monitoring (United States)</li>
            <li><strong>Anthropic</strong> — AI model inference, only when AI features are used (United States)</li>
            <li><strong>xPay</strong> — payment processing for Pakistan customers (Pakistan)</li>
            <li><strong>Federal Board of Revenue (FBR)</strong> — electronic tax invoicing for Pakistan customers using FBR (Pakistan)</li>
            <li><strong>Courier API providers</strong> (e.g., Leopards, TCS, BlueEx, and others) — shipment and tracking, only when you enable a courier integration (Pakistan / global)</li>
          </ul>
          <p>We will give at least 30 days' notice before engaging a new sub-processor that has access to Customer Data — by updating this Policy and/or by email to account administrators — except where shorter notice is needed for a security or operational issue.</p>
          <h3>5.2 At Your Direction</h3>
          <p>We share data with third parties you choose to integrate, in the manner you configure (e.g., a connected Shopify store exchanges product and order data with Shopify under your instructions).</p>
          <h3>5.3 Legal Requirements</h3>
          <p>We may disclose data when we believe in good faith that disclosure is necessary to comply with a legal obligation, court order, or valid authority request; enforce our Terms; protect the rights, property, or safety of SanoPOS, our users, or the public; or investigate fraud, security breaches, or illegal activity. Where legally permitted, we will notify you before disclosing.</p>
          <h3>5.4 Business Transfers</h3>
          <p>In a merger, acquisition, reorganization, asset sale, or insolvency, personal data may transfer to the successor entity. We will notify you.</p>
          <h3>5.5 With Your Consent</h3>
          <p>We may share data for any other purpose with your explicit consent.</p>

          <h2>6. International Data Transfers</h2>
          <p>The Service operates globally, and your data may be stored and processed in the <strong>United States, European Union, and other regions where our sub-processors operate</strong>. Where personal data is transferred outside your country of residence, we rely on appropriate safeguards permitted by applicable law, including the European Commission's Standard Contractual Clauses (SCCs), provider-specific certifications, and your consent where appropriate. By using the Service, you acknowledge that your data may be transferred to and processed in jurisdictions other than your own.</p>

          <h2>7. Data Retention</h2>
          <p>We retain data only as long as necessary for the purposes for which it was collected, including legal, tax, accounting, and reporting requirements. <strong>Active account data:</strong> for the duration of your subscription. <strong>Customer Data after account termination:</strong> 30 days, then deleted from active systems. <strong>Backups:</strong> up to 7 days after deletion from active systems. <strong>Billing and tax records:</strong> as required by applicable law (typically 5–7 years). <strong>Support communications:</strong> up to 3 years. <strong>Security and audit logs:</strong> up to 2 years, or longer to investigate or defend a legal claim. <strong>Email queue (pre-delivery):</strong> deleted after successful delivery; briefly retained for failed messages. For Customer Data you upload, you control retention and may delete records at any time using the Service's tools.</p>

          <h2>8. Security</h2>
          <p>We implement technical and organizational measures including: TLS/HTTPS for all communications; AES-256-GCM encryption at rest for sensitive data including integration credentials; bcrypt hashing for passwords and PINs; role-based access controls within the Service and our infrastructure; short-lived access tokens and rotating refresh tokens; audit logging of administrative actions; regular security monitoring and error tracking; background database backups; and periodic review of sub-processors. No method of transmission or storage is perfectly secure — we cannot guarantee absolute security but work continuously to maintain industry-standard protections.</p>
          <h3>Breach Notification</h3>
          <p>If we become aware of a personal-data breach affecting your data, we will notify you without undue delay — where feasible within 72 hours of becoming aware, in line with GDPR-style standards — describing the nature of the breach, the data involved, likely consequences, and the measures we are taking.</p>

          <h2>9. Your Rights</h2>
          <p>Subject to applicable law, you have rights to: <strong>access</strong> the data we hold about you; <strong>rectify</strong> inaccurate or incomplete data; <strong>erase</strong> data, subject to legal-retention obligations; <strong>restrict</strong> processing in certain circumstances; <strong>object</strong> to processing based on legitimate interest, including direct marketing; <strong>portability</strong> — receive data in a structured, machine-readable format; <strong>withdraw consent</strong> where we rely on consent; and <strong>lodge a complaint</strong> with your local supervisory authority. To exercise rights, email <strong>support@sanopos.com</strong> from your account email — we will respond within 30 days, or as required by law.</p>
          <p>For Customer Data you have uploaded, your end customers should direct their rights requests to <strong>you</strong>, as you are the data controller. We will assist you in fulfilling those requests via the Service's export, correction, and deletion tools.</p>

          <h2>10. Region-Specific Rights</h2>
          <h3>European Economic Area (EEA) and United Kingdom</h3>
          <p>If you are in the EEA or UK, processing is subject to the GDPR or UK GDPR. You have all rights listed in Section 9 and may lodge a complaint with your national supervisory authority (UK: the Information Commissioner's Office).</p>
          <h3>California, United States</h3>
          <p>If you are a California resident, the CCPA (as amended by the CPRA) gives you rights to know, delete, correct, opt out of "sale" or "sharing" of personal information (<strong>note: we do not sell or share personal information as defined under the CCPA</strong>), limit use of sensitive personal information, and non-discrimination for exercising any right. Contact <strong>support@sanopos.com</strong> to exercise CCPA rights.</p>
          <h3>Pakistan</h3>
          <p>If you are in Pakistan, you have such rights as may be granted under the Personal Data Protection Bill once enacted, and under other applicable Pakistani law.</p>
          <h3>Other Regions</h3>
          <p>If you are located in any other jurisdiction, please contact us and we will honour applicable local rights.</p>

          <h2>11. Children</h2>
          <p>The Service is not directed to children under 18 and we do not knowingly collect personal data from anyone under 18. If you believe a child has provided us with personal data, contact <strong>support@sanopos.com</strong> and we will delete it.</p>

          <h2>12. Cookies and Similar Technologies</h2>
          <p>We use only essential cookies and browser storage (such as localStorage) for authentication, session management, security, and user preferences (e.g., light/dark theme). We do not use advertising cookies, behavioural-tracking cookies, third-party user-profiling analytics, or cross-site tracking pixels. Because our use is limited to strictly necessary purposes, no cookie consent banner is required under the EU ePrivacy Directive. If we add non-essential cookies in future, we will update this Policy and present a consent mechanism.</p>

          <h2>13. Changes to This Policy</h2>
          <p>We may update this Privacy Policy from time to time to reflect changes in our practices, technology, legal requirements, or operational needs. We will post the updated Policy with a new "Last Updated" date. For material changes, we will notify account administrators by email and/or in-app notification at least 30 days before the changes take effect — except where shorter notice is needed for legal or security reasons. Continued use of the Service after a change takes effect constitutes acceptance.</p>

          <h2>14. Contact Us</h2>
          <p>For any questions, requests, or complaints regarding this Privacy Policy or our handling of your personal data, contact us at <strong>[Legal Entity Name]</strong>, <strong>[Registered Address]</strong>, email <strong>support@sanopos.com</strong>. We aim to respond within 30 days.</p>

          <p className="mt-8 text-xs italic text-slate-500">
            By using the Service, you acknowledge that you have read and understood this
            Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
}
