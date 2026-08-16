/* ============================================================
   43 MUNN — PROJECT DATA
   This is the single source of truth for the schedule.
   Swap this file's contents (or feed it via CSV import) to
   update the whole website — nothing else needs to change.
   ============================================================ */

const PROJECT = {
  address: "43 Munn",
  type: "Residential Construction",
  start: "2026-08-07",              // Friday, Aug 7, 2026
  targetCompletion: "2027-04-07",   // ~8 months out
};

// Ontario statutory holidays covering the project window.
// Editable in-app under "Holidays" — add/remove as needed.
const DEFAULT_HOLIDAYS = [
  { date: "2026-09-07", name: "Labour Day" },
  { date: "2026-10-12", name: "Thanksgiving Day" },
  { date: "2026-12-25", name: "Christmas Day" },
  { date: "2026-12-26", name: "Boxing Day" },
  { date: "2027-01-01", name: "New Year's Day" },
  { date: "2027-02-15", name: "Family Day" },
  { date: "2027-04-02", name: "Good Friday" },
];

/*
  Each milestone:
    id           unique integer
    name         phase name
    duration     business days (editable)
    dependency   array of milestone ids that must finish first (empty = starts at project start)
    manualStart  ISO date string to override dependency-calculated start, or null
    status       "Not Started" | "In Progress" | "Complete" | "Delayed" | "On Hold"
    progress     0-100
    trade        assigned trade / contractor
    notes        free text

  Start/finish dates are NOT stored here — they are calculated live
  from duration + dependencies + business-day/holiday rules.
*/
const BASELINE_MILESTONES = [
  { id: 1,  name: "Demolition",                       duration: 5,  dependency: [],         manualStart: null, status: "In Progress", progress: 40, trade: "General Contractor",        notes: "Remove existing structure & clear site." },
  { id: 2,  name: "Excavation",                       duration: 6,  dependency: [1],        manualStart: null, status: "Not Started", progress: 0,  trade: "Excavation Contractor",      notes: "Bulk dig to design subgrade." },
  { id: 3,  name: "Footing",                           duration: 3,  dependency: [2],        manualStart: null, status: "Not Started", progress: 0,  trade: "AT McLaren",                 notes: "Footing forms, rebar, pour." },
  { id: 31, name: "Foundation",                        duration: 3,  dependency: [3],        manualStart: null, status: "Not Started", progress: 0,  trade: "Total Excavation",           notes: "Foundation walls & slab per Total Excavation scope." },
  { id: 4,  name: "Underground Services",              duration: 4,  dependency: [31],       manualStart: null, status: "Not Started", progress: 0,  trade: "Plumbing / Utilities",       notes: "Under-slab plumbing, drainage, conduit." },
  { id: 5,  name: "Foundation Walls / Waterproofing",  duration: 8,  dependency: [4],        manualStart: null, status: "Not Started", progress: 0,  trade: "Concrete Contractor",        notes: "Foundation walls, damp-proofing, cure time." },
  { id: 6,  name: "Backfill",                          duration: 3,  dependency: [5],        manualStart: null, status: "Not Started", progress: 0,  trade: "Excavation Contractor",      notes: "Backfill & compact around foundation." },
  { id: 7,  name: "Framing",                           duration: 22, dependency: [6],        manualStart: null, status: "Not Started", progress: 0,  trade: "Framing Crew",               notes: "Floor, wall, and roof framing." },
  { id: 8,  name: "Roofing",                           duration: 8,  dependency: [7],        manualStart: null, status: "Not Started", progress: 0,  trade: "Roofing Contractor",         notes: "Sheathing, underlayment, shingles." },
  { id: 9,  name: "Windows & Exterior Doors",          duration: 5,  dependency: [7],        manualStart: null, status: "Not Started", progress: 0,  trade: "Window Installer",           notes: "Install & flash windows and exterior doors." },
  { id: 10, name: "Plumbing Rough-in",                 duration: 7,  dependency: [8, 9],     manualStart: null, status: "Not Started", progress: 0,  trade: "Plumbing Contractor",        notes: "Supply, DWV, stack-outs." },
  { id: 11, name: "HVAC Rough-in",                     duration: 8,  dependency: [8, 9],     manualStart: null, status: "Not Started", progress: 0,  trade: "HVAC Contractor",            notes: "Ductwork & equipment sets." },
  { id: 12, name: "Electrical Rough-in",                duration: 7,  dependency: [8, 9],     manualStart: null, status: "Not Started", progress: 0,  trade: "Electrical Contractor",      notes: "Wiring, panel, boxes." },
  { id: 13, name: "Insulation",                        duration: 5,  dependency: [10, 11, 12], manualStart: null, status: "Not Started", progress: 0,  trade: "Insulation Contractor",      notes: "Wall & attic insulation, air sealing." },
  { id: 14, name: "Drywall",                           duration: 12, dependency: [13],       manualStart: null, status: "Not Started", progress: 0,  trade: "Drywall Contractor",         notes: "Hang board throughout." },
  { id: 15, name: "Taping / Mudding",                  duration: 7,  dependency: [14],       manualStart: null, status: "Not Started", progress: 0,  trade: "Drywall Contractor",         notes: "Tape, mud, sand to paint-ready." },
  { id: 16, name: "Interior Doors & Trim",              duration: 8,  dependency: [15],       manualStart: null, status: "Not Started", progress: 0,  trade: "Finish Carpenter",           notes: "Hang doors, install casing & baseboard." },
  { id: 17, name: "Cabinetry",                         duration: 6,  dependency: [15],       manualStart: null, status: "Not Started", progress: 0,  trade: "Cabinet Installer",          notes: "Kitchen & bath cabinet install." },
  { id: 18, name: "Tile",                              duration: 7,  dependency: [15],       manualStart: null, status: "Not Started", progress: 0,  trade: "Tile Contractor",            notes: "Bath & wet-area tile." },
  { id: 19, name: "Flooring",                          duration: 8,  dependency: [16, 17, 18], manualStart: null, status: "Not Started", progress: 0,  trade: "Flooring Contractor",        notes: "Subfloor prep & finish flooring." },
  { id: 20, name: "Interior Painting",                 duration: 10, dependency: [19],       manualStart: null, status: "Not Started", progress: 0,  trade: "Painting Contractor",        notes: "Prime & finish coats." },
  { id: 21, name: "Plumbing Finish",                   duration: 4,  dependency: [20],       manualStart: null, status: "Not Started", progress: 0,  trade: "Plumbing Contractor",        notes: "Fixtures, faucets, trim." },
  { id: 22, name: "Electrical Finish",                 duration: 4,  dependency: [20],       manualStart: null, status: "Not Started", progress: 0,  trade: "Electrical Contractor",      notes: "Devices, fixtures, panel finish." },
  { id: 23, name: "HVAC Finish",                       duration: 3,  dependency: [20],       manualStart: null, status: "Not Started", progress: 0,  trade: "HVAC Contractor",            notes: "Grilles, thermostats, startup." },
  { id: 24, name: "Exterior Finishes",                 duration: 10, dependency: [9],        manualStart: null, status: "Not Started", progress: 0,  trade: "Siding / Masonry Contractor",notes: "Siding, brick veneer, exterior trim." },
  { id: 25, name: "Railings",                          duration: 4,  dependency: [24],       manualStart: null, status: "Not Started", progress: 0,  trade: "Metal Fabricator",           notes: "Interior & exterior railings." },
  { id: 26, name: "Landscaping / Site Work",            duration: 6,  dependency: [25],       manualStart: null, status: "Not Started", progress: 0,  trade: "Landscaping Contractor",     notes: "Grading, sod, driveway, plantings." },
  { id: 27, name: "Deficiencies",                       duration: 5,  dependency: [21, 22, 23, 26], manualStart: null, status: "Not Started", progress: 0, trade: "General Contractor", notes: "Punch-list corrections." },
  { id: 28, name: "Final Cleaning",                     duration: 3,  dependency: [27],       manualStart: null, status: "Not Started", progress: 0,  trade: "Cleaning Crew",              notes: "Construction clean, detail clean." },
  { id: 29, name: "Final Inspection",                   duration: 2,  dependency: [28],       manualStart: null, status: "Not Started", progress: 0,  trade: "Building Inspector",         notes: "Municipal final inspection & sign-off." },
  { id: 30, name: "Project Completion",                 duration: 1,  dependency: [29],       manualStart: null, status: "Not Started", progress: 0,  trade: "General Contractor",         notes: "Occupancy / handover." },
];

/*
  Financial fields, added to every trade/milestone:
    contractPrice      number — original quoted/contract price
    changeOrders        [{ id, description, date, amount, approvedBy, status, notes }]
                         status: "Pending" | "Approved" | "Rejected"
                         only "Approved" orders count toward the revised contract value
    invoices             [{ id, invoiceNumber, vendor, invoiceDate, dueDate, subtotal, hst, total,
                            paymentStatus, paymentDate, fileName, notes }]
                         paymentStatus: "Paid" | "Pending" | "Overdue"
    paymentDetails       { vendorName, poNumber, paymentTerms, paymentMethod, bankName, accountName,
                            accountLast4, paymentReference, notes }
  All default to empty/zero — real figures are entered per-trade via the app's Financials tab.
*/
BASELINE_MILESTONES.forEach((m) => {
  m.contractPrice = 0;
  m.changeOrders = [];
  m.invoices = [];
  m.paymentDetails = {
    vendorName: m.trade,
    poNumber: "",
    paymentTerms: "",
    paymentMethod: "",
    bankName: "",
    accountName: "",
    accountLast4: "",
    paymentReference: "",
    notes: "",
  };
});

/*
  TRADES — independent from milestones.

  A trade is its own record with a stable tradeId (e.g. "TRD-001") that
  never changes even if the trade's name is edited. A trade may optionally
  link to a milestone via milestoneId (or null for no link). Multiple
  trades can point at the same milestone; a milestone can have zero trades.

  Structure:
    tradeId, tradeName, vendor, scope, milestoneId,
    contractAmount, hst, workStatus, paymentTerms, poNumber, notes,
    active, createdAt, updatedAt,
    changeOrders: [{ changeOrderId, description, date, amount, approvedBy, status, notes }]
    invoices:     [{ invoiceId, invoiceNumber, vendor, invoiceDate, dueDate, subtotal, hst, total, fileName, notes }]
    payments:     [{ paymentId, invoiceId (nullable), amount, date, method, reference, notes }]

  Financial totals (invoiced, paid, outstanding, payment status) are always
  calculated live from changeOrders + invoices + payments — never stored.
  This file starts with zero trades; add them from the live site's
  "+ Add Trade" button, no code editing required.
*/
const BASELINE_TRADES = [
  {
    tradeId: "TRD-001", tradeName: "AT McLaren", vendor: "AT McLaren", scope: "Footing",
    milestoneIds: [3], contractAmount: 0, hst: 0, workStatus: "Not Started",
    paymentTerms: "", poNumber: "", notes: "",
    active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    changeOrders: [], invoices: [], payments: [],
  },
  {
    tradeId: "TRD-002", tradeName: "Total Excavation", vendor: "Total Excavation", scope: "Excavation & Foundation",
    milestoneIds: [2, 31], contractAmount: 0, hst: 0, workStatus: "Not Started",
    paymentTerms: "", poNumber: "", notes: "",
    active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    changeOrders: [], invoices: [], payments: [],
  },
];
