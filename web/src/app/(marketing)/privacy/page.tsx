import type { Metadata } from 'next';
import { LegalLayout } from '@/components/legal/legal-layout';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How Drezivo handles personal information for its software and storefronts.',
};

export default function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" updated="October 3, 2026">
      <p>
        Drezivo is a software platform for clothing rental businesses. This Privacy Policy explains
        how personal information is processed through Drezivo&apos;s websites, business dashboard,
        public storefronts, reservation and fitting features, subscription services, support
        channels, and related services.
      </p>
      <p>
        Drezivo is currently operated in the Philippines by <strong>Ryanny Romero</strong> and{' '}
        <strong>Vergel Bautista</strong>. Until Drezivo is operated through a separate registered
        legal entity, references in this policy to &quot;Drezivo,&quot; &quot;we,&quot;
        &quot;us,&quot; or &quot;our&quot; refer to the current operators of the service. Privacy
        questions and requests may be sent to{' '}
        <a href="mailto:drezivoshop@gmail.com">drezivoshop@gmail.com</a>.
      </p>

      <h2>1. Our role and the rental business&apos;s role</h2>
      <p>
        Drezivo serves both clothing rental businesses and their customers. When a rental business
        uses Drezivo to manage its customers, reservations, fittings, payment evidence, garments,
        and related records, that business generally determines why the information is collected and
        how it is used. In that situation, the rental business is generally the Personal Information
        Controller and Drezivo processes the information on the business&apos;s documented
        instructions as a Personal Information Processor.
      </p>
      <p>
        The rental business remains responsible for providing any privacy notice required for its
        own processing, establishing an appropriate lawful basis, collecting only information it
        legitimately needs, and responding to requests concerning its customer relationship.
      </p>
      <p>
        Drezivo acts as a Personal Information Controller for information it processes for its own
        purposes, including account administration, Drezivo subscription billing, security, fraud
        and abuse prevention, service reliability, support, legal compliance, and protection of the
        service and its users.
      </p>

      <h2>2. Personal information we process</h2>
      <p>
        The information processed depends on how a person uses Drezivo and which features a rental
        business enables.
      </p>
      <ul>
        <li>
          <strong>Business owner and staff information:</strong> account identifiers, name, email
          address and other identity information handled through our authentication provider,
          membership status, role, business association, branch access, and account activity.
        </li>
        <li>
          <strong>Business information:</strong> business and storefront names, branch information,
          contact details, addresses, logos, operating hours, rental policies, payment instructions,
          subscription information, and other business settings. Some of this information is
          intentionally displayed on the business&apos;s public storefront.
        </li>
        <li>
          <strong>Customer and reservation information:</strong> full name, verified email address,
          mobile number where collected, reservation or delivery address, optional social-media
          contact information, selected garment or size, rental dates, pickup and return details,
          optional event date, fulfillment method, reservation status, and related operational
          history.
        </li>
        <li>
          <strong>Fitting information:</strong> customer name and contact information, appointment
          date and time, garments selected for fitting, appointment status, and notes submitted for
          the fitting.
        </li>
        <li>
          <strong>Garment and measurement information:</strong> clothing sizes, garment
          measurements, measurement guides, and measurements associated with catalogue variants.
          Drezivo&apos;s standard customer reservation flow is not intended to create a general
          profile of a customer&apos;s body measurements.
        </li>
        <li>
          <strong>Payment and transaction information:</strong> payment method selections, amounts,
          payment status, deposits, refunds, limited transaction or reference information, and
          uploaded payment evidence such as a receipt image or PDF. Drezivo may also process
          subscription payment references and uploaded payment proof for Drezivo subscriptions.
        </li>
        <li>
          <strong>Uploaded files and content:</strong> catalogue photographs, business logos and
          cover images, measurement guides, policy materials, payment-method materials, payment
          evidence, and other files intentionally uploaded through an available feature.
        </li>
        <li>
          <strong>Technical and security information:</strong> IP address, request identifiers,
          timestamps, browser or user-agent information, authentication and security events,
          diagnostic information, and other technical data needed to operate, protect, and
          troubleshoot the service.
        </li>
        <li>
          <strong>Support information:</strong> contact details, correspondence, screenshots or
          files a person chooses to provide, support history, and information needed to investigate
          or resolve a request.
        </li>
      </ul>
      <p>
        A guest does not need to create a Drezivo customer account to submit a reservation or
        fitting request through a public storefront.
      </p>

      <h2>3. Sensitive personal information</h2>
      <p>
        Drezivo&apos;s standard reservation, fitting, customer-management, and subscription
        workflows are not designed to require government identification numbers, biometric
        information, health information, religious or political information, or similar sensitive
        personal information.
      </p>
      <p>
        Rental businesses and users should not place unnecessary sensitive personal information in
        customer notes, fitting notes, support messages, uploads, or other free-text areas. If a
        business separately records personal body measurements or other sensitive information, that
        business is responsible for ensuring that the collection is lawful, necessary, properly
        disclosed, and appropriately protected.
      </p>

      <h2>4. Where information comes from</h2>
      <p>
        We may receive personal information directly from the person concerned, from the rental
        business using Drezivo, from authorized business staff, from authentication and security
        providers, from information submitted through payment workflows, from a person&apos;s
        browser or device, and from service providers acting on our instructions.
      </p>
      <p>
        A rental business may also enter information about its existing customers into Drezivo. The
        business is responsible for ensuring that it is permitted to provide that information to the
        service.
      </p>

      <h2>5. Why we process personal information</h2>
      <p>
        We process personal information only for specified and legitimate purposes connected with
        operating Drezivo or providing services requested through a Drezivo storefront. These
        purposes include authentication, workspace and staff management, storefront operation,
        customer management, reservations, fittings, garment fulfillment, payment-evidence review,
        subscription billing, transactional messages, support, security, abuse prevention,
        reliability, record keeping, dispute handling, enforcement of agreements, and compliance
        with applicable legal obligations.
      </p>
      <p>
        Depending on the circumstances, processing may be based on performance of a contract or
        steps requested before entering into a contract, compliance with a legal obligation, consent
        where consent is appropriate, protection of vital interests, or a legitimate interest that
        is not overridden by the rights and freedoms of the data subject.
      </p>
      <p>
        We will not use personal information for a materially incompatible new purpose without an
        appropriate legal basis and any notice required by law.
      </p>

      <h2>6. Email verification and security checks</h2>
      <p>
        Public storefronts may require a customer to verify control of an email address before
        submitting certain requests. Verification codes are time-limited and currently expire after
        approximately 10 minutes.
      </p>
      <p>
        Drezivo may use Cloudflare Turnstile to protect public verification and booking features
        against automated abuse. When Turnstile is enabled, information required to perform the
        security check, including the Turnstile response and technical information such as the
        client&apos;s IP address, may be processed by Cloudflare. These checks are used for security
        and abuse prevention, not by Drezivo for behavioral advertising.
      </p>

      <h2>7. Cookies and similar technologies</h2>
      <p>
        Drezivo may use cookies and similar browser technologies that are necessary for
        authentication, session continuity, storefront preview functionality, security, fraud
        prevention, and operation of the service.
      </p>
      <p>
        Drezivo uses Vercel Web Analytics to measure visits to its marketing pages and public
        storefronts. Vercel Web Analytics does not use cookies and provides aggregated traffic
        reporting. The information may include the page URL, referrer, timestamp, approximate
        location, and browser, operating-system, and device information. Drezivo removes query
        strings, generalizes item identifiers, and does not send booking-flow pageviews to
        analytics. Vercel describes its visitor identifier as a daily hash that expires after 24
        hours; analytics data is otherwise retained according to the applicable Vercel service
        settings. This analytics is not used for behavioral advertising or session replay.
      </p>

      <h2>8. Payments</h2>
      <p>
        Drezivo does not currently collect or store full payment-card numbers as part of the rental
        or Drezivo subscription workflows described in this policy. Rental payments are made using
        methods selected by the rental business. Drezivo may process the selected payment method,
        transaction status, limited reference information, and uploaded receipt or other payment
        evidence.
      </p>
      <p>
        An uploaded receipt is payment evidence for review and does not by itself prove that funds
        have settled. The rental business remains responsible for verifying its customer payments,
        refunds, deposits, and other rental transactions.
      </p>

      <h2>9. How information is shared</h2>
      <p>We do not sell personal information.</p>
      <p>
        Personal information may be made available to the rental business responsible for a customer
        relationship and to staff members authorized by that business. We also use service providers
        to operate Drezivo. Depending on the production configuration, these include Clerk for
        authentication and identity services, Supabase for database infrastructure, Cloudflare for
        object storage and security services such as R2 and Turnstile, Resend for transactional
        email when enabled, Vercel for website analytics and hosting or infrastructure providers
        used to operate Drezivo&apos;s websites, applications, and API.
      </p>
      <p>
        Providers receive information reasonably necessary to perform their services, subject to our
        agreements, configuration, and applicable data-protection requirements. Information may also
        be disclosed to professional advisers or public authorities where reasonably necessary to
        comply with applicable law, respond to lawful process, protect people or systems,
        investigate unlawful activity, or establish or defend legal claims.
      </p>

      <h2>10. Processing outside the Philippines</h2>
      <p>
        Some infrastructure and service providers may process or store information outside the
        Philippines. Where personal information is outsourced or transferred internationally,
        Drezivo and the relevant Personal Information Controller remain responsible for taking
        appropriate contractual, organizational, and technical measures to maintain an appropriate
        level of protection.
      </p>

      <h2>11. Retention and deletion</h2>
      <p>
        Drezivo keeps personal information only for as long as necessary for the purpose for which
        it was collected, the instructions of the applicable rental business, contractual
        requirements, security needs, legal or accounting obligations, unresolved disputes, or the
        establishment or defense of legal claims. Personal information is not retained indefinitely
        merely because it may be useful in the future.
      </p>
      <p>
        <strong>Subscription expiry and workspace closure.</strong> If a Drezivo business no longer
        has an active subscription and does not renew, Drezivo will retain the workspace and its
        associated service data for <strong>30 days</strong>. This period allows the business to
        restore service or complete an available data-export or recovery process. After the 30-day
        period, workspace data will be deleted or irreversibly anonymized according to
        Drezivo&apos;s deletion procedures.
      </p>
      <p>
        Certain limited records may be retained longer where reasonably necessary to comply with
        applicable law, accounting or tax requirements, resolve disputes, investigate fraud or
        security incidents, establish or defend legal claims, or satisfy another lawful retention
        requirement. Information subject to such an exception will not be retained for unrelated
        future use.
      </p>
      <p>
        Short-lived security credentials and technical authorizations, such as verification codes,
        guest access credentials, and upload authorizations, expire according to their technical
        purpose. Backups are removed through their applicable rolling-expiry process rather than
        being used as an indefinite archive.
      </p>

      <h2>12. Security</h2>
      <p>
        Drezivo uses reasonable and appropriate organizational, physical, and technical safeguards
        intended to protect personal information against unauthorized access, disclosure,
        alteration, loss, misuse, and destruction. These safeguards include access controls based on
        tenant, branch, and role; authentication controls; encryption in transit; protected storage
        for private files; validation at system boundaries; audit records; restricted access to
        payment evidence; secure software-development practices; backups; monitoring; abuse
        prevention; and incident-response procedures.
      </p>
      <p>
        No website, network, storage system, or internet service can guarantee absolute security.
        Users and rental businesses are also responsible for protecting their credentials, limiting
        staff access appropriately, and notifying Drezivo of suspected compromise.
      </p>

      <h2>13. Personal-data breaches</h2>
      <p>
        Drezivo maintains procedures for investigating security incidents and personal-data
        breaches. Where a breach satisfies the requirements for mandatory notification under
        Philippine law, the responsible Personal Information Controller will notify the National
        Privacy Commission and affected data subjects within the period required by law. Drezivo
        will assist a rental business where Drezivo acts as that business&apos;s Personal
        Information Processor and the incident involves information processed on the business&apos;s
        behalf.
      </p>

      <h2>14. Your rights</h2>
      <p>
        Subject to applicable conditions and lawful limitations under the Data Privacy Act of 2012,
        a data subject may exercise rights including the right to be informed, object to certain
        processing, access personal information, correct inaccurate information, request suspension,
        withdrawal, blocking, removal or destruction where legally applicable, obtain data
        portability where applicable, seek damages where provided by law, and lodge a complaint with
        the National Privacy Commission.
      </p>
      <p>
        Where processing is based on consent, the data subject may withdraw that consent. Withdrawal
        does not make earlier lawful processing unlawful and may not prevent processing supported by
        another lawful basis.
      </p>
      <p>
        If a request concerns a reservation, fitting, customer profile, payment, or other
        relationship with a rental business, the person should normally contact that business first
        because it is generally the Personal Information Controller for that customer relationship.
        Drezivo will reasonably assist the business with valid requests where required.
      </p>
      <p>
        Requests relating to a Drezivo account, Drezivo subscription, Drezivo&apos;s own website
        processing, security records, support interaction, or this policy may be sent to{' '}
        <a href="mailto:drezivoshop@gmail.com">drezivoshop@gmail.com</a>. We may request information
        necessary to verify the identity and authority of the requester before disclosing, changing,
        exporting, or deleting personal information.
      </p>

      <h2>15. Automated processing</h2>
      <p>
        Drezivo does not currently use the customer information described in this policy to make
        solely automated decisions that produce legal or similarly significant effects on customers.
        Automated technical controls may be used for validation, rate limiting, security, abuse
        prevention, availability calculations, and workflow rules.
      </p>
      <p>
        If Drezivo introduces significant automated decision-making or profiling in the future, we
        will assess the legal and privacy implications and provide any additional notice required
        before using that processing.
      </p>

      <h2>16. Children and minors</h2>
      <p>
        Drezivo is a business software platform and is not intended for children to create
        independent business accounts. A rental business may provide services for an event involving
        a minor, but that business is responsible for determining whether it may lawfully collect
        and process the minor&apos;s information and for obtaining appropriate parental or guardian
        involvement where required.
      </p>

      <h2>17. Responsibilities of businesses using Drezivo</h2>
      <p>
        Businesses using Drezivo must use the platform lawfully. A business is responsible for
        having an appropriate basis for information it enters into Drezivo, giving any notice for
        which it is responsible, limiting staff access, avoiding unnecessary collection, maintaining
        reasonably accurate customer information, and responding to valid privacy requests from its
        customers.
      </p>
      <p>
        Businesses must not use Drezivo to collect or process personal information for unlawful,
        deceptive, discriminatory, or unrelated purposes. Drezivo may restrict access where
        reasonably necessary to address unlawful processing, security threats, abuse, contractual
        violations, non-payment, or legal requirements.
      </p>

      <h2>18. Changes to this Privacy Policy</h2>
      <p>
        We may update this Privacy Policy when the service, our providers, our processing
        activities, or applicable requirements change. The current version will identify its most
        recent update date. Where a change materially affects how personal information is processed,
        we will provide additional notice when required by law.
      </p>

      <h2>19. Contact and complaints</h2>
      <p>
        <strong>Operator:</strong> Drezivo, currently operated by Ryanny Romero and Vergel Bautista
        <br />
        <strong>Location:</strong> Philippines
        <br />
        <strong>Privacy contact:</strong>{' '}
        <a href="mailto:drezivoshop@gmail.com">drezivoshop@gmail.com</a>
      </p>
      <p>
        Because Drezivo is not yet operated through a separate registered legal entity, Ryanny
        Romero and Vergel Bautista are the current operators responsible for Drezivo&apos;s own
        processing to the extent required by law. This section will be updated if Drezivo begins
        operating through a registered business or juridical entity.
      </p>
      <p>
        If a privacy concern is not adequately resolved, a data subject may contact the{' '}
        <a href="https://privacy.gov.ph/">National Privacy Commission of the Philippines</a> through
        its official channels.
      </p>
    </LegalLayout>
  );
}
