// src/data/agreementContent.js
/**
 * The fixed text of the PM Surya Ghar consumer agreement, transcribed verbatim
 * from "Agreement_Aparna Pramanik.docx".
 *
 * Only three things change between agreements:
 *   - the date on page 1,
 *   - the consumer name / consumer id / address (page 1 body and page 4 signature),
 *   - the amount on page 4 and the 50 / 40 / 10 split that follows from it.
 * Everything below is static, which is why it lives here as data rather than
 * being typed into the template.
 */

export const AGREEMENT_TITLE =
  'Agreement between Consumer & Vendor for installation of grid connected rooftop solar (RTS) project under PM – Surya Ghar: Muft Bijli Yojana';

/** Sentence around the execution date. {{day}} {{month}} {{year}} are substituted. */
export const AGREEMENT_EXECUTION =
  'This agreement is executed on {{day}}(Day) {{month}} (Month) {{year}} (Year) for design, supply, installation, commissioning and 5-year comprehensive maintenance of RTS project/system along with warranty under PM Surya Ghar: Muft Bijli Yojana';

/** Text between the parties' details and the numbered clauses. */
export const AGREEMENT_PREAMBLE = [
  'Whereas',
  'First Party wishes to install a Grid Connected Rooftop Solar Plant on the rooftop of the residential building of the Consumer under PM Surya Ghar: Muft Bijli Yojana.',
  'And whereas',
  'Second Party has verified availability of appropriate roof and found it feasible to install a Grid Connected Roof Top Solar plant and that the second party is willing to design, supply, install, test, commission and carry out Operation & Maintenance of the Rooftop Solar plant for 5 year period',
  'On this day, the First Party and Second Party agree to the following:',
  'The First Party hereby undertakes to perform the following activities:',
];

/** Page 1 — what the consumer undertakes to do. */
export const FIRST_PARTY_ITEMS = [
  'Submission of online application at National Portal for installation of RTS project/system, Submission of application for net-metering and system inspection and upload of the relevant documents on the National Portal of the scheme',
  'Provide secure storage of the material of the RTS plant delivered at the premises till handover of the system.',
  'Provide access to the Roof Top during installation of the plant, operation & maintenance, testing of the plant and equipment and for meter reading from solar meter, inverter etc.',
  'Provide electricity during plant installation and water for cleaning of the panels.',
  'Report any malfunctioning of the plant to the Vendor during the warranty period.',
  'Pay the amount as per the payment schedule as mutually agreed with the vendor, including any additional amount to the second party for any additional work/customization required depending upon the building condition',
];

/**
 * Pages 2 and 3 — what the vendor undertakes to do.
 * Item 19 is the payment clause and always starts page 4 (see PDF_PAGE_4_START_INDEX).
 */
export const SECOND_PARTY_ITEMS = [
  'The Vendor must follow all the standards and safety guidelines prescribed under state regulations and technical standards prescribed by MNRE for RTS projects, failing which the vendor is liable for blacklisting from participation in the govt. project/ scheme and other penal actions in accordance with the law. The responsibility of supply, installation and commissioning of the rooftop solar project/ system in complete compliance with MNRE scheme guidelines lies with the Vendor.',
  'Site Survey: Site visit, survey and development of detailed project report for installation of RTS system. This also includes, feasibility study of roof, strength of roof and shadow free area. If any additional work or customization is involved for the plant installation as per site condition and requirement of the consumer building, the Vendor shall prepare an estimate and can raise separate invoice including GST in addition to the amount towards standard plant cost. The consumer shall pay the amount for such additional work directly to the Vendor.',
  'Design & Engineering: Design of plant along with drawings and selection of components as per standard provided by the DISCOM/SERC/MNRE for best performance and safety of the plant.',
  'Module and Inverter: The solar modules, including the solar cells, should be manufactured in India. Both the solar modules and inverters shall conform to the relevant standards and specifications prescribed by MNRE. Any other requirement, viz. star labelling (solar modules),quality control orders and standards & labelling (inverters) etc., shall also be complied.',
  'Procurement & Supply: Procurement of complete system as per BIS/IS/IEC standard (whatever applicable) & safety guidelines for installation of rooftop solar plants. The supplied materials should comply with all MNRE standards for release of subsidy.',
  'Installation & Civil work: Complete civil work, structure work and electrical work (including drawings) following all the safety and relevant BIS standards.',
  'Documentation (Technical Catalogues/Warranty Certificates/BIS certificates/other test reports etc): All such documents shall be provided to the consumer for online uploading and submission of technical specifications, IEC/BIS report, Sr. Nos, Warranty card of Solar Panel & Inverter, Layout & Electrical SLD, Structure Design and Drawing, Cable and other detailed documents.',
  'Project completion report (PCR): Assisting the consumer in filling and uploading of signed documents (Consumer & Vendor) on the national portal.',
  'Warranty: System warranty certificates should be provided to the consumer. The complete system should be warranted for 5 years from the date of commissioning by DISCOM. Individual component warranty documents provided by the manufacturer shall be provided to the consumer and all possible assistance should be extended to the consumer for claiming the warranty from the manufacturer.',
  'NET meter & Grid Connectivity: Net meter supply/procurement, testing and approvals shall be in the scope of vendor. Grid connection of the plant shall be in the scope of vendor.',
  'Testing and Commissioning: The vendor shall be present at the time of testing and commissioning by the DISCOM.',
  'Operation & Maintenance: Five (5) years Comprehensive Operation and Maintenance including overhauling, wear and tear and regular checking of healthiness of system at proper interval shall be in the scope of vendor. The vendor shall also educate the consumer on best practices for cleaning of the modules and system maintenance.',
  'Insurance: Any insurance cost pertaining to material transfer/storage before commissioning of the System shall be in the scope of the vendor.',
  'Applicable Standard: The system must meet the technical standards and specifications notified by MNRE. The vendor is solely responsible to supply component and service which meets the technical standards and specification prescribed by MNRE and State DISCOMs.',
  'Project/system cost & payment terms: The cost of the plant and payment schedule should be mutually discussed and decided between the vendor and consumer. The consumer may opt for milestone-based payment to the vendor and the same shall be included in the agreement.',
  'Dispute: In-case of any dispute between consumer and vendor (in supply/installation/maintenance of system or payment terms), both parties must settle the same mutually or as per law. MNRE/DISCOM shall not be liable for, and would not be a party to any dispute arising between vendor and consumer.',
  'Subsidy / Project Related Documents: Vendor must provide all the documents to consumer and help in uploading the same to National Portal for smooth release of subsidy.',
  'Performance of Plant: The Performance Ratio (PR) of Plant must be 75% at the time of commissioning of the project by DISCOM or its authorised agency. Vendor must provide(returnable basis) radiation sensor with valid calibration certificate of any NABL / International laboratory at the time of commissioning / testing of the plant. Vendor must maintain the PR of the plant till warranty of project i.e. 5 years from the date of commissioning.',
  'Mutually Agreed Terms of Payment:',
];

/** Index (0 based) of the clause that must begin page 4. */
export const PDF_PAGE_4_START_INDEX = 18; // "19. Mutually Agreed Terms of Payment:"

/** Index (0 based) of the last clause that stays on page 2. */
export const PDF_PAGE_2_LAST_INDEX = 9; // items 1-10 on page 2, 11-18 on page 3

/** Sentence introducing the amount. {{amount}} is substituted. */
export const AMOUNT_SENTENCE =
  'The cost of RTS system will be Rs.{{amount}}/(to be decided mutually). The applicant shall pay the total cost to the vendor as under:';

/**
 * Payment milestones. `percent` drives the amount that is printed, `note` is the
 * fixed wording that follows it. {{percent}} {{amount}} are substituted.
 */
export const PAYMENT_STAGES = [
  {
    label: 'a)',
    percent: 50,
    note: 'An advance payment of {{percent}}% of the total project value is payable upon order confirmation. This amount enables project initiation, detailed engineering, and procurement of materials.',
  },
  {
    label: 'b)',
    percent: 40,
    note: 'of the total project value shall be payable prior to dispatch of materials from our store.',
  },
  {
    label: 'c)',
    percent: 10,
    note: 'the balance amount of the project value shall be payable after successfully installation, testing and commissioning of the solar PV system.',
  },
];

export const SIGNATURE_DISCLAIMER =
  'Disclaimer: This agreement is between vendor and consumer and any dispute related to the same shall not involve any third party including MNRE and Distribution Utilities.';

/** Default DISCOM for this vendor's customers. */
export const DEFAULT_DISCOM = 'WBSEDCL';

/** Registered office as printed on the agreement (note: it includes Jamalpur). */
export const DEFAULT_REGISTERED_OFFICE =
  'Uttarsura, Surekalna, Jamalpur, Purba Bardhaman, West Bengal-713408';
