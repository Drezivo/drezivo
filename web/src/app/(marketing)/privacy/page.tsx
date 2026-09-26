import type { Metadata } from 'next';
import { LegalLayout } from '@/components/legal/legal-layout';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How Drezivo handles personal information for its software and storefronts.',
};

export default function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" updated="[INSERT DATE]">
      <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
        Draft for Philippine legal review. Confirm the actual data flows, processors, retention
        schedule, transfers, DPO, and contact details before publishing. This page is not legal
        advice.
      </p>
      <h2>1. Who this notice covers</h2>
      <p>
        This notice covers Drezivo websites, staff dashboards, public storefront tools,
        reservations, support channels, and related services. A clothing rental business often
        decides why its customer data is collected. In that case the business is the personal
        information controller and Drezivo processes the data under documented instructions. Drezivo
        may be a controller for its own account, billing, support, security, and legal purposes.
      </p>
      <h2>2. Information we process</h2>
      <ul>
        <li>Names, email addresses, phone numbers, roles, and account identifiers.</li>
        <li>Business names, branches, addresses, billing details, and selected plan.</li>
        <li>Reservation dates, garment selections, measurements, fitting notes, and messages.</li>
        <li>
          Payment status, receipt metadata, refund details, and limited transaction references.
        </li>
        <li>Uploaded images or documents and the metadata needed to secure them.</li>
        <li>Device, browser, IP address, timestamps, request identifiers, and security events.</li>
        <li>Support correspondence, preferences, surveys, and consent records.</li>
      </ul>
      <p>
        Do not submit sensitive information unless the feature needs it, the controller has a lawful
        purpose, and the data subject has received the required notice. Drezivo does not request a
        full card number for the described workflow.
      </p>
      <h2>3. Purposes and lawful bases</h2>
      <p>
        We process information for stated, legitimate, and proportionate purposes. Depending on the
        relationship, the basis may be contract performance, legal obligation, consent, vital
        interests, or a balanced legitimate interest. Examples include authentication, reservations,
        service messages, security, fraud prevention, support, billing, records, and reliability.
      </p>
      <h2>4. Cookies and marketing</h2>
      <p>
        Service messages may be needed to operate an account. Promotional messages will include an
        opt-out method where required. Cookies and similar technologies should be limited to login,
        security, preferences, measurement, or a separately disclosed purpose. The production
        privacy inventory must list the actual tools enabled before publication.
      </p>
      <h2>5. Disclosure and international processing</h2>
      <p>
        We may disclose information to the business controlling a reservation, authorized staff,
        Clerk, Supabase, Amazon S3, email providers, security and monitoring providers, payment
        providers used for a feature, advisers, and public authorities when legally required. We do
        not sell personal information.
      </p>
      <p>
        Some providers may process information outside the Philippines. Before launch, Drezivo must
        maintain a processor and transfer register, assess safeguards, and update this notice when a
        material transfer or provider changes.
      </p>
      <h2>6. Retention and security</h2>
      <p>
        We keep information only as long as needed for the stated purpose, legal obligations,
        dispute resolution, security records, or legal claims. The production retention schedule
        must state periods for accounts, reservations, financial records, payment evidence, support,
        logs, and backups. At the end of retention, information is deleted, anonymized, or
        de-identified.
      </p>
      <p>
        Safeguards include least privilege, tenant and branch authorization, encryption in transit,
        protected storage, audit records, boundary validation, backups, monitoring, incident
        response, and vendor controls. No internet service can promise absolute security.
      </p>
      <p>
        When required by the Data Privacy Act and National Privacy Commission guidance, a qualifying
        breach is reported to the NPC and affected data subjects within seventy-two hours after
        knowledge of, or reasonable belief that, the breach occurred.
      </p>
      <h2>7. Your rights</h2>
      <p>
        Subject to lawful limits, you may ask to be informed, access and correct information, object
        to or restrict processing, request deletion or blocking, request portability where
        applicable, withdraw consent where consent is the basis, and complain to the National
        Privacy Commission.
      </p>
      <p>
        Questions about a reservation should first go to the business named on the storefront. For
        Drezivo account or website processing, contact [INSERT PRIVACY EMAIL]. We may verify
        identity and coordinate with the relevant controller.
      </p>
      <h2>8. Children and automated processing</h2>
      <p>
        Drezivo is intended for businesses and their customers, not independent child accounts. A
        business must use an appropriate lawful basis and guardian handling before submitting a
        child’s information. Drezivo should not make a significant decision solely through automated
        processing without the required notice, safeguards, human review, and regulatory assessment.
      </p>
      <h2>9. Contact</h2>
      <p>
        Data Protection Officer: [INSERT DPO NAME OR ROLE]
        <br />
        Privacy contact: [INSERT PRIVACY EMAIL]
        <br />
        Postal address: [INSERT REGISTERED ADDRESS]
      </p>
      <p>
        If a concern is not resolved, contact the{' '}
        <a href="https://privacy.gov.ph/">National Privacy Commission</a>.
      </p>
    </LegalLayout>
  );
}
