// Screenshot harness for the property card (§0 step 0.5). Not a gate: the real
// assertions live in tests/e2e-county-parcels.spec.js and
// tests/e2e-clients-exhaustive.spec.js. This renders the card with REAL Shawnee
// County records so the picture can be reviewed before anything is deployed.
//
// Three cards on purpose, because they are the three shapes the owner was
// looking at when he said the data was too small and commercial was missing:
// a pre-1978 house (the lead gate armed), a commercial parcel (which used to
// render as an owner and a dollar figure and nothing else), and a client with
// two properties (the collapsed accordion row).
const { test, mockAllExternal, waitForAppBoot } = require('./helpers');

// Straight from td_county_parcels, 2026-09-22. Not invented: R46715 is the
// owner's own house, R53719 is the Aldi on SW Arvonia.
const SEED = [
  {
    id: 9001, name: 'Blake Sample', phone: '7852550001', addr: '2015 SW Randolph Ave, Topeka, KS 66604',
    street: '2015 SW Randolph Ave', city: 'Topeka', state: 'KS', zip: '66604',
    partyType: 'homeowner', extraAddresses: [], properties: {},
    yearBuilt: 1940, sqft: 1012, bedrooms: 3, bathrooms: 1, lotSize: 0.27054033,
    estimatedValue: 161140, ownerName: 'SAMPLE, LOGAN & BLAKE REVOCABLE LIVING TRUST',
    propDataSource: 'county', propDataCounty: 'Shawnee, KS', propDataUse: 'Single family residence (detached)', propDataClass: 'Residential',
    propDataExact: true, propDataMiss: false, propDataFetchedAt: '2026-09-22T13:00:00.000Z',
    propDataYearTo: 1940, propDataUnits: 1, propDataBuildings: 1, propDataBasement: 'Full', propDataFrontage: 88, propDataDepth: 135,
    propDataLotSqft: 11784.69, propDataSoil: 'Ladysmith silty clay loam, 1 to 3 percent slopes', propDataFloodZone: 'none', propDataFloodSfha: false,
    propDataSubdivision: 'COLLEGE HILL (W OF MEDFD', propDataDeed: '2022R20196', propDataLandValue: 10530, propDataBldgValue: 150610, propDataParcel: '1410204027014000',
    assessorUrl: 'https://ares.sncoapps.us/BasicSearch/Index?searchCriteria=2015+SW+RANDOLPH+AVE&countyCode=089&searchBy=address&listMode=card',
  },
  {
    id: 9002, name: 'Aldi', phone: '7852550002', addr: '1530 SW Arvonia Pl, Topeka, KS 66615',
    street: '1530 SW Arvonia Pl', city: 'Topeka', state: 'KS', zip: '66615',
    partyType: 'business', extraAddresses: [], properties: {},
    yearBuilt: 2001, sqft: 18380, lotSize: 2.7635758,
    estimatedValue: 1617300, ownerName: 'ALDI INC',
    propDataSource: 'county', propDataCounty: 'Shawnee, KS', propDataUse: 'Grocery store / supermarket', propDataClass: 'Commercial',
    propDataExact: true, propDataMiss: false, propDataFetchedAt: '2026-09-22T13:00:00.000Z',
    propDataYearTo: 2017, propDataBuildings: 1, propDataLotSqft: 121223.36, propDataSoil: 'Martin silty clay loam, 3 to 7 percent slopes',
    propDataFloodZone: 'none', propDataFloodSfha: false, propDataSubdivision: 'SHIDELER PLAZA NO 3', propDataLandValue: 651670, propDataBldgValue: 965630,
    propDataParcel: '1430501002002030',
    assessorUrl: 'https://ares.sncoapps.us/BasicSearch/Index?searchCriteria=1530+SW+ARVONIA+PL&countyCode=089&searchBy=address&listMode=card',
  },
  {
    id: 9003, name: 'Pepe Miranda', phone: '7852550003', addr: '306 SW Elmwood Ave, Topeka, KS 66606',
    street: '306 SW Elmwood Ave', city: 'Topeka', state: 'KS', zip: '66606',
    partyType: 'homeowner',
    extraAddresses: [{ label: 'Rental', addr: '6908 SW 17th St, Topeka, KS 66615' }],
    yearBuilt: 1916, sqft: 969, bedrooms: 2, bathrooms: 1, lotSize: 0.05835733,
    estimatedValue: 95710, ownerName: 'CASASMIRANDA LLC',
    propDataSource: 'county', propDataCounty: 'Shawnee, KS', propDataUse: 'Single family residence (detached)', propDataClass: 'Residential',
    propDataExact: true, propDataMiss: false, propDataFetchedAt: '2026-09-22T13:00:00.000Z',
    assessorUrl: 'https://ares.sncoapps.us/BasicSearch/Index?searchCriteria=306+SW+ELMWOOD+AVE&countyCode=089&searchBy=address&listMode=card',
    properties: {
      '6908 sw 17th st': {
        yearBuilt: 2003, sqft: 1367, bedrooms: 4, bathrooms: 3, lotSize: 0.29610643,
        estimatedValue: 328550, ownerName: 'CASASMIRANDA LLC', propDataBasement: 'Walkout ', propDataFrontage: 60, propDataDepth: 215,
        propDataSoil: 'Sogn-Vinland complex, 3 to 25 percent slopes', propDataFloodZone: 'none', propDataFloodSfha: false,
        propDataSubdivision: 'HIDDEN VALLEY', propDataDeed: '2021R09925',
        propDataSource: 'county', propDataCounty: 'Shawnee, KS',
        propDataUse: 'Single family residence (detached)', propDataClass: 'Residential', propDataExact: true, propDataMiss: false,
        assessorUrl: 'https://ares.sncoapps.us/BasicSearch/Index?searchCriteria=6908+SW+17TH+ST&countyCode=089&searchBy=address&listMode=card',
      },
    },
  },
  // 6927 NW 46th St: the one loaded parcel inside a FEMA hazard area. The
  // owner of record is left off; the card only needs the flood shape.
  {
    id: 9004, name: 'Flood Zone Case', phone: '7852550004', addr: '6927 NW 46th St, Topeka, KS 66618',
    street: '6927 NW 46th St', city: 'Topeka', state: 'KS', zip: '66618',
    partyType: 'homeowner', extraAddresses: [], properties: {},
    yearBuilt: 1880, sqft: 2026, bedrooms: 3, bathrooms: 2.5, lotSize: 1.89953805, estimatedValue: 325700,
    propDataSource: 'county', propDataCounty: 'Shawnee, KS', propDataUse: 'Single family residence (detached)', propDataClass: 'Residential',
    propDataExact: true, propDataMiss: false, propDataBasement: 'Full', propDataLotSqft: 82743.55,
    propDataSoil: 'Chase silt loam, occasionally flooded', propDataFloodZone: 'A', propDataFloodSfha: true,
    propDataDeed: '2019R10360', propDataLandValue: 33350, propDataBldgValue: 292350, propDataParcel: '0930600001001010',
  },
];

async function shoot(page, clientId, file) {
  await mockAllExternal(page);
  await page.addInitScript((seed) => { window.__SHOT_CLIENTS = seed; }, SEED);
  await page.goto('/index.html');
  await waitForAppBoot(page);
  await page.evaluate((id) => {
    // Replace the book wholesale rather than appending: a screenshot of the
    // card must not depend on whatever the boot fixture happened to seed.
    clients.length = 0;
    (window.__SHOT_CLIENTS || []).forEach((c) => clients.push(JSON.parse(JSON.stringify(c))));
    currentClientId = id;
    // The card lives inside #pg-client-detail, so the page has to be the active
    // one or the list renders into a hidden container and never paints.
    if (typeof renderClientDetail === 'function') renderClientDetail();
    if (typeof goPg === 'function') goPg('pg-client-detail');
    if (typeof renderCDAddresses === 'function') renderCDAddresses();
  }, clientId);
  // The fixed mobile top bar floats over a tall element screenshot; it is
  // chrome, not the card, so it is hidden for the picture only.
  await page.addStyleTag({ content: '#mobile-topbar,#mobile-tabbar{visibility:hidden!important}' });
  await page.waitForTimeout(400);
  const el = await page.$('#cd-addresses-list');
  if (el) await el.screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage: false });
}

test.describe('property card screenshot', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('pre-1978 house', async ({ page }) => { await shoot(page, 9001, 'prop-card-house.png'); });
  test('commercial parcel', async ({ page }) => { await shoot(page, 9002, 'prop-card-commercial.png'); });
  test('flood hazard house', async ({ page }) => { await shoot(page, 9004, 'prop-card-flood.png'); });
  test('two properties', async ({ page }) => { await shoot(page, 9003, 'prop-card-multi.png'); });
});
