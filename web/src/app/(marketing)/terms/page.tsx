import type { Metadata } from 'next';
import { LegalLayout } from '@/components/legal/legal-layout';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Terms governing use of Drezivo clothing rental operations software.',
};

export default function TermsPage() {
  return (
    <LegalLayout title="Terms of Service" updated="[INSERT DATE]">
      <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
        Draft for Philippine legal review. Replace the bracketed company, address, contact, billing,
        and dispute details before publishing. This page is not legal advice.
      </p>
      <h2>1. Agreement and scope</h2>
      <p>
        These Terms govern access to Drezivo, a hosted service for clothing rental businesses. The
        service may include staff operations, public storefronts, reservations, inventory, payment
        evidence, reports, and support tools.
      </p>
      <p>
        By creating an account or using the service, you confirm that you can enter this agreement.
        If you accept for a business, you confirm that you have authority to bind that business.
      </p>
      <h2>2. The rental business remains the merchant</h2>
      <p>
        Drezivo provides software. Each business using Drezivo remains responsible for its own
        garments, prices, deposits, availability, fitting rules, pickup and return rules, taxes,
        refunds, customer communications, and legal obligations. A storefront or booking is issued
        on behalf of that business, not by Drezivo as the rental provider.
      </p>
      <p>
        Guests should contact the business named on the storefront about a garment, booking,
        payment, deposit, refund, pickup, return, or complaint. Nothing in these Terms removes a
        consumer right that cannot be waived under Philippine law.
      </p>
      <h2>3. Accounts and acceptable use</h2>
      <p>
        Keep account information accurate, protect credentials, use available multi-factor
        authentication, and report suspected compromise. Do not share access in a way that defeats
        role or branch controls.
      </p>
      <p>
        Do not use Drezivo to deceive consumers, infringe rights, upload malware, bypass security,
        manipulate availability, submit false payment evidence, or process information without a
        lawful basis. We may restrict access to address abuse, security risk, non-payment, breach,
        or a legal requirement.
      </p>
      <h2>4. Plans and payment</h2>
      <p>
        Published monthly plans are Starter at ₱300, Professional at ₱499, and Business at ₱1,299,
        unless an order form or pricing page states otherwise. The checkout flow must show the
        selected plan, inclusions, taxes, billing period, renewal, cancellation, and payment terms
        before purchase.
      </p>
      <p>
        The business remains responsible for collecting rental fees, deposits, and refunds from its
        customers. Drezivo is not a bank, escrow agent, payment facilitator, or insurer unless a
        separate written agreement says so. Uploaded payment evidence does not prove settlement.
      </p>
      <h2>5. Content and intellectual property</h2>
      <p>
        Businesses keep ownership of their names, logos, catalogue information, images, policies,
        and records. They give Drezivo the limited licence needed to host, secure, display, and
        process that content to provide the service. Businesses confirm they have the rights and
        notices required for content they upload.
      </p>
      <p>
        Drezivo and its licensors own the service, software, documentation, design, and trademarks,
        excluding business content and third-party materials. These Terms grant a limited right to
        use the service during the applicable term.
      </p>
      <h2>6. Privacy</h2>
      <p>
        The <a href="/privacy">Privacy Policy</a> explains processing of personal information. A
        business may be the controller for its customer data while Drezivo acts as its processor.
        Drezivo may be a controller for account, billing, support, security, and legal purposes.
      </p>
      <h2>7. Availability, suspension, and termination</h2>
      <p>
        We use reasonable efforts to maintain the service, but maintenance, provider failures,
        security response, internet outages, and events outside reasonable control can affect
        availability. We may change features with reasonable notice when practical.
      </p>
      <p>
        You may close an account through [INSERT SUPPORT CHANNEL]. We may suspend or terminate for
        non-payment, material breach, unlawful use, security risk, or legal requirement. Where
        practical, we will give notice and a chance to fix the issue. Export and deletion follow
        the applicable order and retention terms.
      </p>
      <h2>8. Liability and disputes</h2>
      <p>
        To the extent Philippine law allows, Drezivo does not promise uninterrupted service or that
        the software replaces legal, accounting, insurance, security, or operational controls.
        Nothing limits liability or consumer remedies that cannot lawfully be limited, including
        liability for fraud or willful misconduct.
      </p>
      <p>
        These Terms are governed by Philippine law. Insert the agreed venue or dispute process after
        counsel review. Questions and legal notices: [INSERT LEGAL CONTACT EMAIL].
      </p>
      <h2>9. Related Philippine sources</h2>
      <ul>
        <li><a href="https://privacy.gov.ph/data-privacy-act/">Data Privacy Act of 2012</a></li>
        <li><a href="https://lawphil.net/statutes/repacts/ra2023/ra_11967_2023.html">Internet Transactions Act of 2023</a></li>
        <li><a href="https://lawphil.net/statutes/repacts/ra1992/ra_7394_1992.html">Consumer Act of the Philippines</a></li>
        <li><a href="https://lawphil.net/statutes/repacts/ra2000/ra_8792_2000.html">Electronic Commerce Act</a></li>
      </ul>
    </LegalLayout>
  );
}
