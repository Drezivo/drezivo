import type { Metadata } from 'next';
import { READ_ONLY_ACCESS_DAYS, STOREFRONT_GRACE_DAYS } from '@drezivo/contracts';

import { LegalLayout } from '@/components/legal/legal-layout';
import { MARKETING_TRIAL_DAYS } from '@/lib/marketing-content';
import { CONTACT_EMAIL } from '@/lib/site-urls';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Terms governing use of Drezivo clothing rental operations software.',
};

export default function TermsPage() {
  return (
    <LegalLayout title="Terms of Service" updated="October 2, 2026">
      <p>
        These Terms of Service govern access to and use of Drezivo, a hosted software platform for
        clothing rental businesses. Drezivo is currently operated in the Philippines by{' '}
        <strong>Ryanny Romero</strong> and <strong>Vergel Bautista</strong>. References to
        &quot;Drezivo,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot; refer to the current
        operators of the service until Drezivo begins operating through a separate registered legal
        entity.
      </p>
      <p>
        Questions, support requests, account-closure requests, and legal notices may be sent to{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>1. Agreement and eligibility</h2>
      <p>
        By creating a Drezivo business account, starting a trial, subscribing, or continuing to use
        the service, you agree to these Terms. If you use Drezivo for a business, you confirm that
        you are authorized to act for that business and to provide the information submitted through
        its workspace.
      </p>
      <p>
        You must provide accurate account and business information and use Drezivo only for lawful
        business activities. These Terms do not remove rights or remedies that cannot legally be
        waived under Philippine law.
      </p>

      <h2>2. What Drezivo provides</h2>
      <p>
        Drezivo provides software for clothing rental operations. Depending on the features enabled,
        the service may include a business dashboard, inventory and garment records, availability,
        reservations, fittings, customer records, operational calendars, public storefronts,
        payment-evidence workflows, subscription billing, file uploads, reports, and support tools.
      </p>
      <p>
        Drezivo may improve, replace, or discontinue features over time. We will use reasonable
        efforts to give advance notice when a material change significantly reduces a paid service,
        where notice is practical and legally required.
      </p>

      <h2>3. The rental business remains the merchant</h2>
      <p>
        Drezivo provides software; it is not the clothing rental merchant. Each business using
        Drezivo remains responsible for its garments, descriptions, condition, availability, rental
        prices, deposits, fitting rules, pickup and return requirements, delivery arrangements,
        cancellation rules, refunds, taxes, customer communications, and other obligations to its
        customers.
      </p>
      <p>
        A public Drezivo storefront, reservation request, fitting request, payment instruction, or
        booking communication is provided for the business identified on that storefront. Customers
        should contact that business about a specific garment, reservation, fitting, rental payment,
        deposit, refund, pickup, return, or rental complaint.
      </p>
      <p>
        Drezivo is not a bank, escrow service, insurer, or payment facilitator for rental
        transactions. An uploaded receipt or payment screenshot is evidence for review and does not
        by itself prove that funds have settled.
      </p>

      <h2>4. Accounts, staff access, and security</h2>
      <p>
        Account owners are responsible for keeping their account information accurate, protecting
        credentials, using available authentication safeguards, and assigning staff access only to
        people who are authorized to use the workspace. Do not share access in a way that bypasses
        role, branch, or permission controls.
      </p>
      <p>
        You must promptly tell us if you reasonably believe an account has been compromised. Drezivo
        may temporarily restrict an account or feature where reasonably necessary to investigate a
        security issue, prevent abuse, comply with law, or protect users and the service.
      </p>

      <h2>5. Trial, subscription, and payment</h2>
      <p>
        Eligible new businesses may receive a <strong>{MARKETING_TRIAL_DAYS}-day free trial</strong>
        . The currently offered subscription, price, included capacity, and other commercial details
        are shown on the <a href="/pricing">Pricing page</a> and in the Drezivo business app before
        payment is submitted.
      </p>
      <p>
        During the current pilot, Drezivo does not automatically charge a payment card for the SaaS
        subscription. The business selects an available Drezivo payment method, pays externally, and
        submits the transaction reference and payment proof in the business app. Subscription
        payment proof is subject to review before paid access is granted or extended.
      </p>
      <p>
        If a trial or paid subscription period expires without renewal, the workspace becomes
        read-only for up to <strong>{READ_ONLY_ACCESS_DAYS} days</strong>. The public storefront may
        remain online for the first <strong>{STOREFRONT_GRACE_DAYS} days</strong> of that period
        with new bookings paused, after which the storefront goes offline. At the end of the
        read-only period, the workspace is locked until a valid subscription is restored. An
        explicitly cancelled subscription may be locked sooner.
      </p>
      <p>
        Workspace-data retention after a subscription is no longer active is governed by the{' '}
        <a href="/privacy">Privacy Policy</a>. The current policy provides a 30-day retention period
        for workspace service data, subject to limited lawful-retention exceptions.
      </p>
      <p>
        Any future price change applies prospectively. We will show the applicable price before a
        new paid period is purchased and provide any additional notice required by law.
      </p>

      <h2>6. Business content and customer records</h2>
      <p>
        A business keeps its rights in the names, logos, catalogue information, photographs,
        policies, customer records, and other content it submits to Drezivo. The business gives
        Drezivo a limited licence to host, copy, secure, process, transmit, and display that content
        only as reasonably needed to operate, protect, support, and improve the service for that
        business and its authorized users.
      </p>
      <p>
        The business confirms that it has the rights, permissions, notices, and lawful basis needed
        for content and personal information it submits. Do not upload material that infringes
        another person's rights or information that you are not legally permitted to process.
      </p>

      <h2>7. Privacy and data protection</h2>
      <p>
        The <a href="/privacy">Privacy Policy</a> explains how Drezivo processes personal
        information. For customer data controlled by a rental business, that business generally acts
        as the Personal Information Controller and Drezivo generally acts as its Personal
        Information Processor. Drezivo may separately act as a controller for its own account,
        subscription billing, support, security, and legal processing.
      </p>
      <p>
        Businesses using Drezivo are responsible for giving any customer-facing privacy notice for
        which they are responsible, collecting only information they legitimately need, limiting
        staff access, and responding to valid privacy requests relating to their customer
        relationships. Neither a business nor Drezivo may instruct the other to process personal
        information unlawfully.
      </p>

      <h2>8. Acceptable use</h2>
      <p>
        You must not use Drezivo to violate applicable law, deceive customers, infringe intellectual
        property or privacy rights, harass or harm people, upload malicious code, probe or attack
        the service without authorization, bypass access controls, manipulate availability or
        payment records, submit deliberately false payment evidence, impersonate another person or
        business, or process information without an appropriate lawful basis.
      </p>
      <p>
        We may investigate suspected misuse, preserve records where lawfully required, remove or
        restrict harmful content, and suspend affected access where reasonably necessary to protect
        users, Drezivo, third parties, or the integrity of the service.
      </p>

      <h2>9. Third-party services</h2>
      <p>
        Drezivo relies on third-party infrastructure and service providers for functions such as
        authentication, database hosting, object storage, security checks, transactional email, and
        application hosting. The current providers and relevant personal-data processing are
        described in the <a href="/privacy">Privacy Policy</a>.
      </p>
      <p>
        Third-party outages, network failures, or changes outside Drezivo's reasonable control may
        temporarily affect the service. Drezivo remains responsible for its own obligations when
        selecting and configuring service providers.
      </p>

      <h2>10. Availability and support</h2>
      <p>
        We use reasonable efforts to operate and maintain Drezivo, but the service is provided on an
        as-available basis and may occasionally be interrupted by maintenance, provider failures,
        security response, internet outages, software defects, or events outside reasonable control.
      </p>
      <p>
        Unless a separate written agreement expressly provides a service-level commitment, these
        Terms do not guarantee uninterrupted availability, a particular response time, or error-free
        operation. Support requests may be sent to{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>11. Suspension, cancellation, and closure</h2>
      <p>
        You may stop renewing the service or request account closure by contacting{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We may suspend, restrict, or close
        access for non-payment, material breach of these Terms, unlawful use, security risk, fraud,
        abuse, or a legal requirement.
      </p>
      <p>
        Where practical and appropriate, we will provide notice and an opportunity to address a
        remediable issue before permanent closure. Immediate restriction may be necessary for
        security, fraud, unlawful activity, or legal compliance. Data access, retention, deletion,
        and lawful retention exceptions after subscription expiry or closure are governed by the
        Privacy Policy and the applicable subscription state.
      </p>

      <h2>12. Drezivo intellectual property</h2>
      <p>
        Drezivo and its licensors retain all rights in the Drezivo software, source code,
        documentation, product design, interfaces, branding, and other proprietary materials,
        excluding content owned by businesses and third parties. These Terms grant only a limited,
        revocable, non-exclusive, non-transferable right to use the service during an authorized
        trial or subscription.
      </p>
      <p>
        You may not copy, sell, sublicense, reverse engineer, circumvent technical protections, or
        commercially exploit Drezivo except where expressly permitted by law or by a separate
        written agreement.
      </p>

      <h2>13. Disclaimers and limitation of liability</h2>
      <p>
        To the maximum extent permitted by Philippine law, Drezivo does not warrant that the service
        will meet every business requirement, prevent every loss, or replace a business's legal,
        accounting, tax, insurance, security, payment-verification, or operational controls. Rental
        businesses remain responsible for the merchant decisions described in these Terms.
      </p>
      <p>
        To the maximum extent permitted by law, Drezivo and its current operators will not be liable
        for indirect, incidental, special, exemplary, or consequential losses arising solely from
        use of the service, including lost profits or lost business opportunities, where such losses
        may lawfully be excluded. Nothing in these Terms excludes or limits liability, rights, or
        remedies that applicable law does not allow to be excluded or limited, including liability
        for fraud or willful misconduct.
      </p>

      <h2>14. Responsibility for third-party claims</h2>
      <p>
        To the extent permitted by law, a business using Drezivo is responsible for third-party
        claims resulting from that business's unlawful content, unlawful processing of personal
        information, infringement of third-party rights, misleading customer promises, or merchant
        activities that are outside Drezivo's role as a software provider. This does not shift
        responsibility to the business for Drezivo's own unlawful conduct.
      </p>

      <h2>15. Governing law and complaints</h2>
      <p>
        These Terms are governed by the laws of the Republic of the Philippines. Before escalating a
        service complaint where an internal resolution process is legally required or reasonably
        available, please contact <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> so we can
        review the issue.
      </p>
      <p>
        Nothing in these Terms prevents a person from exercising a non-waivable right or contacting
        a government authority that has jurisdiction over the matter, including the Department of
        Trade and Industry or the National Privacy Commission where applicable.
      </p>

      <h2>16. General terms</h2>
      <p>
        If a provision of these Terms is found unenforceable, the remaining provisions remain in
        effect to the extent permitted by law. A failure to enforce a provision once is not a waiver
        of the right to enforce it later. These Terms, the Privacy Policy, and any applicable
        written order or service agreement form the agreement governing the Drezivo service, subject
        to any mandatory rights under applicable law.
      </p>

      <h2>17. Contact</h2>
      <p>
        <strong>Operator:</strong> Drezivo, currently operated by Ryanny Romero and Vergel Bautista
        <br />
        <strong>Location:</strong> Philippines
        <br />
        <strong>Support and legal contact:</strong>{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
    </LegalLayout>
  );
}
