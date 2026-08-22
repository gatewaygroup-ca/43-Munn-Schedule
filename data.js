/* ============================================================
   PROJECT DATA / BASELINE CONFIGURATION — 43 MUNN
   ------------------------------------------------------------
   This file is the ONLY thing that differs between project sites
   running this same codebase (this one vs. 38 Niagara). See the
   38 Niagara data.js for the full explanation of how this is used
   now that the app is Firebase-backed (short version: this is a
   one-time seed + Reset baseline; live edits happen in the app).
   ============================================================ */

const PROJECT_ID = "43-munn";

const DEFAULT_SETTINGS = {
  title: "43 Munn",
  address: "43 Munn",
  clientName: "",
  projectType: "Residential Construction",
  description: "",
  start: "2026-08-07",
  targetCompletion: "2027-04-07",
  status: "In Progress",
  companyName: "Gateway Investment Group Inc.",
  companyLogoDataUrl: null,
  subtitle: "Project milestone schedule & live tracker",
  projectManager: "",
  contact: "",
  footerText: "",
  showFinancialsToClients: false,
};

const DEFAULT_HOLIDAYS = [
  { date: "2026-09-07", name: "Labour Day" },
  { date: "2026-10-12", name: "Thanksgiving Day" },
  { date: "2026-12-25", name: "Christmas Day" },
  { date: "2026-12-26", name: "Boxing Day" },
  { date: "2027-01-01", name: "New Year's Day" },
  { date: "2027-02-15", name: "Family Day" },
  { date: "2027-04-02", name: "Good Friday" },
];

const BASELINE_MILESTONES = [
  { id: 1,  name: "Demolition",                       duration: 5,  dependency: [],         manualStart: null, status: "In Progress", progress: 40, trade: "General Contractor",        priority: "Normal", notes: "Remove existing structure & clear site." },
  { id: 2,  name: "Excavation",                       duration: 6,  dependency: [1],        manualStart: null, status: "Not Started", progress: 0,  trade: "Excavation Contractor",      priority: "Normal", notes: "Bulk dig to design subgrade." },
  { id: 3,  name: "Footing",                           duration: 3,  dependency: [2],        manualStart: null, status: "Not Started", progress: 0,  trade: "AT McLaren",                 priority: "Normal", notes: "Footing forms, rebar, pour." },
  { id: 31, name: "Foundation",                        duration: 3,  dependency: [3],        manualStart: null, status: "Not Started", progress: 0,  trade: "Total Excavation",           priority: "Normal", notes: "Foundation walls & slab per Total Excavation scope." },
  { id: 4,  name: "Underground Services",              duration: 4,  dependency: [31],       manualStart: null, status: "Not Started", progress: 0,  trade: "Plumbing / Utilities",       priority: "Normal", notes: "Under-slab plumbing, drainage, conduit." },
  { id: 5,  name: "Foundation Walls / Waterproofing",  duration: 8,  dependency: [4],        manualStart: null, status: "Not Started", progress: 0,  trade: "Concrete Contractor",        priority: "Normal", notes: "Foundation walls, damp-proofing, cure time." },
  { id: 6,  name: "Backfill",                          duration: 3,  dependency: [5],        manualStart: null, status: "Not Started", progress: 0,  trade: "Excavation Contractor",      priority: "Normal", notes: "Backfill & compact around foundation." },
  { id: 7,  name: "Framing",                           duration: 22, dependency: [6],        manualStart: null, status: "Not Started", progress: 0,  trade: "Framing Crew",               priority: "High",   notes: "Floor, wall, and roof framing." },
  { id: 8,  name: "Roofing",                           duration: 8,  dependency: [7],        manualStart: null, status: "Not Started", progress: 0,  trade: "Roofing Contractor",         priority: "Normal", notes: "Sheathing, underlayment, shingles." },
  { id: 9,  name: "Windows & Exterior Doors",          duration: 5,  dependency: [7],        manualStart: null, status: "Not Started", progress: 0,  trade: "Window Installer",           priority: "Normal", notes: "Install & flash windows and exterior doors." },
  { id: 10, name: "Plumbing Rough-in",                 duration: 7,  dependency: [8, 9],     manualStart: null, status: "Not Started", progress: 0,  trade: "Plumbing Contractor",        priority: "Normal", notes: "Supply, DWV, stack-outs." },
  { id: 11, name: "HVAC Rough-in",                     duration: 8,  dependency: [8, 9],     manualStart: null, status: "Not Started", progress: 0,  trade: "HVAC Contractor",            priority: "Normal", notes: "Ductwork & equipment sets." },
  { id: 12, name: "Electrical Rough-in",                duration: 7,  dependency: [8, 9],     manualStart: null, status: "Not Started", progress: 0,  trade: "Electrical Contractor",      priority: "Normal", notes: "Wiring, panel, boxes." },
  { id: 13, name: "Insulation",                        duration: 5,  dependency: [10, 11, 12], manualStart: null, status: "Not Started", progress: 0,  trade: "Insulation Contractor",      priority: "Normal", notes: "Wall & attic insulation, air sealing." },
  { id: 14, name: "Drywall",                           duration: 12, dependency: [13],       manualStart: null, status: "Not Started", progress: 0,  trade: "Drywall Contractor",         priority: "Normal", notes: "Hang board throughout." },
  { id: 15, name: "Taping / Mudding",                  duration: 7,  dependency: [14],       manualStart: null, status: "Not Started", progress: 0,  trade: "Drywall Contractor",         priority: "Normal", notes: "Tape, mud, sand to paint-ready." },
  { id: 16, name: "Interior Doors & Trim",              duration: 8,  dependency: [15],       manualStart: null, status: "Not Started", progress: 0,  trade: "Finish Carpenter",           priority: "Normal", notes: "Hang doors, install casing & baseboard." },
  { id: 17, name: "Cabinetry",                         duration: 6,  dependency: [15],       manualStart: null, status: "Not Started", progress: 0,  trade: "Cabinet Installer",          priority: "Normal", notes: "Kitchen & bath cabinet install." },
  { id: 18, name: "Tile",                              duration: 7,  dependency: [15],       manualStart: null, status: "Not Started", progress: 0,  trade: "Tile Contractor",            priority: "Normal", notes: "Bath & wet-area tile." },
  { id: 19, name: "Flooring",                          duration: 8,  dependency: [16, 17, 18], manualStart: null, status: "Not Started", progress: 0,  trade: "Flooring Contractor",        priority: "Normal", notes: "Subfloor prep & finish flooring." },
  { id: 20, name: "Interior Painting",                 duration: 10, dependency: [19],       manualStart: null, status: "Not Started", progress: 0,  trade: "Painting Contractor",        priority: "Normal", notes: "Prime & finish coats." },
  { id: 21, name: "Plumbing Finish",                   duration: 4,  dependency: [20],       manualStart: null, status: "Not Started", progress: 0,  trade: "Plumbing Contractor",        priority: "Normal", notes: "Fixtures, faucets, trim." },
  { id: 22, name: "Electrical Finish",                 duration: 4,  dependency: [20],       manualStart: null, status: "Not Started", progress: 0,  trade: "Electrical Contractor",      priority: "Normal", notes: "Devices, fixtures, panel finish." },
  { id: 23, name: "HVAC Finish",                       duration: 3,  dependency: [20],       manualStart: null, status: "Not Started", progress: 0,  trade: "HVAC Contractor",            priority: "Normal", notes: "Grilles, thermostats, startup." },
  { id: 24, name: "Exterior Finishes",                 duration: 10, dependency: [9],        manualStart: null, status: "Not Started", progress: 0,  trade: "Siding / Masonry Contractor",priority: "Normal", notes: "Siding, brick veneer, exterior trim." },
  { id: 25, name: "Railings",                          duration: 4,  dependency: [24],       manualStart: null, status: "Not Started", progress: 0,  trade: "Metal Fabricator",           priority: "Normal", notes: "Interior & exterior railings." },
  { id: 26, name: "Landscaping / Site Work",            duration: 6,  dependency: [25],       manualStart: null, status: "Not Started", progress: 0,  trade: "Landscaping Contractor",     priority: "Normal", notes: "Grading, sod, driveway, plantings." },
  { id: 27, name: "Deficiencies",                       duration: 5,  dependency: [21, 22, 23, 26], manualStart: null, status: "Not Started", progress: 0, trade: "General Contractor", priority: "Normal", notes: "Punch-list corrections." },
  { id: 28, name: "Final Cleaning",                     duration: 3,  dependency: [27],       manualStart: null, status: "Not Started", progress: 0,  trade: "Cleaning Crew",              priority: "Normal", notes: "Construction clean, detail clean." },
  { id: 29, name: "Final Inspection",                   duration: 2,  dependency: [28],       manualStart: null, status: "Not Started", progress: 0,  trade: "Building Inspector",         priority: "High",   notes: "Municipal final inspection & sign-off." },
  { id: 30, name: "Project Completion",                 duration: 1,  dependency: [29],       manualStart: null, status: "Not Started", progress: 0,  trade: "General Contractor",         priority: "Normal", notes: "Occupancy / handover." },
];

BASELINE_MILESTONES.forEach((m) => {
  m.description = m.description || "";
  m.contractPrice = 0;
  m.changeOrders = [];
  m.invoices = [];
  m.gallery = [];
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

// This preserves the two trades that already existed in this project's
// live Firebase data (AT McLaren, Total Excavation) as the RESET baseline.
// They are not re-created on normal load -- your live Firebase data
// (including any figures already entered against them) takes precedence
// and is migrated automatically the first time this version loads;
// this array is only used if you ever hit "Reset to Original Schedule."
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
